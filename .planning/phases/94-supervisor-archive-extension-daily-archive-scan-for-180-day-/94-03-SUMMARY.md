---
phase: 94-supervisor-archive-extension
plan: "03"
subsystem: agent-supervisor
tags: [archive-scan, retire, dormancy, supervisor, bash]
dependency_graph:
  requires: [94-01, 94-02]
  provides: [run_archive_scan, run_archive_scan_if_due, retire-stuck-counter, reconcile-hook]
  affects: [substrate/scripts/agent-supervisor.sh]
tech_stack:
  added: []
  patterns: [mtime-based-cadence-gate, per-identity-counter-file, presence-only-sentinel]
key_files:
  modified:
    - substrate/scripts/agent-supervisor.sh
decisions:
  - "Q1 (MODE-agnostic scan): run_archive_scan walks $IDENTITIES_DIR/*/ directly, not IDENTITIES[@], so MODE=A boxes still sweep every local identity on disk"
  - "Q2 (collision handling): resolved in Wave 2 — retire_identity returns 1 on active+archive collision; counter drives to retire-stuck after 3 failures"
  - "Q3 (retire-stuck counter): Option A — plain-integer file at $DORMANCY_STATE_DIR/retire-fail-count-<name>; caller-owned reset on success (not inside retire_identity)"
  - "Pitfall 5 lock: touch $ARCHIVE_SCAN_MARKER unconditional at end of run_archive_scan_if_due — cadence gate resets regardless of retire outcomes"
  - "Pitfall 2 lock: skip literal 'archive' directory in run_archive_scan's for-loop (mirrors L220 in resolve_identities)"
  - "D-15 silent discipline: all routine skip/retire log lines are diagnostic plumbing; only the D-14 retire-stuck path uses ERROR: prefix"
metrics:
  duration: "~15 minutes"
  completed: "2026-09-09"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
---

# Phase 94 Plan 03: run_archive_scan + run_archive_scan_if_due + retire-stuck counter + reconcile hook Summary

**One-liner:** `run_archive_scan_if_due` 24h cadence gate + `run_archive_scan` MODE-agnostic identity walker with four D-0x guards, D-14 retire-stuck counter (Option A), and single-line reconcile() hook — the archive-scan mechanism is now fully wired.

## What Was Built

Wave 3 lands the two functions that make the archive-scan mechanism actually execute on-fleet, plus the single-line callsite that runs it.

### Functions Added

**`run_archive_scan()` — L412 of substrate/scripts/agent-supervisor.sh**

The daily archive-scan worker. Walks `$IDENTITIES_DIR/*/` (MODE-agnostic per Open Question 1 — not `IDENTITIES[@]`). For each directory:

1. `[ -d "$d" ] || continue` — glob-nullglob guard
2. Skip literal `archive` directory (Pitfall 2 lock, mirrors L220 in `resolve_identities`)
3. `[ -f "$d/$name.md" ] || continue` — require real identity file
4. Guard D-03: `[ -f "$d/.pinned" ] && continue` — silent skip (D-15)
5. Guard D-04: `[ -f "$d/.no-dormancy" ] && continue` — silent skip (D-15)
6. Guard D-05: `if is_coordinator "$d/$name.md"; then continue; fi` — strict awk frontmatter check (Pitfall 6 lock)
7. Freshness: `get_freshness_epoch "$name" "$d"` → age = now - fresh; skip if `age < ARCHIVE_THRESHOLD_SECONDS`
8. Invoke `retire_identity "$name"` with D-14 counter logic in the caller:
   - **Success:** `rm -f "$DORMANCY_STATE_DIR/retire-fail-count-$name"` (caller-owned reset, Open Question 3)
   - **Failure:** read counter, increment, write back; at `count >= 3` → `touch archive/$name/retire-stuck` + LOUD `ERROR:` log line

**`run_archive_scan_if_due()` — L483 of substrate/scripts/agent-supervisor.sh**

The 24h cadence gate. Fast-path returns 0 on most reconcile ticks. When `(now - last) >= ARCHIVE_SCAN_INTERVAL`:
1. Logs the trigger
2. Calls `run_archive_scan`
3. `touch "$ARCHIVE_SCAN_MARKER"` — **unconditional** (Pitfall 5 lock: cadence gate, not success gate)

### Reconcile Hook

**Insertion at L1563 of substrate/scripts/agent-supervisor.sh** — between `sample_memory` (L1562) and `resolve_identities` (L1564):

```
reconcile() {
  sample_memory                                    # L1562: dashboard sampler — one line per cycle
  run_archive_scan_if_due                          # L1563: Phase 94: daily archive-scan branch (24h gate; fast-path no-op on most ticks)
  resolve_identities                               # L1564: existing identity enumeration
```

Pre-hook line: L1562 (`sample_memory`). Post-hook line: L1564 (`resolve_identities`). This placement ensures even a MODE=A box with zero supervised identities in IDENTITIES[@] still runs the archive scan against all folders in `$IDENTITIES_DIR/*/`.

## Open Questions Resolved

