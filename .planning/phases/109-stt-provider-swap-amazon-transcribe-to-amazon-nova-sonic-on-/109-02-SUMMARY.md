---
phase: 109-stt-provider-swap-amazon-transcribe-to-amazon-nova-sonic-on
plan: "02"
subsystem: voice/audio-transcode
tags: [tdd, ffmpeg, audio, nova-sonic, lpcm]
dependency_graph:
  requires: []
  provides: [webmToPcm16k]
  affects: [src/backend/voice/audio-transcode.ts, src/backend/voice/audio-transcode.test.ts]
tech_stack:
  added: []
  patterns: [runFfmpeg delegation, SILENCE_FILTER reuse, FakeChildProcess mock harness]
key_files:
  modified:
    - src/backend/voice/audio-transcode.ts
    - src/backend/voice/audio-transcode.test.ts
decisions:
  - "Reused existing SILENCE_FILTER constant (not duplicated) for token-cost savings on Nova Sonic"
  - "argv hardcoded as literal string array with no user-data interpolation (T-109-02-01 mitigated)"
  - "16 kHz locked (not configurable) per D-AUDIO decision"
metrics:
  duration: "~5 minutes"
  completed: "2026-09-13T01:16:04Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 109 Plan 02: webmToPcm16k Audio Transcode Helper Summary

## One-liner

Added `webmToPcm16k` ffmpeg wrapper producing LPCM 16 kHz s16le mono via `runFfmpeg` delegation + SILENCE_FILTER reuse, with 5 new unit tests mirroring the webmToFlac test topology.

## What Was Built

### Task 1 — RED (test(109-02): add failing tests for webmToPcm16k)

Commit: `4409674b`

Added `webmToPcm16k` to the dynamic import destructure in `audio-transcode.test.ts` and appended a new `describe("audio-transcode.webmToPcm16k — ffmpeg WebM → LPCM 16 kHz s16le mono transcode", ...)` block with 5 tests:

1. **argv shape** — asserts exact `['-i', 'pipe:0', '-af', SILENCE_FILTER_STRING, '-ar', '16000', '-ac', '1', '-f', 's16le', 'pipe:1']` against spawnMock
2. **silence filter constants** — verifies `-af` arg contains `stop_duration`, `stop_silence`, `stop_threshold`, `stop_periods=-1` from exported SILENCE_TRIM_* constants
3. **stdin pipe** — asserts `fake.stdin.end` called once with the exact input buffer
4. **resolve shape** — asserts `Buffer.concat` of two stdout chunks produces the correct concatenated bytes
5. **non-zero exit rejects** — asserts promise rejects with message containing stderr text "pcm encoder failed" on exit code 3

All 5 tests failed RED with `webmToPcm16k is not a function`. Existing 9 tests stayed green.

### Task 2 — GREEN (feat(109-02): implement webmToPcm16k)

Commit: `85f3e1f8`

Added `export function webmToPcm16k(webmBuffer: Buffer): Promise<Buffer>` to `audio-transcode.ts` immediately after `webmToFlac`. The function:

- Delegates to `runFfmpeg(webmBuffer, [...])` — no spawn/pipe body duplication
- Uses exactly `['-i', 'pipe:0', '-af', SILENCE_FILTER, '-ar', '16000', '-ac', '1', '-f', 's16le', 'pipe:1']`
- Reuses the existing `SILENCE_FILTER` module-private constant (not duplicated)
- Carries a docstring naming D-AUDIO, SILENCE_FILTER reuse rationale (token-cost savings), Plan 03 consumer reference, and T-109-02-01 threat mitigation note

## Test Results

```
npx vitest run src/backend/voice/audio-transcode.test.ts

Test Files  1 passed (1)
     Tests  14 passed (14)   ← 9 existing + 5 new webmToPcm16k
  Duration  214ms
```

TypeScript: `npx tsc --noEmit -p tsconfig.json` — clean (no output).

## Acceptance Criteria Verification

| Criterion | Result |
|-----------|--------|
| `grep -c "^export function webmToPcm16k" audio-transcode.ts` = 1 | 1 |
| `grep -c "runFfmpeg" audio-transcode.ts` >= 4 | 4 |
| `-ar 16000` only in webmToPcm16k (not webmToFlac) | confirmed |
| `-f s16le` only in webmToPcm16k | confirmed |
| `grep -c "SILENCE_FILTER" audio-transcode.ts` >= 3 | 5 (definition + webmToFlac use + webmToPcm16k use + docstrings) |
| All existing exports untouched | confirmed |
| Scoped tests green (14/14) | confirmed |
| tsc --noEmit clean | confirmed |

## Deviations from Plan

None — plan executed exactly as written.

The acceptance criteria grep patterns `"-ar",\s*"16000"` and `"-f",\s*"s16le"` use single-line matching and would return 0 against the multi-line argv arrays in the test file (same format used by the existing webmToFlac and webmToOggOpus tests). The underlying assertions are correctly present in the test bodies; this is a formatting choice consistent with the existing test style, not a substantive deviation.

## Known Stubs

None.

## Threat Flags

No new threat surface beyond what was modeled in the plan's STRIDE register. The `webmToPcm16k` function follows the same argv-safety invariant as `webmToOggOpus` and `webmToFlac` (T-109-02-01 mitigated by literal-only argv construction).

## Self-Check

- [x] `src/backend/voice/audio-transcode.ts` exists and exports `webmToPcm16k`
- [x] `src/backend/voice/audio-transcode.test.ts` contains 5 new webmToPcm16k tests
- [x] Commit `4409674b` exists (RED)
- [x] Commit `85f3e1f8` exists (GREEN)
- [x] Scoped test suite: 14/14 green
- [x] `tsc --noEmit`: clean

## Self-Check: PASSED
