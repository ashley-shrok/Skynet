import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
// Phase 103 D-10: multipart-origin-guard — CORS-simple content types don't preflight
import { multipartOriginGuard } from "../../utils/multipart-origin-guard.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { WAKE_WORD_REGEX, applyServerSlashTransform } from "../../voice/slashCommandTransform.js";
import { fetchSkillCatalog, DEFAULT_SKILL_CATALOG_TIMEOUT_MS } from "../../voice/skill-catalog.js";
// Phase 98 Plan 06 — AWS-backed voice routes. The legacy Chatterbox tailnet
// URL constants (formerly under src/backend/config/) are deleted alongside
// this rewrite; those endpoints are dead. All provider translation moves
// onto the backend behind the AWS SDK v3 adapters from Plan 04 + the pure
// kernels from Plan 02.
import { synthesizeToPcm } from "../../voice/polly-adapter.js";
import { transcribeNovaSonic } from "../../voice/nova-sonic-adapter.js";
import { webmToPcm16k, padPcmToMinDuration, MIN_PCM_DURATION_MS } from "../../voice/audio-transcode.js";
import { splitIntoSentences, packChunks } from "../../voice/chunk-and-stitch.js";
import { buildRiffHeader } from "../../voice/riff-header-builder.js";
import { isValidPollyVoice } from "../../voice/polly-voice-catalog.js";
import { isAwsAccessDenied } from "../../voice/aws-errors.js";

// Phase 98 Plan 06 (D-Claude's-discretion 2026-09-10):
//   - Voice-catalog route DROPPED (frontend inlines POLLY_VOICES per Plan 03).
//   - Its handler DELETED (dead code after route drop).
//   - The old .wav-filename regex DELETED (validation moves to isValidPollyVoice).
//
// Security posture preserved from prior era (T-16-* + new T-98-06-*):
//   T-16-01: multer 25 MB fileSize cap prevents memory exhaustion
//   T-16-04: authenticateJWT wired BEFORE multer — unauthenticated = 401 before parse
//   T-98-06-03: AWS errors are NEVER surfaced to clients; fixed {error, status} shapes only
//   T-98-06-04: AccessDenied (policy detached) → 503 + info-level log (no error spam)
//   T-98-06-05: isValidPollyVoice whitelist gate before any Polly call
//   T-98-06-10: handleSpeak RIFF dataSize == pcmBuf.length (byte-accurate; strict WAV parsers)
export const DEFAULT_VOICE = "Joanna";
export const SPEAK_TEXT_MAX = 25000;
export const SAMPLE_PHRASE = "Hi, this is your voice.";

// --- Express router ---
const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// --- multer memory-storage upload middleware ---
// fileSize cap: T-16-01 mitigation (25 MB — generous for audio clips)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// --- Retriable Nova Sonic error classification ---
// Bedrock occasionally returns transient stream errors whose own message
// says "Try your request again." Server-side auto-retry catches these
// before the user sees a 502 and loses their dictated message (the
// transcribe-bank still preserves the raw webm, but by the time it lands
// the client has already dropped the blob and returned state=idle).
//
// Concrete cases seen in prod:
//   ModelStreamErrorException  — "The system encountered an unexpected
//                                error during processing. Try your
//                                request again." (2026-09-28 incident)
//   InternalServerException    — Bedrock-side 5xx.
//   ThrottlingException        — rate-limited; retry with backoff.
//   ServiceUnavailableException — service busy.
//
// Deliberately NOT retriable:
//   ValidationException  — client bug (bad input), retrying won't help.
//   AccessDeniedException — policy detached; caller handles via
//                            isAwsAccessDenied → 503.
//   ModelErrorException  — content-side rejection; retrying rarely helps.
const RETRIABLE_NOVA_SONIC_ERRORS = new Set<string>([
  "ModelStreamErrorException",
  "InternalServerException",
  "ThrottlingException",
  "ServiceUnavailableException",
]);

function isRetriableNovaSonicError(err: unknown): boolean {
  const name = (err as { name?: unknown })?.name;
  return typeof name === "string" && RETRIABLE_NOVA_SONIC_ERRORS.has(name);
}

/**
 * Call Nova Sonic with auto-retry on retriable stream errors. Total
 * attempts capped at maxAttempts; backoff is linear (500ms × attempt).
 * Rethrows the last error unchanged when all attempts exhaust or when
 * the error is non-retriable — the caller's existing 502/503 handling
 * still fires.
 */
