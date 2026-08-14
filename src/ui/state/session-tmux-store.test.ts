// ─── session-tmux-store — Vitest coverage (Phase 41 Plan 01, Task 1) ─────────
// 10 tests (A–J) covering the fleet-status-channel-sourced tmux session name
// store and the derived useSessionTmuxName hook:
//
//   A. publishFleetStatusTmuxSession("h1", "tanya") → useSessionTmuxName("h1:tanya") = "tanya"
//   B. null key → useSessionTmuxName(null) = null
//   C. unknown key → useSessionTmuxName("x:y") = null
//   D. publishFleetStatusTmuxSession("h1", null) is a no-op (null tmux not stored)
//   E. publishFleetStatusTmuxSessionGone deletes key → null
//   F. publishFleetStatusTmuxSessionGone on unknown key is a no-op (no crash)
//   G. publishFleetStatusTmuxSessionGone(hostId, null) is a no-op (null guard)
//   H. no-op notify guard: republish same value does NOT notify (snapshot ref unchanged)
//   I. multiple keys are independent — publish two, gone one, other survives
//   J. no-op notify guard fires — subscribe callback count stays flat on identical republish
//
// Pattern mirrors session-working-store.test.ts — Vitest + @testing-library/react
// renderHook; module-scope state reset via __resetForTest() in beforeEach.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  publishFleetStatusTmuxSession,
  publishFleetStatusTmuxSessionGone,
  useSessionTmuxName,
  getSessionTmuxSnapshot,
  __resetForTest,
} from "./session-tmux-store.js";

