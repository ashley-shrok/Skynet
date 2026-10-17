import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Client } from "ssh2";
import { createSemaphoredExecChannel } from "./semaphored-exec-channel.js";
import { makeSemaphore, type HostSemaphore } from "./host-semaphore-registry.js";
import { ExecTimeoutError } from "./tmux-helper.js";
import { systemLogger } from "../utils/logger.js";

const client = {} as Client;

function setup(opts: { defaultTimeoutMs?: number; semaphore?: HostSemaphore } = {}) {
  const execCommand = vi.fn(async (_c: Client, cmd: string) => `out:${cmd}`);
  const execCommandWithStdin = vi.fn(async (_c: Client, cmd: string, body: Buffer) => `in:${cmd}:${body.toString()}`);
  const ch = createSemaphoredExecChannel({
    client,
    hostId: 6,
    subsystem: "test_sub",
    defaultTimeoutMs: opts.defaultTimeoutMs ?? 30_000,
    peer: "1.2.3.4:22",
    semaphore: opts.semaphore ?? makeSemaphore(48),
    execCommand,
    execCommandWithStdin,
  });
  return { ch, execCommand, execCommandWithStdin };
}

describe("createSemaphoredExecChannel", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("passes the subsystem default timeout INTO execCommand when the caller gives none", async () => {
    const { ch, execCommand } = setup({ defaultTimeoutMs: 12_345 });
    expect(await ch.exec("echo hi")).toBe("out:echo hi");
    expect(execCommand).toHaveBeenCalledWith(client, "echo hi", { timeoutMs: 12_345 });
    expect(ch.peer).toBe("1.2.3.4:22");
  });

  it("per-call opts.timeoutMs overrides the default (exec and stdin paths)", async () => {
    const { ch, execCommand, execCommandWithStdin } = setup({ defaultTimeoutMs: 30_000 });
    await ch.exec("probe", undefined, { timeoutMs: 5_000 });
    expect(execCommand).toHaveBeenCalledWith(client, "probe", { timeoutMs: 5_000 });
    expect(await ch.exec("cat >f", Buffer.from("x"), { timeoutMs: 1_200_000 })).toBe("in:cat >f:x");
    expect(execCommandWithStdin).toHaveBeenCalledWith(client, "cat >f", Buffer.from("x"), {
      timeoutMs: 1_200_000,
    });
  });

  it("resolves null on exec failure, and logs subsystem + timeout on ExecTimeoutError", async () => {
    const warn = vi.spyOn(systemLogger, "warn").mockImplementation(() => {});
    const { ch, execCommand } = setup({ defaultTimeoutMs: 8_000 });
    execCommand.mockRejectedValueOnce(new Error("Command exited with code 1"));
    expect(await ch.exec("false")).toBeNull();
    expect(warn).not.toHaveBeenCalled();

    execCommand.mockRejectedValueOnce(new ExecTimeoutError("run", 8_000));
    expect(await ch.exec("sleep 99")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toMatchObject({
      operation: "ssh_channel_exec_timeout",
      subsystem: "test_sub",
      fleetHostId: "6",
      timeoutMs: 8_000,
      phase: "run",
      timeoutSource: "subsystem_default",
    });
  });

  it("runs every exec through the host semaphore (cap respected) and frees the slot after a timeout", async () => {
    const sem = makeSemaphore(2);
    const { ch, execCommand } = setup({ semaphore: sem });
    let active = 0;
    let peak = 0;
    execCommand.mockImplementation(async (_c, cmd) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      if (cmd === "wedge") throw new ExecTimeoutError("open", 1);
      return cmd;
    });
    vi.spyOn(systemLogger, "warn").mockImplementation(() => {});
    const results = await Promise.all(
      ["a", "wedge", "b", "c", "wedge", "d"].map((c) => ch.exec(c)),
    );
    expect(peak).toBe(2);
    expect(results).toEqual(["a", null, "b", "c", null, "d"]);
    // Slots all released — a fresh exec gets through immediately.
    expect(await ch.exec("e")).toBe("e");
  });
});
