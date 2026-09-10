/**
 * Phase 98 plan 04 — audio format bridge (WebM → Ogg-Opus / FLAC via ffmpeg).
 *
 * Two subprocess-wrapper functions that translate the browser-recorded
 * WebM/Opus blob (what `MediaRecorder` produces by default) into a
 * Transcribe-accepted format. Consumed by Plan 06's rewritten
 * `handleTranscribe` handler as a try/catch fallback pair:
 *
 *   try {
 *     buf = await webmToOggOpus(rawWebmBuffer);   // fast remux, no re-encode
 *     mediaEncoding = "ogg-opus";
 *   } catch {
 *     buf = await webmToFlac(rawWebmBuffer);       // full transcode fallback
 *     mediaEncoding = "flac";
 *   }
 *   transcript = await transcribeBuffer(buf, mediaEncoding, 16000);
 *
 * Locked design decisions (from 98-CONTEXT.md + 98-RESEARCH.md):
 *
 * - **This module exists because Amazon Transcribe streaming REJECTS
 *   WebM natively** (98-RESEARCH.md § Pitfall 1). Transcribe streaming's
 *   supported list is strictly [FLAC, Ogg-Opus, PCM] — no WebM. Since
 *   the client contract is locked as "browser uploads whatever
 *   MediaRecorder gave it, backend translates" (D-Backend-owned-
 *   orchestration), the backend MUST transcode/remux before pushing to
 *   Transcribe. No pure-Node WebM demuxer exists; ffmpeg is the
 *   canonical tool.
 *
 * - **ffmpeg MUST be installed in the docker image** (98-RESEARCH.md
 *   § Pitfall 7 — SHIP BLOCKER). Plan 01 already added `ffmpeg` to
 *   `docker/Dockerfile` Stage 5 apt-get list. Without it, the first
 *   voice-in request in prod fails with `ENOENT: ffmpeg not found` and
 *   the feature is dark. The `webmToOggOpus` / `webmToFlac` reject-on-
 *   spawn-error path surfaces this loudly as an error, not silently as
 *   "no transcript" — asserted by the unit tests.
 *
 * - **`webmToOggOpus` uses `-c:a copy` (REMUX, not transcode).** This
 *   copies the Opus audio track from the WebM container into an Ogg
 *   container WITHOUT re-encoding. Fast (few ms) and lossless because
 *   MediaRecorder already produced Opus. This is the happy path — the
 *   caller SHOULD prefer this and fall back only when it errors.
 *
 * - **`webmToFlac` re-encodes to 16 kHz mono FLAC.** This is the
 *   fallback for edge cases where the Ogg-Opus remux fails. Notable
 *   case per 98-RESEARCH.md § Pattern 5: Chrome sometimes produces
 *   multi-channel (stereo) Opus, and Transcribe's Ogg-Opus mode expects
 *   mono at 16 kHz — the remux preserves multi-channel, causing
 *   `BadRequestException`. Full FLAC transcode with `-ar 16000 -ac 1`
 *   flattens to mono @ 16 kHz, which Transcribe always accepts. Slower
 *   (~50-200 ms) but bulletproof — validated against the bounty's
 *   sample clips via `transcribe-flac.py`.
 *
 *   **This fallback pair is WIRED, not standalone dead code.** Plan 06's
 *   `handleTranscribe` will `try webmToOggOpus / catch → webmToFlac`,
 *   switching `MediaEncoding` from `"ogg-opus"` to `"flac"` when the
 *   fallback fires. Verified in 98-04-PLAN.md § key_links.
 *
 * - **Argv contains ONLY literal strings; user data flows through
 *   stdin only.** Threat T-98-04-04 (command injection): the ffmpeg
 *   argument lists are hardcoded here — voice ID, text, and other user
 *   input NEVER interpolate into argv. The only user-controlled bytes
 *   are the audio buffer, which is piped to stdin (safe — bytes only).
 *
 * @see 98-RESEARCH.md § Pattern 5, § Pitfall 1, § Pitfall 7
 * @see 98-PATTERNS.md § audio-transcode.ts (spawn shape from opkssh-auth.ts analog)
 * @see src/backend/voice/transcribe-adapter.ts (consumer via Plan 06)
 */

