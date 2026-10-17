#!/usr/bin/env python3
"""relay-mcp — one MCP server per host that sends relay (Matrix) messages for every identity.

Canonical copy lives in the app's source repo at substrate/scripts/relay-mcp.py and is
distributed to every managed host by the fleet-substrate distributor (see
src/backend/distributor/catalog.ts). Installed per-box at ~/.local/bin/relay-mcp and run
by relay-mcp.service (a user unit). Do NOT hand-edit the installed copy.

Why one per host: an MCP server registered as stdio is spawned once per claude session,
used or not. This one speaks MCP over HTTP on 127.0.0.1, so every session on the box
shares a single small process. agent-supervisor passes each launch a shared config
(~/.claude/relay-mcp.json) whose X-Fleet-Identity header is filled from $FLEET_IDENTITY,
so the server knows which identity is calling. The agent sees tools named
mcp__relay__<tool>.

Trust: identity comes from that header. Every identity on a box runs as the same OS user
and can already read every other identity's relay.json, so this is no weaker than the
curl recipe it replaces. Requests carrying an Origin header are refused (blocks a browser
page on this box from driving the server), and only 127.0.0.1 is bound.

Credentials: per call, from ~/fleet/identities/<name>/<account>-state/{token,base,uid}
(kept current by the supervisor's receiver), falling back to <account>.json. The default
account is "relay". On M_UNKNOWN_TOKEN the state file is re-read once (the receiver may
have just logged back in); the server never logs in itself, so it never races the
receiver over the token file.

Transport: MCP Streamable HTTP, JSON responses only (no SSE), stateless. stdlib only.
"""
import json
import os
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("RELAY_MCP_PORT", "7793"))
FLEET = os.path.expanduser(os.environ.get("RELAY_MCP_FLEET_DIR", "~/fleet"))
IDENTITIES = os.path.join(FLEET, "identities")
HTTP_TIMEOUT = 20
MAX_BODY = 4 * 1024 * 1024
MAX_FILE = 100 * 1024 * 1024
# Cap on rooms inspected when looking for an existing DM with someone.
DM_SCAN_LIMIT = 200

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
ACCOUNT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
MXID_RE = re.compile(r"^@[a-z0-9._=/+-]+:[A-Za-z0-9.-]+(:[0-9]+)?$")
ROOM_RE = re.compile(r"^![A-Za-z0-9._=/+-]+:[A-Za-z0-9.-]+(:[0-9]+)?$")

SERVER_INFO = {"name": "relay", "version": "1"}
INSTRUCTIONS = (
    "Send and read relay (Matrix) messages as this agent. Use these tools instead of curl. "
    "send() to a person or agent reuses your existing DM room with them, or creates one."
)


def log(msg):
    print(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}", flush=True)


class ToolError(Exception):
    """A failure the calling agent should see as a tool error (isError result)."""


# ---------------------------------------------------------------------------
# Matrix client, one per (identity, account) per call
# ---------------------------------------------------------------------------

def _read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


