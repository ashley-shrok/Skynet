/**
 * types.test.ts — Unit tests for fleet-status harness payload types.
 * Covers SessionJson + StopHookPayload schemas and their safe-parse helpers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SessionJsonSchema,
  StopHookPayloadSchema,
  parseSessionJson,
  parseStopHookPayload,
} from "./types.js";

// ---------------------------------------------------------------------------
// Mock systemLogger to capture warn calls without actual log output
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mock is set up
import { systemLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseSessionJsonFixture = {
  pid: 3941934,
  sessionId: "abc-uuid",
  cwd: "/home/ubuntu",
  startedAt: 1786576479287,
  procStart: "53836667",
  version: "2.1.150",
  status: "busy" as const,
  updatedAt: 1786577996976,
};

const baseStopHookPayloadFixture = {
  session_id: "abc123",
  transcript_path: "~/.claude/projects/.../00893aaf.jsonl",
  cwd: "/home/ubuntu",
  permission_mode: "default",
  hook_event_name: "Stop" as const,
  stop_hook_active: true,
  background_tasks: [
    {
      id: "task-001",
      type: "shell" as const,
      status: "running",
      description: "tail logs",
      command: "tail -f /var/log/syslog",
    },
  ],
};

// ---------------------------------------------------------------------------
// SessionJsonSchema tests
// ---------------------------------------------------------------------------

describe("SessionJsonSchema", () => {
  it("Test 1: parses a valid v2.1.150 fixture with required fields only", () => {
    const result = SessionJsonSchema.safeParse(baseSessionJsonFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pid).toBe(3941934);
    expect(result.data.sessionId).toBe("abc-uuid");
    expect(result.data.cwd).toBe("/home/ubuntu");
    expect(result.data.startedAt).toBe(1786576479287);
    expect(result.data.procStart).toBe("53836667");
    expect(result.data.version).toBe("2.1.150");
    expect(result.data.status).toBe("busy");
    expect(result.data.updatedAt).toBe(1786577996976);
  });

  it("Test 2: accepts optional fields when present", () => {
    const withOptionals = {
      ...baseSessionJsonFixture,
      waitingFor: "approve Bash",
      bridgeSessionId: "xyz",
      kind: "interactive",
      entrypoint: "cli",
      peerProtocol: 1,
    };
    const result = SessionJsonSchema.safeParse(withOptionals);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.waitingFor).toBe("approve Bash");
    expect(result.data.bridgeSessionId).toBe("xyz");
    expect(result.data.kind).toBe("interactive");
    expect(result.data.entrypoint).toBe("cli");
    expect(result.data.peerProtocol).toBe(1);
  });

  it("Test 3: REJECTS a fixture missing sessionId", () => {
    const { sessionId: _omit, ...withoutSessionId } = baseSessionJsonFixture;
    const result = SessionJsonSchema.safeParse(withoutSessionId);
    expect(result.success).toBe(false);
    if (result.success) return;
    const sessionIdIssue = result.error.issues.find((i) =>
      i.path.includes("sessionId"),
    );
    expect(sessionIdIssue).toBeDefined();
  });

  it("Test 4: REJECTS a fixture with an invalid status value", () => {
    const withBadStatus = { ...baseSessionJsonFixture, status: "broken" };
    const result = SessionJsonSchema.safeParse(withBadStatus);
    expect(result.success).toBe(false);
    if (result.success) return;
    const statusIssue = result.error.issues.find((i) =>
      i.path.includes("status"),
    );
    expect(statusIssue).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// parseSessionJson tests
// ---------------------------------------------------------------------------

describe("parseSessionJson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test 5: returns typed SessionJson for valid JSON string input", () => {
    const raw = JSON.stringify(baseSessionJsonFixture);
    const result = parseSessionJson(raw);
    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe("abc-uuid");
    expect(result?.pid).toBe(3941934);
  });

  it("Test 6: returns null and logs warn when raw is not valid JSON", () => {
    const result = parseSessionJson("not valid json {{{");
    expect(result).toBeNull();
    expect(systemLogger.warn).toHaveBeenCalledOnce();
    const warnCall = vi.mocked(systemLogger.warn).mock.calls[0];
    expect(warnCall[1]).toMatchObject({
      operation: "fleet_status_session_json_parse_failed",
    });
  });

  it("Test 7: returns null when valid JSON fails schema validation", () => {
    const badData = { ...baseSessionJsonFixture, sessionId: undefined };
    const raw = JSON.stringify(badData);
    const result = parseSessionJson(raw);
    expect(result).toBeNull();
    expect(systemLogger.warn).toHaveBeenCalledOnce();
    const warnCall = vi.mocked(systemLogger.warn).mock.calls[0];
    expect(warnCall[1]).toMatchObject({
      operation: "fleet_status_session_json_schema_validation_failed",
    });
    // issues array should be present with at least one entry
    expect(
      (warnCall[1] as Record<string, unknown>).issues,
    ).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// StopHookPayloadSchema tests
// ---------------------------------------------------------------------------

describe("StopHookPayloadSchema", () => {
  it("Test 8: parses the canonical Stop payload fixture with all discriminants", () => {
    const allDiscriminants = {
      ...baseStopHookPayloadFixture,
      background_tasks: [
        // shell
        {
          id: "t1",
          type: "shell",
          status: "running",
          description: "tail logs",
          command: "tail -f x",
        },
        // subagent
        {
          id: "t2",
          type: "subagent",
          status: "running",
          description: "worker",
          agent_type: "worker",
        },
        // monitor
        {
          id: "t3",
          type: "monitor",
          status: "running",
          description: "recv",
          server: "some-mcp",
          tool: "watch",
        },
        // workflow
        {
          id: "t4",
          type: "workflow",
          status: "running",
          name: "deploy-flow",
        },
        // teammate
        {
          id: "t5",
          type: "teammate",
          status: "running",
        },
        // cloud session
        {
          id: "t6",
          type: "cloud session",
          status: "running",
        },
        // MCP task
        {
          id: "t7",
          type: "MCP task",
          status: "running",
          server: "my-server",
          tool: "my-tool",
        },
      ],
    };
    const result = StopHookPayloadSchema.safeParse(allDiscriminants);
    expect(result.success).toBe(true);
    if (!result.success) {
      console.error("Issues:", result.error.issues);
      return;
    }
    expect(result.data.hook_event_name).toBe("Stop");
    expect(result.data.background_tasks).toHaveLength(7);
  });

  it("Test 10: background_tasks accepts a monitor-type entry with [ambient] description", () => {
    // Structural check: the schema element for background_tasks accepts monitor entries
    const monitorEntry = {
      id: "m1",
      type: "monitor",
      status: "running",
      server: "some-mcp",
      tool: "watch",
      description: "[ambient] recv",
    };
    const fixture = {
      ...baseStopHookPayloadFixture,
      background_tasks: [monitorEntry],
    };
    const result = StopHookPayloadSchema.safeParse(fixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.background_tasks[0].description).toBe("[ambient] recv");
  });
});

// ---------------------------------------------------------------------------
// parseStopHookPayload tests
// ---------------------------------------------------------------------------

describe("parseStopHookPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test 9a: returns typed value on success", () => {
    const raw = JSON.stringify(baseStopHookPayloadFixture);
    const result = parseStopHookPayload(raw);
    expect(result).not.toBeNull();
    expect(result?.hook_event_name).toBe("Stop");
    expect(result?.session_id).toBe("abc123");
  });

  it("Test 9b: returns null and logs warn when raw is not valid JSON", () => {
    const result = parseStopHookPayload("not json");
    expect(result).toBeNull();
    expect(systemLogger.warn).toHaveBeenCalledOnce();
    const warnCall = vi.mocked(systemLogger.warn).mock.calls[0];
    expect(warnCall[1]).toMatchObject({
      operation: "fleet_status_stop_hook_payload_json_parse_failed",
    });
  });

  it("Test 9c: returns null and logs warn when schema validation fails", () => {
    // Missing required hook_event_name
    const bad = { ...baseStopHookPayloadFixture, hook_event_name: "NotStop" };
    const result = parseStopHookPayload(JSON.stringify(bad));
    expect(result).toBeNull();
    expect(systemLogger.warn).toHaveBeenCalledOnce();
    const warnCall = vi.mocked(systemLogger.warn).mock.calls[0];
    expect(warnCall[1]).toMatchObject({
      operation: "fleet_status_stop_hook_payload_schema_validation_failed",
    });
  });

  it("Test 9d: never throws on any input", () => {
    // These should all be safe — no throws
    expect(() => parseStopHookPayload("")).not.toThrow();
    expect(() => parseStopHookPayload("null")).not.toThrow();
    expect(() => parseStopHookPayload("{invalid")).not.toThrow();
    expect(() => parseStopHookPayload("42")).not.toThrow();
  });
});
