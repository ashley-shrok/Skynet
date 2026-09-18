/**
 * image-gen-requests/end-to-end.test.ts — backend wire test for the
 * image-gen file-drop broker (Phase 116 Plan 04 Task 2).
 *
 * This is the "does the whole thing work together" test — Wave 1 (Plan 01)
 * tested each leaf module in isolation, Plan 03 tested each Wave-2 module in
 * isolation, and this test composes queue + worker + adapter + scan-orch
 * end-to-end against mocked fetch + mocked SSH channel + mocked filesystem
 * writers, so a single test file exercises the request-observation → queue
 * → worker → adapter → response-drop pipeline.
 *
 * Hermeticity:
 *   - No real OpenAI credential — process.env.OPENAI_API_KEY = "sk-test".
 *   - No real network — vi.stubGlobal("fetch", ...) intercepts every call.
 *   - No real SSH — SCAN test uses a mocked channel.exec that returns
 *     tab-separated stdout matching IMAGE_GEN_SCAN_CMD's output shape.
 *   - No real filesystem — writeMarkdownFileAtomic + writeBinaryFileAtomic
 *     are injected as vi.fn()s in WorkerDeps.
 *
 * Test surface (per Plan 04 <behavior>):
 *   HAPPY               — fetch 200 → binary write → JSON write, correct order
 *   RATE_LIMITED        — 429 → failure.json {reason:"rate_limited"}
 *   PROVIDER_UNAVAILABLE— 503 → failure.json {reason:"provider_unavailable"}
 *   CONTENT_BLOCKED     — 400 content_policy_violation → content_blocked + msg
 *   NOT_CONFIGURED      — no OPENAI_API_KEY → failure without fetch call
 *   MALFORMED           — 400 non-policy → malformed
 *   EXPIRED             — TTL check fires before adapter → failure, no fetch
 *   UNKNOWN             — 401 unclassified → unknown
 *   SCAN_INTEGRATION    — full pipeline: scan-orch tick → queue enqueue →
 *                          worker dequeue → mocked fetch → mocked writes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks (declared BEFORE the module imports so vitest hoists them).
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  };
  return {
    systemLogger: mockLogger,
    sshLogger: mockLogger,
    databaseLogger: mockLogger,
    logger: mockLogger,
  };
});

// ---------------------------------------------------------------------------
// Real module imports (after mocks).
// ---------------------------------------------------------------------------

import {
  enqueue,
  setProcessImageGen,
  setWorkerDeps,
  startPool,
  stopPool,
  isEmpty,
  __resetForTests as resetQueue,
} from "./queue.js";
import { processImageGen, type WorkerDeps } from "./worker.js";
import { callOpenAiImageGen } from "./adapter.js";
import { createTokenBucket, type TokenBucket } from "./token-bucket.js";
import {
  createImageGenScanOrchestrator,
  IMAGE_GEN_SCAN_CMD,
  type ImageGenScanHostRecord,
  type SshChannel,
} from "./scan-orchestrator.js";
import type { PendingImageGen } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a PendingImageGen for direct-enqueue tests. */
function makeItem(overrides?: Partial<PendingImageGen>): PendingImageGen {
  return {
    hostId: "42",
    hostIdNum: 42,
    uuid: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    body: {
      prompt: "a cat",
      requested_at: new Date().toISOString(),
      n: 1,
    },
    userId: "user-1",
    ...overrides,
  };
}

/**
 * Build a WorkerDeps whose atomic-writers are vi.fn() spies + isLocalHostId
 * defaults to true so no real SSH connection is attempted. Individual tests
 * override specific fields.
 */
function makeMockWorkerDeps(tokenBucket: TokenBucket, overrides?: Partial<WorkerDeps>): WorkerDeps {
  const deps: WorkerDeps = {
    writeMarkdownFileAtomic: vi.fn().mockResolvedValue(undefined),
    writeBinaryFileAtomic: vi.fn().mockResolvedValue(undefined),
    // LOCAL branch: no SSH connection is opened.
    isLocalHostId: vi.fn().mockReturnValue(true),
    // resolveHostById is only consulted on the REMOTE branch; provide a stub
    // that would return a valid host detail if any test ever flipped
    // isLocalHostId to false.
    resolveHostById: vi.fn().mockResolvedValue({
      ip: "10.0.0.1",
      port: 22,
      username: "user",
      authType: "password",
      password: "secret",
    }),
    connectOneShot: vi.fn().mockResolvedValue({ end: vi.fn() } as never),
    execCommand: vi.fn().mockResolvedValue(""),
    // Use the REAL adapter — the fetch mock stubs out the outbound call so
    // this exercises the real never-throw discriminated-union contract.
    callOpenAiImageGen,
    tokenBucket,
    now: () => Date.now(),
  };
  return { ...deps, ...overrides };
}

