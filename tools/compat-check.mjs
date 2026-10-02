#!/usr/bin/env node
/**
 * Host-contract check — does THIS machine's DSH still offer what the plugin
 * needs? Run it first after a DSH upgrade: every other suite talks to the
 * plugin, this one talks to the host the plugin is written against.
 *
 * It reads the shipped app bundle directly (the same bytes the host runs), so
 * it answers "is the contract still there" without starting a server.
 *
 *     node tools/compat-check.mjs
 *     DSH_APP_ASAR=/path/to/app.asar node tools/compat-check.mjs
 *
 * Exits 0 with SKIP when no bundle can be found (a CI box without DSH).
 */

import { existsSync, openSync, readSync, closeSync, readFileSync } from "node:fs";

const CANDIDATES = [
  process.env.DSH_APP_ASAR,
  "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar",
].filter((path) => typeof path === "string" && path.length > 0);

const failures = [];
function check(label, condition, detail = "") {
  const mark = condition ? "PASS" : "FAIL";
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

const archive = CANDIDATES.find((path) => existsSync(path));
if (archive === undefined) {
  console.log("SKIP: no DSH app bundle found (set DSH_APP_ASAR to point at one)");
  process.exit(0);
}
console.log(`bundle: ${archive}`);

// --- minimal asar reader --------------------------------------------------------
const fd = openSync(archive, "r");
const sizeBuf = Buffer.alloc(8);
readSync(fd, sizeBuf, 0, 8, 0);
const headerSize = sizeBuf.readUInt32LE(4);
const headerBuf = Buffer.alloc(headerSize);
readSync(fd, headerBuf, 0, headerSize, 8);
const jsonLength = headerBuf.readUInt32LE(4);
const tree = JSON.parse(headerBuf.toString("utf8", 8, 8 + jsonLength).replace(/\u0000+$/, ""));
const dataStart = 8 + headerSize;

function entry(path) {
  let node = tree;
  for (const part of path.split("/").filter(Boolean)) {
    node = node?.files?.[part];
    if (node === undefined) return null;
  }
  return node?.files === undefined ? node : null;
}
function readText(path) {
  const node = entry(path);
  if (node === null) return null;
  const buffer = Buffer.alloc(node.size);
  readSync(fd, buffer, 0, node.size, dataStart + parseInt(node.offset, 10));
  return buffer.toString("utf8");
}
const modules = "/dsh/node_modules/@deepseek-ai/";

// --- the bundle is a DSH we can reason about ---------------------------------------
const rootPkg = readText("/dsh/package.json");
const version = rootPkg === null ? null : JSON.parse(rootPkg).version;
check("the bundle is a DSH app with a readable version", typeof version === "string", String(version));

// --- slot contract: settings.section is a list, and our cell is free ----------------
const shell = readText(modules + "dsh-client-ui-settings-general/lib/client.js");
check("the settings shell ships a settings.section list slot",
  typeof shell === "string" && /"settings\.section":\s*\{\s*kind:\s*"list"/.test(shell));
const officialIds = [];
for (const name of ["dsh-client-ui-settings-general", "dsh-client-ui-settings-models", "dsh-client-ui-settings-plugins", "dsh-client-ui-agent-preset", "dsh-client-ui-settings-account"]) {
  const source = readText(`${modules}${name}/lib/client.js`);
  if (source === null) continue;
  for (const match of source.matchAll(/name:\s*"settings\.section"[\s\S]{0,240}?id:\s*"([^"]+)"/g)) officialIds.push(match[1]);
}
check("settings.section is still claimed by the shipped sections", officialIds.length > 0, officialIds.join(", "));
check("our 'archived-sessions' cell is free on this host", !officialIds.includes("archived-sessions"), officialIds.join(", "));
check("no shipped archived-sessions page exists to shadow", entry(modules + "dsh-client-ui-settings-unarchive-sessions/package.json") === null);

// --- archive API -----------------------------------------------------------------------
const workspace = readText(modules + "dsh-workspace/lib/types/index.d.ts") ?? readText(modules + "dsh-workspace/lib/index.js");
check("the workspace registry still owns the archive set",
  typeof workspace === "string" && workspace.includes("archivedSessionIds") && workspace.includes("unarchiveSession"));
check("the registry still exposes archiveSession", typeof workspace === "string" && workspace.includes("archiveSession"));
check("the archived-session admission gate is present",
  entry(modules + "dsh-api-session-controller/lib/types/archived-session-gate.js") !== null);

// --- web server + agent registry ---------------------------------------------------------
const webServer = readText(modules + "dsh-host-webserver/lib/index.js");
check("the host web server still takes exact routes",
  typeof webServer === "string" && webServer.includes("register(route)") && webServer.includes('route.kind === "exact"'));
const agent = readText(modules + "dsh-agent/lib/index.js");
check("the agent registry still lists and gets agents",
  typeof agent === "string" && agent.includes("list()") && agent.includes("get(id)"));

// --- persistence layout -------------------------------------------------------------------
const cache = readText(modules + "dsh-session-projection-cache/lib/index.js");
check("the projection cache still writes one document per session",
  typeof cache === "string" && cache.includes("per-record") && cache.includes("session_projcache"));

closeSync(fd);

console.log();
if (failures.length > 0) {
  console.log(`${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("all checks passed");
