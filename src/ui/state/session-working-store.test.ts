// ─── session-working-store — Vitest coverage (patch #137, extended #260806-ixl) ─
// 11 tests (A–K) covering the composite { ttyBusy, hasBgWork } working-state
// store and the derived useSessionIsWorking hook:
//
//   A. publishSessionTtyBusy(k, true) alone → useSessionIsWorking returns true.
//   B. publishSessionTtyBusy(k, false) alone → returns false.
//   C. publishSessionHasBackgroundedWork(k, true) alone → returns true.
//   D. both true → true; both false → false.
//   E. ttyBusy=null + hasBgWork=false → false (null PTY does NOT false-positive).
//   F. ttyBusy=null + hasBgWork=true → true (hasBgWork dominates unknown ttyBusy).
//   G. no-op notify guard, ttyBusy field: unchanged ttyBusy publish after an
//      intervening hasBgWork publish does NOT re-notify.
//   H. mirror of G for hasBgWork field.
//   I. Unknown key → useSessionIsWorking returns false (was null in old API).
//   J. Null key → useSessionIsWorking(null) returns false (short-circuit).
//   K. Multiple keys are independent.
//
// Pattern mirrors src/ui/state/conversation-store.test.ts — Vitest +
// @testing-library/react's renderHook; module-scope state reset via a
// __resetForTest() helper in beforeEach.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  publishSessionTtyBusy,
  publishSessionHasBackgroundedWork,
  useSessionIsWorking,
  getSessionWorkingSnapshot,
  __resetForTest,
} from "./session-working-store.js";

