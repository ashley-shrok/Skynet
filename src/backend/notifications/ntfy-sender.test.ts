/**
 * Phase 144 Plan 02 Task 2 — ntfy-sender tests.
 *
 * Tests exercise sendPushToUser (ntfy HTTP POST publisher) and buildClickUrl
 * (null-safe deep-link builder) from ntfy-sender.ts.
 *
 * Mocks:
 *   - global.fetch: for ntfy publish POST assertions
 *   - ../database/db/index.js: for the push_subscriptions SELECT
 *   - ./ntfy-config.js: for getNtfyInternalPublishUrl + getNtfyPublishToken
 *   - ../utils/logger.js: for databaseLogger.warn assertions
 *
 * Test coverage (from Plan 144-02 Task 2 <behavior> block):
 *   SND-01: sendPushToUser with no push_subscriptions row returns silently
 *   SND-02: sendPushToUser happy path POSTs to ntfy with correct headers
 *   SND-03: non-2xx response logs databaseLogger.warn and returns normally
 *   SND-04: fetch throwing (network error) logs databaseLogger.warn and returns normally
 *   SND-06 (HC-4): buildClickUrl(mxid, null) → URL has no host= query param
 *   SND-07 (HC-4): buildClickUrl(mxid, "h-123") → URL contains host=h-123
 *   SND-08 (HC-4): sendPushToUser with agentHostId=null sends Click with no host= param
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Logger mock ──────────────────────────────────────────────────────────────
const mockWarn = vi.fn();
const mockInfo = vi.fn();
vi.mock("../utils/logger.js", () => ({
  databaseLogger: { warn: mockWarn, info: mockInfo, error: vi.fn() },
  systemLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// ── ntfy-config mock ──────────────────────────────────────────────────────────
vi.mock("./ntfy-config.js", () => ({
  getNtfyInternalPublishUrl: () => "http://ntfy:2586",
  getNtfyPublishToken: () => "tk_testpublishtoken123456789012",
  getNtfyAdminUser: () => "test-admin",
  getNtfyAdminPassword: () => "test-admin-pass",
  getNtfyBaseUrl: () => "https://example.com/ntfy",
  assertNtfyConfigAtBoot: vi.fn(),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
// Mock the db.$client.prepare(...).get(...) for push_subscriptions SELECT.
let mockTopicRow: { topic_name: string } | undefined = undefined;

const mockPrepare = vi.fn((sql: string) => ({
  get: vi.fn((_userId: string) => {
    if (sql.includes("push_subscriptions")) {
      return mockTopicRow;
    }
    return undefined;
  }),
  all: vi.fn(() => []),
  run: vi.fn(() => ({ changes: 1 })),
}));

vi.mock("../database/db/index.js", () => ({
  db: {
    $client: {
      prepare: mockPrepare,
    },
  },
  DatabaseSaveTrigger: {
    forceSave: vi.fn().mockResolvedValue(undefined),
  },
}));

// Save and restore original fetch
const originalFetch = global.fetch;

function makeOkResponse(status = 200): Response {
  return {
    ok: true,
    status,
    text: async () => "ok",
    json: async () => ({}),
  } as unknown as Response;
}

function makeErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    text: async () => "error",
    json: async () => ({ error: "publish failed" }),
  } as unknown as Response;
}

describe("Phase 144-02 Task 2 — ntfy-sender (SND-01..SND-08)", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    mockTopicRow = undefined;
    mockWarn.mockClear();
    mockInfo.mockClear();
    mockPrepare.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("SND-01: sendPushToUser with no push_subscriptions row returns silently — no fetch call made", async () => {
    mockTopicRow = undefined; // no row
    global.fetch = vi.fn();

    const { sendPushToUser } = await import("./ntfy-sender.js");
    await sendPushToUser("user-123", {
      title: "Test",
      body: "Hello",
      agentMxid: "@agent:skynet",
      agentHostId: 42,
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("SND-02: sendPushToUser happy path POSTs to ntfy with Bearer auth, Title, Click, Content-Type", async () => {
    mockTopicRow = { topic_name: "abc123def456" };
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse(200));
    global.fetch = mockFetch;

    const { sendPushToUser } = await import("./ntfy-sender.js");
    await sendPushToUser("user-123", {
      title: "Agent:",
      body: "Hello from agent",
      agentMxid: "@agent:skynet",
      agentHostId: 42,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://ntfy:2586/abc123def456");
    expect(options.method).toBe("POST");
    const headers = options.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tk_testpublishtoken123456789012");
    expect(headers["Title"]).toBe("Agent:");
    expect(headers["Content-Type"]).toBe("text/plain");
    expect(headers["Click"]).toBeDefined();
    // Click header should contain openHarness param
    expect(headers["Click"]).toContain("openHarness=");
    expect(options.body).toBe("Hello from agent");
  });

  it("SND-03: non-2xx response logs databaseLogger.warn with ntfy_publish_failed and returns normally", async () => {
    mockTopicRow = { topic_name: "abc123def456" };
    global.fetch = vi.fn().mockResolvedValue(makeErrorResponse(503));

    const { sendPushToUser } = await import("./ntfy-sender.js");
    // Must NOT throw
    await expect(
      sendPushToUser("user-123", {
        title: "T",
        body: "B",
        agentMxid: "@a:s",
        agentHostId: 1,
      }),
    ).resolves.toBeUndefined();

    expect(mockWarn).toHaveBeenCalledOnce();
    const warnCall = mockWarn.mock.calls[0] as [string, Record<string, unknown>];
    expect(warnCall[1]).toMatchObject({
      operation: "ntfy_publish_failed",
      userId: "user-123",
      statusCode: 503,
    });
  });

  it("SND-04: fetch throwing (network error) logs databaseLogger.warn with ntfy_publish_threw and returns normally", async () => {
    mockTopicRow = { topic_name: "abc123def456" };
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    const { sendPushToUser } = await import("./ntfy-sender.js");
    // Must NOT throw
    await expect(
      sendPushToUser("user-123", {
        title: "T",
        body: "B",
        agentMxid: "@a:s",
        agentHostId: 1,
      }),
    ).resolves.toBeUndefined();

    expect(mockWarn).toHaveBeenCalledOnce();
    const warnCall = mockWarn.mock.calls[0] as [string, Record<string, unknown>];
    expect(warnCall[1]).toMatchObject({
      operation: "ntfy_publish_threw",
      userId: "user-123",
    });
  });

  it("SND-06 (HC-4): buildClickUrl(mxid, null) returns URL with NO host= query param", async () => {
    const { buildClickUrl } = await import("./ntfy-sender.js");
    const url = buildClickUrl("@agent:skynet", null);

    // Parse the URL to check query params
    const parsed = new URL(url, "http://localhost");
    expect(parsed.searchParams.has("host")).toBe(false);
    // Should still have openHarness param
    expect(parsed.searchParams.has("openHarness")).toBe(true);
    // Must not contain literal 'host=null', 'host=undefined', or 'host='
    expect(url).not.toContain("host=null");
    expect(url).not.toContain("host=undefined");
    // No 'host=' at all
    expect(url).not.toMatch(/[?&]host=/);
  });

  it("SND-07 (HC-4): buildClickUrl(mxid, 'h-123') returns URL containing host=h-123", async () => {
    const { buildClickUrl } = await import("./ntfy-sender.js");
    const url = buildClickUrl("@agent:skynet", "h-123");

    const parsed = new URL(url, "http://localhost");
    expect(parsed.searchParams.get("host")).toBe("h-123");
    expect(parsed.searchParams.get("openHarness")).toBe("@agent:skynet");
  });

  it("SND-08 (HC-4): sendPushToUser with agentHostId=null sends Click header with no host= param", async () => {
    mockTopicRow = { topic_name: "mytopic" };
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse(200));
    global.fetch = mockFetch;

    const { sendPushToUser } = await import("./ntfy-sender.js");
    await sendPushToUser("user-123", {
      title: "Test:",
      body: "Test body",
      agentMxid: "@system:skynet",
      agentHostId: null,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const clickHeader = (options.headers as Record<string, string>)["Click"];
    expect(clickHeader).toBeDefined();
    expect(clickHeader).not.toContain("host=null");
    expect(clickHeader).not.toContain("host=undefined");
    expect(clickHeader).not.toMatch(/[?&]host=/);
    expect(clickHeader).toContain("openHarness=");
  });
});
