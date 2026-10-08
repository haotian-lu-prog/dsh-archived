#!/usr/bin/env python3
"""End-to-end acceptance for dsh-archived, against a live host.

Creates scratch sessions through the official RPCs, archives them, then drives
the plugin's own HTTP routes exactly as the settings page does, checking every
piece of state a delete has to answer for: the artifact directory, the
projection-cache document, the archive index entry, and the recycle bin.

    python3 tools/e2e.py                      # 用当前目录当会话工作区
    python3 tools/e2e.py --workspace ~/dev    # 指定工作区
    DSH_E2E_WORKSPACE=~/dev python3 tools/e2e.py
    python3 tools/e2e.py --print-workspace    # 只打印解析结果，不碰 DSH

工作区（scratch 会话的 cwd）解析顺序：`--workspace` > `DSH_E2E_WORKSPACE` > 当前目录。
以前这里写死了一个 iCloud 路径，换机器/换工作区就跑不了。

Requires a running `dsh web` with the plugin loaded. `node tools/host-smoke.mjs`
covers the same pipeline with no host at all; this file is the proof that the
routes answer over HTTP the way the browser calls them.
"""

import glob
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc import base_url, cookie_header  # noqa: E402  (same-directory helper)

HEADER = "x-dsh-archived"
BASE = "/api/dsh-archived"
FAILURES = []


def normalize_workspace(raw):
    """展开 ~、转绝对路径，并确认它是个真实目录；不合法就退出 2。"""
    workspace = os.path.abspath(os.path.expanduser(raw))
    if not os.path.isdir(workspace):
        print(f"工作区不存在或不是目录：{workspace}", file=sys.stderr)
        print("用 --workspace <目录> 或环境变量 DSH_E2E_WORKSPACE 指定。", file=sys.stderr)
        raise SystemExit(2)
    return workspace


def resolve_workspace(argv):
    """解析会话工作区；`--help` / `--print-workspace` 会直接退出。"""
    chosen = None
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--workspace" and index + 1 < len(argv):
            chosen = argv[index + 1]
            index += 2
            continue
        if arg.startswith("--workspace="):
            chosen = arg.split("=", 1)[1]
            index += 1
            continue
        if arg in ("-h", "--help"):
            print(__doc__)
            raise SystemExit(0)
        if arg == "--print-workspace":
            # 打印的是「真正会被用的值」，所以同样过一遍校验，别给出一个跑不起来的路径
            print(normalize_workspace(chosen or os.environ.get("DSH_E2E_WORKSPACE") or os.getcwd()))
            raise SystemExit(0)
        print(f"未知参数：{arg}（--help 看用法）", file=sys.stderr)
        raise SystemExit(2)

    return normalize_workspace(chosen or os.environ.get("DSH_E2E_WORKSPACE") or os.getcwd())


# \`tools/browser-acceptance.py\` imports this module and uses WORKSPACE as the
# scratch session's cwd, so it has to exist at import time and resolve exactly
# the way the CLI resolves it. `--workspace` stays a CLI-only concern; an
# importer gets the environment/cwd fallback. (Without this the browser suite
# died on ImportError before it ever reached the panel.)
WORKSPACE = normalize_workspace(os.environ.get("DSH_E2E_WORKSPACE") or os.getcwd())


def check(label, condition, detail=""):
    mark = "PASS" if condition else "FAIL"
    print(f"[{mark}] {label}{(' — ' + detail) if detail else ''}")
    if not condition:
        FAILURES.append(label)


def skip(label, why):
    """A case a live host makes unobservable; not a failure, but never silent."""
    print(f"[SKIP] {label} — {why}")


def rpc(method, request):
    base = base_url()
    authority = base.split("://", 1)[1]
    raw = uuid.uuid4().hex
    rpc_id = f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:32]}"
    message = {"type": "client-request", "rpcId": rpc_id, "method": method, "payload": {"args": {"request": request}}}
    http_request = urllib.request.Request(
        f"{base}/api/{method}",
        data=json.dumps(message).encode(),
        headers={"content-type": "application/json", "Cookie": cookie_header(authority)},
        method="POST",
    )
    with urllib.request.urlopen(http_request, timeout=30) as response:
        return json.loads(response.read().decode()).get("result")


