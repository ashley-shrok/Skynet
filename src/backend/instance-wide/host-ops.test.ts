import { describe, it, expect, vi } from "vitest";
import { existingFolders } from "./host-ops.js";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";

describe("host-ops exec timeout", () => {
  it("passes its 60s race budget INTO the channel exec so a wedged command frees its slot", async () => {
    const exec = vi.fn(async () => ".claude/skills/a\n@END");
    const ch: SshChannel = { exec };
    const out = await existingFolders(ch, [".claude/skills/a", ".claude/skills/b"]);
    expect([...out]).toEqual([".claude/skills/a"]);
    expect(exec).toHaveBeenCalledTimes(1);
    expect((exec.mock.calls[0] as unknown[])[1]).toBeUndefined();
    expect((exec.mock.calls[0] as unknown[])[2]).toEqual({ timeoutMs: 60_000 });
  });
});
