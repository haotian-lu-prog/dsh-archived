#!/usr/bin/env python3
"""Drive a real browser (headless Chrome) through the archived-sessions panel.

The panel is client-side React: only a browser can prove the shipped settings
page is really replaced (one nav row, not two), that the destructive buttons
exist, and that clicking 删除 parks the session and 恢复最近一个 brings it back. This drives Chrome over CDP with a
cookie minted from this machine's own session key, creates its own scratch
session through the official RPCs, and then walks the UI.

    python3 tools/browser-acceptance.py --dump     # explore: list visible UI text
    python3 tools/browser-acceptance.py            # assert the full click-through
"""

import base64
import json
import os
import re
import socket
import struct
import sys
import time
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc import base_url  # noqa: E402

CDP_PORT = int(os.environ.get("DSH_CDP_PORT", "9333"))
SCRATCH_TITLE = "浏览器验收临时会话"
FAILURES = []


def check(label, condition, detail=""):
    mark = "PASS" if condition else "FAIL"
    print(f"[{mark}] {label}{(' — ' + detail) if detail else ''}")
    if not condition:
        FAILURES.append(label)


# --- minimal WebSocket client (RFC 6455, text frames only) -------------------
class WebSocket:
    def __init__(self, url, timeout=30):
        match = re.match(r"ws://([^/:]+):(\d+)(/.*)?$", url)
        if match is None:
            raise SystemExit(f"unsupported websocket url: {url}")
        host, port, path = match.group(1), int(match.group(2)), match.group(3) or "/"
        self.socket = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        handshake = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.socket.sendall(handshake.encode())
        header = b""
        while b"\r\n\r\n" not in header:
            chunk = self.socket.recv(4096)
            if not chunk:
                raise SystemExit("websocket handshake closed early")
            header += chunk
        if b"101" not in header.split(b"\r\n", 1)[0]:
            raise SystemExit(f"websocket handshake failed: {header[:120]!r}")
        self.buffer = header.split(b"\r\n\r\n", 1)[1]

    def _read(self, count):
        while len(self.buffer) < count:
            chunk = self.socket.recv(65536)
            if not chunk:
                raise SystemExit("websocket closed")
            self.buffer += chunk
        data, self.buffer = self.buffer[:count], self.buffer[count:]
        return data

    def send(self, text):
        payload = text.encode()
        mask = os.urandom(4)
        header = bytearray([0x81])
        length = len(payload)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", length)
        header += mask
        masked = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        self.socket.sendall(bytes(header) + masked)

    def recv(self):
        while True:
            first, second = self._read(2)
            opcode = first & 0x0F
            length = second & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._read(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(length) if length else b""
            if opcode == 0x1:
                return payload.decode()
            if opcode == 0x8:
                raise SystemExit("websocket closed by peer")
            if opcode == 0x9:  # ping -> pong
                self.socket.sendall(b"\x8a\x80" + os.urandom(4))


class Cdp:
    def __init__(self, websocket_url):
        self.ws = WebSocket(websocket_url)
        self.next_id = 0
        self.session_id = None
        self.events = []

    def call(self, method, params=None, timeout=30):
        self.next_id += 1
        message = {"id": self.next_id, "method": method, "params": params or {}}
        if self.session_id is not None:
            message["sessionId"] = self.session_id
        self.ws.send(json.dumps(message))
        deadline = time.time() + timeout
        while time.time() < deadline:
            reply = json.loads(self.ws.recv())
            if reply.get("id") == self.next_id:
                if "error" in reply:
                    raise SystemExit(f"{method} failed: {reply['error']}")
                return reply.get("result", {})
            self.events.append(reply)
        raise SystemExit(f"{method} timed out")

    def evaluate(self, expression, timeout=30):
        result = self.call(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True},
            timeout=timeout,
        )
        if "exceptionDetails" in result:
            raise SystemExit(f"evaluate threw: {result['exceptionDetails'].get('text')} {expression[:120]}")
        return result.get("result", {}).get("value")


