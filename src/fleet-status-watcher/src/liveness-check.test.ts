/**
 * Tests for liveness-check.ts — isPidAlive + readProcStart.
 *
 * Tests 1-4 per plan spec (Task 2).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist the mock factory — vi.mock calls are hoisted by Vitest to run before imports
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    readdir: vi.fn(),
  },
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

// Import AFTER vi.mock declarations (hoisting ensures mock is active)
import fs from "node:fs/promises";
import { isPidAlive, readProcStart } from "./liveness-check.js";

// Get the mock reference
const mockReadFile = vi.mocked(fs.readFile);

// A typical /proc/<pid>/stat line with normal comm
const NORMAL_STAT =
  "12345 (bash) S 1 12345 12345 0 -1 4194560 100 0 0 0 0 0 0 0 20 0 1 0 53836667 100835328 2289 18446744073709551615 93953428557824 93953428631021 140722561659968 0 0 0 65536 4 65538 1 0 0 17 1 0 0 0 0 0 93953430729016 93953430779712 93953434046464 140722561663280 140722561663300 140722561663300 140722561667052 0";

// A stat line with spaces in the comm field (tricky)
const PARENS_STAT =
  "12345 (bash with (parens)) S 1 12345 12345 0 -1 4194560 100 0 0 0 0 0 0 0 20 0 1 0 53836667 100835328 2289 18446744073709551615 93953428557824 93953428631021 140722561659968 0 0 0 65536 4 65538 1 0 0 17 1 0 0 0 0 0 93953430729016 93953430779712 93953434046464 140722561663280 140722561663300 140722561663300 140722561667052 0";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// readProcStart tests
// ---------------------------------------------------------------------------
describe("readProcStart", () => {
  it("Test 4a: parses field 22 from normal stat line returning '53836667'", async () => {
    mockReadFile.mockResolvedValueOnce(NORMAL_STAT as unknown as Buffer);
    const result = await readProcStart(12345);
    expect(result).toBe("53836667");
  });

  it("Test 4b: parses field 22 correctly for tricky-comm fixture with nested parens", async () => {
    // "12345 (bash with (parens)) S 1 12345 12345 0 -1 4194560 100 0 0 0 0 0 0 0 20 0 1 0 53836667 ..."
    mockReadFile.mockResolvedValueOnce(PARENS_STAT as unknown as Buffer);
    const result = await readProcStart(12345);
    expect(result).toBe("53836667");
  });

  it("returns null on ENOENT (dead PID)", async () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockReadFile.mockRejectedValueOnce(err);
    const result = await readProcStart(99999);
    expect(result).toBeNull();
  });

  it("returns null on other read errors", async () => {
    const err = Object.assign(new Error("EPERM"), { code: "EPERM" });
    mockReadFile.mockRejectedValueOnce(err);
    const result = await readProcStart(12345);
    expect(result).toBeNull();
  });

  it("returns null for malformed stat (no closing paren)", async () => {
    mockReadFile.mockResolvedValueOnce(
      "12345 bash S 1 12345 12345 0" as unknown as Buffer,
    );
    const result = await readProcStart(12345);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isPidAlive tests
// ---------------------------------------------------------------------------
describe("isPidAlive", () => {
  it("Test 1: returns true when field 22 matches procStart", async () => {
    mockReadFile.mockResolvedValueOnce(NORMAL_STAT as unknown as Buffer);
    const result = await isPidAlive(12345, "53836667");
    expect(result).toBe(true);
  });

  it("Test 2: returns false when field 22 differs (PID reuse simulation)", async () => {
    mockReadFile.mockResolvedValueOnce(NORMAL_STAT as unknown as Buffer);
    const result = await isPidAlive(12345, "999999");
    expect(result).toBe(false);
  });

  it("Test 3: returns false when ENOENT (dead PID)", async () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockReadFile.mockRejectedValueOnce(err);
    const result = await isPidAlive(99999, "53836667");
    expect(result).toBe(false);
  });

  it("isPidAlive(3941934, '53836667') returns true when stat reports 53836667", async () => {
    const statLine =
      "3941934 (node) S 1 3941934 3941934 0 -1 4194560 100 0 0 0 0 0 0 0 20 0 1 0 53836667 100835328 2289 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0 0 0 0 0 0 0 0";
    mockReadFile.mockResolvedValueOnce(statLine as unknown as Buffer);
    const result = await isPidAlive(3941934, "53836667");
    expect(result).toBe(true);
  });

  it("isPidAlive(3941934, '53836667') returns false when stat reports 999999", async () => {
    const statLine =
      "3941934 (node) S 1 3941934 3941934 0 -1 4194560 100 0 0 0 0 0 0 0 20 0 1 0 999999 100835328 2289 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0 0 0 0 0 0 0 0";
    mockReadFile.mockResolvedValueOnce(statLine as unknown as Buffer);
    const result = await isPidAlive(3941934, "53836667");
    expect(result).toBe(false);
  });
});
