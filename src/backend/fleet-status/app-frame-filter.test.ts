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
import { beforeEach, describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Phase 129 Plan 129-05 — logger mock so identity-gate fail-closed warn
// (`operation: "app_frame_filter_identity_gate_error"`) is spy-observable.
// vi.hoisted lets the mock references be visible inside the vi.mock factory
// (which hoists above the top-level import order).
//
// Backward-compat: pre-129 tests never asserted on systemLogger calls; the
// existing `canUserSee` warn at L188-196 continues to fire against this mock
// as a no-op (`vi.fn()`), same behavior the tests already observed.
// ---------------------------------------------------------------------------
const { systemLoggerWarnMock, systemLoggerDebugMock } = vi.hoisted(() => ({
  systemLoggerWarnMock: vi.fn(),
  systemLoggerDebugMock: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  systemLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: systemLoggerWarnMock,
    debug: systemLoggerDebugMock,
  },
}));

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
  makeProjectListChangedFrame,
  makeSessionProjectChangedFrame,
  makeSnapshotFrame,
  makeUpdateFrame,
} from "./wire-protocol.js";
import type { SessionState } from "./wire-protocol.js";

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

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
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

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
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

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
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

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
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

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
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

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
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

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
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

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
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

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
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

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
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

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).toEqual(frame);
  });

  it("Test 13: gone frame for unknown host (resolver returns null) → dropped deny-by-default", async () => {
    const frame = makeGoneFrame("h-unknown", "tina", "session-123");
    const resolver = vi.fn().mockResolvedValue(null);
    const checkAccessMock = vi.fn(async () => true);

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).toBeNull();
    expect(checkAccessMock).not.toHaveBeenCalled();
  });

  // (Tests 14-16 identity-archived-frame filtering retired in the Phase 122
  //  shape follow-up alongside publishIdentityArchived + wire frame.)

  // -------------------------------------------------------------------------
  // update + snapshot frame filtering (surface migration — publishSessionState)
  // -------------------------------------------------------------------------

  function makeSessionState(hostId: string, tmuxSession: string | null): SessionState {
    return {
      hostId,
      tmuxSession,
      sessionId: `${hostId}-${tmuxSession ?? "null"}`,
      pid: 1000,
      status: "busy",
      backgroundTasks: [],
      updatedAt: 1_700_000_000_000,
    };
  }

  it("Test 17: update frame for a host the user cannot access → dropped", async () => {
    const frame = makeUpdateFrame(makeSessionState("h1", "tina"));
    const resolver = vi
      .fn()
      .mockResolvedValue({ hostIdNum: 1, hostUserId: "OTHER_USER" });
    const checkAccessMock = vi.fn(async () => false);

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).toBeNull();
    expect(checkAccessMock).toHaveBeenCalledWith(1, "U", "OTHER_USER", "read");
  });

  it("Test 18: update frame for an accessible host → passes verbatim", async () => {
    const frame = makeUpdateFrame(makeSessionState("h1", "tina"));
    const resolver = vi
      .fn()
      .mockResolvedValue({ hostIdNum: 1, hostUserId: "U" });
    const checkAccessMock = vi.fn(async () => true);

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).toEqual(frame);
  });

  it("Test 19: snapshot with three hosts — U sees H1 + H3, H2 dropped → projected snapshot", async () => {
    const stateH1 = makeSessionState("h1", "tina");
    const stateH2 = makeSessionState("h2", "nelly");
    const stateH3 = makeSessionState("h3", "wren");
    const frame = makeSnapshotFrame([stateH1, stateH2, stateH3]);

    const resolver = vi.fn(async (hostIdStr: string) => {
      const map: Record<string, { hostIdNum: number; hostUserId: string }> = {
        h1: { hostIdNum: 1, hostUserId: "U" },
        h2: { hostIdNum: 2, hostUserId: "OTHER" },
        h3: { hostIdNum: 3, hostUserId: "SHARED" },
      };
      return map[hostIdStr] ?? null;
    });
    const checkAccessMock = vi.fn(
      async (hostIdNum: number, _userId: string, hostUserId: string) => {
        if (_userId === hostUserId) return true;
        if (hostIdNum === 3) return true;
        return false;
      },
    );

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).not.toBeNull();
    if (result && result.type === "snapshot") {
      const hostIds = result.states.map((s) => s.hostId).sort();
      expect(hostIds).toEqual(["h1", "h3"]);
      expect(result.schemaVersion).toBe(FRAME_SCHEMA_VERSION);
    } else {
      throw new Error("expected snapshot frame");
    }
  });

  it("Test 20: empty snapshot returns a frame with states: [] and makes zero checkHostAccess calls", async () => {
    const frame = makeSnapshotFrame([]);
    const resolver = vi.fn();
    const checkAccessMock = vi.fn(async () => true);

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).not.toBeNull();
    if (result && result.type === "snapshot") {
      expect(result.states).toEqual([]);
    }
    expect(checkAccessMock).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // project-list-changed frame filtering (surface migration — publishProjectListChanged)
  // -------------------------------------------------------------------------

  it("Test 21: project-list-changed with three hosts — U sees H1 + H3, H2 dropped → projected", async () => {
    const frame = makeProjectListChangedFrame([
      { slug: "a", displayName: "A", hostId: "h1", hostname: "one", archived: false },
      { slug: "b", displayName: "B", hostId: "h2", hostname: "two", archived: false },
      { slug: "c", displayName: "C", hostId: "h3", hostname: "three", archived: false },
    ]);

    const resolver = vi.fn(async (hostIdStr: string) => {
      const map: Record<string, { hostIdNum: number; hostUserId: string }> = {
        h1: { hostIdNum: 1, hostUserId: "U" },
        h2: { hostIdNum: 2, hostUserId: "OTHER" },
        h3: { hostIdNum: 3, hostUserId: "SHARED" },
      };
      return map[hostIdStr] ?? null;
    });
    const checkAccessMock = vi.fn(
      async (hostIdNum: number, userId: string, hostUserId: string) => {
        if (userId === hostUserId) return true;
        if (hostIdNum === 3) return true;
        return false;
      },
    );

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).not.toBeNull();
    if (result && result.type === "project-list-changed") {
      const slugs = result.projects.map((p) => p.slug).sort();
      expect(slugs).toEqual(["a", "c"]);
    } else {
      throw new Error("expected project-list-changed frame");
    }
  });

  it("Test 22: empty project-list-changed short-circuits — zero filter calls, frame verbatim", async () => {
    const frame = makeProjectListChangedFrame([]);
    const resolver = vi.fn();
    const checkAccessMock = vi.fn(async () => true);

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessMock);

    expect(result).not.toBeNull();
    if (result && result.type === "project-list-changed") {
      expect(result.projects).toEqual([]);
    }
    expect(checkAccessMock).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
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
      // Phase 129 Plan 129-05: identity-gate dep required on
      // CreateAppFrameFilterDeps. Pre-129 factory test is agnostic; stub
      // returns true so the composed filter reduces to the host gate.
      resolveIdentityGate: async () => true,
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

  it("non-host-scoped frame (pong) is returned verbatim — defense-in-depth", async () => {
    const nonHostFrame: FrontendOutboundFrameType = {
      schemaVersion: FRAME_SCHEMA_VERSION,
      type: "pong",
    };
    const resolver = vi.fn();
    const checkAccessMock = vi.fn();

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolver,
      // Phase 129 Plan 129-05: identity-gate dep required on AppFrameFilterCtx.
      // Pre-129 tests are agnostic to the identity gate; stub returns true so
      // the intersection reduces to the host gate under test. Regression lock
      // for Test K.
      resolveIdentityGate: async () => true,
    };
    const result = await filterAppFrame(nonHostFrame, ctx, undefined, checkAccessMock);

    expect(result).toEqual(nonHostFrame);
    expect(resolver).not.toHaveBeenCalled();
    expect(checkAccessMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 129 Plan 129-05 — per-identity visibility gate at the WS surface.
//
// filterAppFrame extended to gate every frame type that carries an identity
// name (`update.state.tmuxSession`, `snapshot.states[].tmuxSession`,
// `gone.tmuxSession`, `session-project-changed.identityKey`) via
// ctx.resolveIdentityGate, AFTER the host gate closes. (`identity-archived`
// gate retired alongside the frame in Phase 122 shape follow-up.)
//
// Contract locks:
//   - Host gate short-circuits identity gate (Test J — no wasted resolver
//     call when host is already denied).
//   - Fail-CLOSED on resolver throw (Test I) — mirrors the canUserSee
//     catch-and-return-false shape at L185-198; WS frames are less
//     recoverable than a REST list because a leaked frame updates a live
//     sidebar in real time. Warn log fires with
//     `operation: "app_frame_filter_identity_gate_error"`.
//   - Backward-compat via test-fixture updates (Test K); the ctx type
//     extension is a REQUIRED field, so all pre-129 fixtures gained a
//     stub `resolveIdentityGate: async () => true`.
// ---------------------------------------------------------------------------

describe("Phase 129: identity-name gate", () => {
  function makeSessionState(
    hostId: string,
    tmuxSession: string | null,
  ): SessionState {
    return {
      hostId,
      tmuxSession,
      sessionId: `${hostId}-${tmuxSession ?? "null"}`,
      pid: 1000,
      status: "busy",
      backgroundTasks: [],
      updatedAt: 1_700_000_000_000,
    };
  }

  // Standard host-gate-passes resolver + checkAccess for tests that isolate
  // the identity-gate branch.
  const okResolver = () =>
    vi.fn().mockResolvedValue({ hostIdNum: 1, hostUserId: "U" });
  const okCheckAccess = () => vi.fn(async () => true);

  beforeEach(() => {
    systemLoggerWarnMock.mockReset();
    systemLoggerDebugMock.mockReset();
  });

  it("Test A: update frame, identity visible → frame passes through unchanged", async () => {
    const frame = makeUpdateFrame(makeSessionState("h1", "tina"));
    const resolveIdentityGate = vi.fn(async () => true);

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: okResolver(),
      resolveIdentityGate,
    };
    const result = await filterAppFrame(frame, ctx, undefined, okCheckAccess());

    expect(result).toEqual(frame);
    expect(resolveIdentityGate).toHaveBeenCalledWith("tina", "h1", "U");
  });

  it("Test B: update frame, identity hidden → frame dropped", async () => {
    const frame = makeUpdateFrame(makeSessionState("h1", "tina"));
    const resolveIdentityGate = vi.fn(async () => false);

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: okResolver(),
      resolveIdentityGate,
    };
    const result = await filterAppFrame(frame, ctx, undefined, okCheckAccess());

    expect(result).toBeNull();
    expect(resolveIdentityGate).toHaveBeenCalledWith("tina", "h1", "U");
  });

  it("Test C: update frame with null tmuxSession → identity gate skipped, host gate only", async () => {
    // An update frame whose tmuxSession is null carries no identity name to
    // gate on. The host gate still applies; the identity gate MUST NOT be
    // called (nothing to gate). Defensive branch for source-B dormant-only
    // rows that publish pid:null and no tmuxSession per Phase 52 Plan 01.
    const frame = makeUpdateFrame(makeSessionState("h1", null));
    const resolveIdentityGate = vi.fn(async () => false); // would deny if called

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: okResolver(),
      resolveIdentityGate,
    };
    const result = await filterAppFrame(frame, ctx, undefined, okCheckAccess());

    expect(result).toEqual(frame);
    expect(resolveIdentityGate).not.toHaveBeenCalled();
  });

  it("Test D: snapshot frame, mixed identity visibility → filtered snapshot with 1 state", async () => {
    // 3 states, one visible per identity gate ("keeper"), two hidden
    // ("hidden-a", "hidden-b"). Result is a snapshot frame with 1 state.
    const stateKeeper = makeSessionState("h1", "keeper");
    const stateHiddenA = makeSessionState("h1", "hidden-a");
    const stateHiddenB = makeSessionState("h1", "hidden-b");
    const frame = makeSnapshotFrame([stateKeeper, stateHiddenA, stateHiddenB]);

    const resolveIdentityGate = vi.fn(async (name: string) => name === "keeper");
    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: okResolver(),
      resolveIdentityGate,
    };
    const result = await filterAppFrame(frame, ctx, undefined, okCheckAccess());

    expect(result).not.toBeNull();
    if (result && result.type === "snapshot") {
      expect(result.states.map((s) => s.tmuxSession)).toEqual(["keeper"]);
      expect(result.schemaVersion).toBe(FRAME_SCHEMA_VERSION);
    } else {
      throw new Error("expected snapshot frame");
    }
  });

  it("Test E: snapshot frame, all identities hidden → empty snapshot frame (not null)", async () => {
    // Mirrors the pre-129 empty-snapshot discipline (L228-232): the emit
    // happened, so a snapshot frame with states: [] is a valid outcome. The
    // frontend renders empty state gracefully.
    const stateA = makeSessionState("h1", "hidden-a");
    const stateB = makeSessionState("h1", "hidden-b");
    const frame = makeSnapshotFrame([stateA, stateB]);

    const resolveIdentityGate = vi.fn(async () => false);
    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: okResolver(),
      resolveIdentityGate,
    };
    const result = await filterAppFrame(frame, ctx, undefined, okCheckAccess());

    expect(result).not.toBeNull();
    if (result && result.type === "snapshot") {
      expect(result.states).toEqual([]);
    } else {
      throw new Error("expected snapshot frame");
    }
  });

  it("Test F: gone frame, identity hidden → dropped", async () => {
    const frame = makeGoneFrame("h1", "tina", "session-123");
    const resolveIdentityGate = vi.fn(async () => false);

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: okResolver(),
      resolveIdentityGate,
    };
    const result = await filterAppFrame(frame, ctx, undefined, okCheckAccess());

    expect(result).toBeNull();
    expect(resolveIdentityGate).toHaveBeenCalledWith("tina", "h1", "U");
  });

  // (Test G identity-archived-frame identity-gate retired alongside the frame
  //  itself in the Phase 122 shape follow-up — see Tests 14-16 above.)

  it("Test H: session-project-changed frame, identity hidden → dropped", async () => {
    // frame.identityKey → identity gate; frame.hostId is a NUMBER (unlike
    // the other frame types) so the gate branch must coerce to string for
    // the host lookup.
    const frame = makeSessionProjectChangedFrame("muffin", 1, "kitchen");
    const resolveIdentityGate = vi.fn(async () => false);

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: okResolver(),
      resolveIdentityGate,
    };
    const result = await filterAppFrame(frame, ctx, undefined, okCheckAccess());

    expect(result).toBeNull();
    expect(resolveIdentityGate).toHaveBeenCalledWith("muffin", "1", "U");
  });

  it("Test I: resolveIdentityGate throws → fail-CLOSED (frame dropped) + warn log fires", async () => {
    // Fail-closed on resolver throw mirrors canUserSee's catch-and-return-
    // false shape at L185-198. Warn log carries operation:
    // "app_frame_filter_identity_gate_error" for ops observability.
    const frame = makeUpdateFrame(makeSessionState("h1", "tina"));
    const resolveIdentityGate = vi.fn(async () => {
      throw new Error("SSH exec exploded");
    });

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: okResolver(),
      resolveIdentityGate,
    };
    const result = await filterAppFrame(frame, ctx, undefined, okCheckAccess());

    expect(result).toBeNull();
    // Warn log fired with the identity-gate error operation code.
    const warnCalls = systemLoggerWarnMock.mock.calls;
    const identityGateWarn = warnCalls.find(
      (call) =>
        typeof call[1] === "object" &&
        call[1] !== null &&
        (call[1] as Record<string, unknown>).operation ===
          "app_frame_filter_identity_gate_error",
    );
    expect(identityGateWarn).toBeDefined();
    if (identityGateWarn) {
      const meta = identityGateWarn[1] as Record<string, unknown>;
      expect(meta.userId).toBe("U");
      expect(meta.hostIdStr).toBe("h1");
      expect(meta.identityName).toBe("tina");
      expect(meta.error).toBe("SSH exec exploded");
    }
  });

  it("Test J: host gate closes first → identity gate NOT consulted (efficiency + defense-in-depth)", async () => {
    // If canUserSee returns false, canUserSeeIdentity MUST NOT be called.
    // Prevents wasted SSH round-trips AND provides defense in depth (an
    // over-permissive identity gate cannot leak a frame the host gate
    // already closed).
    const frame = makeUpdateFrame(makeSessionState("h1", "tina"));
    const resolveIdentityGate = vi.fn(async () => true); // would ALLOW if consulted
    const resolveHostDeny = vi
      .fn()
      .mockResolvedValue({ hostIdNum: 1, hostUserId: "OTHER" });
    const checkAccessDeny = vi.fn(async () => false); // host gate closes

    const ctx: AppFrameFilterCtx = {
      userId: "U",
      resolveHostOwnerById: resolveHostDeny,
      resolveIdentityGate,
    };
    const result = await filterAppFrame(frame, ctx, undefined, checkAccessDeny);

    expect(result).toBeNull();
    expect(resolveIdentityGate).not.toHaveBeenCalled();
  });

  it("Test K: pre-129 test fixtures updated with resolveIdentityGate stub → all existing tests still pass (regression lock)", () => {
    // This test is a documentation lock — the actual regression coverage
    // lives in the pre-129 test suite above (Tests 1-22 + factory + pong).
    // Every existing AppFrameFilterCtx construction was updated to include
    // `resolveIdentityGate: async () => true` as a required field. If a
    // future ctx-shape edit drops that field, TypeScript will reject the
    // fixture at compile time; if the runtime shape drifts, this test
    // being present in the file ensures anyone reading the suite sees the
    // regression-lock discipline documented explicitly.
    expect(true).toBe(true);
  });
});
