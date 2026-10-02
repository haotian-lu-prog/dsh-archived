// dsh-archived-sessions-manager host half.
//
// Adds permanent deletion for archived sessions to the DSH web server:
//
//   GET  /api/dsh-archived-sessions/state              archived rows + on-disk truth
//   POST /api/dsh-archived-sessions/delete             { sessionId, mode }
//   POST /api/dsh-archived-sessions/delete-all         { mode, ids? }
//   POST /api/dsh-archived-sessions/restore            { sessionId }
//   POST /api/dsh-archived-sessions/empty-quarantine   purge everything parked
//   POST /api/dsh-archived-sessions/reveal             { sessionId } -> file manager
//
// One archived session owns three pieces of state, and a permanent delete must
// clear all three or the archive list keeps lying to the user:
//
//   1. the artifact directory   $DSH_HOME/sessions/<encoded-workspace>/session-<id>/
//   2. the projection cache doc $DSH_HOME/storages/session_projcache/sessions/<id>.json
//   3. the archive index entry  workspace registry `archivedSessionIds`
//
// (3) goes through the official registry write, so every connected client
// refreshes its archive set through the normal broadcast. The registry's
// unarchiveSession deliberately runs no existence check, which is exactly what
// lets a leftover index entry whose session is already gone be cleaned too.
//
// Deleting is a MOVE by default: see lib/host/quarantine.js. `mode: "forever"`
// is the only irreversible path, and it is never the default.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";

import {
  SESSION_ID,
  directorySize,
  dshHome,
  legacyAggregateFile,
  locateArtifacts,
  projectionCacheFile,
  quarantineArtifactDir,
} from "./host/paths.js";
import {
  ancestorsOf,
  isRunning,
  legacyAggregateRows,
  liveChildrenOf,
  readCacheDocument,
  runningDescendants,
} from "./host/metadata.js";
import {
  expireQuarantine,
  listQuarantine,
  purgeQuarantineEntry,
  quarantineEntryFor,
  quarantineSession,
  restoreSession,
} from "./host/quarantine.js";
import { failureDetail, isTrustedRequest, json, readJsonBody } from "./host/trust.js";

export const name = "dsh-archived-sessions-manager";
export const inject = ["webServer", "workspaceRegistry", "agents", "sessions"];

const BASE = "/api/dsh-archived-sessions";
const STATE_PATH = BASE + "/state";
const DELETE_PATH = BASE + "/delete";
const DELETE_ALL_PATH = BASE + "/delete-all";
const RESTORE_PATH = BASE + "/restore";
const EMPTY_PATH = BASE + "/empty-quarantine";
const REVEAL_PATH = BASE + "/reveal";

/** Wire version of the route contract, so the panel can detect a half-upgraded host. */
export const API_VERSION = 2;

/** How long a quarantined session stays recoverable before it expires. */
const QUARANTINE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Post-delete sweep delays (ms): a lingering idle agent can rewrite its cache once more. */
const SWEEP_DELAYS = [3_000, 15_000, 60_000];

/** Live sweep timers, cleared when the plugin unloads. */
const sweeps = new Set();

/** Session ids with a delete in flight, so two tabs cannot interleave on one row. */
const inFlight = new Set();

/** The archive set's owner. `ctx.get` is the documented safe read; the property stays as a fallback. */
function registryOf(ctx) {
  try {
    const resolved = ctx.get?.("workspaceRegistry");
    if (resolved !== undefined && resolved !== null) return resolved;
  } catch {
    // An unresolvable service read falls through to the property form.
  }
  return ctx.workspaceRegistry;
}

/** Host-owned archive set; a missing registry degrades to "nothing archived". */
function archivedIds(ctx) {
  const ids = registryOf(ctx)?.archivedSessionIds;
  return Array.isArray(ids) ? [...ids] : [];
}

/**
 * Whether this host still offers what a destructive route needs. A host whose
 * registry lost `unarchiveSession` cannot clear the archive index, and a delete
 * that leaves the index behind is the exact "fake success" this plugin exists
 * to prevent — so the routes refuse instead of half-working.
 */
function hostSupportsDelete(ctx) {
  return typeof registryOf(ctx)?.unarchiveSession === "function";
}

/** Refusal codes; the panel localizes every one of them. */
function refuse(code, extra) {
  return { ok: false, error: code, ...(extra ?? {}) };
}

function sumBytes(entries) {
  let total = 0;
  for (const entry of entries) total += entry.bytes ?? 0;
  return total;
}

