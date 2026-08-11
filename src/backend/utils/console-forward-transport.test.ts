/**
 * Phase 31 D-03 smoke suite for console-forward-transport.ts.
 *
 * Tests assert that backend log lines are buffered, flushed to the shared
 * console-forward.log file, and carry a source="backend" marker. Uses a
 * tmp-file override via SKYNET_CONSOLE_FORWARD_LOG_PATH and vitest fake
 * timers for the FLUSH_INTERVAL_MS test.
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

describe("console-forward-transport", () => {
  it("Test 1: enqueue + flush writes JSON line with source=backend, matching ts/level/msg", () => {
    enqueueBackendLog({ level: "info", msg: "[ws-server] accept hostId=1" });
    flushBackendLogs();

    const lines = readLines();
    expect(lines).toHaveLength(1);
    const entry = lines[0];
    expect(entry.source).toBe("backend");
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("[ws-server] accept hostId=1");
    expect(typeof entry.ts).toBe("string");
    // ts must be a valid ISO string
    expect(() => new Date(entry.ts)).not.toThrow();
  });

  it("Test 2: 20 enqueues auto-flush at MAX_BATCH boundary without explicit flush call", () => {
    for (let i = 0; i < 20; i++) {
      enqueueBackendLog({ level: "info", msg: `line ${i}` });
    }
    // After 20th enqueue the buffer should have auto-flushed
    const lines = readLines();
    expect(lines).toHaveLength(20);
    for (const line of lines) {
      expect(line.source).toBe("backend");
    }
  });

  it("Test 3: 5 enqueues auto-flush after FLUSH_INTERVAL_MS=500ms via timer", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) {
      enqueueBackendLog({ level: "warn", msg: `timer-line ${i}` });
    }
    // Buffer should not have flushed yet
    expect(readLines()).toHaveLength(0);

    // Advance past FLUSH_INTERVAL_MS
    vi.advanceTimersByTime(600);

    const lines = readLines();
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(line.source).toBe("backend");
    }
  });

  it("Test 4: flushBackendLogs with empty buffer is a no-op — does not create the file", () => {
    flushBackendLogs();
    expect(fs.existsSync(tmpLog)).toBe(false);
  });

  it("Test 5: failed file write is swallowed (best-effort D-19) — does not throw", () => {
    // Mock fs.appendFileSync to throw
    const appendSpy = vi
      .spyOn(fs, "appendFileSync")
      .mockImplementation(() => {
        throw new Error("disk full");
      });

    enqueueBackendLog({ level: "error", msg: "test error line" });
    // This should NOT throw
    expect(() => flushBackendLogs()).not.toThrow();

    appendSpy.mockRestore();
  });

  it("Test 6: concurrent enqueues in the same tick coalesce into a single appendFileSync call", () => {
    const appendCalls: number[] = [];
    const origAppend = fs.appendFileSync.bind(fs);
    const appendSpy: MockInstance = vi
      .spyOn(fs, "appendFileSync")
      .mockImplementation((...args: Parameters<typeof fs.appendFileSync>) => {
        appendCalls.push(Date.now());
        return origAppend(...args);
      });

    for (let i = 0; i < 5; i++) {
      enqueueBackendLog({ level: "info", msg: `concurrent-${i}` });
    }
    flushBackendLogs();

    // All 5 lines should have been written in exactly 1 appendFileSync call
    expect(appendCalls.length).toBe(1);
    const lines = readLines();
    expect(lines).toHaveLength(5);

    appendSpy.mockRestore();
  });
});
