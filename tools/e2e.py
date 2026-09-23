#!/usr/bin/env python3
"""End-to-end acceptance for dsh-archived-sessions-manager.

Creates a scratch session through the official RPCs, archives it, then deletes
it through the plugin's own HTTP route exactly as the settings panel does, and
checks all three pieces of state (artifact directory, projection cache, archive
index entry) are gone.

    python3 tools/e2e.py                      # 用当前目录当会话工作区
    python3 tools/e2e.py --workspace ~/dev    # 指定工作区
    DSH_E2E_WORKSPACE=~/dev python3 tools/e2e.py
    python3 tools/e2e.py --print-workspace     # 只打印解析结果，不碰 DSH

工作区（scratch 会话的 cwd）解析顺序：`--workspace` > `DSH_E2E_WORKSPACE` > 当前目录。
以前这里写死了一个 iCloud 路径，换机器/换工作区就跑不了。
"""

import glob
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc import base_url, cookie_header  # noqa: E402  (same-directory helper)

HEADER = "x-dsh-archived-sessions"
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


def check(label, condition, detail=""):
    mark = "PASS" if condition else "FAIL"
    print(f"[{mark}] {label}{(' — ' + detail) if detail else ''}")
    if not condition:
        FAILURES.append(label)


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


def artifacts_of(session_id):
    home = os.path.expanduser("~")
    found = glob.glob(os.path.join(home, ".dsh", "sessions", "*", session_id))
    cache = os.path.join(home, ".dsh", "storages", "session_projcache", "sessions", f"{session_id}.json")
    return found, os.path.exists(cache)


def main():
    workspace = resolve_workspace(sys.argv[1:])
    scratch = "session-" + str(uuid.uuid4())
    print(f"scratch session: {scratch}")
    print(f"workspace: {workspace}\n")

    created = rpc("session/create", {"sessionId": scratch, "cwd": workspace})
    check("session/create created the scratch session", bool(created and created.get("ok")), json.dumps(created)[:160])

    archived = rpc("workspace/archiveSession", {"sessionId": scratch})
    check("workspace/archiveSession accepted it", bool(archived and archived.get("ok")), json.dumps(archived)[:160])

    directories, cache = artifacts_of(scratch)
    check("scratch session has an on-disk artifact", len(directories) == 1, str(directories))

    status, state = plugin_api("/api/dsh-archived-sessions/state")
    listed = [item for item in state.get("items", []) if item["id"] == scratch]
    check("GET /state lists the archived session", status == 200 and len(listed) == 1, json.dumps(state)[:200])
    check("GET /state reports the artifact size", bool(listed and listed[0]["artifact"] and listed[0]["bytes"] > 0),
          json.dumps(listed)[:160])

    status, guard = plugin_api("/api/dsh-archived-sessions/purge", "POST",
                               {"sessionId": "session-00000000-0000-0000-0000-000000000000"})
    check("purge refuses a session that is not archived", guard.get("error") == "not-archived", json.dumps(guard)[:160])

    status, purged = plugin_api("/api/dsh-archived-sessions/purge", "POST", {"sessionId": scratch})
    check("purge reports success", status == 200 and purged.get("ok") is True, json.dumps(purged)[:200])
    check("purge removed the archive index entry", scratch not in purged.get("archivedSessionIds", []),
          json.dumps(purged.get("archivedSessionIds"))[:160])

    # A lingering idle agent can rewrite its projection cache once after the
    # purge; the host sweeps that residue on a timer, so wait out the first pass.
    deadline = time.time() + 8
    while time.time() < deadline:
        directories, cache = artifacts_of(scratch)
        if len(directories) == 0 and cache is False:
            break
        time.sleep(0.5)
    check("artifact directory is gone", len(directories) == 0, str(directories))
    check("projection cache stays gone (post-purge sweep)", cache is False)

    status, state = plugin_api("/api/dsh-archived-sessions/state")
    check("GET /state no longer lists it", all(item["id"] != scratch for item in state.get("items", [])),
          json.dumps(state)[:200])

    # Trust shapes: a browser sends no Origin on a same-origin GET, so the Fetch
    # Metadata signal has to carry that case; everything cross-origin is refused.
    status, body = plugin_api("/api/dsh-archived-sessions/state", origin=False,
                              extra={"sec-fetch-site": "same-origin"})
    check("browser-shaped same-origin GET (no Origin) is accepted", status == 200 and body.get("ok") is True,
          json.dumps(body)[:160])

    status, body = plugin_api("/api/dsh-archived-sessions/state", extra={"Origin": "http://evil.example"})
    check("cross-origin Origin is refused", status == 403, json.dumps(body)[:120])

    status, body = plugin_api("/api/dsh-archived-sessions/state", origin=False)
    check("request with no same-origin signal is refused", status == 403, json.dumps(body)[:120])

    status, body = plugin_api("/api/dsh-archived-sessions/state", marker=False)
    check("request without the marker header is refused", status == 403, json.dumps(body)[:120])

    status, body = plugin_api("/api/dsh-archived-sessions/state", extra={"sec-fetch-site": "cross-site"})
    check("cross-site fetch metadata is refused", status == 403, json.dumps(body)[:120])

    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed: {FAILURES}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
