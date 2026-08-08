/**
 * Layer 1 fast-path recycle detector — integration coverage through the
 * __applyLayer1LineForTests seam (quick 260808-ohn / bounty
 * session-holding-layer1-detect-id-reset-not-exit).
 *
 * Mirrors the discovery-repoll test file (claude-session-server.repoll.test.ts)
 * in shape: makeState() + makeHelpers() factories, one describe per case,
 * stubs that mutate state.changeoverState when needed to model the real
 * helper's side effect. The seam __applyLayer1LineForTests is co-located
 * with the reducer in layer1-detect.ts so the production onLine dispatch
 * and this test's dispatch cannot drift — they call the SAME function.
 *
 * The 8 acceptance cases here map 1:1 to the cases documented in the plan:
 *
 *   Case 1: -n +1 replay with history user(regular) → assistant →
 *           user(/id reset) → assistant → user(regular). Expected: 1 arm,
 *           1 clear, final state active.
 *   Case 2: Same but final turn IS /id reset. Expected: 1 arm, 0 clears,
 *           final state holding.
 *   Case 3: History of only regular turns + a stray assistant line that
 *           quotes <command-args>reset. Expected: 0 arms, 0 clears
 *           (Ashley-bug regression guard).
 *   Case 4: History contains a historical /exit user turn. Expected:
 *           0 arms, 0 clears (whole /exit path is gone from Layer 1).
 *   Case 5: While holding, non-user lines (assistant / tool_use /
 *           tool_result / thinking) never fire clear.
 *   Case 6: changeoverState=dead is terminal — no helper ever fires.
 *   Case 7: Live-append arm (state was steady, new /id reset arrives).
 *   Case 8: Live-append clear (state was holding, new regular user turn).
 */

import { describe, it, expect, vi } from "vitest";
import {
  __applyLayer1LineForTests,
  type __Layer1StateForTests,
  type __Layer1HelpersForTests,
} from "./layer1-detect.js";

// ── Helper factories (mirror claude-session-server.repoll.test.ts) ──────────

/** Create a fresh mutable state box for each test. */
function makeState(
  overrides: Partial<{
    changeoverState: __Layer1StateForTests["changeoverState"];
    mostRecentUserTurnIsIdReset: boolean | null;
  }> = {},
): __Layer1StateForTests {
  return {
    changeoverState: overrides.changeoverState ?? "active",
    layer1: {
      mostRecentUserTurnIsIdReset:
        overrides.mostRecentUserTurnIsIdReset ?? null,
    },
  };
}

/**
 * Create fresh stub helpers for each test. By default the transitionToHolding
 * stub mutates state.changeoverState to "holding" (mirroring the real
 * helper's first side effect); transitionFromHoldingToActiveSameFile mutates
 * back to "active". This matches production behavior so cases that fire
 * multiple lines in sequence see the same downstream effects.
 *
 * Tests that need to observe pre-mutation behavior can override the stubs
 * on the returned object.
 */
function makeHelpers(state: __Layer1StateForTests): {
  stubs: __Layer1HelpersForTests;
  transitionToHolding: ReturnType<typeof vi.fn>;
  transitionFromHoldingToActiveSameFile: ReturnType<typeof vi.fn>;
} {
  const transitionToHolding = vi.fn(
    (_reason: "id_reset" | "discovery_diff") => {
      state.changeoverState = "holding";
    },
  );
  const transitionFromHoldingToActiveSameFile = vi.fn(() => {
    state.changeoverState = "active";
  });
  return {
    stubs: { transitionToHolding, transitionFromHoldingToActiveSameFile },
    transitionToHolding,
    transitionFromHoldingToActiveSameFile,
  };
}

// ── Fixture builders (JSONL line synthesizers) ──────────────────────────────

function userTurnLine(content: string): string {
  return JSON.stringify({
    type: "user",
    uuid: `u-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: "2026-08-08T00:00:00.000Z",
    message: { role: "user", content },
  });
}

function assistantTurnLine(content: string): string {
  return JSON.stringify({
    type: "assistant",
    uuid: `a-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: "2026-08-08T00:00:00.000Z",
    message: { role: "assistant", content },
  });
}

