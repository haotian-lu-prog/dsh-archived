// dsh-archived host half.
//
// Adds permanent deletion for archived sessions to the DSH web server:
//
//   GET  /api/dsh-archived/state              archived rows + on-disk truth
//   POST /api/dsh-archived/delete             { sessionId, mode }
//   POST /api/dsh-archived/delete-all         { mode, ids? }
//   POST /api/dsh-archived/restore            { sessionId }
//   POST /api/dsh-archived/empty-quarantine   purge everything parked
//   POST /api/dsh-archived/reveal             { sessionId } -> file manager
//
// Stale sessions nobody archived get a second, narrower door:
//
//   POST /api/dsh-archived/sweep/scan         { days? } -> candidates (read-only)
//   POST /api/dsh-archived/sweep/delete       { ids, mode } -> recycle bin
//   POST /api/dsh-archived/sweep/settings     { enabled?, days? } -> weekly run
//   POST /api/dsh-archived/sweep/run          run the weekly sweep right now
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
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  SESSION_ID,
  directorySize,
  dshHome,
  legacyAggregateFile,
  locateArtifacts,
  projectionCacheFile,
  quarantineArtifactDir,
  sweepSettingsFile,
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
import {
  ACTIVE_GRACE_MS,
  DEFAULT_STALE_DAYS,
  detachAll,
  detachPlan,
  lastWriteMs,
  normalizeStaleDays,
  scanStaleSessions,
} from "./host/sweep.js";
import { failureDetail, json, readJsonBody, trustReport } from "./host/trust.js";

export const name = "dsh-archived";
export const inject = ["webServer", "workspaceRegistry", "agents", "sessions"];

const BASE = "/api/dsh-archived";

/**
 * The pre-rename prefix, still served so a tab that loaded the 0.2.0 client
 * keeps working across the rename instead of stranding the user on an error
 * page until they reload. The 0.2.0 client used the same six verbs, so the
 * alias is a prefix swap and nothing more.
 */
const LEGACY_BASE = "/api/dsh-archived-sessions";
/** Route suffixes, registered under both the current and the legacy prefix. */
const SUFFIX = {
  state: "/state",
  delete: "/delete",
  deleteAll: "/delete-all",
  restore: "/restore",
  empty: "/empty-quarantine",
  reveal: "/reveal",
  sweep: "/sweep/scan",
  sweepDelete: "/sweep/delete",
  sweepSettings: "/sweep/settings",
  sweepRun: "/sweep/run",
};

/** Wire version of the route contract, so the panel can detect a half-upgraded host. */
export const API_VERSION = 2;

/** How long a quarantined session stays recoverable before it expires. */
const QUARANTINE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Post-delete sweep delays (ms): a lingering idle agent can rewrite its cache once more. */
const SWEEP_DELAYS = [3_000, 15_000, 60_000];

/** The weekly auto-sweep: how often it may run, and how often the host checks whether it is due. */
const AUTO_SWEEP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTO_SWEEP_TICK_MS = 60 * 60 * 1000;

/** Live sweep timers, cleared when the plugin unloads. */
const sweeps = new Set();

/** Session ids with a delete in flight, so two tabs cannot interleave on one row. */
const inFlight = new Set();

/**
 * The last few refused requests, with the evidence that refused them. A 403
 * that leaves no trace is undebuggable from the outside — which is exactly how
 * the Desktop app ended up looking broken while every probe said it worked.
 */
const refusals = [];
const MAX_REFUSALS = 20;

function recordRefusal(path, request, report) {
  refusals.push({
    at: new Date().toISOString(),
    path,
    method: request.method,
    remote: request.socket?.remoteAddress ?? null,
    userAgent: String(request.headers?.["user-agent"] ?? "").slice(0, 80),
    ...report,
  });
  if (refusals.length > MAX_REFUSALS) refusals.splice(0, refusals.length - MAX_REFUSALS);
}

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
    refusals: refusals.slice().reverse(),
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
        ctx.logger?.debug?.(`[dsh-archived] sweep ${sessionId} failed:`, error);
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
      `[dsh-archived] delete ${sessionId} (${mode}): ${removed.directories} dir(s), ${removed.bytes} bytes`,
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


