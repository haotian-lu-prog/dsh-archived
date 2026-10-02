// Read-only metadata about archived sessions.
//
// The Settings page must be able to describe a row even when the browser's
// session store has no summary for it — that is exactly the "index-only
// residue" case (the archive set names an id whose log is already gone, or
// whose log is present but not loaded in this client). The projection cache
// document carries what a row needs: `record.rows.title.val` and
// `record.identity.{createdAt, cwd, formatVersion}`.

import { readFile, stat } from "node:fs/promises";
import { legacyAggregateFile, projectionCacheFile } from "./paths.js";

/** Parse one projection-cache document; null when it is missing or unreadable. */
export async function readCacheDocument(sessionId) {
  try {
    const text = await readFile(projectionCacheFile(sessionId), "utf8");
    const parsed = JSON.parse(text);
    const record = parsed?.record;
    if (record === null || typeof record !== "object") return null;
    const title = record.rows?.title?.val;
    const identity = record.identity ?? {};
    return {
      title: typeof title === "string" && title.length > 0 ? title : null,
      createdAt: typeof identity.createdAt === "number" ? identity.createdAt : null,
      cwd: typeof identity.cwd === "string" ? identity.cwd : null,
      formatVersion: typeof identity.formatVersion === "number" ? identity.formatVersion : null,
    };
  } catch {
    return null;
  }
}

/**
 * Session ids still present in the pre-per-record aggregate. The domain moved
 * to one document per session and this file stopped being written (its mtime on
 * a live machine trails the per-record directory by weeks), so it is reported
 * and never rewritten: it is host-owned state we only read.
 *
 * @returns the id set, or null when the file is absent or unreadable.
 */
let legacyCache = { mtimeMs: -1, rows: null };
export async function legacyAggregateRows() {
  const file = legacyAggregateFile();
  try {
    const info = await stat(file);
    if (info.mtimeMs === legacyCache.mtimeMs) return legacyCache.rows;
    const parsed = JSON.parse(await readFile(file, "utf8"));
    const rows = parsed?.tables?.sessions;
    const ids = rows !== null && typeof rows === "object" ? new Set(Object.keys(rows)) : new Set();
    legacyCache = { mtimeMs: info.mtimeMs, rows: ids };
    return ids;
  } catch {
    legacyCache = { mtimeMs: -1, rows: null };
    return null;
  }
}

/** Whether the session is running a turn right now. */
export function isRunning(ctx, sessionId) {
  try {
    return ctx.agents?.get?.(sessionId)?.status === "running";
  } catch {
    return false;
  }
}

/** The subagent lineage of one live agent: itself first, then its ancestors. */
function lineageOfAgent(ctx, agent) {
  const chain = [];
  const seen = new Set();
  let header = agent?.session?.header;
  while (header !== undefined && header !== null && !seen.has(header.id)) {
    chain.push(header.id);
    seen.add(header.id);
    if (header.origin !== "subagent" || header.parentSession === undefined) break;
    const parent = ctx.sessions?.get?.(header.parentSession);
    if (parent === undefined || parent === null) {
      chain.push(header.parentSession);
      break;
    }
    header = parent.header;
  }
  return chain;
}

/**
 * Running subagent descendants of one session. A parent may be deleted while
 * its children keep working — their parent session would vanish underneath
 * them — so a delete is refused while any of them is mid-turn.
 *
 * @returns ids of running descendants.
 */
export function runningDescendants(ctx, sessionId) {
  const found = [];
  let agents;
  try {
    agents = ctx.agents?.list?.() ?? [];
  } catch {
    return found;
  }
  for (const agent of agents) {
    if (agent?.status !== "running") continue;
    if (agent.id === sessionId) continue;
    if (lineageOfAgent(ctx, agent).includes(sessionId)) found.push(agent.id);
  }
  return found;
}

/** Ancestor session ids of one session, from the durable header chain. */
export function ancestorsOf(ctx, sessionId) {
  const header = ctx.sessions?.get?.(sessionId)?.header;
  if (header === undefined || header === null) return [];
  if (header.origin !== "subagent" || header.parentSession === undefined) return [];
  const chain = [];
  const seen = new Set([sessionId]);
  let cursor = header.parentSession;
  while (cursor !== undefined && cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    const parent = ctx.sessions?.get?.(cursor);
    if (parent === undefined || parent === null) break;
    const parentHeader = parent.header;
    if (parentHeader?.origin !== "subagent" || parentHeader.parentSession === undefined) break;
    cursor = parentHeader.parentSession;
  }
  return chain;
}

/** Live subagent children of one session, whether or not they are running. */
export function liveChildrenOf(ctx, sessionId) {
  const children = [];
  let agents;
  try {
    agents = ctx.agents?.list?.() ?? [];
  } catch {
    return children;
  }
  for (const agent of agents) {
    if (agent?.id === sessionId) continue;
    const header = agent?.session?.header;
    if (header?.origin === "subagent" && header.parentSession === sessionId) children.push(agent.id);
  }
  return children;
}
