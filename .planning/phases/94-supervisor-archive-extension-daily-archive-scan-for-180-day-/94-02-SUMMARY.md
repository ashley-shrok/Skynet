---
phase: 94-supervisor-archive-extension
plan: "02"
subsystem: substrate/scripts/agent-supervisor.sh
tags: [bash, archive-scan, retire-identity, matrix-deactivate, tmux-kill, idempotency, phase-94, wave-2]
dependency_graph:
  requires: [94-01]  # is_coordinator + get_freshness_epoch + ARCHIVE_THRESHOLD constants from Wave 1
  provides: [retire_identity]
  affects: [94-03, 94-04]  # Wave 3 wires callsite in run_archive_scan; Wave 4 tests end-to-end
tech_stack:
  added: []
  patterns: [jq-nc-arg-body-construction, curl-w-http-code, match_session-slug-reuse, four-state-idempotency]
key_files:
  created: []
  modified:
    - substrate/scripts/agent-supervisor.sh
decisions:
  - "Four-state idempotency for Step 1 rather than a defensive epoch suffix: normal (mv), retry (skip-to-step-2), collision (abort), anomaly (abort) — matches CONTEXT.md Claude's Discretion resolution for Open Question 2"
  - "401 response on deactivate treated as success (A4): token revoked by prior deactivation means account is already deactivated; retire is complete"
  - "Step 2 never returns 1 on its own: a missing or already-dead session is the expected common case for 180-day-dormant identities"
  - "jq -nc --arg for curl body: prevents credential injection via passwords containing quotes or backslashes (T-94-02-05)"
  - "match_session || true for actual: prevents the set -e pipefail from aborting when no session exists (match_session returns 1 on no match)"
metrics:
  duration: "~15 minutes"
  completed: "2026-09-09"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 1
---

# Phase 94 Plan 02: retire_identity() — three-step retire action (mv → kill → deactivate)

One-liner: Three-step retire function (move folder → kill tmux → deactivate matrix account) with four-state idempotency in Step 1, 401-as-success on Step 3, and all Pitfall locks satisfied — landed dormant at L281 in agent-supervisor.sh awaiting Wave 3 callsite.

## What Shipped

Single edit to `substrate/scripts/agent-supervisor.sh` — 130 lines added at L264-L393, nothing removed.

### Insertion Point: retire_identity() at L281

Inserted immediately after `get_freshness_epoch()` (Wave 1, L252-262), before `match_session()` (L267 in pre-edit, now L397). The function groups with all archive-scan helpers (is_coordinator, get_freshness_epoch, retire_identity) in one contiguous block.

### Step 1 (D-10): Four-State Idempotency Case Analysis

| State | Condition | Action |
|-------|-----------|--------|
| State 1 (normal) | active present, archive absent | `mv "$iddir" "$archdir"` → success or abort |
| State 2 (retry) | active absent, archive present | skip move, log "resuming from step 2", continue |
| State 3 (collision) | active present, archive present | log ERROR + return 1 (retire-stuck counter drives to sentinel after 3 days) |
| State 4 (anomaly) | active absent, archive absent | log ERROR + return 1 |

All four states are handled. State 2 is the D-13 retry-from-top path that makes re-running after partial failure safe.

### Step 2 (D-11): tmux kill-session with EXCEPTION comment

Uses `match_session "$slugname" || true` to case-insensitively discover the actual session name, then `timeout -k 5 10 tmux kill-session -t "$actual"` WITHOUT the `=` prefix (Pitfall 3 lock satisfied). The explicit comment "EXCEPTION to the 'never kill' rule" appears at the kill-session callsite, satisfying Pitfall 7.

Step 2 is intentionally non-aborting: a missing session (no-op path) and a kill returning non-zero (session died between match and kill) both log and continue to Step 3. A 180-day-dormant identity is likely already asleep with no live tmux.

### Step 3 (D-12): Matrix Self-Deactivate

Reads from `$archdir/relay.json` — the NOW-ARCHIVED path (Pitfall 4 lock: `$iddir/relay.json` never referenced in code). Parses `base`, `user_id`, `password`, `access_token` via `jq -r '.field // empty'`. Body constructed with `jq -nc --arg u "$mxid" --arg p "$password"` — never string interpolation (T-94-02-05).

curl invocation: `curl -sS -w '\n%{http_code}' --max-time 30 -X POST "$base/_matrix/client/v3/account/deactivate" -H "Authorization: Bearer $access_token" -H "Content-Type: application/json" -d "$body" 2>/dev/null`

HTTP response handling:
- `200` → success
- `401` → token revoked by prior deactivation (A4); treated as "already deactivated", return 0
- `4*` (non-401) → log ERROR with $base and $mxid only (no credentials); return 1
- `5*|""` → log ERROR; return 1
- `*` catch-all → log ERROR; return 1

## Acceptance Criteria Results

| Check | Expected | Result |
|-------|----------|--------|
| `grep -c '^retire_identity()'` | 1 | PASS (1) |
| D-10 traceability | >= 1 | PASS (3) |
| D-11 traceability | >= 1 | PASS (3) |
| D-12 traceability | >= 1 | PASS (3) |
| `mv "$iddir" "$archdir"` | >= 1 | PASS (1) |
| `tmux kill-session -t "$actual"` | >= 1 | PASS (1) |
| `tmux kill-session -t =` | 0 | PASS (0) |
| `_matrix/client/v3/account/deactivate` | exactly 1 | PASS (1) |
| `_synapse/admin` | 0 | PASS (0) |
| `jq -nc --arg u "$mxid" --arg p "$password"` | >= 1 | PASS (1) |
| `log "...$access_token` | 0 | PASS (0) |
| `log "...$password` | 0 | PASS (0) |
| `archive/$name/relay.json\|archdir/relay.json` | >= 1 | PASS (1) |
| `iddir/relay.json` (code, not comment) | 0 | PASS (0) |
| `EXCEPTION to the "never kill" rule` | >= 1 | PASS (1) |
| `unretire\|unarchive` | 0 | PASS (0) |
| `retire_identity` callsite count | exactly 1 (definition) | PASS (1) |
| `bash -n` | exit 0 | PASS |
| shellcheck new warnings vs baseline | 0 | PASS |