import { spawn } from "node:child_process";

/**
 * Shared subprocess wrapper. Spawns ffmpeg with the given args, pipes
 * `inputBuffer` to stdin, collects stdout chunks, resolves the concatenated
 * Buffer on exit code 0, and rejects on non-zero exit or spawn error.
 *
 * Exported for reuse by audio-chunker.ts (Phase 100) — sliceFlac delegates
 * to this helper rather than duplicating the spawn/pipe body. The argv-safety
 * constraint from T-98-04-04 still applies: every caller (webmToOggOpus,
 * webmToFlac, sliceFlac) passes ONLY hardcoded literal strings and
 * numeric-formatted values; user data flows through stdin only.
 */
export function runFfmpeg(inputBuffer: Buffer, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args as string[], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.stderr.on("data", (c: Buffer) => errChunks.push(c));
    ff.on("error", (err) => reject(err));
    ff.on("close", (code: number | null) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const stderrText = Buffer.concat(errChunks).toString();
        reject(new Error(`ffmpeg exited ${code}: ${stderrText}`));
      }
    });

    // Swallow EPIPE on stdin — ffmpeg may exit early after reading enough input
    // (e.g. `-ss X -t Y` slicing an early section of a large buffer; ffprobe
    // header-only reads). The write of the remaining bytes then errors with
    // EPIPE. That's expected and harmless — the `close` handler above uses the
    // real exit code as the truth. Without this handler, EPIPE bubbles up as an
    // "Unhandled error event" and crashes the process. Any non-EPIPE stdin
    // error still rejects the promise so the caller can surface it.
    ff.stdin.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE") return;
      reject(err);
    });

    ff.stdin.end(inputBuffer);
  });
}

/**
 * REMUX a WebM/Opus buffer into an Ogg/Opus container without re-encoding.
 *
 * Fast (few ms) and lossless — the Opus track from the WebM container is
 * copied verbatim into an Ogg container. This is the happy path;
 * `webmToFlac` is the fallback for edge cases (Chrome's multi-channel
 * Opus output).
 *
 * @param webmBuffer - Raw WebM/Opus bytes as received from `MediaRecorder`.
 * @returns Ogg/Opus bytes suitable for `transcribeBuffer(_, "ogg-opus")`.
 * @throws With ffmpeg's stderr output on non-zero exit.
 * @throws With the spawn error (e.g., ENOENT when ffmpeg is missing from
 *   the container — see the Pitfall 7 note in the module docblock).
 */
export function webmToOggOpus(webmBuffer: Buffer): Promise<Buffer> {
  return runFfmpeg(webmBuffer, [
    "-i",
    "pipe:0",
    "-c:a",
    "copy",
    "-f",
    "ogg",
    "pipe:1",
  ]);
}

/**
 * Full-transcode fallback: re-encode a WebM/Opus buffer as 16 kHz mono
 * FLAC.
 *
 * Slower (~50-200 ms) than `webmToOggOpus` because it decodes + re-
 * encodes rather than remuxing, but bulletproof against Chrome's
 * occasional multi-channel Opus output. Callers should try
 * `webmToOggOpus` first and fall back to this only when the remux
 * throws — see the fallback pair example in the module docblock.
 *
 * @param webmBuffer - Raw WebM/Opus bytes as received from `MediaRecorder`.
 * @returns FLAC bytes at 16 kHz mono, suitable for `transcribeBuffer(_, "flac", 16000)`.
 * @throws With ffmpeg's stderr output on non-zero exit.
 * @throws With the spawn error (e.g., ENOENT when ffmpeg is missing from
 *   the container — see the Pitfall 7 note in the module docblock).
 */
export function webmToFlac(webmBuffer: Buffer): Promise<Buffer> {
  return runFfmpeg(webmBuffer, [
    "-i",
    "pipe:0",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-f",
    "flac",
    "pipe:1",
  ]);
}