async function transcribeWithRetries(
  pcmBuf: Buffer,
  maxAttempts: number = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await transcribeNovaSonic(pcmBuf);
    } catch (err: unknown) {
      lastErr = err;
      if (attempt < maxAttempts && isRetriableNovaSonicError(err)) {
        const backoffMs = 500 * attempt;
        const errName = (err as { name?: string })?.name ?? "unknown";
        const errMessage = err instanceof Error ? err.message : String(err);
        databaseLogger.warn(
          `[voice-server] transcribe-retry attempt=${attempt}/${maxAttempts} errName=${errName} errMessage="${errMessage}" backoffMs=${backoffMs}`,
          { operation: "voice_transcribe_retry", attempt, maxAttempts, errName, backoffMs },
        );
        await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// --- Helper: derive a safe filename extension from mimetype ---
function extFromMimetype(mimetype: string): string {
  if (mimetype.includes("webm")) return "webm";
  if (mimetype.includes("mp4") || mimetype.includes("m4a")) return "mp4";
  if (mimetype.includes("wav")) return "wav";
  if (mimetype.includes("ogg")) return "ogg";
  if (mimetype.includes("flac")) return "flac";
  if (mimetype.includes("mp3") || mimetype.includes("mpeg")) return "mp3";
  return "bin";
}

/**
 * Bridge the raw multipart audio bytes into a Nova Sonic-accepted format.
 *
 * D-REWIRE + D-AUDIO (109-CONTEXT.md): Production is always WebM/Opus from
 * the browser's MediaRecorder. The FLAC and Ogg passthrough branches (for
 * direct FLAC/Ogg uploads) have been removed — they were never hit in
 * production and Nova Sonic on Bedrock accepts only LPCM s16le mono 16 kHz.
 *
 * Single path: WebM → `webmToPcm16k` → 16 kHz LPCM mono s16le buffer.
 * The `ext` parameter is retained (used by the disk-bank filename builder
 * upstream) but is unused in this function body.
 *
 * @throws when webmToPcm16k fails (caller returns 502).
 */
async function transcodeForTranscribe(
  buf: Buffer,
  ext: string,
): Promise<{ buffer: Buffer; sampleRateHz: number }> {
  void ext;
  // D-AUDIO: WebM → LPCM 16 kHz mono s16le — the only shape Nova Sonic accepts.
  const pcmBuf = await webmToPcm16k(buf);
  // Nova Sonic returns "" on <3s clips (streaming ASR needs the trailing-silence
  // "user finished" cue). Right-pad zeros to MIN_PCM_DURATION_MS. See
  // padPcmToMinDuration for the experiment behind this threshold.
  const paddedBuf = padPcmToMinDuration(pcmBuf);
  if (paddedBuf.length > pcmBuf.length) {
    const originalMs = Math.round((pcmBuf.length / 32000) * 1000);
    databaseLogger.info(
      `[voice-server] transcribe-silence-pad originalMs=${originalMs} paddedMs=${MIN_PCM_DURATION_MS}`,
      { operation: "voice_transcribe_silence_pad", originalMs, paddedMs: MIN_PCM_DURATION_MS },
    );
  }
  return { buffer: paddedBuf, sampleRateHz: 16000 };
}

// --- Core handler (exported for direct testing without Express harness) ---
// Follows the handleConsoleLog pattern from debug.ts — named export for testability.
export async function handleTranscribe(req: Request, res: Response): Promise<Response> {
  // (a) Guard: require a file field
  if (!req.file) {
    return res.status(400).json({ error: "missing file field" });
  }

  const file = req.file;
  const ext = extFromMimetype(file.mimetype);

  // --- Disk-bank: fire-and-forget write of incoming audio buffer to container FS ---
  // MUST run BEFORE any transcode (Pitfall 6): user's post-hoc reference folder
  // stays populated with the ORIGINAL .webm bytes (not the transcoded .ogg / .flac).
  // Addresses user 2026-08-14 3.87 MB clip incident: multer is memory-only so once
  // a 504 returned the audio was GC'd. Banking to disk before the transcribe attempt
  // ensures raw bytes are recoverable even if the AWS round-trip fails.
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.userId;
  const dir = process.env.STT_RECORDINGS_DIR ?? "/app/stt-recordings";
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  // Random tail prevents silent overwrite on concurrent same-user same-size
  // uploads within the whole-second timestamp bucket. The disk-bank exists
  // to preserve raw audio when Transcribe fails — losing a clip to filename
  // collision defeats that guarantee.
  const rand = Math.random().toString(36).slice(2, 8);
  const filename = `${timestamp}-${userId ?? "anon"}-${file.size}-${rand}.${ext}`;
  const fullPath = path.join(dir, filename);
  databaseLogger.info(`[voice-server] transcribe-bank-write filename=${filename}`, { operation: "voice_transcribe_bank_write", filename });
  void fs.promises.mkdir(dir, { recursive: true }).then(() => fs.promises.writeFile(fullPath, file.buffer)).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    databaseLogger.warn(`[voice-server] transcribe-bank-write-failed filename=${filename} error=${message}`, { operation: "voice_transcribe_bank_write_failed", filename, error: message });
  });

  databaseLogger.info(`[voice-server] transcribe-req byteSize=${file.size} mimetype=${file.mimetype}`, { operation: "voice_transcribe" });

  try {
    // (b) Transcode raw bytes to a Transcribe-accepted format. WebM → try Ogg-Opus
    //     remux; on failure, fall back to FLAC full-transcode. MediaEncoding
    //     switches accordingly.
    const transcodeResult = await transcodeForTranscribe(file.buffer, ext);

    // (c) D-CUTOVER: single-adapter path — transcribeNovaSonic(pcmBuf).
    // Wrapped in transcribeWithRetries so Bedrock's transient stream
    // errors (ModelStreamErrorException et al) don't drop the user's
    // dictated message on the first flake.
    const transcript = await transcribeWithRetries(transcodeResult.buffer);

    databaseLogger.info(`[voice-server] transcribe-ok textLen=${transcript.length}`, { operation: "voice_transcribe" });

    // --- Phase 34: server-side slash-command transform (PRESERVED VERBATIM) ---
    // If the transcript starts with the "slash <content>" wake-word AND the
    // client provided a hostId form field, SSH-fetch the target box's user-wide
    // skill catalog (~/.claude/skills/*) and apply a greedy longest-prefix
    // matcher. Fail-open on any error (return raw transcript). See 34-CONTEXT.md.
    let transformedText: string | undefined;
    try {
      const rawText = transcript;
      const hostIdRaw = typeof req.body?.hostId === "string" ? req.body.hostId : undefined;
      const hostId = hostIdRaw !== undefined ? parseInt(hostIdRaw, 10) : NaN;
      if (
        typeof rawText === "string" &&
        rawText.length > 0 &&
        Number.isFinite(hostId) &&
        hostId > 0 &&
        WAKE_WORD_REGEX.test(rawText)
      ) {
        const catalog = await fetchSkillCatalog(hostId, userId, DEFAULT_SKILL_CATALOG_TIMEOUT_MS);
        const result = applyServerSlashTransform(rawText, catalog);
        if (result.matched) {
          transformedText = result.transformed;
          databaseLogger.info(
            `[voice-server] slash-transform-applied hostId=${hostId} command=${result.command} rawLen=${rawText.length} transformedLen=${transformedText.length}`,
            { operation: "voice_slash_transform_applied", hostId, command: result.command },
          );
        }
      }
    } catch (err: unknown) {
      // Fail-open — an unexpected throw here (should be unreachable because
      // fetchSkillCatalog and applyServerSlashTransform are both non-throwing)
      // must not break the passthrough transcript response.
      databaseLogger.warn(
        `[voice-server] slash-transform-unexpected-throw errMessage=${err instanceof Error ? err.message : String(err)}`,
        { operation: "voice_slash_transform_unexpected_throw" },
      );
    }

    if (transformedText !== undefined) {
      return res.status(200).json({ text: transformedText });
    }
    return res.status(200).json({ text: transcript });
  } catch (err: unknown) {
    // (d) AccessDenied → policy detached → structured 503 (T-98-06-04 / P98-OFF-01)
    if (isAwsAccessDenied(err)) {
      databaseLogger.info(
        `[voice-server] transcribe-access-denied — policy not attached`,
        { operation: "voice_transcribe_access_denied" },
      );
      return res.status(503).json({ error: "voice STT unavailable", status: 503 });
    }

    // (e) Anything else → 502 (transcode failure, AWS network error, no result stream, ...)
    // Fold error name + message into the log line itself so it lands in
    // console-forward.log (databaseLogger's second-arg Error only reaches
    // container stderr, not the forward stream we grep for diagnosis).
    const errName = err instanceof Error ? err.name : "unknown";
    const errMessage = err instanceof Error ? err.message : String(err);
    databaseLogger.error(
      `[voice-server] transcribe-error errName=${errName} errMessage="${errMessage}"`,
      err instanceof Error ? err : new Error(String(err)),
      { operation: "voice_transcribe_error", errName },
    );
    return res.status(502).json({ error: "STT error", status: 502 });
  }
}

