// dsh-archived-sessions-manager host half.
//
// Adds permanent deletion for archived sessions to the DSH web server:
//
//   GET  /api/dsh-archived-sessions/state       archived ids + on-disk footprint
//   POST /api/dsh-archived-sessions/purge       { sessionId } -> delete forever
//   POST /api/dsh-archived-sessions/purge-all   every archived id -> delete forever
//
// One archived session owns three pieces of state, and a permanent delete must
// clear all three or the archive list keeps lying to the user:
//
//   1. the artifact directory   $DSH_HOME/sessions/<encoded-workspace>/session-<id>
//   2. the projection cache     $DSH_HOME/storages/session_projcache/sessions/<id>.json
//   3. the archive index entry  workspace registry `archivedSessionIds`
//
// (3) goes through the official registry write, so every connected client
// refreshes its archive set through the normal broadcast. The registry's
// unarchiveSession deliberately runs no existence check, which is exactly what
// lets a leftover index entry whose session is already gone be cleaned too.
//
// Path resolution is inlined instead of importing @deepseek-ai/dsh-home-paths:
// this plugin is developed out of tree and linked into the profile, so a bare
// package import would not resolve from its real path. The rule mirrored here
// is the documented one — $DSH_HOME when non-blank, otherwise ~/.dsh.

import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const name = "dsh-archived-sessions-manager";
export const inject = ["webServer", "workspaceRegistry", "agents"];

const HEADER = "x-dsh-archived-sessions";
const STATE_PATH = "/api/dsh-archived-sessions/state";
const PURGE_PATH = "/api/dsh-archived-sessions/purge";
const PURGE_ALL_PATH = "/api/dsh-archived-sessions/purge-all";

/** Session ids this plugin is willing to touch: the canonical `session-<uuid>`. */
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Post-purge sweep delays (ms): a lingering idle agent can rewrite its cache once more. */
const SWEEP_DELAYS = [3_000, 15_000, 60_000];

/** Live sweep timers, cleared when the plugin unloads. */
const sweeps = new Set();

function dshHome() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === "string" && configured.trim() !== "") return resolve(configured.trim());
  return join(homedir(), ".dsh");
}

/** Root holding one directory per encoded workspace, each with `session-*` children. */
function sessionsRoot() {
  return join(dshHome(), "sessions");
}

/** Projection-cache file keyed by the bare session id. */
function projectionCacheFile(sessionId) {
  return join(dshHome(), "storages", "session_projcache", "sessions", `${sessionId}.json`);
}

function header(request, key) {
  const value = request.headers?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function isLoopbackAddress(value) {
  const address = String(value || "").toLowerCase().replace(/^\[|\]$/g, "");
  return (
    address === "localhost" ||
    address === "localhost." ||
    address === "::1" ||
    address.startsWith("127.") ||
    address.startsWith("::ffff:127.")
  );
}

/**
 * Loopback, marker-header, same-origin request check. The route is destructive,
 * so it refuses anything that is not this browser talking to this server.
 *
 * `Origin` is authoritative when present, but browsers omit it on same-origin
 * GETs — so that case falls back to Fetch Metadata's `sec-fetch-site`, which a
 * cross-site caller cannot forge. A request with neither signal is refused.
 */
function isTrustedRequest(request) {
  if (header(request, HEADER) !== "1") return false;
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return false;
  const site = header(request, "sec-fetch-site");
  if (site !== undefined && site !== "same-origin") return false;
  const host = header(request, "host");
  if (!host) return false;
  const origin = header(request, "origin");
  if (origin === undefined) return site === "same-origin";
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      isLoopbackAddress(url.hostname) &&
      url.host === host
    );
  } catch {
    return false;
  }
}

function json(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

/** Short operator-facing cause for a 500 body; this route is loopback-only. */
function failureDetail(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 200);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Recursive byte size of one artifact directory; unreadable entries count as 0. */
async function directorySize(path) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = join(path, entry.name);
    try {
      if (entry.isDirectory()) total += await directorySize(child);
      else if (entry.isFile()) total += (await stat(child)).size;
    } catch {
      // A vanished or unreadable child contributes nothing to the estimate.
    }
  }
  return total;
}

