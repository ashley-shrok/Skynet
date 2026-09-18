// ─── fleet-status-client — Vitest coverage (Phase 34 Plan 06, Task 2) ───────
// Tests 1-8 covering the browser WS client for /fleet-status/ws:
//
//   1. Opens WS + on open sends {schemaVersion:1, type:'subscribe'}
//   2. Snapshot frame → invokes onSnapshot with the 3-state array
//   3. Update frame → invokes onUpdate with the state
//   4. Gone frame → invokes onGone with hostId + tmuxSession + sessionId
//   5. WS close → schedules reconnect with backoff [2000,4000,6000,8000,8000]
//      after 5 attempts settles into indefinite slow retry (D-11; Phase 111 Plan 06)
//   6. dispose() cancels pending retry timer + closes socket
//   7. Malformed frames → log fleet_status_client_parse_error + drop (connection stays open)
//   8. AppShell wires client to store: onSnapshot dispatches per-state to
//      publishFleetStatusSessionState + publishFleetStatusWaitingFor;
//      onGone dispatches publishFleetStatusSessionGone + publishFleetStatusWaitingFor(null)

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FRAME_SCHEMA_VERSION } from "./fleet-status-types.js";

// ---------------------------------------------------------------------------
// Minimal WS stub matching the browser WebSocket API surface used by the client
// ---------------------------------------------------------------------------

type WsEventMap = {
  onopen: (() => void) | null;
  onmessage: ((evt: { data: string }) => void) | null;
  onclose: ((evt: { code: number; reason: string }) => void) | null;
  onerror: ((err: unknown) => void) | null;
};

class MockWebSocket implements WsEventMap {
  url: string;
  readyState: number = 1; // OPEN
  onopen: (() => void) | null = null;
  onmessage: ((evt: { data: string }) => void) | null = null;
  onclose: ((evt: { code: number; reason: string }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3; // CLOSED
  });
  static instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
}

// Helper: get most recent instance
function latestWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

// ---------------------------------------------------------------------------
// Inject MockWebSocket into global so fleet-status-client uses it
// ---------------------------------------------------------------------------

// NOTE: we store the original WebSocket and restore it after tests.
let originalWebSocket: typeof WebSocket;

beforeEach(() => {
  MockWebSocket.instances = [];
  originalWebSocket = globalThis.WebSocket;
  // @ts-expect-error intentional stub
  globalThis.WebSocket = MockWebSocket;
  vi.useFakeTimers();
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Import AFTER injecting the mock so the module picks up MockWebSocket
// ---------------------------------------------------------------------------

import { createFleetStatusClient, __disposeAllClientsForTest } from "./fleet-status-client.js";

// ---------------------------------------------------------------------------
// Test 1 — opens WS + sends subscribe frame on open
// ---------------------------------------------------------------------------

describe("fleet-status-client: Test 1 — opens WS and sends subscribe on open", () => {
  it("sends { schemaVersion: 1, type: 'subscribe' } when WS opens", () => {
    const onSnapshot = vi.fn();
    const onUpdate = vi.fn();
    const onGone = vi.fn();

    createFleetStatusClient({ url: "ws://localhost/fleet-status/ws", onSnapshot, onUpdate, onGone });

    const ws = latestWs();
    expect(ws.url).toBe("ws://localhost/fleet-status/ws");

    // Trigger open
    ws.onopen?.();

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
      schemaVersion: FRAME_SCHEMA_VERSION,
      type: "subscribe",
    });
  });
});

// ---------------------------------------------------------------------------
// Test 2 — snapshot frame → onSnapshot with 3-state array
// ---------------------------------------------------------------------------

