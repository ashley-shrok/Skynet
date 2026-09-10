/**
 * Phase 100 Plan 02 — Word-timestamp stitcher (pure kernel).
 *
 * This module implements the overlap-dedup stitching algorithm for the
 * chunked STT pipeline. It consumes arrays of AWS Transcribe `Item[]`
 * (word-level timestamps) from adjacent chunks and reconstructs a single
 * clean transcript string.
 *
 * Algorithm reference: 100-RESEARCH.md § Section 6 (full pseudocode),
 * Pitfall 1 (chunk-relative timestamps), Pitfall 6 (empty-Items fallback).
 * Decisions: D-11 (longest-common-word-run dedup), D-08 (gap-marker `[...]`).
 *
 * Design invariants (locked from 100-CONTEXT.md — do NOT deviate):
 *
 * - D-11: Overlap dedup via longest-common-word-run match on item-level
 *   timestamps. Only `Type === "pronunciation"` items participate in the
 *   matching comparison; punctuation items are excluded from the run but
 *   re-inserted into the merged output at their global timestamps.
 *
 * - D-08: Gap-marker chunks (`transcript="[...]"`, `items=[]`) pass through
 *   the string `[...]` into the output unchanged.
 *
 * - Pitfall 1 (CRITICAL): `Item.StartTime` values are RELATIVE to each
 *   chunk's own stream start, NOT to the original audio. A chunk extracted
 *   at global second 6.0 has `Item.StartTime ≈ 0.0` for its first word.
 *   `stitchChunks` adds `chunk.startOffsetSec` to every item's StartTime
 *   and EndTime before any cross-chunk comparison.
 *
 * - Pitfall 6: When a chunk's `items` array is empty, the stitcher falls
 *   back to appending the chunk's raw `.transcript` string. This ensures
 *   gap-marker chunks (`[...]`) and low-confidence chunks that returned only
 *   a `.Transcript` string pass through without crashing.
 *
 * This module is pure — NO I/O, NO logging, NO mutable module-level state,
 * NO runtime imports beyond the AWS SDK `Item` type. Safe to import and
 * test in isolation without any AWS credentials or ffmpeg.
 */

import type { Item } from "@aws-sdk/client-transcribe-streaming";

/**
 * A single chunk's transcription result, as produced by the orchestrator.
 *
 * CRITICAL (Pitfall 1): `items` timestamps are RELATIVE to the chunk's own
 * stream start, NOT to the original full-audio timeline. The `startOffsetSec`
 * field carries the chunk's start position in global audio time. `stitchChunks`
 * applies the offset adjustment internally — callers do not need to pre-adjust.
 */
export interface ChunkResult {
  /** Start of this chunk in the original audio, seconds. */
  startOffsetSec: number;
  /** End of this chunk in the original audio, seconds. */
  endOffsetSec: number;
  /**
   * The transcript string for this chunk. For failed chunks this is the
   * gap-marker literal `"[...]"` (D-08). For successful chunks it is the
   * joined `.Transcript` from all final Transcribe results.
   */
  transcript: string;
  /**
   * Word-level items from AWS Transcribe's `Alternative.Items`.
   * Timestamps are chunk-relative (Pitfall 1). Empty array when the chunk
   * failed or when Transcribe returned only a `.Transcript` string.
   */
  items: Item[];
}

/**
 * Find the length of the longest contiguous word run that appears at the
 * END of array `a` AND the START of array `b` (in any alignment). Uses an
 * O(N×M) nested scan — safe because the overlap window bounds N and M to
 * ~5–15 words (2–3 s × word rate).
 *
 * Examples:
 *   longestCommonRun(["a","b","c","d"], ["c","d","e","f"]) === 2
 *   longestCommonRun(["a","b"], ["c","d"]) === 0
 *   longestCommonRun([], []) === 0
 *
 * Inputs should already be lowercased (case-insensitive matching is the
 * caller's responsibility — see `stitchChunks` which lowercases before
 * calling this function).
 */
export function longestCommonRun(a: string[], b: string[]): number {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let len = 0;
      while (
        i + len < a.length &&
        j + len < b.length &&
        a[i + len] === b[j + len]
      ) {
        len++;
      }
      if (len > best) best = len;
    }
  }
  return best;
}

/**
 * Stitch an array of chunk transcription results into a single transcript
 * string by deduplicating the overlap regions using the longest-common-word-
 * run algorithm (D-11).
 *
 * @param chunks     - Array of ChunkResult in chronological order. Items
 *                     timestamps are chunk-relative; this function adjusts
 *                     them to global (Pitfall 1).
 * @param overlapSec - The overlap window width in seconds (the same value
 *                     that was used when the chunks were extracted). Used to
 *                     define the search window for common-run matching.
 * @returns          Final transcript string with overlap deduplication
 *                   applied and punctuation cleaned up (no space before
 *                   comma/period/etc.).
 *
 * Edge case handling:
 * - `chunks.length === 0`  → returns `""`
 * - `chunks.length === 1`  → returns `chunks[0].transcript.trim()` (fast path)
 * - chunk with `items=[]`  → falls back to appending `.transcript` string
 * - gap-marker chunks (`transcript="[...]"`, `items=[]`) → `[...]` appears verbatim
 * - zero-match overlap     → hard-cut fallback (keep all of A, keep all of B)
 */
