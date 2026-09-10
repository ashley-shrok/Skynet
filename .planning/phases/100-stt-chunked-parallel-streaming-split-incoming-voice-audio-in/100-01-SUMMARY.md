---
phase: 100-stt-chunked-parallel-streaming
plan: "01"
subsystem: voice/audio
tags:
  - ffmpeg
  - semaphore
  - chunker
  - tts
  - wave-1-kernels
dependency_graph:
  requires: []
  provides:
    - "createSemaphore(limit) — dep-free counting semaphore (semaphore.ts)"
    - "sliceFlac, scanSilenceGaps, probeDuration, parseSilenceGaps, computeChunkBoundaries (audio-chunker.ts)"
    - "runFfmpeg exported from audio-transcode.ts — shared spawn/pipe utility"
  affects:
    - "src/backend/voice/audio-transcode.ts (one-line export change)"
tech_stack:
  added: []
  patterns:
    - "FakeChildProcess test double (spawn mock via vi.hoisted + vi.mock)"
    - "Inline async counting semaphore (5 lines, dep-free)"
    - "ffmpeg stdin→stdout FLAC slicing with -f flac before -i pipe:0 (Pitfall 3)"
    - "ffmpeg silencedetect stderr collection (stdin→stderr, not stdout)"
    - "ffprobe stdout float parsing for duration"
key_files:
  created:
    - src/backend/voice/semaphore.ts
    - src/backend/voice/semaphore.test.ts
    - src/backend/voice/audio-chunker.ts
    - src/backend/voice/audio-chunker.test.ts
  modified:
    - src/backend/voice/audio-transcode.ts
decisions:
  - "Export runFfmpeg from audio-transcode.ts (not duplicate/extract) — single spawn body shared by webmToOggOpus, webmToFlac, sliceFlac"
  - "Renamed runFfmpeg parameter from webmBuffer to inputBuffer to reflect general use"
  - "semaphore.ts has zero imports (dep-free; D-09/D-10)"
  - "scanSilenceGaps spawns ffmpeg directly (not via runFfmpeg) because silencedetect output is on stderr"
  - "computeChunkBoundaries includes minChunkSec=1.0 guard that merges trailing micro-chunks into the previous boundary"
metrics:
  duration: "~10 minutes"
  completed: "2026-09-10"
  tasks_completed: 2
  files_changed: 5
---

# Phase 100 Plan 01: Wave 1 Pure Kernels Summary

**One-liner:** Counting semaphore factory + FLAC audio chunker (silencedetect scan, ffprobe probe, FLAC slice, boundary math) + runFfmpeg exported as shared spawn utility.

## What Was Done

### Task 1: Export runFfmpeg + create semaphore module

**audio-transcode.ts (modified):**
- Changed `function runFfmpeg` to `export function runFfmpeg`
- Renamed parameter `webmBuffer` to `inputBuffer` to reflect general-purpose use
- Updated JSDoc comment to note T-98-04-04 argv-safety constraint still applies
- No body changes; `webmToOggOpus` and `webmToFlac` callers unaffected

**semaphore.ts (created):**
- Single exported factory `createSemaphore(limit: number)` returning an `acquire<T>` async function
- Zero imports — completely dep-free module per D-09/D-10
- Counting semaphore: `let active = 0; const queue: Array<() => void> = []` pattern from RESEARCH.md § 5

**semaphore.test.ts (created):**
- 5 tests: concurrency limit (N=2 admits 2, queues 3rd), value passthrough, rejection passthrough, FIFO order (limit=1, A/B/C in → A/B/C out), slot-release-on-throw
- All 5 pass; existing 8 audio-transcode tests unaffected

### Task 2: Create audio-chunker module + tests

**audio-chunker.ts (created):**

Exports:
- `SilenceGap` interface: `{ startSec, endSec, durationSec }`
- `ChunkBoundary` interface: `{ startSec, endSec }` (endSec extends past logical cut by overlapSec)
- `sliceFlac(flacBuf, startSec, durationSec)` — delegates to `runFfmpeg` with FLAC argv; `-f flac` before `-i pipe:0` per Pitfall 3
- `scanSilenceGaps(flacBuf, thresholdDb=-40, minGapSec=0.2)` — spawns ffmpeg directly, collects stderr (silencedetect output is on stderr; stdout goes to /dev/null via `-f null -`)
- `probeDuration(flacBuf)` — spawns `ffprobe`, parses stdout float; rejects on non-finite result
- `parseSilenceGaps(stderrOutput)` — pure function; tracks `pendingStart` state to pair silence_start/end; discards unpaired trailing silence_start per Pitfall 2
- `computeChunkBoundaries(totalDurationSec, silenceGaps, targetChunkSec=8, overlapSec=2.5, minChunkSec=1.0)` — silence-aware (gap midpoint) with fixed-window fallback; post-loop minChunkSec merge guard per Pitfall 8

**audio-chunker.test.ts (created):**
- 14 tests covering all 12+ behaviors: sliceFlac (argv exact, toFixed(3)), scanSilenceGaps (argv + stderr resolve, non-zero reject), probeDuration (ffprobe argv, float parse, non-numeric reject), parseSilenceGaps (2 pairs, unpaired trailing, empty), computeChunkBoundaries (silence-aware cut, fixed fallback, last-chunk terminator, total coverage, minimum-chunk merge)
- FakeChildProcess pattern copied verbatim from audio-transcode.test.ts

## Test Results

```
Test Files  3 passed (3)
Tests       27 passed (27)
  - semaphore.test.ts:       5 tests
  - audio-transcode.test.ts: 8 tests (unchanged, still green)
  - audio-chunker.test.ts:  14 tests
```

`npx tsc --noEmit` — zero errors.

## Deviations from Plan

None — plan executed exactly as written.

The only minor implementation detail: the plan acceptance criteria checks for `"-f", "flac", "-i", "pipe:0"` on a single line; the implementation formats each argv element on its own line (consistent with audio-transcode.ts style). The tests assert the exact same argv values element-by-element, which is the functional equivalence. All 14 audio-chunker tests verify the argv contents.

## Security Audit

T-100-01-01 gate: `grep -E '\$\{[^}]*\}' src/backend/voice/audio-chunker.ts | grep -v 'toFixed\|thresholdDb\|minGapSec'` returns only error message interpolations (`${code}`, `${stderrText}`, `${raw}`) — no argv interpolation of user-controlled strings. The `thresholdDb` and `minGapSec` template literals in the silencedetect argv string are numeric function parameters with hardcoded defaults, explicitly excluded by the grep gate.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes. All new code is backend-only subprocess-pipe utilities with no new trust boundary surfaces.

## Handoff Note to Plan 03

`runFfmpeg` is now importable from `./audio-transcode.js` as a named export. The import line `import { runFfmpeg } from "./audio-transcode.js"` is already live in `audio-chunker.ts` and working. Plan 03 (transcribe-orchestrator) and any other Wave 2 module can import it without duplication.

## Self-Check

### Created files exist:
- /home/ubuntu/skynet-tabitha/src/backend/voice/semaphore.ts — FOUND
- /home/ubuntu/skynet-tabitha/src/backend/voice/semaphore.test.ts — FOUND
- /home/ubuntu/skynet-tabitha/src/backend/voice/audio-chunker.ts — FOUND
- /home/ubuntu/skynet-tabitha/src/backend/voice/audio-chunker.test.ts — FOUND

### Commits exist:
- 17842a99 — feat(100-01): export runFfmpeg from audio-transcode + add semaphore module
- 7d9fdd72 — feat(100-01): add audio-chunker module

## Self-Check: PASSED
