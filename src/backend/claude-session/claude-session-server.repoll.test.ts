/**
 * Discovery-repoll branch coverage — Fix A + Fix B (quick 260730-sjf).
 *
 * Tests the five branch cases using the __applyRepollResultForTests seam
 * (a module-scope function that mirrors the discoveryRepollTimer .then() body
 * with injectable state + helpers). This avoids spinning up a WebSocketServer
 * + ssh2 pair, which would require 7+ dependency mocks to reach the
 * connectToPane path.
 *
 * Test seam architecture: see the __applyRepollResultForTests JSDoc in
 * claude-session-server.ts for the rationale. State and helpers are
 * injected as plain objects; tests observe mutations on the state box and
 * call counts / args on the helper stubs.
 *
 * Five cases (a-e) matching the plan's spec:
 *   (a) active + same sessionFile + changeoverState=active → no WS send, steady-state
 *   (b) active + same sessionFile + changeoverState=holding → transitionFromHoldingToActiveSameFile fires
 *   (c) inactive + reason=exec_error + changeoverState=active → NO transitionToHolding (silent tick)
 *   (d) inactive + reason=exec_error + changeoverState=holding → NO holdingTicks++ (budget not burned)
 *   (e) inactive + reason=not_claude + changeoverState=active → transitionToHolding fires (regression guard)
 */

import { describe, it, expect, vi } from "vitest";
import {
  __applyRepollResultForTests,
  type __RepollStateForTests,
  type __RepollHelpersForTests,
} from "./claude-session-server.js";

// ── Helper factories ────────────────────────────────────────────────────────

/** Create a fresh mutable state box for each test. */
function makeState(
  overrides: Partial<__RepollStateForTests> = {},
): __RepollStateForTests {
  return {
    changeoverState: "active",
    currentSessionFile: "/home/ubuntu/.claude/projects/-home-ubuntu-proj/abc123.jsonl",
    holdingTicks: 0,
    ...overrides,
  };
}

/** Create fresh stub helpers for each test. */
function makeHelpers(): {
  stubs: __RepollHelpersForTests;
  transitionToHolding: ReturnType<typeof vi.fn>;
  transitionToActiveNew: ReturnType<typeof vi.fn>;
  transitionFromHoldingToActiveSameFile: ReturnType<typeof vi.fn>;
  transitionToDead: ReturnType<typeof vi.fn>;
} {
  // Use vi.fn() stubs. transitionToHolding and
  // transitionFromHoldingToActiveSameFile mutate changeoverState in the real
  // code — tests that need to observe downstream effects (e.g. holdingTicks
  // guard) must set state.changeoverState explicitly after calling the stub,
  // OR use a stub that also mutates state (see case (e) below).
  const transitionToHolding = vi.fn();
  const transitionToActiveNew = vi.fn();
  const transitionFromHoldingToActiveSameFile = vi.fn();
  const transitionToDead = vi.fn();
  return {
    stubs: {
      transitionToHolding,
      transitionToActiveNew,
      transitionFromHoldingToActiveSameFile,
      transitionToDead,
    },
    transitionToHolding,
    transitionToActiveNew,
    transitionFromHoldingToActiveSameFile,
    transitionToDead,
  };
}

const SESSION_FILE = "/home/ubuntu/.claude/projects/-home-ubuntu-proj/abc123.jsonl";

// ── Case (a): active + same sessionFile + changeoverState=active ────────────

describe("discovery repoll branch — case (a): active + same file + state=active", () => {
  it("no transition helpers are called; changeoverState stays active; holdingTicks stays 0", () => {
    const state = makeState({ changeoverState: "active", currentSessionFile: SESSION_FILE });
    const { stubs, transitionToHolding, transitionToActiveNew,
      transitionFromHoldingToActiveSameFile, transitionToDead } = makeHelpers();

    __applyRepollResultForTests(
      { status: "active", pid: 100, sessionFile: SESSION_FILE },
      state,
      stubs,
    );

    expect(transitionToHolding).not.toHaveBeenCalled();
    expect(transitionToActiveNew).not.toHaveBeenCalled();
    expect(transitionFromHoldingToActiveSameFile).not.toHaveBeenCalled();
    expect(transitionToDead).not.toHaveBeenCalled();
    expect(state.changeoverState).toBe("active");
    expect(state.holdingTicks).toBe(0);
  });
});

