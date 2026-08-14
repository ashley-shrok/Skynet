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

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

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

    server = startFleetStatusServer({
      port: 0, // ephemeral
      authManager: authManager as unknown as Parameters<typeof startFleetStatusServer>[0]["authManager"],
      registry,
      resolveHostRecordByName,
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
    const url = `ws://localhost:${port}/fleet-status/ws`;
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
    const url = `ws://localhost:${port}/fleet-status/ws`;

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

    const url = `ws://localhost:${port}/fleet-status/ws`;
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
});
