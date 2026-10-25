import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { discoverClaudeSession, discoverClaudeSessionBatched } from "./session-file-discovery.js";

// Mock the tmux-helper module so we can control what execCommand and
// queryPanePid return without a real SSH connection. Both are mocked so
// discoverClaudeSession can be driven without real tmux or SSH infrastructure.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
  queryPanePid: vi.fn(),
}));

import { execCommand, queryPanePid } from "../ssh/tmux-helper.js";

// Stub ssh2 Client — execCommand is mocked at module level so conn is never accessed.
const fakeConn = {} as import("ssh2").Client;

// Discovery answers two questions separately:
//   RUNNING — the terminal: pane_pid → descendant walk (`ps -eo`) for `claude`
//   HISTORY — the agent's own history folder (agent-history-file.ts)
// The mock dispatches on script content: the walk mentions `ps -eo`, the
// history lookup mentions `fleet/identities`, the batched script mentions
// `tmux display-message`.

const HISTORY = "/home/ubuntu/.claude/projects/-home-ubuntu-fleet-identities-aqua-workspace/s1.jsonl";

function idLine(name: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: `<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>${name}</command-args>`,
    },
  });
}

/** Records the agent-history script emits for one file. */
function historyRecord(name: string, mtime: number, path: string, firstUserLine: string): string {
  return `${name}\t${mtime}\t${path}\n${firstUserLine}\n---AGENT-HISTORY---\n`;
}

function mockUnbatched(walkOutput: string | (() => Promise<string>), historyStdout = "") {
  vi.mocked(execCommand).mockImplementation(
    (_conn: import("ssh2").Client, script: string): Promise<string> => {
      if (script.includes("ps -eo")) {
        return typeof walkOutput === "function" ? walkOutput() : Promise.resolve(walkOutput);
      }
      if (script.includes("fleet/identities")) return Promise.resolve(historyStdout);
      return Promise.resolve("");
    },
  );
}