// --- handleSpeak — POST /voice/speak (non-streaming) ---
// Single Polly SynthesizeSpeech call. Collects the full PCM buffer BEFORE
// writing the RIFF header so `dataSize` in the header is byte-accurate
// (T-98-06-10 — strict WAV parsers like HTMLAudioElement reject the
// 0xFFFFFFFF streaming sentinel).
export async function handleSpeak(req: Request, res: Response): Promise<Response> {
  // (a) Validate body.text
  if (!req.body || typeof req.body.text !== "string" || req.body.text.length === 0) {
    return res.status(400).json({ error: "body.text is required and must be a non-empty string" });
  }
  if (req.body.text.length > SPEAK_TEXT_MAX) {
    return res.status(400).json({ error: `body.text exceeds maximum length of ${SPEAK_TEXT_MAX}` });
  }

  // (b) Validate body.voice (whitelist against Polly generative-supported voices)
  if (req.body.voice !== undefined) {
    if (typeof req.body.voice !== "string" || !isValidPollyVoice(req.body.voice)) {
      return res.status(400).json({ error: "body.voice must be one of the supported Polly voice IDs" });
    }
  }

  const voiceId = (req.body.voice as string | undefined) ?? DEFAULT_VOICE;
  const text = req.body.text as string;

  databaseLogger.info(
    `[voice-server] speak-req textLen=${text.length} voice="${voiceId}"`,
    { operation: "voice_speak" },
  );

  try {
    // (c) Fire Polly synth. Adapter returns a Node Readable of raw PCM bytes.
    const pollyStream = await synthesizeToPcm(text, voiceId);

    // (d) Collect the ENTIRE PCM stream so we know pcmBuf.length before writing
    //     the RIFF header (non-streaming handler serves a self-contained WAV).
    const pcmChunks: Buffer[] = [];
    for await (const chunk of pollyStream) {
      pcmChunks.push(chunk as Buffer);
    }
    const pcmBuf = Buffer.concat(pcmChunks);
    const dataSize = pcmBuf.length;

    // (e) Build the RIFF header with byte-accurate dataSize (T-98-06-10 mitigation)
    const header = buildRiffHeader({
      channels: 1,
      sampleRate: 16000,
      bitDepth: 16,
      dataSize,
    });

    databaseLogger.info(
      `[voice-server] speak-ok pcmSize=${dataSize} totalSize=${header.length + dataSize}`,
      { operation: "voice_speak" },
    );

    res.status(200);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Content-Length", String(header.length + dataSize));
    res.write(header);
    res.end(pcmBuf);
    return res;
  } catch (err: unknown) {
    // AccessDenied → 503 (P98-OFF-01)
    if (isAwsAccessDenied(err)) {
      databaseLogger.info(
        `[voice-server] speak-access-denied — policy not attached`,
        { operation: "voice_speak_access_denied" },
      );
      return res.status(503).json({ error: "voice TTS unavailable", status: 503 });
    }

    databaseLogger.error(`[voice-server] speak-error`, err instanceof Error ? err : new Error(String(err)), {
      operation: "voice_speak_error",
    });
    return res.status(502).json({ error: "TTS error", status: 502 });
  }
}

