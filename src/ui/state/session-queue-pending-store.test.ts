// ─── session-queue-pending-store — Vitest coverage (quick-260802-w9e) ────────
// 7 tests covering the in-memory per-(host, tmuxSession) queue-pending state
// store that suppresses the patch #137 ready-dot when a ComposeBox has a
// queued idle-send message armed. Extends the dot predicate with the fourth
// gate `!hasQueuePending`. Closes pinned bounty
// `hide-idle-dot-when-queued-message-waiting-to-send`.
//
// This store's type is `Map<string, boolean>` (NOT `Map<string, boolean | null>`
// like session-working-store) — no "unknown" middle state; ComposeBox is the
// SOLE publisher and always knows. `false` is the safe default: "we don't
// know if there's a queue → let the dot render" is the correct behavior.
//
// Pattern mirrors src/ui/state/session-working-store.test.ts — Vitest +
// @testing-library/react's renderHook; module-scope state reset via a
// __resetForTest() helper in beforeEach.

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  publishSessionQueuePending,
  useSessionQueuePending,
  getSessionQueuePendingSnapshot,
  __resetForTest,
} from "./session-queue-pending-store.js";

beforeEach(() => {
  __resetForTest();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — initial useSessionQueuePending("k") returns false (unknown → false)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-queue-pending-store: unknown key returns false", () => {
  it("useSessionQueuePending on a never-published key returns false", () => {
    const { result } = renderHook(() => useSessionQueuePending("never-set"));
    expect(result.current).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — publish(true) → hook returns true
// ─────────────────────────────────────────────────────────────────────────────

describe("session-queue-pending-store: publish(true) → hook returns true", () => {
  it("publish(k, true) → next useSessionQueuePending('k') returns true", () => {
    const { result, rerender } = renderHook(() => useSessionQueuePending("k"));
    // Initial: never published → false.
    expect(result.current).toBe(false);

    act(() => {
      publishSessionQueuePending("k", true);
    });
    rerender();
    expect(result.current).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — publish(false) after publish(true) → hook returns false
//          (key stays present, value flipped — NOT deleted)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-queue-pending-store: publish(false) overwrites (does NOT delete)", () => {
  it("publish(k, true) then publish(k, false) → hook returns false; key remains present in snapshot", () => {
    const { result, rerender } = renderHook(() => useSessionQueuePending("k"));

    act(() => {
      publishSessionQueuePending("k", true);
    });
    rerender();
    expect(result.current).toBe(true);

    act(() => {
      publishSessionQueuePending("k", false);
    });
    rerender();
    expect(result.current).toBe(false);

    // Key MUST still be present in the raw map — false OVERWRITES, does NOT
    // delete. This matches session-working-store semantics for null.
    const snap = getSessionQueuePendingSnapshot();
    expect(snap.has("k")).toBe(true);
    expect(snap.get("k")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — null-key short-circuit → returns false regardless of store state
// ─────────────────────────────────────────────────────────────────────────────

describe("session-queue-pending-store: null key short-circuits to false", () => {
  it("useSessionQueuePending(null) returns false regardless of store contents", () => {
    // Even after populating unrelated keys, a null-key hook still returns false.
    act(() => {
      publishSessionQueuePending("some-key", true);
    });
    const { result } = renderHook(() => useSessionQueuePending(null));
    expect(result.current).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — no-op notify guard: two consecutive publish(k, true) calls produce
//          only ONE notify tick to subscribers.
// ─────────────────────────────────────────────────────────────────────────────

describe("session-queue-pending-store: no-op notify guard", () => {
  it("two consecutive publish(k, true) calls fire only ONE notify (second is deduped)", () => {
    // First call: publish "k" = true (fires notify because key was absent).
    // Second call: publish "k" = true again (must be deduped — has=true AND
    // prev===isWorking).
    let renderCount = 0;
    const { rerender: _rerender } = renderHook(() => {
      renderCount += 1;
      return useSessionQueuePending("k");
    });
    // Initial mount = 1 render.
    const baselineRenders = renderCount;

    act(() => {
      publishSessionQueuePending("k", true);
    });
    // After first publish: exactly one additional render.
    const afterFirst = renderCount;
    expect(afterFirst).toBe(baselineRenders + 1);

    act(() => {
      publishSessionQueuePending("k", true); // no-op — same value
    });
    // Second publish must NOT trigger any additional render.
    expect(renderCount).toBe(afterFirst);

    // Belt-and-suspenders: a THIRD publish with a DIFFERENT value must fire.
    act(() => {
      publishSessionQueuePending("k", false);
    });
    expect(renderCount).toBe(afterFirst + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — __resetForTest() clears state and notifies subscribers
// ─────────────────────────────────────────────────────────────────────────────

describe("session-queue-pending-store: __resetForTest clears state + notifies", () => {
  it("__resetForTest() empties the map and re-notifies subscribers", () => {
    const { result, rerender } = renderHook(() => useSessionQueuePending("k"));

    act(() => {
      publishSessionQueuePending("k", true);
    });
    rerender();
    expect(result.current).toBe(true);

    act(() => {
      __resetForTest();
    });
    rerender();
    // After reset: unknown key → false.
    expect(result.current).toBe(false);
    expect(getSessionQueuePendingSnapshot().size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — getSessionQueuePendingSnapshot() returns the raw internal Map
// ─────────────────────────────────────────────────────────────────────────────

describe("session-queue-pending-store: snapshot helper returns raw Map", () => {
  it("getSessionQueuePendingSnapshot() exposes the raw Map for test inspection", () => {
    act(() => {
      publishSessionQueuePending("a", true);
      publishSessionQueuePending("b", false);
    });
    const snap = getSessionQueuePendingSnapshot();
    expect(snap).toBeInstanceOf(Map);
    expect(snap.size).toBe(2);
    expect(snap.get("a")).toBe(true);
    expect(snap.get("b")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — multiple distinct keys are independent (bonus parity with
//          session-working-store.test.ts's Test 4).
// ─────────────────────────────────────────────────────────────────────────────

describe("session-queue-pending-store: multiple keys are independent", () => {
  it("publish to one key does NOT alter another key's snapshot", () => {
    const { result: a, rerender: rerenderA } = renderHook(() =>
      useSessionQueuePending("h1:s1"),
    );
    const { result: b, rerender: rerenderB } = renderHook(() =>
      useSessionQueuePending("h2:s2"),
    );

    act(() => {
      publishSessionQueuePending("h1:s1", true);
      publishSessionQueuePending("h2:s2", false);
    });
    rerenderA();
    rerenderB();

    expect(a.current).toBe(true);
    expect(b.current).toBe(false);

    // Flipping h1:s1 to false must not touch h2:s2.
    act(() => {
      publishSessionQueuePending("h1:s1", false);
    });
    rerenderA();
    rerenderB();
    expect(a.current).toBe(false);
    expect(b.current).toBe(false);
  });
});
