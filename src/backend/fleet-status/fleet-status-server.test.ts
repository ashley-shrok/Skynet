/**
 * Task 3 — Fleet-status WebSocket server tests (TDD RED phase)
 *
 * Integration tests that spin up a real WebSocketServer on ephemeral port 0.
 * Stub AuthManager verifies 'test-token' as user 'test-user'.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports of the module under test
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    systemLogger: stub,
    // Phase 118 Plan 118-05: app-frame-filter transitively imports
    // ssh/host-resolver → utils/logger { logger, sshLogger, databaseLogger }.
    // Without the additional named exports the module fails to load with
    // "No 'logger' export is defined on the '../utils/logger.js' mock".
    logger: stub,
    sshLogger: stub,
    databaseLogger: stub,
  };
});

// We do NOT mock AuthManager/resolveHostRecordByName — they are injected as opts
// ---------------------------------------------------------------------------

import { startFleetStatusServer } from "./fleet-status-server.js";
import { createSubscriptionRegistry } from "./subscription-registry.js";
import type { SubscriptionRegistry } from "./subscription-registry.js";
import type { FrontendOutboundFrameType } from "./wire-protocol.js";
import { FRAME_SCHEMA_VERSION } from "./wire-protocol.js";
import { systemLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Test harness helpers
// ---------------------------------------------------------------------------

interface StubAuthManager {
  verifyJWTToken: (token: string) => Promise<{ userId: string; sessionId: string } | null>;
}

function makeStubAuthManager(validToken: string, userId: string): StubAuthManager {
  return {
    verifyJWTToken: async (token: string) => {
      if (token === validToken) {
        return { userId, sessionId: "session-1" };
      }
      return null;
    },
  };
}

/**
 * Phase 118 Plan 118-05: multi-user stub accepting a token→userId map so
 * combinatorial filter tests can auth two subscribers as distinct users
 * (U1 and U2) against the same server instance.
 */
function makeMultiUserStubAuthManager(
  tokenMap: Record<string, string>,
): StubAuthManager {
  return {
    verifyJWTToken: async (token: string) => {
      const userId = tokenMap[token];
      if (userId === undefined) return null;
      return { userId, sessionId: `session-${userId}` };
    },
  };
}

