import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Phase 143 Plan 143-05 Task 1 — unarchiveIdentity API client ─────────────
//
// Locks the wire shape of the new `unarchiveIdentity(hostId, identityKey)` API
// helper against the backend endpoint spec in plan 143-04:
//
//   POST /identities/:key/unarchive
//   body: { hostId: number }
//   200 → { ok: true }
//   409 → { reason: "missing_roles" | "name_collision" | "archive_not_found" }
//   non-409 → throws ApiError via handleApiError
//
// D-03 / D-17: structured 409 surfaces UnarchiveError with typed reason field.
//
// Mocks `@/main-axios` and `axios` at module level. The axios mock must expose
// `isAxiosError` so the 409 parser in identity-unarchive-api.ts can gate on it.

// Build a fake axios error that passes isAxiosError
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

import {
  unarchiveIdentity,
  UnarchiveError,
} from "@/api/identity-unarchive-api";
import { authApi } from "@/main-axios";

describe("Phase 143 Plan 143-05 Task 1 — unarchiveIdentity", () => {
  beforeEach(() => {
    vi.mocked(authApi.post).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Test 1 (happy): unarchiveIdentity issues POST /identities/wren/unarchive
  //                 with body { hostId } and returns the parsed response.
  it("Test 1 (happy): unarchiveIdentity(42, 'wren') POSTs /identities/wren/unarchive with body { hostId: 42 } and returns { ok: true }", async () => {
    vi.mocked(authApi.post).mockResolvedValueOnce({ data: { ok: true } });

    const result = await unarchiveIdentity(42, "wren");

    expect(authApi.post).toHaveBeenCalledTimes(1);
    expect(authApi.post).toHaveBeenCalledWith(
      "/identities/wren/unarchive",
      { hostId: 42 },
    );
    expect(result).toEqual({ ok: true });
  });

  // Test 2 (409 missing_roles): identity depends on still-archived roles.
  //   Asserts: throws UnarchiveError, reason === "missing_roles",
  //            missingRoles deep-equals ["ops-oncall"].
  it("Test 2 (409 missing_roles): throws UnarchiveError with reason 'missing_roles' and missingRoles=['ops-oncall']", async () => {
    vi.mocked(authApi.post).mockRejectedValueOnce(
      makeAxiosError(409, {
        reason: "missing_roles",
        missingRoles: ["ops-oncall"],
      }),
    );

    let caught: unknown;
    try {
      await unarchiveIdentity(1, "wren");
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(UnarchiveError);
    const err = caught as UnarchiveError;
    expect(err.reason).toBe("missing_roles");
    expect(err.missingRoles).toEqual(["ops-oncall"]);
  });

  // Test 3 (409 name_collision): live object with same key exists.
  //   Asserts: throws UnarchiveError, reason === "name_collision",
  //            missingRoles is undefined.
  it("Test 3 (409 name_collision): throws UnarchiveError with reason 'name_collision' and missingRoles undefined", async () => {
    vi.mocked(authApi.post).mockRejectedValueOnce(
      makeAxiosError(409, { reason: "name_collision" }),
    );

    let caught: unknown;
    try {
      await unarchiveIdentity(1, "wren");
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(UnarchiveError);
    const err = caught as UnarchiveError;
    expect(err.reason).toBe("name_collision");
    expect(err.missingRoles).toBeUndefined();
  });

  // Test 4 (500 / network): non-409 error → flows through handleApiError
  //   (handleApiError mock re-throws as plain Error, NOT UnarchiveError).
  it("Test 4 (500): non-409 error causes handleApiError to be invoked (throws non-UnarchiveError)", async () => {
    const networkError = new Error("Request failed with status code 500");
    vi.mocked(authApi.post).mockRejectedValueOnce(networkError);

    let caught: unknown;
    try {
      await unarchiveIdentity(1, "wren");
    } catch (e) {
      caught = e;
    }

    expect(caught).not.toBeInstanceOf(UnarchiveError);
    expect(caught).toBeInstanceOf(Error);
    // handleApiError mock formats as "operation: msg"
    expect((caught as Error).message).toMatch(/un-archive identity/i);
  });
});
