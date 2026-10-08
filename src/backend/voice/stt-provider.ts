/**
 * Speech-to-text provider abstraction.
 *
 * Every STT backend implements the same contract: the raw clip uploaded by
 * the browser (bytes + mimetype + extension) in, a plain transcript string
 * out. `handleTranscribe` in routes/voice.ts owns everything around that call
 * (disk-bank, retries, slash-command transform, HTTP status mapping) so a
 * provider only has to translate audio → text and classify its own errors.
 *
 * The provider is chosen per instance with the `STT_PROVIDER` env var:
 *
 *   bedrock     (default) Amazon Nova 2 Sonic on Bedrock. Keeps audio inside
 *               AWS for instances covered by an AWS BAA. IMDS credentials.
 *   elevenlabs  ElevenLabs Scribe v2.            Needs ELEVENLABS_API_KEY.
 *   mistral     Mistral Voxtral Mini Transcribe. Needs MISTRAL_API_KEY.
 *   groq        Whisper Large v3 Turbo on Groq.  Needs GROQ_API_KEY.
 *
 * Optional overrides for the HTTP providers:
 *   STT_MODEL     model id sent to the selected provider (defaults below).
 *   STT_LANGUAGE  ISO-639-1 code (e.g. "en"); omit for auto-detect.
 *
 * Unset STT_PROVIDER keeps the pre-existing Bedrock behaviour exactly, so a
 * BAA instance never sends audio off-AWS unless someone opts in explicitly.
 */

import { SttNotConfiguredError } from "./stt-errors.js";
import { bedrockSttProvider } from "./stt-bedrock.js";
import {
  elevenLabsSttProvider,
  groqSttProvider,
  mistralSttProvider,
} from "./stt-http-providers.js";

export interface SttInput {
  /** Raw uploaded bytes exactly as the browser sent them (WebM/Opus in prod). */
  audio: Buffer;
  /** Multipart mimetype, e.g. `audio/webm;codecs=opus`. */
  mimetype: string;
  /** File extension derived from the mimetype (`webm`, `mp4`, ...). */
  ext: string;
}

export interface SttProvider {
  readonly id: SttProviderId;
  transcribe(input: SttInput): Promise<string>;
  /** Transient failure worth an automatic retry (throttling, 5xx, network). */
  isRetriable(err: unknown): boolean;
  /** Misconfiguration / auth failure → route answers 503 "STT unavailable". */
  isUnavailable(err: unknown): boolean;
}

export const STT_PROVIDER_IDS = ["bedrock", "elevenlabs", "mistral", "groq"] as const;
export type SttProviderId = (typeof STT_PROVIDER_IDS)[number];

const PROVIDERS: Record<SttProviderId, SttProvider> = {
  bedrock: bedrockSttProvider,
  elevenlabs: elevenLabsSttProvider,
  mistral: mistralSttProvider,
  groq: groqSttProvider,
};

/**
 * Resolve the provider for this instance from `STT_PROVIDER`. Read on every
 * call (cheap) so tests and env reloads don't need a module reset.
 *
 * @throws SttNotConfiguredError for an unrecognised value — we never silently
 *   fall back to a different provider, since that could route PHI somewhere
 *   the operator didn't choose.
 */
export function resolveSttProvider(env: NodeJS.ProcessEnv = process.env): SttProvider {
  const raw = (env.STT_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "") return PROVIDERS.bedrock;
  if ((STT_PROVIDER_IDS as readonly string[]).includes(raw)) {
    return PROVIDERS[raw as SttProviderId];
  }
  throw new SttNotConfiguredError(
    `unknown STT_PROVIDER="${raw}" (expected one of: ${STT_PROVIDER_IDS.join(", ")})`,
  );
}
