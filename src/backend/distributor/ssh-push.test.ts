/**
 * ssh-push.test.ts — Tests for the SSH-channel-backed push helpers
 * (readInstalledBytes, writeInstalledBytesWithMode, restartUserUnit).
 *
 * Uses a mock channel object `{ exec: vi.fn() }` — no real SSH.
 *
 * Sentinel-based transport-vs-ENOENT parsing mirrors readStatWithSentinel
 * at src/backend/fleet-status/ssh-poll-orchestrator.ts:107–178. All helpers
 * MUST wrap in try/catch and never propagate a thrown channel.exec.
 */
import { describe, it, expect, vi } from "vitest";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import {
  readInstalledBytes,
  writeInstalledBytesWithMode,
  restartUserUnit,
} from "./ssh-push.js";

function makeChannel(execImpl: (cmd: string) => Promise<string | null> | string | null): {
  channel: SshChannel;
  exec: ReturnType<typeof vi.fn>;
} {
  const exec = vi.fn(async (cmd: string) => execImpl(cmd));
  const channel: SshChannel = { exec };
  return { channel, exec };
}

describe("readInstalledBytes", () => {
  it("Test 1: happy path — __READ_OK__ sentinel with base64-encoded bytes returns readOk:true + Buffer", async () => {
    const bytes = Buffer.from("hello world");
    const b64 = bytes.toString("base64");
    const { channel, exec } = makeChannel(async () => `${b64}__READ_OK__`);

    const result = await readInstalledBytes(channel, "~/foo");

    expect(exec).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ readOk: true, bytes });
  });

  it("Test 2: ENOENT — __READ_ENOENT__ sentinel returns readOk:true + bytes:null (file absent = first install)", async () => {
    const { channel } = makeChannel(async () => "__READ_ENOENT__");

    const result = await readInstalledBytes(channel, "~/does-not-exist");

    expect(result).toEqual({ readOk: true, bytes: null });
  });

  it("Test 3: transport failure — channel.exec returns null → readOk:false + reason:'transport'", async () => {
    const { channel } = makeChannel(async () => null);

    const result = await readInstalledBytes(channel, "~/foo");

    expect(result).toEqual({ readOk: false, reason: "transport" });
  });

  it("Test 4: unknown shape — no sentinel present → readOk:false + reason:'transport' (fail-open on unknown)", async () => {
    const { channel } = makeChannel(async () => "garbage-no-sentinel");

    const result = await readInstalledBytes(channel, "~/foo");

    expect(result).toEqual({ readOk: false, reason: "transport" });
  });
});

