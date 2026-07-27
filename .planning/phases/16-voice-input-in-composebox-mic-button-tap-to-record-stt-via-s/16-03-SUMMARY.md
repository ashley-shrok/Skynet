---
phase: 16-voice-input-in-composebox-mic-button-tap-to-record-stt-via-s
plan: "03"
subsystem: frontend-composebox-voice-wiring
tags: [voice, composebox, react, useVoiceRecording, MicButton, RecordingControls, tdd]
dependency_graph:
  requires:
    - useVoiceRecording hook (from plan 02)
    - MicButton component (from plan 02)
    - RecordingControls component (from plan 02)
    - POST /voice/transcribe (from plan 01)
  provides:
    - ComposeBox with mic button in idle-empty state
    - ComposeBox with RecordingControls during recording
    - voice.endSend routed through handleSend (D-16-05 enforced)
    - Integration test suite for voice flow (9 tests)
  affects:
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/ComposeBox.voice.test.tsx
tech_stack:
  added: []
  patterns:
    - handleSend(overridePayload?: string) refactor for voice send path (D-16-05)
    - navigator.mediaDevices capability guard in showMicButton (JSDOM compat)
    - Conditional slot rendering: RecordingControls | MicButton | existing Send button
    - displayError = errorMessage ?? voice.errorMessage (merge pattern)
key_files:
  created:
    - src/ui/features/pretty-view/ComposeBox.voice.test.tsx
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx
decisions:
  - "handleSend refactored to accept optional overridePayload?: string — when present, used as send payload instead of current text state (D-16-05 voice-send path). Enables voice.endSend result to reach handleSend synchronously without React setState batching artifacts."
  - "showMicButton guards on navigator.mediaDevices != null — dual purpose: (1) correct UX behavior (don't show recording UI if browser lacks getUserMedia support), (2) JSDOM compatibility so existing tests that don't mock mediaDevices still see the Send button and pass without modification."
  - "displayError = errorMessage ?? voice.errorMessage — merges compose errors and STT/mic-denied errors into a single error display block, first non-null wins."
  - "Voice handler callbacks are async functions defined inline (handleVoiceCancel, handleVoiceAppend, handleVoiceSend) — passed to RecordingControls via void-wrapped arrow functions to satisfy the component's synchronous prop types."
metrics:
  duration: "~9 minutes"
  completed: "2026-07-27"
  tasks_completed: 2
  files_changed: 2
---

# Phase 16 Plan 03: ComposeBox Voice Wiring Summary

**One-liner:** ComposeBox now hosts MicButton in the idle-empty slot and RecordingControls while recording, with voice.endSend routing through the existing handleSend(overridePayload) for full D-16-05 send-path fidelity, proven by a 9-test integration suite.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (TDD wiring) | Wire voice hook + MicButton + RecordingControls into ComposeBox | 382b419 | ComposeBox.tsx |
| 2 (TDD integration tests) | Integration test for the ComposeBox voice flow | 902cfa0 | ComposeBox.voice.test.tsx |

## Implementation Details

### handleSend overridePayload refactor (D-16-05)

```typescript
function handleSend(overridePayload?: string) {
  // ...
  const trimmed = overridePayload !== undefined ? overridePayload.trim() : text.trim();
  // ... rest of handleSend unchanged
}
```

The `overridePayload` parameter is the ONLY change to handleSend's body. All other behavior (attachment branching at the hasAttachments gate, D-50 newline collapse via `.replace(/\r?\n/g, " ")`, COMPOSE-04 clear-on-success, COMPOSE-04 error-on-failure) is preserved verbatim. The voice send path calls `handleSend(result.glued)` after `setText(result.glued)` — the overridePayload bypasses the stale-closure issue that would arise from calling `handleSend()` after an async setState.

### Slot-visibility rule as landed

```
showMicButton =
  typeof navigator !== "undefined" &&
  navigator.mediaDevices != null &&   // capability guard + JSDOM compat
  voice.state === "idle" &&
  text.trim().length === 0 &&
  !asideActive &&
  !queueArmed &&
  !hasAttachments

showRecordingControls = voice.state === "recording"
showTranscribingSend  = voice.state === "transcribing"
```

