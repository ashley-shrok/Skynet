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
