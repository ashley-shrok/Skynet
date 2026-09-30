import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Phase 143 Plan 143-05 Task 2 — listArchivedRoles API client ─────────────
//
// Locks the wire shape of the new `listArchivedRoles(hostId)` API helper against
// the backend endpoint spec in plan 143-03:
//
//   GET /roles-archive?hostId=<n>
//   200 → ArchivedRoleListEntry[]  (host-scoped, D-07)
//   4xx/5xx → throws via handleApiError
//
// Key assertion: URL must include `?hostId=42` (host-scoped per D-07).

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
  listArchivedRoles,
  type ArchivedRoleListEntry,
} from "@/api/roles-archive-list-api";
import { authApi } from "@/main-axios";

describe("Phase 143 Plan 143-05 Task 2 — listArchivedRoles", () => {
  beforeEach(() => {
    vi.mocked(authApi.get).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Test 1 (happy): listArchivedRoles(42) issues GET /roles-archive with
  //                 query param hostId=42 and returns the typed array.
  it("Test 1 (happy): listArchivedRoles(42) GETs /roles-archive?hostId=42 and returns entry array", async () => {
    const entries: ArchivedRoleListEntry[] = [
      { name: "ops-oncall" },
      { name: "infra-admin" },
    ];
    vi.mocked(authApi.get).mockResolvedValueOnce({ data: entries });

    const result = await listArchivedRoles(42);

    expect(authApi.get).toHaveBeenCalledTimes(1);
    // Verify the hostId param is passed (axios serializes it to ?hostId=42)
    expect(authApi.get).toHaveBeenCalledWith("/roles-archive", {
      params: { hostId: 42 },
    });
    expect(result).toEqual(entries);
    // D-07 host-scoped assertion: the called args include hostId=42
    const callArgs = vi.mocked(authApi.get).mock.calls[0];
    expect(JSON.stringify(callArgs)).toContain("42");
  });

  // Test 2 (error): GET fails → handleApiError invoked.
  it("Test 2 (error): GET failure causes handleApiError to be invoked", async () => {
    vi.mocked(authApi.get).mockRejectedValueOnce(
      new Error("Request failed with status code 500"),
    );

    await expect(listArchivedRoles(42)).rejects.toThrow(
      /list archived roles/i,
    );
  });
});
