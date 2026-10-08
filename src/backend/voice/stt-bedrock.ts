/**
 * Bedrock (Amazon Nova 2 Sonic) STT provider — the default, and the only
 * provider that keeps audio inside AWS for BAA-covered instances.
 *
 * Wraps the existing `transcribeNovaSonic` adapter unchanged. Nova Sonic only
 * accepts LPCM 16 kHz mono s16le and returns "" on clips under ~3 s, so this
 * provider transcodes WebM → PCM and right-pads short clips first. (The HTTP
 * providers take the browser's WebM directly and skip both steps.)
 */

import { databaseLogger } from "../utils/logger.js";
import { transcribeNovaSonic } from "./nova-sonic-adapter.js";
import { webmToPcm16k, padPcmToMinDuration, MIN_PCM_DURATION_MS } from "./audio-transcode.js";
import { isAwsAccessDenied } from "./aws-errors.js";
import { SttNotConfiguredError } from "./stt-errors.js";
import type { SttInput, SttProvider } from "./stt-provider.js";

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
//                            isUnavailable → 503.
//   ModelErrorException  — content-side rejection; retrying rarely helps.
const RETRIABLE_NOVA_SONIC_ERRORS = new Set<string>([
  "ModelStreamErrorException",
  "InternalServerException",
  "ThrottlingException",
  "ServiceUnavailableException",
]);

/**
 * Bridge the raw multipart audio bytes into a Nova Sonic-accepted format.
 *
 * D-REWIRE + D-AUDIO (109-CONTEXT.md): Production is always WebM/Opus from
 * the browser's MediaRecorder and Nova Sonic on Bedrock accepts only LPCM
 * s16le mono 16 kHz. Single path: WebM → `webmToPcm16k` → padded PCM.
 *
 * @throws when webmToPcm16k fails (route returns 502).
 */
async function transcodeForNovaSonic(buf: Buffer): Promise<Buffer> {
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
  return paddedBuf;
}

export const bedrockSttProvider: SttProvider = {
  id: "bedrock",

  async transcribe(input: SttInput): Promise<string> {
    const pcm = await transcodeForNovaSonic(input.audio);
    return transcribeNovaSonic(pcm);
  },

  isRetriable(err: unknown): boolean {
    const name = (err as { name?: unknown })?.name;
    return typeof name === "string" && RETRIABLE_NOVA_SONIC_ERRORS.has(name);
  },

  isUnavailable(err: unknown): boolean {
    return err instanceof SttNotConfiguredError || isAwsAccessDenied(err);
  },
};
