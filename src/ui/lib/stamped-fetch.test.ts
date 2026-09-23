/**
 * Phase 111 SKEW-04: stampedFetch helper — RED tests.
 *
 * Contract: `stampedFetch(input, init?)` mirrors the global `fetch` API but
 * unconditionally stamps `X-Skynet-Client-Build: <CLIENT_BUILD_ID>` on the
 * outgoing request headers. All in-scope raw-fetch call sites (13 enumerated
 * in RESEARCH.md § Q2 for this plan) are rewritten to go through this helper
 * so client-side stamping is airtight-by-construction for the non-axios lane
 * (parallel to the request interceptor edit in `main-axios.ts`, which owns
 * the axios lane for all 8 instances).
 *
 * Out-of-scope (do NOT wrap): external URL fetches (avatar candidates from
 * pravatar/gravatar) and Electron server-config probes hitting user-configured
 * remote installs — those keep raw `fetch()`.
 *
 * These tests mock `globalThis.fetch` with `vi.fn()` and assert on the args
 * the mock was called with. Streaming semantics preserved — return type is
 * the raw `Response` untouched (no wrapping, no error interception).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stampedFetch } from "./stamped-fetch.js";
import { CLIENT_BUILD_ID } from "./client-build-id.js";

// Save and restore the global fetch so other test files aren't affected.
const originalFetch = globalThis.fetch;

describe("stampedFetch — Phase 111 SKEW-04 raw-fetch stamp wrapper", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response("ok", { status: 200, headers: {} }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("Test 1: stampedFetch(url) stamps X-Skynet-Client-Build on empty init", async () => {
    await stampedFetch("/x");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    // The wrapper normalizes to a Headers instance
    expect(headers).toBeInstanceOf(Headers);
    expect(headers.get("X-Skynet-Client-Build")).toBe(CLIENT_BUILD_ID);
  });

  it("Test 2: preserves existing plain-object headers AND adds the stamp", async () => {
    await stampedFetch("/x", {
      headers: { Authorization: "Bearer abc123" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer abc123");
    expect(headers.get("X-Skynet-Client-Build")).toBe(CLIENT_BUILD_ID);
  });

  it("Test 3: preserves existing Headers-instance headers AND adds the stamp", async () => {
    const existing = new Headers({ Authorization: "Bearer xyz789" });
    await stampedFetch("/x", { headers: existing });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer xyz789");
    expect(headers.get("X-Skynet-Client-Build")).toBe(CLIENT_BUILD_ID);
  });

  it("Test 4: forwards method, body, and signal verbatim", async () => {
    const controller = new AbortController();
    const body = JSON.stringify({ a: 1 });
    await stampedFetch("/x", {
      method: "POST",
      body,
      signal: controller.signal,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    expect(input).toBe("/x");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(body);
    expect(init.signal).toBe(controller.signal);
    // Stamp still landed
    expect((init.headers as Headers).get("X-Skynet-Client-Build")).toBe(
      CLIENT_BUILD_ID,
    );
  });

  it("Test 5: return type is the raw Response (streaming semantics preserved)", async () => {
    // Build a Response with a ReadableStream body to exercise the streaming
    // contract — the wrapper must NOT consume the body.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk-1"));
        controller.close();
      },
    });
    const upstream = new Response(stream, { status: 200 });
    fetchMock.mockResolvedValueOnce(upstream);

    const result = await stampedFetch("/x");
    expect(result).toBe(upstream);
    // Body is still a readable ReadableStream (never touched by the wrapper)
    expect(result.body).toBeInstanceOf(ReadableStream);
    const reader = result.body!.getReader();
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    expect(new TextDecoder().decode(value)).toBe("chunk-1");
  });
});