// --- stale-session sweep ------------------------------------------------------
//
// A second admission set beside the archive list: ordinary sessions that are
// stale by age or empty. Everything destructive still goes through the same
// recycle bin and the same post-delete residue sweeps.

const SWEEP_DEFAULTS = { version: 1, enabled: false, days: DEFAULT_STALE_DAYS, lastRunAt: null, lastRun: null };

async function readSweepSettings() {
  try {
    const parsed = JSON.parse(await readFile(sweepSettingsFile(), "utf8"));
    return {
      version: 1,
      enabled: parsed?.enabled === true,
      days: normalizeStaleDays(parsed?.days),
      lastRunAt: Number.isFinite(parsed?.lastRunAt) ? parsed.lastRunAt : null,
      lastRun: parsed?.lastRun && typeof parsed.lastRun === "object" ? parsed.lastRun : null,
    };
  } catch {
    return { ...SWEEP_DEFAULTS };
  }
}

async function writeSweepSettings(next) {
  await mkdir(dirname(sweepSettingsFile()), { recursive: true });
  await writeFile(sweepSettingsFile(), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

/** Read-only: what would a sweep find right now, and how is it configured? */
async function sweepScan(ctx, body) {
  const settings = await readSweepSettings();
  const days = normalizeStaleDays(body?.days ?? settings.days);
  const candidates = await scanStaleSessions(ctx, { days, archivedIds: archivedIds(ctx) });
  const eligible = candidates.filter((row) => row.eligible);
  return {
    ok: true,
    apiVersion: API_VERSION,
    days,
    graceHours: ACTIVE_GRACE_MS / (60 * 60 * 1000),
    settings,
    candidates,
    totals: {
      rows: candidates.length,
      eligible: eligible.length,
      bytes: eligible.reduce((sum, row) => sum + row.bytes, 0),
      empty: eligible.filter((row) => row.empty).length,
    },
  };
}

async function setSweepSettings(ctx, body) {
  const current = await readSweepSettings();
  const next = await writeSweepSettings({
    ...current,
    enabled: body?.enabled === undefined ? current.enabled : body.enabled === true,
    days: body?.days === undefined ? current.days : normalizeStaleDays(body.days),
  });
  ctx.logger?.info?.("[dsh-archived] sweep settings: enabled=" + next.enabled + " days=" + next.days);
  return { ok: true, settings: next };
}

/**
 * Park one non-archived session: recycle bin first, then the official detach.
 * The order matters — a moved file with a list entry left behind is exactly the
 * "the list keeps lying" failure this plugin exists to prevent, so the detach
 * plan is verified before anything moves.
 */
async function sweepDeleteOne(ctx, sessionId, mode, now = Date.now()) {
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return refuse("invalid-session-id", { sessionId });
  if (archivedIds(ctx).includes(sessionId)) return refuse("archived-session", { sessionId });
  if (isRunning(ctx, sessionId)) return refuse("session-running", { sessionId });
  const descendants = runningDescendants(ctx, sessionId);
  if (descendants.length > 0) return refuse("subagent-running", { sessionId, descendants });
  const plan = detachPlan(ctx, sessionId);
  if (!plan.ok) return refuse(plan.reason, { sessionId });
  const dirs = await locateArtifacts(sessionId);
  const cacheFile = projectionCacheFile(sessionId);
  if (dirs.length === 0 && !existsSync(cacheFile)) return refuse("no-artifact", { sessionId });
  let newest = 0;
  for (const dir of dirs) newest = Math.max(newest, await lastWriteMs(dir));
  if (newest !== 0 && now - newest < ACTIVE_GRACE_MS) return refuse("too-recent", { sessionId });

  return withLock(sessionId, async () => {
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
          source: "sweep",
        },
      });
      removed.parked = true;
    }
    const detached = await detachAll(plan.targets, sessionId);
    scheduleSweep(ctx, sessionId);
    ctx.logger?.info?.(
      "[dsh-archived] sweep delete " + sessionId + " (" + mode + "): " + removed.directories + " dir(s), " + removed.bytes + " bytes, " + detached + " workspace(s)",
    );
    return { ok: true, sessionId, mode, removed: { ...removed, detached }, archivedSessionIds: archivedIds(ctx) };
  });
}

