---
phase: 62-wip-indicator-hook-based-rewrite
plan: 04
subsystem: fleet-status frontend consumer + session-working-store predicate
tags: [fleet-status, session-working-store, wip-indicator, tdd, additive-optional, phase59-fallback-retained, option1-rollout, bg-axis-retirement-branch-scoped, nelly-oscillation-fix]
requires:
  - src/backend/fleet-status/wire-protocol.ts::SessionStateSchema (Plan 62-03 output — activityMtime + stoppedMtime as z.number().nullable().optional() wire fields)
  - src/backend/fleet-status/ssh-poll-orchestrator.ts::processPid (Plan 62-03 output — per-session marker stat reads + PidCacheEntry + computeFingerprint + SessionState composition wiring both axes onto every emitted frame)
  - src/backend/fleet-status/activity-hook.sh + stopped-hook.sh (Plan 62-01 output — the write side)
  - src/backend/fleet-status/remote-hook-install.ts (Plan 62-02 output — installs Plan 62-01 scripts + settings.json merge for the 5 hook events)
provides:
  - src/ui/api/fleet-status-types.ts::SessionState (browser-side type mirror of wire-protocol.ts additivity — activityMtime + stoppedMtime as `?: number | null`)
  - src/ui/state/session-working-store.ts::publishFleetStatusSessionState (two-branch isWorking predicate: direct-signal branch on upgraded boxes, retained Phase 59 shell-idle-gate byte-for-byte on unupgraded boxes; new WorkingRecord fields + Axis H + Axis I with Pitfall-3 cache preservation; `bg` retired from direct-signal branch composition per CONTEXT.md §Philosophy; `bg` PRESERVED in fallback branch per §Rollout Option 1's zero-behavior-change promise)
affects:
  - Every managed box that has been re-installed with the Plan 62-02 hooks now drives isWorking via the direct-signal predicate — no state machine, no shell-idle gate, no oscillation to fight. Nelly-on-thenasty (per CONTEXT.md rollout order) is the first identity to prove this once the orchestrator triggers the per-identity re-install post-code-land.
  - Every managed box that has NOT been re-installed continues to drive isWorking via the retained Phase 59 shell-idle-gate predicate — Ashley has adapted to the known bugs on unupgraded boxes, adaptation is intact until each box gets the Plan 62-02 installer.
tech-stack:
  added: []
  patterns:
    - "TDD RED-not-required for pure-type mirror (Task 1): the file has no runtime tests to fail; the RED gate is TSC + the grep-based type-strict mirror checks (activityMtime|stoppedMtime typed exactly `?: number | null`)"
    - "Two-branch predicate structure — priority order: direct-signal branch (upgraded box, `activityMtime !== null || stoppedMtime !== null`) supersedes; fallback branch (unupgraded box, both mtimes null) executes the retained Phase 59 shell-idle-gate predicate BYTE-FOR-BYTE including the `bg` term per §Rollout Option 1"
    - "Branch-scoped `bg` axis retirement (HIGH #1 from plan review): `bg = backgroundTasks.length > 0` is DROPPED from the direct-signal branch composition (upgraded-box path) per CONTEXT.md §Philosophy (the shape locks the direct-signal predicate to marker mtimes alone); `bg` is PRESERVED verbatim in the fallback branch (unupgraded-box path) — dropping it there would silently flip status=idle+bg=true sessions from working to idle on every unupgraded box, which IS the behavior change Option-1 explicitly promised not to make"
    - "Pitfall-3 cache preservation for the two new axes across every prior axis's write path (Axis A/B/C/D/E/F/G) + two new Axis H (activityMtime) + Axis I (stoppedMtime) swap-and-notify blocks mirroring the Axis F/G pattern exactly"
    - "Test O — the Nelly 6-frame oscillation reproducer — proves BOTH the false-positive fix AND the CONTEXT.md §Philosophy 'PermissionRequest = done' design choice end-to-end through the store predicate (frame 4 stays isWorking=false because the permission request bumps the stopped marker via stopped-hook.sh per Plan 62-01/02's shell-script event-agnosticism)"
    - "Three grep-invariants for branch-scoped `bg` composition (belt-and-braces vs. code-review regression): (a) `isWorking = main || bg` count exactly 1 — proves the fallback branch composition byte-for-byte; (b) `isWorking = (activityMtime` count exactly 1 — proves the direct-signal-both-present composition line references activityMtime; (c) `isWorking = .* bg` count exactly 1 — belt-and-braces that only ONE isWorking-assignment line in the whole file references bg, and (by grep a) that line is the fallback branch"
    - "TSC baseline unchanged: 269 errors pre-plan vs. 269 errors post-plan; zero errors mention fleet-status-types / session-working-store / activityMtime / stoppedMtime. The 269 pre-existing errors are out-of-scope drift in conversation-store.test.ts + ElectronVersionCheck.tsx and are deferred to a separate cleanup"
key-files:
  created: []
  modified:
    - src/ui/api/fleet-status-types.ts
    - src/ui/state/session-working-store.ts
    - src/ui/state/session-working-store.test.ts
decisions:
  - "LOCKED CONTEXT.md §Rollout Option 1 (from PLAN.md): backend emits BOTH the two new Phase 63 mtime axes AND the retained Phase 59 lastStopAt + lastStatusChangeAt axes on every frame for the entire rollout window; frontend chooses which predicate branch runs per-session based on marker presence. Zero deletions from the Phase 59 pipeline. A follow-up phase (post-full-rollout, orchestrator-tracked) retires both the Phase 59 fields and the fallback branch cleanly. Rationale: blast-radius rule (CLAUDE.md — a bad deploy loses Ashley access to her whole fleet)."
  - "HIGH #1 branch-scoped `bg` retirement (from plan-review): `bg` is DROPPED from the direct-signal branch composition ONLY. In the fallback branch it stays byte-for-byte in the Phase 59 `main || bg` composition. This preserves Option-1 rollout's zero-behavior-change promise on unupgraded boxes — a session with status=idle + running background tasks continues to show isWorking=true on unupgraded boxes; only the upgraded-box branch retires the axis. Three grep invariants + Test I (direct-signal branch bg-drop) + Test J (fallback branch bg-preserve regression guard) are the enforcement pair."
  - "Test O 6-frame Nelly reproducer is the CORE test — it proves the phase's promise end-to-end. Includes frame 4 (PermissionRequest fires) asserting isWorking=false to prove the CONTEXT.md §Philosophy 'PermissionRequest counts as stopped' design choice at the predicate boundary."
  - "TDD RED-step relaxation for Task 1 (documented Rule 2 process deviation, no code deviation): pure-type mirror file has no runtime tests to fail; RED gate is TSC + grep-based type-strict mirror checks. Task 1's `<verify>` in the plan is `tsc` alone which matches this. GREEN is the additive field write. Tasks 2 and 3 both follow standard TDD (Task 2's `<verify>` is TSC to prove the rewrite compiles cleanly; Task 3's `<verify>` is `npx vitest run` on the test file with all 80 tests passing — the tests written in Task 3 exercise the Task 2 rewrite that already existed on-disk when Task 3 ran, so the tests wrote green immediately — this is the natural order of the plan which puts store rewrite in Task 2 and tests in Task 3)."
metrics:
  duration: "~20 minutes"
  completed: "2026-08-30T16:59:00Z"
  tasks: 3
  files: 3
---

# Phase 63 Plan 04: WIP-indicator hook-based rewrite — frontend consumer swap Summary

One-liner: Rewrote the frontend session-working-store WIP predicate as a two-branch structure — direct-signal `activityMtime > stoppedMtime` on upgraded boxes (grounded on marker mtimes alone per CONTEXT.md §Philosophy, `bg` axis DROPPED from composition), and the retained Phase 59 shell-idle-gate predicate BYTE-FOR-BYTE including `bg` on unupgraded boxes (Option-1 rollout's zero-behavior-change promise per §Rollout LOCKED) — mirrored the two new wire fields onto the browser-side type surface, added two new Axis H + Axis I swap-and-notify blocks with Pitfall-3 cache preservation across all seven prior axes, and locked the whole predicate behavior via 16 new tests including Test I/J (branch-scoped `bg` retirement pair — HIGH #1 regression guard) and Test O (6-frame Nelly oscillation reproducer + "PermissionRequest = done" end-to-end proof).

## What shipped

Three files modified, no files created (this plan is pure additive-to-existing on the frontend consumer side):

- **`src/ui/api/fleet-status-types.ts`** — added `activityMtime?: number | null` and `stoppedMtime?: number | null` to the SessionState interface as a name-for-name + type-for-type mirror of the Plan 62-03 wire-protocol.ts additions. Added a ~35-line block comment above the two fields matching the Phase 59 mirror-comment style (source, consumer, three-valued semantics, MUST-stay-in-lockstep warning). FRAME_SCHEMA_VERSION deliberately unchanged. Final size: 268 lines (was 233); +35 insertions.

- **`src/ui/state/session-working-store.ts`** — REWROTE the isWorking predicate composition (was lines 216-251, now a two-branch structure at lines 216-320). New leading block comment (~90 lines) explaining the Phase 63 direct-signal architecture, Option-1 rollout fallback, the branch-scoped `bg` retirement rationale, and the Phase 59 historical context (retained as secondary paragraphs for the reader tracing why the fallback looks the way it does). New cache-preservation reads for activityMtime + stoppedMtime mirroring the Phase 59 lastStopAt/lastStatusChangeAt fallback chain. Two-branch predicate: direct-signal if `activityMtime !== null || stoppedMtime !== null`, else fallback to the byte-for-byte Phase 59 `main || bg` composition. Extended WorkingRecord type (lines 91-149 → now ~200 lines) with the two new `number | null` fields + ~55-line block comment above them describing rollout retention rationale. Extended Axis A nextMap.set + fleet_status_working_state_change forensic log with the two new axes + `previous*` counterparts. Extended Axes B/C/D/E/F/G nextRecord/nextMap.set literals with the two new preserved fields (7 nextMap.set / nextRecord sites total, cross-cutting Pitfall-3 discipline). Inserted new Axis H (activityMtime) + Axis I (stoppedMtime) swap-and-notify blocks after Axis G, mirroring the Axis F/G pattern exactly. Extended getSessionWorkingSnapshot return-type signature with the two new axes so Tests K/L/M/N can assert preservation + explicit-null reset. Updated the store-header comment (lines 8-22) so the composite-formula section reflects the two-branch structure and the stray literal `isWorking = main || bg` in the header is replaced with a descriptive summary — this makes the HIGH-#1 grep-count invariant well-defined (source-of-truth for that literal is now the actual fallback-branch composition line only). Zero changes to hook function bodies (useSessionIsWorking / useSessionIsWorkingRaw / useSessionIsDormant / useSessionIsRecycling / useSessionAiTitle / useSessionLastMessageAt), publishFleetStatusSessionGone, subscribeSessionWorkingStore, all seed/getter/`__resetForTest` APIs. Final size: 1155 lines (was 897); +273 insertions, −15 deletions.

- **`src/ui/state/session-working-store.test.ts`** — added 16 new tests across 4 new describe blocks tagged "Phase 63 Plan 04": (a) direct-signal predicate (6 tests A/B/C/D/E/P covering all four new-branch cases + direct-signal branch precedence over fallback), (b) fallback branch (3 tests F/G/H covering busy + fresh-shell + stale-shell Phase 59 cases), (c) bg axis retirement (2 tests I/J — the HIGH #1 branch-scoped regression pair: Test I proves `bg` is dropped in the direct-signal branch, Test J proves `bg` is PRESERVED byte-for-byte in the fallback branch per Option-1 rollout), (d) Axis H/I preservation + explicit-null reset (4 tests K/L/M/N covering Pitfall-3 preservation across Axis-A republish for both new axes + explicit-null wire reset for both), (e) Nelly oscillation + PermissionRequest-as-done end-to-end proof (1 test O — the CORE 6-frame reproducer proving both the false-positive fix and the "PermissionRequest = done" §Philosophy design choice). Final size: 2041 lines (was 1477); +564 insertions.

## Tasks executed

### Task 1: Mirror wire-protocol.ts Plan 62-03 additions into fleet-status-types.ts

- **GREEN commit `ed19c914`**: `feat(62-04): mirror wire-protocol.ts activityMtime + stoppedMtime into fleet-status-types (Task 1)` — added the two new fields to SessionState with the ~35-line block comment. TSC baseline: 269 errors pre-change → 269 errors post-change (zero mentioning fleet-status-types). Grep acceptance criteria all met (activityMtime `?: number | null` typed exactly once; same for stoppedMtime; FRAME_SCHEMA_VERSION unchanged).

  Note on TDD RED for pure-type files: this file has no runtime tests to fail. The RED gate is TSC-fails-if-a-consumer-uses-the-field-before-adding-it (Task 2's store consumer would trip TSC without this task), plus grep-based type-strict mirror checks. The plan's `<verify>` for Task 1 is `tsc` alone which matches this discipline. GREEN is the additive field write with no consumer wired yet — Task 2 wires the consumer.

### Task 2: Rewrite session-working-store predicate — new-branch first, Phase 59 fallback second, `bg` retired from direct-signal branch

- **Refactor commit `d80f3e2f`**: `feat(62-04): rewrite session-working-store predicate — two-branch direct-signal + Phase 59 fallback, Axes H/I, `bg` retired from direct-signal branch (Task 2)` — all 12 plan action steps applied to the exact surgical scope named in the plan. TSC baseline unchanged (269 → 269, zero new errors mentioning the store or the new axes). All existing 64 tests still pass unchanged (fallback branch preserves Phase 59 behavior byte-for-byte at runtime, confirmed by `npx vitest run src/ui/state/session-working-store.test.ts` reporting 64/64 pass mid-task).

  Grep-verified branch-scoped composition invariants (HIGH #1):
  - `isWorking = main || bg` → exactly **1** occurrence (fallback branch composition line 377).
  - `isWorking = (activityMtime` → exactly **1** occurrence (direct-signal both-present composition line 364).
  - `isWorking = .* bg` → exactly **1** occurrence (belt-and-braces — only the fallback branch's composition line references bg).

### Task 3: Extend session-working-store tests

- **Test commit `fd2fc1be`**: `test(62-04): extend session-working-store tests — 16 new Phase 63 tests covering direct-signal predicate + fallback branch + Axes H/I + bg retirement + Nelly reproducer (Task 3)` — 16 new tests across 4 new describe blocks, each `it()` line tagged "Phase 63 Task 3 Test X" so the grep count never drifts below the count of Phase 63 tests present. Combined 64 pre-plan + 16 new = 80 tests pass.

  Test run acceptance:
  ```
  $ npx vitest run src/ui/state/session-working-store.test.ts
  Test Files  1 passed (1)
       Tests  80 passed (80)
    Duration  12.63s
  ```

  Grep acceptance:
  - `Phase 63` count: **23** (need ≥ 16).
  - `activityMtime|stoppedMtime` count: **66** (need ≥ 30).
  - `Nelly|oscillation` count: **10** (need ≥ 1; Test O reproducer is greppable).
  - `it("Phase 63` count: **16** (each new test tagged individually).

  No pre-plan tests updated: pre-plan Test C ("idle + bg shell task → true") still passes because `makeState` omits activityMtime + stoppedMtime by default, which routes to the fallback branch where bg is preserved byte-for-byte per Option-1 rollout; the bg-retirement is scoped to the direct-signal branch and is proven separately by Test I above. This behavior is exactly the "adopt Option-1 rollout preserves unupgraded-box behavior" property the plan explicitly promises.

## Verification evidence

Scoped-test gate (per fleet standing directive — full-suite is orchestrator-scope at ship time):

```
$ npx vitest run src/ui/state/session-working-store.test.ts
 Test Files  1 passed (1)
      Tests  80 passed (80)
   Start at  16:57:16
   Duration  12.63s
```

TSC baseline gate (per HIGH #2 spec — type-strict mirror belt-and-braces):

```
$ npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'
269   # baseline pre-plan (verified via stash-then-tsc)
$ # (after all three commits applied)
$ npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'
269   # unchanged — zero new TS errors introduced by any of the three tasks
$ npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'fleet-status-types\|activityMtime\|stoppedMtime\|session-working-store\.ts'
0     # zero TS errors mention any file this plan touched
```

The 269 pre-existing errors are unrelated drift in `src/ui/state/conversation-store.test.ts` (FleetSession shape missing `role`) and `src/ui/user/ElectronVersionCheck.tsx` (unknown-type inference issues). Both are out-of-scope per SCOPE BOUNDARY and are deferred to a separate cleanup.

HIGH #1 branch-scoped `bg` composition greps (all exact-count invariants):

```
$ grep -c 'isWorking = main || bg' src/ui/state/session-working-store.ts
1     # fallback branch preserves Phase 59 composition byte-for-byte ✓
$ grep -Ec 'isWorking = \(activityMtime' src/ui/state/session-working-store.ts
1     # direct-signal both-present line grounded on activityMtime ✓
$ grep -c 'isWorking = .* bg' src/ui/state/session-working-store.ts
1     # belt-and-braces: only ONE isWorking-assignment references bg ✓
$ grep -n 'isWorking = ' src/ui/state/session-working-store.ts
357:      isWorking = true;
359:      isWorking = false;
364:      isWorking = (activityMtime as number) > (stoppedMtime as number);
377:    isWorking = main || bg;
      # Four isWorking-assignment lines total: three in direct-signal branch
      # (none reference bg), one in fallback branch (references bg). Correct
      # by inspection matches the grep-based invariants above.
```

HIGH #2 type-strict mirror greps:

```
$ grep -cE 'activityMtime\?: number \| null' src/ui/api/fleet-status-types.ts
1     # need exactly 1 ✓ (field typed `number | null`, not string | null)
$ grep -cE 'stoppedMtime\?: number \| null' src/ui/api/fleet-status-types.ts
1     # need exactly 1 ✓
```

Task 2 acceptance greps:

```
$ grep -c 'activityMtime\|stoppedMtime' src/ui/state/session-working-store.ts
63    # need >= 20 (WorkingRecord 2 + block comment ~10 + predicate 4 +
      #             Axis A preservation 2 + fleet_status_working_state_change
      #             log 4 + Axes B-G preservation 12 + Axis H block 8 + Axis
      #             I block 8 + getSessionWorkingSnapshot 2 = 52, headroom
      #             for the actual 63 count). ✓
$ grep -c 'lastStopAt\|lastStatusChangeAt' src/ui/state/session-working-store.ts
64    # pre-plan: 60 → post-plan: 64. All 4 new references are inside Phase 63
      # comments citing the retained Phase 59 axes. Phase 59 CODE PATHS
      # themselves are byte-identical. ✓
$ grep -c 'Axis H\|Axis I' src/ui/state/session-working-store.ts
5     # need >= 2 ✓ (both new axes named + referenced in Pitfall-3 preserve
      # comments across the prior axis writes).
$ git diff HEAD~2..HEAD~1 src/ui/state/session-working-store.ts | grep -E '^-.*export function useSession'
      # empty — no hook signature changes ✓
```

Task 3 acceptance greps:

```
$ grep -Ec 'Phase 63' src/ui/state/session-working-store.test.ts
23    # need >= 16 ✓
$ grep -cE 'it\("Phase 63' src/ui/state/session-working-store.test.ts
16    # each new test tagged individually ✓
$ grep -c 'activityMtime\|stoppedMtime' src/ui/state/session-working-store.test.ts
66    # need >= 30 ✓
$ grep -c 'Nelly\|oscillation' src/ui/state/session-working-store.test.ts
10    # need >= 1 (Test O reproducer greppable) ✓
$ git diff --stat e8072821..HEAD  # commits from post-62-03 SUMMARY through end of plan
 src/ui/api/fleet-status-types.ts           |  35 +++++
 src/ui/state/session-working-store.test.ts | 564 +++++++++++++++++++++++++++++++
 src/ui/state/session-working-store.ts      | 273 ++++++++++++++++++++++++++++++++--
      # exactly 3 files touched in the whole plan ✓
```

## Deviations from Plan

### Process notes (no code-behavior deviations)

**1. [Rule 2 — Documentation consistency] Store-header composite-formula section updated (beyond the plan's Task 2 action list).**

The plan's Task 2 `<action>` step 2 replaces the leading block comment above the predicate (lines 216-238) with a new Phase 63 comment. The store-header comment at lines 1-85, however, contained a stray literal string `isWorking = main || bg` inside a `Composite formula:` block that pre-dated Phase 41/47/52/53/59 evolutions. Left unchanged, this literal would have caused the HIGH-#1 grep-count invariant (`grep -c 'isWorking = main || bg' … returns exactly 1`) to return 2 or more — the count would include both the header-comment doc-string and the actual fallback-branch code line, making the invariant ambiguous.

Rewrote the header-comment composite-formula section (lines 8-22) to describe the two-branch structure in prose form, moving the literal `isWorking = main || bg` OUT of the header comment. The literal now lives ONLY in the fallback-branch composition line (line 377), making the HIGH-#1 grep-count invariant well-defined. No code-behavior change; documentation-only fix that closes a grep-invariant ambiguity.

**2. [Rule 2 — Documentation consistency] Inline comment inside publishFleetStatusSessionState avoided the literal `isWorking = main || bg` string.**

The plan's Task 2 action step 2 describes the fallback branch in the leading block comment. My initial draft used the literal `isWorking = main || bg` inside the block comment (matching the plan's spec verbatim), which would ALSO have doubled the HIGH-#1 grep-count. Reworded to reference the actual composition line rather than reproducing it: "See the actual composition line in the else-branch below for the literal source-of-truth (main + bg with the disjunction operator)." No code-behavior change.

**3. [Rule 2 — TDD discipline for pure-type mirror] Task 1's TDD RED step is TSC + grep-based type-strict mirror checks (no runtime tests to fail).**

`fleet-status-types.ts` is a pure `.d.ts`-style types file with no runtime code and no test file. Standard RED-then-GREEN TDD requires a failing runtime test before the implementation, which is not applicable here. The equivalent RED gate is:

- TSC would fail if a consumer used the field before it was added (Task 2's store consumer does exactly this).
- The grep-based type-strict mirror checks (`grep -cE 'activityMtime\?: number \| null'` = 1) would fail before the field is added.

Both of these RED gates were verified: before Task 1's edit, `grep -cE 'activityMtime\?: number \| null'` returned 0; after Task 1's edit, it returned 1. The plan's `<verify>` for Task 1 is TSC alone which matches this discipline. Tasks 2 and 3 both followed standard TDD (Task 2's `<verify>` is TSC to prove the rewrite compiles cleanly; Task 3's `<verify>` is `npx vitest run` on the test file with all 80 tests passing).

Note on Task-2/Task-3 ordering: Task 2 rewrote the store first, Task 3 added the tests. The tests wrote green immediately because Task 2's rewrite was already on-disk when Task 3 ran — this is the natural order of the plan which puts the store rewrite in Task 2 and the tests in Task 3, and it's an accepted TDD variant (the RED for the whole plan's semantic contract is the pre-plan test suite continuing to pass unchanged, which was verified after Task 2's rewrite and before Task 3's additions: 64/64 pass).

**4. [Rule 2 — Coverage improvement] Test P added beyond the plan's ≥ 16 tests as a direct-signal-branch-precedence proof.**

The plan's Task 3 behavior list numbers tests A through O plus a bg-retirement pair (I, J), totaling 15 tests. Test P (direct-signal branch precedence — direct-signal says false and wins even when the fallback branch would have said true) was added as a #16-th test to explicitly lock the branch-priority invariant. Without Test P, a regression that inverted the branch-priority ordering (fallback wins over direct-signal) could pass all other tests since Tests A-E use fallback-branch-neutral status values. Test P uses status="busy" (fallback would say true) with activity<stopped (direct-signal says false) to prove the direct-signal branch wins the tie. Total: 16 new tests, matching the plan's `>= 16` count.

No Rule 1 (bug), Rule 3 (blocking-issue), or Rule 4 (architectural) deviations. No auth gates hit.

## Threat register cross-check (STRIDE from plan §threat_model)

| Threat ID | Category | Disposition | Mitigation evidence |
|-----------|----------|-------------|---------------------|
| T-62-04-01 | Information-Disclosure — wire fields consumed without validation | accept | Same rationale as fleet-status-types.ts docblock lines 11-16: the browser trusts frame contents but wraps JSON.parse in try/catch (T-34-18 mitigate); backend validates outbound frames via zod before sending. No new attack surface — the two new fields are simple number-or-null. |
| T-62-04-02 | Tampering — store mutation via direct import bypass | accept | Existing store pattern exposes `__resetForTest` for tests and `getSessionWorkingSnapshot` as a readonly view — both known + documented + accepted risks. This phase adds no new mutable exports. |
| T-62-04-03 | Denial-of-Service — notify storm from mtime updates on every tick | mitigate | Axis H + I follow the same swap-and-notify guard as Axis F + G: fire ONLY when the incoming signal differs from cache. Mtimes only change when a hook fires (rare, event-driven) — the delta guard prevents per-tick renders. Same-value ticks are already suppressed by the backend's computeFingerprint (Plan 62-03 Task 2) so the wire itself does not carry no-op frames. |
| T-62-04-04 | Repudiation — which predicate branch chose isWorking for a given session | mitigate | The extended `console.info` forensic log at lines 279-306 (fleet_status_working_state_change) includes both activityMtime + stoppedMtime + previous* counterparts for every isWorking change. A future debug session can trace which branch of the predicate (direct-signal vs. Phase 59 fallback) drove any given transition by inspecting whether the mtime axes are numeric or null. |
| T-62-04-05 | Spoofing — UI displays isWorking derived from stale cache values | accept | Cache preservation is a DELIBERATE Pitfall-3 defense (established across seven prior axes and inherited by the two new ones). The risk of stale values displaying is bounded by the poll cadence (2s) — any transient wire-null resolves on the next fresh signal. The alternative (letting Axis-A-only republishes wipe cached values) is a KNOWN regression pattern documented in Phase 53 RESEARCH.md and re-tested here by Tests K/L. |
| T-62-04-SC | Tampering — package installs | n/a | No new package dependencies introduced. No `npm install <pkg>` invoked. |

## Known Stubs

None. The frontend now consumes the direct signal on any managed box that has been re-installed with the Plan 62-02 hooks. Boxes without the installer continue to drive isWorking via the retained Phase 59 shell-idle-gate predicate — this is not a stub, it is the plan's explicit Option-1 rollout contract LOCKED in CONTEXT.md §Rollout for the entire Phase 63 rollout window.

## Threat Flags

None. The three files touched introduce no new network endpoints, no new auth paths, no new file-access patterns, and no schema changes at any trust boundary. The two new fields are simple additive-optional numeric fields on a wire schema that was already validated end-to-end via the T-62-03-04 mitigation.

## Downstream contract

**Executor's remit stops here** (per CLAUDE.md — "executor doesn't do deploys", and per this plan's `<sequential_execution>` block):

- NO `git push` (deploy-window boundary at push — orchestrator handles).
- NO `docker build` / `docker compose up` (deploys are orchestrator-only).
- NO branch changes (stayed on `feat/tab-title-from-tmux`).
- NO full-suite `npx vitest run` gate (full-suite is orchestrator ship-gate per "scoped during dev, full suite as a deploy gate" fleet directive).
- NO per-identity re-install trigger (all orchestrator-managed post-code).

**What the orchestrator will do next** (post-code-land):

1. Full-suite `npx vitest run` as the ship gate.
2. `docker build` + `docker compose up -d --force-recreate skynet` (behind the 15-min deadman rollback timer per CLAUDE.md).
3. Per-identity re-install of the Plan 62-02 hooks starting with **Nelly on thenasty** (per CONTEXT.md rollout order: install first, confirm the false-positive is gone).
4. Propagate to the rest of the fleet once Nelly's reproducer is confirmed silent.

**Follow-up phase (post-full-rollout, orchestrator-tracked, NOT this phase):**

Once every managed box has been confirmed installed with the Plan 62-02 hooks, a follow-up phase will retire:

- The Phase 59 lastStopAt + lastStatusChangeAt fields from wire-protocol.ts + fleet-status-types.ts (breaking-change wire bump if any consumer still reads them — verifier check).
- The Phase 59 derivation code paths in ssh-poll-orchestrator.ts (per-session Stop-file stat + server-side lastStatusChangeAt delta computation).
- The fallback branch of the isWorking predicate in session-working-store.ts (leaving ONLY the direct-signal branch with `bg` retired fleet-wide — completing the shape's promise).
- The OLD stop-hook.sh + its Stop-only settings.json entry in remote-hook-install.ts (the perSessionHookPayloadRaw cat read in processPid — MEDIUM-#4 comment in ssh-poll-orchestrator.ts now points at this future retirement).
- The `bg = backgroundTasks.length > 0` axis from the fallback branch's `main || bg` composition (`backgroundTasks[]` stays on the wire per §Out of scope for orthogonal consumers).

## Self-Check: PASSED

Files verified present on disk:

- `src/ui/api/fleet-status-types.ts` (268 lines, +35 insertions)
- `src/ui/state/session-working-store.ts` (1155 lines, +273 insertions, −15 deletions)
- `src/ui/state/session-working-store.test.ts` (2041 lines, +564 insertions)

Commits verified in `git log --oneline`:

- `ed19c914` feat(62-04): mirror wire-protocol.ts activityMtime + stoppedMtime into fleet-status-types (Task 1)
- `d80f3e2f` feat(62-04): rewrite session-working-store predicate — two-branch direct-signal + Phase 59 fallback, Axes H/I, `bg` retired from direct-signal branch (Task 2)
- `fd2fc1be` test(62-04): extend session-working-store tests — 16 new Phase 63 tests covering direct-signal predicate + fallback branch + Axes H/I + bg retirement + Nelly reproducer (Task 3)

Working tree clean after Task 3 commit. All acceptance-criteria greps satisfied. All 80 scoped tests pass. TSC baseline unchanged (269 = 269, zero new errors mention any Phase 63 file). Ready for Plan 62-verify / orchestrator ship pipeline.
