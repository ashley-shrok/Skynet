/**
 * Phase 121 Plan 02 Task 2 — feedback-fetch tests.
 *
 * Verifies GET /api/feedback/enabled boot-time fetch that hydrates
 * feedback-store. Silent no-op on any failure path (network throw, non-2xx,
 * malformed body) — mirrors src/ui/branding/branding-fetch.ts philosophy of
 * NEVER breaking app boot regardless of backend health.
 *
 * DIVERGENCE from branding-fetch (documented in feedback-fetch.ts docstring):
 *   /api/feedback/enabled is AUTH-GATED (unlike /api/branding which is
 *   pre-login). Callers MUST run this AFTER auth. This test file does not
 *   assert the caller-side timing — that's Plan 04's AppShell wire — but
 *   does assert `credentials: "include"` on the fetch call so the auth
 *   cookie travels with the request.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { fetchFeedbackConfig } from "./feedback-fetch";
import {
  useFeedbackEnabled,
  __resetForTest as __resetFeedbackStore,
} from "./feedback-store";
import { renderHook } from "@testing-library/react";

// Preserve original global fetch so we can restore after each test.
const realFetch = globalThis.fetch;

function readFlag(): boolean {
  const { result } = renderHook(() => useFeedbackEnabled());
  return result.current;
}

describe("feedback-fetch (Phase 121 Plan 02 Task 2)", () => {
  beforeEach(() => {
    __resetFeedbackStore();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("2xx {enabled:true} → publishFeedbackEnabled(true)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ enabled: true }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await fetchFeedbackConfig();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Assert the URL + credentials:include on the auth-gated route.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/feedback/enabled");
    expect(init?.credentials).toBe("include");
    expect(readFlag()).toBe(true);
  });

  it("2xx {enabled:false} → publishFeedbackEnabled(false); flag remains false", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ enabled: false }),
    } as unknown as Response) as unknown as typeof fetch;

    await fetchFeedbackConfig();

    expect(readFlag()).toBe(false);
  });

  it("401 (auth failure) → publishFeedbackEnabled NOT called; no throw; flag stays default false", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ enabled: true }), // must not be read
    } as unknown as Response) as unknown as typeof fetch;

    await expect(fetchFeedbackConfig()).resolves.toBeUndefined();
    expect(readFlag()).toBe(false);
  });

  it("500 (server error) → publishFeedbackEnabled NOT called; no throw", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ enabled: true }),
    } as unknown as Response) as unknown as typeof fetch;

    await expect(fetchFeedbackConfig()).resolves.toBeUndefined();
    expect(readFlag()).toBe(false);
  });

  it("2xx with malformed body {foo:'bar'} → publishFeedbackEnabled NOT called; no throw (T-121-05 tampering mitigation)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ foo: "bar" }),
    } as unknown as Response) as unknown as typeof fetch;

    await expect(fetchFeedbackConfig()).resolves.toBeUndefined();
    expect(readFlag()).toBe(false);
  });

  it("network throw → publishFeedbackEnabled NOT called; no throw (T-121-06 DoS mitigation)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;

    await expect(fetchFeedbackConfig()).resolves.toBeUndefined();
    expect(readFlag()).toBe(false);
  });

  it("2xx but json.parse throws → publishFeedbackEnabled NOT called; no throw", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response) as unknown as typeof fetch;

    await expect(fetchFeedbackConfig()).resolves.toBeUndefined();
    expect(readFlag()).toBe(false);
  });

  it("2xx {enabled: 'yes'} (wrong type) → publishFeedbackEnabled NOT called (shape guard rejects)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ enabled: "yes" }),
    } as unknown as Response) as unknown as typeof fetch;

    await fetchFeedbackConfig();
    expect(readFlag()).toBe(false);
  });
});