def plugin_api(path, method="GET", body=None, marker=True, origin=True, extra=None):
    """Call one plugin route, choosing which trust signals the request carries."""
    base = base_url()
    authority = base.split("://", 1)[1]
    headers = {"content-type": "application/json"}
    if marker:
        headers[HEADER] = "1"
    headers["Cookie"] = cookie_header(authority)
    if origin:
        headers["Origin"] = base
    if extra:
        headers.update(extra)
    request = urllib.request.Request(
        base + path,
        data=None if body is None else json.dumps(body).encode(),
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode())


def dsh_home():
    return os.path.abspath(os.path.expanduser(os.environ.get("DSH_HOME") or "~/.dsh"))


def artifacts_of(session_id):
    found = glob.glob(os.path.join(dsh_home(), "sessions", "*", session_id))
    cache = os.path.join(dsh_home(), "storages", "session_projcache", "sessions", f"{session_id}.json")
    return found, os.path.exists(cache)


def quarantine_of(session_id):
    return os.path.isdir(os.path.join(dsh_home(), ".archived-sessions-quarantine", session_id))


def state():
    status, payload = plugin_api(BASE + "/state")
    if status != 200:
        raise SystemExit(f"state route returned {status}: {payload}")
    return payload


def archive_set_ids():
    return {item["id"] for item in state().get("items", [])}


def item_for(session_id):
    for item in state().get("items", []):
        if item["id"] == session_id:
            return item
    return None


