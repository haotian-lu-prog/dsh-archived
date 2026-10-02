// Deleted-but-recoverable sessions.
//
// "Delete forever" is the only irreversible thing this plugin does, and the one
// mistake a user cannot undo. So a delete is a move, not an unlink: the
// artifact directory and the projection-cache document are parked under
// `$DSH_HOME/.archived-sessions-quarantine/<id>/` together with a `meta.json`
// describing where they came from. `forever` skips the park and unlinks.
//
// The quarantine lives under `$DSH_HOME`, beside `sessions/`, so the move is a
// same-volume `rename`; the copy fallback only exists for a `DSH_HOME` that
// spans volumes.

import { constants } from "node:fs";
import { access, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  directorySize,
  projectionCacheFile,
  quarantineArtifactDir,
  quarantineCacheFile,
  quarantineEntry,
  quarantineMetaFile,
  quarantineRoot,
  sessionsRoot,
} from "./paths.js";

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Move one path, falling back to copy+unlink when the two ends are on different volumes. */
async function movePath(from, to) {
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
    return "rename";
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    await cp(from, to, { recursive: true, force: true, preserveTimestamps: true });
    await rm(from, { recursive: true, force: true });
    return "copy";
  }
}

/** Park one session's artifacts + cache document; returns what was moved. */
export async function quarantineSession(sessionId, { dirs, cacheFile, meta }) {
  const root = quarantineEntry(sessionId);
  let bytes = 0;
  for (const dir of dirs) bytes += await directorySize(dir);
  // The projection document is state too: a delete that frees it should say so.
  if (cacheFile !== undefined && (await exists(cacheFile))) {
    try {
      bytes += (await stat(cacheFile)).size;
    } catch {
      // A vanished document contributes nothing to the estimate.
    }
  }
  await mkdir(root, { recursive: true });

  const moved = { directories: 0, bytes, cache: false };
  for (const dir of dirs) {
    await movePath(dir, quarantineArtifactDir(sessionId));
    moved.directories += 1;
  }
  if (cacheFile !== undefined && (await exists(cacheFile))) {
    await movePath(cacheFile, quarantineCacheFile(sessionId));
    moved.cache = true;
  }
  await writeFile(
    quarantineMetaFile(sessionId),
    JSON.stringify({ ...meta, sessionId, bytes, directories: moved.directories, cache: moved.cache }, null, 2),
    "utf8",
  );
  return moved;
}

/**
 * The quarantine as the panel sees it. Entries whose payload vanished (a user
 * cleaned the directory by hand) are dropped rather than reported as broken.
 */
export async function listQuarantine() {
  const entries = [];
  let children;
  try {
    children = await readdir(quarantineRoot(), { withFileTypes: true });
  } catch {
    return entries;
  }
  for (const child of children) {
    if (!child.isDirectory()) continue;
    const sessionId = child.name;
    let meta = null;
    try {
      meta = JSON.parse(await readFile(quarantineMetaFile(sessionId), "utf8"));
    } catch {
      meta = null;
    }
    const hasArtifact = await exists(quarantineArtifactDir(sessionId));
    const hasCache = await exists(quarantineCacheFile(sessionId));
    if (!hasArtifact && !hasCache) continue;
    entries.push({
      id: sessionId,
      deletedAt: typeof meta?.deletedAt === "number" ? meta.deletedAt : null,
      title: typeof meta?.title === "string" ? meta.title : null,
      cwd: typeof meta?.cwd === "string" ? meta.cwd : null,
      workspaceDir: typeof meta?.workspaceDir === "string" ? meta.workspaceDir : null,
      bytes: typeof meta?.bytes === "number" ? meta.bytes : await directorySize(quarantineArtifactDir(sessionId)),
    });
  }
  entries.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  return entries;
}

export async function quarantineEntryFor(sessionId) {
  const entries = await listQuarantine();
  return entries.find((entry) => entry.id === sessionId) ?? null;
}

/**
 * Put a quarantined session back where it came from.
 *
 * @returns the restored location and whether it could be re-archived. A failed
 * re-archive is not a failed restore: the session is back on disk and visible
 * in the ordinary session list, which is strictly better than losing it.
 */
export async function restoreSession(ctx, sessionId, entry) {
  const root = quarantineEntry(sessionId);
  const artifact = quarantineArtifactDir(sessionId);
  const cache = quarantineCacheFile(sessionId);
  const restored = { directories: 0, cache: false, rearchived: false };

  const target = entry.workspaceDir !== null ? join(entry.workspaceDir, sessionId) : null;
  if (await exists(artifact)) {
    if (target === null) throw new Error("quarantine metadata has no workspaceDir");
    await mkdir(dirname(target), { recursive: true });
    await movePath(artifact, target);
    restored.directories = 1;
  }
  if (await exists(cache)) {
    await movePath(cache, projectionCacheFile(sessionId));
    restored.cache = true;
  }
  await rm(root, { recursive: true, force: true });

  try {
    await ctx.workspaceRegistry?.archiveSession?.(sessionId, {});
    restored.rearchived = true;
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-archived-sessions-manager] restore ${sessionId}: re-archive failed:`, error);
  }
  return restored;
}

/** Unlink one quarantined session for good. */
export async function purgeQuarantineEntry(sessionId) {
  const bytes = await directorySize(quarantineEntry(sessionId));
  await rm(quarantineEntry(sessionId), { recursive: true, force: true });
  return bytes;
}

/** Drop quarantine entries older than `maxAgeMs`; returns the ids dropped. */
export async function expireQuarantine(maxAgeMs, now = Date.now()) {
  const dropped = [];
  for (const entry of await listQuarantine()) {
    if (entry.deletedAt === null) continue;
    if (now - entry.deletedAt < maxAgeMs) continue;
    await purgeQuarantineEntry(entry.id);
    dropped.push(entry.id);
  }
  return dropped;
}

/** Workspace bucket directory names currently on disk, for orphan reporting. */
export async function sessionBuckets() {
  try {
    return (await readdir(sessionsRoot(), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
