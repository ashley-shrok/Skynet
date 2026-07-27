---
phase: 16-voice-input-in-composebox-mic-button-tap-to-record-stt-via-s
plan: "02"
subsystem: frontend-voice-primitives
tags: [voice, react-hook, mediarecorder, stt, lucide-react, tdd]
dependency_graph:
  requires:
    - POST /voice/transcribe (from plan 01)
  provides:
    - useVoiceRecording hook (state machine + MediaRecorder + fetch)
    - MicButton component (idle-state mic button)
    - RecordingControls component (three-button recording controls)
  affects:
    - src/ui/features/pretty-view/useVoiceRecording.ts
    - src/ui/features/pretty-view/useVoiceRecording.test.ts
    - src/ui/features/pretty-view/MicButton.tsx
    - src/ui/features/pretty-view/RecordingControls.tsx
    - src/ui/features/pretty-view/RecordingControls.test.tsx
tech_stack:
  added: []
  patterns:
    - useRef for mutable MediaRecorder/stream/chunks state (avoids re-render on ref change)
    - Plain-function start() with synchronous getUserMedia (iOS Safari D-16-02 constraint)
    - stopRecording() returning Promise<Blob|null> via onstop event callback
    - endAppend/endSend returning Promise<{transcript, glued}|null>
    - lucide-react bare-glyph icons (Mic, X, ArrowDownToLine, Send)
    - Tailwind pv-palette inline color classes (hsla hue-0 red-tint, var(--color-pv-code-fg) coral)
key_files:
  created:
    - src/ui/features/pretty-view/useVoiceRecording.ts
    - src/ui/features/pretty-view/useVoiceRecording.test.ts
    - src/ui/features/pretty-view/MicButton.tsx
    - src/ui/features/pretty-view/RecordingControls.tsx
    - src/ui/features/pretty-view/RecordingControls.test.tsx
  modified: []
decisions:
  - "endAppend and endSend return Promise<{transcript: string, glued: string} | null> — null on STT error. Both have identical internal logic; caller decides whether to send after receiving the result."
  - "MockMediaRecorder auto-fires onstop on stop() call — simplifies test flow; no need for manual onstop trigger in most tests."
  - "Palette: cancel uses inline hsla(0, 72%, 72%, 0.85) (red hue-0 signature matching prototype pv-danger), send uses text-[color:var(--color-pv-code-fg)] (canonical pv-coral token, #ffb896 per index.css:129), append uses neutral rgba(240,235,224,0.6)."
  - "No MicButton.test.tsx — plan specifies this is intentionally skipped; coverage comes from ComposeBox integration test in Plan 03."
metrics:
  duration: "~5 minutes"
  completed: "2026-07-27"
  tasks_completed: 2
  files_changed: 5
---

# Phase 16 Plan 02: Frontend Voice Recording Primitives Summary

**One-liner:** useVoiceRecording hook with iOS-safe synchronous getUserMedia, MediaRecorder state machine, and /voice/transcribe fetch; plus MicButton and RecordingControls bare-glyph components using pv-palette tokens.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (TDD RED) | Failing tests for useVoiceRecording hook | c909e51 | useVoiceRecording.test.ts |
| 1 (TDD GREEN) | Implement useVoiceRecording hook | d457c52 | useVoiceRecording.ts |
| 2 (TDD RED) | Failing tests for RecordingControls | 0bb3147 | RecordingControls.test.tsx |
| 2 (TDD GREEN) | Implement MicButton + RecordingControls | 13364e1 | MicButton.tsx, RecordingControls.tsx |

## Implementation Details

### endAppend / endSend return shape

Both functions return `Promise<{transcript: string, glued: string} | null>`.

- `transcript`: the raw STT text (e.g., "hello world")
- `glued`: transcript appended to currentText with the space-glue rule applied (`currentText + (currentText && !/\s$/.test(currentText) ? " " : "") + transcript`)
- `null`: returned on STT error or if no recorder was active; `errorMessage` is set on the hook

The caller (ComposeBox, Plan 03) decides what to do with `glued`:
- `endAppend`: set textarea value to `glued`, leave send to user
- `endSend`: set textarea value to `glued`, then call the existing `handleSend()`

### MediaRecorder mock coverage

The test's `MockMediaRecorder` stubs the following:
- `.start()` — vi.fn() (no-op; tests verify it was called)
- `.stop()` — vi.fn() that auto-fires `onstop` synchronously after being called
- `.mimeType` — property (default "audio/webm")
- `.ondataavailable` / `.onstop` — event handler slots
- `.emitData(blob)` — test helper to push a fake audio chunk