# JS helpers evaluated in the page: find a visible clickable by its exact label.
CLICK_BY_TEXT = """
(() => {
  const label = %s;
  const nodes = [...document.querySelectorAll('button,[role="button"],a,li,div,span')];
  const matches = nodes.filter((el) => el.textContent.trim() === label && el.offsetParent !== null);
  if (matches.length === 0) return { ok: false, reason: 'not-found' };
  const target = matches[matches.length - 1].closest('button,[role="button"],a') || matches[matches.length - 1];
  target.click();
  return { ok: true, tag: target.tagName, count: matches.length };
})()
"""

# Visible buttons carrying one exact label — the settings nav rows among them.
BUTTONS_WITH_TEXT = """
(() => [...document.querySelectorAll('button')]
  .filter((el) => el.textContent.trim() === %s && el.offsetParent !== null).length)()
"""

VISIBLE_TEXT = """
(() => {
  const out = [];
  for (const el of document.querySelectorAll('button,[role="button"],[data-slot]')) {
    const text = el.textContent.trim().replace(/\\s+/g, ' ');
    if (text.length > 0 && text.length < 80 && el.offsetParent !== null) out.push(text);
  }
  return out;
})()
"""


def cookie_pair():
    """Mint this browser-session cookie exactly as the web client receives it."""
    from rpc import cookie_header

    authority = base_url().split("://", 1)[1]
    name, value = cookie_header(authority).split("=", 1)
    return name, value


def http_json(url, method="GET"):
    request = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode())


def connect_page():
    version = http_json(f"http://127.0.0.1:{CDP_PORT}/json/version")
    cdp = Cdp(version["webSocketDebuggerUrl"])
    target = cdp.call("Target.createTarget", {"url": "about:blank"})
    attached = cdp.call("Target.attachToTarget", {"targetId": target["targetId"], "flatten": True})
    cdp.session_id = attached["sessionId"]
    cdp.call("Page.enable")
    cdp.call("Runtime.enable")
    cdp.call("Network.enable")
    name, value = cookie_pair()
    cdp.call("Network.setCookie", {"name": name, "value": value, "url": base_url() + "/", "httpOnly": True})
    return cdp


def plugin_state():
    """Read the plugin's own state route exactly as a same-origin browser GET does."""
    from e2e import plugin_api

    status, state = plugin_api("/api/dsh-archived-sessions/state", origin=False,
                               extra={"sec-fetch-site": "same-origin"})
    if status != 200:
        raise SystemExit(f"state route returned {status}: {state}")
    return state


def still_archived(session_id):
    try:
        return any(item["id"] == session_id for item in plugin_state().get("items", []))
    except SystemExit:
        return False


def purge(session_id):
    """Permanent delete, used for cleanup so a run never leaves a parked session."""
    from e2e import plugin_api

    plugin_api("/api/dsh-archived-sessions/delete", "POST", {"sessionId": session_id, "mode": "forever"},
               origin=False, extra={"sec-fetch-site": "same-origin"})


def artifacts_of(session_id):
    from e2e import artifacts_of as locate

    return locate(session_id)