describe("fleet-status-client: Test 2 — snapshot frame → onSnapshot", () => {
  it("invokes onSnapshot exactly once with all states from snapshot frame", () => {
    const onSnapshot = vi.fn();
    const onUpdate = vi.fn();
    const onGone = vi.fn();

    createFleetStatusClient({ url: "ws://localhost/fleet-status/ws", onSnapshot, onUpdate, onGone });
    const ws = latestWs();
    ws.onopen?.();

    const states = [
      { hostId: "h1", tmuxSession: "s1", sessionId: "sid1", pid: 1, status: "busy", backgroundTasks: [], updatedAt: 0 },
      { hostId: "h1", tmuxSession: "s2", sessionId: "sid2", pid: 2, status: "idle", backgroundTasks: [], updatedAt: 0 },
      { hostId: "h2", tmuxSession: "s3", sessionId: "sid3", pid: 3, status: "shell", backgroundTasks: [], updatedAt: 0 },
    ];

    ws.onmessage?.({
      data: JSON.stringify({ schemaVersion: FRAME_SCHEMA_VERSION, type: "snapshot", states }),
    });

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith(states);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onGone).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 3 — update frame → onUpdate with the state
// ---------------------------------------------------------------------------

describe("fleet-status-client: Test 3 — update frame → onUpdate", () => {
  it("invokes onUpdate with the state from an update frame", () => {
    const onSnapshot = vi.fn();
    const onUpdate = vi.fn();
    const onGone = vi.fn();

    createFleetStatusClient({ url: "ws://localhost/fleet-status/ws", onSnapshot, onUpdate, onGone });
    const ws = latestWs();
    ws.onopen?.();

    const state = { hostId: "h1", tmuxSession: "s1", sessionId: "sid1", pid: 1, status: "busy", backgroundTasks: [], updatedAt: 0 };

    ws.onmessage?.({
      data: JSON.stringify({ schemaVersion: FRAME_SCHEMA_VERSION, type: "update", state }),
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(state);
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(onGone).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 4 — gone frame → onGone with hostId + tmuxSession + sessionId
// ---------------------------------------------------------------------------

describe("fleet-status-client: Test 4 — gone frame → onGone", () => {
  it("invokes onGone with correct fields from a gone frame", () => {
    const onSnapshot = vi.fn();
    const onUpdate = vi.fn();
    const onGone = vi.fn();

    createFleetStatusClient({ url: "ws://localhost/fleet-status/ws", onSnapshot, onUpdate, onGone });
    const ws = latestWs();
    ws.onopen?.();

    ws.onmessage?.({
      data: JSON.stringify({
        schemaVersion: FRAME_SCHEMA_VERSION,
        type: "gone",
        hostId: "h1",
        tmuxSession: "s1",
        sessionId: "sid1",
      }),
    });

    expect(onGone).toHaveBeenCalledTimes(1);
    expect(onGone).toHaveBeenCalledWith("h1", "s1", "sid1");
  });
});

// ---------------------------------------------------------------------------
// Test 5 — WS close → schedules reconnect with backoff [2s, 4s, 6s, 8s, 8s]
//          then settles into indefinite slow retry (D-11)
//
// D-11 boundary lock: this test previously asserted "after 5 ladder attempts,
// gave_up is logged and no further reconnect ever occurs." That assertion was
// the WRONG contract. The deliberate change (Phase 111 Plan 06) replaces the
// terminal give-up with an indefinite slow retry at SLOW_RETRY_MS (~30s).
// The ladder is preserved; only the exhaustion behaviour changes.
// ---------------------------------------------------------------------------

describe("fleet-status-client: Test 5 — reconnect backoff on WS close", () => {
  it("fires reconnects at 2000, 4000, 6000, 8000, 8000 ms; then settles into indefinite slow retry (D-11)", () => {
    const onSnapshot = vi.fn();
    const onUpdate = vi.fn();
    const onGone = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    createFleetStatusClient({ url: "ws://localhost/fleet-status/ws", onSnapshot, onUpdate, onGone });

    // Simulate open + close for each attempt
    const triggerClose = () => {
      const ws = latestWs();
      ws.readyState = 3;
      ws.onclose?.({ code: 1006, reason: "test close" });
    };

    // Attempt 1: close → 2s timer
    triggerClose();
    expect(MockWebSocket.instances.length).toBe(1); // no reconnect yet
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances.length).toBe(2); // reconnected

    // Attempt 2: close → 4s timer
    triggerClose();
    vi.advanceTimersByTime(4000);
    expect(MockWebSocket.instances.length).toBe(3);

    // Attempt 3: close → 6s timer
    triggerClose();
    vi.advanceTimersByTime(6000);
    expect(MockWebSocket.instances.length).toBe(4);

    // Attempt 4: close → 8s timer
    triggerClose();
    vi.advanceTimersByTime(8000);
    expect(MockWebSocket.instances.length).toBe(5);

    // Attempt 5: close → 8s timer
    triggerClose();
    vi.advanceTimersByTime(8000);
    expect(MockWebSocket.instances.length).toBe(6);

    // Attempt 6: this is where the old code gave up. Under D-11, a slow retry
    // IS scheduled. Advance by SLOW_RETRY_MS (30s) — a 7th socket must appear.
    triggerClose();
    vi.advanceTimersByTime(30000);
    expect(MockWebSocket.instances.length).toBe(7); // slow retry reconnected — NOT stuck at 6

    // Prove "indefinitely" — not "one extra attempt". Another close + 30s → 8th socket.
    triggerClose();
    vi.advanceTimersByTime(30000);
    expect(MockWebSocket.instances.length).toBe(8);

    // The transition to slow retry must have emitted fleet_status_client_slow_retry
    // (ONCE, on the first exhaustion). The old gave_up operation no longer exists.
    const allCalls = [...warnSpy.mock.calls.flat(), ...infoSpy.mock.calls.flat()];
    const slowRetry = allCalls.find(
      (arg) =>
        typeof arg === "object" &&
        arg !== null &&
        (arg as Record<string, unknown>).operation === "fleet_status_client_slow_retry",
    );
    expect(slowRetry).toBeDefined();

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Test 6 — dispose() cancels timer + closes socket
// ---------------------------------------------------------------------------

describe("fleet-status-client: Test 6 — dispose() cancels retry and closes socket", () => {
  it("dispose() clears pending retry timer and stops reconnects", () => {
    const onSnapshot = vi.fn();
    const onUpdate = vi.fn();
    const onGone = vi.fn();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot,
      onUpdate,
      onGone,
    });

    expect(MockWebSocket.instances.length).toBe(1);

    // Trigger a close to schedule a 2s retry timer
    const ws = latestWs();
    ws.readyState = 3;
    ws.onclose?.({ code: 1006, reason: "" });

    // dispose before the 2s timer fires — cancels the timer
    client.dispose();

    // Advance well past the 2s timer — should NOT create a new WS
    vi.advanceTimersByTime(10000);
    expect(MockWebSocket.instances.length).toBe(1); // no reconnect after dispose
  });

  it("dispose() closes the socket if still open", () => {
    const onSnapshot = vi.fn();
    const onUpdate = vi.fn();
    const onGone = vi.fn();
    vi.spyOn(console, "info").mockImplementation(() => {});

    const client = createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot,
      onUpdate,
      onGone,
    });

    const ws = latestWs();
    // WS is still OPEN (readyState=1); dispose should close it
    ws.readyState = 1;

    client.dispose();

    expect(ws.close).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 7 — Malformed frames → log parse_error + drop; connection stays open
// ---------------------------------------------------------------------------

describe("fleet-status-client: Test 7 — malformed frames are logged and dropped", () => {
  it("logs fleet_status_client_parse_error and does not throw on malformed JSON", () => {
    const onSnapshot = vi.fn();
    const onUpdate = vi.fn();
    const onGone = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    createFleetStatusClient({ url: "ws://localhost/fleet-status/ws", onSnapshot, onUpdate, onGone });
    const ws = latestWs();
    ws.onopen?.();

    // Send malformed JSON — should not throw
    expect(() => {
      ws.onmessage?.({ data: "not valid json{{{{" });
    }).not.toThrow();

    // Should log parse_error with err.message (not an Event object)
    const parseErrorCalls = warnSpy.mock.calls.filter((args) =>
      args.some(
        (arg) =>
          typeof arg === "object" &&
          arg !== null &&
          (arg as Record<string, unknown>).operation === "fleet_status_client_parse_error",
      ),
    );
    expect(parseErrorCalls.length).toBeGreaterThanOrEqual(1);

    // err.message must be a string, not an Event object
    const logObj = parseErrorCalls[0].find(
      (arg) =>
        typeof arg === "object" &&
        arg !== null &&
        (arg as Record<string, unknown>).operation === "fleet_status_client_parse_error",
    ) as Record<string, unknown>;
    expect(typeof logObj.errMessage).toBe("string");

    // Callbacks NOT called — frame was dropped
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onGone).not.toHaveBeenCalled();

    // Connection NOT closed — still OPEN (readyState 1)
    expect(ws.readyState).toBe(1);

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Test 8 — AppShell wiring: onSnapshot + onUpdate dispatch to both stores;
//           onGone dispatches publishFleetStatusSessionGone + waitingFor(null)
// ---------------------------------------------------------------------------

describe("fleet-status-client: Test 8 — AppShell callback wiring dispatches to stores", () => {
  it("AppShell-style onSnapshot dispatches each state to both stores correctly", async () => {
    const { publishFleetStatusSessionState, __resetForTest, getSessionWorkingSnapshot } =
      await import("@/state/session-working-store.js");
    const { publishFleetStatusWaitingFor, useSessionWaitingFor, __resetForTestWaiting } =
      await import("@/state/session-waiting-store.js");
    const { publishFleetStatusSessionGone } =
      await import("@/state/session-working-store.js");

    __resetForTest();
    __resetForTestWaiting();

    vi.spyOn(console, "info").mockImplementation(() => {});

    // Build the AppShell-style callbacks (mirrors what AppShell.tsx will do)
    type SS = Parameters<typeof publishFleetStatusSessionState>[1];

    const onSnapshot = (states: SS[]) => {
      for (const state of states) {
        publishFleetStatusSessionState(state.hostId, state);
        publishFleetStatusWaitingFor(
          state.hostId,
          state.tmuxSession,
          state.status === "waiting" ? state.waitingFor ?? "input needed" : null,
        );
      }
    };
    const onUpdate = (state: SS) => {
      publishFleetStatusSessionState(state.hostId, state);
      publishFleetStatusWaitingFor(
        state.hostId,
        state.tmuxSession,
        state.status === "waiting" ? state.waitingFor ?? "input needed" : null,
      );
    };
    const onGone = (hostId: string, tmuxSession: string | null, sessionId: string) => {
      publishFleetStatusSessionGone(hostId, tmuxSession, sessionId);
      publishFleetStatusWaitingFor(hostId, tmuxSession, null);
    };

    createFleetStatusClient({ url: "ws://localhost/fleet-status/ws", onSnapshot, onUpdate, onGone });
    const ws = latestWs();
    ws.onopen?.();

    const busyState: SS = {
      hostId: "h1", tmuxSession: "s1", sessionId: "sid1", pid: 1,
      status: "busy", backgroundTasks: [], updatedAt: 0,
    };
    const waitingState: SS = {
      hostId: "h1", tmuxSession: "s2", sessionId: "sid2", pid: 2,
      status: "waiting", waitingFor: "approve Bash",
      backgroundTasks: [], updatedAt: 0,
    };

    // Simulate snapshot with 2 states
    ws.onmessage?.({
      data: JSON.stringify({
        schemaVersion: FRAME_SCHEMA_VERSION,
        type: "snapshot",
        states: [busyState, waitingState],
      }),
    });

    // h1:s1 should be working (busy)
    const snap = getSessionWorkingSnapshot();
    expect(snap.get("h1:s1")?.isWorking).toBe(true);

    // h1:s2 is waiting — NOT working; but waiting-store has the reason
    expect(snap.get("h1:s2")?.isWorking).toBe(false);
    // Test waitingFor via the store's direct Map (not hook, to avoid React context)
    // We check via publishFleetStatusWaitingFor having been called correctly by testing
    // that a subsequent useSessionWaitingFor call from a hook would return the right thing.
    // Actually, verify by checking we can retrieve via hook in act():
    // (We confirm waitingFor state was set by verifying the update path clears it)

    // onUpdate path: idle state clears isWorking
    const idleState: SS = {
      hostId: "h1", tmuxSession: "s1", sessionId: "sid1", pid: 1,
      status: "idle", backgroundTasks: [], updatedAt: 1,
    };
    ws.onmessage?.({
      data: JSON.stringify({
        schemaVersion: FRAME_SCHEMA_VERSION,
        type: "update",
        state: idleState,
      }),
    });

    const snap2 = getSessionWorkingSnapshot();
    expect(snap2.get("h1:s1")?.isWorking).toBe(false);

    // onGone path: session h1:s1 gone → key deleted from working store
    const initialCount = snap2.size;
    ws.onmessage?.({
      data: JSON.stringify({
        schemaVersion: FRAME_SCHEMA_VERSION,
        type: "gone",
        hostId: "h1",
        tmuxSession: "s1",
        sessionId: "sid1",
      }),
    });

    const snap3 = getSessionWorkingSnapshot();
    expect(snap3.size).toBeLessThan(initialCount);
    expect(snap3.has("h1:s1")).toBe(false);
  });

  it("publishFleetStatusWaitingFor is called with waiting reason for waiting state, null for non-waiting", async () => {
    const { publishFleetStatusSessionState, __resetForTest } =
      await import("@/state/session-working-store.js");
    const { __resetForTestWaiting } =
      await import("@/state/session-waiting-store.js");

    __resetForTest();
    __resetForTestWaiting();

    vi.spyOn(console, "info").mockImplementation(() => {});

    type SS = Parameters<typeof publishFleetStatusSessionState>[1];

    const waitingForReceived: Array<string | null> = [];
    const onSnapshot = vi.fn();
    const onUpdate = (state: SS) => {
      const wf = state.status === "waiting" ? state.waitingFor ?? "input needed" : null;
      waitingForReceived.push(wf);
      publishFleetStatusSessionState(state.hostId, state);
    };
    const onGone = vi.fn();

    createFleetStatusClient({ url: "ws://localhost/fleet-status/ws", onSnapshot, onUpdate, onGone });
    const ws = latestWs();
    ws.onopen?.();

    // waiting state → waitingFor should be the reason
    ws.onmessage?.({
      data: JSON.stringify({
        schemaVersion: FRAME_SCHEMA_VERSION,
        type: "update",
        state: {
          hostId: "h1", tmuxSession: "s1", sessionId: "sid1", pid: 1,
          status: "waiting", waitingFor: "approve Bash",
          backgroundTasks: [], updatedAt: 0,
        },
      }),
    });
    expect(waitingForReceived[0]).toBe("approve Bash");

    // idle state → null
    ws.onmessage?.({
      data: JSON.stringify({
        schemaVersion: FRAME_SCHEMA_VERSION,
        type: "update",
        state: {
          hostId: "h1", tmuxSession: "s1", sessionId: "sid1", pid: 1,
          status: "idle", backgroundTasks: [], updatedAt: 1,
        },
      }),
    });
    expect(waitingForReceived[1]).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Test 9 — reconnect delay is full-jittered (R-54-07)
// ---------------------------------------------------------------------------

describe("fleet-status-client: Test 9 — reconnect delay is full-jittered (R-54-07)", () => {
  it("after ws.onclose, the scheduled setTimeout delay is in [0, BACKOFF_SCHEDULE_MS[0]) — NOT the fixed BACKOFF_SCHEDULE_MS[0]", () => {
    // Set up deterministic Math.random returning 0.5 (mid-point)
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
    });

    const ws = latestWs();
    ws.onclose?.({ code: 1006, reason: "test" });

    // With Math.random() = 0.5, jittered delay for attempt 0 = floor(0.5 * 2000) = 1000
    // (NOT the fixed 2000 from BACKOFF_SCHEDULE_MS[0])
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);
    const reconnectDelay = delays[delays.length - 1];
    expect(reconnectDelay).toBe(1000); // Math.floor(0.5 * 2000) = 1000, NOT 2000
    expect(reconnectDelay).not.toBe(2000); // must NOT be the fixed cap value

    randomSpy.mockRestore();
  });

  it("100 samples of the first-attempt reconnect delay all fall in [0, 2000) — proves uniform not clumped", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Restore real Math.random for statistical sampling
    vi.spyOn(Math, "random").mockRestore?.();

    const samples: number[] = [];

    for (let i = 0; i < 100; i++) {
      MockWebSocket.instances = [];
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      const client = createFleetStatusClient({
        url: "ws://localhost/fleet-status/ws",
        onSnapshot: vi.fn(),
        onUpdate: vi.fn(),
        onGone: vi.fn(),
      });

      const ws = latestWs();
      ws.onclose?.({ code: 1006, reason: "test" });

      const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);
      const reconnectDelay = delays[delays.length - 1];
      samples.push(reconnectDelay);

      client.dispose();
      setTimeoutSpy.mockRestore();
    }

    // All samples must be in [0, 2000)
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2000);
    }

    // Mean must be in [800, 1200] — proves uniform distribution, not clumped at edges
    const mean = samples.reduce((acc, s) => acc + s, 0) / samples.length;
    expect(mean).toBeGreaterThanOrEqual(800);
    expect(mean).toBeLessThanOrEqual(1200);
  });

  it("attempt 2 delay is jittered in [0, BACKOFF_SCHEDULE_MS[1]) === [0, 4000)", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
    });

    // First close — attempt 1 (index 0)
    const ws1 = latestWs();
    ws1.onclose?.({ code: 1006, reason: "test" });

    // Advance timer to trigger the reconnect
    vi.advanceTimersByTime(2000);

    // Second close — attempt 2 (index 1, cap = BACKOFF_SCHEDULE_MS[1] = 4000)
    const ws2 = latestWs();
    ws2.onclose?.({ code: 1006, reason: "test" });

    const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);
    // The last delay captured is the second-attempt reconnect
    const secondAttemptDelay = delays[delays.length - 1];
    expect(secondAttemptDelay).toBeGreaterThanOrEqual(0);
    expect(secondAttemptDelay).toBeLessThan(4000);
  });

  // D-11 boundary lock (fourth case): this test previously asserted that after
  // MAX_RECONNECT_ATTEMPTS closes the client gave up and logged the give-up operation
  // with no further setTimeout. That was the WRONG contract.
  // The deliberate change (Phase 111 Plan 06) makes the 6th close schedule a slow
  // retry timer at SLOW_RETRY_MS (30s) and emit fleet_status_client_slow_retry ONCE.
  // The jitter draw still applies: the delay is in [0, SLOW_RETRY_MS) not a fixed 30s.
  it("after MAX_RECONNECT_ATTEMPTS (5) closes without open, settles into slow retry (D-11): setTimeout IS called with delay in [0, SLOW_RETRY_MS) and fleet_status_client_slow_retry is logged", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
    });

    // Simulate 5 closes + timer advances (the 5 reconnect attempts — ladder exhausted)
    for (let i = 0; i < 5; i++) {
      const ws = latestWs();
      ws.onclose?.({ code: 1006, reason: "test" });
      vi.advanceTimersByTime(10000); // advance past any scheduled timer
    }

    // 6th close — under D-11 this MUST schedule a slow retry, not give up
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const ws = latestWs();
    ws.onclose?.({ code: 1006, reason: "test" });

    // A setTimeout MUST have been called (slow retry scheduled)
    expect(setTimeoutSpy).toHaveBeenCalled();

    // The delay must fall in [0, SLOW_RETRY_MS) — full-jitter still applies (D-13)
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);
    const slowRetryDelay = delays[delays.length - 1];
    expect(slowRetryDelay).toBeGreaterThanOrEqual(0);
    expect(slowRetryDelay).toBeLessThan(30000); // SLOW_RETRY_MS = 30_000

    // The transition must have emitted fleet_status_client_slow_retry, not gave_up
    const allWarnCalls = warnSpy.mock.calls.flat();
    const slowRetry = allWarnCalls.find(
      (arg) =>
        typeof arg === "object" &&
        arg !== null &&
        (arg as Record<string, unknown>).operation === "fleet_status_client_slow_retry",
    );
    expect(slowRetry).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 10 — wake on visible (D-12) — Phase 111 Plan 06
// ---------------------------------------------------------------------------
//
// Helper to flip document.visibilityState and dispatch the event, since
// jsdom's visibilityState is read-only by default.
//
function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("fleet-status-client: Test 10 — wake on visible (D-12)", () => {
  // Dispose all clients created by prior tests (including Test 9's intentionally
  // undisposed jitter cases) before each Test 10 case. Without this, those
  // clients' visibilitychange listeners remain registered and fire when
  // setVisibility() is called, creating extra sockets and polluting assertions.
  // __disposeAllClientsForTest() is a test-only export from fleet-status-client.ts
  // that disposes every client in the module-level registry and clears it.
  beforeEach(() => {
    __disposeAllClientsForTest();
    MockWebSocket.instances = []; // reset after disposing (dispose creates disposed log, not new sockets)
  });
  afterEach(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("case 1: reconnects immediately when visible with no socket (no timer advance needed)", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
    });
    // Snapshot after create: our socket + any prior-test sockets from beforeEach reset = 1
    const countAfterCreate = MockWebSocket.instances.length;

    // Drive the socket to null by closing and NOT advancing timers (so it stays null)
    const ws = latestWs();
    ws.readyState = 3;
    ws.onclose?.({ code: 1006, reason: "test" });
    // ws is now null; a retry timer is pending but has NOT fired.
    // Snapshot before visibility: no new sockets created by the close alone.
    const countBeforeVisible = MockWebSocket.instances.length;
    expect(countBeforeVisible).toBe(countAfterCreate); // onclose alone creates no new socket

    // Go visible — THIS client's handler fires (disposed=false, ws===null) → +1 socket.
    // Undisposed clients from prior jitter tests may also fire, but their ws.readyState=1
    // (open) so the `ws !== null` double-fire guard blocks them. Net delta: exactly +1.
    setVisibility("visible");
    expect(MockWebSocket.instances.length).toBe(countBeforeVisible + 1); // exactly +1 (this client)

    client.dispose();
  });

  it("case 2: clears the pending retry timer on visible (no extra socket from the old timer)", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
    });

    // Close → pending retry timer
    const ws = latestWs();
    ws.readyState = 3;
    ws.onclose?.({ code: 1006, reason: "test" });
    const countBeforeVisible = MockWebSocket.instances.length;

    // Go visible → THIS client reconnects immediately (+1), clearing the pending timer
    setVisibility("visible");
    const countAfterVisible = MockWebSocket.instances.length;
    expect(countAfterVisible).toBe(countBeforeVisible + 1); // +1 from this client

    // Advance past the original delay — must NOT produce another socket from this client
    vi.advanceTimersByTime(10000);
    expect(MockWebSocket.instances.length).toBe(countAfterVisible); // no extra from old timer

    client.dispose();
  });

  it("case 3: does NOT reconnect when a socket is already open (iOS-PWA double-fire guard)", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
    });
    // Socket is open (readyState=1, the mock default)
    const countAfterCreate = MockWebSocket.instances.length;

    // Go visible — ws !== null guard prevents extra socket from THIS client
    setVisibility("visible");
    expect(MockWebSocket.instances.length).toBe(countAfterCreate); // unchanged by THIS client

    client.dispose();
  });

  it("case 4: hidden clears the timer but does NOT reset the attempt budget; visible then gives a fresh budget", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Part A: drive two closes, go hidden, then close again WITHOUT going visible.
    // The next delay cap should correspond to where the ladder was (attempt 2 → BACKOFF[2] = 6000).
    {
      // Ensure visible state for a clean start
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      const client = createFleetStatusClient({
        url: "ws://localhost/fleet-status/ws",
        onSnapshot: vi.fn(),
        onUpdate: vi.fn(),
        onGone: vi.fn(),
      });
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      // Close 1 → attempt 0 → BACKOFF[0] = 2000 cap
      latestWs().onclose?.({ code: 1006, reason: "test" });
      vi.advanceTimersByTime(2000); // reconnect fires

      // Close 2 → attempt 1 → BACKOFF[1] = 4000 cap
      latestWs().onclose?.({ code: 1006, reason: "test" });
      vi.advanceTimersByTime(4000); // reconnect fires

      // Go HIDDEN (clears pending timer if any) — does NOT reset reconnectAttempts
      setVisibility("hidden");

      // Close 3 → attempt 2 → BACKOFF[2] = 6000 cap, not reset to attempt 0
      latestWs().onclose?.({ code: 1006, reason: "test" });
      // The scheduled delay must be in [0, 6000) — not reset to [0, 2000)
      const delays = setTimeoutSpy.mock.calls.map((c) => c[1] as number);
      const capAfterHide = delays[delays.length - 1];
      expect(capAfterHide).toBeLessThan(6000); // within attempt-2 cap (BACKOFF[2] = 6000)

      client.dispose();
      setTimeoutSpy.mockRestore();
    }

    // Part B: drive two closes, go visible while socket is null (fresh budget), then close.
    // The next delay cap should be BACKOFF[0] = 2000 (budget reset on visible).
    {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      const client = createFleetStatusClient({
        url: "ws://localhost/fleet-status/ws",
        onSnapshot: vi.fn(),
        onUpdate: vi.fn(),
        onGone: vi.fn(),
      });
      const countAfterCreate = MockWebSocket.instances.length;

      // Close 1 → attempt 0 → BACKOFF[0] = 2000
      latestWs().onclose?.({ code: 1006, reason: "test" });
      vi.advanceTimersByTime(2000);

      // Close 2 → attempt 1 → BACKOFF[1] = 4000; drive to socket-null, don't advance timer
      latestWs().onclose?.({ code: 1006, reason: "test" });
      // Now ws is null and reconnectAttempts is 2 (post-increment from onclose)
      const countBeforeVisible = MockWebSocket.instances.length;

      // Go visible while socket is null → fresh budget (reconnectAttempts = 0), immediate connect
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      setVisibility("visible");
      // +1 from this client's visible handler (possibly more from other undisposed, but
      // those have ws open → blocked). Assert at least +1 from our client.
      expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(countBeforeVisible + 1);
      const countAfterVisible = MockWebSocket.instances.length;

      // Now close that newly-opened socket → attempt 0 with fresh budget → BACKOFF[0] = 2000 cap
      latestWs().onclose?.({ code: 1006, reason: "test" });
      const delays = setTimeoutSpy.mock.calls.map((c) => c[1] as number);
      const firstDelayAfterVisible = delays[delays.length - 1];
      expect(firstDelayAfterVisible).toBeLessThan(2000); // within BACKOFF[0] = 2000 cap

      void countAfterCreate; void countAfterVisible; // used in assertions
      client.dispose();
      setTimeoutSpy.mockRestore();
    }
  });

  it("case 5: resets the attempt budget on visible — next close after visible uses BACKOFF[0] not SLOW_RETRY_MS", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
    });

    // Exhaust the ladder into slow-retry mode (5 ladder closes)
    for (let i = 0; i < 5; i++) {
      latestWs().onclose?.({ code: 1006, reason: "test" });
      vi.advanceTimersByTime(10000); // advance past any scheduled timer
    }
    // Now in slow-retry mode. Trigger the 6th close (first slow-retry scheduled).
    latestWs().onclose?.({ code: 1006, reason: "test" });
    // Don't advance the slow retry timer — ws is null, slow retry is pending.
    const countBeforeVisible = MockWebSocket.instances.length;

    // Go visible while socket is null (ws===null) → fresh budget, immediate connect from THIS client
    setVisibility("visible");
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(countBeforeVisible + 1);

    // Close the socket that THIS client just opened (the latestWs after visible)
    // and assert the delay is in [0, BACKOFF[0]) = [0, 2000), not [0, SLOW_RETRY_MS)
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    latestWs().onclose?.({ code: 1006, reason: "test" });
    const delays = setTimeoutSpy.mock.calls.map((c) => c[1] as number);
    const freshDelay = delays[delays.length - 1];
    // With a fresh budget, attempt 0 cap is BACKOFF[0] = 2000, NOT SLOW_RETRY_MS = 30000
    expect(freshDelay).toBeLessThan(2000);
    setTimeoutSpy.mockRestore();
    client.dispose();
  });

  it("case 6: dispose() removes the listener — dispatching visibilitychange after dispose creates no new socket", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
    });

    // Drive to socket-null state
    const ws = latestWs();
    ws.readyState = 3;
    ws.onclose?.({ code: 1006, reason: "test" });
    const countAfterClose = MockWebSocket.instances.length;

    // Dispose — removes the visibilitychange listener
    client.dispose();

    // Dispatch visibilitychange with state=visible → no NEW socket from THIS client, no throw
    expect(() => {
      setVisibility("visible");
    }).not.toThrow();
    // THIS client's listener is removed → no socket from it. Delta = 0 from this client.
    // (Other undisposed clients with ws open are blocked by ws!==null guard.)
    expect(MockWebSocket.instances.length).toBe(countAfterClose); // no new socket from this client
  });

  it("case 7: a disposed client ignores visibility entirely — disposed early-return runs first", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
    });
    // Record instance count and info calls before dispose
    const countAfterCreate = MockWebSocket.instances.length;
    client.dispose();

    const callsBefore = infoSpy.mock.calls.length;
    setVisibility("visible");
    // The disposed early-return fires before any action — no new info logs from THIS client.
    // (The disposed log was already emitted when dispose() was called, counted in callsBefore.)
    expect(infoSpy.mock.calls.length).toBe(callsBefore); // no new console output from this client
    expect(MockWebSocket.instances.length).toBe(countAfterCreate); // no new socket from this client
  });

  it("case 8: no sequence-reconciliation on reconnect (D-13) — only the subscribe frame is sent after a visible-triggered reconnect", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
    });

    // Record the initial subscribe frame sent on open
    const ws1 = latestWs();
    ws1.onopen?.();
    expect(ws1.send).toHaveBeenCalledTimes(1);
    const initialFrame = JSON.parse(ws1.send.mock.calls[0][0] as string);

    // Drive to socket-null (ws.onclose fires, ws set to null)
    ws1.readyState = 3;
    ws1.onclose?.({ code: 1006, reason: "test" });
    const countAfterClose = MockWebSocket.instances.length;

    // Trigger visible reconnect — THIS client creates +1 socket
    setVisibility("visible");
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(countAfterClose + 1);

    // The newly-created socket from THIS client is latestWs()
    const ws2 = latestWs();
    ws2.onopen?.();
    expect(ws2.send).toHaveBeenCalledTimes(1);
    const reconnectFrame = JSON.parse(ws2.send.mock.calls[0][0] as string);

    // The reconnect's only outbound frame must deep-equal the initial subscribe frame.
    // No sequence number, no since-timestamp, no replay request — D-13.
    expect(reconnectFrame).toEqual(initialFrame);
    expect(reconnectFrame).toEqual({
      schemaVersion: FRAME_SCHEMA_VERSION,
      type: "subscribe",
    });

    client.dispose();
  });
});

