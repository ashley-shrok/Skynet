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

/** Longest Skynet clip is ~2 min; batch APIs answer in seconds. */
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
    throw new SttNotConfiguredError(
      `STT_PROVIDER=${spec.id} but ${spec.apiKeyEnv} is not set`,
    );
  }
  return key;
}

async function transcribeOverHttp(spec: HttpProviderSpec, input: SttInput): Promise<string> {
  const apiKey = readApiKey(spec);
  const model = process.env.STT_MODEL?.trim() || spec.defaultModel;
  const language = process.env.STT_LANGUAGE?.trim() || undefined;

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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

/** 429 / 5xx, request timeout, or a network-level fetch failure. */
function isRetriableHttpError(err: unknown): boolean {
  if (err instanceof SttNetworkError) return true;
  return err instanceof SttHttpError && (err.status === 429 || err.status >= 500);
}

/** Missing key / unknown provider, or the provider rejecting our key. */
function isUnavailableHttpError(err: unknown): boolean {
  if (err instanceof SttNotConfiguredError) return true;
  return err instanceof SttHttpError && (err.status === 401 || err.status === 403);
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
