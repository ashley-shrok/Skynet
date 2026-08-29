---
phase: quick-260829-kmr
plan: 01
status: complete
completed: 2026-08-29
commit: 95147a6a
files_modified:
  - src/backend/fleet-status/ssh-poll-orchestrator.ts
  - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
tests_added: 4
tests_pass: 98
tests_fail: 0
---

# Quick 260829-kmr Summary: cross-identity background_tasks leak fix

## Objective

Fix source A of the fleet-status SSH poll orchestrator so identity A's WIP indicator no longer lights up with identity B's non-ambient background_tasks. The bug: source A was reading the box-wide `~/.claude/fleet-status/last-stop-payload.json` file (shared across all Claude sessions on the box) instead of the per-session `~/.claude/fleet-status/stop-<sessionId>.json` file that Phase 61's Stop hook already writes.

## Change Summary

**Backend read-path swap** — surgical two-file change:

1. `src/backend/fleet-status/ssh-poll-orchestrator.ts` — inserted a per-session `cat ~/.claude/fleet-status/stop-<sanitized-sid>.json` read after the Phase 61 mtime stat block (at ~L1109). Rewrote the hook-payload consumer at ~L1356 to prefer per-session, fall back to box-wide, and fire `emitHookPayloadWarn` only when BOTH sources are missing. Reused Phase 61's regex `/^[a-zA-Z0-9_-]+$/` + `shellSingleQuote` verbatim (no new regex introduced). Illegal sessionIds skip the per-session cat entirely — mirrors Phase 61's stat behavior at L1089.

2. `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — appended a new `describe("quick-260829-kmr — cross-identity background_tasks leak: per-session hook-payload read + fallback", ...)` block at end of file with 4 new tests (A/B/C/D). Local `wireQuick260829Base` + `buildQuick260829Deps` helpers (Phase 59 pattern; not touching Phase 59 helpers). Pattern-collision discipline: registered `"cat ~/.claude/fleet-status/stop-"` (per-session PAYLOAD), `"stat -c %Y ~/.claude/fleet-status/stop-"` (Phase 61 mtime), and `"cat ~/.claude/fleet-status/last-stop-payload.json"` (box-wide) — patterns are disjoint (order defensive, not load-bearing).

## Tests

4 new tests, all pass:

- **Test A** — per-session PAYLOAD wins over box-wide when both present (load-bearing proof cross-identity leak closed: identity B's `"identity-B task"` NEVER appears on identity A's wire).
- **Test B** — per-session file empty → falls back to box-wide payload (backward compat for pre-Phase-61 sessions).
- **Test C** — BOTH sources empty → `backgroundTasks: []` AND EXACTLY ONE `emitHookPayloadWarn` (widened absent semantic + debounce contract preserved).
- **Test D** — sessionId `"../evil"` fails regex guard → per-session cat is SKIPPED entirely (verified via `channel.getCalls()` — the POISON response registered under the per-session pattern is NEVER read); box-wide fallback consulted directly.

## Verification Output

Targeted test suite green:

```
npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts

 Test Files  1 passed (1)
      Tests  98 passed (98)
   Start at  15:01:33
   Duration  13.69s
```

- Prior file test count was 94; new count is 98 (+4 for tests A/B/C/D).
- Zero regressions in the surrounding Phase 41/44/47/52/53/55/59 blocks.

## Commit

```
95147a6a fix(quick-260829-kmr): source A reads per-session Stop payload, not box-wide
```

`git show --name-only HEAD` files:
```
src/backend/fleet-status/ssh-poll-orchestrator.ts
src/backend/fleet-status/ssh-poll-orchestrator.test.ts
```

`git status` post-commit (clean; only untracked docs remain for orchestrator):
```
?? .planning/quick/260829-kmr-fix-cross-identity-background-tasks-leak/
```

## Deviations from Plan

None. The plan was executed verbatim. One minor detail worth noting for the record: the four new tests use `type: "shell"` (matching the BackgroundTaskSchema discriminant in `wire-protocol.ts:26` — `ShellTaskSchema`) rather than the `shell_id` field mentioned in casual planning shorthand. This mirrors the existing sibling test at L811 which also uses `type: "shell"` — the tests parse via `parseStopHookPayload` (zod) which requires the `type` discriminant. No semantic deviation from the plan's intent.

## Backend-only Guard

`git diff --name-only HEAD~1 HEAD | grep -vE "^src/backend/" | wc -l` → 0. Zero non-backend files touched.

`git diff HEAD~1 HEAD -- src/backend/fleet-status/ssh-poll-orchestrator.ts | grep -c "pollDormantOnly\|source B"` → 0. Source B code path untouched.

## Handoff

Ready for orchestrator ship-batch with patches #521 (search box) + #522 (dormant Send). Full-suite run is orchestrator responsibility (fleet rule updated 2026-08-29 — full-suite is the push gate, not the commit gate; local targeted-pass is sufficient at executor exit).

NO push, NO docker, NO patch-entry edit, NO coord-room post at this checkpoint.

## Self-Check: PASSED

- File exists: `src/backend/fleet-status/ssh-poll-orchestrator.ts` (modified) — FOUND
- File exists: `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (modified) — FOUND
- Commit exists: `95147a6a` — FOUND in `git log --oneline`
- Patch-comment banners in source file — 2 markers (`Quick 260829-kmr` at L1109, `Fix (quick-260829-kmr)` at L1356)
- quick-260829-kmr marker count in test file — 6 occurrences (describe + 4 test docblocks + section banner)
- `hookPayloadPath` grep in source file — 4 occurrences (>=3 required; box-wide `hookPayloadPromise` at L1009 preserved)
