import { describe, it, expect } from "vitest";
import {
  __admitBackgroundedAgentsLineForTests as admit,
  type __BackgroundedAgentsCorrelatorStateForTests as State,
} from "./claude-session-server.js";

// Phase 51 Plan 01 — BG-agents panel admission for Claude Code v2.1.150+
// async Agent invocations via the tool_result launch-ack.
//
// Background: The backgrounded_agents correlator in claude-session-server.ts
// used to gate admission on `input.run_in_background === true`. Claude Code
// v2.1.150+ dropped that field from `Agent` tool_use payloads and moved the
// async signal to the tool_result launch-ack (`toolUseResult.isAsync ===
// true`). The parser already reads that signal at ~L2603 as a skip-guard
// (so an async-ack doesn't remove the entry). This test suite exercises the
// four admission paths documented in 51-RESEARCH.md § "Test Plan":
//   Fixture A: Modern async Agent (no run_in_background, ack has isAsync:true)
//              → admitted to backgroundedAgents on the ack.
//   Fixture B: Modern sync Agent (no run_in_background, tool_result is a real
//              completion with no isAsync) → NEVER admitted; scratch dropped.
//   Fixture C: Legacy Agent (input.run_in_background === true) → admitted
//              immediately at tool_use time; survives the async-ack skip-guard;
//              removed on real completion.
//   Fixture D: Full lifecycle of a modern async Agent — intermediate snapshot
//              shows the entry present, final snapshot shows it removed.
//
// All four fixtures exercise the module-scope extracted helper
// __admitBackgroundedAgentsLineForTests, which the in-closure call site at
// ~L2698 in claude-session-server.ts invokes with the same state Maps.

// -------------------- fixture builders --------------------

function makeState(): State {
  return {
    backgroundedAgents: new Map(),
    pendingAgentAdmission: new Map(),
    backgroundedShells: new Map(),
  };
}

// Modern Agent tool_use shape (Claude Code v2.1.150+). Real bytes lifted from
// taylor's live JSONL — see /home/ubuntu/.claude/projects/-home-ubuntu-skynet-
// taylor/c054cef9-c251-4d00-a460-8e90dbead931.jsonl (grep for
// toolu_01C3yz4A5NV4AamxHQRZH7DH). Input keys are exactly [description,
// prompt, subagent_type] — NO run_in_background.
function modernAgentToolUseLine(
  toolUseId: string,
  description: string,
  subagentType: string,
  timestamp: string = "2026-08-20T22:00:00.000Z",
): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    message: {
      content: [
        {
          type: "tool_use",
          id: toolUseId,
          name: "Agent",
          input: {
            description,
            subagent_type: subagentType,
            prompt: "…",
          },
        },
      ],
    },
  });
}

// Legacy Agent tool_use shape (older Claude Code; harnesses that reintroduce
// the field). Input has `run_in_background: true`; identical top-level shape
// to modern. Kept as a separate builder for readability.
function legacyAgentToolUseLine(
  toolUseId: string,
  description: string,
  subagentType: string,
  timestamp: string = "2026-08-20T22:00:00.000Z",
): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    message: {
      content: [
        {
          type: "tool_use",
          id: toolUseId,
          name: "Agent",
          input: {
            description,
            subagent_type: subagentType,
            prompt: "…",
            run_in_background: true,
          },
        },
      ],
    },
  });
}

// Async-launch-ack tool_result. Real bytes lifted from
// /home/ubuntu/.claude/projects/-home-ubuntu/6ff7e6b7-d12f-4165-9674-
// 314a1538d770.jsonl (grep for "isAsync":true). The enclosing turn carries
// toolUseResult:{isAsync:true, status:"async_launched"} and the tool_result
// block carries a text "Async agent launched successfully..." payload.
function asyncAckToolResultLine(
  toolUseId: string,
  timestamp: string = "2026-08-20T22:00:00.100Z",
): string {
  return JSON.stringify({
    type: "user",
    timestamp,
    toolUseResult: {
      isAsync: true,
      status: "async_launched",
      agentId: "adf1a7dd85c0d164a",
    },
    message: {
      content: [
        {
          tool_use_id: toolUseId,
          type: "tool_result",
          content: [
            {
              type: "text",
              text:
                "Async agent launched successfully.\n" +
                "agentId: adf1a7dd85c0d164a\n" +
                "The agent is working in the background.",
            },
          ],
        },
      ],
    },
  });
}

// Non-async (real completion) tool_result. Same shape as the legacy sync
// completion — toolUseResult has NO isAsync field.
function syncCompletionToolResultLine(
  toolUseId: string,
  resultText: string = "Task completed successfully.",
  timestamp: string = "2026-08-20T22:00:10.000Z",
): string {
  return JSON.stringify({
    type: "user",
    timestamp,
    toolUseResult: {
      // deliberate: no isAsync field
      stdout: resultText,
      interrupted: false,
    },
    message: {
      content: [
        {
          tool_use_id: toolUseId,
          type: "tool_result",
          content: [
            {
              type: "text",
              text: resultText,
            },
          ],
        },
      ],
    },
  });
}

