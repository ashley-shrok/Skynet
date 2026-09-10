/**
 * Phase 100 Plan 03 — Chunked parallel STT orchestrator.
 *
 * Assembles the Wave 1 kernels (semaphore, audio-chunker, word-stitcher) with
 * the Phase 100 Plan 03 adapter extension (transcribeBufferWithItems) to deliver
 * the chunked-parallel entry point `transcribeBufferChunked(flacBuf, sampleRateHz)`.
 *
 * Decisions (from 100-CONTEXT.md — do NOT deviate):
 *   D-07: Retry each chunk exactly once on transient failure.
 *   D-08: Insert `[...]` sentinel in the transcript at the position of any
 *         chunk that fails both attempts.
 *   D-09: N=5 concurrent Transcribe streams (well under the 25-stream account
 *         quota per region).
 *   D-10: Module-level semaphore singleton — mirrors the TranscribeStreamingClient
 *         singleton at transcribe-adapter.ts:93. Constructed ONCE at import.
 *   D-11: Overlap dedup via longest-common-word-run match (delegated to stitchChunks).
 *
 * Research references:
 *   100-RESEARCH.md §§ 5 (semaphore pattern), 7 (retry + gap marker), 10 (fan-out analogs);
 *   Pitfall 1 (chunk-relative timestamps — offsets are included in ChunkResult),
 *   Pitfall 5 (AccessDenied must NOT be retried or swallowed — re-throw immediately),
 *   Pitfall 6 (empty Items fallback — handled by stitchChunks),
 *   Pitfall 8 (minimum chunk duration guard — handled by computeChunkBoundaries).
 *
 * Pattern reference:
 *   100-PATTERNS.md § transcribe-orchestrator.ts.
 *
 * Security:
 *   T-100-03-01: semaphore caps concurrent AWS streams at 5 even for large inputs.
 *   T-100-03-02: Pitfall 5 enforcement — isAwsAccessDenied is checked BEFORE any
 *                retry so AccessDenied propagates to handleTranscribe's existing 503 path.
 *   T-100-03-03: Errors go to databaseLogger only; the user-facing transcript is
 *                either the successful text or the sentinel "[...]".
 */

