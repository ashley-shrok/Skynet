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
// Speech routes. Provider translation lives behind the TTS/STT provider
// contracts (tts-provider.ts / stt-provider.ts); nothing here is specific to
// one provider.
import {
  chooseVoice,
  defaultVoiceFor,
  getVoiceList,
  resolveTtsFallback,
  resolveTtsProvider,
  synthesizeWithRetries,
  ttsStallTimeoutMs,
  TTS_PROVIDER_LABELS,
  voiceLabels,
  VOICE_ID_MAX_LEN,
  type TtsProvider,
  type VoiceChoice,
} from "../../voice/tts-provider.js";
import { TtsNotConfiguredError, TtsStallError } from "../../voice/tts-errors.js";
import { PcmResampler, benchProvider, isProviderBenched, resumeText } from "../../voice/tts-fallback.js";
import { resolveSttProvider, transcribeWithRetries, type SttProvider } from "../../voice/stt-provider.js";
import { SttHttpError, SttNotConfiguredError } from "../../voice/stt-errors.js";
import { splitIntoSentences, packChunks } from "../../voice/chunk-and-stitch.js";
import { buildRiffHeader } from "../../voice/riff-header-builder.js";
import { maybePruneRecordings } from "../../voice/recording-retention.js";
import {
  TAIL_GUARD_FILLER,
  TAIL_GUARD_HOLD_SEC,
  findTailGuardCut,
  tailGuardApplies,
} from "../../voice/tail-guard.js";

// Voice list: GET /voices serves the ACTIVE provider's list — the app keeps
// no copy of its own (supersedes Phase 98 Plan 03's inlined Polly list).
//
// Security posture preserved from prior era (T-16-* + new T-98-06-*):
//   T-16-01: multer 25 MB fileSize cap prevents memory exhaustion
//   T-16-04: authenticateJWT wired BEFORE multer — unauthenticated = 401 before parse
//   T-98-06-03: provider errors are NEVER surfaced to clients; fixed {error, status} shapes only
//   T-98-06-04: provider unavailable (policy detached, key rejected, unknown
//               TTS_PROVIDER) → 503 + info-level log (no error spam)
//   T-98-06-05: voice ids are length-capped and only ever chosen from the
//               provider's own list (or its own id format when the list is down)
//   T-98-06-10: handleSpeak RIFF dataSize == pcmBuf.length (byte-accurate; strict WAV parsers)
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
  void fs.promises.mkdir(dir, { recursive: true }).then(() => fs.promises.writeFile(fullPath, file.buffer)).then(() => maybePruneRecordings(dir)).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    databaseLogger.warn(`[voice-server] transcribe-bank-write-failed filename=${filename} error=${message}`, { operation: "voice_transcribe_bank_write_failed", filename, error: message });
  });

  databaseLogger.info(`[voice-server] transcribe-req byteSize=${file.size} mimetype=${file.mimetype}`, { operation: "voice_transcribe" });

  // Resolved per request; an unknown STT_PROVIDER surfaces as 503 below.
  let provider: SttProvider | undefined;
  try {
    // (b) The provider owns any format conversion it needs (Bedrock
    //     transcodes WebM → 16 kHz PCM; the HTTP providers take WebM as-is).
    // (c) Wrapped in transcribeWithRetries so transient provider errors
    //     (Bedrock ModelStreamErrorException, HTTP 429/5xx) don't drop the
    //     user's dictated message on the first flake.
    provider = resolveSttProvider();
    const transcript = await transcribeWithRetries(provider, { audio: file.buffer, mimetype: file.mimetype, ext });

    databaseLogger.info(`[voice-server] transcribe-ok provider=${provider.id} textLen=${transcript.length}`, { operation: "voice_transcribe", provider: provider.id });

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
    // (d) Misconfigured or unauthorised provider → structured 503
    //     (T-98-06-04 / P98-OFF-01: AWS AccessDenied when the policy is
    //     detached; missing/rejected API key or unknown STT_PROVIDER).
    if (err instanceof SttNotConfiguredError || provider?.isUnavailable(err)) {
      const errMessage = err instanceof Error ? err.message : String(err);
      databaseLogger.info(
        `[voice-server] transcribe-unavailable provider=${provider?.id ?? "none"} reason="${errMessage}"`,
        { operation: "voice_transcribe_access_denied", provider: provider?.id },
      );
      // Out of provider credits (e.g. ElevenLabs `quota_exceeded`): tell the
      // user plainly, and that the disk-bank above kept their audio.
      if (err instanceof SttHttpError && /quota/i.test(err.body)) {
        return res.status(503).json({
          error: "voice STT unavailable",
          reason: "quota_exhausted",
          message: "transcription quota exhausted — your audio was saved",
          status: 503,
        });
      }
      return res.status(503).json({ error: "voice STT unavailable", status: 503 });
    }

    // (e) Anything else → 502 (transcode failure, AWS network error, no result stream, ...)
    // Fold error name + message into the log line itself so it lands in
    // console-forward.log (databaseLogger's second-arg Error only reaches
    // container stderr, not the forward stream we grep for diagnosis).
    const errName = err instanceof Error ? err.name : "unknown";
    const errMessage = err instanceof Error ? err.message : String(err);
    databaseLogger.error(
      `[voice-server] transcribe-error provider=${provider?.id ?? "none"} errName=${errName} errMessage="${errMessage}"`,
      err instanceof Error ? err : new Error(String(err)),
      { operation: "voice_transcribe_error", provider: provider?.id, errName },
    );
    return res.status(502).json({ error: "STT error", status: 502 });
  }
}

// --- Shared speak-request helpers ---

/** Most voice candidates a speak request may carry (identity, role, fallback + slack). */
const MAX_VOICE_CANDIDATES = 8;

