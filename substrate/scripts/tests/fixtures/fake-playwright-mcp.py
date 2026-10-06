#!/usr/bin/env python3
"""Stand-in for @playwright/mcp in the desktop-mcp bridge tests.

Speaks just enough MCP: initialize, tools/list (two browser tools) and
tools/call, which echoes the tool name, its arguments, and the DISPLAY and
argv it was started with, so tests can see what the bridge passed through.
Writes its pid to $FAKE_PW_PIDFILE (when set) so tests can check teardown.
"""
import json
import os
import sys

if os.environ.get("FAKE_PW_PIDFILE"):
    with open(os.environ["FAKE_PW_PIDFILE"], "a") as f:
        f.write("%d\n" % os.getpid())

TOOLS = [
    {"name": "browser_navigate", "description": "fake", "inputSchema": {"type": "object", "properties": {"url": {"type": "string"}}}},
    {"name": "browser_snapshot", "description": "fake", "inputSchema": {"type": "object", "properties": {}}},
]

for line in sys.stdin:
    msg = json.loads(line)
    if "id" not in msg:
        continue
    method, rid = msg.get("method"), msg["id"]
    if method == "initialize":
        result = {"protocolVersion": msg["params"]["protocolVersion"], "capabilities": {"tools": {}}, "serverInfo": {"name": "fake-pw", "version": "0"}}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        info = {
            "tool": msg["params"]["name"],
            "arguments": msg["params"].get("arguments", {}),
            "display": os.environ.get("DISPLAY", ""),
            "argv": sys.argv[1:],
        }
        result = {"content": [{"type": "text", "text": json.dumps(info)}], "isError": False}
    else:
        print(json.dumps({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "nope"}}), flush=True)
        continue
    print(json.dumps({"jsonrpc": "2.0", "id": rid, "result": result}), flush=True)
