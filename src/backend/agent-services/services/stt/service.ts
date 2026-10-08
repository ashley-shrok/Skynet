/**
 * stt — speech to text. The agent sends an audio file and gets the
 * transcript back.
 *
 * Transcription goes through the instance's existing STT provider
 * (src/backend/voice/stt-provider.ts), the same one voice input uses:
 * STT_PROVIDER picks bedrock (default), elevenlabs, mistral or groq, with
 * the same keys, STT_MODEL and STT_LANGUAGE. No separate provider config.
 *
 * Agent side: substrate/scripts/stt (wrapper over fleet-service) and
 * substrate/skills/stt/SKILL.md.
 *
 * Limits: 4 requests in flight, a fleet-wide requests-per-minute cap from
 * SKYNET_STT_RPM (default 30), 25 MB per file (same cap as voice input), and
 * a 2-minute queue TTL. The helper waits 9 minutes, under Claude Code's
 * 10-minute Bash-tool limit.
 */

import { z } from "zod";
import { defineService, fail, ok } from "../../engine/types.js";
import {
  resolveSttProvider,
  transcribeWithRetries,
  type SttInput,
  type SttProvider,
} from "../../../voice/stt-provider.js";
import { SttNotConfiguredError } from "../../../voice/stt-errors.js";

/** Same cap as POST /voice/transcribe uploads. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Per-attempt timeout for the HTTP providers. Up to 3 attempts, so the
 * worst case (2 min queued + 3 × 2 min) stays under the helper's 9 min.
 */
export const STT_ATTEMPT_TIMEOUT_MS = 2 * 60 * 1000;

const MIME_BY_EXT: Record<string, string> = {
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};

/** Formats every provider accepts (Bedrock transcodes them with ffmpeg). */
export const AUDIO_EXTENSIONS = Object.keys(MIME_BY_EXT);

/** No options: model and language are instance settings (STT_MODEL, STT_LANGUAGE). */
export const sttInput = z.strictObject({});

/** SKYNET_STT_RPM, default 30, floor 1. */
export function sttRpmFromEnv(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = parseInt(env.SKYNET_STT_RPM ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export interface SttServiceDeps {
  resolveProvider?: () => SttProvider;
  transcribe?: (provider: SttProvider, input: SttInput) => Promise<string>;
}

export function createSttService({
  resolveProvider = () => resolveSttProvider(),
  transcribe = transcribeWithRetries,
}: SttServiceDeps = {}) {
  return defineService({
    name: "stt",
    description: "Transcribe an audio file with the instance's STT provider",
    input: sttInput,
    attachments: {
      audio: {
        extensions: AUDIO_EXTENSIONS,
        maxBytes: MAX_AUDIO_BYTES,
        required: true,
      },
    },
    ttlMs: 2 * 60 * 1000,
    concurrency: 4,
    rateLimitPerMinute: () => sttRpmFromEnv(),

    async handle(_input, ctx) {
      const audio = ctx.attachments.audio;
      let provider: SttProvider | undefined;
      const start = ctx.now();
      try {
        provider = resolveProvider();
        const text = await transcribe(provider, {
          audio: audio.bytes,
          mimetype: MIME_BY_EXT[audio.ext] ?? "application/octet-stream",
          ext: audio.ext,
          timeoutMs: STT_ATTEMPT_TIMEOUT_MS,
        });
        return ok({
          text,
          provider: provider.id,
          audio_bytes: audio.bytes.byteLength,
          transcription_time_ms: ctx.now() - start,
        });
      } catch (err) {
        // Provider errors can carry response bodies; keep them in the
        // backend log and give the agent a code plus a fixed message.
        ctx.log.warn("stt: transcription failed", {
          provider: provider?.id,
          errName: err instanceof Error ? err.name : "unknown",
          errMessage: err instanceof Error ? err.message : String(err),
        });
        if (
          err instanceof SttNotConfiguredError ||
          provider?.isUnavailable(err)
        ) {
          return fail(
            "not_configured",
            "the backend's speech-to-text provider is not configured or rejected its credentials",
          );
        }
        if (provider?.isRetriable(err)) {
          return fail(
            "provider_unavailable",
            "the speech-to-text provider is busy or unreachable",
          );
        }
        return fail(
          "transcription_failed",
          "the speech-to-text provider could not transcribe this file",
        );
      }
    },
  });
}

export default createSttService();