/**
 * Read the voice candidates from a speak body, in preference order.
 *
 * Accepts `voices: string[]` (the app sends identity voice, role voice, the
 * user's fallback voice) or the older single `voice: string`. Candidates the
 * active provider doesn't offer are skipped later (chooseVoice) — an
 * unavailable voice is NOT an error, so a voice saved under another provider
 * still speaks (in the next available voice). Only malformed input is a 400.
 */
export function parseVoiceCandidates(body: Record<string, unknown>): { candidates: string[] } | { error: string } {
  const raw: unknown[] = [];
  if (body.voices !== undefined) {
    if (!Array.isArray(body.voices) || body.voices.length > MAX_VOICE_CANDIDATES) {
      return { error: `body.voices must be an array of at most ${MAX_VOICE_CANDIDATES} voice ids` };
    }
    raw.push(...body.voices);
  }
  if (body.voice !== undefined) raw.push(body.voice);

  const candidates: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || v.length === 0 || v.length > VOICE_ID_MAX_LEN) {
      return { error: `each voice must be a non-empty string of at most ${VOICE_ID_MAX_LEN} characters` };
    }
    if (!candidates.includes(v)) candidates.push(v);
  }
  return { candidates };
}

function describeChoice(choice: VoiceChoice): string {
  return `voice="${choice.voice}" voiceSource=${choice.source} skipped=[${choice.skipped.map((s) => `"${s}"`).join(",")}] listUnavailable=${choice.listUnavailable}`;
}

/** provider / model / voice for failure log lines (whatever was resolved before the failure). */
function failureContext(provider: TtsProvider | undefined, choice: VoiceChoice | undefined): string {
  return `provider=${provider?.id ?? "none"} model=${provider?.model() ?? "none"} voice="${choice?.voice ?? "none"}"`;
}

/** PCM is always 16-bit mono, so bytes per second = sampleRate × 2. */
function pcmBytesPerSec(provider: TtsProvider): number {
  return provider.sampleRate * 2;
}

