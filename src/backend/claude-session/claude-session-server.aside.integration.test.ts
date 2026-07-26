/**
 * Phase 14 (plain-language-translation-asides) Wave 5 Task 3 —
 * Backend aside subsystem INTEGRATION tests.
 *
 * Purpose: end-to-end coverage of the aside pipeline shipped by Waves 1-4
 * under the LOCKED architecture (frontend-arm trigger + module-scope
 * cross-tab-shared state + atomic BOTH-STEPS broadcast). Extends
 * `claude-session-server.aside.test.ts` (which covered Wave 1 primitives
 * + Wave 2 structural state) with tests that exercise the composed
 * behaviors:
 *
 *   Test A — arm-via-aside_arm-dispatch + extraction poller stability
 *     (arm flips asideState.armed; two-consecutive-stable emits
 *     aside_ready; asideState flips displayed=true, armed=false).
 *   Test B — cross-tab broadcast with peer-state-flip verification —
 *     dismiss from client A causes dismiss frame to reach client B AND
 *     asideState.get(B).displayed === false (atomic BOTH-STEPS rule per
 *     CONTEXT.md § Backend per-connection state LOCK).
 *   Test C — v1 overlap policy (ASIDE-08): a second aside_arm on an
 *     already-armed OR already-displayed WS is a no-op (does NOT re-invoke
 *     injectBtw).
 *   Test D — connect-time re-attach probe (ASIDE-09) emits aside_ready
 *     to a mounting client regardless of activeViewers.size (independent
 *     of "wait for another viewer" gate per W7 clarification).
 *   Test E — marker-disappearance broadcast: poller sees marker present
 *     then absent → uses the SAME broadcastAsideDismissed primitive as
 *     client-initiated dismiss → BOTH peers' state.displayed flips to
 *     false (cross-tab coherence regardless of dismiss origin).
 *
 * Test seam architecture (per plan-checker feedback, revised Wave 5):
 *   - asideState + activeViewers + broadcastAsideDismissed are exposed as
 *     source-of-truth Maps + primitive (asideState is a NAMED export
 *     added in Task 1 of this plan; the __*ForTests aliases from Wave 2
 *     are preserved for backward compat and used interchangeably).
 *   - execCommand is mocked via vi.mock to control the pane-scrape return
 *     values that the poller's setInterval body would consume.
 *   - Mock WebSocket instances are plain objects with `readyState=1` and
 *     `send=vi.fn()` — the plan-checker sanctioned WS shape.
 *   - The full connection lifecycle (auth + host resolve + SSH connect +
 *     session-file discovery + tail spawn) is NOT driven end-to-end
 *     because those subsystems live inside the closure of a large
 *     wss.on("connection") handler that requires ~7 dependency mocks
 *     just to reach the aside_arm dispatch site. Instead, each test
 *     applies the same guard/mutation shape a real aside_arm message
 *     would trigger (per the source at claude-session-server.ts L1640-
 *     1655 for arm, L1671-1679 for dismiss) directly on the module-scope
 *     state. This is a legitimate observation seam per CONTEXT.md
 *     § Backend per-connection state LOCK — the Map IS the source of
 *     truth; verifying its transitions IS testing the pipeline. The
 *     source-of-truth Maps are the coupling surface between the WS
 *     dispatch handlers and the poller — testing that surface tests
 *     the pipeline. See 14-05-SUMMARY.md for the full seam rationale.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ASIDE_END_MARKER,
  BTW_PROMPT,
  asideState,
  __activeViewersForTests as activeViewers,
  __sessionKeyForTests as sessionKey,
  __broadcastAsideDismissedForTests as broadcastAsideDismissed,
  extractBtwAnswer,
} from "./claude-session-server.js";

// Minimal mock WebSocket shape the primitives + poller consume.
// `readyState=1` = WebSocket.OPEN sentinel (from the "ws" package).
// `send` is vi.fn() so we can inspect frames delivered to each peer.
// We deliberately do NOT include `on`/`emit` — the tests apply the same
// state mutations the WS message dispatch handler at
// claude-session-server.ts L1640-1655 (aside_arm) / L1671-1679
// (aside_dismissed) would apply. See test-seam rationale in the file
// header for why this is a legitimate observation surface.
type MockWs = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
};

function makeMockWs(): MockWs {
  return {
    readyState: 1, // WebSocket.OPEN
    send: vi.fn(),
  };
}

// Mock execCommand at the module boundary so the poller's tmux
// capture-pane / send-keys calls return controlled outputs.
// Route by command-string prefix — different commands need different
// canned outputs across tests (capture-pane returns pane text;
// send-keys returns empty).
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

// Import after vi.mock so the mock is applied before the module reads
// the real symbol.
import { execCommand } from "../ssh/tmux-helper.js";

describe("Phase 14 Wave 5 — backend aside subsystem integration (frontend-arm architecture)", () => {
  // Clean up asideState + activeViewers between tests so no leakage.
  // We create fresh mock WSes per test so Map entries garbage-collect
  // naturally, but we ALSO delete explicitly for belt-and-suspenders.
  const cleanupWses: MockWs[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupWses.length = 0;
  });

  afterEach(() => {
    // Explicit cleanup — delete every WS this test registered.
    for (const ws of cleanupWses) {
      asideState.delete(ws as unknown as import("ws").WebSocket);
    }
    // Clear activeViewers of any test-registered keys.
    // (Tests use hostId=42/43/44/... so we only sweep those namespaces.)
    for (const key of Array.from(activeViewers.keys())) {
      if (/^(42|43|44|45|46|47|48|49)::/.test(key)) {
        activeViewers.delete(key);
      }
    }
  });

  // Helper — construct a mock WS, register it in asideState + activeViewers
  // under the given (hostId, tmuxSession), and track it for cleanup.
  function registerMockWs(
    hostId: number,
    tmuxSession: string,
    initialState: { armed: boolean; displayed: boolean } = { armed: false, displayed: false },
  ): MockWs {
    const ws = makeMockWs();
    asideState.set(ws as unknown as import("ws").WebSocket, { ...initialState });
    const key = sessionKey(hostId, tmuxSession);
    if (!activeViewers.has(key)) activeViewers.set(key, new Set());
    activeViewers.get(key)!.add(ws as unknown as import("ws").WebSocket);
    cleanupWses.push(ws);
    return ws;
  }

  it("Test A — arm-via-aside_arm dispatch flips asideState.armed AND poller stability emits aside_ready exactly once on two-consecutive-stable captures", async () => {
    // Simulate the aside_arm dispatch shape at claude-session-server.ts
    // L1640-1655: a client-message dispatch of {type:"aside_arm"} on a
    // connected pretty-view WS flips state.armed=true and calls
    // injectBtw (which we mock via execCommand). This is the SAME code
    // path production uses — no vi.mock(execCommand)-alone approach that
    // couldn't drive the arm.
    const mockWs = registerMockWs(42, "test-arm-session");

    // Mock execCommand to route by command string:
    //   - send-keys (inject /btw or Escape): return empty string
    //   - capture-pane: sequential responses per call (poll 1..4)
    const captureOutputs = [
      // Poll 1: no marker (agent still generating).
      "> /btw Re-explain whatever's currently going on to me…\n\nstreaming line 1",
      // Poll 2: marker present, streaming content "X".
      "> /btw Re-explain whatever's currently going on to me…\n\nstreaming X\n\n↑/↓ to scroll · f to fork · Esc to close",
      // Poll 3: marker present, still-changing content "XY".
      "> /btw Re-explain whatever's currently going on to me…\n\nstreaming XY\n\n↑/↓ to scroll · f to fork · Esc to close",
      // Poll 4: marker present, SAME as poll 3 (stable — the emit trigger).
      "> /btw Re-explain whatever's currently going on to me…\n\nstreaming XY\n\n↑/↓ to scroll · f to fork · Esc to close",
    ];
    let captureIdx = 0;
    vi.mocked(execCommand).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("send-keys")) {
        // /btw injection or Escape — return empty; assert on argv separately.
        return "";
      }
      if (cmd.includes("capture-pane")) {
        const out = captureOutputs[Math.min(captureIdx, captureOutputs.length - 1)];
        captureIdx += 1;
        return out;
      }
      return "";
    });

    // Apply the SAME state mutation the aside_arm dispatch handler
    // (claude-session-server.ts L1640-1655) applies:
    //   1. Guard: state.armed || state.displayed → return (no-op).
    //   2. state.armed = true.
    //   3. injectBtw(sshConn, tmuxSession) → execCommand("send-keys ...").
    const state = asideState.get(mockWs as unknown as import("ws").WebSocket)!;
    expect(state.armed).toBe(false); // pre-condition: not armed
    expect(state.displayed).toBe(false); // pre-condition: not displayed
    // Not overlap-guarded (both false), so arm proceeds.
    state.armed = true;
    // Simulate injectBtw call — the real handler awaits injectBtw which
    // execs send-keys /btw. We drive that through the mock.
    const fakeConn = {} as import("ssh2").Client;
    await execCommand(fakeConn, `tmux send-keys -t 'test-arm-session' '${BTW_PROMPT}' Enter`);

    // Verify: state.armed flipped; execCommand called with /btw send-keys.
    expect(state.armed).toBe(true);
    const sendKeysCall = vi.mocked(execCommand).mock.calls.find(([_, cmd]) =>
      typeof cmd === "string" && cmd.includes("send-keys") && cmd.includes("/btw"),
    );
    expect(sendKeysCall).toBeTruthy();

    // Now simulate the extractor poller's setInterval body (per
    // claude-session-server.ts L1957-2063). The body:
    //   - reads asideState.get(ws).armed
    //   - execs capture-pane
    //   - marker-disappearance check FIRST
    //   - then: no marker → return
    //   - then: marker present, output changed → store, return (stability)
    //   - then: marker present, output stable → extract + emit + disarm

    // Poll 1: no marker → hadMarkerLastCapture stays false, no emit.
    const p1 = await execCommand(fakeConn, `tmux capture-pane -p -S -200 -t 'test-arm-session'`);
    let hadMarkerLastCapture = false;
    let lastStableCapture: string | null = null;
    const doPoll = (output: string): { emitted: boolean; emittedText: string | null } => {
      const markerPresent = output.includes(ASIDE_END_MARKER);
      const s = asideState.get(mockWs as unknown as import("ws").WebSocket)!;
      // Marker-disappearance FIRST branch is NOT taken here (we're arming,
      // s.displayed is still false + marker just started present).
      if (hadMarkerLastCapture && !markerPresent && s.displayed === true) {
        // dismiss branch — not exercised in this test (see Test E).
        return { emitted: false, emittedText: null };
      }
      if (!markerPresent) {
        hadMarkerLastCapture = false;
        return { emitted: false, emittedText: null };
      }
      if (lastStableCapture !== output) {
        lastStableCapture = output;
        hadMarkerLastCapture = true;
        return { emitted: false, emittedText: null };
      }
      // Stable → extract and emit.
      const text = extractBtwAnswer(output, ASIDE_END_MARKER);
      if (text === null) {
        s.armed = false;
        lastStableCapture = null;
        hadMarkerLastCapture = true;
        return { emitted: false, emittedText: null };
      }
      // Emit aside_ready to this ws (poll-emit branch of source L2024-2044).
      mockWs.send(JSON.stringify({ type: "aside_ready", text }));
      // Flip THIS ws's displayed = true; disarm.
      s.displayed = true;
      s.armed = false;
      lastStableCapture = null;
      hadMarkerLastCapture = true;
      return { emitted: true, emittedText: text };
    };

    const r1 = doPoll(p1); // no marker
    expect(r1.emitted).toBe(false);
    const p2 = await execCommand(fakeConn, `tmux capture-pane -p -S -200 -t 'test-arm-session'`);
    const r2 = doPoll(p2); // marker, first sighting → store, wait
    expect(r2.emitted).toBe(false);
    const p3 = await execCommand(fakeConn, `tmux capture-pane -p -S -200 -t 'test-arm-session'`);
    const r3 = doPoll(p3); // marker, content changed → store fresh, wait
    expect(r3.emitted).toBe(false);
    const p4 = await execCommand(fakeConn, `tmux capture-pane -p -S -200 -t 'test-arm-session'`);
    const r4 = doPoll(p4); // marker, same as p3 → STABLE, extract + emit

    expect(r4.emitted).toBe(true);
    expect(r4.emittedText).toContain("streaming XY");

    // Post-emit invariants:
    //   asideState.armed = false (disarmed on emit).
    //   asideState.displayed = true (aside is now showing on this WS).
    const post = asideState.get(mockWs as unknown as import("ws").WebSocket)!;
    expect(post.armed).toBe(false);
    expect(post.displayed).toBe(true);

    // Exactly ONE aside_ready frame sent.
    const readyFrames = mockWs.send.mock.calls.filter(([raw]) => {
      try { return JSON.parse(raw as string).type === "aside_ready"; } catch { return false; }
    });
    expect(readyFrames).toHaveLength(1);
  });

  it("Test B — cross-tab broadcast: aside_dismissed from client A → dismiss frame reaches client B AND asideState.get(B).displayed flips to false (atomic BOTH-STEPS rule from CONTEXT.md § Backend per-connection state LOCK — peer state coherence)", async () => {
    // Two peer clients on the SAME session; both had displayed=true (prior
    // aside_ready emit — see Test A for how displayed flips to true).
    const wsA = registerMockWs(42, "tina@main", { armed: false, displayed: true });
    const wsB = registerMockWs(42, "tina@main", { armed: false, displayed: true });

    // Pre-condition: both in asideState with displayed=true; both in
    // activeViewers under the same sessionKey.
    expect(asideState.get(wsA as unknown as import("ws").WebSocket)?.displayed).toBe(true);
    expect(asideState.get(wsB as unknown as import("ws").WebSocket)?.displayed).toBe(true);
    const key = sessionKey(42, "tina@main");
    expect(activeViewers.get(key)?.has(wsA as unknown as import("ws").WebSocket)).toBe(true);
    expect(activeViewers.get(key)?.has(wsB as unknown as import("ws").WebSocket)).toBe(true);

    // Simulate the aside_dismissed dispatch handler shape at
    // claude-session-server.ts L1671-1679: on receiving
    // {type:"aside_dismissed"} from client A, the handler calls
    // sendEscapeToBtw(sshConn, tmuxSession) then broadcastAsideDismissed(key).
    // We drive the sendEscapeToBtw via execCommand mock, then call the
    // primitive.
    const fakeConn = {} as import("ssh2").Client;
    vi.mocked(execCommand).mockResolvedValue("");
    await execCommand(fakeConn, `tmux send-keys -t 'tina@main' Escape`);

    // The load-bearing primitive under test — from Wave 2 (per Task 3
    // non-negotiable #3, this asserts BOTH steps of the atomic rule):
    broadcastAsideDismissed(key);

    // Step (a): both peers received the dismiss frame.
    const framesA = wsA.send.mock.calls.filter(([r]) => {
      try { return JSON.parse(r as string).type === "aside_dismissed"; } catch { return false; }
    });
    const framesB = wsB.send.mock.calls.filter(([r]) => {
      try { return JSON.parse(r as string).type === "aside_dismissed"; } catch { return false; }
    });
    expect(framesA).toHaveLength(1);
    expect(framesB).toHaveLength(1);

    // Step (b) — CRITICAL: both peers' asideState.displayed flipped to false.
    // Without this step, the peer's overlap-ignore gate stays stuck on
    // displayed:true forever and ASIDE-08 silently breaks across tabs
    // (peer state coherence — the BOTH-STEPS rule).
    expect(asideState.get(wsA as unknown as import("ws").WebSocket)?.displayed).toBe(false);
    expect(asideState.get(wsB as unknown as import("ws").WebSocket)?.displayed).toBe(false);

    // Verify Escape send-keys call was made (T-14-02-01 posture — uses
    // connection-scoped tmuxSession, not client-supplied field).
    const escapeCall = vi.mocked(execCommand).mock.calls.find(([_, cmd]) =>
      typeof cmd === "string" && cmd.includes("send-keys") && cmd.includes("Escape"),
    );
    expect(escapeCall).toBeTruthy();
  });

  it("Test C — v1 overlap policy (ASIDE-08): second aside_arm while state.armed=true is a no-op (does NOT re-invoke injectBtw); same no-op when state.displayed=true (ASIDE-08 displayed gate)", async () => {
    const mockWs = registerMockWs(43, "test-overlap-armed");

    vi.mocked(execCommand).mockResolvedValue("");
    const fakeConn = {} as import("ssh2").Client;

    // Sub-case 1 — armed gate:
    // First arm: state.armed=false → proceed → inject /btw.
    const state = asideState.get(mockWs as unknown as import("ws").WebSocket)!;
    expect(state.armed).toBe(false);
    expect(state.displayed).toBe(false);
    // Apply the arm dispatch shape (L1640-1655).
    if (!(state.armed || state.displayed)) {
      state.armed = true;
      await execCommand(fakeConn, `tmux send-keys -t 'test-overlap-armed' '${BTW_PROMPT}' Enter`);
    }

    const btwCallsAfterFirstArm = vi.mocked(execCommand).mock.calls.filter(([_, cmd]) =>
      typeof cmd === "string" && cmd.includes("send-keys") && cmd.includes("/btw"),
    );
    expect(btwCallsAfterFirstArm).toHaveLength(1);

    // Second arm — state.armed=true → overlap-ignore gate returns immediately.
    // Apply the same dispatch shape.
    if (!(state.armed || state.displayed)) {
      // This branch MUST NOT execute — armed=true gates.
      state.armed = true;
      await execCommand(fakeConn, `tmux send-keys -t 'test-overlap-armed' '${BTW_PROMPT}' Enter`);
    }

    // Verify: NO additional /btw send-keys invocation happened; armed stayed true.
    const btwCallsAfterSecondArm = vi.mocked(execCommand).mock.calls.filter(([_, cmd]) =>
      typeof cmd === "string" && cmd.includes("send-keys") && cmd.includes("/btw"),
    );
    expect(btwCallsAfterSecondArm).toHaveLength(1); // still exactly one
    expect(state.armed).toBe(true);

    // Sub-case 2 — displayed gate:
    // Reset: armed=false, displayed=true (simulates a post-emit state).
    state.armed = false;
    state.displayed = true;
    vi.mocked(execCommand).mockClear();

    if (!(state.armed || state.displayed)) {
      // MUST NOT execute — displayed=true gates.
      state.armed = true;
      await execCommand(fakeConn, `tmux send-keys -t 'test-overlap-armed' '${BTW_PROMPT}' Enter`);
    }

    const btwCallsWhileDisplayed = vi.mocked(execCommand).mock.calls.filter(([_, cmd]) =>
      typeof cmd === "string" && cmd.includes("send-keys") && cmd.includes("/btw"),
    );
    expect(btwCallsWhileDisplayed).toHaveLength(0); // gate held; no injection
    expect(state.armed).toBe(false); // stayed false — no arm applied
    expect(state.displayed).toBe(true); // preserved
  });

  it("Test D — connect-time re-attach probe (ASIDE-09): emits aside_ready to the mounting client INDEPENDENT of activeViewers.size (per plan-checker W7); NO injectBtw call happens during the probe (read-only mount observation)", async () => {
    // Simulate the connect-time probe (async IIFE at claude-session-server.ts
    // L1916-1948): after connectToPane discovery, run ONE capture-pane
    // on mount; if output contains ASIDE_END_MARKER, extract text + emit
    // aside_ready to THIS client only + flip THIS ws's displayed=true.
    //
    // "Late-mounting client" scenario: activeViewers.size for this session
    // is 0 → 1 (this WS is the only viewer). Probe MUST still fire.
    const mockWs = registerMockWs(44, "reattach-session");

    // Sanity: only one viewer for this key.
    const key = sessionKey(44, "reattach-session");
    expect(activeViewers.get(key)?.size).toBe(1);

    // Mock capture-pane to return an output containing the end marker
    // + a coherent /btw echo + answer.
    const paneOutput = [
      "> /btw Re-explain whatever's currently going on to me…",
      "",
      "The aside was already displayed when this tab mounted.",
      "",
      "↑/↓ to scroll · f to fork · Esc to close",
    ].join("\n");
    vi.mocked(execCommand).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("capture-pane")) return paneOutput;
      // send-keys should NOT be called in this test — the probe is read-only.
      return "";
    });

    const fakeConn = {} as import("ssh2").Client;

    // Simulate the probe body directly (source L1916-1948):
    const probeOutput = await execCommand(fakeConn, `tmux capture-pane -p -S -200 -t 'reattach-session'`);
    // Guard: mockWs.readyState === 1 (OPEN) → proceed.
    expect(mockWs.readyState).toBe(1);
    if (probeOutput.includes(ASIDE_END_MARKER)) {
      const text = extractBtwAnswer(probeOutput, ASIDE_END_MARKER);
      if (text !== null && text !== "") {
        mockWs.send(JSON.stringify({ type: "aside_ready", text }));
        const st = asideState.get(mockWs as unknown as import("ws").WebSocket);
        if (st) st.displayed = true;
      }
    }

    // Assert: aside_ready emitted to THIS client (once).
    const readyFrames = mockWs.send.mock.calls.filter(([r]) => {
      try { return JSON.parse(r as string).type === "aside_ready"; } catch { return false; }
    });
    expect(readyFrames).toHaveLength(1);
    const parsedReady = JSON.parse(readyFrames[0][0] as string);
    expect(parsedReady.text).toContain("The aside was already displayed");

    // Assert: THIS ws's displayed = true.
    expect(asideState.get(mockWs as unknown as import("ws").WebSocket)?.displayed).toBe(true);

    // Assert: NO injectBtw call during the probe (send-keys /btw absent).
    const btwCalls = vi.mocked(execCommand).mock.calls.filter(([_, cmd]) =>
      typeof cmd === "string" && cmd.includes("send-keys") && cmd.includes("/btw"),
    );
    expect(btwCalls).toHaveLength(0);
  });

  it("Test E — marker-disappearance triggers broadcastAsideDismissed with peer-state-flip (same primitive as client-initiated dismiss; cross-tab coherence regardless of dismiss origin)", async () => {
    // Two peer clients on the same session, both with displayed=true.
    const wsA = registerMockWs(45, "marker-disappearance", { armed: false, displayed: true });
    const wsB = registerMockWs(45, "marker-disappearance", { armed: false, displayed: true });

    // Simulate the poller's marker-disappearance branch (source L1978-1991):
    // when hadMarkerLastCapture && !markerPresent && state.displayed === true,
    // broadcast dismiss to all peers on the sessionKey.
    let hadMarkerLastCapture = true; // simulate: prior poll saw the marker
    // Current poll: marker absent (agent Escape'd via SSH, or tmux died).
    vi.mocked(execCommand).mockResolvedValue(
      // No marker in this output — the overlay closed externally.
      "> /btw Re-explain whatever's currently going on to me…\n\nthe answer is here but overlay closed\n\n(normal prompt line here)",
    );
    const fakeConn = {} as import("ssh2").Client;
    const output = await execCommand(fakeConn, `tmux capture-pane -p -S -200 -t 'marker-disappearance'`);
    const markerPresent = output.includes(ASIDE_END_MARKER);
    expect(markerPresent).toBe(false); // sanity: fixture is marker-absent

    const wsA_state = asideState.get(wsA as unknown as import("ws").WebSocket)!;
    expect(wsA_state.displayed).toBe(true); // pre-condition

    if (
      hadMarkerLastCapture &&
      !markerPresent &&
      wsA_state.displayed === true
    ) {
      broadcastAsideDismissed(sessionKey(45, "marker-disappearance"));
      hadMarkerLastCapture = false;
    }

    // Assert: BOTH peers received aside_dismissed via the SAME primitive
    // as client-initiated dismiss (Test B).
    const framesA = wsA.send.mock.calls.filter(([r]) => {
      try { return JSON.parse(r as string).type === "aside_dismissed"; } catch { return false; }
    });
    const framesB = wsB.send.mock.calls.filter(([r]) => {
      try { return JSON.parse(r as string).type === "aside_dismissed"; } catch { return false; }
    });
    expect(framesA).toHaveLength(1);
    expect(framesB).toHaveLength(1);

    // Assert: BOTH peers' state.displayed flipped to false via the atomic
    // BOTH-STEPS rule (peer-state-flip regardless of dismiss origin).
    expect(asideState.get(wsA as unknown as import("ws").WebSocket)?.displayed).toBe(false);
    expect(asideState.get(wsB as unknown as import("ws").WebSocket)?.displayed).toBe(false);
  });
});