/** Archived rows with everything the panel needs to draw them, plus quarantine. */
async function stateOf(ctx) {
  const ids = archivedIds(ctx);
  const legacyRows = await legacyAggregateRows();
  const items = [];
  for (const id of ids) {
    const dirs = await locateArtifacts(id);
    let bytes = 0;
    for (const dir of dirs) bytes += await directorySize(dir);
    const cacheFile = projectionCacheFile(id);
    const cache = existsSync(cacheFile);
    const document = cache ? await readCacheDocument(id) : null;
    items.push({
      id,
      archived: true,
      title: document?.title ?? null,
      cwd: document?.cwd ?? null,
      createdAt: document?.createdAt ?? null,
      artifact: { present: dirs.length > 0, bytes, path: dirs.length > 0 ? dirs[0] : null },
      cache,
      indexOnly: dirs.length === 0 && cache === false,
      cacheOnly: dirs.length === 0 && cache === true,
      running: isRunning(ctx, id),
      ancestors: ancestorsOf(ctx, id),
      children: liveChildrenOf(ctx, id),
      legacyRow: legacyRows !== null && legacyRows.has(id),
    });
  }
  const parked = await listQuarantine();
  return {
    ok: true,
    apiVersion: API_VERSION,
    home: dshHome(),
    items,
    quarantine: { count: parked.length, bytes: sumBytes(parked), items: parked },
    legacy: {
      present: existsSync(legacyAggregateFile()),
      rows: legacyRows === null ? null : legacyRows.size,
    },
  };
}

/**
 * Delay a delete that already happened in full. A session archived while its
 * agent was still open keeps that idle agent in memory, and DSH's projection
 * service can rewrite the cache JSON (never the log) from that state seconds
 * later, so every delete schedules bounded best-effort sweeps that re-remove
 * such residue.
 */
function scheduleSweep(ctx, sessionId) {
  if (sweeps.size >= 192) return;
  for (const delay of SWEEP_DELAYS) {
    const timer = setTimeout(() => {
      sweeps.delete(timer);
      sweepResidue(ctx, sessionId).catch((error) => {
        ctx.logger?.debug?.(`[dsh-archived-sessions-manager] sweep ${sessionId} failed:`, error);
      });
    }, delay);
    timer.unref?.();
    sweeps.add(timer);
  }
}

/**
 * Re-remove the cache document a lingering idle agent can rewrite after a
 * delete. Only that: the log directory never resurrects, and a directory back
 * on disk means the session itself came back (a restore whose re-archive
 * failed), which the sweep must not touch.
 */
async function sweepResidue(ctx, sessionId) {
  if (archivedIds(ctx).includes(sessionId)) return;
  if (isRunning(ctx, sessionId)) return;
  if ((await locateArtifacts(sessionId)).length > 0) return;
  const cacheFile = projectionCacheFile(sessionId);
  if (existsSync(cacheFile)) await rm(cacheFile, { force: true });
}

/** Serialize destructive work per session so two tabs cannot interleave. */
async function withLock(sessionId, work) {
  if (inFlight.has(sessionId)) return refuse("busy", { sessionId });
  inFlight.add(sessionId);
  try {
    return await work();
  } finally {
    inFlight.delete(sessionId);
  }
}

/**
 * Permanently remove (or park) one archived session: artifacts, projection
 * cache, then the archive index entry. Refusals are explicit codes.
 */
async function deleteOne(ctx, sessionId, mode) {
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return refuse("invalid-session-id", { sessionId });
  if (!hostSupportsDelete(ctx)) return refuse("no-registry", { sessionId });
  if (!archivedIds(ctx).includes(sessionId)) return refuse("not-archived", { sessionId });
  if (isRunning(ctx, sessionId)) return refuse("session-running", { sessionId });
  const descendants = runningDescendants(ctx, sessionId);
  if (descendants.length > 0) return refuse("subagent-running", { sessionId, descendants });

  return withLock(sessionId, async () => {
    const dirs = await locateArtifacts(sessionId);
    const cacheFile = projectionCacheFile(sessionId);
    let bytes = 0;
    for (const dir of dirs) bytes += await directorySize(dir);

    let removed;
    if (mode === "forever") {
      for (const dir of dirs) await rm(dir, { recursive: true, force: true });
      let cache = false;
      if (existsSync(cacheFile)) {
        await rm(cacheFile, { force: true });
        cache = true;
      }
      removed = { directories: dirs.length, bytes, cache };
    } else if (dirs.length === 0 && !existsSync(cacheFile)) {
      // An index-only entry has no payload to park. Creating an empty recycle-bin
      // entry for it would put something in the bin that can never be restored,
      // and that the panel would not even show.
      removed = { directories: 0, bytes: 0, cache: false, parked: false };
    } else {
      const document = existsSync(cacheFile) ? await readCacheDocument(sessionId) : null;
      removed = await quarantineSession(sessionId, {
        dirs,
        cacheFile,
        meta: {
          deletedAt: Date.now(),
          title: document?.title ?? null,
          cwd: document?.cwd ?? null,
          workspaceDir: dirs.length > 0 ? dirname(dirs[0]) : null,
        },
      });
      removed.parked = true;
    }

    await registryOf(ctx).unarchiveSession(sessionId);
    scheduleSweep(ctx, sessionId);
    ctx.logger?.info?.(
      `[dsh-archived-sessions-manager] delete ${sessionId} (${mode}): ${removed.directories} dir(s), ${removed.bytes} bytes`,
    );
    return { ok: true, sessionId, mode, removed, archivedSessionIds: archivedIds(ctx) };
  });
}

