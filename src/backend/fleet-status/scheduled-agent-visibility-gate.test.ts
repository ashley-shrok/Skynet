/**
 * scheduled-agent-visibility-gate.test.ts — unit tests for
 * isScheduledAgentVisibleToUser.
 *
 * Mirrors project-visibility-gate.test.ts test structure — same D-3 fallback
 * discipline, same null-caller-bypass semantics, same case-sensitive
 * comparison discipline. Differs in that scheduled agents have NO role-parent
 * intersection, so the gate is one-sided (only the spec's own users list).
 */

import { describe, it, expect } from "vitest";
import { isScheduledAgentVisibleToUser } from "./scheduled-agent-visibility-gate.js";

describe("isScheduledAgentVisibleToUser — null caller (gate disabled)", () => {
  it("returns true when callerUsername is null regardless of specUsers shape", () => {
    expect(isScheduledAgentVisibleToUser(null, null)).toBe(true);
    expect(isScheduledAgentVisibleToUser([], null)).toBe(true);
    expect(isScheduledAgentVisibleToUser(["alice"], null)).toBe(true);
    // Even a totally arbitrary list: null caller ALWAYS passes.
    expect(isScheduledAgentVisibleToUser(["someone-else"], null)).toBe(true);
  });
});

describe("isScheduledAgentVisibleToUser — D-3 fallback (empty/absent list = falls open)", () => {
  it("null users list → falls open for any caller", () => {
    expect(isScheduledAgentVisibleToUser(null, "alice")).toBe(true);
    expect(isScheduledAgentVisibleToUser(null, "zoey")).toBe(true);
  });

  it("empty users list → falls open for any caller", () => {
    expect(isScheduledAgentVisibleToUser([], "alice")).toBe(true);
    expect(isScheduledAgentVisibleToUser([], "zoey")).toBe(true);
  });
});

describe("isScheduledAgentVisibleToUser — membership check", () => {
  it("caller in list → true", () => {
    expect(isScheduledAgentVisibleToUser(["alice"], "alice")).toBe(true);
    expect(isScheduledAgentVisibleToUser(["alice", "zoey"], "zoey")).toBe(true);
    expect(
      isScheduledAgentVisibleToUser(["a", "b", "c", "alice", "d"], "alice"),
    ).toBe(true);
  });

  it("caller NOT in list → false", () => {
    expect(isScheduledAgentVisibleToUser(["alice"], "zoey")).toBe(false);
    expect(isScheduledAgentVisibleToUser(["a", "b"], "zoey")).toBe(false);
  });
});

describe("isScheduledAgentVisibleToUser — case sensitivity (Pitfall 7)", () => {
  it("comparison is case-sensitive — 'Alice' does NOT match 'alice'", () => {
    // Matches DB users.username storage discipline: case is stored as-typed
    // at register; no normalization layer downstream.
    expect(isScheduledAgentVisibleToUser(["Alice"], "alice")).toBe(false);
    expect(isScheduledAgentVisibleToUser(["alice"], "Alice")).toBe(false);
    expect(isScheduledAgentVisibleToUser(["ALICE"], "alice")).toBe(false);
  });

  it("exact case match → true", () => {
    expect(isScheduledAgentVisibleToUser(["Alice"], "Alice")).toBe(true);
    expect(isScheduledAgentVisibleToUser(["alice"], "alice")).toBe(true);
  });
});