function toolUseAssistantLine(): string {
  return JSON.stringify({
    type: "assistant",
    uuid: "a-tooluse-1",
    timestamp: "2026-08-08T00:00:00.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
      ],
    },
  });
}

function toolResultUserLine(): string {
  // Tool results arrive as "type":"user" turns whose content is a
  // tool_result block — this IS a user turn from Layer 1's perspective
  // (isUserTurn returns true because "type":"user" is present), so it
  // will update mostRecentUserTurnIsIdReset to false. See Case 5's
  // adjustment below.
  return JSON.stringify({
    type: "user",
    uuid: "u-toolresult-1",
    timestamp: "2026-08-08T00:00:00.000Z",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
      ],
    },
  });
}

function thinkingAssistantLine(): string {
  return JSON.stringify({
    type: "assistant",
    uuid: "a-thinking-1",
    timestamp: "2026-08-08T00:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "let me consider" }],
    },
  });
}

// Empirical /id reset shape from the bounty spec.
const ID_RESET_CONTENT =
  "<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>reset</command-args>";

const EXIT_CONTENT =
  "<command-message>exit</command-message>\n<command-name>/exit</command-name>\n<command-args></command-args>";

// ── Case 1: replay with /id reset then a later regular turn ─────────────────

describe("Layer 1 seam — Case 1: replay with history [user, assistant, /id reset, assistant, user]", () => {
  it("fires 1 arm (with reason='id_reset') and 1 clear; final changeoverState is 'active'", () => {
    const state = makeState({ changeoverState: "active" });
    const { stubs, transitionToHolding, transitionFromHoldingToActiveSameFile } = makeHelpers(state);

    const lines = [
      userTurnLine("first regular turn"),
      assistantTurnLine("some reply"),
      userTurnLine(ID_RESET_CONTENT),
      assistantTurnLine("acknowledged"),
      userTurnLine("post-reset regular turn"),
    ];
    for (const line of lines) __applyLayer1LineForTests(line, state, stubs);

    expect(transitionToHolding).toHaveBeenCalledOnce();
    expect(transitionToHolding).toHaveBeenCalledWith("id_reset");
    expect(transitionFromHoldingToActiveSameFile).toHaveBeenCalledOnce();
    expect(state.changeoverState).toBe("active");
    expect(state.layer1.mostRecentUserTurnIsIdReset).toBe(false);
  });
});

// ── Case 2: final turn IS /id reset (most-recent-user-turn IS /id reset) ────

describe("Layer 1 seam — Case 2: history ends on /id reset user turn", () => {
  it("fires 1 arm, 0 clears; final changeoverState is 'holding'", () => {
    const state = makeState({ changeoverState: "active" });
    const { stubs, transitionToHolding, transitionFromHoldingToActiveSameFile } = makeHelpers(state);

    const lines = [
      userTurnLine("first regular turn"),
      assistantTurnLine("reply"),
      userTurnLine(ID_RESET_CONTENT),
    ];
    for (const line of lines) __applyLayer1LineForTests(line, state, stubs);

    expect(transitionToHolding).toHaveBeenCalledOnce();
    expect(transitionToHolding).toHaveBeenCalledWith("id_reset");
    expect(transitionFromHoldingToActiveSameFile).not.toHaveBeenCalled();
    expect(state.changeoverState).toBe("holding");
    expect(state.layer1.mostRecentUserTurnIsIdReset).toBe(true);
  });
});

// ── Case 3: regular user turns only + a stray assistant line quoting the tag

