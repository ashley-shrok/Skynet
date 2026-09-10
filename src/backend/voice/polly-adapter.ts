/**
 * Phase 98 plan 04 — Amazon Polly TTS adapter (SynthesizeSpeech wrapper).
 *
 * Thin backend adapter that translates the invariant client contract
 * (`{text, voice}` in → PCM audio stream out) into an Amazon Polly
 * `SynthesizeSpeechCommand` call. Consumed by Plan 06's rewritten
 * `handleSpeakStream` orchestrator, which chunks long messages via
 * `chunk-and-stitch.ts` and pipes each per-chunk Polly response to the
 * client sequentially.
 *
 * Locked design decisions (from 98-CONTEXT.md — do NOT deviate):
 *
 * - **Engine locked to `generative`** (D-Provider-choice). Ashley A/B'd
 *   generative vs neural against her local rig during exploration and
 *   picked generative flat: "yeah, definitely generative, because it
 *   sounded way better." No per-identity engine toggle, no user-facing
 *   engine picker. Callers of this module CANNOT override the engine.
 *
 * - **Output format locked to `pcm` @ 16000 Hz mono 16-bit LE.** This is
 *   the ONE Polly output format that matches what the shipped client-side
 *   `webAudioStreamPlayer.ts` + `riffPcmDecode.ts` decoder path expects.
 *   Requesting MP3 / Ogg-Opus / mulaw would require rewriting the client
 *   player, violating D-Verification-bar's "client player unchanged"
 *   invariant. Plan 06 pairs this adapter's first chunk with a synthetic
 *   44-byte RIFF header built by `riff-header-builder.ts` so the player's
 *   parser accepts the stream as-is.
 *
 * - **Region hardcoded to `us-east-1`** (per D-Claude's-discretion).
 *   Generative-engine Polly is not available in every region; hardcoding
 *   removes an operator failure mode. Both t1000 and T800 have us-east-1
 *   generative available. If a future region-switch becomes needed,
 *   one-line change here.
 *
 * - **Credentials via IMDS through the SDK's default provider chain.**
 *   The `PollyClient` constructor MUST NOT receive a `credentials` field
 *   (see 98-RESEARCH.md § Pitfall 2). `@aws-sdk/client-polly` bundles
 *   `@aws-sdk/credential-provider-node`, whose default chain includes
 *   IMDS as one of its providers — so on EC2 with an attached instance
 *   role, this "just works" with zero wiring. Passing any explicit
 *   `credentials` value (even the SDK-provided default) DISABLES the
 *   composite chain and falls back to a single-provider resolution that
 *   does NOT include IMDS, breaking prod. Enforced by the mocked unit
 *   test which asserts the constructor is called with no `credentials`
 *   property. This is also the phase's off-switch mechanism: when the
 *   `PollyTranscribeExploratory` policy is not attached, `.send()` throws
 *   `AccessDeniedException`, which upstream `voice.ts` routes to a clean
 *   info-level 503 via `isAwsAccessDenied` from `aws-errors.ts`.
 *
 * - **Module-level singleton PollyClient.** The client is constructed
 *   ONCE at module load (see the `pollyClient` binding below). Adapter
 *   calls (`synthesizeToPcm`) reuse this instance. Per-request client
 *   construction would defeat the SDK's connection reuse and add
 *   ~50-100ms of setup latency to every synth request — matters on the
 *   hot path for streaming TTS.
 *
 * Caller contract (Plan 06 responsibility):
 *
 *   - Voice ID validation MUST happen upstream via `isValidPollyVoice`
 *     from `polly-voice-catalog.ts`. This adapter does NOT re-validate —
 *     invalid IDs (e.g., "Elena", "joanna") would fail Polly-side with a
 *     `ValidationException`, but validation upstream produces a clean
 *     400 with a helpful error message before the SDK round-trip.
 *
 *   - Text length capping (2900-char safety margin) MUST happen upstream
 *     via `packChunks` from `chunk-and-stitch.ts`. This adapter does NOT
 *     re-check length — over-limit text fails Polly-side with
 *     `TextLengthExceededException`, but upstream chunking sidesteps the
 *     error entirely.
 *
 * @see 98-CONTEXT.md § Provider choice
 * @see 98-RESEARCH.md § Pattern 1, § Pitfall 2, § Pitfall 4
 * @see src/backend/voice/aws-errors.ts (AccessDenied classifier)
 * @see src/backend/voice/polly-voice-catalog.ts (voice-ID whitelist)
 */

import {
  PollyClient,
  SynthesizeSpeechCommand,
  type VoiceId,
} from "@aws-sdk/client-polly";
import { Readable } from "node:stream";

/**
 * Module-level PollyClient singleton. Constructed exactly ONCE at module
 * import. Do NOT add a `credentials` field — see the extensive docblock
 * above (Pitfall 2). Do NOT construct additional clients elsewhere in the
 * codebase — reuse this one via `synthesizeToPcm`.
 */
const pollyClient = new PollyClient({ region: "us-east-1" });

/**
 * Synthesize `text` as PCM audio (signed 16-bit little-endian, mono, 16 kHz)
 * using Polly's generative engine and the given `voiceId`.
 *
 * @param text - Plain text to speak. Caller must ensure length is under the
 *   safe billing ceiling (2900 chars) — see the caller-contract note in the
 *   module docblock. Empty / whitespace-only strings will be rejected by
 *   Polly with a `ValidationException`.
 * @param voiceId - One of the 7 supported Polly voice IDs (Danielle, Joanna,
 *   Ruth, Salli, Tiffany, Matthew, Stephen). Caller must have validated
 *   this via `isValidPollyVoice` upstream.
 * @returns A Node.js `Readable` stream of PCM bytes. The caller should pipe
 *   this to the HTTP response body (with a synthetic RIFF header prepended
 *   before the first PCM chunk if this is the first sub-message in a
 *   chunk-and-stitch sequence).
 * @throws If Polly's response does not include an `AudioStream` field.
 * @throws The raw SDK error unchanged for any other failure (AccessDenied,
 *   throttling, network) — upstream `voice.ts` classifies via
 *   `isAwsAccessDenied` from `aws-errors.ts`.
 */
export async function synthesizeToPcm(
  text: string,
  voiceId: string,
): Promise<Readable> {
  const cmd = new SynthesizeSpeechCommand({
    Text: text,
    Engine: "generative",
    OutputFormat: "pcm",
    SampleRate: "16000",
    VoiceId: voiceId as VoiceId,
  });
  const response = await pollyClient.send(cmd);
  if (!response.AudioStream) {
    throw new Error("Polly returned no AudioStream");
  }
  return response.AudioStream as Readable;
}
