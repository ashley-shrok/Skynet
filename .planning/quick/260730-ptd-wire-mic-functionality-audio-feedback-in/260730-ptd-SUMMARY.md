---
phase: 260730-ptd-wire-mic-functionality-audio-feedback-in
plan: "01"
subsystem: ui/voice-recording
tags: [audio-feedback, ux, vitest, hooks]
dependency_graph:
  requires: []
  provides: [mic-audio-feedback]
  affects: [useVoiceRecording, ComposeBox]
tech_stack:
  added: [Web Audio API (HTMLAudioElement), Vite ?url imports]
  patterns: [useRef lazy-init for Audio instances, silent .play().catch()]
key_files:
  created:
    - src/ui/assets/sounds/mic/start.mp3
    - src/ui/assets/sounds/mic/stop.mp3
    - src/ui/assets/sounds/mic/cancel.mp3
    - src/ui/assets/sounds/mic/error.mp3
    - src/ui/assets/sounds/mic/CREDITS.md
  modified:
    - src/ui/features/pretty-view/useVoiceRecording.ts
    - src/ui/features/pretty-view/useVoiceRecording.test.ts
decisions:
  - "Used useRef lazy-init pattern (not useMemo) for Audio instances — refs don't trigger re-renders"
  - "playSound() helper centralizes currentTime reset + silent .catch() — no audio failure propagates to recording flow"
  - "stop.mp3 placed as FIRST statement in endAppend/endSend (before stopRecording await) to give immediate feedback before STT latency"
  - "error.mp3 NOT played on permission-denied path (mic denied) — Safari autoplay risk + errorMessage signal is sufficient"
  - "Audio constructor mocked with function declaration (not arrow) in tests — vi.fn() arrow mocks are not usable as constructors"
metrics:
  duration: "~8 minutes"
  completed: "2026-07-30T18:42:59Z"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 7
---

# Phase 260730-ptd Plan 01: Wire Mic Audio Feedback Summary

**One-liner:** 4 Google Material Design MP3 sounds wired into useVoiceRecording at start/stop/cancel/error transitions via lazy-init Audio refs and a silent-failure playSound helper, with 6 new vitest assertions covering call ordering and failure isolation.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Stage 4 MP3 assets + CREDITS.md | be3c573 | src/ui/assets/sounds/mic/{start,stop,cancel,error}.mp3, CREDITS.md |
| 2 | Wire audio feedback + extend vitest | 5c59743 | useVoiceRecording.ts, useVoiceRecording.test.ts |

## Implementation Notes

### Audio architecture

- 4 `?url` imports at top of `useVoiceRecording.ts` (Vite built-in; no config change)
- 4 `useRef<HTMLAudioElement | null>(null)` with inline lazy-init guards — constructed once per mount, survive re-renders without reconstruction
- `playSound(audio)`: resets `currentTime = 0` (enables replay without seeking), calls `.play().catch(() => {})` — audio failure is UX polish only and must not disrupt recording

### Sound placement

| Sound | Location | Ordering guarantee |
|-------|----------|--------------------|
| start.mp3 | `.then()` callback after `recorder.start()` + `setState("recording")` | Plays only on success path; .catch() does not invoke it |
| stop.mp3 | First statement in `endAppend` + `endSend` after guard | Before `stopRecording()` await — immediate feedback, no STT latency |
| cancel.mp3 | First statement in `cancel()` after guard | Before `stopRecording()` await — immediate feedback before teardown |
| error.mp3 | All 3 failure branches in `transcribeBlob()` + empty-transcript guard in endAppend/endSend | Plays on fetch throw, non-ok status, invalid JSON, empty STT response |

### Test coverage (14 tests passing)

- 8 pre-existing tests: unchanged assertions, Audio mock added to beforeEach (constructor mock pattern, not arrow)
- Test A: start.mp3 plays after recorder.start() — verified via invocationCallOrder
- Test B: start.mp3 NOT played on getUserMedia rejection
- Test C: stop.mp3 plays before fetch — verified via invocationCallOrder (endAppend + endSend)
- Test D: cancel.mp3 plays before recorder.stop() — verified via invocationCallOrder
- Test E: error.mp3 plays on HTTP 500 and network error
- Test F: rejected play() Promise is silently swallowed; state still transitions to "recording"

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

### Files exist
- src/ui/assets/sounds/mic/start.mp3: FOUND
- src/ui/assets/sounds/mic/stop.mp3: FOUND
- src/ui/assets/sounds/mic/cancel.mp3: FOUND
- src/ui/assets/sounds/mic/error.mp3: FOUND
- src/ui/assets/sounds/mic/CREDITS.md: FOUND
- src/ui/features/pretty-view/useVoiceRecording.ts: modified
- src/ui/features/pretty-view/useVoiceRecording.test.ts: modified

### Commits exist
- be3c573: chore(260730-ptd-01): stage 4 mic audio-feedback assets + CREDITS.md
- 5c59743: feat(260730-ptd-01): wire 4 audio-feedback sounds into useVoiceRecording + extend vitest coverage

### Test results
- 14/14 tests passing
- npx tsc --noEmit: exit 0

## Self-Check: PASSED
