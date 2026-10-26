/**
 * The compose box's text area carries only Skynet's own commands. A send
 * marked as coming out of the text area that starts with a blocked command
 * (src/types/blocked-commands.ts) is refused before anything is typed into
 * the agent; unmarked sends (buttons) are never checked.
 */

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

import { __applyInputMessageForTests } from "./claude-session-server.js";
import { sshLogger } from "../utils/logger.js";

const fakeConn = {} as import("ssh2").Client;

function run(data: string, textArea: boolean | undefined, mqid = "pv-optim-1-abcdefgh") {
  const exec = vi.fn().mockResolvedValue("");
  const wsSend = vi.fn();
  const done = __applyInputMessageForTests({
    sshConn: fakeConn,
    currentTmuxSession: "legit-session",
    currentHostId: 1,
    execCommand: exec,
    data,
    messageQueueItemId: mqid,
    textArea,
    wsSend,
  });
  return { exec, wsSend, done };
}

describe("text-area command refusal", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it.each(["/clear\r", "/compact keep the plan\r", "  /Resume\r", "/id other-agent\r", "/desktop\r"])(
    "refuses a marked %j: nothing typed, command_refused sent",
    async (data) => {
      const { exec, wsSend, done } = run(data, true);
      await done;
      expect(exec).not.toHaveBeenCalled();
      expect(wsSend).toHaveBeenCalledTimes(1);
      expect(wsSend).toHaveBeenCalledWith({ type: "command_refused", mqid: "pv-optim-1-abcdefgh" });
      expect(vi.mocked(sshLogger.info)).toHaveBeenCalledWith(
        expect.stringContaining("command_refused"),
        expect.objectContaining({ operation: "pv_input_command_refused" }),
      );
    },
  );

  it("refuses before waking a dormant agent", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const setWakeTriggerTs = vi.fn();
    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "/clear\r",
      messageQueueItemId: "pv-optim-1-abcdefgh",
      textArea: true,
      wsSend: vi.fn(),
      dormantLastEmitted: () => true,
      setWakeTriggerTs,
      markerCommand: vi.fn(),
      now: () => 0,
    });
    expect(setWakeTriggerTs).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("never checks an unmarked send (a button's)", async () => {
    const { exec, wsSend, done } = run("/compact", false);
    await done;
    expect(exec).toHaveBeenCalledTimes(1);
    expect(String(exec.mock.calls[0][1])).toContain("/compact");
    expect(wsSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: "command_refused" }));
  });

  it("never checks a send with no mark at all", async () => {
    const { exec, done } = run("/id save", undefined);
    await done;
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it.each(["hello there", "/build add a button", "see you tomorrow\n/clear", "/clearly", "/home/ubuntu/notes.md"])(
    "types a marked ordinary message %j as usual",
    async (data) => {
      const { exec, wsSend, done } = run(data, true);
      await done;
      expect(exec).toHaveBeenCalledTimes(1);
      expect(wsSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: "command_refused" }));
    },
  );
});