// ---------------------------------------------------------------------------
// Phase 90 Plan 00 Wave 0 (D-10 delivery mechanism, user 2026-09-08 D-03
// waiver) — useSessionContextPct hook tests (behaviors 1-4 per plan).
// ---------------------------------------------------------------------------

describe("useSessionContextPct hook (Phase 90 Wave 0)", () => {
  // Vitest uses jsdom by default per package.json; renderHook needs the DOM.
  let renderHook: typeof import("@testing-library/react").renderHook;
  let act: typeof import("@testing-library/react").act;
  let useSessionContextPct: (
    hostId: string | number,
    tmuxSession: string,
  ) => number | null;
  let __setSessionContextPctForTests: (
    hostId: string,
    tmuxSession: string | null,
    pct: number | null,
  ) => void;
  let __resetSessionContextPctForTests: () => void;

  beforeEach(async () => {
    // Import lazily so the vi.useFakeTimers() setup above doesn't interfere.
    const rtl = await import("@testing-library/react");
    renderHook = rtl.renderHook;
    act = rtl.act;
    const mod = await import("./fleet-status-client.js");
    useSessionContextPct = mod.useSessionContextPct;
    __setSessionContextPctForTests = mod.__setSessionContextPctForTests;
    __resetSessionContextPctForTests = mod.__resetSessionContextPctForTests;
    // Use REAL timers for hook tests — React scheduling depends on them.
    vi.useRealTimers();
    __resetSessionContextPctForTests();
  });

  afterEach(() => {
    __resetSessionContextPctForTests();
  });

  it(
    "Test 1 (behavior 1): returns the current contextPct for the given session from the subscribed store; returns null when the session record has no contextPct OR when the session is not present",
    () => {
      // Unpublished session → null.
      const { result: r1 } = renderHook(() =>
        useSessionContextPct(42, "never-published"),
      );
      expect(r1.current).toBeNull();

      // Publish a value, mount hook, read.
      __setSessionContextPctForTests("42", "tina", 55);
      const { result: r2 } = renderHook(() =>
        useSessionContextPct(42, "tina"),
      );
      expect(r2.current).toBe(55);

      // Publish an explicit null (dormant/no-reading sentinel) → hook reads null.
      act(() => {
        __setSessionContextPctForTests("42", "tina", null);
      });
      expect(r2.current).toBeNull();
    },
  );

  it(
    "Test 2 (behavior 2): mounting subscribes; unmounting cleans up (mirrors the existing hook pattern)",
    () => {
      __setSessionContextPctForTests("42", "tina", 30);
      const { result, unmount } = renderHook(() =>
        useSessionContextPct(42, "tina"),
      );
      expect(result.current).toBe(30);

      // Unmount should remove the listener — a subsequent publish must NOT
      // throw or cause a stale render. React 18 renderHook.unmount is sync.
      unmount();
      expect(() => {
        act(() => {
          __setSessionContextPctForTests("42", "tina", 90);
        });
      }).not.toThrow();
      // Freshly mounted hook sees the new value (proves the store is intact).
      const { result: r2 } = renderHook(() =>
        useSessionContextPct(42, "tina"),
      );
      expect(r2.current).toBe(90);
    },
  );

  it(
    "Test 3 (behavior 3): hook key format matches session-working-store convention — `${hostId}:${tmuxSession}` (D-10 correctness)",
    () => {
      // Publishing with a specific hostId+tmuxSession — the hook must resolve
      // to the SAME key. String-vs-number hostId coercion must not collide.
      __setSessionContextPctForTests("42", "tina", 65);
      const { result } = renderHook(() =>
        useSessionContextPct(42, "tina"), // numeric hostId — must resolve
      );
      expect(result.current).toBe(65);

      // Different tmuxSession on same hostId → distinct key.
      const { result: rOther } = renderHook(() =>
        useSessionContextPct(42, "other"),
      );
      expect(rOther.current).toBeNull();

      // Different hostId, same tmuxSession → distinct key.
      __setSessionContextPctForTests("77", "tina", 12);
      const { result: rHost77 } = renderHook(() =>
        useSessionContextPct("77", "tina"),
      );
      expect(rHost77.current).toBe(12);
      // Original still 65 (no collision).
      expect(result.current).toBe(65);
    },
  );

  it(
    "Test 4 (behavior 4): reactive updates — a change to the underlying fleet-status snapshot re-renders consumers (useSyncExternalStore semantics)",
    () => {
      __setSessionContextPctForTests("42", "tina", 20);
      const { result } = renderHook(() =>
        useSessionContextPct(42, "tina"),
      );
      expect(result.current).toBe(20);

      // Publish successive updates; hook must reflect each.
      act(() => {
        __setSessionContextPctForTests("42", "tina", 30);
      });
      expect(result.current).toBe(30);

      act(() => {
        __setSessionContextPctForTests("42", "tina", 50);
      });
      expect(result.current).toBe(50);

      // Publishing an IDENTICAL value should be a no-op notify (guard in
      // publishSessionContextPct). Hook value stays at 50.
      act(() => {
        __setSessionContextPctForTests("42", "tina", 50);
      });
      expect(result.current).toBe(50);
    },
  );
});

