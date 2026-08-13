/**
 * Tests for logger.ts — watcherLogger structured JSON output.
 *
 * Tests 3 + 4 per plan spec.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { watcherLogger, extractErrorFields } from "./logger.js";

// Capture stderr output
function captureStderr(fn: () => void): string {
  let captured = "";
  const original = process.stderr.write.bind(process.stderr);
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    captured += chunk;
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
    void original;
  }
  return captured;
}

// Parse the first JSON line from captured output
function parseLogLine(output: string): Record<string, unknown> {
  const line = output.trim().split("\n")[0];
  if (!line) throw new Error("No output captured");
  return JSON.parse(line) as Record<string, unknown>;
}

describe("watcherLogger", () => {
  // ---------------------------------------------------------------------------
  // Test 3: emits valid single-line JSON and does NOT JSON.stringify Error objects
  // ---------------------------------------------------------------------------
  it("Test 3a: emits a valid single-line JSON object per call", () => {
    const output = captureStderr(() => {
      watcherLogger.info("test message", { operation: "test_op" });
    });

    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = parseLogLine(output);
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("test message");
    expect(typeof entry.timestamp).toBe("string");
    // Confirm it parses as ISO date
    expect(new Date(entry.timestamp as string).getTime()).toBeGreaterThan(0);
    expect(entry.operation).toBe("test_op");
  });

  it("Test 3b: does NOT include Event.prototype or raw Error properties when passed an Error via extractErrorFields", () => {
    const err = new Error("something broke");
    const fields = extractErrorFields(err);

    // Confirm it only has message + stack + name — no enumerable Error prototype properties
    // and definitely no [object Event]-style serialisation issues
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining(["message", "stack", "name"]),
    );
    // No extra keys that an Error itself doesn't own
    const extraKeys = Object.keys(fields).filter(
      (k) => !["message", "stack", "name"].includes(k),
    );
    expect(extraKeys).toHaveLength(0);

    // Confirm that passing it through watcherLogger doesn't throw
    const output = captureStderr(() => {
      watcherLogger.error("error occurred", { err: fields });
    });

    const entry = parseLogLine(output);
    expect(entry.level).toBe("error");
    expect(entry.message).toBe("error occurred");
    const errField = entry.err as Record<string, unknown>;
    expect(errField.message).toBe("something broke");
    expect(typeof errField.stack).toBe("string");
  });

  it("Test 3c: warn level emits valid JSON with level=warn", () => {
    const output = captureStderr(() => {
      watcherLogger.warn("something suspicious", { pid: 12345 });
    });
    const entry = parseLogLine(output);
    expect(entry.level).toBe("warn");
    expect(entry.pid).toBe(12345);
  });

  it("Test 3d: error level emits valid JSON with level=error", () => {
    const output = captureStderr(() => {
      watcherLogger.error("fatal error", { code: "ENOENT" });
    });
    const entry = parseLogLine(output);
    expect(entry.level).toBe("error");
    expect(entry.code).toBe("ENOENT");
  });

  // ---------------------------------------------------------------------------
  // Test 4: watcherLogger accepts hostId + pid + sessionId as standard fields
  // ---------------------------------------------------------------------------
  it("Test 4a: accepts hostId + pid + sessionId at top level of JSON payload", () => {
    const output = captureStderr(() => {
      watcherLogger.info("session updated", {
        hostId: "skynet-ec2",
        pid: 3941934,
        sessionId: "c7274f12-0dbf-4fa7-9a89-9c35b6b5b39a",
        operation: "session_update",
      });
    });

    const entry = parseLogLine(output);
    expect(entry.hostId).toBe("skynet-ec2");
    expect(entry.pid).toBe(3941934);
    expect(entry.sessionId).toBe("c7274f12-0dbf-4fa7-9a89-9c35b6b5b39a");
    expect(entry.operation).toBe("session_update");
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("session updated");
  });

  it("Test 4b: emits exactly one newline-terminated JSON line per call", () => {
    const output = captureStderr(() => {
      watcherLogger.info("first", { hostId: "box-1", pid: 100, sessionId: "s1" });
      watcherLogger.info("second", { hostId: "box-1", pid: 200, sessionId: "s2" });
    });

    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    const second = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(first.message).toBe("first");
    expect(first.pid).toBe(100);
    expect(second.message).toBe("second");
    expect(second.pid).toBe(200);
  });

  it("extractErrorFields handles string errors", () => {
    const fields = extractErrorFields("plain string error");
    expect(fields).toEqual({ message: "plain string error" });
  });

  it("extractErrorFields handles non-Error objects with raw field", () => {
    const fields = extractErrorFields({ code: 42 });
    expect(fields).toHaveProperty("raw");
  });
});
