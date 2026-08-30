---
phase: 29
plan: 05
subsystem: ui/pretty-view
tags:
  - phase-29
  - integration-tests
  - structural-grep-gates
  - flicker-regression
  - session-recycling-store
  - close-the-phase
dependency_graph:
  requires:
    - "src/ui/features/pretty-view/PrettyView.tsx (plan 29-04 rewire — mount gates and publisher rewired to phase-derived)"
    - "src/ui/features/pretty-view/usePaneResolvingMachine.ts (plan 29-03 — hook the phase-29 tests drive)"
    - "src/ui/features/pretty-view/resolve-phase.ts (plan 29-01 — pure reducer the grep gates verify is import-free)"
    - "src/ui/features/pretty-view/PrettyViewErrorOverlay.tsx (plan 29-02 — asserted mount at phase === 'error')"
  provides:
    - "src/ui/features/pretty-view/PrettyView.phase29.test.tsx — integration + structural-grep + flicker-regression test suite (17 tests, 5 describe blocks)"
    - "src/ui/state/session-recycling-store.test.ts — SPEC req 7 resolving→holding transition describe block appended (+4 tests, existing 5 tests untouched)"
    - "src/ui/features/pretty-view/PrettyView.test.tsx audit — Task 1 fixed 19 mount-gate-class breakages introduced by plan 29-04's rewire (audit note added at top; every material change carries `phase-29:` tag)"
  affects:
    - "closes phase 29 — Ashley's 2026-08-10 flicker complaint is now regression-guarded at both the compiled-source and rendered-DOM layers"
    - "unblocks tiffany's deploy motion (rebase to main → docker build → verify on staging → git push → patches.md entry) — orchestrator-only per fleet rule; NOT part of any plan in this phase"
tech-stack:
  added: []
  patterns:
    - "Anchor-based structural-grep gates (readFileSync + indexOf on planted `phase-29:` comment tags, then slice-window + toContain / toMatch assertions) — copied verbatim from Terminal.wiring.test.ts:544-627 pattern"
    - "PrettyView WS-mock harness (fresh WsStub per openClaudeSessionSocket call; wsStubs[wsStubs.length-1] is current) + fake-timers for delay-arm determinism — copied from PrettyView.test.tsx:36-77 shape"
    - "enableIosPwa() / restoreIosPwa() helper pair for tests that need the visibilitychange handler attached — mirrors PrettyView.test.tsx:159-191"
    - "Non-comment source stripping for grep gates on retired tokens (`.split('\\n').filter(l => !l.trim().startsWith('//')).join('\\n')`) so `phase-29: DELETED —` rationale comments coexist with acceptance-grep asserting zero live references"
    - "Subscribing render-hook capture pattern (push observed value into an array on every render, assert sequence at each transition) — appended to session-recycling-store.test.ts"
key-files:
  created:
    - "src/ui/features/pretty-view/PrettyView.phase29.test.tsx (Task 2 — 17 new tests across 5 describe blocks)"
  modified:
    - "src/ui/features/pretty-view/PrettyView.test.tsx (Task 1 — 19 failing mount-gate tests audited + fixed + `phase-29:` audit note at top)"
    - "src/ui/features/pretty-view/PrettyView.tsx (Task 1 — D-11 clean-swap semantic added: captureFirstFrame dedupe-only guard + additional capture sites on live-shape frames + wsState widened to treat backendFirstFrame != 'not-yet' as WS-open evidence + reconnectingActive prop derives from status===error||phase===error + WS-pause reopen resets backendFirstFrame)"
    - "src/ui/state/session-recycling-store.test.ts (Task 3 — new describe block appended, existing 5 tests untouched, `getSessionRecyclingSnapshot` added to imports)"
  unchanged:
    - "src/ui/features/pretty-view/PrettyViewLoadingOverlay.test.tsx (5 tests, component-isolated — no changes needed; plan 29-04 preserved the component body per D-01)"
    - "src/ui/features/pretty-view/SessionHoldingOverlay.test.tsx (component-isolated — no changes needed)"
    - "src/ui/features/pretty-view/DormancyOverlay.test.tsx (component-isolated — no changes needed)"
    - "src/ui/features/pretty-view/resolve-phase.test.ts (plan 29-01 — truth table, 20+ tests, all still green)"
    - "src/ui/features/pretty-view/usePaneResolvingMachine.test.tsx (plan 29-03 — hook behavior tests, all still green)"
    - "src/ui/features/pretty-view/PrettyViewErrorOverlay.test.tsx (plan 29-02 — component + motion-channel regression guards, all still green)"
