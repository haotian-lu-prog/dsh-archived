// Path derivation for everything one archived session owns on disk.
//
// DSH 0.2.0-rc.2 keeps three pieces of per-session state, and a permanent
// delete has to answer for all three:
//
//   1. the artifact directory   $DSH_HOME/sessions/<encoded-workspace>/session-<id>/
//                               (session.v4.jsonl.zstd + session.lock)
//   2. the projection cache doc $DSH_HOME/storages/session_projcache/sessions/<id>.json
//   3. the archive index entry  workspace registry archivedSessionIds
//
// Path resolution is inlined instead of importing @deepseek-ai/dsh-home-paths:
// this plugin is developed out of tree and linked into the profile, so a bare
// package import would not resolve from its real path. The rule mirrored here
// is the documented one — $DSH_HOME when non-blank, otherwise ~/.dsh.

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Session ids this plugin is willing to touch: the canonical `session-<uuid>`. */
export const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function dshHome() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === "string" && configured.trim() !== "") return resolve(configured.trim());
  return join(homedir(), ".dsh");
}

/** Root holding one directory per encoded workspace, each with `session-*` children. */
export function sessionsRoot() {
  return join(dshHome(), "sessions");
}

/** Root holding one projection-cache document per session (the `per-record` json layout). */
export function projectionCacheDir() {
  return join(dshHome(), "storages", "session_projcache", "sessions");
}

export function projectionCacheFile(sessionId) {
  return join(projectionCacheDir(), sessionId + ".json");
}

/**
 * The pre-per-record aggregate of the same domain. It stopped being written
 * when the domain moved to one document per session (`unit.version: 3`), so it
 * is host-owned history we only report on, never rewrite.
 */
export function legacyAggregateFile() {
  return join(dshHome(), "storages", "session_projcache.json");
}

/** The durable workspace registry store; the archive index lives in its `global` block. */
export function workspaceStoreFile() {
  return join(dshHome(), "storages", "workspace.json");
}

/** Deleted-but-recoverable sessions live here, beside the state they came from. */
export function quarantineRoot() {
  return join(dshHome(), ".archived-sessions-quarantine");
}

export function quarantineEntry(sessionId) {
  return join(quarantineRoot(), sessionId);
}

/** Where a quarantined session's original artifact directory is parked. */
export function quarantineArtifactDir(sessionId) {
  return join(quarantineEntry(sessionId), "session");
}

/** Where a quarantined session's projection-cache document is parked. */
export function quarantineCacheFile(sessionId) {
  return join(quarantineEntry(sessionId), "cache.json");
}

export function quarantineMetaFile(sessionId) {
  return join(quarantineEntry(sessionId), "meta.json");
}

/** Every on-disk artifact directory of one session (normally zero or one). */
export async function locateArtifacts(sessionId) {
  const found = [];
  let workspaces;
  try {
    workspaces = await readdir(sessionsRoot(), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;
    const candidate = join(sessionsRoot(), workspace.name, sessionId);
    if (existsSync(candidate)) found.push(candidate);
  }
  return found;
}

/** Recursive byte size of one artifact directory; unreadable entries count as 0. */
export async function directorySize(path) {
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
