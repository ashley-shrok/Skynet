#!/usr/bin/env python3
"""Interactive client for desktop-mcp tests: runs a scripted session and prints
one JSON line per step, so the bash driver can assert with jq.

Usage: desktop-mcp-session.py <server> <step>...
Steps:
  init                 initialize + notifications/initialized
  tools                -> {"tools": [names]}
  wait-list-changed    -> {"list_changed": true|false} (waits up to 20s)
  call:<name>:<json>   -> the tools/call result
  touch:<path> / rm:<path>
"""
import json
import os
import select
import subprocess
import sys
import time

proc = subprocess.Popen([sys.argv[1]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
next_id = 0
seen = []


def read(timeout):
    r, _, _ = select.select([proc.stdout], [], [], timeout)
    if not r:
        return None
    line = proc.stdout.readline()
    return json.loads(line) if line else None


def send(msg):
    proc.stdin.write(json.dumps(msg) + "\n")
    proc.stdin.flush()


def request(method, params):
    global next_id
    next_id += 1
    send({"jsonrpc": "2.0", "id": next_id, "method": method, "params": params})
    deadline = time.time() + 60
    while time.time() < deadline:
        msg = read(1)
        if msg is None:
            continue
        if msg.get("id") == next_id:
            return msg
        seen.append(msg.get("method"))
    raise SystemExit("timeout waiting for " + method)


for step in sys.argv[2:]:
    if step == "init":
        request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}})
        send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        print(json.dumps({"init": True}))
    elif step == "tools":
        print(json.dumps({"tools": [t["name"] for t in request("tools/list", {})["result"]["tools"]]}))
    elif step == "wait-list-changed":
        deadline = time.time() + 20
        while "notifications/tools/list_changed" not in seen and time.time() < deadline:
            msg = read(0.5)
            if msg:
                seen.append(msg.get("method"))
        print(json.dumps({"list_changed": "notifications/tools/list_changed" in seen}))
    elif step.startswith("call:"):
        _, name, args = step.split(":", 2)
        print(json.dumps(request("tools/call", {"name": name, "arguments": json.loads(args)})["result"]))
    elif step.startswith("touch:"):
        open(step[6:], "w").close()
    elif step.startswith("rm:"):
        os.remove(step[3:])

proc.stdin.close()
proc.wait(timeout=30)