async function sweepDeleteMany(ctx, ids, mode) {
  const results = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    try {
      results.push(await sweepDeleteOne(ctx, id, mode));
    } catch (error) {
      results.push(refuse("error", { sessionId: id, message: failureDetail(error) }));
    }
  }
  return { ok: results.length > 0 && results.every((result) => result.ok), results, archivedSessionIds: archivedIds(ctx) };
}

/**
 * The weekly run behind the panel's toggle. It only ever PARKS sessions: a
 * wrong guess costs a restore, never a session. Exported so the offline suite
 * can drive it with an injected clock.
 */
export async function runAutoSweep(ctx, now = Date.now()) {
  const settings = await readSweepSettings();
  if (!settings.enabled) return { ok: true, skipped: "disabled" };
  if (settings.lastRunAt !== null && now - settings.lastRunAt < AUTO_SWEEP_INTERVAL_MS) {
    return { ok: true, skipped: "not-due" };
  }
  const rows = await scanStaleSessions(ctx, { days: settings.days, archivedIds: archivedIds(ctx), now });
  const targets = rows.filter((row) => row.eligible).map((row) => row.id);
  const outcome = await sweepDeleteMany(ctx, targets, "quarantine");
  const results = outcome.results;
  const summary = {
    at: now,
    days: settings.days,
    candidates: targets.length,
    parked: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    bytes: results.reduce((sum, result) => sum + (result.removed?.bytes ?? 0), 0),
  };
  await writeSweepSettings({ ...settings, lastRunAt: now, lastRun: summary });
  ctx.logger?.info?.(
    "[dsh-archived] auto sweep: " + summary.parked + "/" + summary.candidates + " parked (" + summary.bytes + " bytes), " + summary.failed + " refused",
  );
  return { ok: true, ran: true, ...summary };
}

/** Put a parked session back where it came from and re-file it in the archive set. */
async function restoreOne(ctx, sessionId) {
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return refuse("invalid-session-id", { sessionId });
  const entry = await quarantineEntryFor(sessionId);
  if (entry === null) return refuse("not-quarantined", { sessionId });
  return withLock(sessionId, async () => {
    const restored = await restoreSession(ctx, sessionId, entry);
    ctx.logger?.info?.(`[dsh-archived] restore ${sessionId}`);
    return { ok: true, sessionId, restored, archivedSessionIds: archivedIds(ctx) };
  });
}

/**
 * Open one session's directory in the platform file manager.
 *
 * `DSH_ARCHIVED_OPENER=none` answers the path without launching
 * anything: a headless host has no file manager to launch, and a test run
 * should not pop windows on the operator's desktop.
 *
 * @returns the opener actually used.
 */
function revealPath(path) {
  if (process.env.DSH_ARCHIVED_OPENER === "none") return "none";
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
          const report = trustReport(request);
          if (!report.trusted) {
            recordRefusal(path, request, report);
            ctx.logger?.warn?.(`[dsh-archived] refused ${request.method} ${path}: ${JSON.stringify(report)}`);
            json(response, 403, { error: "forbidden", detail: report });
            return;
          }
          try {
            const body = method === "POST" ? await readJsonBody(request) : {};
            const result = await handle(body);
            json(response, result?.ok === false && result.error === "busy" ? 409 : 200, result);
          } catch (error) {
            ctx.logger?.warn?.(`[dsh-archived] ${path} failed:`, error);
            json(response, 500, { ok: false, error: "internal", detail: failureDetail(error) });
          }
        },
      }),
    `dsh-archived: ${path}`,
  );
}

