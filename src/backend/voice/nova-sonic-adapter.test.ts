import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Phase 109 plan 01 — nova-sonic-adapter unit tests with mocked AWS SDK.
 *
 * vi.mock pattern mirrors transcribe-adapter.test.ts and polly-adapter.test.ts:
 * vi.hoisted ctor spies + vi.mock function-ctor pattern, adapter imported
 * dynamically AFTER the mock is installed.
 *
 * Coverage:
 *   1. BedrockRuntimeClient singleton constructed exactly once at import
 *   2. Ctor receives region: 'us-east-1' and NO credentials property (D-CREDS)
 *   3. NodeHttp2Handler constructed with correct timeouts/streams (D-TRANSPORT)
 *   4. InvokeModelWithBidirectionalStreamCommand receives modelId + async iterable body (D-PROV)
 *   5. Event send sequence exactly matches locked schema (D-EVENTS + D-AUDIOOUT + D-ASYNCGEN)
 *   6. Audio chunking at 1920 bytes/chunk, base64-encoded (D-AUDIO)
 *   7. role=USER textOutput accumulated; ASSISTANT text + audioOutput discarded (D-FILTER)
 *   8. Empty transcript when no USER textOutput events
 *   9. Clean teardown: post-completionEnd ValidationException swallowed (D-TEARDOWN)
 *  10. Non-ValidationException errors propagate unchanged
 *  11. AccessDeniedException propagates unchanged (not swallowed by adapter)
 *  12. Singleton reuse: ctor count stays at 1 across multiple calls
 */