describe("Layer 1 seam — Case 3: Ashley-bug regression guard (no /id reset anywhere)", () => {
  it("fires 0 arms and 0 clears; state stays 'active' throughout", () => {
    const state = makeState({ changeoverState: "active" });
    const { stubs, transitionToHolding, transitionFromHoldingToActiveSameFile } = makeHelpers(state);

    const lines = [
      userTurnLine("hi"),
      assistantTurnLine("hello"),
      userTurnLine("another regular turn"),
      // Assistant reflection that quotes the string <command-args>reset
      // inside its own body — MUST NOT arm because it's not a user turn.
      assistantTurnLine(
        "You issued <command-args>reset which cleared your identity context.",
      ),
      userTurnLine("a third regular turn"),
    ];
    for (const line of lines) __applyLayer1LineForTests(line, state, stubs);

    expect(transitionToHolding).not.toHaveBeenCalled();
    expect(transitionFromHoldingToActiveSameFile).not.toHaveBeenCalled();
    expect(state.changeoverState).toBe("active");
    expect(state.layer1.mostRecentUserTurnIsIdReset).toBe(false);
  });
});

// ── Case 4: historical /exit turn (leftover from pre-refactor sessions) ─────

describe("Layer 1 seam — Case 4: historical /exit user turn", () => {
  it("fires 0 arms and 0 clears (the whole /exit path is gone from Layer 1)", () => {
    const state = makeState({ changeoverState: "active" });
    const { stubs, transitionToHolding, transitionFromHoldingToActiveSameFile } = makeHelpers(state);

    const lines = [
      userTurnLine("first regular turn"),
      assistantTurnLine("reply"),
      userTurnLine(EXIT_CONTENT),
      assistantTurnLine("session recycled"),
      userTurnLine("post-exit regular turn"),
    ];
    for (const line of lines) __applyLayer1LineForTests(line, state, stubs);

    expect(transitionToHolding).not.toHaveBeenCalled();
    expect(transitionFromHoldingToActiveSameFile).not.toHaveBeenCalled();
    expect(state.changeoverState).toBe("active");
  });

  it("fires 0 arms even for MULTIPLE historical /exit turns (Ashley empirically saw 14 arm+clear pairs in ~1h under the old detector)", () => {
    const state = makeState({ changeoverState: "active" });
    const { stubs, transitionToHolding } = makeHelpers(state);

    const lines = [
      userTurnLine(EXIT_CONTENT),
      assistantTurnLine("recycled"),
      userTurnLine("turn 1"),
      assistantTurnLine("reply 1"),
      userTurnLine(EXIT_CONTENT),
      assistantTurnLine("recycled again"),
      userTurnLine("turn 2"),
      assistantTurnLine("reply 2"),
      userTurnLine("turn 3"),
    ];
    for (const line of lines) __applyLayer1LineForTests(line, state, stubs);

    expect(transitionToHolding).not.toHaveBeenCalled();
    expect(state.changeoverState).toBe("active");
  });
});

// ── Case 5: while holding, non-user lines never clear ──────────────────────

describe("Layer 1 seam — Case 5: while holding, only USER turns can clear", () => {
  it("assistant / tool_use / thinking lines fed while holding do NOT clear", () => {
    // Start in a state that would clear on a regular user turn, then feed
    // only non-user lines — clear must NOT fire.
    const state = makeState({
      changeoverState: "holding",
      mostRecentUserTurnIsIdReset: true,
    });
    const { stubs, transitionToHolding, transitionFromHoldingToActiveSameFile } = makeHelpers(state);

    const nonUserLines = [
      assistantTurnLine("still processing"),
      toolUseAssistantLine(),
      thinkingAssistantLine(),
    ];
    for (const line of nonUserLines) __applyLayer1LineForTests(line, state, stubs);

    expect(transitionToHolding).not.toHaveBeenCalled();
    expect(transitionFromHoldingToActiveSameFile).not.toHaveBeenCalled();
    // State box is not mutated by non-user turns:
    expect(state.changeoverState).toBe("holding");
    expect(state.layer1.mostRecentUserTurnIsIdReset).toBe(true);
  });

  it("tool_result USER turn (type:user with tool_result content) DOES count as a user turn — that is Claude Code's byte-shape", () => {
    // Byte-shape reality check: tool_result blocks come wrapped in a
    // "type":"user" turn (Claude Code's convention). Layer 1 treats
    // ANY "type":"user" line as a user turn. That's correct: a
    // tool_result IS the model's next input, and if it lands while
    // holding, the tail-state "most recent user turn is not /id reset"
    // invariant holds → clear fires. This is desirable behavior
    // (recovered-session-with-different-cwd delivers a tool_result as
    // the first turn of the new session).
    const state = makeState({
      changeoverState: "holding",
      mostRecentUserTurnIsIdReset: true,
    });
    const { stubs, transitionToHolding, transitionFromHoldingToActiveSameFile } = makeHelpers(state);

    __applyLayer1LineForTests(toolResultUserLine(), state, stubs);

    expect(transitionToHolding).not.toHaveBeenCalled();
    expect(transitionFromHoldingToActiveSameFile).toHaveBeenCalledOnce();
    expect(state.changeoverState).toBe("active");
    expect(state.layer1.mostRecentUserTurnIsIdReset).toBe(false);
  });
});

