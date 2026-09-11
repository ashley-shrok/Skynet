# Phase 100: STT chunked parallel streaming — Context

**Gathered:** 2026-09-10
**Status:** Ready for planning
**Source:** Follow-up to Phase 98 more-versatile-stt-tts-support. Motivated by Alice UAT 2026-09-10 (STT wall time ~= audio duration on Amazon Transcribe streaming, felt slow vs the old Chatterbox GPU rig). Verified via research (AWS SDK ships `apply_realtime_delay()` — the streaming API is designed for live mics, not batch upload) and validated via direct benchmark against t1000's Transcribe endpoint (3 s clip → 0.8 s wall, 8 s → 3.6 s, 15 s → 8.8 s, 30 s → 17.8 s — short streams get faster-than-realtime treatment, long streams throttle to ~1.7× real-time).

<domain>
## Phase Boundary

Refactor `handleTranscribe` in `src/backend/database/routes/voice.ts` so that longer voice recordings dispatch as multiple parallel Amazon Transcribe streaming sessions instead of a single sequential one. Stitch the per-chunk transcripts back into a single string using AWS's word-level timestamps. Target 5–10× speedup for clips ≥ 10 s.

**What this phase changes:**
- Server-side chunker (silence-aware with fixed-window fallback) inside `voice.ts` / new adapter module
- Parallel-stream dispatcher with a concurrency semaphore, bounded well below AWS's 25-stream default account quota
- Word-timestamp-driven stitcher that dedupes overlap regions
- Threshold gate: clips shorter than ~10 s take the existing single-stream path (no chunking overhead)

**What this phase does NOT change:**
- `/voice/transcribe` endpoint contract — same multipart WebM in, same `{text}` JSON out, same slash-command-transform still runs on the final stitched transcript
- Frontend: no `useVoiceRecording` changes, no compose-box changes, no new WebSocket, no progressive-transcript UI
- Provider: still Amazon Transcribe streaming, still `us-east-1`, still IMDS creds via SDK default chain (Phase 98 locks)
- The disk-bank write of the raw WebM (Pitfall 6 from Phase 98 — Alice's post-hoc reference folder)
- Chatterbox: still killed, no dual-provider seam

**Scope anchor:** the visible effect for Alice is "STT roundtrip is 5-10× faster for longer recordings." That's it. No UX-affecting change; no new features; no frontend touched.

</domain>

<decisions>
## Implementation Decisions

### Chunking strategy

- **D-01:** Silence-aware splitting via `ffmpeg silencedetect` as the primary strategy. Pre-scan the audio for silence gaps ≥ ~200 ms and split at the nearest gap to the target window boundary. Alice 2026-09-10 chose this over fixed windows for word-boundary preservation at seams — mid-word cuts show up in transcripts as obvious junk ("we-" | "-nt to the store") and silence detection eliminates most of that class.
- **D-02:** Fixed-window fallback. If `silencedetect` returns no gaps within the target window (continuous speech), cut at fixed 8 s (with overlap — see D-04). Ensures the chunker always produces a split; degrades gracefully on rapid speech / no-pause monologues.
- **D-03:** Target chunk size ~8 s. Rationale from benchmark: 8 s clip returns in 3.6 s single-stream (2.25× real-time on short-stream path), so parallel 8 s chunks should each return in ~3.5 s wall time regardless of total audio length. Planner may tune this within 5–10 s if evidence warrants.
- **D-04:** Overlap 2–3 s per chunk boundary. Enough for the stitcher to find matching word runs on both sides of the seam; not so much that we blow the concurrent-stream budget on redundant transcription. Planner picks the exact value.

### Fast-path threshold for short clips

- **D-05:** Clips shorter than ~10 s take the EXISTING single-stream path (current `handleTranscribe` code path — one `transcribeBuffer(flacBuf, "flac", 16000)` call, no chunking). Alice 2026-09-10 verbatim chose this over uniform chunking. Rationale: benchmark shows 3 s → 0.8 s and 8 s → 3.6 s on single-stream already, and adding ~300 ms of orchestration tax to those makes UX worse. Chunking is only beneficial when there's actually audio to parallelize across.
- **D-06:** Threshold value is ~10 s (planner picks exact cutoff; anywhere in 8–12 s is fine). Decision point could be audio duration (from ffprobe pre-scan) OR audio bytes as a proxy (16 kHz mono FLAC → ~32 KB/s, so ~320 KB = 10 s). Planner picks based on what's cheapest to compute.

### Failure handling on individual chunk failure

- **D-07:** Retry once, then insert a marked gap. If a per-chunk Transcribe stream fails (network error, transient 5xx, timeout), retry that ONE chunk exactly once. If the retry also fails, stitch the remaining chunks into the transcript and insert a placeholder token like `[...]` at the failed chunk's position. Alice 2026-09-10 chose this over silent-skip (dangerous — user might send an incomplete transcript unaware) and full-fail (user-hostile — losing a 3-minute rant to one transient network hiccup).
- **D-08:** The `[...]` marker is the exact placeholder emitted; planner may negotiate the sentinel string if it collides with something reasonable-to-type verbatim, but SOMETHING visible-and-obvious must appear so Alice can see there's a gap and choose to edit or re-record.

### Concurrency limit

- **D-09:** Start conservative at N=5 concurrent streams. Amazon's default quota is 25 concurrent StartStreamTranscription per account per region (see canonical refs). N=5 gives us 4× current throughput (probable common-case improvement) while leaving 20 streams of headroom for future concurrent Skynet users on the same AWS account (T800/Stacy is on a separate account so doesn't compete; but if Alice invites collaborators to her instance later, they share our 25-stream ceiling). Planner may tune upward with justification.
- **D-10:** Semaphore lives in the adapter module, module-level singleton (mirrors the existing `TranscribeStreamingClient` singleton pattern from Phase 98 `transcribe-adapter.ts:93`). No per-request semaphore state; no cross-request coordination required (single Skynet process on t1000).

