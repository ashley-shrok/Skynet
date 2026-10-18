#!/usr/bin/env python3
"""Stand-in for @playwright/mcp in the desktop-mcp bridge tests.

Speaks just enough MCP: initialize, tools/list (two browser tools) and
tools/call, which echoes the tool name, its arguments, and the DISPLAY and
argv it was started with, its pid and how many sessions (initialize calls) it has
had, so tests can see what the bridge passed through.
Writes its pid to $FAKE_PW_PIDFILE (when set) so tests can check teardown, and
answers tools/list $FAKE_PW_LIST_DELAY seconds late (when set) so tests can see a
cold tool-list fetch in progress.
"""
import json
import os
import sys
import time

if os.environ.get("FAKE_PW_PIDFILE"):
    with open(os.environ["FAKE_PW_PIDFILE"], "a") as f:
        f.write("%d\n" % os.getpid())

TOOLS = [
    {"name": "browser_navigate", "description": "fake", "inputSchema": {"type": "object", "properties": {"url": {"type": "string"}}}},
    {"name": "browser_snapshot", "description": "fake", "inputSchema": {"type": "object", "properties": {}}},
]

sessions = 0
for line in sys.stdin:
    msg = json.loads(line)
    if "id" not in msg:
        continue
    method, rid = msg.get("method"), msg["id"]
    if method == "initialize":
        sessions += 1
        result = {"protocolVersion": msg["params"]["protocolVersion"], "capabilities": {"tools": {}}, "serverInfo": {"name": "fake-pw", "version": "0"}}
    elif method == "tools/list":
        time.sleep(float(os.environ.get("FAKE_PW_LIST_DELAY") or 0))
        result = {"tools": TOOLS}
    elif method == "tools/call":
        info = {
            "tool": msg["params"]["name"],
            "arguments": msg["params"].get("arguments", {}),
            "display": os.environ.get("DISPLAY", ""),
            "env": {
                k: os.environ.get(k)
                for k in ("WAYLAND_DISPLAY", "ELECTRON_OZONE_PLATFORM_HINT", "XDG_SESSION_TYPE",
                          "GDK_BACKEND", "QT_QPA_PLATFORM", "MOZ_ENABLE_WAYLAND", "SDL_VIDEODRIVER")
            },
            "argv": sys.argv[1:],
            "pid": os.getpid(),
            "sessions": sessions,
        }
        result = {"content": [{"type": "text", "text": json.dumps(info)}], "isError": False}
    else:
        print(json.dumps({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "nope"}}), flush=True)
        continue
    print(json.dumps({"jsonrpc": "2.0", "id": rid, "result": result}), flush=True)