// ── Case (b): active + same sessionFile + changeoverState=holding ───────────

describe("discovery repoll branch — case (b): active + same file + state=holding → self-clear", () => {
  it("transitionFromHoldingToActiveSameFile is called; changeoverState not mutated by seam (helper owns it)", () => {
    const state = makeState({ changeoverState: "holding", currentSessionFile: SESSION_FILE, holdingTicks: 3 });
    const { stubs, transitionToHolding, transitionToActiveNew,
      transitionFromHoldingToActiveSameFile, transitionToDead } = makeHelpers();

    // The real helper would flip changeoverState to "active" and reset holdingTicks.
    // The stub is a vi.fn() that doesn't mutate state — we only need to assert
    // that the helper was called (the helper's own unit is: it emits the WS frame
    // and flips changeoverState, which the transition helper's own test would cover).
    __applyRepollResultForTests(
      { status: "active", pid: 100, sessionFile: SESSION_FILE },
      state,
      stubs,
    );

    expect(transitionFromHoldingToActiveSameFile).toHaveBeenCalledOnce();
    expect(transitionToHolding).not.toHaveBeenCalled();
    expect(transitionToActiveNew).not.toHaveBeenCalled();
    expect(transitionToDead).not.toHaveBeenCalled();
  });

  it("WS receives { type: 'session_holding_cleared' } when real helper is wired (integration shape)", () => {
    // This test drives the real transitionFromHoldingToActiveSameFile shape
    // via an inline implementation that captures WS sends. Validates the
    // end-to-end contract: WS must receive session_holding_cleared,
    // changeoverState must flip to active, holdingTicks must reset to 0.
    const wsSend = vi.fn();
    const mockWs = { readyState: 1, send: wsSend }; // readyState=1 = WebSocket.OPEN
    const state = makeState({ changeoverState: "holding", currentSessionFile: SESSION_FILE, holdingTicks: 5 });

    // Inline the real helper logic (mirrors transitionFromHoldingToActiveSameFile in server.ts):
    const transitionFromHoldingToActiveSameFile = vi.fn(() => {
      if (state.changeoverState !== "holding") return;
      state.changeoverState = "active";
      state.holdingTicks = 0;
      if (mockWs.readyState === 1) {
        try { mockWs.send(JSON.stringify({ type: "session_holding_cleared" })); } catch { /* ignore */ }
      }
    });

    const { stubs } = makeHelpers();
    stubs.transitionFromHoldingToActiveSameFile = transitionFromHoldingToActiveSameFile;

    __applyRepollResultForTests(
      { status: "active", pid: 100, sessionFile: SESSION_FILE },
      state,
      stubs,
    );

    // Helper was called:
    expect(transitionFromHoldingToActiveSameFile).toHaveBeenCalledOnce();
    // Helper mutated state correctly:
    expect(state.changeoverState).toBe("active");
    expect(state.holdingTicks).toBe(0);
    // WS received the correct frame:
    expect(wsSend).toHaveBeenCalledOnce();
    expect(JSON.parse(wsSend.mock.calls[0][0] as string)).toEqual({ type: "session_holding_cleared" });
  });
});

// ── Case (c): inactive + exec_error + changeoverState=active ────────────────

describe("discovery repoll branch — case (c): inactive/exec_error + state=active → silent tick", () => {
  it("NO transitionToHolding called; changeoverState stays active; NO holdingTicks++ (stays 0)", () => {
    const state = makeState({ changeoverState: "active", holdingTicks: 0 });
    const { stubs, transitionToHolding, transitionToActiveNew,
      transitionFromHoldingToActiveSameFile, transitionToDead } = makeHelpers();

    __applyRepollResultForTests(
      { status: "inactive", reason: "exec_error" },
      state,
      stubs,
    );

    // Must NOT arm the overlay on a transient SSH failure (Fix A):
    expect(transitionToHolding).not.toHaveBeenCalled();
    expect(transitionToActiveNew).not.toHaveBeenCalled();
    expect(transitionFromHoldingToActiveSameFile).not.toHaveBeenCalled();
    expect(transitionToDead).not.toHaveBeenCalled();
    expect(state.changeoverState).toBe("active");
    // holdingTicks must NOT increment (state was "active", so the
    // holdingTicks++ block is gated on changeoverState==="holding" anyway —
    // but the !isExecErrorTick guard is the belt-and-suspenders check):
    expect(state.holdingTicks).toBe(0);
  });
});

