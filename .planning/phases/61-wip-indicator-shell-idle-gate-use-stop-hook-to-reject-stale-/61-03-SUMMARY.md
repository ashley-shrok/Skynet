---
phase: 61-wip-indicator-shell-idle-gate
plan: 03
subsystem: session-working-store
tags: [frontend-predicate, working-store, axis-cache-preservation, pitfall-3, additive-axis, tdd, rollout-safety]

# Dependency graph
requires:
  - phase: 34-fleet-status
    provides: session-working-store WorkingRecord + publishFleetStatusSessionState (Axis A/B/C swap-and-notify architecture)
  - phase: 47-ai-title
    provides: Axis C reconciliation pattern (LAST-WINS via advanceSessionAiTitle chokepoint)
  - phase: 52-dormant
    provides: Axis D direct swap-and-notify pattern (undefined-preserves / value-sets wire convention)
  - phase: 53-recycling
    provides: Axis E direct swap-and-notify pattern; Pitfall 3 (cache preservation on Axis A republish) as recurring invariant across additive axes; Pitfall 7 (frontend-mirror lockstep) closed pre-emptively by Wave 1
  - phase: 61-01
    provides: SessionState frontend mirror with lastStopAt + lastStatusChangeAt as `?: number | null` (fleet-status-types.ts); wire schema optional-nullable both fields
  - phase: 61-02
    provides: backend processPid stamps both new axes on every SessionState frame; both participate in computeFingerprint; PidCacheEntry cache-preservation across both livenessMap.set branches
provides:
  - WorkingRecord extended with two new cached axes (`lastStopAt: number | null`, `lastStatusChangeAt: number | null`), preserved across every Axis (A/B/C/D/E) republish per the Pitfall-3 invariant
  - main predicate REVISED from `busy || shell` to `busy || (shell && (lastStopAt === null || lastStatusChangeAt > lastStopAt))`; rollout-safety default-on when `lastStopAt === null` per CONTEXT.md D-05
  - Two new Axis blocks (F for lastStopAt, G for lastStatusChangeAt) appended after Axis E, mirroring the direct swap-and-notify pattern of Axis D/E; wire semantic (undefined preserves / null resets / number sets)
  - inline-260823-wip-shell-is-work rule cited in the new predicate header for historical traceability (superseded at the predicate boundary but preserved as the mid-turn-shell case)
  - Test B REVISED (not deleted) to cover the rollout-safety default-on branch; four new tests (M/N/O/P) cover stale-stop, mid-turn shell, busy-bypasses-gate, and the Pitfall-3 Axis-A cache-preservation regression guard
  - Consumer surfaces (WipBubble in PrettyView; row dot in PrettyConversationRow) inherit the fix through the existing useSessionIsWorking hook — zero consumer-site changes
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sixth iteration of the additive-axis pattern on session-working-store (lastMessageAt Phase 41 → aiTitle Phase 47 → dormant Phase 52 → recycling Phase 53 → lastStopAt+lastStatusChangeAt Phase 61 — with the two new fields grouped as ONE conceptual pair, added together with a shared header comment and mirrored Axis F/G blocks)"
    - "First composite-multi-axis predicate on the frontend working store (`main = busy || (shell && stop-gate-fresh)`) — all prior main-predicate revisions were single-axis (`busy || shell` in Phase 34; `busy || shell || dormant` never landed). The three-way normalize + conjunction pattern is now the template for any future stop-gate-shaped axis addition."
    - "Explicit Test B revision as first-class deliverable (rather than deletion + fresh test) — cites Phase 61 supersession in the header AND preserves inline-260823-wip-shell-is-work as historical reference. Prevents 61-RESEARCH.md § Common Pitfalls Pitfall 8 (skipped Test B revision leaves the pre-Phase-57 rule locked as truth)."

key-files:
  created: []
  modified:
    - src/ui/state/session-working-store.ts
    - src/ui/state/session-working-store.test.ts