// --- TTS diagnostic bank — WAV-per-chunk fire-and-forget writer + rotation ---
// Purpose: prove/disprove "Polly returned less audio than the text should
// produce" reports (2026-09-28 cutoff investigation). Each speak-stream
// request writes one WAV per Polly chunk to the bank so we can play back
// exactly what came off Polly's wire and hear whether the tail was
// truncated at the provider or lost downstream.
//
// Path defaults to /app/stt-recordings/tts-bank — a SUBDIRECTORY of the
// existing stt-recordings bind mount, so no docker-compose change needed
// (host: /opt/skynet/stt-recordings/tts-bank/). Rotation caps disk use.
const TTS_BANK_ENABLED = process.env.TTS_BANK_ENABLED !== "0";
const TTS_BANK_DIR = process.env.TTS_BANK_DIR ?? "/app/stt-recordings/tts-bank";
const TTS_BANK_MAX_FILES = Number(process.env.TTS_BANK_MAX_FILES ?? 200);

async function rotateTtsBank(dir: string, maxFiles: number): Promise<void> {
  const entries = await fs.promises.readdir(dir).catch(() => [] as string[]);
  const wavs = entries.filter((f) => f.endsWith(".wav"));
  if (wavs.length <= maxFiles) return;
  const stats = await Promise.all(
    wavs.map(async (f) => ({
      name: f,
      mtime: (await fs.promises.stat(path.join(dir, f))).mtimeMs,
    })),
  );
  stats.sort((a, b) => a.mtime - b.mtime);
  const toDelete = stats.slice(0, wavs.length - maxFiles);
  await Promise.all(
    toDelete.map((s) =>
      fs.promises.unlink(path.join(dir, s.name)).catch(() => {}),
    ),
  );
}

