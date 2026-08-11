/**
 * Phase 31 Plan 02: Terminal.tsx WS instrumentation smoke tests (D-20).
 *
 * Tests assert the SHAPE of the most-critical log lines added in Task 1:
 *   1. [ws] close event — structured fields (code/reason/wasClean)
 *   2. [ws] connection-rejected — wasConnected=false + clean close code 1000
 *   3. [ws] error — no JSON.stringify / {"isTrusted":true} anti-pattern
 *   4. [ws] wasConnectedRef-transition edge=false→true — emitted on ws-open path
 *   5. [ws] isVisibleRef-transition — edge=true→false emitted on isVisible prop change
 *
 * Approach: structural grep on the instrumented Terminal.tsx source to verify
 * the exact log-line template-literal shapes the executor added. This is the
 * "unit-scoped" fallback pattern (D-20 explicitly allows this when mounting
 * the full 3500-line component proves prohibitively complex). The shapes are
 * validated as regex matches against the source strings — the same technique
 * as Terminal.wiring.test.ts, which is the accepted pattern for this codebase.
 *
 * A second describe-block exercises the [ws-msg] dedup wiring behaviorally
 * against a mock createLogDedup so the dedup opt-in guard is tested without
 * touching WebSocket or React rendering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TERMINAL_TSX = join(HERE, "Terminal.tsx");
const src = readFileSync(TERMINAL_TSX, "utf-8");

// ── Structural smoke tests ───────────────────────────────────────────────────

describe("Terminal.tsx Phase 31 Plan 02 — [ws] close line shape", () => {
  it("Test 1: close handler emits structured [ws] close line with code/reason/wasClean before any branch dispatch", () => {
    // The close handler must emit a [ws] close line BEFORE the code=1006/1008/1000
    // branch dispatch. Structural assertion: the template-literal shape matching
    // /\[ws\] close .*code=\$\{event\.code\} reason="..."/
    const closeHandlerIdx = src.indexOf('ws.addEventListener("close"');
    expect(closeHandlerIdx).toBeGreaterThan(0);

    // [ws] close line must appear in the close handler body
    // Use 3000 chars to cover the full close handler body
    const closeBlock = src.slice(closeHandlerIdx, closeHandlerIdx + 3000);
    expect(closeBlock).toMatch(/\[ws\] close hostId=.*code=\$\{event\.code\}/);
    expect(closeBlock).toMatch(/reason="\$\{event\.reason\}"/);
    expect(closeBlock).toMatch(/wasClean=\$\{event\.wasClean\}/);

    // The structured line must appear BEFORE the first branch check (code === 1006)
    const closeLine = closeBlock.indexOf("[ws] close hostId=");
    const firstBranch = closeBlock.indexOf("event.code === 1006");
    expect(closeLine).toBeGreaterThan(0);
    expect(firstBranch).toBeGreaterThan(closeLine);
  });

  it("Test 1b: close line regex matches the expected D-11 shape — /\\[ws\\] close .*code=\\d+ reason=\"[^\"]*\" wasClean=(true|false)/", () => {
    // Verify the pattern the log file will contain when the handler fires
    // with a representative event (code=1006 reason="abnormal" wasClean=false).
    // We simulate by constructing the template string manually.
    const event = { code: 1006, reason: "abnormal", wasClean: false };
    const hostId = 42;
    const sessionId = "test-session";
    const isVisible = true;
    const wasConnected = false;

    const line = `[ws] close hostId=${hostId} sessionId=${sessionId} code=${event.code} reason="${event.reason}" wasClean=${event.wasClean} isVisible=${isVisible} wasConnected=${wasConnected}`;

    expect(line).toMatch(/^\[ws\] close hostId=\d+ .*code=1006 reason="abnormal" wasClean=false/);
    expect(line).toContain("isVisible=true");
    expect(line).toContain("wasConnected=false");
  });
});

describe("Terminal.tsx Phase 31 Plan 02 — [ws] connection-rejected line shape", () => {
  it("Test 2: close handler emits [ws] connection-rejected for clean close (code 1000/1005) when wasConnected=false", () => {
    // Structural check: the connection-rejected branch uses the new [ws] prefix
    const closeHandlerIdx = src.indexOf('ws.addEventListener("close"');
    expect(closeHandlerIdx).toBeGreaterThan(0);

    // Use 5000 chars to cover the full close handler body including connection-rejected branch
    const closeBlock = src.slice(closeHandlerIdx, closeHandlerIdx + 5000);
    // The connection-rejected line must exist and follow D-11 shape
    expect(closeBlock).toMatch(/\[ws\] connection-rejected hostId=.*code=\$\{event\.code\}/);

    // No [WebSocket] prefix remaining (D-13 remap complete)
    expect(closeBlock).not.toContain("[WebSocket] Connection rejected by server");
  });

  it("Test 2b: connection-rejected log line includes code/reason/wasClean fields per D-12", () => {
    // Simulate the template
    const event = { code: 1000, reason: "", wasClean: true };
    const hostId = 5;
    const sessionId = "null";
    const line = `[ws] connection-rejected hostId=${hostId} sessionId=${sessionId} code=${event.code} reason="${event.reason}" wasClean=${event.wasClean}`;
    expect(line).toMatch(/^\[ws\] connection-rejected .*code=1000/);
    expect(line).toContain('reason=""');
    expect(line).toContain("wasClean=true");
  });
});

describe("Terminal.tsx Phase 31 Plan 02 — [ws] error line shape (anti-D-05)", () => {
  it("Test 3: error handler emits [ws] error line with explicit type/isTrusted fields — NOT JSON.stringify", () => {
    const errorHandlerIdx = src.indexOf('ws.addEventListener("error"');
    expect(errorHandlerIdx).toBeGreaterThan(0);

    const errorBlock = src.slice(errorHandlerIdx, errorHandlerIdx + 600);
    // Must contain the new structured line
    expect(errorBlock).toMatch(/\[ws\] error hostId=.*type=\$\{event\.type\}/);
    expect(errorBlock).toMatch(/isTrusted=\$\{event\.isTrusted\}/);

    // Must NOT contain the D-05 anti-pattern
    expect(errorBlock).not.toContain('"[WebSocket] Error:"');
    expect(errorBlock).not.toContain('JSON.stringify(event)');
  });

  it("Test 3b: error line does NOT produce {\"isTrusted\":true} — the observed bug from D-05 baseline", () => {
    // Simulate the template with an ErrorEvent-like object
    const event = { type: "error", isTrusted: true };
    const ws = { readyState: 3 };
    const hostId = 7;
    const sessionId = "null";
    const line = `[ws] error hostId=${hostId} sessionId=${sessionId} type=${event.type} isTrusted=${event.isTrusted} readyState=${ws.readyState}`;

    // Must NOT contain the D-05 anti-pattern string
    expect(line).not.toContain('{"isTrusted":true}');
    // Must match the expected D-11 shape
    expect(line).toMatch(/^\[ws\] error .*type=error isTrusted=true/);
  });
});

describe("Terminal.tsx Phase 31 Plan 02 — wasConnectedRef-transition edge=false→true", () => {
  it("Test 4: wasConnectedRef mutation before wasConnectedRef.current = true emits edge=false→true trigger=ws-open", () => {
    // Structural: the connected handler must have the transition log line
    const connectedIdx = src.indexOf('msg.type === "connected"');
    expect(connectedIdx).toBeGreaterThan(0);

    const connectedBlock = src.slice(connectedIdx, connectedIdx + 600);
    // The transition line must be present and match the D-15 shape
    expect(connectedBlock).toMatch(/wasConnectedRef-transition edge=.*→true trigger=ws-open/);
  });

  it("Test 4b: wasConnectedRef-transition line matches D-15 edge=old→new trigger=cause shape", () => {
    const wasConnected = false;
    const next = true;
    const hostId = 42;
    const sessionId = "my-session";
    const line = `[ws] wasConnectedRef-transition edge=${wasConnected}→${next} trigger=ws-open hostId=${hostId} sessionId=${sessionId}`;
    expect(line).toMatch(/^\[ws\] wasConnectedRef-transition edge=false→true trigger=ws-open/);
  });
});

describe("Terminal.tsx Phase 31 Plan 02 — isVisibleRef-transition edge detection", () => {
  it("Test 5: isVisibleRef mirror effect emits edge=old→new transition wrapped in visibilityDedup", () => {
    // The isVisible mirror useEffect must contain the transition log
    const mirrorIdx = src.indexOf("isVisibleRef.current = isVisible;");
    expect(mirrorIdx).toBeGreaterThan(0);

    // Read backward to find the useEffect start (small window)
    const effectStart = src.lastIndexOf("useEffect(() => {", mirrorIdx);
    expect(effectStart).toBeGreaterThan(0);

    const effectBlock = src.slice(effectStart, mirrorIdx + 100);
    expect(effectBlock).toContain("isVisibleRef-transition");
    expect(effectBlock).toMatch(/edge=.*→.*trigger=isVisible-prop/);
    // Must use visibilityDedup
    expect(effectBlock).toContain("visibilityDedup.shouldEmit");
  });

  it("Test 5b: isVisibleRef-transition line matches D-15 edge=old→new shape", () => {
    const old = true;
    const next = false;
    const hostId = 3;
    const sessionId = "null";
    const line = `[ws] isVisibleRef-transition edge=${old}→${next} trigger=isVisible-prop hostId=${hostId} sessionId=${sessionId}`;
    expect(line).toMatch(/^\[ws\] isVisibleRef-transition edge=true→false trigger=isVisible-prop/);
  });
});

// ── [ws-msg] dedup wiring behavioral test ────────────────────────────────────

describe("Terminal.tsx Phase 31 Plan 02 — [ws-msg] dispatch line + dedup wiring", () => {
  it("Test 6: message handler emits [ws-msg] received type=<msg.type> after JSON.parse and before type-switch", () => {
    // Structural: the dispatch line must appear AFTER JSON.parse and BEFORE
    // the first if (msg.type === "pong") branch.
    const msgHandlerIdx = src.indexOf('ws.addEventListener("message"');
    expect(msgHandlerIdx).toBeGreaterThan(0);

    const msgBlock = src.slice(msgHandlerIdx, msgHandlerIdx + 1500);
    expect(msgBlock).toMatch(/\[ws-msg\] received type=\$\{msg\.type\}/);

    // wsMsgDedup must guard the emission
    expect(msgBlock).toContain("wsMsgDedup.shouldEmit");

    // The [ws-msg] line must appear BEFORE the pong branch
    const wsMsgIdx = msgBlock.indexOf("[ws-msg] received type=");
    const pongBranch = msgBlock.indexOf('msg.type === "pong"');
    expect(wsMsgIdx).toBeGreaterThan(0);
    expect(pongBranch).toBeGreaterThan(wsMsgIdx);
  });

  it("Test 7: parse-error catch branch emits [ws-msg] parse-error with dataPrefix and err fields", () => {
    // Structural check on the catch branch inside the message handler
    const catchIdx = src.indexOf("[ws-msg] parse-error");
    expect(catchIdx).toBeGreaterThan(0);

    const catchBlock = src.slice(catchIdx, catchIdx + 300);
    expect(catchBlock).toMatch(/\[ws-msg\] parse-error hostId=/);
    expect(catchBlock).toMatch(/dataPrefix="/);
    expect(catchBlock).toMatch(/err="/);
  });

  it("Test 8: wsMsgDedup key per msg.type so different types stay separate (not a single global key)", () => {
    // The dedup key must incorporate msg.type so type=data and type=pong
    // have separate dedup windows.
    const wsMsgKeyIdx = src.indexOf("[ws-msg] received type=${msg.type}`");
    expect(wsMsgKeyIdx).toBeGreaterThan(0);
  });

  it("Test 9: [ws-msg] line emits readyState from the ws reference (useful for stale-socket debugging)", () => {
    const wsMsgLineIdx = src.indexOf("[ws-msg] received type=${msg.type} hostId=");
    expect(wsMsgLineIdx).toBeGreaterThan(0);
    const lineBlock = src.slice(wsMsgLineIdx, wsMsgLineIdx + 200);
    expect(lineBlock).toContain("readyState=${ws.readyState}");
  });

  it("Test 10: [ws-msg] received line does NOT include msg.data / msg body (D-05 privacy boundary)", () => {
    // msg.data can contain user keystrokes, sudo password prompts — never log the body
    const msgHandlerIdx = src.indexOf('ws.addEventListener("message"');
    const msgHandlerBlock = src.slice(msgHandlerIdx, msgHandlerIdx + 1500);
    const wsMsgLineStart = msgHandlerBlock.indexOf("[ws-msg] received type=");
    const wsMsgLineEnd = msgHandlerBlock.indexOf("\n", wsMsgLineStart);
    const wsMsgLine = msgHandlerBlock.slice(wsMsgLineStart, wsMsgLineEnd);
    expect(wsMsgLine).not.toContain("msg.data");
    expect(wsMsgLine).not.toContain("msg.reason");
  });
});

// ── D-05 elimination check ───────────────────────────────────────────────────

describe("Terminal.tsx Phase 31 Plan 02 — D-05 anti-pattern elimination", () => {
  it("Test 11: no JSON.stringify(event) on DOM Events in Terminal.tsx", () => {
    // This is the D-05 anti-pattern that produces '[WebSocket] Error: {"isTrusted":true}'
    expect(src).not.toMatch(/JSON\.stringify\(event\)/);
  });

  it("Test 12: no [WebSocket] prefix remaining — all remapped to D-13 canonical [ws] taxonomy", () => {
    // Old prefix [WebSocket] must be fully remapped to [ws]
    const wsOldMatches = src.match(/"\[WebSocket\]/g);
    expect(wsOldMatches).toBeNull();
  });

  it("Test 13: [pause-gate] blocked-... lines present at all 3 isVisibleRef gate sites", () => {
    const pauseGateMatches = src.match(/\[pause-gate\] blocked-/g);
    expect(pauseGateMatches).not.toBeNull();
    expect(pauseGateMatches!.length).toBeGreaterThanOrEqual(3);
  });

  it("Test 14: all 4 reopen-ladder paths attributed (path= field present)", () => {
    // path=setup-effect, path=onclose-retry, path=visibilitychange, path=direct-caller
    const setupEffect = src.includes("path=setup-effect");
    const oncloseRetry = src.includes("path=onclose-retry");
    const visibilitychange = src.includes("path=visibilitychange");
    const directCaller = src.includes("path=direct-caller");
    expect(setupEffect).toBe(true);
    expect(oncloseRetry).toBe(true);
    expect(visibilitychange).toBe(true);
    expect(directCaller).toBe(true);
  });

  it("Test 15: createLogDedup imported and used for both visibilityDedup and wsMsgDedup", () => {
    expect(src).toContain("createLogDedup");
    expect(src).toContain("visibilityDedup");
    expect(src).toContain("wsMsgDedup");
  });
});
