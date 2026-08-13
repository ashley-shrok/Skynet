/**
 * ambient-filter.test.ts — Unit tests for ambient task filtering.
 * Exercises all seven BackgroundTask type discriminants from RESEARCH §1.
 */
import { describe, it, expect } from "vitest";
import { isAmbientTask, filterAmbientTasks } from "./ambient-filter.js";
import type { BackgroundTask } from "./wire-protocol.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeShellTask(description?: string): BackgroundTask {
  return {
    id: "shell-1",
    type: "shell",
    status: "running",
    ...(description !== undefined ? { description } : {}),
  };
}

function makeSubagentTask(description?: string): BackgroundTask {
  return {
    id: "subagent-1",
    type: "subagent",
    status: "running",
    ...(description !== undefined ? { description } : {}),
  };
}

function makeMonitorTask(description?: string): BackgroundTask {
  return {
    id: "monitor-1",
    type: "monitor",
    status: "running",
    server: "some-mcp",
    tool: "watch",
    ...(description !== undefined ? { description } : {}),
  };
}

function makeWorkflowTask(description?: string): BackgroundTask {
  return {
    id: "workflow-1",
    type: "workflow",
    status: "running",
    name: "deploy-flow",
    ...(description !== undefined ? { description } : {}),
  };
}

function makeTeammateTask(description?: string): BackgroundTask {
  return {
    id: "teammate-1",
    type: "teammate",
    status: "running",
    ...(description !== undefined ? { description } : {}),
  };
}

function makeCloudSessionTask(description?: string): BackgroundTask {
  return {
    id: "cloud-1",
    type: "cloud session",
    status: "running",
    ...(description !== undefined ? { description } : {}),
  };
}

function makeMcpTask(description?: string): BackgroundTask {
  return {
    id: "mcp-1",
    type: "MCP task",
    status: "running",
    server: "my-server",
    tool: "my-tool",
    ...(description !== undefined ? { description } : {}),
  };
}

// ---------------------------------------------------------------------------
// isAmbientTask tests
// ---------------------------------------------------------------------------

describe("isAmbientTask", () => {
  it("Test 1: returns true for monitor task with [ambient] prefix", () => {
    const task = makeMonitorTask("[ambient] recv monitor");
    expect(isAmbientTask(task)).toBe(true);
  });

  it("Test 2: returns false for shell task with non-ambient description", () => {
    const task = makeShellTask("tail logs");
    expect(isAmbientTask(task)).toBe(false);
  });

  it("Test 3: returns false for monitor task with no description", () => {
    const task = makeMonitorTask(); // no description
    expect(isAmbientTask(task)).toBe(false);
  });

  it("Test 4: returns false when description is 'ambient' without brackets", () => {
    const task = makeMonitorTask("ambient");
    expect(isAmbientTask(task)).toBe(false);
  });

  it("Test 5: returns false for [Ambient] (case-sensitive — uppercase not treated as ambient)", () => {
    const task = makeMonitorTask("[Ambient] recv");
    expect(isAmbientTask(task)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterAmbientTasks tests
// ---------------------------------------------------------------------------

describe("filterAmbientTasks", () => {
  it("Test 6: filters ambient, preserves non-ambient and no-description tasks in order", () => {
    const a: BackgroundTask = makeMonitorTask("[ambient] recv"); // ambient
    const b: BackgroundTask = makeShellTask("tail logs"); // non-ambient
    const c: BackgroundTask = makeMonitorTask(); // no description — NOT ambient

    const result = filterAmbientTasks([a, b, c]);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(b); // original reference preserved
    expect(result[1]).toBe(c);
  });

  it("Test 7: returns [] for empty input", () => {
    expect(filterAmbientTasks([])).toEqual([]);
  });

  it("Test 8: does NOT mutate the input array", () => {
    const ambient = makeMonitorTask("[ambient] wakeup");
    const nonAmbient = makeShellTask("tail logs");
    const input = Object.freeze([ambient, nonAmbient]) as BackgroundTask[];

    // Object.freeze prevents any in-place mutation from throwing a TypeError
    expect(() => filterAmbientTasks(input)).not.toThrow();
    const result = filterAmbientTasks(input);
    expect(result).toHaveLength(1);
    // Input array unchanged (freeze guards this — would have thrown if mutated)
    expect(input).toHaveLength(2);
  });

  it("Test 9: accepts all seven RESEARCH §1 type discriminants; filters the ambient ones", () => {
    const tasks: BackgroundTask[] = [
      // ambient — will be filtered
      makeShellTask("[ambient] shell bg"),
      makeSubagentTask("[ambient] subagent bg"),
      makeMonitorTask("[ambient] monitor bg"),
      // non-ambient — will be preserved
      makeWorkflowTask("deploy"),
      makeTeammateTask("partner"),
      makeCloudSessionTask("cloud-1"),
      makeMcpTask("mcp op"),
    ];

    const result = filterAmbientTasks(tasks);

    expect(result).toHaveLength(4);
    // Verify the preserved tasks are the non-ambient ones, in original order
    expect(result[0].type).toBe("workflow");
    expect(result[1].type).toBe("teammate");
    expect(result[2].type).toBe("cloud session");
    expect(result[3].type).toBe("MCP task");
  });

  it("Test 10: filters unknown-type task with [ambient] description; preserves without", () => {
    // The UnknownTaskSchema fallback in wire-protocol.ts matches any type string
    const unknownAmbient: BackgroundTask = {
      id: "unknown-1",
      type: "some-future-type" as string as BackgroundTask["type"],
      status: "running",
      description: "[ambient] future task",
    };
    const unknownNonAmbient: BackgroundTask = {
      id: "unknown-2",
      type: "some-future-type" as string as BackgroundTask["type"],
      status: "running",
      description: "regular future task",
    };

    const result = filterAmbientTasks([unknownAmbient, unknownNonAmbient]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("unknown-2");
  });
});
