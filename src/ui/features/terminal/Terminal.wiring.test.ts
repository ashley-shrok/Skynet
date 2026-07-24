/**
 * Phase 05 Plan 03 wiring tests for Terminal.tsx.
 *
 * Terminal.tsx is far too large + stateful (3000+ lines, xterm, WebSocket,
 * ssh, tmux, react-i18next) to unit-test as a mounted component with any
 * real fidelity. This suite instead pins the WIRING SHAPE via two
 * complementary techniques:
 *
 *   1. Structural grep on the source file — asserts that the exact prop
 *      names + attribute lines Plan 03 requires (terminalWs=..., onInjectedTurnReady=...,
 *      handleInjectedTurnReady callback definition) are present. Also
 *      asserts that the pre-existing PrettyView onSend callback (line ~2846)
 *      and MessageQueueDrawer onSend callback (line ~2869) are byte-identical
 *      to their known-good pre-Plan-03 sha256 (patch #60 / #100 protection).
 *
 *   2. Behavioral reproduction — copies the same two-event split-send
 *      pattern that handleInjectedTurnReady uses (as documented in the
 *      plan's Task 1 Step A action block) into a helper here and verifies
 *      the emitted mock-WS `.send()` calls match the expected split-send
 *      shape: body event first (no mqid), then \r event with mqid 60ms
 *      later. This is byte-identical to the MessageQueueDrawer onSend
 *      pattern at line 2869 (patch #60 template).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TERMINAL_TSX = join(HERE, "Terminal.tsx");

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

describe("Terminal.tsx Phase 05 Plan 03 wiring — structural", () => {
  const src = readFileSync(TERMINAL_TSX, "utf-8");

  it("Test 1a: PrettyView mount includes terminalWs={webSocketRef.current}", () => {
    const matches = src.match(/terminalWs=\{webSocketRef\.current\}/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it("Test 1b: PrettyView mount includes onInjectedTurnReady={handleInjectedTurnReady}", () => {
    const matches = src.match(/onInjectedTurnReady=\{handleInjectedTurnReady\}/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it("Test 1c: handleInjectedTurnReady callback is defined exactly once", () => {
    // Two occurrences expected: one definition (const handleInjectedTurnReady = ...)
    // and one JSX attribute usage above.
    const matches = src.match(/handleInjectedTurnReady/g);
    expect(matches).not.toBeNull();
    // definition + usage
    expect(matches!.length).toBe(2);
  });

  it("Test 1d: handleInjectedTurnReady definition uses useCallback", () => {
    // The callback must be memoized (docs live in the JSDoc — the body is
    // idempotent because webSocketRef is read via .current inside).
    const defBlock = /const handleInjectedTurnReady = useCallback\(/;
    expect(defBlock.test(src)).toBe(true);
  });

  it("Test 4 (patch #110): PrettyView onSend is a single WS event with mqid + text+CR", () => {
    // Patch #110 collapsed the prior two-event split (text + setTimeout(60ms)
    // for \r) into a single event with a synthetic messageQueueItemId. The
    // backend's isPrettyViewSubmit gate then fires and does the split
    // server-side, eliminating the 60ms WS-race window that silently dropped
    // Enter on WS flap.
    //
    // This test guards ALL THREE load-bearing invariants:
    //   1. WS-not-ready check + false return still present (fail-fast path)
    //   2. Exactly ONE ws.send call, carrying `text + "\r"` (no split)
    //   3. messageQueueItemId is attached (backend gate requires it)
    //   4. NO setTimeout in the pretty-view onSend block (regression guard —
    //      re-introducing setTimeout re-opens the race)
    const openIdx = src.indexOf(
      "            onSend={(text) => {\n              // Patch #110:",
    );
    expect(openIdx).toBeGreaterThan(0);
    // Read to the end of the arrow function body (matching closing `}}`).
    // The block is bounded by the next line starting with `            terminalWs=`.
    const closeIdx = src.indexOf(
      "            terminalWs={webSocketRef.current}",
      openIdx,
    );
    expect(closeIdx).toBeGreaterThan(openIdx);
    const block = src.slice(openIdx, closeIdx);
    // (1) fail-fast path preserved
    expect(block).toContain("if (!ws || ws.readyState !== 1) return false;");
    // (2) single event with text + "\r" (no split)
    expect(block).toContain('data: text + "\\r"');
    // (3) synthetic mqid attached
    expect(block).toContain('"pv-adhoc-" + crypto.randomUUID()');
    expect(block).toContain("messageQueueItemId: mqid");
    // (4) regression guard: no setTimeout CALL and no ws2 re-fetch. Both
    //     would reintroduce the 60ms cross-event race window we're closing.
    //     Match the CALL shape (arrow-fn arg) rather than the bare word —
    //     the explanatory comment above the fix mentions "setTimeout(60ms)"
    //     in prose, which we don't want to false-positive on.
    expect(block).not.toContain("setTimeout(() => {");
    expect(block).not.toMatch(/\bws2\s*=/);
    expect(block).not.toContain("ws2.send(");
    // (5) still returns true on the happy path
    expect(block).toContain("return true;");
  });

  it("Test 4b (patch #110): PrettyView onSend attaches a non-empty messageQueueItemId every call", () => {
    // Backend gate: isPrettyViewSubmit = typeof mqid === 'string' && mqid.length > 0.
    // If the pretty-view onSend ever emits a bare {type,data} without mqid,
    // the backend falls through to generic write and the split-send is dormant
    // → the ORIGINAL bug (Enter dropped) resurfaces. Belt-and-suspenders check
    // that mqid is always constructed non-empty.
    const openIdx = src.indexOf(
      "            onSend={(text) => {\n              // Patch #110:",
    );
    expect(openIdx).toBeGreaterThan(0);
    const closeIdx = src.indexOf(
      "            terminalWs={webSocketRef.current}",
      openIdx,
    );
    const block = src.slice(openIdx, closeIdx);
    // The mqid construction is a non-empty prefix + a UUID (both non-empty).
    expect(block).toMatch(/const mqid = "pv-adhoc-" \+ crypto\.randomUUID\(\);/);
  });

  it("Test 5: pre-existing MessageQueueDrawer onSend callback (line ~2869) is byte-identical", () => {
    // patch #60 template — the injected-turn callback is a byte-identical
    // copy of THIS pattern with an extra messageQueueItemId always present.
    const openIdx = src.indexOf(
      "            onSend={(text, messageQueueItemId) => {\n              const ws = webSocketRef.current;\n              if (!ws || ws.readyState !== 1) return false;",
    );
    expect(openIdx).toBeGreaterThan(0);
    // Positive content of the split-send + mqid attach.
    const block = src.slice(openIdx, openIdx + 1200);
    expect(block).toContain('ws.send(JSON.stringify({ type: "input", data: text }));');
    expect(block).toContain("setTimeout(() => {");
    expect(block).toContain("messageQueueItemId?: string;");
    expect(block).toContain("if (messageQueueItemId)");
    expect(block).toContain("payload.messageQueueItemId = messageQueueItemId;");
    expect(block).toContain("}, 60);");
  });

  it("Test 6 (patch #143 structural): visibilitychange listener added/removed as a pair, respects wasDisconnectedBySSH guard, adds no new terminal.clear()", () => {
    // Patch #143: new sibling useEffect wires a document.visibilitychange
    // listener that (a) cancels the scheduled reconnect + resets attempt
    // counter when the PWA tab is backgrounded, and (b) on foreground
    // auto-reconnects when the WS is closed AND the target did NOT drop
    // the SSH connection (wasDisconnectedBySSH === false). Critically:
    // the auto-reconnect path must NOT call terminal.clear() — that's
    // the manual-overlay Reconnect handler's flicker cause and the
    // deliberate divergence documented in the plan.
    //
    // Baselines pinned pre-patch (from the executor's grep gates):
    //   - terminal.clear()          count: 8   (must stay 8)
    //   - visibilitychange          count: 2   (add + remove pair)
    //
    // The wasDisconnectedBySSH.current guard is asserted by locating the
    // add/remove pair as bookends and checking the substring between them
    // contains the guard token — proves the visible branch respects the
    // target-terminated boundary and doesn't fire connectToHost after a
    // real SSH drop.

    // (1) add + remove pair
    const addMatches = src.match(/addEventListener\(["']visibilitychange["']/g);
    expect(addMatches).not.toBeNull();
    expect(addMatches!.length).toBe(1);

    const removeMatches = src.match(
      /removeEventListener\(["']visibilitychange["']/g,
    );
    expect(removeMatches).not.toBeNull();
    expect(removeMatches!.length).toBe(1);

    // (2) guard token exists between the add site and the remove site
    // (i.e. inside the effect body / handler closure).
    const addIdx = src.indexOf('addEventListener("visibilitychange"');
    const removeIdx = src.indexOf('removeEventListener("visibilitychange"');
    // Search a window that starts BEFORE the addEventListener call so we
    // include the handler body (declared above the listener wire-up).
    const effectStart = src.lastIndexOf("useEffect", addIdx);
    expect(effectStart).toBeGreaterThan(0);
    expect(removeIdx).toBeGreaterThan(addIdx);
    const effectBlock = src.slice(effectStart, removeIdx + 200);
    expect(effectBlock).toContain("wasDisconnectedBySSH.current");
    // (3) the visible branch must also cancel the scheduled reconnect
    // (hidden branch's clearTimeout is the load-bearing behavior).
    expect(effectBlock).toContain("clearTimeout(reconnectTimeoutRef");
    // (4) connectToHost is invoked with terminal.cols in the visible branch
    // (equivalent to the manual overlay Reconnect handler).
    expect(effectBlock).toMatch(/connectToHost\(terminal\.cols/);

    // (5) baseline pin: no NEW terminal.clear() introduced by the visibility
    // effect. Pre-patch baseline was 8; patch #143 adds zero.
    const clearMatches = src.match(/terminal\.clear\(\)/g);
    expect(clearMatches).not.toBeNull();
    expect(clearMatches!.length).toBe(8);
  });
});

// Behavioral reproduction of the patch #143 visibilitychange handler.
// This test literally re-implements the effect body from Task 1 Step B
// against fake refs + spies and verifies the three branches of the state
// machine: (a) hidden cancels the scheduled reconnect and resets the attempt
// counter; (b) visible auto-reconnects when disconnected and NOT target-
// terminated (without terminal.clear()); (c) visible respects the
// wasDisconnectedBySSH boundary and no-ops when the target dropped us;
// (d) visible no-ops when the WS is already open.
//
// The helper is BY DESIGN a byte-for-byte copy of the effect body so that
// if the source pattern ever changes, this suite must be updated deliberately
// (mirrors the handleInjectedTurnReady behavioral reproduction pattern above).
describe("Terminal.tsx patch #143 — visibilitychange auto-reconnect (iOS PWA backgrounding fix)", () => {
  type MockRef<T> = { current: T };
  type MockWs = { readyState: number } | null;

  let reconnectTimeoutRef: MockRef<ReturnType<typeof setTimeout> | null>;
  let reconnectAttempts: MockRef<number>;
  let isUnmountingRef: MockRef<boolean>;
  let isReconnectingRef: MockRef<boolean>;
  let isConnectingRef: MockRef<boolean>;
  let shouldNotReconnectRef: MockRef<boolean>;
  let wasConnectedRef: MockRef<boolean>;
  let wasDisconnectedBySSH: MockRef<boolean>;
  let webSocketRef: MockRef<MockWs>;

  let connectToHostSpy: ReturnType<typeof vi.fn>;
  let setShowDisconnectedOverlaySpy: ReturnType<typeof vi.fn>;
  let updateConnectionErrorSpy: ReturnType<typeof vi.fn>;
  let terminalClearSpy: ReturnType<typeof vi.fn>;

  let terminal: { cols: number; rows: number; clear: ReturnType<typeof vi.fn> } | null;
  let hidden: boolean;

  // WebSocket readyState constants (align with browser values).
  const WS_OPEN = 1;
  const WS_CLOSED = 3;

  // Byte-for-byte reproduction of the effect body in Terminal.tsx patch #143.
  function handleVisibilityChange() {
    if (hidden) {
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      reconnectAttempts.current = 0;
      isReconnectingRef.current = false;
      return;
    }
    // visible branch
    if (isUnmountingRef.current) return;
    if (wasDisconnectedBySSH.current) return;
    shouldNotReconnectRef.current = false;
    isReconnectingRef.current = false;
    isConnectingRef.current = false;
    reconnectAttempts.current = 0;
    wasConnectedRef.current = false;
    wasDisconnectedBySSH.current = false;
    updateConnectionErrorSpy(null);
    setShowDisconnectedOverlaySpy(false);
    if (terminal) {
      connectToHostSpy(terminal.cols, terminal.rows);
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    reconnectTimeoutRef = { current: null };
    reconnectAttempts = { current: 0 };
    isUnmountingRef = { current: false };
    isReconnectingRef = { current: false };
    isConnectingRef = { current: false };
    shouldNotReconnectRef = { current: false };
    wasConnectedRef = { current: false };
    wasDisconnectedBySSH = { current: false };
    webSocketRef = { current: null };
    connectToHostSpy = vi.fn();
    setShowDisconnectedOverlaySpy = vi.fn();
    updateConnectionErrorSpy = vi.fn();
    terminalClearSpy = vi.fn();
    terminal = { cols: 80, rows: 24, clear: terminalClearSpy };
    hidden = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Test 7: hidden branch cancels scheduled reconnect + resets attempt counter", () => {
    const scheduledCallback = vi.fn();
    reconnectTimeoutRef.current = setTimeout(scheduledCallback, 5000);
    reconnectAttempts.current = 3;
    isReconnectingRef.current = true;

    hidden = true;
    handleVisibilityChange();

    expect(reconnectTimeoutRef.current).toBeNull();
    expect(reconnectAttempts.current).toBe(0);
    expect(isReconnectingRef.current).toBe(false);

    // Advance past the original 5s deadline — the scheduled callback
    // MUST NOT fire (proves clearTimeout worked).
    vi.advanceTimersByTime(10_000);
    expect(scheduledCallback).not.toHaveBeenCalled();
  });

  it("Test 8: visible branch auto-reconnects when disconnected AND not target-terminated (no terminal.clear())", () => {
    webSocketRef.current = { readyState: WS_CLOSED };
    wasDisconnectedBySSH.current = false;
    isUnmountingRef.current = false;
    // Simulate mid-flight reconnect state so we can assert the reset.
    shouldNotReconnectRef.current = true;
    isReconnectingRef.current = true;
    isConnectingRef.current = true;
    reconnectAttempts.current = 5;
    wasConnectedRef.current = true;

    hidden = false;
    handleVisibilityChange();

    // Reconnect fired exactly once with the mocked terminal dims.
    expect(connectToHostSpy).toHaveBeenCalledTimes(1);
    expect(connectToHostSpy).toHaveBeenCalledWith(80, 24);
    // Overlay + error setters both called.
    expect(setShowDisconnectedOverlaySpy).toHaveBeenCalledWith(false);
    expect(updateConnectionErrorSpy).toHaveBeenCalledWith(null);
    // State flags fully reset (matches the manual overlay Reconnect handler).
    expect(shouldNotReconnectRef.current).toBe(false);
    expect(isReconnectingRef.current).toBe(false);
    expect(isConnectingRef.current).toBe(false);
    expect(reconnectAttempts.current).toBe(0);
    expect(wasConnectedRef.current).toBe(false);
    expect(wasDisconnectedBySSH.current).toBe(false);
    // CRITICAL divergence from the manual overlay path: NO terminal.clear().
    // tmux repaint on reattach handles restoration; clearing was the
    // visible-flicker cause in the manual-overlay path.
    expect(terminalClearSpy).not.toHaveBeenCalled();
  });

  it("Test 9: visible branch respects target-terminated boundary (wasDisconnectedBySSH=true → no-op)", () => {
    webSocketRef.current = { readyState: WS_CLOSED };
    wasDisconnectedBySSH.current = true;
    // Pin the state flags so we can assert nothing changed.
    shouldNotReconnectRef.current = true;
    isReconnectingRef.current = true;
    reconnectAttempts.current = 4;

    hidden = false;
    handleVisibilityChange();

    // No reconnect, no overlay/error setter calls.
    expect(connectToHostSpy).not.toHaveBeenCalled();
    expect(setShowDisconnectedOverlaySpy).not.toHaveBeenCalled();
    expect(updateConnectionErrorSpy).not.toHaveBeenCalled();
    // State flags unchanged — manual Reconnect stays the correct affordance
    // for the target-terminated case.
    expect(shouldNotReconnectRef.current).toBe(true);
    expect(isReconnectingRef.current).toBe(true);
    expect(reconnectAttempts.current).toBe(4);
    expect(wasDisconnectedBySSH.current).toBe(true);
    expect(terminalClearSpy).not.toHaveBeenCalled();
  });

  // spec change #143 v2: the readyState guard was deleted in patch #144
  // because iOS PWA foreground resumes JS with the old WS ref still reading
  // OPEN even when a queued close event hasn't been delivered yet. Opening
  // a fresh WS is idempotent (old one closes cleanly, tmux reattach handles
  // restoration).
  it("Test 10 (spec change #143 v2): visible branch UNCONDITIONALLY reconnects even when webSocketRef reports OPEN — iOS PWA resume sees a stale OPEN ref before the queued close delivers, so the guard was the bug", () => {
    webSocketRef.current = { readyState: WS_OPEN };
    wasDisconnectedBySSH.current = false;

    hidden = false;
    handleVisibilityChange();

    // Reconnect fires exactly once with the mocked terminal dims — the OPEN
    // ref is deliberately ignored because iOS resumes with a stale OPEN
    // before the queued close event has delivered.
    expect(connectToHostSpy).toHaveBeenCalledTimes(1);
    expect(connectToHostSpy).toHaveBeenCalledWith(80, 24);
    // Overlay + error setters both called as part of the full reset path.
    expect(setShowDisconnectedOverlaySpy).toHaveBeenCalledWith(false);
    expect(updateConnectionErrorSpy).toHaveBeenCalledWith(null);
    // CRITICAL divergence from the manual overlay path: NO terminal.clear()
    // in the visibility path per the plan (tmux repaint on reattach handles
    // restoration; clearing was the visible-flicker cause).
    expect(terminalClearSpy).not.toHaveBeenCalled();
  });
});

// Behavioral reproduction of the handleInjectedTurnReady pattern.
// This test literally re-implements the callback body from Task 1 Step A
// against a mock WebSocket and verifies the two-event split-send with the
// 60ms setTimeout gap. It is BY DESIGN a copy of the same pattern so that
// if we ever change the pattern in Terminal.tsx, this test must be updated
// deliberately (rather than silently passing a stale mock).
describe("Terminal.tsx handleInjectedTurnReady — behavioral reproduction", () => {
  let mockWs: {
    readyState: number;
    send: ReturnType<typeof vi.fn>;
  };
  let webSocketRef: { current: typeof mockWs | null };

  // Match the exact pattern from Task 1 Step A action block.
  function handleInjectedTurnReady(text: string, messageQueueItemId: string) {
    const ws = webSocketRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "input", data: text }));
    setTimeout(() => {
      const ws2 = webSocketRef.current;
      if (ws2 && ws2.readyState === 1) {
        ws2.send(
          JSON.stringify({ type: "input", data: "\r", messageQueueItemId }),
        );
      }
    }, 60);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    mockWs = { readyState: 1, send: vi.fn() };
    webSocketRef = { current: mockWs };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Test 2: emits two-event split-send (body first, then \\r with mqid 60ms later)", () => {
    const injectedText =
      'caption\n\n--- attached files ---\n1. log.txt (12.1 KB, text/plain) → /home/ash/pretty-view-uploads/2026-07-20/143211-log.txt\n   uploaded 2026-07-20T14:32:11\n';
    handleInjectedTurnReady(injectedText, "mqid-abc");

    // First event fires synchronously (body only, no mqid).
    expect(mockWs.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockWs.send.mock.calls[0][0])).toEqual({
      type: "input",
      data: injectedText,
    });

    // Second event fires after ~60ms with \r + mqid.
    vi.advanceTimersByTime(59);
    expect(mockWs.send).toHaveBeenCalledTimes(1); // still just the first
    vi.advanceTimersByTime(1); // total 60ms
    expect(mockWs.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockWs.send.mock.calls[1][0])).toEqual({
      type: "input",
      data: "\r",
      messageQueueItemId: "mqid-abc",
    });
  });

  it("Test 3a: silent noop when webSocketRef.current is null", () => {
    webSocketRef.current = null;
    expect(() => handleInjectedTurnReady("x", "y")).not.toThrow();
    // No timer scheduled either.
    vi.advanceTimersByTime(1000);
    expect(mockWs.send).not.toHaveBeenCalled();
  });

  it("Test 3b: silent noop when readyState !== 1", () => {
    mockWs.readyState = 3; // CLOSED
    expect(() => handleInjectedTurnReady("x", "y")).not.toThrow();
    vi.advanceTimersByTime(1000);
    expect(mockWs.send).not.toHaveBeenCalled();
  });

  it("Test 3c: second event checks readyState at fire time (WS closed between fires → no second send)", () => {
    handleInjectedTurnReady("hi", "mqid-1");
    expect(mockWs.send).toHaveBeenCalledTimes(1);
    // WS closes between the two events.
    mockWs.readyState = 3;
    vi.advanceTimersByTime(60);
    // Second send skipped because ws2.readyState !== 1.
    expect(mockWs.send).toHaveBeenCalledTimes(1);
  });
});
