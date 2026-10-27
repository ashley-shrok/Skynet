#!/usr/bin/env bash
# Test driver for recv.sh's startup wait for an unreachable relay server.
#
# Reproduces the post-reboot case: the receiver starts before the network is up, so the relay
# server doesn't answer. Before the fix the token check failed, the re-login failed, and the
# agent was woken with "AUTH DEAD ... startup relogin failed" although the account was fine.
#
# Cases:
#   T-01 server comes up within the alert window   -> no wake lines; token kept, sync runs
#   T-02 server down past the alert window         -> one RELAY SERVER TROUBLE wake, then one
#                                                     answering-again wake; never AUTH DEAD
#   T-03 server up but token and password rejected -> AUTH DEAD still raised
#   T-04 no token yet, logins 503 for a while      -> no wake lines; logs in once logins work
#   T-05 no token yet, logins always 429           -> one RELAY SERVER TROUBLE wake; never AUTH DEAD
#
# Usage: bash substrate/scripts/tests/recv-server-unreachable.test.sh   (from the repo root)
# Requirements: bash, jq, curl, python3.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
RECV="${RECV:-$REPO_ROOT/substrate/skills/agent-relay/recv.sh}"

for _tool in jq curl python3; do
  command -v "$_tool" >/dev/null 2>&1 || { printf 'FATAL: %s not found\n' "$_tool" >&2; exit 1; }
done

SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT

cat > "$SCRATCH/fake_matrix.py" <<'PY'
import json, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT, MODE = int(sys.argv[1]), sys.argv[2]   # MODE: ok | reject | flaky | ratelimited
ME = "@me:test"
START = time.time()
syncs = {"n": 0}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/client/versions" in p:
            return self._send({"versions": ["v1.11"]})
        if "/account/whoami" in p:
            if MODE == "reject":
                return self._send({"errcode": "M_UNKNOWN_TOKEN", "error": "bad token"}, 401)
            return self._send({"user_id": ME})
        if "/sync" in p:
            syncs["n"] += 1
            time.sleep(0.3)
            return self._send({"next_batch": "s%d" % syncs["n"]})
        self._send({})
    def do_POST(self):
        if "/login" in self.path:
            if MODE == "flaky":
                if time.time() - START < 3:
                    return self._send({"errcode": "M_UNKNOWN", "error": "db not ready"}, 503)
                return self._send({"access_token": "newtok", "user_id": ME})
            if MODE == "ratelimited":
                return self._send({"errcode": "M_LIMIT_EXCEEDED", "retry_after_ms": 500}, 429)
            return self._send({"errcode": "M_FORBIDDEN", "error": "Invalid password"}, 403)
        self._send({})

ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
PY

free_port(){ python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }

# run_case <name> <mode> <server-delay-seconds> <alert-after-seconds> <run-seconds> [token]
# An empty token leaves it out of the creds, as on a fresh account.
run_case(){
  local name=$1 mode=$2 delay=$3 alert=$4 run=$5 tok=${6-tok} port dir recv_pid srv_pid
  port=$(free_port); dir="$SCRATCH/$name"; mkdir -p "$dir/relay-state"
  jq -n --arg b "http://127.0.0.1:$port/_matrix/client/v3" --arg t "$tok" \
    '{base:$b, user_id:"@me:test", password:"pw"} + (if $t == "" then {} else {token:$t} end)' > "$dir/relay.json"
  printf 's0' > "$dir/relay-state/since"
  STATE_DIR="$dir/relay-state" RELAY_CREDS="$dir/relay.json" AMBIENT_MONITOR_HARNESS_PID=$$ \
    UNREACHABLE_ALERT_AFTER="$alert" UNREACHABLE_POLL=1 \
    bash "$RECV" > "$dir/out" 2> "$dir/err" &
  recv_pid=$!
  (sleep "$delay"; exec python3 "$SCRATCH/fake_matrix.py" "$port" "$mode") &
  srv_pid=$!
  sleep "$run"
  kill "$recv_pid" "$srv_pid" 2>/dev/null
}

run_case t1 ok 3 60 6 &
run_case t2 ok 4 1 7 &
run_case t3 reject 0 60 3 &
run_case t4 flaky 0 60 7 "" &
run_case t5 ratelimited 0 1 4 "" &
wait

PASS=0; FAIL=0; FAILURES=()
check(){ if eval "$2"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILURES+=("$1"); fi; }
lines(){ grep -c -- "$2" "$SCRATCH/$1/out" 2>/dev/null; }

t1_out=$(wc -l < "$SCRATCH/t1/out")
t1_since=$(cat "$SCRATCH/t1/relay-state/since")
check "T-01 no wake lines while waiting (got $t1_out)" '[ "$t1_out" -eq 0 ]'
check "T-01 sync ran after server came up (since=$t1_since)" '[ "$t1_since" != "s0" ]'
check "T-02 one RELAY SERVER TROUBLE wake (got $(lines t2 'RELAY SERVER TROUBLE'))" '[ "$(lines t2 "RELAY SERVER TROUBLE")" -eq 1 ]'
check "T-02 one answering-again wake (got $(lines t2 'answering again'))" '[ "$(lines t2 "answering again")" -eq 1 ]'
check "T-01/T-02 never AUTH DEAD" '[ "$(lines t1 "AUTH DEAD")" -eq 0 ] && [ "$(lines t2 "AUTH DEAD")" -eq 0 ]'
check "T-03 AUTH DEAD raised on a rejected login (got $(lines t3 'AUTH DEAD'))" '[ "$(lines t3 "AUTH DEAD")" -ge 1 ]'
t4_out=$(wc -l < "$SCRATCH/t4/out")
t4_tok=$(cat "$SCRATCH/t4/relay-state/token" 2>/dev/null)
t4_since=$(cat "$SCRATCH/t4/relay-state/since")
check "T-04 no wake lines while logins 503 (got $t4_out)" '[ "$t4_out" -eq 0 ]'
check "T-04 logged in once logins worked (token=$t4_tok)" '[ "$t4_tok" = "newtok" ]'
check "T-04 sync ran after login (since=$t4_since)" '[ "$t4_since" != "s0" ]'
check "T-05 one RELAY SERVER TROUBLE wake (got $(lines t5 'RELAY SERVER TROUBLE'))" '[ "$(lines t5 "RELAY SERVER TROUBLE")" -eq 1 ]'
check "T-05 never AUTH DEAD on 429 (got $(lines t5 'AUTH DEAD'))" '[ "$(lines t5 "AUTH DEAD")" -eq 0 ]'

echo "==============================="
echo "PASS: $PASS  FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"; for f in "${FAILURES[@]}"; do echo "  - $f"; done
  for c in t1 t2 t3 t4 t5; do echo "--- $c stdout ---"; cat "$SCRATCH/$c/out"; echo "--- $c stderr ---"; cat "$SCRATCH/$c/err"; done
  exit 1
fi
exit 0
