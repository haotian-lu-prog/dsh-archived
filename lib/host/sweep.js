// Stale-session sweep — sessions nobody archived, found by age or by silence.
//
// The Archived page serves one admission set (the workspace registry's
// archivedSessionIds) and one removal verb (unarchiveSession). A sweep has
// neither: its candidates are ordinary sessions, and the official way to take
// one out of a workspace list is Workspace.detachSession. Everything else it
// needs — artifact discovery, the projection cache, the recycle bin — is the
// same code the archived path already uses, so a swept session lands in the
// same bin, restores the same way, and expires on the same 30-day clock.

import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import zlib from "node:zlib";
import { SESSION_ID, sessionsRoot, projectionCacheFile, directorySize } from "./paths.js";
import { readCacheDocument, isRunning, runningDescendants } from "./metadata.js";

/** Days of silence that make a session stale. The panel offers 7 / 14 / 30. */
export const DEFAULT_STALE_DAYS = 14;
export const MIN_STALE_DAYS = 1;
export const MAX_STALE_DAYS = 365;

/**
 * Hard floor, independent of the day count: a session written within this
 * window is never a sweep candidate. Someone is looking at it right now.
 */
export const ACTIVE_GRACE_MS = 24 * 60 * 60 * 1000;

export function normalizeStaleDays(value) {
  const days = Number(value);
  if (!Number.isFinite(days)) return DEFAULT_STALE_DAYS;
  return Math.min(MAX_STALE_DAYS, Math.max(MIN_STALE_DAYS, Math.round(days)));
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const LOG_NAME = /^session(\.v\d+)?\.jsonl(\.zstd)?$/;
const MAX_LOG_READ = 4 * 1024 * 1024;
const SESSION_RECORD = '"type":"session"';
const USER_RECORD = '"type":"user/message"';

/** The session log inside one artifact directory, newest generation last, or null. */
export async function logPathOf(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const logs = entries
    .filter((entry) => entry.isFile() && LOG_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return logs.length === 0 ? null : join(dir, logs[logs.length - 1]);
}

/**
 * When did this session last get written?
 *
 * The log decides it. `session.lock` is an empty file the host recreates
 * whenever a session is opened, so counting it as activity would make every
 * session someone merely looked at look fresh forever. Falls back to the
 * newest entry only when there is no log to ask.
 */
export async function lastWriteMs(dir) {
  const log = await logPathOf(dir);
  if (log !== null) {
    try {
      return (await stat(log)).mtimeMs;
    } catch {
      // Fall through to the directory listing.
    }
  }
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let newest = 0;
  for (const entry of entries) {
    try {
      const info = await stat(join(dir, entry.name));
      if (info.mtimeMs > newest) newest = info.mtimeMs;
    } catch {
      // A vanished child cannot be the newest write.
    }
  }
  return newest;
}

/**
 * Decode a v4 log's leading bytes. DSH writes one zstd frame per flush, so the
 * buffer is split on the frame magic and every frame decoded on its own; a
 * false split is merged back into the next chunk and retried.
 */
function decodeLog(buffer) {
  if (!buffer.subarray(0, 4).equals(ZSTD_MAGIC)) return buffer.toString("utf8");
  const offsets = [];
  let at = buffer.indexOf(ZSTD_MAGIC, 0);
  while (at !== -1) {
    offsets.push(at);
    at = buffer.indexOf(ZSTD_MAGIC, at + 4);
  }
  const parts = [];
  let pending = null;
  for (let index = 0; index < offsets.length; index += 1) {
    const frame = buffer.subarray(offsets[index], index + 1 < offsets.length ? offsets[index + 1] : buffer.length);
    const candidate = pending === null ? frame : Buffer.concat([pending, frame]);
    try {
      parts.push(zlib.zstdDecompressSync(candidate));
      pending = null;
    } catch {
      pending = candidate;
    }
  }
  if (pending !== null) {
    try {
      parts.push(zlib.zstdDecompressSync(pending));
    } catch {
      // A truncated tail frame contributes nothing; the head already decided.
    }
  }
  return Buffer.concat(parts).toString("utf8");
}

/**
 * Did anyone ever send a message here? A log that stops at the session header
 * (a seed or an aborted start) is junk no matter how old it is.
 *
 * Answering "not empty" whenever the log cannot be recognised is deliberate:
 * a lead that cannot be read is not evidence that nobody ever spoke, and this
 * answer feeds a delete.
 */
export async function isEmptySession(dir) {
  const logPath = await logPathOf(dir);
  if (logPath === null) return false;
  let buffer;
  try {
    buffer = await readFile(logPath);
  } catch {
    return false;
  }
  if (buffer.length > MAX_LOG_READ) buffer = buffer.subarray(0, MAX_LOG_READ);
  let text;
  try {
    text = decodeLog(buffer);
  } catch {
    return false;
  }
  if (!text.includes(SESSION_RECORD)) return false;
  return !text.includes(USER_RECORD);
}

/**
 * Read-only sweep scan. Returns candidate rows — stale by age, empty, or both —
 * minus anything archived (that page owns it), running, or written inside the
 * grace window. Never writes.
 */
export async function scanStaleSessions(ctx, { days = DEFAULT_STALE_DAYS, archivedIds = [], now = Date.now() } = {}) {
  const cutoff = now - normalizeStaleDays(days) * 24 * 60 * 60 * 1000;
  const archived = new Set(Array.isArray(archivedIds) ? archivedIds : []);
  const rows = [];
  let workspaces;
  try {
    workspaces = await readdir(sessionsRoot(), { withFileTypes: true });
  } catch {
    return rows;
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;
    let entries;
    try {
      entries = await readdir(join(sessionsRoot(), workspace.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID.test(entry.name)) continue;
      const id = entry.name;
      const dir = join(sessionsRoot(), workspace.name, id);
      const mtime = await lastWriteMs(dir);
      if (mtime === 0 || now - mtime < ACTIVE_GRACE_MS) continue;
      const empty = await isEmptySession(dir);
      const stale = mtime <= cutoff;
      if (!stale && !empty) continue;
      const cacheFile = projectionCacheFile(id);
      const cache = existsSync(cacheFile);
      let document = null;
      if (cache) {
        try {
          document = await readCacheDocument(id);
        } catch {
          document = null;
        }
      }
      // Archived sessions belong to the Archived page. Listing them here too
      // would offer the same row through two doors with two different verbs.
      if (archived.has(id)) continue;
      const running = isRunning(ctx, id);
      const descendants = runningDescendants(ctx, id).length;
      rows.push({
        id,
        workspace: workspace.name,
        dir,
        bytes: await directorySize(dir),
        mtime,
        ageDays: Math.floor((now - mtime) / (24 * 60 * 60 * 1000)),
        title: document?.title ?? null,
        cwd: document?.cwd ?? null,
        createdAt: document?.createdAt ?? null,
        cache,
        empty,
        stale,
        reason: stale && empty ? "stale+empty" : empty ? "empty" : "stale",
        running,
        descendants,
        eligible: !running && descendants === 0,
      });
    }
  }
  rows.sort((left, right) => right.bytes - left.bytes);
  return rows;
}

/**
 * Which workspaces still name this id, and can they drop it?
 *
 * The official verb is Workspace.detachSession. A host that lost it must not
 * produce a "deleted the files but the list still shows it" success, so the
 * caller asks first and refuses when the answer is no.
 */
export function detachPlan(ctx, sessionId) {
  const registry = typeof ctx.get === "function" ? ctx.get("workspaceRegistry") : ctx.workspaceRegistry;
  if (!registry || typeof registry.list !== "function") return { ok: false, reason: "no-registry", targets: [] };
  const targets = [];
  for (const workspace of registry.list()) {
    const ids = workspace?.sessionIds;
    if (!Array.isArray(ids) || !ids.includes(sessionId)) continue;
    if (typeof workspace.detachSession !== "function") return { ok: false, reason: "no-detach", targets: [] };
    targets.push(workspace);
  }
  return { ok: true, reason: null, targets };
}

/** Drop one id from every workspace that still names it; returns how many did. */
export async function detachAll(targets, sessionId) {
  let removed = 0;
  for (const workspace of targets) {
    await workspace.detachSession(sessionId);
    removed += 1;
  }
  return removed;
}
