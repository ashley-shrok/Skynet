import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Phase 115 Plan 115-06 Task 1 — archiveIdentity API client ──────────────
//
// Locks the wire shape of the new `archiveIdentity(hostId, identityKey)` API
// helper against the backend endpoint landed in 115-03:
//
//   POST /identities/:key/archive
//   body: { hostId: number }
//   200 → { ok: true }
//   4xx/5xx → throws with informative message
//
// Mocks `@/main-axios` at module level per the sibling test convention
// (see user-preferences-api.test.ts § vi.mock("@/main-axios", ...)).

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

import { archiveIdentity } from "@/api/identity-archive-api";
import { authApi } from "@/main-axios";

describe("Phase 115 Plan 115-06 Task 1 — archiveIdentity", () => {
  beforeEach(() => {
    vi.mocked(authApi.post).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Test 1 (happy): archiveIdentity issues POST /identities/wren/archive with
  //                 body { hostId } and returns the parsed response.
  it("Test 1 (happy): archiveIdentity(42, 'wren') POSTs /identities/wren/archive with body { hostId: 42 } and returns { ok: true }", async () => {
    vi.mocked(authApi.post).mockResolvedValueOnce({
      data: { ok: true },
    });

    const result = await archiveIdentity(42, "wren");

    expect(authApi.post).toHaveBeenCalledTimes(1);
    expect(authApi.post).toHaveBeenCalledWith("/identities/wren/archive", {
      hostId: 42,
    });
    expect(result).toEqual({ ok: true });
  });

  // Test 2 (400): backend rejects → helper throws.
  it("Test 2 (400): non-2xx response causes archiveIdentity to throw", async () => {
    vi.mocked(authApi.post).mockRejectedValueOnce(
      new Error("Request failed with status code 400"),
    );

    await expect(archiveIdentity(1, "wren")).rejects.toThrow(
      /archive identity/i,
    );
  });

  // Test 3 (404): mocks a 404 response — throws.
  it("Test 3 (404): 404 response causes archiveIdentity to throw", async () => {
    vi.mocked(authApi.post).mockRejectedValueOnce(
      new Error("Request failed with status code 404"),
    );

    await expect(archiveIdentity(1, "wren")).rejects.toThrow(
      /archive identity/i,
    );
  });

  // Test 4 (500): mocks a 500 response — throws.
  it("Test 4 (500): 500 response causes archiveIdentity to throw", async () => {
    vi.mocked(authApi.post).mockRejectedValueOnce(
      new Error("Request failed with status code 500"),
    );

    await expect(archiveIdentity(1, "wren")).rejects.toThrow(
      /archive identity/i,
    );
  });

  // Test 5 (identity key encoding): identity keys with URL-special characters
  //                                 flow through encodeURIComponent so the URL
  //                                 does not double-encode or break.
  it("Test 5 (identity key encoding): non-trivial identity key is encoded into the URL path", async () => {
    vi.mocked(authApi.post).mockResolvedValueOnce({
      data: { ok: true },
    });

    // Space becomes %20; slash becomes %2F. Sanity-checks that the identity
    // key runs through encodeURIComponent rather than being pasted raw into
    // the URL. (The backend's IDENTITY_KEY_RE gate rejects such keys, but the
    // encoding is the frontend's contract — a client bug where a raw slash
    // splits the URL path segment is the failure this locks against.)
    await archiveIdentity(1, "wren name/x");

    expect(authApi.post).toHaveBeenCalledWith(
      "/identities/wren%20name%2Fx/archive",
      { hostId: 1 },
    );
  });
});
