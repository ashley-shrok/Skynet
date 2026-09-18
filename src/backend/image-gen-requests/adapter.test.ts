/**
 * adapter.test.ts — Unit tests for the OpenAI image-gen adapter.
 *
 * Coverage (per plan 116-01 Task 3 behaviour list):
 *   H1  200 OK with data[b64_json] → {ok:true, images:Buffer[], generation_time_ms}
 *   H2  Multi-image response (n=3) → images.length === 3, order preserved
 *   E1  429 → {ok:false, reason:"rate_limited"} (D-23)
 *   E2  500 → {ok:false, reason:"provider_unavailable"} (D-24)
 *   E3  503 → {ok:false, reason:"provider_unavailable"} (D-24)
 *   E4  400 with error.code === "content_policy_violation" → content_blocked (D-27)
 *   E5  400 without that code → malformed with error.message
 *   E6  AbortError (timeout) → provider_unavailable with "openai timeout"
 *   E7  Missing OPENAI_API_KEY → not_configured, NO fetch call (Pitfall 4 + D-25)
 *   E8  401 (bad key) → unknown "status 401" — NOT not_configured (Pitfall 4)
 *   E9  200 with malformed JSON → unknown
 *   R1  refImage: Buffer → POSTs to /v1/images/edits with multipart body,
 *       Content-Type NOT set to application/json, Authorization present
 *   S1  Authorization header MUST start with "Bearer " (present in call, not logged)
 *
 * The adapter MUST NOT log the Authorization header, the API key, or the
 * full URL in any code path (T-116-01-01 mitigation).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the logger BEFORE importing the adapter so its module-scoped import
// picks up the mock.
vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
}));

import { callOpenAiImageGen } from "./adapter.js";
import type { ImageGenRequestBody } from "./types.js";
import { systemLogger } from "../utils/logger.js";

const VALID_BODY: ImageGenRequestBody = {
  prompt: "a cat",
  requested_at: "2026-09-18T00:00:00Z",
};

let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test-1234567890";
  vi.clearAllMocks();
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  vi.unstubAllGlobals();
});

/**
 * Build a Response-like object for vi.stubGlobal("fetch", ...) results.
 * Supports json() and text() consumers.
 */
function makeResponse(opts: {
  ok: boolean;
  status: number;
  json?: unknown;
  jsonThrows?: boolean;
}): Response {
  return {
    ok: opts.ok,
    status: opts.status,
    async json() {
      if (opts.jsonThrows) throw new SyntaxError("Unexpected token");
      return opts.json;
    },
    async text() {
      return typeof opts.json === "string" ? opts.json : JSON.stringify(opts.json);
    },
  } as unknown as Response;
}

describe("adapter — happy path", () => {
  it("H1: 200 OK returns {ok:true, images:[Buffer], generation_time_ms}", async () => {
    const raw = Buffer.from("hello-world-png-bytes");
    const b64 = raw.toString("base64");
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ ok: true, status: 200, json: { data: [{ b64_json: b64 }] } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callOpenAiImageGen(VALID_BODY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.images.length).toBe(1);
      expect(Buffer.isBuffer(result.images[0])).toBe(true);
      expect(result.images[0].equals(raw)).toBe(true);
      expect(result.generation_time_ms).toBeGreaterThanOrEqual(0);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    const initTyped = init as RequestInit;
    expect(initTyped.method).toBe("POST");
    const headers = initTyped.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toMatch(/^Bearer /);
  });

  it("H2: multi-image response preserves order", async () => {
    const raw = [Buffer.from("a"), Buffer.from("b"), Buffer.from("c")];
    const b64s = raw.map((b) => ({ b64_json: b.toString("base64") }));
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ ok: true, status: 200, json: { data: b64s } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callOpenAiImageGen({ ...VALID_BODY, n: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.images.length).toBe(3);
      expect(result.images[0].equals(raw[0])).toBe(true);
      expect(result.images[1].equals(raw[1])).toBe(true);
      expect(result.images[2].equals(raw[2])).toBe(true);
    }
  });
});

