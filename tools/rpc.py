#!/usr/bin/env python3
"""Call one DSH web RPC from the terminal, using this machine's own session key.

The web client authenticates with a signed browser-session cookie. The signing
key already lives in ~/.dsh/.credentials.yaml, so a local tool can mint the same
cookie and drive the official RPCs — which is how this plugin's tests create and
archive a scratch session without a browser.

Usage:
    python3 tools/rpc.py session/create '{"sessionId":"session-...","cwd":"/tmp"}'
    python3 tools/rpc.py workspace/archiveSession '{"sessionId":"session-..."}'
"""

import base64
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid


def base_url() -> str:
    return os.environ.get("DSH_WEB_URL", "http://127.0.0.1:3080").rstrip("/")


def b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def dsh_home() -> str:
    """The DSH home the target host runs with, so an isolated test host works."""
    configured = os.environ.get("DSH_HOME")
    if configured is not None and configured.strip() != "":
        return os.path.abspath(os.path.expanduser(configured.strip()))
    return os.path.join(os.path.expanduser("~"), ".dsh")


def cookie_header(authority: str) -> str:
    text = open(os.path.join(dsh_home(), ".credentials.yaml")).read()
    match = re.search(r"^\s*secret:\s*([A-Za-z0-9_-]{43})\s*$", text, re.M)
    if match is None:
        raise SystemExit(f"no browser-session secret in {os.path.join(dsh_home(), '.credentials.yaml')}")
    secret = base64.urlsafe_b64decode(match.group(1) + "=" * ((4 - len(match.group(1)) % 4) % 4))
    name = "dsh-auth-" + b64u(hashlib.sha256(authority.encode()).digest())
    now = int(time.time() * 1000)
    body = b64u(
        json.dumps(
            {"version": 1, "authority": authority, "issuedAt": now, "expiresAt": now + 86_400_000},
            separators=(",", ":"),
        ).encode()
    )
    signature = b64u(hmac.new(secret, body.encode(), hashlib.sha256).digest())
    return f"{name}=v1.{body}.{signature}"


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    method = sys.argv[1]
    request = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    base = base_url()
    authority = base.split("://", 1)[1]
    raw = uuid.uuid4().hex
    rpc_id = f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:32]}"
    message = {
        "type": "client-request",
        "rpcId": rpc_id,
        "method": method,
        "payload": {"args": {"request": request}},
    }
    http_request = urllib.request.Request(
        f"{base}/api/{method}",
        data=json.dumps(message).encode(),
        headers={"content-type": "application/json", "Cookie": cookie_header(authority)},
        method="POST",
    )
    try:
        with urllib.request.urlopen(http_request, timeout=30) as response:
            print(response.read().decode())
    except urllib.error.HTTPError as error:
        print(f"HTTP {error.code}: {error.read().decode()[:400]}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
