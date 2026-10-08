/**
 * Amazon Polly as a TtsProvider — the default, and the pre-existing
 * behaviour byte-for-byte: generative engine, 16 kHz PCM, the seven
 * generative en-US voices, ≤2900-char requests (see polly-adapter.ts,
 * polly-voice-catalog.ts, chunk-and-stitch.ts for the locked Phase 98
 * decisions this wraps).
 */

import { synthesizeToPcm } from "./polly-adapter.js";
import { POLLY_VOICES, POLLY_VOICE_IDS } from "./polly-voice-catalog.js";
import { CHUNK_MAX_CHARS } from "./chunk-and-stitch.js";
import { isAwsAccessDenied } from "./aws-errors.js";
import { TtsNotConfiguredError } from "./tts-errors.js";
import type { TtsProvider } from "./tts-provider.js";

/** AWS exception names that mean "try again shortly". */
const RETRIABLE_AWS_NAMES = new Set([
  "ThrottlingException",
  "ServiceFailureException",
  "ServiceUnavailableException",
  "RequestTimeout",
  "TimeoutError",
]);

function isRetriablePollyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (RETRIABLE_AWS_NAMES.has(err.name)) return true;
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return status === 429 || (typeof status === "number" && status >= 500);
}

const POLLY_TTS_VOICES = POLLY_VOICES.map((v) => ({ id: v.voiceId, name: v.displayName }));

export const pollyTtsProvider: TtsProvider = {
  id: "polly",
  sampleRate: 16000,
  maxCharsPerRequest: CHUNK_MAX_CHARS,
  defaultVoiceId: "Joanna",
  model: () => "generative",
  staticVoices: POLLY_TTS_VOICES,
  listVoices: async () => [...POLLY_TTS_VOICES],
  isOwnVoiceId: (id) => POLLY_VOICE_IDS.has(id),
  synthesize: (text, voiceId) => synthesizeToPcm(text, voiceId),
  isRetriable: isRetriablePollyError,
  isUnavailable: (err) => err instanceof TtsNotConfiguredError || isAwsAccessDenied(err),
};