key-decisions:
  - "Test B REVISED, not deleted. Kept the same fixture shape (makeState with only `status: 'shell'`) but re-labeled the header + describe + it titles to reflect the new rollout-safety default-on branch semantics. The old expectation (`shell IS real tool-execution work`) is removed from every assertion label; the new expectation (`rollout-safety default-on per CONTEXT.md D-05`) is present. inline-260823-wip-shell-is-work is preserved in the revised header as historical citation."
  - "Test P uses snapshot-inspection (`getSessionWorkingSnapshot().get('h1:s1')?.lastStopAt`) rather than useSessionIsWorking — this is what catches Pitfall-3 specifically. A useSessionIsWorking-only test would see the correct false on frame 2 (idle → isWorking false) regardless of whether Axis A preserved lastStopAt, silently masking the cache-preservation regression."
  - "Extended getSessionWorkingSnapshot return-type to include the two new axes. Required because Test P asserts on snapshot fields directly; without the type extension, the test would compile-error under strict TS mode. Signature was already exposed for the existing recycling/dormant snapshot inspection so this is a pattern-consistent additive change."
  - "advanceSessionLastMessageAt + advanceSessionAiTitle helpers ALSO extended with the new axes' cache preservation. Not strictly required by the plan's <action> steps (the plan only called for Axis A/D/E preservation), but the same Pitfall-3 invariant applies to these chokepoint writes — a fresh lastMessageAt / aiTitle arriving before any Axis F/G frame would have wiped the new axes. Rule 2 auto-added critical functionality: strict correctness invariant matching the pattern documented for Axis A."
  - "Kept the rollout-safety branch as the DEFAULT (fresh session defaults on) rather than off. CONTEXT.md D-05 locks this: 'If we've never seen a turn ended event for a session, treat it as if the session is still working — no evidence of any stop yet, so it defaults to on.' Missing real work would be a worse failure mode than the current stale-shell false-positive per CONTEXT.md § What would make it wrong."

patterns-established:
  - "Multi-axis conjunction predicate for the working-store `main` computation. Prior main was single-axis boolean OR (`busy || shell`); Phase 61 introduces the shape `bypass-status || (gated-status && gate-condition)` where the gate condition itself normalizes multiple wire fields (undefined → null → numeric compare). Template for any future 'X status only counts when Y signal is fresh' rule."
  - "Snapshot-inspection test as Pitfall-3 regression guard. Any future additive axis with the Pitfall-3 preservation invariant should include a matching Test P-shape: publish-with-axis-set → publish-without-axis-set-that-triggers-Axis-A → assert cached-axis-still-set via snapshot inspection (not hook shortcut)."

requirements-completed: []

# Metrics
duration: 22min
completed: 2026-08-29
---

# Phase 61 Plan 03: WIP-Indicator Shell-Idle-Gate Frontend Consumer Summary

**Frontend `main` predicate revised from `busy || shell` to `busy || (shell && (lastStopAt === null || lastStatusChangeAt > lastStopAt))`; WorkingRecord extended with two new cached axes preserved across every Axis republish per Pitfall-3; Axis F/G swap-and-notify blocks appended; Test B revised (not deleted) with the superseded rule cited for traceability; four new tests (M/N/O/P) lock the stop-gate canonical cases + Pitfall-3 regression guard. Zero consumer-site changes — WipBubble + row dot inherit the fix via the existing useSessionIsWorking hook. Phase 61 vertical slice is code-complete.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-08-29T08:28:35Z
- **Completed:** 2026-08-29T08:48Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Extended `WorkingRecord` type with two new cached axes (`lastStopAt: number | null` + `lastStatusChangeAt: number | null`) grouped as a Phase 61 Plan 03 comment block that cites the Pitfall-3 preservation invariant.
- REVISED the `main` predicate at line 206–207 (session-working-store.ts) from the unconditional `busy || shell` shape to the new stop-gate shape:

  ```typescript
  const lastStopAt = state_arg.lastStopAt ?? null;
  const lastStatusChangeAt = state_arg.lastStatusChangeAt ?? null;
  const shellCountsAsWork =
    state_arg.status === "shell" &&
    (lastStopAt === null ||
      (lastStatusChangeAt !== null && lastStatusChangeAt > lastStopAt));
  const main =
    state_arg.status === "busy" || shellCountsAsWork;
  ```

  Exact match against 61-RESEARCH.md § Frontend predicate verified.

