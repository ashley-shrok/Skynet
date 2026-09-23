// ─── skew-lock-store — Vitest coverage (Phase 111 Plan 02, task 1) ───────────
// 6 tests covering the module-scope shell-level skew-lock store. First-drift-
// wins idempotency (Test 3), exact-one notify on transition (Test 4), listener
// disposer semantics (Test 5), __resetForTest guard (Test 6).
//
// Store is roll-your-own per Skynet convention (see the six precedents in
// src/ui/state/ — session-queue-pending-store.ts:58 documents the shape:
// "subscribe() returns disposer. No zustand / jotai / redux — the fork rolls
// its own.").

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  lockSkewedSession,
  getSkewLockedSnapshot,
  subscribeSkewLock,
  __resetForTest,
} from "./skew-lock-store.js";

beforeEach(() => {
  __resetForTest();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — initial snapshot is fully-unlocked, all nullable fields null.
// ─────────────────────────────────────────────────────────────────────────────

describe("skew-lock-store: initial snapshot", () => {
  it("getSkewLockedSnapshot() returns fully-unlocked initial state", () => {
    const snap = getSkewLockedSnapshot();
    expect(snap).toEqual({
      locked: false,
      reason: null,
      clientBuild: null,
      serverBuild: null,
      lockedAt: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — lockSkewedSession() transitions to locked with populated fields.
// ─────────────────────────────────────────────────────────────────────────────

describe("skew-lock-store: first lock transitions to locked", () => {
  it("after lockSkewedSession(...), snapshot reflects args + positive lockedAt", () => {
    const before = Date.now();
    lockSkewedSession({
      reason: "response_tag_mismatch",
      clientBuild: "aaa",
      serverBuild: "bbb",
    });
    const after = Date.now();

    const snap = getSkewLockedSnapshot();
    expect(snap.locked).toBe(true);
    expect(snap.reason).toBe("response_tag_mismatch");
    expect(snap.clientBuild).toBe("aaa");
    expect(snap.serverBuild).toBe("bbb");
    expect(typeof snap.lockedAt).toBe("number");
    expect(snap.lockedAt).toBeGreaterThanOrEqual(before);
    expect(snap.lockedAt).toBeLessThanOrEqual(after);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — first-drift-wins idempotency: second lock does NOT overwrite reason.
// ─────────────────────────────────────────────────────────────────────────────

describe("skew-lock-store: idempotent (first-drift-wins)", () => {
  it("second lockSkewedSession call does NOT overwrite reason/build fields", () => {
    lockSkewedSession({
      reason: "response_tag_mismatch",
      clientBuild: "aaa",
      serverBuild: "bbb",
    });
    lockSkewedSession({
      reason: "ws_handshake_mismatch",
      clientBuild: "ccc",
      serverBuild: "ddd",
    });
    const snap = getSkewLockedSnapshot();
    expect(snap.locked).toBe(true);
    // First-drift-wins: reason + build fields preserve the FIRST call's values.
    expect(snap.reason).toBe("response_tag_mismatch");
    expect(snap.clientBuild).toBe("aaa");
    expect(snap.serverBuild).toBe("bbb");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — subscriber receives EXACTLY ONE notify on first lock, ZERO on
// subsequent (idempotent) locks.
// ─────────────────────────────────────────────────────────────────────────────

describe("skew-lock-store: subscribe fires exactly once on transition", () => {
  it("listener called exactly once on first lock; zero times on subsequent locks", () => {
    const listener = vi.fn();
    subscribeSkewLock(listener);
    expect(listener).toHaveBeenCalledTimes(0);

    lockSkewedSession({
      reason: "response_tag_mismatch",
      clientBuild: "aaa",
      serverBuild: "bbb",
    });
    expect(listener).toHaveBeenCalledTimes(1);

    lockSkewedSession({
      reason: "ws_message_tag_mismatch",
      clientBuild: "ccc",
      serverBuild: "ddd",
    });
    expect(listener).toHaveBeenCalledTimes(1); // still 1; idempotent no-notify
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — subscribeSkewLock's returned disposer removes the listener.
// After dispose + reset + fresh lock, the disposed listener is NOT called.
// ─────────────────────────────────────────────────────────────────────────────

describe("skew-lock-store: disposer removes listener", () => {
  it("disposer returned by subscribeSkewLock detaches the listener", () => {
    const listener = vi.fn();
    const dispose = subscribeSkewLock(listener);
    dispose();

    // Verify detachment via a fresh lock after __resetForTest.
    __resetForTest();
    lockSkewedSession({
      reason: "response_tag_mismatch",
      clientBuild: "x",
      serverBuild: "y",
    });
    expect(listener).toHaveBeenCalledTimes(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — __resetForTest resets state AND clears listener set.
// (Guard: only fires when NODE_ENV === "test" — vitest sets this by default.)
// ─────────────────────────────────────────────────────────────────────────────

describe("skew-lock-store: __resetForTest resets state and listeners", () => {
  it("__resetForTest returns state to initial value AND clears listeners", () => {
    const listener = vi.fn();
    subscribeSkewLock(listener);
    lockSkewedSession({
      reason: "response_tag_mismatch",
      clientBuild: "a",
      serverBuild: "b",
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSkewLockedSnapshot().locked).toBe(true);

    __resetForTest();

    // State reset to initial.
    expect(getSkewLockedSnapshot()).toEqual({
      locked: false,
      reason: null,
      clientBuild: null,
      serverBuild: null,
      lockedAt: null,
    });

    // Listener set is cleared — a fresh lock does NOT re-fire the old listener.
    lockSkewedSession({
      reason: "response_tag_mismatch",
      clientBuild: "a",
      serverBuild: "b",
    });
    expect(listener).toHaveBeenCalledTimes(1); // unchanged from before reset
  });
});
