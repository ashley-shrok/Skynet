---
phase: 31-whole-app-structured-logging-backfill
plan: "04"
subsystem: voice
tags:
  - logging
  - instrumentation
  - voice-recording
  - D-11
  - D-13
  - D-14
dependency_graph:
  requires:
    - 31-01
  provides:
    - canonical-voice-logging-shape
  affects:
    - src/ui/features/pretty-view/useVoiceRecording.ts
    - src/ui/features/pretty-view/ComposeBox.tsx
tech_stack:
  added: []
  patterns:
    - "[voice] event key=value structured log lines"
    - "D-07 feedback-playback-order boundary logs"
    - "D-12 logContext optional parameter pattern"
key_files:
  modified:
    - src/ui/features/pretty-view/useVoiceRecording.ts
    - src/ui/features/pretty-view/ComposeBox.tsx
decisions:
  - "Inlined audio.play() with .then/.catch in cancel/endAppend/endSend to allow per-phase boundary log injection around the feedback-playback-order pattern — consistent with D-07 diagnostic goal"
  - "logContext param is optional with n/a fallbacks — threading is best-effort per plan; ComposeBox wires hostId+tmuxSession"
  - "playSound() helper kept for error.mp3 / start.mp3 paths (no boundary-log requirement there) — cancel/stop paths inlined for boundary instrumentation"
metrics:
  duration: "~25 minutes"
  completed: "2026-08-11"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 2
---

# Phase 31 Plan 04: useVoiceRecording [voice-diag]→[voice] Canonical Retrofit Summary

Fully retrofitted `useVoiceRecording.ts` to the D-11/D-13/D-14 canonical golden-copy shape: `[voice-diag]` → `[voice]` prefix rename (23 → 0 occurrences), log-level normalization, D-05 MediaRecorder explicit field extraction, D-07 patch #382 AudioSession boundary logs, and D-12 optional logContext threading — all while keeping existing tests green.

## What Was Built

Single task executed: rename + normalize + instrument + extend `useVoiceRecording.ts` and wire logContext in `ComposeBox.tsx`.

## Prefix Count (old → new)

| Metric | Before | After |
|--------|--------|-------|
| `[voice-diag]` occurrences in src/ | 23 | 0 |
| `[voice]` occurrences in useVoiceRecording.ts | 0 | 42 |
| `[voice] ` (with trailing space) | 0 | 41 |

## Final Log Level Distribution

| Level | Count | Examples |
|-------|-------|---------|
| `console.info` | 25 | recording-started, stop-recording onstop-fired, transcribe-post, transcribe-fetch-resolved, transcribe-json-parsed, feedback-playback-order phases, recorder-start, recorder-data-available, cancel/endAppend/endSend entry/exit success |
| `console.warn` | 12 | stop-recording recorder-null, recorder-state-not-recording, stop-recording watchdog-fired, transcribe-fetch-not-ok, cancel/end-append/end-send gate rejected, end-append/end-send blob null, feedback-playback-order rejected |
| `console.error` | 4 | recorder-error (DOMException), transcribe-fetch-threw, transcribe-json-parse-threw, mic-denied |

## Key Assertions (all green)

- `[voice-diag]` in src/: **0** (required: 0)
- `[voice]` lines in file: **42** (required: >=10)
- `feedback-playback-order` lines: **12** (required: >=3; 4 phases × 3 entry-points)
- `recorder-error` lines: **1** (required: >=1)
- `mic-denied` lines: **2** (required: >=1)
- `console.info` lines: **25** (required: >=5)
- `console.warn` lines: **12** (required: >=3)
- `console.error` lines: **4** (required: >=2)
- `logContext` occurrences: **2** (required: >=1)
- `npx tsc --noEmit`: **exit 0**
- `npx vitest run src/ui/features/pretty-view/`: **549 passed, 7 skipped, 1 todo**

## Caller Sites Updated

**ComposeBox.tsx (line ~406):** Updated from `useVoiceRecording()` to:
```typescript
useVoiceRecording({ hostId: hostId ?? undefined, sessionId: tmuxSession ?? undefined })
```
This wires real hostId (number) and tmuxSession (string | null) into every voice log line. When either is absent (e.g., non-tmux SSH host), the log line shows `hostId=n/a` or `sessionId=n/a` — best-effort per D-12.

## D-07 Patch #382 Boundary Logs Detail

The patch #382 fix (play feedback AFTER recorder teardown) is now bracketed by four structured lines in each of `cancel()`, `endAppend()`, and `endSend()`:

```
[voice] feedback-playback-order phase=before-teardown hostId=N sessionId=X
[voice] feedback-playback-order phase=after-teardown-before-feedback hostId=N sessionId=X
[voice] feedback-playback-order phase=feedback-play-resolved sound=cancel hostId=N sessionId=X
[voice] feedback-playback-order phase=feedback-play-rejected sound=cancel errName="..." ...
```

If the AudioSession bug re-appears (onstop stops firing after audio.play), the missing `after-teardown-before-feedback` line — combined with `feedback-play-resolved` appearing before any onstop — immediately narrows the diagnosis without code archaeology.

## Deviations from Plan

### Auto-applied adjustments

**1. [Rule 2 - Enhancement] Inlined audio.play() calls in cancel/endAppend/endSend**
- **Found during:** Task 1 — implementing D-07 boundary logs
- **Issue:** The `playSound()` helper (which calls `audio.play()`) hid the exact play() promise, making it impossible to attach `.then/.catch` boundary log hooks without restructuring
- **Fix:** For the stop/cancel feedback paths (where D-07 boundary logs are required), inlined `audio.currentTime = 0; Promise.resolve(audio.play()).then(...).catch(...)` directly. The `playSound()` helper is retained for start.mp3 (Test A passes) and error.mp3 paths (no boundary-log requirement)
- **Files modified:** `src/ui/features/pretty-view/useVoiceRecording.ts`
- **Tests:** All 549 tests green; Test C (stop.mp3 ordering), Test D (cancel.mp3 ordering), Test F (rejected play does not throw) all pass because the inlined calls still call `.play()` on the same Audio stub instances the tests track via `audioInstances`

## Known Stubs

None. All log lines are wired to real runtime values. The `logContext` n/a fallback is intentional (best-effort per D-12) not a stub.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. Log lines carry:
- `blob.size` (numeric), `blob.type` (mimetype string) — T-31-10 compliant
- MediaRecorder error name/message (browser-provided strings)
- fetch status/ok (HTTP semantics)
- optional hostId (integer), sessionId (tmux session string)

Explicitly NOT logged: recorded audio bytes, transcript text, user speech content.

## Self-Check: PASSED

- File exists: `src/ui/features/pretty-view/useVoiceRecording.ts` — FOUND
- File exists: `src/ui/features/pretty-view/ComposeBox.tsx` — FOUND
- Commit `99745fc` exists in git log — FOUND
- `[voice-diag]` in src/: 0 — PASSED
- TypeScript: exit 0 — PASSED
- Test suite: 549/549 — PASSED
