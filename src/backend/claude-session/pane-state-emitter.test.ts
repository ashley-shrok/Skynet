// Unit tests for the pane-state emitter (Phase 30 Plan 30-01).
//
// The emitter is a per-connection factory that consolidates today's five
// racing WS emit paths (dormant / session_holding / session_holding_cleared /
// session_changed / inactive) into ONE authoritative `pane_state` frame per
// D-signal-set LOCKED in 30-CONTEXT.md.
//
// These tests exercise:
//   * factory shape (methods returned)
//   * wire-frame byte shape (with and without reason field)
//   * dedupe on identical (state, reason) pairs (mirrors dormantLastEmitted)
//   * dedupe is against the LAST emit only (not any prior emit)
//   * emitCurrent() bypasses dedupe (attach-time forced re-emit for a fresh
//     client that missed the original)
//   * full transition matrix across every documented state and reason
//   * compile-time exhaustiveness gate (via _exhaust: never sentinel)
//
// NO ws / ssh2 / logger imports — the emitter is pure per-connection state +
// a wsSend callback, testable in isolation.

import { describe, expect, it, vi } from "vitest";
import {
  createPaneStateEmitter,
  type PaneState,
  type PaneStateWireFrame,
  type PaneStateEmitter,
} from "./pane-state-emitter.js";

