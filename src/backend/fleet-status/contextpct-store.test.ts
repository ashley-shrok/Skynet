/**
 * contextpct-store.test.ts
 *
 * Phase 90 Wave 0 Task 1 — tests for the per-session contextPct shared map.
 * Behaviors 1-5 from 90-00-PLAN.md.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  setContextPct,
  getContextPct,
  deleteContextPct,
  __clearAllContextPctForTests,
} from "./contextpct-store.js";

describe("contextpct-store", () => {
  beforeEach(() => {
    __clearAllContextPctForTests();
  });

  it("Test 1: setContextPct stores the value; getContextPct returns it (round-trip)", () => {
    setContextPct(42, "tina", 65);
    expect(getContextPct(42, "tina")).toBe(65);
  });

  it("Test 2: getContextPct returns null for an unknown session key (never throws)", () => {
    expect(getContextPct(99, "never-set")).toBeNull();
    // Never-set key on a hostId that HAS been used for another session — also null.
    setContextPct(42, "tina", 65);
    expect(getContextPct(42, "someone-else")).toBeNull();
  });

  it("Test 3: setContextPct with null explicitly stores null; subsequent get returns null", () => {
    setContextPct(42, "tina", null);
    expect(getContextPct(42, "tina")).toBeNull();
    // A subsequent set to a number overwrites null.
    setContextPct(42, "tina", 55);
    expect(getContextPct(42, "tina")).toBe(55);
    // Then flipping back to null is honored.
    setContextPct(42, "tina", null);
    expect(getContextPct(42, "tina")).toBeNull();
  });

  it("Test 4: deleteContextPct removes the entry; subsequent get returns null", () => {
    setContextPct(42, "tina", 65);
    expect(getContextPct(42, "tina")).toBe(65);
    deleteContextPct(42, "tina");
    expect(getContextPct(42, "tina")).toBeNull();
    // Idempotent — deleting an absent key does not throw.
    expect(() => deleteContextPct(42, "tina")).not.toThrow();
  });

  it("Test 5: session key format is `${hostId}:${tmuxSession}` — D-10 correctness (matches session-working-store convention)", () => {
    // Writing with numeric hostId and reading with string hostId (or vice versa)
    // must resolve to the same key. This is the D-10 correctness invariant:
    // backend (claude-session-server) has hostId as number in scope; frontend
    // (session-working-store) uses string hostIds from the wire frame. Both
    // MUST coerce via String() so the same key is used.
    setContextPct(42, "tina", 65);
    expect(getContextPct("42", "tina")).toBe(65);

    setContextPct("77", "nelly", 42);
    expect(getContextPct(77, "nelly")).toBe(42);

    // Different hostId (as string vs. number) must NOT collide.
    setContextPct(1, "shared-name", 10);
    setContextPct(2, "shared-name", 20);
    expect(getContextPct(1, "shared-name")).toBe(10);
    expect(getContextPct(2, "shared-name")).toBe(20);
  });
});
