/**
 * Phase 98 plan 04 — Amazon Transcribe streaming STT adapter.
 *
 * Thin backend adapter that translates the invariant client contract
 * (`multipart audio upload` in → text transcript out) into an Amazon
 * Transcribe streaming session (`StartStreamTranscriptionCommand`).
 * Consumed by Plan 06's rewritten `handleTranscribe` handler, which
 * pipes the raw multipart bytes through `webmToOggOpus` (or the
 * `webmToFlac` fallback) before handing the buffered blob to this
 * adapter.
 *
 * Locked design decisions (from 98-CONTEXT.md — do NOT deviate):
 *
 * - **Streaming, not batch.** AWS offers no synchronous
 *   "POST-audio-get-text" endpoint for Transcribe. The streaming API
 *   (HTTP/2 event streams) is the only real-time option. The client
 *   contract preserves "one-shot upload" — this adapter opens a stream,
 *   pushes the buffered blob as a burst of 16 KB chunks, and reads
 *   final transcripts back until the stream closes.
 *
 * - **LanguageCode locked to `en-US`** (D-Provider-choice + § Deferred
 *   multi-language). Multi-language support is a future-phase concern.
 *
 * - **Region hardcoded to `us-east-1`** (per D-Claude's-discretion;
 *   mirror of `polly-adapter.ts`). One-line change if a future region
 *   swap becomes needed.
 *
 * - **Credentials via IMDS through the SDK's default provider chain.**
 *   The `TranscribeStreamingClient` constructor MUST NOT receive a
 *   `credentials` field (see 98-RESEARCH.md § Pitfall 2). Same mechanism
 *   as `polly-adapter.ts` — passing anything explicit disables the
 *   IMDS-inclusive default chain and breaks prod. Enforced by the mocked
 *   unit test which asserts the constructor is called with no
 *   `credentials` property. Off-switch: when the
 *   `PollyTranscribeExploratory` policy is not attached, `.send()`
 *   throws `AccessDeniedException`, which upstream `voice.ts` routes to
 *   a clean info-level 503 via `isAwsAccessDenied` from `aws-errors.ts`.
 *
 * - **Module-level singleton TranscribeStreamingClient.** Constructed
 *   ONCE at module load. Adapter calls (`transcribeBuffer`) reuse this
 *   instance — same rationale as polly-adapter's connection reuse.
 *
 * - **CRITICAL: partial-vs-final result filter (98-RESEARCH.md § Pitfall
 *   3).** By default, Transcribe emits BOTH partial results (as it hears
 *   more audio and refines its guess) AND final results (when it commits
 *   to a segment). Partials are marked `IsPartial: true`. Accumulating
 *   every result produces hallucinated repeated text — "hello", "hello
 *   there", "hello there world" concatenated is junk. This adapter
 *   MUST filter `IsPartial === false` before accumulating. Enforced by
 *   a dedicated unit test.
 *
 * Caller contract (Plan 06 responsibility):
 *
 *   - Audio buffer MUST be a Transcribe-accepted format: FLAC, Ogg-Opus,
 *     or raw PCM (16-bit LE mono). WebM is REJECTED by Transcribe
 *     natively (98-RESEARCH.md § Pitfall 1) — the caller must transcode
 *     via `audio-transcode.ts::webmToOggOpus` (fast remux path) or its
 *     `webmToFlac` fallback (full re-encode when the remux fails on
 *     Chrome's multi-channel Opus edge case) BEFORE calling this
 *     adapter. The MediaEncoding argument MUST match the actual buffer
 *     shape: `"ogg-opus"` after `webmToOggOpus`, `"flac"` after
 *     `webmToFlac`, `"pcm"` if the caller has already produced raw PCM.
 *
 *   - `sampleRateHz` MUST match the actual sample rate of the buffer
 *     (16000 for the fallback FLAC path; caller determines for
 *     ogg-opus).
 *
 *   - The entire audio buffer must be present BEFORE calling this
 *     adapter — the internal `audioChunkGenerator` is constructed
 *     eagerly and the SDK begins reading it as soon as `send()` returns.
 *
 * @see 98-CONTEXT.md § Provider choice
 * @see 98-RESEARCH.md § Pattern 2, § Pitfall 1, § Pitfall 2, § Pitfall 3
 * @see src/backend/voice/audio-transcode.ts (WebM → Ogg-Opus / FLAC bridge)
 * @see src/backend/voice/aws-errors.ts (AccessDenied classifier)
 */

