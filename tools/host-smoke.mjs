#!/usr/bin/env node
/**
 * Host-half smoke test — no DSH, no browser, no network.
 *
 * Points $DSH_HOME at a temp directory, builds the three pieces of state one
 * archived session owns, then drives the plugin's own route handlers with fake
 * request/response pairs and asserts what survived. This is the suite that can
 * run in CI; tools/e2e.py is the one that proves it against a live host.
 *
 *     node tools/host-smoke.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const home = mkdtempSync(join(tmpdir(), "dasm-home-"));
process.env.DSH_HOME = home;
process.env.DSH_ARCHIVED_OPENER = "none";

const failures = [];
function check(label, condition, detail = "") {
  const mark = condition ? "PASS" : "FAIL";
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

const HEADER = "x-dsh-archived";
const ids = {
  withArtifact: "session-11111111-1111-4111-8111-111111111111",
  indexOnly: "session-22222222-2222-4222-8222-222222222222",
  running: "session-33333333-3333-4333-8333-333333333333",
  withChild: "session-44444444-4444-4444-8444-444444444444",
  child: "session-55555555-5555-4555-8555-555555555555",
  gone: "session-66666666-6666-4666-8666-666666666666",
  cacheOnly: "session-88888888-8888-4888-8888-888888888888",
};
const bucket = "--Users-test-project--";

function seedArtifact(sessionId, bytes = 2048) {
  const path = join(home, "sessions", bucket, sessionId);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "session.v4.jsonl.zstd"), Buffer.alloc(bytes, 7));
  writeFileSync(join(path, "session.lock"), "");
  return path;
}

function seedCache(sessionId, title) {
  const path = join(home, "storages", "session_projcache", "sessions");
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, sessionId + ".json"),
    JSON.stringify({
      version: 3,
      record: { identity: { formatVersion: 4, createdAt: 1_700_000_000_000, cwd: "/Users/test/project" }, rows: { title: { ver: 1, seq: 1, val: title } } },
    }),
  );
}

function seedWorkspaceStore(archived) {
  const path = join(home, "storages");
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "workspace.json"), JSON.stringify({ unit: { name: "workspace" }, global: { archivedSessionIds: archived }, tables: {} }));
  writeFileSync(
    join(path, "session_projcache.json"),
    JSON.stringify({ unit: { name: "session_projcache", version: 3 }, global: null, tables: { sessions: { [ids.withArtifact]: { identity: {} } } } }),
  );
}

seedArtifact(ids.withArtifact);
seedCache(ids.withArtifact, "重构归档页");
// index-only: the archive set names it, nothing else does.
// cache-only: its log is gone but the projection document survived.
seedCache(ids.cacheOnly, "只剩缓存的会话");
seedArtifact(ids.running, 1024);
seedCache(ids.running, "正在跑的会话");
seedArtifact(ids.withChild, 512);
seedCache(ids.withChild, "有子会话的父会话");
seedCache(ids.child, "子会话");
seedWorkspaceStore([ids.withArtifact, ids.indexOnly, ids.running, ids.withChild, ids.child, ids.cacheOnly]);

// An already-parked session that is older than the retention window: the
// startup sweep must drop it without anyone asking.
const stale = "session-77777777-7777-4777-8777-777777777777";
mkdirSync(join(home, ".archived-sessions-quarantine", stale, "session"), { recursive: true });
writeFileSync(join(home, ".archived-sessions-quarantine", stale, "session", "old.zstd"), "x");
writeFileSync(
  join(home, ".archived-sessions-quarantine", stale, "meta.json"),
  JSON.stringify({ sessionId: stale, deletedAt: Date.now() - 40 * 24 * 60 * 60 * 1000, bytes: 1 }),
);

// --- fake host context -------------------------------------------------------
const routes = new Map();
const archived = new Set([ids.withArtifact, ids.indexOnly, ids.running, ids.withChild, ids.child, ids.cacheOnly]);
const unarchiveCalls = [];
const archiveCalls = [];
const registry = {
  get archivedSessionIds() {
    return [...archived];
  },
  async unarchiveSession(sessionId) {
    unarchiveCalls.push(sessionId);
    archived.delete(sessionId);
  },
  async archiveSession(sessionId) {
    archiveCalls.push(sessionId);
    archived.add(sessionId);
  },
};
const headersOf = {
  [ids.withChild]: { id: ids.withChild, origin: "root" },
  [ids.child]: { id: ids.child, origin: "subagent", parentSession: ids.withChild },
};
const ctx = {
  logger: { info() {}, warn() {}, debug() {} },
  effect(fn) {
    fn();
  },
  get: (name) => (name === "workspaceRegistry" ? registry : undefined),
  webServer: {
    register(route) {
      routes.set(route.path, route);
    },
  },
  workspaceRegistry: registry,
  sessions: { get: (sessionId) => (headersOf[sessionId] ? { header: headersOf[sessionId] } : undefined) },
  agents: {
    get: (sessionId) => (sessionId === ids.running ? { id: sessionId, status: "running" } : undefined),
    list: () => [
      { id: ids.running, status: "running", session: { header: headersOf[ids.running] ?? { id: ids.running, origin: "root" } } },
      { id: ids.child, status: "running", session: { header: headersOf[ids.child] } },
      { id: ids.withArtifact, status: "idle", session: { header: { id: ids.withArtifact, origin: "root" } } },
    ],
  },
};

// --- sweep candidates: stale by age, empty by content, plus two refusals --------
const sweepIds = {
  stale: "session-a1111111-1111-4111-8111-111111111111",
  emptyish: "session-a2222222-2222-4222-8222-222222222222",
  fresh: "session-a3333333-3333-4333-8333-333333333333",
  runningOnly: "session-a5555555-5555-4555-8555-555555555555",
  archivedKeep: "session-a6666666-6666-4666-8666-666666666666",
};
const OLD_MS = Date.now() - 40 * 24 * 60 * 60 * 1000;
function seedSweepArtifact(sessionId, body, mtimeMs) {
  const dir = join(home, "sessions", bucket, sessionId);
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "session.v4.jsonl");
  writeFileSync(log, body);
  writeFileSync(join(dir, "session.lock"), "");
  utimesSync(log, new Date(mtimeMs), new Date(mtimeMs));
  utimesSync(dir, new Date(mtimeMs), new Date(mtimeMs));
  return { dir: dir, log: log };
}
const sessionLine = (id) => JSON.stringify({ type: "session", version: 4, id: id }) + "\n";
const userLine = JSON.stringify({ type: "user/message", seq: 1, data: { content: [{ type: "text", text: "hi" }] } }) + "\n";
seedSweepArtifact(sweepIds.stale, sessionLine(sweepIds.stale) + userLine, OLD_MS);
seedSweepArtifact(sweepIds.emptyish, sessionLine(sweepIds.emptyish), OLD_MS);
seedSweepArtifact(sweepIds.fresh, sessionLine(sweepIds.fresh) + userLine, Date.now());
// Two sessions old enough to tempt a sweep, which it must still refuse: one
// running, one archived. seeding backdates their LOG, which is what age means.
seedSweepArtifact(sweepIds.runningOnly, sessionLine(sweepIds.runningOnly) + userLine, OLD_MS);
seedSweepArtifact(sweepIds.archivedKeep, sessionLine(sweepIds.archivedKeep) + userLine, OLD_MS);
const sweepAgentGet = ctx.agents.get;
ctx.agents.get = (sessionId) => (sessionId === sweepIds.runningOnly ? { id: sessionId, status: "running" } : sweepAgentGet(sessionId));
const detachCalls = [];
const sweptWorkspaceIds = [sweepIds.stale, sweepIds.emptyish, sweepIds.fresh, sweepIds.runningOnly];
registry.list = () => [
  {
    id: "ws-test",
    path: "/Users/test/project",
    sessionIds: sweptWorkspaceIds.slice(),
    async detachSession(sessionId) {
      const at = sweptWorkspaceIds.indexOf(sessionId);
      if (at !== -1) sweptWorkspaceIds.splice(at, 1);
      detachCalls.push(sessionId);
    },
  },
];

const plugin = await import(join(here, "..", "lib", "index.js"));
plugin.apply(ctx);

// --- fake http -----------------------------------------------------------------
function makeRequest({ method = "GET", body, headers = {}, remoteAddress = "127.0.0.1" } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return {
    method,
    headers: { host: "127.0.0.1:3080", "sec-fetch-site": "same-origin", [HEADER]: "1", ...headers },
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      if (payload !== null) yield payload;
    },
  };
}
function makeResponse() {
  const captured = { status: 0, body: null };
  return {
    captured,
    writeHead(status) {
      captured.status = status;
    },
    end(text) {
      captured.body = JSON.parse(text);
    },
  };
}
async function call(path, options) {
  const route = routes.get(path);
  if (route === undefined) throw new Error("no route " + path);
  const response = makeResponse();
  await route.handler(makeRequest(options), response);
  return { status: response.captured.status, body: response.captured.body };
}

const P = "/api/dsh-archived";
const artifactOf = (id) => join(home, "sessions", bucket, id);
const cacheOf = (id) => join(home, "storages", "session_projcache", "sessions", id + ".json");

// --- route shape ----------------------------------------------------------------
check("registers ten routes under both prefixes", routes.size === 20
  && [...routes.keys()].some((p) => p.startsWith("/api/dsh-archived/"))
  && [...routes.keys()].some((p) => p.startsWith("/api/dsh-archived-sessions/")), [...routes.keys()].length + " routes");

// --- state ----------------------------------------------------------------------
const state = await call(P + "/state");
check("GET /state answers the panel's api version", state.status === 200 && state.body.apiVersion === 2, String(state.body.apiVersion));
const byId = Object.fromEntries(state.body.items.map((item) => [item.id, item]));
check("state lists every archived id", state.body.items.length === 6, String(state.body.items.length));
check("row title comes from the projection cache", byId[ids.withArtifact].title === "重构归档页", String(byId[ids.withArtifact].title));
check("row reports the artifact size", byId[ids.withArtifact].artifact.present === true && byId[ids.withArtifact].artifact.bytes > 2000, JSON.stringify(byId[ids.withArtifact].artifact));
check("index-only residue still gets a row", byId[ids.indexOnly].indexOnly === true && byId[ids.indexOnly].title === null, JSON.stringify(byId[ids.indexOnly]));
check("cache-only residue is distinguished from index-only", byId[ids.cacheOnly].cacheOnly === true && byId[ids.cacheOnly].indexOnly === false && byId[ids.cacheOnly].title === "只剩缓存的会话", JSON.stringify(byId[ids.cacheOnly]));
check("running sessions are flagged, not hidden", byId[ids.running].running === true);
check("subagent lineage is exposed on the parent", byId[ids.withChild].children.includes(ids.child), JSON.stringify(byId[ids.withChild].children));
check("legacy aggregate membership is reported", byId[ids.withArtifact].legacyRow === true && state.body.legacy.rows >= 1, JSON.stringify(state.body.legacy));
check("stale quarantine entry expired at load", existsSync(join(home, ".archived-sessions-quarantine", stale)) === false);

// --- trust ------------------------------------------------------------------------
// A same-origin signal is proof enough on its own: the shipped web client
// sends the marker, but the Desktop app's pipeline may not carry custom
// headers, and refusing it there was the bug this rule fixes.
const noMarker = await call(P + "/state", { headers: { [HEADER]: undefined } });
check("a browser-shaped same-origin GET needs no marker", noMarker.status === 200, String(noMarker.status));
const crossOrigin = await call(P + "/state", { headers: { origin: "http://evil.example" } });
check("origin mismatch is fatal even with the marker", crossOrigin.status === 403, String(crossOrigin.status));
const crossSite = await call(P + "/state", { headers: { "sec-fetch-site": "cross-site" } });
check("cross-site fetch metadata is fatal even with the marker", crossSite.status === 403, String(crossSite.status));
const noSignalNoMarker = await call(P + "/state", { headers: { [HEADER]: undefined, "sec-fetch-site": undefined } });
check("no signal and no marker is refused", noSignalNoMarker.status === 403, String(noSignalNoMarker.status));
const legacyMarker = await call("/api/dsh-archived-sessions/state", { headers: { [HEADER]: undefined, "x-dsh-archived-sessions": "1" } });
check("the pre-rename marker still works", legacyMarker.status === 200 && legacyMarker.body.apiVersion === 2, String(legacyMarker.status));
const legacyNoMarker = await call("/api/dsh-archived-sessions/state", { headers: { [HEADER]: undefined, "sec-fetch-site": undefined } });
check("the legacy prefix is no looser than the current one", legacyNoMarker.status === 403, String(legacyNoMarker.status));
const refusals = (await call(P + "/state")).body.refusals;
check("refused requests are recorded with their evidence",
  Array.isArray(refusals) && refusals.length >= 2 && refusals[0].trusted === false && "site" in refusals[0],
  JSON.stringify(refusals?.[0] ?? null).slice(0, 160));
const wrongMethod = await call(P + "/delete", { method: "GET" });
check("wrong method is refused", wrongMethod.status === 405, String(wrongMethod.status));

// --- refusals ----------------------------------------------------------------------
const badId = await call(P + "/delete", { method: "POST", body: { sessionId: "nope" } });
check("invalid id is refused", badId.body.error === "invalid-session-id", JSON.stringify(badId.body));
const notArchived = await call(P + "/delete", { method: "POST", body: { sessionId: ids.gone } });
check("unarchived id is refused", notArchived.body.error === "not-archived", JSON.stringify(notArchived.body));
const running = await call(P + "/delete", { method: "POST", body: { sessionId: ids.running } });
check("running session is refused", running.body.error === "session-running", JSON.stringify(running.body));
const parent = await call(P + "/delete", { method: "POST", body: { sessionId: ids.withChild } });
check("running subagent blocks the parent delete", parent.body.error === "subagent-running", JSON.stringify(parent.body));

// --- quarantine round trip ----------------------------------------------------------
const deleted = await call(P + "/delete", { method: "POST", body: { sessionId: ids.withArtifact } });
check("delete parks the session", deleted.body.ok === true && deleted.body.mode === "quarantine", JSON.stringify(deleted.body).slice(0, 120));
check("artifact directory left the sessions tree", existsSync(artifactOf(ids.withArtifact)) === false);
check("projection cache left the cache dir", existsSync(cacheOf(ids.withArtifact)) === false);
check("archive index entry was cleared through the registry", unarchiveCalls.includes(ids.withArtifact) && archived.has(ids.withArtifact) === false);
const parked = await call(P + "/state");
check("state reports the recycle bin", parked.body.quarantine.count === 1 && parked.body.quarantine.bytes > 2000, JSON.stringify(parked.body.quarantine.count));
const revealParked = await call(P + "/reveal", { method: "POST", body: { sessionId: ids.withArtifact } });
check("reveal follows a parked session into the recycle bin",
  revealParked.body.ok === true && revealParked.body.where === "quarantine" && revealParked.body.opener === "none",
  JSON.stringify(revealParked.body).slice(0, 160));

// A lingering idle agent rewrites its cache once after the delete; the sweep
// scheduled by the delete has to remove that residue.
mkdirSync(dirname(cacheOf(ids.withArtifact)), { recursive: true });
writeFileSync(cacheOf(ids.withArtifact), "{}");
await new Promise((resolve) => setTimeout(resolve, 3400));
check("post-delete sweep removes rewritten residue", existsSync(cacheOf(ids.withArtifact)) === false);

// --- restore ------------------------------------------------------------------------
const restored = await call(P + "/restore", { method: "POST", body: { sessionId: ids.withArtifact } });
check("restore succeeds and re-archives", restored.body.ok === true && restored.body.restored.rearchived === true, JSON.stringify(restored.body).slice(0, 140));
check("restore put the log directory back", existsSync(join(artifactOf(ids.withArtifact), "session.v4.jsonl.zstd")));
check("restore put the cache document back", existsSync(cacheOf(ids.withArtifact)));
check("restored id is archived again", archived.has(ids.withArtifact) === true && archiveCalls.includes(ids.withArtifact));
const restoreAgain = await call(P + "/restore", { method: "POST", body: { sessionId: ids.withArtifact } });
check("restoring a live session is refused", restoreAgain.body.error === "not-quarantined", JSON.stringify(restoreAgain.body));

const revealRestored = await call(P + "/reveal", { method: "POST", body: { sessionId: ids.withArtifact } });
check("reveal answers a path with the opener suppressed",
  revealRestored.body.ok === true && revealRestored.body.opener === "none" && revealRestored.body.where === "sessions",
  JSON.stringify(revealRestored.body).slice(0, 160));

// --- permanent delete ----------------------------------------------------------------
const forever = await call(P + "/delete", { method: "POST", body: { sessionId: ids.withArtifact, mode: "forever" } });
check("delete forever reports the mode", forever.body.ok === true && forever.body.mode === "forever", JSON.stringify(forever.body).slice(0, 120));
check("delete forever unlinks the directory", existsSync(artifactOf(ids.withArtifact)) === false);
const binAfterForever = await call(P + "/state");
check("delete forever leaves nothing parked", binAfterForever.body.quarantine.count === 0, String(binAfterForever.body.quarantine.count));

// --- index-only residue and batch delete ------------------------------------------------
const batch = await call(P + "/delete-all", { method: "POST", body: { ids: [ids.indexOnly, ids.running], mode: "quarantine" } });
check("batch delete reports per-id results", batch.body.results.length === 2, JSON.stringify(batch.body.results).slice(0, 160));
check("batch skips the running session and clears the residue", batch.body.results.find((r) => r.sessionId === ids.indexOnly).ok === true && batch.body.results.find((r) => r.sessionId === ids.running).error === "session-running");
const afterBatch = await call(P + "/state");
check("an index-only cleanup parks nothing", afterBatch.body.quarantine.count === 0, JSON.stringify(afterBatch.body.quarantine.count));

const parkedCacheOnly = await call(P + "/delete", { method: "POST", body: { sessionId: ids.cacheOnly } });
check("a cache-only session is recoverable", parkedCacheOnly.body.ok === true && parkedCacheOnly.body.removed.parked === true, JSON.stringify(parkedCacheOnly.body).slice(0, 140));

// --- reveal and empty ---------------------------------------------------------------------
const revealMissing = await call(P + "/reveal", { method: "POST", body: { sessionId: ids.gone } });
check("reveal refuses an unknown session", revealMissing.body.error === "no-artifact", JSON.stringify(revealMissing.body));

const emptied = await call(P + "/empty-quarantine", { method: "POST", body: {} });
check("emptying the recycle bin reports what it freed", emptied.body.ok === true && emptied.body.purged === 1, JSON.stringify(emptied.body));
check("emptying the bin frees the parked bytes", emptied.body.bytes > 0, String(emptied.body.bytes));
check("recycle bin directory is gone", readdirSync(join(home, ".archived-sessions-quarantine")).length === 0);

// --- imported sessions ---------------------------------------------------------------------
// The import feature namespaces the id it files in the archive index, while the
// session store keeps the bare uuid. Every row below was a real row the panel
// drew and every delete of it came back `invalid-session-id`, because the id
// guard only knew `session-<uuid>` — and once that guard is widened, the lookup
// still has to find a directory whose name is NOT the registry id.
const importCached = "import-e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
const importDir = "import-session-e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2";
const importRaw = "import-e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3";
const importRawInner = importRaw.slice("import-".length);
seedCache(importCached.slice("import-".length), "导入的会话（只剩缓存）");
seedArtifact(importDir.slice("import-session-".length), 777);
seedCache(importDir.slice("import-session-".length), "导入的会话（带日志）");
seedArtifact(importRawInner, 555);
seedCache(importRawInner, "导入的会话（裸 uuid 目录）");
for (const id of [importCached, importDir, importRaw]) archived.add(id);

// An imported row whose raw uuid names a *different* live session must not be
// deleted out from under that session's agent.
const importAlias = "import-33333333-3333-4333-8333-333333333333";
seedCache(importAlias.slice("import-".length), "导入的会话（裸 uuid 正在跑）");
archived.add(importAlias);

const importState = await call(P + "/state");
const importRows = Object.fromEntries(importState.body.items.map((item) => [item.id, item]));
check("an imported row reaches the panel", importRows[importCached] !== undefined && importRows[importDir] !== undefined, String(importState.body.items.length));
check("an imported row's log directory is found under its raw id",
  importRows[importDir].artifact.present === true && importRows[importDir].artifact.bytes === 777,
  JSON.stringify(importRows[importDir].artifact));
check("import-session-<uuid> resolves to the bare directory too",
  importRows[importRaw].artifact.present === true && importRows[importRaw].artifact.bytes === 555,
  JSON.stringify(importRows[importRaw].artifact));
const aliasDelete = await call(P + "/delete", { method: "POST", body: { sessionId: importAlias } });
check("an imported id aliasing a running session is refused",
  aliasDelete.body.error === "session-running" && aliasDelete.body.runningAs === ids.running,
  JSON.stringify(aliasDelete.body).slice(0, 160));
check("that refusal left its cache document alone", existsSync(cacheOf(importAlias.slice("import-".length))) === true);

const importBatch = await call(P + "/delete-all", { method: "POST", body: { ids: [importCached, importDir, importRaw], mode: "quarantine" } });
check("every imported row deletes", importBatch.body.ok === true && importBatch.body.results.every((result) => result.ok === true),
  JSON.stringify(importBatch.body.results).slice(0, 240));
check("an imported row's log directory is really gone", existsSync(artifactOf(importDir.slice("import-session-".length))) === false);
check("a bare-uuid directory is really gone", existsSync(artifactOf(importRawInner)) === false);
check("the imported row's cache document is gone", existsSync(cacheOf(importDir.slice("import-session-".length))) === false && existsSync(cacheOf(importCached.slice("import-".length))) === false);
check("the imported rows left the archive index", [importCached, importDir, importRaw].every((id) => archived.has(id) === false));
const importBin = await call(P + "/state");
check("imported deletions park what had a payload", importBin.body.quarantine.count === 3, String(importBin.body.quarantine.count));

const importRestore = await call(P + "/restore", { method: "POST", body: { sessionId: importDir } });
check("an imported session can be restored", importRestore.body.ok === true && importRestore.body.restored.directories === 1,
  JSON.stringify(importRestore.body).slice(0, 160));
check("the restored imported log is back under its bare uuid",
  existsSync(join(artifactOf(importDir.slice("import-session-".length)), "session.v4.jsonl.zstd")));

const importReveal = await call(P + "/reveal", { method: "POST", body: { sessionId: importRaw } });
check("reveal accepts an imported id", importReveal.body.error !== "invalid-session-id", JSON.stringify(importReveal.body).slice(0, 120));

// The namespace must not become a way around the path-safety argument.
for (const bad of ["import-../../etc/passwd", "import-session-1234", "import-", "session-../../x", "import-session-" + "a".repeat(36)]) {
  const refused = await call(P + "/delete", { method: "POST", body: { sessionId: bad } });
  check(`a malformed id is still refused (${bad.slice(0, 28)})`, refused.body.error === "invalid-session-id", JSON.stringify(refused.body).slice(0, 120));
}

// --- capability probe ---------------------------------------------------------------------
const routesWithout = routes.size;
const blind = { ...ctx, workspaceRegistry: { get archivedSessionIds() { return [ids.indexOnly]; } }, get: () => undefined };
const blindRoutes = new Map();
blind.webServer = { register: (route) => blindRoutes.set(route.path, route) };
delete blind.get;
const blindPlugin = await import(join(here, "..", "lib", "index.js") + "?blind");
blindPlugin.apply(blind);
const blindResponse = makeResponse();
await blindRoutes.get(P + "/delete").handler(makeRequest({ method: "POST", body: { sessionId: ids.indexOnly } }), blindResponse);
check("a host without the registry API refuses instead of half-deleting", blindResponse.captured.body.error === "no-registry", JSON.stringify(blindResponse.captured.body));
check("the primary host was untouched by that probe", routes.size === routesWithout);

// --- sweep: scan (read-only) -------------------------------------------------------
// The archive set is only re-seeded here: the suite's own delete-all test empties
// it long before this point, and the sweep must ignore whatever the archive page
// currently owns.
archived.add(sweepIds.archivedKeep);
const sweepScan = await call(P + "/sweep/scan", { method: "POST", body: { days: 14 } });
check("POST /sweep/scan answers", sweepScan.status === 200 && sweepScan.body.ok === true, String(sweepScan.status));
const sweepRows = Object.fromEntries(sweepScan.body.candidates.map((row) => [row.id, row]));
check("40 天前的会话成为候选", sweepIds.stale in sweepRows && sweepRows[sweepIds.stale].stale === true, Object.keys(sweepRows).length + " rows");
check("只发过 header 的空会话成为候选", sweepRows[sweepIds.emptyish]?.empty === true, JSON.stringify(sweepRows[sweepIds.emptyish] ?? null).slice(0, 140));
check("今天写过的会话不在候选里", (sweepIds.fresh in sweepRows) === false);
check("已归档的会话留给归档页", (sweepIds.archivedKeep in sweepRows) === false);
check("正在跑的会话列出来但不可删", sweepRows[sweepIds.runningOnly]?.eligible === false && sweepRows[sweepIds.runningOnly]?.running === true, JSON.stringify(sweepRows[sweepIds.runningOnly] ?? null).slice(0, 140));
check("扫描不写盘", existsSync(join(home, "sessions", bucket, sweepIds.stale)));

// --- sweep: delete ------------------------------------------------------------------
const sweepArchived = await call(P + "/sweep/delete", { method: "POST", body: { ids: [sweepIds.archivedKeep] } });
check("sweep 拒绝已归档 id", sweepArchived.body.results[0].error === "archived-session", JSON.stringify(sweepArchived.body.results[0]));
const sweepRunning = await call(P + "/sweep/delete", { method: "POST", body: { ids: [sweepIds.runningOnly] } });
check("sweep 拒绝在跑的会话", sweepRunning.body.results[0].error === "session-running", JSON.stringify(sweepRunning.body.results[0]));
const sweepBadId = await call(P + "/sweep/delete", { method: "POST", body: { ids: ["not-a-session"] } });
check("sweep 拒绝非法 id", sweepBadId.body.results[0].error === "invalid-session-id", JSON.stringify(sweepBadId.body.results[0]));

const swept = await call(P + "/sweep/delete", { method: "POST", body: { ids: [sweepIds.stale, sweepIds.emptyish] } });
check("sweep 把两个候选都停进回收站", swept.status === 200 && swept.body.ok === true && swept.body.results.every((row) => row.ok === true), JSON.stringify(swept.body.results).slice(0, 200));
check("被清的会话日志离开 sessions 根", !existsSync(join(home, "sessions", bucket, sweepIds.stale)) && !existsSync(join(home, "sessions", bucket, sweepIds.emptyish)));
check("被清的会话进了同一个回收站", existsSync(join(home, ".archived-sessions-quarantine", sweepIds.stale, "session")) && existsSync(join(home, ".archived-sessions-quarantine", sweepIds.emptyish, "session")));
check("官方 detachSession 把 id 从工作区列表摘掉", detachCalls.includes(sweepIds.stale) && detachCalls.includes(sweepIds.emptyish) && sweptWorkspaceIds.includes(sweepIds.stale) === false, JSON.stringify({ detachCalls: detachCalls, left: sweptWorkspaceIds }));
check("回收站里的会话可以按原路恢复", (await call(P + "/restore", { method: "POST", body: { sessionId: sweepIds.stale } })).body.ok === true);

// --- sweep: settings + the weekly run -------------------------------------------------
const sweepSaved = await call(P + "/sweep/settings", { method: "POST", body: { enabled: true, days: 7 } });
check("sweep 设置可保存", sweepSaved.body.ok === true && sweepSaved.body.settings.enabled === true && sweepSaved.body.settings.days === 7, JSON.stringify(sweepSaved.body.settings));
const autoId = "session-a4444444-4444-4444-8444-444444444444";
seedSweepArtifact(autoId, sessionLine(autoId) + userLine, Date.now() - 30 * 24 * 60 * 60 * 1000);
sweptWorkspaceIds.push(autoId);
const ran = await plugin.runAutoSweep(ctx, Date.now());
check("到期的自动 sweep 只把陈旧会话停进回收站", ran.ran === true && ran.parked >= 1, JSON.stringify(ran));
check("自动 sweep 落的也是同一个回收站", existsSync(join(home, ".archived-sessions-quarantine", autoId, "session")));
check("自动 sweep 走的是同一个 detach 出口", detachCalls.includes(autoId));
const notDue = await plugin.runAutoSweep(ctx, Date.now());
check("同一周内不会重复跑", notDue.skipped === "not-due", JSON.stringify(notDue));

rmSync(home, { recursive: true, force: true });

console.log();
if (failures.length > 0) {
  console.log(`${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("all checks passed");
