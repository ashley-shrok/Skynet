/**
 * Phase 31 D-03 smoke suite for console-forward-transport.ts.
 *
 * Tests assert that backend log lines are buffered, flushed to the shared
 * console-forward.log file, and carry a source="backend" marker. Uses a
 * tmp-file override via SKYNET_CONSOLE_FORWARD_LOG_PATH.
 *
 * NOTE (post-#392 fix): flush() switched from sync fs.appendFileSync to
 * async fs.appendFile to eliminate event-loop stall under high log volume
 * (see bounty phase-31-ws-regression-rca). Tests now poll for the async
 * write to land before asserting.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  enqueueBackendLog,
  flushBackendLogs,
  __test_reset,
  __test_getBuffer,
  type BackendLogEntry,
} from "./console-forward-transport.js";

// Each test uses a unique tmp file via the env var that getLogPath() reads.
let tmpLog: string;

beforeEach(() => {
  __test_reset();
  tmpLog = path.join(os.tmpdir(), `cft-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
  process.env.SKYNET_CONSOLE_FORWARD_LOG_PATH = tmpLog;
});

afterEach(() => {
  __test_reset();
  try {
    fs.unlinkSync(tmpLog);
  } catch {
    // file may not exist if the test never flushed
  }
  delete process.env.SKYNET_CONSOLE_FORWARD_LOG_PATH;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function readLines(): BackendLogEntry[] {
  try {
    const content = fs.readFileSync(tmpLog, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as BackendLogEntry);
  } catch {
    return [];
  }
}

/** Poll until the tmp log has at least `n` lines, or timeout. */
async function waitForLines(n: number, timeoutMs = 500): Promise<BackendLogEntry[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lines = readLines();
    if (lines.length >= n) return lines;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return readLines();
}

describe("console-forward-transport", () => {
  it("Test 1: enqueue + flush writes JSON line with source=backend, matching ts/level/msg", async () => {
    enqueueBackendLog({ level: "info", msg: "[ws-server] accept hostId=1" });
    flushBackendLogs();

    const lines = await waitForLines(1);
    expect(lines).toHaveLength(1);
    const entry = lines[0];
    expect(entry.source).toBe("backend");
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("[ws-server] accept hostId=1");
    expect(typeof entry.ts).toBe("string");
    // ts must be a valid ISO string
    expect(() => new Date(entry.ts)).not.toThrow();
  });

  it("Test 2: 20 enqueues auto-flush at MAX_BATCH boundary without explicit flush call", async () => {
    for (let i = 0; i < 20; i++) {
      enqueueBackendLog({ level: "info", msg: `line ${i}` });
    }
    // After 20th enqueue the buffer should have auto-flushed
    const lines = await waitForLines(20);
    expect(lines).toHaveLength(20);
    for (const line of lines) {
      expect(line.source).toBe("backend");
    }
  });

  it("Test 3: 5 enqueues auto-flush after FLUSH_INTERVAL_MS=500ms via timer", async () => {
    for (let i = 0; i < 5; i++) {
      enqueueBackendLog({ level: "warn", msg: `timer-line ${i}` });
    }
    // Buffer should not have flushed yet (well under 500ms)
    expect(readLines()).toHaveLength(0);

    // Wait past FLUSH_INTERVAL_MS + async write completion budget.
    const lines = await waitForLines(5, 1500);
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(line.source).toBe("backend");
    }
  });

  it("Test 4: flushBackendLogs with empty buffer is a no-op — does not create the file", () => {
    flushBackendLogs();
    expect(fs.existsSync(tmpLog)).toBe(false);
  });

  it("Test 5: failed file write is swallowed (best-effort D-19) — does not throw and stderr is written", async () => {
    // Mock fs.appendFile to invoke callback with an error
    const appendSpy = vi
      .spyOn(fs, "appendFile")
      .mockImplementation(
        (
          _path: fs.PathOrFileDescriptor,
          _data: string | Uint8Array,
          cb: fs.NoParamCallback | { encoding?: BufferEncoding | null; mode?: fs.Mode; flag?: fs.OpenMode; flush?: boolean } | BufferEncoding,
        ): void => {
          if (typeof cb === "function") {
            cb(new Error("disk full"));
          }
        },
      );
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    enqueueBackendLog({ level: "error", msg: "test error line" });
    // Explicit flush; the async callback runs on the next tick.
    expect(() => flushBackendLogs()).not.toThrow();

    // Give the async callback a tick to fire.
    await new Promise((resolve) => setTimeout(resolve, 20));
    // stderr note about the failed write should have been emitted.
    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(stderrCalls.some((s) => s.includes("appendFile failed"))).toBe(true);

    appendSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("Test 6: concurrent enqueues in the same tick coalesce into a single appendFile call", async () => {
    const appendCalls: number[] = [];
    const appendSpy: MockInstance = vi
      .spyOn(fs, "appendFile")
      .mockImplementation(
        (
          filePath: fs.PathOrFileDescriptor,
          data: string | Uint8Array,
          cb: fs.NoParamCallback | { encoding?: BufferEncoding | null; mode?: fs.Mode; flag?: fs.OpenMode; flush?: boolean } | BufferEncoding,
        ): void => {
          appendCalls.push(Date.now());
          fs.appendFileSync(filePath as fs.PathOrFileDescriptor, data);
          if (typeof cb === "function") cb(null);
        },
      );

    for (let i = 0; i < 5; i++) {
      enqueueBackendLog({ level: "info", msg: `concurrent-${i}` });
    }
    flushBackendLogs();

    // Give async writes time to complete
    await new Promise((resolve) => setTimeout(resolve, 20));

    // All 5 lines should have been written in exactly 1 appendFile call
    expect(appendCalls.length).toBe(1);
    const lines = readLines();
    expect(lines).toHaveLength(5);

    appendSpy.mockRestore();
  });
});
