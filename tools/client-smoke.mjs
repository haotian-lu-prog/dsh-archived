#!/usr/bin/env node
/**
 * Client-half smoke test — no browser, no React install.
 *
 * Loads lib/client.js with a stub module loader and a minimal React shim, then
 * checks the two things the browser would otherwise be the first to discover:
 * the slot registration (same cell as the shipped page, shadowing priority) and
 * that the page renders the shipped affordances plus the destructive ones.
 *
 *     node tools/client-smoke.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = join(here, "..", "plugin", "lib", "client.js");

const failures = [];
function check(label, condition, detail = "") {
  const mark = condition ? "PASS" : "FAIL";
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

// --- minimal React shim ------------------------------------------------------
const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } };
  },
  useState(initial) {
    return [typeof initial === "function" ? initial() : initial, () => {}];
  },
  useMemo(factory) {
    return factory();
  },
  useEffect() {},
};

let loaded = null;
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      loaded = { id, exports: factory((name) => {
        if (name === "react") return React;
        throw new Error(`unexpected require(${name})`);
      }) };
    },
  },
};

await import(clientPath);
check("module registered itself on the loader", loaded !== null && loaded.id === "dsh-archived-sessions-manager");
const client = loaded.exports;
check("client half exports apply()", typeof client.apply === "function");
check("client half injects slots/locale/uiWorkspace",
  ["slots", "locale", "uiWorkspace"].every((name) => client.inject.includes(name)),
  JSON.stringify(client.inject));

// --- context stub ------------------------------------------------------------
let dictionaries = null;
let registration = null;
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
        const template = dictionaries?.zh?.[key];
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
  uiWorkspace: {
    async unarchiveSession() {},
  },
};
client.apply(ctx);

check("page registers into settings.section", registration?.options?.name === "settings.section");
check("page takes over the shipped 'archived-sessions' cell", registration?.options?.id === "archived-sessions");
check("page registers at a shadowing priority", registration?.options?.priority === -1, String(registration?.options?.priority));
check("page keeps the shipped nav order", registration?.options?.order === 25);

// --- render walk -------------------------------------------------------------
const archivedId = "session-11111111-2222-3333-4444-555555555555";
const liveId = "session-99999999-8888-7777-6666-555555555555";
const props = {
  t: ctx.locale.bind("dsh-archived-sessions"),
  unarchive: async () => {},
  useSessions: (selector) => selector({
    phase: "ready",
    byId: {
      [archivedId]: { displayTitle: "回收站测试", updatedAt: Date.now() - 3 * 3600_000 },
    },
  }),
  useWorkspaces: (selector) => selector({
    items: [{ id: "workspace", title: "Ai", sessionIds: [archivedId, liveId] }],
    archivedSessionIds: [archivedId],
  }),
};

const tree = registration.component(props);
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
const rendered = texts.join(" | ");

check("renders the archived session title", rendered.includes("回收站测试"), rendered.slice(0, 160));
check("renders the workspace and relative time", rendered.includes("Ai · 3小时"), rendered.slice(0, 200));
check("keeps the shipped Unarchive action", rendered.includes("取消归档"));
check("adds the per-row permanent delete", rendered.includes("彻底删除"));
check("adds the clear-all action", rendered.includes("清空全部（1）"), rendered.slice(0, 200));
check("no raw locale keys leak into the page", !/settings\.|time\.[a-z]+ \{/.test(rendered));

console.log();
if (failures.length > 0) {
  console.log(`${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("all checks passed");
