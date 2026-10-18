// WaitingBubble Allow / Deny: the permission_probe + permission_answer seams.
// Answers re-capture the pane and only type a digit when the same prompt
// (by fingerprint) is still on screen.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../utils/logger.js", () => {
  const makeLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  });
  const systemLogger = makeLogger();
  return {
    sshLogger: makeLogger(),
    authLogger: makeLogger(),
    databaseLogger: makeLogger(),
    apiLogger: makeLogger(),
    systemLogger,
    fileLogger: makeLogger(),
    statsLogger: makeLogger(),
    tunnelLogger: makeLogger(),
    dashboardLogger: makeLogger(),
    guacLogger: makeLogger(),
    versionLogger: makeLogger(),
    logger: systemLogger,
    setGlobalLogLevel: vi.fn(),
    getGlobalLogLevel: vi.fn(() => "info"),
  };
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyPermissionAnswer,
  applyPermissionProbe,
} from "./claude-session-server.js";
import { parsePermissionPromptScreen } from "./permission-prompt-screen.js";

const fakeConn = {};
const PROMPT = readFileSync(
  join(__dirname, "__fixtures__", "permission-prompt-dangerous-rm-countdown.txt"),
  "utf8",
);
const IDLE = readFileSync(
  join(__dirname, "__fixtures__", "permission-prompt-none-idle.txt"),
  "utf8",
);
const FP = parsePermissionPromptScreen(PROMPT)!.fingerprint;
const base = { sshConn: fakeConn, currentTmuxSession: "legit-session", currentHostId: 1 };

afterEach(() => vi.clearAllMocks());

describe("applyPermissionProbe", () => {
  it("captures the connection's own pane and returns the parsed prompt", async () => {
    const exec = vi.fn().mockResolvedValue(PROMPT);
    const frame = await applyPermissionProbe({ ...base, execCommand: exec });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][1]).toBe("tmux capture-pane -p -t 'legit-session'");
    expect(frame.type).toBe("permission_prompt_state");
    expect(frame.prompt?.autoDenySeconds).toBe(20);
    expect(frame.prompt?.fingerprint).toBe(FP);
  });

  it("returns prompt:null with no pane bound, without exec", async () => {
    const exec = vi.fn();
    const frame = await applyPermissionProbe({ ...base, currentTmuxSession: null, execCommand: exec });
    expect(frame.prompt).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });

  it("returns prompt:null when capture throws", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("boom"));
    const frame = await applyPermissionProbe({ ...base, execCommand: exec });
    expect(frame.prompt).toBeNull();
  });
});

describe("applyPermissionAnswer", () => {
  it("allow → re-captures, then sends the Yes digit", async () => {
    const exec = vi.fn().mockResolvedValueOnce(PROMPT).mockResolvedValueOnce("");
    const frame = await applyPermissionAnswer({ ...base, execCommand: exec, choice: "allow", fingerprint: FP });
    expect(frame).toEqual({ type: "permission_answer_result", choice: "allow", fingerprint: FP, status: "sent" });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1][1]).toBe("tmux send-keys -t 'legit-session' 1");
  });

  it("deny → sends the No digit", async () => {
    const exec = vi.fn().mockResolvedValueOnce(PROMPT).mockResolvedValueOnce("");
    const frame = await applyPermissionAnswer({ ...base, execCommand: exec, choice: "deny", fingerprint: FP });
    expect(frame?.status).toBe("sent");
    expect(exec.mock.calls[1][1]).toBe("tmux send-keys -t 'legit-session' 2");
  });

  it("prompt gone from screen → status gone, no keystroke", async () => {
    const exec = vi.fn().mockResolvedValue(IDLE);
    const frame = await applyPermissionAnswer({ ...base, execCommand: exec, choice: "allow", fingerprint: FP });
    expect(frame?.status).toBe("gone");
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("a different prompt on screen → status gone, no keystroke", async () => {
    const exec = vi.fn().mockResolvedValue(PROMPT);
    const frame = await applyPermissionAnswer({ ...base, execCommand: exec, choice: "allow", fingerprint: "someotherprompt" });
    expect(frame?.status).toBe("gone");
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("invalid choice or fingerprint → null, no exec", async () => {
    const exec = vi.fn();
    expect(await applyPermissionAnswer({ ...base, execCommand: exec, choice: "maybe", fingerprint: FP })).toBeNull();
    expect(await applyPermissionAnswer({ ...base, execCommand: exec, choice: "allow", fingerprint: 42 })).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });

  it("send-keys throws → status error, no rethrow", async () => {
    const exec = vi.fn().mockResolvedValueOnce(PROMPT).mockRejectedValueOnce(new Error("ssh down"));
    const frame = await applyPermissionAnswer({ ...base, execCommand: exec, choice: "allow", fingerprint: FP });
    expect(frame?.status).toBe("error");
  });
});