/**
 * Drain the queue: wait until the pending queue is empty AND every
 * outstanding worker microtask has flushed. A `for` loop of microtask flushes
 * is sufficient — the worker's `await deps.callOpenAiImageGen(...)` +
 * `await deps.writeBinaryFileAtomic(...)` + `await deps.writeMarkdownFileAtomic(...)`
 * each resolve as microtasks under mocked fetch (all mockResolvedValue).
 */
async function drainQueue(): Promise<void> {
  // 100 rounds of microtask flush is more than enough for a worker that
  // does at most ~3 sequential awaits per item.
  for (let i = 0; i < 100; i++) {
    if (isEmpty()) {
      // Also give the currently-executing worker microtask a chance to complete
      // its response-file writes.
      for (let j = 0; j < 20; j++) {
        await Promise.resolve();
      }
      return;
    }
    await Promise.resolve();
  }
}

/**
 * Build a fake OpenAI success response. `pngBytes` is the raw bytes to
 * embed as base64 for each image.
 */
function makeFetchSuccessResponse(pngBytesArr: Buffer[]): Response {
  const body = {
    data: pngBytesArr.map((b) => ({ b64_json: b.toString("base64") })),
  };
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Build a fake OpenAI error response with a given status + optional body. */
function makeFetchErrorResponse(status: number, body?: unknown): Response {
  const payload = body ?? {};
  return {
    ok: false,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Suite-level setup: use a high-rate token bucket so acquire() is
// effectively instant across every test.
// ---------------------------------------------------------------------------

let tokenBucket: TokenBucket;
let fetchMock: ReturnType<typeof vi.fn>;
let mockDeps: WorkerDeps;

beforeEach(() => {
  vi.clearAllMocks();
  resetQueue();
  // 600 RPM = 10/sec — capacity = max(1, floor(600*5/60)) = 50 tokens.
  // Plenty of headroom for a single-item test.
  tokenBucket = createTokenBucket(600);
  process.env.OPENAI_API_KEY = "sk-test";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  stopPool();
  delete process.env.OPENAI_API_KEY;
  resetQueue();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Wire the mocked deps + real processImageGen into the queue + start the pool. */
function startPipeline(depsOverrides?: Partial<WorkerDeps>): WorkerDeps {
  mockDeps = makeMockWorkerDeps(tokenBucket, depsOverrides);
  setWorkerDeps(mockDeps);
  setProcessImageGen(processImageGen);
  startPool();
  return mockDeps;
}

// ---------------------------------------------------------------------------
// HAPPY PATH
// ---------------------------------------------------------------------------

describe("image-gen end-to-end: HAPPY", () => {
  it("fetch 200 → binary writes for each PNG (before JSON) → success.json with correct filenames + model", async () => {
    const pngBytes = Buffer.from("fake png bytes");
    fetchMock.mockResolvedValueOnce(makeFetchSuccessResponse([pngBytes]));

    const deps = startPipeline();

    // Track write order for the Pitfall-3-response-side invariant.
    const writeOrder: string[] = [];
    (deps.writeBinaryFileAtomic as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, path: string) => {
        writeOrder.push(`BIN:${path}`);
      },
    );
    (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, path: string) => {
        writeOrder.push(`JSON:${path}`);
      },
    );

    const uuid = "aaaaaaaa-1111-2222-3333-444444444444";
    enqueue(
      makeItem({
        uuid,
        body: { prompt: "cat", requested_at: new Date().toISOString(), n: 1 },
      }),
    );

    await drainQueue();

    // fetch called once with the correct URL + JSON body.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchCall = fetchMock.mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.openai.com/v1/images/generations");
    expect(fetchCall[1].method).toBe("POST");
    const parsedBody = JSON.parse(fetchCall[1].body as string);
    expect(parsedBody.model).toBe("gpt-image-1");
    expect(parsedBody.prompt).toBe("cat");
    expect(parsedBody.n).toBe(1);
    // Authorization header carries Bearer sk-test — do not leak this in logs
    // (adapter's log-safe contract is tested in adapter.test.ts).
    expect(fetchCall[1].headers.Authorization).toBe("Bearer sk-test");

    // 1 PNG write + 1 JSON write.
    expect(deps.writeBinaryFileAtomic).toHaveBeenCalledTimes(1);
    expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);

    // PNG path.
    const binCall = (deps.writeBinaryFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(binCall[1]).toBe(`$HOME/fleet/image-gen-requests/${uuid}.success.0.png`);
    expect((binCall[2] as Buffer).equals(pngBytes)).toBe(true);

    // JSON path + body.
    const jsonCall = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(jsonCall[1]).toBe(`$HOME/fleet/image-gen-requests/${uuid}.success.json`);
    const jsonBody = JSON.parse(jsonCall[2] as string);
    expect(jsonBody.model).toBe("gpt-image-1");
    expect(jsonBody.n).toBe(1);
    expect(jsonBody.images).toEqual([`${uuid}.success.0.png`]);

    // Write order: PNG BEFORE JSON (Pitfall 3 response side).
    expect(writeOrder[0]).toBe(`BIN:$HOME/fleet/image-gen-requests/${uuid}.success.0.png`);
    expect(writeOrder[1]).toBe(`JSON:$HOME/fleet/image-gen-requests/${uuid}.success.json`);
  });
});

// ---------------------------------------------------------------------------
// ADAPTER FAILURE PATHS (D-27 all 7 reasons via the full worker+adapter stack)
// ---------------------------------------------------------------------------

describe("image-gen end-to-end: failure paths (D-27 enum)", () => {
  it("RATE_LIMITED — 429 → failure.json {reason:'rate_limited'}, no PNG writes", async () => {
    fetchMock.mockResolvedValueOnce(makeFetchErrorResponse(429));
    const deps = startPipeline();

    const uuid = "bbbbbbbb-1111-2222-3333-444444444444";
    enqueue(makeItem({ uuid }));
    await drainQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deps.writeBinaryFileAtomic).not.toHaveBeenCalled();
    expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const call = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe(`$HOME/fleet/image-gen-requests/${uuid}.failure.json`);
    expect(JSON.parse(call[2] as string)).toEqual({ reason: "rate_limited" });
  });

  it("PROVIDER_UNAVAILABLE — 503 → failure.json {reason:'provider_unavailable'}", async () => {
    fetchMock.mockResolvedValueOnce(makeFetchErrorResponse(503));
    const deps = startPipeline();

    const uuid = "cccccccc-1111-2222-3333-444444444444";
    enqueue(makeItem({ uuid }));
    await drainQueue();

    expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const call = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe(`$HOME/fleet/image-gen-requests/${uuid}.failure.json`);
    expect(JSON.parse(call[2] as string)).toEqual({ reason: "provider_unavailable" });
  });

  it("CONTENT_BLOCKED — 400 content_policy_violation → failure.json content_blocked + message", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchErrorResponse(400, {
        error: { code: "content_policy_violation", message: "nope" },
      }),
    );
    const deps = startPipeline();

    const uuid = "dddddddd-1111-2222-3333-444444444444";
    enqueue(makeItem({ uuid }));
    await drainQueue();

    expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const call = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe(`$HOME/fleet/image-gen-requests/${uuid}.failure.json`);
    const parsed = JSON.parse(call[2] as string);
    expect(parsed.reason).toBe("content_blocked");
    expect(parsed.message).toBe("nope");
  });

  it("NOT_CONFIGURED — no OPENAI_API_KEY → failure.json not_configured + fetch NEVER called", async () => {
    delete process.env.OPENAI_API_KEY;
    const deps = startPipeline();

    const uuid = "eeeeeeee-1111-2222-3333-444444444444";
    enqueue(makeItem({ uuid }));
    await drainQueue();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const call = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe(`$HOME/fleet/image-gen-requests/${uuid}.failure.json`);
    expect(JSON.parse(call[2] as string)).toEqual({ reason: "not_configured" });
  });

  it("MALFORMED — 400 non-policy → failure.json malformed + message (from OpenAI error body)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchErrorResponse(400, {
        error: { code: "invalid_request", message: "prompt too long" },
      }),
    );
    const deps = startPipeline();

    const uuid = "ffffffff-1111-2222-3333-444444444444";
    enqueue(makeItem({ uuid }));
    await drainQueue();

    expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const call = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe(`$HOME/fleet/image-gen-requests/${uuid}.failure.json`);
    const parsed = JSON.parse(call[2] as string);
    expect(parsed.reason).toBe("malformed");
    expect(parsed.message).toBe("prompt too long");
  });

  it("EXPIRED — TTL-expired item → failure.json expired + fetch NEVER called + token NEVER acquired", async () => {
    // Track token bucket acquire calls.
    const acquireSpy = vi.spyOn(tokenBucket, "acquire");

    const deps = startPipeline();
    const uuid = "11111111-2222-3333-4444-555555555555";
    // 6 minutes ago — past the 5-min TTL.
    const oldReqAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    enqueue(
      makeItem({
        uuid,
        body: { prompt: "cat", requested_at: oldReqAt, n: 1 },
      }),
    );
    await drainQueue();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(acquireSpy).not.toHaveBeenCalled();
    expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const call = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe(`$HOME/fleet/image-gen-requests/${uuid}.failure.json`);
    expect(JSON.parse(call[2] as string)).toEqual({ reason: "expired" });
  });

  it("UNKNOWN — 401 unclassified → failure.json unknown + message", async () => {
    fetchMock.mockResolvedValueOnce(makeFetchErrorResponse(401, { error: { message: "bad key" } }));
    const deps = startPipeline();

    const uuid = "22222222-3333-4444-5555-666666666666";
    enqueue(makeItem({ uuid }));
    await drainQueue();

    expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const call = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe(`$HOME/fleet/image-gen-requests/${uuid}.failure.json`);
    const parsed = JSON.parse(call[2] as string);
    expect(parsed.reason).toBe("unknown");
    // Message is present with the "status 401" tag from the adapter.
    expect(parsed.message).toContain("401");
  });
});

