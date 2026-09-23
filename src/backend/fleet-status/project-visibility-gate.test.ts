/**
 * project-visibility-gate.test.ts — Phase 130 unit tests for
 * isProjectVisibleToUser.
 *
 * Mirrors identity-visibility-gate.test.ts test structure — same D-3 fallback
 * discipline, same null-caller-bypass semantics, same case-sensitive comparison
 * discipline. Differs in that projects have NO role-parent intersection, so the
 * gate is one-sided (only the project's own users list).
 */

import { describe, it, expect } from "vitest";
import { isProjectVisibleToUser } from "./project-visibility-gate.js";

describe("isProjectVisibleToUser — null caller (gate disabled)", () => {
  it("returns true when callerUsername is null regardless of projectUsers shape", () => {
    expect(isProjectVisibleToUser(null, null)).toBe(true);
    expect(isProjectVisibleToUser([], null)).toBe(true);
    expect(isProjectVisibleToUser(["ashley"], null)).toBe(true);
    // Even a totally arbitrary list: null caller ALWAYS passes.
    expect(isProjectVisibleToUser(["someone-else"], null)).toBe(true);
  });
});

describe("isProjectVisibleToUser — D-3 fallback (empty/absent list = falls open)", () => {
  it("null users list → falls open for any caller", () => {
    expect(isProjectVisibleToUser(null, "ashley")).toBe(true);
    expect(isProjectVisibleToUser(null, "zoey")).toBe(true);
  });

  it("empty users list → falls open for any caller", () => {
    expect(isProjectVisibleToUser([], "ashley")).toBe(true);
    expect(isProjectVisibleToUser([], "zoey")).toBe(true);
  });
});

describe("isProjectVisibleToUser — membership check", () => {
  it("caller in list → true", () => {
    expect(isProjectVisibleToUser(["ashley"], "ashley")).toBe(true);
    expect(isProjectVisibleToUser(["ashley", "zoey"], "zoey")).toBe(true);
    expect(
      isProjectVisibleToUser(["a", "b", "c", "ashley", "d"], "ashley"),
    ).toBe(true);
  });

  it("caller NOT in list → false", () => {
    expect(isProjectVisibleToUser(["ashley"], "zoey")).toBe(false);
    expect(isProjectVisibleToUser(["a", "b"], "zoey")).toBe(false);
  });
});

describe("isProjectVisibleToUser — case sensitivity (Pitfall 7)", () => {
  it("comparison is case-sensitive — 'Ashley' does NOT match 'ashley'", () => {
    // Matches DB users.username storage discipline: case is stored as-typed
    // at register; no normalization layer downstream.
    expect(isProjectVisibleToUser(["Ashley"], "ashley")).toBe(false);
    expect(isProjectVisibleToUser(["ashley"], "Ashley")).toBe(false);
    expect(isProjectVisibleToUser(["ASHLEY"], "ashley")).toBe(false);
  });

  it("exact case match → true", () => {
    expect(isProjectVisibleToUser(["Ashley"], "Ashley")).toBe(true);
    expect(isProjectVisibleToUser(["ashley"], "ashley")).toBe(true);
  });
});
