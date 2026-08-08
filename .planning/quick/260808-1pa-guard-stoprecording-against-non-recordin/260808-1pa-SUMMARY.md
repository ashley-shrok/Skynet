---
phase: quick-260808-1pa
plan: 01
subsystem: voice-recording
tags: [bug-fix, ios-safari, media-recorder, defensive-cleanup, watchdog]
requires: []
provides:
  - stopRecording-non-recording-guard
  - stopRecording-8s-onstop-watchdog
  - mock-media-recorder-state-field-alignment
affects:
  - src/ui/features/pretty-view/useVoiceRecording.ts
  - src/ui/features/pretty-view/useVoiceRecording.test.ts
  - src/ui/features/pretty-view/ComposeBox.voice.test.tsx
  - src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx
  - src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx
tech-stack:
  added: []
  patterns:
    - "Race-with-watchdog: `resolved` flag ensures whichever of onstop/setTimeout fires first wins; the loser no-ops."
    - "State-mirror mocks: MockMediaRecorder mirrors real MediaRecorder.state field (inactive/recording), flipped by start()/stop()."
key-files:
  created: []
  modified:
    - src/ui/features/pretty-view/useVoiceRecording.ts
    - src/ui/features/pretty-view/useVoiceRecording.test.ts
    - src/ui/features/pretty-view/ComposeBox.voice.test.tsx
    - src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx
    - src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx
decisions:
  - "Test G asserts onstop assignment count === 0 across the single stopRecording-with-stale-inactive-recorder path, not the plan's suggested count === 1 across two calls. Rationale: after the guard bails without touching onstop, React state recovers via cancel()'s unconditional setState('idle'), which then makes any second call hit the outer React-state gate — never reaching stopRecording. The count===0 assertion locks in the same invariant more directly."
  - "Auto-fixed MockMediaRecorder mocks in 3 sibling ComposeBox test files (Rule 3): the new guard reads `recorder.state`, which the pre-existing mocks did not expose. Without alignment, 10 voice-flow tests fail because `undefined !== 'recording'` trips the guard on the happy path."
metrics:
  duration: 24m33s
  completed: 2026-08-08
  files_changed: 5
  lines_added: 193
  lines_removed: 4
  tests_added: 2
  tests_total_after: 1526 pass / 6 skipped / 0 fail (123 files)
  commit: a4a5962
---

# Quick 260808-1pa: Guard stopRecording Against Non-Recording State + 8s Onstop Watchdog Summary

Two-part defensive fix in `useVoiceRecording.ts::stopRecording()` for the "mic dead buttons" iOS Safari hang: a state guard that bails without touching `onstop` when the recorder is not "recording" (kills the cascade after the first dropped event), and an 8-second watchdog that force-cleans-up and resolves null when the browser's `onstop` event never fires (recovers even the first hang).

## What Was Built

### 1. Non-recording guard (fixes cascade-of-hangs, presses 2+)

Inside `stopRecording()`, immediately after the existing `if (!recorder)` early-return, a new guard checks `if (recorder.state !== "recording")` and — if true — logs a `[voice-diag]` warn line, `resolve(null)`, and returns. **Does NOT reassign `recorder.onstop`** and **does NOT call `recorder.stop()`**. That's the whole point: on iOS Safari, once `onstop` drops, `recorder.state` transitions to "inactive" but React state is still "recording", so subsequent stopRecording() calls would (pre-fix) reassign onstop on the already-inactive recorder and hang identically. The guard makes that a fast null-resolve, and endAppend/endSend's null-blob branches (lines 294-298, 335-338) then recover React state to "idle" via their existing `setState("idle")` calls.

### 2. 8-second onstop watchdog (fixes even the first hang)

When stopRecording proceeds past the guard, it now arms two parallel paths:

- `recorder.onstop` (the happy path — mimeType/blob assembly, chunksRef reset, stream track stop, ref cleanup, resolve(blob)).
- A `setTimeout(..., 8000)` (the recovery path — stops all stream tracks, nulls out `recorderRef`/`streamRef`, clears `chunksRef`, resolve(null), logs a loud `[voice-diag] WATCHDOG` warn line).

A shared `let resolved = false;` flag ensures whichever fires first wins; the loser no-ops via `if (resolved) return;`. The winning `onstop` also `clearTimeout(watchdogHandle)` so no orphan timer fires late.

### 3. Regression tests (Test G, Test H)

Appended to `useVoiceRecording.test.ts`:

- **Test G** — simulates the iOS bug directly: start recording, manually flip `recorder.state = "inactive"` (mimicking browser transition after dropped onstop), call `cancel()`, assert the guard never touches onstop. Uses an `Object.defineProperty` setter spy to count onstop assignments; expects 0.
- **Test H** — uses `vi.useFakeTimers()`, overrides `recorder.stop` to be a plain `vi.fn()` (does not fire onstop), calls `endSend("text")`, advances timers by 8000ms via `vi.advanceTimersByTimeAsync(8000)`, awaits the promise. Asserts return value is null, state is "idle", stream track.stop was called (watchdog cleanup ran), and fetch was NOT called (null blob short-circuited before transcribeBlob).

## Files Modified

| File | Change |
|------|--------|
| `src/ui/features/pretty-view/useVoiceRecording.ts` | Added state guard + 8s watchdog to `stopRecording()`. +32 lines. |
| `src/ui/features/pretty-view/useVoiceRecording.test.ts` | Added Test G, Test H; updated MockMediaRecorder to expose `state` field. +138/-1. |
| `src/ui/features/pretty-view/ComposeBox.voice.test.tsx` | Rule-3 auto-fix: MockMediaRecorder gains `state` field. +8/-1. |
| `src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx` | Rule-3 auto-fix: same. +8/-1. |
| `src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` | Rule-3 auto-fix: same. +8/-1. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] MockMediaRecorder mocks in 3 sibling test files missing `state` field**