/** Every on-disk artifact directory of one session (normally zero or one). */
async function locateArtifacts(sessionId) {
  const root = sessionsRoot();
  const found = [];
  let workspaces;
  try {
    workspaces = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;
    const candidate = join(root, workspace.name, sessionId);
    if (existsSync(candidate)) found.push(candidate);
  }
  return found;
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
 * Whether the session is running a turn right now. An open-but-idle agent is
 * deletable — same rule the trash-based session manager applies — while an
 * in-flight turn must not lose the log it is appending to.
 */
function isRunning(ctx, sessionId) {
  try {
    return ctx.agents?.get?.(sessionId)?.status === "running";
  } catch {
    return false;
  }
}

async function footprint(sessionId) {
  const dirs = await locateArtifacts(sessionId);
  let bytes = 0;
  for (const dir of dirs) bytes += await directorySize(dir);
  return { dirs, bytes, cache: existsSync(projectionCacheFile(sessionId)) };
}

/** Archived ids with the on-disk footprint the panel annotates each row with. */
async function stateOf(ctx) {
  const ids = archivedIds(ctx);
  const items = [];
  for (const id of ids) {
    const { dirs, bytes, cache } = await footprint(id);
    items.push({ id, artifact: dirs.length > 0, bytes, cache });
  }
  return { ok: true, version: "0.1.2", items };
}

/**
 * Delay a purge already deleted in full. A session archived while its agent was
 * still open keeps that idle agent in memory, and DSH's projection service can
 * rewrite the cache JSON (never the log) from that state seconds later, so each
 * purge schedules bounded best-effort sweeps that re-remove such residue.
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

/** Re-remove residue of a purged session, unless the user re-archived or resumed it. */
async function sweepResidue(ctx, sessionId) {
  if (archivedIds(ctx).includes(sessionId)) return;
  if (isRunning(ctx, sessionId)) return;
  for (const dir of await locateArtifacts(sessionId)) await rm(dir, { recursive: true, force: true });
  const cacheFile = projectionCacheFile(sessionId);
  if (existsSync(cacheFile)) await rm(cacheFile, { force: true });
}

/**
 * Permanently delete one archived session: artifacts, projection cache, then the
 * archive index entry. Refusals are explicit codes — the panel localizes them.
 */
async function purgeOne(ctx, sessionId) {
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) {
    return { ok: false, sessionId, error: "invalid-session-id" };
  }
  const registry = registryOf(ctx);
  if (registry === undefined || registry === null) return { ok: false, sessionId, error: "no-registry" };
  if (!archivedIds(ctx).includes(sessionId)) return { ok: false, sessionId, error: "not-archived" };
  if (isRunning(ctx, sessionId)) return { ok: false, sessionId, error: "session-running" };

  const { dirs, bytes } = await footprint(sessionId);
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });

  let cacheRemoved = false;
  const cacheFile = projectionCacheFile(sessionId);
  if (existsSync(cacheFile)) {
    await rm(cacheFile, { force: true });
    cacheRemoved = true;
  }

  await registry.unarchiveSession(sessionId);
  scheduleSweep(ctx, sessionId);
  return {
    ok: true,
    sessionId,
    removed: { directories: dirs.length, bytes, cache: cacheRemoved },
  };
}

async function purgeMany(ctx, ids) {
  const results = [];
  for (const id of ids) {
    try {
      results.push(await purgeOne(ctx, id));
    } catch (error) {
      results.push({ ok: false, sessionId: id, error: "error", message: String(error?.message ?? error) });
    }
  }
  return {
    ok: results.every((result) => result.ok),
    results,
    archivedSessionIds: archivedIds(ctx),
  };
}

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: STATE_PATH,
        handler: async (request, response) => {
          if (request.method !== "GET") {
            json(response, 405, { error: "method not allowed" });
            return;
          }
          if (!isTrustedRequest(request)) {
            json(response, 403, { error: "forbidden" });
            return;
          }
          try {
            json(response, 200, await stateOf(ctx));
          } catch (error) {
            ctx.logger?.warn?.("[dsh-archived-sessions-manager] state failed:", error);
            json(response, 500, { ok: false, error: "state-failed", detail: failureDetail(error) });
          }
        },
      }),
    "dsh-archived-sessions-manager: state endpoint",
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: PURGE_PATH,
        handler: async (request, response) => {
          if (request.method !== "POST") {
            json(response, 405, { error: "method not allowed" });
            return;
          }
          if (!isTrustedRequest(request)) {
            json(response, 403, { error: "forbidden" });
            return;
          }
          try {
            const body = await readJsonBody(request);
            const result = await purgeOne(ctx, body?.sessionId);
            ctx.logger?.info?.(
              `[dsh-archived-sessions-manager] purge ${body?.sessionId}: ${result.ok ? "ok" : result.error}`,
            );
            json(response, result.ok ? 200 : 409, { ...result, archivedSessionIds: archivedIds(ctx) });
          } catch (error) {
            ctx.logger?.warn?.("[dsh-archived-sessions-manager] purge failed:", error);
            json(response, 500, { ok: false, error: "purge-failed", detail: failureDetail(error) });
          }
        },
      }),
    "dsh-archived-sessions-manager: purge endpoint",
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: PURGE_ALL_PATH,
        handler: async (request, response) => {
          if (request.method !== "POST") {
            json(response, 405, { error: "method not allowed" });
            return;
          }
          if (!isTrustedRequest(request)) {
            json(response, 403, { error: "forbidden" });
            return;
          }
          try {
            const outcome = await purgeMany(ctx, archivedIds(ctx));
            const deleted = outcome.results.filter((result) => result.ok).length;
            ctx.logger?.info?.(
              `[dsh-archived-sessions-manager] purge-all: ${deleted}/${outcome.results.length} deleted`,
            );
            json(response, 200, outcome);
          } catch (error) {
            ctx.logger?.warn?.("[dsh-archived-sessions-manager] purge-all failed:", error);
            json(response, 500, { ok: false, error: "purge-all-failed", detail: failureDetail(error) });
          }
        },
      }),
    "dsh-archived-sessions-manager: purge-all endpoint",
  );

  ctx.effect(
    () => () => {
      for (const timer of sweeps) clearTimeout(timer);
      sweeps.clear();
    },
    "dsh-archived-sessions-manager: sweep timers",
  );

  ctx.logger?.info?.("[dsh-archived-sessions-manager] host loaded");
}