// --- Tail guard (see voice/tail-guard.ts) ---
// gpt-4o-mini-tts intermittently drops the final sentence. When the guard
// applies, the last chunk carries a filler sentence that is cut off the PCM
// afterwards; chunks are packed short enough to leave room for it.
function planSpeakChunks(provider: TtsProvider, text: string): { chunks: string[]; plain: string[]; guard: boolean } {
  const guard = tailGuardApplies(provider.id, provider.model());
  // Room for the filler, its leading space and a possibly added period.
  const maxChars = guard
    ? provider.maxCharsPerRequest - TAIL_GUARD_FILLER.length - 2
    : provider.maxCharsPerRequest;
  // `plain` keeps the chunk texts without the filler (rate logs, resume point).
  const plain = packChunks(splitIntoSentences(text), maxChars);
  const chunks = [...plain];
  if (guard && chunks.length > 0) {
    // The cut relies on the sentence-break pause before the filler; text
    // ending on a colon or bare phrase would run straight into it.
    const last = chunks[chunks.length - 1];
    const ended = /[.!?]["'”’)\]]*$/.test(last);
    chunks[chunks.length - 1] = `${last}${ended ? "" : "."} ${TAIL_GUARD_FILLER}`;
  }
  return { chunks, plain, guard };
}

/**
 * Cut the filler off the last chunk's PCM. `pcm` may be the whole chunk or
 * just its held-back tail; returns the bytes to play. Refusal plays untrimmed
 * (filler audible, nothing lost) and is logged so drift in the model's timing
 * shows up in the logs.
 */
function applyTailGuard(pcm: Buffer, provider: TtsProvider, reqId: string): Buffer {
  const d = findTailGuardCut(pcm, provider.sampleRate);
  if (d.decision === "cut") {
    databaseLogger.info(
      `[voice-server] speak-tail-guard reqId=${reqId} decision=cut pauseSec=${d.pauseSec.toFixed(3)} fillerSec=${d.fillerSec.toFixed(3)} trimmedBytes=${pcm.length - d.cutByte}`,
      { operation: "voice_speak_tail_guard", reqId, decision: "cut" },
    );
    return pcm.subarray(0, d.cutByte);
  }
  databaseLogger.warn(
    `[voice-server] speak-tail-guard reqId=${reqId} decision=refused reason=${d.reason} speechEndSec=${d.speechEndSec.toFixed(3)} pcmBytes=${pcm.length}`,
    { operation: "voice_speak_tail_guard", reqId, decision: "refused", reason: d.reason },
  );
  return pcm;
}

// --- handleSpeak — POST /voice/speak (non-streaming) ---
// Used by the voice pickers' sample button. Synthesizes every chunk in order
// and collects the full PCM buffer BEFORE writing the RIFF header so
// `dataSize` in the header is byte-accurate (T-98-06-10 — strict WAV parsers
// like HTMLAudioElement reject the 0xFFFFFFFF streaming sentinel).
export async function handleSpeak(req: Request, res: Response): Promise<Response> {
  // (a) Validate body.text
  if (!req.body || typeof req.body.text !== "string" || req.body.text.length === 0) {
    return res.status(400).json({ error: "body.text is required and must be a non-empty string" });
  }
  if (req.body.text.length > SPEAK_TEXT_MAX) {
    return res.status(400).json({ error: `body.text exceeds maximum length of ${SPEAK_TEXT_MAX}` });
  }

  // (b) Validate voice candidates (shape only — availability is decided below)
  const parsed = parseVoiceCandidates(req.body as Record<string, unknown>);
  if ("error" in parsed) {
    return res.status(400).json({ error: parsed.error });
  }

  const text = req.body.text as string;
  const reqId = Math.random().toString(36).slice(2, 10);

  let provider: TtsProvider | undefined;
  let choice: VoiceChoice | undefined;
  try {
    provider = resolveTtsProvider();
    choice = await chooseVoice(provider, parsed.candidates);

    databaseLogger.info(
      `[voice-server] speak-req reqId=${reqId} provider=${provider.id} model=${provider.model() ?? "none"} textLen=${text.length} ${describeChoice(choice)}`,
      { operation: "voice_speak", reqId, provider: provider.id },
    );

    // (c) Synthesize each ≤maxCharsPerRequest chunk in order and collect the
    //     ENTIRE PCM so pcmBuf.length is known before the RIFF header.
    const { chunks, guard } = planSpeakChunks(provider, text);
    const pcmChunks: Buffer[] = [];
    const voice = choice.voice;
    for (let i = 0; i < chunks.length; i++) {
      // Read in flowing mode so the stall watchdog runs (it never arms under
      // for-await, which reads in paused mode).
      const chunkPcm = await drainStreamToBuffer(
        synthesizeWithRetries(provider, chunks[i], voice, { reqId, chunkIndex: i }),
      );
      pcmChunks.push(guard && i === chunks.length - 1 ? applyTailGuard(chunkPcm, provider, reqId) : chunkPcm);
    }
    const pcmBuf = Buffer.concat(pcmChunks);
    const dataSize = pcmBuf.length;

    // (d) Build the RIFF header with byte-accurate dataSize (T-98-06-10 mitigation)
    const header = buildRiffHeader({
      channels: 1,
      sampleRate: provider.sampleRate,
      bitDepth: 16,
      dataSize,
    });

    databaseLogger.info(
      `[voice-server] speak-ok reqId=${reqId} provider=${provider.id} chunks=${chunks.length} pcmSize=${dataSize} totalSize=${header.length + dataSize}`,
      { operation: "voice_speak", reqId, provider: provider.id },
    );

    res.status(200);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Content-Length", String(header.length + dataSize));
    res.write(header);
    res.end(pcmBuf);
    return res;
  } catch (err: unknown) {
    const errName = err instanceof Error ? err.name : "unknown";
    const errMessage = err instanceof Error ? err.message : String(err);
    // Misconfigured / unauthorised provider → 503 (P98-OFF-01 + unknown
    // TTS_PROVIDER, missing or rejected API key, no credits).
    if (err instanceof TtsNotConfiguredError || provider?.isUnavailable(err)) {
      databaseLogger.info(
        `[voice-server] speak-unavailable reqId=${reqId} ${failureContext(provider, choice)} errName=${errName} reason="${errMessage}"`,
        { operation: "voice_speak_access_denied", reqId, provider: provider?.id },
      );
      return res.status(503).json({ error: "voice TTS unavailable", status: 503 });
    }

    databaseLogger.error(
      `[voice-server] speak-error reqId=${reqId} ${failureContext(provider, choice)} errName=${errName} errMessage="${errMessage}"`,
      err instanceof Error ? err : new Error(String(err)),
      { operation: "voice_speak_error", reqId, provider: provider?.id, errName },
    );
    return res.status(502).json({ error: "TTS error", status: 502 });
  }
}

// --- handleListVoices — GET /voice/voices ---
// The active provider's voice list, for the app's voice pickers. The app
// carries no voice list of its own. `labels` maps every voice id the server
// can name right now (all fixed provider lists + the active list) so the app
// shows saved voices by name, even ones saved under another provider. When
// the list can't be fetched (e.g. ElevenLabs unreachable), answers 200 with
// `listError: true` and an empty list so pickers can still show the saved
// voice and say the list failed; only an unusable provider config answers 503.
export async function handleListVoices(_req: Request, res: Response): Promise<Response> {
  let provider: TtsProvider;
  let defaultVoice: string;
  try {
    provider = resolveTtsProvider();
    defaultVoice = defaultVoiceFor(provider);
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    databaseLogger.info(
      `[voice-server] voice-list-unavailable provider=none reason="${errMessage}"`,
      { operation: "voice_list_unavailable" },
    );
    return res.status(503).json({ error: "voice TTS unavailable", status: 503 });
  }

  try {
    const voices = await getVoiceList(provider);
    return res.status(200).json({ voices, defaultVoice, labels: voiceLabels(voices), listError: false });
  } catch (err: unknown) {
    if (err instanceof TtsNotConfiguredError || provider.isUnavailable(err)) {
      return res.status(503).json({ error: "voice TTS unavailable", status: 503 });
    }
    // getVoiceList already logged the failure with provider + error detail.
    return res.status(200).json({ voices: [], defaultVoice, labels: voiceLabels([]), listError: true });
  }
}

// --- TTS diagnostic bank — WAV-per-chunk fire-and-forget writer + rotation ---
// Purpose: prove/disprove "the provider returned less audio than the text
// should produce" reports (2026-09-28 cutoff investigation). Each speak-stream
// request writes one WAV per chunk to the bank so we can play back exactly
// what came off the provider's wire and hear whether the tail was truncated
// at the provider or lost downstream.
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
  meta: { reqId: string; chunkIndex: number; voiceId: string; textLen: number; sampleRate: number },
): void {
  if (!TTS_BANK_ENABLED) return;
  const pcm = Buffer.concat(pcmChunks);
  const header = buildRiffHeader({
    channels: 1,
    sampleRate: meta.sampleRate,
    bitDepth: 16,
    dataSize: pcm.length,
  });
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const safeVoice = meta.voiceId.replace(/[^A-Za-z0-9_-]/g, "_");
  const filename = `${timestamp}-${meta.reqId}-chunk${meta.chunkIndex}-${safeVoice}-len${meta.textLen}.wav`;
  const fullPath = path.join(TTS_BANK_DIR, filename);
  databaseLogger.info(
    `[voice-server] tts-bank-write reqId=${meta.reqId} chunk=${meta.chunkIndex} filename=${filename} pcmBytes=${pcm.length}`,
    { operation: "voice_tts_bank_write", reqId: meta.reqId, filename },
  );
  void fs.promises
    .mkdir(TTS_BANK_DIR, { recursive: true })
    .then(() => fs.promises.writeFile(fullPath, Buffer.concat([header, pcm])))
    .then(() => rotateTtsBank(TTS_BANK_DIR, TTS_BANK_MAX_FILES))
    .then(() => maybePruneRecordings(TTS_BANK_DIR))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      databaseLogger.warn(
        `[voice-server] tts-bank-write-failed reqId=${meta.reqId} chunk=${meta.chunkIndex} filename=${filename} error=${message}`,
        { operation: "voice_tts_bank_write_failed", reqId: meta.reqId, filename, error: message },
      );
    });
}