describe("discoverClaudeSession — terminal for running, agent folder for history", () => {
  afterEach(() => {
    vi.mocked(execCommand).mockReset();
    vi.mocked(queryPanePid).mockReset();
    vi.useRealTimers();
  });

  it("kiro-cli-term wrapper — walks descendants to the claude grandchild; history from the agent folder", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(100);
    mockUnbatched("102", historyRecord("aqua", 10, HISTORY, idLine("aqua")));
    expect(await discoverClaudeSession(fakeConn, "aqua")).toEqual({
      status: "active",
      pid: 102,
      sessionFile: HISTORY,
    });
  });

  it("pane_pid is claude directly (backcompat)", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(200);
    mockUnbatched("200", historyRecord("aqua", 10, HISTORY, idLine("aqua")));
    const r = await discoverClaudeSession(fakeConn, "aqua");
    expect(r).toMatchObject({ status: "active", pid: 200 });
  });

  it("never reads Claude's per-process session file", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(100);
    mockUnbatched("102", historyRecord("aqua", 10, HISTORY, idLine("aqua")));
    await discoverClaudeSession(fakeConn, "aqua");
    for (const [, script] of vi.mocked(execCommand).mock.calls) {
      expect(script).not.toContain(".claude/sessions/");
    }
  });

  it("newest /id file wins; a newer bare session in the folder is skipped", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(100);
    const older = HISTORY.replace("s1", "old");
    const bare = HISTORY.replace("s1", "bare");
    mockUnbatched(
      "102",
      historyRecord("aqua", 30, bare, JSON.stringify({ type: "user", message: { role: "user", content: "hi" } })) +
        historyRecord("aqua", 20, HISTORY, idLine("aqua")) +
        historyRecord("aqua", 10, older, idLine("aqua")),
    );
    expect(await discoverClaudeSession(fakeConn, "aqua")).toMatchObject({ sessionFile: HISTORY });
  });

  it("no claude in the pane — inactive/not_claude, history not looked up", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(300);
    mockUnbatched("");
    expect(await discoverClaudeSession(fakeConn, "aqua")).toEqual({ status: "inactive", reason: "not_claude" });
    expect(vi.mocked(execCommand)).toHaveBeenCalledTimes(1);
  });

  it("claude running but no history yet (launch window) — inactive/no_open_session_file", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(100);
    mockUnbatched("102", "");
    expect(await discoverClaudeSession(fakeConn, "aqua")).toEqual({
      status: "inactive",
      reason: "no_open_session_file",
    });
  });

  it("knownHistoryFile — answers only 'is it running', no history lookup", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(100);
    mockUnbatched("102");
    expect(await discoverClaudeSession(fakeConn, "aqua", { knownHistoryFile: HISTORY })).toEqual({
      status: "active",
      pid: 102,
      sessionFile: HISTORY,
    });
    for (const [, script] of vi.mocked(execCommand).mock.calls) {
      expect(script).not.toContain("fleet/identities");
    }
  });

  it("knownHistoryFile does not mask a stopped claude", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(100);
    mockUnbatched("");
    expect(await discoverClaudeSession(fakeConn, "aqua", { knownHistoryFile: HISTORY })).toEqual({
      status: "inactive",
      reason: "not_claude",
    });
  });

  it("history lookup exec rejects — inactive/exec_error", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(100);
    vi.mocked(execCommand).mockImplementation((_c, script: string) =>
      script.includes("ps -eo") ? Promise.resolve("102") : Promise.reject(new Error("channel closed")),
    );
    expect(await discoverClaudeSession(fakeConn, "aqua")).toEqual({ status: "inactive", reason: "exec_error" });
  });

  it("walk exec times out — inactive/exec_error", async () => {
    vi.useFakeTimers();
    vi.mocked(queryPanePid).mockResolvedValue(400);
    mockUnbatched(() => new Promise(() => {}));
    const p = discoverClaudeSession(fakeConn, "aqua");
    await vi.advanceTimersByTimeAsync(15100);
    expect(await p).toEqual({ status: "inactive", reason: "exec_error" });
  });

  it("queryPanePid throws (SSH failure) — exec_error, NOT no_tmux_session", async () => {
    vi.mocked(queryPanePid).mockRejectedValue(new Error("SSH exec channel error"));
    vi.mocked(execCommand).mockImplementation(() => {
      throw new Error("execCommand must not be called when queryPanePid throws");
    });
    expect(await discoverClaudeSession(fakeConn, "aqua")).toEqual({ status: "inactive", reason: "exec_error" });
    expect(vi.mocked(execCommand)).not.toHaveBeenCalled();
  });

  it("queryPanePid returns null — no_tmux_session", async () => {
    vi.mocked(queryPanePid).mockResolvedValue(null);
    vi.mocked(execCommand).mockImplementation(() => {
      throw new Error("execCommand must not be called when queryPanePid returns null");
    });
    expect(await discoverClaudeSession(fakeConn, "aqua")).toEqual({ status: "inactive", reason: "no_tmux_session" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// discoverClaudeSessionBatched — terminal check + history lookup in ONE exec
// ─────────────────────────────────────────────────────────────────────────────

const MARK = "---AGENT-HISTORY-LOOKUP---";

function mockBatched(output: string | (() => Promise<string>)) {
  vi.mocked(execCommand).mockImplementation(
    (_conn: import("ssh2").Client, script: string): Promise<string> => {
      if (!script.includes("tmux display-message")) {
        return Promise.reject(new Error(`unexpected second exec: ${script.slice(0, 60)}`));
      }
      return typeof output === "function" ? output() : Promise.resolve(output);
    },
  );
}

describe("discoverClaudeSessionBatched — single-exec discovery", () => {
  afterEach(() => {
    vi.mocked(execCommand).mockReset();
    vi.useRealTimers();
  });

  it("happy path — one exec answers running AND history", async () => {
    mockBatched(`OK\n12345\n${MARK}\n` + historyRecord("aqua", 10, HISTORY, idLine("aqua")));
    expect(await discoverClaudeSessionBatched(fakeConn, "aqua")).toEqual({
      status: "active",
      pid: 12345,
      sessionFile: HISTORY,
    });
    expect(vi.mocked(execCommand)).toHaveBeenCalledTimes(1);
    const script = vi.mocked(execCommand).mock.calls[0][1] as string;
    expect(script).toContain("ps --sid");
    expect(script).toContain("fleet/identities");
    expect(script).not.toContain(".claude/sessions/");
  });

  it("no pane → no_tmux_session", async () => {
    mockBatched("NO_TMUX_SESSION\n");
    expect(await discoverClaudeSessionBatched(fakeConn, "aqua")).toEqual({ status: "inactive", reason: "no_tmux_session" });
  });

  it("no claude → not_claude", async () => {
    mockBatched("NOT_CLAUDE\n");
    expect(await discoverClaudeSessionBatched(fakeConn, "aqua")).toEqual({ status: "inactive", reason: "not_claude" });
  });

  it("claude running, no /id history yet → no_open_session_file", async () => {
    mockBatched(`OK\n12345\n${MARK}\n`);
    expect(await discoverClaudeSessionBatched(fakeConn, "aqua")).toEqual({
      status: "inactive",
      reason: "no_open_session_file",
    });
  });

  it("another agent's /id in this folder doesn't count", async () => {
    mockBatched(`OK\n12345\n${MARK}\n` + historyRecord("aqua", 10, HISTORY, idLine("wilma")));
    expect(await discoverClaudeSessionBatched(fakeConn, "aqua")).toMatchObject({ reason: "no_open_session_file" });
  });

  it("knownHistoryFile — skips the lookup, returns it", async () => {
    mockBatched(`OK\n12345\n${MARK}\n`);
    expect(await discoverClaudeSessionBatched(fakeConn, "aqua", { knownHistoryFile: HISTORY })).toEqual({
      status: "active",
      pid: 12345,
      sessionFile: HISTORY,
    });
    expect(vi.mocked(execCommand).mock.calls[0][1]).not.toContain("fleet/identities");
  });

  it("garbled output → exec_error", async () => {
    mockBatched("OK\nnot-a-pid");
    expect(await discoverClaudeSessionBatched(fakeConn, "aqua")).toEqual({ status: "inactive", reason: "exec_error" });
  });

  it("exec throws → exec_error", async () => {
    vi.mocked(execCommand).mockRejectedValue(new Error("ssh gone"));
    expect(await discoverClaudeSessionBatched(fakeConn, "aqua")).toEqual({ status: "inactive", reason: "exec_error" });
  });

  it("times out on every attempt → exec_error", async () => {
    vi.useFakeTimers();
    mockBatched(() => new Promise(() => {}));
    const p = discoverClaudeSessionBatched(fakeConn, "aqua");
    await vi.advanceTimersByTimeAsync(16000);
    expect(await p).toEqual({ status: "inactive", reason: "exec_error" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// connectToPane cache-hit vs batched-fresh
// ─────────────────────────────────────────────────────────────────────────────

import {
  writeSessionFileCache,
  readSessionFileCache,
  __clearAllSessionFileCacheForTests,
} from "../fleet-status/session-file-cache.js";

describe("Phase 55: connectToPane cache-hit vs batched-fresh integration", () => {
  beforeEach(() => {
    vi.mocked(execCommand).mockReset();
    vi.useRealTimers();
    __clearAllSessionFileCacheForTests();
  });

  it("cache-hit — cross-type coercion, both string and number hostId resolve same entry", () => {
    writeSessionFileCache("7", "aqua", { sessionFile: "/x/a.jsonl", pid: 42 });
    expect(readSessionFileCache("7", "aqua")).toMatchObject({ pid: 42, sessionFile: "/x/a.jsonl" });
    expect(readSessionFileCache(7, "aqua")).toMatchObject({ pid: 42, sessionFile: "/x/a.jsonl" });
    expect(vi.mocked(execCommand)).not.toHaveBeenCalled();
  });

  it("cache-miss — falls straight through to the batched discovery", async () => {
    writeSessionFileCache("999", "some-other-identity", { sessionFile: "/x/other.jsonl", pid: 999 });
    expect(readSessionFileCache(7, "aqua")).toBeNull();
    mockBatched(`OK\n42\n${MARK}\n` + historyRecord("aqua", 10, HISTORY, idLine("aqua")));
    const result = await discoverClaudeSessionBatched(fakeConn, "aqua");
    expect(vi.mocked(execCommand)).toHaveBeenCalled();
    expect(result).toEqual({ status: "active", pid: 42, sessionFile: HISTORY });
  });
});