// ── Case (d): inactive + exec_error + changeoverState=holding ────────────────

describe("discovery repoll branch — case (d): inactive/exec_error + state=holding → NO holdingTicks++", () => {
  it("holdingTicks does NOT increment on exec_error tick (budget preserved)", () => {
    const state = makeState({ changeoverState: "holding", holdingTicks: 3 });
    const { stubs, transitionToHolding, transitionToActiveNew,
      transitionFromHoldingToActiveSameFile, transitionToDead } = makeHelpers();

    __applyRepollResultForTests(
      { status: "inactive", reason: "exec_error" },
      state,
      stubs,
    );

    // The !isExecErrorTick guard on the holdingTicks++ block must skip the
    // increment. holdingTicks stays at 3 (unchanged from initial value):
    expect(state.holdingTicks).toBe(3);
    // No timeout/dead transition either:
    expect(transitionToDead).not.toHaveBeenCalled();
    // No overlay changes:
    expect(transitionToHolding).not.toHaveBeenCalled();
    expect(transitionToActiveNew).not.toHaveBeenCalled();
    expect(transitionFromHoldingToActiveSameFile).not.toHaveBeenCalled();
  });

  it("multiple exec_error ticks in holding do NOT accumulate ticks", () => {
    const state = makeState({ changeoverState: "holding", holdingTicks: 7 });
    const { stubs } = makeHelpers();

    // Fire three consecutive exec_error ticks:
    for (let i = 0; i < 3; i++) {
      __applyRepollResultForTests(
        { status: "inactive", reason: "exec_error" },
        state,
        stubs,
      );
    }

    // holdingTicks must still be 7 (unchanged):
    expect(state.holdingTicks).toBe(7);
  });
});

// ── Case (e): inactive + not_claude + changeoverState=active ─────────────────

describe("discovery repoll branch — case (e): inactive/not_claude + state=active → transitionToHolding fires (regression guard)", () => {
  it("transitionToHolding is called with 'discovery_diff' for real inactive reasons", () => {
    const state = makeState({ changeoverState: "active", holdingTicks: 0 });
    const { stubs, transitionToHolding, transitionToActiveNew,
      transitionFromHoldingToActiveSameFile, transitionToDead } = makeHelpers();

    __applyRepollResultForTests(
      { status: "inactive", reason: "not_claude" },
      state,
      stubs,
    );

    expect(transitionToHolding).toHaveBeenCalledOnce();
    expect(transitionToHolding).toHaveBeenCalledWith("discovery_diff");
    expect(transitionToActiveNew).not.toHaveBeenCalled();
    expect(transitionFromHoldingToActiveSameFile).not.toHaveBeenCalled();
    expect(transitionToDead).not.toHaveBeenCalled();
  });

  it("no_tmux_session also arms holding (another real-inactive reason)", () => {
    const state = makeState({ changeoverState: "active" });
    const { stubs, transitionToHolding } = makeHelpers();

    __applyRepollResultForTests(
      { status: "inactive", reason: "no_tmux_session" },
      state,
      stubs,
    );

    expect(transitionToHolding).toHaveBeenCalledOnce();
    expect(transitionToHolding).toHaveBeenCalledWith("discovery_diff");
  });

  it("holdingTicks++ fires on next real-inactive tick (after transition sets state to holding)", () => {
    // Simulate: transitionToHolding also mutates state (the real helper does).
    // Wire a stub that sets changeoverState to "holding" so the
    // holdingTicks++ block fires on the same tick (as happens in production
    // when the real transition helper mutates the closure state).
    const state = makeState({ changeoverState: "active", holdingTicks: 0 });
    const { stubs } = makeHelpers();
    stubs.transitionToHolding = vi.fn(() => {
      state.changeoverState = "holding";
      state.holdingTicks = 0;
    });

    __applyRepollResultForTests(
      { status: "inactive", reason: "not_claude" },
      state,
      stubs,
    );

    // After transitionToHolding flipped state to "holding", the holdingTicks++
    // block should have fired (reason is not exec_error):
    expect(state.holdingTicks).toBe(1);
  });
});
