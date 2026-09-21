// ─── ready-cue-latch-store — Vitest coverage (Phase 126 Plan 02, Task 1) ─────
//
// Six tests (A–F) covering the per-row armed:boolean latch state machine per
// 126-CONTEXT.md D-25:
//
//   A. armRow flips unarmed→armed                     (D-25 case i)
//   B. disarmRow flips armed→unarmed                  (D-25 case ii disarm half)
//   C. isRowArmed on unknown key returns false        (D-25 case iii)
//   D. Multiple armRow calls collapse to armed=true   (D-25 case iv)
//   E. disarmRow on already-false is a no-op          (D-25 case v)
//   F. Multiple keys are independent                  (belt-and-suspenders)
//
// The store is pure module-scope state, so `beforeEach(__resetForTest)`
// isolates each test — same pattern as session-working-store.test.ts:46.
//
// The end-to-end integration path (arm-then-fire-then-disarm in a single
// user work cycle) is covered by PrettyView.ready-cue.test.tsx Test 7
// (flicker collapse), which imports the REAL store from this file and
// drives it through PrettyView.

import { describe, it, expect, beforeEach } from "vitest";

import {
  armRow,
  disarmRow,
  isRowArmed,
  __resetForTest,
} from "./ready-cue-latch-store.js";

beforeEach(() => {
  __resetForTest();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test A — armRow flips unarmed→armed (D-25 case i)
// ─────────────────────────────────────────────────────────────────────────────

describe("ready-cue-latch-store: Test A — armRow flips unarmed→armed", () => {
  it("armRow sets the entry to true; isRowArmed subsequently returns true", () => {
    expect(isRowArmed("k")).toBe(false);
    armRow("k");
    expect(isRowArmed("k")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test B — disarmRow flips armed→unarmed (D-25 case ii disarm half)
// ─────────────────────────────────────────────────────────────────────────────

describe("ready-cue-latch-store: Test B — disarmRow flips armed→unarmed", () => {
  it("after armRow + disarmRow the entry is false; isRowArmed returns false", () => {
    armRow("k");
    expect(isRowArmed("k")).toBe(true);
    disarmRow("k");
    expect(isRowArmed("k")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test C — isRowArmed on unknown key returns false (D-25 case iii)
// ─────────────────────────────────────────────────────────────────────────────

describe("ready-cue-latch-store: Test C — isRowArmed on unknown key is false", () => {
  it("isRowArmed on a never-armed key returns false (the 'does NOT fire when unarmed' precondition)", () => {
    expect(isRowArmed("never-armed")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test D — multiple armRow calls collapse to a single armed=true (D-25 case iv)
// ─────────────────────────────────────────────────────────────────────────────

describe("ready-cue-latch-store: Test D — multiple armRow calls collapse", () => {
  it("three consecutive armRow calls leave the entry at true; a single disarmRow flips it to false", () => {
    // The load-bearing behavior: multiple bubbles within a single work cycle
    // arm the latch multiple times, but the store's set-to-true is idempotent
    // — the terminal fire+disarm at WIP-off runs exactly once (D-04). The
    // PrettyView-scope test at PrettyView.ready-cue.test.tsx Test 7 verifies
    // the end-to-end multi-bubble-single-chime behavior; this store-scope
    // test locks the natural encoding.
    armRow("k");
    armRow("k");
    armRow("k");
    expect(isRowArmed("k")).toBe(true);

    disarmRow("k");
    expect(isRowArmed("k")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test E — disarmRow on already-false is a no-op (D-25 case v precondition)
// ─────────────────────────────────────────────────────────────────────────────

describe("ready-cue-latch-store: Test E — disarmRow on already-false is a no-op", () => {
  it("disarmRow on already-false key does not throw; also holds after arm+disarm+repeat-disarm", () => {
    // Two-part assertion in one test to keep the it() count at six per plan.
    // Part 1: never-armed key, back-to-back disarms — no throw, stays false.
    disarmRow("k1");
    disarmRow("k1");
    expect(isRowArmed("k1")).toBe(false);

    // Part 2: arm-then-disarm-then-redisarm — the redisarms remain no-ops.
    armRow("k2");
    disarmRow("k2");
    disarmRow("k2");
    disarmRow("k2");
    expect(isRowArmed("k2")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test F — multiple keys are independent
// ─────────────────────────────────────────────────────────────────────────────

describe("ready-cue-latch-store: Test F — multiple keys are independent", () => {
  it("arming key 'a' and 'b' then disarming 'a' leaves 'b' still armed", () => {
    armRow("a");
    armRow("b");
    expect(isRowArmed("a")).toBe(true);
    expect(isRowArmed("b")).toBe(true);

    disarmRow("a");
    expect(isRowArmed("a")).toBe(false);
    expect(isRowArmed("b")).toBe(true);
  });
});