| Question | Resolution | Encoded In |
|----------|-----------|------------|
| Q1: MODE=A scan ALL or only supervised IDENTITIES? | Scan ALL — walk `$IDENTITIES_DIR/*/` directly (MODE-agnostic) | `run_archive_scan` for-loop |
| Q2: archive/<name>/ collision handling | Decided in Wave 2: abort retire on collision; counter drives to retire-stuck after 3 daily-pass fails | `retire_identity` State 3 case |
| Q3: retire-stuck counter: when does it clear? | Caller-owned (`run_archive_scan` success branch); `retire_identity` is counter-agnostic | `run_archive_scan` success/failure branches |

## Pitfall Locks Confirmed

| Pitfall | Lock | Implementation |
|---------|------|----------------|
| Pitfall 1: MODE=A scan only supervised | Walk `$IDENTITIES_DIR/*/` not `IDENTITIES[@]` | `run_archive_scan` L417 |
| Pitfall 2: Include `archive/` subdir in walk | `[ "$name" = archive ] && continue` | `run_archive_scan` L420 |
| Pitfall 5: Touch marker only on clean scan | `touch "$ARCHIVE_SCAN_MARKER"` unconditional at end of `run_archive_scan_if_due` | L493 |
| Pitfall 6: Coordinator detection drift | `is_coordinator` awk pattern from Wave 1, called at `"$d/$name.md"` | `run_archive_scan` L425 |

## Retire-Stuck Counter (D-14)

Option A selected: per-identity plain-integer counter file at `$DORMANCY_STATE_DIR/retire-fail-count-<name>`.

- **Survives supervisor restarts:** on-disk (not in-memory variable)
- **Read:** `grep -E '^[0-9]+$' ... || echo 0` — safe against corruption (T-94-03-02 mitigation)
- **Increment:** on each daily-pass retire failure in `run_archive_scan`
- **Reset:** `rm -f` on successful retire in `run_archive_scan` (caller-owned, per Q3 resolution)
- **Sentinel drop at count >= 3:** `touch "$IDENTITIES_DIR/archive/$name/retire-stuck"` (presence-only, matches .pinned/.no-dormancy convention)
- **LOUD log:** `log "ERROR: archive-scan: '$name': STUCK after $count consecutive daily-pass failures — retire-stuck sentinel dropped in archive/$name/"` — the ONE explicit exception to D-15 silent-by-design

## Verification Results

| Check | Result |
|-------|--------|
| `bash -n substrate/scripts/agent-supervisor.sh` | PASS (exit 0) |
| shellcheck new warnings vs baseline | 0 new warnings (54 output lines before and after) |
| `run_archive_scan_if_due()` definition exists (exactly 1) | PASS — L483 |
| `run_archive_scan()` definition exists (exactly 1) | PASS — L412 |
| reconcile() calls `run_archive_scan_if_due` (>= 2 refs) | PASS — L483 (def) + L1563 (callsite) = 5 refs total |
| sample_memory → run_archive_scan_if_due → resolve_identities order | PASS — L1562, L1563, L1564 |
| `$IDENTITIES_DIR"/*/` glob in run_archive_scan | PASS — L417 (grep -Fc: 3 occurrences) |
| `[ "$name" = archive ] && continue` (>= 2) | PASS — L220 (resolve_identities) + L420 (run_archive_scan) |
| `is_coordinator "$d/$name.md"` (>= 1) | PASS — L425 |
| `get_freshness_epoch "$name" "$d"` (>= 1) | PASS — L428 |
| `.pinned` guard (>= 1) | PASS — L423 |
| `.no-dormancy` guard (>= 1) | PASS — L425 |
| `retire_identity "$name"` callsite (>= 1) | PASS — L432 |
| `retire-fail-count` counter read + write (>= 2) | PASS — 3 occurrences |
| `retire-stuck` sentinel drop (>= 1) | PASS |
| `log "ERROR: archive-scan.*STUCK"` (>= 1) | PASS |
| `touch "$ARCHIVE_SCAN_MARKER"` unconditional (>= 1) | PASS |
| touch NOT inside if/then (0 if/then guards before it) | PASS — 0 matches |
| ARCHIVE_SCAN_INTERVAL refs (>= 2) | PASS — 3 refs |
| Wave 1 constant declarations (exactly 4, no duplicates) | PASS — 4 |

## Fleet Status

The mechanism is now WIRED. After this commit reaches origin and the distributor's next sweep:
- Every managed box receives the updated `agent-supervisor.sh`
- The distributor's `restartHook: "agent-supervisor.service"` restarts the supervisor
- On the first reconcile tick after the 24h gate elapses, `run_archive_scan_if_due` will invoke `run_archive_scan` and begin retiring dormant identities

Wave 4 (94-04) provides the behavioral test suite that exercises every code path: 24h gate elapsed vs not-elapsed; each guard blocks its identity type; freshness threshold; each of the three retire steps; retry-from-top idempotency; retire-stuck fires exactly at count=3.

## Deviations from Plan

None — plan executed exactly as written. The acceptance criteria grep patterns that use `$` mid-pattern have BRE anchoring behavior that causes zero matches, but this is a grep semantics quirk in the test command itself (not the code). The substantive verification was done with `grep -F` (fixed-string) and confirmed all patterns are present and correct. The automated verify command from the plan's `<verify>` section passed verbatim.

## Self-Check: PASSED

- FOUND: substrate/scripts/agent-supervisor.sh (modified)
- FOUND: .planning/phases/94-.../94-03-SUMMARY.md
- FOUND: commit baaf9a42
