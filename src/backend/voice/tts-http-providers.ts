/**
 * Hosted TTS providers reached over plain HTTPS, streaming raw PCM back:
 *
 *   openai      POST https://api.openai.com/v1/audio/speech            (24 kHz PCM)
 *   elevenlabs  POST https://api.elevenlabs.io/v1/text-to-speech/{voice}/stream
 *                                                 ?output_format=pcm_24000
 *
 * Both return headerless signed 16-bit LE mono PCM, which the speak routes
 * wrap in the same RIFF header the browser player already parses (the player
 * reads the sample rate from that header, so 24 kHz needs no client change).
 *
 * Uses Node's global fetch (Node ≥ 18); no SDK dependencies. API keys and
 * TTS_MODEL are read at call time so rotating skynet.env + restart is enough.
 *
 * NOTE: unlike Polly, these send message text to a third party. Do not enable
 * them on an instance whose content must stay under an AWS BAA.
 */

import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { TtsHttpError, TtsNetworkError, TtsNotConfiguredError } from "./tts-errors.js";
import type { TtsProvider, TtsProviderId, TtsVoice } from "./tts-provider.js";

/**
 * Time allowed for the provider to START answering (response headers). Not a
 * whole-body timeout: the audio body of a long chunk legitimately streams for
 * minutes under client backpressure.
 */
const RESPONSE_START_TIMEOUT_MS = 60_000;
/** Whole-request timeout for voice-list fetches. */
const VOICE_LIST_TIMEOUT_MS = 10_000;
/** Cap on provider error-body text copied into logs. */
const ERROR_BODY_MAX = 300;

/**
 * Provider error body, made safe for one-line logs: whitespace collapsed (no
 * line breaks splitting a log entry) and truncated. Never sent to clients.
 */
async function errorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return text.replace(/\s+/g, " ").trim().slice(0, ERROR_BODY_MAX);
}

function readApiKey(provider: TtsProviderId, envName: string): string {
  const key = process.env[envName]?.trim();
  if (!key) {
    throw new TtsNotConfiguredError(`TTS_PROVIDER=${provider} but ${envName} is not set`);
  }
  return key;
}

function modelOr(defaultModel: string): string {
  return process.env.TTS_MODEL?.trim() || defaultModel;
}

/**
 * POST and hand back the response once headers arrive. Non-2xx → TtsHttpError
 * (with a truncated body for logs); no response at all → TtsNetworkError.
 */
async function postForAudio(
  provider: TtsProviderId,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Readable> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("response-start timeout")), RESPONSE_START_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    throw new TtsNetworkError(provider, err);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new TtsHttpError(provider, res.status, await errorBody(res));
  }
  if (!res.body) {
    throw new Error(`${provider} TTS response had no body`);
  }
  return Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
}

/**
 * A 429 that means "out of credit", not "slow down": OpenAI reports exhausted
 * quota as 429 insufficient_quota, ElevenLabs as quota_exceeded. Retrying
 * can't help, so it's treated as unavailable.
 */
function isQuotaExhausted(err: TtsHttpError): boolean {
  return err.status === 429 && /insufficient_quota|quota_exceeded/i.test(err.body);
}

/** 429 / 5xx, or a network-level failure / response-start timeout. */
function isRetriableHttpError(err: unknown): boolean {
  if (err instanceof TtsNetworkError) return true;
  if (!(err instanceof TtsHttpError) || isQuotaExhausted(err)) return false;
  return err.status === 429 || err.status >= 500;
}

/** Missing key, or the provider rejecting our key / account (incl. no credits). */
function isUnavailableHttpError(err: unknown): boolean {
  if (err instanceof TtsNotConfiguredError) return true;
  if (!(err instanceof TtsHttpError)) return false;
  return err.status === 401 || err.status === 402 || err.status === 403 || isQuotaExhausted(err);
}

// --- OpenAI -------------------------------------------------------------------

/**
 * OpenAI's built-in voices. Fixed by OpenAI (no list endpoint). The older
 * tts-1 / tts-1-hd models support a subset; with TTS_MODEL pointing at one of
 * those, the extra voices fail loudly at speak time rather than silently.
 */
