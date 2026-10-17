#!/usr/bin/env python3
"""relay-mcp against a fake Matrix homeserver.

Runs the real substrate/scripts/relay-mcp.py as a subprocess pointed at a scratch fleet
dir, with a stdlib fake homeserver standing in for Synapse, and drives it over MCP HTTP
the way Claude Code does. Run from the repo root:

    python3 substrate/scripts/tests/test_relay_mcp.py

Prints PASS/FAIL per test and a `PASS: n  FAIL: m` summary; exits non-zero on failure.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.environ.get("RELAY_MCP", os.path.join(HERE, "..", "relay-mcp.py"))
HS = "test.local"
ME = f"@alpha-box-maintainer:{HS}"
BETA = f"@beta-box-maintainer:{HS}"
ASHLEY = f"@ashley:{HS}"
GOOD_TOKEN = "tok-good"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


# ---------------------------------------------------------------------------
# Fake homeserver
# ---------------------------------------------------------------------------

class World:
    def __init__(self):
        self.lock = threading.Lock()
        self.users = {ME: "alpha", BETA: "beta", ASHLEY: "Ashley", f"@ashley-two:{HS}": "Ashley"}
        self.rooms = {}  # rid -> {"members": {mxid: membership}, "name": str, "events": [..]}
        self.direct = {}  # owner mxid -> m.direct content
        self.create_calls = 0
        self.join_calls = []
        self.uploads = []
        self.token_rotations = 0
        self.on_unknown_token = None  # callback when a stale token is seen
        self.seq = 0

    def add_room(self, members, name="", last_ts=0):
        with self.lock:
            self.seq += 1
            rid = f"!r{self.seq}:{HS}"
            self.rooms[rid] = {"members": dict(members), "name": name, "events": []}
            if last_ts:
                self.rooms[rid]["events"].append({"origin_server_ts": last_ts, "content": {"body": "old"}})
            return rid


class FakeHS(BaseHTTPRequestHandler):
    world: World = None
    valid_tokens = {GOOD_TOKEN}

    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def _auth(self):
        tok = (self.headers.get("Authorization") or "").replace("Bearer ", "")
        if tok in self.valid_tokens:
            return True
        if self.world.on_unknown_token:
            self.world.on_unknown_token()
        self._send(401, {"errcode": "M_UNKNOWN_TOKEN", "error": "bad token"})
        return False

    def _route(self, method):
        w = self.world
        u = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(u.path)
        raw = self._body()
        if not self._auth():
            return
        c = "/_matrix/client/v3"
        if method == "POST" and path == "/_matrix/media/v3/upload":
            w.uploads.append({"len": len(raw), "type": self.headers.get("Content-Type")})
            return self._send(200, {"content_uri": f"mxc://{HS}/m{len(w.uploads)}"})
        if not path.startswith(c):
            return self._send(404, {"errcode": "M_UNRECOGNIZED"})
        p = path[len(c):]
        body = json.loads(raw) if raw else {}
        if p == "/createRoom":
            time.sleep(0.2)  # outside the lock: widens the window for the concurrency test
        with w.lock:
            if method == "GET" and p.startswith("/profile/"):
                mx = p[len("/profile/"):]
                if mx in w.users:
                    return self._send(200, {"displayname": w.users[mx]})
                return self._send(404, {"errcode": "M_NOT_FOUND"})
            if method == "POST" and p == "/user_directory/search":
                term = body.get("search_term", "").lower()
                res = [{"user_id": m, "display_name": n} for m, n in w.users.items()
                       if term in m.lower() or term in n.lower()]
                return self._send(200, {"results": res, "limited": False})
            if p == f"/user/{ME}/account_data/m.direct":
                if method == "GET":
                    if ME not in w.direct:
                        return self._send(404, {"errcode": "M_NOT_FOUND"})
                    return self._send(200, w.direct[ME])
                w.direct[ME] = body
                return self._send(200, {})
            if method == "GET" and p == "/joined_rooms":
                return self._send(200, {"joined_rooms": [r for r, d in w.rooms.items() if d["members"].get(ME) == "join"]})
            if method == "POST" and p == "/createRoom":
                w.create_calls += 1
                w.seq += 1
                rid = f"!r{w.seq}:{HS}"
                mem = {ME: "join"}
                for inv in body.get("invite", []):
                    mem[inv] = "invite"
                w.rooms[rid] = {"members": mem, "name": body.get("name", ""), "events": [], "create": body}
                return self._send(200, {"room_id": rid})
            if method == "POST" and p.startswith("/join/"):
                rid = p[len("/join/"):]
                w.join_calls.append(rid)
                w.rooms[rid]["members"][ME] = "join"
                return self._send(200, {"room_id": rid})
            if p.startswith("/rooms/"):
                rest = p[len("/rooms/"):]
                rid, _, sub = rest.partition("/")
                room = w.rooms.get(rid)
                if room is None:
                    return self._send(404, {"errcode": "M_NOT_FOUND"})
                if method == "GET" and sub == "members":
                    chunk = [{"type": "m.room.member", "state_key": m, "content": {"membership": s}}
                             for m, s in room["members"].items() if s != "leave"]
                    return self._send(200, {"chunk": chunk})
                if method == "GET" and sub == "messages":
                    ev = room["events"][-1:]
                    return self._send(200, {"chunk": list(reversed(ev))})
                if method == "GET" and sub == "state/m.room.name":
                    if room["name"]:
                        return self._send(200, {"name": room["name"]})
                    return self._send(404, {"errcode": "M_NOT_FOUND"})
                if method == "PUT" and sub.startswith("send/m.room.message/"):
                    if room["members"].get(ME) != "join":
                        return self._send(403, {"errcode": "M_FORBIDDEN"})
                    eid = f"$e{len(room['events']) + 1}-{rid}"
                    room["events"].append({"origin_server_ts": int(time.time() * 1000), "content": body, "event_id": eid})
                    return self._send(200, {"event_id": eid})
        return self._send(404, {"errcode": "M_UNRECOGNIZED", "path": p})

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PUT(self):
        self._route("PUT")


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------

class Env:
    def __init__(self):
        self.tmp = tempfile.mkdtemp(prefix="relay-mcp-test-")
        self.world = World()
        FakeHS.world = self.world
        FakeHS.valid_tokens = {GOOD_TOKEN}
        self.hs_port = free_port()
        self.hs = ThreadingHTTPServer(("127.0.0.1", self.hs_port), FakeHS)
        threading.Thread(target=self.hs.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.hs_port}/_matrix/client/v3"
        self.fleet = os.path.join(self.tmp, "fleet")
        self.make_identity("alpha-box-maintainer", ME)
        self.make_identity("beta-box-maintainer", BETA)
        self.port = free_port()
        self.log_path = os.path.join(self.tmp, "relay-mcp.log")
        self.proc = subprocess.Popen(
            [sys.executable, SCRIPT],
            env={**os.environ, "RELAY_MCP_PORT": str(self.port), "RELAY_MCP_FLEET_DIR": self.fleet,
                 "RELAY_MCP_MAX_HANDLERS": "4", "RELAY_MCP_IDLE_TIMEOUT": "1"},
            stdout=open(self.log_path, "w"), stderr=subprocess.STDOUT,
        )
        for _ in range(100):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{self.port}/health", timeout=1)
                break
            except OSError:
                time.sleep(0.05)
        else:
            raise RuntimeError("relay-mcp did not come up: " + open(self.log_path).read())
        self.rpc_id = 0

    def make_identity(self, name, mxid):
        idir = os.path.join(self.fleet, "identities", name)
        st = os.path.join(idir, "relay-state")
        os.makedirs(st, exist_ok=True)
        with open(os.path.join(idir, "relay.json"), "w") as f:
            json.dump({"base": self.base, "user_id": mxid, "token": GOOD_TOKEN, "access_token": GOOD_TOKEN}, f)
        for k, v in (("token", GOOD_TOKEN), ("base", self.base), ("uid", mxid)):
            with open(os.path.join(st, k), "w") as f:
                f.write(v + "\n")
        return st

    def post(self, payload, identity="alpha-box-maintainer", headers=None):
        h = {"Content-Type": "application/json"}
        if identity:
            h["X-Fleet-Identity"] = identity
        h.update(headers or {})
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/mcp", data=json.dumps(payload).encode(), headers=h, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            return e.code, (json.loads(raw) if raw else None)

    def call(self, tool, args, identity="alpha-box-maintainer"):
        self.rpc_id += 1
        _, res = self.post({"jsonrpc": "2.0", "id": self.rpc_id, "method": "tools/call",
                            "params": {"name": tool, "arguments": args}}, identity=identity)
        r = res["result"]
        text = r["content"][0]["text"]
        if r.get("isError"):
            return None, text
        return json.loads(text), None

    def close(self):
        self.proc.terminate()
        self.proc.wait(timeout=5)
        self.hs.shutdown()
        shutil.rmtree(self.tmp, ignore_errors=True)


# ---------------------------------------------------------------------------
# Tests — each gets a fresh Env
# ---------------------------------------------------------------------------

def t_initialize_and_list(e):
    code, res = e.post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}})
    assert code == 200 and res["result"]["serverInfo"]["name"] == "relay", res
    assert res["result"]["protocolVersion"] == "2025-06-18"
    code, _ = e.post({"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert code == 202, code
    _, res = e.post({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    names = [t["name"] for t in res["result"]["tools"]]
    assert names == ["send", "send_file", "find", "list_rooms", "create_room"], names


def t_send_creates_dm_then_reuses(e):
    out, err = e.call("send", {"to": "beta-box-maintainer", "body": "hello"})
    assert err is None, err
    assert out["new_room"] is True and e.world.create_calls == 1
    rid = out["room_id"]
    assert out["recipients"] == [{"mxid": BETA, "membership": "invite"}], out
    assert e.world.rooms[rid]["create"]["is_direct"] is True
    assert e.world.direct[ME] == {BETA: [rid]}
    out2, err = e.call("send", {"to": BETA, "body": "again"})
    assert err is None, err
    assert out2["room_id"] == rid and out2["new_room"] is False
    assert e.world.create_calls == 1
    assert [ev["content"]["body"] for ev in e.world.rooms[rid]["events"]] == ["hello", "again"]


def t_reuses_existing_dm_without_m_direct(e):
    rid = e.world.add_room({ME: "join", ASHLEY: "join"})
    e.world.add_room({ME: "join", ASHLEY: "join", BETA: "join"})  # group, not a DM
    out, err = e.call("send", {"to": ASHLEY, "body": "hi"})
    assert err is None, err
    assert out["room_id"] == rid and e.world.create_calls == 0
    assert e.world.direct[ME][ASHLEY] == [rid]


def t_picks_most_recent_dm(e):
    e.world.add_room({ME: "join", BETA: "join"}, last_ts=1000)
    recent = e.world.add_room({ME: "join", BETA: "join"}, last_ts=5000)
    e.world.add_room({ME: "join", BETA: "join"}, last_ts=3000)
    out, err = e.call("send", {"to": "beta-box-maintainer", "body": "x"})
    assert err is None, err
    assert out["room_id"] == recent, (out["room_id"], recent)


def t_ignores_dm_peer_has_left(e):
    e.world.add_room({ME: "join", BETA: "leave"})
    out, err = e.call("send", {"to": BETA, "body": "x"})
    assert err is None, err
    assert out["new_room"] is True and e.world.create_calls == 1


def t_refuses_unknown_and_ambiguous(e):
    _, err = e.call("send", {"to": f"@ghost:{HS}", "body": "x"})
    assert err and "does not exist" in err, err
    _, err = e.call("send", {"to": "ashley", "body": "x"})
    assert err and "several accounts" in err and ASHLEY in err, err
    _, err = e.call("send", {"to": "nobody-at-all", "body": "x"})
    assert err and "no account matches" in err, err
    assert e.world.create_calls == 0
    _, err = e.call("send", {"to": "@not valid", "body": "x"})
    assert err and "valid Matrix ID" in err, err


def t_argument_errors(e):
    _, err = e.call("send", {"body": "x"})
    assert err and "exactly one of" in err, err
    _, err = e.call("send", {"to": BETA, "room": "!r1:test.local", "body": "x"})
    assert err and "exactly one of" in err, err
    _, err = e.call("send", {"to": BETA, "body": "   "})
    assert err and "empty" in err, err
    _, err = e.call("send", {"room": "general", "body": "x"})
    assert err and "isn't a room id" in err, err
    _, err = e.call("nope", {})
    assert err and "unknown tool" in err, err


def t_send_to_room_joins_if_needed(e):
    rid = e.world.add_room({ME: "invite", BETA: "join", ASHLEY: "join"})
    out, err = e.call("send", {"room": rid, "body": "group hello"})
    assert err is None, err
    assert e.world.join_calls == [rid]
    assert sorted(r["mxid"] for r in out["recipients"]) == sorted([BETA, ASHLEY])


def t_unicode_body_roundtrip(e):
    body = "em—dash “curly” emoji 🚀 and\nnewline"
    out, err = e.call("send", {"to": BETA, "body": body})
    assert err is None, err
    assert e.world.rooms[out["room_id"]]["events"][-1]["content"] == {"msgtype": "m.text", "body": body}


def t_concurrent_sends_one_room(e):
    results = []

    def go(i):
        results.append(e.call("send", {"to": BETA, "body": f"m{i}"}))

    th = [threading.Thread(target=go, args=(i,)) for i in range(4)]
    for t in th:
        t.start()
    for t in th:
        t.join()
    assert all(err is None for _, err in results), results
    assert e.world.create_calls == 1, e.world.create_calls
    assert len({out["room_id"] for out, _ in results}) == 1


def t_stale_token_picks_up_receivers_refresh(e):
    st = os.path.join(e.fleet, "identities", "alpha-box-maintainer", "relay-state")
    with open(os.path.join(st, "token"), "w") as f:
        f.write("tok-stale\n")
    FakeHS.valid_tokens = {"tok-fresh"}

    def receiver_relogs():  # what recv.sh does on M_UNKNOWN_TOKEN
        with open(os.path.join(st, "token"), "w") as f:
            f.write("tok-fresh\n")
        e.world.token_rotations += 1

    e.world.on_unknown_token = receiver_relogs
    out, err = e.call("find", {"name": "beta"})
    assert err is None, err
    assert e.world.token_rotations == 1


def t_dead_token_reports_error(e):
    FakeHS.valid_tokens = {"something-else"}
    _, err = e.call("find", {"name": "beta"})
    assert err and "M_UNKNOWN_TOKEN" in err, err


def t_identity_handling(e):
    _, err = e.call("find", {"name": "beta"}, identity=None)
    assert err and "no FLEET_IDENTITY" in err, err
    _, err = e.call("find", {"name": "beta"}, identity="no-such-identity")
    assert err and "no relay account" in err, err
    _, err = e.call("find", {"name": "beta"}, identity="../../etc")
    assert err and "no FLEET_IDENTITY" in err, err
    _, err = e.call("find", {"name": "beta"}, identity="beta-box-maintainer")
    assert err is None, err
    _, err = e.call("find", {"name": "beta", "account": "../relay"})
    assert err and "bad account name" in err, err


def t_secondary_account(e):
    idir = os.path.join(e.fleet, "identities", "alpha-box-maintainer")
    shutil.copy(os.path.join(idir, "relay.json"), os.path.join(idir, "other.json"))
    shutil.copytree(os.path.join(idir, "relay-state"), os.path.join(idir, "other-state"))
    out, err = e.call("find", {"name": "beta", "account": "other"})
    assert err is None, err
    _, err = e.call("find", {"name": "beta", "account": "missing"})
    assert err and "no relay account 'missing'" in err, err


def t_refuses_browser_and_bad_requests(e):
    code, _ = e.post({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, headers={"Origin": "http://evil.example"})
    assert code == 403, code
    req = urllib.request.Request(f"http://127.0.0.1:{e.port}/mcp", data=b"{}", headers={"Content-Type": "text/plain"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=5)
        raise AssertionError("text/plain accepted")
    except urllib.error.HTTPError as err:
        assert err.code == 415, err.code
    code, res = e.post({"jsonrpc": "2.0", "id": 9, "method": "bogus/method"})
    assert res["error"]["code"] == -32601, res


def t_send_file(e):
    path = os.path.join(e.tmp, "pic.png")
    with open(path, "wb") as f:
        f.write(b"\x89PNG fake")
    out, err = e.call("send_file", {"to": BETA, "path": path, "caption": "see this"})
    assert err is None, err
    evs = e.world.rooms[out["room_id"]]["events"]
    assert evs[0]["content"]["msgtype"] == "m.image" and evs[0]["content"]["body"] == "pic.png", evs
    assert evs[0]["content"]["info"] == {"mimetype": "image/png", "size": 9}
    assert evs[1]["content"]["body"] == "see this"
    assert e.world.uploads == [{"len": 9, "type": "image/png"}]
    _, err = e.call("send_file", {"to": BETA, "path": "relative.txt"})
    assert err and "absolute file path" in err, err


def t_find_and_list_and_create(e):
    out, err = e.call("find", {"name": "beta-box-maintainer"})
    assert err is None, err
    assert out["results"][0] == {"mxid": BETA, "name": "beta-box-maintainer", "source": "this box"}, out
    assert all(r["mxid"] != BETA for r in out["results"][1:])
    out, err = e.call("create_room", {"invite": ["beta-box-maintainer", ASHLEY], "name": "topic-1017"})
    assert err is None, err
    assert sorted(out["invited"]) == sorted([BETA, ASHLEY])
    out, err = e.call("list_rooms", {})
    assert err is None, err
    assert out["rooms"][0]["name"] == "topic-1017" and sorted(out["rooms"][0]["members"]) == sorted([BETA, ASHLEY])


def t_batch_request(e):
    code, res = e.post([
        {"jsonrpc": "2.0", "id": 1, "method": "ping"},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
    ])
    assert code == 200 and res == [{"jsonrpc": "2.0", "id": 1, "result": {}}], res


def _ping_ok(e, timeout=5):
    req = urllib.request.Request(f"http://127.0.0.1:{e.port}/mcp", method="POST",
                                 data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status == 200


def t_kept_open_connections_dont_block(e):
    # More clients than handler slots, each asking for keep-alive and then
    # holding its socket open: the server must close each after its response.
    socks = []
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}).encode()
    for _ in range(8):
        s = socket.create_connection(("127.0.0.1", e.port), timeout=5)
        s.sendall(b"POST /mcp HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\nContent-Type: application/json\r\n"
                  + f"Content-Length: {len(body)}\r\n\r\n".encode() + body)
        resp = s.recv(65536)
        assert b"200" in resp.split(b"\r\n")[0] and b"Connection: close" in resp, resp[:200]
        socks.append(s)
    try:
        assert _ping_ok(e, timeout=3)
    finally:
        for s in socks:
            s.close()


def t_silent_connections_time_out(e):
    # More silent connections than handler slots: each is dropped after the
    # idle timeout (1s here), so a real request still gets through.
    socks = [socket.create_connection(("127.0.0.1", e.port), timeout=5) for _ in range(6)]
    try:
        t0 = time.monotonic()
        assert _ping_ok(e, timeout=8)
        assert time.monotonic() - t0 < 6
    finally:
        for s in socks:
            s.close()


TESTS = [v for k, v in list(globals().items()) if k.startswith("t_")]


def main():
    passed, failed = 0, []
    for t in TESTS:
        e = Env()
        try:
            t(e)
            passed += 1
            print(f"PASS {t.__name__}")
        except Exception as ex:
            failed.append(t.__name__)
            print(f"FAIL {t.__name__}: {type(ex).__name__}: {ex}")
            print("  relay-mcp log tail:\n    " + "\n    ".join(open(e.log_path).read().splitlines()[-8:]))
        finally:
            e.close()
    print("===============================")
    print(f"PASS: {passed}  FAIL: {len(failed)}")
    for n in failed:
        print(f"  - {n}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
