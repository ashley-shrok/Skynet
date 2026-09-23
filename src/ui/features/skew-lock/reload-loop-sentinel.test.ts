// ─── reload-loop-sentinel — Vitest coverage (Phase 111 Plan 02, task 2) ──────
// 6 tests covering the sessionStorage-backed reload-attempt counter that
// defends against Pitfall 4 (RESEARCH.md §Pitfall 4): if the server tag reads
// stale relative to the code it serves, the modal's Reload button would
// trigger an infinite reload loop. This sentinel activates on the FOURTH
// reload within a 60-second sliding window and the modal switches to a
// fatal-mode "please contact support" variant that does NOT reload.
//
// Fail-open on any sessionStorage exception (quota, disabled, parse error) —
// we do not add a second failure mode on top of the first.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  recordReloadAttempt,
  shouldSuppressReload,
} from "./reload-loop-sentinel.js";

const STORAGE_KEY = "skynet_skew_reload_history";

beforeEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — no history → shouldSuppressReload() returns false.
// ─────────────────────────────────────────────────────────────────────────────

describe("reload-loop-sentinel: no history → suppress=false", () => {
  it("shouldSuppressReload() returns false when sessionStorage is empty", () => {
    expect(shouldSuppressReload()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — first three consecutive record() calls do NOT activate suppression.
// Activation is on the FOURTH (>3), per the >3-within-60s rule.
// ─────────────────────────────────────────────────────────────────────────────

describe("reload-loop-sentinel: 1st/2nd/3rd record → suppress=false", () => {
  it("shouldSuppressReload() returns false after 1, 2, or 3 recorded attempts", () => {
    recordReloadAttempt();
    expect(shouldSuppressReload()).toBe(false);

    recordReloadAttempt();
    expect(shouldSuppressReload()).toBe(false);

    recordReloadAttempt();
    expect(shouldSuppressReload()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — four attempts within 60s → suppression activates.
// Uses vi.useFakeTimers to control Date.now() and space attempts by 5s each
// (4 attempts at t=0, 5s, 10s, 15s all fall in the same 60s window).
// ─────────────────────────────────────────────────────────────────────────────

describe("reload-loop-sentinel: 4th attempt within 60s → suppress=true", () => {
  it("shouldSuppressReload() returns true after 4 attempts inside the 60s window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T00:00:00Z"));

    recordReloadAttempt(); // t=0
    vi.advanceTimersByTime(5_000);
    recordReloadAttempt(); // t=5s
    vi.advanceTimersByTime(5_000);
    recordReloadAttempt(); // t=10s
    vi.advanceTimersByTime(5_000);
    recordReloadAttempt(); // t=15s — 4th within 60s window

    expect(shouldSuppressReload()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — four attempts spaced >60s apart → TTL rolls off; suppress=false.
// ─────────────────────────────────────────────────────────────────────────────

describe("reload-loop-sentinel: attempts spaced >60s → TTL rolls off", () => {
  it("shouldSuppressReload() returns false when attempts are >60s apart", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T00:00:00Z"));

    recordReloadAttempt(); // t=0
    vi.advanceTimersByTime(61_000);
    recordReloadAttempt(); // t=61s — first has aged out
    vi.advanceTimersByTime(61_000);
    recordReloadAttempt(); // t=122s
    vi.advanceTimersByTime(61_000);
    recordReloadAttempt(); // t=183s

    // At this point, only the last attempt is within the 60s window.
    expect(shouldSuppressReload()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — values are written to sessionStorage under the documented key.
// ─────────────────────────────────────────────────────────────────────────────

describe("reload-loop-sentinel: sessionStorage key + shape", () => {
  it("recordReloadAttempt writes a JSON-encoded array of timestamps under the documented key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T00:00:00Z"));

    recordReloadAttempt();
    recordReloadAttempt();

    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw as string) as unknown;
    // Shape: either an array of numbers, OR an object with `timestamps: number[]`.
    // Accept either — the plan documents "JSON-encoded array of timestamps"
    // (Test 5 behavior) but the action block shows an object shape
    // `{ timestamps: number[] }`. The suppressive contract is what matters —
    // both encodings satisfy the "an array of timestamps under the key" rule.
    const timestamps: number[] = Array.isArray(parsed)
      ? (parsed as number[])
      : (parsed as { timestamps: number[] }).timestamps;
    expect(Array.isArray(timestamps)).toBe(true);
    expect(timestamps.length).toBe(2);
    expect(typeof timestamps[0]).toBe("number");
    expect(typeof timestamps[1]).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — sessionStorage exception fails open. Simulate by stubbing
// sessionStorage.setItem to throw (quota exceeded scenario).
// ─────────────────────────────────────────────────────────────────────────────

describe("reload-loop-sentinel: sessionStorage exception fails open", () => {
  it("recordReloadAttempt swallows exceptions; shouldSuppressReload returns false", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError (simulated)");
      });
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError (simulated)");
      });

    // Must NOT throw.
    expect(() => recordReloadAttempt()).not.toThrow();
    // Fail-open: no history readable → false.
    expect(shouldSuppressReload()).toBe(false);

    setItemSpy.mockRestore();
    getItemSpy.mockRestore();
  });
});
