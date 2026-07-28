import { describe, it, expect, vi, afterEach } from "vitest";
import { discoverClaudeSession } from "./session-file-discovery.js";

// Mock the tmux-helper module. queryPaneCurrentCommand is included in the factory
// to satisfy the module contract even though the new code no longer calls it —
// if a future refactor re-adds a call, the mock will capture it.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
  queryPanePid: vi.fn(),
  queryPaneCurrentCommand: vi.fn(),
}));

import { execCommand, queryPanePid } from "../ssh/tmux-helper.js";

// Stub ssh2 Client — execCommand is mocked at module level so conn is never accessed.
const fakeConn = {} as import("ssh2").Client;

// Helper: build a mock execCommand implementation that returns different outputs
// depending on whether the script is the walk script (contains "ps -eo") or the
// CWD/JSONL discovery script (contains "readlink -f").
//
// walkPidOutput: the PID string the walk would emit (i.e. the output of the full
//   `ps -eo ... | awk ...` pipeline — the JS layer treats execCommand as a black
//   box, so the mock returns the final result, not the raw ps table).
// discoveryOutput: the JSONL path the CWD/JSONL script would emit.
function mockExecCommand(
  walkPidOutput: string | (() => Promise<string>),
  discoveryOutput: string,
) {
  vi.mocked(execCommand).mockImplementation(
    (_conn: import("ssh2").Client, script: string): Promise<string> => {
      if (script.includes("ps -eo")) {
        // Walk script — return the resolved claude PID (or "" if none found)
        if (typeof walkPidOutput === "function") {
          return walkPidOutput();
        }
        return Promise.resolve(walkPidOutput);
      }
      if (script.includes("readlink -f")) {
        // CWD/JSONL discovery script
        return Promise.resolve(discoveryOutput);
      }
      return Promise.resolve("");
    },
  );
}

describe("discoverClaudeSession — kiro-cli-term wrapper fix", () => {
  afterEach(() => {
    vi.mocked(execCommand).mockReset();
    vi.mocked(queryPanePid).mockReset();
    vi.useRealTimers();
  });

  // Case 1: Kiro-style wrapper (the primary bug fix)
  // pane_pid=100 (kiro-cli-term), pid=101 ppid=100 (bash), pid=102 ppid=101 (claude)
  // Walk emits "102" (the awk output); CWD/JSONL discovery runs with PID=102.
  it("CASE 1: kiro-cli-term wrapper — walks descendants and finds claude grandchild (pid 102)", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(100);
    mockExecCommand(
      // The walk script (ps | awk) would emit "102" — the PID with comm=claude
      "102",
      "/home/ubuntu/.claude/projects/-home-ubuntu-project/abc123.jsonl",
    );

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({
      status: "active",
      pid: 102,
      sessionFile: "/home/ubuntu/.claude/projects/-home-ubuntu-project/abc123.jsonl",
    });
  });

  // Case 2: Deeper wrapper — 4-level chain: pane_pid=100 → shell=101 → wrapper=102 → claude=103
  // Walk emits "103" (the awk output for the deepest claude descendant).
  it("CASE 2: deeper wrapper (4-level chain) — walk returns deepest descendant claude pid (103)", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(100);
    mockExecCommand(
      // The walk script (ps | awk) would emit "103"
      "103",
      "/home/ubuntu/.claude/projects/-home-ubuntu-project/deep.jsonl",
    );

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({
      status: "active",
      pid: 103,
      sessionFile: "/home/ubuntu/.claude/projects/-home-ubuntu-project/deep.jsonl",
    });
  });

  // Case 3: pane_pid IS claude directly (backcompat)
  // Walk must include pane_pid itself as a valid candidate — no `pid[i] != root` guard.
  // Walk emits "200" (pane_pid itself, which has comm=claude).
  it("CASE 3: pane_pid is claude directly (backcompat) — walk returns pane_pid itself (200)", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(200);
    mockExecCommand(
      // The walk script emits "200" — pane_pid itself has comm=claude
      "200",
      "/home/ubuntu/.claude/projects/-home-ubuntu-direct/session.jsonl",
    );

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({
      status: "active",
      pid: 200,
      sessionFile: "/home/ubuntu/.claude/projects/-home-ubuntu-direct/session.jsonl",
    });
  });

  // Case 4: No claude anywhere in the descendant tree → not_claude
  // Walk emits "" (empty output from awk — no pid with comm=claude found).
  it("CASE 4: no claude in pane_pid descendant tree — returns inactive/not_claude", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(300);
    mockExecCommand(
      // The walk script emits "" — no comm=claude found
      "",
      "",
    );

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({ status: "inactive", reason: "not_claude" });
  });

  // Case 5: No tmux session — queryPanePid returns null → no_tmux_session, walk must NOT run
  it("CASE 5: queryPanePid returns null — returns inactive/no_tmux_session without running walk", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(null);
    // execCommand should never be called in this case
    vi.mocked(execCommand).mockImplementation(() => {
      throw new Error("execCommand must not be called when pane_pid is null");
    });

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({ status: "inactive", reason: "no_tmux_session" });
    expect(vi.mocked(execCommand)).not.toHaveBeenCalled();
  });

  // Case 6: Walk exec timeout → exec_error
  it("CASE 6: walk exec times out — returns inactive/exec_error", async () => {
    vi.useFakeTimers();
    vi.mocked(queryPanePid).mockResolvedValue(400);
    // Walk script never resolves
    vi.mocked(execCommand).mockImplementation(
      (_conn: import("ssh2").Client, script: string): Promise<string> => {
        if (script.includes("ps -eo")) {
          return new Promise(() => {}); // never resolves
        }
        return Promise.resolve("");
      },
    );

    // Start the discovery (do not await yet — need to advance timers)
    const resultPromise = discoverClaudeSession(fakeConn, "test-session");

    // Advance past the 3000ms DISCOVERY_EXEC_TIMEOUT_MS
    await vi.advanceTimersByTimeAsync(3100);

    const result = await resultPromise;
    expect(result).toEqual({ status: "inactive", reason: "exec_error" });
  });

  // Case 7: CWD/JSONL script fails after walk succeeds → exec_error
  it("CASE 7: walk succeeds (returns pid 102) but CWD/JSONL script exec rejects — returns inactive/exec_error", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(100);
    vi.mocked(execCommand).mockImplementation(
      (_conn: import("ssh2").Client, script: string): Promise<string> => {
        if (script.includes("ps -eo")) {
          // Walk emits "102" — the awk output (the PID, not raw ps table)
          return Promise.resolve("102");
        }
        if (script.includes("readlink -f")) {
          return Promise.reject(new Error("SSH exec channel error"));
        }
        return Promise.resolve("");
      },
    );

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({ status: "inactive", reason: "exec_error" });
  });

  // Case 8: CWD/JSONL script returns empty output after walk succeeds → no_open_session_file
  it("CASE 8: walk succeeds (returns pid 102) but CWD/JSONL script returns empty — returns inactive/no_open_session_file", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(100);
    mockExecCommand(
      "102", // walk emits the PID
      "", // no jsonl file found
    );

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({ status: "inactive", reason: "no_open_session_file" });
  });
});
