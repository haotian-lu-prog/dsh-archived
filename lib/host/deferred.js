// Archive-index entries a delete had to keep.
//
// An archived session is hidden from every list surface by exactly one thing:
// its entry in the workspace registry's `archivedSessionIds`. Deleting the
// session therefore means dropping that entry — and dropping it is what makes
// the session visible again.
//
// The host usually still holds the Session in memory: archiving never disposes
// the session's idle agent, and `session.list` — the only source the browser
// draws rows from — is the persisted headers plus the live sessions. A deleted
// session that is still live keeps producing a summary, so dropping the entry
// puts it back into its workspace until the host restarts: the ghost 0.4.0
// shipped (the row comes back, its files are gone, and only a restart clears it).
//
// So the entry is kept, recorded here instead, and dropped the moment the host
// has let the session go — a restart always does. The panel does not draw
// deferred rows: to the user the session is gone as soon as the delete answers.
//
// The book lives in `$DSH_HOME/dsh-archived/deferred.json` so a plugin reload
// inside the same host run cannot lose it, and is cached in memory for the
// host's lifetime.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { deferredFile } from "./paths.js";

/** In-memory mirror of the book; loaded from disk on first use. */
let book = null;

function validEntry(entry) {
  const source = entry !== null && typeof entry === "object" ? entry : {};
  return {
    at: Number.isFinite(source.at) ? source.at : null,
    mode: typeof source.mode === "string" ? source.mode : null,
    reason: typeof source.reason === "string" ? source.reason : null,
  };
}

async function load() {
  try {
    const parsed = JSON.parse(await readFile(deferredFile(), "utf8"));
    const items = parsed?.items;
    if (items === null || typeof items !== "object") return new Map();
    return new Map(Object.entries(items).map(([id, entry]) => [id, validEntry(entry)]));
  } catch {
    // A missing or unreadable book means "nothing was deferred": the entry then
    // simply stays in the archive set like any other residue, which the panel
    // already reports as an index-only row a user can clean.
    return new Map();
  }
}

async function save() {
  await mkdir(dirname(deferredFile()), { recursive: true });
  const items = {};
  for (const id of [...book.keys()].sort()) items[id] = book.get(id);
  await writeFile(deferredFile(), JSON.stringify({ version: 1, items }, null, 2) + "\n", "utf8");
}

/** The deferred entries, loaded from disk the first time they are asked for. */
export async function deferredEntries() {
  if (book === null) book = await load();
  return book;
}

/** Keep this id's archive-index entry until the host lets the session go. */
export async function deferIndexDrop(sessionId, entry = {}) {
  const entries = await deferredEntries();
  entries.set(sessionId, validEntry({ at: Date.now(), ...entry }));
  await save();
  return entries.get(sessionId);
}

/**
 * Stop deferring these ids: their entry was dropped, or the session came back.
 *
 * @returns how many of them were actually deferred.
 */
export async function forgetDeferred(ids) {
  const entries = await deferredEntries();
  let forgotten = 0;
  for (const id of ids) if (entries.delete(id)) forgotten += 1;
  if (forgotten > 0) await save();
  return forgotten;
}

/** The deferred rows as the panel reads them: the id plus why it is still there. */
export async function deferredRows() {
  const entries = await deferredEntries();
  return [...entries.entries()].map(([id, entry]) => ({ id, ...entry }));
}
