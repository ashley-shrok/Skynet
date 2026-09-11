# substrate/scripts/tests

Shell-code tests for `substrate/scripts/*.sh`. This directory establishes the
convention for bash-native test coverage in the substrate — no BATS harness, no
vitest coupling; just a self-contained driver that sources the script under test,
invokes its functions against scratch fixtures, and asserts against exit codes,
file-system state, and log output.

## Current test drivers

| Driver | What it covers |
|--------|---------------|
| `agent-supervisor-archive-scan.sh` | Phase 94 archive-scan mechanism: coordinator guard, freshness-read, retire action (3-step), retire-stuck counter, MODE-agnostic scan, 24h cadence gate, static-analysis grep gates |

---

## How to run

From the **repo root**:

```bash
bash substrate/scripts/tests/agent-supervisor-archive-scan.sh
```

Exits 0 on all-pass, 1 on any failure. Failures print a summary line naming each
failing test at the end:

```
===============================
PASS: 31  FAIL: 1
Failures:
  - test_retire_happy_path_200
```

To override the supervisor path (e.g. to test a local branch before merging):

```bash
SUPERVISOR=/path/to/agent-supervisor.sh bash substrate/scripts/tests/agent-supervisor-archive-scan.sh
```

---

## Dependencies

| Tool | Mandatory? | Notes |
|------|-----------|-------|
| `bash` | yes | Script and supervisor require bash |
| `shellcheck` | yes | Static-analysis phase gates on shellcheck clean |
| `tmux` | yes | Supervisor uses tmux; test driver exercises kill-session path |
| `jq` | yes | Supervisor uses jq for relay.json parsing |
| `stat` | yes | Supervisor uses `stat -c %Y` (GNU coreutils); tested by freshness tests |
| `curl` | yes | Retire action's Step 3 (Matrix deactivate) uses curl |
| `python3` | optional | Stub homeserver for retire-action tests (200/401/5xx paths). Tests skip gracefully with a diagnostic if absent and `nc` is also absent. |
| `nc` | optional | Fallback stub homeserver if python3 is not available. One of python3 or nc must be present for retire-action stub tests to run; if neither is available, those tests emit a SKIPPED diagnostic rather than failing. |

---

## Stub homeserver pattern

The `retire_identity` function (Step 3) POSTs to
`$base/_matrix/client/v3/account/deactivate`. In tests, `$base` in the fixture
`relay.json` is set to `http://127.0.0.1:<ephemeral-port>` and a lightweight
local HTTP server is started that returns a canned status code.

The server is spawned via `python3` (preferred) using `port=0` (kernel-assigned
ephemeral port) and a tiny handler that always responds with the configured HTTP
status code plus a minimal JSON body. The assigned port is written to a temp file
which the driver reads before injecting the port into the fixture `relay.json` via
`sed -i`.

```
start_stub_homeserver 200   # canned status = 200
# $STUB_PORT is now set; $STUB_PID holds the server PID
sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/tina/relay.json"
...
stop_stub_homeserver        # kill $STUB_PID + wait
```

A test that wants a **network-fail** result simply does NOT start the stub and
uses `http://127.0.0.1:1` as `$base` (port 1 has no listener; curl returns a
connection-refused error).

This pattern is portable to future substrate tests that need to isolate Matrix-API
calls without a real Synapse instance. Steps to reuse:
1. Call `start_stub_homeserver <status_code>` to get `STUB_PORT` + `STUB_PID`.
2. Write a fixture `relay.json` with `"base": "http://127.0.0.1:STUB_PORT"`.
3. `sed -i "s|STUB_PORT|$STUB_PORT|"` the fixture file.
4. Invoke the function under test.
5. Call `stop_stub_homeserver`.

---

## Fixture pattern

Each test that exercises filesystem-touching functions sets up a scratch directory
and tears it down after the assertion. The driver provides these helpers:

```bash
setup_scratch              # returns path to mktemp -d scratch
teardown_scratch "$scratch" # rm -rf; called even on failure via trap

fixture_identity "$scratch" <name> [flags]
  # Creates $scratch/<name>/<name>.md with valid frontmatter.
  # Flags:
  #   --pinned           creates $scratch/<name>/.pinned sentinel
  #   --no-dormancy      creates $scratch/<name>/.no-dormancy sentinel
  #   --coordinator      adds "coordinator: true" to frontmatter
  #   --cursor-age-days N sets relay-state/since mtime to N days in the past
  #   --no-md            omits the .md file (for testing the identity-file guard)

fixture_relay_json "$dir" "<base>" "<user_id>" "<password>" "<access_token>"
  # Writes relay.json to $dir/relay.json with the given fields.
  # Use this for both active-path ($scratch/tina/relay.json before Step 1)
  # and archive-path ($scratch/archive/tina/relay.json for retry-from-partial).
```

To add a new fixture scenario (e.g. an identity with a corrupted relay.json):

1. Call `setup_scratch` to get a scratch dir.
2. Call `fixture_identity "$scratch" myname --cursor-age-days 200`.
3. Write a malformed `relay.json` to `"$scratch/myname/relay.json"` directly.
4. Invoke `retire_identity "myname"` in a subshell with `IDENTITIES_DIR="$scratch"`.
5. Assert against the return code and any log output.
6. Call `teardown_scratch "$scratch"`.

---

## CI integration

Deferred to future work. For now this is a manual quality-gate: run the driver
before shipping any edits to `agent-supervisor.sh`. When CI is added, the
integration is:

```yaml
- run: bash substrate/scripts/tests/agent-supervisor-archive-scan.sh
```

from the repo root; the driver exits 1 on any failure and names the failing tests.

---

## Manual verifications not exercised by the test driver

Two behaviors require a live runtime environment and are not covered by the
automated driver:

**A1: Live tmux kill-session against a running session.**
The `test_retire_happy_path_200` test exercises the retire flow against a fixture
identity with no tmux session active, which covers the "no session to kill" no-op
path (the common case for 180-day-dormant identities). It does NOT exercise killing
an actually-running tmux session. To verify A1 manually:
1. Start a throwaway tmux session: `tmux new-session -d -s throwaway-test`.
2. Create a matching fixture identity folder whose slug resolves to `throwaway-test`.
3. Source the supervisor with `AGENT_SUPERVISOR_LIB_ONLY=1` and invoke
   `retire_identity` against the fixture identity.
4. Confirm the tmux session is gone: `tmux has-session -t throwaway-test` should
   return non-zero.

**T-94-02-01: Folder-move race with keep-alive loop.**
`retire_identity` Step 1 uses `mv` (atomic on same-filesystem). The structural
defense against a concurrent keep-alive loop writing to the identity folder at the
moment of the move is the atomicity of `mv` itself, not a lock file. This is not
code-testable without a truly concurrent fixture. If a concurrent-mv-vs-drive smoke
test is needed, it can be run manually with a `while true; do touch "$iddir/probe"; done &`
background loop alongside a direct `retire_identity` invocation. Expected: the move
succeeds atomically; the background loop's next write fails (directory moved out
from under it) with ENOENT, which the keep-alive loop handles gracefully.
