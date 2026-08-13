/**
 * Tests for stop-hook-socket.ts — createStopHookSocketServer + filterAmbientTasks.
 *
 * Tests 6-8 (socket + filter) per plan spec (Task 3).
 * Test 8 (index.ts integration) is handled in index.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createStopHookSocketServer, filterAmbientTasks } from "./stop-hook-socket.js";
import type { BackgroundTask, StopHookPayload } from "./types.js";

// Use a unique socket path per test to avoid collisions
function makeSockPath(suffix: string): string {
  return path.join(os.tmpdir(), `test-stop-hook-${process.pid}-${suffix}.sock`);
}

// Helper: write a length-prefixed JSON payload to a socket
function sendPayload(sockPath: string, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(payload);
    const jsonBuf = Buffer.from(json, "utf-8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(jsonBuf.length, 0);
    const full = Buffer.concat([header, jsonBuf]);

    const client = net.createConnection(sockPath, () => {
      client.write(full, (err) => {
        if (err) {
          client.destroy();
          reject(err);
        } else {
          client.end();
        }
      });
    });

    client.on("close", () => resolve());
    client.on("error", reject);
  });
}

// Wait for a server to start listening
function waitForServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) {
      resolve();
    } else {
      server.once("listening", resolve);
    }
  });
}

afterEach(async () => {
  // Small delay to let sockets close
  await new Promise((r) => setTimeout(r, 20));
});

// ---------------------------------------------------------------------------
// filterAmbientTasks tests
// ---------------------------------------------------------------------------
describe("filterAmbientTasks", () => {
  it("Test 7a: removes entries where description startsWith '[ambient]'", () => {
    const tasks: BackgroundTask[] = [
      {
        type: "monitor",
        id: "a",
        status: "running",
        description: "[ambient] recv",
      },
      {
        type: "shell",
        id: "b",
        status: "running",
        description: "tail logs",
        command: "tail -f x",
      },
      {
        type: "monitor",
        id: "c",
        status: "running",
        // No description — must be preserved
      },
    ];

    const result = filterAmbientTasks(tasks);
    expect(result.map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("Test 7b: exact filterAmbientTasks fixture from plan acceptance criteria", () => {
    const tasks: BackgroundTask[] = [
      {
        type: "monitor",
        id: "a",
        status: "running",
        description: "[ambient] recv",
        server: "mcp",
        tool: "recv",
      },
      {
        type: "shell",
        id: "b",
        status: "running",
        description: "tail logs",
        command: "tail -f x",
      },
      {
        type: "monitor",
        id: "c",
        status: "running",
        server: "mcp",
        tool: "other",
        // No description field
      },
    ];

    const result = filterAmbientTasks(tasks);
    const ids = result.map((t) => t.id);
    expect(ids).toContain("b");
    expect(ids).toContain("c");
    expect(ids).not.toContain("a");
    expect(result).toHaveLength(2);
  });

  it("preserves tasks with undefined description", () => {
    const tasks: BackgroundTask[] = [
      { type: "shell", id: "x", status: "running" },
    ];
    expect(filterAmbientTasks(tasks)).toHaveLength(1);
  });

  it("removes all ambient tasks from a list", () => {
    const tasks: BackgroundTask[] = [
      {
        type: "monitor",
        id: "m1",
        status: "running",
        description: "[ambient] monitor 1",
      },
      {
        type: "monitor",
        id: "m2",
        status: "running",
        description: "[ambient] monitor 2",
      },
    ];
    expect(filterAmbientTasks(tasks)).toHaveLength(0);
  });

  it("handles empty array", () => {
    expect(filterAmbientTasks([])).toHaveLength(0);
  });

  it("does not filter tasks with description that merely contains '[ambient]' mid-string", () => {
    const tasks: BackgroundTask[] = [
      {
        type: "shell",
        id: "y",
        status: "running",
        description: "not [ambient] but contains it",
        command: "echo hi",
      },
    ];
    expect(filterAmbientTasks(tasks)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test 6: createStopHookSocketServer accepts connection, reads length-prefixed payload
// ---------------------------------------------------------------------------
describe("createStopHookSocketServer", () => {
  it("Test 6: accepts connection, reads 4-byte BE header + JSON body, invokes onPayload, closes connection", async () => {
    const sockPath = makeSockPath("t6");

    const receivedPayloads: StopHookPayload[] = [];
    const server = createStopHookSocketServer({
      socketPath: sockPath,
      onPayload(p) {
        receivedPayloads.push(p);
      },
    });

    await waitForServer(server);

    const payload: StopHookPayload = {
      session_id: "test-session-123",
      transcript_path: "/home/ubuntu/.claude/projects/-home-ubuntu/abc.jsonl",
      cwd: "/home/ubuntu",
      permission_mode: "default",
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: "Done",
      background_tasks: [],
    };

    await sendPayload(sockPath, payload);

    // Wait for payload to be processed
    await vi.waitFor(() => expect(receivedPayloads).toHaveLength(1), {
      timeout: 2000,
    });

    expect(receivedPayloads[0]?.session_id).toBe("test-session-123");
    expect(receivedPayloads[0]?.hook_event_name).toBe("Stop");

    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Clean up socket file
    try { fs.unlinkSync(sockPath); } catch { /* ignore */ }
  });

  it("drops malformed JSON payload without crashing", async () => {
    const sockPath = makeSockPath("malformed");

    let payloadCount = 0;
    const server = createStopHookSocketServer({
      socketPath: sockPath,
      onPayload() {
        payloadCount++;
      },
    });

    await waitForServer(server);

    // Send a malformed JSON payload (raw bytes that aren't valid JSON)
    await new Promise<void>((resolve, reject) => {
      const junk = Buffer.from("not valid json", "utf-8");
      const header = Buffer.alloc(4);
      header.writeUInt32BE(junk.length, 0);
      const client = net.createConnection(sockPath, () => {
        client.write(Buffer.concat([header, junk]), () => {
          client.end();
        });
      });
      client.on("close", resolve);
      client.on("error", reject);
    });

    // Small delay to let processing happen
    await new Promise((r) => setTimeout(r, 50));

    expect(payloadCount).toBe(0);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    try { fs.unlinkSync(sockPath); } catch { /* ignore */ }
  });

  it("handles multiple sequential connections correctly", async () => {
    const sockPath = makeSockPath("multi");

    const received: string[] = [];
    const server = createStopHookSocketServer({
      socketPath: sockPath,
      onPayload(p) {
        received.push(p.session_id);
      },
    });

    await waitForServer(server);

    const makePayload = (sessionId: string): StopHookPayload => ({
      session_id: sessionId,
      transcript_path: "/tmp/foo.jsonl",
      cwd: "/tmp",
      permission_mode: "default",
      hook_event_name: "Stop",
      stop_hook_active: false,
      background_tasks: [],
    });

    await sendPayload(sockPath, makePayload("sess-1"));
    await sendPayload(sockPath, makePayload("sess-2"));

    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 2000 });
    expect(received).toContain("sess-1");
    expect(received).toContain("sess-2");

    await new Promise<void>((resolve) => server.close(() => resolve()));
    try { fs.unlinkSync(sockPath); } catch { /* ignore */ }
  });
});
