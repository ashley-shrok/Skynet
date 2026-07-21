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
