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
  __classifyAttachInactiveForTests,
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
    holdingReason: null,
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

// ── Case (b') — same-file-active during holding armed by id_reset ───────────
// Regression: patch #358 (follow-up to #356). When Layer 1 armed the overlay
// via /id reset, the 3-second same-file-active repoll tick MUST NOT clear the
// overlay — Claude is still running its /id save flow, discovery correctly
// reports the OLD session file as active, and the real recycle is coming. The
// clear must be deferred to transitionToActiveNew when the NEW UUID appears.

describe("discovery repoll branch — case (b'): active + same file + state=holding + reason=id_reset → NO clear", () => {
  it("real helper with holdingReason='id_reset' guard is a no-op; state stays holding; WS receives nothing", () => {
    const wsSend = vi.fn();
    const mockWs = { readyState: 1, send: wsSend }; // WebSocket.OPEN
    const state = makeState({
      changeoverState: "holding",
      currentSessionFile: SESSION_FILE,
      holdingTicks: 1,
      holdingReason: "id_reset", // Layer 1 armed via real /id reset
    });

    // Inline the real helper WITH the patch-#358 guard (mirrors
    // transitionFromHoldingToActiveSameFile in claude-session-server.ts).
    const transitionFromHoldingToActiveSameFile = vi.fn(() => {
      if (state.changeoverState !== "holding") return;
      if (state.holdingReason === "id_reset") return; // ← patch #358 guard
      state.changeoverState = "active";
      state.holdingReason = null;
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

    // Reducer still dispatches (it doesn't know about the reason):
    expect(transitionFromHoldingToActiveSameFile).toHaveBeenCalledOnce();
    // But the helper's guard means the OVERLAY state is UNCHANGED (still holding, still id_reset):
    expect(state.changeoverState).toBe("holding");
    expect(state.holdingReason).toBe("id_reset");
    // holdingTicks DOES bump — that's the reducer's timeout bookkeeping,
    // orthogonal to the clear-path guard. If the /id reset gets stuck and
    // the new session file never appears, HOLDING_TIMEOUT_TICKS still fires
    // transitionToDead as the safety valve. Initial 1 + this tick = 2.
    expect(state.holdingTicks).toBe(2);
    // And NO WS frame was sent — nothing clears the overlay client-side:
    expect(wsSend).not.toHaveBeenCalled();
  });

  it("holdingReason='discovery_diff' still clears normally (patch #244 behavior preserved)", () => {
    const wsSend = vi.fn();
    const mockWs = { readyState: 1, send: wsSend };
    const state = makeState({
      changeoverState: "holding",
      currentSessionFile: SESSION_FILE,
      holdingTicks: 2,
      holdingReason: "discovery_diff", // Layer 2 false-alarm arm
    });

    const transitionFromHoldingToActiveSameFile = vi.fn(() => {
      if (state.changeoverState !== "holding") return;
      if (state.holdingReason === "id_reset") return;
      state.changeoverState = "active";
      state.holdingReason = null;
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

    // False-alarm self-clear MUST still fire (Fix B / patch #244 preserved):
    expect(transitionFromHoldingToActiveSameFile).toHaveBeenCalledOnce();
    expect(state.changeoverState).toBe("active");
    expect(state.holdingReason).toBeNull();
    expect(state.holdingTicks).toBe(0);
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

// ── quick 260813-0qx — attach-path reset-window coverage ────────────────────
//
// Groups A/B/C exercise the new attach-path reset-window branch
// (claude-session-server.ts ~L5155-onward) that fixes the deactivate →
// /id reset window → reactivate → "no active Claude session" latch. See
// .planning/quick/260813-0qx-deactivate-reactivate-during-reset-latch/
// 260813-0qx-PLAN.md for the diagnosis + spec.
//
// Group A drives the pure classifier __classifyAttachInactiveForTests
// (12-case truth table over the 5 discovery reasons × 3 identity-shape
// cache states, plus a defensive active case).
//
// Group B proves the post-holding handoff into the existing repoll
// reducer works: after the attach branch seeds
// {changeoverState:"holding", holdingReason:"discovery_diff",
// holdingTicks:0, currentSessionFile:null}, subsequent ticks flowing
// through __applyRepollResultForTests recover correctly (active-with-new-
// file → transitionToActiveNew; N ticks of no_pid_session_file →
// transitionToDead at HOLDING_TIMEOUT_TICKS; exec_error ticks don't burn
// budget).
//
// Group C is a mixed-sequence integration smoke test — proves the whole
// handoff-to-recovery cycle end-to-end.

// ── Group A: __classifyAttachInactiveForTests truth table ───────────────────

describe("attach-path reset-window classifier — Group A truth table (quick 260813-0qx)", () => {
  // Helper factories for the two shapes the classifier consumes.
  const inactive = (
    reason:
      | "no_tmux_session"
      | "not_claude"
      | "pid_unavailable"
      | "no_pid_session_file"
      | "no_open_session_file"
      | "exec_error",
  ) => ({ status: "inactive" as const, reason });
  const active = () => ({
    status: "active" as const,
    pid: 100,
    sessionFile: SESSION_FILE,
  });

  // no_pid_session_file → always reset_window (identity-shape irrelevant).
  it("no_pid_session_file + isIdentityShapedCached:null → reset_window", () => {
    expect(__classifyAttachInactiveForTests(inactive("no_pid_session_file"), null)).toBe("reset_window");
  });
  it("no_pid_session_file + isIdentityShapedCached:false → reset_window", () => {
    expect(__classifyAttachInactiveForTests(inactive("no_pid_session_file"), false)).toBe("reset_window");
  });
  it("no_pid_session_file + isIdentityShapedCached:true → reset_window", () => {
    expect(__classifyAttachInactiveForTests(inactive("no_pid_session_file"), true)).toBe("reset_window");
  });

  // no_open_session_file → always reset_window (identity-shape irrelevant).
  it("no_open_session_file + isIdentityShapedCached:null → reset_window", () => {
    expect(__classifyAttachInactiveForTests(inactive("no_open_session_file"), null)).toBe("reset_window");
  });
  it("no_open_session_file + isIdentityShapedCached:false → reset_window", () => {
    expect(__classifyAttachInactiveForTests(inactive("no_open_session_file"), false)).toBe("reset_window");
  });
  it("no_open_session_file + isIdentityShapedCached:true → reset_window", () => {
    expect(__classifyAttachInactiveForTests(inactive("no_open_session_file"), true)).toBe("reset_window");
  });

  // not_claude — identity-shape gates the verdict.
  it("not_claude + isIdentityShapedCached:true → reset_window (identity pane mid-reset)", () => {
    expect(__classifyAttachInactiveForTests(inactive("not_claude"), true)).toBe("reset_window");
  });
  it("not_claude + isIdentityShapedCached:false → fallback_01 (bare shell — terminal)", () => {
    expect(__classifyAttachInactiveForTests(inactive("not_claude"), false)).toBe("fallback_01");
  });
  it("not_claude + isIdentityShapedCached:null → fallback_01 (probe never ran / failed — conservative)", () => {
    // Locks in the T-260813-0qx-04 mitigation from the plan's threat model:
    // if the dormant-probe SSH-throw catch (~L5150-5152) sets
    // isIdentityShapedCached = false, we DO NOT want a stray null path to
    // slip a permanently-terminal not_claude into the 10min hold.
    expect(__classifyAttachInactiveForTests(inactive("not_claude"), null)).toBe("fallback_01");
  });

  // no_tmux_session → always fallback_01 (no pane to poll).
  it("no_tmux_session + isIdentityShapedCached:null → fallback_01", () => {
    expect(__classifyAttachInactiveForTests(inactive("no_tmux_session"), null)).toBe("fallback_01");
  });
  it("no_tmux_session + isIdentityShapedCached:false → fallback_01", () => {
    expect(__classifyAttachInactiveForTests(inactive("no_tmux_session"), false)).toBe("fallback_01");
  });
  it("no_tmux_session + isIdentityShapedCached:true → fallback_01", () => {
    expect(__classifyAttachInactiveForTests(inactive("no_tmux_session"), true)).toBe("fallback_01");
  });

  // exec_error → always fallback_01 (SSH-side failure, attach-time can't
  // distinguish transient from persistent).
  it("exec_error + isIdentityShapedCached:null → fallback_01", () => {
    expect(__classifyAttachInactiveForTests(inactive("exec_error"), null)).toBe("fallback_01");
  });
  it("exec_error + isIdentityShapedCached:false → fallback_01", () => {
    expect(__classifyAttachInactiveForTests(inactive("exec_error"), false)).toBe("fallback_01");
  });
  it("exec_error + isIdentityShapedCached:true → fallback_01", () => {
    expect(__classifyAttachInactiveForTests(inactive("exec_error"), true)).toBe("fallback_01");
  });

  // Defensive: attach path only calls this on inactive, but the classifier
  // must handle a stray active input safely (map to fallback_01, don't throw).
  it("status:'active' (defensive) → fallback_01", () => {
    expect(__classifyAttachInactiveForTests(active(), true)).toBe("fallback_01");
    expect(__classifyAttachInactiveForTests(active(), false)).toBe("fallback_01");
    expect(__classifyAttachInactiveForTests(active(), null)).toBe("fallback_01");
  });
});

// ── Group B: post-holding repoll behavior via __applyRepollResultForTests ───

// HOLDING_TIMEOUT_TICKS is not re-exported from claude-session-server.ts —
// the plan explicitly says "don't modify HOLDING_TIMEOUT_TICKS at L187",
// so tests reference it via a local const with a comment tying it to the
// production constant. Keep in sync.
const TIMEOUT = 200; // ← MUST equal HOLDING_TIMEOUT_TICKS in claude-session-server.ts:187

describe("attach-path reset-window handoff — Group B post-holding recovery/timeout (quick 260813-0qx)", () => {
  // Case B1: recovery — new session file appears after attach-branch seeded
  // holding with currentSessionFile:null.
  it("B1: active tick with new sessionFile → transitionToActiveNew fires; no other helpers called", () => {
    const state = makeState({
      changeoverState: "holding",
      currentSessionFile: null,
      holdingTicks: 0,
      holdingReason: "discovery_diff",
    });
    const {
      stubs,
      transitionToHolding,
      transitionToActiveNew,
      transitionFromHoldingToActiveSameFile,
      transitionToDead,
    } = makeHelpers();

    __applyRepollResultForTests(
      { status: "active", pid: 100, sessionFile: "/some/new.jsonl" },
      state,
      stubs,
    );

    // sessionFile ("/some/new.jsonl") !== currentSessionFile (null) — this
    // is the sessionFile-changed branch. But state was already "holding"
    // (not "active"), so transitionToHolding does NOT fire (its guard is
    // `changeoverState === "active"`). Only transitionToActiveNew fires.
    expect(transitionToActiveNew).toHaveBeenCalledOnce();
    expect(transitionToActiveNew).toHaveBeenCalledWith("/some/new.jsonl");
    expect(transitionToHolding).not.toHaveBeenCalled();
    expect(transitionFromHoldingToActiveSameFile).not.toHaveBeenCalled();
    expect(transitionToDead).not.toHaveBeenCalled();
  });

  // Case B2: timeout — 200 consecutive no_pid_session_file ticks trip
  // transitionToDead("holding_timeout"). Proves HOLDING_TIMEOUT_TICKS
  // budget is intact through the attach-path handoff.
  it("B2: N=199 no_pid_session_file ticks holds; 200th trips transitionToDead('holding_timeout')", () => {
    const state = makeState({
      changeoverState: "holding",
      currentSessionFile: null,
      holdingTicks: 0,
      holdingReason: "discovery_diff",
    });
    const { stubs, transitionToDead } = makeHelpers();

    // Fire 199 no_pid_session_file ticks. changeoverState stays "holding"
    // throughout (transitionToHolding's stub is a no-op vi.fn — real helper
    // would flip state, but state is already "holding" so its guard would
    // short-circuit anyway; this seam faithfully preserves that behavior
    // because the reducer's `if (changeoverState === "active")` gate
    // prevents transitionToHolding from being called when state is
    // "holding").
    for (let i = 0; i < TIMEOUT - 1; i++) {
      __applyRepollResultForTests(
        { status: "inactive", reason: "no_pid_session_file" },
        state,
        stubs,
      );
    }
    expect(state.holdingTicks).toBe(TIMEOUT - 1); // 199
    expect(transitionToDead).not.toHaveBeenCalled();

    // 200th tick — trips the timeout.
    __applyRepollResultForTests(
      { status: "inactive", reason: "no_pid_session_file" },
      state,
      stubs,
    );
    expect(state.holdingTicks).toBe(TIMEOUT); // 200
    expect(transitionToDead).toHaveBeenCalledOnce();
    expect(transitionToDead).toHaveBeenCalledWith("holding_timeout");
  });

  // Case B3: exec_error ticks do NOT burn the holding budget (Fix A guard
  // preserved through the attach-path handoff).
  it("B3: exec_error tick from attach-seeded holding → transitionToDead NOT called; holdingTicks unchanged", () => {
    const state = makeState({
      changeoverState: "holding",
      currentSessionFile: null,
      holdingTicks: 0,
      holdingReason: "discovery_diff",
    });
    const {
      stubs,
      transitionToHolding,
      transitionToActiveNew,
      transitionFromHoldingToActiveSameFile,
      transitionToDead,
    } = makeHelpers();

    __applyRepollResultForTests(
      { status: "inactive", reason: "exec_error" },
      state,
      stubs,
    );

    // Fix A guard: exec_error → NO holdingTicks++, NO transitions.
    expect(state.holdingTicks).toBe(0);
    expect(transitionToDead).not.toHaveBeenCalled();
    expect(transitionToHolding).not.toHaveBeenCalled();
    expect(transitionToActiveNew).not.toHaveBeenCalled();
    expect(transitionFromHoldingToActiveSameFile).not.toHaveBeenCalled();
  });

  // Case B4: defensive — active-with-new-file after some prior ticks still
  // dispatches transitionToActiveNew regardless of tick count.
  it("B4: active tick with new sessionFile after 5 prior ticks → transitionToActiveNew fires", () => {
    const state = makeState({
      changeoverState: "holding",
      currentSessionFile: null,
      holdingTicks: 5,
      holdingReason: "discovery_diff",
    });
    const { stubs, transitionToActiveNew } = makeHelpers();

    __applyRepollResultForTests(
      { status: "active", pid: 100, sessionFile: "/x.jsonl" },
      state,
      stubs,
    );

    expect(transitionToActiveNew).toHaveBeenCalledOnce();
    expect(transitionToActiveNew).toHaveBeenCalledWith("/x.jsonl");
    // holdingTicks value at time of dispatch isn't asserted — bookkeeping
    // downstream (transitionToActiveNew's real body resets holdingTicks to 0
    // in production; the stub doesn't touch it, and that's fine — we're
    // testing the reducer's dispatch, not the helper's internal reset).
  });
});

// ── Group C: mixed-sequence integration smoke test ──────────────────────────

describe("attach-path reset-window handoff — Group C integration smoke test (quick 260813-0qx)", () => {
  it("no_pid×2 → exec_error×3 → active recovery: budget preserved, recovery fires", () => {
    const state = makeState({
      changeoverState: "holding",
      currentSessionFile: null,
      holdingTicks: 0,
      holdingReason: "discovery_diff",
    });
    const { stubs, transitionToActiveNew } = makeHelpers();
    // Wire transitionToActiveNew to also mutate state (so if the test grew
    // a 4th tick, downstream branches would read the right state — the real
    // helper mutates changeoverState and currentSessionFile). Defensive:
    // the 3-step test doesn't fire a 4th, but this keeps the test robust
    // to expansion.
    stubs.transitionToActiveNew = vi.fn((sf: string) => {
      state.changeoverState = "active";
      state.currentSessionFile = sf;
      state.holdingTicks = 0;
    });

    // Step 1: two no_pid_session_file ticks — budget increments to 2.
    for (let i = 0; i < 2; i++) {
      __applyRepollResultForTests(
        { status: "inactive", reason: "no_pid_session_file" },
        state,
        stubs,
      );
    }
    expect(state.holdingTicks).toBe(2);
    expect(state.changeoverState).toBe("holding");

    // Step 2: three exec_error ticks — budget STILL 2 (transient failures
    // don't burn the timeout; Fix A guard preserved).
    for (let i = 0; i < 3; i++) {
      __applyRepollResultForTests(
        { status: "inactive", reason: "exec_error" },
        state,
        stubs,
      );
    }
    expect(state.holdingTicks).toBe(2);
    expect(state.changeoverState).toBe("holding");
    expect(stubs.transitionToActiveNew).not.toHaveBeenCalled();

    // Step 3: active tick with a new file — recovery fires.
    __applyRepollResultForTests(
      { status: "active", pid: 100, sessionFile: "/recovered.jsonl" },
      state,
      stubs,
    );
    expect(stubs.transitionToActiveNew).toHaveBeenCalledOnce();
    expect((stubs.transitionToActiveNew as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "/recovered.jsonl",
    );
    expect(state.changeoverState).toBe("active");
    expect(state.currentSessionFile).toBe("/recovered.jsonl");
    expect(state.holdingTicks).toBe(0);
  });
});
