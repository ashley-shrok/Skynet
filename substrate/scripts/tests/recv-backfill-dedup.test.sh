#!/usr/bin/env bash
# Test driver for recv.sh's post-join backfill dedup.
#
# Reproduces the race: sync 1 surfaces an invite, the receiver joins and backfills the room
# (the opener is already there), then sync 2 carries the SAME opener in the joined room's
# timeline. Before the fix the opener woke the agent twice with the same event id.
#
# Cases:
#   T-01 opener caught by backfill and repeated in the next sync -> surfaced exactly once
#   T-02 a newer message in that same next sync                  -> still surfaced
#
# Usage: bash substrate/scripts/tests/recv-backfill-dedup.test.sh   (from the repo root)
# Requirements: bash, jq, curl, python3.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
RECV="${RECV:-$REPO_ROOT/substrate/skills/agent-relay/recv.sh}"

for _tool in jq curl python3; do
  command -v "$_tool" >/dev/null 2>&1 || { printf 'FATAL: %s not found\n' "$_tool" >&2; exit 1; }
done

SCRATCH=$(mktemp -d)
SRV_PID=""; RECV_PID=""
cleanup(){
  [ -n "$RECV_PID" ] && kill "$RECV_PID" 2>/dev/null
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

PORT_FILE="$SCRATCH/port"
cat > "$SCRATCH/fake_matrix.py" <<'PY'
import json, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ME = "@me:test"
ROOM = "!room:test"
OPENER = {"type": "m.room.message", "sender": "@peer:test", "event_id": "$opener",
          "content": {"msgtype": "m.text", "body": "hello from peer"}}
LATER = {"type": "m.room.message", "sender": "@peer:test", "event_id": "$later",
         "content": {"msgtype": "m.text", "body": "second message"}}
syncs = {"n": 0}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, obj):
        b = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/account/whoami" in p:
            return self._send({"user_id": ME})
        if "/joined_members" in p:
            return self._send({"joined": {ME: {}, "@peer:test": {}}})
        if "/messages" in p:
            return self._send({"chunk": [OPENER]})
        if "/sync" in p:
            syncs["n"] += 1
            n = syncs["n"]
            if n == 1:
                return self._send({"next_batch": "s1", "rooms": {"invite": {ROOM: {}}}})
            if n == 2:
                return self._send({"next_batch": "s2", "rooms": {"join": {ROOM: {
                    "timeline": {"events": [OPENER, LATER]}}}}})
            time.sleep(0.5)
            return self._send({"next_batch": "s%d" % n})
        self._send({})
    def do_POST(self):
        self._send({})

srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
open(sys.argv[1], "w").write(str(srv.server_address[1]))
srv.serve_forever()
PY

python3 "$SCRATCH/fake_matrix.py" "$PORT_FILE" &
SRV_PID=$!
for _ in $(seq 1 50); do [ -s "$PORT_FILE" ] && break; sleep 0.1; done
PORT=$(cat "$PORT_FILE")

ID_DIR="$SCRATCH/identity"; STATE="$ID_DIR/relay-state"; mkdir -p "$STATE"
jq -n --arg b "http://127.0.0.1:$PORT/_matrix/client/v3" \
  '{base:$b, user_id:"@me:test", token:"tok", password:"pw"}' > "$ID_DIR/relay.json"
printf 's0' > "$STATE/since"

STATE_DIR="$STATE" RELAY_CREDS="$ID_DIR/relay.json" AMBIENT_MONITOR_HARNESS_PID=$$ \
  bash "$RECV" > "$SCRATCH/out" 2> "$SCRATCH/err" &
RECV_PID=$!
for _ in $(seq 1 50); do grep -q '\$later' "$SCRATCH/out" 2>/dev/null && break; sleep 0.1; done
sleep 1

PASS=0; FAIL=0; FAILURES=()
check(){ if eval "$2"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILURES+=("$1"); fi; }

opener_count=$(grep -c '(event \$opener)' "$SCRATCH/out")
later_count=$(grep -c '(event \$later)' "$SCRATCH/out")
check "T-01 opener surfaced once (got $opener_count)" '[ "$opener_count" -eq 1 ]'
check "T-02 later message surfaced (got $later_count)" '[ "$later_count" -eq 1 ]'

echo "==============================="
echo "PASS: $PASS  FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"; for f in "${FAILURES[@]}"; do echo "  - $f"; done
  echo "--- stdout ---"; cat "$SCRATCH/out"; echo "--- stderr ---"; cat "$SCRATCH/err"
  exit 1
fi
exit 0