import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  type AudioStream,
  type LanguageCode,
  type MediaEncoding,
} from "@aws-sdk/client-transcribe-streaming";

/**
 * Module-level TranscribeStreamingClient singleton. Constructed exactly
 * ONCE at module import. Do NOT add a `credentials` field — see the
 * extensive docblock above (Pitfall 2). Do NOT construct additional
 * clients elsewhere in the codebase — reuse this one via
 * `transcribeBuffer`.
 */
const client = new TranscribeStreamingClient({ region: "us-east-1" });

/**
 * Chunk size for pushing audio to the streaming session. 16 KB matches
 * the reference `transcribe-flac.py` chunk size from the exploration
 * bounty; the size is not load-bearing on Transcribe's side (any
 * reasonable chunk size works), but matching the Python reference keeps
 * behavior parity easy to reason about.
 */
const CHUNK_SIZE = 16 * 1024;

/**
 * Async generator that yields Transcribe's expected AudioStream event
 * shape — `{ AudioEvent: { AudioChunk: Uint8Array } }` per 16 KB slice
 * of the input buffer. The SDK begins reading this generator as soon as
 * `client.send(cmd)` returns, so it must be lazy (not eagerly
 * materialized).
 */
async function* audioChunkGenerator(
  buffer: Buffer,
): AsyncIterable<AudioStream> {
  for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
    const chunk = buffer.subarray(
      offset,
      Math.min(offset + CHUNK_SIZE, buffer.length),
    );
    yield { AudioEvent: { AudioChunk: chunk } };
  }
}

/**
 * Transcribe an audio buffer via Amazon Transcribe streaming, returning
 * the concatenated FINAL transcripts (partial results filtered out per
 * Pitfall 3).
 *
 * @param audioBuffer - Post-transcode audio bytes (FLAC, Ogg-Opus, or raw
 *   PCM 16-bit LE mono). WebM is NOT accepted — see the caller contract
 *   note in the module docblock.
 * @param mediaEncoding - Which encoding the `audioBuffer` uses. Defaults
 *   to `"ogg-opus"` (the fast-remux happy path from `webmToOggOpus`).
 * @param sampleRateHz - Sample rate of the audio. Defaults to `16000`
 *   (matches the `webmToFlac` fallback + typical microphone recording).
 * @returns The final transcript text — an empty string if the audio was
 *   silent / unintelligible (no non-partial results yielded).
 * @throws If Transcribe's response does not include a `TranscriptResultStream`.
 * @throws The raw SDK error unchanged for any other failure (AccessDenied,
 *   throttling, network). Upstream `voice.ts` classifies via
 *   `isAwsAccessDenied` from `aws-errors.ts`.
 */
export async function transcribeBuffer(
  audioBuffer: Buffer,
  mediaEncoding: "flac" | "ogg-opus" | "pcm" = "ogg-opus",
  sampleRateHz: number = 16000,
): Promise<string> {
  const cmd = new StartStreamTranscriptionCommand({
    LanguageCode: "en-US" as LanguageCode,
    MediaSampleRateHertz: sampleRateHz,
    MediaEncoding: mediaEncoding as MediaEncoding,
    AudioStream: audioChunkGenerator(audioBuffer),
  });

  const response = await client.send(cmd);
  if (!response.TranscriptResultStream) {
    throw new Error("Transcribe returned no TranscriptResultStream");
  }

  const finalTranscripts: string[] = [];
  for await (const event of response.TranscriptResultStream) {
    const results = event.TranscriptEvent?.Transcript?.Results;
    if (!results) continue;
    for (const result of results) {
      // CRITICAL (Pitfall 3): skip partial results — only accumulate
      // finals. Accumulating partials produces hallucinated repeated text.
      if (result.IsPartial) continue;
      for (const alt of result.Alternatives ?? []) {
        if (alt.Transcript) finalTranscripts.push(alt.Transcript);
      }
    }
  }
  return finalTranscripts.join(" ");
}
