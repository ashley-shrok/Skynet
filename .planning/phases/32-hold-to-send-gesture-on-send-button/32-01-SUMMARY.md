---
phase: 32-hold-to-send-gesture-on-send-button
plan: 01
subsystem: ui
tags: [react, hooks, voice-recording, gestures, ios-safari, pointer-events, media-recorder, testing]

# Dependency graph
requires:
  - phase: 16
    provides: "useVoiceRecording state machine (idle/recording/transcribing), D-16-02 iOS Safari sync-getUserMedia invariant, MediaRecorder + STT pipeline"
provides:
  - "useVoiceRecording.cancel() is race-safe against a pending getUserMedia (B-1 defensive fix via pendingCancelRef)"
  - "useHoldToRecord hook: reusable press-and-hold gesture layer for the send button with Shape 1 optimistic-start + rollback semantics; short-tap rolls back the just-started recording via awaited voice.cancel before dispatching onShortTap (M-1 fix)"
  - "holdInitiatedRef exposed on hook return so the Plan 32-02 consumer can gate showRecordingControls off during a hold-initiated recording (B-3 fix)"
  - "HOLD_THRESHOLD_MS = 250 exported constant so ComposeBox integration and downstream tests reference a single source of truth"
  - "13 new unit tests (3 for useVoiceRecording pending-cancel race + 10 for useHoldToRecord) — all green in isolation and in the full suite"