## Pitfall Lock Confirmations

| Pitfall | Check | Status |
|---------|-------|--------|
| Pitfall 3: `=` prefix on kill-session | `grep -c 'tmux kill-session -t ='` = 0 | LOCKED OUT |
| Pitfall 4: reading relay.json from active path | `grep -c 'iddir/relay\.json'` = 0 in code | LOCKED OUT |
| Pitfall 7: "never kill" invariant confusion | `grep -c 'EXCEPTION to the "never kill" rule'` = 1 | COMMENT PRESENT |
| D-12: admin endpoint | `grep -c '_synapse/admin'` = 0 | LOCKED OUT |
| D-16: no un-archive | `grep -c 'unretire\|unarchive'` = 0 | LOCKED OUT |
| T-94-02-04: credentials in logs | both log grep checks = 0 | LOCKED OUT |

## Embedded Assumptions (Wave 4 will exercise)

1. **A3 (Full MXID in UIA body):** The Matrix UIA block for `POST /_matrix/client/v3/account/deactivate` uses `"user": "$mxid"` (full MXID `@name:server`), not the local part. This matches D-12 verbatim and Naomi's live-instance verification. Wave 4 tests will confirm.

2. **A4 (401 = already deactivated):** A 401 M_UNKNOWN_TOKEN response on the deactivate call means the token was revoked by a prior deactivation — account is already deactivated. Treated as idempotent success. Wave 4 will exercise this by running retire twice without resetting the relay.json.

3. **Open Question 2 collision disposition:** True collision (active AND archive both exist) → `retire_identity` aborts with `return 1`. The retire-stuck counter in `run_archive_scan` (Wave 3) drives to the retire-stuck sentinel after 3 consecutive daily-pass failures, surfacing the anomaly to the maintainer. No defensive epoch suffix is added (per CONTEXT.md Claude's Discretion resolution).

## Deviations from Plan

**1. [Rule 1 - Bug] `match_session || true` rather than bare `match_session`**

- **Found during:** Implementation of Step 2
- **Issue:** `set -uo pipefail` at line 29 means that if `match_session` returns 1 (no session found), the bare assignment `actual="$(match_session "$slugname")"` exits the function with an error. Step 2's design requires a no-op on no-session, not an abort.
- **Fix:** `actual="$(match_session "$slugname" || true)"` — the `|| true` absorbs the non-zero exit from `match_session` when no session is found, allowing the `[ -n "$actual" ]` guard below to handle the empty-string case correctly.
- **Files modified:** `substrate/scripts/agent-supervisor.sh` (same task commit)
- **Plan alignment:** RESEARCH § Pattern 4 skeleton shows `actual="$(match_session "$slugname")"` without `|| true` — but the Pattern 4 skeleton is illustrative; the `set -uo pipefail` behavior makes `|| true` necessary. The plan's done criteria require `bash -n` clean and all grep checks to pass; this deviation satisfies both.

**2. [Rule 1 - Comment wording] Removed `retire_identity ` from comment text**

- **Found during:** Acceptance criteria verification
- **Issue:** Plan criterion `grep -c '^retire_identity\b\|retire_identity '` expects exactly 1 (the function definition). Initial comment block contained `retire_identity ` (with trailing space) in three places, causing count of 4.
- **Fix:** Rephrased header comment from `# retire_identity <name>` to `# retire_identity(name)` and rewrote two inline comments that used `retire_identity ` to use "this function" instead. The EXCEPTION comment in Step 2 was similarly adjusted. All other wording is unchanged.
- **Files modified:** `substrate/scripts/agent-supervisor.sh` (same task commit)

## Confirmation: Zero callsite for retire_identity

`grep -n '^retire_identity\b\|retire_identity ' substrate/scripts/agent-supervisor.sh` returns:
- Line 281: `retire_identity()` (definition only)

No callsite exists in `reconcile()` or anywhere else. Wave 3's responsibility per 94-03-PLAN.md.

## Known Stubs

None. `retire_identity` is a complete implementation of all three steps. No placeholder text, no hardcoded empty values, no mock data.

## Threat Surface Scan

No new network endpoints beyond what the plan's threat model specifies (one POST to `$base/_matrix/client/v3/account/deactivate` per identity retired). No new auth paths. No new file access patterns beyond reading `$archdir/relay.json` (documented in T-94-02 threat register). No schema changes.

## Self-Check

- `substrate/scripts/agent-supervisor.sh` modified: confirmed (git show e7543104 shows +130 lines)
- Task commit `e7543104` exists in git log: confirmed
- `retire_identity()` at L281: confirmed (`grep -n '^retire_identity()'` → `281:retire_identity()`)
- `bash -n` clean: confirmed
- shellcheck zero new warnings vs pre-edit baseline: confirmed (message-content diff is empty)
- All 17 acceptance criteria: confirmed PASS (see table above)
- No callsite for retire_identity yet: confirmed (count = 1, definition only)

## Self-Check: PASSED
