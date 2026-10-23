/**
 * Hosted TTS providers reached over plain HTTPS, streaming raw PCM back:
 *
 *   openai      POST https://api.openai.com/v1/audio/speech            (24 kHz PCM)
 *   elevenlabs  POST https://api.elevenlabs.io/v1/text-to-speech/{voice}/stream
 *                                                 ?output_format=pcm_24000
 *   gemini      POST https://generativelanguage.googleapis.com/v1beta/interactions
 *                                                 (SSE, base64 24 kHz PCM deltas)
 *
 * All return headerless signed 16-bit LE mono PCM (Gemini's arrives base64'd
 * inside server-sent events and is decoded here), which the speak routes
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

/** TTS_MODEL applies to the selected provider only; as a backup, a provider uses its default. */
function modelOr(provider: TtsProviderId, defaultModel: string): string {
  const selected = (process.env.TTS_PROVIDER ?? "").trim().toLowerCase() === provider;
  return (selected && process.env.TTS_MODEL?.trim()) || defaultModel;
}

/**
 * POST and hand back the response once headers arrive. Non-2xx → TtsHttpError
 * (with a truncated body for logs); no response at all → TtsNetworkError.
 */
async function postJson(
  provider: TtsProviderId,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("response-start timeout")), RESPONSE_START_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
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
  return res;
}