function writeTtsBankChunk(
  pcmChunks: Buffer[],
  meta: { reqId: string; chunkIndex: number; voiceId: string; textLen: number },
): void {
  if (!TTS_BANK_ENABLED) return;
  const pcm = Buffer.concat(pcmChunks);
  const header = buildRiffHeader({
    channels: 1,
    sampleRate: 16000,
    bitDepth: 16,
    dataSize: pcm.length,
  });
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const filename = `${timestamp}-${meta.reqId}-chunk${meta.chunkIndex}-${meta.voiceId}-len${meta.textLen}.wav`;
  const fullPath = path.join(TTS_BANK_DIR, filename);
  databaseLogger.info(
    `[voice-server] tts-bank-write reqId=${meta.reqId} chunk=${meta.chunkIndex} filename=${filename} pcmBytes=${pcm.length}`,
    { operation: "voice_tts_bank_write", reqId: meta.reqId, filename },
  );
  void fs.promises
    .mkdir(TTS_BANK_DIR, { recursive: true })
    .then(() => fs.promises.writeFile(fullPath, Buffer.concat([header, pcm])))
    .then(() => rotateTtsBank(TTS_BANK_DIR, TTS_BANK_MAX_FILES))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      databaseLogger.warn(
        `[voice-server] tts-bank-write-failed reqId=${meta.reqId} chunk=${meta.chunkIndex} filename=${filename} error=${message}`,
        { operation: "voice_tts_bank_write_failed", reqId: meta.reqId, filename, error: message },
      );
    });
}