const OPENAI_VOICES: readonly TtsVoice[] = [
  "alloy", "ash", "ballad", "cedar", "coral", "echo", "fable",
  "marin", "nova", "onyx", "sage", "shimmer", "verse",
].map((id) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) }));

const OPENAI_VOICE_IDS = new Set(OPENAI_VOICES.map((v) => v.id));
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini-tts";

export const openAiTtsProvider: TtsProvider = {
  id: "openai",
  // OpenAI's `pcm` response format is fixed at 24 kHz.
  sampleRate: 24000,
  // Documented input cap is 4096 characters per request.
  maxCharsPerRequest: 4000,
  defaultVoiceId: "marin",
  model: () => modelOr(OPENAI_DEFAULT_MODEL),
  staticVoices: OPENAI_VOICES,
  listVoices: async () => [...OPENAI_VOICES],
  isOwnVoiceId: (id) => OPENAI_VOICE_IDS.has(id),
  // async so a missing key rejects (never throws synchronously).
  synthesize: async (text, voiceId) =>
    postForAudio(
      "openai",
      "https://api.openai.com/v1/audio/speech",
      { Authorization: `Bearer ${readApiKey("openai", "OPENAI_API_KEY")}` },
      { model: modelOr(OPENAI_DEFAULT_MODEL), input: text, voice: voiceId, response_format: "pcm" },
    ),
  isRetriable: isRetriableHttpError,
  isUnavailable: isUnavailableHttpError,
};

// --- ElevenLabs ---------------------------------------------------------------

/** ElevenLabs voice ids are 20-character alphanumeric codes. */
const ELEVENLABS_VOICE_ID_RE = /^[A-Za-z0-9]{20}$/;
const ELEVENLABS_DEFAULT_MODEL = "eleven_multilingual_v2";

/**
 * ElevenLabs names read "Sarah - Mature, Reassuring, Confident"; split the
 * part after the first " - " off as the description.
 */
function splitElevenLabsName(full: string): { name: string; description?: string } {
  const idx = full.indexOf(" - ");
  if (idx <= 0) return { name: full };
  return { name: full.slice(0, idx), description: full.slice(idx + 3) };
}

async function listElevenLabsVoices(): Promise<TtsVoice[]> {
  const apiKey = readApiKey("elevenlabs", "ELEVENLABS_API_KEY");
  let res: Response;
  try {
    res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(VOICE_LIST_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    throw new TtsNetworkError("elevenlabs", err);
  }
  if (!res.ok) {
    throw new TtsHttpError("elevenlabs", res.status, await errorBody(res));
  }
  const json = (await res.json()) as { voices?: Array<{ voice_id?: unknown; name?: unknown }> };
  if (!Array.isArray(json.voices)) {
    throw new Error(`elevenlabs voice list response missing "voices" array`);
  }
  const voices: TtsVoice[] = [];
  for (const v of json.voices) {
    if (typeof v.voice_id !== "string" || typeof v.name !== "string") continue;
    voices.push({ id: v.voice_id, ...splitElevenLabsName(v.name) });
  }
  return voices;
}

export const elevenLabsTtsProvider: TtsProvider = {
  id: "elevenlabs",
  sampleRate: 24000,
  // Under every current TTS model's per-request cap (the tightest is 5000).
  maxCharsPerRequest: 4500,
  // "River – Relaxed, Neutral, Informative" — a standard voice, so present
  // on every ElevenLabs account.
  defaultVoiceId: "SAz9YHcvj6GT2YYXdXww",
  model: () => modelOr(ELEVENLABS_DEFAULT_MODEL),
  listVoices: listElevenLabsVoices,
  isOwnVoiceId: (id) => ELEVENLABS_VOICE_ID_RE.test(id),
  synthesize: async (text, voiceId) =>
    postForAudio(
      "elevenlabs",
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=pcm_24000`,
      { "xi-api-key": readApiKey("elevenlabs", "ELEVENLABS_API_KEY") },
      { text, model_id: modelOr(ELEVENLABS_DEFAULT_MODEL) },
    ),
  isRetriable: isRetriableHttpError,
  isUnavailable: isUnavailableHttpError,
};