def wait_until(predicate, timeout=10.0, interval=0.5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


def forget(session_id):
    """Cleanup that never leaves a parked or archived scratch behind.

    Goes through the plugin's own routes rather than the filesystem: the parked
    payload lives under the host's DSH home, which a sandboxed test process may
    not be allowed to touch, while the host itself always can.
    """
    plugin_api(BASE + "/restore", "POST", {"sessionId": session_id}, origin=False,
               extra={"sec-fetch-site": "same-origin"})
    plugin_api(BASE + "/delete", "POST", {"sessionId": session_id, "mode": "forever"}, origin=False,
               extra={"sec-fetch-site": "same-origin"})


def main():
    workspace = resolve_workspace(sys.argv[1:])
    scratch = "session-" + str(uuid.uuid4())
    residue = "session-" + str(uuid.uuid4())
    print(f"scratch session: {scratch}")
    print(f"residue session: {residue}")
    print(f"workspace: {workspace}")
    print(f"DSH home: {dsh_home()}\n")

    before_ids = archive_set_ids()
    before_sessions = set(glob.glob(os.path.join(dsh_home(), "sessions", "*", "session-*")))

    # --- the host still speaks the contract -------------------------------------
    payload = state()
    check("GET /state answers the panel's api version", payload.get("apiVersion") == 2, str(payload.get("apiVersion")))
    check("GET /state reports the legacy aggregate without touching it",
          isinstance(payload.get("legacy"), dict) and "present" in payload["legacy"], json.dumps(payload.get("legacy")))

    # --- create + archive ---------------------------------------------------------
    created = rpc("session/create", {"sessionId": scratch, "cwd": workspace})
    check("session/create created the scratch session", bool(created and created.get("ok")), json.dumps(created)[:160])
    archived = rpc("workspace/archiveSession", {"sessionId": scratch})
    check("workspace/archiveSession accepted it", bool(archived and archived.get("ok")), json.dumps(archived)[:160])

    directories, cache_before = artifacts_of(scratch)
    check("scratch session has an on-disk artifact", len(directories) == 1, str(directories))

    listed = item_for(scratch)
    check("GET /state lists the archived session", listed is not None, json.dumps(listed)[:200])
    # A freshly created scratch session has a directory but an empty log, so the
    # size is legitimately 0 here; the count is what this asserts.
    check("GET /state reports the artifact size",
          bool(listed and listed["artifact"]["present"] and "bytes" in listed["artifact"]),
          json.dumps(listed)[:200] if listed else "")
    check("GET /state marks a session with a log directory as neither residue kind",
          bool(listed and listed["indexOnly"] is False and listed["cacheOnly"] is False))

    # --- refusals --------------------------------------------------------------------
    status, guard = plugin_api(BASE + "/delete", "POST",
                               {"sessionId": "session-00000000-0000-0000-0000-000000000000"})
    check("delete refuses a session that is not archived", guard.get("error") == "not-archived", json.dumps(guard)[:160])

    status, guard = plugin_api(BASE + "/delete", "POST", {"sessionId": "not-a-session"})
    check("delete refuses a malformed id", guard.get("error") == "invalid-session-id", json.dumps(guard)[:160])

    status, guard = plugin_api(BASE + "/delete", "POST", {"sessionId": scratch})
    check("delete accepts a well-formed archived id", status == 200 and guard.get("ok") is True,
          json.dumps(guard)[:200])
    check("delete reports the quarantine mode", guard.get("mode") == "quarantine", json.dumps(guard)[:160])
    check("delete cleared the archive index entry", scratch not in guard.get("archivedSessionIds", []),
          json.dumps(guard.get("archivedSessionIds"))[:160])

    # --- the delete is a move, and it says where the bytes went -------------------------
    check("session log directory left the sessions tree", not artifacts_of(scratch)[0], str(artifacts_of(scratch)[0]))
    # A busy host keeps writing the projection cache for a session it still holds
    # in memory, so "is the cache gone right now" is a race; what is deterministic
    # is that whatever existed at delete time was parked. The sweep assertion
    # below covers the rewrite.
    if cache_before:
        check("the projection cache was parked with the session",
              os.path.exists(os.path.join(dsh_home(), ".archived-sessions-quarantine", scratch, "cache.json")))
    else:
        skip("the projection cache was parked with the session",
             "the host had not written a cache document yet, so there was nothing to park")
    check("the payload is parked in the recycle bin", quarantine_of(scratch))
    parked = state().get("quarantine", {})
    check("the recycle bin reports the parked session",
          any(entry["id"] == scratch for entry in parked.get("items", [])), json.dumps(parked)[:200])

    # A lingering idle agent can rewrite its projection cache once after the
    # delete; the host sweeps that residue on a timer, so wait out the first pass.
    check("post-delete sweep removes rewritten residue",
          wait_until(lambda: not artifacts_of(scratch)[1], timeout=8))

    # --- restore puts it back, in the archive set ----------------------------------------
    status, restored = plugin_api(BASE + "/restore", "POST", {"sessionId": scratch})
    check("restore reports success", status == 200 and restored.get("ok") is True, json.dumps(restored)[:200])
    check("restore re-archives the session", restored.get("restored", {}).get("rearchived") is True,
          json.dumps(restored)[:200])
    directories, cache = artifacts_of(scratch)
    check("restore put the log directory back", len(directories) == 1, str(directories))
    if cache_before:
        check("restore put the cache document back", cache is True)
    else:
        skip("restore put the cache document back", "no cache document existed to park")
    check("restored session is listed as archived again", scratch in archive_set_ids())
    check("the recycle bin no longer holds it", not quarantine_of(scratch))

    status, guard = plugin_api(BASE + "/restore", "POST", {"sessionId": scratch})
    check("restoring a session that is not parked is refused", guard.get("error") == "not-quarantined",
          json.dumps(guard)[:160])

    # --- index-only residue: the case the old page could not even show ---------------------
    created = rpc("session/create", {"sessionId": residue, "cwd": workspace})
    archived = rpc("workspace/archiveSession", {"sessionId": residue})
    check("second scratch session archived", bool(created and created.get("ok") and archived and archived.get("ok")))
    directories, _ = artifacts_of(residue)
    for directory in directories:
        shutil.rmtree(directory, ignore_errors=True)
    cache_path = os.path.join(dsh_home(), "storages", "session_projcache", "sessions", f"{residue}.json")
    if os.path.exists(cache_path):
        os.remove(cache_path)
    # Fabricating index-only residue means deleting files out from under a host
    # that still holds the session in memory, which is a race on a live box: the
    # host can re-materialize the directory or the cache. tools/host-smoke.mjs
    # covers this path deterministically; here it is asserted when it sticks.
    time.sleep(1.0)
    residue_item = item_for(residue)
    genuinely_index_only = residue_item is not None and residue_item["indexOnly"] is True
    if genuinely_index_only:
        check("index-only residue still gets a row", True)
    elif residue_item is None:
        skip("index-only residue still gets a row", "the host dropped it from the archive set")
    else:
        skip("index-only residue still gets a row",
             f"a live host re-materializes what it still holds: {json.dumps(residue_item)[:140]}")
    bin_before = state()["quarantine"]["count"]
    status, cleared = plugin_api(BASE + "/delete", "POST", {"sessionId": residue})
    check("index-only residue can be cleaned", status == 200 and cleared.get("ok") is True, json.dumps(cleared)[:160])
    if genuinely_index_only:
        check("cleaning residue parks nothing", state()["quarantine"]["count"] == bin_before,
              f"{bin_before} -> {state()['quarantine']['count']}")
    else:
        skip("cleaning residue parks nothing", "the residue was not actually index-only")

    # --- batch delete with an explicit id list ------------------------------------------------
    status, batch = plugin_api(BASE + "/delete-all", "POST", {"ids": [scratch], "mode": "forever"})
    check("delete-all accepts an explicit id list", status == 200 and batch.get("ok") is True, json.dumps(batch)[:200])
    check("delete-all over that id leaves nothing behind on disk",
          wait_until(lambda: not artifacts_of(scratch)[0] and artifacts_of(scratch)[1] is False, timeout=8))
    check("permanent delete parks nothing", not quarantine_of(scratch))

    # --- nothing else moved ------------------------------------------------------------------
    after_ids = archive_set_ids()
    after_sessions = set(glob.glob(os.path.join(dsh_home(), "sessions", "*", "session-*")))
    check("no other archived session was touched", after_ids == before_ids - {scratch},
          f"before={len(before_ids)} after={len(after_ids)}")
    # Only one direction matters: a live host legitimately creates session
    # directories while the suite runs (its own activity, subagents), and a
    # symmetric difference would report that as a failure. What must never
    # happen is a session that existed before the run disappearing.
    disappeared = sorted(before_sessions - after_sessions)
    check("no session that existed before the run disappeared", not disappeared, f"disappeared={disappeared}")

    # --- trust shapes ----------------------------------------------------------------------------
    # A browser sends no Origin on a same-origin GET, so the Fetch Metadata
    # signal has to carry that case; everything cross-origin is refused.
    status, body = plugin_api(BASE + "/state", origin=False, extra={"sec-fetch-site": "same-origin"})
    check("browser-shaped same-origin GET (no Origin) is accepted", status == 200 and body.get("ok") is True,
          json.dumps(body)[:160])

    status, body = plugin_api(BASE + "/state", extra={"Origin": "http://evil.example"})
    check("cross-origin Origin is refused", status == 403, json.dumps(body)[:120])

    status, body = plugin_api(BASE + "/state", origin=False, marker=False)
    check("no same-origin signal and no marker is refused", status == 403, json.dumps(body)[:120])

    # The pre-rename path stays served so a tab holding the 0.2.0 client keeps
    # working across the rename instead of erroring until it is reloaded.
    status, body = plugin_api("/api/dsh-archived-sessions/state", extra={"x-dsh-archived-sessions": "1"})
    check("the pre-rename route still answers", status == 200 and body.get("apiVersion") == 2,
          json.dumps(body)[:120])

    status, body = plugin_api(BASE + "/state")
    check("refusals are reported with their evidence",
          isinstance(body.get("refusals"), list) and len(body["refusals"]) >= 1
          and body["refusals"][0].get("trusted") is False, json.dumps(body.get("refusals", []))[:160])

    # A same-origin `Origin` is proof on its own: the Desktop app's request
    # pipeline may carry no custom header at all, and requiring one is what
    # refused its legitimate call. The marker only covers the case where no
    # signal of any kind arrives.
    status, body = plugin_api(BASE + "/state", marker=False)
    check("a same-origin request needs no marker", status == 200, json.dumps(body)[:120])

    status, body = plugin_api(BASE + "/state", marker=False, origin=False)
    check("a request with no signal and no marker is refused", status == 403, json.dumps(body)[:120])

    status, body = plugin_api(BASE + "/state", extra={"sec-fetch-site": "cross-site"})
    check("cross-site fetch metadata is refused", status == 403, json.dumps(body)[:120])

    status, body = plugin_api(BASE + "/delete", "GET")
    check("a destructive route only answers its own method", status == 405, json.dumps(body)[:120])

    # `reveal` opens the platform file manager on the HOST, so a test run only
    # asserts the refusal path — proving the happy path would pop a Finder window.
    status, body = plugin_api(BASE + "/reveal", "POST", {"sessionId": "session-00000000-0000-0000-0000-000000000000"})
    check("reveal refuses a session with no directory", body.get("error") == "no-artifact", json.dumps(body)[:160])

    # Nothing this run created may be left behind, archived or parked.
    forget(residue)
    forget(scratch)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed: {FAILURES}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
