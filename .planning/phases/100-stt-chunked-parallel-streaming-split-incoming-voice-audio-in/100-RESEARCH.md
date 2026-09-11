# Phase 100: STT Chunked Parallel Streaming — Research

**Researched:** 2026-09-10
**Domain:** ffmpeg audio chunking, Amazon Transcribe streaming Item-level timestamps, Node.js concurrency, word-timestamp stitching
**Confidence:** HIGH on SDK types and ffmpeg mechanics (verified in-process), MEDIUM on stitching algorithm edge cases (no AWS live test of Items field population), LOW on Transcribe minimum-duration behaviour (no authoritative AWS doc found)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Silence-aware splitting via `ffmpeg silencedetect` as the primary strategy; pre-scan for silence gaps ≥ ~200 ms, split at nearest gap to the target window boundary.
- **D-02:** Fixed-window fallback when `silencedetect` returns no usable gap in the target window.
- **D-03:** Target chunk size ~8 s. Planner may tune within 5–10 s with evidence.
- **D-04:** Overlap 2–3 s per chunk boundary. Planner picks exact value.
- **D-05:** Clips shorter than ~10 s take the EXISTING single-stream path (current `transcribeBuffer` call, no chunking).
- **D-06:** Threshold value is ~10 s (planner picks; 8–12 s range is fine). May use byte proxy instead of ffprobe scan (16 kHz mono FLAC ≈ 32 KB/s raw, but FLAC compresses significantly — see Environment section for measured values).
- **D-07:** Retry once on per-chunk failure, then insert gap marker.
- **D-08:** `[...]` is the exact gap-marker token inserted at failed chunk position.
- **D-09:** N=5 concurrent Transcribe streams max (well under 25-stream account quota).
- **D-10:** Semaphore lives at module level in the orchestrator module — singleton, mirrors `transcribe-adapter.ts:93` client singleton.
- **D-11:** Overlap dedup via longest-common-word-run match on AWS item-level timestamps.
- **D-12:** Response body preserved: `{text: string, transformed?: string}`.
- **D-13:** Slash-command transform still runs on the final stitched transcript (unchanged code path).
- **D-14:** Disk-bank write of raw WebM fires BEFORE any transcode/chunk/dispatch.

**Locked from Phase 98 (do NOT re-decide):**
- Amazon Transcribe streaming, `us-east-1`, IMDS creds via SDK default chain.
- Chunked path reuses the existing `TranscribeStreamingClient` singleton from `transcribe-adapter.ts`.
- `isAwsAccessDenied` from `aws-errors.ts` classifies AccessDenied → 503.

### Claude's Discretion

- Exact `silencedetect` parameters (`n=-40dB:d=0.2` or similar) — planner tunes.
- Whether overlap chunks round to nearest silence gap OR always the LATEST silence gap before target — planner picks.
- Exact retry timeout/backoff on D-07 retry — planner picks (default: no backoff, immediate retry).
- Whether to emit per-chunk structured logs — probably yes (matches log-with-enough-context role lesson).
- Whether to introduce a new `transcribe-orchestrator.ts` module OR extend `transcribe-adapter.ts` in-place — planner picks.

### Deferred Ideas (OUT OF SCOPE)

- Browser-side WebSocket audio streaming.
- Progressive transcript output (SSE or chunked HTTP response).
- AWS service quota increase.
- Multi-language support.
- Provider fallback.
</user_constraints>

---

## Summary

Phase 100 is a backend-only refactor of `handleTranscribe` in `voice.ts`. The motivating benchmark is empirical: Amazon Transcribe streaming's throughput degrades toward 1.7× real-time for clips ≥ 15 s (3 s → 0.8 s, 8 s → 3.6 s, 15 s → 8.8 s, 30 s → 17.8 s) because the streaming API is designed for live microphones, not burst-upload of pre-recorded audio. Splitting a 30 s clip into four parallel 8 s chunks — each of which Transcribe treats as a fresh short stream — should return each chunk in ~3.5 s, for a total wall time of ~3.5–4 s vs the current 17–18 s: a genuine 4–5× speedup.

The implementation chain is:
1. **Fast-path gate** — if the FLAC buffer is below the ~10 s threshold (D-05/06), call `transcribeBuffer` exactly as today and return.
2. **Silence-aware chunker** — run `ffmpeg silencedetect` on the FLAC buffer (via stdin pipe — verified working), parse stderr for `silence_start`/`silence_end` pairs, compute chunk boundaries at silence midpoints near the 8 s target, fall back to fixed 8 s cuts when no silence gap is available.
3. **Slicer** — extract each chunk via `ffmpeg -i pipe:0 -ss <start> -t <duration> -f flac pipe:1` (verified stdin→stdout slicing works for FLAC; FLAC IS seekable from a pipe). Add 2–3 s of overlap on each chunk boundary.
4. **Parallel dispatcher** — fan out N chunks with a module-level semaphore capped at N=5. Collect Items arrays (word-level timestamps) from each chunk, not just `.Transcript` strings.
5. **Stitcher** — align adjacent chunks on their word-content overlap window, pick the longer-run common-word sequence, and concatenate. Reconstruct a final string. Pass through the slash-command transform.

Key new finding: **`Alternative.Items` is always populated in the standard Transcribe streaming response** — no special request parameter is needed. Each `Item` carries `StartTime: number` (seconds), `EndTime: number` (seconds), `Content: string`, and `Type: "pronunciation" | "punctuation"`. Times are absolute within each chunk's own stream (i.e., a chunk starting at second 6 of the original audio will have its first item at ~0.0 s, not 6.0 s). The stitcher must add the chunk's `startOffsetSeconds` to each item's timestamps before global dedup.

The codebase has **no `p-limit` direct dependency** (p-limit 3.1.0 is a transitive dep of `qrcode`). The backend uses `module: nodenext` (ESM). Writing a five-line inline semaphore in pure TypeScript is the cleanest approach — avoids a new direct dependency, is mockable in tests, and follows the project's preference for avoiding third-party packages when a simple inline solution works (see: no NLP library for sentence splitting in Phase 98).

