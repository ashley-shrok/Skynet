import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { WAKE_WORD_REGEX, applyServerSlashTransform } from "../../voice/slashCommandTransform.js";
import { fetchSkillCatalog, DEFAULT_SKILL_CATALOG_TIMEOUT_MS } from "../../voice/skill-catalog.js";
// Phase 98 Plan 06 — AWS-backed voice routes. The legacy Chatterbox tailnet
// URL constants (formerly under src/backend/config/) are deleted alongside
// this rewrite; those endpoints are dead. All provider translation moves
// onto the backend behind the AWS SDK v3 adapters from Plan 04 + the pure
// kernels from Plan 02.
import { synthesizeToPcm } from "../../voice/polly-adapter.js";
import { transcribeBuffer } from "../../voice/transcribe-adapter.js";
import { webmToOggOpus, webmToFlac } from "../../voice/audio-transcode.js";
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
 * Bridge the raw multipart audio bytes into a Transcribe-accepted format.
 *
 * Happy path (WebM/Opus from MediaRecorder): remux to Ogg/Opus via
 * `webmToOggOpus` (fast — `-c:a copy`, few ms). On failure (e.g. Chrome's
 * multi-channel edge case), fall back to `webmToFlac` (full re-encode to
 * 16 kHz mono FLAC, ~50-200 ms) and switch MediaEncoding to "flac". Passes
 * through Ogg/FLAC uploads unchanged.
 *
 * @throws when BOTH webmToOggOpus AND webmToFlac fail (caller returns 502).
 */
async function transcodeForTranscribe(
  buf: Buffer,
  ext: string,
): Promise<{ buffer: Buffer; mediaEncoding: "flac" | "ogg-opus"; sampleRateHz: number }> {
  if (ext === "flac") {
    return { buffer: buf, mediaEncoding: "flac", sampleRateHz: 16000 };
  }
  if (ext === "ogg") {
    return { buffer: buf, mediaEncoding: "ogg-opus", sampleRateHz: 48000 };
  }
  // Default assumption: browser MediaRecorder WebM/Opus. Try fast remux first.
  try {
    const oggBuf = await webmToOggOpus(buf);
    return { buffer: oggBuf, mediaEncoding: "ogg-opus", sampleRateHz: 48000 };
  } catch (err: unknown) {
    databaseLogger.warn(
      `[voice-server] transcode-remux-failed-falling-back-flac error=${err instanceof Error ? err.message : String(err)}`,
      { operation: "voice_transcode_remux_failed_fallback_flac" },
    );
    // Fallback: full-transcode to 16 kHz mono FLAC. If THIS also throws, let
    // it propagate up — handleTranscribe's outer catch will return 502.
    const flacBuf = await webmToFlac(buf);
    return { buffer: flacBuf, mediaEncoding: "flac", sampleRateHz: 16000 };
  }
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
  // MUST run BEFORE any transcode (Pitfall 6): Ashley's post-hoc reference folder
  // stays populated with the ORIGINAL .webm bytes (not the transcoded .ogg / .flac).
  // Addresses Ashley 2026-08-14 3.87 MB clip incident: multer is memory-only so once
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

    // (c) Push the buffer through Amazon Transcribe streaming.
    const transcript = await transcribeBuffer(
      transcodeResult.buffer,
      transcodeResult.mediaEncoding,
      transcodeResult.sampleRateHz,
    );

    databaseLogger.info(
      `[voice-server] transcribe-ok textLen=${transcript.length} mediaEncoding=${transcodeResult.mediaEncoding}`,
      { operation: "voice_transcribe" },
    );

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
    databaseLogger.error(`[voice-server] transcribe-error`, err instanceof Error ? err : new Error(String(err)), {
      operation: "voice_transcribe_error",
    });
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

// --- handleSpeakStream — POST /voice/speak-stream (streaming, chunk-and-stitch) ---
// Splits long text into ≤2900-char chunks (packChunks), fires one Polly synth
// per chunk with prefetch of chunk N+1 while chunk N streams (concurrency cap 2
// per Pitfall 5 mitigation), pipes each chunk's PCM Readable to `res` in order.
// The RIFF header is written ONCE at start with the 0xFFFFFFFF streaming
// sentinel (total size unknown at header-write time — this IS the case the
// sentinel exists for; the client-side riffPcmDecode ignores dataSize on
// streaming input).
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

  databaseLogger.info(
    `[voice-server] speak-stream-req textLen=${text.length} voice="${voiceId}"`,
    { operation: "voice_speak_stream" },
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

      // Pipe this chunk's PCM Readable to res (do NOT end res yet).
      await new Promise<void>((resolve, reject) => {
        currentStream.on("end", resolve);
        currentStream.on("error", reject);
        currentStream.pipe(res, { end: false });
      });

      // Advance to the prefetched next chunk (or null on the last iteration).
      if (nextPromise !== null) {
        currentPromise = nextPromise;
      }
    }

    databaseLogger.info(
      `[voice-server] speak-stream-ok chunks=${chunks.length}`,
      { operation: "voice_speak_stream" },
    );

    res.end();
  } catch (err: unknown) {
    // AccessDenied → 503 (if we can still send status) OR destroy() (if bytes flushed).
    if (isAwsAccessDenied(err)) {
      databaseLogger.info(
        `[voice-server] speak-stream-access-denied — policy not attached headersFlushed=${headersFlushed}`,
        { operation: "voice_speak_stream_access_denied", headersFlushed },
      );
      if (!headersFlushed) {
        res.status(503).json({ error: "voice TTS unavailable", status: 503 });
      } else {
        res.destroy();
      }
      return;
    }

    databaseLogger.error(
      `[voice-server] speak-stream-error`,
      err instanceof Error ? err : new Error(String(err)),
      { operation: "voice_speak_stream_error", headersFlushed },
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

// Reject bridge service tokens on /speak endpoints. The tg-bridge JWT is
// minted with userId="tg-bridge-service" and legitimately only needs
// /voice/transcribe. Scoping the token at the route layer (not the JWT
// verify layer) means a leaked bridge JWT gets 403 on TTS surfaces rather
// than the AWS-Polly-billing-burn a leaked wildcard would enable. User
// tokens carry real DB userIds and pass through unchanged.
function rejectBridgeServiceOnSpeak(req: Request, res: Response, next: NextFunction) {
  const authReq = req as AuthenticatedRequest;
  if (authReq.userId === "tg-bridge-service") {
    res.status(403).json({
      error: "voice: bridge service tokens are not authorized for /speak endpoints",
    });
    return;
  }
  next();
}

// --- Route: POST /speak ---
router.post(
  "/speak",
  authenticateJWT,
  rejectBridgeServiceOnSpeak,
  express.json({ limit: "64kb" }),
  (req: Request, res: Response) => {
    void handleSpeak(req, res);
  },
);

// --- Route: POST /speak-stream ---
// Middleware chain: authenticateJWT (401 if unauth) → rejectBridgeServiceOnSpeak
// (403 if bridge token) → express.json (body parse) → handleSpeakStream
// T-19-01: authenticateJWT BEFORE express.json — body is never parsed if JWT is invalid.
router.post(
  "/speak-stream",
  authenticateJWT,
  rejectBridgeServiceOnSpeak,
  express.json({ limit: "64kb" }),
  (req: Request, res: Response) => {
    void handleSpeakStream(req, res);
  },
);

// GET /voices route DELETED (D-Claude's-discretion 2026-09-10) — frontend
// inlines the 7-voice const via VoicePicker.tsx (Plan 03). No backend round-trip.

export default router;
