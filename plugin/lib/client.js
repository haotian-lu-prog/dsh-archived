// dsh-archived-sessions-manager browser half.
//
// Built in the DSH lazy-CJS bundle format: executing this file only registers a
// factory; the module body (styles, locale, slot registration) runs when the
// browser materializes the module.
//
// It takes over the shipped "Archived sessions" settings page by registering
// the SAME `settings.section` cell id at a LOWER priority. The slot registry
// keeps one winner per (kind, id) cell — the lowest priority renders — so this
// entry replaces client-ui-settings-unarchive-sessions' page in place while the
// shipped plugin keeps loading untouched. The page therefore owes the user the
// shipped affordances (search, per-row Unarchive, the three empty states) plus
// the new destructive ones (per-row permanent delete, clear all).

window.__ModuleLoader__.load({
  id: "dsh-archived-sessions-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useMemo = React.useMemo;

    var HEADER = "x-dsh-archived-sessions";
    var STATE_PATH = "/api/dsh-archived-sessions/state";
    var PURGE_PATH = "/api/dsh-archived-sessions/purge";
    var PURGE_ALL_PATH = "/api/dsh-archived-sessions/purge-all";
    var STYLE_ID = "dsh-archived-sessions-manager-style";

    var CSS = [
      ".dasm_section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}",
      ".dasm_head{align-items:center;gap:8px;display:flex}",
      ".dasm_search{flex:1;color:var(--dsw-alias-label-tertiary);align-items:center;display:flex;position:relative}",
      ".dasm_search>svg{pointer-events:none;position:absolute;left:10px}",
      ".dasm_search input{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);width:100%;height:32px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;padding:0 12px 0 34px}",
      ".dasm_status{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}",
      ".dasm_notice{color:var(--dsw-alias-state-success-primary,#36d67a);margin:0;font-size:12px;line-height:18px;word-break:break-word}",
      ".dasm_noticeError{color:var(--dsw-alias-state-error-primary,#ff6464);margin:0;font-size:12px;line-height:18px;word-break:break-word}",
      ".dasm_list{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}",
      ".dasm_row{border-radius:8px;align-items:center;gap:12px;padding:8px 10px;display:flex}",
      ".dasm_row:hover{background:var(--dsw-alias-bg-layer-1)}",
      ".dasm_identity{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}",
      ".dasm_title{text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px;overflow:hidden}",
      ".dasm_meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
      ".dasm_actions{align-items:center;gap:6px;flex:0 0 auto;display:flex}",
      ".dasm_hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap}",
      ".dasm_btn{display:inline-flex;align-items:center;justify-content:center;min-height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#4b4d52);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#b8bbc2);font:inherit;font-size:13px;line-height:18px;white-space:nowrap;cursor:pointer}",
      ".dasm_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#3a3b3f);color:var(--dsw-alias-label-primary,#fff)}",
      ".dasm_btn:disabled{cursor:not-allowed;opacity:.55}",
      ".dasm_btnDanger{border-color:var(--dsw-alias-state-error-primary,#ff6464);color:var(--dsw-alias-state-error-primary,#ff6464)}",
      ".dasm_btnDanger:hover:not(:disabled){background:var(--dsw-alias-state-error-primary,#ff6464);color:#fff}",
      ".dasm_btnSolidDanger{border-color:var(--dsw-alias-state-error-primary,#ff6464);background:var(--dsw-alias-state-error-primary,#ff6464);color:#fff}",
      ".dasm_btnSolidDanger:hover:not(:disabled){background:var(--dsw-alias-state-error-primary-hover,#e04f4f);color:#fff}",
    ].join("");

    if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-archived-sessions-manager";
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** Same-origin call to this plugin's host routes; never throws on a JSON error body. */
    function request(path, options) {
      var init = {
        method: options && options.method ? options.method : "GET",
        credentials: "same-origin",
        headers: { [HEADER]: "1" },
      };
      if (options && options.body !== undefined) {
        init.headers["content-type"] = "application/json";
        init.body = JSON.stringify(options.body);
      }
      return fetch(path, init).then(function (response) {
        return response.json().catch(function () {
          throw new Error("HTTP " + response.status);
        });
      });
    }

    function formatBytes(bytes) {
      if (typeof bytes !== "number" || !isFinite(bytes) || bytes <= 0) return "0 KB";
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
      return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    /** Localized compact relative time of one row's last activity. */
    function timeLabel(updatedAt, now, t) {
      var elapsed = Math.max(0, now - updatedAt);
      var minutes = Math.floor(elapsed / 60000);
      if (minutes < 1) return t("time.now");
      if (minutes < 60) return t("time.minutes", { n: minutes });
      var hours = Math.floor(minutes / 60);
      if (hours < 24) return t("time.hours", { n: hours });
      var days = Math.floor(hours / 24);
      if (days < 30) return t("time.days", { n: days });
      var months = Math.floor(days / 30);
      if (months < 12) return t("time.months", { n: months });
      return t("time.years", { n: Math.floor(months / 12) });
    }

    function matches(row, normalizedQuery) {
      if (normalizedQuery.length === 0) return true;
      return (
        row.title.toLowerCase().indexOf(normalizedQuery) !== -1 ||
        row.workspace.toLowerCase().indexOf(normalizedQuery) !== -1
      );
    }

    /**
     * Archived-session Settings page with permanent deletion.
     *
     * @param props - composed slot props: localizer, the two host-backed actions,
     * the framework session/workspace selectors, and the shell's `close`.
     */
    function ArchivedSessionsManagerSection(props) {
      var t = props.t;
      var unarchive = props.unarchive;
      var useSessions = props.useSessions;
      var useWorkspaces = props.useWorkspaces;

      var sessions = useSessions(function (state) {
        return state;
      });
      var workspaceItems = useWorkspaces(function (state) {
        return state.items;
      });
      var archivedSessionIds = useWorkspaces(function (state) {
        return state.archivedSessionIds;
      });

      var [query, setQuery] = useState("");
      var [sizes, setSizes] = useState(null);
      var [pending, setPending] = useState(null);
      var [confirmId, setConfirmId] = useState(null);
      var [confirmAll, setConfirmAll] = useState(false);
      var [notice, setNotice] = useState(null);

      var idsKey = archivedSessionIds.join(",");

      // The archive set is host-owned; the on-disk footprint is not, so annotate
      // rows from this plugin's own endpoint and refresh whenever the set changes.
      useEffect(
        function () {
          var cancelled = false;
          if (archivedSessionIds.length === 0) {
            setSizes({});
            return function () {};
          }
          request(STATE_PATH)
            .then(function (payload) {
              if (cancelled || !payload || payload.ok !== true) return;
              var next = {};
              for (var i = 0; i < payload.items.length; i += 1) next[payload.items[i].id] = payload.items[i];
              setSizes(next);
            })
            .catch(function () {
              // The annotation is optional; a failure leaves rows unannotated.
            });
          return function () {
            cancelled = true;
          };
        },
        [idsKey],
      );

      var ungrouped = t("ungrouped");
      var summaries = sessions.byId;
      var rows = useMemo(
        function () {
          var owners = new Map();
          for (var i = 0; i < workspaceItems.length; i += 1) {
            var workspace = workspaceItems[i];
            for (var j = 0; j < workspace.sessionIds.length; j += 1) {
              owners.set(workspace.sessionIds[j], workspace.title);
            }
          }
          var built = [];
          for (var k = archivedSessionIds.length - 1; k >= 0; k -= 1) {
            var id = archivedSessionIds[k];
            var summary = summaries[id];
            if (summary === undefined) continue;
            built.push({
              id: id,
              title: summary.displayTitle,
              workspace: owners.get(id) || ungrouped,
              updatedAt: summary.updatedAt,
            });
          }
          return built;
        },
        [archivedSessionIds, workspaceItems, summaries, ungrouped],
      );

      if (sessions.phase !== "ready") {
        return h("p", { className: "dasm_status" }, t("loading"));
      }

      var now = Date.now();
      var normalized = query.trim().toLowerCase();
      var visible = rows.filter(function (row) {
        return matches(row, normalized);
      });
      var archivedCount = archivedSessionIds.length;

      function describeError(code) {
        var key = "error." + String(code);
        var text = t(key);
        return text === key ? t("error.generic") : text;
      }

      function runPurge(row) {
        setPending(row.id);
        setNotice(null);
        request(PURGE_PATH, { method: "POST", body: { sessionId: row.id } })
          .then(function (payload) {
            if (!payload || payload.ok !== true) {
              throw new Error(describeError(payload && payload.error));
            }
            setConfirmId(null);
            setNotice({
              kind: "ok",
              text: t("deletedOne", { title: row.title, size: formatBytes(payload.removed && payload.removed.bytes) }),
            });
          })
          .catch(function (error) {
            setNotice({ kind: "error", text: String(error && error.message ? error.message : error) });
          })
          .then(function () {
            setPending(null);
          });
      }

      function runPurgeAll() {
        setPending("__all__");
        setNotice(null);
        request(PURGE_ALL_PATH, { method: "POST", body: {} })
          .then(function (payload) {
            if (!payload || !Array.isArray(payload.results)) {
              throw new Error(describeError(payload && payload.error));
            }
            var deleted = 0;
            var bytes = 0;
            for (var i = 0; i < payload.results.length; i += 1) {
              if (payload.results[i].ok) {
                deleted += 1;
                bytes += (payload.results[i].removed && payload.results[i].removed.bytes) || 0;
              }
            }
            var failed = payload.results.length - deleted;
            setConfirmAll(false);
            if (failed === 0) {
              setNotice({ kind: "ok", text: t("deletedAll", { n: deleted, size: formatBytes(bytes) }) });
            } else {
              setNotice({ kind: "error", text: t("deletedPartial", { ok: deleted, failed: failed }) });
            }
          })
          .catch(function (error) {
            setNotice({ kind: "error", text: String(error && error.message ? error.message : error) });
          })
          .then(function () {
            setPending(null);
          });
      }

      function sizeLabel(id) {
        if (sizes === null) return null;
        var entry = sizes[id];
        if (entry === undefined) return t("indexOnly");
        if (entry.artifact !== true) return t("indexOnly");
        return t("logSize", { size: formatBytes(entry.bytes) });
      }

      var head = h("div", { className: "dasm_head" }, [
        h(
          "div",
          { className: "dasm_search", key: "search" },
          [
            h(
              "svg",
              { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", key: "icon" },
              [
                h("circle", { cx: 7, cy: 7, r: 4.5, stroke: "currentColor", strokeWidth: 1.2, key: "c" }),
                h("path", { d: "M10.5 10.5 14 14", stroke: "currentColor", strokeWidth: 1.2, key: "p" }),
              ],
            ),
            h("input", {
              type: "search",
              value: query,
              placeholder: t("search"),
              "aria-label": t("search"),
              onChange: function (event) {
                setQuery(event.currentTarget.value);
              },
              key: "input",
            }),
          ],
        ),
        archivedCount > 0
          ? confirmAll
            ? h("div", { className: "dasm_actions", key: "confirmAll" }, [
                h("span", { className: "dasm_hint", key: "hint" }, t("purgeAllHint")),
                h(
                  "button",
                  {
                    type: "button",
                    className: "dasm_btn dasm_btnSolidDanger",
                    disabled: pending !== null,
                    onClick: runPurgeAll,
                    key: "go",
                  },
                  t("purgeAllConfirmAction", { n: archivedCount }),
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "dasm_btn",
                    disabled: pending !== null,
                    onClick: function () {
                      setConfirmAll(false);
                    },
                    key: "cancel",
                  },
                  t("cancel"),
                ),
              ])
            : h(
                "button",
                {
                  type: "button",
                  className: "dasm_btn dasm_btnDanger",
                  disabled: pending !== null,
                  onClick: function () {
                    setNotice(null);
                    setConfirmAll(true);
                  },
                  key: "purgeAll",
                },
                t("purgeAll", { n: archivedCount }),
              )
          : null,
      ]);

      var body = [];
      if (archivedCount === 0) body.push(h("p", { className: "dasm_status", key: "empty" }, t("empty")));
      if (archivedCount > 0 && rows.length === 0) {
        body.push(h("p", { className: "dasm_status", key: "unavailable" }, t("unavailable")));
      }
      if (rows.length > 0 && visible.length === 0) {
        body.push(h("p", { className: "dasm_status", key: "emptySearch" }, t("emptySearch")));
      }
      if (visible.length > 0) {
        body.push(
          h(
            "ul",
            { className: "dasm_list", key: "list" },
            visible.map(function (row) {
              var confirming = confirmId === row.id;
              var busy = pending === row.id;
              var annotation = sizeLabel(row.id);
              var actions = [];
              if (confirming) {
                actions.push(h("span", { className: "dasm_hint", key: "hint" }, t("deleteHint")));
                actions.push(
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dasm_btn dasm_btnSolidDanger",
                      disabled: busy,
                      "aria-label": t("deleteNamed", { title: row.title }),
                      onClick: function () {
                        runPurge(row);
                      },
                      key: "confirm",
                    },
                    t("deleteConfirmAction"),
                  ),
                );
                actions.push(
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dasm_btn",
                      disabled: busy,
                      onClick: function () {
                        setConfirmId(null);
                      },
                      key: "cancel",
                    },
                    t("cancel"),
                  ),
                );
              } else {
                actions.push(
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dasm_btn",
                      disabled: pending !== null,
                      "aria-label": t("unarchiveNamed", { title: row.title }),
                      onClick: function () {
                        unarchive(row.id).catch(function (reason) {
                          console.warn("session unarchive rejected:", reason);
                        });
                      },
                      key: "unarchive",
                    },
                    t("unarchive"),
                  ),
                );
                actions.push(
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dasm_btn dasm_btnDanger",
                      disabled: pending !== null,
                      "aria-label": t("deleteNamed", { title: row.title }),
                      onClick: function () {
                        setNotice(null);
                        setConfirmAll(false);
                        setConfirmId(row.id);
                      },
                      key: "delete",
                    },
                    t("delete"),
                  ),
                );
              }
              return h("li", { className: "dasm_row", key: row.id }, [
                h("span", { className: "dasm_identity", key: "identity" }, [
                  h("span", { className: "dasm_title", key: "title" }, row.title),
                  h(
                    "span",
                    { className: "dasm_meta", key: "meta" },
                    [row.workspace, timeLabel(row.updatedAt, now, t), annotation]
                      .filter(function (part) {
                        return typeof part === "string" && part.length > 0;
                      })
                      .join(" · "),
                  ),
                ]),
                h("div", { className: "dasm_actions", key: "actions" }, actions),
              ]);
            }),
          ),
        );
      }

      var children = [head];
      if (notice !== null) {
        children.push(
          h("p", { className: notice.kind === "error" ? "dasm_noticeError" : "dasm_notice", key: "notice" }, notice.text),
        );
      }
      for (var i = 0; i < body.length; i += 1) children.push(body[i]);
      return h("div", { className: "dasm_section" }, children);
    }

    /** Dictionary namespace owned by this plugin. */
    var NS = "dsh-archived-sessions";

    /** Simplified Chinese dictionary and key source of truth. */
    var zh = {
      nav: "已归档会话",
      search: "搜索已归档会话",
      loading: "正在读取会话…",
      empty: "暂无已归档会话。",
      unavailable: "这里没有可恢复的已归档会话。",
      emptySearch: "没有匹配的会话。",
      unarchive: "取消归档",
      unarchiveNamed: "取消归档 {title}",
      delete: "彻底删除",
      deleteNamed: "彻底删除 {title}",
      deleteHint: "删除后不可恢复",
      deleteConfirmAction: "确认删除",
      cancel: "取消",
      purgeAll: "清空全部（{n}）",
      purgeAllHint: "将永久删除全部已归档会话",
      purgeAllConfirmAction: "确认清空 {n} 个",
      deletedOne: "已彻底删除「{title}」，释放 {size}",
      deletedAll: "已彻底删除 {n} 个会话，释放 {size}",
      deletedPartial: "已删除 {ok} 个，{failed} 个失败",
      indexOnly: "仅索引残留",
      logSize: "日志 {size}",
      ungrouped: "未分组",
      "error.invalid-session-id": "会话 ID 无效。",
      "error.not-archived": "该会话已不在归档列表中。",
      "error.session-running": "会话正在运行中，未删除。",
      "error.no-registry": "工作区注册表不可用。",
      "error.forbidden": "请求被拒绝。",
      "error.generic": "操作失败，请查看 DSH 日志。",
      "time.now": "刚刚",
      "time.minutes": "{n}分钟",
      "time.hours": "{n}小时",
      "time.days": "{n}天",
      "time.months": "{n}个月",
      "time.years": "{n}年",
    };

    /** English dictionary checked against the Chinese key set. */
    var en = {
      nav: "Archived sessions",
      search: "Search archived sessions",
      loading: "Reading sessions…",
      empty: "No archived sessions.",
      unavailable: "No archived session here can be restored.",
      emptySearch: "No matching sessions.",
      unarchive: "Unarchive",
      unarchiveNamed: "Unarchive {title}",
      delete: "Delete forever",
      deleteNamed: "Delete {title} forever",
      deleteHint: "Cannot be undone",
      deleteConfirmAction: "Delete",
      cancel: "Cancel",
      purgeAll: "Clear all ({n})",
      purgeAllHint: "Permanently deletes every archived session",
      purgeAllConfirmAction: "Clear {n}",
      deletedOne: "Deleted “{title}”, freed {size}",
      deletedAll: "Deleted {n} sessions, freed {size}",
      deletedPartial: "Deleted {ok}, {failed} failed",
      indexOnly: "index only",
      logSize: "log {size}",
      ungrouped: "Ungrouped",
      "error.invalid-session-id": "Invalid session id.",
      "error.not-archived": "That session is no longer archived.",
      "error.session-running": "Session is running; not deleted.",
      "error.no-registry": "Workspace registry unavailable.",
      "error.forbidden": "Request rejected.",
      "error.generic": "Failed — check the DSH log.",
      "time.now": "now",
      "time.minutes": "{n}min",
      "time.hours": "{n}h",
      "time.days": "{n}d",
      "time.months": "{n}mo",
      "time.years": "{n}y",
    };

    /** Services required by the Settings registration and the archive write. */
    var inject = ["slots", "locale", "uiWorkspace"];

    /** Contribute the archived-session page, shadowing the shipped entry. */
    function apply(ctx) {
      ctx.effect(
        function () {
          return ctx.locale.register(NS, { zh: zh, en: en });
        },
        "dsh-archived-sessions-manager: dictionaries",
      );
      var t = ctx.locale.bind(NS);
      var injected = function () {
        return {
          unarchive: function (sessionId) {
            return ctx.uiWorkspace.unarchiveSession(sessionId);
          },
        };
      };
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register(
          {
            name: "settings.section",
            id: "archived-sessions",
            // Lowest priority wins the cell: this shadows the shipped
            // client-ui-settings-unarchive-sessions page without disabling it.
            priority: -1,
            order: 25,
            label: function () {
              return t("nav");
            },
            locale: NS,
            inject: injected,
          },
          ArchivedSessionsManagerSection,
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
