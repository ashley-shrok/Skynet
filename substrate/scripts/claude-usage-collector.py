#!/usr/bin/env python3
"""claude-usage-collector — keeps the freshest Claude Code rate-limit reading and serves it.

Reporters (statusline wrappers on active boxes) POST:
  { "five_hour": {"used_percentage": N, "resets_at": unix_s},
    "seven_day": {"used_percentage": N, "resets_at": unix_s},
    "source_box": "<host>", "ts": unix_s }
Collector keeps the freshest report (by ts) that carries five_hour, and serves on GET:
  { "five_hour": {...}, "seven_day": {...}, "updated_at": unix_s, "source_box": "<host>" }

Tailnet/LAN/loopback only (source-IP gated). Bind 0.0.0.0 so boot-order (tailscale IP
not up yet) never blocks the bind; the IP gate keeps it private.
"""
import json, os, ipaddress, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("CLAUDE_USAGE_PORT", "9421"))
STATE = os.environ.get("CLAUDE_USAGE_STATE", "/var/lib/claude-usage/latest.json")
ALLOWED_NETS = [ipaddress.ip_network(n) for n in
                ("127.0.0.0/8", "100.64.0.0/10", "192.168.111.0/24", "::1/128")]
_lock = threading.Lock()

def _load():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {}

def _save(d):
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f)
    os.replace(tmp, STATE)

def _allowed(ip):
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(a in n for n in ALLOWED_NETS)

def _get_view():
    d = _load()
    return {
        "five_hour": d.get("five_hour"),
        "seven_day": d.get("seven_day"),
        "updated_at": d.get("ts"),
        "source_box": d.get("source_box"),
    }

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a):
        pass
    def _client_ok(self):
        if not _allowed(self.client_address[0]):
            self._send(403, {"error": "forbidden"})
            return False
        return True
    def do_GET(self):
        if not self._client_ok():
            return
        if self.path.rstrip("/") in ("", "/usage", "/claude-usage"):
            self._send(200, _get_view())
        elif self.path.rstrip("/") == "/health":
            self._send(200, {"status": "ok"})
        else:
            self._send(404, {"error": "not found"})
    def do_POST(self):
        if not self._client_ok():
            return
        if self.path.rstrip("/") not in ("/report", "/usage", ""):
            self._send(404, {"error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            report = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            self._send(400, {"error": "bad json"})
            return
        fh = report.get("five_hour")
        if not isinstance(fh, dict) or "used_percentage" not in fh:
            # nothing usable (early session before first response) — accept quietly, don't store
            self._send(200, {"ok": True, "stored": False, "reason": "no five_hour data"})
            return
        try:
            ts = float(report.get("ts") or 0)
        except (TypeError, ValueError):
            ts = 0.0
        now = time.time()
        if ts <= 0 or ts > now + 300:   # missing or absurd-future ts -> stamp on arrival
            ts = now

        # Reject snapshots from an already-EXPIRED 5h window. An idle Claude Code session
        # keeps posting its last rate_limits until it hits a new response, so `resets_at`
        # from a completed window is stale-data-with-a-fresh-ts and must never be stored.
        # (This closes the hole the old resets_at tiebreaker was papering over.)
        try:
            inc_reset = float(fh.get("resets_at") or 0)
        except (TypeError, ValueError):
            inc_reset = 0.0
        if inc_reset > 0 and inc_reset <= now:
            self._send(200, {"ok": True, "stored": False, "reason": "five_hour window expired"})
            return

        with _lock:
            cur = _load()
            cur_ts = float(cur.get("ts") or 0)
            # Last-write-wins by post ts. `resets_at` is per-ACCOUNT, so it can't be a
            # currency signal when boxes are on different accounts — the expired-window
            # reject above handles the idle-stale-snapshot risk instead.
            if not cur or ts >= cur_ts:
                _save({
                    "five_hour": fh,
                    "seven_day": report.get("seven_day"),
                    "source_box": report.get("source_box"),
                    "ts": ts,
                })
                stored = True
            else:
                stored = False
        self._send(200, {"ok": True, "stored": stored})

if __name__ == "__main__":
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
    print(f"claude-usage-collector listening on :{PORT} (state={STATE})", flush=True)
    srv.serve_forever()