// ---------------------------------------------------------------------------
// SCAN INTEGRATION — full pipeline from mocked SSH channel to mocked writes.
// ---------------------------------------------------------------------------

describe("image-gen end-to-end: SCAN_INTEGRATION", () => {
  it("scan tick → parse → enqueue → dequeue → adapter → response drop, all in one pass", async () => {
    // Set up a mocked channel that returns tab-separated stdout matching the
    // IMAGE_GEN_SCAN_CMD output shape when its exec is called with that cmd.
    const uuid = "abcdef01-2345-6789-abcd-ef0123456789";
    const requestBody = JSON.stringify({
      prompt: "a mountain",
      requested_at: new Date().toISOString(),
      n: 1,
    });
    const scanStdout = `${uuid}.json\t${requestBody}\n`;

    const channelExec = vi.fn(async (cmd: string) => {
      if (cmd === IMAGE_GEN_SCAN_CMD) return scanStdout;
      // No companion ref in this test — reject any other cmd.
      return "";
    });
    const channel: SshChannel = { exec: channelExec };

    const hosts: ImageGenScanHostRecord[] = [
      { id: "42", name: "test-host", _connDetails: {} },
    ];

    // Mock a fetch success response.
    const pngBytes = Buffer.from("scan-integration-png-bytes");
    fetchMock.mockResolvedValueOnce(makeFetchSuccessResponse([pngBytes]));

    // Wire the worker + queue with mocked writers.
    const deps = startPipeline();

    // Build the scan-orchestrator with the queue's real enqueue as the deps
    // hookpoint so the full pipeline flows.
    const setIntervalMock = vi.fn(
      (_fn: () => Promise<void> | void, _ms: number) => 1 as unknown as ReturnType<typeof setInterval>,
    );
    const clearIntervalMock = vi.fn();
    const orch = createImageGenScanOrchestrator({
      listSubstrateHosts: async () => hosts,
      acquireChannel: async () => channel,
      releaseChannel: vi.fn(),
      enqueue,
      setInterval: setIntervalMock,
      clearInterval: clearIntervalMock,
      now: () => Date.now(),
      scanIntervalMs: 10000,
    });

    // Kick off the initial scan pass.
    await orch.start();
    // Fully drain the queue: worker dequeues the item, invokes real adapter
    // (which calls mocked fetch), gets the base64 PNG back, writes the two
    // response files.
    await drainQueue();

    // Assert the full chain executed.
    expect(channelExec).toHaveBeenCalledWith(IMAGE_GEN_SCAN_CMD);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/images/generations");

    // 1 PNG + 1 JSON write with the correct uuid-derived paths.
    expect(deps.writeBinaryFileAtomic).toHaveBeenCalledTimes(1);
    expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const binCall = (deps.writeBinaryFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(binCall[1]).toBe(`$HOME/fleet/image-gen-requests/${uuid}.success.0.png`);
    expect((binCall[2] as Buffer).equals(pngBytes)).toBe(true);
    const jsonCall = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(jsonCall[1]).toBe(`$HOME/fleet/image-gen-requests/${uuid}.success.json`);
    const jsonBody = JSON.parse(jsonCall[2] as string);
    expect(jsonBody.images).toEqual([`${uuid}.success.0.png`]);

    orch.stop();
  });
});
