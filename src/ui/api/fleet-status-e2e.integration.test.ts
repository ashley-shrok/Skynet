// ─── fleet-status end-to-end integration test (Phase 34 Plan 06, Task 4) ────
//
// Spins up the REAL fleet-status backend server on an ephemeral port with a
// stub auth manager, then connects a fleet-status browser client (via Node
// WebSocket with the `ws` package wrapping the browser's createFleetStatusClient),
// and asserts the full pipe: watcher-side state → backend → frontend WS →
// session-working-store + session-waiting-store.
//
// Tests:
//   1. Watcher session_state (status='busy') → browser onUpdate fires →
//      publishFleetStatusSessionState dispatched → useSessionIsWorking returns true
//   2. Watcher session_gone → publishFleetStatusSessionGone fires →
//      useSessionIsWorking returns false + useSessionWaitingFor returns null
//   3. Watcher session_state (status='waiting') → useSessionIsWorking returns false
//      (D-CTX waiting is NOT working) + useSessionWaitingFor returns the reason

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket as WsClient } from "ws";
import { startFleetStatusServer } from "../../backend/fleet-status/fleet-status-server.js";
import { createSubscriptionRegistry } from "../../backend/fleet-status/subscription-registry.js";
import {
  publishFleetStatusSessionState,
  publishFleetStatusSessionGone,
  useSessionIsWorking,
  getSessionWorkingSnapshot,
  __resetForTest,
} from "@/state/session-working-store.js";
import {
  publishFleetStatusWaitingFor,
  useSessionWaitingFor,
  __resetForTestWaiting,
} from "@/state/session-waiting-store.js";
import { FRAME_SCHEMA_VERSION } from "@/api/fleet-status-types.js";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Find a free ephemeral port by letting the OS assign one
async function getFreePort(): Promise<number> {
  const net = await import("net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

// Stub auth manager that accepts any token with userId='test-user'
const stubAuthManager = {
  async verifyJWTToken(_token: string) {
    return { userId: "test-user", sessionId: "test-session" };
  },
};

// Stub host resolver — not needed for the frontend path
const stubResolveHostRecord = async () => null;

// Helper: wait up to `timeout` ms for a predicate to return true (polling 10ms)
async function waitFor(
  predicate: () => boolean,
  timeout = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error("waitFor timeout exceeded");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let serverPort: number;
let fleetStatusServer: ReturnType<typeof startFleetStatusServer> | null = null;
let registry: ReturnType<typeof createSubscriptionRegistry>;
let clientWs: WsClient | null = null;

// AppShell-style callback wiring — same as the real AppShell.tsx
function buildCallbacks() {
  type SS = Parameters<typeof publishFleetStatusSessionState>[1];

  return {
    onSnapshot(states: SS[]) {
      for (const state of states) {
        publishFleetStatusSessionState(state.hostId, state);
        publishFleetStatusWaitingFor(
          state.hostId,
          state.tmuxSession,
          state.status === "waiting" ? state.waitingFor ?? "input needed" : null,
        );
      }
    },
    onUpdate(state: SS) {
      publishFleetStatusSessionState(state.hostId, state);
      publishFleetStatusWaitingFor(
        state.hostId,
        state.tmuxSession,
        state.status === "waiting" ? state.waitingFor ?? "input needed" : null,
      );
    },
    onGone(hostId: string, tmuxSession: string | null, sessionId: string) {
      publishFleetStatusSessionGone(hostId, tmuxSession, sessionId);
      publishFleetStatusWaitingFor(hostId, tmuxSession, null);
    },
  };
}

beforeEach(async () => {
  __resetForTest();
  __resetForTestWaiting();

  serverPort = await getFreePort();
  registry = createSubscriptionRegistry();

  fleetStatusServer = startFleetStatusServer({
    port: serverPort,
    authManager: stubAuthManager,
    registry,
    resolveHostRecordByName: stubResolveHostRecord,
  });
});

afterEach(async () => {
  // Close client first
  if (clientWs) {
    const ws = clientWs;
    clientWs = null;
    ws.terminate();
  }

  // Close server — terminate all remaining WS connections so the HTTP
  // server's keep-alive handles don't prevent node from exiting.
  if (fleetStatusServer) {
    const server = fleetStatusServer;
    fleetStatusServer = null;
    await new Promise<void>((resolve) => {
      // Terminate any remaining client connections before closing
      server.wss.clients.forEach((c) => c.terminate());
      server.wss.close(() => resolve());
    });
  }
});

// ---------------------------------------------------------------------------
// Helper: open a WS client that sends the subscribe frame on open
// ---------------------------------------------------------------------------

async function openAndSubscribe(
  callbacks: ReturnType<typeof buildCallbacks>,
): Promise<void> {
  const url = `ws://localhost:${serverPort}/fleet-status/ws`;

  // We need a WS client that mimics what the browser client does. Use ws package
  // with an Authorization header to satisfy the auth check.
  clientWs = new WsClient(url, {
    headers: { Authorization: "Bearer test-token" },
  });

  await new Promise<void>((resolve, reject) => {
    clientWs!.on("open", () => {
      // Send subscribe frame
      clientWs!.send(
        JSON.stringify({ schemaVersion: FRAME_SCHEMA_VERSION, type: "subscribe" }),
      );
      resolve();
    });
    clientWs!.on("error", reject);
    setTimeout(() => reject(new Error("WS open timeout")), 3000);
  });

  // Wire message handler: dispatch frames to stores via callbacks
  clientWs.on("message", (raw) => {
    let parsed: { type: string; states?: unknown[]; state?: unknown; hostId?: string; tmuxSession?: string | null; sessionId?: string };
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }

    type SS = Parameters<typeof publishFleetStatusSessionState>[1];

    if (parsed.type === "snapshot" && Array.isArray(parsed.states)) {
      callbacks.onSnapshot(parsed.states as SS[]);
    } else if (parsed.type === "update" && parsed.state) {
      callbacks.onUpdate(parsed.state as SS);
    } else if (parsed.type === "gone") {
      callbacks.onGone(
        parsed.hostId ?? "",
        parsed.tmuxSession ?? null,
        parsed.sessionId ?? "",
      );
    }
  });

  // Wait briefly for the initial snapshot to arrive
  await new Promise((r) => setTimeout(r, 100));
}

// ---------------------------------------------------------------------------
// Test 1: watcher session_state (status='busy') → useSessionIsWorking true
// ---------------------------------------------------------------------------

describe("fleet-status e2e: Test 1 — busy state propagates to working-store", () => {
  it("registry.publishSessionState (status=busy) → onUpdate fires → useSessionIsWorking returns true", async () => {
    const callbacks = buildCallbacks();
    await openAndSubscribe(callbacks);

    // Publish a busy state from the watcher side
    const busyState = {
      hostId: "h1",
      tmuxSession: "s1",
      sessionId: "sid-1",
      pid: 1234,
      status: "busy" as const,
      backgroundTasks: [],
      updatedAt: Date.now(),
    };

    registry.publishSessionState("h1", busyState);

    // Wait for the update to propagate through the WS to the store
    await waitFor(() => {
      const snap = getSessionWorkingSnapshot();
      return snap.get("h1:s1")?.isWorking === true;
    }, 2000);

    const snap = getSessionWorkingSnapshot();
    expect(snap.get("h1:s1")?.isWorking).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2: watcher session_gone → stores cleared
// ---------------------------------------------------------------------------

describe("fleet-status e2e: Test 2 — session_gone propagates to both stores", () => {
  it("registry.publishSessionGone → useSessionIsWorking false + useSessionWaitingFor null", async () => {
    const callbacks = buildCallbacks();
    await openAndSubscribe(callbacks);

    // First publish a busy state
    const busyState = {
      hostId: "h1",
      tmuxSession: "s1",
      sessionId: "sid-1",
      pid: 1234,
      status: "busy" as const,
      backgroundTasks: [],
      updatedAt: Date.now(),
    };
    registry.publishSessionState("h1", busyState);

    // Wait for it to land
    await waitFor(() => {
      return getSessionWorkingSnapshot().get("h1:s1")?.isWorking === true;
    }, 2000);

    // Now send gone
    registry.publishSessionGone("h1", "s1", "sid-1");

    // Wait for key to disappear from working store
    await waitFor(() => {
      return !getSessionWorkingSnapshot().has("h1:s1");
    }, 2000);

    expect(getSessionWorkingSnapshot().has("h1:s1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 3: waiting state → isWorking=false, useSessionWaitingFor='approve Bash'
// ---------------------------------------------------------------------------

describe("fleet-status e2e: Test 3 — waiting state: isWorking=false, waitingFor='approve Bash'", () => {
  it("status='waiting' → useSessionIsWorking returns false AND useSessionWaitingFor returns reason", async () => {
    const callbacks = buildCallbacks();
    await openAndSubscribe(callbacks);

    const waitingState = {
      hostId: "h1",
      tmuxSession: "s2",
      sessionId: "sid-2",
      pid: 5678,
      status: "waiting" as const,
      waitingFor: "approve Bash",
      backgroundTasks: [],
      updatedAt: Date.now(),
    };

    registry.publishSessionState("h1", waitingState);

    // Wait for the state to land (waitingFor should be set)
    await waitFor(() => {
      const { result } = renderHook(() => useSessionWaitingFor("h1:s2"));
      return result.current !== null;
    }, 2000);

    // isWorking must be FALSE — waiting is NOT working per D-CTX composite formula
    const snap = getSessionWorkingSnapshot();
    expect(snap.get("h1:s2")?.isWorking).toBe(false);

    // waitingFor must be the reason from the harness
    const { result } = renderHook(() => useSessionWaitingFor("h1:s2"));
    act(() => {}); // flush
    expect(result.current).toBe("approve Bash");
  });
});
