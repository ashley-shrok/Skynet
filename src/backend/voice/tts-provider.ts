/**
 * Text-to-speech provider abstraction — the TTS twin of stt-provider.ts.
 *
 * Every TTS backend implements the same contract: speak this text in this
 * voice (raw signed 16-bit LE mono PCM out, at the provider's declared sample
 * rate), list the voices you offer, name your default, say how much text fits
 * in one request, and classify your own errors. Everything around that — the
 * speak routes, voice choice, message splitting, retries, logs, the voice
 * list the app's pickers render — is written once against this contract in
 * routes/voice.ts and knows nothing provider-specific. Adding a provider
 * means one new connection module plus one entry in PROVIDERS below.
 *
 * The provider is chosen per instance with the `TTS_PROVIDER` env var:
 *
 *   polly       (default) Amazon Polly, generative engine. Keeps audio inside
 *               AWS for instances covered by an AWS BAA. IMDS credentials.
 *   openai      OpenAI speech.        Needs OPENAI_API_KEY.
 *   elevenlabs  ElevenLabs.           Needs ELEVENLABS_API_KEY.
 *
 * Optional overrides:
 *   TTS_MODEL          model id sent to the selected provider (Polly ignores it).
 *   TTS_DEFAULT_VOICE  voice used when no saved voice is available on the
 *                      active provider (defaults per provider below).
 *
 * Unset TTS_PROVIDER keeps the pre-existing Polly behaviour exactly, so a BAA
 * instance never sends text off-AWS unless someone opts in explicitly. An
 * unknown value is refused, never mapped to some other provider.
 */

import type { Readable } from "node:stream";
import { databaseLogger } from "../utils/logger.js";
import { TtsNotConfiguredError } from "./tts-errors.js";
import { pollyTtsProvider } from "./tts-polly.js";
import { elevenLabsTtsProvider, openAiTtsProvider } from "./tts-http-providers.js";

/** One entry in a provider's voice list, as the app's pickers render it. */
export interface TtsVoice {
  /** What gets saved in identity/role frontmatter and sent back to speak. */
  id: string;
  /** Human-facing name. */
  name: string;
  /** Optional short description (ElevenLabs voices carry one). */
  description?: string;
}

export interface TtsProvider {
  readonly id: TtsProviderId;
  /** Sample rate (Hz) of the PCM `synthesize` returns. Mono, 16-bit LE. */
  readonly sampleRate: number;
  /** Largest text one `synthesize` call accepts; longer text is split upstream. */
  readonly maxCharsPerRequest: number;
  /** Built-in default voice id, used when TTS_DEFAULT_VOICE is unset. */
  readonly defaultVoiceId: string;
  /** Model id in effect (for logs); null when the provider has no model choice. */
  model(): string | null;
  /** The voices this provider offers. May hit the network. */
  listVoices(): Promise<TtsVoice[]>;
  /**
   * The provider's voice list when it is fixed and known offline (no network,
   * no key). Lets the app show names for voices saved under an INACTIVE
   * provider. Omitted for providers whose list is per-account.
   */
  readonly staticVoices?: readonly TtsVoice[];
  /**
   * Cheap offline check: could `id` be one of this provider's voices? Used to
   * accept saved voices on write regardless of which provider is active, and
   * to keep speaking a saved voice when the live voice list is unreachable.
   */
  isOwnVoiceId(id: string): boolean;
  /** Speak `text` (≤ maxCharsPerRequest) in `voiceId`; resolves once audio starts. */
  synthesize(text: string, voiceId: string): Promise<Readable>;
  /** Transient failure worth an automatic retry (throttling, 5xx, network). */
  isRetriable(err: unknown): boolean;
  /** Misconfiguration / auth failure → route answers 503 "TTS unavailable". */
  isUnavailable(err: unknown): boolean;
}

export const TTS_PROVIDER_IDS = ["polly", "openai", "elevenlabs"] as const;
export type TtsProviderId = (typeof TTS_PROVIDER_IDS)[number];

const PROVIDERS: Record<TtsProviderId, TtsProvider> = {
  polly: pollyTtsProvider,
  openai: openAiTtsProvider,
  elevenlabs: elevenLabsTtsProvider,
};

/** Longest voice id accepted anywhere (saved frontmatter, prefs, speak body). */
export const VOICE_ID_MAX_LEN = 64;

/**
 * Resolve the provider for this instance from `TTS_PROVIDER`. Read on every
 * call (cheap) so tests and env reloads don't need a module reset.
 *
 * @throws TtsNotConfiguredError for an unrecognised value — never a silent
 *   fallback, since that could route text somewhere the operator didn't choose.
 */
