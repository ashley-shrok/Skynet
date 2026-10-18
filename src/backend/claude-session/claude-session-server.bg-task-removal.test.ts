import { describe, it, expect } from "vitest";
import {
  __admitBackgroundedAgentsLineForTests as admit,
  __applyTaskNotificationForTests as applyNotification,
  type __BackgroundedAgentsCorrelatorStateForTests as State,
} from "./claude-session-server.js";

// Removal paths for the Agents / Shells panels beyond the tool-use-id
// notification: "killed" status, <task-id>-only notifications (newer
// harnesses), and agent-initiated TaskStop / KillShell. Shapes mirror real
// Claude Code v2.1.286 JSONL lines.

function makeState(): State {
  return {
    backgroundedAgents: new Map(),
    pendingAgentAdmission: new Map(),
    backgroundedShells: new Map(),
    taskIdToToolUseId: new Map(),
  };
}

function bashLaunch(toolUseId: string, taskId: string): string[] {
  return [
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-10-18T19:00:00.000Z",
      message: {
        content: [
          {
            type: "tool_use",
            id: toolUseId,
            name: "Bash",
            input: {
              command: "python3 -m http.server 8899",
              description: "Serve prototype",
              run_in_background: true,
            },
          },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: `Command running in background with ID: ${taskId}.`,
          },
        ],
      },
      toolUseResult: {
        stdout: "",
        stderr: "",
        interrupted: false,
        backgroundTaskId: taskId,
      },
    }),
  ];
}

function agentLaunch(toolUseId: string, agentId: string): string[] {
  return [
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-10-18T19:00:00.000Z",
      message: {
        content: [
          {
            type: "tool_use",
            id: toolUseId,
            name: "Agent",
            input: {
              description: "Audit lifecycle flows",
              subagent_type: "general-purpose",
              prompt: "…",
            },
          },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: [{ type: "text", text: "Async agent launched successfully." }],
          },
        ],
      },
      toolUseResult: {
        isAsync: true,
        status: "async_launched",
        agentId,
      },
    }),
  ];
}

function taskStop(toolUseId: string, input: Record<string, string>): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: toolUseId, name: "TaskStop", input }],
    },
  });
}

describe("backgrounded task removal", () => {
  it("removes a shell on a killed notification", () => {
    const state = makeState();
    bashLaunch("toolu_shell1", "bvw1vda9m").forEach((l) => admit(l, state));
    expect(state.backgroundedShells.has("toolu_shell1")).toBe(true);

    applyNotification(
      "<task-notification>\n<task-id>bvw1vda9m</task-id>\n<tool-use-id>toolu_shell1</tool-use-id>\n<status>killed</status>\n</task-notification>",
      state,
    );
    expect(state.backgroundedShells.size).toBe(0);
  });

  it("removes an agent on a notification carrying only <task-id>", () => {
    const state = makeState();
    agentLaunch("toolu_agent1", "a53b8b02c5d553024").forEach((l) =>
      admit(l, state),
    );
    expect(state.backgroundedAgents.has("toolu_agent1")).toBe(true);

    applyNotification(
      '<task-notification>\n<task-id>a53b8b02c5d553024</task-id>\n<status>completed</status>\n<summary>Agent "Audit lifecycle flows" finished</summary>\n</task-notification>',
      state,
    );
    expect(state.backgroundedAgents.size).toBe(0);
  });

  it("removes a shell when the agent stops it via TaskStop", () => {
    const state = makeState();
    bashLaunch("toolu_shell2", "bz72m2a29").forEach((l) => admit(l, state));
    admit(taskStop("toolu_stop", { task_id: "bz72m2a29" }), state);
    expect(state.backgroundedShells.size).toBe(0);
    expect(state.taskIdToToolUseId.size).toBe(0);
  });

  it("removes a shell when stopped via legacy KillShell shell_id", () => {
    const state = makeState();
    bashLaunch("toolu_shell3", "b1kanlkcn").forEach((l) => admit(l, state));
    admit(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_kill",
              name: "KillShell",
              input: { shell_id: "b1kanlkcn" },
            },
          ],
        },
      }),
      state,
    );
    expect(state.backgroundedShells.size).toBe(0);
  });

  it("stops a background agent via TaskStop on its agentId", () => {
    const state = makeState();
    agentLaunch("toolu_agent2", "aece63dc1daaa25d4").forEach((l) =>
      admit(l, state),
    );
    admit(taskStop("toolu_stop2", { task_id: "aece63dc1daaa25d4" }), state);
    expect(state.backgroundedAgents.size).toBe(0);
  });

  it("ignores non-terminal notifications and unknown task ids", () => {
    const state = makeState();
    bashLaunch("toolu_shell4", "bp42xylgs").forEach((l) => admit(l, state));
    applyNotification(
      "<task-notification>\n<task-id>bp42xylgs</task-id>\n<status>running</status>\n</task-notification>",
      state,
    );
    admit(taskStop("toolu_stop3", { task_id: "bsomethingelse" }), state);
    expect(state.backgroundedShells.has("toolu_shell4")).toBe(true);
  });
});