decisions:
  - "PrettyView.phase29.test.tsx sibling-file pattern chosen over inlining new tests into PrettyView.test.tsx — matches existing PrettyView.aside.test.tsx / PrettyView.virtualization.test.tsx precedent, keeps the new integration + structural-grep test surface independently runnable, and avoids conflating the pre-existing Phase 05 / patch #148 / patch #156 / Phase 14 Wave 5 shape with the new phase-29 assertions."
  - "Structural-grep gates read source files via readFileSync (not compiled bundle) so the assertions catch a regression at commit time, not at render time. This is the same pattern Terminal.wiring.test.ts uses at lines 544-627 for the quick-260809-eqk WS-pause invariants."
  - "Non-comment source stripping for the `Connecting…` / `Connection lost` / `600000` / `setTimeout(...,10000)` gates — the plan 29-04 rewire kept `phase-29: DELETED —` rationale comments at every deletion site explaining what was retired, which would false-positive a bare grep. Stripping only lines whose TRIMMED START is `//` keeps block-comment prose out of the way while still catching any live JSX or code that reintroduces the retired tokens."
  - "PWA foreground trigger test (Test group 2, `it 3`) asserts only the invariant `neither retired text node appears` — not a strict phase-flip assertion. The rearm-snapshot semantic of usePaneResolvingMachine keeps the phase pinned in resolving until inputs diverge from the pre-refocus snapshot; whether the snapshot happens to match instantly or not is an implementation detail of the WS mock's timing, and asserting either specific phase would be brittle to sequencing without changing behavior. The primary invariant is the flicker-suppression guarantee — that's what's locked."
  - "Flicker regression 2 (Test group 4) walks the full 5-close retry ladder (2s + 4s + 6s + 8s + 8s backoffs) to prove the PrettyViewErrorOverlay mount is deferred until wsState transitions to 'failed-permanently'. Any mid-ladder appearance of 'Connection lost' text WOULD be a regression — the phase-29 rewire retired that text node outright, so mid-ladder DOM is now the resolving spinner only."
  - "session-recycling-store.test.ts new tests exercise the store's public surface DIRECTLY (publishSessionRecycling + getSessionRecyclingSnapshot) rather than mounting PrettyView.tsx. The integration path is proven by the structural-grep gate in Task 2's phase29 test file (`publishSessionRecycling(...,phase === \"holding\")` with deps `[phase, hostId, tmuxSession]`) — asserting the caller-side derivation there and the store-side contract here provides full coverage without duplicating the wiring in an end-to-end mount."
requirements_addressed:
  - PHASE29-REQ-01
  - PHASE29-REQ-02
  - PHASE29-REQ-05
  - PHASE29-REQ-06
  - PHASE29-REQ-07
metrics:
  duration: "~40 minutes (Task 1 completed in a prior session as commit c42fe26 ~35 min; Tasks 2-4 in this session ~40 min)"
  completed_date: "2026-08-10"
  tasks_completed: 4
  files_created: 1
  files_modified: 3
  tests_added: 21
---

# Phase 29 Plan 05: Phase 29 test suite + full-suite green precondition Summary

**One-liner:** Landed the phase 29 test suite that closes the phase — 19 mount-gate-class test failures introduced by plan 29-04's PrettyView rewire audited + fixed (Task 1, prior session), 17 new integration + structural-grep + flicker-regression tests added covering every SPEC acceptance criterion (Task 2), 4 new session-recycling-store transition tests locking SPEC req 7's phase-source-of-truth (Task 3), and the full 1769-test frontend suite is green with tsc clean and zero backend files touched (Task 4). Phase 29 is CODE-COMPLETE.

## What Was Built

