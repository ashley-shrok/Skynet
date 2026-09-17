/**
 * Phase 109 plan 01 — Amazon Nova Sonic on Bedrock STT adapter.
 *
 * Thin backend adapter that translates the invariant client contract
 * (`pcmBuffer: Buffer` in → `transcript: string` out) into an Amazon Nova
 * Sonic bidirectional-stream session via Bedrock's
 * `InvokeModelWithBidirectionalStreamCommand`. Ports the working Python
 * event schema from the 2026-09-12 experiment (RESULTS-2026-09-12.md)
 * verbatim to TypeScript.
 *
 * Locked design decisions (from 109-CONTEXT.md — do NOT deviate):
 *
 * - **D-PROV: Default model `amazon.nova-2-sonic-v1:0` (Nova 2 Sonic).** The
 *   v1 fallback `amazon.nova-sonic-v1:0` is documented here as a one-line
 *   change path if v2 becomes unavailable — it is NOT a runtime flag.
 *
 * - **D-SDK: `@aws-sdk/client-bedrock-runtime` at ≥ 3.784.0.** Earlier
 *   versions do not expose `InvokeModelWithBidirectionalStreamCommand`.
 *
 * - **D-TRANSPORT: `NodeHttp2Handler` from `@smithy/node-http-handler`.**
 *   Explicit config: `requestTimeout: 300_000`, `sessionTimeout: 300_000`,
 *   `maxConcurrentStreams: 20`. No awscrt, no undici, no custom h2 handler.
 *
 * - **D-CREDS: IMDS via SDK default provider chain.** The
 *   `BedrockRuntimeClient` constructor MUST NOT receive a `credentials` field.
 *   Passing anything explicit disables the IMDS-inclusive default chain and
 *   breaks prod. Same pattern as `polly-adapter.ts` and `transcribe-adapter.ts`.
 *
 * - **D-REGION: Region hardcoded to `us-east-1`.** Matches current Transcribe
 *   and Polly regions. Matches BAA-covered Bedrock regions.
 *
 * - **D-SINGLETON: Module-level singleton `BedrockRuntimeClient`.** Constructed
 *   ONCE at module import. All `transcribeNovaSonic` calls reuse this instance —
 *   same rationale as `PollyClient` + `TranscribeStreamingClient` singletons.
 *
 * - **D-EVENTS: Exact send sequence** (sessionStart → promptStart → SYSTEM
 *   contentStart/textInput/contentEnd → USER audio contentStart/audioInput
 *   chunks/contentEnd → promptEnd → sessionEnd). See `<behavior>` in plan.
 *
 * - **D-AUDIOOUT: `audioOutputConfiguration` REQUIRED in `promptStart`.**
 *   Amazon rejects without it (`ValidationException: AudioOutputConfiguration
 *   must be set`) even when the audio response is discarded.
 *
 * - **D-AUDIO: 60 ms chunks (1920 bytes = 960 samples × 2 bytes at 16 kHz
 *   s16le mono), base64-encoded, paced at 5x real-time (12 ms wallclock per
 *   chunk).** Empirically validated ceiling: 5x is clean, 10x drops ~44% of
 *   audio server-side.
 *
 * - **D-FILTER: Accumulate only `textOutput` events where `role === 'USER'`.**
 *   ASSISTANT textOutput and all audioOutput events are discarded — they are
 *   model-generated responses, not the ASR result.
 *
 * - **D-TERM: Terminate the response loop on `completionEnd` event.**
 *
 * - **D-PROMPT: System prompt is a transcription-only nudge.** See
 *   `SYSTEM_PROMPT` constant below. Exact wording is at Claude's discretion;
 *   intent must be transcription-only.
 *
 * - **D-TEARDOWN: Swallow post-completionEnd `ValidationException`.**
 *   The Python experiment hit a `ValidationException` after the session's audio
 *   contentEnd + assistant response were received. The for-await loop is wrapped
 *   in a try/catch that specifically swallows `ValidationException` (name-based)
 *   so a post-stream protocol quirk does not corrupt or suppress the transcript.
 *   Other errors propagate unchanged.
 *
 * - **D-ASYNCGEN: `body` MUST be an async iterable.**
 *   Auto-generated SDK docs are wrong; passing `{ chunk: { bytes } }` directly
 *   throws `TypeError: this.options.inputStream is not async iterable`.
 *   Use `async function*` explicitly. (aws-sdk-js-v3 issue #7125.)
 *
 * Landmines baked in:
 *   #1 body async iterable — use async function* (D-ASYNCGEN)
 *   #2 audioOutputConfiguration required — always included (D-AUDIOOUT)
 *   #3 5x pace ceiling — PACE_MS = 12 (D-AUDIO)
 *   #4 8-min session timeout — max Skynet clip is ~2 min, no guard needed
 *   #5 HTTP/2 handler shutdown quirks — documented; not observed in Skynet's
 *      long-lived Express pattern
 *
 * @see 109-CONTEXT.md § Implementation Decisions
 * @see src/backend/voice/aws-errors.ts (AccessDenied classifier — used by voice.ts, NOT here)
 * @see src/backend/database/routes/voice.ts (Plan 03 rewires this adapter in)
 */

