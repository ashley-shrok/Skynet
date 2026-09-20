/**
 * Phase 118 Plan 118-05 Task 1 — app-frame-filter unit tests (TDD RED phase).
 *
 * The filter is the FIRST fleet-status caller of checkHostAccess in the
 * codebase (RESEARCH § Q4 verified: grep for the function returns only its
 * export site prior to this plan). Deny-by-default on unknown hosts (Test 9)
 * and on error paths (Test 10). Backward-compat guard for no-ctx subscribers
 * (Test 6) matches the shape of the existing bare `subscribe(sendFrame)`
 * callers in fleet-status-server + subscription-registry tests.
 *
 * The filter's `_checkHostAccess` dependency is injected as an optional
 * parameter so these tests can pass a `vi.fn()` mock without `vi.mock`ing
 * the whole host-resolver module (cleaner test purity — RESEARCH § Q7).
 */
import { describe, it, expect, vi } from "vitest";

import {
  createAccessCache,
  createAppFrameFilter,
  filterAppFrame,
} from "./app-frame-filter.js";
import type { AppFrameFilterCtx } from "./app-frame-filter.js";
import type { AppState, FrontendOutboundFrameType } from "./wire-protocol.js";
import {
  FRAME_SCHEMA_VERSION,
  makeAppGoneFrame,
  makeAppSnapshotFrame,
  makeAppUpdateFrame,
  makeGoneFrame,
} from "./wire-protocol.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeAppState(
  hostId: string,
  slug: string,
  overrides: Partial<AppState> = {},
): AppState {
  return {
    hostId,
    slug,
    title: `App ${slug}`,
    description: "test app",
    port: 9591,
    hasIcon: false,
    createdAtMs: 1_700_000_000_000,
    isHealthy: true,
    healthMessage: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("app-frame-filter", () => {
  it("Test 1: owner-self path — resolver returns { hostIdNum, hostUserId: U } for U, app-update passes verbatim", async () => {
    const app = makeAppState("h1", "todo");
    const frame = makeAppUpdateFrame(app);
    const resolver = vi
      .fn<
        (hostIdStr: string) => Promise<{ hostIdNum: number; hostUserId: string } | null>
      >()
      .mockResolvedValue({ hostIdNum: 1, hostUserId: "U" });
    const checkAccessMock = vi.fn(async () => true);

    const ctx: AppFrameFilterCtx = { userId: "U", resolveHostOwnerById: resolver };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).toEqual(frame);
    expect(resolver).toHaveBeenCalledWith("h1");
    // The mock returned true; whether it was invoked or not is fine — production
    // checkHostAccess short-circuits on owner-self BEFORE PermissionManager,
    // but the mock here just always returns true so we don't over-constrain.
  });

  it("Test 2: non-owner + checkHostAccess=false → returns null (frame dropped)", async () => {
    const app = makeAppState("h1", "todo");
    const frame = makeAppUpdateFrame(app);
    const resolver = vi
      .fn()
      .mockResolvedValue({ hostIdNum: 1, hostUserId: "OTHER_USER" });
    const checkAccessMock = vi.fn(async () => false);

    const ctx: AppFrameFilterCtx = { userId: "U", resolveHostOwnerById: resolver };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).toBeNull();
    expect(checkAccessMock).toHaveBeenCalledWith(1, "U", "OTHER_USER", "read");
  });

  it("Test 3: app-gone for a host the user cannot access → returns null", async () => {
    const frame = makeAppGoneFrame("h2", "todo");
    const resolver = vi
      .fn()
      .mockResolvedValue({ hostIdNum: 2, hostUserId: "OTHER_USER" });
    const checkAccessMock = vi.fn(async () => false);

    const ctx: AppFrameFilterCtx = { userId: "U", resolveHostOwnerById: resolver };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).toBeNull();
  });

  it("Test 4: app-snapshot with three hosts — U sees H1 + H3, H2 dropped → projected snapshot", async () => {
    const appH1 = makeAppState("h1", "todo");
    const appH2 = makeAppState("h2", "kanban");
    const appH3 = makeAppState("h3", "notes");
    const frame = makeAppSnapshotFrame([appH1, appH2, appH3]);

    const resolver = vi.fn(async (hostIdStr: string) => {
      const map: Record<string, { hostIdNum: number; hostUserId: string }> = {
        h1: { hostIdNum: 1, hostUserId: "U" }, // owner
        h2: { hostIdNum: 2, hostUserId: "OTHER" },
        h3: { hostIdNum: 3, hostUserId: "SHARED" },
      };
      return map[hostIdStr] ?? null;
    });
    const checkAccessMock = vi.fn(
      async (hostIdNum: number, _userId: string, hostUserId: string) => {
        // Owner-self path — always allow.
        if (_userId === hostUserId) return true;
        // Shared allow for h3.
        if (hostIdNum === 3) return true;
        // Deny h2.
        return false;
      },
    );

    const ctx: AppFrameFilterCtx = { userId: "U", resolveHostOwnerById: resolver };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).not.toBeNull();
    if (result && result.type === "app-snapshot") {
      const slugs = result.apps.map((a) => a.slug).sort();
      expect(slugs).toEqual(["notes", "todo"]);
      expect(result.schemaVersion).toBe(FRAME_SCHEMA_VERSION);
    } else {
      throw new Error("expected app-snapshot frame");
    }
  });

  it("Test 5: empty snapshot returns a frame with apps: [] and makes zero checkHostAccess calls", async () => {
    const frame = makeAppSnapshotFrame([]);
    const resolver = vi.fn();
    const checkAccessMock = vi.fn(async () => true);

    const ctx: AppFrameFilterCtx = { userId: "U", resolveHostOwnerById: resolver };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).not.toBeNull();
    if (result && result.type === "app-snapshot") {
      expect(result.apps).toEqual([]);
    } else {
      throw new Error("expected app-snapshot frame");
    }
    expect(checkAccessMock).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("Test 6: no userId in ctx (bare subscriber) → frame returned verbatim, no resolver/checkAccess calls", async () => {
    const app = makeAppState("h1", "todo");
    const frame = makeAppUpdateFrame(app);
    const resolver = vi.fn();
    const checkAccessMock = vi.fn();

    const ctx: AppFrameFilterCtx = {
      userId: undefined,
      resolveHostOwnerById: resolver,
    };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).toEqual(frame);
    expect(resolver).not.toHaveBeenCalled();
    expect(checkAccessMock).not.toHaveBeenCalled();
  });

  it("Test 7: TTL cache hit — repeated (userId, hostId) within TTL does NOT call checkHostAccess a second time", async () => {
    const app = makeAppState("h1", "todo");
    const frame = makeAppUpdateFrame(app);
    const resolver = vi
      .fn()
      .mockResolvedValue({ hostIdNum: 1, hostUserId: "OTHER" });
    const checkAccessMock = vi.fn(async () => true);
    const cache = createAccessCache(30_000);

    const ctx: AppFrameFilterCtx = { userId: "U", resolveHostOwnerById: resolver };
    await filterAppFrame(frame, ctx, cache, checkAccessMock);
    await filterAppFrame(frame, ctx, cache, checkAccessMock);

    expect(checkAccessMock).toHaveBeenCalledTimes(1);
    // Resolver is also cached-out on the second call (we cache the decision,
    // not the resolver result — but the second call's canUserSee sees a cache
    // hit and skips both the resolver AND checkHostAccess).
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("Test 8: TTL cache miss after expiry — call after ttl elapses invokes checkHostAccess again", async () => {
    const app = makeAppState("h1", "todo");
    const frame = makeAppUpdateFrame(app);
    const resolver = vi
      .fn()
      .mockResolvedValue({ hostIdNum: 1, hostUserId: "OTHER" });
    const checkAccessMock = vi.fn(async () => true);

    // TTL = 0 means every read sees the entry as expired.
    const cache = createAccessCache(0);

    const ctx: AppFrameFilterCtx = { userId: "U", resolveHostOwnerById: resolver };
    await filterAppFrame(frame, ctx, cache, checkAccessMock);
    // Second call — ttl=0 makes the prior write immediately stale.
    await filterAppFrame(frame, ctx, cache, checkAccessMock);

    expect(checkAccessMock).toHaveBeenCalledTimes(2);
  });

  it("Test 9: resolveHostOwnerById returns null (unknown host) → frame is dropped (deny-by-default)", async () => {
    const app = makeAppState("h-unknown", "todo");
    const frame = makeAppUpdateFrame(app);
    const resolver = vi.fn().mockResolvedValue(null);
    const checkAccessMock = vi.fn(async () => true);

    const ctx: AppFrameFilterCtx = { userId: "U", resolveHostOwnerById: resolver };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).toBeNull();
    expect(checkAccessMock).not.toHaveBeenCalled();
  });

  it("Test 10: checkHostAccess throws → filter treats as false (deny-by-default on error)", async () => {
    const app = makeAppState("h1", "todo");
    const frame = makeAppUpdateFrame(app);
    const resolver = vi
      .fn()
      .mockResolvedValue({ hostIdNum: 1, hostUserId: "OTHER" });
    const checkAccessMock = vi.fn(async () => {
      throw new Error("permission-manager exploded");
    });

    const ctx: AppFrameFilterCtx = { userId: "U", resolveHostOwnerById: resolver };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // gone-frame filtering (surface migration — publishIdentityGoneByName + publishSessionGone)
  // -------------------------------------------------------------------------

  it("Test 11: gone frame for a host the user cannot access → dropped", async () => {
    const frame = makeGoneFrame("h1", "tina", "session-123");
    const resolver = vi
      .fn()
      .mockResolvedValue({ hostIdNum: 1, hostUserId: "OTHER_USER" });
    const checkAccessMock = vi.fn(async () => false);

    const ctx: AppFrameFilterCtx = { userId: "U", resolveHostOwnerById: resolver };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).toBeNull();
    expect(checkAccessMock).toHaveBeenCalledWith(1, "U", "OTHER_USER", "read");
  });

  it("Test 12: gone frame for an accessible host → passes verbatim", async () => {
    const frame = makeGoneFrame("h1", "tina", "session-123");
    const resolver = vi
      .fn()
      .mockResolvedValue({ hostIdNum: 1, hostUserId: "U" });
    const checkAccessMock = vi.fn(async () => true);

    const ctx: AppFrameFilterCtx = { userId: "U", resolveHostOwnerById: resolver };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).toEqual(frame);
  });

  it("Test 13: gone frame for unknown host (resolver returns null) → dropped deny-by-default", async () => {
    const frame = makeGoneFrame("h-unknown", "tina", "session-123");
    const resolver = vi.fn().mockResolvedValue(null);
    const checkAccessMock = vi.fn(async () => true);

    const ctx: AppFrameFilterCtx = { userId: "U", resolveHostOwnerById: resolver };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).toBeNull();
    expect(checkAccessMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Sanity tests for the factory + non-app frame passthrough
  // -------------------------------------------------------------------------

  it("createAppFrameFilter — factory returns a filter that composes cache + resolver + checkHostAccess", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValue({ hostIdNum: 1, hostUserId: "OTHER" });
    const checkAccessMock = vi.fn(async () => true);
    const filter = createAppFrameFilter({
      resolveHostOwnerById: resolver,
      ttlMs: 30_000,
      _checkHostAccess: checkAccessMock,
    });

    const app = makeAppState("h1", "todo");
    const frame = makeAppUpdateFrame(app);

    const r1 = await filter(frame, "U");
    const r2 = await filter(frame, "U");

    expect(r1).toEqual(frame);
    expect(r2).toEqual(frame);
    // TTL cache lives inside the factory-created filter — second call reuses it.
    expect(checkAccessMock).toHaveBeenCalledTimes(1);
  });

  it("non-app frame (e.g. session snapshot) is returned verbatim — defense-in-depth", async () => {
    const nonAppFrame: FrontendOutboundFrameType = {
      schemaVersion: FRAME_SCHEMA_VERSION,
      type: "snapshot",
      states: [],
    };
    const resolver = vi.fn();
    const checkAccessMock = vi.fn();

    const ctx: AppFrameFilterCtx = { userId: "U", resolveHostOwnerById: resolver };
    const result = await filterAppFrame(nonAppFrame, ctx, undefined, checkAccessMock);

    expect(result).toEqual(nonAppFrame);
    expect(resolver).not.toHaveBeenCalled();
    expect(checkAccessMock).not.toHaveBeenCalled();
  });
});