def wait_for(cdp, expression, timeout=30, interval=0.5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if cdp.evaluate(expression) is True:
            return True
        time.sleep(interval)
    return False


def finish():
    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed: {FAILURES}")
        return 1
    print("all checks passed")
    return 0


def main():
    from e2e import WORKSPACE, rpc

    scratch = "session-" + str(uuid.uuid4())
    created = rpc("session/create", {"sessionId": scratch, "cwd": WORKSPACE})
    rpc("session/rename", {"sessionId": scratch, "title": SCRATCH_TITLE})
    archived = rpc("workspace/archiveSession", {"sessionId": scratch})
    check("scratch session archived for the UI run",
          bool(created and created.get("ok") and archived and archived.get("ok")), scratch)

    try:
        cdp = connect_page()
        cdp.call("Page.navigate", {"url": base_url() + "/"})
        check("app shell rendered", wait_for(cdp, "document.querySelectorAll('button').length > 3", timeout=40))

        opened = cdp.evaluate(CLICK_BY_TEXT % json.dumps("设置"))
        if not opened.get("ok"):
            # Rail layout: the settings trigger is icon-only.
            opened = cdp.evaluate(
                "(() => { const el = document.querySelector('[data-slot=\"settings.trigger\"] button, [data-slot=\"settings.trigger\"]');"
                " if (!el) return {ok:false}; el.click(); return {ok:true, tag: el.tagName}; })()"
            )
        check("settings panel opened", bool(opened.get("ok")), json.dumps(opened, ensure_ascii=False))

        # DSH 0.2.0-rc.2 ships no archived-sessions settings page, so this page
        # is the only claimant of the cell. A second row would mean some host
        # does still ship one and the shadowing priority stopped working.
        nav_rows = cdp.evaluate(BUTTONS_WITH_TEXT % json.dumps("已归档"))
        check("exactly one 已归档 nav row", nav_rows == 1, f"rows={nav_rows}")

        nav = cdp.evaluate(CLICK_BY_TEXT % json.dumps("已归档"))
        check("archived-sessions nav row found", bool(nav.get("ok")), json.dumps(nav, ensure_ascii=False))

        if "--dump" in sys.argv:
            print("visible interactive text:", json.dumps(cdp.evaluate(VISIBLE_TEXT), ensure_ascii=False, indent=1))
            return finish()

        panel = cdp.evaluate("document.body.innerText")
        check("panel shows the delete action", "删除" in panel)
        check("panel shows the clear-all action", "删除全部" in panel)
        check("panel shows the per-row unarchive action", "取消归档" in panel)
        check("panel shows the per-row details action", "详情" in panel)
        check("panel lists the scratch session", SCRATCH_TITLE in panel)

        # The row's disk footprint comes from the plugin's own GET /state — the exact
        # request shape a browser sends (no Origin on a same-origin GET).
        check("row annotates its on-disk footprint from GET /state",
              wait_for(cdp, "document.body.innerText.includes('日志') || document.body.innerText.includes('仅索引')", timeout=15))

        count_js = ("[...document.querySelectorAll('button')]"
                    ".filter((el) => el.textContent.trim() === '删除' && el.offsetParent !== null).length")
        rows_before = cdp.evaluate(count_js)

        clicked = cdp.evaluate(CLICK_BY_TEXT % json.dumps("删除"))
        check("row delete button is clickable", bool(clicked.get("ok")), json.dumps(clicked, ensure_ascii=False))
        check("inline confirmation appears before anything is deleted",
              wait_for(cdp, "document.body.innerText.includes('删除后可在回收站恢复')", timeout=10))
        check("the confirmation offers a separate permanent delete",
              "永久删除" in cdp.evaluate("document.body.innerText"))

        confirmed = cdp.evaluate(CLICK_BY_TEXT % json.dumps("确认删除"))
        check("confirmation button is clickable", bool(confirmed.get("ok")), json.dumps(confirmed, ensure_ascii=False))
        check("success notice replaces the row",
              wait_for(cdp, "document.body.innerText.includes('已删除')", timeout=25))
        check("the archived row is gone",
              wait_for(cdp, f"document.body.innerText.includes('暂无已归档会话') || "
                            f"[...document.querySelectorAll('button')].filter((el) => el.textContent.trim() === '删除' && el.offsetParent !== null).length < {rows_before}",
                       timeout=25))

        after = plugin_state()
        check("server-side archive set no longer lists the session",
              all(item["id"] != scratch for item in after.get("items", [])), json.dumps(after)[:160])

        directories, cache = artifacts_of(scratch)
        check("session log directory left the sessions tree", len(directories) == 0, str(directories))
        check("the delete parked the session instead of unlinking it",
              os.path.isdir(os.path.join(os.path.expanduser("~"), ".dsh", ".archived-sessions-quarantine", scratch)))
        check("the panel now shows the recycle bin",
              wait_for(cdp, "document.body.innerText.includes('回收站')", timeout=10))

        # The undo has to work from the UI, not just from the API.
        restored = cdp.evaluate(CLICK_BY_TEXT % json.dumps("恢复最近一个"))
        check("recycle-bin restore is clickable", bool(restored.get("ok")), json.dumps(restored, ensure_ascii=False))
        check("the restored session is listed again",
              wait_for(cdp, f"document.body.innerText.includes({json.dumps(SCRATCH_TITLE)})", timeout=25))

        print("deleted and restored through the UI:", scratch)
    finally:
        # Never leave the scratch session behind, however the run ended.
        if still_archived(scratch):
            purge(scratch)
            print("cleanup: purged leftover scratch session")

    return finish()


if __name__ == "__main__":
    raise SystemExit(main())