The `navigator.mediaDevices != null` guard was added as a deviation from the plan's original `showMicButton` spec (which had 5 conditions, not 6). This is the correct UX behavior (don't show mic UI if browser lacks getUserMedia), and it also resolves the JSDOM compatibility issue that would otherwise have broken the existing test suite (see Deviations below).

### voice.errorMessage merge

```typescript
const displayError = errorMessage ?? voice.errorMessage;
// ...
{displayError && (
  <div className="text-xs text-[color:var(--color-pv-code-fg)]">{displayError}</div>
)}
```

Single display block, first-non-null wins. This is cleaner than two separate error blocks and matches the compact compose-error UX precedent (the block was already present for compose errors).

### Test counts

| Suite | Tests before Plan 03 | Tests after Plan 03 |
|-------|---------------------|---------------------|
| ComposeBox.test.tsx | 18 | 18 (unchanged) |
| ComposeBox.aside-morph.test.tsx | 9 | 9 (unchanged) |
| ComposeBox.aside-props.test.tsx | 10 | 10 (unchanged) |
| useVoiceRecording.test.ts | 8 | 8 (unchanged) |
| RecordingControls.test.tsx | 6 | 6 (unchanged) |
| **ComposeBox.voice.test.tsx** | 0 | **9 (new)** |
| **Total pretty-view** | **157** | **166** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] navigator.mediaDevices capability guard added to showMicButton**
- **Found during:** Task 1 verification — existing tests (ComposeBox.test.tsx, ComposeBox.aside-morph.test.tsx) failed because JSDOM does not provide `navigator.mediaDevices`, but the plan's 5-condition `showMicButton` gate did not account for this
- **Issue:** The plan said "existing tests pass with zero test edits required." Without the capability guard, tests that render ComposeBox with empty text and query for the "Send" button would fail (MicButton replaced Send in those cases). JSDOM's lack of `navigator.mediaDevices` is the discriminator.
- **Fix:** Added `typeof navigator !== "undefined" && navigator.mediaDevices != null` as the first two conditions in `showMicButton`. This is also the correct production UX (browsers without getUserMedia should not show recording UI). The new integration tests in ComposeBox.voice.test.tsx explicitly mock `navigator.mediaDevices`, so they correctly see MicButton. The existing tests do not mock it, so they continue to see the Send button.
- **Files modified:** `src/ui/features/pretty-view/ComposeBox.tsx`
- **Commit:** 382b419

## Verification Results

- `npx tsc --noEmit` exits 0
- `npx vitest run src/ui/features/pretty-view/` exits 0 with 166 tests passing (all 16 test files)
- `grep -c "useVoiceRecording\|MicButton\|RecordingControls" ComposeBox.tsx` returns 21 (>= 6)
- `grep -c "overridePayload\|voice.endSend" ComposeBox.tsx` returns 7 (>= 1)
- All 9 integration tests pass, including Test 8 (D-16-05 assertion: `onSend` called with "hello world")
- All 37 existing ComposeBox tests pass with zero modifications

## Known Stubs

None — all voice paths are fully wired:
- MicButton → voice.start() → MediaRecorder lifecycle (hook owns this)
- RecordingControls onCancel → voice.cancel()
- RecordingControls onAppend → voice.endAppend() → setText(glued)
- RecordingControls onSend → voice.endSend() → setText(glued) → handleSend(glued)
- voice.errorMessage → displayError → DOM error div

## Threat Flags

None — all threat mitigations from the plan's threat register were applied:
- T-16-13: voice.endSend routes through handleSend(overridePayload) — D-50 collapse, COMPOSE-04 hard-lock, attachment branching all preserved; Test 8 asserts this
- T-16-15: showMicButton gate explicitly excludes asideActive=true; Test 3 asserts this
- T-16-16: showTranscribingSend disables the send button during STT round-trip; showMicButton=false during transcribing; no affordance is tappable during the window

## Self-Check: PASSED

- ComposeBox.tsx modified: FOUND
- ComposeBox.voice.test.tsx created: FOUND
- Commit 382b419 (Task 1 wiring): verified in git log
- Commit 902cfa0 (Task 2 tests): verified in git log
- TypeScript clean: confirmed
- All 166 pretty-view tests passing: confirmed
- 9 new voice tests passing: confirmed
- Existing test suite (37 tests) unchanged and passing: confirmed
