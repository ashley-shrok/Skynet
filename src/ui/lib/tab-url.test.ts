// ─── tab-url.test.ts ───────────────────────────────────────────────────────
// Phase 56 Plan 02 Task 2 — vitest suite for the tab-url WorkspaceSpec
// widening. See:
//   .planning/phases/56-visual-session-management-foundation-recursive-split-tree-da/56-02-PLAN.md
//
// The tab-url module is small and pure; this suite focuses on the Plan 56-02
// additive-only widening: `WorkspaceSpec.splitTree?: string` round-trips
// through encodeWorkspaceSpec → URLSearchParams → consumePendingWorkspace,
// AND backward-compat is preserved for URLs without split-tree params.
//
// Tests:
//   Test 1  encodeWorkspaceSpec splices s=/t= into the outer param set;
//           consumePendingWorkspace extracts them back into the round-trip
//           splitTree string.
//   Test 2  URLs WITHOUT s=/t= parse correctly (splitTree undefined) —
//           backward-compat regression guard.
//
// consumePendingWorkspace touches window.location + window.sessionStorage;
// the frontend project uses jsdom by default so those are already stubbed.
// We drive the reads by writing to window.location.hash directly and
// clearing sessionStorage in beforeEach.

import { describe, it, expect, beforeEach } from "vitest";
import {
  encodeWorkspaceSpec,
  consumePendingWorkspace,
  type WorkspaceSpec,
  type TabSpec,
} from "./tab-url";

beforeEach(() => {
  // Clean slate: strip any lingering sessionStorage snapshot from prior
  // tests + reset the hash to a known-empty state.
  window.sessionStorage.clear();
  window.history.replaceState(null, "", window.location.pathname);
});

describe("tab-url — WorkspaceSpec.splitTree widening (Phase 56 Plan 02)", () => {
  it("Test 1: splitTree round-trips through encode/consume", () => {
    const specs: TabSpec[] = [
      { protocol: "tmux", host: "host1", session: "aqua" },
      { protocol: "tmux", host: "host1", session: "nelly" },
    ];
    // Emulate the shape encodeSplitTreeToUrl would emit for a two-leaf tree.
    const splitTreeFragment =
      "s=tmux%3Ahost1%3Aaqua~tmux%3Ahost1%3Anelly&t=v(0%2C1)";
    const ws: WorkspaceSpec = {
      tabs: specs,
      splitTree: splitTreeFragment,
    };
    const encoded = encodeWorkspaceSpec(ws);
    const parsed = new URLSearchParams(encoded);
    // The `s` and `t` params must appear in the outer encoded string.
    expect(parsed.get("s")).toBe("tmux:host1:aqua~tmux:host1:nelly");
    expect(parsed.get("t")).toBe("v(0,1)");

    // Round-trip through the URL fragment via consumePendingWorkspace.
    window.history.replaceState(null, "", `#${encoded}`);
    const back = consumePendingWorkspace();
    expect(back).not.toBeNull();
    expect(back!.tabs.length).toBe(2);
    expect(back!.tabs[0]).toEqual({
      protocol: "tmux",
      host: "host1",
      session: "aqua",
    });
    expect(back!.tabs[1]).toEqual({
      protocol: "tmux",
      host: "host1",
      session: "nelly",
    });
    // The splitTree field survives as an opaque URLSearchParams-ordered
    // round-trip string; the exact param ordering is URLSearchParams's
    // internal choice, so we assert both s and t are present.
    expect(back!.splitTree).toBeDefined();
    const backParsed = new URLSearchParams(back!.splitTree);
    expect(backParsed.get("s")).toBe("tmux:host1:aqua~tmux:host1:nelly");
    expect(backParsed.get("t")).toBe("v(0,1)");
  });

  it("Test 2: pre-Phase-56 URL without s= / t= parses cleanly (splitTree undefined)", () => {
    // A vintage `#tab=` URL — the pre-Phase-56 shape.
    window.history.replaceState(null, "", "#tab=tmux%3Ahost1%3Aaqua");
    const back = consumePendingWorkspace();
    expect(back).not.toBeNull();
    expect(back!.tabs.length).toBe(1);
    expect(back!.tabs[0]).toEqual({
      protocol: "tmux",
      host: "host1",
      session: "aqua",
    });
    expect(back!.splitTree).toBeUndefined();
  });

  it("Test 3: URL with only `s=` and no `t=` is malformed — splitTree field is dropped", () => {
    // Half-a-splitTree URL. The tab= still parses, but splitTree must be
    // dropped fail-safe (Plan 56-01's decoder returns null on this anyway).
    window.history.replaceState(
      null,
      "",
      "#tab=tmux%3Ahost1%3Aaqua&s=tmux%3Ahost1%3Aaqua",
    );
    const back = consumePendingWorkspace();
    expect(back).not.toBeNull();
    expect(back!.tabs.length).toBe(1);
    expect(back!.splitTree).toBeUndefined();
  });
});

