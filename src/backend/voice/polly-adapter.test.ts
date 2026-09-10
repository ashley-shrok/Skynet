import { describe, it, expect, beforeEach, vi } from "vitest";
import { Readable } from "node:stream";

/**
 * Phase 98 plan 04 — polly-adapter unit tests with mocked AWS SDK.
 *
 * vi.mock pattern per 98-RESEARCH.md § Example 3. The SDK is mocked at the
 * top of this file so no real Polly call is ever made from these tests;
 * real-Polly integration lives in `polly-adapter.integration.test.ts`
 * (env-gated behind AWS_INTEGRATION_TESTS=1).
 *
 * Assertion targets (from 98-04-PLAN.md § Task 2 <behavior>):
 *   1. PollyClient constructed with `{region: "us-east-1"}` and NO
 *      credentials arg (per Pitfall 2 — passing anything explicit disables
 *      the IMDS-inclusive default chain).
 *   2. Client is constructed exactly ONCE at module-load (singleton).
 *   3. synthesizeToPcm builds SynthesizeSpeechCommand with the locked
 *      generative-engine PCM 16kHz shape.
 *   4. Returns the SDK's Readable directly on success.
 *   5. Throws "Polly returned no AudioStream" when the mock response
 *      returns an undefined AudioStream field.
 *
 * Structured with hoisted `vi.fn()` bindings so the client/command
 * constructors and send() method are inspectable from tests without
 * reaching into module internals.
 */

// Hoisted mock functions — vi.mock factory runs before imports.
const { pollyClientCtor, synthesizeSpeechCmdCtor, sendMock } = vi.hoisted(() => {
  return {
    pollyClientCtor: vi.fn(),
    synthesizeSpeechCmdCtor: vi.fn(),
    sendMock: vi.fn(),
  };
});

vi.mock("@aws-sdk/client-polly", () => ({
  PollyClient: pollyClientCtor.mockImplementation(() => ({ send: sendMock })),
  SynthesizeSpeechCommand: synthesizeSpeechCmdCtor.mockImplementation((input: unknown) => ({
    input,
  })),
}));

// Import AFTER vi.mock so the adapter picks up the mocked SDK.
const { synthesizeToPcm } = await import("./polly-adapter.js");

describe("polly-adapter — client construction (module-level singleton)", () => {
  it("constructs PollyClient exactly once at module load", () => {
    // Module-load-time construction — importing the adapter above triggered it.
    expect(pollyClientCtor).toHaveBeenCalledTimes(1);
  });

  it("constructs PollyClient with region us-east-1 and NO credentials arg", () => {
    // Pitfall 2: passing `credentials` (any value) disables the
    // @aws-sdk/credential-provider-node default chain, which is what
    // gives IMDS-based auth on EC2 for free. Assert absence explicitly.
    const args = pollyClientCtor.mock.calls[0]?.[0];
    expect(args).toEqual({ region: "us-east-1" });
    expect(args).not.toHaveProperty("credentials");
  });
});

describe("polly-adapter — synthesizeToPcm command construction", () => {
  beforeEach(() => {
    synthesizeSpeechCmdCtor.mockClear();
    sendMock.mockReset();
  });

  it("builds SynthesizeSpeechCommand with the locked generative/pcm/16000 shape", async () => {
    sendMock.mockResolvedValueOnce({
      AudioStream: Readable.from([Buffer.from([1, 2, 3])]),
    });
    await synthesizeToPcm("Hello.", "Joanna");
    expect(synthesizeSpeechCmdCtor).toHaveBeenCalledTimes(1);
    expect(synthesizeSpeechCmdCtor.mock.calls[0][0]).toEqual({
      Text: "Hello.",
      Engine: "generative",
      OutputFormat: "pcm",
      SampleRate: "16000",
      VoiceId: "Joanna",
    });
  });

  it("returns the Readable from the SDK response on success", async () => {
    const fakeStream = Readable.from([Buffer.from([9, 8, 7])]);
    sendMock.mockResolvedValueOnce({ AudioStream: fakeStream });
    const result = await synthesizeToPcm("World.", "Matthew");
    expect(result).toBe(fakeStream);
  });

  it("passes the requested VoiceId through unchanged (does not hardcode)", async () => {
    sendMock.mockResolvedValueOnce({
      AudioStream: Readable.from([Buffer.from([0])]),
    });
    await synthesizeToPcm("Test.", "Danielle");
    expect(synthesizeSpeechCmdCtor.mock.calls[0][0].VoiceId).toBe("Danielle");
  });
});

describe("polly-adapter — error paths", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("throws 'Polly returned no AudioStream' when AudioStream is undefined", async () => {
    sendMock.mockResolvedValueOnce({ AudioStream: undefined });
    await expect(synthesizeToPcm("Hello.", "Joanna")).rejects.toThrow(
      "Polly returned no AudioStream",
    );
  });

  it("propagates SDK errors unchanged (does NOT swallow — voice.ts owns classification)", async () => {
    const sdkErr = new Error("Network unreachable");
    sendMock.mockRejectedValueOnce(sdkErr);
    await expect(synthesizeToPcm("Hello.", "Joanna")).rejects.toBe(sdkErr);
  });
});