describe("writeInstalledBytesWithMode", () => {
  it("Test 5: happy path — __WRITE_OK__ sentinel returns {ok:true}; exec command includes base64 -d and chmod", async () => {
    const { channel, exec } = makeChannel(async () => "__WRITE_OK__");
    const bytes = Buffer.from("bundled-content");

    const result = await writeInstalledBytesWithMode(
      channel,
      "~/.claude/skills/id/SKILL.md",
      bytes,
      0o644,
    );

    expect(result).toEqual({ ok: true });
    expect(exec).toHaveBeenCalledTimes(1);
    const cmd = exec.mock.calls[0][0] as string;
    // The command must include base64 -d for decoding + chmod 644
    expect(cmd).toContain("base64 -d");
    expect(cmd).toContain("chmod 644");
    // The base64-encoded bytes must be present in the command
    expect(cmd).toContain(bytes.toString("base64"));
    // Sentinel echoes for success/failure
    expect(cmd).toContain("__WRITE_OK__");
    expect(cmd).toContain("__WRITE_FAIL__");
  });

  it("Test 6: failure — channel.exec returns null → {ok:false, stage, errorMessage}", async () => {
    const { channel } = makeChannel(async () => null);
    const bytes = Buffer.from("x");

    const result = await writeInstalledBytesWithMode(
      channel,
      "~/foo",
      bytes,
      0o755,
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.stage === "write" || result.stage === "chmod").toBe(true);
      expect(typeof result.errorMessage).toBe("string");
    }
  });

  it("Test 7: installPath tilde expansion — command references the install path with a shell-expandable tilde prefix", async () => {
    const { channel, exec } = makeChannel(async () => "__WRITE_OK__");
    const bytes = Buffer.from("y");
    const installPath = "~/.claude/skills/id/SKILL.md";

    await writeInstalledBytesWithMode(channel, installPath, bytes, 0o644);

    const cmd = exec.mock.calls[0][0] as string;
    // The tilde-preservation fix (phase-72 BLOCKER) emits `~/` UNQUOTED so
    // the remote shell expands it, followed by the rest of the path
    // shell-single-quoted for safety. So the command contains the sequence
    // `~/'.claude/skills/id/SKILL.md'`. The alternative `$HOME/...` form is
    // still accepted for forward-compat.
    const hasTildeQuoted = cmd.includes("~/'.claude/skills/id/SKILL.md'");
    const hasHome = cmd.includes("$HOME/.claude/skills/id/SKILL.md");
    expect(hasTildeQuoted || hasHome).toBe(true);
  });

  it("Test 8: mkdir -p parent — command mkdir -p's the parent dir before writing", async () => {
    const { channel, exec } = makeChannel(async () => "__WRITE_OK__");
    const bytes = Buffer.from("z");

    await writeInstalledBytesWithMode(
      channel,
      "~/.claude/skills/id/SKILL.md",
      bytes,
      0o644,
    );

    const cmd = exec.mock.calls[0][0] as string;
    expect(cmd).toContain("mkdir -p");
    // Parent dir path with the tilde-preservation fix: `~/'.claude/skills/id'`
    // (unquoted `~/` prefix, single-quoted remainder). `$HOME` form accepted
    // as a forward-compat alternative.
    const hasParentTildeQuoted = cmd.includes("~/'.claude/skills/id'");
    const hasParentHome = cmd.includes("$HOME/.claude/skills/id");
    expect(hasParentTildeQuoted || hasParentHome).toBe(true);
  });

  it("Test 8b: tilde-preservation — no `'~/` literal (single-quoted tilde-slash) appears in the write command for a catalog-shaped path", async () => {
    // BLOCKER regression (phase-72 code review): the previous implementation
    // wrapped `~/.claude/skills/id/SKILL.md` in shellSingleQuote(...) producing
    // `'~/.claude/skills/id/SKILL.md'`. Shell tilde expansion does NOT run
    // inside single quotes, so the remote shell would create a literal `~`
    // directory in cwd (typically $HOME) instead of writing into $HOME. This
    // test asserts the emitted command NEVER contains the single-quote-tilde-
    // slash sequence anywhere (mkdir target, write target, chmod target).
    const { channel, exec } = makeChannel(async () => "__WRITE_OK__");
    const bytes = Buffer.from("catalog-shaped");

    await writeInstalledBytesWithMode(
      channel,
      "~/.claude/skills/id/SKILL.md",
      bytes,
      0o644,
    );

    const cmd = exec.mock.calls[0][0] as string;
    // The load-bearing assertion: the literal `'~/` (single-quote-tilde-slash)
    // MUST NOT appear anywhere in the emitted command. The fix quotes only
    // the segment AFTER the `~/` prefix so the shell performs home expansion.
    expect(cmd).not.toContain("'~/");
    // Positive assertion: the raw `~/` tilde prefix DOES appear (unquoted),
    // proving the shell will expand it to $HOME.
    expect(cmd).toContain("~/");
  });

  it("Test 8c: readInstalledBytes tilde-preservation — no `'~/` literal in the read command for a catalog-shaped path", async () => {
    // Same BLOCKER regression as Test 8b, but for the read path
    // (base64 -w0 '<path>') which also embeds the install path.
    const { channel, exec } = makeChannel(async () => "__READ_ENOENT__");

    await readInstalledBytes(channel, "~/.claude/skills/id/SKILL.md");

    const cmd = exec.mock.calls[0][0] as string;
    expect(cmd).not.toContain("'~/");
    expect(cmd).toContain("~/");
  });
});

describe("restartUserUnit", () => {
  it("Test 9: happy path — __RESTART_OK__ sentinel returns {ok:true}", async () => {
    const { channel, exec } = makeChannel(async () => "__RESTART_OK__");

    const result = await restartUserUnit(channel, "agent-supervisor.service");

    expect(result).toEqual({ ok: true });
    const cmd = exec.mock.calls[0][0] as string;
    expect(cmd).toContain("systemctl --user restart");
    expect(cmd).toContain("agent-supervisor.service");
    expect(cmd).toContain("__RESTART_OK__");
    expect(cmd).toContain("__RESTART_FAIL__");
  });

  it("Test 10: failure — __RESTART_FAIL__ or null → {ok:false, errorMessage}", async () => {
    const { channel: c1 } = makeChannel(async () => "__RESTART_FAIL__");
    const r1 = await restartUserUnit(c1, "agent-supervisor.service");
    expect(r1.ok).toBe(false);
    if (r1.ok === false) {
      expect(typeof r1.errorMessage).toBe("string");
    }

    const { channel: c2 } = makeChannel(async () => null);
    const r2 = await restartUserUnit(c2, "agent-supervisor.service");
    expect(r2.ok).toBe(false);
    if (r2.ok === false) {
      expect(typeof r2.errorMessage).toBe("string");
    }
  });
});

describe("all helpers never throw (fire-and-forget contract)", () => {
  it("Test 11: every helper catches a synchronous throw and returns a shaped failure result", async () => {
    const throwingChannel: SshChannel = {
      exec: async () => {
        throw new Error("boom");
      },
    };

    const readResult = await readInstalledBytes(throwingChannel, "~/foo");
    expect(readResult).toEqual({ readOk: false, reason: "transport" });

    const writeResult = await writeInstalledBytesWithMode(
      throwingChannel,
      "~/foo",
      Buffer.from("x"),
      0o644,
    );
    expect(writeResult.ok).toBe(false);

    const restartResult = await restartUserUnit(
      throwingChannel,
      "agent-supervisor.service",
    );
    expect(restartResult.ok).toBe(false);
  });
});