class Matrix:
    def __init__(self, identity, account):
        if not NAME_RE.match(identity or ""):
            raise ToolError(f"unknown identity {identity!r}")
        if not ACCOUNT_RE.match(account):
            raise ToolError(f"bad account name {account!r}")
        self.identity = identity
        self.account = account
        idir = os.path.join(IDENTITIES, identity)
        self.creds_path = os.path.join(idir, f"{account}.json")
        self.state_dir = os.path.join(idir, f"{account}-state")
        if not os.path.isfile(self.creds_path):
            raise ToolError(f"no relay account '{account}' for identity {identity}")
        self._load()

    def _load(self):
        try:
            with open(self.creds_path, encoding="utf-8") as f:
                creds = json.load(f)
        except (OSError, ValueError) as e:
            raise ToolError(f"can't read {self.creds_path}: {e}")
        self.token = _read(os.path.join(self.state_dir, "token")) or creds.get("access_token") or creds.get("token") or ""
        self.base = (_read(os.path.join(self.state_dir, "base")) or creds.get("base") or "").rstrip("/")
        self.me = _read(os.path.join(self.state_dir, "uid")) or creds.get("user_id") or ""
        if not (self.token and self.base and self.me):
            raise ToolError(f"relay account '{self.account}' for {self.identity} is missing token/base/user_id")
        self.media_root = self.base.split("/_matrix/")[0]

    def request(self, method, path, body=None, *, raw=None, content_type=None, root=None, retry=True):
        url = (root or self.base) + path
        data = None
        headers = {"Authorization": f"Bearer {self.token}"}
        if raw is not None:
            data = raw
            headers["Content-Type"] = content_type or "application/octet-stream"
        elif body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
                payload = resp.read()
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read() or b"{}")
            except ValueError:
                err = {}
            if e.code == 401 and err.get("errcode") == "M_UNKNOWN_TOKEN" and retry:
                # The receiver re-logs in on token death; pick up its fresh token once.
                self._load()
                return self.request(method, path, body, raw=raw, content_type=content_type, root=root, retry=False)
            raise ToolError(f"homeserver said {e.code} {err.get('errcode', '')}: {err.get('error', '')}".strip())
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise ToolError(f"can't reach the homeserver at {self.base}: {e}")

    # --- helpers -----------------------------------------------------------

    def members(self, room_id):
        """Joined + invited members of a room, as {mxid: membership}."""
        q = urllib.parse.quote(room_id, safe="")
        res = self.request("GET", f"/rooms/{q}/members?not_membership=leave")
        out = {}
        for ev in res.get("chunk", []):
            m = (ev.get("content") or {}).get("membership")
            if m in ("join", "invite") and ev.get("state_key"):
                out[ev["state_key"]] = m
        return out

    def room_name(self, room_id):
        q = urllib.parse.quote(room_id, safe="")
        try:
            return (self.request("GET", f"/rooms/{q}/state/m.room.name") or {}).get("name") or ""
        except ToolError:
            return ""

    def last_activity(self, room_id):
        q = urllib.parse.quote(room_id, safe="")
        try:
            res = self.request("GET", f"/rooms/{q}/messages?dir=b&limit=1")
            chunk = res.get("chunk") or []
            return chunk[0].get("origin_server_ts", 0) if chunk else 0
        except ToolError:
            return 0

    def profile_exists(self, mxid):
        q = urllib.parse.quote(mxid, safe="")
        try:
            self.request("GET", f"/profile/{q}")
            return True
        except ToolError:
            return False

    def display_name(self, mxid):
        q = urllib.parse.quote(mxid, safe="")
        try:
            return (self.request("GET", f"/profile/{q}") or {}).get("displayname") or ""
        except ToolError:
            return ""


# ---------------------------------------------------------------------------
# Resolving who "to" means
# ---------------------------------------------------------------------------

def _local_identity_mxid(name):
    """mxid of an identity on this box, read off disk."""
    if not NAME_RE.match(name):
        return None
    path = os.path.join(IDENTITIES, name, "relay.json")
    try:
        with open(path, encoding="utf-8") as f:
            uid = json.load(f).get("user_id")
        return uid if isinstance(uid, str) and MXID_RE.match(uid) else None
    except (OSError, ValueError):
        return None


def _directory(mx, term, limit=20):
    res = mx.request("POST", "/user_directory/search", {"search_term": term, "limit": limit})
    return [
        {"mxid": r.get("user_id"), "name": r.get("display_name") or ""}
        for r in res.get("results", [])
        if isinstance(r.get("user_id"), str)
    ]


def resolve_recipient(mx, to):
    """Turn `to` (an mxid, an identity name, or a person's name) into one verified mxid."""
    to = (to or "").strip()
    if not to:
        raise ToolError("`to` is empty")
    if to.startswith("@"):
        if not MXID_RE.match(to):
            raise ToolError(f"{to!r} isn't a valid Matrix ID")
        if not mx.profile_exists(to):
            raise ToolError(f"{to} does not exist on the homeserver — not sending")
        return to
    local = _local_identity_mxid(to.lower())
    if local:
        return local
    hits = _directory(mx, to)
    key = to.lower()
    exact = [h for h in hits if h["mxid"][1:].split(":")[0].lower() == key or h["name"].lower() == key]
    if len(exact) == 1:
        return exact[0]["mxid"]
    pick = exact or hits
    if not pick:
        raise ToolError(f"no account matches {to!r}. Try find(), or pass a full Matrix ID.")
    listing = "; ".join(f"{h['mxid']} ({h['name']})" for h in pick[:10])
    raise ToolError(f"{to!r} matches several accounts — pass one Matrix ID as `to`: {listing}")


# One lock per (identity, account): two concurrent sends to the same new peer must not
# each create a DM room.
_dm_locks = {}
_dm_locks_guard = threading.Lock()
# (identity, account, peer) -> room_id. Re-verified on every use.
_dm_cache = {}


def _dm_lock(mx):
    key = (mx.identity, mx.account)
    with _dm_locks_guard:
        return _dm_locks.setdefault(key, threading.Lock())