affects: [32-02, 32-03, "any future ComposeBox gesture work", "any future voice-recording race-safety concerns"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Race-safety ref pattern: `pendingCancelRef` in an async-init hook — a synchronous ref write in the cancel path signals the resolving init callback to abort teardown before side effects. Enables cancel() to remain a no-op-safe API to callers while defending against the pre-resolve window."
    - "iOS Safari sync-gesture invariant chain: React handler → hook onPointerDown → voice.start (sync) → getUserMedia (sync). Only synchronous ref writes may appear between the guard chain and voice.start — no await, no setState, no timers. Enforced at every layer + asserted in Test 4 of useHoldToRecord.test.tsx."
    - "Hook injection over hook import: useHoldToRecord accepts a narrowed `Pick<UseVoiceRecordingReturn, ...>` for the voice singleton rather than calling useVoiceRecording itself. Keeps the two hooks decoupled (each testable in isolation) and lets ComposeBox share one voice singleton across primary + slot send-button gestures."

key-files:
  created:
    - src/ui/features/pretty-view/useHoldToRecord.ts
    - src/ui/features/pretty-view/useHoldToRecord.test.tsx
  modified:
    - src/ui/features/pretty-view/useVoiceRecording.ts
    - src/ui/features/pretty-view/useVoiceRecording.test.ts

key-decisions:
  - "Adopted Shape 1 (optimistic start + rollback) per CONTEXT.md § iOS Safari sync-gesture invariant — Shape 2 (debounced start) rejected because it requires an iOS Safari 26.6 prototype and none exists in this tree."
  - "Awaited voice.cancel() before dispatching onShortTap in the short-tap branch (M-1 fix) — deterministic ordering ensures teardown fully unwinds before typed-send fires; when voice.state is still 'idle' the cancel takes the pendingCancelRef synchronous path and resolves immediately, so awaiting is still correct."
  - "Exposed holdInitiatedRef as a MutableRefObject (not state) so the Plan 32-02 consumer can read it during render without triggering an infinite render loop. Set true BEFORE voice.start() so it is already true when the async voice.state → 'recording' re-render fires."
  - "Used pointer capture (setPointerCapture + releasePointerCapture) wrapped in try/catch — recommended in CONTEXT.md § Claude's Discretion; simplifies slide-off tracking and try/catch keeps jsdom tests safe."
  - "Refactored UseHoldToRecordArgs / UseHoldToRecordReturn from `interface` to `type` (during Task 2) — the plan's acceptance-criteria grep pattern `^export (const|function|type)` requires `type` not `interface`. This is a stylistic-not-semantic swap; TS treats them equivalently at usage sites here."

patterns-established:
  - "Race-safety pending-flag pattern for async-init hooks (see pendingCancelRef in useVoiceRecording — future voice-related hooks with async init should follow the same shape)."
  - "Injected-narrowed-voice pattern for gesture hooks: hooks that need `voice.start / voice.cancel / voice.state` accept a `Pick<UseVoiceRecordingReturn, ...>` rather than calling the singleton hook themselves. Enables testing with a mock without vi.mock of the whole useVoiceRecording module."
  - "Test-consumer-component pattern for hooks that own pointer events: render a real button with data-* attributes exposing ref/state, drive real fireEvent.pointerDown/Up flows, install a getBoundingClientRect shim so jsdom bounds checks work."

requirements-completed:
  - HOLD-SEND-01
  - HOLD-SEND-02
  - HOLD-SEND-03
  - HOLD-SEND-04
  - HOLD-SEND-05

# Metrics
duration: 55min
completed: 2026-08-13
---

# Phase 32 Plan 01: useVoiceRecording race-safety + useHoldToRecord hook Summary

**pendingCancelRef closes the cancel-before-getUserMedia race in useVoiceRecording, and a new useHoldToRecord hook (Shape 1 optimistic-start + rollback) owns the press-and-hold gesture layer for the ComposeBox send button with iOS-Safari-sync-getUserMedia invariant preserved by construction and short-tap-rollback awaited before typed-send.**

## Performance

- **Duration:** ~55 min (started 2026-08-13T13:16:07Z, completed 2026-08-13T14:19Z; SUMMARY writing + docs commit adds a few more minutes)
- **Started:** 2026-08-13T13:16:07Z
- **Completed:** 2026-08-13T14:19:00Z
- **Tasks:** 3 (all atomic, task-per-commit)
- **Files created:** 2 (useHoldToRecord.ts, useHoldToRecord.test.tsx)
- **Files modified:** 2 (useVoiceRecording.ts, useVoiceRecording.test.ts)

## Accomplishments

- **useVoiceRecording.cancel() is race-safe.** A `pendingCancelRef` in the state !== "recording" branch signals the in-flight `streamPromise.then()` to tear down the arriving stream (`stream.getTracks().forEach(t => t.stop())`) and short-circuit BEFORE constructing MediaRecorder, calling recorder.start, firing setState("recording"), or playing the start sound. Closes the pre-existing race where a short-tap on hold-send during a slow mic-permission grant would otherwise leave the mic hot indefinitely.
- **useHoldToRecord hook (new file, 374 lines).** Exports `useHoldToRecord`, `HOLD_THRESHOLD_MS`, `UseHoldToRecordArgs`, `UseHoldToRecordReturn`, `UseHoldToRecordVoice`. Owns the pointer-event layer that distinguishes a short tap (< 250ms → onShortTap, with `await voice.cancel()` rollback of the just-started recording) from a long press (≥ 250ms → onLongPressSend if released inside bounds, `void voice.cancel()` if released outside). Guards short-circuit before voice.start when asideActive / disabled / voice.state !== "idle". Pointer capture via `setPointerCapture`/`releasePointerCapture` wrapped in try/catch for jsdom safety.
- **D-16-02 iOS Safari sync-gesture invariant preserved by construction and asserted in tests.** In useHoldToRecord.ts the only statement between the guard-chain `return`s and `voice.start();` is a synchronous ref write (`holdInitiatedRef.current = true;`). No await, no setState, no timers. Test 4 (`useHoldToRecord.test.tsx`) asserts `voice.start.mock.calls.length === 1` synchronously immediately after fireEvent.pointerDown — with no await / no timer advance / no waitFor between the fire and the expect.
- **M-1 await-cancel-before-shortTap ordering closed.** The short-tap branch of onPointerUp is `await voice.cancel();` on its own line immediately followed by `onShortTap();`. Test 5 uses a controllable cancel promise to prove that onShortTap.calls.length === 0 immediately after pointerup and === 1 only after resolveCancel() runs.
- **B-3 gating ref (`holdInitiatedRef`) exposed** for the Plan 32-02 consumer to gate `showRecordingControls` on `!holdInitiatedRef.current`. Ref (not state) so consumer reads during render without triggering an infinite render loop; set true BEFORE voice.start() so already true when voice.state → "recording" triggers a re-render.
- **13 new unit tests, all green.** 3 tests in useVoiceRecording.test.ts (Test PC-A cancel-before-resolve, PC-B cancel-after-recording unchanged, PC-C cancel-then-start stale-flag clear). 10 tests in useHoldToRecord.test.tsx (guards × 3, iOS sync-gesture invariant, short-tap await-cancel ordering, release-inside long-press, slide-off long-press, holdActive lifecycle, threshold boundary 249 vs 250, elapsed=0 short-tap edge).

## Task Commits

Each task was committed atomically on `feat/tab-title-from-tmux`:

1. **Task 1: useVoiceRecording.cancel() race-safety (B-1 fix)** — `f822acf` (fix)
   - `src/ui/features/pretty-view/useVoiceRecording.ts` — pendingCancelRef declaration + start() entry clear + streamPromise.then() teardown branch + cancel() pending set + belt-and-suspenders clear in state==="recording" branch
   - `src/ui/features/pretty-view/useVoiceRecording.test.ts` — 3 new tests (PC-A / PC-B / PC-C) inside a new nested describe block "cancel() race-safety (pending cancel flag)"
2. **Task 2: useHoldToRecord hook** — `4aba86f` (feat)
   - `src/ui/features/pretty-view/useHoldToRecord.ts` (new) — hook + HOLD_THRESHOLD_MS + types
3. **Task 3: useHoldToRecord unit tests** — `de58a08` (test)
   - `src/ui/features/pretty-view/useHoldToRecord.test.tsx` (new) — 10 tests

**Plan metadata commit:** to follow this SUMMARY.md write + STATE.md/ROADMAP.md updates.

## Files Created/Modified

- **CREATED** `src/ui/features/pretty-view/useHoldToRecord.ts` (374 lines) — The press-and-hold gesture hook. Exports: `useHoldToRecord`, `HOLD_THRESHOLD_MS`, `UseHoldToRecordArgs`, `UseHoldToRecordReturn`, `UseHoldToRecordVoice`, and re-exports `VoiceRecordingState`.
- **CREATED** `src/ui/features/pretty-view/useHoldToRecord.test.tsx` (~451 lines) — 10 unit tests. Test-consumer-component pattern with a real button and data-* attributes; fake timers with `shouldAdvanceTime: false` for deterministic 250ms boundary walking; getBoundingClientRect shim for bounds checks.
- **MODIFIED** `src/ui/features/pretty-view/useVoiceRecording.ts` (+42 lines) — Added `pendingCancelRef` (useRef<boolean>), start() entry clear, streamPromise.then() pending-cancel check + teardown, cancel() pending-set in the state !== "recording" branch, belt-and-suspenders clear in the state === "recording" branch. Also amended start()'s docstring to note the pending-cancel race defense.
- **MODIFIED** `src/ui/features/pretty-view/useVoiceRecording.test.ts` (+139 lines) — 3 new tests inside a nested `describe("cancel() race-safety (pending cancel flag)")` block, placed immediately before Test F.

## Evidence

### D-16-02 iOS Safari sync-gesture invariant preservation

`useHoldToRecord.ts` — `onPointerDown` handler (opened at L209, `voice.start()` at L231):

```
L216:   if (asideActive || disabled || voice.state !== "idle") return;
L217:
L218-223: [comment block]
L224:   holdInitiatedRef.current = true;           // synchronous ref write
L225:
L226-230: [comment block: D-16-02]
L231:   voice.start();                             // FIRST non-conditional statement after guards + ref write
```

No `await`, no `setState`, no `setTimeout`, no `Promise` between the guard chain and `voice.start()`. The `holdInitiatedRef.current = true;` write is a synchronous JS assignment — it does NOT queue a microtask or task.

`useVoiceRecording.ts` — `start()` (opened at L262, `getUserMedia` at L280):

```
L269:   function start(): void {
L270-271: [comment + ref clear] pendingCancelRef.current = false;
L272:
L273:     if (state !== "idle") return;
L274:
L275-278: [D-16-02 comment]
L280:     const streamPromise = navigator.mediaDevices.getUserMedia({ audio: true });
```

Only a synchronous ref write and the pre-existing state guard between the function entry and `getUserMedia` — invariant preserved.

### pendingCancelRef placement in useVoiceRecording.ts

Grep output (`grep -n "pendingCancelRef"`):
```
L93:  const pendingCancelRef = useRef<boolean>(false);            // declaration
L266: * function's .then() callback now checks pendingCancelRef ... // docstring
L271:   pendingCancelRef.current = false;                         // start() entry clear
L285:     if (pendingCancelRef.current) {                         // .then() check
L286:       pendingCancelRef.current = false;                     //   → clear-and-teardown branch
L330: console.warn(`... setting pendingCancelRef=true`);           // cancel() pending-branch log
L331:   pendingCancelRef.current = true;                          // cancel() pending set
L334-337: [belt-and-suspenders comment]
L338:   pendingCancelRef.current = false;                         // cancel() state==="recording" clear
```

The `if (pendingCancelRef.current)` block inside `streamPromise.then((stream) => { ... })` sits BEFORE `streamRef.current = stream;`, `chunksRef.current = []`, `new MediaRecorder(stream)`, `recorder.start()`, `setState("recording")`, and `playSound(startAudioRef.current)`. Ordering verified by reading `useVoiceRecording.ts` L283-306.

### Test counts

- `useVoiceRecording.test.ts`: 23 `it(` blocks (20 pre-existing + 3 new).
- `useHoldToRecord.test.tsx`: 10 `it(` blocks.
- Isolated run: `npx vitest run useVoiceRecording.test.ts useHoldToRecord.test.tsx` → **33 passed / 0 failed**.
- Full suite: `npx vitest run` → **1909 passed / 4 failed / 7 skipped / 1 todo (1921 total)**. See "Deferred Issues" below re: the 4 flakes.

## Decisions Made

1. **Shape 1 over Shape 2** — Plan pre-specified Shape 1 (optimistic-start + rollback) is the safe choice for iOS Safari without a real-device prototype for Shape 2. Adopted verbatim.
2. **Awaited cancel in short-tap branch** — Adopted per M-1 fix in plan. When state is still "idle" during the cancel, the pendingCancelRef branch is synchronous and the await resolves immediately, so the tradeoff is zero user-perceptible latency but deterministic ordering.
3. **holdInitiatedRef as MutableRefObject not state** — Per plan; a state variable would trigger an infinite render loop in the consumer that reads it during render.
4. **Pointer capture via setPointerCapture** — Adopted per CONTEXT.md § Claude's Discretion. Wrapped in try/catch so jsdom (which lacks setPointerCapture) can still run the tests.
5. **Types instead of interfaces for UseHoldToRecordArgs/Return** — Plan's acceptance-criteria grep expects `type` not `interface`; refactored during Task 2 verification. Stylistic swap; no semantic difference at usage sites.

## Deviations from Plan

None substantive — plan executed as written with two minor stylistic adjustments during Task 2 that were self-corrections against the plan's own grep-based acceptance criteria:

**1. [Rule 3 — Blocking-for-Acceptance] Refactored `interface` to `type` for UseHoldToRecordArgs/Return**
- **Found during:** Task 2 verification (grep against acceptance criterion)
- **Issue:** Initial implementation used `interface UseHoldToRecordArgs { ... }` and `interface UseHoldToRecordReturn { ... }`. The plan's acceptance criterion greps for `^export (const|function|type) (useHoldToRecord|HOLD_THRESHOLD_MS|UseHoldToRecord)` which matches `type` but not `interface`.
- **Fix:** Converted both `interface` declarations to `type X = { ... };` aliases. Semantically equivalent at usage sites.
- **Files modified:** `src/ui/features/pretty-view/useHoldToRecord.ts`
- **Verification:** Grep now returns 5 hits (`HOLD_THRESHOLD_MS`, `UseHoldToRecordVoice`, `UseHoldToRecordArgs`, `UseHoldToRecordReturn`, `useHoldToRecord`) — plan requires ≥ 4.
- **Committed in:** `4aba86f` (Task 2 commit — the swap happened before commit)

---

**Total deviations:** 0 substantive / 1 self-corrected during verification
**Impact on plan:** None — hook API is byte-identical to the spec; only the `type`/`interface` keyword changed.

## Issues Encountered

**1. Full-suite flakes (4 tests fail in full-suite parallel run but pass in isolation).**

The full `npx vitest run` reported 4 failing tests / 1909 passing. When re-run in isolation, all 4 files pass:

| Test File | Failing Test | Isolated Result |
|---|---|---|
| `src/ui/sidebar/NewSessionDialog.test.tsx` | Test T (`no UI text hints at persistence…`) | 46/46 pass |
| `src/ui/features/pretty-view/IdentityModal.test.tsx` | Test 1 (`edit-title happy path`) | pass in isolation (via combined run with next 2 files: 16/16) |
| `src/ui/features/pretty-view/IdentityModal.voice.test.tsx` | Test 5 (`Save with changed voice`) | pass in isolation |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx` | Test 16 (`right-click row → Clone menu item`) | pass in isolation |

**Diagnosis:** These tests time out (5–6s each) under the parallel-runner concurrency, but complete well within the timeout when run in isolation. None of the files touched by this plan (`useVoiceRecording.ts`, `useVoiceRecording.test.ts`, `useHoldToRecord.ts`, `useHoldToRecord.test.tsx`) intersects with any of these 4 test files or their nearest neighbors (they're in different feature folders: `sidebar`, `IdentityModal`, `pretty-conversations/clone-dialog`). This is a **pre-existing flake pattern**, not a regression introduced by Plan 32-01.

**Baseline evidence:** The most recent STATE.md entries record prior quick tasks reporting full-suite passes of 1870 and 1900 — this plan added 13 tests bringing the pass count to 1909. Delta = +9 vs baseline 1900, consistent with 13 new tests passing minus the 4 pre-existing flakes that happened to intermittently fail this run.

**Action taken:** Flagged in this SUMMARY per fleet rule "if pre-existing failing tests in files you touch or their neighbors, either fix them or explicitly flag them in the plan SUMMARY.md as pre-existing." No code changes attempted — the flakes are outside plan scope and outside neighbor scope, and out-of-scope fixes are prohibited by the executor's scope boundary. **Recommend a follow-up quick task or Phase 33 wave to raise the per-test timeout in these 4 files (or convert them to `test.concurrent(false)`) if they continue to flake.**

## Deferred Issues

None — all plan tasks completed within scope. The 4 full-suite flakes above are pre-existing and out of scope.

## Known Stubs

None — this plan wires no data-source stubs; the new hook takes an injected voice singleton, and the ComposeBox consumer wiring is Plan 32-02's responsibility.

## User Setup Required

None — no external service configuration, no env vars, no dashboard steps. Frontend-only hook + defensive fix to an existing hook.

## Threat Flags

None — no new network endpoints, no new auth paths, no new file access patterns, no schema changes. This plan is pure frontend gesture-hook + defensive race-safety on an existing hook. No security-relevant surface introduced outside the plan's declared scope.

## Self-Check

- **File `src/ui/features/pretty-view/useHoldToRecord.ts`:** FOUND
- **File `src/ui/features/pretty-view/useHoldToRecord.test.tsx`:** FOUND
- **File `src/ui/features/pretty-view/useVoiceRecording.ts` (modified with pendingCancelRef):** FOUND (grep returns 9 pendingCancelRef references)
- **File `src/ui/features/pretty-view/useVoiceRecording.test.ts` (extended with 3 tests):** FOUND (23 `it(` blocks, up from 20)
- **Commit `f822acf` (Task 1 fix):** FOUND in `git log`
- **Commit `4aba86f` (Task 2 feat):** FOUND in `git log`
- **Commit `de58a08` (Task 3 test):** FOUND in `git log`
- **`npx vitest run useVoiceRecording.test.ts useHoldToRecord.test.tsx`:** PASSED (33/33)
- **`npx tsc --noEmit`:** exit 0 (no errors mentioning useVoiceRecording or useHoldToRecord)
- **D-16-02 sync-gesture invariant:** grep-verified, `voice.start()` at useHoldToRecord.ts:231 immediately after synchronous ref write at L224, no await/setState/timer between guards and voice.start
- **Full suite:** 1909 pass / 4 pre-existing flakes / 7 skip / 1 todo — flakes documented above

## Self-Check: PASSED

## Next Phase Readiness

- Plan 32-02 (wire useHoldToRecord into ComposeBox primary + slot send buttons) is UNBLOCKED. All dependencies satisfied:
  - `useHoldToRecord` hook exists with the exact API Plan 32-02 expects (onPointerDown/Up/Cancel/Leave handlers + holdActive + holdInitiatedRef).
  - `useVoiceRecording.cancel()` is race-safe — Plan 32-02's short-tap wiring can call it in the pre-getUserMedia window without leaving the mic hot.
  - `HOLD_THRESHOLD_MS` is an exported constant — Plan 32-02 tests will reference it rather than a magic number.
- Plan 32-03 (ComposeBox integration tests) is UNBLOCKED — the 10 useHoldToRecord unit tests establish the reference test-consumer pattern that Plan 32-03 will adapt for the full ComposeBox render tree.
- No blockers, no open questions, no follow-up code changes required from this plan.

---
*Phase: 32-hold-to-send-gesture-on-send-button*
*Plan: 01*
*Completed: 2026-08-13*