describe("createPaneStateEmitter", () => {
  // --- Test 1: factory shape + getCurrent() initial value ---
  it("returns an object with emit, emitCurrent, and getCurrent methods; getCurrent() starts null", () => {
    const wsSend = vi.fn();
    const emitter: PaneStateEmitter = createPaneStateEmitter({ wsSend });
    expect(typeof emitter.emit).toBe("function");
    expect(typeof emitter.emitCurrent).toBe("function");
    expect(typeof emitter.getCurrent).toBe("function");
    expect(emitter.getCurrent()).toBeNull();
    expect(wsSend).not.toHaveBeenCalled();
  });

  // --- Test 2: emit("active") — no reason omits the field on the wire ---
  it("emit('active') sends { type:'pane_state', state:'active' } with no reason field", () => {
    const wsSend = vi.fn();
    const emitter = createPaneStateEmitter({ wsSend });
    emitter.emit("active");
    expect(wsSend).toHaveBeenCalledTimes(1);
    expect(wsSend).toHaveBeenCalledWith(
      JSON.stringify({ type: "pane_state", state: "active" }),
    );
    // getCurrent reflects the emit — reason is undefined when omitted.
    expect(emitter.getCurrent()).toEqual({ state: "active", reason: undefined });
  });

  // --- Test 3: emit("holding", "id_reset") — reason included on wire ---
  it("emit('holding', 'id_reset') includes the reason field", () => {
    const wsSend = vi.fn();
    const emitter = createPaneStateEmitter({ wsSend });
    emitter.emit("holding", "id_reset");
    expect(wsSend).toHaveBeenCalledTimes(1);
    expect(wsSend).toHaveBeenCalledWith(
      JSON.stringify({ type: "pane_state", state: "holding", reason: "id_reset" }),
    );
    expect(emitter.getCurrent()).toEqual({ state: "holding", reason: "id_reset" });
  });

  // --- Test 4: dedupe — identical (state, reason) emits ONCE ---
  it("emit('active') then emit('active') → wsSend called exactly ONCE (dedupe)", () => {
    const wsSend = vi.fn();
    const emitter = createPaneStateEmitter({ wsSend });
    emitter.emit("active");
    emitter.emit("active");
    expect(wsSend).toHaveBeenCalledTimes(1);
  });

  // --- Test 5: differing reason is NOT a dedupe ---
  it("emit('holding','id_reset') then emit('holding','discovery_diff') → wsSend called TWICE", () => {
    const wsSend = vi.fn();
    const emitter = createPaneStateEmitter({ wsSend });
    emitter.emit("holding", "id_reset");
    emitter.emit("holding", "discovery_diff");
    expect(wsSend).toHaveBeenCalledTimes(2);
    expect(wsSend).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({ type: "pane_state", state: "holding", reason: "id_reset" }),
    );
    expect(wsSend).toHaveBeenNthCalledWith(
      2,
      JSON.stringify({ type: "pane_state", state: "holding", reason: "discovery_diff" }),
    );
  });

  // --- Test 6: dedupe is against LAST emit only, not any prior emit ---
  it("emit('holding','id_reset') → emit('active') → emit('holding','id_reset') → wsSend called THREE times", () => {
    const wsSend = vi.fn();
    const emitter = createPaneStateEmitter({ wsSend });
    emitter.emit("holding", "id_reset");
    emitter.emit("active");
    emitter.emit("holding", "id_reset");
    expect(wsSend).toHaveBeenCalledTimes(3);
  });

  // --- Test 7: emitCurrent() before any emit → wsSend NOT called ---
  it("emitCurrent() before any emit → wsSend NOT called; getCurrent still null", () => {
    const wsSend = vi.fn();
    const emitter = createPaneStateEmitter({ wsSend });
    emitter.emitCurrent();
    expect(wsSend).not.toHaveBeenCalled();
    expect(emitter.getCurrent()).toBeNull();
  });

  // --- Test 8: emitCurrent() bypasses dedupe ---
  it("emit('active') then emitCurrent() → wsSend called TWICE with identical payload (bypass dedupe)", () => {
    const wsSend = vi.fn();
    const emitter = createPaneStateEmitter({ wsSend });
    emitter.emit("active");
    emitter.emitCurrent();
    expect(wsSend).toHaveBeenCalledTimes(2);
    const expected = JSON.stringify({ type: "pane_state", state: "active" });
    expect(wsSend).toHaveBeenNthCalledWith(1, expected);
    expect(wsSend).toHaveBeenNthCalledWith(2, expected);
  });

  // --- Test 9: full transition matrix across every documented reason ---
  // Reason vocabulary is enumerated in 30-CONTEXT.md § Backend observations
  // feeding pane_state (and mirrored in 30-01-PLAN.md's Step 4 mapping table).
  // Test each documented (state, reason) pair — the emitter is pure so a
  // parametric loop is sufficient coverage.
  it("full transition matrix — every documented (state, reason) pair emits the correct wire frame", () => {
    type Case = { state: PaneState; reason?: string };
    const cases: Case[] = [
      // active
      { state: "active" }, // bare active (no reason) — initial-attach path
      { state: "active", reason: "same_file_recovery" }, // false-alarm recovery from holding
      { state: "active", reason: "session_changed" }, // new session file appeared
      { state: "active", reason: "dormancy_cleared" }, // .dormant sentinel disappeared
      // holding
      { state: "holding", reason: "id_reset" }, // Layer 1 parser saw /id reset
      { state: "holding", reason: "discovery_diff" }, // Layer 2 discovery detected file change
      { state: "holding", reason: "pid_death" }, // fallback: pid died
      { state: "holding", reason: "exit_scan" }, // fallback: /exit scan
      // dormant
      { state: "dormant" }, // .dormant sentinel present — no reason needed
      // inactive
      { state: "inactive", reason: "holding_timeout" }, // hold exceeded backend give-up window
      { state: "inactive", reason: "no_session" }, // discovery reported no session
      { state: "inactive", reason: "session_marked_inactive" }, // backend classification
      // error
      { state: "error", reason: "file_unreadable" }, // session file corrupt/unreadable
      { state: "error", reason: "tracking_error" }, // unrecoverable backend state error
    ];
    // Emit each case on a FRESH emitter so dedupe doesn't collapse the sequence.
    // (Two adjacent cases like {active} then {active,'same_file_recovery'} do
    // differ by reason and would emit twice on the same emitter, but the safest
    // per-case assertion is a fresh emitter — matches the semantics of a fresh
    // pane connection producing each transition once.)
    for (const c of cases) {
      const wsSend = vi.fn();
      const emitter = createPaneStateEmitter({ wsSend });
      emitter.emit(c.state, c.reason);
      const expectedFrame: PaneStateWireFrame =
        c.reason !== undefined
          ? { type: "pane_state", state: c.state, reason: c.reason }
          : { type: "pane_state", state: c.state };
      expect(wsSend).toHaveBeenCalledTimes(1);
      expect(wsSend).toHaveBeenCalledWith(JSON.stringify(expectedFrame));
      expect(emitter.getCurrent()).toEqual({ state: c.state, reason: c.reason });
    }
  });

  // --- Test 10: compile-time exhaustiveness gate ---
  // If a caller passes a value NOT in the PaneState union, tsc must reject it
  // at compile time (the _exhaust: never sentinel inside emit() would fail to
  // narrow to `never` if a new variant is added without a matching branch).
  it("TypeScript exhaustiveness rejects unknown pane states at compile time", () => {
    const wsSend = vi.fn();
    const emitter = createPaneStateEmitter({ wsSend });
    // @ts-expect-error — "nonexistent" is not in the PaneState union. If this
    // line ever compiles without an error, the union or the emit signature has
    // drifted and the exhaustiveness gate must be re-established.
    emitter.emit("nonexistent");
    // The emit still runs at runtime (JS has no type enforcement) — the
    // point of this test is the compile-time gate, not runtime behavior.
    // Assert something trivial so the test has a body.
    expect(wsSend).toHaveBeenCalledTimes(1);
  });
});