/** postJson for providers whose response body IS the PCM. */
async function postForAudio(
  provider: TtsProviderId,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Readable> {
  const res = await postJson(provider, url, headers, body);
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
  model: () => modelOr("openai", OPENAI_DEFAULT_MODEL),
  staticVoices: OPENAI_VOICES,
  listVoices: async () => [...OPENAI_VOICES],
  isOwnVoiceId: (id) => OPENAI_VOICE_IDS.has(id),
  // async so a missing key rejects (never throws synchronously).
  synthesize: async (text, voiceId) =>
    postForAudio(
      "openai",
      "https://api.openai.com/v1/audio/speech",
      { Authorization: `Bearer ${readApiKey("openai", "OPENAI_API_KEY")}` },
      { model: modelOr("openai", OPENAI_DEFAULT_MODEL), input: text, voice: voiceId, response_format: "pcm" },
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
  model: () => modelOr("elevenlabs", ELEVENLABS_DEFAULT_MODEL),
  listVoices: listElevenLabsVoices,
  isOwnVoiceId: (id) => ELEVENLABS_VOICE_ID_RE.test(id),
  synthesize: async (text, voiceId) =>
    postForAudio(
      "elevenlabs",
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=pcm_24000`,
      { "xi-api-key": readApiKey("elevenlabs", "ELEVENLABS_API_KEY") },
      { text, model_id: modelOr("elevenlabs", ELEVENLABS_DEFAULT_MODEL) },
    ),
  isRetriable: isRetriableHttpError,
  isUnavailable: isUnavailableHttpError,
};

// --- Google Gemini ------------------------------------------------------------

/** Gemini's prebuilt voices. Fixed by Google (no list endpoint). */
const GEMINI_VOICES: readonly TtsVoice[] = (
  [
    ["Achernar", "Soft"], ["Achird", "Friendly"], ["Algenib", "Gravelly"], ["Algieba", "Smooth"],
    ["Alnilam", "Firm"], ["Aoede", "Breezy"], ["Autonoe", "Bright"], ["Callirrhoe", "Easy-going"],
    ["Charon", "Informative"], ["Despina", "Smooth"], ["Enceladus", "Breathy"], ["Erinome", "Clear"],
    ["Fenrir", "Excitable"], ["Gacrux", "Mature"], ["Iapetus", "Clear"], ["Kore", "Firm"],
    ["Laomedeia", "Upbeat"], ["Leda", "Youthful"], ["Orus", "Firm"], ["Puck", "Upbeat"],
    ["Pulcherrima", "Forward"], ["Rasalgethi", "Informative"], ["Sadachbia", "Lively"],
    ["Sadaltager", "Knowledgeable"], ["Schedar", "Even"], ["Sulafat", "Warm"], ["Umbriel", "Easy-going"],
    ["Vindemiatrix", "Gentle"], ["Zephyr", "Bright"], ["Zubenelgenubi", "Casual"],
  ] as const
).map(([id, description]) => ({ id, name: id, description }));

const GEMINI_VOICE_IDS = new Set(GEMINI_VOICES.map((v) => v.id));
const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash-tts";
const GEMINI_SAMPLE_RATE = 24000;

/** Gemini error codes (SSE `error` events) → the HTTP status they'd carry. */
const GEMINI_ERROR_STATUS: Record<string, number> = {
  invalid_argument: 400,
  invalid_request: 400,
  unauthenticated: 401,
  permission_denied: 403,
  not_found: 404,
  resource_exhausted: 429,
  internal: 500,
  unavailable: 503,
  gateway_timeout: 504,
  deadline_exceeded: 504,
};

interface GeminiEvent {
  event_type?: string;
  delta?: { type?: string; data?: unknown; mime_type?: unknown };
  error?: { message?: unknown; code?: unknown; status?: unknown };
}

/** Parse an SSE body into its JSON `data:` payloads; stops at `[DONE]`. */
async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<GeminiEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let sep: RegExpExecArray | null;
      while ((sep = /\r?\n\r?\n/.exec(buf))) {
        const block = buf.slice(0, sep.index);
        buf = buf.slice(sep.index + sep[0].length);
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data === "") continue;
        if (data === "[DONE]") return;
        let ev: GeminiEvent;
        try {
          ev = JSON.parse(data) as GeminiEvent;
        } catch {
          throw new TtsHttpError("gemini", 502, `malformed event: ${data.slice(0, 100)}`);
        }
        yield ev;
      }
      if (done) return;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * The PCM bytes carried by a Gemini stream, in order. An `error` event (or a
 * stream that ends without audio) throws TtsHttpError, so retry / backup
 * classification works the same as for an HTTP error.
 */
async function* geminiPcm(body: ReadableStream<Uint8Array>): AsyncGenerator<Buffer> {
  let sawAudio = false;
  for await (const ev of readSseEvents(body)) {
    if (ev.event_type === "error") {
      // Seen as {code: "invalid_request"}; Google's usual shape is
      // {code: 429, status: "RESOURCE_EXHAUSTED"} — accept either.
      const raw = ev.error?.code;
      const named = typeof raw === "string" ? raw : typeof ev.error?.status === "string" ? ev.error.status : "";
      const code = named.toLowerCase() || (typeof raw === "number" ? String(raw) : "unknown");
      const message = typeof ev.error?.message === "string" ? ev.error.message : "";
      const status = typeof raw === "number" && raw >= 400 && raw < 600 ? raw : (GEMINI_ERROR_STATUS[code] ?? 500);
      throw new TtsHttpError("gemini", status, `${code}: ${message}`.replace(/\s+/g, " ").slice(0, ERROR_BODY_MAX));
    }
    if (ev.event_type !== "step.delta" || ev.delta?.type !== "audio" || typeof ev.delta.data !== "string") continue;
    const mime = typeof ev.delta.mime_type === "string" ? ev.delta.mime_type.toLowerCase() : "";
    const rate = /rate=(\d+)/.exec(mime)?.[1];
    if ((mime && !/^audio\/(l16|pcm)/.test(mime)) || (rate && Number(rate) !== GEMINI_SAMPLE_RATE)) {
      throw new Error(`gemini TTS returned unexpected audio format "${mime}"`);
    }
    sawAudio = true;
    yield Buffer.from(ev.delta.data, "base64");
  }
  if (!sawAudio) throw new TtsHttpError("gemini", 502, "stream ended without audio");
}

/**
 * Speak via Gemini. Resolves once the FIRST audio arrives (not just headers):
 * Gemini reports most failures as an SSE `error` event on a 200 response, and
 * surfacing those here lets them be retried / handed to the backup before any
 * audio has gone out.
 */
async function synthesizeGemini(text: string, voiceId: string): Promise<Readable> {
  // Aborting this ends the whole request, body included: on a first-audio
  // timeout, and when the returned stream is closed early (listener hung up,
  // stall watchdog) so a pending body read never holds the connection open.
  const controller = new AbortController();
  const startedAt = Date.now();
  const res = await postJson(
    "gemini",
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    { "x-goog-api-key": readApiKey("gemini", "GEMINI_API_KEY") },
    {
      model: modelOr("gemini", GEMINI_DEFAULT_MODEL),
      input: [{ type: "user_input", content: [{ type: "text", text }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: voiceId }] },
      stream: true,
    },
    controller.signal,
  );
  const pcm = geminiPcm(res.body as unknown as ReadableStream<Uint8Array>);
  // Headers and first audio share one RESPONSE_START_TIMEOUT_MS budget.
  const timer = setTimeout(
    () => controller.abort(new Error("no audio before response-start timeout")),
    Math.max(0, RESPONSE_START_TIMEOUT_MS - (Date.now() - startedAt)),
  );
  let first: IteratorResult<Buffer>;
  try {
    first = await pcm.next();
  } catch (err: unknown) {
    const timedOut = controller.signal.aborted;
    controller.abort();
    // A Gemini error event or bad audio is the provider's answer; a cut-off
    // body (our timeout, a dropped connection) is a network failure.
    if (err instanceof TtsHttpError || (!timedOut && !(err instanceof TypeError) && !(err instanceof DOMException))) throw err;
    throw new TtsNetworkError("gemini", err);
  } finally {
    clearTimeout(timer);
  }
  if (first.done) throw new TtsHttpError("gemini", 502, "stream ended without audio");
  const firstChunk = first.value;
  async function* all(): AsyncGenerator<Buffer> {
    yield firstChunk;
    yield* pcm;
  }
  const out = Readable.from(all(), { objectMode: false });
  out.once("close", () => controller.abort());
  return out;
}

export const geminiTtsProvider: TtsProvider = {
  id: "gemini",
  sampleRate: GEMINI_SAMPLE_RATE,
  // No documented character cap; kept in line with OpenAI's so a long
  // message is split into similar-sized requests.
  maxCharsPerRequest: 4000,
  defaultVoiceId: "Kore",
  model: () => modelOr("gemini", GEMINI_DEFAULT_MODEL),
  staticVoices: GEMINI_VOICES,
  listVoices: async () => [...GEMINI_VOICES],
  isOwnVoiceId: (id) => GEMINI_VOICE_IDS.has(id),
  synthesize: synthesizeGemini,
  isRetriable: isRetriableHttpError,
  // Google rejects a malformed / unknown AIza… key with 400 API_KEY_INVALID.
  isUnavailable: (err) =>
    isUnavailableHttpError(err) || (err instanceof TtsHttpError && err.status === 400 && /API_KEY_INVALID/.test(err.body)),
};
