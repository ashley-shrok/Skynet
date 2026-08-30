---
phase: 62-invisible-dormancy-client-side-follow-up
plan: 01
subsystem: pretty-view
tags:
  - dormancy
  - optimistic-bubbles
  - pv-send-watchdog
  - timing
  - client-symmetric-widening
  - phase-60-follow-up
dependency_graph:
  requires:
    - src/backend/claude-session/pv-send-watchdog.ts (MARKER_FALLBACK_MS_MIRROR + GIVE_UP_MS_DORMANT — sizing coupling for D-62-02)
    - src/ui/features/pretty-view/PrettyView.tsx dormantRef (declared L1271, mirror useEffect L2381-2386)
    - src/ui/features/pretty-view/PrettyView.tsx handleOptimisticSend (L1082-1134)
  provides:
    - PENDING_SEND_TIMEOUT_MS_NORMAL (exported constant, 20_000)
    - PENDING_SEND_TIMEOUT_MS_DORMANT (exported constant, 220_000)
    - client_timeout_20s_normal (post-ship diagnostic reason label)
    - client_timeout_220s_dormant (post-ship diagnostic reason label)
    - Test 5b (locking test for dormant-branch defer + eventual fire)
  affects:
    - src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx (+56 lines, new Test 5b only)
    - src/ui/features/pretty-view/PrettyView.tsx (+43 / -3 lines)
tech_stack:
  added: []
  patterns:
    - "Arm-time ref read (dormantRef.current) — symmetric to backend __applyInputMessageForTests entry-time read of dormantLastEmitted (D-62-03)"
    - "Named-constant + rationale-comment coupling across frontend<->backend files that cannot import each other (see Phase 56 MARKER_FALLBACK_MS_MIRROR precedent)"
    - "Branched reason-label for post-ship grep-based diagnostics (D-62-04)"
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx
decisions:
  - "D-62-02: client dormant timeout sized at 220_000ms (10s margin over backend's 210_000ms ceiling from MARKER_FALLBACK_MS_MIRROR + GIVE_UP_MS_DORMANT). Verified backend constants at pv-send-watchdog.ts:83-100 match the plan's assumption before setting the client value."
  - "D-62-03: dormancy read at arm time via dormantRef.current — no retroactive re-arm on late-arriving dormant frames (race case explicitly out of scope per CONTEXT.md L81)."
  - "D-62-04: two refined reason labels replace the bare 'client_timeout_20s' — post-ship diagnostics can grep the two paths distinctly."
metrics:
  duration_min: 12
  completed_date: 2026-08-30
  tasks_completed: 3
  files_modified: 2
  commits: 2
  tests_added: 1
requirements: []
---

# Phase 62 Plan 01: Widen client PrettyView pending-send timer for dormant sends — Summary

Symmetric client-side half of Phase 60's backend `pv-send-watchdog` dormant widening — closes bounty `pv-client-pending-send-timer-dormancy-blind` by branching `handleOptimisticSend`'s pending-send timeout on `dormantRef.current` at arm time so dormant sends get a 220_000ms ceiling instead of the historical 20_000ms.

## What Shipped

Two edits in `src/ui/features/pretty-view/PrettyView.tsx`:

1. **Two new module-scope constants** (colocated with `WORKING_SET_CAP` at the top of the file):
   - `export const PENDING_SEND_TIMEOUT_MS_NORMAL = 20_000` — preserves Phase 50 Plan 03 behavior byte-for-byte for the non-dormant path.
   - `export const PENDING_SEND_TIMEOUT_MS_DORMANT = 220_000` — 10s margin above the backend ceiling of `MARKER_FALLBACK_MS_MIRROR (90_000) + GIVE_UP_MS_DORMANT (120_000) = 210_000ms` per D-62-02.
   - Header comment cross-references `src/backend/claude-session/pv-send-watchdog.ts` for future maintainers (no import possible; the two files cannot depend on each other).

2. **`handleOptimisticSend` branch** at the previous 20000ms literal site (was `PrettyView.tsx:1119-1121`):
   - Reads `dormantRef.current` at arm time (D-62-03) — the one-shot read pattern is symmetric to the backend's `dormantLastEmitted` read at `__applyInputMessageForTests` entry.
   - Branches BOTH the setTimeout duration AND the flipToFailed reason label:
     - Non-dormant: `20_000ms` + `"client_timeout_20s_normal"`.
     - Dormant:    `220_000ms` + `"client_timeout_220s_dormant"`.
   - `flipToFailed` itself is unchanged — its existing `console.warn` at line 1065-1067 interpolates the reason argument, so changing the passed string automatically changes the log output (D-62-04).
   - The `immediateFailure:true` branch is untouched — seed-as-failed path is unaffected by dormancy (no timer armed).

One edit in `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx`:

3. **New Test 5b** (56 lines, immediately after Test 5). Delivers `{type:"dormant", dormant:true}` WS frame BEFORE `typeAndEnter` so the dormantRef mirror useEffect populates `dormantRef.current === true` before the send arms. Asserts:
   - At T+20001ms: `[data-pv-bubble-failed]` is null AND `[data-pv-bubble-spinner]` is non-null (dormant path defers the flip).
   - At T+220001ms cumulative (advance additional 200000ms): `[data-pv-bubble-failed]` is non-null AND `[data-pv-bubble-spinner]` is null (dormant ceiling fires).
   - Textarea `value` equals `"dormant-send-payload"` (composeOverrideText populated, same edit-and-resend path as Test 5).

## TDD Cycle