export function resolveTtsProvider(env: NodeJS.ProcessEnv = process.env): TtsProvider {
  const raw = (env.TTS_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "") return PROVIDERS.polly;
  if ((TTS_PROVIDER_IDS as readonly string[]).includes(raw)) {
    return PROVIDERS[raw as TtsProviderId];
  }
  throw new TtsNotConfiguredError(
    `unknown TTS_PROVIDER="${raw}" (expected one of: ${TTS_PROVIDER_IDS.join(", ")})`,
  );
}

/**
 * True when `id` could be a voice of ANY known provider. This is the write-side
 * gate for saved voices (identity/role frontmatter, the user's fallback voice):
 * a voice saved under one provider must stay saveable after the instance
 * switches to another — saved voices are never rewritten or rejected for
 * belonging to an inactive provider.
 */
export function isRecognizedVoiceId(id: unknown): id is string {
  if (typeof id !== "string" || id.length === 0 || id.length > VOICE_ID_MAX_LEN) return false;
  return TTS_PROVIDER_IDS.some((p) => PROVIDERS[p].isOwnVoiceId(id));
}

/**
 * The voice used when no candidate is available: TTS_DEFAULT_VOICE, else the
 * provider's. An override that isn't one of the active provider's voice ids
 * (e.g. a Polly name left behind after switching TTS_PROVIDER, or an
 * ElevenLabs voice NAME instead of its code) is a misconfiguration → speech
 * unavailable, not a provider-side 400 dressed up as a transient error.
 *
 * @throws TtsNotConfiguredError for an override the provider can't use.
 */
export function defaultVoiceFor(provider: TtsProvider, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.TTS_DEFAULT_VOICE?.trim();
  if (!override) return provider.defaultVoiceId;
  if (override.length > VOICE_ID_MAX_LEN || !provider.isOwnVoiceId(override)) {
    throw new TtsNotConfiguredError(
      `TTS_DEFAULT_VOICE="${override.slice(0, VOICE_ID_MAX_LEN)}" is not a ${provider.id} voice id`,
    );
  }
  return override;
}

// --- Voice-list cache --------------------------------------------------------

/** How long a successfully fetched voice list is reused before refetching. */
export const VOICE_LIST_TTL_MS = 5 * 60_000;
/**
 * After a failed fetch, callers within this window fail fast with the same
 * error instead of each waiting out the provider timeout — so an unreachable
 * list never delays speaking by more than one timeout per window.
 */
export const VOICE_LIST_FAILURE_TTL_MS = 30_000;

const voiceListCache = new Map<TtsProviderId, { voices: TtsVoice[]; fetchedAt: number }>();
/**
 * Last list each provider returned successfully, kept past the TTL. Used ONLY
 * for naming saved voices while a live list can't be fetched — never to decide
 * what can be picked or spoken.
 */
const lastKnownVoices = new Map<TtsProviderId, TtsVoice[]>();
const voiceListInflight = new Map<TtsProviderId, Promise<TtsVoice[]>>();
const voiceListFailure = new Map<TtsProviderId, { err: unknown; at: number }>();

/**
 * The provider's voice list, reused for VOICE_LIST_TTL_MS after a successful
 * fetch. Concurrent callers share one in-flight fetch. A failure is rethrown
 * unchanged, and repeated to callers for VOICE_LIST_FAILURE_TTL_MS before the
 * next real attempt.
 */
export async function getVoiceList(provider: TtsProvider, now: () => number = Date.now): Promise<TtsVoice[]> {
  const cached = voiceListCache.get(provider.id);
  if (cached && now() - cached.fetchedAt < VOICE_LIST_TTL_MS) return cached.voices;

  const inflight = voiceListInflight.get(provider.id);
  if (inflight) return inflight;

  const failed = voiceListFailure.get(provider.id);
  if (failed && now() - failed.at < VOICE_LIST_FAILURE_TTL_MS) throw failed.err;

  const startedAt = now();
  const p = provider
    .listVoices()
    .then((voices) => {
      voiceListCache.set(provider.id, { voices, fetchedAt: now() });
      lastKnownVoices.set(provider.id, voices);
      voiceListFailure.delete(provider.id);
      databaseLogger.info(
        `[voice-server] voice-list-fetched provider=${provider.id} count=${voices.length} ms=${now() - startedAt}`,
        { operation: "voice_list_fetched", provider: provider.id, count: voices.length },
      );
      return voices;
    })
    .catch((err: unknown) => {
      const errName = err instanceof Error ? err.name : "unknown";
      const errMessage = err instanceof Error ? err.message : String(err);
      databaseLogger.warn(
        `[voice-server] voice-list-failed provider=${provider.id} errName=${errName} errMessage="${errMessage}"`,
        { operation: "voice_list_failed", provider: provider.id, errName },
      );
      voiceListFailure.set(provider.id, { err, at: now() });
      throw err;
    })
    .finally(() => {
      voiceListInflight.delete(provider.id);
    });
  voiceListInflight.set(provider.id, p);
  return p;
}

