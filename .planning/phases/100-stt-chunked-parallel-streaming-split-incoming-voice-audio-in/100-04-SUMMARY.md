---
phase: 100-stt-chunked-parallel-streaming
plan: "04"
subsystem: voice/stt
tags: [wave-3, wiring, fast-path-gate, tdd]
dependency_graph:
  requires: [100-03]
  provides: [chunked-stt-routing-live]
  affects: [src/backend/database/routes/voice.ts, src/backend/database/routes/voice.test.ts]
tech_stack:
  added: []
  patterns: [fast-path-ternary-branch, byte-proxy-threshold, tdd-red-green]
key_files:
  created: []
  modified:
    - src/backend/database/routes/voice.ts
    - src/backend/database/routes/voice.test.ts
decisions:
  - "CHUNKED_THRESHOLD_BYTES = 80_000 bytes (D-05/D-06): byte-proxy over ffprobe avoids ~10 ms spawn on every request; 80 KB safely captures any clip likely exceeding ~10 s clean-speech FLAC at 16 kHz mono"
  - "Ternary branch inside handleTranscribe's try-block replaces single transcribeBuffer call; catch block and all downstream code (slash-transform, response shape, disk-bank write) remain untouched"
metrics:
  duration: "~5 min"
  completed: "2026-09-10"
  tasks_completed: 1
  files_modified: 2
---

# Phase 100 Plan 04: Fast-path gate wiring into handleTranscribe Summary

Wave 3 wiring complete. `handleTranscribe` in `src/backend/database/routes/voice.ts` now branches on buffer size: clips at/above `CHUNKED_THRESHOLD_BYTES` (80_000 bytes ≈ 10 s of clean-speech FLAC) route to `transcribeBufferChunked`; shorter clips keep the existing single-stream `transcribeBuffer` path unchanged.

## What Was Built

### voice.ts diff summary (line ranges added/modified)

| Change | Location | Description |
|--------|----------|-------------|
| Import added | Line 18 (after existing transcribeBuffer import) | `import { transcribeBufferChunked } from "../../voice/transcribe-orchestrator.js"` |
| Constant added | Lines 40-44 (after SAMPLE_PHRASE) | `export const CHUNKED_THRESHOLD_BYTES = 80_000;` with inline rationale comment |
| Branch added | Lines 143-160 (replacing single transcribeBuffer call) | Ternary: `buffer.length >= CHUNKED_THRESHOLD_BYTES ? transcribeBufferChunked(...) : transcribeBuffer(...)` |
| Log line updated | Lines 162-164 | Added `path=chunked|single` field and structured `path` property for observability |

**Untouched (verified via `git diff`):** disk-bank write block (lines 106-127), slash-transform block (lines 149-184), catch block (lines 190-205), response shape (lines 186-189), handleSpeak, handleSpeakStream, router registration.

### voice.test.ts changes

- Test count before this plan: **24 tests**
- Test count after this plan: **30 tests** (6 new tests added)
- New `vi.mock` block for `transcribe-orchestrator.js`
- New import of `transcribeBufferChunked` and `CHUNKED_THRESHOLD_BYTES`
- `transcribeBufferChunked.mockReset()` added to `beforeEach`
- New describe block: `handleTranscribe — Phase 100 chunked path routing`

| Test | Description | Covers |
|------|-------------|--------|
| T1 | Short clip (10 KB) stays on single-stream; chunked NOT called | D-05 fast-path preserved |
| T2 | Long clip (100 KB) routes to transcribeBufferChunked with correct args | D-06 chunked routing |
| T3 | transcribeBufferChunked AccessDenied → 503 fixed shape | D-12 catch block reuse |
| T4 | transcribeBufferChunked generic error → 502 fixed shape | D-12 catch block reuse |
| T5 | Slash-transform fires on chunked-path output (`slash gsd status` → `/gsd status`) | D-13 preservation |
| T6 | mkdir + writeFile called, mkdir before transcribeBufferChunked (invocationCallOrder) | D-14 ordering preserved |

## Acceptance Criteria Verification

| Criterion | Result |
|-----------|--------|
| `import { transcribeBufferChunked }` in voice.ts | 1 match (line 18) |
| `export const CHUNKED_THRESHOLD_BYTES = 80_000` | 1 match (line 44) |
| `transcribeBufferChunked(` call count | 1 (inside branch) |
| `transcribeBuffer(` preserved | 1 (short-clip branch) |
| `CHUNKED_THRESHOLD_BYTES` usage count | 4 (declaration + 2× branch condition + log) |
| `voice_transcribe_bank_write` log op present | 2 (info + warn fallback, both pre-existing) |
| `applyServerSlashTransform` present | 3 (import + call + comment, all pre-existing) |
| `res.status(200).json({ text` count | 2 (transformedText path + raw-transcript path) |
| All 30 tests green | PASS — 30 passed, 0 failed |
| Wave 1+2 tests green | PASS — 194/194 voice module tests pass |
| `npx tsc --noEmit` | CLEAN — zero errors |

## TDD Gate Compliance

- **RED commit:** `39549891` — `test(100-04): add failing tests for fast-path gate and chunked-path routing (RED)` — 4 tests failed as expected (T2, T3, T5, T6)
- **GREEN commit:** `40be4910` — `feat(100-04): wire fast-path gate in handleTranscribe → chunked orchestrator (GREEN)` — all 30 tests pass

## Deviations from Plan

None — plan executed exactly as written. The diff is confined to the four locations specified in the plan: import block, constants block, branch inside handleTranscribe's try-block, and the log line update.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. The `path=chunked|single` log field is server-side diagnostic only (no client leak, T-100-04-01 accepted). D-14/D-13/D-12 preservation verified by grep + tests.

## Known Stubs

None.

## Self-Check

- [x] `src/backend/database/routes/voice.ts` modified — verified via `git show HEAD`
- [x] `src/backend/database/routes/voice.test.ts` modified — verified via `git show HEAD~1`
- [x] RED commit `39549891` exists in git log
- [x] GREEN commit `40be4910` exists in git log
- [x] 30 tests all green

## Self-Check: PASSED

---

**READY FOR DEPLOY**

Files the orchestrator will need to push (all changes under the voice pipeline):

- `src/backend/database/routes/voice.ts` — contains the fast-path gate (this plan)
- `src/backend/database/routes/voice.test.ts` — extended test suite (this plan)
- `src/backend/voice/transcribe-orchestrator.ts` — chunked orchestrator (Plan 03)
- `src/backend/voice/transcribe-adapter.ts` — extended with `transcribeBufferWithItems` (Plan 03)
- `src/backend/voice/audio-chunker.ts` — ffprobe/silencedetect chunker (Plan 01)
- `src/backend/voice/word-stitcher.ts` — overlap-dedup stitcher (Plan 02)
- `src/backend/voice/semaphore.ts` — concurrency semaphore (Plan 01)