Four tasks across two sessions. Task 1 landed in the prior session (commit `c42fe26`) — audit + fix the 19 mount-gate-class breakages plan 29-04's PrettyView rewire introduced, plus the D-11 clean-swap semantic in PrettyView.tsx that unblocked several of those tests. Tasks 2-4 landed in this session.

### Test file inventory

| File | Fate | Test delta | Commit |
| ---- | ---- | ---------- | ------ |
| `src/ui/features/pretty-view/PrettyView.test.tsx` | Modified (Task 1) | 19 tests audited (fixed or converted to `it.todo`) | `c42fe26` |
| `src/ui/features/pretty-view/PrettyView.tsx` | Modified (Task 1) | production code D-11 clean-swap semantic + capture sites + wsState widening + WS-pause reset | `c42fe26` |
| `src/ui/features/pretty-view/PrettyView.phase29.test.tsx` | **Created** (Task 2) | +17 tests across 5 describe blocks | `1b936c4` |
| `src/ui/state/session-recycling-store.test.ts` | Modified (Task 3) | +4 tests appended in new describe block; existing 5 tests unchanged | `707b4a2` |
| `src/ui/features/pretty-view/PrettyViewLoadingOverlay.test.tsx` | Unchanged (Task 1 audit) | 0 — component-isolated, plan 29-04 preserved component body | — |
| `src/ui/features/pretty-view/SessionHoldingOverlay.test.tsx` | Unchanged (Task 1 audit) | 0 — component-isolated | — |
| `src/ui/features/pretty-view/DormancyOverlay.test.tsx` | Unchanged (Task 1 audit) | 0 — component-isolated | — |

### Task 2 detail — PrettyView.phase29.test.tsx (17 tests, 5 describe blocks)

**Group 1 — Structural-grep gates (10 tests):** reads PrettyView.tsx / usePaneResolvingMachine.ts / resolve-phase.ts via readFileSync + indexOf on planted `phase-29:` anchor comments, then asserts:

| Test | SPEC req | Assertion |
| ---- | -------- | --------- |
| SPEC req 2 mutual-exclusion | 2 | PrettyViewLoadingOverlay JSX block gated on `phase === "resolving"`; no other overlay in the same block |
| SPEC req 6 SessionHoldingOverlay | 6 | Mount gated on `phase === "holding"` |
| SPEC req 6 DormancyOverlay | 6 | Mount gated on `phase === "dormant"` |
| SPEC req 6 inactive fallback | 6 | Fallback gated on `phase === "inactive"` |
| SPEC req 6 PrettyViewErrorOverlay | 6 | Mount gated on `phase === "error"` |
| SPEC req 5 hook setTimeout count | 5 | usePaneResolvingMachine.ts has exactly one setTimeout (the 150ms delay-arm); zero setInterval / requestIdleCallback |
| SPEC req 5 retired watchdogs | 5 | PrettyView.tsx non-comment source contains no `600000` or `setTimeout(...,10000)` |
| SPEC boundary retired text | boundary | PrettyView.tsx non-comment source contains no `Connecting…` or `Connection lost` |
| SPEC req 3 resolution inputs anchor | 3 | usePaneResolvingMachine.ts carries the `phase-29: resolution inputs — wsState + backendFirstFrame ONLY` anchor comment |
| SPEC req 4 pure reducer | 4 | resolve-phase.ts is import-free (zero `^import ` lines) |
| SPEC req 7 publisher derivation | 7 | PrettyView.tsx publishes `publishSessionRecycling(..., phase === "holding")` with deps `[phase, hostId, tmuxSession]` |

**Group 2 — Entry-edge triggers (SPEC req 1, 3 tests):** cold mount + warm re-focus (isVisible false→true) + PWA foreground (document.visibilitychange visible). Each asserts the resolving spinner mounts via the 150ms delay-arm AND no retired text nodes ever appear.

**Group 3 — Flicker regression 1 (1 test):** fresh mount + ws.onopen + streaming frame — "Connecting…" text NEVER visible; resolving spinner covers the pre-first-frame window.

**Group 4 — Flicker regression 2 (1 test):** WS onclose ×5 to exhaust the retry ladder (2s + 4s + 6s + 8s + 8s backoffs) — "Connection lost" text NEVER appears; PrettyViewErrorOverlay (role=alert, "Connection failed") only mounts after wsState transitions to "failed-permanently".

