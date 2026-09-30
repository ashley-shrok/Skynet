import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Phase 143 Plan 143-05 Task 2 — listArchivedIdentities API client ────────
//
// Locks the wire shape of the new `listArchivedIdentities()` API helper against
// the backend endpoint spec in plan 143-03:
//
//   GET /identities-archive
//   200 → ArchivedIdentityListEntry[]  (fleet-wide, D-07)
//   4xx/5xx → throws via handleApiError
//
// Mocks `@/main-axios` at module level per sibling test convention.

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

import {
  listArchivedIdentities,
  type ArchivedIdentityListEntry,
} from "@/api/identities-archive-list-api";
import { authApi } from "@/main-axios";

describe("Phase 143 Plan 143-05 Task 2 — listArchivedIdentities", () => {
  beforeEach(() => {
    vi.mocked(authApi.get).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Test 1 (happy): listArchivedIdentities issues GET /identities-archive
  //                 with no query params and returns the typed array.
  it("Test 1 (happy): listArchivedIdentities() GETs /identities-archive and returns entry array", async () => {
    const entries: ArchivedIdentityListEntry[] = [
      { identityKey: "wren", hostId: 42 },
      { identityKey: "sparrow", hostId: 7 },
    ];
    vi.mocked(authApi.get).mockResolvedValueOnce({ data: entries });

    const result = await listArchivedIdentities();

    expect(authApi.get).toHaveBeenCalledTimes(1);
    expect(authApi.get).toHaveBeenCalledWith("/identities-archive");
    expect(result).toEqual(entries);
  });

  // Test 2 (error): GET fails → handleApiError invoked.
  it("Test 2 (error): GET failure causes handleApiError to be invoked", async () => {
    vi.mocked(authApi.get).mockRejectedValueOnce(
      new Error("Request failed with status code 500"),
    );

    await expect(listArchivedIdentities()).rejects.toThrow(
      /list archived identities/i,
    );
  });
});