- **Found during:** First full-suite run after Task 1 fix + Task 2 tests.
- **Issue:** After adding the `recorder.state !== "recording"` guard, the full-suite run showed 10 pre-existing ComposeBox voice tests failing because their MockMediaRecorder mocks did not expose a `state` field. `undefined !== "recording"` is true, so the guard fired on the happy path and short-circuited every recording flow — breaking `Test 3` through `Test I4` (12 failures in useVoiceRecording.test.ts alone), plus ~10 across the three ComposeBox test files.
- **Root cause:** The plan spec correctly reads `recorder.state`, which real MediaRecorder always exposes; the pre-existing mocks were only "minimal" stubs that omitted it. This is a mock-contract-drift issue — the mocks needed to mirror the real API surface that the code under test now reads.
- **Fix:** Updated the MockMediaRecorder class in each of the 4 test files (mine + 3 pre-existing) to declare `state: "inactive" | "recording" | "paused" = "inactive"` and to flip it in the mock's `start()` / `stop()` implementations. Zero prod-code change; test-mock alignment only.
- **Files modified:** ComposeBox.voice.test.tsx, ComposeBox.recycle-disable.test.tsx, ComposeBox.plan-pending-disable.test.tsx, useVoiceRecording.test.ts.
- **Commit:** a4a5962 (folded into the single atomic commit alongside the fix + tests).

**2. [Design choice, not a fix] Test G asserts count === 0, not count === 1 across two calls**

- **Plan spec:** "assert `recorder.onstop` was assigned exactly once across both calls, or use a spy that counts assignments" AND "install a getter/setter on `onstop` that increments a counter on every `set`. Expect the counter to be `1` after both calls."
- **What I did:** Test G asserts count === 0 after a single flow (start → simulate browser flipping state to "inactive" → cancel → assert onstop never reassigned).
- **Why:** The plan's proposed structure has a chicken-and-egg problem: to reach the guard on the SECOND call with a stale-inactive recorder, React state must still be "recording" — but after the FIRST call resolves (via watchdog or fake-fired onstop), the caller's null-blob branch runs `setState("idle")`, which then blocks the second call at the OUTER state gate in endSend/endAppend (line ~325) before it can reach stopRecording. So the second call never actually exercises the inner guard.
- The simplified count === 0 test locks in the same invariant more directly: when stopRecording is invoked with a stale-inactive recorder (the exact iOS bug shape), the guard bails without touching onstop. Any regression that removes the guard would trip this assertion because the pre-fix code assigned onstop unconditionally.
- Documented inline in the test file for future readers.

### Auth Gates
None.

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | EXIT 0 |
| `npx vitest run src/ui/features/pretty-view/useVoiceRecording.test.ts` | 20 pass / 0 fail (18 existing + Test G + Test H) |
| `npx vitest run` (full suite) | 1526 pass / 6 skipped / 0 fail (123 files) — includes ComposeBox voice tests + recycle-disable + plan-pending-disable + IdentityModal voice tests, all green |
| `git log -1 --pretty=format:'%s'` matches expected | Yes: `fix(voice-recording): guard stopRecording against non-recording state + 8s onstop watchdog (mic-dead-buttons)` |
| `git show --stat HEAD` file list | 5 files: useVoiceRecording.ts + useVoiceRecording.test.ts (target) + 3 Rule-3 sibling mocks. NewSessionDialog.tsx (unrelated pre-existing edit) NOT included. `.planning/` NOT staged. |
| No push / build / deploy | Correct — commit only, on branch `feat/tab-title-from-tmux`. |

## Success Criteria — All Met

- [x] stopRecording() no longer reassigns onstop when recorder.state !== "recording" (kills the cascade-of-hangs after the first dropped onstop)
- [x] stopRecording() force-cleans-up and resolves null within 8 seconds if onstop never fires (recovers even the first hang)
- [x] Existing happy-path behavior preserved (onstop fires normally → Blob resolves, refs cleaned)
- [x] Two new regression tests locked in (Test G + Test H); existing tests unchanged in behavior
- [x] Single atomic commit `a4a5962` on `feat/tab-title-from-tmux`; no push

## Follow-ups / Not Done Here

- **Deploy:** Not performed. Per the constraint "code work doesn't authorize ship" and the plan note that tina is mid-deploy on the shared container, this fix is committed but not pushed/built/deployed.
- **iOS Safari live verification:** The fix's real-world payoff (buttons no longer dead after dropped onstop) is only observable on a real iOS Safari device. The regression tests lock in the invariant but cannot reproduce the browser event drop itself. A staging deploy + on-device tap sequence would confirm the user-facing recovery.
- **Watchdog duration tuning:** 8s is generous — long enough that a genuinely-slow stop() flow completes normally, short enough that a hung recorder recovers before the user gives up. If field data shows either edge case, tune the constant.

## Self-Check: PASSED

- File `.planning/quick/260808-1pa-guard-stoprecording-against-non-recordin/260808-1pa-SUMMARY.md` — FOUND (this file)
- Commit `a4a5962` — FOUND on `feat/tab-title-from-tmux`
- Commit message matches expected — FOUND
- Files in commit match declared list (5 files) — FOUND
- Full suite green (1526 pass / 6 skipped / 0 fail) — VERIFIED
- tsc --noEmit exit 0 — VERIFIED
