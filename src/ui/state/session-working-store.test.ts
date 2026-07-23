// ─── session-working-store — Vitest coverage (patch #137) ────────────────────
// 4 tests covering the in-memory per-(host, tmuxSession) working-state store:
//
//   1. publish → useSessionWorking round-trip through true / false / null
//      (proves publishing `null` OVERWRITES rather than deleting the key).
//   2. useSessionWorking on an unknown key returns null.
//   3. useSessionWorking with a null key short-circuits to null (no subscribe
//      work required).
//   4. Multiple distinct keys are independent — publishing to key A must not
//      alter key B's snapshot.
//
// Pattern mirrors src/ui/state/conversation-store.test.ts — Vitest +
// @testing-library/react's renderHook; module-scope state reset via a
// __resetForTest() helper in beforeEach.

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  publishSessionWorking,
  useSessionWorking,
  __resetForTest,
} from "./session-working-store.js";

beforeEach(() => {
  __resetForTest();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — publish → hook round-trip through true / false / null
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: publish → hook round-trip", () => {
  it("publish(true) → hook returns true; publish(false) → hook returns false; publish(null) → hook returns null (overwrite, not delete)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionWorking("h1:s1"),
    );
    // Initial: never published → null.
    expect(result.current).toBeNull();

    act(() => {
      publishSessionWorking("h1:s1", true);
    });
    rerender();
    expect(result.current).toBe(true);

    act(() => {
      publishSessionWorking("h1:s1", false);
    });
    rerender();
    expect(result.current).toBe(false);

    // Publishing null MUST overwrite (not delete). The hook still resolves the
    // key, and the resolved value is null.
    act(() => {
      publishSessionWorking("h1:s1", null);
    });
    rerender();
    expect(result.current).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Unknown-key semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: unknown key returns null", () => {
  it("useSessionWorking on a never-published key returns null", () => {
    const { result } = renderHook(() =>
      useSessionWorking("never-set"),
    );
    expect(result.current).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Null-key short-circuit
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: null key short-circuits to null", () => {
  it("useSessionWorking(null) returns null (avoids subscribe work for host-less rows)", () => {
    const { result } = renderHook(() => useSessionWorking(null));
    expect(result.current).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Independent keys
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: multiple keys are independent", () => {
  it("publish to one key does NOT alter another key's snapshot", () => {
    const { result: a, rerender: rerenderA } = renderHook(() =>
      useSessionWorking("h1:s1"),
    );
    const { result: b, rerender: rerenderB } = renderHook(() =>
      useSessionWorking("h2:s2"),
    );

    act(() => {
      publishSessionWorking("h1:s1", true);
      publishSessionWorking("h2:s2", false);
    });
    rerenderA();
    rerenderB();

    expect(a.current).toBe(true);
    expect(b.current).toBe(false);

    // Overwriting h1:s1 to null must not touch h2:s2.
    act(() => {
      publishSessionWorking("h1:s1", null);
    });
    rerenderA();
    rerenderB();
    expect(a.current).toBeNull();
    expect(b.current).toBe(false);
  });
});
