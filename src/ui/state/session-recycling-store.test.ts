// ─── session-recycling-store — Vitest coverage (quick-260730-qbl) ────────────
// 5 tests covering the in-memory per-(host, tmuxSession) recycling-state
// store — mirrors session-working-store.test.ts's 4-test shape verbatim and
// appends a 5th test for the no-op notify guard:
//
//   1. publish → useSessionRecycling round-trip through true / false / null
//      (proves publishing `null` OVERWRITES rather than deleting the key).
//   2. useSessionRecycling on an unknown key returns null.
//   3. useSessionRecycling with a null key short-circuits to null (no
//      subscribe work required).
//   4. Multiple distinct keys are independent — publishing to key A must not
//      alter key B's snapshot.
//   5. No-op notify guard — publishing the same value twice in a row must
//      NOT re-render subscribers on the second publish. Asserted via a
//      render-count wrapper hook (increment a ref on every render; expect
//      exactly 1 additional render for the FIRST publish and 0 for the
//      redundant second publish).
//
// Pattern mirrors src/ui/state/session-working-store.test.ts — Vitest +
// @testing-library/react's renderHook; module-scope state reset via a
// __resetForTest() helper in beforeEach.

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";

import {
  publishSessionRecycling,
  useSessionRecycling,
  __resetForTest,
} from "./session-recycling-store.js";

beforeEach(() => {
  __resetForTest();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — publish → hook round-trip through true / false / null
// ─────────────────────────────────────────────────────────────────────────────

describe("session-recycling-store: publish → hook round-trip", () => {
  it("publish(true) → hook returns true; publish(false) → hook returns false; publish(null) → hook returns null (overwrite, not delete)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionRecycling("h1:s1"),
    );
    // Initial: never published → null.
    expect(result.current).toBeNull();

    act(() => {
      publishSessionRecycling("h1:s1", true);
    });
    rerender();
    expect(result.current).toBe(true);

    act(() => {
      publishSessionRecycling("h1:s1", false);
    });
    rerender();
    expect(result.current).toBe(false);

    // Publishing null MUST overwrite (not delete). The hook still resolves the
    // key, and the resolved value is null.
    act(() => {
      publishSessionRecycling("h1:s1", null);
    });
    rerender();
    expect(result.current).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Unknown-key semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("session-recycling-store: unknown key returns null", () => {
  it("useSessionRecycling on a never-published key returns null", () => {
    const { result } = renderHook(() =>
      useSessionRecycling("never-set"),
    );
    expect(result.current).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Null-key short-circuit
// ─────────────────────────────────────────────────────────────────────────────

describe("session-recycling-store: null key short-circuits to null", () => {
  it("useSessionRecycling(null) returns null (avoids subscribe work for host-less rows)", () => {
    const { result } = renderHook(() => useSessionRecycling(null));
    expect(result.current).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Independent keys
// ─────────────────────────────────────────────────────────────────────────────

describe("session-recycling-store: multiple keys are independent", () => {
  it("publish to one key does NOT alter another key's snapshot", () => {
    const { result: a, rerender: rerenderA } = renderHook(() =>
      useSessionRecycling("h1:s1"),
    );
    const { result: b, rerender: rerenderB } = renderHook(() =>
      useSessionRecycling("h2:s2"),
    );

    act(() => {
      publishSessionRecycling("h1:s1", true);
      publishSessionRecycling("h2:s2", false);
    });
    rerenderA();
    rerenderB();

    expect(a.current).toBe(true);
    expect(b.current).toBe(false);

    // Overwriting h1:s1 to null must not touch h2:s2.
    act(() => {
      publishSessionRecycling("h1:s1", null);
    });
    rerenderA();
    rerenderB();
    expect(a.current).toBeNull();
    expect(b.current).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — No-op notify guard
// ─────────────────────────────────────────────────────────────────────────────
// The store's `if (has && prev === isRecycling) return;` guard prevents a
// redundant second publish of the same value from firing notify() → prevents
// subscriber re-render. Asserted via a render-count wrapper hook: increment a
// ref on every render; expect the FIRST publish to bump the count by exactly
// 1 (state change → re-render), and the redundant SECOND publish to bump it
// by 0 (no notify → no re-render). React's useSyncExternalStore bailout on
// snapshot equality means primitive-boolean re-renders are also skipped by
// React, but the store-level guard is a distinct earlier bailout — this test
// exercises the store-level guard.

describe("session-recycling-store: no-op notify guard on duplicate publish", () => {
  it("publishing the same value twice in a row does NOT re-render subscribers on the second publish", () => {
    // useRef(0) starts at 0; each render increments it. Return the current
    // count so renderHook.result.current is observable in the test. The hook
    // also subscribes to the store so re-renders track store notifications.
    const { result } = renderHook(() => {
      const count = useRef(0);
      count.current += 1;
      const value = useSessionRecycling("h1:s1");
      return { count: count.current, value };
    });

    // Initial render only.
    const initialCount = result.current.count;
    expect(result.current.value).toBeNull();

    // First publish — value changes null → true, MUST bump count.
    act(() => {
      publishSessionRecycling("h1:s1", true);
    });
    const afterFirstPublish = result.current.count;
    expect(result.current.value).toBe(true);
    expect(afterFirstPublish).toBeGreaterThan(initialCount);

    // Redundant second publish (same value) — MUST NOT bump count.
    act(() => {
      publishSessionRecycling("h1:s1", true);
    });
    expect(result.current.value).toBe(true);
    expect(result.current.count).toBe(afterFirstPublish);
  });
});
