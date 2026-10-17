import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  systemLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  sshRequestIo,
  AGENT_SERVICES_ATTACHMENT_EXEC_TIMEOUT_MS,
  AGENT_SERVICES_EXEC_TIMEOUT_MS,
  type SshChannel,
} from "./host-io.js";

describe("sshRequestIo exec timeouts", () => {
  it("claim uses the channel default; attachment reads pass the longer attachment budget", async () => {
    const exec = vi.fn(async (_cmd: string) => Buffer.from("hello").toString("base64"));
    const ch: SshChannel = { exec };
    const io = sshRequestIo("3", ch);
    await io.claim();
    expect((exec.mock.calls[0] as unknown[])[2]).toBeUndefined();
    const bytes = await io.readAttachment("a.mp3", 1024);
    expect(Buffer.isBuffer(bytes) && bytes.toString()).toBe("hello");
    expect((exec.mock.calls[1] as unknown[])[2]).toEqual({
      timeoutMs: AGENT_SERVICES_ATTACHMENT_EXEC_TIMEOUT_MS,
    });
    expect(AGENT_SERVICES_EXEC_TIMEOUT_MS).toBe(30_000);
    expect(AGENT_SERVICES_ATTACHMENT_EXEC_TIMEOUT_MS).toBeGreaterThan(AGENT_SERVICES_EXEC_TIMEOUT_MS);
  });
});