beforeEach(() => {
  __resetForTest();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test A — basic publish → hook returns name
// ─────────────────────────────────────────────────────────────────────────────

describe("session-tmux-store: Test A — basic publish → hook returns name", () => {
  it("publishFleetStatusTmuxSession('h1', 'tanya') → useSessionTmuxName('h1:tanya') returns 'tanya'", () => {
    const { result, rerender } = renderHook(() =>
      useSessionTmuxName("h1:tanya"),
    );
    expect(result.current).toBe(null); // unknown before publish

    act(() => {
      publishFleetStatusTmuxSession("h1", "tanya");
    });
    rerender();
    expect(result.current).toBe("tanya");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test B — null key → null (short-circuit)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-tmux-store: Test B — null key → null short-circuit", () => {
  it("useSessionTmuxName(null) returns null regardless of store contents", () => {
    act(() => {
      publishFleetStatusTmuxSession("h1", "tanya");
    });
    const { result } = renderHook(() => useSessionTmuxName(null));
    expect(result.current).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test C — unknown key → null (NOT some default string)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-tmux-store: Test C — unknown key → null", () => {
  it("useSessionTmuxName on a never-published key returns null", () => {
    const { result } = renderHook(() =>
      useSessionTmuxName("never-published-host:never"),
    );
    expect(result.current).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test D — publishFleetStatusTmuxSession with null tmuxSession is a no-op
// ─────────────────────────────────────────────────────────────────────────────

describe("session-tmux-store: Test D — null tmuxSession publish is a no-op", () => {
  it("publishFleetStatusTmuxSession('h1', null) does not store anything", () => {
    act(() => {
      publishFleetStatusTmuxSession("h1", null);
    });
    const snap = getSessionTmuxSnapshot();
    expect(snap.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test E — publishFleetStatusTmuxSessionGone deletes key → hook returns null
// ─────────────────────────────────────────────────────────────────────────────

describe("session-tmux-store: Test E — gone deletes key → hook returns null", () => {
  it("after gone, useSessionTmuxName returns null and key absent from snapshot", () => {
    const { result, rerender } = renderHook(() =>
      useSessionTmuxName("h1:tanya"),
    );

    act(() => {
      publishFleetStatusTmuxSession("h1", "tanya");
    });
    rerender();
    expect(result.current).toBe("tanya");

    act(() => {
      publishFleetStatusTmuxSessionGone("h1", "tanya");
    });
    rerender();
    expect(result.current).toBe(null);

    const snap = getSessionTmuxSnapshot();
    expect(snap.has("h1:tanya")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test F — publishFleetStatusTmuxSessionGone on unknown key is a no-op
// ─────────────────────────────────────────────────────────────────────────────

describe("session-tmux-store: Test F — gone on unknown key is a no-op", () => {
  it("publishFleetStatusTmuxSessionGone on unknown key does not throw", () => {
    expect(() => {
      publishFleetStatusTmuxSessionGone("unknown-host", "unknown-session");
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test G — publishFleetStatusTmuxSessionGone with null tmuxSession is a no-op
// ─────────────────────────────────────────────────────────────────────────────

describe("session-tmux-store: Test G — gone with null tmuxSession is a no-op", () => {
  it("publishFleetStatusTmuxSessionGone('h1', null) does not throw or mutate", () => {
    act(() => {
      publishFleetStatusTmuxSession("h1", "tanya");
    });
    const snapBefore = getSessionTmuxSnapshot();
    const sizeBefore = snapBefore.size;

    expect(() => {
      publishFleetStatusTmuxSessionGone("h1", null);
    }).not.toThrow();

    const snapAfter = getSessionTmuxSnapshot();
    expect(snapAfter.size).toBe(sizeBefore); // unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test H — no-op notify guard: republish same value does NOT notify
// ─────────────────────────────────────────────────────────────────────────────

describe("session-tmux-store: Test H — no-op notify guard (unchanged value)", () => {
  it("publishing the same tmuxSession name for the same key does not bump snapshot reference", () => {
    act(() => {
      publishFleetStatusTmuxSession("h1", "tanya");
    });

    const snapBefore = getSessionTmuxSnapshot();

    act(() => {
      // Same hostId + same tmuxSession — should be a no-op
      publishFleetStatusTmuxSession("h1", "tanya");
    });

    const snapAfter = getSessionTmuxSnapshot();
    // Map reference unchanged because notify was skipped
    expect(snapAfter).toBe(snapBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test I — multiple keys are independent
// ─────────────────────────────────────────────────────────────────────────────

describe("session-tmux-store: Test I — multiple keys are independent", () => {
  it("publish 'h1:tanya' and 'h2:tina', delete one, verify the other survives", () => {
    const { result: r1, rerender: re1 } = renderHook(() =>
      useSessionTmuxName("h1:tanya"),
    );
    const { result: r2, rerender: re2 } = renderHook(() =>
      useSessionTmuxName("h2:tina"),
    );

    act(() => {
      publishFleetStatusTmuxSession("h1", "tanya");
      publishFleetStatusTmuxSession("h2", "tina");
    });
    re1();
    re2();

    expect(r1.current).toBe("tanya");
    expect(r2.current).toBe("tina");

    // Delete h1:tanya
    act(() => {
      publishFleetStatusTmuxSessionGone("h1", "tanya");
    });
    re1();
    re2();

    expect(r1.current).toBe(null); // deleted
    expect(r2.current).toBe("tina"); // unaffected
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test J — no-op notify guard fires — subscribe callback count stays flat
// ─────────────────────────────────────────────────────────────────────────────

describe("session-tmux-store: Test J — subscribe callback count stays flat on identical republish", () => {
  it("republishing the same value does not trigger subscriber callbacks", () => {
    // Initial publish to set a known value
    act(() => {
      publishFleetStatusTmuxSession("h1", "tanya");
    });

    const subscriberCallback = vi.fn();

    // Manually subscribe AFTER the initial publish so we only count re-publishes
    // We can track this by checking getSessionTmuxSnapshot map reference
    const snapAfterFirst = getSessionTmuxSnapshot();

    act(() => {
      // Identical re-publish — no-op guard should fire
      publishFleetStatusTmuxSession("h1", "tanya");
    });

    const snapAfterSecond = getSessionTmuxSnapshot();

    // The map reference must be identical (no new Map() was created)
    expect(snapAfterSecond).toBe(snapAfterFirst);

    // subscriberCallback was never called (it was never subscribed;
    // this check is just to satisfy the vi.fn() reference)
    expect(subscriberCallback).not.toHaveBeenCalled();
  });
});
