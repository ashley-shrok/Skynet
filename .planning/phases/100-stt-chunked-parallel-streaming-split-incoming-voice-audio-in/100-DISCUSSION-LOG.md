# Phase 100: STT chunked parallel streaming - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-10
**Phase:** 100-stt-chunked-parallel-streaming
**Areas discussed:** Short-clip fast path, Chunking strategy, Failure handling

---

## Short-clip fast path

| Option | Description | Selected |
|--------|-------------|----------|
| 1a | Chunk uniformly — adds ~300 ms orchestration tax to short clips but one code path | |
| 1b | Keep current single-stream path for clips <10 s (empirically snappy already at 0.8-3.6 s), only chunk when parallelism helps | ✓ |

**User's choice:** 1b (via "thumbs up" on tabitha's recommendation)
**Notes:** Tabitha argued from benchmark data — 3 s → 0.8 s and 8 s → 3.6 s on single-stream today; adding chunker overhead to those clips makes UX worse. Ashley concurred.

---

## Chunking strategy

| Option | Description | Selected |
|--------|-------------|----------|
| 2a | Fixed 8 s windows with 2-3 s overlap — simple, predictable, may cut mid-word | |
| 2b | Silence-aware splitting via `ffmpeg silencedetect` with fixed-window fallback when no silence in target window — ~200 ms pre-scan overhead, ~zero mid-word cuts | ✓ |

**User's choice:** 2b (silence-aware with fallback) via thumbs-up
**Notes:** Tabitha argued mid-word cuts at seams show up in transcripts as obvious junk ("we-" | "-nt to the store"). Silence detection eliminates most of that; the fixed-window fallback ensures we always cut. 200 ms pre-scan is nothing next to the wall time we already pay.

---

## Failure handling (one chunk fails)

| Option | Description | Selected |
|--------|-------------|----------|
| 3a | Retry once, then mark gap with `[...]` in the stitched transcript | ✓ |
| 3b | Silent skip — stitch remaining chunks, transcript has an invisible gap | |
| 3c | Fail whole request → 502, user re-records | |

**User's choice:** 3a (retry + marked gap) via thumbs-up
**Notes:** Tabitha's rationale — voice input goes into a text field Ashley reviews before sending. A marked gap tells her "this section didn't transcribe — edit or re-record." Silent skip (3b) is dangerous — she might send an incomplete transcript unaware. Full failure (3c) means losing a 3-min rant to one transient network hiccup, user-hostile.

---

## Claude's Discretion

- Concurrency limit — starting at N=5, well under AWS's 25/account/region quota (D-09 in CONTEXT.md)
- Stitching algorithm — longest-common-word-run match on AWS's item-level timestamps (D-11)
- Exact silence-detection threshold (`silencedetect=n=-40dB:d=0.2` or similar) — planner tunes
- Whether to introduce a new adapter module (`transcribe-orchestrator.ts`) or extend `transcribe-adapter.ts` in-place — planner picks
- Retry timeout / backoff strategy on the D-07 retry — planner picks (default: immediate retry, no backoff)
- Log op naming — tabitha proposed `voice_transcribe_chunk_start/ok/retry/failed_gap/stitch_complete`

## Deferred Ideas

- **Browser-side WebSocket audio streaming** — the bigger UX win (partials during speech; perceived latency ~300 ms) but requires client + server + progressive-transcript UI. Backend-only Phase 100 covers most of the perf gap; WebSocket streaming is a follow-up phase only if Phase 100's speedup isn't enough.
- **Progressive transcript output** (SSE or chunked HTTP response) — future
- **AWS quota increase request** (25 → 100 concurrent streams) — future when we actually hit the ceiling
- **Multi-language support** — inherited English-US only from Phase 98
- **Provider fallback / dual-provider seam** — rejected in Phase 98, still rejected
