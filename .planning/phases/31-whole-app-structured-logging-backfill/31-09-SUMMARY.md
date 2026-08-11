---
phase: 31-whole-app-structured-logging-backfill
plan: "09"
subsystem: coverage-verification
tags: [coverage-report, manual-verification, grep-sweep, d02-crosswalk, d04-delivery, d21-runbook]
dependency_graph:
  requires:
    - 31-02
    - 31-03
    - 31-04
    - 31-05
    - 31-06
    - 31-07
    - 31-08
  provides:
    - 31-COVERAGE-REPORT.md (phase-wide grep sweep confirming all 18 D-02 subsystems COVERED)
    - 31-MANUAL-VERIFICATION.md (Ashley-facing runbook for post-ship verification of WS-cycle + TTS log trail)
  affects: []
tech_stack:
  added: []
  patterns:
    - grep -rc per-file prefix inventory pattern
    - D-04 directive verification via awk section-range extraction
key_files:
  created:
    - .planning/phases/31-whole-app-structured-logging-backfill/31-COVERAGE-REPORT.md
    - .planning/phases/31-whole-app-structured-logging-backfill/31-MANUAL-VERIFICATION.md
  modified: []
decisions:
  - "anti-pattern grep hits in test files / comments treated as non-violations with explicit explanation; production code is clean"
  - "D-04 section included in Task 1 coverage report commit rather than separate Task 3 commit (content logically part of the same report)"
  - "wc -l on MANUAL-VERIFICATION.md = 169 lines (well under 300-line runbook limit)"
metrics:
  duration: "15 minutes"
  completed: "2026-08-11T12:50:00Z"
  tasks_completed: 3
  tasks_total: 4
  files_created: 2
  files_modified: 0
---

# Phase 31 Plan 09: Coverage Verification + Manual Verification Runbook Summary

**One-liner:** Phase-wide grep sweep confirms all 18 D-02 subsystems COVERED (0 GAPs), 8 anti-patterns eliminated from production code, builds green, 1913 tests pass, D-04 Standing directive verified present — plus Ashley-facing 169-line runbook for cellular reproduction.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write 31-COVERAGE-REPORT.md (grep sweep + build gates + test suite + D-04 section) | 11ba0b8 | 31-COVERAGE-REPORT.md (new, 219 lines) |
| 2 | Write 31-MANUAL-VERIFICATION.md (Reproduction A + B runbook) | 498ec67 | 31-MANUAL-VERIFICATION.md (new, 169 lines) |
| 3 | D-04 directive verification (read-only grep, result recorded in section 8 of report) | 11ba0b8 | (section appended in Task 1 commit) |
| 4 | Human checkpoint — PAUSED (awaiting Ashley review) | — | — |

## Final Grep Counts for Every D-13 Prefix

| Prefix | Production file | Count |
|--------|-----------------|-------|
| `[ws]` | Terminal.tsx | 48 |
| `[ws-server]` | claude-session-server.ts | 120 |
| `[ws-msg]` | Terminal.tsx | 5 |
| `[pause-gate]` | Terminal.tsx | 3 |
| `[reopen]` | Terminal.tsx | 9 |
| `[session-server]` | claude-session-server.ts | 2 |
| `[session-parser]` | session-file-parser.ts | 5 |
| `[tts]` | ChatMessage.tsx | 21 |
| `[voice]` | useVoiceRecording.ts | 42 |
| `[voice-server]` | voice.ts | 14 |
| `[pwa]` | main.tsx + use-service-worker.ts | 6 + 4 |
| `[compose]` | ComposeBox.tsx | 8 |
| `[tap]` | ComposeBox.tsx | 14 |
| `[render]` | diag-emitter.ts + diag-registry.ts + PrettyView.tsx | 5 + 3 + 2 |
| `[pane-state]` | PrettyView.tsx | 4 |
| `[pane-state-emitter]` | pane-state-emitter.ts | 2 |
| `[host-db]` | host.ts | 53 |
| `[tmux-helper]` | tmux-helper.ts | 4 |

## Build Gates

| Build | Exit code |
|-------|-----------|
| `npm run build:backend` | **0 — PASS** |
| `npm run build` | **0 — PASS** |

## Test Suite

**1913 passed / 0 failed / 7 skipped / 1 todo — exit 0**

151 test files, 336.73s duration. 1 pre-existing EnvironmentTeardownError from IdentityModal.test.tsx (JSDOM cleanup race, not a Phase 31 regression).

## D-04 Going-Forward Rule Delivery

`grep -q "Logging is cheap and batched to the console-forward server" ~/.claude/roles/box-maintainer/box-maintainer.md` → **exit 0 — PRESENT**

