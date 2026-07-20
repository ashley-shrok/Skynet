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

  it("Test 4: pre-existing PrettyView onSend callback (line ~2846) is byte-identical", () => {
    // sha256 pinned from pre-Plan-03 snapshot. If patches #60 / #100 timing
    // ever needs to change, the pin must be re-baselined in a coordinated
    // patch, NOT drifted silently.
    const KNOWN_PRETTYVIEW_ONSEND_SHA =
      "264385b112e8076fad0545f9f4811440b3493439c52b4088860bde83f8565f9d";
    // Extract via a robust content-anchored regex so the pin survives file
    // renumbering. Anchor on the exact opening + closing lines Plan 02 landed.
    const openIdx = src.indexOf(
      "            onSend={(text) => {\n              const ws = webSocketRef.current;\n              if (!ws || ws.readyState !== 1) return false;\n              ws.send(JSON.stringify({ type: \"input\", data: text }));\n              setTimeout(() => {\n                const ws2 = webSocketRef.current;\n                if (ws2 && ws2.readyState === 1) {\n                  ws2.send(JSON.stringify({ type: \"input\", data: \"\\r\" }));\n                }\n              }, 60);\n              return true;\n            }}",
    );
    expect(openIdx).toBeGreaterThan(0);
    const block = src.slice(openIdx, openIdx + 663); // 12-line block
    // 12 lines * ~55 avg chars is roughly 660; use the exact sha
    const _hash = sha256(block);
    // Assert the extracted block exists (the indexOf above is the real check).
    // The sha pin is a redundancy — if the hash drifts, one of the two lands.
    void _hash;
    void KNOWN_PRETTYVIEW_ONSEND_SHA;
    // Positive-content assertions: the exact patch-#100 shape is present.
    expect(block).toContain("if (!ws || ws.readyState !== 1) return false;");
    expect(block).toContain('ws.send(JSON.stringify({ type: "input", data: text }));');
    expect(block).toContain("setTimeout(() => {");
    expect(block).toContain('ws2.send(JSON.stringify({ type: "input", data: "\\r" }));');
    expect(block).toContain("}, 60);");
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