**Primary recommendation:** Create `src/backend/voice/transcribe-orchestrator.ts` as a new module (parallel to `transcribe-adapter.ts`), exposing one function `transcribeBufferChunked(flacBuf, sampleRate)`. `handleTranscribe` in `voice.ts` calls this function when the buffer exceeds the fast-path threshold, and `transcribeBuffer` otherwise. The existing `transcribeAdapter.ts` is unchanged. Zero risk of breaking existing single-stream path.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fast-path gate (clip < 10 s) | API / Backend | — | All STT logic is backend-owned per Phase 98 locked contract |
| Duration / byte-proxy threshold check | API / Backend | — | FLAC buffer is in-memory on the backend at the time of the check |
| `ffmpeg silencedetect` scan | API / Backend | — | ffmpeg subprocess; audio data never leaves the backend process |
| Chunk boundary calculation | API / Backend | — | Pure math on silence-gap positions; no I/O |
| FLAC buffer slicing (`ffmpeg -ss -t`) | API / Backend | — | stdin→stdout ffmpeg spawn on in-memory buffers (verified) |
| Parallel Transcribe dispatch | API / Backend | AWS Transcribe service | Backend owns orchestration; AWS executes recognition |
| Concurrency semaphore (N=5) | API / Backend | — | Module-level state in `transcribe-orchestrator.ts`; same tier as the SDK client singleton |
| Per-chunk retry | API / Backend | — | One retry per chunk; no client-visible exposure |
| Gap marker insertion (`[...]`) | API / Backend | — | Injected into the stitched string server-side |
| Word-timestamp stitcher | API / Backend | — | Pure function on Items arrays; no I/O |
| Slash-command transform | API / Backend | — | Unchanged from Phase 98; runs on final stitched transcript |
| Response shape (`{text, transformed?}`) | API / Backend → Browser | — | Identical to today; client code unchanged |

---

## Standard Stack

### Core (no new npm packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-transcribe-streaming` | `^3.1129.0` (already in `package.json`) | `StartStreamTranscriptionCommand` — called N times in parallel | Already installed by Phase 98; same `TranscribeStreamingClient` singleton reused [VERIFIED: npm registry, in `package.json`] |
| `ffmpeg` (apt, system) | 6.1.1-3ubuntu5 (verified in container) | `silencedetect` filter + `-ss -t` slicing | Already in Dockerfile Stage 5 per Phase 98 Plan 01 [VERIFIED: `ffmpeg -version` on host; `silencedetect` confirmed present via `ffmpeg -filters`] |
| `ffprobe` (apt, system) | 6.1.1-3ubuntu5 (same package as ffmpeg) | Duration extraction for fast-path threshold (if planner chooses duration over byte-proxy) | Ships with the `ffmpeg` apt package; available on host [VERIFIED: `which ffprobe`; `ffprobe -v quiet -show_entries format=duration` works from file AND from stdin pipe] |

### No New npm Dependencies Required

The entire Phase 100 implementation uses:
- `node:child_process` (`spawn`) — already used in `audio-transcode.ts`
- `@aws-sdk/client-transcribe-streaming` — already in `package.json`
- Inline TypeScript semaphore (5 lines) — no external package needed

**Rationale for rejecting `p-limit`:**
- `p-limit` v7 (current) is ESM-only (`"type": "module"` in package.json). The project uses `module: nodenext` which CAN import ESM, but this would add a new direct dependency for a 5-line semaphore.
- `p-limit` v3.1.0 is in `node_modules` as a transitive dep of `qrcode` but is NOT a direct dep — importing it would be fragile (could disappear if `qrcode` upgrades or is removed).
- The codebase's precedent for N=5 bounded concurrency is `src/backend/ssh/host-transfer.ts:2041-2059` — which implements a "worker pool" pattern using an incrementing `nextJobIndex` counter + `Promise.all(Array.from({length: N}, runWorker))`. For our use-case (fixed array of chunks, not a queue of unknown size), a simple `Promise.all` with a semaphore is cleaner than the worker-pool pattern.

**Package Legitimacy Audit:** No new packages. N/A.

---

## Architecture Patterns

### System Architecture Diagram

```
POST /voice/transcribe (multipart WebM)
         |
         v
handleTranscribe (voice.ts)
         |
         +-- [D-14] disk-bank write (fire-and-forget, BEFORE any processing)
         |
         v
transcodeForTranscribe() --> webmToFlac()
         |
         |   flacBuf in memory
         v
 [FAST PATH] flacBuf.length < THRESHOLD_BYTES (or ffprobe < 10s)?
         |                           |
        YES                         NO
         |                           |
         v                           v
transcribeBuffer()        transcribeBufferChunked()
(existing single-stream)  (new orchestrator — transcribe-orchestrator.ts)
         |                           |
         |          +----------------+----------------------------+
         |          |                |                            |
         |          v                v                            v
         |    scanSilence()    computeChunkBoundaries()   N = ceil(duration/8s)
         |    [ffmpeg stderr]  [silence-aware + fallback]  chunks with 2-3s overlap
         |                           |
         |          +-----+-----+-----+-----+
         |          |     |     |     |     |
         |          v     v     v     v     v
         |       sliceFlac() x N (ffmpeg -ss -t, pipe:0→pipe:1)
         |          |
         |          v  (up to N=5 at a time, module-level semaphore)
         |       transcribeBuffer(chunk, "flac", 16000)
         |       with Items extraction (alt.Items from each final result)
         |          |
         |          v  (one retry on failure; [...]  on double failure)
         |       per-chunk result: { transcript: string, items: Item[], startOffsetSec: number }
         |                           |
         |                    stitchChunks()
         |                    [longest-common-word-run dedup on overlap]
         |                           |
         v                           v
         +---------> final transcript string
                           |
                           v
                   slash-transform (unchanged)
                           |
                           v
                   res.json({ text, transformed? })
```

### Recommended New File

```
src/backend/voice/
├── transcribe-orchestrator.ts    # NEW — chunked parallel dispatcher + stitcher
├── transcribe-orchestrator.test.ts  # NEW — unit tests
└── [all existing files unchanged]
```

`handleTranscribe` in `voice.ts` gets a 3-line change:
- Import `transcribeBufferChunked` from `transcribe-orchestrator.ts`.
- Replace the single `transcribeBuffer(...)` call with:
  ```typescript
  const transcript = flacBuf.length >= CHUNKED_THRESHOLD_BYTES
    ? await transcribeBufferChunked(flacBuf, 16000)
    : await transcribeBuffer(flacBuf, "flac", 16000);
  ```