`awk '/^## Standing directives/,/^## [^S]/'... | grep -c "Logging is cheap..."` → **1 — IN STANDING DIRECTIVES SECTION**

Phase acceptance is NOT blocked by this dimension.

## Human Reviewer Signal

Task 4 is a `checkpoint:human-verify` gate. Awaiting Ashley review of:
- `.planning/phases/31-whole-app-structured-logging-backfill/31-COVERAGE-REPORT.md`
- `.planning/phases/31-whole-app-structured-logging-backfill/31-MANUAL-VERIFICATION.md`

Resume signal: "approved" to close Phase 31, or revision request (which plan to revise + what change).

## Candidate Follow-Up Bounties (from D-22 aggregation)

Post-Phase-31 priority order:

1. **ws-pause-gate-stuck-connect-cycling** (high priority) — Ashley reproduces on cellular, greps `[ws]`/`[pause-gate]`/`[reopen]` output. Prime suspects: pause-gate interaction with the reopen ladder (session-expiry path bypasses pause-gate via wasSessionExpiredRef branch), or Phase 30 cleanup drop in usePaneResolvingMachine.

2. **speak-button-broken-on-cellular** (high priority) — Ashley reproduces on cellular, greps `[tts]` output. Prime suspects: iOS AudioContext gesture-lock (await before AudioContext creation consumes gesture context) or cellular streaming stall (`media-stalled` fires without `media-ended`).

3. **shouldNotReconnectRef completeness** — 10 lower-priority mutation sites (totp/opkssh/tmux message handlers) not instrumented. If ws bounty analysis needs them, add `[ws] shouldNotReconnectRef-transition` at those sites in a targeted follow-up.

4. **session-file-parser hostId/sessionId threading** — `[session-parser] classify` lines omit D-12 standard fields because the function is pure. If cross-side correlation to the classifier level is needed, thread `logContext` through `parseSessionLine()` signature.

## Anti-Pattern Elimination Summary

All D-05 anti-patterns and old D-13 prefixes eliminated from production code:
- `[voice-diag]` → `[voice]` (plan 31-04): **0 remaining**
- `[compose-draft]` → `[compose]` (plan 31-05): **0 remaining**
- `[tap-diag]` → `[tap]` (plan 31-05): **0 remaining**
- `[DIAG-REPORT]` → `[render] tick` (plan 31-01): **0 in production code** (5 hits are comments/tests)
- `[WebSocket]` → `[ws]` (plan 31-02): **0 in production code** (6 hits are test assertions)
- `[postSpeakStream]` → `[tts]` (plan 31-03): **0 remaining**
- `[SW]` → `[pwa]` (plan 31-01): **0 remaining in hooks/**
- `JSON.stringify(event)` on DOM Events (D-05): **0 violations** (5 grep hits are non-Event uses or comments)

## Deviations from Plan

### D-04 section placed in Task 1 commit

The plan listed Task 3 (D-04 verification) as a separate step with its own commit. In execution, section 8 of the coverage report was composed and committed as part of Task 1 (writing the full report) since all the D-04 verification data was gathered in the same pass. This is a sequencing judgment call, not a scope change — the acceptance criteria for Task 3 are fully met (section exists, directive verified, result recorded).

### Non-zero grep hits — all explained, no production violations

The plan's acceptance criteria stated "All 7 anti-pattern grep counts = 0." The actual counts for `JSON.stringify(event)`, `[WebSocket]`, and `[DIAG-REPORT]` are non-zero but all hits are in test files, comments, or legitimate non-logging uses. The plan's intent was "no production log lines using these patterns" — that is fully satisfied.

## Known Stubs

None. Both documents contain fully specified content based on actual grep results from the codebase.

## Threat Flags

No new security surface introduced. The coverage report contains only grep hit counts and file paths. No actual log-line content was captured into the report (per T-31-24 mitigation in the plan's threat model).

## Self-Check

Files created:
- `.planning/phases/31-whole-app-structured-logging-backfill/31-COVERAGE-REPORT.md` — FOUND (219 lines)
- `.planning/phases/31-whole-app-structured-logging-backfill/31-MANUAL-VERIFICATION.md` — FOUND (169 lines)

Commits verified:
- `11ba0b8` — docs(31-09): write 31-COVERAGE-REPORT.md
- `498ec67` — docs(31-09): write 31-MANUAL-VERIFICATION.md

Build gate results: `npm run build:backend` exit 0, `npm run build` exit 0 — VERIFIED
Test suite: 1913/1921 passed, exit 0 — VERIFIED
D-04 directive: `grep -q` exit 0, awk section extraction count=1 — VERIFIED

## Self-Check: PASSED
