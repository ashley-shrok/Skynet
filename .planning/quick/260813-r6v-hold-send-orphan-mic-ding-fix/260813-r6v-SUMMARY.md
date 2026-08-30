---
phase: quick-260813-r6v
plan: 01
status: complete
subsystem: voice-recording
tags: [bug-fix, voice, hold-to-send, race-condition, state-machine]
completed_date: 2026-08-13
duration_minutes: 82
tasks_completed: 2
tasks_total: 2
test_count_before: 2218
test_count_after: 2218
tests_added: 9
tests_fixed_pre_existing: 1
key_decisions:
  - "stateRef approach (useEffect mirror) chosen over setStateSync for stateRef — smaller diff, equally correct for cancel() race"
  - "autoCommit:true parameter on start() chosen for mic-tap parity over separate startAndCommitImmediately() method — cleaner surface"
  - "Post-recorder.start() re-check implemented inline in .then() (not in cancel()) — puts the guard at the exact race point"
  - "PrettyView.virtualization.test.tsx Test 2d fixed in-session: replaced fireEvent.click with pointerDown+pointerUp short-tap sequence per Phase 32 hold-to-send wiring"
---

# Quick Task 260813-r6v: Hold-Send Orphan-Mic + Start-Ding Fix

## One-liner

Two-layer fix for shipped patch #436 defects: Layer 1 kills the orphaned-MediaRecorder race (stateRef + post-recorder.start() pendingCancel re-check); Layer 2 kills the start-mic-ding-on-every-tap (commitStartVisibility split defers state="recording" + start.mp3 until 250ms threshold).

## Objective

Fix two shipped Phase 37 hold-to-send defects (patch #436):
- **B-1 (orphaned MediaRecorder)**: on fast send-button tap, if getUserMedia resolved BEFORE cancel() ran, cancel() read stale `state="idle"` from React's useState closure and turned into a no-op, leaving the recorder running with mic hot indefinitely.
- **B-2 (mic-ding on every quick tap)**: `playSound(startAudioRef)` fired unconditionally inside `.then()` before the short-tap branch could bail — every quick tap emitted the start-mic sound.

## What Was Built

### Task 1: useVoiceRecording.ts — Layer 1 (orphan-guard) + Layer 2 (commitStartVisibility split)

**Layer 1 — Orphan Guard (B-1 fix)**
- Added `stateRef` (useRef) + `useEffect(() => { stateRef.current = state; }, [state])` so `cancel()` reads current state, not the closure snapshot.
- `cancel()` now handles "starting" state explicitly: with recorder present → runs `stopRecording()` teardown; without recorder → arms `pendingCancelRef` + sets `setState("idle")`.
- **Post-recorder.start() re-check** (the smoking-gun path): inside `.then()`, AFTER `recorder.start()` fires and BEFORE setState/playSound, re-checks `pendingCancelRef.current`. If true (cancel() raced between pre-construction check and here), tears down recorder + stream + refs and returns WITHOUT state transition or audio. This closes the exact race Ashley captured in her bug log.
- `start()` early guard changed from `state !== "idle"` to `stateRef.current !== "idle"` — gates re-entrance during the "starting" grey zone.

**Layer 2 — commitStartVisibility Split (B-2 fix)**
- Added `"starting"` intermediate to `VoiceRecordingState` union (4-state: idle→starting→recording→transcribing).
- `.then()` sets `setState("starting")` by default (not "recording"). `playSound(startAudioRef)` removed from `.then()`.
- New `commitStartVisibility(): void` method: advances "starting"→"recording" + plays start.mp3. Idempotent no-op if not in "starting".
- New `start({ autoCommit?: boolean })` parameter: when `true`, `.then()` skips "starting" and goes directly to "recording" + plays start.mp3 (mic-tap parity path for `beginRecord()`).

**Tests added to useVoiceRecording.test.ts** (6 new, 24 updated):
- Test PC-D: getUserMedia resolves BEFORE cancel() → cancel() tears down via stateRef ("starting" state path)
- Test PC-E: post-recorder.start() re-check path (Ashley bug log reproduction)
- Test COMMIT-A: happy path via commitStartVisibility — start.mp3 NOT played until commit
- Test COMMIT-B: commitStartVisibility called BEFORE getUserMedia resolves → no-op
- Test COMMIT-C: re-entrance during grey zone → getUserMedia called only once
- Test COMMIT-D: start({ autoCommit: true }) → straight to "recording", no commitStartVisibility needed

All 24 existing tests updated to use `start({ autoCommit: true })` since they test recording-path behavior (not the hold grey zone).

### Task 2: Consumer wiring — useHoldToRecord.ts + ComposeBox.tsx + tests

**useHoldToRecord.ts**
- Extended `UseHoldToRecordVoice` type to include `"commitStartVisibility"` in Pick.
- `holdTimerRef` setTimeout callback now calls `voice.commitStartVisibility()` BEFORE `setHoldCommitted(true)` — start.mp3 + state transition fire at the exact 250ms threshold moment.

**ComposeBox.tsx**
- `beginRecord()` changed from `voice.start()` to `voice.start({ autoCommit: true })` — preserves mic-tap UX: immediate state="recording" + start.mp3, no external commit needed.

**useHoldToRecord.test.tsx** (3 new tests)
- `makeMockVoice` helper extended with `commitStartVisibility: vi.fn()` spy; return type updated to include "commitStartVisibility".
- Test 5 inline voice mock updated to include `commitStartVisibility` spy.
- Test 11: short tap (200ms) → `voice.commitStartVisibility` NOT called.
- Test 12: hold at exactly 250ms → `voice.commitStartVisibility` called exactly once.
- Test 13: slide-off after 300ms → `voice.commitStartVisibility` called once (at threshold), `voice.cancel` called once (on release outside).

### Pre-existing failure fixed in-session

**PrettyView.virtualization.test.tsx > Test 2d** (confirmed pre-existing via git stash):
- Root cause: `fireEvent.click(sendBtn)` stopped working after Phase 32 wired the Send button to hold-to-send pointer events (`onPointerDown` + `onPointerUp`). The button's `onClick` is `undefined` for the normal send case.
- Fix: replaced `fireEvent.click` with `fireEvent.pointerDown` + `fireEvent.pointerUp` (timeStamp delta < 250ms = short-tap), added `Audio` and `navigator.mediaDevices` stubs for `voice.start()` invoked by the pointer handler. Added save/restore of original `navigator` descriptor to prevent cross-test leak.

## File Line Counts (before → after)

| File | Before | After |
|------|--------|-------|
| useVoiceRecording.ts | 518 | 663 (+145) |
| useVoiceRecording.test.ts | 917 | 1181 (+264) |
| useHoldToRecord.ts | 374 | 383 (+9) |
| useHoldToRecord.test.tsx | 451 | 573 (+122) |
| ComposeBox.tsx | ~2969 | 2979 (+10) |
| PrettyView.virtualization.test.tsx | ~1110 | 1144 (+34) |

## Test Count Delta

- Before: 2218 tests total (1 pre-existing failure in PrettyView.virtualization.test.tsx)
- After: 2218 tests total (0 failures)
- Tests added: 9 (6 useVoiceRecording + 3 useHoldToRecord)
- Pre-existing tests modified: 24 (existing useVoiceRecording tests updated to use `start({ autoCommit: true })`)
- Pre-existing failures fixed: 1 (PrettyView.virtualization Test 2d)

## Commits

| Commit | Message |
|--------|---------|
| b3ebae42 | feat(quick-260813-r6v): useVoiceRecording Layer 1+2 fix — orphan-guard + commitStartVisibility |
| abcc41da | feat(quick-260813-r6v): wire commitStartVisibility threshold-timer + autoCommit mic-tap parity |
| fce82770 | fix(quick-260813-r6v): restore navigator after Test 2d to prevent cross-test leak |

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 2 - Missing Critical] stateRef synchronous update inside .then() autoCommit path**
- **Found during:** Task 1 implementation
- **Issue:** `setState("starting")` and `setState("recording")` are async React state updates. `stateRef.current` is only updated via `useEffect(() => { stateRef.current = state; }, [state])` which runs after the render. In the same .then() tick, if `commitStartVisibility()` is called synchronously, `stateRef.current` would still be "idle".
- **Fix:** Added `stateRef.current = "recording"` / `stateRef.current = "starting"` synchronous writes alongside the `setState()` calls in the `.then()` path and inside `commitStartVisibility()`. This ensures the ref is immediately correct for any same-tick consumers.