describe("adapter — provider error mapping", () => {
  it("E1: 429 → rate_limited (D-23)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeResponse({ ok: false, status: 429, json: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callOpenAiImageGen(VALID_BODY);
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("E2: 500 → provider_unavailable (D-24)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeResponse({ ok: false, status: 500, json: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callOpenAiImageGen(VALID_BODY);
    expect(result).toEqual({ ok: false, reason: "provider_unavailable" });
  });

  it("E3: 503 → provider_unavailable (D-24)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeResponse({ ok: false, status: 503, json: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callOpenAiImageGen(VALID_BODY);
    expect(result).toEqual({ ok: false, reason: "provider_unavailable" });
  });

  it("E4: 400 with error.code content_policy_violation → content_blocked", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({
        ok: false,
        status: 400,
        json: { error: { code: "content_policy_violation", message: "your prompt was refused" } },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await callOpenAiImageGen(VALID_BODY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("content_blocked");
      expect(result.message).toBe("your prompt was refused");
    }
  });

  it("E5: 400 without content_policy_violation → malformed with error.message", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({
        ok: false,
        status: 400,
        json: { error: { code: "invalid_request_error", message: "bad size value" } },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await callOpenAiImageGen(VALID_BODY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("malformed");
      expect(result.message).toBe("bad size value");
    }
  });

  it("E5b: 400 with empty body → malformed with fallback message", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeResponse({ ok: false, status: 400, jsonThrows: true }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callOpenAiImageGen(VALID_BODY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("malformed");
      expect(result.message).toBe("bad request");
    }
  });

  it("E6: AbortError → provider_unavailable with openai timeout", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const ac = init?.signal;
      // Simulate an aborted fetch by throwing AbortError.
      const err = new Error("The user aborted a request.");
      err.name = "AbortError";
      // Reference signal to avoid unused-var lint.
      void ac;
      throw err;
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await callOpenAiImageGen(VALID_BODY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("provider_unavailable");
      expect(result.message).toBe("openai timeout");
    }
  });

  it("E7: missing OPENAI_API_KEY → not_configured, NO fetch call", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await callOpenAiImageGen(VALID_BODY);
    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("E8: 401 → unknown 'status 401' (NOT not_configured — Pitfall 4)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeResponse({ ok: false, status: 401, json: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callOpenAiImageGen(VALID_BODY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unknown");
      expect(result.message).toBe("status 401");
    }
  });

  it("E9: 200 with malformed JSON body → unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonThrows: true }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callOpenAiImageGen(VALID_BODY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unknown");
      expect(result.message).toBeDefined();
    }
  });
});

describe("adapter — refImage multipart path", () => {
  it("R1: refImage buffer → POSTs to /v1/images/edits with FormData body", async () => {
    const raw = Buffer.from("out-png");
    const b64 = raw.toString("base64");
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse({ ok: true, status: 200, json: { data: [{ b64_json: b64 }] } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const refImage = Buffer.from("png-bytes-here");
    const bodyWithRef: ImageGenRequestBody = {
      ...VALID_BODY,
      ref: "abcdef01-2345-6789-abcd-ef0123456789.ref.png",
    };
    const result = await callOpenAiImageGen(bodyWithRef, refImage);
    expect(result.ok).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    const initTyped = init as RequestInit;
    expect(initTyped.method).toBe("POST");
    const headers = initTyped.headers as Record<string, string>;
    // Multipart: Content-Type MUST NOT be set to application/json — the
    // fetch runtime derives the multipart boundary.
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers.Authorization).toMatch(/^Bearer /);
    // Body should be a FormData instance.
    expect(initTyped.body).toBeInstanceOf(FormData);
  });
});

describe("adapter — no secret leakage", () => {
  it("S1: logger receives no Authorization header or API key values", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeResponse({ ok: false, status: 429, json: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await callOpenAiImageGen(VALID_BODY);
    const info = systemLogger.info as unknown as { mock: { calls: unknown[][] } };
    const warn = systemLogger.warn as unknown as { mock: { calls: unknown[][] } };
    const allCalls = [...info.mock.calls, ...warn.mock.calls];
    const flattened = JSON.stringify(allCalls);
    expect(flattened).not.toContain("sk-test-1234567890");
    expect(flattened).not.toContain("Authorization");
    expect(flattened).not.toContain("Bearer sk-");
  });
});