// --- handleSpeakStream — POST /voice/speak-stream (streaming, chunk-and-stitch) ---
// Splits long text into ≤2900-char chunks (packChunks), fires one Polly synth
// per chunk with prefetch of chunk N+1 while chunk N streams (concurrency cap 2
// per Pitfall 5 mitigation), pipes each chunk's PCM Readable to `res` in order.
// The RIFF header is written ONCE at start with the 0xFFFFFFFF streaming
// sentinel (total size unknown at header-write time — this IS the case the
// sentinel exists for; the client-side riffPcmDecode ignores dataSize on
// streaming input).
//
// Diagnostic instrumentation (2026-09-28): every speak-stream request carries
// a short reqId that ties `speak-stream-plan` → `speak-stream-chunk-out` →
// `speak-stream-ok` log lines together, and each Polly chunk's PCM is banked
// to disk (see writeTtsBankChunk above) so a suspected truncation can be
// played back and heard directly. 16000 Hz mono 16-bit means 32000 bytes/s
// of PCM; audioSec = pcmBytes / 32000 and charsPerSec = textLen / audioSec.
// Anything wildly higher than typical English speech (~15 chars/sec) means
// Polly returned less audio than the text should have produced.
export async function handleSpeakStream(req: Request, res: Response): Promise<void> {
  // (a) Validate body.text
  if (!req.body || typeof req.body.text !== "string" || req.body.text.length === 0) {
    res.status(400).json({ error: "body.text is required and must be a non-empty string" });
    return;
  }
  if (req.body.text.length > SPEAK_TEXT_MAX) {
    res.status(400).json({ error: `body.text exceeds maximum length of ${SPEAK_TEXT_MAX}` });
    return;
  }

  // (b) Validate body.voice
  if (req.body.voice !== undefined) {
    if (typeof req.body.voice !== "string" || !isValidPollyVoice(req.body.voice)) {
      res.status(400).json({ error: "body.voice must be one of the supported Polly voice IDs" });
      return;
    }
  }

  const voiceId = (req.body.voice as string | undefined) ?? DEFAULT_VOICE;
  const text = req.body.text as string;
  // Short random id to correlate every log line for THIS request. Included
  // in bank filenames so a specific request's chunks can be located on disk.
  const reqId = Math.random().toString(36).slice(2, 10);

  databaseLogger.info(
    `[voice-server] speak-stream-req reqId=${reqId} textLen=${text.length} voice="${voiceId}"`,
    { operation: "voice_speak_stream", reqId },
  );

  // Track whether we've already flushed the response headers + first bytes.
  // Once true, we cannot send a new status code — mid-stream errors trigger
  // res.destroy() instead of res.status(503).
  let headersFlushed = false;

  try {
    // (c) Split + pack into ≤CHUNK_MAX_CHARS chunks
    const chunks = packChunks(splitIntoSentences(text));

    if (chunks.length === 0) {
      // Defensive: SPEAK_TEXT_MAX + non-empty-text validation should prevent this,
      // but if we ever end up with zero chunks, return a 400.
      res.status(400).json({ error: "body.text produced zero synthesizable chunks" });
      return;
    }

    // Log the chunk plan up front so a suspected loss can be traced back to
    // exactly which char range fed which Polly call.
    databaseLogger.info(
      `[voice-server] speak-stream-plan reqId=${reqId} chunkCount=${chunks.length} chunkLens=[${chunks.map((c) => c.length).join(",")}] totalTextLen=${text.length}`,
      { operation: "voice_speak_stream_plan", reqId, chunkCount: chunks.length },
    );

    // Per-request PCM accounting — populated inside the loop, summarised at end.
    let totalPcmBytes = 0;

    // (d) Fire first Polly call; then loop with prefetch of N+1 while N streams.
    let currentPromise: Promise<import("node:stream").Readable> = synthesizeToPcm(chunks[0], voiceId);

    for (let i = 0; i < chunks.length; i++) {
      const currentStream = await currentPromise;

      // Kick off prefetch of chunk i+1 (if any) BEFORE we start piping chunk i.
      // Concurrency cap 2 (chunk N + prefetch N+1) per Pitfall 5.
      const nextPromise: Promise<import("node:stream").Readable> | null =
        i + 1 < chunks.length ? synthesizeToPcm(chunks[i + 1], voiceId) : null;
      // Attach a no-op catch immediately so a rejection here (before the
      // await on the next iteration) doesn't surface as an unhandled
      // rejection — starter.ts's unhandledRejection handler calls
      // process.exit(1), which would kill the container mid-stream and
      // drop every other connected client. The rejection is still
      // re-thrown when the next iteration's `await currentPromise` runs.
      if (nextPromise) nextPromise.catch(() => {});

      // On the first chunk, flush headers + RIFF header BEFORE any PCM bytes.
      if (i === 0) {
        res.status(200);
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("X-Accel-Buffering", "no");
        // Streaming sentinel: total PCM byte count is unknown at header-write time.
        // riffPcmDecode.ts ignores dataSize on streaming input.
        res.write(buildRiffHeader({ channels: 1, sampleRate: 16000, bitDepth: 16 }));
        headersFlushed = true;
      }

      // Manual data/end/error handling instead of .pipe() so we can (a)
      // count Polly's exact per-chunk PCM byte output and (b) accumulate
      // the bytes for the disk bank. Backpressure preserved by pausing
      // the source when res.write returns false.
      const chunkTextLen = chunks[i].length;
      const chunkPcmBuffers: Buffer[] = [];
      let chunkPcmBytes = 0;
      await new Promise<void>((resolve, reject) => {
        currentStream.on("data", (buf: Buffer) => {
          chunkPcmBytes += buf.length;
          if (TTS_BANK_ENABLED) chunkPcmBuffers.push(buf);
          if (!res.write(buf)) {
            currentStream.pause();
            res.once("drain", () => currentStream.resume());
          }
        });
        currentStream.on("end", () => resolve());
        currentStream.on("error", reject);
      });

      totalPcmBytes += chunkPcmBytes;
      const chunkAudioSec = chunkPcmBytes / 32000; // 16kHz mono 16bit = 32000 bytes/sec
      const chunkCharsPerSec = chunkAudioSec > 0 ? chunkTextLen / chunkAudioSec : 0;
      databaseLogger.info(
        `[voice-server] speak-stream-chunk-out reqId=${reqId} i=${i} textLen=${chunkTextLen} pcmBytes=${chunkPcmBytes} audioSec=${chunkAudioSec.toFixed(3)} charsPerSec=${chunkCharsPerSec.toFixed(2)}`,
        { operation: "voice_speak_stream_chunk_out", reqId, i, textLen: chunkTextLen, pcmBytes: chunkPcmBytes },
      );
      writeTtsBankChunk(chunkPcmBuffers, {
        reqId,
        chunkIndex: i,
        voiceId,
        textLen: chunkTextLen,
      });

      // Advance to the prefetched next chunk (or null on the last iteration).
      if (nextPromise !== null) {
        currentPromise = nextPromise;
      }
    }

    const totalAudioSec = totalPcmBytes / 32000;
    const totalCharsPerSec = totalAudioSec > 0 ? text.length / totalAudioSec : 0;
    databaseLogger.info(
      `[voice-server] speak-stream-ok reqId=${reqId} chunks=${chunks.length} totalTextLen=${text.length} totalPcmBytes=${totalPcmBytes} totalAudioSec=${totalAudioSec.toFixed(3)} charsPerSec=${totalCharsPerSec.toFixed(2)}`,
      { operation: "voice_speak_stream", reqId },
    );

    res.end();
  } catch (err: unknown) {
    // AccessDenied → 503 (if we can still send status) OR destroy() (if bytes flushed).
    if (isAwsAccessDenied(err)) {
      databaseLogger.info(
        `[voice-server] speak-stream-access-denied reqId=${reqId} — policy not attached headersFlushed=${headersFlushed}`,
        { operation: "voice_speak_stream_access_denied", reqId, headersFlushed },
      );
      if (!headersFlushed) {
        res.status(503).json({ error: "voice TTS unavailable", status: 503 });
      } else {
        res.destroy();
      }
      return;
    }

    databaseLogger.error(
      `[voice-server] speak-stream-error reqId=${reqId}`,
      err instanceof Error ? err : new Error(String(err)),
      { operation: "voice_speak_stream_error", reqId, headersFlushed },
    );
    if (!headersFlushed) {
      res.status(502).json({ error: "TTS stream error", status: 502 });
    } else {
      res.destroy();
    }
  }
}