// ── Case 6: changeoverState=dead is terminal ────────────────────────────────

describe("Layer 1 seam — Case 6: dead is terminal, no helper ever fires", () => {
  it("no helper called for any line type while dead", () => {
    const state = makeState({ changeoverState: "dead" });
    const { stubs, transitionToHolding, transitionFromHoldingToActiveSameFile } = makeHelpers(state);

    __applyLayer1LineForTests(userTurnLine(ID_RESET_CONTENT), state, stubs);
    __applyLayer1LineForTests(userTurnLine("regular"), state, stubs);
    __applyLayer1LineForTests(assistantTurnLine("hi"), state, stubs);
    __applyLayer1LineForTests(userTurnLine(EXIT_CONTENT), state, stubs);
    __applyLayer1LineForTests("", state, stubs);
    __applyLayer1LineForTests("garbage", state, stubs);

    expect(transitionToHolding).not.toHaveBeenCalled();
    expect(transitionFromHoldingToActiveSameFile).not.toHaveBeenCalled();
    expect(state.changeoverState).toBe("dead");
  });
});

// ── Case 7: live-append arm ─────────────────────────────────────────────────

describe("Layer 1 seam — Case 7: live-append arm (post-replay steady state)", () => {
  it("state was steady (isIdReset=false, active), a NEW /id reset user turn arrives → transitionToHolding('id_reset') fires", () => {
    // Simulate the post-replay state: the tail has already replayed a
    // history whose most-recent user turn was a regular turn (so
    // mostRecentUserTurnIsIdReset=false, changeoverState=active). Now
    // a live-appended /id reset turn arrives — the same code path
    // must arm holding.
    const state = makeState({
      changeoverState: "active",
      mostRecentUserTurnIsIdReset: false,
    });
    const { stubs, transitionToHolding, transitionFromHoldingToActiveSameFile } = makeHelpers(state);

    __applyLayer1LineForTests(userTurnLine(ID_RESET_CONTENT), state, stubs);

    expect(transitionToHolding).toHaveBeenCalledOnce();
    expect(transitionToHolding).toHaveBeenCalledWith("id_reset");
    expect(transitionFromHoldingToActiveSameFile).not.toHaveBeenCalled();
    expect(state.changeoverState).toBe("holding");
    expect(state.layer1.mostRecentUserTurnIsIdReset).toBe(true);
  });
});

// ── Case 8: live-append clear ───────────────────────────────────────────────

describe("Layer 1 seam — Case 8: live-append clear (holding → active)", () => {
  it("state was holding (isIdReset=true), a NEW regular user turn arrives → transitionFromHoldingToActiveSameFile fires", () => {
    const state = makeState({
      changeoverState: "holding",
      mostRecentUserTurnIsIdReset: true,
    });
    const { stubs, transitionToHolding, transitionFromHoldingToActiveSameFile } = makeHelpers(state);

    __applyLayer1LineForTests(userTurnLine("regular text after reset"), state, stubs);

    expect(transitionFromHoldingToActiveSameFile).toHaveBeenCalledOnce();
    expect(transitionToHolding).not.toHaveBeenCalled();
    expect(state.changeoverState).toBe("active");
    expect(state.layer1.mostRecentUserTurnIsIdReset).toBe(false);
  });
});
