/**
 * Phase 91 Plan 05 Task 3 — AppShell.new-conversation tests.
 *
 * Verifies the structural wiring of onCreateRelayRoom in AppShell.tsx.
 * Per plan §action: "If a full AppShell mount is too heavy, extract the
 * callback body into a testable inline function OR structural-grep-only tests."
 *
 * These are source-level structural tests (grep-based) as specified in the plan:
 *   Test 1 — canonical openTab signature (4-arg, not 5-arg)
 *   Test 2 — selectConversationDeferred called
 *   Test 3 — touch-device navigation follow-ups present
 *   Test 4 — explicit fleet refresh (getSessionList + updateFleetSessions)
 *   Test 5 — defense-in-depth on missing roomId
 *   Test 6 — structured log at success
 *   Test 7 — structured log on refresh failure
 *   Test 8 — existing onRelayRoomRowClick handler UNCHANGED
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the AppShell source for structural assertions.
const appShellSrc = readFileSync(
  resolve(__dirname, "AppShell.tsx"),
  "utf8",
);

// Extract the onCreateRelayRoom callback block for scoped assertions.
// The block starts at `onCreateRelayRoom={` and ends at the matching `}}`.
function extractCallbackBlock(src: string, marker: string): string {
  const startIdx = src.indexOf(marker);
  if (startIdx === -1) throw new Error(`Marker "${marker}" not found in AppShell.tsx`);
  // Walk forward to find the closing `}}` at the same depth.
  let depth = 0;
  let i = startIdx;
  let started = false;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") { depth++; started = true; }
    if (ch === "}" && started) {
      depth--;
      if (depth === 0) {
        return src.slice(startIdx, i + 1);
      }
    }
    i++;
  }
  return src.slice(startIdx);
}

const createRelayRoomBlock = extractCallbackBlock(
  appShellSrc,
  "onCreateRelayRoom={",
);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AppShell.tsx — onCreateRelayRoom structural wiring (Phase 91 Plan 05)", () => {
  // Test 1: canonical openTab signature (4 args: null, "terminal", undefined, options)
  it('Test 1 (canonical openTab signature): uses 4-arg openTab(null, "terminal", undefined, {...})', () => {
    // The canonical shape mirrors onRelayRoomRowClick at L2155.
    expect(createRelayRoomBlock).toContain('openTab(null, "terminal", undefined, {');
    // Regression guard: must NOT use a 5-arg form (label as positional string between "terminal" and options).
    // Match openTab(null, "terminal", <something-that-is-NOT-undefined>, { which would indicate a 5-arg call.
    expect(createRelayRoomBlock).not.toMatch(
      /openTab\(\s*null\s*,\s*"terminal"\s*,\s*"[^"]*"\s*,/,
    );
  });

  // Test 2: selectConversationDeferred called with the new tab id
  it("Test 2 (selectConversationDeferred called): newTabId flows to selectConversationDeferred", () => {
    expect(createRelayRoomBlock).toContain("selectConversationDeferred(newTabId)");
  });

  // Test 3: touch-device + mobile follow-ups present
  it("Test 3 (touch-device navigation follow-ups): isTouchDevice navigateToView + isMobile setSidebarOpen present", () => {
    expect(createRelayRoomBlock).toContain("if (isTouchDevice) navigateToView()");
    expect(createRelayRoomBlock).toContain("if (isMobile) setSidebarOpen(false)");
  });

  // Test 4: explicit fleet refresh — both getSessionList and updateFleetSessions in the block
  it("Test 4 (explicit fleet refresh): getSessionList() and updateFleetSessions appear inside the callback", () => {
    // W5 fix: getSessionList runs ONCE per page-load, so explicit refresh is required.
    expect(createRelayRoomBlock).toContain("getSessionList()");
    expect(createRelayRoomBlock).toContain("updateFleetSessions(");
  });

  // Test 5: defense-in-depth on missing roomId
  it("Test 5 (defense-in-depth on missing roomId): early-return with log when roomId is falsy", () => {
    expect(createRelayRoomBlock).toContain("new_conversation_modal_missing_room_id");
    // Should return early before calling openTab when roomId is missing.
    const missingRoomBlock = createRelayRoomBlock.slice(
      0,
      createRelayRoomBlock.indexOf("openTab("),
    );
    expect(missingRoomBlock).toContain("return");
  });

  // Test 6: structured log at success — after openTab
  it("Test 6 (structured log at success): console.info with new_conversation_modal_tab_opened after openTab", () => {
    expect(createRelayRoomBlock).toContain("new_conversation_modal_tab_opened");
    // openTab must appear BEFORE the success log.
    const openTabIdx = createRelayRoomBlock.indexOf("openTab(null,");
    const logIdx = createRelayRoomBlock.indexOf("new_conversation_modal_tab_opened");
    expect(openTabIdx).toBeGreaterThan(-1);
    expect(logIdx).toBeGreaterThan(openTabIdx);
  });

  // Test 7: structured log on refresh failure
  it("Test 7 (structured log on refresh failure): catch logs new_conversation_modal_refresh_failed", () => {
    expect(createRelayRoomBlock).toContain("new_conversation_modal_refresh_failed");
    // The refresh failure is inside a catch block.
    const catchIdx = createRelayRoomBlock.indexOf(".catch(");
    const refreshFailIdx = createRelayRoomBlock.indexOf("new_conversation_modal_refresh_failed");
    expect(catchIdx).toBeGreaterThan(-1);
    expect(refreshFailIdx).toBeGreaterThan(catchIdx);
  });

  // Test 8: existing onRelayRoomRowClick UNCHANGED — its unique operation-key strings preserved
  it("Test 8 (existing handler unchanged): relay-room row missing roomId log string is preserved", () => {
    expect(appShellSrc).toContain(
      '"relay-room row missing roomId at AppShell"',
    );
  });

  // Line-order check: openTab BEFORE getSessionList inside the callback
  it("Line-order: openTab appears BEFORE getSessionList (tab is warm before sidebar refresh)", () => {
    const openTabIdx = createRelayRoomBlock.indexOf("openTab(null,");
    const getSessionListIdx = createRelayRoomBlock.indexOf("getSessionList()");
    expect(openTabIdx).toBeGreaterThan(-1);
    expect(getSessionListIdx).toBeGreaterThan(openTabIdx);
  });

  // No JSON.stringify in the new callback block
  it("No JSON.stringify in the onCreateRelayRoom callback block", () => {
    expect(createRelayRoomBlock).not.toContain("JSON.stringify(");
  });

  // sessionKind: "relay-room" present in the new callback
  it('sessionKind: "relay-room" present in onCreateRelayRoom callback', () => {
    expect(createRelayRoomBlock).toContain('sessionKind: "relay-room"');
  });

  // relayRoomId present in the new callback
  it("relayRoomId: present in onCreateRelayRoom options bag", () => {
    expect(createRelayRoomBlock).toContain("relayRoomId:");
  });
});