def _is_dm_with(mx, room_id, peer):
    try:
        mem = mx.members(room_id)
    except ToolError:
        return False
    return mem.get(mx.me) == "join" and peer in mem and set(mem) == {mx.me, peer}


def find_or_create_dm(mx, peer):
    """Existing two-person room with `peer` (most recently active wins), else a new one."""
    if peer == mx.me:
        raise ToolError("that's your own account")
    with _dm_lock(mx):
        ck = (mx.identity, mx.account, peer)
        cached = _dm_cache.get(ck)
        if cached and _is_dm_with(mx, cached, peer):
            return cached, False

        q_me = urllib.parse.quote(mx.me, safe="")
        try:
            direct = mx.request("GET", f"/user/{q_me}/account_data/m.direct") or {}
        except ToolError:
            direct = {}
        candidates = list(dict.fromkeys(direct.get(peer, [])))
        joined = mx.request("GET", "/joined_rooms").get("joined_rooms", [])
        candidates += [r for r in joined if r not in candidates]

        found = []
        for rid in candidates[:DM_SCAN_LIMIT]:
            if rid in joined and _is_dm_with(mx, rid, peer):
                found.append(rid)
        if found:
            best = max(found, key=mx.last_activity) if len(found) > 1 else found[0]
            _dm_cache[ck] = best
            _remember_direct(mx, direct, peer, best)
            return best, False

        res = mx.request("POST", "/createRoom", {
            "preset": "trusted_private_chat",
            "is_direct": True,
            "invite": [peer],
        })
        rid = res.get("room_id")
        if not rid:
            raise ToolError("createRoom returned no room_id")
        _dm_cache[ck] = rid
        _remember_direct(mx, direct, peer, rid)
        log(f"[relay-mcp] dm-created identity={mx.identity} account={mx.account} peer={peer} room={rid}")
        return rid, True


def _remember_direct(mx, direct, peer, rid):
    rooms = direct.get(peer, [])
    if rooms[:1] == [rid]:
        return
    direct = dict(direct)
    direct[peer] = [rid] + [r for r in rooms if r != rid]
    q_me = urllib.parse.quote(mx.me, safe="")
    try:
        mx.request("PUT", f"/user/{q_me}/account_data/m.direct", direct)
    except ToolError as e:
        log(f"[relay-mcp] m.direct-update-failed identity={mx.identity} peer={peer} error={e}")


def resolve_target(mx, args):
    """(room_id, created) from exactly one of `to` / `room`."""
    to, room = args.get("to"), args.get("room")
    if bool(to) == bool(room):
        raise ToolError("pass exactly one of `to` (who) or `room` (a !room:server id)")
    if room:
        if not ROOM_RE.match(room):
            raise ToolError(f"{room!r} isn't a room id (expected !something:server)")
        mem = mx.members(room)
        if mem.get(mx.me) != "join":
            q = urllib.parse.quote(room, safe="")
            mx.request("POST", f"/join/{q}", {})
        return room, False
    return find_or_create_dm(mx, resolve_recipient(mx, to))


def _recipients(mx, room_id):
    mem = mx.members(room_id)
    return [{"mxid": m, "membership": s} for m, s in sorted(mem.items()) if m != mx.me]


def _send_event(mx, room_id, content):
    q = urllib.parse.quote(room_id, safe="")
    txn = secrets.token_hex(8)
    res = mx.request("PUT", f"/rooms/{q}/send/m.room.message/{txn}", content)
    eid = res.get("event_id")
    if not eid:
        raise ToolError("the homeserver accepted the send but returned no event_id")
    return eid


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

ACCOUNT_PROP = {
    "type": "string",
    "description": "Which of your relay accounts to use (default \"relay\"). Only needed if you hold another, e.g. for a second homeserver.",
}
TO_PROP = {
    "type": "string",
    "description": "Who to message: a Matrix ID (@name:server), an agent's identity name on this box, or a person's name. Your existing DM room with them is reused, or one is created.",
}
ROOM_PROP = {"type": "string", "description": "An existing room id (!something:server), e.g. the room a message came from. Use instead of `to`."}

