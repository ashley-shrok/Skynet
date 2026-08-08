/**
 * Bounty pretty-view-per-pane-cost-diag (2026-08-08).
 * Unit tests for the singleton diag registry.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerPane,
  collectSnapshots,
  __test_clear,
  __test_size,
  type PaneSnapshot,
} from "./diag-registry";

function fakeSnapshot(paneId: string, overrides: Partial<PaneSnapshot> = {}): PaneSnapshot {
  return {
    kind: "pretty-view",
    paneId,
    hostId: 1,
    tmuxSession: "s1",
    isVisible: null,
    messageCount: 0,
    wsFramesSinceLast: 0,
    domNodeCount: 0,
    ...overrides,
  };
}

describe("diag-registry", () => {
  beforeEach(() => {
    __test_clear();
  });

  it("registerPane stores the fn; collectSnapshots returns exactly one entry", () => {
    const snap = fakeSnapshot("a");
    registerPane("a", () => snap);
    expect(__test_size()).toBe(1);
    const out = collectSnapshots();
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(snap);
  });

  it("collectSnapshots returns one entry per registered pane", () => {
    registerPane("a", () => fakeSnapshot("a", { messageCount: 5 }));
    registerPane("b", () => fakeSnapshot("b", { messageCount: 12 }));
    registerPane("c", () => fakeSnapshot("c", { messageCount: 99 }));
    const out = collectSnapshots();
    expect(out).toHaveLength(3);
    const counts = out.map((s) => s.messageCount);
    expect(counts).toEqual(expect.arrayContaining([5, 12, 99]));
  });

  it("unregister removes the pane; subsequent collect skips it", () => {
    const unreg = registerPane("a", () => fakeSnapshot("a"));
    expect(__test_size()).toBe(1);
    unreg();
    expect(__test_size()).toBe(0);
    expect(collectSnapshots()).toEqual([]);
  });

  it("re-register with same key REPLACES the prior fn (last-writer-wins)", () => {
    registerPane("a", () => fakeSnapshot("a", { messageCount: 1 }));
    registerPane("a", () => fakeSnapshot("a", { messageCount: 2 }));
    expect(__test_size()).toBe(1);
    expect(collectSnapshots()[0].messageCount).toBe(2);
  });

  it("stale unregister (after re-register) does NOT drop the current entry", () => {
    // Race: pane mounts, registers snapshotFn A; pane remounts, unregisters
    // A (which fired late) then registers B. The stale A-unregister must
    // NOT remove B from the registry.
    const unregA = registerPane("a", () => fakeSnapshot("a", { messageCount: 1 }));
    registerPane("a", () => fakeSnapshot("a", { messageCount: 2 }));
    unregA(); // stale — the guarded delete should be a no-op
    expect(__test_size()).toBe(1);
    expect(collectSnapshots()[0].messageCount).toBe(2);
  });

  it("a snapshot fn that throws is skipped; other panes still collect", () => {
    registerPane("good", () => fakeSnapshot("good", { messageCount: 1 }));
    registerPane("bad", () => {
      throw new Error("boom");
    });
    registerPane("good2", () => fakeSnapshot("good2", { messageCount: 3 }));
    const out = collectSnapshots();
    expect(out).toHaveLength(2);
    const ids = out.map((s) => s.paneId).sort();
    expect(ids).toEqual(["good", "good2"]);
  });

  it("empty registry returns an empty array (no throw)", () => {
    expect(collectSnapshots()).toEqual([]);
  });
});
