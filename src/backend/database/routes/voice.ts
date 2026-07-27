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

export default router;
