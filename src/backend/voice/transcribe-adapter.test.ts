import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Phase 98 plan 04 — transcribe-adapter unit tests with mocked AWS SDK.
 *
 * vi.mock pattern per 98-RESEARCH.md § Example 3, mirroring the polly-adapter
 * test structure. Real-AWS integration lives in
 * `transcribe-adapter.integration.test.ts` (env-gated behind
 * AWS_INTEGRATION_TESTS=1).
 *
 * The CRITICAL contract this file protects is Pitfall 3 — the partial-vs-final
 * result filter. Without the `result.IsPartial === false` guard, Transcribe's
 * progressively-longer partials would concatenate into a hallucinated repeated
 * transcript ("hello", "hello there", "hello there world" → "hello hello there
 * hello there world"). One dedicated test asserts the filter is enforced.
 *
 * Additional coverage:
 *   - TranscribeStreamingClient ctor: NO credentials arg (mirror Polly's Pitfall 2 rule)
 *   - Command shape: LanguageCode "en-US", MediaSampleRateHertz, MediaEncoding
 *   - Empty-input edge case (only-partial events → empty transcript)
 *   - Missing TranscriptResultStream → throws
 */

const {
  transcribeClientCtor,
  startStreamCmdCtor,
  sendMock,
} = vi.hoisted(() => ({
  transcribeClientCtor: vi.fn(),
  startStreamCmdCtor: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-transcribe-streaming", () => {
  function TranscribeStreamingClient(this: unknown, cfg: unknown) {
    transcribeClientCtor(cfg);
    (this as { send: unknown }).send = sendMock;
  }
  function StartStreamTranscriptionCommand(this: unknown, input: unknown) {
    startStreamCmdCtor(input);
    (this as { input: unknown }).input = input;
  }
  return { TranscribeStreamingClient, StartStreamTranscriptionCommand };
});

// Import AFTER vi.mock so the adapter picks up the mocked SDK.
const { transcribeBuffer } = await import("./transcribe-adapter.js");

/**
 * Build a fake async-iterable TranscriptResultStream that the SDK response
 * mimics. Each event is `{ TranscriptEvent: { Transcript: { Results: [...] } } }`.
 */
function fakeTranscriptStream(
  results: Array<{ IsPartial: boolean; transcript: string }>,
): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const r of results) {
        yield {
          TranscriptEvent: {
            Transcript: {
              Results: [
                {
                  IsPartial: r.IsPartial,
                  Alternatives: [{ Transcript: r.transcript }],
                },
              ],
            },
          },
        };
      }
    },
  };
}

describe("transcribe-adapter — client construction (module-level singleton)", () => {
  it("constructs TranscribeStreamingClient exactly once at module load", () => {
    expect(transcribeClientCtor).toHaveBeenCalledTimes(1);
  });

  it("constructs TranscribeStreamingClient with region us-east-1 and NO credentials arg", () => {
    // Mirror of Pitfall 2 for the twin client — IMDS via default chain only.
    const args = transcribeClientCtor.mock.calls[0]?.[0];
    expect(args).toEqual({ region: "us-east-1" });
    expect(args).not.toHaveProperty("credentials");
  });
});

describe("transcribe-adapter — StartStreamTranscriptionCommand construction", () => {
  beforeEach(() => {
    startStreamCmdCtor.mockClear();
    sendMock.mockReset();
  });

  it("builds command with LanguageCode 'en-US', MediaEncoding, MediaSampleRateHertz, and AudioStream", async () => {
    sendMock.mockResolvedValueOnce({
      TranscriptResultStream: fakeTranscriptStream([]),
    });
    await transcribeBuffer(Buffer.from([1, 2, 3, 4]), "ogg-opus", 16000);
    expect(startStreamCmdCtor).toHaveBeenCalledTimes(1);
    const input = startStreamCmdCtor.mock.calls[0][0];
    expect(input.LanguageCode).toBe("en-US");
    expect(input.MediaEncoding).toBe("ogg-opus");
    expect(input.MediaSampleRateHertz).toBe(16000);
    // AudioStream is an async iterable — assert shape, not identity.
    expect(input.AudioStream).toBeDefined();
    expect(typeof input.AudioStream[Symbol.asyncIterator]).toBe("function");
  });

  it("passes MediaEncoding='flac' and sampleRateHz through when provided", async () => {
    sendMock.mockResolvedValueOnce({
      TranscriptResultStream: fakeTranscriptStream([]),
    });
    await transcribeBuffer(Buffer.from([0]), "flac", 44100);
    const input = startStreamCmdCtor.mock.calls[0][0];
    expect(input.MediaEncoding).toBe("flac");
    expect(input.MediaSampleRateHertz).toBe(44100);
  });
});

describe("transcribe-adapter — partial-vs-final result filtering (Pitfall 3)", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("returns ONLY final transcripts; partials are dropped (mixed input)", async () => {
    // The canonical Pitfall 3 case: progressive partials + a single final.
    sendMock.mockResolvedValueOnce({
      TranscriptResultStream: fakeTranscriptStream([
        { IsPartial: true, transcript: "hello" },
        { IsPartial: true, transcript: "hello there" },
        { IsPartial: false, transcript: "hello there world" },
      ]),
    });
    const result = await transcribeBuffer(Buffer.from([0]), "ogg-opus", 16000);
    expect(result).toBe("hello there world");
  });

  it("returns empty string when the stream contains only partial events", async () => {
    sendMock.mockResolvedValueOnce({
      TranscriptResultStream: fakeTranscriptStream([
        { IsPartial: true, transcript: "partial only" },
        { IsPartial: true, transcript: "partial only more" },
      ]),
    });
    const result = await transcribeBuffer(Buffer.from([0]), "ogg-opus", 16000);
    expect(result).toBe("");
  });

  it("joins multiple final segments with a single space", async () => {
    sendMock.mockResolvedValueOnce({
      TranscriptResultStream: fakeTranscriptStream([
        { IsPartial: false, transcript: "first segment" },
        { IsPartial: true, transcript: "partial ignored" },
        { IsPartial: false, transcript: "second segment" },
      ]),
    });
    const result = await transcribeBuffer(Buffer.from([0]), "ogg-opus", 16000);
    expect(result).toBe("first segment second segment");
  });
});

describe("transcribe-adapter — error paths", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("throws 'Transcribe returned no TranscriptResultStream' when field is undefined", async () => {
    sendMock.mockResolvedValueOnce({ TranscriptResultStream: undefined });
    await expect(
      transcribeBuffer(Buffer.from([0]), "ogg-opus", 16000),
    ).rejects.toThrow("Transcribe returned no TranscriptResultStream");
  });

  it("propagates SDK errors unchanged (does NOT swallow — voice.ts owns classification)", async () => {
    const sdkErr = new Error("Network unreachable");
    sendMock.mockRejectedValueOnce(sdkErr);
    await expect(
      transcribeBuffer(Buffer.from([0]), "ogg-opus", 16000),
    ).rejects.toBe(sdkErr);
  });
});