// Eagerly consume a provider audio stream into a single contiguous Buffer.
// Used for prefetched chunks (N≥1) so that holding a provider response open
// WITHOUT reading it — while chunk N-1 is still being piped to the client
// at playback rate (~32-48 KB/s) — doesn't let the backpressured socket
// cause the provider to idle-close or stop generating past its send buffer.
//
// Observed symptom (2026-10-02 reqId=ywzjfdk1): chunk 0 was streamed
// directly to res over 31s; chunk 1 was prefetched as a Readable but never
// read during that window. When iteration advanced to chunk 1, its
// AudioStream fired `end` cleanly with only 147,456 bytes (= 144 KiB,
// exactly one socket-buffer-worth) of PCM — 4.6s of audio for a 2559-char
// chunk that should have produced ~5 MB / 2.5 min.
//
// Memory cost: at most one fully-drained chunk is in memory at a time
// (plus the one being written to res, in-memory as `buf`). Each chunk caps
// at the provider's per-request limit (2900-4500 chars); at roughly 2000
// (16 kHz) to 3000 (24 kHz) PCM bytes per char that is ~6-14 MB per chunk.
// Trivial on a multi-GB container.
async function drainStreamToBuffer(
  streamPromise: Promise<import("node:stream").Readable>,
): Promise<Buffer> {
  const stream = await streamPromise;
  const bufs: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (b: Buffer) => bufs.push(b));
    stream.on("end", () => resolve());
    // destroy() without an error (listener hung up, pass abandoned) emits only
    // "close"; callers check why before using the partial buffer.
    stream.on("close", () => resolve());
    stream.on("error", reject);
  });
  return Buffer.concat(bufs);
}

/** Tries per chunk when the provider's audio stream stalls (see watchForStall). */
const STALL_MAX_ATTEMPTS = 3;

/** TTS_FALLBACK_PROVIDER values already warned about (logged once each). */
const warnedFallbackConfig = new Set<string>();

/** What one provider's pass over (part of) a message ended with. */
type SpeakPassOutcome =
  | { kind: "done"; truncated: boolean }
  /**
   * Stopped early; the backup should speak `restText`. Only when hand-off is
   * allowed. `bench` is false when the failure looks specific to this message
   * (e.g. a 400 on its text) rather than the provider being in trouble.
   */
  | { kind: "handoff"; restText: string; reason: string; playedSec: number; bench: boolean };