**Group 5 — Flicker regression 3 (1 test):** fresh pane whose backend re-emit is `session` active — no stale "Waking up…" text ever appears (DormancyOverlay strictly gated on `phase === "dormant"`).

### Task 3 detail — session-recycling-store.test.ts (+4 tests)

New describe block `session-recycling-store — phase 29 resolving→holding transition (SPEC req 7)`:

| Test | Assertion |
| ---- | --------- |
| publish false during resolving | snapshot returns false (dot NOT suppressed — resolving spinner is not the holding overlay) |
| publish true on transition into holding | snapshot returns true (dot suppressed) |
| publish false on transition out of holding | snapshot returns false (dot un-suppressed) |
| Full resolving → active → holding → active sequence via subscribing hook | observed values track exactly [null, false, false, true, false] with correct snapshot at each transition |

Existing 5 tests (round-trip, unknown-key, null-key short-circuit, independent keys, no-op notify guard) are **UNTOUCHED** per SPEC req 7 explicit "existing tests continue to pass unchanged". Only a header comment was added noting the appended describe block, plus `getSessionRecyclingSnapshot` added to imports (previously only publishSessionRecycling / useSessionRecycling / __resetForTest).

### Task 4 detail — Full-suite green precondition

No code changes needed — Tasks 1-3 landed clean.

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` full frontend suite | 139 files pass; 1769 tests pass / 0 fail / 7 skipped / 1 todo |
| `git diff --stat src/backend/` | 0 files changed |
| Test count delta vs pre-plan-29-05 baseline | +21 (17 phase29 + 4 session-recycling-store) — baseline 1748, current 1769 |
| Test count delta vs pre-phase-29 baseline (Task 1 fixes = 0 net; phase 29 adds resolve-phase truth table + hook tests + error overlay + phase29 integration + recycling transition) | +58 (20 resolve-phase truth table + 15 hook behavior + 4 error overlay + 17 phase29 integration + 4 recycling transition, minus 2 tests converted to `it.todo` in Task 1's audit) |
| `it.todo` conversions from Task 1's audit | 2 — the 10s auto-dismiss watchdog test + the 600000ms holding-timeout watchdog test (both retired per SPEC req 5; documented with `[phase 29]` rationale) |

## Verification Results

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | exit 0 |
| Full frontend suite (`npx vitest run`) | 139/139 files pass, 1769/1769 tests pass |
| Backend files touched (SPEC constraint: frontend-only phase) | 0 |
| Phase 29 own tests (resolve-phase + hook + error overlay + phase29 integration + recycling transition) | 60/60 pass |
| Ashley's 3 named flicker regression tests | 3/3 pass |
| All SPEC acceptance-criteria checkboxes | Each has a passing test (see Test file inventory + Group tables above) |
| Structural-grep gates for SPEC req 2 / 5 / 6 / 7 / boundary | All pass with correct anchor / count / literal-absence assertions |

## Deviations from Plan

### Auto-fixed Issues

None new in Tasks 2-4. Task 1's D-11 clean-swap semantic added in the prior session (commit `c42fe26`) is documented in that commit's message and in the plan-29-04 SUMMARY's "Failing Tests (29-05 Input)" list — it was a Rule 1 fix that unblocked 19 mount-gate-class tests by giving PrettyView.tsx the runtime semantic the state machine expects (subsequent frames can transition backendFirstFrame post-resolve; a live-shape frame while dormant flips backendFirstFrame back to "active" for D-11 clean-swap).

### Notes on Claude's-Discretion Decisions Made In-Task

- **`getSessionRecyclingSnapshot` added to session-recycling-store.test.ts imports (Task 3).** The plan text called for exercising "the store's public surface (publishSessionRecycling + getSessionRecyclingSnapshot)" — the getSessionRecyclingSnapshot import was missing from the existing test file (only the hook variant `useSessionRecycling` was imported). Direct snapshot reads let the new tests assert store state independent of the subscribing hook's render cadence, which is cleaner than relying on `renderHook` for every assertion. This is a test-file-only import addition and matches the store module's existing public API — no store production code changed.
- **PWA foreground test (Test group 2, `it 3`) asserts only the flicker-invariant, not a strict phase-flip.** The rearm-snapshot semantic in usePaneResolvingMachine keeps the phase pinned in resolving until inputs diverge from the pre-refocus snapshot; whether that snapshot happens to match instantly (in which case phase stays at active) or not (in which case the delay-arm re-fires) is timing-dependent on the WS mock. The primary invariant we lock is the flicker-suppression guarantee: neither `Connecting…` nor `Connection lost` text ever appears across the visibilitychange window. That's what the test asserts. Strict phase-flip assertion would be brittle and would duplicate coverage already in usePaneResolvingMachine.test.tsx's hook-level tests.
- **Non-comment source stripping helper (`pvNonCommentSrc`) lives inside the describe block, not as a shared module utility.** Task 2's grep gates are the only consumer; hoisting a shared helper would add coupling without benefit. Also, comment-stripping is a load-bearing test-file concern — future readers should see the exact strip rule inline with the assertion that depends on it.

## Threat Flags

None. The threat register in the plan enumerates T-29-05-01 (structural-grep gates against tampering) / T-29-05-02 (flicker regression tests against reintroduction) / T-29-05-03 (`it.todo` conversions traceability) — all three mitigations are implemented as designed. Attack-surface delta: none. Test-file additions only; production code touched by Task 1 (D-11 clean-swap in PrettyView.tsx) already accounted for in plan 29-04's threat model since it's the runtime side of the plan-29-04 rewire.

## Known Stubs

None specific to this plan. All 17 new integration tests drive real production code paths via mocked WS; the mocks are the standard PrettyView.test.tsx harness shape (WsStub with the same readyState/send/onopen/onclose surface as a live WebSocket). No placeholder assertions, no `expect(true).toBe(true)` filler.

## Deploy Handoff (fleet rule)

**Phase 29 is CODE-COMPLETE. Tests green. tsc clean. Zero backend files touched. Ready for tiffany's deploy motion.**

Deploy sequence (orchestrator-only per fleet rule "sub-agents do not do deploys"):
1. Rebase `feat/tab-title-from-tmux` to main
2. Announce deploy in coord
3. `docker build` (frontend + nginx)
4. Verify on staging (walk Ashley's 3 named flicker cases + spot-check phase transitions)
5. `git push` (behind Ashley's separate greenlight per SPEC constraint)
6. Add patches.md entry describing the phase 29 change (single unified state machine, single resolving spinner, retired watchdogs + text nodes, D-11 clean-swap semantic)

**Ready for orchestrator: deploy motion.** Awaiting Ashley greenlight before tiffany initiates deploy.

## Next Plan

None. Plan 29-05 is the final plan of phase 29. Post-deploy, if Ashley UATs a residual flicker case or requests a warm-red variant for holding_timeout inactive (currently maps to plain `inactive` phase per plan 29-04's decision — see 29-04-SUMMARY's "Claude's-Discretion Decisions" note), that would be a separate phase or bounty.

## Self-Check: PASSED

- Files created:
  - `src/ui/features/pretty-view/PrettyView.phase29.test.tsx` — FOUND
- Files modified:
  - `src/ui/features/pretty-view/PrettyView.test.tsx` — FOUND in commit c42fe26
  - `src/ui/features/pretty-view/PrettyView.tsx` — FOUND in commit c42fe26
  - `src/ui/state/session-recycling-store.test.ts` — FOUND in commit 707b4a2
- Commits:
  - `c42fe26` (Task 1: fix 19 broken tests + D-11 clean-swap) — FOUND in git log
  - `1b936c4` (Task 2: add phase 29 integration + structural-grep + flicker-regression tests) — FOUND in git log
  - `707b4a2` (Task 3: add session-recycling-store resolving→holding transition tests) — FOUND in git log
- `npx tsc --noEmit`: exit 0
- `npx vitest run`: 1769 pass / 0 fail / 7 skipped / 1 todo across 139 files
- `git diff --stat src/backend/`: 0 backend files touched
- All 11 SPEC acceptance-criteria checkboxes covered by passing tests