import { transcribeBufferWithItems } from "./transcribe-adapter.js";
import {
  probeDuration,
  scanSilenceGaps,
  parseSilenceGaps,
  computeChunkBoundaries,
  sliceFlac,
  type SilenceGap,
  type ChunkBoundary,
} from "./audio-chunker.js";
import { stitchChunks, type ChunkResult } from "./word-stitcher.js";
import { createSemaphore } from "./semaphore.js";
import { isAwsAccessDenied } from "./aws-errors.js";
import { databaseLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Constants (D-03, D-04, D-09)
// ---------------------------------------------------------------------------

/** D-09: Maximum concurrent Transcribe sessions. Well under the 25-stream account quota. */
const CONCURRENCY_LIMIT = 5;

/** D-03: Target chunk duration in seconds. Empirically chosen — see 100-CONTEXT.md. */
const TARGET_CHUNK_SEC = 8;

/** D-04: Overlap window in seconds (midpoint of the 2–3 s planner-picked range). */
const OVERLAP_SEC = 2.5;

/** Pitfall 8: Minimum chunk duration; computeChunkBoundaries merges shorter tails. */
const MIN_CHUNK_SEC = 1.0;

// ---------------------------------------------------------------------------
// Module-level semaphore singleton (D-10)
//
// Constructed ONCE at module load, mirrors the TranscribeStreamingClient
// singleton at transcribe-adapter.ts:93. All transcribeBufferChunked calls
// share this single semaphore so the in-process concurrency cap is global.
// ---------------------------------------------------------------------------

const transcribeSemaphore = createSemaphore(CONCURRENCY_LIMIT);

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Internal bundle combining chunk boundary metadata with the sliced FLAC buffer
 * ready for dispatch to transcribeBufferWithItems.
 */
interface ChunkInput {
  /** Index in the boundaries array (0-based). Used for log correlation. */
  index: number;
  /** Start of this chunk in the original audio, seconds. */
  startSec: number;
  /** End of this chunk in the original audio, seconds (includes overlap). */
  endSec: number;
  /** Sliced FLAC bytes ready to send to Transcribe. */
  buf: Buffer;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Dispatch a single chunk to Transcribe and emit structured start/ok logs.
 * Returns a `ChunkResult` whose `items` timestamps are CHUNK-RELATIVE (Pitfall 1).
 * The caller (`transcribeChunkWithRetry`) includes `startSec` in the returned
 * `ChunkResult.startOffsetSec` so the stitcher can apply global offsets.
 */
async function transcribeChunkOnce(
  chunk: ChunkInput,
  sampleRateHz: number,
): Promise<ChunkResult> {
  databaseLogger.info(
    `[voice-server] voice_transcribe_chunk_start chunkIndex=${chunk.index} startSec=${chunk.startSec} endSec=${chunk.endSec}`,
    {
      operation: "voice_transcribe_chunk_start",
      chunkIndex: chunk.index,
      startSec: chunk.startSec,
      endSec: chunk.endSec,
    },
  );

  const { transcript, items } = await transcribeBufferWithItems(
    chunk.buf,
    "flac",
    sampleRateHz,
  );

  databaseLogger.info(
    `[voice-server] voice_transcribe_chunk_ok chunkIndex=${chunk.index} textLen=${transcript.length} itemCount=${items.length}`,
    {
      operation: "voice_transcribe_chunk_ok",
      chunkIndex: chunk.index,
      textLen: transcript.length,
      itemCount: items.length,
    },
  );

  return {
    startOffsetSec: chunk.startSec,
    endOffsetSec: chunk.endSec,
    transcript,
    items,
  };
}

/**
 * Dispatch a single chunk with a once-retry on transient failure (D-07).
 *
 * AccessDenied (isAwsAccessDenied) is re-thrown immediately on EITHER attempt —
 * it is never retried or swallowed into the `[...]` gap marker (Pitfall 5 /
 * T-100-03-02). If a policy-detached error reaches this function, it propagates
 * all the way to `handleTranscribe`'s existing catch block → 503.
 *
 * Any other error:
 *   - First failure: log `voice_transcribe_chunk_retry` at warn, try again.
 *   - Second failure: log `voice_transcribe_chunk_failed_gap` at warn, return
 *     the D-08 sentinel `{transcript: "[...]", items: []}`.
 */
async function transcribeChunkWithRetry(
  chunk: ChunkInput,
  sampleRateHz: number,
): Promise<ChunkResult> {
  try {
    return await transcribeChunkOnce(chunk, sampleRateHz);
  } catch (err) {
    // Pitfall 5 / T-100-03-02: AccessDenied must NOT be retried or swallowed.
    if (isAwsAccessDenied(err)) throw err;

    // First attempt failed (non-AccessDenied). Log and retry once (D-07).
    databaseLogger.warn(
      `[voice-server] voice_transcribe_chunk_retry chunkIndex=${chunk.index}`,
      {
        operation: "voice_transcribe_chunk_retry",
        chunkIndex: chunk.index,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  // Second attempt (retry — no backoff per D-07 discretion: transients resolve fast).
  try {
    return await transcribeChunkOnce(chunk, sampleRateHz);
  } catch (err) {
    // Check AccessDenied again — it is possible the first attempt was a network
    // error and the retry is an AccessDenied on a newly-deattached policy.
    if (isAwsAccessDenied(err)) throw err;

    // Both attempts failed. Insert D-08 gap marker at this chunk's position.
    databaseLogger.warn(
      `[voice-server] voice_transcribe_chunk_failed_gap chunkIndex=${chunk.index}`,
      {
        operation: "voice_transcribe_chunk_failed_gap",
        chunkIndex: chunk.index,
      },
    );

    return {
      startOffsetSec: chunk.startSec,
      endOffsetSec: chunk.endSec,
      transcript: "[...]",
      items: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Exported entry point
// ---------------------------------------------------------------------------

/**
 * Transcribe a FLAC buffer using chunked parallel dispatch.
 *
 * Drop-in shape for `transcribeBuffer(flacBuf, "flac", sampleRateHz)` — returns
 * a plain string so `voice.ts` can branch between the two paths without changing
 * the downstream slash-transform or response-shape code (D-12, D-13).
 *
 * Pipeline:
 *   1. Probe duration via ffprobe (probeDuration).
 *   2. Scan silence gaps via ffmpeg silencedetect (scanSilenceGaps + parseSilenceGaps).
 *   3. Compute chunk boundaries (silence-aware + fixed fallback — computeChunkBoundaries).
 *   4. Slice FLAC per boundary (sliceFlac, clamped to audio end).
 *   5. Fan out under a module-level semaphore of N=5 with per-chunk retry (D-07/D-09/D-10).
 *      AccessDenied propagates immediately (Pitfall 5). Double-failure yields `[...]` (D-08).
 *   6. Stitch results via word-timestamp overlap dedup (stitchChunks, D-11).
 *   7. Log stitch completion and return the final transcript string.
 *
 * @param flacBuf - Post-transcode FLAC audio bytes (from transcodeForTranscribe).
 * @param sampleRateHz - Sample rate of the audio (default 16000).
 * @returns Final stitched transcript string.
 */
export async function transcribeBufferChunked(
  flacBuf: Buffer,
  sampleRateHz: number = 16000,
): Promise<string> {
  // Step 1: Probe duration via ffprobe.
  const totalDurationSec = await probeDuration(flacBuf);

  // Step 2: Scan silence gaps and parse them.
  const stderrText = await scanSilenceGaps(flacBuf);
  const silenceGaps: SilenceGap[] = parseSilenceGaps(stderrText);

  // Step 3: Compute chunk boundaries (silence-aware + fixed-window fallback).
  const boundaries: ChunkBoundary[] = computeChunkBoundaries(
    totalDurationSec,
    silenceGaps,
    TARGET_CHUNK_SEC,
    OVERLAP_SEC,
    MIN_CHUNK_SEC,
  );

  // Step 4: Slice FLAC per boundary. Clamp endSec to avoid requesting audio
  // beyond the file end (a boundary's endSec can exceed totalDurationSec when
  // overlap extends past the last sample).
  const chunks: ChunkInput[] = await Promise.all(
    boundaries.map(async (b, index) => ({
      index,
      startSec: b.startSec,
      endSec: b.endSec,
      buf: await sliceFlac(
        flacBuf,
        b.startSec,
        Math.min(b.endSec - b.startSec, totalDurationSec - b.startSec),
      ),
    })),
  );

  // Step 5: Fan out under semaphore + retry.
  // Promise.all propagates any AccessDenied (Pitfall 5) immediately without
  // waiting for other in-flight chunks — the handler's 503 path takes over.
  const chunkResults: ChunkResult[] = await Promise.all(
    chunks.map((c) =>
      transcribeSemaphore(() => transcribeChunkWithRetry(c, sampleRateHz)),
    ),
  );

  // Step 6: Stitch results with overlap dedup (D-11).
  const finalText = stitchChunks(chunkResults, OVERLAP_SEC);

  // Step 7: Log stitch completion.
  databaseLogger.info(
    `[voice-server] voice_transcribe_stitch_complete chunkCount=${chunks.length} textLen=${finalText.length}`,
    {
      operation: "voice_transcribe_stitch_complete",
      chunkCount: chunks.length,
      textLen: finalText.length,
    },
  );

  return finalText;
}
