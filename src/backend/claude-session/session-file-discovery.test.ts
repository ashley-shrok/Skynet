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

// Helper: build a mock execCommand implementation that dispatches based on the
// script content to different outputs. Three dispatch keys:
//
//   "ps -eo"            → walk script (produces the claude PID string or "")
//   ".claude/sessions/" → PID-file read script (produces JSON + delimiter + HOME, or "")
//   'if [ -f "'         → JSONL existence test (produces the path string if found, or "")
//
// These substrings are unique across all three scripts and cannot collide with each
// other (the walk script never mentions ".claude/sessions/"; the PID-file script
// never mentions "ps -eo"; the test-f script never mentions ".claude/sessions/").
//
// walkOutput:     PID string the walk would emit ("102", "103", "200", or "")
// pidFileOutput:  raw string the PID-file script would emit — caller is responsible
//                 for constructing the "---HOME---" delimited format, or passing ""
//                 to simulate a missing PID file (delimiter absent → no_pid_session_file).
// jsonlTestOutput: string the test-f script would emit — either the constructed path
//                  (file exists) or "" (file not found → no_open_session_file).
function mockExecCommand(
  walkOutput: string | (() => Promise<string>),
  pidFileOutput: string,
  jsonlTestOutput = "",
) {
  vi.mocked(execCommand).mockImplementation(
    (_conn: import("ssh2").Client, script: string): Promise<string> => {
      if (script.includes("ps -eo")) {
        // Walk script — return the resolved claude PID (or "" if none found)
        if (typeof walkOutput === "function") {
          return walkOutput();
        }
        return Promise.resolve(walkOutput);
      }
      if (script.includes(".claude/sessions/")) {
        // PID-file read script — return JSON blob + ---HOME--- + HOME value, or ""
        return Promise.resolve(pidFileOutput);
      }
      if (script.includes('if [ -f "')) {
        // JSONL existence test — return the path if found, "" if not
        return Promise.resolve(jsonlTestOutput);
      }
      return Promise.resolve("");
    },
  );
}

// Build the delimited PID-file output string for happy-path mocks.
// Format: <JSON>\n---HOME---\n<home>
function makePidFileOutput(
  sessionId: string,
  cwd: string,
  home: string,
  extra?: Record<string, unknown>,
): string {
  const json = JSON.stringify({ sessionId, cwd, ...extra });
  return `${json}\n---HOME---\n${home}`;
}