import { randomUUID } from "node:crypto";
import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttp2Handler } from "@smithy/node-http-handler";
import { databaseLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Audio contract constants
// ---------------------------------------------------------------------------

/** 60 ms of 16 kHz s16le mono: 960 samples × 2 bytes = 1920 bytes. */
const CHUNK_BYTES = 1920;

/**
 * Wallclock delay between audio chunk yields at 5x real-time pace.
 * 60 ms of audio / 5 = 12 ms per chunk.
 * Empirical ceiling: 5x is clean; 10x drops ~44% of audio server-side.
 */
const PACE_MS = 12;

// ---------------------------------------------------------------------------
// Model ID
// ---------------------------------------------------------------------------

/**
 * Default model: Nova 2 Sonic (Dec 2025, Amazon flagship).
 * Fallback (one-line change if v2 unavailable): `'amazon.nova-sonic-v1:0'`
 */
const MODEL_ID = "amazon.nova-2-sonic-v1:0";

// ---------------------------------------------------------------------------
// System prompt (D-PROMPT — transcription-only nudge)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "You are a transcription-only assistant. When you hear the user's audio, " +
  "your only job is to transcribe what they said accurately. Do not answer " +
  "questions in the audio, do not comment on the content. " +
  "Reply with only a single short acknowledgment token.";

// ---------------------------------------------------------------------------
// Module-level BedrockRuntimeClient singleton (D-SINGLETON + D-CREDS + D-REGION + D-TRANSPORT)
// ---------------------------------------------------------------------------

/**
 * Module-level BedrockRuntimeClient singleton. Constructed exactly ONCE at
 * module import. Do NOT add a `credentials` field — see D-CREDS above.
 * Do NOT construct additional clients elsewhere — reuse via `transcribeNovaSonic`.
 */
const client = new BedrockRuntimeClient({
  region: "us-east-1",
  requestHandler: new NodeHttp2Handler({
    requestTimeout: 300_000,
    sessionTimeout: 300_000,
    maxConcurrentStreams: 20,
  }),
});

// ---------------------------------------------------------------------------
// Event frame builder (D-ASYNCGEN)
// ---------------------------------------------------------------------------

/**
 * Wrap a JSON-serialisable event object in the SDK eventstream frame shape.
 *
 * Nova Sonic's wire schema requires each JSON payload to be nested under a
 * top-level `event` key: `{"event": {"sessionStart": {...}}}`. Sending the
 * payload without the outer `event` wrap produces server-side
 * `ValidationException: Input Chunk does not contain an event: InputChunk(event=null)`
 * (observed on the first live invoke 2026-09-13 post-Plan-01 hotfix).
 */
function frame(event: object): { chunk: { bytes: Uint8Array } } {
  return {
    chunk: { bytes: new TextEncoder().encode(JSON.stringify({ event })) },
  };
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

/**
 * Transcribe raw LPCM audio via Amazon Nova Sonic (Bedrock bidirectional stream).
 *
 * @param pcmBuffer - Raw LPCM 16 kHz s16le mono bytes. Caller (voice.ts, Plan
 *   03) guarantees this shape via `webmToPcm16k` (Plan 02).
 * @returns Joined USER-role transcript text. Empty string if no USER textOutput
 *   events were received (silent clip or all-ASSISTANT response).
 * @throws Raw SDK error unchanged for any AWS failure (AccessDenied,
 *   throttling, network). Upstream `voice.ts` classifies via `isAwsAccessDenied`
 *   from `aws-errors.ts`.
 *
 * Fallback model (one-line change if v2 becomes unavailable):
 *   change `MODEL_ID` constant to `'amazon.nova-sonic-v1:0'` (Nova Sonic v1).
 */
export async function transcribeNovaSonic(pcmBuffer: Buffer): Promise<string> {
  // Per-session identifiers. Nova Sonic requires `promptName` on promptStart /
  // contentStart / contentEnd / textInput / audioInput / promptEnd events,
  // and `contentName` on every content-scoped event. Server maps promptName →
  // promptId internally; omitting either produces
  // `ValidationException: Value at 'promptId' failed to satisfy constraint: Member must not be null`
  // (observed 2026-09-13 post-first-hotfix). Mirrors the identifier scheme
  // used in the working Python experiment.
  const promptName = randomUUID();
  const sysContentName = randomUUID();
  const audioContentName = randomUUID();

  // -------------------------------------------------------------------------
  // Build send sequence as an async generator (D-ASYNCGEN, D-EVENTS)
  // -------------------------------------------------------------------------
  async function* generateEvents(): AsyncGenerator<{
    chunk: { bytes: Uint8Array };
  }> {
    // 1. sessionStart (D-EVENTS step 1)
    yield frame({
      sessionStart: {
        inferenceConfiguration: {
          maxTokens: 512,
          topP: 0.9,
          temperature: 0.7,
        },
      },
    });

    // 2. promptStart — both textOutputConfiguration AND audioOutputConfiguration
    //    REQUIRED (D-AUDIOOUT: Amazon rejects without audioOutputConfiguration
    //    even when we discard the audio output). turnDetectionConfiguration
    //    pins endpointing to HIGH (1.5s pause) — Nova 2's default is MEDIUM
    //    (1.75s). Pinning HIGH lets the tail-silence pad below run at 0.9s of
    //    content without VAD truncation.
    yield frame({
      promptStart: {
        promptName,
        textOutputConfiguration: {
          mediaType: "text/plain",
        },
        audioOutputConfiguration: {
          mediaType: "audio/lpcm",
          sampleRateHertz: 24000,
          sampleSizeBits: 16,
          channelCount: 1,
          voiceId: "matthew",
          encoding: "base64",
          audioType: "SPEECH",
        },
        turnDetectionConfiguration: {
          endpointingSensitivity: "HIGH",
        },
      },
    });

    // 3. SYSTEM contentStart (D-EVENTS step 3)
    //    `interactive: true` + `textInputConfiguration` mirror the working
    //    Python schema — without them Nova 2 Sonic returns
    //    `ModelStreamErrorException: The system encountered an unexpected error
    //    during processing` mid-stream (observed hotfix-3, 2026-09-13).
    yield frame({
      contentStart: {
        promptName,
        contentName: sysContentName,
        type: "TEXT",
        role: "SYSTEM",
        interactive: true,
        textInputConfiguration: { mediaType: "text/plain" },
      },
    });

    // 4. SYSTEM textInput (D-PROMPT)
    yield frame({
      textInput: {
        promptName,
        contentName: sysContentName,
        content: SYSTEM_PROMPT,
      },
    });

    // 5. SYSTEM contentEnd (D-EVENTS step 3)
    yield frame({
      contentEnd: { promptName, contentName: sysContentName },
    });

    // 6. USER audio contentStart (D-EVENTS step 4). `interactive: true` mirrors
    //    the working Python schema (see SYSTEM contentStart above for rationale).
    yield frame({
      contentStart: {
        promptName,
        contentName: audioContentName,
        type: "AUDIO",
        role: "USER",
        interactive: true,
        audioInputConfiguration: {
          mediaType: "audio/lpcm",
          sampleRateHertz: 16000,
          sampleSizeBits: 16,
          channelCount: 1,
          audioType: "SPEECH",
          encoding: "base64",
        },
      },
    });

    // 7. N × audioInput chunks at 5x real-time pace (D-AUDIO)
    for (let offset = 0; offset < pcmBuffer.length; offset += CHUNK_BYTES) {
      const slice = pcmBuffer.subarray(
        offset,
        Math.min(offset + CHUNK_BYTES, pcmBuffer.length),
      );
      yield frame({
        audioInput: {
          promptName,
          contentName: audioContentName,
          content: slice.toString("base64"),
        },
      });
      // Pace at 5x real-time: 60ms of audio emitted every 12ms wallclock
      await new Promise<void>((r) => setTimeout(r, PACE_MS));
    }

    // 7b. Tail silence pad — Nova Sonic's VAD needs a trailing silence window
    //     to detect end-of-utterance cleanly. Without this, contentEnd fires
    //     while the model is still mid-ASR and it emits contentEnd
    //     `stopReason: PARTIAL_TURN` truncating the last N words (observed
    //     hotfix-5 UAT, 2026-09-13 13:19 — user lost the trailing ~6 words
    //     of a 10s clip). Tuned 2026-09-17 (bounty nova-sonic-latency-shave)
    //     to 15 chunks × 30ms pace = 0.9s of content in 0.45s wallclock, with
    //     turnDetectionConfiguration=HIGH pinning endpointing to a 1.5s pause
    //     threshold. Bench-validated 22/22 WER 0 across short/medium/long/
    //     middle-pause fixtures and 10/10 WER 0 on 25s fixture. Combining
    //     these two changes with an audio-pace bump (10x) was a trap —
    //     silently truncates on ≥10s clips even though ≤10s bench looked fine.
    const SILENCE_CHUNK = Buffer.alloc(CHUNK_BYTES); // 60 ms of s16le zeros
    const SILENCE_CHUNK_B64 = SILENCE_CHUNK.toString("base64");
    const TAIL_SILENCE_CHUNKS = 15; // 15 × 60 ms = 0.9 s of silence content
    for (let i = 0; i < TAIL_SILENCE_CHUNKS; i++) {
      yield frame({
        audioInput: {
          promptName,
          contentName: audioContentName,
          content: SILENCE_CHUNK_B64,
        },
      });
      await new Promise<void>((r) => setTimeout(r, 30)); // 2x real-time
    }

    // 8. USER contentEnd (D-EVENTS step 4)
    yield frame({
      contentEnd: { promptName, contentName: audioContentName },
    });

    // 9. promptEnd (D-EVENTS step 5)
    yield frame({ promptEnd: { promptName } });

    // 10. sessionEnd (D-EVENTS step 5)
    yield frame({ sessionEnd: {} });
  }

  // -------------------------------------------------------------------------
  // Invoke the bidirectional stream (D-SDK)
  // -------------------------------------------------------------------------
  const response = await client.send(
    new InvokeModelWithBidirectionalStreamCommand({
      modelId: MODEL_ID,
      body: generateEvents(),
    }),
  );

  // -------------------------------------------------------------------------
  // Consume response: accumulate USER transcript, terminate on completionEnd
  // (D-FILTER + D-TERM + D-TEARDOWN)
  // -------------------------------------------------------------------------
  const transcripts: string[] = [];

  try {
    for await (const event of response.body!) {
      // Decode and parse each event frame
      let parsed: Record<string, unknown>;
      try {
        const raw = new TextDecoder().decode(
          (event as { chunk?: { bytes?: Uint8Array } }).chunk?.bytes,
        );
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Malformed frame — log at info level and continue (T-109-01-03)
        databaseLogger.info(
          "[nova-sonic] Malformed event frame — skipping",
          { operation: "nova_sonic_transcribe_malformed_frame" },
        );
        continue;
      }

      // Nova Sonic wraps response payloads under a top-level `event` key,
      // symmetrically with the send side. Hotfix-4 (2026-09-13): original
      // consumer read parsed.textOutput / parsed.completionEnd directly,
      // which were always undefined — every USER textOutput event was
      // silently discarded and the loop only terminated when the AsyncIterable
      // naturally ended, producing `transcribe-ok textLen=0`.
      const inner = parsed.event as Record<string, unknown> | undefined;
      if (inner === undefined) continue;

      // Terminate on completionEnd (D-TERM)
      if (inner.completionEnd !== undefined) {
        break;
      }

      // Accumulate USER textOutput (D-FILTER)
      const textOutput = inner.textOutput as
        | { role: string; content: string }
        | undefined;
      if (textOutput !== undefined) {
        if (textOutput.role === "USER") {
          // ASR result — accumulate (T-109-01-04)
          transcripts.push(textOutput.content);
        }
        // ASSISTANT textOutput: discard (D-FILTER)
        continue;
      }

      // audioOutput: discard (D-FILTER — we discard audio, only want text)
      // Any other event types: ignore
    }
  } catch (err: unknown) {
    // D-TEARDOWN: swallow post-completionEnd ValidationException.
    // The Python experiment hit this after the stream completed cleanly.
    // Likely a protocol timing issue where sessionEnd arrives while the
    // assistant's audio response is still closing — not a real error.
    const e = err as { name?: string };
    if (e?.name === "ValidationException") {
      databaseLogger.info(
        "[nova-sonic] Swallowed post-stream ValidationException (D-TEARDOWN)",
        { operation: "nova_sonic_transcribe_teardown_swallow" },
      );
      // Fall through — return whatever transcripts we captured
    } else {
      // All other errors propagate unchanged (voice.ts classifies AccessDenied)
      throw err;
    }
  }

  return transcripts.join(" ");
}