export function stitchChunks(chunks: ChunkResult[], overlapSec: number): string {
  // Step 1: Edge cases.
  if (chunks.length === 0) return "";
  if (chunks.length === 1) return chunks[0].transcript.trim();

  // Step 2: Adjust each item's timestamps to global (audio-wide) coordinates.
  // Pitfall 1: Items timestamps are relative to the chunk's own stream start.
  // We produce NEW item objects without mutating the input ChunkResult arrays.
  const globalChunks = chunks.map((c) => ({
    ...c,
    items: c.items.map((item) => ({
      ...item,
      StartTime: (item.StartTime ?? 0) + c.startOffsetSec,
      EndTime: (item.EndTime ?? 0) + c.startOffsetSec,
    })),
  }));

  // Step 3: Walk adjacent pairs, merging into `merged` Item[] and accumulating
  // string-only chunks in `stringFallbackParts` (for empty-Items chunks).
  let merged: Item[] = globalChunks[0].items;
  // If the very first chunk has no items, seed the string fallback with it.
  const stringFallbackParts: string[] = [];
  if (merged.length === 0) {
    const t = globalChunks[0].transcript.trim();
    if (t) stringFallbackParts.push(t);
  }

  for (let i = 1; i < globalChunks.length; i++) {
    const bChunk = globalChunks[i];
    const bItems = bChunk.items;
    const seamAt = bChunk.startOffsetSec;
    const overlapEnd = seamAt + overlapSec;

    // Empty-Items fallback (Pitfall 6): if B has no timestamped items OR
    // the accumulator is empty (prior fallback consumed everything), append
    // B's raw transcript string to the side-channel.
    if (bItems.length === 0) {
      const t = bChunk.transcript.trim();
      if (t) stringFallbackParts.push(t);
      continue;
    }

    if (merged.length === 0) {
      // The accumulator is empty (all prior chunks were string-fallback).
      // Take all of B's items and continue.
      merged = bItems;
      continue;
    }

    // Normal path: both sides have timestamped items.
    // Extract pronunciation items from A that fall in the overlap window.
    const aOverlapWords = merged
      .filter(
        (it) =>
          it.Type === "pronunciation" &&
          (it.StartTime ?? 0) >= seamAt &&
          (it.StartTime ?? 0) < overlapEnd,
      )
      .map((it) => (it.Content ?? "").toLowerCase());

    // Extract pronunciation items from B that fall in the overlap window.
    const bOverlapWords = bItems
      .filter(
        (it) =>
          it.Type === "pronunciation" &&
          (it.StartTime ?? 0) >= seamAt &&
          (it.StartTime ?? 0) < overlapEnd,
      )
      .map((it) => (it.Content ?? "").toLowerCase());

    // Find the longest common contiguous word run (case-insensitive).
    const lcRun = longestCommonRun(aOverlapWords, bOverlapWords);

    if (lcRun > 0) {
      // Drop the first `lcRun` pronunciation items from B's contribution.
      // Non-pronunciation items (punctuation) are kept but filtered by position.
      const bPronounceItems = bItems.filter((it) => it.Type === "pronunciation");
      const bKeptPronounce = bPronounceItems.slice(lcRun);
      // Include punctuation from B that appears after the overlap window.
      const bPunctuationAfterOverlap = bItems.filter(
        (it) => it.Type === "punctuation" && (it.StartTime ?? 0) >= overlapEnd,
      );
      merged = [
        ...merged,
        ...bKeptPronounce,
        ...bPunctuationAfterOverlap,
      ].sort((x, y) => (x.StartTime ?? 0) - (y.StartTime ?? 0));
    } else {
      // Zero-match fallback: hard-cut at the seam — keep all of A, keep all of B.
      merged = [...merged, ...bItems].sort(
        (x, y) => (x.StartTime ?? 0) - (y.StartTime ?? 0),
      );
    }
  }

  // Step 4: Reconstruct text from the sorted merged items.
  const reconstructedText = merged
    .map((it) => it.Content ?? "")
    .join(" ")
    .replace(/\s+([.,!?;:])/g, "$1") // remove space before punctuation
    .trim();

  // Append any string-fallback parts (empty-Items chunks) at the end.
  const parts = [reconstructedText, ...stringFallbackParts].filter(Boolean);
  return parts.join(" ").trim();
}