describe("discoverClaudeSession — PID-file-based lookup", () => {
  afterEach(() => {
    vi.mocked(execCommand).mockReset();
    vi.mocked(queryPanePid).mockReset();
    vi.useRealTimers();
  });

  // ── Preserved walk-step tests (Steps 1-4) ──────────────────────────────────

  // Test 1: Kiro-style wrapper (the primary bug fix)
  // pane_pid=100 (kiro-cli-term), pid=101 ppid=100 (bash), pid=102 ppid=101 (claude)
  // Walk emits "102" (the awk output); PID-file lookup runs with PID=102.
  it("CASE 1: kiro-cli-term wrapper — walks descendants and finds claude grandchild (pid 102)", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(100);
    const pidFileStr = makePidFileOutput(
      "abc123",
      "/home/ubuntu/project",
      "/home/ubuntu",
    );
    mockExecCommand(
      "102",
      pidFileStr,
      "/home/ubuntu/.claude/projects/-home-ubuntu-project/abc123.jsonl",
    );

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({
      status: "active",
      pid: 102,
      sessionFile: "/home/ubuntu/.claude/projects/-home-ubuntu-project/abc123.jsonl",
    });
  });

  // Test 2: Deeper wrapper — 4-level chain: pane_pid=100 → shell=101 → wrapper=102 → claude=103
  // Walk emits "103" (the awk output for the deepest claude descendant).
  it("CASE 2: deeper wrapper (4-level chain) — walk returns deepest descendant claude pid (103)", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(100);
    const pidFileStr = makePidFileOutput(
      "deep-session",
      "/home/ubuntu/project",
      "/home/ubuntu",
    );
    mockExecCommand(
      "103",
      pidFileStr,
      "/home/ubuntu/.claude/projects/-home-ubuntu-project/deep-session.jsonl",
    );

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({
      status: "active",
      pid: 103,
      sessionFile: "/home/ubuntu/.claude/projects/-home-ubuntu-project/deep-session.jsonl",
    });
  });

  // Test 3: pane_pid IS claude directly (backcompat)
  // Walk must include pane_pid itself as a valid candidate — no `pid[i] != root` guard.
  // Walk emits "200" (pane_pid itself, which has comm=claude).
  it("CASE 3: pane_pid is claude directly (backcompat) — walk returns pane_pid itself (200)", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(200);
    const pidFileStr = makePidFileOutput(
      "direct-session",
      "/home/ubuntu/direct",
      "/home/ubuntu",
    );
    mockExecCommand(
      "200",
      pidFileStr,
      "/home/ubuntu/.claude/projects/-home-ubuntu-direct/direct-session.jsonl",
    );

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({
      status: "active",
      pid: 200,
      sessionFile: "/home/ubuntu/.claude/projects/-home-ubuntu-direct/direct-session.jsonl",
    });
  });

  // Test 4: No claude anywhere in the descendant tree → not_claude
  // Walk emits "" (empty output from awk — no pid with comm=claude found).
  it("CASE 4: no claude in pane_pid descendant tree — returns inactive/not_claude", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(300);
    mockExecCommand("", "", "");

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({ status: "inactive", reason: "not_claude" });
  });

  // Test 5: No tmux session — queryPanePid returns null → no_tmux_session, walk must NOT run
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

  // Test 6: Walk exec timeout → exec_error
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

  // ── New Step 5 tests (PID-file-based flow) ─────────────────────────────────

  // Test 7 (Test G): Happy path with explicit slug-transform assertion.
  // cwd="/home/ubuntu/proj", HOME="/home/ubuntu", sessionId="abc-def"
  // → slug = "-home-ubuntu-proj" (every / and . replaced by -)
  // → JSONL path = /home/ubuntu/.claude/projects/-home-ubuntu-proj/abc-def.jsonl
  it("CASE 7: happy path — PID-file valid, sessionId resolved, JSONL found (slug-transform asserted)", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(500);
    const cwd = "/home/ubuntu/proj";
    const home = "/home/ubuntu";
    const sessionId = "abc-def";
    // slug: replace every / and . with - → "-home-ubuntu-proj"
    const expectedSessionFile = `${home}/.claude/projects/-home-ubuntu-proj/${sessionId}.jsonl`;
    const pidFileStr = makePidFileOutput(sessionId, cwd, home);
    mockExecCommand("500", pidFileStr, expectedSessionFile);

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({
      status: "active",
      pid: 500,
      sessionFile: expectedSessionFile,
    });
  });

  // Test 8 (Test H): PID-file missing — script exits early, no delimiter in output
  // → no_pid_session_file
  it("CASE 8: PID-file missing (no delimiter in output) — returns inactive/no_pid_session_file", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(501);
    // PID-file script returns empty string (file not found, exit 10 path)
    mockExecCommand("501", "", "");

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({ status: "inactive", reason: "no_pid_session_file" });
  });

  // Test 9 (Test I): PID-file returns malformed JSON (not parseable)
  // → no_pid_session_file
  it("CASE 9: PID-file contains malformed JSON — returns inactive/no_pid_session_file", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(502);
    // Delimiter present but JSON part is not valid JSON
    const malformedOutput = "this is not json\n---HOME---\n/home/ubuntu";
    mockExecCommand("502", malformedOutput, "");

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({ status: "inactive", reason: "no_pid_session_file" });
  });

  // Test 10 (Test J): PID-file returns valid JSON but missing sessionId field
  // → no_pid_session_file
  it("CASE 10: PID-file missing sessionId field — returns inactive/no_pid_session_file", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(503);
    // Valid JSON but no sessionId key
    const noSessionIdOutput = `{"cwd":"/home/ubuntu/proj","someOtherField":"value"}\n---HOME---\n/home/ubuntu`;
    mockExecCommand("503", noSessionIdOutput, "");

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({ status: "inactive", reason: "no_pid_session_file" });
  });

  // Test 11 (Test K): PID-file valid, sessionId resolved, but JSONL not on disk
  // → no_open_session_file
  it("CASE 11: sessionId resolved but JSONL not on disk — returns inactive/no_open_session_file", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(504);
    const pidFileStr = makePidFileOutput(
      "orphan-session",
      "/home/ubuntu/proj",
      "/home/ubuntu",
    );
    // test-f returns "" → JSONL not found
    mockExecCommand("504", pidFileStr, "");

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({ status: "inactive", reason: "no_open_session_file" });
  });

  // Test 12 (Test L, rewrite of old Case 7): PID-file exec rejects (SSH channel error)
  // → exec_error
  it("CASE 12: PID-file exec rejects (SSH channel error) — returns inactive/exec_error", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(100);
    vi.mocked(execCommand).mockImplementation(
      (_conn: import("ssh2").Client, script: string): Promise<string> => {
        if (script.includes("ps -eo")) {
          // Walk emits "102" — walk succeeds
          return Promise.resolve("102");
        }
        if (script.includes(".claude/sessions/")) {
          // PID-file read rejects with SSH error
          return Promise.reject(new Error("SSH exec channel error"));
        }
        return Promise.resolve("");
      },
    );

    const result = await discoverClaudeSession(fakeConn, "test-session");

    expect(result).toEqual({ status: "inactive", reason: "exec_error" });
  });
});
