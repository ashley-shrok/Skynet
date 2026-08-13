/**
 * pid-to-tmux.test.ts — Unit tests for PID→tmux correlation functions.
 * All dependencies (readEnviron, resolveTmuxName) are mocked; no real SSH,
 * no real /proc, no real tmux required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractTmuxPaneFromEnviron,
  isValidTmuxPaneId,
  resolvePidToTmuxSession,
} from "./pid-to-tmux.js";

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
// extractTmuxPaneFromEnviron tests
// ---------------------------------------------------------------------------

describe("extractTmuxPaneFromEnviron", () => {
  it("Test 1: extracts TMUX_PANE from a Buffer of NUL-separated env vars", () => {
    const buf = Buffer.from(
      "HOME=/home/ubuntu\0TMUX_PANE=%2\0TERM=xterm-256color\0",
      "utf8",
    );
    expect(extractTmuxPaneFromEnviron(buf)).toBe("%2");
  });

  it("Test 2: returns null when TMUX_PANE is absent", () => {
    const buf = Buffer.from("HOME=/home/ubuntu\0TERM=xterm\0", "utf8");
    expect(extractTmuxPaneFromEnviron(buf)).toBeNull();
  });

  it("Test 3: returns null when TMUX_PANE value is empty", () => {
    const buf = Buffer.from("TMUX_PANE=\0", "utf8");
    expect(extractTmuxPaneFromEnviron(buf)).toBeNull();
  });

  it("Test 4: returns null for TMUX_PANE_SOMETHING_ELSE= (strict prefix match)", () => {
    // Must match TMUX_PANE= exactly — prefixed alternatives must NOT match
    const buf = Buffer.from("TMUX_PANE_SOMETHING_ELSE=%2\0", "utf8");
    expect(extractTmuxPaneFromEnviron(buf)).toBeNull();
  });

  it("Test 5: accepts a plain string in addition to Buffer", () => {
    const str = "HOME=/home/ubuntu\0TMUX_PANE=%13\0TERM=screen\0";
    expect(extractTmuxPaneFromEnviron(str)).toBe("%13");
  });
});

// ---------------------------------------------------------------------------
// isValidTmuxPaneId tests
// ---------------------------------------------------------------------------

describe("isValidTmuxPaneId", () => {
  it("Test 6a: accepts %2", () => {
    expect(isValidTmuxPaneId("%2")).toBe(true);
  });

  it("Test 6b: accepts %13", () => {
    expect(isValidTmuxPaneId("%13")).toBe(true);
  });

  it("Test 6c: rejects '2' (no leading %)", () => {
    expect(isValidTmuxPaneId("2")).toBe(false);
  });

  it("Test 6d: rejects '%abc' (non-digit after %)", () => {
    expect(isValidTmuxPaneId("%abc")).toBe(false);
  });

  it("Test 6e: rejects shell metacharacters", () => {
    expect(isValidTmuxPaneId("$(rm -rf /)")).toBe(false);
  });

  it("Test 6f: rejects empty string", () => {
    expect(isValidTmuxPaneId("")).toBe(false);
  });

  it("Test 6g: rejects '%' alone (no digits)", () => {
    expect(isValidTmuxPaneId("%")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolvePidToTmuxSession tests
// ---------------------------------------------------------------------------

describe("resolvePidToTmuxSession", () => {
  const pid = 3941934;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test 7: resolves PID to trimmed session name on happy path", async () => {
    const mockReadEnviron = vi
      .fn()
      .mockResolvedValue(Buffer.from("TMUX_PANE=%2\0", "utf8"));
    const mockResolveTmuxName = vi.fn().mockResolvedValue("tina\n");

    const result = await resolvePidToTmuxSession(pid, {
      readEnviron: mockReadEnviron,
      resolveTmuxName: mockResolveTmuxName,
    });

    expect(result).toBe("tina"); // trimmed
    expect(mockReadEnviron).toHaveBeenCalledWith(pid);
    // Pane ID passed verbatim to resolveTmuxName — no shell escaping at this layer
    expect(mockResolveTmuxName).toHaveBeenCalledWith("%2");
  });

  it("Test 8: returns null and logs fleet_status_environ_read_failed when readEnviron returns null", async () => {
    const mockReadEnviron = vi.fn().mockResolvedValue(null);
    const mockResolveTmuxName = vi.fn();

    const result = await resolvePidToTmuxSession(pid, {
      readEnviron: mockReadEnviron,
      resolveTmuxName: mockResolveTmuxName,
    });

    expect(result).toBeNull();
    expect(systemLogger.warn).toHaveBeenCalledOnce();
    const warnCall = vi.mocked(systemLogger.warn).mock.calls[0];
    expect(warnCall[1]).toMatchObject({
      operation: "fleet_status_environ_read_failed",
      pid,
    });
  });

  it("Test 9: returns null and logs fleet_status_tmux_pane_absent when TMUX_PANE is absent", async () => {
    const mockReadEnviron = vi
      .fn()
      .mockResolvedValue(Buffer.from("HOME=/home/ubuntu\0TERM=xterm\0", "utf8"));
    const mockResolveTmuxName = vi.fn();

    const result = await resolvePidToTmuxSession(pid, {
      readEnviron: mockReadEnviron,
      resolveTmuxName: mockResolveTmuxName,
    });

    expect(result).toBeNull();
    expect(mockResolveTmuxName).not.toHaveBeenCalled();
    expect(systemLogger.warn).toHaveBeenCalledOnce();
    const warnCall = vi.mocked(systemLogger.warn).mock.calls[0];
    expect(warnCall[1]).toMatchObject({
      operation: "fleet_status_tmux_pane_absent",
      pid,
    });
  });

  it("Test 10: returns null and does NOT call resolveTmuxName when pane ID fails isValidTmuxPaneId", async () => {
    // A compromised /proc read returns an invalid pane ID
    const mockReadEnviron = vi
      .fn()
      .mockResolvedValue("TMUX_PANE=$(rm -rf /)\0");
    const mockResolveTmuxName = vi.fn();

    const result = await resolvePidToTmuxSession(pid, {
      readEnviron: mockReadEnviron,
      resolveTmuxName: mockResolveTmuxName,
    });

    expect(result).toBeNull();
    // Defense-in-depth: resolveTmuxName must NOT be called with invalid pane
    expect(mockResolveTmuxName).not.toHaveBeenCalled();
    expect(systemLogger.warn).toHaveBeenCalledOnce();
    const warnCall = vi.mocked(systemLogger.warn).mock.calls[0];
    expect(warnCall[1]).toMatchObject({
      operation: "fleet_status_tmux_pane_invalid",
      pid,
    });
  });

  it("Test 11: returns null and logs fleet_status_tmux_name_unresolved when resolveTmuxName returns null", async () => {
    const mockReadEnviron = vi
      .fn()
      .mockResolvedValue(Buffer.from("TMUX_PANE=%2\0", "utf8"));
    const mockResolveTmuxName = vi.fn().mockResolvedValue(null);

    const result = await resolvePidToTmuxSession(pid, {
      readEnviron: mockReadEnviron,
      resolveTmuxName: mockResolveTmuxName,
    });

    expect(result).toBeNull();
    expect(systemLogger.warn).toHaveBeenCalledOnce();
    const warnCall = vi.mocked(systemLogger.warn).mock.calls[0];
    expect(warnCall[1]).toMatchObject({
      operation: "fleet_status_tmux_name_unresolved",
      pid,
      pane: "%2",
    });
  });

  it("Test 12: returns null and logs fleet_status_tmux_name_unresolved when resolveTmuxName returns empty-after-trim", async () => {
    const mockReadEnviron = vi
      .fn()
      .mockResolvedValue(Buffer.from("TMUX_PANE=%2\0", "utf8"));
    // Only whitespace returned — tmux server not running or pane vanished
    const mockResolveTmuxName = vi.fn().mockResolvedValue("   \n  ");

    const result = await resolvePidToTmuxSession(pid, {
      readEnviron: mockReadEnviron,
      resolveTmuxName: mockResolveTmuxName,
    });

    expect(result).toBeNull();
    expect(systemLogger.warn).toHaveBeenCalledOnce();
    const warnCall = vi.mocked(systemLogger.warn).mock.calls[0];
    expect(warnCall[1]).toMatchObject({
      operation: "fleet_status_tmux_name_unresolved",
    });
  });
});