function connectAndReceive(
  url: string,
  headers: Record<string, string>,
  firstMessage?: string,
): Promise<{ frames: FrontendOutboundFrameType[]; closeCode?: number }> {
  return new Promise((resolve, reject) => {
    const frames: FrontendOutboundFrameType[] = [];
    let closeCode: number | undefined;

    const ws = new WebSocket(url, { headers });

    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error("WebSocket timed out after 1000ms"));
    }, 1000);

    ws.on("open", () => {
      if (firstMessage) {
        ws.send(firstMessage);
      }
    });

    ws.on("message", (raw) => {
      try {
        const frame = JSON.parse(raw.toString()) as FrontendOutboundFrameType;
        frames.push(frame);
        // After receiving first data frame, resolve
        if (frames.length >= 1) {
          clearTimeout(timeout);
          setTimeout(() => {
            ws.close();
            resolve({ frames, closeCode });
          }, 50);
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on("close", (code) => {
      closeCode = code;
      clearTimeout(timeout);
      resolve({ frames, closeCode });
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      // Don't reject — let close handler resolve
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("fleet-status-server", () => {
  let server: ReturnType<typeof startFleetStatusServer>;
  let port: number;
  let registry: SubscriptionRegistry;
  let authManager: StubAuthManager;
  let resolveHostRecordByName: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    registry = createSubscriptionRegistry();
    authManager = makeStubAuthManager("test-token", "test-user");
    resolveHostRecordByName = vi.fn();

    // Phase 118 code-review HIGH-1b (fix pass 2026-09-18): these tests
    // intentionally use the bare-registry shape (branch 1 without a
    // resolver) — that path now emits fleet_status_unfiltered_mode by
    // default. Ack the unfiltered mode so the warn does not pollute
    // test logs; the dedicated Server-Warn test below verifies the
    // warn DOES fire when the ack flag is absent.
    server = startFleetStatusServer({
      port: 0, // ephemeral
      authManager: authManager as unknown as Parameters<typeof startFleetStatusServer>[0]["authManager"],
      registry,
      resolveHostRecordByName,
      acknowledgeUnfilteredMode: true,
    });

    port = (server.wss.address() as AddressInfo).port;
    vi.clearAllMocks();
  });

  afterEach(() => {
    server.close();
  });

  it("Test 1: startFleetStatusServer returns a running server with .close() method", () => {
    expect(server).toBeDefined();
    expect(typeof server.close).toBe("function");
    expect(server.wss).toBeDefined();
    expect(port).toBeGreaterThan(0);
  });

  it("Test 2: Frontend with valid JWT receives snapshot frame on subscribe", async () => {
    // Phase 111 SKEW-07: frontend path now requires ?build= param matching
    // getServerBuildId(). In test/CI env this falls back to "dev-unknown"
    // (see src/backend/config/server-build-id.ts).
    const url = `ws://localhost:${port}/fleet-status/ws?build=dev-unknown`;
    const headers = { Cookie: "jwt=test-token" };
    const subscribeMsg = JSON.stringify({ schemaVersion: 1, type: "subscribe" });

    const { frames } = await connectAndReceive(url, headers, subscribeMsg);

    const snapshotFrame = frames.find((f) => f.type === "snapshot");
    expect(snapshotFrame).toBeDefined();
    expect(snapshotFrame?.type).toBe("snapshot");
    if (snapshotFrame?.type === "snapshot") {
      expect(snapshotFrame.schemaVersion).toBe(FRAME_SCHEMA_VERSION);
      expect(Array.isArray(snapshotFrame.states)).toBe(true);
    }
  });

  it("Test 3: Frontend with no JWT cookie is closed with code 1008 and log includes fleet_status_auth_failed", async () => {
    // Phase 111 SKEW-07: pass through the skew gate so the auth check
    // still runs — this test exercises the auth-failure path, not the
    // skew-failure path.
    const url = `ws://localhost:${port}/fleet-status/ws?build=dev-unknown`;

    const { closeCode } = await connectAndReceive(url, {}).catch(() => ({
      frames: [],
      closeCode: 1008,
    }));

    expect(closeCode).toBe(1008);

    // Check that the logger was called with fleet_status_auth_failed
    const warnMock = vi.mocked(systemLogger.warn);
    const infoMock = vi.mocked(systemLogger.info);
    const allCalls = [...warnMock.mock.calls, ...infoMock.mock.calls];
    const hasAuthFailed = allCalls.some(
      ([, ctx]) =>
        typeof ctx === "object" &&
        ctx !== null &&
        (ctx as Record<string, unknown>).operation === "fleet_status_auth_failed",
    );
    expect(hasAuthFailed).toBe(true);
  });

  it("Test 4: Watcher hello resolves hostId; subsequent session_state calls publishSessionState with resolved hostId", async () => {
    resolveHostRecordByName.mockResolvedValue({ id: "host-thenasty", name: "thenasty" });
    const publishSpy = vi.spyOn(registry, "publishSessionState");

    const url = `ws://localhost:${port}/fleet-status/watcher`;
    const ws = new WebSocket(url);

    await new Promise<void>((resolve) => ws.on("open", resolve));

    ws.send(
      JSON.stringify({ schemaVersion: 1, type: "hello", hostname: "thenasty" }),
    );

    const sessionState = {
      hostId: "host-thenasty",
      tmuxSession: "tina",
      sessionId: "session-abc",
      pid: 1234,
      status: "busy",
      backgroundTasks: [],
      updatedAt: Date.now(),
    };

    await new Promise((resolve) => setTimeout(resolve, 50));

    ws.send(
      JSON.stringify({
        schemaVersion: 1,
        type: "session_state",
        state: sessionState,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(resolveHostRecordByName).toHaveBeenCalledWith("thenasty");
    expect(publishSpy).toHaveBeenCalledWith(
      "host-thenasty",
      expect.objectContaining({ sessionId: "session-abc" }),
    );
  });

  it("Test 5: Watcher with unknown hostname is closed with 1008 and log includes fleet_status_watcher_host_unknown", async () => {
    resolveHostRecordByName.mockResolvedValue(null);

    const url = `ws://localhost:${port}/fleet-status/watcher`;
    const ws = new WebSocket(url);
    let closeCode: number | undefined;

    await new Promise<void>((resolve) => ws.on("open", resolve));

    ws.send(
      JSON.stringify({ schemaVersion: 1, type: "hello", hostname: "unknown-box" }),
    );

    await new Promise<void>((resolve) => {
      ws.on("close", (code) => {
        closeCode = code;
        resolve();
      });
    });

    expect(closeCode).toBe(1008);

    const warnMock = vi.mocked(systemLogger.warn);
    const allCalls = warnMock.mock.calls;
    const hasHostUnknown = allCalls.some(
      ([, ctx]) =>
        typeof ctx === "object" &&
        ctx !== null &&
        (ctx as Record<string, unknown>).operation === "fleet_status_watcher_host_unknown",
    );
    expect(hasHostUnknown).toBe(true);
  });

  it("Test 6: Watcher session_gone calls registry.publishSessionGone with resolved hostId", async () => {
    resolveHostRecordByName.mockResolvedValue({ id: "host-thenasty", name: "thenasty" });
    const goneSpy = vi.spyOn(registry, "publishSessionGone");

    const url = `ws://localhost:${port}/fleet-status/watcher`;
    const ws = new WebSocket(url);

    await new Promise<void>((resolve) => ws.on("open", resolve));

    ws.send(
      JSON.stringify({ schemaVersion: 1, type: "hello", hostname: "thenasty" }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    ws.send(
      JSON.stringify({
        schemaVersion: 1,
        type: "session_gone",
        tmuxSession: "tina",
        sessionId: "session-abc",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(goneSpy).toHaveBeenCalledWith("host-thenasty", "tina", "session-abc");
  });

  it("Test 7: Wrong path is closed with code 4000", async () => {
    const url = `ws://localhost:${port}/wrong-path`;
    const ws = new WebSocket(url);
    let closeCode: number | undefined;

    await new Promise<void>((resolve, reject) => {
      ws.on("close", (code) => {
        closeCode = code;
        resolve();
      });
      ws.on("error", () => resolve()); // connection might error
      setTimeout(() => resolve(), 500);
    });

    // Code 4000 or connection refused/error is expected for wrong path
    expect([4000, undefined]).toContain(closeCode);
  });

  it("Test 8b (Phase 39-02): Frontend subscribe call threads { userId } into registry.subscribe as ctx", async () => {
    // Spy BEFORE the frontend connection so the call is captured on first invocation.
    const subscribeSpy = vi.spyOn(registry, "subscribe");

    // Phase 111 SKEW-07: pass the skew gate; test-env SERVER_BUILD_ID
    // is "dev-unknown".
    const url = `ws://localhost:${port}/fleet-status/ws?build=dev-unknown`;
    const headers = { Cookie: "jwt=test-token" };
    const subscribeMsg = JSON.stringify({ schemaVersion: 1, type: "subscribe" });

    await connectAndReceive(url, headers, subscribeMsg);

    // The subscribe call the server made in response to the frontend's {type:'subscribe'} frame
    // must carry the JWT-verified userId ('test-user' per makeStubAuthManager) as ctx.
    expect(subscribeSpy).toHaveBeenCalled();
    const call = subscribeSpy.mock.calls[0];
    expect(call).toBeDefined();
    expect(typeof call[0]).toBe("function"); // sendFrame closure
    expect(call[1]).toEqual({ userId: "test-user" }); // ctx per Phase 39 D-03 (GATE2-03)
  });

  it("Test 8: Every lifecycle event logs a single line with explicit fields — no Event objects", () => {
    // Verify that the logger was called with structured objects (not Event instances)
    const warnMock = vi.mocked(systemLogger.warn);
    const infoMock = vi.mocked(systemLogger.info);

    for (const call of [...warnMock.mock.calls, ...infoMock.mock.calls]) {
      const ctx = call[1];
      if (ctx !== null && typeof ctx === "object") {
        // Ensure no DOM Event or similar objects got serialized
        expect(ctx).not.toBeInstanceOf(Event);
        expect(ctx).not.toHaveProperty("target");
        expect(ctx).not.toHaveProperty("currentTarget");
      }
    }
  });

  // -------------------------------------------------------------------------
  // Phase 118 code-review HIGH-1b (fix pass 2026-09-18) — external-registry
  // unfiltered-mode warn. Defense in depth on top of starter.ts's
  // resolveHostOwnerById wiring: even if a future regression drops the
  // wiring, the log path fires so the state is grep-observable.
  // -------------------------------------------------------------------------
  it("Warn-1: pre-built registry without resolveHostOwnerById AND without ack emits fleet_status_unfiltered_mode warn (source: external_registry)", () => {
    const warnSpy = vi.mocked(systemLogger.warn);
    warnSpy.mockClear();

    const bareRegistry = createSubscriptionRegistry();
    const localAuth = makeStubAuthManager("t", "u");
    const localServer = startFleetStatusServer({
      port: 0,
      authManager: localAuth as unknown as Parameters<
        typeof startFleetStatusServer
      >[0]["authManager"],
      registry: bareRegistry,
      resolveHostRecordByName: vi.fn(),
      // no acknowledgeUnfilteredMode → warn MUST fire
    });

    const unfilteredWarns = warnSpy.mock.calls.filter(
      ([, ctx]) =>
        typeof ctx === "object" &&
        ctx !== null &&
        (ctx as Record<string, unknown>).operation ===
          "fleet_status_unfiltered_mode" &&
        (ctx as Record<string, unknown>).source === "external_registry",
    );
    expect(unfilteredWarns.length).toBeGreaterThanOrEqual(1);

    localServer.close();
  });

  it("Warn-2: pre-built registry + acknowledgeUnfilteredMode=true suppresses the warn (existing test-harness callers stay quiet)", () => {
    const warnSpy = vi.mocked(systemLogger.warn);
    warnSpy.mockClear();

    const bareRegistry = createSubscriptionRegistry();
    const localAuth = makeStubAuthManager("t", "u");
    const localServer = startFleetStatusServer({
      port: 0,
      authManager: localAuth as unknown as Parameters<
        typeof startFleetStatusServer
      >[0]["authManager"],
      registry: bareRegistry,
      resolveHostRecordByName: vi.fn(),
      acknowledgeUnfilteredMode: true,
    });

    const unfilteredWarns = warnSpy.mock.calls.filter(
      ([, ctx]) =>
        typeof ctx === "object" &&
        ctx !== null &&
        (ctx as Record<string, unknown>).operation ===
          "fleet_status_unfiltered_mode",
    );
    expect(unfilteredWarns).toHaveLength(0);

    localServer.close();
  });
});

// ---------------------------------------------------------------------------
// Phase 118 Plan 118-05 — Combinatorial filter tests (Server-1 … Server-5)
// ---------------------------------------------------------------------------
//
// End-to-end WS tests exercising the per-user host-visibility filter wired
// through the fleet-status server. Two clients auth as distinct users (U1
// and U2), the registry is seeded via publishAppUpdate, and each client's
// received frames are asserted for correct per-subscriber projection.
//
// The tests inject a stub `resolveHostOwnerById` (owner-self / shared-access
// matrix) plus mock the imported `checkHostAccess` so the tests do not touch
// PermissionManager or the DB. Server-4 exercises the shared-access branch
// via the checkHostAccess mock (owner-self allow + PermissionManager allow).
// ---------------------------------------------------------------------------

import type { AppState } from "./wire-protocol.js";

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
    users: null,
    ...overrides,
  };
}

interface ConnectedClient {
  ws: WebSocket;
  frames: FrontendOutboundFrameType[];
}

async function connectAsUser(
  port: number,
  token: string,
): Promise<ConnectedClient> {
  const url = `ws://localhost:${port}/fleet-status/ws`;
  const ws = new WebSocket(url, { headers: { Cookie: `jwt=${token}` } });
  const frames: FrontendOutboundFrameType[] = [];

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WS open timeout")), 1000);
    ws.on("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  ws.on("message", (raw) => {
    try {
      frames.push(JSON.parse(raw.toString()) as FrontendOutboundFrameType);
    } catch {
      /* ignore parse errors */
    }
  });

  ws.send(JSON.stringify({ schemaVersion: 1, type: "subscribe" }));

  return { ws, frames };
}

async function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("fleet-status-server Phase 118 Plan 118-05 combinatorial filter", () => {
  let server: ReturnType<typeof startFleetStatusServer>;
  let port: number;
  let registry: SubscriptionRegistry;
  let authManager: StubAuthManager;
  let resolveHostRecordByName: ReturnType<typeof vi.fn>;
  let resolveHostOwnerByIdMock: ReturnType<typeof vi.fn>;
  let checkHostAccessMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Owner map for the three test hosts:
    //   h1 owned by U1
    //   h2 owned by U2
    //   h3 owned by SHARED_OWNER (used in Server-4 to exercise the
    //   non-owner-self PermissionManager branch — checkHostAccess returns
    //   true for U1+h3 but false for U2+h3).
    resolveHostOwnerByIdMock = vi.fn(async (hostIdStr: string) => {
      const map: Record<string, { hostIdNum: number; hostUserId: string }> = {
        h1: { hostIdNum: 1, hostUserId: "U1" },
        h2: { hostIdNum: 2, hostUserId: "U2" },
        h3: { hostIdNum: 3, hostUserId: "SHARED_OWNER" },
      };
      return map[hostIdStr] ?? null;
    });

    checkHostAccessMock = vi.fn(
      async (
        hostIdNum: number,
        userId: string,
        hostUserId: string,
        _perm: "read" | "execute",
      ) => {
        // Owner-self allow.
        if (userId === hostUserId) return true;
        // Shared access grant: U1 can read h3.
        if (hostIdNum === 3 && userId === "U1") return true;
        return false;
      },
    );

    authManager = makeMultiUserStubAuthManager({
      "token-U1": "U1",
      "token-U2": "U2",
    });
    resolveHostRecordByName = vi.fn();

    // Phase 118 Plan 118-05 Task 3: startFleetStatusServer takes optional
    // resolveHostOwnerById + testCheckHostAccessOverride + registryFactory
    // deps and constructs the filter + registry INTERNALLY. This exercises
    // the production wiring path (starter.ts will pass resolveHostOwnerById
    // + the real host-resolver at deploy time; the executor does NOT touch
    // starter.ts per fleet directive #10).
    server = startFleetStatusServer({
      port: 0,
      authManager: authManager as unknown as Parameters<
        typeof startFleetStatusServer
      >[0]["authManager"],
      resolveHostRecordByName,
      resolveHostOwnerById: resolveHostOwnerByIdMock,
      appFrameFilterTtlMs: 0,
      _testCheckHostAccessOverride: checkHostAccessMock,
    });

    // Pull the registry back out for direct publish() calls in the tests.
    registry = server.registry;

    port = (server.wss.address() as AddressInfo).port;
    vi.clearAllMocks();
  });

  afterEach(() => {
    server.close();
  });

  it("Server-1: subscribe-path app-snapshot is projected per-user (U1 sees h1 only; U2 sees h2 only)", async () => {
    // Seed BEFORE anyone subscribes.
    registry.publishAppUpdate("h1", makeAppState("h1", "todo"));
    registry.publishAppUpdate("h2", makeAppState("h2", "kanban"));
    await waitMs(50);

    const u1 = await connectAsUser(port, "token-U1");
    const u2 = await connectAsUser(port, "token-U2");

    await waitMs(150);

    const u1Snapshots = u1.frames.filter((f) => f.type === "app-snapshot");
    const u2Snapshots = u2.frames.filter((f) => f.type === "app-snapshot");
    expect(u1Snapshots).toHaveLength(1);
    expect(u2Snapshots).toHaveLength(1);
    if (u1Snapshots[0].type === "app-snapshot") {
      const slugs = u1Snapshots[0].apps.map((a) => a.slug);
      expect(slugs).toEqual(["todo"]);
    }
    if (u2Snapshots[0].type === "app-snapshot") {
      const slugs = u2Snapshots[0].apps.map((a) => a.slug);
      expect(slugs).toEqual(["kanban"]);
    }

    u1.ws.close();
    u2.ws.close();
  });

  it("Server-2: publishAppUpdate on h1 reaches U1, does NOT reach U2", async () => {
    const u1 = await connectAsUser(port, "token-U1");
    const u2 = await connectAsUser(port, "token-U2");
    await waitMs(100);
    u1.frames.length = 0;
    u2.frames.length = 0;

    registry.publishAppUpdate("h1", makeAppState("h1", "todo"));
    await waitMs(100);

    expect(u1.frames.filter((f) => f.type === "app-update")).toHaveLength(1);
    expect(u2.frames.filter((f) => f.type === "app-update")).toHaveLength(0);

    u1.ws.close();
    u2.ws.close();
  });

  it("Server-3: publishAppGoneByHostSlug on h2 reaches U2, does NOT reach U1", async () => {
    // Seed the map first (else gone is a no-op).
    registry.publishAppUpdate("h2", makeAppState("h2", "kanban"));

    const u1 = await connectAsUser(port, "token-U1");
    const u2 = await connectAsUser(port, "token-U2");
    await waitMs(100);
    u1.frames.length = 0;
    u2.frames.length = 0;

    registry.publishAppGoneByHostSlug("h2", "kanban");
    await waitMs(100);

    expect(u1.frames.filter((f) => f.type === "app-gone")).toHaveLength(0);
    expect(u2.frames.filter((f) => f.type === "app-gone")).toHaveLength(1);

    u1.ws.close();
    u2.ws.close();
  });

  it("Server-4: three hosts — U1 sees h1 (owner) + h3 (shared); U2 sees h2 (owner) only", async () => {
    // Seed all three hosts.
    registry.publishAppUpdate("h1", makeAppState("h1", "todo"));
    registry.publishAppUpdate("h2", makeAppState("h2", "kanban"));
    registry.publishAppUpdate("h3", makeAppState("h3", "notes"));
    await waitMs(50);

    const u1 = await connectAsUser(port, "token-U1");
    const u2 = await connectAsUser(port, "token-U2");
    await waitMs(200);

    const u1Snapshots = u1.frames.filter((f) => f.type === "app-snapshot");
    const u2Snapshots = u2.frames.filter((f) => f.type === "app-snapshot");
    expect(u1Snapshots).toHaveLength(1);
    expect(u2Snapshots).toHaveLength(1);
    if (u1Snapshots[0].type === "app-snapshot") {
      const slugs = u1Snapshots[0].apps.map((a) => a.slug).sort();
      // U1: owner of h1, shared access to h3, denied h2
      expect(slugs).toEqual(["notes", "todo"]);
    }
    if (u2Snapshots[0].type === "app-snapshot") {
      const slugs = u2Snapshots[0].apps.map((a) => a.slug);
      // U2: owner of h2 only
      expect(slugs).toEqual(["kanban"]);
    }

    // Proves the non-owner-self branch of checkHostAccess was invoked
    // (U1 + h3 is not owner-self; the mock's PermissionManager-substitute
    // decision path fired).
    expect(checkHostAccessMock).toHaveBeenCalled();

    u1.ws.close();
    u2.ws.close();
  });

  it("Server-5: publishSessionState on h1 reaches U1 (owner), does NOT reach U2", async () => {
    // Session-state fan-out is now filtered by per-user host access (mirrors
    // Server-2 for apps). publishSessionState on h1 (owned by U1) reaches U1
    // and is dropped for U2.
    const u1 = await connectAsUser(port, "token-U1");
    const u2 = await connectAsUser(port, "token-U2");
    await waitMs(100);
    u1.frames.length = 0;
    u2.frames.length = 0;

    registry.publishSessionState("h1", {
      hostId: "h1",
      tmuxSession: "tina",
      sessionId: "session-1",
      pid: 1234,
      status: "busy",
      backgroundTasks: [],
      updatedAt: Date.now(),
    });
    await waitMs(50);

    expect(u1.frames.filter((f) => f.type === "update")).toHaveLength(1);
    expect(u2.frames.filter((f) => f.type === "update")).toHaveLength(0);

    u1.ws.close();
    u2.ws.close();
  });
});
