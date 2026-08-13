/**
 * liveness-check.test.ts — Unit tests for the pure liveness probe functions.
 * All test fixtures are static strings — no real /proc reads, no SSH, no fs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readProcStartField22, isStaleFromStat } from "./liveness-check.js";

// ---------------------------------------------------------------------------
// Mock systemLogger
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { systemLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Helpers for building /proc/<pid>/stat content
// ---------------------------------------------------------------------------

/**
 * Build a realistic /proc/<pid>/stat line with the given comm field and
 * starttime (field 22). All other fields use valid placeholder values.
 *
 *   1  pid
 *   2  (comm)
 *   3  state        -> index 0 after ')'
 *   4  ppid         -> index 1
 *   5  pgrp         -> index 2
 *   6  session      -> index 3
 *   7  tty_nr       -> index 4
 *   8  tpgid        -> index 5
 *   9  flags        -> index 6
 *  10  minflt       -> index 7
 *  11  cminflt      -> index 8
 *  12  majflt       -> index 9
 *  13  cmajflt      -> index 10
 *  14  utime        -> index 11
 *  15  stime        -> index 12
 *  16  cutime       -> index 13
 *  17  cstime       -> index 14
 *  18  priority     -> index 15
 *  19  nice         -> index 16
 *  20  num_threads  -> index 17
 *  21  itrealvalue  -> index 18
 *  22  starttime    -> index 19  ← this is what we parse
 */
function buildStatLine(comm: string, starttime: string): string {
  // 19 filler fields after state (indices 1-18), then starttime at index 19
  const fillers = "1 12345 12345 0 -1 4194560 100 0 0 0 0 0 0 0 20 0 1 0";
  return `12345 (${comm}) S ${fillers} ${starttime} 12345678 0 0 0 0 0 0 0 0 17 0`;
}

// ---------------------------------------------------------------------------
// readProcStartField22 tests
// ---------------------------------------------------------------------------

describe("readProcStartField22", () => {
  it("Test 1: returns field 22 from a standard /proc/<pid>/stat line", () => {
    const statLine = buildStatLine("bash", "53836667");
    expect(readProcStartField22(statLine)).toBe("53836667");
  });

  it("Test 2: handles comm field with spaces and nested parens", () => {
    // The tricky case: the comm field itself contains parens + spaces.
    // lastIndexOf(')') must anchor to the FINAL ')' of the comm wrapper.
    const statLine = buildStatLine("bash with (nested) parens", "53836667");
    expect(readProcStartField22(statLine)).toBe("53836667");
  });

  it("Test 3: returns null when there are no parens at all", () => {
    expect(readProcStartField22("garbage no parens at all")).toBeNull();
  });

  it("Test 4: returns null for an empty string", () => {
    expect(readProcStartField22("")).toBeNull();
  });

  it("Test 5: returns null when there are not enough post-comm fields to reach field 22", () => {
    // Only 5 fields after the ')' — way less than 20 needed
    expect(readProcStartField22("12345 (bash) S 1 12345 12345")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isStaleFromStat tests
// ---------------------------------------------------------------------------

describe("isStaleFromStat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test 6: returns false when procStart matches field 22 (session is LIVE)", () => {
    const statLine = buildStatLine("bash", "53836667");
    expect(isStaleFromStat("53836667", statLine)).toBe(false);
  });

  it("Test 7: returns true when procStart does not match field 22 (PID reused)", () => {
    const statLine = buildStatLine("bash", "999999");
    expect(isStaleFromStat("53836667", statLine)).toBe(true);
  });

  it("Test 8: returns true when statContents is null (ENOENT = pid dead)", () => {
    expect(isStaleFromStat("53836667", null)).toBe(true);
  });

  it("Test 9: returns true when statContents is unparseable", () => {
    expect(isStaleFromStat("53836667", "garbage")).toBe(true);
  });

  it("Test 10: logs systemLogger.warn with operation fleet_status_stat_unparseable when stat is unparseable", () => {
    isStaleFromStat("53836667", "garbage no parens");
    expect(systemLogger.warn).toHaveBeenCalledOnce();
    const warnCall = vi.mocked(systemLogger.warn).mock.calls[0];
    expect(warnCall[1]).toMatchObject({
      operation: "fleet_status_stat_unparseable",
    });
  });
});