async function deleteMany(ctx, ids, mode) {
  const results = [];
  for (const id of ids) {
    try {
      results.push(await deleteOne(ctx, id, mode));
    } catch (error) {
      results.push(refuse("error", { sessionId: id, message: failureDetail(error) }));
    }
  }
  return { ok: results.every((result) => result.ok), results, archivedSessionIds: archivedIds(ctx) };
}

/** Put a parked session back where it came from and re-file it in the archive set. */
async function restoreOne(ctx, sessionId) {
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return refuse("invalid-session-id", { sessionId });
  const entry = await quarantineEntryFor(sessionId);
  if (entry === null) return refuse("not-quarantined", { sessionId });
  return withLock(sessionId, async () => {
    const restored = await restoreSession(ctx, sessionId, entry);
    ctx.logger?.info?.(`[dsh-archived-sessions-manager] restore ${sessionId}`);
    return { ok: true, sessionId, restored, archivedSessionIds: archivedIds(ctx) };
  });
}

/**
 * Open one session's directory in the platform file manager.
 *
 * `DSH_ARCHIVED_SESSIONS_OPENER=none` answers the path without launching
 * anything: a headless host has no file manager to launch, and a test run
 * should not pop windows on the operator's desktop.
 *
 * @returns the opener actually used.
 */
function revealPath(path) {
  if (process.env.DSH_ARCHIVED_SESSIONS_OPENER === "none") return "none";
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const child = spawn(command, [path], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
  return command;
}

async function revealOne(ctx, sessionId) {
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return refuse("invalid-session-id", { sessionId });
  const dirs = await locateArtifacts(sessionId);
  if (dirs.length > 0) {
    return { ok: true, sessionId, opened: dirs[0], where: "sessions", opener: revealPath(dirs[0]) };
  }
  const parked = quarantineArtifactDir(sessionId);
  if (existsSync(parked)) {
    return { ok: true, sessionId, opened: parked, where: "quarantine", opener: revealPath(parked) };
  }
  return refuse("no-artifact", { sessionId });
}

/** One route: trust gate, method gate, handler, uniform failure reporting. */
function route(ctx, { path, method, handle }) {
  return ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path,
        handler: async (request, response) => {
          if (request.method !== method) {
            json(response, 405, { error: "method-not-allowed" });
            return;
          }
          if (!isTrustedRequest(request)) {
            json(response, 403, { error: "forbidden" });
            return;
          }
          try {
            const body = method === "POST" ? await readJsonBody(request) : {};
            const result = await handle(body);
            json(response, result?.ok === false && result.error === "busy" ? 409 : 200, result);
          } catch (error) {
            ctx.logger?.warn?.(`[dsh-archived-sessions-manager] ${path} failed:`, error);
            json(response, 500, { ok: false, error: "internal", detail: failureDetail(error) });
          }
        },
      }),
    `dsh-archived-sessions-manager: ${path}`,
  );
}

export function apply(ctx) {
  route(ctx, { path: STATE_PATH, method: "GET", handle: () => stateOf(ctx) });

  route(ctx, {
    path: DELETE_PATH,
    method: "POST",
    handle: (body) => deleteOne(ctx, body?.sessionId, body?.mode === "forever" ? "forever" : "quarantine"),
  });

  route(ctx, {
    path: DELETE_ALL_PATH,
    method: "POST",
    handle: (body) => {
      const mode = body?.mode === "forever" ? "forever" : "quarantine";
      const ids = Array.isArray(body?.ids) ? body.ids : archivedIds(ctx);
      return deleteMany(ctx, ids, mode);
    },
  });

  route(ctx, { path: RESTORE_PATH, method: "POST", handle: (body) => restoreOne(ctx, body?.sessionId) });

  route(ctx, {
    path: EMPTY_PATH,
    method: "POST",
    handle: async () => {
      const parked = await listQuarantine();
      for (const entry of parked) await purgeQuarantineEntry(entry.id);
      return { ok: true, purged: parked.length, bytes: sumBytes(parked) };
    },
  });

  route(ctx, { path: REVEAL_PATH, method: "POST", handle: (body) => revealOne(ctx, body?.sessionId) });

  // A parked session is recoverable for a bounded window, then it expires on
  // its own so the quarantine can never become a second archive nobody drains.
  const expire = () =>
    expireQuarantine(QUARANTINE_MAX_AGE_MS).then((dropped) => {
      if (dropped.length > 0) ctx.logger?.info?.(`[dsh-archived-sessions-manager] quarantine expired: ${dropped.length}`);
    });
  expire().catch(() => {});
  const daily = setInterval(() => expire().catch(() => {}), 24 * 60 * 60 * 1000);
  daily.unref?.();
  ctx.effect(() => () => clearInterval(daily), "dsh-archived-sessions-manager: quarantine expiry");

  ctx.effect(
    () => () => {
      for (const timer of sweeps) clearTimeout(timer);
      sweeps.clear();
    },
    "dsh-archived-sessions-manager: sweep timers",
  );

  if (!hostSupportsDelete(ctx)) {
    ctx.logger?.warn?.(
      "[dsh-archived-sessions-manager] workspaceRegistry.unarchiveSession is missing — destructive routes will refuse",
    );
  }
  ctx.logger?.info?.("[dsh-archived-sessions-manager] host loaded");
}