// --- Route: POST /transcribe ---
// Middleware chain: authenticateJWT (401 if unauth) → upload.single("file") (parses multipart)
// → handleTranscribe (transcode + Transcribe streaming, returns transcript)
// T-16-04 invariant: authenticateJWT BEFORE multer — unauthenticated = 401 before parse.
router.post(
  "/transcribe",
  // Phase 103 D-10: multipart-origin-guard — CORS-simple content types don't preflight
  multipartOriginGuard,
  // Phase 34: multer.single("file") parses non-file multipart fields into req.body
  // (hostId, tmuxSession). handleTranscribe reads these to gate slash-transform.
  authenticateJWT,
  upload.single("file"),
  (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    void authReq; // userId validated by authenticateJWT
    void handleTranscribe(req, res);
  },
);

// Phase 128-09 (D-18): the rejectBridgeServiceOnSpeak middleware — which
// 403'd any /speak or /speak-stream request whose JWT carried
// userId="tg-bridge-service" — is deleted alongside the tg-bridge itself.
// The "tg-bridge-service" identity no longer exists post-teardown, so the
// guard has no live class of caller to gate.

// --- Route: POST /speak ---
router.post(
  "/speak",
  authenticateJWT,
  express.json({ limit: "64kb" }),
  (req: Request, res: Response) => {
    void handleSpeak(req, res);
  },
);

// --- Route: POST /speak-stream ---
// Middleware chain: authenticateJWT (401 if unauth) → express.json (body
// parse) → handleSpeakStream.
// T-19-01: authenticateJWT BEFORE express.json — body is never parsed if JWT is invalid.
router.post(
  "/speak-stream",
  authenticateJWT,
  express.json({ limit: "64kb" }),
  (req: Request, res: Response) => {
    void handleSpeakStream(req, res);
  },
);

// GET /voices route DELETED (D-Claude's-discretion 2026-09-10) — frontend
// inlines the 7-voice const via VoicePicker.tsx (Plan 03). No backend round-trip.

export default router;
