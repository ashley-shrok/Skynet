import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Phase 143 Plan 143-05 Task 1 — unarchiveApp API client ──────────────────
//
// Locks the wire shape of the new `unarchiveApp(hostId, slug)` API helper
// against the backend endpoint spec in plan 143-04:
//
//   POST /apps/:hostId/:slug/unarchive
//   body: (empty — hostId is in the path)
//   200 → { ok: true }
//   409 → { reason: "name_collision" | "archive_not_found" }
//   non-409 → throws ApiError via handleApiError
//
// D-03 / D-17: structured 409 surfaces UnarchiveError with typed reason field.
// The hostId-in-path convention matches apps-archive-api.ts:33.

function makeAxiosError(status: number, data: unknown): Error {
  const err = new Error(`Request failed with status code ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number; data: unknown };
  };
  err.isAxiosError = true;
  err.response = { status, data };
  return err;
}

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      isAxiosError: (err: unknown): boolean => {
        return (err as { isAxiosError?: boolean }).isAxiosError === true;
      },
    },
    isAxiosError: (err: unknown): boolean => {
      return (err as { isAxiosError?: boolean }).isAxiosError === true;
    },
  };
});

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

import { unarchiveApp, UnarchiveError } from "@/api/apps-unarchive-api";
import { authApi } from "@/main-axios";

describe("Phase 143 Plan 143-05 Task 1 — unarchiveApp", () => {
  beforeEach(() => {
    vi.mocked(authApi.post).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Test 1 (happy): unarchiveApp issues POST /apps/42/my-app/unarchive (no body)
  //                 and returns the parsed response.
  it("Test 1 (happy): unarchiveApp(42, 'my-app') POSTs /apps/42/my-app/unarchive and returns { ok: true }", async () => {
    vi.mocked(authApi.post).mockResolvedValueOnce({ data: { ok: true } });

    const result = await unarchiveApp(42, "my-app");

    expect(authApi.post).toHaveBeenCalledTimes(1);
    expect(authApi.post).toHaveBeenCalledWith("/apps/42/my-app/unarchive");
    expect(result).toEqual({ ok: true });
  });

  // Test 2 (409 name_collision): live app with same slug exists on this host.
  it("Test 2 (409 name_collision): throws UnarchiveError with reason 'name_collision'", async () => {
    vi.mocked(authApi.post).mockRejectedValueOnce(
      makeAxiosError(409, { reason: "name_collision" }),
    );

    let caught: unknown;
    try {
      await unarchiveApp(1, "my-app");
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(UnarchiveError);
    const err = caught as UnarchiveError;
    expect(err.reason).toBe("name_collision");
    expect(err.missingRoles).toBeUndefined();
  });

  // Test 3 (500 / network): non-409 error → flows through handleApiError.
  it("Test 3 (500): non-409 error causes handleApiError to be invoked (throws non-UnarchiveError)", async () => {
    const networkError = new Error("Request failed with status code 500");
    vi.mocked(authApi.post).mockRejectedValueOnce(networkError);

    let caught: unknown;
    try {
      await unarchiveApp(1, "my-app");
    } catch (e) {
      caught = e;
    }

    expect(caught).not.toBeInstanceOf(UnarchiveError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/un-archive app/i);
  });
});
