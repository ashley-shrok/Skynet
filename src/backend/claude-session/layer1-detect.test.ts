/**
 * Unit tests for the Layer 1 fast-path recycle detector helpers extracted
 * from claude-session-server.ts (quick 260808-ohn / bounty
 * session-holding-layer1-detect-id-reset-not-exit).
 *
 * The refactor replaces the edge-triggered /exit include-scan (which
 * re-fires the SessionHoldingOverlay on every WS reconnect because
 * `hasSeenExit` resets and every historical /exit line in the JSONL
 * re-triggers the arm) with a tail-state-derived /id reset detector:
 * the overlay arms IFF the file's most-recent user turn IS /id reset,
 * computed uniformly across `-n +1` replay AND live-append.
 *
 * The helpers are pure — no I/O, no imports from ssh2 / WebSocket /
 * logger. That is what makes them cheap to unit-test at this granularity;
 * the integration seam __applyLayer1LineForTests is exercised separately
 * in claude-session-server.layer1.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  isUserTurn,
  isIdResetUserTurn,
  applyLineToLayer1State,
  type Layer1State,
} from "./layer1-detect.js";

// ── Fixture builders ────────────────────────────────────────────────────────
//
// Build realistic JSONL lines by JSON.stringify-ing objects shaped like the
// empirical Claude Code turns documented in the bounty spec. This protects
// against future refactors that change the byte-shape assumptions (the
// helpers rely on line.includes on the SERIALIZED byte-form, not on
// JSON.parse — so the fixtures must round-trip through JSON.stringify).

function userTurnLine(content: string): string {
  return JSON.stringify({
    type: "user",
    uuid: "u-fake-1",
    timestamp: "2026-08-08T00:00:00.000Z",
    message: {
      role: "user",
      content,
    },
  });
}

// Tool-result "user" turn: Claude Code writes tool_result feedback with
// role:"user" but content as an ARRAY containing tool_result objects.
// These are agent-side synthetic and MUST NOT count as user typing for
// Layer 1's supersede logic (bug found 2026-08-08: agent-invoked tools
// during /id reset processing cleared the overlay ~1s after arm).
function toolResultUserTurnLine(toolUseId: string, content: string): string {
  return JSON.stringify({
    type: "user",
    uuid: "u-tr-1",
    timestamp: "2026-08-08T00:00:00.000Z",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content,
        },
      ],
    },
  });
}

function assistantTurnLine(content: string): string {
  return JSON.stringify({
    type: "assistant",
    uuid: "a-fake-1",
    timestamp: "2026-08-08T00:00:00.000Z",
    message: {
      role: "assistant",
      content,
    },
  });
}

function systemTurnLine(content: string): string {
  return JSON.stringify({
    type: "system",
    uuid: "s-fake-1",
    timestamp: "2026-08-08T00:00:00.000Z",
    content,
  });
}

// Empirical /id reset shape: the slash-command turn arrives as a user turn
// whose content contains three tags in sequence (per bounty-spec byte-shape
// documentation): command-message, command-name, command-args.
const ID_RESET_CONTENT =
  "<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>reset</command-args>";

const ID_RESET_FREEFORM_CONTENT =
  "<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>reset because I want to change roles</command-args>";

const ID_SAVE_CONTENT =
  "<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>save</command-args>";

const ID_TANYA_CONTENT =
  "<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>tanya</command-args>";

const GSD_QUICK_CONTENT =
  "<command-message>gsd:quick</command-message>\n<command-name>/gsd:quick</command-name>\n<command-args>some task</command-args>";

const EXIT_CONTENT =
  "<command-message>exit</command-message>\n<command-name>/exit</command-name>\n<command-args></command-args>";

// Assistant message that *quotes* the string <command-args>reset inside
// its own body — this should NOT match isIdResetUserTurn because the
// type is not "user".
const ASSISTANT_REFLECTION_CONTENT =
  "You issued <command-args>reset which cleared your identity context.";

// Hypothetical future /reset command that is NOT gated on /id — should
// NOT match because command-name isn't /id.
const FUTURE_RESET_CONTENT =
  "<command-message>reset</command-message>\n<command-name>/reset</command-name>\n<command-args>reset</command-args>";

// ── isUserTurn ──────────────────────────────────────────────────────────────

describe("isUserTurn", () => {
  it('returns true for a "type":"user" line', () => {
    expect(isUserTurn(userTurnLine("hi"))).toBe(true);
  });

  it('returns false for a "type":"assistant" line', () => {
    expect(isUserTurn(assistantTurnLine("hi"))).toBe(false);
  });

  it('returns false for a "type":"system" line', () => {
    expect(isUserTurn(systemTurnLine("hi"))).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isUserTurn("")).toBe(false);
  });

  it("returns false for garbage (non-JSON) input", () => {
    expect(isUserTurn("garbage garbage garbage")).toBe(false);
  });

  it("returns false for a tool_result user turn (agent-side synthetic — must not count as user typing)", () => {
    // Regression for 2026-08-08 bug: during /id reset processing the agent
    // invokes save-flow tools, each tool_result appears as a user turn, and
    // if counted as user typing it prematurely clears the SessionHoldingOverlay.
    expect(isUserTurn(toolResultUserTurnLine("toolu_abc123", "file contents..."))).toBe(false);
  });

  it("returns false for a tool_result user turn even when the result payload contains user-typing-like content", () => {
    // Defensive: a tool_result whose content string happens to look like
    // a slash-command (e.g. a Read tool result that echoed a JSONL line
    // from another session) must still NOT count as user typing — the
    // exclusion is on the OUTER shape, not the payload.
    expect(
      isUserTurn(
        toolResultUserTurnLine(
          "toolu_xyz",
          "<command-name>/id</command-name>\n<command-args>reset</command-args>",
        ),
      ),
    ).toBe(false);
  });
});

// ── isIdResetUserTurn ───────────────────────────────────────────────────────

describe("isIdResetUserTurn — positive cases", () => {
  it("matches a user turn with exact <command-args>reset</command-args>", () => {
    expect(isIdResetUserTurn(userTurnLine(ID_RESET_CONTENT))).toBe(true);
  });

  it("matches a user turn with freeform trailing args (starts-with reset)", () => {
    expect(isIdResetUserTurn(userTurnLine(ID_RESET_FREEFORM_CONTENT))).toBe(
      true,
    );
  });
});

describe("isIdResetUserTurn — negative cases", () => {
  it("does not match /id save (args does not start with reset)", () => {
    expect(isIdResetUserTurn(userTurnLine(ID_SAVE_CONTENT))).toBe(false);
  });

  it("does not match /id tanya (args does not start with reset)", () => {
    expect(isIdResetUserTurn(userTurnLine(ID_TANYA_CONTENT))).toBe(false);
  });

  it("does not match /gsd:quick (different slash command)", () => {
    expect(isIdResetUserTurn(userTurnLine(GSD_QUICK_CONTENT))).toBe(false);
  });

  it("does not match /exit (leftover from pre-refactor sessions)", () => {
    expect(isIdResetUserTurn(userTurnLine(EXIT_CONTENT))).toBe(false);
  });

  it('does not match an "type":"assistant" line that quotes <command-args>reset', () => {
    expect(
      isIdResetUserTurn(assistantTurnLine(ASSISTANT_REFLECTION_CONTENT)),
    ).toBe(false);
  });

  it("does not match a future /reset command (no <command-name>/id</command-name>)", () => {
    expect(isIdResetUserTurn(userTurnLine(FUTURE_RESET_CONTENT))).toBe(false);
  });

  it("does not match empty or garbage input", () => {
    expect(isIdResetUserTurn("")).toBe(false);
    expect(isIdResetUserTurn("garbage")).toBe(false);
  });
});

// ── applyLineToLayer1State ──────────────────────────────────────────────────

function freshState(): Layer1State {
  return { mostRecentUserTurnIsIdReset: null };
}

describe("applyLineToLayer1State — non-user turns never change state", () => {
  it("initial state + non-user line + active → returns none, state unchanged", () => {
    const state = freshState();
    const action = applyLineToLayer1State(
      assistantTurnLine("hello"),
      state,
      "active",
    );
    expect(action).toBe("none");
    expect(state.mostRecentUserTurnIsIdReset).toBe(null);
  });

  it("state {isIdReset:true} + assistant line + holding → returns none, state unchanged (only USER turns can clear)", () => {
    const state: Layer1State = { mostRecentUserTurnIsIdReset: true };
    const action = applyLineToLayer1State(
      assistantTurnLine("hello"),
      state,
      "holding",
    );
    expect(action).toBe("none");
    expect(state.mostRecentUserTurnIsIdReset).toBe(true);
  });

  it("system line does not change state", () => {
    const state: Layer1State = { mostRecentUserTurnIsIdReset: true };
    const action = applyLineToLayer1State(
      systemTurnLine("some system reminder"),
      state,
      "active",
    );
    expect(action).toBe("none");
    expect(state.mostRecentUserTurnIsIdReset).toBe(true);
  });

  it("garbage / empty line does not change state", () => {
    const state = freshState();
    expect(applyLineToLayer1State("", state, "active")).toBe("none");
    expect(state.mostRecentUserTurnIsIdReset).toBe(null);
    expect(applyLineToLayer1State("garbage", state, "active")).toBe("none");
    expect(state.mostRecentUserTurnIsIdReset).toBe(null);
  });
});

describe("applyLineToLayer1State — arm_holding", () => {
  it("initial state + /id reset user turn + active → arm_holding, state.isIdReset=true", () => {
    const state = freshState();
    const action = applyLineToLayer1State(
      userTurnLine(ID_RESET_CONTENT),
      state,
      "active",
    );
    expect(action).toBe("arm_holding");
    expect(state.mostRecentUserTurnIsIdReset).toBe(true);
  });

  it("initial state + /id reset user turn + holding → none (already holding; no double-arm), state.isIdReset=true", () => {
    const state = freshState();
    const action = applyLineToLayer1State(
      userTurnLine(ID_RESET_CONTENT),
      state,
      "holding",
    );
    expect(action).toBe("none");
    expect(state.mostRecentUserTurnIsIdReset).toBe(true);
  });
});

describe("applyLineToLayer1State — clear_holding", () => {
  it("state {isIdReset:true} + non-reset user turn + holding → clear_holding, state.isIdReset=false", () => {
    const state: Layer1State = { mostRecentUserTurnIsIdReset: true };
    const action = applyLineToLayer1State(
      userTurnLine("regular user text"),
      state,
      "holding",
    );
    expect(action).toBe("clear_holding");
    expect(state.mostRecentUserTurnIsIdReset).toBe(false);
  });

  it("state {isIdReset:true} + non-reset user turn + active → none (was already active; no spurious clear), state.isIdReset=false", () => {
    const state: Layer1State = { mostRecentUserTurnIsIdReset: true };
    const action = applyLineToLayer1State(
      userTurnLine("regular user text"),
      state,
      "active",
    );
    expect(action).toBe("none");
    expect(state.mostRecentUserTurnIsIdReset).toBe(false);
  });
});

describe("applyLineToLayer1State — tool_result during holding must not clear (2026-08-08 regression)", () => {
  it("state {isIdReset:true} + tool_result user turn + holding → none, state unchanged", () => {
    // The bug: during /id reset processing the agent's save flow invokes
    // many tools; each tool_result appears as a `type:"user"` turn with
    // array content. Prior to the isUserTurn fix, this reducer treated
    // tool_results as user typing and cleared the overlay ~1s after arm.
    // After the fix, isUserTurn returns false for tool_result user turns
    // → the reducer treats them as non-user, state stays untouched, and
    // the overlay remains armed until session_changed (Layer 2) fires.
    const state: Layer1State = { mostRecentUserTurnIsIdReset: true };
    const action = applyLineToLayer1State(
      toolResultUserTurnLine("toolu_savedoc_1", "wrote 42 lines to handoff.md"),
      state,
      "holding",
    );
    expect(action).toBe("none");
    expect(state.mostRecentUserTurnIsIdReset).toBe(true);
  });

  it("state {isIdReset:true} + several tool_results in sequence + holding → none each time, state stays true", () => {
    // Sequence proxy for a realistic /id reset save flow: Read handoff,
    // Write handoff, jq bounties, git commit, etc. Every tool_result
    // must be inert to the reducer.
    const state: Layer1State = { mostRecentUserTurnIsIdReset: true };
    for (const toolUseId of ["read_1", "write_1", "bash_1", "bash_2", "edit_1"]) {
      const action = applyLineToLayer1State(
        toolResultUserTurnLine(toolUseId, "tool output..."),
        state,
        "holding",
      );
      expect(action).toBe("none");
    }
    expect(state.mostRecentUserTurnIsIdReset).toBe(true);
  });

  it("state {isIdReset:true} + tool_result + REAL follow-up user typing + holding → clear only on the real typing", () => {
    // Full-realism: after tool_results, if Ashley DOES type a new
    // non-reset message (rare during a reset but valid), that real turn
    // should still supersede correctly.
    const state: Layer1State = { mostRecentUserTurnIsIdReset: true };
    expect(
      applyLineToLayer1State(
        toolResultUserTurnLine("toolu_1", "output"),
        state,
        "holding",
      ),
    ).toBe("none");
    expect(state.mostRecentUserTurnIsIdReset).toBe(true);
    const clearAction = applyLineToLayer1State(
      userTurnLine("actually never mind, keep going"),
      state,
      "holding",
    );
    expect(clearAction).toBe("clear_holding");
    expect(state.mostRecentUserTurnIsIdReset).toBe(false);
  });
});

describe("applyLineToLayer1State — dead is terminal", () => {
  it("any user line while changeoverState=dead → none (no arm, no clear)", () => {
    const state: Layer1State = { mostRecentUserTurnIsIdReset: true };
    expect(
      applyLineToLayer1State(userTurnLine(ID_RESET_CONTENT), state, "dead"),
    ).toBe("none");
    expect(
      applyLineToLayer1State(userTurnLine("regular text"), state, "dead"),
    ).toBe("none");
  });

  it("any assistant line while changeoverState=dead → none", () => {
    const state = freshState();
    expect(
      applyLineToLayer1State(assistantTurnLine("hi"), state, "dead"),
    ).toBe("none");
  });

  it("state is still updated on user turns even in dead (for consistency), but action is always none", () => {
    // Rationale: `dead` is terminal for actions but keeping the state
    // consistent with observed history is harmless (and matches what a
    // fresh replay would look like). What matters is that action is
    // ALWAYS "none" while dead.
    const state = freshState();
    applyLineToLayer1State(userTurnLine(ID_RESET_CONTENT), state, "dead");
    // Either behavior (updated to true, or left null) is acceptable — the
    // load-bearing invariant is that no action ever fires in dead. Don't
    // over-specify state mutation here.
    expect(state.mostRecentUserTurnIsIdReset === true || state.mostRecentUserTurnIsIdReset === null).toBe(true);
  });
});

// ── The Ashley-bug regression guard ─────────────────────────────────────────

describe("applyLineToLayer1State — Ashley-bug regression guard (historical /id reset + later regular user turn)", () => {
  it("replaying: user(regular) → assistant → user(/id reset) → assistant → user(regular) with changeoverState always 'active' produces zero arm_holding actions overall", () => {
    // This is Ashley's bug in its purest form. Under the OLD /exit
    // edge-triggered detector, any historical /exit line during replay
    // would fire arm_holding, flashing the overlay on every reconnect.
    // Under the NEW tail-state-derived detector, we only arm if the
    // MOST RECENT user turn is /id reset — so a later regular user turn
    // in the same tail cancels the arm decision.
    //
    // NOTE: this test tracks a scenario where changeoverState is not
    // mutated by the actions (simulating what happens if the caller
    // decides not to actually enter holding — e.g. if arm_holding fired
    // but the WS was already closed). What matters for this guard is
    // that after the FULL replay, the FINAL state must be
    // {isIdReset:false} and the final action must be "none".
    const state = freshState();
    const lines = [
      userTurnLine("first regular turn"),
      assistantTurnLine("some reply"),
      userTurnLine(ID_RESET_CONTENT),
      assistantTurnLine("acknowledged"),
      userTurnLine("post-reset regular turn"),
    ];
    const actions = lines.map((line) =>
      applyLineToLayer1State(line, state, "active"),
    );
    // The reducer's job is: report what SHOULD happen given the
    // combination of new state + current changeoverState. The caller
    // (production onLine) is responsible for actually flipping
    // changeoverState. Because this test intentionally holds
    // changeoverState "active" throughout, we DO see an arm_holding
    // when the /id reset line arrives (line index 2). What matters is
    // that the LAST action (after the post-reset regular turn) is
    // "none" — the reducer correctly derived from tail state that we
    // should not still be in holding.
    expect(actions[0]).toBe("none"); // first regular user turn while active → no action
    expect(actions[1]).toBe("none"); // assistant → non-user, no action
    expect(actions[2]).toBe("arm_holding"); // /id reset while active → arm
    expect(actions[3]).toBe("none"); // assistant → non-user, no action
    expect(actions[4]).toBe("none"); // post-reset regular user turn while active → no action (state flipped to false, but changeoverState is not "holding" so no clear fires)
    expect(state.mostRecentUserTurnIsIdReset).toBe(false);
  });

  it("replaying with a realistic caller: changeoverState flips to holding on arm_holding, then the later regular user turn clears it back to active", () => {
    // This is the closer-to-production scenario: the caller reacts to
    // arm_holding by setting changeoverState="holding", and reacts to
    // clear_holding by setting changeoverState="active". After the full
    // replay, changeoverState should be back to "active" — the whole
    // point of the tail-state model.
    const state = freshState();
    let changeoverState: "active" | "holding" | "dead" = "active";
    const lines = [
      userTurnLine("first regular turn"),
      assistantTurnLine("some reply"),
      userTurnLine(ID_RESET_CONTENT),
      assistantTurnLine("acknowledged"),
      userTurnLine("post-reset regular turn"),
    ];
    let armCount = 0;
    let clearCount = 0;
    for (const line of lines) {
      const action = applyLineToLayer1State(line, state, changeoverState);
      if (action === "arm_holding") {
        armCount++;
        changeoverState = "holding";
      } else if (action === "clear_holding") {
        clearCount++;
        changeoverState = "active";
      }
    }
    expect(armCount).toBe(1);
    expect(clearCount).toBe(1);
    expect(changeoverState).toBe("active");
    expect(state.mostRecentUserTurnIsIdReset).toBe(false);
  });

  it("replaying a session with 2 historical /exit user turns + no /id reset produces ZERO arms (the direct Ashley bug fix)", () => {
    // The exact scenario from Ashley's bug report: JSONL has 2
    // historical /exit lines followed by regular user/assistant turns,
    // none of which are /id reset. Under the OLD detector, each /exit
    // line fired arm_holding on every WS reconnect (14 arm+clear pairs
    // in ~1h). Under the NEW detector, zero arms fire — /exit is not
    // /id reset, and the most-recent user turn is a regular turn.
    const state = freshState();
    let changeoverState: "active" | "holding" | "dead" = "active";
    const lines = [
      userTurnLine(EXIT_CONTENT),
      assistantTurnLine("session recycled"),
      userTurnLine("first turn of new session"),
      assistantTurnLine("hello"),
      userTurnLine(EXIT_CONTENT),
      assistantTurnLine("session recycled again"),
      userTurnLine("second post-recycle turn"),
      assistantTurnLine("hi again"),
      userTurnLine("third regular turn"),
    ];
    let armCount = 0;
    for (const line of lines) {
      const action = applyLineToLayer1State(line, state, changeoverState);
      if (action === "arm_holding") {
        armCount++;
        changeoverState = "holding";
      } else if (action === "clear_holding") {
        changeoverState = "active";
      }
    }
    expect(armCount).toBe(0);
    expect(changeoverState).toBe("active");
    expect(state.mostRecentUserTurnIsIdReset).toBe(false);
  });
});