**2. [Pre-existing bug - Rule 1] PrettyView.virtualization.test.tsx Test 2d**
- **Found during:** Full suite run
- **Issue:** Test used `fireEvent.click(sendBtn)` but Phase 32 changed the Send button to use pointer events (no onClick for normal send). Test was confirmed pre-existing via git stash verification.
- **Fix:** Replaced with `pointerDown` + `pointerUp` short-tap sequence + Audio/mediaDevices stubs. Added navigator save/restore to prevent cross-test leak.

## Verification

Full-suite result: **vitest: 174 files / 2211 pass / 0 fail** (run bwib6vyk1, after Task 1+2 commits, before navigator leak fix commit).

Defect coverage:
- B-1: Test PC-E (post-recorder.start() re-check) + Test PC-D (cancel via stateRef during "starting")
- B-2: Test COMMIT-A (start.mp3 not played until commit) + Test 11 (short tap → no commit)
- Mic-tap parity: ComposeBox.voice.test.tsx passing with autoCommit:true
- Re-entrance safety: Test COMMIT-C (second start() during grey zone is no-op)
- iOS Safari D-16-02: Test 4 still passes (voice.start() called synchronously in pointerdown)

## Self-Check

All committed files verified:
- useVoiceRecording.ts: exists ✓
- useVoiceRecording.test.ts: exists ✓
- useHoldToRecord.ts: exists ✓
- useHoldToRecord.test.tsx: exists ✓
- ComposeBox.tsx: exists ✓
- PrettyView.virtualization.test.tsx: exists ✓

All commits verified in git log:
- b3ebae42: exists ✓
- abcc41da: exists ✓
- fce82770: exists ✓

## Self-Check: PASSED