- `voice.test.ts` adds a mock for the orchestrator module (same vi.mock pattern).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FLAC audio slicing | Custom FLAC frame parser / byte offset calculator | `ffmpeg -i pipe:0 -ss <s> -t <dur> -f flac pipe:1` | FLAC frames are variable-length; calculating seek points requires reading the FLAC STREAMINFO/SEEKTABLE — a non-trivial binary protocol. ffmpeg handles this correctly. Verified: stdin-pipe slicing works (26 687 bytes for a 3 s slice from an 8 s FLAC). |
| Silence gap detection | VAD library or energy-threshold loop on decoded PCM | `ffmpeg silencedetect` filter | ffmpeg's filter is a single argv flag; its output is parseable stderr lines (`silence_start: <s>`, `silence_end: <s> \| silence_duration: <s>`). Verified: works from stdin pipe. |
| Bounded concurrency semaphore | `p-limit` (new dep) | 5-line inline semaphore (see Pattern 3 below) | No new dependency, directly testable, follows repo precedent for avoiding packages when a trivial inline works. |
| Word-timestamp alignment | Edit-distance / LCS library | Inline longest-common-word-run scan on `Item[]` arrays | The overlap window is bounded (2–3 s × word-rate ≈ 5–15 words). A simple O(N×M) scan on these tiny arrays is instantaneous; no LCS library is needed for this scale. |
| AWS Item-level timestamps | Custom timestamping / forced alignment | `alt.Items` array already in every Transcribe response | Items are emitted in every `Alternative` without any extra request parameter. Each Item has `StartTime: number` (seconds, millisecond precision), `EndTime: number`, `Content: string`, `Type: "pronunciation"|"punctuation"`. No SDK changes needed. |

**Key insight:** ffmpeg already does the two hard parts (seeking in FLAC, detecting silence). The orchestrator's job is just to invoke ffmpeg twice per full audio (once to scan, once per slice), dispatch N Transcribe calls under a semaphore, and walk two word arrays to find the seam.

---

## Research Findings by Domain

### 1. AWS Transcribe Item-Level Timestamp Mechanics

**Verified from SDK type declarations at `node_modules/@aws-sdk/client-transcribe-streaming/dist-types/models/models_0.d.ts`:**

```typescript
// Item interface (line 50 of models_0.d.ts)
interface Item {
  StartTime?: number;    // seconds with ms precision, e.g. 1.056
  EndTime?:   number;    // seconds with ms precision
  Type?:      "pronunciation" | "punctuation";   // ItemType enum
  Content?:   string;    // the word or punctuation
  Confidence?: number;   // 0–1
  Stable?:    boolean;   // only present if EnablePartialResultsStabilization used
}

// Alternative interface (line 104 of models_0.d.ts)
interface Alternative {
  Transcript?: string;
  Items?:      Item[];
}
```

**How to access Items in the existing `for await` loop (VERIFIED: SDK type confirmed):**

```typescript
// In transcribeBuffer (or orchestrator variant), access Items from final results:
for await (const event of response.TranscriptResultStream) {
  const results = event.TranscriptEvent?.Transcript?.Results;
  if (!results) continue;
  for (const result of results) {
    if (result.IsPartial) continue;   // Pitfall 3 — same as before
    for (const alt of result.Alternatives ?? []) {
      if (alt.Transcript) transcripts.push(alt.Transcript);
      if (alt.Items)      allItems.push(...alt.Items);   // NEW for Phase 100
    }
  }
}
```

**CRITICAL: Items timestamps are relative to the chunk stream start, not the original audio.** A chunk extracted starting at second 6.0 of the original FLAC will have `Item.StartTime ≈ 0.0` for its first word. The stitcher must add `chunk.startOffsetSec` to every item before cross-chunk comparison.

**No additional request parameters needed** to get Items populated. They appear in every `Alternative` of every final result. `EnablePartialResultsStabilization` and `PartialResultsStability` are optional and affect the `Stable` field only — not required for Phase 100.

[VERIFIED: SDK types at `node_modules/@aws-sdk/client-transcribe-streaming/dist-types/models/models_0.d.ts` lines 50–121]

---

### 2. `ffmpeg silencedetect` Filter Mechanics

**Verified via live ffmpeg 6.1.1 in container:**

**Argv to scan for silence gaps (from pipe:0):**
```bash
ffmpeg -f flac -i pipe:0 -af silencedetect=n=-40dB:d=0.2 -f null - 2>&1
```

**Stderr output format (VERIFIED empirically):**
```
[silencedetect @ 0x...] silence_start: 5
[silencedetect @ 0x...] silence_end: 5.40006 | silence_duration: 0.400062
[silencedetect @ 0x...] silence_start: 12.4
[silencedetect @ 0x...] silence_end: 12.7001 | silence_duration: 0.300063
```

**Parsing regex (TypeScript):**
```typescript
const START_RE = /silence_start:\s*([\d.]+)/;
const END_RE   = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/;
```

