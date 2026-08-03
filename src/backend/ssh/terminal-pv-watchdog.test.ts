/**
 * Backend unit tests for the PV submit post-send idle-watchdog helper
 * (quick 260803-1xw / pinned bounty pv-paste-to-terminal-lands-as-unsent-
 * bracket-paste). Uses vi.useFakeTimers so we can advance the T+2.5s and
 * T+5.0s windows deterministically without real wall-clock waits.
 *
 * Test surface:
 *  T-1  happy path — activity within 2.5s → no retry, no escalate
 *  T-2  retry fires — no activity within 2.5s → retry send-keys called
 *  T-3  retry succeeds — activity arrives after retry → no paste_send_failed
 *  T-4  retry fails-escalate — no activity in either window → WS emit
 *  T-5  cancel-on-destroy — clearing pvSubmitWatchdogs cancels the timers
 *  T-6  non-tmux — missing target/conn → no watchdog armed, no timers
 *  T-7  concurrent-submits — two mqids, only the stagnant one escalates
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import { WebSocket } from "ws";
import { armPvSubmitWatchdog } from "./terminal-pv-watchdog.js";
import {
  sessionManager,
  type TerminalSession,
} from "./terminal-session-manager.js";

// Silence sshLogger noise during the fake-timer flushes. The helper logs a
// lot on every arm/fire; without this, vitest's terminal fills with
// operation=pv_submit_watchdog_* lines that obscure real failures.
vi.mock("../utils/logger.js", () => ({
  sshLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  authLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

interface MockChannel {
  on: Mock;
  stderr: { on: Mock };
  end: Mock;
}

interface MockSubmitConn {
  exec: Mock;
}

interface MockWs {
  readyState: number;
  send: Mock;
}

interface MockSession {
  lastActivityAt: number;
  pvSubmitWatchdogs: Set<NodeJS.Timeout>;
  sshConn: MockSubmitConn | null;
  attachedWs: MockWs | null;
}

function makeMockChannel(): MockChannel {
  const chan: MockChannel = {
    on: vi.fn(),
    stderr: { on: vi.fn() },
    end: vi.fn(),
  };
  // Support chainable `.on().on()...` if a caller relies on it, but the
  // helper does not chain — no need to return `chan` from `.on`.
  return chan;
}

function makeMockSubmitConn(): MockSubmitConn {
  return {
    exec: vi.fn((_cmd: string, cb: (e: unknown, c: MockChannel) => void) => {
      // Fire the callback synchronously with a fresh channel — mirrors ssh2
      // behavior for `exec` on an already-connected client.
      cb(undefined, makeMockChannel());
      return true;
    }),
  };
}

function makeMockWs(): MockWs {
  return {
    readyState: WebSocket.OPEN, // 1
    send: vi.fn(),
  };
}

function makeMockSession(submitConn: MockSubmitConn | null, ws: MockWs | null): MockSession {
  return {
    lastActivityAt: Date.now(),
    pvSubmitWatchdogs: new Set(),
    sshConn: submitConn,
    attachedWs: ws,
  };
}

describe("PV submit watchdog (quick 260803-1xw)", () => {
  const SESSION_ID = "session-under-test";
  const USER_ID = "user-1";
  const TMUX_TARGET = "ashley-tmux";

  let getSessionSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    getSessionSpy = vi.spyOn(sessionManager, "getSession");
  });

  afterEach(() => {
    getSessionSpy.mockRestore();
    vi.useRealTimers();
  });

  it("T-1 happy path: activity within 2.5s → no retry, no paste_send_failed", () => {
    const submitConn = makeMockSubmitConn();
    const ws = makeMockWs();
    const session = makeMockSession(submitConn, ws);
    getSessionSpy.mockReturnValue(session as unknown as TerminalSession);

    const armed = armPvSubmitWatchdog({
      session: session as unknown as TerminalSession,
      submitConn,
      tmuxTarget: TMUX_TARGET,
      mqid: "mqid-t1",
      userId: USER_ID,
      sessionId: SESSION_ID,
    });

    expect(armed).toBe(true);
    expect(session.pvSubmitWatchdogs.size).toBe(1);

    // Simulate activity: bump lastActivityAt past the snapshot.
    session.lastActivityAt = session.lastActivityAt + 1000;

    // Fire the first watchdog.
    vi.advanceTimersByTime(2500);

    // No retry exec, no WS send, no second timer armed.
    expect(submitConn.exec).not.toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled();
    expect(session.pvSubmitWatchdogs.size).toBe(0);
  });

  it("T-2 retry-fires: no activity → retry `tmux send-keys ... Enter` dispatched", () => {
    const submitConn = makeMockSubmitConn();
    const ws = makeMockWs();
    const session = makeMockSession(submitConn, ws);
    getSessionSpy.mockReturnValue(session as unknown as TerminalSession);

    armPvSubmitWatchdog({
      session: session as unknown as TerminalSession,
      submitConn,
      tmuxTarget: TMUX_TARGET,
      mqid: "mqid-t2",
      userId: USER_ID,
      sessionId: SESSION_ID,
    });

    // DO NOT bump lastActivityAt.
    vi.advanceTimersByTime(2500);

    expect(submitConn.exec).toHaveBeenCalledTimes(1);
    expect(submitConn.exec).toHaveBeenCalledWith(
      `tmux send-keys -t '${TMUX_TARGET}' Enter`,
      expect.any(Function),
    );
    // Second watchdog should now be armed.
    expect(session.pvSubmitWatchdogs.size).toBe(1);
    // No escalation yet.
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("T-3 retry-succeeds: activity after retry → no paste_send_failed WS emit", () => {
    const submitConn = makeMockSubmitConn();
    const ws = makeMockWs();
    const session = makeMockSession(submitConn, ws);
    getSessionSpy.mockReturnValue(session as unknown as TerminalSession);

    armPvSubmitWatchdog({
      session: session as unknown as TerminalSession,
      submitConn,
      tmuxTarget: TMUX_TARGET,
      mqid: "mqid-t3",
      userId: USER_ID,
      sessionId: SESSION_ID,
    });

    // T+2.5s: no activity → retry fires.
    vi.advanceTimersByTime(2500);
    expect(submitConn.exec).toHaveBeenCalledTimes(1);

    // Simulate the retry Enter actually landing this time: bump activity.
    session.lastActivityAt = session.lastActivityAt + 5000;

    // T+5.0s (2.5s after retry): second watchdog fires.
    vi.advanceTimersByTime(2500);

    // No paste_send_failed emitted; second watchdog cleared itself.
    expect(ws.send).not.toHaveBeenCalled();
    expect(session.pvSubmitWatchdogs.size).toBe(0);
  });

  it("T-4 retry-fails-escalate: no activity in either window → paste_send_failed WS emit", () => {
    const submitConn = makeMockSubmitConn();
    const ws = makeMockWs();
    const session = makeMockSession(submitConn, ws);
    getSessionSpy.mockReturnValue(session as unknown as TerminalSession);

    armPvSubmitWatchdog({
      session: session as unknown as TerminalSession,
      submitConn,
      tmuxTarget: TMUX_TARGET,
      mqid: "mqid-t4",
      userId: USER_ID,
      sessionId: SESSION_ID,
    });

    // T+2.5s: retry fires.
    vi.advanceTimersByTime(2500);
    expect(submitConn.exec).toHaveBeenCalledTimes(1);

    // Keep lastActivityAt static.
    // T+5.0s: escalation.
    vi.advanceTimersByTime(2500);

    expect(ws.send).toHaveBeenCalledTimes(1);
    const emitted = JSON.parse(ws.send.mock.calls[0][0] as string);
    expect(emitted).toEqual({
      type: "paste_send_failed",
      mqid: "mqid-t4",
      reason: "no_activity_after_2_retries",
    });
    expect(session.pvSubmitWatchdogs.size).toBe(0);
  });

  it("T-5 cancel-on-destroy: clearing pvSubmitWatchdogs cancels the timers (no exec, no send)", () => {
    const submitConn = makeMockSubmitConn();
    const ws = makeMockWs();
    const session = makeMockSession(submitConn, ws);
    getSessionSpy.mockReturnValue(session as unknown as TerminalSession);

    armPvSubmitWatchdog({
      session: session as unknown as TerminalSession,
      submitConn,
      tmuxTarget: TMUX_TARGET,
      mqid: "mqid-t5",
      userId: USER_ID,
      sessionId: SESSION_ID,
    });
    expect(session.pvSubmitWatchdogs.size).toBe(1);

    // Simulate destroySession's cleanup step: cancel + clear.
    for (const handle of session.pvSubmitWatchdogs) {
      clearTimeout(handle);
    }
    session.pvSubmitWatchdogs.clear();

    // Also simulate the getSession race: destroySession would remove it.
    getSessionSpy.mockReturnValue(null);

    // Advance well past both windows.
    vi.advanceTimersByTime(5000);

    expect(submitConn.exec).not.toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("T-6 non-tmux-no-watchdog: missing tmuxTarget or submitConn → no arm, no timers", () => {
    // No submitConn.
    const wsA = makeMockWs();
    const sessionA = makeMockSession(null, wsA);
    getSessionSpy.mockReturnValue(sessionA as unknown as TerminalSession);
    const armedA = armPvSubmitWatchdog({
      session: sessionA as unknown as TerminalSession,
      submitConn: null,
      tmuxTarget: TMUX_TARGET,
      mqid: "mqid-t6-a",
      userId: USER_ID,
      sessionId: SESSION_ID,
    });
    expect(armedA).toBe(false);
    expect(sessionA.pvSubmitWatchdogs.size).toBe(0);

    // No tmuxTarget.
    const submitConnB = makeMockSubmitConn();
    const wsB = makeMockWs();
    const sessionB = makeMockSession(submitConnB, wsB);
    const armedB = armPvSubmitWatchdog({
      session: sessionB as unknown as TerminalSession,
      submitConn: submitConnB,
      tmuxTarget: null,
      mqid: "mqid-t6-b",
      userId: USER_ID,
      sessionId: SESSION_ID,
    });
    expect(armedB).toBe(false);
    expect(sessionB.pvSubmitWatchdogs.size).toBe(0);

    // No timers should have been scheduled by either call.
    vi.advanceTimersByTime(10_000);
    expect(submitConnB.exec).not.toHaveBeenCalled();
    expect(wsA.send).not.toHaveBeenCalled();
    expect(wsB.send).not.toHaveBeenCalled();
  });

  it("T-7 concurrent-submits: two mqids, only the stagnant snapshot escalates", () => {
    const submitConn = makeMockSubmitConn();
    const ws = makeMockWs();
    const session = makeMockSession(submitConn, ws);
    getSessionSpy.mockReturnValue(session as unknown as TerminalSession);

    // First submit — arm.
    armPvSubmitWatchdog({
      session: session as unknown as TerminalSession,
      submitConn,
      tmuxTarget: TMUX_TARGET,
      mqid: "mqid-first",
      userId: USER_ID,
      sessionId: SESSION_ID,
    });

    // Bump lastActivityAt so the FIRST submit's snapshot has been surpassed
    // before the second submit is armed. This means:
    //   - First watchdog will see s.lastActivityAt > lastActivityAtAtSend[first]
    //     → happy path, no retry.
    //   - Second watchdog captures the NEW lastActivityAt as its snapshot.
    session.lastActivityAt = session.lastActivityAt + 500;

    // Second submit — arm.
    armPvSubmitWatchdog({
      session: session as unknown as TerminalSession,
      submitConn,
      tmuxTarget: TMUX_TARGET,
      mqid: "mqid-second",
      userId: USER_ID,
      sessionId: SESSION_ID,
    });

    // Two watchdogs armed.
    expect(session.pvSubmitWatchdogs.size).toBe(2);

    // T+2.5s: both first-watchdogs fire. First sees activity, second does not.
    vi.advanceTimersByTime(2500);

    // Exactly ONE retry fired — for the second mqid.
    expect(submitConn.exec).toHaveBeenCalledTimes(1);

    // Second watchdog for the escalating submit is now armed.
    expect(session.pvSubmitWatchdogs.size).toBe(1);

    // Keep lastActivityAt static — the second's retry snapshot never advances.
    // T+5.0s: escalation for second mqid.
    vi.advanceTimersByTime(2500);

    expect(ws.send).toHaveBeenCalledTimes(1);
    const emitted = JSON.parse(ws.send.mock.calls[0][0] as string);
    expect(emitted).toEqual({
      type: "paste_send_failed",
      mqid: "mqid-second",
      reason: "no_activity_after_2_retries",
    });
  });
});
