/**
 * Tests for pid-to-tmux.ts — resolveTmuxSessionForPid + clearPidCache.
 *
 * Tests 5-8 per plan spec (Task 2).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist mocks before any imports
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    readdir: vi.fn(),
  },
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  default: {
    execFile: vi.fn(),
  },
  execFile: vi.fn(),
}));

// Import util — we need promisify to work for execFile wrapping in pid-to-tmux.ts
// The module uses `promisify(execFileCb)` internally, so we mock execFile at the node:child_process level

import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { resolveTmuxSessionForPid, clearPidCache } from "./pid-to-tmux.js";

const mockReadFile = vi.mocked(fs.readFile);
const mockExecFile = vi.mocked(execFile);

// Build a fake environ buffer with TMUX_PANE set (or not)
function makeEnvironBuf(tmuxPane: string | null): Buffer {
  const vars: string[] = [
    "HOME=/home/ubuntu",
    "USER=ubuntu",
    "PATH=/usr/bin:/bin",
  ];
  if (tmuxPane !== null) {
    vars.push(`TMUX_PANE=${tmuxPane}`);
    vars.push("TMUX=/tmp/tmux-1000/default,12345,0");
  }
  return Buffer.from(vars.join("\0") + "\0");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Clear the internal PID cache between tests
  clearPidCache(3941934);
  clearPidCache(131617);
  clearPidCache(180099);
  clearPidCache(99999);
  clearPidCache(11111);
  clearPidCache(22222);
});

// ---------------------------------------------------------------------------
// Test 5: resolveTmuxSessionForPid reads environ, extracts TMUX_PANE, runs tmux
// ---------------------------------------------------------------------------
describe("resolveTmuxSessionForPid", () => {
  it("Test 5: reads /proc/<pid>/environ, extracts TMUX_PANE, spawns tmux display-message, returns trimmed stdout", async () => {
    mockReadFile.mockResolvedValueOnce(makeEnvironBuf("%2") as unknown as string);
    // promisify(execFile) transforms the callback-style execFile into a promise
    // The mock needs to call the callback with (null, stdout, stderr)
    mockExecFile.mockImplementationOnce(
      (_cmd: unknown, _args: unknown, callback: unknown) => {
        (callback as (err: null, stdout: string, stderr: string) => void)(
          null,
          "tina\n",
          "",
        );
        return {} as ReturnType<typeof execFile>;
      },
    );

    const result = await resolveTmuxSessionForPid(3941934);
    expect(result).toBe("tina");

    // Verify execFile was called with the correct arguments (NOT exec — no shell)
    expect(mockExecFile).toHaveBeenCalledWith(
      "tmux",
      ["display-message", "-p", "-t", "%2", "#{session_name}"],
      expect.any(Function),
    );
  });

  // ---------------------------------------------------------------------------
  // Test 6: returns null when TMUX_PANE is absent from environ
  // ---------------------------------------------------------------------------
  it("Test 6: returns null when TMUX_PANE is absent (process not inside tmux)", async () => {
    mockReadFile.mockResolvedValueOnce(
      makeEnvironBuf(null) as unknown as string,
    );

    const result = await resolveTmuxSessionForPid(131617);
    expect(result).toBeNull();
    // tmux should NOT have been invoked
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Test 7: caches per-PID — second call does NOT re-read environ or re-invoke tmux
  // ---------------------------------------------------------------------------
  it("Test 7: caches result per PID — second call uses cache (mock called exactly once)", async () => {
    mockReadFile.mockResolvedValueOnce(
      makeEnvironBuf("%1") as unknown as string,
    );
    mockExecFile.mockImplementationOnce(
      (_cmd: unknown, _args: unknown, callback: unknown) => {
        (callback as (err: null, stdout: string, stderr: string) => void)(
          null,
          "tiffany\n",
          "",
        );
        return {} as ReturnType<typeof execFile>;
      },
    );

    const first = await resolveTmuxSessionForPid(180099);
    expect(first).toBe("tiffany");

    // Second call — should use cache
    const second = await resolveTmuxSessionForPid(180099);
    expect(second).toBe("tiffany");

    // readFile and execFile should each have been called exactly once
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Test 8: clearPidCache drops the cache entry; subsequent resolve re-reads environ
  // ---------------------------------------------------------------------------
  it("Test 8: clearPidCache(pid) drops cache entry; subsequent resolve re-reads environ", async () => {
    // First resolution
    mockReadFile.mockResolvedValueOnce(
      makeEnvironBuf("%2") as unknown as string,
    );
    mockExecFile.mockImplementationOnce(
      (_cmd: unknown, _args: unknown, callback: unknown) => {
        (callback as (err: null, stdout: string, stderr: string) => void)(
          null,
          "tina\n",
          "",
        );
        return {} as ReturnType<typeof execFile>;
      },
    );

    const first = await resolveTmuxSessionForPid(3941934);
    expect(first).toBe("tina");
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile).toHaveBeenCalledTimes(1);

    // Clear cache
    clearPidCache(3941934);

    // Second resolution — should re-read environ and re-invoke tmux
    mockReadFile.mockResolvedValueOnce(
      makeEnvironBuf("%2") as unknown as string,
    );
    mockExecFile.mockImplementationOnce(
      (_cmd: unknown, _args: unknown, callback: unknown) => {
        (callback as (err: null, stdout: string, stderr: string) => void)(
          null,
          "tina\n",
          "",
        );
        return {} as ReturnType<typeof execFile>;
      },
    );

    const second = await resolveTmuxSessionForPid(3941934);
    expect(second).toBe("tina");
    // Both mocks should now have been called twice total
    expect(mockReadFile).toHaveBeenCalledTimes(2);
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it("returns null when /proc/environ cannot be read", async () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockReadFile.mockRejectedValueOnce(err);
    const result = await resolveTmuxSessionForPid(99999);
    expect(result).toBeNull();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("returns null when tmux display-message fails", async () => {
    mockReadFile.mockResolvedValueOnce(
      makeEnvironBuf("%5") as unknown as string,
    );
    mockExecFile.mockImplementationOnce(
      (_cmd: unknown, _args: unknown, callback: unknown) => {
        (callback as (err: Error, stdout: string, stderr: string) => void)(
          new Error("tmux: no server running"),
          "",
          "",
        );
        return {} as ReturnType<typeof execFile>;
      },
    );
    const result = await resolveTmuxSessionForPid(11111);
    expect(result).toBeNull();
  });

  it("returns null and does not call tmux when TMUX_PANE has invalid format", async () => {
    // Invalid TMUX_PANE: not matching /^%\d+$/
    const badEnv = Buffer.from(
      ["HOME=/home/ubuntu", "TMUX_PANE=invalid"].join("\0") + "\0",
    );
    mockReadFile.mockResolvedValueOnce(badEnv as unknown as string);
    const result = await resolveTmuxSessionForPid(22222);
    expect(result).toBeNull();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("caches null result for absent TMUX_PANE (avoid repeated environ reads)", async () => {
    mockReadFile.mockResolvedValueOnce(
      makeEnvironBuf(null) as unknown as string,
    );
    await resolveTmuxSessionForPid(131617);
    // Second call should use cache — no additional readFile
    await resolveTmuxSessionForPid(131617);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });
});