/**
 * Names for every voice id the server can label right now: every provider's
 * fixed offline list, the last list each provider returned successfully, and
 * the active provider's current list. The app
 * uses this to show a saved voice by name — including one saved under another
 * provider — without knowing anything provider-specific.
 */
export function voiceLabels(activeVoices: readonly TtsVoice[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const id of TTS_PROVIDER_IDS) {
    for (const v of PROVIDERS[id].staticVoices ?? []) labels[v.id] = v.name;
    for (const v of lastKnownVoices.get(id) ?? []) labels[v.id] = v.name;
  }
  for (const v of activeVoices) labels[v.id] = v.name;
  return labels;
}

/** Test hook: forget cached voice lists. */
export function clearVoiceListCache(): void {
  voiceListCache.clear();
  lastKnownVoices.clear();
  voiceListFailure.clear();
  voiceListInflight.clear();
}

// --- Voice choice ------------------------------------------------------------

export interface VoiceChoice {
  /** The voice to speak in. */
  voice: string;
  /** Where it came from: index into the candidate list, or "default". */
  source: number | "default";
  /** Candidates passed over because the active provider doesn't offer them. */
  skipped: string[];
  /** True when the live voice list couldn't be fetched and format checks were used. */
  listUnavailable: boolean;
}

/**
 * Pick the voice to speak in: the first candidate the active provider offers,
 * else the instance default. Candidates arrive in the app's preference order
 * (identity's own voice, role voice, user's fallback voice).
 *
 * Availability is judged against the provider's voice list. If that list can't
 * be fetched, a candidate that looks like one of the provider's voice ids is
 * still tried — speaking a saved voice never depends on the list being
 * reachable.
 */
export async function chooseVoice(provider: TtsProvider, candidates: readonly string[]): Promise<VoiceChoice> {
  let available: Set<string> | null = null;
  let listUnavailable = false;
  if (candidates.length > 0) {
    try {
      available = new Set((await getVoiceList(provider)).map((v) => v.id));
    } catch {
      listUnavailable = true;
    }
  }

  const skipped: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const ok = available ? available.has(c) : provider.isOwnVoiceId(c);
    if (ok) return { voice: c, source: i, skipped, listUnavailable };
    skipped.push(c);
  }
  return { voice: defaultVoiceFor(provider), source: "default", skipped, listUnavailable };
}

// --- Synthesis with retry ----------------------------------------------------

/**
 * Start synthesis with auto-retry on errors the provider classifies as
 * transient. Only the request that STARTS the audio is retried — once a stream
 * is handed back, mid-stream failures surface to the caller unchanged (we
 * can't un-send audio already written to the client). Backoff is linear
 * (500ms × attempt). Shared by POST /voice/speak and /voice/speak-stream.
 */
export async function synthesizeWithRetries(
  provider: TtsProvider,
  text: string,
  voiceId: string,
  meta: { reqId: string; chunkIndex: number },
  maxAttempts: number = 3,
): Promise<Readable> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await provider.synthesize(text, voiceId);
    } catch (err: unknown) {
      lastErr = err;
      if (attempt < maxAttempts && provider.isRetriable(err)) {
        const backoffMs = 500 * attempt;
        const errName = (err as { name?: string })?.name ?? "unknown";
        const errMessage = err instanceof Error ? err.message : String(err);
        databaseLogger.warn(
          `[voice-server] speak-retry reqId=${meta.reqId} chunk=${meta.chunkIndex} provider=${provider.id} model=${provider.model() ?? "none"} voice="${voiceId}" attempt=${attempt}/${maxAttempts} errName=${errName} errMessage="${errMessage}" backoffMs=${backoffMs}`,
          { operation: "voice_speak_retry", reqId: meta.reqId, provider: provider.id, attempt, maxAttempts, errName, backoffMs },
        );
        await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
