/**
 * Phase 100 Wave 1 — FLAC audio chunker for parallel STT dispatch.
 *
 * Decisions: D-01 (silence-aware splitting), D-02 (fixed-window fallback),
 * D-03 (target chunk ~8 s), D-04 (overlap 2–3 s), D-06 (duration probe).
 *
 * Research: RESEARCH.md §§ 2 (silencedetect mechanics), 3 (FLAC slicing
 * via stdin pipe), 4 (ffprobe duration), 6 (boundary algorithm), 8 (min
 * duration guard); Pitfalls 2 (unpaired silence_start), 3 (format flag
 * ordering), 4 (mixed stderr), 8 (minimum-chunk guard).
 *
 * Patterns: PATTERNS.md § audio-chunker.ts (spawn/pipe shape mirrors
 * audio-transcode.ts).
 *
 * Security: T-100-01-01 — argv contains ONLY literal strings and
 * toFixed(3) numeric values; user data flows through stdin ONLY.
 */

import { spawn } from "node:child_process";
import { runFfmpeg } from "./audio-transcode.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A silence region detected by ffmpeg's silencedetect filter. */
export interface SilenceGap {
  startSec: number;
  endSec: number;
  durationSec: number;
}

/**
 * A chunk boundary produced by computeChunkBoundaries.
 * endSec is exclusive and extends past the logical cut by overlapSec so
 * adjacent Transcribe sessions cover the same audio at the seam.
 */
export interface ChunkBoundary {
  startSec: number;
  endSec: number;
}

// ---------------------------------------------------------------------------
// sliceFlac
// ---------------------------------------------------------------------------

/**
 * Extracts the window [startSec, startSec+durationSec) from a FLAC buffer
 * via ffmpeg, returning a new FLAC buffer.
 *
 * Argv contains ONLY literal strings and numeric-formatted values; user data
 * flows through stdin only. (T-98-04-04 inherited constraint.)
 *
 * @param flacBuf - Full FLAC audio bytes.
 * @param startSec - Start offset in seconds.
 * @param durationSec - Duration of the slice in seconds.
 * @returns A new FLAC buffer covering [startSec, startSec+durationSec).
 */
export function sliceFlac(
  flacBuf: Buffer,
  startSec: number,
  durationSec: number,
): Promise<Buffer> {
  return runFfmpeg(flacBuf, [
    "-f",
    "flac",
    "-i",
    "pipe:0",
    "-ss",
    startSec.toFixed(3),
    "-t",
    durationSec.toFixed(3),
    "-f",
    "flac",
    "pipe:1",
  ]);
}

// ---------------------------------------------------------------------------
// scanSilenceGaps
// ---------------------------------------------------------------------------

/**
 * Runs ffmpeg silencedetect on the FLAC buffer and resolves with the full
 * stderr text. The caller passes this text to parseSilenceGaps().
 *
 * Spawns ffmpeg directly (not via runFfmpeg) because the useful output is
 * on stderr; stdout goes to /dev/null via -f null -.
 *
 * Argv contains ONLY literal strings and numeric-formatted values (thresholdDb
 * and minGapSec are numeric, never user-controlled strings).
 * (T-98-04-04 inherited constraint.)
 *
 * @param flacBuf - Full FLAC audio bytes.
 * @param thresholdDb - Silence noise floor in dB (default -40).
 * @param minGapSec - Minimum silence duration in seconds (default 0.2).
 * @returns The raw stderr text from ffmpeg, suitable for parseSilenceGaps().
 */
export function scanSilenceGaps(
  flacBuf: Buffer,
  thresholdDb = -40,
  minGapSec = 0.2,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-f",
        "flac",
        "-i",
        "pipe:0",
        "-af",
        `silencedetect=n=${thresholdDb}dB:d=${minGapSec}`,
        "-f",
        "null",
        "-",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const errChunks: Buffer[] = [];

    ff.stderr.on("data", (c: Buffer) => errChunks.push(c));
    ff.on("error", (err) => reject(err));
    ff.on("close", (code: number | null) => {
      const stderrText = Buffer.concat(errChunks).toString();
      if (code === 0) {
        resolve(stderrText);
      } else {
        reject(new Error(`ffmpeg exited ${code}: ${stderrText}`));
      }
    });

    // Swallow EPIPE on stdin — see runFfmpeg docstring in audio-transcode.ts.
    ff.stdin.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE") return;
      reject(err);
    });

    ff.stdin.end(flacBuf);
  });
}

// ---------------------------------------------------------------------------
// probeDuration
// ---------------------------------------------------------------------------

/**
 * Probes the duration of a FLAC buffer via ffprobe.
 *
 * Argv contains ONLY literal strings; user data flows through stdin only.
 * (T-98-04-04 inherited constraint.)
 *
 * @param flacBuf - Full FLAC audio bytes.
 * @returns Duration in seconds as a float.
 * @throws When ffprobe exits non-zero, or when stdout is not a parseable float.
 */
