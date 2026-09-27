import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── archiveApp API client — wire-shape tests ──────────────────────────────
//
// Locks the wire shape of the `archiveApp(hostId, slug)` helper against the
// backend endpoint:
//
//   POST /apps/:hostId/:slug/archive
//   body: (empty)
//   200 → { ok: true }
//   4xx/5xx → throws with informative message
//
// Byte-shape parallel of role-archive-api.test.ts / identity-archive-api.test.ts
// with the domain substitution to apps + the path-shape divergence (hostId in
// URL path rather than body).

vi.mock("@/main-axios", () => ({
  authApi: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
  },
  handleApiError: (err: unknown, operation: string): never => {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "unknown error";
    throw new Error(`${operation}: ${msg}`);
  },
}));

import { archiveApp } from "@/api/apps-archive-api";
import { authApi } from "@/main-axios";

describe("archiveApp", () => {
  beforeEach(() => {
    vi.mocked(authApi.post).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Test 1 (happy): archiveApp issues POST /apps/:hostId/:slug/archive with
  //                 empty body and returns the parsed response.
  it("Test 1 (happy): archiveApp(42, 'my-app') POSTs /apps/42/my-app/archive with no body and returns { ok: true }", async () => {
    vi.mocked(authApi.post).mockResolvedValueOnce({
      data: { ok: true },
    });

    const result = await archiveApp(42, "my-app");

    expect(authApi.post).toHaveBeenCalledTimes(1);
    expect(authApi.post).toHaveBeenCalledWith("/apps/42/my-app/archive");
    expect(result).toEqual({ ok: true });
  });

  // Test 2 (400): backend rejects → helper throws.
  it("Test 2 (400): non-2xx response causes archiveApp to throw", async () => {
    vi.mocked(authApi.post).mockRejectedValueOnce(
      new Error("Request failed with status code 400"),
    );

    await expect(archiveApp(1, "my-app")).rejects.toThrow(/archive app/i);
  });

  // Test 3 (404): mocks a 404 response — throws.
  it("Test 3 (404): 404 response causes archiveApp to throw", async () => {
    vi.mocked(authApi.post).mockRejectedValueOnce(
      new Error("Request failed with status code 404"),
    );

    await expect(archiveApp(1, "my-app")).rejects.toThrow(/archive app/i);
  });

  // Test 4 (500): mocks a 500 response — throws.
  it("Test 4 (500): 500 response causes archiveApp to throw", async () => {
    vi.mocked(authApi.post).mockRejectedValueOnce(
      new Error("Request failed with status code 500"),
    );

    await expect(archiveApp(1, "my-app")).rejects.toThrow(/archive app/i);
  });

  // Test 5 (URL encoding): slugs with URL-special characters flow through
  //                        encodeURIComponent. APP_SLUG_RE rejects such slugs
  //                        at the backend, but the encoding is the frontend's
  //                        contract — a client bug where a raw special char
  //                        splits the URL path segment is the failure this
  //                        locks against.
  it("Test 5 (URL encoding): non-trivial slug is encoded into the URL path segment", async () => {
    vi.mocked(authApi.post).mockResolvedValueOnce({
      data: { ok: true },
    });

    await archiveApp(1, "a b");

    expect(authApi.post).toHaveBeenCalledWith("/apps/1/a%20b/archive");
  });
});