// --- handleSpeakStream — POST /voice/speak-stream (streaming, chunk-and-stitch) ---
// Splits long text into chunks no longer than the active provider's
// per-request limit (packChunks), fires one synth per chunk, and pipes PCM to
// `res` in chunk order. Chunk 0 streams DIRECTLY from its provider Readable to
// res for lowest time-to-first-audio. Chunks N≥1 are PREFETCHED and EAGERLY
// DRAINED into Buffers via drainStreamToBuffer so the next-chunk response is
// read fully from the socket as it arrives, not held open at backpressure for
// the ~N×30s it takes the preceding chunk to stream to the client. This is the
// 2026-10-02 cutoff fix: previously `nextPromise` kept a Readable in paused
// mode while chunk N-1 drained at playback rate, causing chunks N≥1 to
// truncate at ~144 KiB. See drainStreamToBuffer docstring above.
//
// Concurrency cap: at most 2 open synth operations at once (per Pitfall 5).
// The RIFF header (at the provider's sample rate) is written ONCE at start
// with the 0xFFFFFFFF streaming sentinel (total size unknown at header-write
// time — this IS the case the sentinel exists for; the client-side
// riffPcmDecode ignores dataSize on streaming input).
//
// Backup provider (TTS_FALLBACK_PROVIDER, see voice/tts-fallback.ts): when the
// selected provider fails or stalls, the backup speaks the rest of the
// message in the same response — the whole message if no audio went out yet,
// else from about where the audio stopped (resumeText). The backup's audio is
// resampled to the rate already in the RIFF header. A stall is first retried
// on the selected provider; the backup (paid for separately) speaks only when
// those retries stall too or the provider errors. An outage or key / credit
// error benches the provider so later messages try the backup first. If the
// backup fails too, the selected provider speaks what's left with its full
// stall retries — a backup never makes a message worse off. With no backup
// configured the behaviour is exactly the single-provider one.
//
// Diagnostic instrumentation (2026-09-28): every speak-stream request carries
// a short reqId that ties `speak-stream-plan` → `speak-stream-chunk-out` →
// `speak-stream-ok` log lines together, and each chunk's PCM is banked to disk
// (see writeTtsBankChunk above) so a suspected truncation can be played back
// and heard directly. PCM is 16-bit mono, so audioSec = pcmBytes /
// (sampleRate × 2) and charsPerSec = textLen / audioSec. Anything wildly
// higher than typical English speech (~15 chars/sec) means the provider
// returned less audio than the text should have produced.
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

  // (b) Validate voice candidates (shape only — availability is decided below)
  const parsed = parseVoiceCandidates(req.body as Record<string, unknown>);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const text = req.body.text as string;
  // Short random id to correlate every log line for THIS request. Included
  // in bank filenames so a specific request's chunks can be located on disk.
  const reqId = Math.random().toString(36).slice(2, 10);

  // Track whether we've already flushed the response headers + first bytes.
  // Once true, we cannot send a new status code — mid-stream errors trigger
  // res.destroy() instead of res.status(503).
  let headersFlushed = false;
  // Sample rate in the RIFF header once written; a later provider at another
  // rate is resampled to it.
  let headerRate: number | null = null;
  // Provider / voice of the pass in progress (for failure log lines).
  let provider: TtsProvider | undefined;
  let choice: VoiceChoice | undefined;
  let totalAudioSec = 0;

  // Listener stopped / navigated away: stop asking the provider for audio
  // nobody will hear (paid characters on OpenAI / ElevenLabs). Streams in
  // flight are abandoned; no further chunks are requested.
  let clientGone = false;
  const liveStreams = new Set<import("node:stream").Readable>();
  res.once("close", () => {
    if (res.writableEnded) return;
    clientGone = true;
    for (const s of liveStreams) s.destroy();
  });
  const waitDrain = () =>
    new Promise<void>((resolve) => {
      res.once("drain", resolve);
      res.once("close", resolve);
    });

  // One provider's pass over `passText`. With `canHandOff`, any failure or
  // stall returns a hand-off (what's left to say) instead of retrying the same
  // provider or failing the request; without it, failures behave as they
  // always have (retry a stall while nothing is out, else end / throw).
  // `quickStall` uses the short stall timeout (a healthy provider is waiting).
  const speakPass = async (
    p: TtsProvider,
    passText: string,
    canHandOff: boolean,
    quickStall = canHandOff,
  ): Promise<SpeakPassOutcome> => {
    provider = p;
    choice = undefined;
    const handoff = (restText: string, reason: string, playedSec = 0, bench = true): SpeakPassOutcome => ({
      kind: "handoff",
      restText,
      reason,
      playedSec,
      bench,
    });
    const reasonOf = (err: unknown) =>
      err instanceof TtsStallError ? "stall" : `error:${err instanceof Error ? err.name : "unknown"}`;
    // Provider trouble (outage, throttling, network, key / credit) benches it;
    // anything else is treated as this message's own problem. A stall doesn't
    // bench: OpenAI's stalls are per-request and a fresh request usually works.
    const benchFor = (err: unknown) => p.isRetriable(err) || p.isUnavailable(err);

    try {
      choice = await chooseVoice(p, parsed.candidates);
    } catch (err) {
      if (canHandOff) return handoff(passText, reasonOf(err), 0, benchFor(err));
      throw err;
    }
    const voiceId = choice.voice;

    databaseLogger.info(
      `[voice-server] speak-stream-req reqId=${reqId} provider=${p.id} model=${p.model() ?? "none"} textLen=${passText.length} ${describeChoice(choice)}`,
      { operation: "voice_speak_stream", reqId, provider: p.id },
    );

    // (c) Split + pack into chunks under the provider's per-request limit
    const { chunks, plain, guard } = planSpeakChunks(p, passText);

    if (chunks.length === 0) {
      // Defensive: SPEAK_TEXT_MAX + non-empty-text validation should prevent this,
      // but if we ever end up with zero chunks, return a 400.
      if (!headersFlushed) res.status(400).json({ error: "body.text produced zero synthesizable chunks" });
      return { kind: "done", truncated: false };
    }

    // Log the chunk plan up front so a suspected loss can be traced back to
    // exactly which char range fed which synth call.
    databaseLogger.info(
      `[voice-server] speak-stream-plan reqId=${reqId} provider=${p.id} chunkCount=${chunks.length} chunkLens=[${chunks.map((c) => c.length).join(",")}] totalTextLen=${passText.length} tailGuard=${guard}`,
      { operation: "voice_speak_stream_plan", reqId, chunkCount: chunks.length },
    );

    const bytesPerSec = pcmBytesPerSec(p);
    // Converts this provider's PCM to the header's rate (set once chunk 0 is in).
    let resampler: PcmResampler | null = null;
    const send = (buf: Buffer): boolean => res.write(resampler ? resampler.push(buf) : buf);

    // Chunk 0 stalled after some of its audio was out: end the message there
    // rather than skip ahead to the next chunk's text.
    let truncated = false;
    // Set when this pass is abandoned for the backup: prefetches stop.
    let abandoned = false;
    const stallMs = ttsStallTimeoutMs(process.env, { canHandOff: quickStall });
    const synth = (i: number) => synthesizeWithRetries(p, chunks[i], voiceId, { reqId, chunkIndex: i }, 3, stallMs);
    // Prefetched chunks are drained whole before any of their audio is sent,
    // so a stalled one can always be retried from scratch (or handed off).
    const prefetch = async (i: number): Promise<Buffer> => {
      for (let attempt = 1; ; attempt++) {
        try {
          const stream = await synth(i);
          if (clientGone || abandoned) {
            stream.destroy();
            return Buffer.alloc(0);
          }
          liveStreams.add(stream);
          try {
            return await drainStreamToBuffer(Promise.resolve(stream));
          } finally {
            liveStreams.delete(stream);
          }
        } catch (err: unknown) {
          if (
            canHandOff ||
            !(err instanceof TtsStallError) ||
            attempt >= STALL_MAX_ATTEMPTS ||
            clientGone ||
            truncated ||
            abandoned
          )
            throw err;
          databaseLogger.warn(
            `[voice-server] speak-stall reqId=${reqId} chunk=${i} provider=${p.id} attempt=${attempt}/${STALL_MAX_ATTEMPTS} streamedBytes=0 action=retry`,
            { operation: "voice_speak_stall", reqId, provider: p.id, attempt, action: "retry" },
          );
        }
      }
    };

    // (d) Fire chunk 0 (direct-stream Readable, for lowest TTFA) AND the
    // chunk 1 prefetch (eagerly-drained Buffer) simultaneously, so chunk 1
    // starts synthesizing in parallel with chunk 0's HTTP round-trip.
    // Attach a no-op catch to nextPrefetch immediately so a rejection
    // before we await it doesn't surface as an unhandled rejection —
    // starter.ts's unhandledRejection handler calls process.exit(1), which
    // would kill the container mid-stream and drop every other connected
    // client. The rejection is still re-thrown when the loop awaits.
    const chunk0Promise: Promise<import("node:stream").Readable> = synth(0);
    chunk0Promise.catch(() => {});
    let nextPrefetch: Promise<Buffer> | null = null;
    if (chunks.length > 1) {
      nextPrefetch = prefetch(1);
      nextPrefetch.catch(() => {});
    }
    const abandon = (restText: string, reason: string, playedSec = 0, bench = true): SpeakPassOutcome => {
      abandoned = true;
      for (const s of liveStreams) s.destroy();
      return handoff(restText, reason, playedSec, bench);
    };

    for (let i = 0; i < chunks.length; i++) {
      if (clientGone) break;
      // Rate logs measure the real text only (the filler is cut off the audio).
      const chunkTextLen = plain[i].length;
      const chunkPcmBuffers: Buffer[] = [];
      let chunkPcmBytes = 0;

      if (i === 0) {
        // Chunk 0: direct-stream from the provider to res. Manual
        // data/end/error handling instead of .pipe() so we can (a) count the
        // exact per-chunk PCM byte output and (b) accumulate the bytes for
        // the disk bank. Backpressure preserved by pausing the source when
        // res.write returns false.
        //
        // Await the provider Readable BEFORE flushing the response headers —
        // if the provider throws (AccessDenied, rejected key, out of
        // credits), we need to be able to send a 503 status, which requires
        // headers NOT be flushed yet.
        let currentStream: import("node:stream").Readable;
        try {
          currentStream = await chunk0Promise;
        } catch (err) {
          if (canHandOff && !clientGone) return abandon(passText, reasonOf(err), 0, benchFor(err));
          throw err;
        }
        liveStreams.add(currentStream);
        if (clientGone) {
          currentStream.destroy();
          break;
        }

        // Flush response headers + RIFF header now that chunk 0's response
        // is confirmed (unless an earlier pass already did). Streaming
        // sentinel: total PCM byte count is unknown at header-write time.
        // riffPcmDecode.ts ignores dataSize on streaming input.
        if (headerRate === null) {
          res.status(200);
          res.setHeader("Content-Type", "audio/wav");
          res.setHeader("X-Accel-Buffering", "no");
          res.write(buildRiffHeader({ channels: 1, sampleRate: p.sampleRate, bitDepth: 16 }));
          headersFlushed = true;
          headerRate = p.sampleRate;
        }
        if (headerRate !== p.sampleRate) resampler = new PcmResampler(p.sampleRate, headerRate);

        // Tail guard on a single-chunk request: hold back the last
        // TAIL_GUARD_HOLD_SEC of PCM so the filler can be cut once the
        // provider finishes. Everything older streams through unchanged.
        const holdTail = guard && chunks.length === 1;
        const holdBytes = TAIL_GUARD_HOLD_SEC * bytesPerSec;
        let held: Buffer[] = [];
        let heldBytes = 0;
        // Provider bytes that reached the listener (before any resampling).
        let streamedBytes = 0;
        // Only a cleanly ended stream has the filler at its tail; a provider
        // stream that merely closed was cut short and plays as-is.
        let providerEnded = false;
        const writeOut = (buf: Buffer) => {
          streamedBytes += buf.length;
          if (!send(buf)) {
            const paused = currentStream;
            paused.pause();
            res.once("drain", () => paused.resume());
          }
        };

        // A provider stream that goes quiet (TtsStallError, see watchForStall)
        // is retried from scratch while none of its audio has reached the
        // listener yet — the RIFF header alone commits nothing. Once audio is
        // out, a stall ends the message where it stopped. With a backup ready,
        // either case hands off instead.
        for (let attempt = 1; ; attempt++) {
          let stalled = false;
          let failure: unknown = null;
          const stream = currentStream;
          await new Promise<void>((resolve, reject) => {
            stream.on("data", (buf: Buffer) => {
              if (TTS_BANK_ENABLED) chunkPcmBuffers.push(buf);
              if (!holdTail) {
                writeOut(buf);
                return;
              }
              held.push(buf);
              heldBytes += buf.length;
              while (held.length > 1 && heldBytes - held[0].length >= holdBytes) {
                const out = held.shift()!;
                heldBytes -= out.length;
                writeOut(out);
              }
            });
            stream.on("end", () => {
              providerEnded = true;
              resolve();
            });
            // destroy() on client hang-up ends the stream with "close", not "end".
            stream.on("close", () => resolve());
            stream.on("error", (err) => {
              if (clientGone) return resolve();
              if (err instanceof TtsStallError) {
                stalled = true;
                return resolve();
              }
              if (canHandOff) {
                failure = err;
                return resolve();
              }
              reject(err);
            });
          });
          liveStreams.delete(stream);
          if (clientGone) break;
          if (canHandOff && (stalled || failure !== null)) {
            const playedSec = streamedBytes / bytesPerSec;
            databaseLogger.warn(
              `[voice-server] speak-stall reqId=${reqId} chunk=0 provider=${p.id} attempt=${attempt}/${STALL_MAX_ATTEMPTS} streamedBytes=${streamedBytes} heldBytes=${heldBytes} action=handoff reason=${stalled ? "stall" : reasonOf(failure)}`,
              { operation: "voice_speak_stall", reqId, provider: p.id, attempt, action: "handoff" },
            );
            totalAudioSec += playedSec;
            // Provider pieces can end mid-sample; complete the last sample so
            // the backup's audio starts on the frame grid (the player reads
            // the body as one continuous run of 16-bit samples).
            if (streamedBytes % 2 === 1) res.write(Buffer.alloc(1));
            // A stall or a broken stream mid-body is provider trouble either way.
            return abandon(
              resumeText(plain, 0, playedSec),
              stalled ? "stall" : reasonOf(failure),
              playedSec,
              !stalled,
            );
          }
          if (!stalled) break;

          const retry = streamedBytes === 0 && attempt < STALL_MAX_ATTEMPTS;
          databaseLogger.warn(
            `[voice-server] speak-stall reqId=${reqId} chunk=0 provider=${p.id} attempt=${attempt}/${STALL_MAX_ATTEMPTS} streamedBytes=${streamedBytes} heldBytes=${heldBytes} action=${retry ? "retry" : "end"}`,
            { operation: "voice_speak_stall", reqId, provider: p.id, attempt, action: retry ? "retry" : "end" },
          );
          if (!retry) {
            truncated = true;
            break;
          }
          held = [];
          heldBytes = 0;
          chunkPcmBuffers.length = 0;
          currentStream = await synth(0);
          liveStreams.add(currentStream);
          if (clientGone) {
            currentStream.destroy();
            break;
          }
        }
        if (holdTail && !clientGone && heldBytes > 0) {
          // Provider chunks can split a sample; re-align the held tail to the
          // stream's frame grid before analysing it.
          const tail = Buffer.concat(held, heldBytes);
          const skew = streamedBytes % 2;
          const kept = providerEnded ? applyTailGuard(tail.subarray(skew), p, reqId) : tail.subarray(skew);
          const out = tail.subarray(0, skew + kept.length);
          streamedBytes += out.length;
          if (!send(out)) await waitDrain();
        }
        chunkPcmBytes = streamedBytes;
      } else {
        // Chunks i≥1: fire chunk i+1's prefetch FIRST (so it starts synthesizing
        // in parallel with chunk i's await/write), then await and write the
        // already-drained chunk i Buffer. Concurrency cap 2: only chunk i's
        // prefetch (just-awaited) and chunk i+1's prefetch (just-fired) are
        // open with the provider at the swap point.
        const prevPrefetch = nextPrefetch!;
        nextPrefetch = i + 1 < chunks.length && !clientGone ? prefetch(i + 1) : null;
        if (nextPrefetch) nextPrefetch.catch(() => {});

        let raw: Buffer;
        try {
          raw = await prevPrefetch;
        } catch (err) {
          // Nothing of chunk i is out yet, so the backup starts exactly there.
          if (canHandOff && !clientGone) {
            databaseLogger.warn(
              `[voice-server] speak-stall reqId=${reqId} chunk=${i} provider=${p.id} streamedBytes=0 action=handoff reason=${reasonOf(err)}`,
              { operation: "voice_speak_stall", reqId, provider: p.id, action: "handoff" },
            );
            return abandon(resumeText(plain, i, 0), reasonOf(err), 0, benchFor(err));
          }
          throw err;
        }
        if (clientGone) break;
        if (TTS_BANK_ENABLED) chunkPcmBuffers.push(raw);
        const buf = guard && i === chunks.length - 1 ? applyTailGuard(raw, p, reqId) : raw;
        chunkPcmBytes = buf.length;
        if (!send(buf)) {
          await waitDrain();
        }
      }

      const chunkAudioSec = chunkPcmBytes / bytesPerSec;
      totalAudioSec += chunkAudioSec;
      const chunkCharsPerSec = chunkAudioSec > 0 ? chunkTextLen / chunkAudioSec : 0;
      databaseLogger.info(
        `[voice-server] speak-stream-chunk-out reqId=${reqId} provider=${p.id} i=${i} textLen=${chunkTextLen} pcmBytes=${chunkPcmBytes} audioSec=${chunkAudioSec.toFixed(3)} charsPerSec=${chunkCharsPerSec.toFixed(2)}`,
        { operation: "voice_speak_stream_chunk_out", reqId, i, textLen: chunkTextLen, pcmBytes: chunkPcmBytes },
      );
      writeTtsBankChunk(chunkPcmBuffers, {
        reqId,
        chunkIndex: i,
        voiceId,
        textLen: chunkTextLen,
        sampleRate: p.sampleRate,
      });
      if (truncated) break;
    }
    return { kind: "done", truncated };
  };

  let firstId: string = "none";
  let backupId: string = "none";
  try {
    // Which provider speaks first: the selected one, unless it is benched
    // and a backup is configured.
    let primary: TtsProvider | undefined;
    let primaryErr: unknown;
    try {
      primary = resolveTtsProvider();
    } catch (err) {
      primaryErr = err;
    }
    const fallback = resolveTtsFallback();
    if (fallback.kind === "ignored" && !warnedFallbackConfig.has(fallback.raw)) {
      warnedFallbackConfig.add(fallback.raw);
      databaseLogger.warn(
        `[voice-server] speak-fallback-config-ignored value="${fallback.raw}" reason=${fallback.reason}`,
        { operation: "voice_speak_fallback_config", reason: fallback.reason },
      );
    }
    const backup = fallback.kind === "ok" ? fallback.provider : null;
    backupId = backup?.id ?? "none";

    // A misconfigured TTS_PROVIDER stays an error (as on every other voice
    // route) — the backup covers a provider in trouble, not a broken setting.
    if (!primary) throw primaryErr;

    // The order providers get to speak this message. The backup is paid for
    // separately, so it only speaks when the selected provider can't:
    //   - a stall on the selected provider is retried on it (from about where
    //     the audio stopped) up to STALL_MAX_ATTEMPTS passes before the backup
    //     is asked; any other failure goes to the backup straight away;
    //   - a bench (outage, key / credit trouble — never a stall) only changes
    //     who goes first, it never takes a provider out;
    //   - the selected provider always gets the last word with its full stall
    //     retries, so a message is never worse off for having a backup.
    type SpeakStep = { p: TtsProvider; quickStall: boolean; stallPasses: number };
    let steps: SpeakStep[];
    if (!backup) {
      steps = [{ p: primary, quickStall: false, stallPasses: 1 }];
    } else if (isProviderBenched(primary.id, reqId) && !isProviderBenched(backup.id, reqId)) {
      steps = [
        { p: backup, quickStall: false, stallPasses: 1 },
        { p: primary, quickStall: false, stallPasses: 1 },
      ];
      databaseLogger.info(
        `[voice-server] speak-fallback reqId=${reqId} from=${primary.id} to=${backup.id} reason=benched restTextLen=${text.length} playedSec=0`,
        { operation: "voice_speak_fallback", reqId, from: primary.id, to: backup.id, reason: "benched" },
      );
    } else {
      steps = [
        { p: primary, quickStall: true, stallPasses: STALL_MAX_ATTEMPTS },
        { p: backup, quickStall: false, stallPasses: 1 },
        { p: primary, quickStall: false, stallPasses: 1 },
      ];
    }
    firstId = steps[0].p.id;

    let restText = text;
    let outcome: SpeakPassOutcome = { kind: "done", truncated: false };
    for (let k = 0; k < steps.length; k++) {
      const { p, quickStall, stallPasses } = steps[k];
      const next = steps[k + 1];
      for (let pass = 1; ; pass++) {
        outcome = await speakPass(p, restText, next !== undefined, quickStall);
        if (outcome.kind !== "handoff" || clientGone) break;
        restText = outcome.restText;
        if (restText.length === 0) break;
        const again = outcome.reason === "stall" && pass < stallPasses;
        const to = again ? p : next.p;
        if (outcome.bench) benchProvider(p.id, reqId, outcome.reason);
        databaseLogger.warn(
          `[voice-server] speak-fallback reqId=${reqId} from=${p.id} to=${to.id} reason=${outcome.reason} pass=${pass}/${stallPasses} bench=${outcome.bench} restTextLen=${restText.length} playedSec=${outcome.playedSec.toFixed(3)} headersFlushed=${headersFlushed}`,
          { operation: "voice_speak_fallback", reqId, from: p.id, to: to.id, reason: outcome.reason },
        );
        if (!again) break;
      }
      if (outcome.kind !== "handoff" || clientGone) break;
      if (restText.length === 0) {
        outcome = { kind: "done", truncated: false };
        break;
      }
    }

    if (clientGone) {
      databaseLogger.info(
        `[voice-server] speak-stream-client-gone reqId=${reqId} provider=${firstId} fallback=${backupId} totalAudioSec=${totalAudioSec.toFixed(3)}`,
        { operation: "voice_speak_stream_client_gone", reqId, provider: firstId },
      );
      return;
    }
    if (!headersFlushed && res.headersSent) return; // zero-chunk 400 already answered

    const truncated = outcome.kind === "done" && outcome.truncated;
    const totalCharsPerSec = totalAudioSec > 0 ? text.length / totalAudioSec : 0;
    databaseLogger.info(
      `[voice-server] speak-stream-ok reqId=${reqId} provider=${firstId} finishedBy=${provider?.id ?? "none"} fallback=${backupId} totalTextLen=${text.length} totalAudioSec=${totalAudioSec.toFixed(3)} charsPerSec=${totalCharsPerSec.toFixed(2)} truncated=${truncated}`,
      { operation: "voice_speak_stream", reqId, provider: firstId },
    );

    res.end();
  } catch (err: unknown) {
    const errName = err instanceof Error ? err.name : "unknown";
    const errMessage = err instanceof Error ? err.message : String(err);
    // Misconfigured / unauthorised provider → 503 (if we can still send
    // status) OR destroy() (if bytes flushed). A configured backup has
    // already had its turn by the time an error lands here.
    if (err instanceof TtsNotConfiguredError || provider?.isUnavailable(err)) {
      databaseLogger.info(
        `[voice-server] speak-stream-unavailable reqId=${reqId} ${failureContext(provider, choice)} fallback=${backupId} errName=${errName} reason="${errMessage}" headersFlushed=${headersFlushed}`,
        { operation: "voice_speak_stream_access_denied", reqId, provider: provider?.id, headersFlushed },
      );
      if (!headersFlushed) {
        res.status(503).json({ error: "voice TTS unavailable", status: 503 });
      } else {
        res.destroy();
      }
      return;
    }

    databaseLogger.error(
      `[voice-server] speak-stream-error reqId=${reqId} ${failureContext(provider, choice)} fallback=${backupId} errName=${errName} errMessage="${errMessage}" headersFlushed=${headersFlushed}`,
      err instanceof Error ? err : new Error(String(err)),
      { operation: "voice_speak_stream_error", reqId, provider: provider?.id, errName, headersFlushed },
    );
    if (!headersFlushed) {
      res.status(502).json({ error: "TTS stream error", status: 502 });
    } else {
      res.destroy();
    }
  }
}