const {
  bedrockClientCtor,
  invokeCmdCtor,
  sendMock,
  nodeHttp2HandlerCtor,
} = vi.hoisted(() => ({
  bedrockClientCtor: vi.fn(),
  invokeCmdCtor: vi.fn(),
  sendMock: vi.fn(),
  nodeHttp2HandlerCtor: vi.fn(),
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  function BedrockRuntimeClient(this: unknown, cfg: unknown) {
    bedrockClientCtor(cfg);
    (this as { send: unknown }).send = sendMock;
  }
  function InvokeModelWithBidirectionalStreamCommand(
    this: unknown,
    input: unknown,
  ) {
    invokeCmdCtor(input);
    (this as { input: unknown }).input = input;
  }
  return { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand };
});

vi.mock("@smithy/node-http-handler", () => {
  function NodeHttp2Handler(this: unknown, cfg: unknown) {
    nodeHttp2HandlerCtor(cfg);
  }
  return { NodeHttp2Handler };
});

// Import AFTER vi.mock so the adapter picks up the mocked SDK.
const { transcribeNovaSonic } = await import("./nova-sonic-adapter.js");

// ---------------------------------------------------------------------------
// Helper: build a fake async-iterable response body for the receive side
// Each event is { chunk: { bytes: TextEncoder.encode(JSON.stringify(event)) } }
// ---------------------------------------------------------------------------
function fakeResponseBody(events: object[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const ev of events) {
        yield {
          chunk: {
            bytes: new TextEncoder().encode(JSON.stringify(ev)),
          },
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: drain the body iterable captured by invokeCmdCtor and return parsed
// events (skipping the 12ms pacing sleeps is fine in test — they're still
// awaited but resolve immediately under vi's fake-timer-free default).
// ---------------------------------------------------------------------------
async function drainBody(body: AsyncIterable<unknown>): Promise<object[]> {
  const collected: object[] = [];
  for await (const frame of body as AsyncIterable<{
    chunk: { bytes: Uint8Array };
  }>) {
    collected.push(
      JSON.parse(new TextDecoder().decode(frame.chunk.bytes)) as object,
    );
  }
  return collected;
}

// ---------------------------------------------------------------------------
// Test 1 — singleton: BedrockRuntimeClient ctor called exactly once
// ---------------------------------------------------------------------------
describe("nova-sonic-adapter — module-level singleton (D-SINGLETON)", () => {
  it("constructs BedrockRuntimeClient exactly once at module load", () => {
    expect(bedrockClientCtor).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — region + no credentials (D-CREDS + D-REGION)
// ---------------------------------------------------------------------------
describe("nova-sonic-adapter — BedrockRuntimeClient ctor shape (D-CREDS + D-REGION)", () => {
  it("receives region=us-east-1 and does NOT have a credentials property", () => {
    const ctorArg = bedrockClientCtor.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(ctorArg.region).toBe("us-east-1");
    expect(ctorArg).not.toHaveProperty("credentials");
  });
});

// ---------------------------------------------------------------------------
// Test 3 — NodeHttp2Handler config (D-TRANSPORT)
// ---------------------------------------------------------------------------
describe("nova-sonic-adapter — NodeHttp2Handler config (D-TRANSPORT)", () => {
  it("constructs NodeHttp2Handler with requestTimeout=300_000, sessionTimeout=300_000, maxConcurrentStreams=20", () => {
    expect(nodeHttp2HandlerCtor).toHaveBeenCalledTimes(1);
    expect(nodeHttp2HandlerCtor.mock.calls[0][0]).toEqual({
      requestTimeout: 300_000,
      sessionTimeout: 300_000,
      maxConcurrentStreams: 20,
    });
  });
});

// ---------------------------------------------------------------------------
// Remaining tests share a beforeEach that resets invokeCmdCtor + sendMock
// ---------------------------------------------------------------------------
describe("nova-sonic-adapter — command shape + event sequence", () => {
  beforeEach(() => {
    invokeCmdCtor.mockClear();
    sendMock.mockReset();
  });

  // Test 4 — command shape + modelId (D-PROV)
  it("Test 4: invokes InvokeModelWithBidirectionalStreamCommand with modelId=amazon.nova-2-sonic-v1:0 and async iterable body", async () => {
    sendMock.mockResolvedValueOnce({
      body: fakeResponseBody([{ completionEnd: {} }]),
    });

    await transcribeNovaSonic(Buffer.alloc(1920));

    expect(invokeCmdCtor).toHaveBeenCalledTimes(1);
    const input = invokeCmdCtor.mock.calls[0][0] as {
      modelId: string;
      body: AsyncIterable<unknown>;
    };
    expect(input.modelId).toBe("amazon.nova-2-sonic-v1:0");
    expect(typeof (input.body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator]).toBe("function");
  });

  // Test 5 — event sequence (D-EVENTS + D-AUDIOOUT + D-ASYNCGEN)
  it("Test 5: generates events in exact order: sessionStart → promptStart (with audioOutputConfiguration) → SYSTEM contentStart/textInput/contentEnd → USER audio contentStart → audioInput(s) → USER contentEnd → promptEnd → sessionEnd", async () => {
    // Capture the body iterable before send() returns — we inspect it separately
    let capturedBody: AsyncIterable<unknown> | null = null;
    sendMock.mockImplementationOnce(
      async (cmd: { input: { body: AsyncIterable<unknown> } }) => {
        capturedBody = cmd.input.body;
        return { body: fakeResponseBody([{ completionEnd: {} }]) };
      },
    );

    const buffer = Buffer.alloc(1920 * 2); // 2 chunks
    await transcribeNovaSonic(buffer);

    expect(capturedBody).not.toBeNull();
    const events = await drainBody(capturedBody!);

    // Verify ordering of top-level keys
    expect(Object.keys(events[0])).toContain("sessionStart");

    const promptStartEvent = events[1] as Record<string, unknown>;
    expect(Object.keys(promptStartEvent)).toContain("promptStart");
    const promptStart = promptStartEvent.promptStart as Record<string, unknown>;
    expect(promptStart).toHaveProperty("textOutputConfiguration");
    expect(promptStart).toHaveProperty("audioOutputConfiguration");

    const systemContentStart = events[2] as Record<string, unknown>;
    expect(Object.keys(systemContentStart)).toContain("contentStart");
    const cs1 = systemContentStart.contentStart as Record<string, unknown>;
    expect(cs1.role).toBe("SYSTEM");
    expect(cs1.type).toBe("TEXT");

    expect(Object.keys(events[3])).toContain("textInput");

    expect(Object.keys(events[4])).toContain("contentEnd");

    const userContentStart = events[5] as Record<string, unknown>;
    expect(Object.keys(userContentStart)).toContain("contentStart");
    const cs2 = userContentStart.contentStart as Record<string, unknown>;
    expect(cs2.role).toBe("USER");
    expect(cs2.type).toBe("AUDIO");
    expect(cs2).toHaveProperty("audioInputConfiguration");

    // events[6] and [7] are audioInput chunks (2 × 1920 B)
    const audioInputEvents = events.slice(6, events.length - 3);
    expect(audioInputEvents.length).toBeGreaterThanOrEqual(1);
    for (const ae of audioInputEvents) {
      expect(Object.keys(ae)).toContain("audioInput");
    }

    // Last 3: USER contentEnd, promptEnd, sessionEnd
    const last3 = events.slice(events.length - 3);
    expect(Object.keys(last3[0])).toContain("contentEnd");
    expect(Object.keys(last3[1])).toContain("promptEnd");
    expect(Object.keys(last3[2])).toContain("sessionEnd");
  });

  // Test 6 — audio chunking (D-AUDIO)
  it("Test 6: 5 × 1920-byte buffer emits exactly 5 audioInput events, each base64-encoded at 1920 bytes", async () => {
    let capturedBody: AsyncIterable<unknown> | null = null;
    sendMock.mockImplementationOnce(
      async (cmd: { input: { body: AsyncIterable<unknown> } }) => {
        capturedBody = cmd.input.body;
        return { body: fakeResponseBody([{ completionEnd: {} }]) };
      },
    );

    await transcribeNovaSonic(Buffer.alloc(1920 * 5));

    expect(capturedBody).not.toBeNull();
    const events = await drainBody(capturedBody!);
    const audioInputEvents = events.filter(
      (e) => "audioInput" in (e as Record<string, unknown>),
    ) as Array<{ audioInput: { content: string } }>;

    expect(audioInputEvents).toHaveLength(5);
    for (const ae of audioInputEvents) {
      const decoded = Buffer.from(ae.audioInput.content, "base64");
      expect(decoded.length).toBe(1920);
    }
  });

  // Test 7 — role=USER filter (D-FILTER)
  it("Test 7: accumulates only USER textOutput content; discards ASSISTANT text and audioOutput", async () => {
    sendMock.mockResolvedValueOnce({
      body: fakeResponseBody([
        { textOutput: { role: "USER", content: "hello world" } },
        { textOutput: { role: "ASSISTANT", content: "sure thing!" } },
        { audioOutput: { content: "base64audiobytes" } },
        { completionEnd: {} },
      ]),
    });

    const result = await transcribeNovaSonic(Buffer.alloc(1920));
    expect(result).toBe("hello world");
  });

  // Test 8 — empty transcript
  it("Test 8: resolves to empty string when only ASSISTANT textOutput + audioOutput + completionEnd", async () => {
    sendMock.mockResolvedValueOnce({
      body: fakeResponseBody([
        { textOutput: { role: "ASSISTANT", content: "some response" } },
        { audioOutput: { content: "base64audiobytes" } },
        { completionEnd: {} },
      ]),
    });

    const result = await transcribeNovaSonic(Buffer.alloc(1920));
    expect(result).toBe("");
  });

  // Test 9 — clean teardown (D-TEARDOWN)
  it("Test 9: swallows ValidationException thrown after completionEnd, returns captured transcript", async () => {
    sendMock.mockResolvedValueOnce({
      body: {
        async *[Symbol.asyncIterator]() {
          yield {
            chunk: {
              bytes: new TextEncoder().encode(
                JSON.stringify({
                  textOutput: { role: "USER", content: "teardown test" },
                }),
              ),
            },
          };
          yield {
            chunk: {
              bytes: new TextEncoder().encode(
                JSON.stringify({ completionEnd: {} }),
              ),
            },
          };
          // Post-completionEnd: throw ValidationException
          const err = new Error("post-stream ValidationException");
          err.name = "ValidationException";
          throw err;
        },
      },
    });

    // Should resolve with transcript, NOT reject
    const result = await transcribeNovaSonic(Buffer.alloc(1920));
    expect(result).toBe("teardown test");
  });

  // Test 10 — error propagation (non-ValidationException)
  it("Test 10: propagates non-ValidationException errors unchanged", async () => {
    const networkErr = new Error("Network unreachable");
    networkErr.name = "NetworkError";
    sendMock.mockRejectedValueOnce(networkErr);

    await expect(transcribeNovaSonic(Buffer.alloc(1920))).rejects.toBe(
      networkErr,
    );
  });

  // Test 11 — AccessDeniedException not swallowed
  it("Test 11: propagates AccessDeniedException unchanged (adapter does not translate, voice.ts classifies)", async () => {
    const accessErr = new Error("Access denied to Bedrock");
    accessErr.name = "AccessDeniedException";
    Object.assign(accessErr, { $metadata: { httpStatusCode: 403 } });
    sendMock.mockRejectedValueOnce(accessErr);

    await expect(transcribeNovaSonic(Buffer.alloc(1920))).rejects.toBe(
      accessErr,
    );
  });

  // Test 12 — singleton reuse across calls
  it("Test 12: calling transcribeNovaSonic twice does not re-invoke BedrockRuntimeClient ctor", async () => {
    sendMock
      .mockResolvedValueOnce({
        body: fakeResponseBody([{ completionEnd: {} }]),
      })
      .mockResolvedValueOnce({
        body: fakeResponseBody([{ completionEnd: {} }]),
      });

    await transcribeNovaSonic(Buffer.alloc(1920));
    await transcribeNovaSonic(Buffer.alloc(1920));

    // Constructor was called exactly once at module import — never again
    expect(bedrockClientCtor.mock.calls.length).toBe(1);
  });
});