TOOLS = [
    {
        "name": "send",
        "description": "Send a relay message as you. Give `to` (a person or agent) OR `room` (to reply where a message came from). Returns the room and who is in it.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "to": TO_PROP,
                "room": ROOM_PROP,
                "body": {"type": "string", "description": "The message text. Markdown is fine."},
                "account": ACCOUNT_PROP,
            },
            "required": ["body"],
        },
    },
    {
        "name": "send_file",
        "description": "Send a file from this machine as a relay attachment. Same addressing as send.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "to": TO_PROP,
                "room": ROOM_PROP,
                "path": {"type": "string", "description": "Absolute path of the file to send."},
                "caption": {"type": "string", "description": "Optional message sent right after the file."},
                "account": ACCOUNT_PROP,
            },
            "required": ["path"],
        },
    },
    {
        "name": "find",
        "description": "Look up relay accounts by name (agents on this box, then the homeserver directory). Use the Matrix ID it returns; never build one yourself.",
        "inputSchema": {
            "type": "object",
            "properties": {"name": {"type": "string"}, "account": ACCOUNT_PROP},
            "required": ["name"],
        },
    },
    {
        "name": "list_rooms",
        "description": "Rooms you are in, with their names and members.",
        "inputSchema": {"type": "object", "properties": {"account": ACCOUNT_PROP}},
    },
    {
        "name": "create_room",
        "description": "Create a group room with several people (for one person, just send(to=...)). Give it a short descriptive name like sftp-diagnosis-0610.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "invite": {"type": "array", "items": {"type": "string"}, "description": "Matrix IDs, identity names or people's names."},
                "name": {"type": "string"},
                "account": ACCOUNT_PROP,
            },
            "required": ["invite", "name"],
        },
    },
]


def tool_send(mx, args):
    body = args.get("body")
    if not isinstance(body, str) or not body.strip():
        raise ToolError("`body` is empty")
    room_id, created = resolve_target(mx, args)
    eid = _send_event(mx, room_id, {"msgtype": "m.text", "body": body})
    log(f"[relay-mcp] sent identity={mx.identity} account={mx.account} room={room_id} event={eid} created={created} bodyLen={len(body)}")
    return {"ok": True, "room_id": room_id, "event_id": eid, "new_room": created, "recipients": _recipients(mx, room_id)}


def _mime(path):
    import mimetypes
    return mimetypes.guess_type(path)[0] or "application/octet-stream"


def tool_send_file(mx, args):
    path = args.get("path") or ""
    if not os.path.isabs(path) or not os.path.isfile(path):
        raise ToolError(f"{path!r} isn't an existing absolute file path")
    size = os.path.getsize(path)
    if size > MAX_FILE:
        raise ToolError(f"file is {size} bytes; limit is {MAX_FILE}")
    room_id, created = resolve_target(mx, args)
    name = os.path.basename(path)
    mime = _mime(path)
    with open(path, "rb") as f:
        data = f.read()
    up = mx.request("POST", f"/_matrix/media/v3/upload?filename={urllib.parse.quote(name)}",
                    raw=data, content_type=mime, root=mx.media_root)
    mxc = up.get("content_uri")
    if not mxc:
        raise ToolError("upload returned no content_uri")
    msgtype = {"image": "m.image", "audio": "m.audio", "video": "m.video"}.get(mime.split("/")[0], "m.file")
    eid = _send_event(mx, room_id, {"msgtype": msgtype, "url": mxc, "body": name, "info": {"mimetype": mime, "size": size}})
    out = {"ok": True, "room_id": room_id, "event_id": eid, "new_room": created, "file": name}
    caption = args.get("caption")
    if isinstance(caption, str) and caption.strip():
        out["caption_event_id"] = _send_event(mx, room_id, {"msgtype": "m.text", "body": caption})
    out["recipients"] = _recipients(mx, room_id)
    log(f"[relay-mcp] sent-file identity={mx.identity} account={mx.account} room={room_id} event={eid} size={size} mime={mime}")
    return out


def tool_find(mx, args):
    name = (args.get("name") or "").strip()
    if not name:
        raise ToolError("`name` is empty")
    results = []
    local = _local_identity_mxid(name.lower())
    if local:
        results.append({"mxid": local, "name": name.lower(), "source": "this box"})
    for h in _directory(mx, name):
        if h["mxid"] != local:
            results.append({**h, "source": "directory"})
    return {"ok": True, "results": results}


def tool_list_rooms(mx, args):
    rooms = []
    for rid in mx.request("GET", "/joined_rooms").get("joined_rooms", [])[:DM_SCAN_LIMIT]:
        try:
            mem = mx.members(rid)
        except ToolError:
            continue
        rooms.append({
            "room_id": rid,
            "name": mx.room_name(rid),
            "members": sorted(m for m in mem if m != mx.me),
        })
    return {"ok": True, "rooms": rooms}