// --- handleTtsProviders — GET /voice/providers (admin) ---
// What the server is configured to speak with, for the admin modal's
// read-only Voice section. Mirrors exactly what handleSpeakStream resolves.
export function handleTtsProviders(_req: Request, res: Response): void {
  let primary: { id: string | null; label: string | null; error?: string };
  try {
    const p = resolveTtsProvider();
    primary = { id: p.id, label: TTS_PROVIDER_LABELS[p.id] };
  } catch {
    primary = { id: null, label: null, error: `Unknown service "${(process.env.TTS_PROVIDER ?? "").trim()}"` };
  }
  const fb = resolveTtsFallback();
  const backup =
    fb.kind === "ok"
      ? { id: fb.provider.id, label: TTS_PROVIDER_LABELS[fb.provider.id] }
      : fb.kind === "none"
        ? { id: null, label: null }
        : {
            id: null,
            label: null,
            error:
              fb.reason === "unknown"
                ? `Unknown service "${fb.raw}" — ignored`
                : "Same as the main service — ignored",
          };
  res.status(200).json({ primary, backup });
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

// --- Route: GET /providers (admin) ---
// Read-only: the configured main and backup TTS providers.
router.get(
  "/providers",
  authManager.createAdminMiddleware(),
  (req: Request, res: Response) => {
    handleTtsProviders(req, res);
  },
);

// --- Route: GET /voices ---
// The active TTS provider's voice list for the app's voice pickers.
router.get(
  "/voices",
  authenticateJWT,
  (req: Request, res: Response) => {
    void handleListVoices(req, res);
  },
);

export default router;
