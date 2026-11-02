/**
 * Hosted STT providers reached over plain HTTPS multipart upload:
 *
 *   elevenlabs  POST https://api.elevenlabs.io/v1/speech-to-text      (Scribe v2)
 *   mistral     POST https://api.mistral.ai/v1/audio/transcriptions   (Voxtral)
 *   groq        POST https://api.groq.com/openai/v1/audio/transcriptions (Whisper)
 *
 * All three accept the browser's WebM/Opus (and Safari's MP4) as-is, so no
 * transcode or silence padding — the whole clip goes up in one request and
 * comes back in roughly a second, versus Nova Sonic's 5x-real-time feed.
 *
 * Uses Node's global fetch/FormData/Blob (Node ≥ 18); no SDK dependencies.
 * API keys are read at call time so rotating skynet.env + restart is enough.
 *
 * NOTE: unlike the Bedrock provider, these send audio to a third party. Do
 * not enable them on an instance whose audio must stay under an AWS BAA.
 */

import { SttHttpError, SttNetworkError, SttNotConfiguredError } from "./stt-errors.js";
import type { SttInput, SttProvider, SttProviderId } from "./stt-provider.js";

/**
 * Default per-request timeout. The longest dictated clip is ~2 min and batch
 * APIs answer in seconds; callers with longer audio pass `input.timeoutMs`.
 */
const REQUEST_TIMEOUT_MS = 60_000;
/** Cap on provider error-body text copied into logs. */
const ERROR_BODY_MAX = 500;

interface HttpProviderSpec {
  id: SttProviderId;
  url: string;
  apiKeyEnv: string;
  defaultModel: string;
  /** Auth header(s) for the given key. */
  authHeaders(apiKey: string): Record<string, string>;
  /** Provider-specific form fields besides the file. */
  formFields(model: string, language: string | undefined): Record<string, string>;
}

function readApiKey(spec: HttpProviderSpec): string {
  const key = process.env[spec.apiKeyEnv]?.trim();
  if (!key) {
    throw new SttNotConfiguredError(`${spec.id} STT needs ${spec.apiKeyEnv}, which is not set`);
  }
  return key;
}

async function transcribeOverHttp(spec: HttpProviderSpec, input: SttInput): Promise<string> {
  const apiKey = readApiKey(spec);
  // STT_MODEL names a model of the SELECTED provider; a backup
  // (STT_FALLBACK_PROVIDER) always uses its own default.
  const selected = (process.env.STT_PROVIDER ?? "").trim().toLowerCase() === spec.id;
  const model = (selected && process.env.STT_MODEL?.trim()) || spec.defaultModel;
  const language =
    input.language?.trim() || process.env.STT_LANGUAGE?.trim() || undefined;

  const form = new FormData();
  for (const [k, v] of Object.entries(spec.formFields(model, language))) {
    form.append(k, v);
  }
  // Providers sniff the container from the filename extension, so keep it
  // accurate (webm/mp4/ogg/...). Blob type carries the full mimetype.
  // Uint8Array copy: Blob's typings reject Buffer's ArrayBufferLike backing.
  const blob = new Blob([new Uint8Array(input.audio)], { type: input.mimetype });
  form.append("file", blob, `audio.${input.ext}`);

  let res: Response;
  try {
    res = await fetch(spec.url, {
      method: "POST",
      headers: spec.authHeaders(apiKey),
      body: form,
      signal: AbortSignal.timeout(input.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    // fetch rejects with TypeError("fetch failed") on DNS/socket errors and
    // with TimeoutError when AbortSignal.timeout fires.
    throw new SttNetworkError(spec.id, err);
  }

  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, ERROR_BODY_MAX);
    throw new SttHttpError(spec.id, res.status, body);
  }

  const json = (await res.json()) as { text?: unknown };
  if (typeof json.text !== "string") {
    throw new Error(`${spec.id} STT response missing "text" field`);
  }
  return json.text.trim();
}

/**
 * A 429 that means "out of credit", not "slow down" (ElevenLabs
 * quota_exceeded, OpenAI-style insufficient_quota). Retrying can't help, so
 * it's treated as unavailable — same rule as the TTS providers.
 */
function isQuotaExhausted(err: SttHttpError): boolean {
  return err.status === 429 && /insufficient_quota|quota_exceeded/i.test(err.body);
}

/** 429 / 5xx, request timeout, or a network-level fetch failure. */
function isRetriableHttpError(err: unknown): boolean {
  if (err instanceof SttNetworkError) return true;
  if (!(err instanceof SttHttpError) || isQuotaExhausted(err)) return false;
  return err.status === 429 || err.status >= 500;
}

/** Missing key / unknown provider, or the provider rejecting our key / account (incl. no credit). */
function isUnavailableHttpError(err: unknown): boolean {
  if (err instanceof SttNotConfiguredError) return true;
  if (!(err instanceof SttHttpError)) return false;
  return err.status === 401 || err.status === 402 || err.status === 403 || isQuotaExhausted(err);
}

function makeHttpProvider(spec: HttpProviderSpec): SttProvider {
  return {
    id: spec.id,
    transcribe: (input) => transcribeOverHttp(spec, input),
    isRetriable: isRetriableHttpError,
    isUnavailable: isUnavailableHttpError,
  };
}

export const elevenLabsSttProvider = makeHttpProvider({
  id: "elevenlabs",
  url: "https://api.elevenlabs.io/v1/speech-to-text",
  apiKeyEnv: "ELEVENLABS_API_KEY",
  defaultModel: "scribe_v2",
  authHeaders: (apiKey) => ({ "xi-api-key": apiKey }),
  formFields: (model, language) => ({
    model_id: model,
    // Default is to inline "(laughter)"/"(music)" cues — noise in a prompt.
    tag_audio_events: "false",
    ...(language ? { language_code: language } : {}),
  }),
});

export const mistralSttProvider = makeHttpProvider({
  id: "mistral",
  url: "https://api.mistral.ai/v1/audio/transcriptions",
  apiKeyEnv: "MISTRAL_API_KEY",
  defaultModel: "voxtral-mini-latest",
  authHeaders: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  formFields: (model, language) => ({
    model,
    ...(language ? { language } : {}),
  }),
});

export const groqSttProvider = makeHttpProvider({
  id: "groq",
  url: "https://api.groq.com/openai/v1/audio/transcriptions",
  apiKeyEnv: "GROQ_API_KEY",
  defaultModel: "whisper-large-v3-turbo",
  authHeaders: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  formFields: (model, language) => ({
    model,
    response_format: "json",
    temperature: "0",
    ...(language ? { language } : {}),
  }),
});