// -------------------- test suite --------------------

describe("__admitBackgroundedAgentsLineForTests — Phase 51 Plan 01 fixtures", () => {
  it("Fixture A: modern async Agent (no run_in_background) → admitted on isAsync ack", () => {
    const state = makeState();
    const toolUseId = "toolu_A1";
    admit(
      modernAgentToolUseLine(toolUseId, "Test async agent", "gsd-executor"),
      state,
    );
    // Before the ack, modern Agent is stashed to scratch — NOT yet in
    // backgroundedAgents. (After Task 2 lands the pendingAgentAdmission
    // logic; before Task 2 the tool_use is silently ignored because the
    // legacy gate rejects it. Either way the invariant "not yet in
    // backgroundedAgents at this point" holds.)
    expect(state.backgroundedAgents.has(toolUseId)).toBe(false);

    // Ack arrives ~100ms later → promote scratch → backgroundedAgents.
    admit(asyncAckToolResultLine(toolUseId), state);
    expect(state.backgroundedAgents.has(toolUseId)).toBe(true);
    const entry = state.backgroundedAgents.get(toolUseId);
    expect(entry).toBeDefined();
    expect(entry?.subagentType).toBe("gsd-executor");
    expect(entry?.description).toBe("Test async agent");
    expect(entry?.toolUseId).toBe(toolUseId);
    // startedAt should be derived from the tool_use timestamp, not the ack —
    // the panel wants the true start time so its "N min ago" clock is right.
    expect(entry?.startedAt).toBe(Date.parse("2026-08-20T22:00:00.000Z"));
  });

  it("Fixture B: modern sync Agent (no run_in_background) → scratch dropped, never admitted", () => {
    const state = makeState();
    const toolUseId = "toolu_A2";
    admit(
      modernAgentToolUseLine(toolUseId, "Test sync agent", "code-reviewer"),
      state,
    );
    expect(state.backgroundedAgents.has(toolUseId)).toBe(false);

    // Sync completion arrives (no isAsync field) → both maps must be clean.
    // This is the "sync Agent silently dropped" behavior — never enters
    // backgroundedAgents, no emit noise.
    admit(syncCompletionToolResultLine(toolUseId, "Review done."), state);
    expect(state.backgroundedAgents.has(toolUseId)).toBe(false);
    expect(state.pendingAgentAdmission.has(toolUseId)).toBe(false);
  });

  it("Fixture C: legacy Agent (input.run_in_background === true) → immediate admit, survives ack, removes on completion", () => {
    const state = makeState();
    const toolUseId = "toolu_A3";
    admit(
      legacyAgentToolUseLine(toolUseId, "Legacy background agent", "gsd-executor"),
      state,
    );
    // Legacy fast-path: admitted immediately at tool_use time. Backward
    // compat — older Claude Code (or any future harness that reintroduces
    // the flag) must still work.
    expect(state.backgroundedAgents.has(toolUseId)).toBe(true);
    expect(state.pendingAgentAdmission.has(toolUseId)).toBe(false);

    // Async-launch-ack arrives. Skip-guard preserved: entry stays.
    admit(asyncAckToolResultLine(toolUseId), state);
    expect(state.backgroundedAgents.has(toolUseId)).toBe(true);

    // Real completion arrives (no isAsync): entry removed.
    admit(syncCompletionToolResultLine(toolUseId, "Legacy agent done."), state);
    expect(state.backgroundedAgents.has(toolUseId)).toBe(false);
    expect(state.pendingAgentAdmission.has(toolUseId)).toBe(false);
  });

  it("Fixture D: full modern async lifecycle — intermediate present, final removed", () => {
    const state = makeState();
    const toolUseId = "toolu_A4";
    admit(
      modernAgentToolUseLine(toolUseId, "Full lifecycle test", "planner"),
      state,
    );
    // Intermediate 1: after tool_use, scratch holds the entry but
    // backgroundedAgents does not yet.
    expect(state.backgroundedAgents.has(toolUseId)).toBe(false);

    // Ack arrives → promote.
    admit(asyncAckToolResultLine(toolUseId), state);
    expect(state.backgroundedAgents.has(toolUseId)).toBe(true);
    expect(state.pendingAgentAdmission.has(toolUseId)).toBe(false);

    // Later, real completion → entry removed.
    admit(
      syncCompletionToolResultLine(
        toolUseId,
        "Lifecycle finished.",
        "2026-08-20T22:05:00.000Z",
      ),
      state,
    );
    expect(state.backgroundedAgents.has(toolUseId)).toBe(false);
    expect(state.pendingAgentAdmission.has(toolUseId)).toBe(false);
  });
});
