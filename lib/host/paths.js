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

/**
 * Ids the *store* and the *host API* accept. A session is `session-<uuid>`, but
 * a session whose header carries no prefix at all is a bare uuid (imported
 * transcripts and delegate imports both produce those).
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const IMPORT_PREFIXES = ["import-session-", "import-"];
const CANONICAL_PREFIX = "session-";
export const HOST_ID = new RegExp(`^(?:${CANONICAL_PREFIX})?${UUID}$`, "i");

/**
 * Ids an archived *row* may be filed under.
 *
 * DSH's own sessions are `session-<uuid>`, but the import feature namespaces the
 * id it files in the archive index: `import-session-<uuid>` for an imported
 * transcript and `import-<uuid>` for a delegate-imported session. Every one of
 * those is a real archived row the panel draws, so all of them must be accepted.
 * Refusing the import namespaces was a silent, total failure: the rows rendered
 * fine and every delete came back `invalid-session-id`.
 *
 * The path-safety argument is unchanged — a bare uuid is the only shape any form
 * may carry, so no form can introduce a separator, a `..`, or a NUL.
 */
export const SESSION_ID = new RegExp(`^(?:import-session-|import-|${CANONICAL_PREFIX})?${UUID}$`, "i");

/** The raw id a registry entry names, with its import namespace peeled off. */
export function canonicalSessionId(raw) {
  const text = String(raw);
  for (const prefix of IMPORT_PREFIXES) {
    if (text.startsWith(prefix)) return text.slice(prefix.length);
  }
  return text;
}

/**
 * Ordered ids the *filesystem* may know one archived row by.
 *
 * The archive index is namespaced; the session store is not. `import-<uuid>` and
 * `import-session-<uuid>` both name a session whose directory (and whose log
 * header `id`) is the bare uuid or `session-<uuid>`. `locateArtifacts` only ever
 * accepts a directory whose decoded name is one of these, so a namespace
 * collision cannot make the plugin delete a different session's log.
 */
export function artifactIdCandidates(raw) {
  const text = String(raw);
  const out = [text];
  const add = (value) => {
    if (value.length > 0 && !out.includes(value)) out.push(value);
  };
  // The import namespace wraps the store shape, so peeling it off is the first
  // and usually only step. The other store form is added as a fallback, because
  // each import form has been seen wrapping each store shape. Peeling `import-`
  // off `import-session-<uuid>` would leave `session-session-<uuid>`, a name
  // nothing on disk carries.
  for (const prefix of IMPORT_PREFIXES) {
    if (!text.startsWith(prefix)) continue;
    const rest = text.slice(prefix.length);
    add(rest);
    add(CANONICAL_PREFIX + rest);
  }
  return out;
}

/**
 * Inverse of DSH's `encodeSegment`: safe units stay literal and every other code
 * unit is `~XXXX`. Lets a directory name be compared against the candidate ids
 * instead of guessing at string prefixes.
 */
export function decodeSegment(name) {
  let out = "";
  for (let i = 0; i < name.length; i += 1) {
    const ch = name[i];
    if (ch !== "~") {
      out += ch;
      continue;
    }
    out += String.fromCharCode(parseInt(name.slice(i + 1, i + 5), 16));
    i += 4;
  }
  return out;
}

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

/** Plugin-owned state that is not per-session (the stale-sweep settings). */
export function pluginStateDir() {
  return join(dshHome(), "dsh-archived");
}

/** Where the stale-sweep settings document lives. */
export function sweepSettingsFile() {
  return join(pluginStateDir(), "sweep.json");
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

/**
 * Every on-disk artifact directory of one session (normally zero or one).
 *
 * The directory is named after the id inside the session log's header, which is
 * NOT always the id the archive index files the row under: an imported row is
 * indexed as `import-session-<uuid>` / `import-<uuid>` while its directory is
 * `session-<uuid>` or the bare uuid. Looking up the raw registry id therefore
 * found nothing, so a delete freed the projection cache and the index entry and
 * silently left the session log on disk — the exact "fake success" this plugin
 * exists to prevent. Match on the decoded directory name instead.
 */
export async function locateArtifacts(sessionId) {
  const candidates = artifactIdCandidates(sessionId);
  const wanted = new Set(candidates.map((id) => id.toLowerCase()));
  const found = [];
  let workspaces;
  try {
    workspaces = await readdir(sessionsRoot(), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;
    const bucket = join(sessionsRoot(), workspace.name);
    // The pre-encoded name is the common case; only fall back to decoding the
    // bucket's entries when it is absent (an id that needed `encodeSegment`).
    const direct = candidates.map((id) => join(bucket, id)).find((path) => existsSync(path));
    if (direct !== undefined) {
      found.push(direct);
      continue;
    }
    let entries;
    try {
      entries = await readdir(bucket, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!wanted.has(decodeSegment(entry.name).toLowerCase())) continue;
      found.push(join(bucket, entry.name));
      break;
    }
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
