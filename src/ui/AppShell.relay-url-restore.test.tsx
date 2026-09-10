/**
 * Phase 97 Plan 05 Task 2 — AppShell.relay-url-restore tests.
 *
 * Verifies the structural wiring of relay-protocol handling across three
 * AppShell code paths that must all agree on the relay case:
 *   1. URL-sync effect (~L910-972): specForTab called with sessionKind +
 *      relayRoomId so relay-room tabs emit `relay:<roomId>` into the URL
 *      fragment.
 *   2. splitTreeFragment callback inside the URL-sync effect: same widening
 *      so a relay leaf inside a split tree round-trips through the URL.
 *   3. Tab-restore FIRST loop (~L1256): `if (spec.protocol === "relay")`
 *      branch that calls `openTab(null, "terminal", undefined,
 *      {sessionKind: "relay-room", relayRoomId, ...})` matching the shape at
 *      onRelayRoomRowClick L2169-2176.
 *   4. Tab-restore SECOND loop (~L1344, splitTree resolver): relay-branch
 *      the spec-key builder to `relay:${spec.roomId}` AND the resolver's
 *      fallback walk to match on `t.sessionKind === "relay-room" &&
 *      t.relayRoomId === spec.roomId` (BLOCKER-1 fix — the unpatched second
 *      loop would `.toLowerCase()` an undefined host and mask bugs behind a
 *      `"relay:undefined:"` key).
 *
 * Mounting AppShell is too heavy (30+ imports), so this uses the same
 * structural-grep pattern the sibling AppShell.new-conversation.test.tsx
 * (Phase 91 Plan 05) established. Tests assert the shipped shape of
 * AppShell.tsx's source directly.
 *
 * Tests:
 *   Test 1 — URL-sync specForTab call includes sessionKind + relayRoomId.
 *   Test 2 — splitTreeFragment specForTab call also includes those fields
 *            (relay leaf inside split tree round-trips).
 *   Test 3 — Tab-restore loop 1 has a relay-protocol branch that calls
 *            openTab with sessionKind: "relay-room".
 *   Test 4 — Tab-restore loop 2 (splitTree positional resolver) key builder
 *            AND fallback walk both handle relay via roomId identity
 *            (BLOCKER-1 regression floor).
 *   Test 5 — Structured log with masked roomId localpart at URL restore.
 *   Test 6 — No JSON.stringify on DOM Event (Phase 93 Landmine 6 preserved).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appShellSrc = readFileSync(
  resolve(__dirname, "AppShell.tsx"),
  "utf8",
);

describe("AppShell.tsx — relay URL round-trip wiring (Phase 97 Plan 05)", () => {
  // ─── URL-sync effect: sessionKind + relayRoomId threaded to specForTab ────

  it("Test 1: URL-sync effect passes sessionKind: t.sessionKind to specForTab", () => {
    expect(appShellSrc).toContain("sessionKind: t.sessionKind");
  });

  it("Test 1b: URL-sync effect passes relayRoomId: t.relayRoomId to specForTab", () => {
    expect(appShellSrc).toContain("relayRoomId: t.relayRoomId");
  });

  it("Test 1c: sessionKind: t.sessionKind appears at >= 2 sites (URL-sync loop + splitTreeFragment callback)", () => {
    // Both the top-level URL-sync tabs loop AND the splitTreeFragment
    // callback must pass sessionKind so a relay leaf inside a split tree
    // also round-trips.
    const matches = appShellSrc.match(/sessionKind: t\.sessionKind/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  // ─── Tab-restore loop 1: relay branch calls openTab with relay-room shape ──

  it('Test 2: Tab-restore has an if (spec.protocol === "relay") branch', () => {
    expect(appShellSrc).toContain('spec.protocol === "relay"');
  });

  it("Test 2b: Relay-branch appears at >= 2 tab-restore loops (loop 1 + splitTree loop 2)", () => {
    // BLOCKER-1 gate: both `for (const spec of pending.tabs)` loops MUST
    // relay-branch. The second loop (splitTree positional resolver) is the
    // one iter 1 forgot; iter 2 fixed it.
    const matches = appShellSrc.match(/spec\.protocol === "relay"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("Test 2c: Relay branch calls openTab with sessionKind: 'relay-room'", () => {
    // The exact shape mirrors onRelayRoomRowClick L2169-2176: openTab first
    // arg is null (relay tabs have no fleet host); options bag carries
    // sessionKind: "relay-room" + relayRoomId.
    expect(appShellSrc).toContain('sessionKind: "relay-room"');
    // Options bag also carries relayRoomId: spec.roomId
    expect(appShellSrc).toContain("relayRoomId: spec.roomId");
  });

  // ─── Tab-restore loop 2 (splitTree resolver): key builder + fallback walk ──

  it("Test 3: splitTree resolver builds a relay-flavored key (`relay:${spec.roomId}`)", () => {
    // BLOCKER-1 fix: the second loop's spec-key builder must emit
    // `relay:${spec.roomId}` for the relay variant (NOT `${spec.protocol}:${spec.host}:...`
    // which would produce `"relay:undefined:"` given spec.host is never on relay).
    expect(appShellSrc).toContain("relay:${spec.roomId}");
  });

  it("Test 3b: splitTree resolver fallback walk matches on sessionKind === 'relay-room' && relayRoomId === spec.roomId", () => {
    // BLOCKER-1 regression floor: the fallback walk (when the spec-key map
    // misses) must match relay tabs by roomId identity, not by host lookup.
    expect(appShellSrc).toMatch(
      /t\.sessionKind === "relay-room" && t\.relayRoomId === spec\.roomId/,
    );
  });

  it("Test 3c: spec.roomId appears at >= 4 sites (loop-1 match + loop-1 openTab + loop-2 key + resolver fallback)", () => {
    // BLOCKER-1 gate: all four sites must reference spec.roomId — this
    // catches iter 1's unpatched second-loop path.
    const matches = appShellSrc.match(/spec\.roomId/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  // ─── Structured log with masked localpart ─────────────────────────────────

  it("Test 4: URL restore emits structured log with operation: 'relay_room_url_restore'", () => {
    expect(appShellSrc).toContain('operation: "relay_room_url_restore"');
  });

  it("Test 4b: Structured log includes a masked roomIdLocalpart field, not the raw roomId", () => {
    // Phase 93 Landmine 6 discipline — logs mask the shareable identifier
    // to localpart. NEVER log the full roomId; NEVER JSON.stringify DOM events.
    expect(appShellSrc).toContain("roomIdLocalpart");
  });

  // ─── Regression floor: no JSON.stringify on DOM Event ─────────────────────

  it("Test 5 (regression): No JSON.stringify(e) on DOM Event anywhere in AppShell", () => {
    // Phase 93 Landmine 6: DOM Events are non-enumerable + circular; stringify
    // returns "{}" and hides forensic information. Fleet-wide standing rule.
    expect(appShellSrc).not.toMatch(/JSON\.stringify\(e\)/);
  });

  it("Test 5b (regression): No stringify of the full roomId (localpart-only log emit)", () => {
    // The structured log must only emit the localpart-truncated value, not
    // the full share-sensitive room address.
    const logBlock = appShellSrc.slice(
      appShellSrc.indexOf('operation: "relay_room_url_restore"'),
    );
    // Cut to the closing brace of the log object.
    const closeIdx = logBlock.indexOf("});");
    const scoped = closeIdx > 0 ? logBlock.slice(0, closeIdx) : logBlock;
    // The scoped log block must NOT contain a bare `roomId: spec.roomId` (unmasked).
    expect(scoped).not.toMatch(/roomId: spec\.roomId/);
  });

  // ─── Regression floor: legacy session tab paths intact ────────────────────

  it("Test 6 (regression): existing host-lookup code path preserved (needle = spec.host.toLowerCase)", () => {
    // The relay branch must not have replaced the existing session-tab logic
    // — both paths coexist. The needle-lowercase pattern still lives in the
    // else-branches of both loops.
    expect(appShellSrc).toContain("spec.host.toLowerCase()");
  });

  it("Test 6b (regression): onRelayRoomRowClick canonical open shape preserved (openTab reference site)", () => {
    // The canonical open shape at L2169-2176 is what the tab-restore relay
    // branch mirrors. If the sidebar-click path drifted this test catches it.
    expect(appShellSrc).toContain(
      'relayRoomId: row.roomId',
    );
  });
});
