// Tests for useNewConversationForm — the form-state hook for NewConversationModal.
//
// Phase 91 Plan 01 (Wave 1 — frontend foundation: participant types + form hook).
//
// Test strategy:
//   - renderHook from @testing-library/react drives the hook through real React
//     state transitions without a wrapper component.
//   - A fixture builder `makeParticipant(overrides)` produces PickedParticipant
//     values; tests use 3 humans + 3 agents pre-built from it.
//   - No API client mocks — hook is pure client-side derivation (no fetch calls).
//   - 8 behaviors: initial state, self-exclude, alphabetical sort, case-insensitive
//     filter, gate transitions, toggle idempotence, remove, viewingUserMxid=null.

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { PickedParticipant, GateState } from "./participant-types";
import { useNewConversationForm } from "./useNewConversationForm";

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

let _seq = 0;
function makeParticipant(overrides: Partial<PickedParticipant> = {}): PickedParticipant {
  _seq += 1;
  const base: PickedParticipant = {
    mxid: `@user${_seq}:server`,
    displayName: `User ${_seq}`,
    colorHue: (_seq * 37) % 360,
    avatarUrl: null,
    role: "human",
  };
  return { ...base, ...overrides };
}

// 3 humans + 3 agents shared across tests
const HUMAN_A = makeParticipant({ mxid: "@alice:s", displayName: "Alice", role: "human", userId: "u-alice" });
const HUMAN_B = makeParticipant({ mxid: "@bob:s", displayName: "Bob", role: "human", userId: "u-bob" });
const HUMAN_C = makeParticipant({ mxid: "@carol:s", displayName: "Carol", role: "human", userId: "u-carol" });

const AGENT_X = makeParticipant({ mxid: "@alpha:s", displayName: "Alpha", role: "agent", identityKey: "alpha" });
const AGENT_Y = makeParticipant({ mxid: "@beta:s", displayName: "Beta", role: "agent", identityKey: "beta" });
const AGENT_Z = makeParticipant({ mxid: "@gamma:s", displayName: "Gamma", role: "agent", identityKey: "gamma" });

