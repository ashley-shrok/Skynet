import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Phase 133 Plan 133-02 Task 1 — archiveRole API client ──────────────────
//
// Locks the wire shape of the new `archiveRole(hostId, roleName)` API helper
// against the backend endpoint landed in 133-01:
//
//   POST /roles/:name/archive
//   body: { hostId: number }
//   200 → { ok: true }
//   4xx/5xx → throws with informative message
//
// This is a byte-shape clone of `identity-archive-api.test.ts` with the
// identity → role concept substitution. Mocks `@/main-axios` at module level
// per the sibling test convention.

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

import { archiveRole } from "@/api/role-archive-api";
import { authApi } from "@/main-axios";

describe("Phase 133 Plan 133-02 Task 1 — archiveRole", () => {
  beforeEach(() => {
    vi.mocked(authApi.post).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Test 1 (happy): archiveRole issues POST /roles/box-maintainer/archive with
  //                 body { hostId } and returns the parsed response.
  it("Test 1 (happy): archiveRole(42, 'box-maintainer') POSTs /roles/box-maintainer/archive with body { hostId: 42 } and returns { ok: true }", async () => {
    vi.mocked(authApi.post).mockResolvedValueOnce({
      data: { ok: true },
    });

    const result = await archiveRole(42, "box-maintainer");

    expect(authApi.post).toHaveBeenCalledTimes(1);
    expect(authApi.post).toHaveBeenCalledWith(
      "/roles/box-maintainer/archive",
      { hostId: 42 },
    );
    expect(result).toEqual({ ok: true });
  });

  // Test 2 (400): backend rejects → helper throws.
  it("Test 2 (400): non-2xx response causes archiveRole to throw", async () => {
    vi.mocked(authApi.post).mockRejectedValueOnce(
      new Error("Request failed with status code 400"),
    );

    await expect(archiveRole(1, "box-maintainer")).rejects.toThrow(
      /archive role/i,
    );
  });

  // Test 3 (404): mocks a 404 response — throws.
  it("Test 3 (404): 404 response causes archiveRole to throw", async () => {
    vi.mocked(authApi.post).mockRejectedValueOnce(
      new Error("Request failed with status code 404"),
    );

    await expect(archiveRole(1, "box-maintainer")).rejects.toThrow(
      /archive role/i,
    );
  });

  // Test 4 (500): mocks a 500 response — throws.
  it("Test 4 (500): 500 response causes archiveRole to throw", async () => {
    vi.mocked(authApi.post).mockRejectedValueOnce(
      new Error("Request failed with status code 500"),
    );

    await expect(archiveRole(1, "box-maintainer")).rejects.toThrow(
      /archive role/i,
    );
  });

  // Test 5 (URL encoding): role names with URL-special characters flow through
  //                        encodeURIComponent so the URL does not double-encode
  //                        or break. ROLE_NAME_PATTERN rejects spaces at the
  //                        backend, but the encoding is the frontend's contract
  //                        — a client bug where a raw special char splits the
  //                        URL path segment is the failure this locks against.
  it("Test 5 (URL encoding): non-trivial role name is encoded into the URL path", async () => {
    vi.mocked(authApi.post).mockResolvedValueOnce({
      data: { ok: true },
    });

    await archiveRole(1, "a b");

    expect(authApi.post).toHaveBeenCalledWith("/roles/a%20b/archive", {
      hostId: 1,
    });
  });
});
