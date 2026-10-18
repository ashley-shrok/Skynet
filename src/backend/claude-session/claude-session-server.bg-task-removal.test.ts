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
    pendingStops: new Map(),
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

function stopResult(stopToolUseId: string, isError = false): string {
  return JSON.stringify({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: stopToolUseId,
          content: isError ? "Permission denied" : '{"message":"Successfully stopped task"}',
          ...(isError ? { is_error: true } : {}),
        },
      ],
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
    expect(state.backgroundedShells.size).toBe(1);
    admit(stopResult("toolu_stop"), state);
    expect(state.backgroundedShells.size).toBe(0);
    expect(state.pendingStops.size).toBe(0);
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
    admit(stopResult("toolu_kill"), state);
    expect(state.backgroundedShells.size).toBe(0);
  });

  it("stops a background agent via TaskStop on its agentId", () => {
    const state = makeState();
    agentLaunch("toolu_agent2", "aece63dc1daaa25d4").forEach((l) =>
      admit(l, state),
    );
    admit(taskStop("toolu_stop2", { task_id: "aece63dc1daaa25d4" }), state);
    admit(stopResult("toolu_stop2"), state);
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

  it("keeps the row when the stop call is denied or fails", () => {
    const state = makeState();
    bashLaunch("toolu_shell5", "bmudu8j03").forEach((l) => admit(l, state));
    admit(taskStop("toolu_stop5", { task_id: "bmudu8j03" }), state);
    admit(stopResult("toolu_stop5", true), state);
    expect(state.backgroundedShells.has("toolu_shell5")).toBe(true);
    expect(state.pendingStops.size).toBe(0);
  });

  it("ignores ids quoted in a notification's summary/result body", () => {
    const state = makeState();
    bashLaunch("toolu_shell6", "bhd0pw54s").forEach((l) => admit(l, state));
    agentLaunch("toolu_agent6", "a1111111111111111").forEach((l) =>
      admit(l, state),
    );
    applyNotification(
      "<task-notification>\n<task-id>a1111111111111111</task-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n<result>Stopped <task-id>bhd0pw54s</task-id> and toolu_shell6 earlier.</result>\n</task-notification>",
      state,
    );
    expect(state.backgroundedAgents.size).toBe(0);
    expect(state.backgroundedShells.has("toolu_shell6")).toBe(true);
  });

  it("does not index foreground (synchronous) Agent results", () => {
    const state = makeState();
    admit(agentLaunch("toolu_sync", "a2222222222222222")[0], state);
    admit(
      JSON.stringify({
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_sync", content: "done" }],
        },
        toolUseResult: { status: "completed", agentId: "a2222222222222222" },
      }),
      state,
    );
    expect(state.taskIdToToolUseId.size).toBe(0);
    expect(state.backgroundedAgents.size).toBe(0);
  });
});
