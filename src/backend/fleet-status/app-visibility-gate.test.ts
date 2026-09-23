/**
 * app-visibility-gate.test.ts — Phase 130 unit tests for
 * isAppVisibleToUser.
 *
 * Byte-shape mirror of project-visibility-gate.test.ts. The two gates share
 * the same D-3 fallback + null-caller-bypass + case-sensitivity discipline;
 * kept as separate files so a grep for each function name is the audit-
 * visible answer to "did we gate every emit site of this resource kind?".
 */

import { describe, it, expect } from "vitest";
import { isAppVisibleToUser } from "./app-visibility-gate.js";

describe("isAppVisibleToUser — null caller (gate disabled)", () => {
  it("returns true when callerUsername is null regardless of appUsers shape", () => {
    expect(isAppVisibleToUser(null, null)).toBe(true);
    expect(isAppVisibleToUser([], null)).toBe(true);
    expect(isAppVisibleToUser(["alice"], null)).toBe(true);
    expect(isAppVisibleToUser(["someone-else"], null)).toBe(true);
  });
});

describe("isAppVisibleToUser — D-3 fallback (empty/absent list = falls open)", () => {
  it("null users list → falls open for any caller", () => {
    expect(isAppVisibleToUser(null, "alice")).toBe(true);
    expect(isAppVisibleToUser(null, "zoey")).toBe(true);
  });

  it("empty users list → falls open for any caller", () => {
    expect(isAppVisibleToUser([], "alice")).toBe(true);
    expect(isAppVisibleToUser([], "zoey")).toBe(true);
  });
});

describe("isAppVisibleToUser — membership check", () => {
  it("caller in list → true", () => {
    expect(isAppVisibleToUser(["alice"], "alice")).toBe(true);
    expect(isAppVisibleToUser(["alice", "zoey"], "zoey")).toBe(true);
    expect(isAppVisibleToUser(["a", "b", "c", "alice", "d"], "alice")).toBe(
      true,
    );
  });

  it("caller NOT in list → false", () => {
    expect(isAppVisibleToUser(["alice"], "zoey")).toBe(false);
    expect(isAppVisibleToUser(["a", "b"], "zoey")).toBe(false);
  });
});

describe("isAppVisibleToUser — case sensitivity (Pitfall 7)", () => {
  it("comparison is case-sensitive — 'Alice' does NOT match 'alice'", () => {
    expect(isAppVisibleToUser(["Alice"], "alice")).toBe(false);
    expect(isAppVisibleToUser(["alice"], "Alice")).toBe(false);
    expect(isAppVisibleToUser(["ALICE"], "alice")).toBe(false);
  });

  it("exact case match → true", () => {
    expect(isAppVisibleToUser(["Alice"], "Alice")).toBe(true);
    expect(isAppVisibleToUser(["alice"], "alice")).toBe(true);
  });
});
