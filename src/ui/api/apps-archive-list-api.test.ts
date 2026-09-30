import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Phase 143 Plan 143-05 Task 2 — listArchivedApps API client ──────────────
//
// Locks the wire shape of the new `listArchivedApps()` API helper against the
// backend endpoint spec in plan 143-03:
//
//   GET /apps-archive
//   200 → ArchivedAppListEntry[]  (fleet-wide, D-07)
//   4xx/5xx → throws via handleApiError
//
// The compound key `hostId:slug` mirrors PrettyConversationsPanel.tsx:3025.
// title + iconUrl are optional fields — happy-path test includes them to lock
// the interface shape; absent = caller falls back to slug.

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
  listArchivedApps,
  type ArchivedAppListEntry,
} from "@/api/apps-archive-list-api";
import { authApi } from "@/main-axios";

describe("Phase 143 Plan 143-05 Task 2 — listArchivedApps", () => {
  beforeEach(() => {
    vi.mocked(authApi.get).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Test 1 (happy): listArchivedApps() issues GET /apps-archive with no query
  //                 params and returns the typed array.
  it("Test 1 (happy): listArchivedApps() GETs /apps-archive and returns entry array", async () => {
    const entries: ArchivedAppListEntry[] = [
      { hostId: 42, slug: "my-app", title: "My App", iconUrl: "/icon.png" },
      { hostId: 7, slug: "another-app" },
    ];
    vi.mocked(authApi.get).mockResolvedValueOnce({ data: entries });

    const result = await listArchivedApps();

    expect(authApi.get).toHaveBeenCalledTimes(1);
    expect(authApi.get).toHaveBeenCalledWith("/apps-archive");
    expect(result).toEqual(entries);
  });

  // Test 2 (error): GET fails → handleApiError invoked.
  it("Test 2 (error): GET failure causes handleApiError to be invoked", async () => {
    vi.mocked(authApi.get).mockRejectedValueOnce(
      new Error("Request failed with status code 500"),
    );

    await expect(listArchivedApps()).rejects.toThrow(/list archived apps/i);
  });
});