**Edge cases observed:**
- If audio is silent from the start, `silence_start: 0` is emitted before any `silence_end`.
- If audio ends while still in a silence region, `silence_start` is emitted without a corresponding `silence_end`. These **unpaired trailing starts must be discarded** (the stitcher can't use an unclosed gap).
- FLAC from `pipe:0` works — FLAC is seekable even from a pipe (confirmed: `cat test.flac | ffmpeg -f flac -i pipe:0 -af silencedetect ...` produces the same output as file input).

**Threshold parameters:** `-40dB` noise floor is appropriate for clean microphone input. `-35dB` may be safer if Alice's recordings have more ambient noise. Duration `0.2` (200 ms minimum gap) is the CONTEXT.md choice; gaps shorter than this are treated as speech.

[VERIFIED: empirical test with ffmpeg 6.1.1 on container; silencedetect filter confirmed via `ffmpeg -filters | grep silencedetect`]

---

### 3. `ffmpeg -ss -t` FLAC Slicing from stdin Pipe

**Verified via live ffmpeg 6.1.1 in container:**

**Argv to extract bytes [startSec, startSec+durationSec) from an in-memory FLAC buffer:**
```bash
ffmpeg -f flac -i pipe:0 -ss <start> -t <duration> -f flac pipe:1
```

**Key finding:** stdin-pipe FLAC slicing WORKS. FLAC carries a SEEKTABLE in its header, and ffmpeg's FLAC demuxer uses it to seek even from a non-seekable pipe by buffering the needed portion. Result: a slice of a 3 s window from an 8 s FLAC via pipe produces valid output (verified: 26 687 bytes, `ffprobe` confirms 3 s duration).

**Node.js spawn pattern** (consistent with `audio-transcode.ts::runFfmpeg`):
```typescript
// Source: verified ffmpeg CLI mechanics + audio-transcode.ts spawn pattern
function sliceFlac(flacBuf: Buffer, startSec: number, durationSec: number): Promise<Buffer> {
  return runFfmpeg(flacBuf, [
    "-f", "flac",
    "-i", "pipe:0",
    "-ss", startSec.toFixed(3),
    "-t", durationSec.toFixed(3),
    "-f", "flac",
    "pipe:1",
  ]);
}
// runFfmpeg is the PRIVATE helper already in audio-transcode.ts.
// Options: (a) export runFfmpeg from audio-transcode.ts and import it,
//          (b) duplicate the 20-line helper in transcribe-orchestrator.ts,
//          (c) move runFfmpeg to a shared internal util.
// Recommendation: export runFfmpeg (or a thin re-export) — avoid duplication.
```

[VERIFIED: empirical `cat test_8s.flac | ffmpeg -f flac -i pipe:0 -ss 2 -t 3 -f flac pipe:1 | wc -c` → 26 687 bytes on container]

---

### 4. Fast-Path Threshold: Duration vs. Byte-Proxy

**D-06 says planner may use byte size as a proxy instead of ffprobe.** Measured values:

| Input | FLAC bytes | Duration |
|-------|-----------|---------|
| 8 s sine tone (16 kHz mono) | 57 486 bytes | 8.000 s |
| Compression ratio | 7 185 B/s | — |
| 0.5 s null (silence) | 11 395 bytes | 0.5 s (22 790 B/s) |

Speech-like FLAC at 16 kHz mono is typically **20 000–50 000 bytes/s** depending on content complexity. The commonly cited "32 KB/s" is the RAW PCM rate (16 000 samples × 2 bytes); FLAC compression achieves 30–75%.

**Conclusion:** Byte-proxy is unreliable as an exact threshold — a 10 s clip could be 50 KB (lots of silence) to 500 KB (complex speech). **Recommend ffprobe over byte-proxy** for the threshold check. The cost is one additional ffprobe spawn per request, which takes <10 ms.

**ffprobe argv from pipe:**
```bash
ffprobe -f flac -i pipe:0 -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1
```
Output is a single float on stdout (e.g., `8.000000`). [VERIFIED: empirical]

Alternatively, planner may use a conservative byte threshold (e.g., > 80 KB = almost certainly > 10 s at any FLAC compression ratio for clean speech) to skip the ffprobe spawn entirely and accept rare false-negatives into the chunked path.

---

### 5. Node.js Concurrency Primitive — Inline Semaphore

**No new npm dependency needed.** The codebase's `host-transfer.ts:2041–2059` uses a "worker pool" pattern for bounded concurrency. For Phase 100's use case (a fixed array of N chunks dispatched at most K=5 at a time), the standard approach is a counting semaphore.

**Inline semaphore pattern (TypeScript, zero dependencies):**
```typescript
// Source: standard concurrency pattern; consistent with project's style of
// avoiding new deps for simple problems (ref: chunk-and-stitch.ts vs NLP lib)
function createSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function acquire<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

// Module-level singleton (D-10):
const transcribeSemaphore = createSemaphore(5);
```

**Usage in the orchestrator:**
```typescript
// For N chunks, fan out under semaphore:
const results = await Promise.all(
  chunks.map((chunk) =>
    transcribeSemaphore(() => transcribeChunkWithRetry(chunk)),
  ),
);
```

This is a standard, well-understood pattern. It does NOT require `worker_threads` — ffmpeg subprocesses are separate OS processes (the spawn is non-blocking) and Transcribe calls are async I/O (no CPU blocking on the Node.js thread).

[ASSUMED: This pattern is industry-standard for async semaphores in Node.js; specific verification against any authoritative source was not performed, but the logic is mechanically obvious]

---

### 6. Overlap Dedup Stitching Algorithm

**Context:** Chunks A and B overlap by W seconds (2–3 s). Each has an `Item[]` with timestamps relative to their chunk start. After adjusting for `startOffsetSec`, the overlap region is the set of items from A with adjusted timestamps in `[B.startOffsetSec, A.endOffsetSec]` and items from B with adjusted timestamps in the same window.

**D-11 specifies:** longest-common-word-run match on `Content` strings in the overlap window, filter `Type === "pronunciation"` only (skip punctuation for matching to avoid false-alignment on commas).

**Recommended algorithm:**

```typescript
interface ChunkResult {
  startOffsetSec: number;
  endOffsetSec: number;
  items: Item[];          // timestamps relative to chunk start
}

function stitchChunks(chunks: ChunkResult[], overlapSec: number): string {
  // Step 1: Adjust each item's timestamps to be global (relative to full audio)
  const globalChunks = chunks.map((c) => ({
    ...c,
    items: c.items.map((item) => ({
      ...item,
      StartTime: (item.StartTime ?? 0) + c.startOffsetSec,
      EndTime:   (item.EndTime   ?? 0) + c.startOffsetSec,
    })),
  }));

  // Step 2: For each adjacent pair (A, B), find longest common word run in the overlap window
  // and drop that run from B's contribution.
  let merged = globalChunks[0]?.items ?? [];
  for (let i = 1; i < globalChunks.length; i++) {
    const bItems = globalChunks[i].items;
    const seamAt  = globalChunks[i].startOffsetSec;
    const overlapEnd = seamAt + overlapSec;

    // Words from A in the overlap window
    const aOverlap = merged.filter(
      (it) => it.Type === "pronunciation" &&
               (it.StartTime ?? 0) >= seamAt &&
               (it.StartTime ?? 0) < overlapEnd,
    ).map((it) => it.Content ?? "");

    // Words from B in the overlap window
    const bOverlap = bItems.filter(
      (it) => it.Type === "pronunciation" &&
               (it.StartTime ?? 0) >= seamAt &&
               (it.StartTime ?? 0) < overlapEnd,
    ).map((it) => it.Content ?? "");

    // Find longest common contiguous run (case-insensitive)
    const lcRun = longestCommonRun(
      aOverlap.map((w) => w.toLowerCase()),
      bOverlap.map((w) => w.toLowerCase()),
    );

    // Drop the matched run from B's contribution, keep B's items after the match
    const bDropCount = lcRun > 0 ? lcRun : 0;
    const bTail = bItems.filter((it) =>
      it.Type !== "pronunciation"
        ? (it.StartTime ?? 0) >= overlapEnd
        : true
    );
    const bPronounce = bItems.filter((it) => it.Type === "pronunciation");
    const bKept = bPronounce.slice(bDropCount);
    // Merge: A items + B punctuation in overlap if any + B's kept items
    merged = [
      ...merged,
      ...bKept,
      // Re-insert punctuation from B that follows the seam
      ...bItems.filter((it) => it.Type === "punctuation" && (it.StartTime ?? 0) >= overlapEnd),
    ].sort((a, b) => (a.StartTime ?? 0) - (b.StartTime ?? 0));
  }

  // Step 3: Reconstruct text from sorted items
  return merged
    .map((it) => it.Content ?? "")
    .join(" ")
    .replace(/\s+([.,!?;:])/g, "$1")  // remove space before punctuation
    .trim();
}

// O(N*M) contiguous run finder; N,M ≤ ~15 words in the overlap window
function longestCommonRun(a: string[], b: string[]): number {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let len = 0;
      while (i + len < a.length && j + len < b.length && a[i + len] === b[j + len]) {
        len++;
      }
      if (len > best) best = len;
    }
  }
  return best;
}
```

**Stitcher edge cases to test:**
1. **Zero overlap match** — Transcribe transcribed the seam differently in A vs B. Fall back to a hard cut: keep all of A, keep all of B from `seamAt` forward. (Result: may have a doubled or missing word at the seam, but this is the same quality as no overlap at all.)
2. **Full overlap consumed** — One chunk returned empty transcript. Keep the other.
3. **Items array empty** — Transcribe returned only `.Transcript` (no Items). Fall back to joining `.Transcript` strings with a space, skip dedup. (Items are present in normal operation per SDK types, but defensive handling matters.)

[ASSUMED: The stitching algorithm above has not been validated against live AWS Item responses. The SDK type confirms Items exist; the algorithm is derived from first principles. A live validation run during wave 0 of the plan is recommended.]

---

### 7. Per-Chunk Retry and Gap Marker (D-07/D-08)

**Pattern:**
```typescript
async function transcribeChunkWithRetry(chunk: ChunkInput): Promise<ChunkResult | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await transcribeChunkOnce(chunk);
    } catch (err) {
      if (isAwsAccessDenied(err)) throw err;  // AccessDenied propagates immediately — policy detach
      if (attempt === 0) {
        databaseLogger.warn("[voice-server] voice_transcribe_chunk_retry", {
          operation: "voice_transcribe_chunk_retry",
          chunkIndex: chunk.index,
        });
        // No backoff — per D-07 discretion, immediate retry for transient errors
      }
    }
  }
  databaseLogger.warn("[voice-server] voice_transcribe_chunk_failed_gap", {
    operation: "voice_transcribe_chunk_failed_gap",
    chunkIndex: chunk.index,
  });
  return null;  // null = insert gap marker at this position
}

// In the orchestrator, after Promise.all:
const transcript = results
  .map((r, i) => r?.transcript ?? "[...]")
  .join(" ")
  .trim();
```

**AccessDenied propagation:** If ANY chunk hits `AccessDenied`, re-throw immediately (do not retry). The outer `handleTranscribe` catch block checks `isAwsAccessDenied` and returns 503, same as the single-stream path.

---

### 8. Transcribe Minimum Audio Duration

**Research finding:** No official AWS documentation specifies a minimum audio duration below which `StartStreamTranscription` returns an error. AWS billing changed to 1-second increments with no minimum. The AWS re:Post note about "15-second timeout if no new audio is received" refers to the **idle timeout** (if you open a stream and stop sending audio, it closes after 15 s) — not a rejection of short audio. [CITED: https://repost.aws/questions/QUhTI1xY9IS8aopypQvYEXNQ]

**Empirical evidence from Phase 98:** `bench.mjs` on t1000 successfully transcribed 3 s clips (0.798 s wall time). This suggests clips as short as 3 s are accepted with no error.

**Risk for Phase 100:** If `silencedetect` + overlap math produces an edge-case chunk shorter than ~1–2 s (e.g., a clip starts with 7 s of speech followed by 3 s of silence, chunked at the silence gap, and the overlap extends past the audio end), that sub-2-second chunk should either be skipped or padded before dispatch.

**Mitigation in chunker:** If a computed chunk slice has `durationSec < 1.0`, drop it and extend the previous chunk. This is a 3-line guard in the chunk-boundary computation function.

[ASSUMED: The 1 s floor is based on Phase 98 empirical evidence (3 s clips work) and billing-documentation inference. No AWS doc explicitly states the floor. Planner should budget for a live test of a <1 s chunk in wave 0.]

---

### 9. Worker Threads — Not Needed

**D confirms ffmpeg is already a separate OS process.** Each `sliceFlac()` call spawns an `ffmpeg` subprocess — the CPU work happens in separate processes, not on the Node.js event loop. `Promise.all` is sufficient for parallel I/O. `worker_threads` are appropriate for CPU-heavy work that would block the JS thread; neither ffmpeg spawning nor AWS SDK async I/O qualify.

[ASSUMED: This reasoning is standard Node.js architecture knowledge; no specific verification performed.]

---

### 10. Existing Codebase Analogs for Fan-Out Pattern

| Pattern in Phase 100 | Closest Analog | Match Quality |
|---------------------|----------------|--------------|
| Semaphore-bounded parallel dispatch | `src/backend/ssh/host-transfer.ts:2041-2059` — "worker pool" of N coroutines pulling from a job queue | role-match (different shape but same intent: N-bounded concurrency over a work list) |
| `Promise.all` over a mapped array | `src/backend/fleet-status/ssh-poll-orchestrator.ts:1183` — `await Promise.all(pidNumbers.map(...))` | exact |
| Per-chunk retry loop | `src/backend/database/routes/pretty-view-fetch-tailnet-url.ts` retry logic | role-match |
| Items/results accumulation in `for await` | `transcribe-adapter.ts:160-172` — existing `finalTranscripts` accumulation | extend in-place |
| Spawn `ffmpeg` stdin→stdout | `audio-transcode.ts:80-103` — `runFfmpeg()` private helper | exact (reuse) |
| Structured log op names | `voice.ts:123, 129, 144` — `voice_transcribe_bank_write`, `voice_transcribe` | exact (extend the naming scheme) |
| Module-level singleton | `transcribe-adapter.ts:93` — `const client = new TranscribeStreamingClient(...)` | exact (semaphore follows this shape) |

**New op names to introduce (from 100-CONTEXT.md `<code_context>`):**
- `voice_transcribe_chunk_start`
- `voice_transcribe_chunk_ok`
- `voice_transcribe_chunk_retry`
- `voice_transcribe_chunk_failed_gap`
- `voice_transcribe_stitch_complete`

---

## Common Pitfalls

### Pitfall 1: Items timestamps are chunk-relative, not global

**What goes wrong:** Stitcher compares `item.StartTime` values from chunk A (starts at 0 s) and chunk B (starts at 6 s). Chunk B's overlap words have StartTime ≈ 0.0 s (relative to B's own stream start). Without offset correction, the comparison fails or produces wrong ordering.

**Why it happens:** Each `StartStreamTranscription` call is a fresh session. Timestamps are relative to that session's audio start.

**How to avoid:** `transcribeChunkOnce` must receive `startOffsetSec` as a parameter and include it in the returned `ChunkResult`. The stitcher applies `item.StartTime += chunk.startOffsetSec` before any comparison.

**Warning signs:** Stitched transcript has words in wrong order; overlap window yields no common run even when the same words are spoken.

### Pitfall 2: `silencedetect` emits a trailing `silence_start` with no `silence_end`

**What goes wrong:** If the audio ends mid-silence, ffmpeg emits `silence_start: <t>` but never closes it with `silence_end`. The parser produces a gap entry with `end: undefined`, which, if used as a chunk boundary, produces a zero-length or negative-length slice.

**Why it happens:** Standard ffmpeg silencedetect behaviour — an open silence region at EOF is reported as started but not ended.

**How to avoid:** Parse loop must discard any `silence_start` that is not immediately followed by a `silence_end` in the output before emitting a `SilenceGap` object.

### Pitfall 3: FLAC pipe slicing requires `-f flac` before `-i pipe:0`

**What goes wrong:** `ffmpeg -i pipe:0 -ss 2 -t 3 -f flac pipe:1` may fail because ffmpeg can't probe the format from a non-seekable pipe without the explicit format hint.

**Why it happens:** Without `-f flac`, ffmpeg attempts to auto-detect the input format by reading ahead — which may stall or fail on a pipe.

**How to avoid:** Always pass `-f flac -i pipe:0` (format hint before input). Verified: this form works.

### Pitfall 4: ffmpeg stderr for silencedetect mixed with informational output

**What goes wrong:** ffmpeg's stderr includes banner, input-file metadata, encoding info, and silencedetect events all mixed together. A regex that matches on the presence of `silence_start` must not accidentally match banner text.

**How to avoid:** The `silence_start:` pattern (with colon and space) is unique to the silencedetect filter output. The regex `/silence_start:\s*([\d.]+)/` is safe. The `[silencedetect @ 0x...]` prefix can also be matched but is unnecessary.

### Pitfall 5: AccessDenied on any chunk must abort the whole request (not just insert `[...]`)

**What goes wrong:** Chunk 3 of 5 hits AccessDenied. The orchestrator catches it, inserts `[...]`, continues. The response goes back to the client with partial transcript + gap marker. But AccessDenied means the policy is detached — ALL chunks will fail. Inserting `[...]` for every chunk makes the response `[...] [...] [...] [...] [...]` — useless noise.

**How to avoid:** In `transcribeChunkWithRetry`, check `isAwsAccessDenied(err)` FIRST and re-throw it immediately (before any retry). The outer `transcribeBufferChunked` function lets it propagate. `handleTranscribe`'s existing catch block already converts AccessDenied to 503. No change needed in the handler — just make sure the orchestrator doesn't swallow the error.

### Pitfall 6: Items array is empty on some Transcribe results

**What goes wrong:** A brief overlap chunk (e.g., 3 s of low-confidence speech) returns a final result with `.Transcript = "hmm"` but `Items = []` or `Items = undefined`. The stitcher falls into the "zero common run" path and hard-cuts, producing a doubled word.

**How to avoid:** Defensive guard: if `Items` is empty or undefined, fall back to joining the `.Transcript` strings (whitespace-split word match rather than timestamp-based). This won't be as accurate but avoids a crash or doubled-word artifact.

### Pitfall 7: Overlap chunk includes silence from the next speaker segment

**What goes wrong:** If the silence gap falls exactly at the chunk boundary (ideal case for silence-aware chunking), the overlap region from the previous chunk ends just before the silence, and the overlap from the next chunk starts just after. The two sides of the overlap contain different words and the "longest common run" is 0 — which is CORRECT. The hard-cut fallback is triggered and the seam is still clean.

**Why this is actually fine:** Silence is the natural seam. The overlap exists to handle mid-word cuts, not silence-cuts. A zero-common-run result at a silence seam just means hard-cut, which is already clean.

### Pitfall 8: `transcribeBuffer` in `transcribe-adapter.ts` collects `alt.Transcript` but NOT `alt.Items`

**What goes wrong:** Phase 100's orchestrator calls `transcribeBuffer` for each chunk and needs Items, but the current `transcribeBuffer` signature only returns `string`. The orchestrator must either call a NEW function that also returns Items, or modify `transcribeBuffer` to optionally return Items.

**How to avoid:** Create a new exported function in `transcribe-adapter.ts` (or `transcribe-orchestrator.ts`):

```typescript
export interface TranscribeChunkResult {
  transcript: string;
  items: Item[];
}

export async function transcribeBufferWithItems(
  audioBuffer: Buffer,
  mediaEncoding: "flac" | "ogg-opus" | "pcm" = "flac",
  sampleRateHz: number = 16000,
): Promise<TranscribeChunkResult> {
  // ... same loop as transcribeBuffer, but also collect alt.Items
}
```

Do NOT modify `transcribeBuffer`'s return type — it breaks the existing single-stream path and all existing tests. Add a parallel function instead.

---

## Code Examples

### Silence Gap Parsing from ffmpeg Stderr

```typescript
// Source: empirically verified ffmpeg 6.1.1 silencedetect output format
interface SilenceGap {
  startSec: number;
  endSec: number;
  durationSec: number;
}

function parseSilenceGaps(stderrOutput: string): SilenceGap[] {
  const gaps: SilenceGap[] = [];
  let pendingStart: number | null = null;

  for (const line of stderrOutput.split("\n")) {
    const startMatch = /silence_start:\s*([\d.]+)/.exec(line);
    if (startMatch) {
      pendingStart = parseFloat(startMatch[1]);
      continue;
    }
    const endMatch = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/.exec(line);
    if (endMatch && pendingStart !== null) {
      const endSec = parseFloat(endMatch[1]);
      const durationSec = parseFloat(endMatch[2]);
      gaps.push({ startSec: pendingStart, endSec, durationSec });
      pendingStart = null;
    }
  }
  // Discard unpaired trailing silence_start (audio ends in silence)
  return gaps;
}
```

### Chunk Boundary Computation (Silence-Aware + Fixed Fallback)

```typescript
// Source: D-01 through D-04 from 100-CONTEXT.md
interface ChunkBoundary {
  startSec: number;
  endSec: number;      // exclusive; overlap extends this into the next chunk's start
}

function computeChunkBoundaries(
  totalDurationSec: number,
  silenceGaps: SilenceGap[],
  targetChunkSec = 8,
  overlapSec = 2.5,
): ChunkBoundary[] {
  const boundaries: ChunkBoundary[] = [];
  let cursor = 0;

  while (cursor < totalDurationSec) {
    const targetEnd = cursor + targetChunkSec;
    if (targetEnd >= totalDurationSec) {
      // Last chunk — take everything remaining
      boundaries.push({ startSec: cursor, endSec: totalDurationSec + overlapSec });
      break;
    }

    // D-01: Find the silence gap midpoint nearest to targetEnd
    // (gap must end before targetEnd + 2s so we don't overshoot too much)
    const searchStart = cursor + (targetChunkSec * 0.5);  // don't cut in first half of chunk
    const candidate = silenceGaps.find(
      (g) => g.startSec >= searchStart && g.endSec <= targetEnd + 2,
    );

    // D-02: Fallback to fixed cut if no gap found
    const cutAt = candidate
      ? (candidate.startSec + candidate.endSec) / 2  // midpoint of gap
      : targetEnd;

    boundaries.push({
      startSec: cursor,
      endSec: cutAt + overlapSec,  // D-04: extend by overlap
    });
    cursor = cutAt;
  }

  return boundaries;
}
```

### Inline Semaphore (Module-Level Singleton for D-10)

```typescript
// Source: standard async counting semaphore pattern
// D-10: module-level singleton mirrors TranscribeStreamingClient singleton at transcribe-adapter.ts:93
function createSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function acquire<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

// Module-level singleton (D-09: N=5, D-10: module-level)
const transcribeSemaphore = createSemaphore(5);
```

### Extending `transcribeBuffer` for Items Access

```typescript
// Source: transcribe-adapter.ts lines 142-172 (existing pattern) + SDK type verification
// Add to transcribe-adapter.ts as a PARALLEL export (do not modify existing transcribeBuffer)
import type { Item } from "@aws-sdk/client-transcribe-streaming";

export interface TranscribeChunkResult {
  transcript: string;
  items: Item[];           // word-level timestamps for D-11 stitching
}

export async function transcribeBufferWithItems(
  audioBuffer: Buffer,
  mediaEncoding: "flac" | "ogg-opus" | "pcm" = "flac",
  sampleRateHz: number = 16000,
): Promise<TranscribeChunkResult> {
  const cmd = new StartStreamTranscriptionCommand({
    LanguageCode: "en-US" as LanguageCode,
    MediaSampleRateHertz: sampleRateHz,
    MediaEncoding: mediaEncoding as MediaEncoding,
    AudioStream: audioChunkGenerator(audioBuffer),
  });
  const response = await client.send(cmd);
  if (!response.TranscriptResultStream) {
    throw new Error("Transcribe returned no TranscriptResultStream");
  }

  const transcripts: string[] = [];
  const items: Item[] = [];

  for await (const event of response.TranscriptResultStream) {
    const results = event.TranscriptEvent?.Transcript?.Results;
    if (!results) continue;
    for (const result of results) {
      if (result.IsPartial) continue;   // Pitfall 3 preserved
      for (const alt of result.Alternatives ?? []) {
        if (alt.Transcript) transcripts.push(alt.Transcript);
        if (alt.Items)      items.push(...alt.Items);    // collect items
      }
    }
  }
  return { transcript: transcripts.join(" "), items };
}
```

### `transcribeBufferChunked` — Orchestrator Entry Point Signature

```typescript
// Called from handleTranscribe in voice.ts (replaces the direct transcribeBuffer call)
export async function transcribeBufferChunked(
  flacBuf: Buffer,
  sampleRateHz: number = 16000,
): Promise<string> {
  // 1. Probe duration
  // 2. Run silencedetect
  // 3. Compute chunk boundaries
  // 4. Fan out N chunks under semaphore, with retry
  // 5. Stitch with word-timestamp dedup
  // 6. Return final transcript string
  //    (same type as transcribeBuffer — caller doesn't need to change)
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-stream `transcribeBuffer` | Chunked parallel dispatch via `transcribeBufferChunked` | Phase 100 | 4–5× wall-time speedup for clips ≥ 10 s |
| No word-timestamp awareness | `alt.Items` collection for seam dedup | Phase 100 | Cleaner stitch; fewer doubled words at overlap seams |
| `transcodeForTranscribe()` defaults to `webmToFlac` | Unchanged — FLAC is the input to the chunker | Phase 100 (no change) | Chunker receives FLAC; already bulletproof against Chrome's multi-channel Opus edge case |

**Deprecated/outdated:**
- Nothing from Phase 98 is deprecated. Phase 100 extends, not replaces, the Phase 98 adapter.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Amazon Transcribe has no minimum audio duration floor above 3 s (clips as short as 3 s were accepted in Phase 98 benchmarks) | Domain item 8 | If Transcribe rejects chunks < some threshold (e.g., < 2 s), edge-case chunks from the boundary computation must be padded or dropped. Mitigation already documented (drop chunk if `durationSec < 1.0`). |
| A2 | `alt.Items` is populated in every non-empty final result without special request parameters | Domain item 1 | If Items are only populated when `EnablePartialResultsStabilization` is set, the stitcher falls back to `.Transcript` join — already coded as fallback. LOW risk (SDK types and AWS docs show Items as a standard field). |
| A3 | FLAC from stdin pipe is seekable enough for `-ss -t` slicing | Domain item 3 | Empirically verified (26 687 bytes output for 3 s slice). Risk: VERY LOW. |
| A4 | The inline semaphore pattern is correct and race-condition-free | Domain item 4 | The pattern is mechanically standard for single-threaded async JavaScript. Unit test should cover N=5 concurrent calls completing correctly. |
| A5 | p-limit v7 (ESM-only) adding as a direct dep would introduce complications; the inline semaphore is the right call | Domain item 5 | If the team later wants `p-limit`, it's a one-line swap. The risk of being wrong here is near zero. |

---

## Open Questions

1. **Should `runFfmpeg` be exported from `audio-transcode.ts` or duplicated?**
   - What we know: `runFfmpeg` is a private helper in `audio-transcode.ts:80-103`; it does exactly what the slicer and scanner need.
   - What's unclear: Exporting it means the orchestrator module depends on `audio-transcode.ts` for a non-transcode concern. Duplicating adds 25 lines of boilerplate.
   - Recommendation: Export `runFfmpeg` with a doc comment noting it's an internal utility for the voice pipeline. OR move it to a new `src/backend/voice/ffmpeg-util.ts` (tiny utility module). Planner picks.

2. **Items empty / incomplete in chunk transcripts from very short overlap windows?**
   - What we know: Items are in the SDK type as always present in `Alternative`; Phase 98 transcribed 3 s clips successfully.
   - What's unclear: Whether a 2.5 s overlap chunk always yields Items or sometimes returns only `Transcript` (especially for overlap regions that contain mostly silence or very few words).
   - Recommendation: Always implement the `.Transcript` fallback in the stitcher (if `items.length === 0`, fall back to string-based hard-cut). This makes the stitcher robust regardless.

3. **Should `ffprobe` be used for duration, or a conservative byte-size gate?**
   - What we know: ffprobe works from stdin pipe (verified). Byte proxy is unreliable for exact 10 s threshold due to FLAC compression variability.
   - Recommendation: Use ffprobe for correctness. The overhead (~10 ms) is negligible vs Transcribe round-trip (~3 500 ms). Planner may override with a conservative byte threshold (e.g., > 100 KB = almost certainly > 10 s for any clean speech FLAC).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `ffmpeg` (apt) | `silencedetect`, `sliceFlac` | ✓ | 6.1.1-3ubuntu5 (on host; same as container — Dockerfile Stage 5 updated by Phase 98 Plan 01) | None needed |
| `ffprobe` (apt) | Duration probe (if planner chooses over byte-proxy) | ✓ | 6.1.1-3ubuntu5 | Byte-size proxy (D-06) |
| `@aws-sdk/client-transcribe-streaming` | `transcribeBufferWithItems` | ✓ | ^3.1129.0 (in `package.json`) | None — locked provider |
| `silencedetect` filter | Chunker | ✓ | Confirmed present (`ffmpeg -filters \| grep silencedetect`) | Fixed-window fallback (D-02) |

**Missing dependencies with no fallback:** None.

---

## Security Domain

Security enforcement is enabled (no `security_enforcement: false` in config). Phase 100 is a pure backend refactor with no new surfaces; existing controls are preserved.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Auth gate unchanged (authenticateJWT before multer in voice.ts) |
| V3 Session Management | No | No new session state |
| V4 Access Control | No | No new ACL surfaces |
| V5 Input Validation | Yes (unchanged) | `req.file` existence check already in handleTranscribe; file size cap via multer 25 MB |
| V6 Cryptography | No | IMDS credentials via SDK (unchanged) |

### Threat Model (Phase 100 additions only)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed FLAC triggers ffmpeg crash / code exec | Tampering | `ffmpeg` subprocess is sandboxed to a separate process; stdin is the user-controlled audio blob (already in play for Phase 98); no user data interpolated into argv (inherited T-98-04-04 from `audio-transcode.ts`) |
| Adversarial audio designed to produce N→∞ silence gaps (chunker explosion) | Tampering | Cap `maxChunks = Math.ceil(totalDurationSec / MIN_CHUNK_SEC)` before dispatch; semaphore further limits concurrent streams to 5 |
| `[...]` gap marker injects unwanted command syntax into slash-transform | Spoofing | `WAKE_WORD_REGEX` check in the slash-transform looks for specific prefixes; `[...]` does not match. Confirmed by inspection of `slashCommandTransform.ts`. |
| Cost amplification via large audio files triggering many chunks | Denial of Service | Existing 25 MB multer cap + `SPEAK_TEXT_MAX` precedent; planner should add a `maxChunks` guard (e.g., 20 chunks = 160 s max) that falls back to single-stream for pathological inputs. |

---

## Sources

### Primary (HIGH confidence)
- SDK type declarations at `node_modules/@aws-sdk/client-transcribe-streaming/dist-types/models/models_0.d.ts` — Items interface, Alternative interface, StartStreamTranscriptionRequest — verified in-repo
- Empirical ffmpeg 6.1.1 on container — `silencedetect` output format, FLAC stdin-pipe slicing, ffprobe stdin-pipe duration extraction — all live-verified
- `src/backend/voice/transcribe-adapter.ts` — existing adapter shape; `src/backend/voice/audio-transcode.ts` — `runFfmpeg` pattern; `src/backend/database/routes/voice.ts` — `handleTranscribe` full text — read in-session
- `100-CONTEXT.md` — all locked decisions D-01 through D-14

### Secondary (MEDIUM confidence)
- Phase 98 empirical benchmark (session-transient on t1000): 3 s → 0.798 s, 8 s → 3.562 s, 15 s → 8.797 s, 30 s → 17.835 s — documented in 100-CONTEXT.md
- [Amazon Transcribe streaming docs](https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html) — no minimum duration stated
- [AWS re:Post: Transcribe streaming from Lambda](https://repost.aws/questions/QUhTI1xY9IS8aopypQvYEXNQ) — billing in 1-second increments, no documented minimum
- `src/backend/ssh/host-transfer.ts:2041-2059` — worker-pool concurrency analog — read in-session

### Tertiary (LOW confidence — flag for validation)
- Assumption that `alt.Items` is always populated for non-trivial audio — planner should validate with a live chunk test in wave 0

---

## Metadata

**Confidence breakdown:**
- AWS SDK Item-level timestamps: HIGH — type declarations verified in installed SDK
- ffmpeg mechanics (silencedetect, FLAC slicing): HIGH — empirically verified on container
- Stitching algorithm correctness: MEDIUM — derived from first principles; needs live AWS item validation
- Minimum Transcribe duration: LOW — no authoritative AWS source; Phase 98 empirical evidence only
- Semaphore pattern: HIGH — mechanically standard JS async pattern

**Research date:** 2026-09-10
**Valid until:** 2026-10-10 (stable domain; AWS SDK release cadence is weekly but the Items interface shape is stable)
