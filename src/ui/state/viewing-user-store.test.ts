/**
 * Phase 90 Plan 05 Task 1 — viewing-user-store tests (W#8 resolution).
 *
 * Small state module exposing `useViewingUserMxid(): string | null` — the
 * single source of truth for the viewing user's Matrix mxid. Drives (a)
 * IdentityBadgeRow's D-07 self-exclusion filter and (b) RelayMessageList's
 * inbound-vs-outbound discrimination.
 *
 * Implementation choice (Option A per PLAN.md): fetches via `getUserInfo()`
 * (widened to include `mxid?: string`). Caches the value in a
 * module-scoped variable; subsequent subscribers get the cached value
 * without re-fetching. Fetch is fired once per app-mount (idempotent).
 * Failure keeps the cached value null and logs a structured warning via
 * console.warn (NEVER JSON.stringify the raw error).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock getUserInfo so tests can drive the fetch outcome without hitting
// the real /users/me endpoint.
vi.mock("@/main-axios", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    getUserInfo: vi.fn(),
  };
});

import { getUserInfo } from "@/main-axios";
import {
  useViewingUserMxid,
  useViewingUserId,
  __resetViewingUserStoreForTests,
} from "./viewing-user-store";

const mockedGetUserInfo = getUserInfo as unknown as ReturnType<typeof vi.fn>;

describe("viewing-user-store (Phase 90 Plan 05 Task 1 — W#8)", () => {
  beforeEach(() => {
    // Fresh store state each test — no leakage from prior tests' cache.
    __resetViewingUserStoreForTests();
    mockedGetUserInfo.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 9 (W#8): returns null on initial mount, then the mxid after the fetch resolves", async () => {
    let resolve: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve = r;
    });
    mockedGetUserInfo.mockReturnValueOnce(pending);

    const { result } = renderHook(() => useViewingUserMxid());

    // Initial mount — fetch is in flight, value is null.
    expect(result.current).toBe(null);

    // Resolve the fetch — hook should re-render with the mxid.
    await act(async () => {
      resolve({
        userId: "42",
        username: "ashley",
        is_admin: false,
        is_oidc: false,
        totp_enabled: false,
        data_unlocked: true,
        mxid: "@ashley:matrix.example.com",
      });
      // Flush the .then() microtask so the store publishes.
      await pending;
    });

    await waitFor(() => {
      expect(result.current).toBe("@ashley:matrix.example.com");
    });
  });

  it("Test 10: fetch failure leaves cached value null and logs a structured warning (no JSON.stringify)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedGetUserInfo.mockRejectedValueOnce(
      new Error("Request failed with status code 401"),
    );

    const { result } = renderHook(() => useViewingUserMxid());

    // Initial value is null.
    expect(result.current).toBe(null);

    // After the rejected fetch settles, value stays null and warn was called.
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });
    expect(result.current).toBe(null);

    // The warn payload MUST be a structured object with an `operation` field
    // — NEVER JSON.stringify of the raw error (PATTERNS.md § 2 discipline).
    const call = warnSpy.mock.calls[0];
    expect(call.length).toBeGreaterThan(0);
    const payload = call[0];
    expect(typeof payload).toBe("object");
    expect(payload).not.toBeNull();
    expect((payload as { operation: string }).operation).toBe(
      "viewing_user_mxid_fetch_failed",
    );
  });

  it("Test 11: fetch is fired ONCE per app-mount — subsequent hook consumers use the cached value", async () => {
    mockedGetUserInfo.mockResolvedValueOnce({
      userId: "42",
      username: "ashley",
      is_admin: false,
      is_oidc: false,
      totp_enabled: false,
      data_unlocked: true,
      mxid: "@ashley:matrix.example.com",
    });

    const { result: r1 } = renderHook(() => useViewingUserMxid());
    await waitFor(() => {
      expect(r1.current).toBe("@ashley:matrix.example.com");
    });

    // Mount three additional consumers.
    const { result: r2 } = renderHook(() => useViewingUserMxid());
    const { result: r3 } = renderHook(() => useViewingUserMxid());
    const { result: r4 } = renderHook(() => useViewingUserMxid());

    expect(r2.current).toBe("@ashley:matrix.example.com");
    expect(r3.current).toBe("@ashley:matrix.example.com");
    expect(r4.current).toBe("@ashley:matrix.example.com");

    // getUserInfo was called exactly once across all four mounts.
    expect(mockedGetUserInfo).toHaveBeenCalledTimes(1);
  });

  it("Test 12 (contract): the hook subscribes via useSyncExternalStore — value updates re-render consumers", async () => {
    // The hook must react to store updates. Use two separate renders across
    // a fetch-in-flight → fetch-resolved transition.
    let resolve: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve = r;
    });
    mockedGetUserInfo.mockReturnValueOnce(pending);

    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useViewingUserMxid();
    });

    const initialRenderCount = renderCount;
    expect(result.current).toBe(null);

    // Resolve — the store publishes, useSyncExternalStore triggers re-render.
    await act(async () => {
      resolve({
        userId: "42",
        username: "ashley",
        is_admin: false,
        is_oidc: false,
        totp_enabled: false,
        data_unlocked: true,
        mxid: "@ashley:matrix.example.com",
      });
      await pending;
    });

    await waitFor(() => {
      expect(result.current).toBe("@ashley:matrix.example.com");
    });

    // At least one additional render occurred after the store publish
    // (useSyncExternalStore semantics — value change re-renders subscribers).
    expect(renderCount).toBeGreaterThan(initialRenderCount);
  });

  it("Test 12b: null mxid on the UserInfo response leaves cached value null (backward-compat)", async () => {
    // Pre-Phase-90 backend response omits `mxid` entirely.
    mockedGetUserInfo.mockResolvedValueOnce({
      userId: "42",
      username: "ashley",
      is_admin: false,
      is_oidc: false,
      totp_enabled: false,
      data_unlocked: true,
      // no mxid field
    });

    const { result } = renderHook(() => useViewingUserMxid());

    // Allow the fetch to settle.
    await waitFor(() => {
      expect(mockedGetUserInfo).toHaveBeenCalledTimes(1);
    });
    // Even after settle, value stays null (nothing to cache).
    expect(result.current).toBe(null);
  });

  // ==========================================================================
  // L2 FIXUP TESTS (2026-09-09) — useViewingUserId parallel to useViewingUserMxid
  // ==========================================================================

  it("L2-fixup: useViewingUserId returns null on initial mount, then the userId after fetch resolves", async () => {
    mockedGetUserInfo.mockResolvedValueOnce({
      userId: "user-uuid-42",
      username: "ashley",
      is_admin: false,
      is_oidc: false,
      totp_enabled: false,
      data_unlocked: true,
      mxid: "@ashley:matrix.example.com",
    });
    const { result } = renderHook(() => useViewingUserId());
    await waitFor(() => {
      expect(result.current).toBe("user-uuid-42");
    });
  });

  it("L2-fixup: useViewingUserId and useViewingUserMxid share the SAME /users/me fetch — single round-trip", async () => {
    mockedGetUserInfo.mockResolvedValueOnce({
      userId: "user-uuid-99",
      username: "ashley",
      is_admin: false,
      is_oidc: false,
      totp_enabled: false,
      data_unlocked: true,
      mxid: "@ashley:matrix.example.com",
    });
    const { result: rId } = renderHook(() => useViewingUserId());
    const { result: rMxid } = renderHook(() => useViewingUserMxid());
    await waitFor(() => {
      expect(rId.current).toBe("user-uuid-99");
      expect(rMxid.current).toBe("@ashley:matrix.example.com");
    });
    // Both hooks resolved from a single fetch.
    expect(mockedGetUserInfo).toHaveBeenCalledTimes(1);
  });

  it("L2-fixup: fetch failure leaves userId null (mirrors the mxid null-on-failure discipline)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedGetUserInfo.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useViewingUserId());
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });
    expect(result.current).toBe(null);
    warnSpy.mockRestore();
  });

  it("L2-fixup: non-string userId coerces to null (defensive against pre-Phase-90 cached responses)", async () => {
    mockedGetUserInfo.mockResolvedValueOnce({
      userId: 42 as unknown as string, // numeric legacy shape
      username: "ashley",
      is_admin: false,
      is_oidc: false,
      totp_enabled: false,
      data_unlocked: true,
      mxid: "@ashley:matrix.example.com",
    });
    const { result } = renderHook(() => useViewingUserId());
    await waitFor(() => {
      expect(mockedGetUserInfo).toHaveBeenCalledTimes(1);
    });
    // Non-string coerces to null — the store guarantees `string | null`.
    expect(result.current).toBe(null);
  });
});
