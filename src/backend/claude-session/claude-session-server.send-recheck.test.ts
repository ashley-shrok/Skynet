/**
 * claude-session-server.send-recheck.test.ts
 *
 * Send-time pane recheck: a compose send must never be typed into the bare
 * shell of a session whose claude is gone or going. The connection's dormant
 * view (dormantLastEmitted) lags the host by a poll — the supervisor writes
 * `.dormant` before it sends /exit — so the input handler re-checks the host
 * right before typing and takes the wake path when there is no live claude.
 *
 *   SR-1: probe says .dormant present (view still "awake") → wake gate runs
 *         before the message is typed
 *   SR-2: probe says claude not running, no sentinel → wake gate runs
 *   SR-3: probe says live claude → typed directly, no wake gate
 *   SR-4: probe fails (null) → typed directly, as before
 *   SR-5: not an identity → typed directly, no wake gate
 *   SR-6: bare Enter frame → no probe at all
 *   SR-7: probePaneForSend parses the host's answer and fails closed to null
 */

import { describe, it, expect, vi } from "vitest";

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

import {
  __applyInputMessageForTests,
  probePaneForSend,
  type PaneSendProbe,
} from "./claude-session-server.js";

const fakeConn = {} as import("ssh2").Client;
const SENTINEL_RM = "rm -f ~/fleet/identities/'test-agent'/.dormant";
const BODY = "tmux send-keys -l -t 'test-agent' -- 'hello'";

async function send(probe: PaneSendProbe | null | "unwired", data = "hello\r") {
  const execCalls: string[] = [];
  const execCommand = vi.fn((_c: unknown, cmd: string) => {
    execCalls.push(cmd);
    return Promise.resolve("");
  });
  const paneProbe = vi.fn(async () => (probe === "unwired" ? null : probe));
  const setWakeTriggerTs = vi.fn();
  const t0 = 1_000_000;
  await __applyInputMessageForTests({
    sshConn: fakeConn,
    currentTmuxSession: "test-agent",
    currentHostId: 42,
    execCommand,
    data,
    messageQueueItemId: "mqid-1",
    dormantLastEmitted: () => false,
    setWakeTriggerTs,
    // Marker already fresh on the first poll, so the gate returns at once.
    markerCommand: vi.fn(async () => new Date(t0 + 10_000).toISOString()),
    now: () => t0,
    ...(probe === "unwired" ? {} : { paneProbe }),
  });
  return { execCalls, paneProbe, setWakeTriggerTs };
}

describe("send-time pane recheck", () => {
  it("SR-1: .dormant present while the view says awake → wakes before typing", async () => {
    const { execCalls, setWakeTriggerTs } = await send({ isIdentity: true, dormantSentinel: true, claudeRunning: true });
    const rm = execCalls.indexOf(SENTINEL_RM);
    const body = execCalls.indexOf(BODY);
    expect(rm).toBeGreaterThanOrEqual(0);
    expect(body).toBeGreaterThan(rm);
    expect(setWakeTriggerTs).toHaveBeenCalledTimes(1);
  });

  it("SR-2: claude not running, no sentinel → wakes before typing", async () => {
    const { execCalls } = await send({ isIdentity: true, dormantSentinel: false, claudeRunning: false });
    expect(execCalls.indexOf(SENTINEL_RM)).toBeGreaterThanOrEqual(0);
    expect(execCalls.indexOf(BODY)).toBeGreaterThan(execCalls.indexOf(SENTINEL_RM));
  });

  it("SR-3: live claude → typed directly, no wake", async () => {
    const { execCalls, paneProbe, setWakeTriggerTs } = await send({ isIdentity: true, dormantSentinel: false, claudeRunning: true });
    expect(paneProbe).toHaveBeenCalledTimes(1);
    expect(execCalls).not.toContain(SENTINEL_RM);
    expect(execCalls).toContain(BODY);
    expect(setWakeTriggerTs).not.toHaveBeenCalled();
  });

  it("SR-4: probe fails → typed directly, as before", async () => {
    const { execCalls } = await send(null);
    expect(execCalls).not.toContain(SENTINEL_RM);
    expect(execCalls).toContain(BODY);
  });

  it("SR-5: not an identity → typed directly, no wake", async () => {
    const { execCalls } = await send({ isIdentity: false, dormantSentinel: false, claudeRunning: false });
    expect(execCalls).not.toContain(SENTINEL_RM);
    expect(execCalls).toContain(BODY);
  });

  it("SR-6: bare Enter frame → no probe", async () => {
    const { paneProbe, execCalls } = await send({ isIdentity: true, dormantSentinel: true, claudeRunning: false }, "\r");
    expect(paneProbe).not.toHaveBeenCalled();
    expect(execCalls).not.toContain(SENTINEL_RM);
  });
});

describe("probePaneForSend", () => {
  const run = (out: string | Error) =>
    probePaneForSend(fakeConn, "test-agent", async () => {
      if (out instanceof Error) throw out;
      return out;
    });

  it("SR-7a: parses the host's answer", async () => {
    expect(await run("probe 1 1 0\n")).toEqual({ isIdentity: true, dormantSentinel: true, claudeRunning: false });
    expect(await run("probe 1 0 1")).toEqual({ isIdentity: true, dormantSentinel: false, claudeRunning: true });
    expect(await run("motd noise\nprobe 0 0 0")).toEqual({ isIdentity: false, dormantSentinel: false, claudeRunning: false });
  });

  it("SR-7b: unparseable output or a failed exec → null", async () => {
    expect(await run("")).toBeNull();
    expect(await run("probe 1 1")).toBeNull();
    expect(await run(new Error("ssh down"))).toBeNull();
  });

  it("SR-7c: the command quotes the name and checks sentinel + pane tty", async () => {
    let cmd = "";
    await probePaneForSend(fakeConn, "test-agent", async (_c, c) => {
      cmd = c;
      return "probe 1 0 1";
    });
    expect(cmd).toContain("~/fleet/identities/'test-agent'/.dormant");
    expect(cmd).toContain("~/fleet/identities/'test-agent'/'test-agent.md'");
    expect(cmd).toContain("tmux list-panes -t '=test-agent:'");
    expect(cmd).toContain('ps -t "${t#/dev/}"');
  });
});
