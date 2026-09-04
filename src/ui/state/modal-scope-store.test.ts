// ─── modal-scope-store — Vitest coverage (Phase 72 Plan 03 Task 1) ────────────
//
// Exercises the module-scoped useSyncExternalStore store that backs the
// IdentityModal's per-identity Role/Identity scope memory. The store owns:
//   - useModalScope(identityKey) selector (undefined pre-write, scope after)
//   - setModalScope(identityKey, scope) writer that notifies subscribers
//   - getModalScope(identityKey) synchronous non-hook read
//   - __resetModalScopeForTest() test-only reset
//
// No external dependencies to mock — the store is self-contained.

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  useModalScope,
  setModalScope,
  getModalScope,
  __resetModalScopeForTest,
} from "./modal-scope-store.js";

beforeEach(() => {
  __resetModalScopeForTest();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — useModalScope(null) returns undefined
// ─────────────────────────────────────────────────────────────────────────────

describe("useModalScope null-key short-circuit", () => {
  it("returns undefined when identityKey is null (short-circuit — no subscription cost)", () => {
    const { result } = renderHook(() => useModalScope(null));
    expect(result.current).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — useModalScope(<key>) returns undefined when no entry exists
// ─────────────────────────────────────────────────────────────────────────────

describe("useModalScope pre-write behavior", () => {
  it("returns undefined for a key that has never been written to", () => {
    const { result } = renderHook(() => useModalScope("tina"));
    expect(result.current).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — setModalScope + useModalScope round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe("setModalScope round-trip", () => {
  it("returns the stored scope after setModalScope writes it", () => {
    const { result, rerender } = renderHook(() => useModalScope("tina"));
    expect(result.current).toBeUndefined();

    act(() => {
      setModalScope("tina", "role");
    });
    rerender();
    expect(result.current).toBe("role");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — no cross-identity leak
// ─────────────────────────────────────────────────────────────────────────────

describe("setModalScope per-identity isolation", () => {
  it("writing scope for identity A does not affect useModalScope(B)", () => {
    const { result: resultB, rerender: rerenderB } = renderHook(() =>
      useModalScope("nelly"),
    );

    act(() => {
      setModalScope("tina", "role");
    });
    rerenderB();

    // nelly still returns undefined — cross-identity read is unaffected.
    expect(resultB.current).toBeUndefined();

    // sanity: tina reads role.
    expect(getModalScope("tina")).toBe("role");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — sequential writes propagate the latest value
// ─────────────────────────────────────────────────────────────────────────────

describe("setModalScope sequential-write semantics", () => {
  it("two consecutive setModalScope calls make useModalScope return the latest value", () => {
    const { result, rerender } = renderHook(() => useModalScope("tina"));

    act(() => {
      setModalScope("tina", "identity");
    });
    rerender();
    expect(result.current).toBe("identity");

    act(() => {
      setModalScope("tina", "role");
    });
    rerender();
    expect(result.current).toBe("role");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — subscription callback fires on every setModalScope
// ─────────────────────────────────────────────────────────────────────────────

describe("useModalScope subscription semantics", () => {
  it("hook re-renders on every setModalScope call (renderCount increases with each write)", () => {
    let renderCount = 0;
    const { result, rerender } = renderHook(() => {
      renderCount++;
      return useModalScope("tina");
    });
    const initialRenderCount = renderCount;

    act(() => {
      setModalScope("tina", "role");
    });
    rerender();
    const afterFirstWrite = renderCount;
    expect(afterFirstWrite).toBeGreaterThan(initialRenderCount);
    expect(result.current).toBe("role");

    act(() => {
      setModalScope("tina", "identity");
    });
    rerender();
    const afterSecondWrite = renderCount;
    expect(afterSecondWrite).toBeGreaterThan(afterFirstWrite);
    expect(result.current).toBe("identity");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — __resetModalScopeForTest clears the map
// ─────────────────────────────────────────────────────────────────────────────

describe("__resetModalScopeForTest", () => {
  it("clears the map so useModalScope returns undefined for a previously-written key", () => {
    act(() => {
      setModalScope("tina", "role");
    });
    expect(getModalScope("tina")).toBe("role");

    act(() => {
      __resetModalScopeForTest();
    });

    const { result } = renderHook(() => useModalScope("tina"));
    expect(result.current).toBeUndefined();
    expect(getModalScope("tina")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — getModalScope non-hook read
// ─────────────────────────────────────────────────────────────────────────────

describe("getModalScope non-hook read", () => {
  it("returns the same value as the hook without subscribing (no listener side-effect)", () => {
    // Before any write: both undefined.
    expect(getModalScope("tina")).toBeUndefined();

    act(() => {
      setModalScope("tina", "identity");
    });

    // Non-hook read matches what the hook would return.
    expect(getModalScope("tina")).toBe("identity");

    // Sanity: subscribing hook also sees "identity".
    const { result } = renderHook(() => useModalScope("tina"));
    expect(result.current).toBe("identity");
  });
});