const ALL_HUMANS = [HUMAN_A, HUMAN_B, HUMAN_C];
const ALL_AGENTS = [AGENT_X, AGENT_Y, AGENT_Z];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useNewConversationForm", () => {
  // ─── Test 1: Initial state ────────────────────────────────────────────────
  it("Test 1: initial state — empty strings, empty picks, gate no-room-name", () => {
    const { result } = renderHook(() =>
      useNewConversationForm({ humans: ALL_HUMANS, agents: ALL_AGENTS, viewingUserMxid: "@viewer:s" }),
    );

    expect(result.current.roomName).toBe("");
    expect(result.current.searchQuery).toBe("");
    expect(result.current.picked).toHaveLength(0);
    expect(result.current.submitting).toBe(false);
    expect(result.current.error).toBeNull();
    const gate: GateState = result.current.gate;
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toBe("no-room-name");
    }
  });

  // ─── Test 2: Self-exclude ─────────────────────────────────────────────────
  it("Test 2: self-exclude — viewing user's mxid omitted from availableHumans", () => {
    const viewingUserMxid = HUMAN_B.mxid; // "@bob:s"
    const { result } = renderHook(() =>
      useNewConversationForm({ humans: ALL_HUMANS, agents: ALL_AGENTS, viewingUserMxid }),
    );

    const mxids = result.current.availableHumans.map((h) => h.mxid);
    expect(mxids).not.toContain(viewingUserMxid);
    expect(mxids).toContain(HUMAN_A.mxid);
    expect(mxids).toContain(HUMAN_C.mxid);
    // agents are never self-excluded
    expect(result.current.availableAgents).toHaveLength(ALL_AGENTS.length);
  });

  // ─── Test 3: Alphabetical sort ────────────────────────────────────────────
  it("Test 3: availableHumans and availableAgents sorted alphabetically by displayName", () => {
    // Feed humans in reverse order
    const scrambledHumans = [HUMAN_C, HUMAN_A, HUMAN_B];
    const scrambledAgents = [AGENT_Z, AGENT_X, AGENT_Y];

    const { result } = renderHook(() =>
      useNewConversationForm({
        humans: scrambledHumans,
        agents: scrambledAgents,
        viewingUserMxid: null,
      }),
    );

    const humanNames = result.current.availableHumans.map((h) => h.displayName);
    expect(humanNames).toEqual([...humanNames].sort((a, b) => a.localeCompare(b)));

    const agentNames = result.current.availableAgents.map((a) => a.displayName);
    expect(agentNames).toEqual([...agentNames].sort((a, b) => a.localeCompare(b)));
  });

  // ─── Test 4: Case-insensitive substring filter ────────────────────────────
  it("Test 4: setSearchQuery('AL') filters availableHumans to displayName containing 'al' (any case)", () => {
    // HUMAN_A: "Alice" (contains 'al'), HUMAN_B: "Bob" (no), HUMAN_C: "Carol" (contains 'al' via 'aro...al'? no — 'Carol' ⊃ 'al' at chars 1-2? c-a-r-o-l → no 'al' substring)
    // Actually "Alice" → a-l-i-c-e → 'al' at position 0. "Bob" → no. "Carol" → c-a-r-o-l → no 'al'.
    const { result } = renderHook(() =>
      useNewConversationForm({ humans: ALL_HUMANS, agents: ALL_AGENTS, viewingUserMxid: null }),
    );

    act(() => {
      result.current.setSearchQuery("AL");
    });

    const humanNames = result.current.availableHumans.map((h) => h.displayName);
    // Only "Alice" contains 'al' (case-insensitive)
    expect(humanNames).toContain("Alice");
    expect(humanNames).not.toContain("Bob");
    expect(humanNames).not.toContain("Carol");

    // Empty query restores full list
    act(() => {
      result.current.setSearchQuery("");
    });
    expect(result.current.availableHumans).toHaveLength(ALL_HUMANS.length);
  });

  // ─── Test 5: Gate transitions ─────────────────────────────────────────────
  it("Test 5: gate transitions — blank name → no-room-name → no-participants → single-agent-only → ok", () => {
    const { result } = renderHook(() =>
      useNewConversationForm({ humans: ALL_HUMANS, agents: ALL_AGENTS, viewingUserMxid: null }),
    );

    // Initial: blank name → no-room-name
    expect(result.current.gate).toEqual({ ok: false, reason: "no-room-name" });

    // Set a name, zero picks → no-participants
    act(() => { result.current.setRoomName("Test Room"); });
    expect(result.current.gate).toEqual({ ok: false, reason: "no-participants" });

    // Toggle one agent (no humans) → single-agent-only
    act(() => { result.current.toggle(AGENT_X.mxid); });
    expect(result.current.gate).toEqual({ ok: false, reason: "single-agent-only" });

    // Toggle one human (plus one agent) → ok
    act(() => { result.current.toggle(HUMAN_A.mxid); });
    expect(result.current.gate).toEqual({ ok: true });

    // Remove agent, only human → ok
    act(() => { result.current.remove(AGENT_X.mxid); });
    expect(result.current.gate).toEqual({ ok: true });

    // Set submitting=true → submitting (overrides everything)
    act(() => { result.current.setSubmitting(true); });
    expect(result.current.gate).toEqual({ ok: false, reason: "submitting" });
  });

  // ─── Test 6: Toggle idempotence ───────────────────────────────────────────
  it("Test 6: toggle(mxid) twice returns to un-picked state; picked list mirrors Set", () => {
    const { result } = renderHook(() =>
      useNewConversationForm({ humans: ALL_HUMANS, agents: ALL_AGENTS, viewingUserMxid: null }),
    );

    // Toggle in
    act(() => { result.current.toggle(HUMAN_A.mxid); });
    expect(result.current.picked.map((p) => p.mxid)).toContain(HUMAN_A.mxid);

    // Toggle out
    act(() => { result.current.toggle(HUMAN_A.mxid); });
    expect(result.current.picked.map((p) => p.mxid)).not.toContain(HUMAN_A.mxid);
    expect(result.current.picked).toHaveLength(0);
  });

  // ─── Test 7: remove ───────────────────────────────────────────────────────
  it("Test 7: remove(mxid) removes only that mxid; other picks preserved", () => {
    const { result } = renderHook(() =>
      useNewConversationForm({ humans: ALL_HUMANS, agents: ALL_AGENTS, viewingUserMxid: null }),
    );

    // Pick two humans
    act(() => {
      result.current.toggle(HUMAN_A.mxid);
      result.current.toggle(HUMAN_B.mxid);
    });
    expect(result.current.picked).toHaveLength(2);

    // Remove one
    act(() => { result.current.remove(HUMAN_A.mxid); });
    expect(result.current.picked).toHaveLength(1);
    expect(result.current.picked[0].mxid).toBe(HUMAN_B.mxid);

    // Remove unknown mxid is a no-op
    act(() => { result.current.remove("@unknown:s"); });
    expect(result.current.picked).toHaveLength(1);
  });

  // ─── Test 8: viewingUserMxid=null — no self-exclusion ────────────────────
  it("Test 8: viewingUserMxid=null — every human appears in availableHumans (no exclusion)", () => {
    const { result } = renderHook(() =>
      useNewConversationForm({ humans: ALL_HUMANS, agents: ALL_AGENTS, viewingUserMxid: null }),
    );

    expect(result.current.availableHumans).toHaveLength(ALL_HUMANS.length);
    const mxids = result.current.availableHumans.map((h) => h.mxid);
    expect(mxids).toContain(HUMAN_A.mxid);
    expect(mxids).toContain(HUMAN_B.mxid);
    expect(mxids).toContain(HUMAN_C.mxid);
  });

  // ─── Test 9: reset() — clears all form state (M1 fix) ───────────────────
  it("Test 9: reset() clears roomName, picked, searchQuery, submitting, error to initial values", () => {
    const { result } = renderHook(() =>
      useNewConversationForm({ humans: ALL_HUMANS, agents: ALL_AGENTS, viewingUserMxid: null }),
    );

    // Accumulate state
    act(() => {
      result.current.setRoomName("My Room");
      result.current.toggle(HUMAN_A.mxid);
      result.current.setSearchQuery("ali");
      result.current.setSubmitting(true);
      result.current.setError("something went wrong");
    });

    // Verify state was set
    expect(result.current.roomName).toBe("My Room");
    expect(result.current.picked).toHaveLength(1);
    expect(result.current.searchQuery).toBe("ali");
    expect(result.current.submitting).toBe(true);
    expect(result.current.error).toBe("something went wrong");

    // Reset
    act(() => {
      result.current.reset();
    });

    // All back to initial
    expect(result.current.roomName).toBe("");
    expect(result.current.picked).toHaveLength(0);
    expect(result.current.searchQuery).toBe("");
    expect(result.current.submitting).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.gate).toEqual({ ok: false, reason: "no-room-name" });
  });
});