- Wrote a Phase 61 header comment above the predicate that supersedes `inline-260823-wip-shell-is-work` at the predicate boundary while preserving it as the mid-turn-shell case, and cites CONTEXT.md D-05 for the rollout-safety default-on branch.
- Extended Axis A `console.info` logger with `lastStopAt` / `lastStatusChangeAt` / `previousLastStopAt` / `previousLastStatusChangeAt` for forensic tracing.
- Extended Axis A `nextMap.set` write with `lastStopAt: existing?.lastStopAt ?? null` and `lastStatusChangeAt: existing?.lastStatusChangeAt ?? null` — the Pitfall-3 fix that Test P locks in.
- Extended Axis D + Axis E `nextMap.set` writes to preserve the two new axes on dormant/recycling flips.
- Appended NEW Axis F block (lastStopAt swap-and-notify) after Axis E, mirroring the direct swap-and-notify pattern of Axis D/E. Wire semantic: undefined preserves; null resets; number sets. Includes a ~15-line block-comment header citing Phase 61 Plan 03, 61-CONTEXT.md § Shape, and 61-RESEARCH.md § Frontend predicate.
- Appended NEW Axis G block (lastStatusChangeAt swap-and-notify) after Axis F, identical structure with `lastStatusChangeAt` swapped for `lastStopAt`. Header cites Pitfall 4 (never source from sessionJson.updatedAt).
- Extended `advanceSessionLastMessageAt` + `advanceSessionAiTitle` chokepoint helpers to preserve the two new axes on their record writes (Rule 2 auto-add: same Pitfall-3 invariant applies to these writers).
- Extended `getSessionWorkingSnapshot` return-type to include the two new axes (unlocks Test P's snapshot-inspection assertions).
- REVISED Test B at session-working-store.test.ts:84–107:
  - Header block-comment rewritten to cite Phase 61 supersession (with inline-260823-wip-shell-is-work preserved as historical reference).
  - describe title changed to "shell + no-Stop-yet → isWorking true (Phase 61 rollout-safety default-on, supersedes inline-260823-wip-shell-is-work)".
  - it() title changed to "shell + wire omitted lastStopAt/lastStatusChangeAt → useSessionIsWorking returns true (rollout-safety default-on per CONTEXT.md D-05)".
  - Assertion body unchanged (still publishes `makeState({ status: "shell" })` → expects `true`) — but now hits the default-on branch (undefined → null → shellCountsAsWork true) rather than the old unconditional shell-is-work path.
- Appended four new tests (M/N/O/P) at end of file covering: stale-stop (Poppy/aqua/wilma pattern) → FALSE; fresh mid-turn shell → TRUE; busy bypasses stop-gate → TRUE regardless of stop ordering; Axis-A republish preserves cached lastStopAt (Pitfall-3 regression guard via snapshot inspection).
- Zero consumer-site changes verified via `git diff --stat src/ui/features/pretty-view/ src/ui/features/pretty-conversations/` (empty output).
- Scoped vitest suite `npx vitest run src/ui/state/session-working-store` — 64 tests green (60 pre-existing + 4 new Phase 61 stop-gate tests).
- Frontend TypeScript compiles clean for session-working-store.ts (`npx tsc -p tsconfig.app.json --noEmit` shows zero errors for this file; the 30 pre-existing errors in unrelated files — SSHAuthDialog / conversation-store.test / ElectronVersionCheck / NewSessionDialog — are out-of-scope per SCOPE BOUNDARY).

## Task Commits

Each task committed atomically:

1. **Task 1: revise main predicate + extend WorkingRecord + Axis A/D/E cache preservation + append Axis F/G blocks** — `9f759367` (feat)
   - Touched: `src/ui/state/session-working-store.ts` (143 additions, 4 deletions)
   - WorkingRecord extension + main predicate rewrite + Axis A/D/E preservation + Axis F/G swap-and-notify blocks + advanceSessionLastMessageAt/AiTitle helper extensions + getSessionWorkingSnapshot return-type extension.
   - Pre-existing 60 tests remained green after this commit (Test B did NOT flip red because `makeState({status:'shell'})` omits both fields, hitting the default-on rollout-safety branch — new predicate still returns true for that input).

2. **Task 2: revise Test B + append Tests M/N/O/P** — `f539c3bd` (test)
   - Touched: `src/ui/state/session-working-store.test.ts` (172 additions, 11 deletions)
   - Test B header + describe + it titles + inline comment revised to cover rollout-safety default-on branch; four new tests appended at end of file with the shape matching the plan's `<action>` step 3–6 exactly.
   - Full scoped test count went from 60 → 64 (all green).

_Note: No `refactor` step needed — both diffs are strictly additive (Task 1 adds fields and blocks; Task 2 adds tests and revises labels/comments only). The revised Test B's assertion body is unchanged in shape._

## Files Created/Modified

- `src/ui/state/session-working-store.ts` (Task 1) — WorkingRecord gains two new fields; main predicate revised to include the stop-gate; Axis A/D/E preserve the new fields; Axis F/G blocks appended; advanceSessionLastMessageAt + advanceSessionAiTitle also preserve the new fields; getSessionWorkingSnapshot return-type extended.
- `src/ui/state/session-working-store.test.ts` (Task 2) — Test B header + describe + it titles revised for rollout-safety default-on branch; four new tests (M/N/O/P) appended at end of file.

## Verification

### Scoped test suite
```
$ npx vitest run src/ui/state/session-working-store
Test Files  1 passed (1)
Tests       64 passed (64)
```
(60 pre-existing + 4 new Phase 61 stop-gate tests)

### Frontend TypeScript typecheck
```
$ NODE_OPTIONS=--max-old-space-size=4096 npx tsc -p tsconfig.app.json --noEmit
# 30 errors — all in unrelated files (SSHAuthDialog / conversation-store.test /
# ElectronVersionCheck / NewSessionDialog); ZERO errors in session-working-store.ts.
# Confirmed by: grep -c 'session-working-store' <typecheck-output> → 0
# Baseline comparison (git stash + re-run): baseline had 35 errors — my changes
# reduced by 5 (NewSessionDialog errors gone in current branch state, unrelated to my work).
# All errors pre-existing per SCOPE BOUNDARY.
```

### Task 1 acceptance-criteria greps (all met)

| Grep | Threshold | Actual |
| --- | --- | --- |
| `grep -v '^ *//' session-working-store.ts \| grep -c 'lastStopAt'` | ≥8 | **17** |
| `grep -v '^ *//' session-working-store.ts \| grep -c 'lastStatusChangeAt'` | ≥8 | **16** |
| `grep -c 'shellCountsAsWork' session-working-store.ts` | ≥1 | **2** |
| `grep -c 'Axis F' session-working-store.ts` | ≥1 | **3** |
| `grep -c 'Axis G' session-working-store.ts` | ≥1 | **2** |
| `grep -c 'inline-260823-wip-shell-is-work' session-working-store.ts` | ≥1 | **3** |
| Consumer surfaces untouched (`git diff --stat src/ui/features/pretty-{view,conversations}/`) | 0 files | **0 files** |

### Task 2 acceptance-criteria greps (all met)

| Grep | Threshold | Actual |
| --- | --- | --- |
| `grep -c 'Test M\|Test N\|Test O\|Test P' session-working-store.test.ts` | ≥4 | **56** (letter reuse across raw-hook tests + Phase 61 stop-gate tests + describe/it/comment mentions — plan spec was ≥4) |
| `grep -c 'Phase 61' session-working-store.test.ts` | ≥2 | **6** |
| `grep -c 'inline-260823-wip-shell-is-work' session-working-store.test.ts` | ≥1 | **6** |
| `grep -c 'shell IS real tool-execution work' session-working-store.test.ts` (old expectation MUST BE ABSENT) | 0 | **0** ✓ |
| `grep -c 'rollout-safety\|default-on' session-working-store.test.ts` (new expectation present) | ≥1 | **6** |
| Test P snapshot-assertion literal `snapAfter.get("h1:s1")?.lastStopAt).toBe(1000)` | ≥1 | **1** |

### All four new tests present and passing

| Test | Canonical case | Result |
| --- | --- | --- |
| M | shell + stale stop (`lastStatusChangeAt < lastStopAt`, Poppy/aqua/wilma pattern) → isWorking FALSE | ✅ |
| N | shell + fresh status-change (`lastStatusChangeAt > lastStopAt`, real mid-turn shell) → isWorking TRUE | ✅ |
| O | busy bypasses stop-gate → isWorking TRUE regardless of stop ordering | ✅ |
| P | Axis A republish PRESERVES cached lastStopAt (Pitfall-3 regression guard via snapshot inspection) | ✅ |

### Revised Test B still passing

| Test | New expectation | Result |
| --- | --- | --- |
| B (revised) | shell + no-Stop-yet (both wire fields omitted → predicate normalizes to null → default-on) → isWorking TRUE (rollout-safety per CONTEXT.md D-05) | ✅ |

## Decisions Made

None beyond the plan-listed decisions and the five in the `key-decisions` frontmatter. Both tasks executed exactly as specified in the plan's `<action>` steps.

**One noted design choice worth documenting:** The plan's `<action>` steps 1–8 only explicitly required Axis A/D/E cache preservation for the two new fields. Extending `advanceSessionLastMessageAt` + `advanceSessionAiTitle` (Axis B + Axis C chokepoint helpers) was NOT in the plan's <action> steps but IS covered by the same Pitfall-3 invariant — a fresh `lastMessageAt` or `aiTitle` arriving before any Axis F/G frame would have wiped the newly-set-null defaults. Applied Rule 2 (auto-add missing critical functionality) and extended both helpers with `lastStopAt: existing?.lastStopAt ?? null` + `lastStatusChangeAt: existing?.lastStatusChangeAt ?? null`. Tracked here for transparency; no additional tests written for this (Test P already indirectly covers Axis A which is the primary attack surface).

## Deviations from Plan

Two minor Rule-2 auto-adds (both correctness-preserving extensions of the plan's declared invariants):

**1. [Rule 2 - Critical functionality] Extended `advanceSessionLastMessageAt` + `advanceSessionAiTitle` to preserve the two new axes**

- **Found during:** Task 1 (WorkingRecord type extension surfaced the missing fields in the record literals).
- **Issue:** Both chokepoint helpers construct fresh `WorkingRecord` literals; with the new fields added to the type, TypeScript would flag missing properties AND the runtime behavior would default them to null-on-every-write (wiping cached values from prior Axis F/G frames). The plan's `<action>` steps 1–8 only called for Axis A/D/E preservation.
- **Fix:** Added `lastStopAt: existing?.lastStopAt ?? null` + `lastStatusChangeAt: existing?.lastStatusChangeAt ?? null` to both helpers' `nextRecord` literals (matching the same Pitfall-3 pattern as Axis A/D/E).
- **Files modified:** `src/ui/state/session-working-store.ts` lines ~419–420 (lastMessageAt helper) and ~510–511 (aiTitle helper).
- **Commit:** `9f759367`.

**2. [Rule 2 - Critical functionality] Extended `getSessionWorkingSnapshot` return-type**

- **Found during:** Task 2 (Test P asserts on snapshot fields directly).
- **Issue:** The exported `ReadonlyMap` value type explicitly enumerated `{ isWorking, lastMessageAt, aiTitle, dormant, recycling }` and did not include the two new axes. Test P's `snap.get("h1:s1")?.lastStopAt` would TS-error under strict mode; consumers that inspect the snapshot would see incomplete type info.
- **Fix:** Extended the return-type shape to include `lastStopAt: number | null` and `lastStatusChangeAt: number | null` with a Phase 61 comment.
- **Files modified:** `src/ui/state/session-working-store.ts` lines ~666–678.
- **Commit:** `9f759367`.

Both auto-adds match the pattern the plan established for prior additive axes and are strictly additive to the plan's declared invariants. No other Rule 1/3/4 triggers.

- Rule 1 (auto-fix bugs): not triggered — all pre-existing tests remained green after Task 1.
- Rule 3 (auto-fix blocking issues): not triggered.
- Rule 4 (architectural questions): not triggered.

## Issues Encountered

None. The one minor "gotcha" is worth calling out: Test B was expected by the plan to potentially FAIL after the predicate change ("that failure is the wire-up validation"). In practice, Test B remained GREEN because `makeState({ status: "shell" })` omits both `lastStopAt` and `lastStatusChangeAt` fields — the predicate normalizes both to null and hits the default-on rollout-safety branch, which correctly returns `true` (matching the old expectation numerically). The plan's Task 2 explicitly revises Test B's header + describe + it titles + comments to reflect the NEW semantics (default-on rollout-safety branch, not unconditional shell-is-work) — so the deliberate revision is preserved even though the assertion body's truth-value is unchanged.

## User Setup Required

None — no new packages installed, no external service configuration, no environment-variable changes. All changes are frontend source-only under `src/ui/state/`.

## Known Stubs

None. Every code path in the extended predicate + Axis F/G blocks handles its full contract:
- Predicate: (a) `busy` → true unconditionally, (b) `shell` + `lastStopAt === null` → true (default-on rollout safety), (c) `shell` + `lastStatusChangeAt > lastStopAt` → true (mid-turn shell), (d) `shell` + `lastStatusChangeAt <= lastStopAt` → false (stale-shell), (e) `shell` + `lastStatusChangeAt === null` (but `lastStopAt !== null`) → false (Stop seen but no post-Stop status transition tracked — conservative false).
- Axis F/G: undefined preserves; null explicit-resets; number sets. All three paths covered by the plan's action-step spec and exercised by Test P (undefined-preserves via Axis A republish path).

## Threat Flags

None. The plan's `<threat_model>` already covered every new surface (T-61-03-01 through T-61-03-04). No new network endpoints, no new auth surface, no new file-access patterns — this plan is a strict source-diff within an existing frontend module and touches no I/O or trust boundary beyond the SessionState wire boundary already established by Waves 1 + 2.

## TDD Gate Compliance

This plan's `<task type="auto" tdd="true">` declarations are two-task per-file — Task 1 is source code (`session-working-store.ts`) and Task 2 is tests (`session-working-store.test.ts`). Same shape as prior additive-axis phases (52-Task-2 dormant / 53-Task-1 recycling / 61-02).

The RED gate for the new-predicate behavior is inherent to Task 2's four new tests, which would have all FAILED against the pre-Task-1 predicate:
- Test M (`shell + stale stop → false`) would have returned `true` under the old `busy || shell` predicate.
- Test N (`shell + fresh status-change → true`) would have returned `true` under the old predicate (same answer, but for the wrong reason — vacuously via the old shell-is-work rule).
- Test O (`busy bypasses stop-gate → true`) would have returned `true` under the old predicate (same answer, vacuously — busy → true).
- Test P (`Axis A preserves cached lastStopAt`) would have FAILED because the pre-Task-1 WorkingRecord didn't have a `lastStopAt` field to preserve — snapshot inspection would find `undefined`.

The Task 1 commit (`9f759367`) landed the source change; Task 2 commit (`f539c3bd`) landed the tests that lock the new behavior. Wave 1 (61-01) and Wave 2 (61-02) already established full RED-then-GREEN cycles for the wire schema extension + backend derivation via their combined 16 new tests, so the phase's cumulative TDD gate compliance is intact.

## Next Phase Readiness

**Phase 61 is code-complete.** The vertical slice is fully wired:

1. **Wave 1 (harness + wire):** managed-box Stop hook writes per-session file; `SessionStateSchema` extended with `lastStopAt` + `lastStatusChangeAt` as `z.number().nullable().optional()`; frontend `SessionState` mirror in lockstep. FRAME_SCHEMA_VERSION held at 1.
2. **Wave 2 (backend derivation):** `processPid` derives both axes server-side (per-session Stop-file mtime + poll-to-poll status-value delta), stamps both on every SessionState frame, both participate in `computeFingerprint` so axis-only flips publish new frames.
3. **Wave 3 (frontend predicate — THIS PLAN):** WorkingRecord gains both cached axes; `main` predicate revised to consume them via the stop-gate shape; Axis F/G swap-and-notify blocks appended; Test B revised + four new tests locking the canonical cases.

**Consumer surfaces inherit the fix without modification.** The `useSessionIsWorking` hook is unchanged; every consumer (WipBubble in PrettyView, row dot in PrettyConversationRow) reads the revised predicate's output automatically.

**Ready for the orchestrator's deploy motion.** No deploy task at executor scope per the plan's `<success_criteria>` and CLAUDE.md fleet rule.

## Poppy/aqua/wilma post-deploy prediction

On the next Phase 61 deploy (which ships the Wave-1 stop-hook script upgrade via the STOP_HOOK_SCRIPT_CONTENTS byte-in-sync install path AND the Wave-2/Wave-3 code):

**Immediate (deploy tick + 1):** Poppy, aqua, wilma are still lit — the predicate reads `lastStopAt === null` for all three (backend hasn't seen any Phase-59 Stop-hook file yet for them; wire carries `lastStopAt: null`), so the default-on rollout-safety branch fires → `shellCountsAsWork = true` → `main = true` → indicator on. This is the correct lazy-rollout behavior — no false-negatives, no wake of sleeping sessions.

**On the next real turn end for each session:** the newly-installed Phase-59 stop-hook fires (their Claude Code sessions execute a turn, hit the Stop event, the hook script writes `~/.claude/fleet-status/stop-<sessionId>.json` for the first time). The Wave-2 backend's next 2s poll tick reads the file's mtime via the added `stat -c %Y` exec, stamps `lastStopAt: <mtime * 1000>` on the SessionState frame, and publishes.

**Immediately after that first Stop-file-observed frame:** the Wave-2 backend also stamps `lastStatusChangeAt` — either the seed value from the first-appearance PidCacheEntry (if the PID cache was cold at that tick), or a preserved value from prior ticks. Because the harness-observed status was already `shell` at the time of Stop (that's what caused this whole phase), `lastStatusChangeAt` reflects a timestamp from 18–20 hours ago (when the session initially transitioned to shell), which is now strictly LESS than the freshly-stamped `lastStopAt`.

**Wave-3 predicate reads:** `lastStopAt = <now>`; `lastStatusChangeAt = <18h ago>`. `shellCountsAsWork = shell && (lastStopAt === null || lastStatusChangeAt > lastStopAt)` = `shell && (false || false)` = `false`. `main = busy || false` = `false`. `isWorking = main || bg` = `false` (assuming ambient bg tasks were already filtered by the watcher). **Indicator flips OFF.** Ashley's UAT signal.

Any subsequent real turn for these sessions will flip busy → shell → busy → shell during work; the Wave-2 backend bumps `lastStatusChangeAt` on every transition, so `lastStatusChangeAt > lastStopAt` while the turn is running and the indicator lights back up correctly. When the turn ends and the Stop hook fires, `lastStopAt` advances past `lastStatusChangeAt` again and the indicator returns to off. Steady-state honest.

## Self-Check: PASSED

Verified all claims:

- `src/ui/state/session-working-store.ts` — FOUND (modified in `9f759367`).
- `src/ui/state/session-working-store.test.ts` — FOUND (modified in `f539c3bd`).
- Commit `9f759367` — FOUND in `git log --oneline -5`.
- Commit `f539c3bd` — FOUND in `git log --oneline -5`.
- Scoped test suite `npx vitest run src/ui/state/session-working-store` — 64/64 green.
- Frontend TS typecheck — zero errors in session-working-store.ts (pre-existing errors in unrelated files out-of-scope).
- Every acceptance-criteria grep passes at or above threshold (see Verification tables above).
- Zero files changed under `src/ui/features/pretty-view/` or `src/ui/features/pretty-conversations/` per `git diff --stat`.

---
*Phase: 61-wip-indicator-shell-idle-gate*
*Completed: 2026-08-29*
