/**
 * Tests for types.ts — SessionJson schema (v2.1.150) + BackgroundTask discriminated union.
 */

import { describe, it, expect } from "vitest";
import {
  SessionJsonSchema,
  BackgroundTaskSchema,
} from "./types.js";

// ---------------------------------------------------------------------------
// Test 1: SessionJson parses verified v2.1.150 schema fields
// ---------------------------------------------------------------------------
describe("SessionJsonSchema", () => {
  const validBase = {
    pid: 3941934,
    sessionId: "c7274f12-0dbf-4fa7-9a89-9c35b6b5b39a",
    cwd: "/home/ubuntu",
    startedAt: 1786576479287,
    procStart: "53836667",
    version: "2.1.150",
    status: "busy" as const,
    updatedAt: 1786577996976,
  };

  it("Test 1: parses all required v2.1.150 fields (no optional fields)", () => {
    const result = SessionJsonSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pid).toBe(3941934);
      expect(result.data.sessionId).toBe("c7274f12-0dbf-4fa7-9a89-9c35b6b5b39a");
      expect(result.data.cwd).toBe("/home/ubuntu");
      expect(result.data.procStart).toBe("53836667");
      expect(result.data.version).toBe("2.1.150");
      expect(result.data.status).toBe("busy");
      expect(result.data.updatedAt).toBe(1786577996976);
    }
  });

  it("parses with optional fields present (full v2.1.150 shape)", () => {
    const full = {
      ...validBase,
      peerProtocol: 1,
      kind: "interactive",
      entrypoint: "cli",
    };
    const result = SessionJsonSchema.safeParse(full);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.peerProtocol).toBe(1);
      expect(result.data.kind).toBe("interactive");
      expect(result.data.entrypoint).toBe("cli");
    }
  });

  it("parses waiting status with waitingFor field", () => {
    const waiting = {
      ...validBase,
      status: "waiting" as const,
      waitingFor: "approve Bash",
    };
    const result = SessionJsonSchema.safeParse(waiting);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("waiting");
      expect(result.data.waitingFor).toBe("approve Bash");
    }
  });

  it("rejects missing required fields", () => {
    const noPid = { ...validBase };
    // @ts-expect-error intentional
    delete noPid.pid;
    expect(SessionJsonSchema.safeParse(noPid).success).toBe(false);
  });

  it("rejects invalid status value", () => {
    const bad = { ...validBase, status: "unknown" };
    expect(SessionJsonSchema.safeParse(bad).success).toBe(false);
  });

  it("parses all four status values", () => {
    for (const status of ["busy", "shell", "idle", "waiting"] as const) {
      const r = SessionJsonSchema.safeParse({ ...validBase, status });
      expect(r.success, `status=${status} should parse`).toBe(true);
    }
  });

  it("parses bridgeSessionId optional field (thenasty-style sessions)", () => {
    const with_bridge = { ...validBase, bridgeSessionId: "some-bridge-uuid" };
    const result = SessionJsonSchema.safeParse(with_bridge);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bridgeSessionId).toBe("some-bridge-uuid");
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2: BackgroundTask covers all seven type discriminants
// ---------------------------------------------------------------------------
describe("BackgroundTaskSchema", () => {
  it("Test 2: parses shell task with command field", () => {
    const task = {
      id: "task-001",
      type: "shell",
      status: "running",
      description: "tail logs",
      command: "tail -f /var/log/syslog",
    };
    const result = BackgroundTaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("shell");
      if (result.data.type === "shell") {
        expect(result.data.command).toBe("tail -f /var/log/syslog");
      }
    }
  });

  it("parses subagent task with agent_type field", () => {
    const task = {
      id: "task-002",
      type: "subagent",
      status: "running",
      description: "research agent",
      agent_type: "researcher",
    };
    const result = BackgroundTaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "subagent") {
      expect(result.data.agent_type).toBe("researcher");
    }
  });

  it("parses monitor task with server + tool fields", () => {
    const task = {
      id: "task-003",
      type: "monitor",
      status: "running",
      description: "[ambient] recv monitor",
      server: "mcp-server",
      tool: "recv",
    };
    const result = BackgroundTaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "monitor") {
      expect(result.data.server).toBe("mcp-server");
      expect(result.data.tool).toBe("recv");
    }
  });

  it("parses workflow task with name field", () => {
    const task = {
      id: "task-004",
      type: "workflow",
      status: "running",
      name: "my-workflow",
    };
    const result = BackgroundTaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "workflow") {
      expect(result.data.name).toBe("my-workflow");
    }
  });

  it("parses teammate task", () => {
    const task = {
      id: "task-005",
      type: "teammate",
      status: "running",
      description: "peer agent",
    };
    const result = BackgroundTaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("teammate");
    }
  });

  it('parses cloud session task', () => {
    const task = {
      id: "task-006",
      type: "cloud session",
      status: "running",
    };
    const result = BackgroundTaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("cloud session");
    }
  });

  it("parses MCP task with server + tool fields", () => {
    const task = {
      id: "task-007",
      type: "MCP task",
      status: "running",
      server: "filesystem",
      tool: "read_file",
    };
    const result = BackgroundTaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "MCP task") {
      expect(result.data.server).toBe("filesystem");
    }
  });

  it("rejects unknown type discriminant", () => {
    const task = { id: "x", type: "unknown-type", status: "running" };
    expect(BackgroundTaskSchema.safeParse(task).success).toBe(false);
  });

  it("tasks with no description are valid (description is optional)", () => {
    const task = { id: "x", type: "shell", status: "running" };
    const result = BackgroundTaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
    }
  });
});
