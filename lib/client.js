// dsh-archived browser half.
//
// Built in the DSH lazy-CJS bundle format: executing this file only registers a
// factory; the module body (styles, locale, slot registration) runs when the
// browser materializes the module.
//
// It contributes the Settings → Archived page. On DSH 0.2.0-rc.2 the shipped
// archived-sessions settings page no longer exists, so this is an ordinary
// list-slot contribution with no shadowing to do; the id and `priority: -1`
// are kept so that on an older host which still ships the page, the lowest
// priority still wins the cell.
//
// Rows come from the host route, not from the browser's session store: the
// archive set can name an id whose summary this client has never loaded (an
// "index-only" leftover), and a page that silently drops those rows is exactly
// the page that made them impossible to get rid of.

window.__ModuleLoader__.load({
  id: "dsh-archived",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useMemo = React.useMemo;

    var BASE = "/api/dsh-archived";
    var STATE_PATH = BASE + "/state";
    var DELETE_PATH = BASE + "/delete";
    var DELETE_ALL_PATH = BASE + "/delete-all";
    var RESTORE_PATH = BASE + "/restore";
    var EMPTY_PATH = BASE + "/empty-quarantine";
    var REVEAL_PATH = BASE + "/reveal";
    var HEADER = "x-dsh-archived";
    var API_VERSION = 2;
    var STYLE_ID = "dsh-archived-style";

    var CSS = [
      ".dasm_section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}",
      ".dasm_title{font-size:15px;line-height:22px;font-weight:600;margin:0}",
      ".dasm_head{align-items:center;gap:8px;display:flex}",
      ".dasm_search{flex:1;color:var(--dsw-alias-label-tertiary);align-items:center;display:flex;position:relative}",
      ".dasm_search>svg{pointer-events:none;position:absolute;left:10px}",
      ".dasm_search input{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);width:100%;height:32px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;padding:0 12px 0 34px}",
      ".dasm_tools{align-items:center;gap:6px;flex-wrap:wrap;display:flex}",
      ".dasm_status{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}",
      ".dasm_notice{color:var(--dsw-alias-state-success-primary,#36d67a);margin:0;font-size:12px;line-height:18px;word-break:break-word}",
      ".dasm_noticeError{color:var(--dsw-alias-state-error-primary,#ff6464);margin:0;font-size:12px;line-height:18px;word-break:break-word}",
      ".dasm_group{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:6px 0 0}",
      ".dasm_list{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}",
      ".dasm_row{border-radius:8px;align-items:flex-start;gap:10px;padding:8px 10px;display:flex}",
      ".dasm_row:hover{background:var(--dsw-alias-bg-layer-1)}",
      ".dasm_check{margin-top:3px;flex:0 0 auto}",
      ".dasm_identity{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}",
      ".dasm_title{text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px;overflow:hidden}",
      ".dasm_meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
      ".dasm_detail{color:var(--dsw-alias-label-secondary,#b8bbc2);font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word}",
      ".dasm_actions{align-items:center;gap:6px;flex:0 0 auto;display:flex;flex-wrap:wrap;justify-content:flex-end}",
      ".dasm_hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
      ".dasm_btn{display:inline-flex;align-items:center;justify-content:center;min-height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#4b4d52);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#b8bbc2);font:inherit;font-size:13px;line-height:18px;white-space:nowrap;cursor:pointer}",
      ".dasm_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#3a3b3f);color:var(--dsw-alias-label-primary,#fff)}",
      ".dasm_btn:disabled{cursor:not-allowed;opacity:.55}",
      ".dasm_btnDanger{border-color:var(--dsw-alias-state-error-primary,#ff6464);color:var(--dsw-alias-state-error-primary,#ff6464)}",
      ".dasm_btnDanger:hover:not(:disabled){background:var(--dsw-alias-state-error-primary,#ff6464);color:#fff}",
      ".dasm_btnSolidDanger{border-color:var(--dsw-alias-state-error-primary,#ff6464);background:var(--dsw-alias-state-error-primary,#ff6464);color:#fff}",
      ".dasm_btnSolidDanger:hover:not(:disabled){background:var(--dsw-alias-state-error-primary-hover,#e04f4f);color:#fff}",
      ".dasm_quarantine{border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;align-items:center;gap:8px;padding:8px 10px;display:flex;flex-wrap:wrap}",
      ".dasm_quarantineText{color:var(--dsw-alias-label-secondary,#b8bbc2);font-size:12px;line-height:18px;flex:1;min-width:180px}",
      ".dasm_sweep{border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px;margin:2px 0 12px;display:flex;flex-direction:column;gap:8px}",
      ".dasm_sweepHead{align-items:flex-start;gap:8px;display:flex;flex-wrap:wrap;justify-content:space-between}",
      ".dasm_sweepTitle{flex-direction:column;display:flex;gap:2px;min-width:200px}",
      ".dasm_sweepName{font-size:13px;line-height:20px;font-weight:600}",
      ".dasm_sweepHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
      ".dasm_sweepTools{align-items:center;gap:6px;display:flex;flex-wrap:wrap}",
      ".dasm_select{min-height:28px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:inherit;font:inherit}",
      ".dasm_sweepList{flex-direction:column;display:flex;max-height:260px;overflow:auto}",
      ".dasm_sweepRow{align-items:center;gap:8px;padding:4px 2px;display:flex}",
      ".dasm_sweepRowLocked{opacity:.55}",
      ".dasm_sweepLabel{flex:1;min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;font-size:13px;line-height:20px}",
      ".dasm_sweepReason,.dasm_sweepMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;flex:0 0 auto}",
      ".dasm_sweepAuto{align-items:center;gap:6px;display:flex;flex-wrap:wrap}",
    ].join("");

    if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-archived";
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
      if (typeof updatedAt !== "number") return "";
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

    /** Last path segment of a cwd, used as the group heading. */
    function baseName(path) {
      if (typeof path !== "string" || path.length === 0) return "";
      var parts = path.split(/[\\/]/).filter(function (part) {
        return part.length > 0;
      });
      return parts.length > 0 ? parts[parts.length - 1] : path;
    }

    function matches(row, normalizedQuery) {
      if (normalizedQuery.length === 0) return true;
      return (
        row.title.toLowerCase().indexOf(normalizedQuery) !== -1 ||
        row.id.toLowerCase().indexOf(normalizedQuery) !== -1 ||
        row.group.toLowerCase().indexOf(normalizedQuery) !== -1
      );
    }

    /**
     * Archived-sessions Settings page with permanent deletion.
     *
     * @param props - composed slot props: localizer, the injected unarchive
     * action, and the framework's session/workspace selector seats.
     */
    function ArchivedSessionsSection(props) {
      var t = props.t;
      var unarchive = props.unarchive;
      var useSessions = props.useSessions;
      var useWorkspaces = props.useWorkspaces;

      // The seats are optional: on a host that does not compose them the page
      // still renders, because the rows come from the host route.
      var summaries = useSessions
        ? useSessions(function (state) {
            return state.byId;
          })
        : {};
      var archivedSessionIds = useWorkspaces
        ? useWorkspaces(function (state) {
            return state.archivedSessionIds;
          })
        : [];

      var [snapshot, setSnapshot] = useState(null);
      var [failed, setFailed] = useState(null);
      var [query, setQuery] = useState("");
      var [selected, setSelected] = useState({});
      var [expanded, setExpanded] = useState({});
      var [confirm, setConfirm] = useState(null);
      var [confirmAll, setConfirmAll] = useState(null);
      var [busy, setBusy] = useState(null);
      var [notice, setNotice] = useState(null);
      var [sweep, setSweep] = useState(null);
      var [sweepDays, setSweepDays] = useState(14);
      var [sweepSelected, setSweepSelected] = useState({});
      var [sweepBusy, setSweepBusy] = useState(false);
      var [sweepNotice, setSweepNotice] = useState(null);
      var [sweepConfirm, setSweepConfirm] = useState(false);

      var idsKey = archivedSessionIds ? archivedSessionIds.join(",") : "";

      function reload() {
        return request(STATE_PATH)
          .then(function (payload) {
            if (!payload || payload.ok !== true) {
              throw new Error(payload && payload.error ? String(payload.error) : "state");
            }
            setSnapshot(payload);
            setFailed(null);
            return payload;
          })
          .catch(function (error) {
            // Say why: a bare "cannot read host state" is undebuggable from the
            // outside, which is exactly how the Desktop-app failure hid.
            setFailed(String(error && error.message ? error.message : error));
            setSnapshot(null);
          });
      }

      useEffect(
        function () {
          reload();
        },
        [idsKey],
      );

      var now = Date.now();
      var normalized = query.trim().toLowerCase();

      var rows = useMemo(
        function () {
          var built = [];
          var items = snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
          for (var i = 0; i < items.length; i += 1) {
            var item = items[i];
            var summary = summaries ? summaries[item.id] : undefined;
            var group = item.cwd ? baseName(item.cwd) : t("ungrouped");
            built.push({
              id: item.id,
              title: (summary && summary.displayTitle) || item.title || item.id,
              group: group,
              updatedAt: summary ? summary.updatedAt : item.createdAt,
              item: item,
            });
          }
          built.sort(function (a, b) {
            return (b.updatedAt || 0) - (a.updatedAt || 0);
          });
          return built;
        },
        [snapshot, summaries, t],
      );

      var visible = rows.filter(function (row) {
        return matches(row, normalized);
      });

      var groups = useMemo(
        function () {
          var order = [];
          var map = {};
          for (var i = 0; i < visible.length; i += 1) {
            var row = visible[i];
            if (map[row.group] === undefined) {
              map[row.group] = [];
              order.push(row.group);
            }
            map[row.group].push(row);
          }
          return order.map(function (name) {
            return { name: name, rows: map[name] };
          });
        },
        [visible],
      );

      var archivedCount = rows.length;
      var quarantine = (snapshot && snapshot.quarantine) || { count: 0, bytes: 0, items: [] };
      var selectedIds = Object.keys(selected).filter(function (id) {
        return selected[id] === true;
      });

      function describeError(code) {
        var key = "error." + String(code);
        var text = t(key);
        return text === key ? t("error.generic") : text;
      }

      function run(path, body, onDone) {
        setNotice(null);
        return request(path, { method: "POST", body: body })
          .then(function (payload) {
            if (!payload || payload.ok === false) {
              throw new Error(payload && payload.error === "busy" ? t("error.busy") : describeError(payload && payload.error));
            }
            setConfirm(null);
            setConfirmAll(null);
            if (onDone) onDone(payload);
            return payload;
          })
          .catch(function (error) {
            setNotice({ kind: "error", text: String(error && error.message ? error.message : error) });
          })
          .then(function () {
            setBusy(null);
            return reload();
          });
      }

      function deleteRow(row, mode) {
        setBusy(row.id);
        run(DELETE_PATH, { sessionId: row.id, mode: mode }, function () {
          setNotice({
            kind: "ok",
            text:
              mode === "forever"
                ? t("deletedForeverOne", { title: row.title })
                : t("deletedOne", { title: row.title, size: formatBytes(row.item.artifact.bytes) }),
          });
        });
      }

      function deleteSelected(mode) {
        var ids = selectedIds;
        if (ids.length === 0) return;
        setBusy("__selected__");
        run(DELETE_ALL_PATH, { ids: ids, mode: mode }, function (payload) {
          var ok = payload.results.filter(function (result) {
            return result.ok === true;
          }).length;
          var bytes = 0;
          for (var i = 0; i < payload.results.length; i += 1) {
            if (payload.results[i].ok && payload.results[i].removed) bytes += payload.results[i].removed.bytes || 0;
          }
          setSelected({});
          setNotice(
            ok === payload.results.length
              ? { kind: "ok", text: t("deletedMany", { n: ok, size: formatBytes(bytes) }) }
              : { kind: "error", text: t("deletedPartial", { ok: ok, failed: payload.results.length - ok }) },
          );
        });
      }

      function deleteAll(mode) {
        var ids = rows.map(function (row) {
          return row.id;
        });
        setBusy("__all__");
        run(DELETE_ALL_PATH, { ids: ids, mode: mode }, function (payload) {
          var ok = payload.results.filter(function (result) {
            return result.ok === true;
          }).length;
          var bytes = 0;
          for (var i = 0; i < payload.results.length; i += 1) {
            if (payload.results[i].ok && payload.results[i].removed) bytes += payload.results[i].removed.bytes || 0;
          }
          setNotice(
            ok === payload.results.length
              ? { kind: "ok", text: t("deletedMany", { n: ok, size: formatBytes(bytes) }) }
              : { kind: "error", text: t("deletedPartial", { ok: ok, failed: payload.results.length - ok }) },
          );
        });
      }

      function restoreRow(entry) {
        setBusy(entry.id);
        run(RESTORE_PATH, { sessionId: entry.id }, function () {
          setNotice({ kind: "ok", text: t("restoredOne", { title: entry.title || entry.id }) });
        });
      }

      function emptyQuarantine() {
        setBusy("__quarantine__");
        run(EMPTY_PATH, {}, function (payload) {
          setNotice({ kind: "ok", text: t("purgedQuarantine", { n: payload.purged, size: formatBytes(payload.bytes) }) });
        });
      }

      function toggleSelected(id) {
        setSelected(function (previous) {
          var next = Object.assign({}, previous);
          if (next[id] === true) delete next[id];
          else next[id] = true;
          return next;
        });
      }

      function toggleExpanded(id) {
        setExpanded(function (previous) {
          var next = Object.assign({}, previous);
          next[id] = next[id] !== true;
          return next;
        });
      }

      // --- stale-session sweep -------------------------------------------------
      // Read-only scan, then the same recycle bin the archived rows use. Every
      // destructive path is a POST the host re-validates; the panel never
      // decides on its own what may be removed.

      function scanSweep(days) {
        setSweepBusy(true);
        setSweepNotice(null);
        request(BASE + "/sweep/scan", { method: "POST", body: { days: days } })
          .then(function (payload) {
            if (!payload || payload.ok !== true) throw new Error(describeError(payload && payload.error));
            setSweep(payload);
            setSweepSelected({});
            setSweepDays(payload.days);
          })
          .catch(function (error) {
            setSweepNotice({ kind: "error", text: (error && error.message) || t("error.generic") });
          })
          .then(function () {
            setSweepBusy(false);
          });
      }

      function toggleSweep(id) {
        setSweepSelected(function (current) {
          var next = Object.assign({}, current);
          if (next[id] === true) delete next[id];
          else next[id] = true;
          return next;
        });
      }

      function deleteSweepSelection() {
        var ids = Object.keys(sweepSelected);
        if (ids.length === 0) return;
        setSweepBusy(true);
        setSweepNotice(null);
        request(BASE + "/sweep/delete", { method: "POST", body: { ids: ids, mode: "quarantine" } })
          .then(function (payload) {
            var results = (payload && payload.results) || [];
            var done = results.filter(function (row) { return row.ok === true; });
            var lost = results.filter(function (row) { return row.ok !== true; });
            var bytes = 0;
            for (var i = 0; i < done.length; i += 1) {
              bytes += (done[i].removed && done[i].removed.bytes) || 0;
            }
            setSweepNotice(lost.length === 0
              ? { kind: "ok", text: t("sweepDeleted", { n: done.length, size: formatBytes(bytes) }) }
              : { kind: "error", text: t("sweepDeletedPartial", { ok: done.length, failed: lost.length }) });
            setSweepConfirm(false);
            setSweepSelected({});
            scanSweep(sweepDays);
            reload();
          })
          .catch(function (error) {
            setSweepNotice({ kind: "error", text: (error && error.message) || t("error.generic") });
            setSweepBusy(false);
          });
      }

      function toggleAutoSweep(enabled) {
        setSweepBusy(true);
        request(BASE + "/sweep/settings", { method: "POST", body: { enabled: enabled, days: sweepDays } })
          .then(function (payload) {
            var saved = payload && payload.settings ? payload.settings : null;
            if (saved !== null) {
              setSweep(function (current) {
                return current === null ? current : Object.assign({}, current, { settings: saved });
              });
            }
            setSweepNotice({ kind: "ok", text: enabled ? t("sweepAutoOn", { n: sweepDays }) : t("sweepAutoOff") });
          })
          .catch(function (error) {
            setSweepNotice({ kind: "error", text: (error && error.message) || t("error.generic") });
          })
          .then(function () {
            setSweepBusy(false);
          });
      }

      function sweepSection() {
        var settings = sweep && sweep.settings ? sweep.settings : { enabled: false, lastRunAt: null, lastRun: null };
        var candidates = sweep && Array.isArray(sweep.candidates) ? sweep.candidates : [];
        var chosen = Object.keys(sweepSelected).length;
        var eligible = candidates.filter(function (row) { return row.eligible === true; }).length;
        var parts = [
          h("div", { className: "dasm_sweepHead", key: "sweepHead" }, [
            h("div", { className: "dasm_sweepTitle", key: "sweepTitle" }, [
              h("span", { className: "dasm_sweepName", key: "name" }, t("sweepNav")),
              h("span", { className: "dasm_sweepHint", key: "hint" }, t("sweepHint", { n: sweepDays })),
            ]),
            h("div", { className: "dasm_sweepTools", key: "sweepTools" }, [
              h("select", {
                className: "dasm_select",
                value: String(sweepDays),
                disabled: sweepBusy,
                "aria-label": t("sweepDaysLabel"),
                onChange: function (event) { setSweepDays(Number(event.currentTarget.value)); },
                key: "days",
              }, [7, 14, 30].map(function (days) {
                return h("option", { value: String(days), key: "day" + days }, t("sweepDays", { n: days }));
              })),
              h("button", {
                type: "button",
                className: "dasm_btn",
                disabled: sweepBusy,
                onClick: function () { scanSweep(sweepDays); },
                key: "scan",
              }, sweepBusy ? t("sweepScanning") : t("sweepScan")),
            ]),
          ]),
        ];
        if (sweepNotice !== null) {
          parts.push(h("p", { className: "dasm_status", key: "sweepNotice" }, sweepNotice.text));
        }
        if (sweep !== null) {
          parts.push(h("p", { className: "dasm_status", key: "sweepSummary" }, candidates.length === 0
            ? t("sweepNone", { n: sweepDays })
            : t("sweepFound", { n: candidates.length, eligible: eligible, size: formatBytes(sweep.totals ? sweep.totals.bytes : 0) })));
        }
        if (chosen > 0 && !sweepConfirm) {
          parts.push(h("div", { className: "dasm_sweepTools", key: "sweepActions" }, [
            h("button", {
              type: "button",
              className: "dasm_btn dasm_btnDanger",
              disabled: sweepBusy,
              onClick: function () { setSweepConfirm(true); },
              key: "sweepDelete",
            }, t("sweepDelete", { n: chosen })),
          ]));
        }
        if (sweepConfirm) {
          parts.push(h("div", { className: "dasm_sweepTools", key: "sweepConfirm" }, [
            h("span", { className: "dasm_sweepHint", key: "ask" }, t("sweepConfirmAsk", { n: chosen })),
            h("button", {
              type: "button",
              className: "dasm_btn dasm_btnDanger",
              disabled: sweepBusy,
              onClick: deleteSweepSelection,
              key: "yes",
            }, t("sweepConfirmYes")),
            h("button", {
              type: "button",
              className: "dasm_btn",
              disabled: sweepBusy,
              onClick: function () { setSweepConfirm(false); },
              key: "no",
            }, t("cancel")),
          ]));
        }
        var listRows = candidates.map(function (row) {
          var label = row.title || row.id;
          return h("div", { className: "dasm_sweepRow" + (row.eligible === true ? "" : " dasm_sweepRowLocked"), key: row.id }, [
            h("input", {
              type: "checkbox",
              className: "dasm_check",
              checked: sweepSelected[row.id] === true,
              disabled: row.eligible !== true || sweepBusy,
              "aria-label": t("sweepSelectNamed", { title: label }),
              onChange: function () { toggleSweep(row.id); },
              key: "check",
            }),
            h("span", { className: "dasm_sweepLabel", key: "label", title: row.id }, label),
            h("span", { className: "dasm_sweepReason", key: "reason" }, row.eligible === true ? t("sweepReason." + row.reason) : t("sweepLocked")),
            h("span", { className: "dasm_sweepMeta", key: "meta" }, t("sweepMeta", { n: row.ageDays }) + " · " + formatBytes(row.bytes)),
          ]);
        });
        if (listRows.length > 0) {
          parts.push(h("div", { className: "dasm_sweepList", key: "sweepList" }, listRows));
        }
        parts.push(h("label", { className: "dasm_sweepAuto", key: "sweepAuto" }, [
          h("input", {
            type: "checkbox",
            checked: settings.enabled === true,
            disabled: sweepBusy,
            onChange: function (event) { toggleAutoSweep(event.currentTarget.checked); },
            key: "auto",
          }),
          h("span", { className: "dasm_sweepHint", key: "autoLabel" }, t("sweepAutoLabel", { n: sweepDays })),
          h("span", { className: "dasm_sweepHint", key: "autoLast" }, settings.lastRunAt
            ? t("sweepAutoLast", { time: timeLabel(settings.lastRunAt, now, t), n: (settings.lastRun && settings.lastRun.parked) || 0 })
            : t("sweepAutoNever")),
        ]));
        return h("div", { className: "dasm_sweep", key: "sweep" }, parts);
      }

      if (failed !== null) {
        return h("div", { className: "dasm_section" }, [
          h("h2", { className: "dasm_title", key: "title" }, t("nav")),
          h("p", { className: "dasm_status", key: "failed" }, t("hostUnavailable", { reason: failed })),
        ]);
      }

      if (snapshot === null) {
        return h("div", { className: "dasm_section" }, h("p", { className: "dasm_status" }, t("loading")));
      }

      if (snapshot.apiVersion !== API_VERSION) {
        return h("div", { className: "dasm_section" }, [
          h("h2", { className: "dasm_title", key: "title" }, t("nav")),
          h("p", { className: "dasm_status", key: "mismatch" }, t("apiMismatch")),
        ]);
      }

      var children = [h("h2", { className: "dasm_title", key: "title" }, t("nav"))];
      children.push(sweepSection());

      var head = h("div", { className: "dasm_head", key: "head" }, [
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
      ]);
      children.push(head);

      var tools = [];
      if (archivedCount > 0) {
        tools.push(
          h(
            "button",
            {
              type: "button",
              className: "dasm_btn",
              disabled: busy !== null,
              onClick: function () {
                var next = {};
                if (selectedIds.length !== archivedCount) {
                  for (var i = 0; i < rows.length; i += 1) next[rows[i].id] = true;
                }
                setSelected(next);
              },
              key: "selectAll",
            },
            selectedIds.length === archivedCount ? t("clearSelection") : t("selectAll"),
          ),
        );
      }
      if (selectedIds.length > 0) {
        tools.push(
          h(
            "button",
            {
              type: "button",
              className: "dasm_btn dasm_btnDanger",
              disabled: busy !== null,
              onClick: function () {
                deleteSelected("quarantine");
              },
              key: "deleteSelected",
            },
            t("deleteSelected", { n: selectedIds.length }),
          ),
        );
      }
      if (archivedCount > 0) {
        tools.push(
          h(
            "button",
            {
              type: "button",
              className: "dasm_btn dasm_btnDanger",
              disabled: busy !== null,
              onClick: function () {
                setNotice(null);
                setConfirmAll("quarantine");
              },
              key: "deleteAll",
            },
            t("deleteAll", { n: archivedCount }),
          ),
        );
      }
      if (tools.length > 0) children.push(h("div", { className: "dasm_tools", key: "tools" }, tools));

      if (confirmAll !== null) {
        children.push(
          h("div", { className: "dasm_quarantine", key: "confirmAll" }, [
            h("span", { className: "dasm_quarantineText", key: "text" }, t("deleteAllHint", { n: archivedCount })),
            h(
              "button",
              {
                type: "button",
                className: "dasm_btn dasm_btnSolidDanger",
                disabled: busy !== null,
                onClick: function () {
                  deleteAll(confirmAll);
                },
                key: "go",
              },
              t("deleteConfirmAction"),
            ),
            h(
              "button",
              {
                type: "button",
                className: "dasm_btn",
                disabled: busy !== null,
                onClick: function () {
                  setConfirmAll(null);
                },
                key: "cancel",
              },
              t("cancel"),
            ),
          ]),
        );
      }

      if (quarantine.count > 0) {
        children.push(
          h("div", { className: "dasm_quarantine", key: "quarantine" }, [
            h(
              "span",
              { className: "dasm_quarantineText", key: "text" },
              t("quarantineSummary", { n: quarantine.count, size: formatBytes(quarantine.bytes) }),
            ),
            h(
              "button",
              {
                type: "button",
                className: "dasm_btn",
                disabled: busy !== null,
                onClick: function () {
                  restoreRow(quarantine.items[0]);
                },
                key: "restoreLatest",
              },
              t("restoreLatest"),
            ),
            h(
              "button",
              {
                type: "button",
                className: "dasm_btn dasm_btnDanger",
                disabled: busy !== null,
                onClick: emptyQuarantine,
                key: "empty",
              },
              t("emptyQuarantine"),
            ),
          ]),
        );
      }

      if (notice !== null) {
        children.push(
          h("p", { className: notice.kind === "error" ? "dasm_noticeError" : "dasm_notice", key: "notice" }, notice.text),
        );
      }

      if (archivedCount === 0) {
        children.push(h("p", { className: "dasm_status", key: "empty" }, t("empty")));
      } else if (visible.length === 0) {
        children.push(h("p", { className: "dasm_status", key: "emptySearch" }, t("emptySearch")));
      }

      for (var g = 0; g < groups.length; g += 1) {
        var group = groups[g];
        children.push(h("p", { className: "dasm_group", key: "group-" + group.name }, group.name));
        children.push(
          h(
            "ul",
            { className: "dasm_list", key: "list-" + group.name },
            group.rows.map(function (row) {
              var item = row.item;
              var confirming = confirm !== null && confirm.id === row.id;
              var isBusy = busy === row.id;
              var meta = [row.group, timeLabel(row.updatedAt, now, t)];
              if (item.artifact.present) meta.push(t("logSize", { size: formatBytes(item.artifact.bytes) }));
              else if (item.cache) meta.push(t("cacheOnly"));
              else meta.push(t("indexOnly"));
              if (item.running) meta.push(t("running"));

              var actions = [];
              if (confirming) {
                actions.push(h("span", { className: "dasm_hint", key: "hint" }, t("deleteHint")));
                actions.push(
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dasm_btn dasm_btnSolidDanger",
                      disabled: isBusy,
                      "aria-label": t("deleteNamed", { title: row.title }),
                      onClick: function () {
                        deleteRow(row, "quarantine");
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
                      className: "dasm_btn dasm_btnDanger",
                      disabled: isBusy,
                      onClick: function () {
                        deleteRow(row, "forever");
                      },
                      key: "forever",
                    },
                    t("deleteForever"),
                  ),
                );
                actions.push(
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dasm_btn",
                      disabled: isBusy,
                      onClick: function () {
                        setConfirm(null);
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
                      disabled: busy !== null,
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
                      className: "dasm_btn",
                      disabled: busy !== null,
                      "aria-label": t("revealNamed", { title: row.title }),
                      onClick: function () {
                        request(REVEAL_PATH, { method: "POST", body: { sessionId: row.id } }).catch(function () {});
                      },
                      key: "reveal",
                    },
                    t("reveal"),
                  ),
                );
                actions.push(
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dasm_btn",
                      disabled: busy !== null,
                      "aria-label": t("detailsNamed", { title: row.title }),
                      onClick: function () {
                        toggleExpanded(row.id);
                      },
                      key: "details",
                    },
                    t("details"),
                  ),
                );
                actions.push(
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dasm_btn dasm_btnDanger",
                      disabled: busy !== null,
                      "aria-label": t("deleteNamed", { title: row.title }),
                      onClick: function () {
                        setNotice(null);
                        setConfirmAll(null);
                        setConfirm({ id: row.id });
                      },
                      key: "delete",
                    },
                    t("delete"),
                  ),
                );
              }

              var detail = null;
              if (expanded[row.id] === true) {
                var lines = [
                  t("detailId", { id: row.id }),
                  t("detailCreated", { time: timeLabel(item.createdAt, now, t) }),
                  item.artifact.present
                    ? t("detailPath", { path: item.artifact.path })
                    : t("detailNoArtifact"),
                  t("detailCache", { state: item.cache ? t("yes") : t("no") }),
                ];
                if (item.ancestors.length > 0) lines.push(t("detailParent", { ids: item.ancestors.join(", ") }));
                if (item.children.length > 0) lines.push(t("detailChildren", { n: item.children.length }));
                if (item.legacyRow) lines.push(t("detailLegacy"));
                detail = h("span", { className: "dasm_detail", key: "detail" }, lines.join("\n"));
              }

              return h("li", { className: "dasm_row", key: row.id }, [
                h("input", {
                  type: "checkbox",
                  className: "dasm_check",
                  checked: selected[row.id] === true,
                  disabled: busy !== null,
                  "aria-label": t("selectNamed", { title: row.title }),
                  onChange: function () {
                    toggleSelected(row.id);
                  },
                  key: "check",
                }),
                h("span", { className: "dasm_identity", key: "identity" }, [
                  h("span", { className: "dasm_title", key: "title" }, row.title),
                  h(
                    "span",
                    { className: "dasm_meta", key: "meta" },
                    meta
                      .filter(function (part) {
                        return typeof part === "string" && part.length > 0;
                      })
                      .join(" · "),
                  ),
                  detail,
                ]),
                h("div", { className: "dasm_actions", key: "actions" }, actions),
              ]);
            }),
          ),
        );
      }

      return h("div", { className: "dasm_section" }, children);
    }

    /** Dictionary namespace owned by this plugin. */
    var NS = "dsh-archived";

    /** Simplified Chinese dictionary and key source of truth. */
    var zh = {
      nav: "已归档",
      sweepNav: "清理陈旧会话",
      sweepHint: "扫出 {n} 天没动过、或一次都没说过话的未归档会话；删掉先进回收站，30 天内可恢复。",
      sweepDaysLabel: "陈旧标准",
      sweepDays: "{n} 天",
      sweepScan: "扫描",
      sweepScanning: "扫描中…",
      sweepNone: "没有符合 {n} 天标准、也不是空的未归档会话。",
      sweepFound: "{n} 个候选：{eligible} 个可清理，共 {size}。",
      sweepLocked: "受保护",
      sweepMeta: "{n} 天未动",
      "sweepReason.stale": "陈旧",
      "sweepReason.empty": "空会话",
      "sweepReason.stale+empty": "陈旧且空",
      sweepDelete: "移入回收站（{n}）",
      sweepConfirmAsk: "把选中的 {n} 个会话移入回收站？",
      sweepConfirmYes: "确认移入",
      sweepDeleted: "已移入回收站 {n} 个（{size}）。",
      sweepDeletedPartial: "成功 {ok} 个，失败 {failed} 个（失败的多为正在运行或刚动过）。",
      sweepSelectNamed: "选择 {title}",
      sweepAutoLabel: "每周自动把 {n} 天以上的会话移入回收站（只进回收站，30 天内都能恢复）",
      sweepAutoOn: "已开启每周自动清理（{n} 天标准）。",
      sweepAutoOff: "已关闭每周自动清理。",
      sweepAutoLast: "上次自动清理：{time}，移入 {n} 个",
      sweepAutoNever: "还没跑过自动清理",

      search: "搜索已归档会话",
      loading: "正在读取会话…",
      hostUnavailable: "读不到宿主状态（{reason}）：请确认插件已随宿主加载，然后刷新页面。",
      apiMismatch: "插件的前后端版本不一致：请重启 DSH 后再试。",
      empty: "暂无已归档会话。",
      emptySearch: "没有匹配的会话。",
      ungrouped: "未分组",
      unarchive: "取消归档",
      unarchiveNamed: "取消归档 {title}",
      delete: "删除",
      deleteNamed: "删除 {title}",
      deleteForever: "永久删除",
      deleteHint: "删除后可在回收站恢复，永久删除不可恢复",
      deleteConfirmAction: "确认删除",
      cancel: "取消",
      deleteSelected: "删除所选（{n}）",
      deleteAll: "删除全部（{n}）",
      deleteAllHint: "将把全部 {n} 个已归档会话移入回收站",
      selectAll: "全选",
      clearSelection: "取消全选",
      selectNamed: "选择 {title}",
      details: "详情",
      detailsNamed: "查看 {title} 的详情",
      reveal: "打开文件夹",
      revealNamed: "打开 {title} 的文件夹",
      quarantineSummary: "回收站：{n} 个 · {size}，30 天后自动清除",
      restoreLatest: "恢复最近一个",
      emptyQuarantine: "清空回收站",
      deletedOne: "已删除「{title}」，释放 {size}",
      deletedForeverOne: "已永久删除「{title}」",
      deletedMany: "已删除 {n} 个会话，释放 {size}",
      deletedPartial: "已删除 {ok} 个，{failed} 个失败",
      restoredOne: "已恢复「{title}」",
      purgedQuarantine: "已清空回收站，释放 {size}（{n} 个）",
      indexOnly: "仅索引残留",
      cacheOnly: "仅缓存",
      logSize: "日志 {size}",
      running: "运行中",
      yes: "有",
      no: "无",
      detailId: "ID：{id}",
      detailCreated: "创建：{time}",
      detailPath: "位置：{path}",
      detailNoArtifact: "位置：磁盘上已无日志目录",
      detailCache: "投影缓存：{state}",
      detailParent: "父会话：{ids}",
      detailChildren: "子会话：{n} 个在内存中",
      detailLegacy: "该 id 仍留在旧版聚合缓存里（历史遗留，宿主不再写入）",
      "error.invalid-session-id": "会话 ID 无效。",
      "error.not-archived": "该会话已不在归档列表中。",
      "error.session-running": "会话正在运行中，未删除。",
      "error.subagent-running": "它的子会话正在运行，未删除。",
      "error.no-registry": "工作区注册表不可用，已拒绝删除。",
      "error.busy": "该会话正被另一个操作占用，请稍后重试。",
      "error.not-quarantined": "该会话不在回收站里。",
      "error.no-artifact": "磁盘上找不到这个会话的目录。",
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
      nav: "Archived",
      sweepNav: "Clean up stale sessions",
      sweepHint: "Lists unarchived sessions untouched for {n} days, or that never got a message. Removals go to the recycle bin first — recoverable for 30 days.",
      sweepDaysLabel: "Stale after",
      sweepDays: "{n} days",
      sweepScan: "Scan",
      sweepScanning: "Scanning…",
      sweepNone: "No unarchived session is older than {n} days or empty.",
      sweepFound: "{n} candidates: {eligible} removable, {size} total.",
      sweepLocked: "protected",
      sweepMeta: "idle {n} days",
      "sweepReason.stale": "stale",
      "sweepReason.empty": "empty",
      "sweepReason.stale+empty": "stale + empty",
      sweepDelete: "Move to recycle bin ({n})",
      sweepConfirmAsk: "Move the {n} selected sessions to the recycle bin?",
      sweepConfirmYes: "Move them",
      sweepDeleted: "Moved {n} session(s) to the recycle bin ({size}).",
      sweepDeletedPartial: "{ok} moved, {failed} refused (usually running or just touched).",
      sweepSelectNamed: "Select {title}",
      sweepAutoLabel: "Every week, move sessions older than {n} days to the recycle bin (never a permanent delete)",
      sweepAutoOn: "Weekly automatic cleanup is on ({n}-day rule).",
      sweepAutoOff: "Weekly automatic cleanup is off.",
      sweepAutoLast: "Last automatic run: {time}, {n} moved",
      sweepAutoNever: "No automatic run yet",

      search: "Search archived sessions",
      loading: "Reading sessions…",
      hostUnavailable: "Cannot read host state ({reason}) — check that the plugin loaded, then refresh.",
      apiMismatch: "The plugin's two halves disagree on the API version — restart DSH and try again.",
      empty: "No archived sessions.",
      emptySearch: "No matching sessions.",
      ungrouped: "Ungrouped",
      unarchive: "Unarchive",
      unarchiveNamed: "Unarchive {title}",
      delete: "Delete",
      deleteNamed: "Delete {title}",
      deleteForever: "Delete forever",
      deleteHint: "Delete keeps it recoverable; delete forever does not",
      deleteConfirmAction: "Delete",
      cancel: "Cancel",
      deleteSelected: "Delete selected ({n})",
      deleteAll: "Delete all ({n})",
      deleteAllHint: "Moves all {n} archived sessions to the recycle bin",
      selectAll: "Select all",
      clearSelection: "Clear selection",
      selectNamed: "Select {title}",
      details: "Details",
      detailsNamed: "Show details for {title}",
      reveal: "Open folder",
      revealNamed: "Open the folder for {title}",
      quarantineSummary: "Recycle bin: {n} · {size}, cleared automatically after 30 days",
      restoreLatest: "Restore latest",
      emptyQuarantine: "Empty recycle bin",
      deletedOne: "Deleted “{title}”, freed {size}",
      deletedForeverOne: "Deleted “{title}” forever",
      deletedMany: "Deleted {n} sessions, freed {size}",
      deletedPartial: "Deleted {ok}, {failed} failed",
      restoredOne: "Restored “{title}”",
      purgedQuarantine: "Emptied the recycle bin, freed {size} ({n})",
      indexOnly: "index only",
      cacheOnly: "cache only",
      logSize: "log {size}",
      running: "running",
      yes: "yes",
      no: "no",
      detailId: "ID: {id}",
      detailCreated: "Created: {time}",
      detailPath: "Path: {path}",
      detailNoArtifact: "Path: no log directory on disk",
      detailCache: "Projection cache: {state}",
      detailParent: "Parent session: {ids}",
      detailChildren: "Child sessions: {n} in memory",
      detailLegacy: "This id is still in the legacy aggregate cache (host no longer writes it)",
      "error.invalid-session-id": "Invalid session id.",
      "error.not-archived": "That session is no longer archived.",
      "error.session-running": "Session is running; not deleted.",
      "error.subagent-running": "A subagent session of it is running; not deleted.",
      "error.no-registry": "Workspace registry unavailable; deletion refused.",
      "error.busy": "Another operation is already working on that session.",
      "error.not-quarantined": "That session is not in the recycle bin.",
      "error.no-artifact": "No directory for that session on disk.",
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

    /** Contribute the archived-session page. */
    function apply(ctx) {
      ctx.effect(
        function () {
          return ctx.locale.register(NS, { zh: zh, en: en });
        },
        "dsh-archived: dictionaries",
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
            // Lowest priority wins the cell. On 0.2.0-rc.2 nothing else claims
            // it; on an older host this still shadows the shipped page.
            priority: -1,
            order: 25,
            label: function () {
              return t("nav");
            },
            locale: NS,
            inject: injected,
          },
          ArchivedSessionsSection,
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__test = { zh: zh, en: en };
    return module.exports;
  },
});