export function apply(ctx) {
  const specs = [
    { suffix: SUFFIX.state, method: "GET", handle: () => stateOf(ctx) },
    {
      suffix: SUFFIX.delete,
      method: "POST",
      handle: (body) => deleteOne(ctx, body?.sessionId, body?.mode === "forever" ? "forever" : "quarantine"),
    },
    {
      suffix: SUFFIX.deleteAll,
      method: "POST",
      handle: (body) => {
        const mode = body?.mode === "forever" ? "forever" : "quarantine";
        const ids = Array.isArray(body?.ids) ? body.ids : archivedIds(ctx);
        return deleteMany(ctx, ids, mode);
      },
    },
    { suffix: SUFFIX.restore, method: "POST", handle: (body) => restoreOne(ctx, body?.sessionId) },
    {
      suffix: SUFFIX.empty,
      method: "POST",
      handle: async () => {
        const parked = await listQuarantine();
        for (const entry of parked) await purgeQuarantineEntry(entry.id);
        return { ok: true, purged: parked.length, bytes: sumBytes(parked) };
      },
    },
    { suffix: SUFFIX.reveal, method: "POST", handle: (body) => revealOne(ctx, body?.sessionId) },
    { suffix: SUFFIX.sweep, method: "POST", handle: (body) => sweepScan(ctx, body) },
    {
      suffix: SUFFIX.sweepDelete,
      method: "POST",
      handle: (body) => sweepDeleteMany(ctx, body?.ids, body?.mode === "forever" ? "forever" : "quarantine"),
    },
    { suffix: SUFFIX.sweepSettings, method: "POST", handle: (body) => setSweepSettings(ctx, body) },
    { suffix: SUFFIX.sweepRun, method: "POST", handle: () => runAutoSweep(ctx) },
  ];
  for (const spec of specs) {
    for (const base of [BASE, LEGACY_BASE]) {
      route(ctx, { path: base + spec.suffix, method: spec.method, handle: spec.handle });
    }
  }

  // A parked session is recoverable for a bounded window, then it expires on
  // its own so the quarantine can never become a second archive nobody drains.
  const expire = () =>
    expireQuarantine(QUARANTINE_MAX_AGE_MS).then((dropped) => {
      if (dropped.length > 0) ctx.logger?.info?.(`[dsh-archived] quarantine expired: ${dropped.length}`);
    });
  expire().catch(() => {});
  const daily = setInterval(() => expire().catch(() => {}), 24 * 60 * 60 * 1000);
  daily.unref?.();
  ctx.effect(() => () => clearInterval(daily), "dsh-archived: quarantine expiry");

  ctx.effect(
    () => () => {
      for (const timer of sweeps) clearTimeout(timer);
      sweeps.clear();
    },
    "dsh-archived: sweep timers",
  );

  if (!hostSupportsDelete(ctx)) {
    ctx.logger?.warn?.(
      "[dsh-archived] workspaceRegistry.unarchiveSession is missing — destructive routes will refuse",
    );
  }
  // The weekly sweep: the host ticks hourly and runs when the panel's toggle is
  // on and the interval has passed. Parking only — see runAutoSweep.
  const autoSweepTimer = setInterval(() => {
    runAutoSweep(ctx).catch((error) => ctx.logger?.warn?.("[dsh-archived] auto sweep failed:", error));
  }, AUTO_SWEEP_TICK_MS);
  autoSweepTimer.unref?.();
  ctx.effect(() => () => clearInterval(autoSweepTimer), "dsh-archived: auto sweep timer");

  ctx.logger?.info?.("[dsh-archived] host loaded");
}