The auto-onstop on `.stop()` means tests don't need to manually trigger `onstop` after calling `cancel()/endAppend()/endSend()`. This mirrors how real MediaRecorder fires `onstop` after `stop()` completes.

### Palette token landing

| Element | Class | CSS value |
|---------|-------|-----------|
| MicButton (idle) | `text-[rgba(240,235,224,0.3)]` | warm off-white at 30% alpha |
| RecordingControls cancel | `text-[hsla(0,72%,72%,0.85)]` | red-tint (hue-0 = red, pv-danger analog) |
| RecordingControls append | `text-[rgba(240,235,224,0.6)]` | neutral warm off-white |
| RecordingControls send | `text-[color:var(--color-pv-code-fg)]` | coral #ffb896 (canonical pv-coral token) |

The `--color-pv-code-fg` CSS variable is the canonical Skynet way to reference coral (#ffb896, per `src/ui/index.css:129`). Using `var(--color-pv-code-fg)` instead of an inline `#ffb896` literal means the send button automatically follows any future palette update.

### Sync-getUserMedia constraint verified by test

Test 2 in `useVoiceRecording.test.ts` verifies the iOS Safari constraint:
1. Call `act(() => { result.current.start(); })`
2. Immediately assert `navigator.mediaDevices.getUserMedia` was called (before any `await` resolves)
3. Then `await waitFor(...)` to confirm state transitions to "recording"

If `start()` were `async` with an `await` before `getUserMedia`, step 2 would fail because the getUserMedia call would be queued as a microtask rather than executed synchronously.

### State machine deviations from prototype

No deviations from the prototype's state machine shape (`setState('idle'|'recording'|'transcribing', msg)` pattern). The hook maps these directly:
- `setState("idle")` ↔ prototype `setState('idle', msg)`
- `setState("recording")` ↔ prototype `setState('recording', 'recording...')`
- `setState("transcribing")` ↔ prototype `setState('idle', 'transcribing...')` (prototype reuses 'idle' for transcribing display; the hook adds a proper third state for cleaner UI gating)

The only addition vs. prototype: the hook uses a distinct `"transcribing"` state (the prototype uses `setState('idle', 'transcribing...')` as a display hack). This is intentional — ComposeBox Plan 03 will use `state === "transcribing"` to disable controls during the fetch.

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

- `npx tsc --noEmit` exits 0
- `npx vitest run src/ui/features/pretty-view/useVoiceRecording.test.ts src/ui/features/pretty-view/RecordingControls.test.tsx` exits 0 with 14 tests passing (8 + 6)
- `grep -c "navigator.mediaDevices.getUserMedia" useVoiceRecording.ts` returns 3 (>= 1)
- `grep -c "/voice/transcribe" useVoiceRecording.ts` returns 3 (>= 1)
- `grep -c "MediaRecorder" useVoiceRecording.ts` returns 3 (>= 1)
- All components (useVoiceRecording, MicButton, RecordingControls) live under `src/ui/features/pretty-view/`
- Zero changes to ComposeBox.tsx (verified by grep — file does not reference any new exports)

## Known Stubs

None.

## Threat Flags

None — all threat mitigations from the plan's threat register were applied:
- T-16-08: `start()` is only callable from onClick handler (not from effects/timers); no-op if state !== "idle"
- T-16-10: State machine gates transitions; rapid-tap guard in `start()` (if state !== "idle" return), `cancel/endAppend/endSend` (if state !== "recording" return null)
- T-16-11: Transcript inserted via React state setter into textarea value (plain text, no innerHTML path)
- T-16-12: errorMessage strings are hardcoded ("mic denied: NotAllowedError") — no stack traces or system paths

## Self-Check: PASSED

- useVoiceRecording.ts exists: FOUND
- useVoiceRecording.test.ts exists: FOUND
- MicButton.tsx exists: FOUND
- RecordingControls.tsx exists: FOUND
- RecordingControls.test.tsx exists: FOUND
- Commit c909e51 (TDD RED hook tests): verified in git log
- Commit d457c52 (TDD GREEN hook impl): verified in git log
- Commit 0bb3147 (TDD RED controls tests): verified in git log
- Commit 13364e1 (TDD GREEN components): verified in git log
- TypeScript clean: confirmed
- All 14 tests passing: confirmed
