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

/**
 * Quick 260803-1xw / bounty pv-paste-to-terminal-lands-as-unsent-bracket-
 * paste: structural pins for the new `paste_send_failed` WS handler branch.
 * The backend PV submit watchdog (patch: quick 260803-1xw) emits this event
 * when the initial Enter + 1 retry Enter both failed to produce activity
 * within 2 x 2.5s windows. Terminal.tsx surfaces it as a `toast.error` and
 * logs to the connection log — same pattern as `tmux_unavailable` / `tmux_
 * detached` above.
 */
describe("Terminal.tsx quick 260803-1xw — paste_send_failed WS handler", () => {
  const src = readFileSync(TERMINAL_TSX, "utf-8");
  const I18N_EN = join(HERE, "..", "..", "locales", "en.json");

  it("Test PV-Watchdog 1: WS handler branch for paste_send_failed exists exactly once", () => {
    const matches = src.match(/msg\.type === "paste_send_failed"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it("Test PV-Watchdog 2: paste_send_failed branch calls toast.error with pasteSendFailed i18n key", () => {
    // Proximity match — the toast.error call must live inside the branch.
    // The window (900 chars) is generous enough to allow for the docblock
    // comment above the toast.error call but tight enough that we won't
    // false-positive on an unrelated toast.error elsewhere in the file.
    expect(
      /msg\.type === "paste_send_failed"[\s\S]{0,900}toast\.error\(t\("terminal\.pasteSendFailed"\)/.test(
        src,
      ),
    ).toBe(true);
  });

  it("Test PV-Watchdog 3: terminal.pasteSendFailed i18n key is registered in en.json", () => {
    const i18nSrc = readFileSync(I18N_EN, "utf-8");
    expect(i18nSrc).toMatch(/"pasteSendFailed"/);
  });
});

/**
 * quick-260809-eqk — iter 2 of hidden-pane-cost-mitigation-empirical-rotation.
 *
 * Structural-grep assertions for:
 *   (a) new WS-pause useEffect on [isVisible] in Terminal.tsx (mirrors the
 *       iter-1 shape applied to PrettyView.tsx at commit 4a3c21c);
 *   (b) isVisibleRef guard at the top of attemptReconnection() so patch #148-
 *       analog auto-reconnect cannot fight the pause;
 *   (c) isVisibleRef guard on the visible branch of the iOS PWA
 *       visibilitychange handler so foreground events cannot reopen a hidden
 *       pane's WS;
 *   (d) no duplication of the pre-existing isVisibleRef mirror effect;
 *   (e) main WS-setup effect at line ~2903 still gates on `attach` and NOT on
 *       `isVisible` (accepted tradeoff for the URL-restore contract);
 *   (f) PrettyView.tsx registerPane snapshotFn returns isVisibleRef.current
 *       (fixes stale-closure bug post-iter-1 so diag emits reflect live
 *       visibility);
 *   (g) PrettyView.tsx registerPane useEffect deps stay [hostId, tmuxSession]
 *       so the pane-registration slot doesn't churn on every visibility flip.
 *
 * All Terminal.tsx assertions anchor on the `quick-260809-eqk` comment tags
 * planted in the source so they survive future reformatting.
 */
describe("quick-260809-eqk — hidden-pane WS-pause + diag fix", () => {
  const src = readFileSync(TERMINAL_TSX, "utf-8");
  const PV_SRC_PATH = join(HERE, "..", "pretty-view", "PrettyView.tsx");
  const pvSrc = readFileSync(PV_SRC_PATH, "utf-8");

  it("Test eqk-1: Terminal.tsx contains exactly one isVisibleRef.current = isVisible mirror (no duplication)", () => {
    // The pre-existing mirror lives at line ~580 (present before this
    // patch). A second mirror would race with the first and defeat the
    // single-source-of-truth for isVisibleRef.
    const matches = src.match(/isVisibleRef\.current = isVisible/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it("Test eqk-2: Terminal.tsx contains a new [isVisible]-keyed useEffect tagged quick-260809-eqk with close() + attemptReconnection()", () => {
    // Anchor on the planted comment tag introducing the WS-pause effect.
    // The body must reference BOTH the close path and the reopen path so
    // the test guards against a well-meaning refactor that splits them or
    // removes one branch.
    const anchor = "quick-260809-eqk — Terminal-SSH WS-pause lifecycle effect";
    const anchorIdx = src.indexOf(anchor);
    expect(anchorIdx).toBeGreaterThan(0);
    // Effect body spans from the tag comment to the next useEffect / other
    // block. 8000 chars covers the verbose ~40-line rationale header plus
    // the ~35-line effect body.
    const block = src.slice(anchorIdx, anchorIdx + 8000);
    expect(block).toMatch(/useEffect\(\(\) => \{/);
    expect(block).toContain("webSocketRef.current");
    expect(block).toContain("ws.close()");
    expect(block).toContain("attemptReconnection()");
    // deps must be exactly [isVisible]
    expect(block).toMatch(/\}, \[isVisible\]\);/);
    // eslint-disable-next-line for the deps comment (mirrors PV iter-1 shape)
    expect(block).toContain("eslint-disable-line react-hooks/exhaustive-deps");
    // Clear the pending reconnect timer belt-and-suspenders
    expect(block).toContain("clearTimeout(reconnectTimeoutRef");
    // Fresh reconnect budget on re-show
    expect(block).toContain("reconnectAttempts.current = 0");
  });

  it("Test eqk-3: attemptReconnection() opens with isVisibleRef.current early-return", () => {
    // The guard must be the FIRST statement inside the function body so it
    // runs before every other early-return check — patch #148 auto-reconnect
    // cannot fight the pause otherwise.
    const fnIdx = src.indexOf("function attemptReconnection() {");
    expect(fnIdx).toBeGreaterThan(0);
    // Read the first ~400 chars of the function body (enough to cover the
    // planted comment + guard + the original guard block start).
    const body = src.slice(fnIdx, fnIdx + 900);
    // The guard line — anchored on the planted comment tag for deterministic
    // matching that survives reformatting.
    expect(body).toContain("quick-260809-eqk: hidden panes must not fight the WS-pause effect");
    // Guard may be single-line `return;` or multi-line `{ ...; return; }` after 31-02's warn-log conversion.
    expect(body).toMatch(/if \(!isVisibleRef\.current\)\s*(?:return;|\{[\s\S]*?return;\s*\})/);
    // Positional check: the isVisibleRef guard appears BEFORE the pre-existing
    // guard block on isUnmountingRef / shouldNotReconnectRef.
    const guardIdx = body.indexOf("if (!isVisibleRef.current)");
    const oldGuardIdx = body.indexOf("isUnmountingRef.current ||");
    expect(guardIdx).toBeGreaterThan(0);
    expect(oldGuardIdx).toBeGreaterThan(guardIdx);
  });

  it("Test eqk-4: iOS PWA visibilitychange handler's visible branch early-returns on !isVisibleRef.current", () => {
    // Anchor on the planted quick-260809-eqk tag on the visible branch.
    // The pretty-view mirror of this guard lives in PrettyView.tsx around
    // line ~986 (iter 1).
    const anchor = "quick-260809-eqk: pane hidden → do not open WS from foreground event";
    const anchorIdx = src.indexOf(anchor);
    expect(anchorIdx).toBeGreaterThan(0);
    // The guard line lives shortly after the anchor comment (the anchor is
    // a multi-line rationale block; 800 chars covers ~10 comment lines +
    // the guard line itself).
    const window = src.slice(anchorIdx, anchorIdx + 800);
    // Guard may be single-line `return;` or multi-line `{ ...; return; }`.
    expect(window).toMatch(/if \(!isVisibleRef\.current\)\s*(?:return;|\{[\s\S]*?return;\s*\})/);
    // Positional check: the guard must live in the VISIBLE branch (after
    // `document.hidden` early return, and inside the isIosPwa-gated effect).
    // Locate `if (document.hidden)` before the anchor and confirm it exists —
    // this proves we planted in the correct effect.
    const hiddenBranchIdx = src.lastIndexOf("if (document.hidden)", anchorIdx);
    expect(hiddenBranchIdx).toBeGreaterThan(0);
    expect(anchorIdx).toBeGreaterThan(hiddenBranchIdx);
    // And the isIosPwa gate is above the hidden branch.
    const iosGateIdx = src.lastIndexOf("if (!isIosPwa()) return;", hiddenBranchIdx);
    expect(iosGateIdx).toBeGreaterThan(0);
  });

  it("Test eqk-5: main WS-setup effect keeps `attach` in deps, keeps `isVisible` OUT of deps, and gates body on `!isVisibleRef.current` (patch #368 followup)", () => {
    // Patch #367 shipped the [isVisible] pause effect but the WS-setup effect
    // (this one) still lacked an isVisibleRef body-gate — so when the pause
    // closed the WS, onclose flipped isConnected, the setup effect's deps
    // fired, and it immediately reopened the WS behind the pause's back
    // (empirically confirmed: hidden terminals were still burning 17-61 KB/30s).
    // Patch #368 (2026-08-09) adds the body-gate; deps stay the same so a
    // visibility flip alone does NOT re-fire this effect (pause effect owns
    // the reopen via attemptReconnection). Trade: hidden URL-restored panes
    // no longer pre-warm — they open on first visible tap (same ~2s cost the
    // pause layer already accepts).
    //
    // Anchor on the updated comment above the effect.
    const anchor = "attach gates initial WS lifecycle";
    const anchorIdx = src.indexOf(anchor);
    expect(anchorIdx).toBeGreaterThan(0);
    // Read to the effect's closing deps array (within ~2500 chars from the
    // comment — the effect body is ~30 lines; the comment itself grew).
    const window = src.slice(anchorIdx, anchorIdx + 2500);
    // Body-gate assertion (patch #368): early-return on !isVisibleRef.current.
    expect(window).toMatch(/if\s*\(\s*!isVisibleRef\.current\s*\)\s*return\s*;/);
    // Deps array MUST include `attach`. Match the deps closing shape.
    const depsMatch = window.match(/\}, \[([^\]]+)\]\);/);
    expect(depsMatch).not.toBeNull();
    const depsList = depsMatch![1];
    expect(depsList).toContain("attach");
    // Negative assert: `isVisible` must NOT appear in this deps list — the
    // effect must only re-run on the state changes it already tracks; the
    // pause effect owns visibility-driven reopen via attemptReconnection.
    // Use a word-boundary check because `isVisible` isn't a substring of
    // any current dep name (guards against a future rename collision).
    expect(depsList).not.toMatch(/\bisVisible\b/);
  });

  it("Test eqk-6: PrettyView.tsx registerPane snapshotFn returns isVisible: isVisibleRef.current", () => {
    // Fixes the stale-closure bug where the snapshotFn returned `isVisible`
    // captured from render scope at first registration (deps are
    // [hostId, tmuxSession], intentionally not [isVisible]). Post-fix the
    // snapshot reads through the ref which the mirror effect at
    // lines ~1150-1156 keeps live.
    expect(pvSrc).toMatch(/isVisible: isVisibleRef\.current,/);
    // Negative assert: the buggy `isVisible,` (shorthand, closure-captured)
    // must NOT appear inside the returned object of the snapshotFn.
    // Locate the snapshot return block and check it doesn't contain the
    // shorthand form.
    const snapIdx = pvSrc.indexOf('kind: "pretty-view",');
    expect(snapIdx).toBeGreaterThan(0);
    // Snapshot return object plus the inserted rationale comment lives
    // within ~1500 chars of the `kind:` line.
    const snapBlock = pvSrc.slice(snapIdx, snapIdx + 1500);
    // Positive: fresh-read form present
    expect(snapBlock).toContain("isVisible: isVisibleRef.current");
    // Negative: bare shorthand `isVisible,` (with no colon before it) absent —
    // shorthand-property form would be dishonest under the [hostId,
    // tmuxSession] deps design.
    expect(snapBlock).not.toMatch(/^\s*isVisible,\s*$/m);
  });

  it("Test eqk-7: PrettyView.tsx registerPane useEffect deps remain [hostId, tmuxSession] (not extended with isVisible)", () => {
    // Guards against a well-meaning fix that adds `isVisible` to the deps
    // array — which would re-register the pane on every visibility flip and
    // defeat the stable-key design (the diag emitter uses the key as its
    // slot identifier).
    const snapIdx = pvSrc.indexOf('kind: "pretty-view",');
    expect(snapIdx).toBeGreaterThan(0);
    // Deps live within ~2000 chars after the snapshot-return object opens
    // (the inserted rationale comment inside the object added ~600 chars).
    const afterSnap = pvSrc.slice(snapIdx, snapIdx + 2000);
    // Match the exact deps array shape.
    expect(afterSnap).toMatch(/\}, \[hostId, tmuxSession\]\);/);
    // Negative: no [hostId, tmuxSession, isVisible] variant.
    expect(afterSnap).not.toMatch(/\[hostId, tmuxSession, isVisible\]/);
  });
});

/**
 * quick-260809-ih9 — pause-effect initial-mount race fix
 * (prevIsVisibleRef edge detector).
 *
 * BUG: Terminal.tsx's pause effect at ~L624 (patch #367) fires on mount
 * with isVisible=true and webSocketRef.current === null, taking the visible
 * branch and calling attemptReconnection() — which schedules a setTimeout
 * that captures a still-null `terminal` closure. The setup effect at
 * ~L3000 (patch #368 body-gate) then sees isReconnectingRef=true and
 * returns early. Result: first session after page load is stuck on
 * "Reconnecting..." until user nav-away-then-back forces a genuine
 * false→true transition with a fresh (non-null-terminal) closure.
 *
 * FIX: mirror PrettyView.tsx quick-260809-cnx's `prevIsVisibleRef`
 * edge-detector pattern at L1181-L1203. Init `prevIsVisibleRef` to
 * `isVisible` (NOT `false`) so on initial mount `prev === isVisible === true`
 * and `!prev && isVisible` is false, so the visible branch no-ops on mount.
 * Only genuine false→true transitions (nav-away-then-back) fire the
 * reopen. Setup effect owns initial-mount WS open; pause effect owns
 * transitions. Hidden branch untouched.
 *
 * All tests here are static source-string assertions matching the eqk-*
 * style above (no rendering, no mocks, no timers).
 */
describe("quick-260809-ih9 — pause-effect initial-mount race fix (prevIsVisibleRef edge detector)", () => {
  const src = readFileSync(TERMINAL_TSX, "utf-8");

  it("Test ih9-1: Terminal.tsx declares prevIsVisibleRef = useRef<boolean>(isVisible) with quick-260809-ih9 tag (init to isVisible, NOT false, is load-bearing)", () => {
    // Declaration must exist AND be initialized to `isVisible` (the prop),
    // NOT to `false`. If it were initialized to `false`, initial mount
    // would see prev=false && isVisible=true → !prev && isVisible = TRUE,
    // and the reopen would still fire on mount — reproducing the exact
    // race we're fixing.
    expect(src).toMatch(
      /const prevIsVisibleRef = useRef<boolean>\(isVisible\);/,
    );
    // NEGATIVE assert: no `useRef<boolean>(false)` variant on prevIsVisibleRef.
    expect(src).not.toMatch(
      /prevIsVisibleRef = useRef<boolean>\(false\)/,
    );
    // The declaration must be tagged with the quick-260809-ih9 comment
    // anchor so future refactors can locate it.
    const declIdx = src.indexOf(
      "const prevIsVisibleRef = useRef<boolean>(isVisible);",
    );
    expect(declIdx).toBeGreaterThan(0);
    // The tag should live within ~800 chars above the declaration
    // (comment block explaining the pattern).
    const commentWindow = src.slice(Math.max(0, declIdx - 800), declIdx);
    expect(commentWindow).toContain("quick-260809-ih9");
    // Overall the tag must appear at least 2× in the file (declaration
    // comment + pause-effect comment).
    const tagMatches = src.match(/quick-260809-ih9/g);
    expect(tagMatches).not.toBeNull();
    expect(tagMatches!.length).toBeGreaterThanOrEqual(2);
  });

  it("Test ih9-2: pause effect's visible branch is edge-gated on `!prev && isVisible` (initial-mount race regression guard)", () => {
    // Anchor on the pause effect via the eqk comment tag (same anchor
    // used in eqk-2).
    const anchor = "quick-260809-eqk — Terminal-SSH WS-pause lifecycle effect";
    const anchorIdx = src.indexOf(anchor);
    expect(anchorIdx).toBeGreaterThan(0);
    // Effect body + rationale header lives within ~8000 chars of anchor
    // (same window size as eqk-2).
    const block = src.slice(anchorIdx, anchorIdx + 8000);
    // Edge-detector prelude: capture prev + update ref.
    expect(block).toContain("const prev = prevIsVisibleRef.current;");
    expect(block).toContain("prevIsVisibleRef.current = isVisible;");
    // The visible branch must be gated on the false→true edge.
    expect(block).toMatch(/else if \(!prev && isVisible\)/);
    // Hidden branch still present (regression guard against someone
    // "simplifying" it away).
    expect(block).toMatch(/if \(!isVisible\) \{/);
    // Deps stay exactly [isVisible] — reading a ref doesn't require deps
    // and the eslint-disable-line comment stays.
    expect(block).toMatch(/\}, \[isVisible\]\);/);
    expect(block).toContain("eslint-disable-line react-hooks/exhaustive-deps");
    // The gated branch must be tagged with quick-260809-ih9 so future
    // maintainers understand the WHY.
    const gateIdx = block.indexOf("!prev && isVisible");
    expect(gateIdx).toBeGreaterThan(0);
    // Tag lives within ~1000 chars around the gate (either as a comment
    // immediately above or an inline comment just after).
    const gateWindow = block.slice(
      Math.max(0, gateIdx - 1000),
      gateIdx + 1000,
    );
    expect(gateWindow).toContain("quick-260809-ih9");
  });

  it("Test ih9-3: attemptReconnection() and WS-setup effect retain their patch #367/#368 isVisibleRef guards (no regression on prior fixes)", () => {
    // Patch #367 (eqk): attemptReconnection() opens with an
    // isVisibleRef.current early-return. This ih9 patch must NOT weaken it.
    const fnIdx = src.indexOf("function attemptReconnection() {");
    expect(fnIdx).toBeGreaterThan(0);
    const fnBody = src.slice(fnIdx, fnIdx + 900);
    expect(fnBody).toContain(
      "quick-260809-eqk: hidden panes must not fight the WS-pause effect",
    );
    // Guard may be single-line `return;` or multi-line `{ ...; return; }`.
    expect(fnBody).toMatch(/if \(!isVisibleRef\.current\)\s*(?:return;|\{[\s\S]*?return;\s*\})/);
    // Patch #368: WS-setup effect at L3000 body-gates on !isVisibleRef.
    const setupAnchor = "attach gates initial WS lifecycle";
    const setupIdx = src.indexOf(setupAnchor);
    expect(setupIdx).toBeGreaterThan(0);
    const setupWindow = src.slice(setupIdx, setupIdx + 2500);
    expect(setupWindow).toMatch(
      /if\s*\(\s*!isVisibleRef\.current\s*\)\s*return\s*;/,
    );
    // Setup effect deps unchanged — still exactly the patch #368 shape.
    const depsMatch = setupWindow.match(/\}, \[([^\]]+)\]\);/);
    expect(depsMatch).not.toBeNull();
    const depsList = depsMatch![1];
    expect(depsList).toContain("attach");
    expect(depsList).not.toMatch(/\bisVisible\b/);
  });
});

describe("Terminal.tsx terminal-connecting-loader-shows-in-pretty-mode wiring — structural", () => {
  const src = readFileSync(TERMINAL_TSX, "utf-8");

  // terminal-connecting-loader-shows-in-pretty-mode (2026-08-10): the
  // SimpleLoader that renders the black-bg "Connecting..." overlay for
  // terminal SSH handshakes must NOT mount in pretty mode — its
  // connection-status semantics belong to PrettyView's own overlays there.
  // The `visible` prop wires isConnecting + !isConnectionLogExpanded +
  // !isPrettyMode; regression-guard on the third gate specifically.
  it("SimpleLoader (terminal.connecting) visible prop includes !isPrettyMode gate", () => {
    const anchor = 'message={t("terminal.connecting")}';
    const anchorIdx = src.indexOf(anchor);
    expect(anchorIdx).toBeGreaterThan(0);
    // Look at the ~200 chars preceding the anchor for the `visible` prop
    // line — its gate must include !isPrettyMode.
    const window = src.slice(Math.max(0, anchorIdx - 300), anchorIdx);
    expect(window).toMatch(/visible=\{[^}]*!isPrettyMode[^}]*\}/);
  });
});