- **RED (Task 1, commit `0ac705de`):** Test 5b added. Ran against unmodified PrettyView.tsx — failed at the T+20001ms `expect(... [data-pv-bubble-failed]).toBeNull()` assertion. Failure log captured at `/tmp/62-01-task1-red.log`. Console line `[pv-optim] flip-to-failed mqid=... reason=client_timeout_20s content-length=20` proved today's hard-coded 20000ms setTimeout fires regardless of dormancy — the exact bug Ashley reproduced live on hilda@workstation 2026-08-30 (client fired T+20.003s, server delivered send-keys T+31.379s, bubble red ~11s before message landed).
- **GREEN (Task 2, commit `b98f81f1`):** Constants + branch shipped. Test 5b now passes at both the T+20001ms (must-not-flip) and T+220001ms (must-flip) assertions. Test 5 (non-dormant sibling, unmodified) also green — 20000ms behavior byte-for-byte preserved for the common path.

## Verification

- **Task 1 RED evidence:** `/tmp/62-01-task1-red.log` (vitest exit 1 with `expected <div ... data-pv-bubble-failed="true">... to be null`).
- **Task 2 GREEN scoped run:** `npx vitest run src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` — 21/21 pass, exit 0.
- **Task 3 scoped sibling tests (defensive per fleet rule):** `npx vitest run src/ui/features/pretty-view/ChatMessage.test.tsx src/ui/features/pretty-view/ComposeBox` — 11 files / 171 tests pass, exit 0.
- **Frontend typecheck:** `npx tsc --noEmit` exit 0.
- **Grep gates (all Task 2 acceptance criteria):** all 6 required greps confirm the change shape (2 constants exported with expected values, `armedDormant = dormantRef.current === true` present, both refined reason labels present, bare `"client_timeout_20s"` absent outside comments, no `setTimeout(... 20000)` bare literal remaining).

## Deviations from Plan

**1. [Fleet-rule adjustment - Task 3 scope] Ran scoped tests only, not full `npx vitest run`.**
- **Trigger:** Orchestrator prompt's `<sequential_execution>` block cites fleet rule 2026-08-20: "Run scoped tests only (`npx vitest run --related <files-you-touched>` or specific paths in `src/ui/features/pretty-view/`). Full suite runs at the orchestrator ship-gate — NOT at executor exit."
- **Plan text at Task 3:** literally called for `npx vitest run` (full frontend suite) — this predates the fleet-rule tightening.
- **Resolution:** Ran three scoped surfaces — the modified test file (21 pass), plus sibling `ChatMessage.test.tsx` + `ComposeBox` test files (171 pass across 11 files) — as the executor-side defensive check. Full-suite run deferred to the orchestrator's ship-gate per fleet directive.
- **No files or commit affected — process-scope only.**

Otherwise: plan executed exactly as written. Zero backend files changed. Wire-protocol frame shapes unchanged. No new dependencies.

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `0ac705de` | test(62-01) | RED — add Test 5b for widened dormant pending-send timer |
| `b98f81f1` | feat(62-01) | GREEN — widen PrettyView pending-send timer for dormant sends |

## Post-ship Diagnostic Payoff

After Wave 1 + Wave 2 ship-bundle, `[pv-optim] flip-to-failed reason=...` console logs distinguish:

- `client_timeout_20s_normal` — awake-pane send that hit the 20s cap. Same failure mode as before Phase 62; probably a genuine send-path bug in the backend.
- `client_timeout_220s_dormant` — dormant-arm send that hit the widened 220s cap. Means the invisible-wake sequence took longer than the backend's ceiling AND the client's margin — investigate whether backend's `MARKER_FALLBACK_MS_MIRROR` or `GIVE_UP_MS_DORMANT` needs further widening (per D-62-02 note: if backend widens further, bump the client constant to preserve margin).

## Non-goals (explicitly out of scope per CONTEXT.md)

- **Race case** — client with `dormantRef.current === false` at arm time but backend routes through invisible-wake path anyway. CONTEXT.md L39 + L81: separate concern, out of Phase 62.
- **Backend watchdog non-arming for dormant sends** — Ashley's log shows the backend `pv_input_arm_split` did NOT fire for hilda's dormant send at 13:46:26 (potentially another Phase 60 gap). CONTEXT.md L82: investigate as follow-up bounty, NOT Phase 62 scope.
- **Duplicate-bubble mechanism** — Wave 2 (Plan 62-02) covers that via instrumentation only.
- **Automated cross-file drift guard** — the frontend can't import backend constants; the header comment is the coupling. Manual review at any future backend widening.

## Self-Check: PASSED

- **Files exist:**
  - `src/ui/features/pretty-view/PrettyView.tsx` — FOUND (contains `PENDING_SEND_TIMEOUT_MS_DORMANT`).
  - `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` — FOUND (contains `Test 5b`).
  - `.planning/phases/62-invisible-dormancy-client-side-follow-up-widen-client-pendin/62-01-SUMMARY.md` — FOUND (this file).
- **Commits exist on `feat/tab-title-from-tmux`:**
  - `0ac705de` (test 62-01 RED) — FOUND via `git log --oneline`.
  - `b98f81f1` (feat 62-01 GREEN) — FOUND via `git log --oneline`.
- **Grep gates (Task 2 acceptance):**
  - `PENDING_SEND_TIMEOUT_MS_NORMAL = 20_000` — present.
  - `PENDING_SEND_TIMEOUT_MS_DORMANT = 220_000` — present.
  - `const armedDormant = dormantRef.current === true` — present.
  - `"client_timeout_20s_normal"` and `"client_timeout_220s_dormant"` — both present.
  - Bare `"client_timeout_20s"` outside comments — count 0.
  - Bare `setTimeout(... 20000)` — count 0.