// ─── Phase 97 Plan 05 — relay: protocol grammar widening ─────────────────────
// Extends TabSpec to a discriminated union with a `relay` variant carrying an
// opaque Matrix room ID. See:
//   .planning/phases/97-.../97-05-url-persistence-PLAN.md § Task 1 <behavior>
//
// The relay variant is additive: existing tmux:/terminal:/rdp:/vnc:/telnet:
// tests remain the regression floor (proved by Tests 6 + 7 + 9 below).

import { parseTabParam, encodeTabSpec, specForTab } from "./tab-url";

describe("tab-url — relay: protocol grammar widening (Phase 97 Plan 05)", () => {
  it("Test 1: parseTabParam('relay:%21abcdef%3Amatrix.example.com') returns {protocol: 'relay', roomId}", () => {
    const spec = parseTabParam("relay:%21abcdef%3Amatrix.example.com");
    expect(spec).toEqual({
      protocol: "relay",
      roomId: "!abcdef:matrix.example.com",
    });
  });

  it("Test 2: parseTabParam('relay:') returns null (empty roomId → invalid)", () => {
    expect(parseTabParam("relay:")).toBeNull();
  });

  it("Test 3: encodeTabSpec({protocol: 'relay', roomId}) returns 'relay:<encoded>'", () => {
    const out = encodeTabSpec({
      protocol: "relay",
      roomId: "!abcdef:matrix.example.com",
    });
    // encodeURIComponent leaves `!` and `.` unencoded per RFC 3986; it DOES
    // encode `:` as `%3A`. The exact wire form is `relay:!abcdef%3Amatrix.example.com`.
    // The invariant that matters is round-trip through parseTabParam (Test 8 +
    // Test 10c cover that end-to-end for Matrix-legal chars).
    expect(out).toBe("relay:!abcdef%3Amatrix.example.com");
  });

  it("Test 4: specForTab({type:'terminal', sessionKind:'relay-room', relayRoomId}) returns relay spec", () => {
    const spec = specForTab({
      type: "terminal",
      host: undefined,
      sessionKind: "relay-room",
      relayRoomId: "!abc:example.com",
    });
    expect(spec).toEqual({
      protocol: "relay",
      roomId: "!abc:example.com",
    });
  });

  it("Test 5: specForTab({sessionKind:'relay-room'}) with no relayRoomId returns null (defensive)", () => {
    const spec = specForTab({
      type: "terminal",
      host: undefined,
      sessionKind: "relay-room",
    });
    expect(spec).toBeNull();
  });

  it("Test 6 (regression): parseTabParam('tmux:foo.host:mysession') still returns tmux spec", () => {
    const spec = parseTabParam("tmux:foo.host:mysession");
    expect(spec).toEqual({
      protocol: "tmux",
      host: "foo.host",
      session: "mysession",
    });
  });

  it("Test 7 (regression): encodeTabSpec({protocol:'terminal', host:'foo.host'}) still returns 'terminal:foo.host'", () => {
    const out = encodeTabSpec({ protocol: "terminal", host: "foo.host" });
    expect(out).toBe("terminal:foo.host");
  });

  it("Test 8 (round-trip): parseTabParam(encodeTabSpec({relay, roomId})) matches input", () => {
    const original = {
      protocol: "relay" as const,
      roomId: "!abc:example.com",
    };
    const encoded = encodeTabSpec(original);
    const decoded = parseTabParam(encoded);
    expect(decoded).toEqual(original);
  });

  it("Test 9 (backward compat): legacy multi-tab URL parses without error", () => {
    // A legacy fragment with two tab= entries; verify parseTabParam handles
    // each individually without the relay: extension breaking existing
    // patterns.
    expect(parseTabParam("tmux:foo:bar")).toEqual({
      protocol: "tmux",
      host: "foo",
      session: "bar",
    });
    expect(parseTabParam("terminal:baz")).toEqual({
      protocol: "terminal",
      host: "baz",
    });
  });

  it("Test 10 (over-cap defense): parseTabParam('relay:' + 600 chars) returns null (roomId > 512 rejected)", () => {
    const oversized = "relay:" + "a".repeat(600);
    expect(parseTabParam(oversized)).toBeNull();
  });

  it("Test 10b (at-cap): parseTabParam('relay:' + 512 chars) parses (boundary check)", () => {
    // 512 chars is at the cap and should still parse. 513 fails.
    const at512 = "relay:" + "a".repeat(512);
    const spec = parseTabParam(at512);
    expect(spec).not.toBeNull();
    expect(spec!.protocol).toBe("relay");
  });

  it("Test 10c (round-trip Matrix-legal chars): !, :, ., @, # survive encode/decode", () => {
    // A pathological roomId containing every Matrix-legal special char.
    const pathological = "!room.name@server:matrix.example.com#alias";
    const encoded = encodeTabSpec({
      protocol: "relay",
      roomId: pathological,
    });
    const decoded = parseTabParam(encoded);
    expect(decoded).toEqual({ protocol: "relay", roomId: pathological });
  });

  it("Test 11 (malformed URI encoding): parseTabParam('relay:%ZZ') returns null (URIError → fail-safe)", () => {
    // Phase 97 code-review Fix 5: decodeURIComponent throws URIError on
    // malformed percent-encoding. The parser must catch and return null
    // (matches the function's malformed-input contract), NOT propagate the
    // throw and crash tab restoration.
    expect(parseTabParam("relay:%ZZ")).toBeNull();
    // Stray '%' with no hex pair at all.
    expect(parseTabParam("relay:%")).toBeNull();
    // '%' followed by only one hex digit.
    expect(parseTabParam("relay:%2")).toBeNull();
  });

  // ── Quick 260910-gqi: extend Phase 97 code-review Fix 5 URIError guard to
  // the two remaining parseTabParam branches (tmux + generic-host). Same
  // fail-safe contract as Test 11: malformed percent-encoding → null, never
  // throw. Tests 11b/11c cover tmux host + session slots; Tests 11d-11g
  // cover the generic-host branch across every protocol it handles
  // (terminal/rdp/vnc/telnet). Additive-only — the relay branch (Test 11)
  // is untouched.

  it("Test 11b (tmux host slot malformed URI): parseTabParam('tmux:%ZZ:session') returns null", () => {
    // Malformed percent-encoding in the tmux host component. `decodeURIComponent`
    // currently throws URIError before the `!host || !session` guard runs; the
    // fix wraps both decodes in try/catch and returns null on the URIError path.
    expect(parseTabParam("tmux:%ZZ:session")).toBeNull();
    expect(parseTabParam("tmux:%:session")).toBeNull();
    expect(parseTabParam("tmux:%2:session")).toBeNull();
  });

  it("Test 11c (tmux session slot malformed URI): parseTabParam('tmux:host:%ZZ') returns null", () => {
    // Same fail-safe path as 11b, but the malformed encoding is on the session
    // side of the second colon. Same try/catch covers both decodes.
    expect(parseTabParam("tmux:host:%ZZ")).toBeNull();
    expect(parseTabParam("tmux:host:%")).toBeNull();
    expect(parseTabParam("tmux:host:%2")).toBeNull();
  });

  it("Test 11d (generic-host branch — terminal): parseTabParam('terminal:%ZZ') returns null", () => {
    // Generic-host branch (all non-tmux, non-relay protocols) decodes the
    // whole `rest` as the host. Malformed percent-encoding → URIError →
    // null (never throw). Mirrors Test 11 for the terminal protocol.
    expect(parseTabParam("terminal:%ZZ")).toBeNull();
    expect(parseTabParam("terminal:%")).toBeNull();
    expect(parseTabParam("terminal:%2")).toBeNull();
  });

  it("Test 11e (generic-host branch — rdp): parseTabParam('rdp:%ZZ') returns null", () => {
    expect(parseTabParam("rdp:%ZZ")).toBeNull();
  });

  it("Test 11f (generic-host branch — vnc): parseTabParam('vnc:%ZZ') returns null", () => {
    expect(parseTabParam("vnc:%ZZ")).toBeNull();
  });

  it("Test 11g (generic-host branch — telnet): parseTabParam('telnet:%ZZ') returns null", () => {
    expect(parseTabParam("telnet:%ZZ")).toBeNull();
  });
});