def tool_create_room(mx, args):
    invite = args.get("invite")
    name = (args.get("name") or "").strip()
    if not isinstance(invite, list) or not invite:
        raise ToolError("`invite` must list at least one person")
    if not name:
        raise ToolError("`name` is empty")
    mxids = list(dict.fromkeys(resolve_recipient(mx, str(p)) for p in invite))
    res = mx.request("POST", "/createRoom", {"preset": "private_chat", "name": name, "invite": mxids})
    rid = res.get("room_id")
    if not rid:
        raise ToolError("createRoom returned no room_id")
    log(f"[relay-mcp] room-created identity={mx.identity} account={mx.account} room={rid} invited={len(mxids)}")
    return {"ok": True, "room_id": rid, "name": name, "invited": mxids}


HANDLERS = {
    "send": tool_send,
    "send_file": tool_send_file,
    "find": tool_find,
    "list_rooms": tool_list_rooms,
    "create_room": tool_create_room,
}


def call_tool(identity, name, args):
    handler = HANDLERS.get(name)
    if not handler:
        return {"content": [{"type": "text", "text": f"unknown tool {name!r}"}], "isError": True}
    started = time.monotonic()
    try:
        mx = Matrix(identity, (args or {}).get("account") or "relay")
        result = handler(mx, args or {})
        log(f"[relay-mcp] call identity={identity} tool={name} ok=true ms={int((time.monotonic() - started) * 1000)}")
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
    except ToolError as e:
        log(f"[relay-mcp] call identity={identity} tool={name} ok=false ms={int((time.monotonic() - started) * 1000)} error={e}")
        return {"content": [{"type": "text", "text": f"relay error: {e}"}], "isError": True}
    except Exception as e:  # never let one bad call take the server down
        log(f"[relay-mcp] call identity={identity} tool={name} ok=false crash={type(e).__name__}: {e}")
        return {"content": [{"type": "text", "text": f"relay error: internal {type(e).__name__}: {e}"}], "isError": True}


# ---------------------------------------------------------------------------
# MCP over HTTP
# ---------------------------------------------------------------------------

def handle_rpc(identity, msg):
    """One JSON-RPC message in, one response dict out (None for notifications)."""
    if not isinstance(msg, dict):
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "invalid request"}}
    mid = msg.get("id")
    method = msg.get("method")
    if mid is None:
        return None  # notification (initialized, cancelled, ...) or a client response
    params = msg.get("params") or {}
    if method == "initialize":
        result = {
            "protocolVersion": params.get("protocolVersion") or "2025-06-18",
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVER_INFO,
            "instructions": INSTRUCTIONS,
        }
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        if not identity:
            result = {"content": [{"type": "text", "text": "relay error: this session has no FLEET_IDENTITY, so the relay doesn't know who you are"}], "isError": True}
        else:
            result = call_tool(identity, params.get("name"), params.get("arguments"))
    else:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}}
    return {"jsonrpc": "2.0", "id": mid, "result": result}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "relay-mcp"

    def log_message(self, *a):
        pass

    def _reply(self, code, payload=None):
        body = b"" if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        if payload is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _refuse_browser(self):
        if self.headers.get("Origin"):
            self._reply(403, {"error": "browser requests are not accepted"})
            return True
        return False

    def do_GET(self):
        if self.path == "/health":
            self._reply(200, {"ok": True})
            return
        self._reply(405)  # no server-initiated stream

    def do_DELETE(self):
        self._reply(200)  # stateless: nothing to tear down

    def do_POST(self):
        if self._refuse_browser():
            return
        if self.path.split("?")[0] != "/mcp":
            self._reply(404)
            return
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            self._reply(415, {"error": "Content-Type must be application/json"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n < 0 or n > MAX_BODY:
            self._reply(413)
            return
        try:
            msg = json.loads(self.rfile.read(n) or b"null")
        except ValueError:
            self._reply(400, {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
            return
        identity = (self.headers.get("X-Fleet-Identity") or "").strip().lower()
        if identity and not NAME_RE.match(identity):
            identity = ""
        if isinstance(msg, list):
            out = [r for r in (handle_rpc(identity, m) for m in msg) if r is not None]
            self._reply(200, out) if out else self._reply(202)
            return
        if isinstance(msg, dict) and msg.get("method") == "initialize":
            log(f"[relay-mcp] session-init identity={identity or '<none>'} client={json.dumps((msg.get('params') or {}).get('clientInfo'))}")
        res = handle_rpc(identity, msg)
        self._reply(202) if res is None else self._reply(200, res)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    srv = Server(("127.0.0.1", PORT), Handler)
    log(f"[relay-mcp] listening 127.0.0.1:{PORT} identities={IDENTITIES}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())