export function probeDuration(flacBuf: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      "ffprobe",
      [
        "-f",
        "flac",
        "-i",
        "pipe:0",
        "-v",
        "quiet",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    ff.stdout.on("data", (c: Buffer) => outChunks.push(c));
    ff.stderr.on("data", (c: Buffer) => errChunks.push(c));
    ff.on("error", (err) => reject(err));
    ff.on("close", (code: number | null) => {
      if (code !== 0) {
        const stderrText = Buffer.concat(errChunks).toString();
        reject(new Error(`ffprobe exited ${code}: ${stderrText}`));
        return;
      }
      const raw = Buffer.concat(outChunks).toString().trim();
      const duration = parseFloat(raw);
      if (!Number.isFinite(duration)) {
        reject(new Error(`ffprobe returned non-numeric duration: "${raw}"`));
        return;
      }
      resolve(duration);
    });

    // Swallow EPIPE on stdin — ffprobe reads FLAC headers (~100 bytes) and
    // exits before consuming the rest of the buffer. See runFfmpeg docstring
    // in audio-transcode.ts for full rationale. Without this handler, EPIPE
    // bubbles as an uncaught error event and crashes the Node process.
    ff.stdin.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE") return;
      reject(err);
    });

    ff.stdin.end(flacBuf);
  });
}

// ---------------------------------------------------------------------------
// parseSilenceGaps
// ---------------------------------------------------------------------------

const START_RE = /silence_start:\s*([\d.]+)/;
const END_RE = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/;

/**
 * Pure function. Parses ffmpeg silencedetect stderr text into SilenceGap
 * objects. Unpaired trailing silence_start entries (audio ended mid-silence)
 * are discarded (Pitfall 2).
 *
 * @param stderrOutput - Full stderr string from ffmpeg silencedetect.
 * @returns Array of fully-closed silence gaps (both start and end present).
 */
export function parseSilenceGaps(stderrOutput: string): SilenceGap[] {
  const gaps: SilenceGap[] = [];
  let pendingStart: number | null = null;

  for (const line of stderrOutput.split("\n")) {
    const startMatch = START_RE.exec(line);
    if (startMatch) {
      pendingStart = parseFloat(startMatch[1]);
      continue;
    }
    const endMatch = END_RE.exec(line);
    if (endMatch && pendingStart !== null) {
      gaps.push({
        startSec: pendingStart,
        endSec: parseFloat(endMatch[1]),
        durationSec: parseFloat(endMatch[2]),
      });
      pendingStart = null;
    }
  }
  // Discard any unpaired trailing silence_start (audio ended in silence).
  return gaps;
}

// ---------------------------------------------------------------------------
// computeChunkBoundaries
// ---------------------------------------------------------------------------

/**
 * Computes chunk boundaries for parallel STT dispatch using a silence-aware
 * strategy with fixed-window fallback (D-01/D-02).
 *
 * Algorithm (RESEARCH.md § 6):
 * - Walk the audio from cursor=0 while cursor < totalDurationSec.
 * - targetEnd = cursor + targetChunkSec.
 * - If targetEnd >= totalDurationSec, emit a final chunk and break.
 * - Search for a silence gap whose midpoint falls in [cursor+half, targetEnd+2].
 * - Cut at the gap midpoint (silence-aware) or at targetEnd (fixed fallback).
 * - Push {startSec: cursor, endSec: cutAt + overlapSec}; advance cursor.
 * - After the loop, if the final chunk's audio-only length < minChunkSec and
 *   there are at least 2 boundaries, merge it into the previous chunk (Pitfall 8).
 *
 * @param totalDurationSec - Total audio duration in seconds.
 * @param silenceGaps - Silence gaps from parseSilenceGaps().
 * @param targetChunkSec - Target chunk size in seconds (default 8).
 * @param overlapSec - Overlap added to each chunk's endSec (default 2.5).
 * @param minChunkSec - Minimum chunk audio length; shorter final chunks are
 *   merged into the previous (default 1.0).
 * @returns Array of ChunkBoundary objects covering [0, totalDurationSec].
 */
export function computeChunkBoundaries(
  totalDurationSec: number,
  silenceGaps: SilenceGap[],
  targetChunkSec = 8,
  overlapSec = 2.5,
  minChunkSec = 1.0,
): ChunkBoundary[] {
  const boundaries: ChunkBoundary[] = [];
  let cursor = 0;

  while (cursor < totalDurationSec) {
    const targetEnd = cursor + targetChunkSec;

    if (targetEnd >= totalDurationSec) {
      // Last chunk — take everything remaining.
      boundaries.push({ startSec: cursor, endSec: totalDurationSec + overlapSec });
      break;
    }

    // D-01: find a silence gap whose start falls in the second half of this
    // window AND whose end is within targetEnd + 2 s (don't overshoot too much).
    const searchStart = cursor + targetChunkSec * 0.5;
    const candidate = silenceGaps.find(
      (g) => g.startSec >= searchStart && g.endSec <= targetEnd + 2,
    );

    // D-02: fall back to fixed cut if no gap found.
    const cutAt = candidate
      ? (candidate.startSec + candidate.endSec) / 2 // midpoint of silence gap
      : targetEnd;

    boundaries.push({ startSec: cursor, endSec: cutAt + overlapSec });
    cursor = cutAt;
  }

  // Pitfall 8 / minimum-chunk guard: if the final chunk's pure audio length
  // (endSec - overlapSec - startSec) is shorter than minChunkSec, merge it
  // into the previous chunk.
  if (boundaries.length > 1) {
    const last = boundaries[boundaries.length - 1];
    const audioLength = last.endSec - overlapSec - last.startSec;
    if (audioLength < minChunkSec) {
      boundaries.pop();
      boundaries[boundaries.length - 1].endSec = totalDurationSec + overlapSec;
    }
  }

  return boundaries;
}