### Stitching algorithm

- **D-11:** Overlap dedup via longest-common-word-run match on AWS's item-level timestamps. Each Transcribe stream emits `Items` with `StartTime`/`EndTime`/`Content`. For adjacent chunks A and B with configured overlap window W, walk A's tail items and B's head items looking for the longest matching content run; drop it from B's contribution. Planner produces the specific matching algorithm (probably word-content sequence match with tolerance for one-word substitutions, since Transcribe may disambiguate the same audio differently across chunks).

### Response-shape preservation (Claude's Discretion, non-negotiable)

- **D-12:** Response body stays exactly `{text: string, transformed?: string}` (the current shape after Phase 98 `handleTranscribe`). No new fields, no per-chunk metadata leaked to the client, no timing info. Client code must not need to change.
- **D-13:** The existing slash-command wake-word transform still runs on the final stitched transcript. Same code path (`WAKE_WORD_REGEX.test(rawText)` → `fetchSkillCatalog` → `applyServerSlashTransform`), same behavior.
- **D-14:** The existing disk-bank write of the raw WebM (voice.ts:129) still fires BEFORE any transcode / chunk / dispatch happens. Preserves Pitfall 6 (Alice's post-hoc reference folder holds the original bytes even if the transcribe pipeline fails).

### Claude's Discretion

- Exact silence-detection threshold parameters (`silencedetect=n=-40dB:d=0.2` or similar) — planner tunes
- Whether chunks-with-overlap round to nearest silence gap OR always cut at the LATEST silence gap before target — planner picks
- Exact retry timeout / backoff on the D-07 retry — planner picks (default: no backoff, immediate retry — network transients usually resolve; if there's a systemic AWS issue, both attempts fail fast)
- Whether to emit structured logs at per-chunk boundaries (probably yes — matches role file lesson "log with enough context to be actionable in isolation")
- Whether to introduce a new adapter module (e.g., `src/backend/voice/transcribe-orchestrator.ts`) or extend `transcribe-adapter.ts` in-place — planner picks based on file-size tolerance

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Prior phase context (locked decisions inherit)

- `.planning/phases/98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol/98-CONTEXT.md` — Phase 98 locked provider/region/creds/contract; Phase 100 does NOT re-decide those
- `.planning/phases/98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol/98-RESEARCH.md` — AWS SDK patterns, Pitfall list (particularly Pitfall 1 WebM-rejection, Pitfall 3 partial-vs-final filter)
- `.planning/phases/98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol/98-PATTERNS.md` — Existing spawn / adapter shapes (audio-transcode.ts spawn shape from opkssh-auth.ts analog)

### Code being refactored

- `src/backend/database/routes/voice.ts` — the `handleTranscribe` handler + `transcodeForTranscribe` helper (currently defaults to `webmToFlac` per hotfix `a613017b`)
- `src/backend/voice/transcribe-adapter.ts` — the `transcribeBuffer` function + module-level `TranscribeStreamingClient` singleton; new orchestrator module either extends this or lives beside it
- `src/backend/voice/audio-transcode.ts` — `webmToFlac` and `webmToOggOpus` (only `webmToFlac` used in the live handler post-hotfix; `webmToOggOpus` retained but unused)
- `src/backend/database/routes/voice.test.ts` — existing test suite (24 tests, all passing post-hotfix) — Phase 100 additions extend not replace

### AWS docs / quotas

- https://docs.aws.amazon.com/general/latest/gr/transcribe.html — Concurrent streams quota (25 per region per account, adjustable via `L-0599F82B`); StartStreamTranscription TPS (25/sec per region, `L-2B06FDCC`); max stream duration 4 hours
- https://docs.aws.amazon.com/transcribe/latest/APIReference/API_streaming_StartStreamTranscription.html — API surface, `EnablePartialResultsStabilization` and `PartialResultsStability` params
- https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html — Best practices ("Ensure that your stream is as close to real-time as possible") and the guidance that pre-recorded short files may not benefit from streaming
- https://github.com/awslabs/amazon-transcribe-streaming-sdk/blob/develop/amazon_transcribe/utils.py — Reference implementation of `apply_realtime_delay` (documents WHY streaming is designed for live audio)

### Benchmark evidence

- `/tmp/bench.mjs` on skynet container (session-transient — reproducible by re-running with `clip-3s/8s/15s/30s.flac` inputs synthesized from an existing banked recording) — Documents the observed timing floor
- Session transcript (Alice + tabitha, 2026-09-10 06:30-06:35 UTC) — Empirical results table: 3 s → 0.798 s (3.75×); 8 s → 3.562 s (2.25×); 15 s → 8.797 s (1.70×); 30 s → 17.835 s (1.68×); first-event latency consistently 266–335 ms

### Fleet operational rules (Phase 100 respects)

- `~/.claude/roles/box-maintainer/box-maintainer.md` — Test discipline (scoped-during-dev, full-suite as first step of deploy motion), executor scope (code + commit + scoped tests green; deploy is orchestrator territory), container-mutation serialization, no worktrees
- `~/.claude/roles/box-maintainer/box-maintainer.md` § "Skynet DB is in-memory SQLite" — irrelevant for this phase (no DB writes)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`transcribeBuffer` function (transcribe-adapter.ts:142)** — Already handles a single stream cleanly (IsPartial filter, singleton client, error propagation). Chunked path calls this N times in parallel via `Promise.all` under a semaphore.
- **`webmToFlac` (audio-transcode.ts:147)** — Full-transcode WebM → 16 kHz mono FLAC. The chunker probably slices the FLAC output (not the WebM input) — cleaner boundaries and lets us feed already-transcode-processed bytes to Transcribe unchanged.
- **`ffmpeg` binary in Docker Stage 5 image** — Already installed by Phase 98 Plan 01. `silencedetect` filter and `-ss`/`-t` for slicing are stock ffmpeg features; no new image dependencies.
- **`isAwsAccessDenied` guard (aws-errors.ts)** — Existing AccessDenied classifier for the AWS SDK error shape. Chunked path uses it identically — if ANY chunk hits AccessDenied, the whole request goes 503-dark (matches Phase 98 D-Provider-access "off-switch is policy-absence").
- **Disk-bank write pattern (voice.ts:129)** — Fire-and-forget mkdir+writeFile for the raw WebM. Preserved verbatim; runs before the chunker.

### Established Patterns

- **Module-level singleton for AWS SDK clients** — `transcribe-adapter.ts:93` constructs `TranscribeStreamingClient` at import time; `polly-adapter.ts` does the same. New orchestrator module follows this shape (module-level semaphore + module-level singleton client, if a new client is needed at all — probably just reuses the existing `client` export).
- **`for await` on `TranscriptResultStream` with IsPartial filter** — Phase 98's Pitfall 3 (accumulating partials produces hallucinated repeated text). Chunked path applies the same filter per-stream, no cross-stream state.
- **Test double for TranscribeStreamingClient** — `voice.test.ts:60-68` shows how to fake the SDK constructor + `.send()` return shape. Phase 100 tests reuse this mocking pattern; add per-chunk fixtures.

### Integration Points

- **Handler entry (voice.ts:102 `handleTranscribe`)** — The ONLY external caller of the chunker. The chunker is called instead of `transcribeBuffer` directly, when the audio duration exceeds the fast-path threshold.
- **Slash-command transform (voice.ts:160-193)** — Runs on the STITCHED transcript, not per-chunk. No changes to the transform code itself.
- **Log op names** — Phase 100 introduces new structured log ops: `voice_transcribe_chunk_start`, `voice_transcribe_chunk_ok`, `voice_transcribe_chunk_retry`, `voice_transcribe_chunk_failed_gap`, `voice_transcribe_stitch_complete`. Mirrors Phase 98's op-name style.

</code_context>

<specifics>
## Specific Ideas

- **Empirical benchmark drove the design.** Not just user speculation — actual measurements against t1000's Transcribe endpoint at 06:30-06:35 UTC using the shipped `@aws-sdk/client-transcribe-streaming` in the running container. Numbers are reproducible.
- **The `[...]` gap marker (D-08)** — Alice chose visible gap-marking over silent-skip specifically because voice STT feeds an editable input field before send. A gap that renders as `[...]` is a clear editing signal; a silent gap is a data-loss surface.
- **Silence-aware chunking (D-01) is the perception fix** — mid-word cuts have been a recurring frustration in every batch STT UX Alice has used. Even 200 ms of ffmpeg overhead is worth it.

</specifics>

<deferred>
## Deferred Ideas

- **Browser-side WebSocket audio streaming.** Discussed with Alice 2026-09-10 as the OTHER path to faster STT — stream audio from MediaRecorder to Skynet via WebSocket while she's still speaking; server forwards to Transcribe live; partials arrive within ~300 ms. That's a bigger refactor (client + server + progressive-transcript UI) and would touch the frontend. Phase 100 is intentionally backend-only. If perceived latency after Phase 100 still isn't good enough, this becomes a follow-up phase.
- **Progressive transcript output (SSE or chunked HTTP response).** Currently the response is a single JSON blob; a future phase could stream partial transcripts to the client as chunks complete. Not this phase.
- **AWS service quota increase request** (raise from 25 to 100 concurrent streams). Not needed until we hit the ceiling in practice.
- **Multi-language support.** English-US only (inherited from Phase 98 D-Voice-catalog). Not this phase.
- **Provider fallback / dual-provider seam.** Rejected in Phase 98; still rejected. If AWS is down, STT is dark. Not this phase.

</deferred>

---

*Phase: 100-stt-chunked-parallel-streaming*
*Context gathered: 2026-09-10*