beforeEach(() => {
  __resetForTest();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test A — ttyBusy=true alone → isWorking true
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test A — ttyBusy=true alone", () => {
  it("publishSessionTtyBusy(k, true) → useSessionIsWorking returns true", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );
    expect(result.current).toBe(false); // unknown → false

    act(() => {
      publishSessionTtyBusy("h1:s1", true);
    });
    rerender();
    expect(result.current).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test B — ttyBusy=false alone → isWorking false
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test B — ttyBusy=false alone", () => {
  it("publishSessionTtyBusy(k, false) → useSessionIsWorking returns false", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishSessionTtyBusy("h1:s1", false);
    });
    rerender();
    expect(result.current).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test C — hasBgWork=true alone → isWorking true
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test C — hasBgWork=true alone", () => {
  it("publishSessionHasBackgroundedWork(k, true) alone → useSessionIsWorking returns true", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );
    expect(result.current).toBe(false); // unknown → false

    act(() => {
      publishSessionHasBackgroundedWork("h1:s1", true);
    });
    rerender();
    expect(result.current).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test D — both true → true; both false → false
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test D — composite logic", () => {
  it("both ttyBusy=true and hasBgWork=true → true; then cleared → false", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishSessionTtyBusy("h1:s1", true);
      publishSessionHasBackgroundedWork("h1:s1", true);
    });
    rerender();
    expect(result.current).toBe(true);

    // Clear both
    act(() => {
      publishSessionTtyBusy("h1:s1", false);
      publishSessionHasBackgroundedWork("h1:s1", false);
    });
    rerender();
    expect(result.current).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test E — ttyBusy=null + hasBgWork=false → false (no false-positive)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test E — null ttyBusy + no bg work → false", () => {
  it("ttyBusy=null + hasBgWork=false → useSessionIsWorking returns false", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    // Publish null ttyBusy (unknown PTY) + false hasBgWork
    act(() => {
      publishSessionTtyBusy("h1:s1", null);
      publishSessionHasBackgroundedWork("h1:s1", false);
    });
    rerender();
    expect(result.current).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test F — ttyBusy=null + hasBgWork=true → true (hasBgWork dominates)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test F — null ttyBusy + hasBgWork=true → true", () => {
  it("ttyBusy=null + hasBgWork=true → useSessionIsWorking returns true", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishSessionTtyBusy("h1:s1", null);
      publishSessionHasBackgroundedWork("h1:s1", true);
    });
    rerender();
    expect(result.current).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test G — no-op guard for ttyBusy field (per-field independence)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test G — ttyBusy no-op guard is per-field", () => {
  it("unchanged ttyBusy after an intervening hasBgWork publish does NOT re-notify", () => {
    // Set initial state: ttyBusy=true, hasBgWork=false.
    act(() => {
      publishSessionTtyBusy("h1:s1", true);
    });

    // Capture snapshot reference BEFORE the intervening hasBgWork publish.
    const snapBefore = getSessionWorkingSnapshot();

    // Publish hasBgWork — this MUST notify (hasBgWork changed).
    act(() => {
      publishSessionHasBackgroundedWork("h1:s1", true);
    });

    // The snapshot reference should have changed (hasBgWork updated).
    const snapAfterBgWork = getSessionWorkingSnapshot();
    expect(snapAfterBgWork).not.toBe(snapBefore);

    // Now publish SAME ttyBusy (true again, unchanged). Per-field guard should
    // skip notify — the snapshot reference MUST stay the same.
    const snapBeforeSameTtyBusy = getSessionWorkingSnapshot();
    act(() => {
      publishSessionTtyBusy("h1:s1", true); // unchanged
    });
    const snapAfterSameTtyBusy = getSessionWorkingSnapshot();
    expect(snapAfterSameTtyBusy).toBe(snapBeforeSameTtyBusy);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test H — no-op guard for hasBgWork field (mirror of G)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test H — hasBgWork no-op guard is per-field", () => {
  it("unchanged hasBgWork after an intervening ttyBusy publish does NOT re-notify", () => {
    // Set initial state: hasBgWork=true, ttyBusy=null.
    act(() => {
      publishSessionHasBackgroundedWork("h1:s1", true);
    });

    // Capture snapshot before the intervening ttyBusy publish.
    const snapBefore = getSessionWorkingSnapshot();

    // Publish ttyBusy — this MUST notify (ttyBusy changed from null).
    act(() => {
      publishSessionTtyBusy("h1:s1", false);
    });

    // Snapshot reference should have changed.
    const snapAfterTtyBusy = getSessionWorkingSnapshot();
    expect(snapAfterTtyBusy).not.toBe(snapBefore);

    // Now publish SAME hasBgWork (true, unchanged). Guard should skip notify.
    const snapBeforeSameHasBgWork = getSessionWorkingSnapshot();
    act(() => {
      publishSessionHasBackgroundedWork("h1:s1", true); // unchanged
    });
    const snapAfterSameHasBgWork = getSessionWorkingSnapshot();
    expect(snapAfterSameHasBgWork).toBe(snapBeforeSameHasBgWork);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test I — Unknown key → false (not null, per new API contract)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test I — unknown key returns false", () => {
  it("useSessionIsWorking on a never-published key returns false (was null in old API)", () => {
    const { result } = renderHook(() =>
      useSessionIsWorking("never-set"),
    );
    expect(result.current).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test J — Null key → false, no subscribe
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test J — null key short-circuits to false", () => {
  it("useSessionIsWorking(null) returns false (avoids subscribe work for host-less rows)", () => {
    const { result } = renderHook(() => useSessionIsWorking(null));
    expect(result.current).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test K — Multiple keys are independent
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test K — multiple keys are independent", () => {
  it("publishing to key A does NOT alter key B's composite state", () => {
    const { result: a, rerender: rerenderA } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );
    const { result: b, rerender: rerenderB } = renderHook(() =>
      useSessionIsWorking("h2:s2"),
    );

    act(() => {
      publishSessionTtyBusy("h1:s1", true);
      publishSessionHasBackgroundedWork("h2:s2", true);
    });
    rerenderA();
    rerenderB();

    expect(a.current).toBe(true);
    expect(b.current).toBe(true);

    // Setting key A's ttyBusy to false + hasBgWork to false must not change B.
    act(() => {
      publishSessionTtyBusy("h1:s1", false);
      publishSessionHasBackgroundedWork("h1:s1", false);
    });
    rerenderA();
    rerenderB();
    expect(a.current).toBe(false);
    expect(b.current).toBe(true); // key B unchanged

    // Publishing hasBgWork=false on B should clear it.
    act(() => {
      publishSessionHasBackgroundedWork("h2:s2", false);
    });
    rerenderA();
    rerenderB();
    expect(a.current).toBe(false); // key A still false
    expect(b.current).toBe(false);
  });
});
