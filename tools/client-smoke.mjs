#!/usr/bin/env node
/**
 * Client-half smoke test — no browser, no React install.
 *
 * Loads lib/client.js with a stub module loader and a minimal React shim, then
 * renders the page with fake host state. The regression this suite exists for
 * is the one that made residue impossible to remove: a row whose session the
 * browser has no summary for must still render, because the host route is the
 * row source and the browser store is only an enrichment.
 *
 *     node tools/client-smoke.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = join(here, "..", "lib", "client.js");

const failures = [];
function check(label, condition, detail = "") {
  const mark = condition ? "PASS" : "FAIL";
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

// --- minimal React shim ------------------------------------------------------
// Hook state persists across renders so the test can render, let the effects'
// promises settle, and render again — which is how the real page fills in.
let hooks = [];
let cursor = 0;
const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } };
  },
  useState(initial) {
    const index = cursor++;
    if (hooks[index] === undefined) hooks[index] = typeof initial === "function" ? initial() : initial;
    return [
      hooks[index],
      (value) => {
        hooks[index] = typeof value === "function" ? value(hooks[index]) : value;
      },
    ];
  },
  useMemo(factory) {
    cursor += 1;
    return factory();
  },
  useEffect(fn, deps) {
    const index = cursor++;
    const previous = hooks[index];
    const changed = previous === undefined || deps === undefined || previous.some((dep, i) => dep !== deps[i]);
    if (changed) {
      hooks[index] = deps === undefined ? [] : [...deps];
      const cleanup = fn();
      if (typeof cleanup === "function") cleanup();
    }
  },
};

let loaded = null;
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      loaded = {
        id,
        exports: factory((name) => {
          if (name === "react") return React;
          throw new Error(`unexpected require(${name})`);
        }),
      };
    },
  },
};

// --- fake host -----------------------------------------------------------------
const archivedId = "session-11111111-2222-3333-4444-555555555555";
const hostTitleId = "session-77777777-7777-4777-8777-777777777777";
const residueId = "session-99999999-8888-7777-6666-555555555555";
const calls = [];
const statePayload = {
  ok: true,
  apiVersion: 2,
  home: "/tmp/dsh",
  items: [
    {
      id: archivedId,
      archived: true,
      title: "宿主给的标题",
      cwd: "/Users/test/project",
      createdAt: Date.now() - 86400000,
      artifact: { present: true, bytes: 2048, path: "/tmp/dsh/sessions/x/" + archivedId },
      cache: true,
      indexOnly: false,
      cacheOnly: false,
      running: false,
      ancestors: [],
      children: [],
      legacyRow: true,
    },
    {
      id: hostTitleId,
      archived: true,
      title: "只有宿主知道标题",
      cwd: "/Users/test/other",
      createdAt: Date.now() - 7200000,
      artifact: { present: false, bytes: 0, path: null },
      cache: true,
      indexOnly: false,
      cacheOnly: true,
      running: false,
      ancestors: [],
      children: [],
      legacyRow: false,
    },
    {
      id: residueId,
      archived: true,
      title: null,
      cwd: null,
      createdAt: null,
      artifact: { present: false, bytes: 0, path: null },
      cache: false,
      indexOnly: true,
      cacheOnly: false,
      running: false,
      ancestors: [],
      children: [],
      legacyRow: false,
    },
  ],
  quarantine: { count: 1, bytes: 4096, items: [{ id: "session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", title: "被删的", bytes: 4096 }] },
  legacy: { present: true, rows: 56 },
};
globalThis.fetch = async (path, init) => {
  calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
  return { status: 200, json: async () => statePayload };
};

await import(clientPath);
check("module registered itself on the loader", loaded !== null && loaded.id === "dsh-archived-sessions-manager");
const client = loaded.exports;
check("client half exports apply()", typeof client.apply === "function");
check("client half injects slots/locale/uiWorkspace", ["slots", "locale", "uiWorkspace"].every((name) => client.inject.includes(name)), JSON.stringify(client.inject));

// --- context stub ---------------------------------------------------------------
let dictionaries = null;
let registration = null;
let locale = "zh";
const ctx = {
  effect(fn) {
    fn();
  },
  locale: {
    register(namespace, value) {
      dictionaries = value;
      return () => {};
    },
    bind() {
      return (key, params) => {
        const template = dictionaries?.[locale]?.[key];
        if (template === undefined) return key;
        if (params === undefined) return template;
        return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);
      };
    },
  },
  slots: {
    inject(name, contribute) {
      contribute();
    },
    register(options, component) {
      registration = { options, component };
      return () => {};
    },
  },
  uiWorkspace: { async unarchiveSession() {} },
};
client.apply(ctx);

check("page registers into settings.section", registration?.options?.name === "settings.section");
check("page owns the 'archived-sessions' cell", registration?.options?.id === "archived-sessions");
check("page registers at the shadowing priority", registration?.options?.priority === -1, String(registration?.options?.priority));
check("page sits after the shipped settings sections", registration?.options?.order === 25, String(registration?.options?.order));

// --- dictionaries -----------------------------------------------------------------
const zhKeys = Object.keys(dictionaries.zh).sort();
const enKeys = Object.keys(dictionaries.en).sort();
check("zh and en dictionaries cover the same keys", JSON.stringify(zhKeys) === JSON.stringify(enKeys),
  zhKeys.filter((k) => !enKeys.includes(k)).concat(enKeys.filter((k) => !zhKeys.includes(k))).join(", "));
check("nav reads 已归档 in Chinese", dictionaries.zh.nav === "已归档", dictionaries.zh.nav);
check("nav reads Archived in English", dictionaries.en.nav === "Archived", dictionaries.en.nav);
const hostCodes = ["invalid-session-id", "not-archived", "session-running", "subagent-running", "no-registry", "busy", "not-quarantined", "no-artifact", "forbidden", "generic"];
check("every host refusal code has a message in both dictionaries",
  hostCodes.every((code) => dictionaries.zh["error." + code] !== undefined && dictionaries.en["error." + code] !== undefined),
  hostCodes.filter((code) => dictionaries.zh["error." + code] === undefined).join(", "));

// --- render walk --------------------------------------------------------------------
function walk(node, visit) {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") return;
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit));
  visit(node);
  walk(node.props?.children, visit);
}
function textsOf(tree) {
  const texts = [];
  (function walk(node) {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") {
      texts.push(String(node));
      return;
    }
    if (Array.isArray(node)) return node.forEach(walk);
    walk(node.props?.children);
  })(tree);
  return texts.join(" | ");
}
function findButton(tree, label) {
  let found = null;
  walk(tree, (node) => {
    if (found !== null) return;
    if (node.type !== "button") return;
    const text = textsOf(node);
    if (text === label) found = node;
  });
  return found;
}

const props = () => ({
  t: ctx.locale.bind("dsh-archived-sessions"),
  unarchive: async () => {},
  useSessions: (selector) =>
    selector({ phase: "ready", byId: { [archivedId]: { displayTitle: "浏览器里的标题", updatedAt: Date.now() - 3 * 3600_000 } } }),
  useWorkspaces: (selector) => selector({ items: [], archivedSessionIds: [archivedId, residueId] }),
});

hooks = [];
cursor = 0;
const first = registration.component(props());
check("first paint shows the loading state", textsOf(first).includes("正在读取会话"), textsOf(first).slice(0, 80));

await new Promise((resolve) => setTimeout(resolve, 10));
const p = props();
cursor = 0;
const tree = registration.component(p);
const rendered = textsOf(tree);

check("the page asks the host for its rows", calls.some((call) => call.path === "/api/dsh-archived-sessions/state"));
check("client summary enriches the host title", rendered.includes("浏览器里的标题"), rendered.slice(0, 200));
check("row group heading comes from the session cwd", rendered.includes("project"), rendered.slice(0, 200));
check("index-only residue still renders a row", rendered.includes(residueId), rendered.slice(0, 300));
check("index-only rows are labelled as such", rendered.includes("仅索引残留"));
check("a row the browser has no summary for uses the host title", rendered.includes("只有宿主知道标题"), rendered.slice(0, 400));
check("a row with neither summary nor cache falls back to its id", rendered.includes(residueId));
check("recycle bin strip is shown with its size", rendered.includes("回收站") && rendered.includes("4 KB"), rendered.slice(0, 300));
check("every rule carries unarchive", rendered.includes("取消归档"));
check("every rule carries delete and details", rendered.includes("删除") && rendered.includes("详情"));
check("permanent delete is not offered before confirming", rendered.includes("永久删除") === false);
check("no raw locale keys leak into the page",
  !/\berror\.[a-z-]+|\btime\.[a-z]+|\bcancel\b|\bdetailId\b/.test(rendered), rendered.slice(0, 300));

// --- destructive flow is two-step ------------------------------------------------------
let deleteButton = null;
walk(tree, (node) => {
  if (deleteButton !== null || node.type !== "button") return;
  if (node.props["aria-label"] === "删除 浏览器里的标题") deleteButton = node;
});
check("the delete button is wired", deleteButton !== null && typeof deleteButton.props.onClick === "function");
deleteButton.props.onClick();
cursor = 0;
const confirming = registration.component(props());
const confirmText = textsOf(confirming);
check("confirming offers delete forever as a separate, explicit action", confirmText.includes("永久删除"), confirmText.slice(0, 300));
check("confirming says deletion is recoverable", confirmText.includes("删除后可在回收站恢复"), confirmText.slice(0, 300));
const confirmButton = findButton(confirming, "确认删除");
check("confirming exposes the delete action", confirmButton !== null);
confirmButton.props.onClick();
await new Promise((resolve) => setTimeout(resolve, 10));
const posted = calls.filter((call) => call.method === "POST");
check("confirming posts a quarantine delete for that row",
  posted.some((call) => call.path === "/api/dsh-archived-sessions/delete" && call.body.sessionId === archivedId && call.body.mode === "quarantine"),
  JSON.stringify(posted).slice(0, 200));

// --- English locale ----------------------------------------------------------------------
locale = "en";
cursor = 0;
const englishTree = registration.component(props());
const english = textsOf(englishTree);
check("English render uses the Archived label", english.includes("Archived"), english.slice(0, 160));
check("English render localizes the actions", english.includes("Unarchive") && english.includes("Delete"), english.slice(0, 200));

console.log();
if (failures.length > 0) {
  console.log(`${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("all checks passed");