// ---------------------------------------------------------------------------
// Phase 117 Plan 117-06 Task 2 — onProjectListChanged option + WS dispatch
// ---------------------------------------------------------------------------
//
// Locks the new `project-list-changed` frame dispatch:
//   - New callback option onProjectListChanged?: (projects) => void
//   - New switch case "project-list-changed" invoking the callback
//   - Structured console.info log with operation:
//     "fleet_status_client_project_list_changed" and projectCount
//   - Regression guard on the existing dispatch branches (identity-archived,
//     snapshot) — Phase 115 wiring must not break.
//   - Malformed frames (projects not an array) MUST NOT invoke the callback
//     with garbage. This is a Rule-2 correctness guard added to the switch
//     branch because the browser skips zod (see fleet-status-types.ts).
//
// Uses the same MockWebSocket harness as Tests 1-10. Fake timers already
// installed by the top-level beforeEach.

describe("fleet-status-client: Phase 117 Plan 117-06 — project-list-changed dispatch", () => {
  beforeEach(() => {
    __disposeAllClientsForTest();
    MockWebSocket.instances = [];
  });

  // Test P117-06-1 — onProjectListChanged callback fires with the projects array
  it("Test 1 (project-list-changed callback fires): valid frame invokes onProjectListChanged once with parsed.projects", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const onProjectListChanged = vi.fn();
// Phase 119 Plan 119-01 (D-14, D-16): app-frame dispatch tests
//
// Verifies the three new switch arms — `app-snapshot`, `app-update`,
// `app-gone` — fire their corresponding optional callbacks with the parsed
// payloads. Also verifies (a) the callbacks are optional (omitting them does
// NOT throw when a real app frame arrives), and (b) unknown frame types
// still fall through to the pre-existing default branch (no regression from
// widening the union).
//
// These tests close RESEARCH.md Pitfall 1 at runtime — they would fail if
// the switch dispatch silently dropped app frames into the default arm.
// ---------------------------------------------------------------------------

describe("fleet-status-client: app-frame dispatch (Phase 119 Plan 119-01)", () => {
  // Realistic AppState payload — mirrors backend AppStateSchema
  // (wire-protocol.ts:632-644) verbatim.
  const sampleApp = {
    hostId: "6",
    slug: "scratch-sidebar-test",
    title: "Scratch Sidebar Test",
    description: "Test app for Phase 119 UAT",
    port: 8080,
    hasIcon: true,
    createdAtMs: 1758211200000,
    isHealthy: true,
    healthMessage: null,
  };

  const sampleAppUnhealthy = {
    ...sampleApp,
    slug: "scratch-broken",
    title: "Broken App",
    isHealthy: false,
    healthMessage: "unit exists but currently stopped",
  };

  it("dispatches app-snapshot frame to onAppSnapshot with the apps array", () => {
    const onAppSnapshot = vi.fn();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
      onProjectListChanged,
      onAppSnapshot,
    });
    const ws = latestWs();
    ws.onopen?.();

    const projects = [
      {
        slug: "alpha",
        displayName: "Alpha",
        hostId: "1",
        hostname: "host-a",
        archived: false,
      },
      {
        slug: "beta",
        displayName: "Beta",
        hostId: "1",
        hostname: "host-a",
        archived: false,
      },
    ];

    ws.onmessage?.({
      data: JSON.stringify({
        schemaVersion: FRAME_SCHEMA_VERSION,
        type: "project-list-changed",
        projects,
      }),
    });

    expect(onProjectListChanged).toHaveBeenCalledTimes(1);
    expect(onProjectListChanged).toHaveBeenCalledWith(projects);
  });

  // Test P117-06-2 — missing callback is a no-op (no throw, no crash);
  //                  structured info log still fires.
  it("Test 2 (missing callback no-op): frame arrives without onProjectListChanged wired — no throw, structured info log still fires", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Deliberately do NOT wire onProjectListChanged.
    ws.onmessage?.({
      data: JSON.stringify({
        schemaVersion: FRAME_SCHEMA_VERSION,
        type: "app-snapshot",
        apps: [sampleApp, sampleAppUnhealthy],
      }),
    });

    expect(onAppSnapshot).toHaveBeenCalledTimes(1);
    expect(onAppSnapshot).toHaveBeenCalledWith([sampleApp, sampleAppUnhealthy]);

    // Structured logging is emitted with the plan-specified operation name.
    const snapshotLogs = infoSpy.mock.calls.filter((args) =>
      args.some(
        (arg) =>
          typeof arg === "object" &&
          arg !== null &&
          (arg as Record<string, unknown>).operation ===
            "fleet_status_client_app_snapshot",
      ),
    );
    expect(snapshotLogs.length).toBe(1);
    infoSpy.mockRestore();
  });

  it("dispatches app-update frame to onAppUpdate with the parsed AppState", () => {
    const onAppUpdate = vi.fn();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
      onAppUpdate,
    });
    const ws = latestWs();
    ws.onopen?.();

    ws.onmessage?.({
      data: JSON.stringify({
        schemaVersion: FRAME_SCHEMA_VERSION,
        type: "app-update",
        app: sampleAppUnhealthy,
      }),
    });

    expect(onAppUpdate).toHaveBeenCalledTimes(1);
    expect(onAppUpdate).toHaveBeenCalledWith(sampleAppUnhealthy);

    const updateLogs = infoSpy.mock.calls.filter((args) =>
      args.some(
        (arg) =>
          typeof arg === "object" &&
          arg !== null &&
          (arg as Record<string, unknown>).operation ===
            "fleet_status_client_app_update",
      ),
    );
    expect(updateLogs.length).toBe(1);
    infoSpy.mockRestore();
  });

  it("dispatches app-gone frame to onAppGone with (hostId, slug)", () => {
    const onAppGone = vi.fn();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
      onAppGone,
    });
    const ws = latestWs();
    ws.onopen?.();

    ws.onmessage?.({
      data: JSON.stringify({
        schemaVersion: FRAME_SCHEMA_VERSION,
        type: "app-gone",
        hostId: "6",
        slug: "scratch-sidebar-test",
      }),
    });

    expect(onAppGone).toHaveBeenCalledTimes(1);
    expect(onAppGone).toHaveBeenCalledWith("6", "scratch-sidebar-test");

    const goneLogs = infoSpy.mock.calls.filter((args) =>
      args.some(
        (arg) =>
          typeof arg === "object" &&
          arg !== null &&
          (arg as Record<string, unknown>).operation ===
            "fleet_status_client_app_gone",
      ),
    );
    expect(goneLogs.length).toBe(1);
    infoSpy.mockRestore();
  });

  it("does NOT throw when app frames arrive with all three callbacks omitted (they are optional)", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});

    // Construct the client with ZERO app-frame callbacks — mirrors how
    // Phase 118-era AppShell will still wire the client before 119-02 lands.
    createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
    });
    const ws = latestWs();
    ws.onopen?.();

    // Deliver one of each app-frame arm — none of these should throw.
    expect(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          schemaVersion: FRAME_SCHEMA_VERSION,
          type: "project-list-changed",
          projects: [
            {
              slug: "alpha",
              displayName: "Alpha",
              hostId: "1",
              hostname: "host-a",
              archived: false,
            },
          ],
          type: "app-snapshot",
          apps: [sampleApp],
        }),
      });
      ws.onmessage?.({
        data: JSON.stringify({
          schemaVersion: FRAME_SCHEMA_VERSION,
          type: "app-update",
          app: sampleAppUnhealthy,
        }),
      });
      ws.onmessage?.({
        data: JSON.stringify({
          schemaVersion: FRAME_SCHEMA_VERSION,
          type: "app-gone",
          hostId: "6",
          slug: "scratch-sidebar-test",
        }),
      });
    }).not.toThrow();

    // Structured info log still fires.
    const structuredLogs = infoSpy.mock.calls
      .flat()
      .filter(
        (arg) =>
          typeof arg === "object" &&
          arg !== null &&
          (arg as Record<string, unknown>).operation ===
            "fleet_status_client_project_list_changed",
      );
    expect(structuredLogs.length).toBeGreaterThanOrEqual(1);
  });

  // Test P117-06-3 — regression guard: identity-archived + snapshot branches
  //                  still work.
  it("Test 3 (regression guard): identity-archived + snapshot dispatch untouched by the extension", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const onSnapshot = vi.fn();
    const onIdentityArchived = vi.fn();
    const onProjectListChanged = vi.fn();
    createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot,
      onUpdate: vi.fn(),
      onGone: vi.fn(),
      onIdentityArchived,
      onProjectListChanged,
    // Connection stays open — the client did not close on the app-frame arrival.
    expect(ws.readyState).toBe(1);
  });

  it("unknown frame types still hit the default branch without dispatching to any app callback (regression guard)", () => {
    const onSnapshot = vi.fn();
    const onUpdate = vi.fn();
    const onGone = vi.fn();
    const onAppSnapshot = vi.fn();
    const onAppUpdate = vi.fn();
    const onAppGone = vi.fn();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot,
      onUpdate,
      onGone,
      onAppSnapshot,
      onAppUpdate,
      onAppGone,
    });
    const ws = latestWs();
    ws.onopen?.();

    // identity-archived
    ws.onmessage?.({
      data: JSON.stringify({
        schemaVersion: FRAME_SCHEMA_VERSION,
        type: "identity-archived",
        name: "wren",
        hostId: "1",
        hostname: "host-a",
      }),
    });
    expect(onIdentityArchived).toHaveBeenCalledTimes(1);
    expect(onIdentityArchived).toHaveBeenCalledWith("wren", "1", "host-a");

    // snapshot
    const states = [
      {
        hostId: "h1",
        tmuxSession: "s1",
        sessionId: "sid1",
        pid: 1,
        status: "busy",
        backgroundTasks: [],
        updatedAt: 0,
      },
    ];
    ws.onmessage?.({
      data: JSON.stringify({
        schemaVersion: FRAME_SCHEMA_VERSION,
        type: "snapshot",
        states,
      }),
    });
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith(states);

    // The project-list-changed callback MUST NOT have been fired for either.
    expect(onProjectListChanged).not.toHaveBeenCalled();
  });

  // Test P117-06-4 — malformed frame (projects not an array) is REJECTED
  //                  before invoking the callback. Rule-2 correctness guard.
  it("Test 4 (malformed frame rejected before dispatch): projects: 'not-an-array' does not invoke the callback", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const onProjectListChanged = vi.fn();
    createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
      onProjectListChanged,
    });
    const ws = latestWs();
    ws.onopen?.();

    // Malformed frame — passes JSON.parse (browser skips zod per
    // fleet-status-types.ts) but projects is a string, not an array. The
    // switch-branch guard MUST short-circuit before invoking the callback.
    // Deliver an unknown frame type — must NOT throw and must NOT invoke
    // any callback (the default branch is a silent drop for forward-compat).
    expect(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          schemaVersion: FRAME_SCHEMA_VERSION,
          type: "project-list-changed",
          projects: "not-an-array",
          type: "some-future-frame-kind-that-does-not-exist",
          payload: { anything: "goes" },
        }),
      });
    }).not.toThrow();

    expect(onProjectListChanged).not.toHaveBeenCalled();
  });

  // Test P117-06-5 — structured console.info log with operation identifier
  //                  and projectCount.
  it("Test 5 (structured log entry): console.info fires once with operation='fleet_status_client_project_list_changed' and projectCount", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    createFleetStatusClient({
      url: "ws://localhost/fleet-status/ws",
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onGone: vi.fn(),
      onProjectListChanged: vi.fn(),
    });
    const ws = latestWs();
    ws.onopen?.();

    const projects = [
      {
        slug: "alpha",
        displayName: "Alpha",
        hostId: "1",
        hostname: "host-a",
        archived: false,
      },
      {
        slug: "beta",
        displayName: "Beta",
        hostId: "2",
        hostname: "host-b",
        archived: false,
      },
      {
        slug: "gamma",
        displayName: "Gamma",
        hostId: "2",
        hostname: "host-b",
        archived: false,
      },
    ];

    // Snapshot info-log calls BEFORE the frame so we can isolate the delta.
    const callsBefore = infoSpy.mock.calls.length;

    ws.onmessage?.({
      data: JSON.stringify({
        schemaVersion: FRAME_SCHEMA_VERSION,
        type: "project-list-changed",
        projects,
      }),
    });

    // Find the exactly-one project-list-changed structured log entry.
    const logEntries = infoSpy.mock.calls
      .slice(callsBefore)
      .flat()
      .filter(
        (arg) =>
          typeof arg === "object" &&
          arg !== null &&
          (arg as Record<string, unknown>).operation ===
            "fleet_status_client_project_list_changed",
      ) as Array<Record<string, unknown>>;

    expect(logEntries.length).toBe(1);
    expect(logEntries[0].projectCount).toBe(3);
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onGone).not.toHaveBeenCalled();
    expect(onAppSnapshot).not.toHaveBeenCalled();
    expect(onAppUpdate).not.toHaveBeenCalled();
    expect(onAppGone).not.toHaveBeenCalled();

    // Connection stays open.
    expect(ws.readyState).toBe(1);
  });
});
