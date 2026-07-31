import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import multer from "multer";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

// Patch #155: POST /voice/transcribe — authenticated reverse-proxy to tailnet
// faster-whisper STT service on GigaAshleyPC.
//
// The production ComposeBox runs on the public internet and cannot reach the
// tailnet STT directly. This route acts as the authenticated reverse-proxy hop:
//   browser → nginx → this handler → STT (tailnet) → transcript JSON → client
//
// Security posture (per threat model T-16-*):
//   T-16-01: multer 25 MB fileSize cap prevents memory exhaustion
//   T-16-02: AbortController 30s timeout prevents hung threads
//   T-16-03: non-2xx responses return a fixed {error, status} shape — no STT body leak
//   T-16-04: authenticateJWT is wired BEFORE multer — unauthenticated = 401 before parse
//   T-16-05: client multipart is parsed by multer into req.file.buffer, then a FRESH
//             FormData is constructed for the STT request — no content-type smuggling

// --- Locked STT endpoint (Nelly-verified live, 2026-07-27) ---
const STT_URL = "http://100.80.122.111:8000/v1/audio/transcriptions";

// --- Patch #223: TTS endpoints (Chatterbox on tailnet) ---
const TTS_URL = "http://100.80.122.111:8001/v1/audio/speech";
const VOICES_URL = "http://100.80.122.111:8001/get_predefined_voices";
export const DEFAULT_VOICE = "Elena.wav";
export const SPEAK_TEXT_MAX = 25000;
export const SAMPLE_PHRASE = "Hi, this is your voice.";
const VOICE_FILENAME_RE = /^[A-Z][A-Za-z]+\.wav$/;

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

  // (b) Build a fresh FormData for the STT request
  // multer parsed the incoming multipart into file.buffer; we re-construct
  // a new multipart to send to STT — no client Content-Type header reaches STT.
  const formData = new FormData();
  // Copy the Buffer into a fresh ArrayBuffer so TypeScript's BlobPart constraint
  // is satisfied — Buffer.buffer is ArrayBufferLike (includes SharedArrayBuffer),
  // but Blob only accepts ArrayBuffer explicitly.
  const arrayBuf: ArrayBuffer = file.buffer.buffer.slice(
    file.buffer.byteOffset,
    file.buffer.byteOffset + file.buffer.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuf], { type: file.mimetype });
  formData.append("file", blob, `clip.${ext}`);

  // (c) AbortController: T-16-02 mitigation — 30-second STT timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    // (d) Forward to tailnet STT
    const response = await fetch(STT_URL, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    // (e) Clear timeout on completion
    clearTimeout(timeoutId);

    // (f) Non-2xx: return fixed error shape — T-16-03 (no STT body leak)
    if (!response.ok) {
      return res.status(response.status).json({
        error: "STT non-2xx",
        status: response.status,
      });
    }

    // (g) 2xx: forward STT JSON verbatim
    const sttJson = await response.json() as unknown;
    return res.status(200).json(sttJson);
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    // (h) AbortError → 504 timeout
    if (
      err instanceof DOMException && err.name === "AbortError"
    ) {
      databaseLogger.error("Voice STT request timed out", err, {
        operation: "voice_transcribe_timeout",
      });
      return res.status(504).json({ error: "STT timeout", status: 504 });
    }

    // Anything else → 502 proxy error
    databaseLogger.error("Voice STT proxy error", err, {
      operation: "voice_transcribe_proxy",
    });
    return res.status(502).json({ error: "STT proxy error", status: 502 });
  }
}

// --- Patch #223: handleSpeak — POST /voice/speak reverse-proxy to Chatterbox TTS ---
export async function handleSpeak(req: Request, res: Response): Promise<Response> {
  // (a) Validate body.text: must be a non-empty string within SPEAK_TEXT_MAX
  if (!req.body || typeof req.body.text !== "string" || req.body.text.length === 0) {
    return res.status(400).json({ error: "body.text is required and must be a non-empty string" });
  }
  if (req.body.text.length > SPEAK_TEXT_MAX) {
    return res.status(400).json({ error: `body.text exceeds maximum length of ${SPEAK_TEXT_MAX}` });
  }

  // (b) Validate body.voice if provided
  if (req.body.voice !== undefined) {
    if (typeof req.body.voice !== "string" || !VOICE_FILENAME_RE.test(req.body.voice)) {
      return res.status(400).json({ error: "body.voice must match [A-Z][A-Za-z]+\\.wav" });
    }
  }

  // (c) AbortController: 30-second TTS timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    // (d) Forward to tailnet Chatterbox TTS
    const response = await fetch(TTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tts-1",
        input: req.body.text,
        voice: req.body.voice ?? DEFAULT_VOICE,
      }),
      signal: controller.signal,
    });

    // (e) Clear timeout
    clearTimeout(timeoutId);

    // (f) Non-2xx: return fixed error shape — no upstream body leak (T-16-03 analog)
    if (!response.ok) {
      return res.status(response.status).json({
        error: "TTS non-2xx",
        status: response.status,
      });
    }

    // (g) 2xx: pipe wav bytes back
    const buf = Buffer.from(await response.arrayBuffer());
    res.status(200).set("Content-Type", "audio/wav");
    res.end(buf);
    return res;
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    // (h) AbortError → 504 timeout
    if (err instanceof DOMException && err.name === "AbortError") {
      databaseLogger.error("Voice TTS speak request timed out", err, {
        operation: "voice_speak_timeout",
      });
      return res.status(504).json({ error: "TTS timeout", status: 504 });
    }

    databaseLogger.error("Voice TTS speak proxy error", err, {
      operation: "voice_speak_proxy",
    });
    return res.status(502).json({ error: "TTS proxy error", status: 502 });
  }
}

// --- Patch #223: handleListVoices — GET /voice/voices ---
export async function handleListVoices(req: Request, res: Response): Promise<Response> {
  void req;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(VOICES_URL, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return res.status(response.status).json({
        error: "voices non-2xx",
        status: response.status,
      });
    }

    const data = await response.json() as unknown;
    return res.status(200).json(data);
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    if (err instanceof DOMException && err.name === "AbortError") {
      databaseLogger.error("Voice list voices request timed out", err, {
        operation: "voice_list_voices_timeout",
      });
      return res.status(504).json({ error: "voices timeout", status: 504 });
    }

    databaseLogger.error("Voice list voices proxy error", err, {
      operation: "voice_list_voices_proxy",
    });
    return res.status(502).json({ error: "voices proxy error", status: 502 });
  }
}

// --- Route: POST /transcribe ---
// Middleware chain: authenticateJWT (401 if unauth) → upload.single("file") (parses multipart)
// → handleTranscribe (forwards to STT, returns transcript)
router.post(
  "/transcribe",
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

// --- Route: GET /voices ---
router.get(
  "/voices",
  authenticateJWT,
  (req: Request, res: Response) => {
    void handleListVoices(req, res);
  },
);

export default router;
