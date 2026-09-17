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
  removeInstalledFile,
} from "./ssh-push.js";

function makeChannel(execImpl: (cmd: string, stdinBody?: Buffer) => Promise<string | null> | string | null): {
  channel: SshChannel;
  exec: ReturnType<typeof vi.fn>;
} {
  const exec = vi.fn(async (cmd: string, stdinBody?: Buffer) => execImpl(cmd, stdinBody));
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
  it("Test 5: happy path — __WRITE_OK__ sentinel returns {ok:true}; exec command is small + base64 body flows via stdin", async () => {
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
    const stdinBody = exec.mock.calls[0][1] as Buffer | undefined;
    // The command must include base64 -d for decoding + chmod 644.
    expect(cmd).toContain("base64 -d");
    expect(cmd).toContain("chmod 644");
    // Sentinel echoes for success/failure
    expect(cmd).toContain("__WRITE_OK__");
    expect(cmd).toContain("__WRITE_FAIL__");
    // The base64 body is NOT in the command — it is passed via stdin.
    const b64 = bytes.toString("base64");
    expect(cmd).not.toContain(b64);
    // Stdin body is present and equals the base64-encoded bytes.
    expect(stdinBody).toBeInstanceOf(Buffer);
    expect(stdinBody?.toString("utf-8")).toBe(b64);
    // Anti-regression: neither the OLD heredoc form nor the ORIGINAL echo-pipe
    // form should appear — both embedded the payload in the argv-limited
    // command string.
    expect(cmd).not.toContain("<<'GSD_B64_EOF'");
    expect(cmd).not.toContain(`echo '${b64}'`);
  });

  it("Test 5b: large payload (200 KB) keeps command string small — argv-element-limit safety", async () => {
    // Root cause of the phase-72-follow-on: Linux caps a single argv element
    // at MAX_ARG_STRLEN = PAGE_SIZE * 32 = 131072 bytes on x86_64. sshd
    // invokes /bin/bash -c "<command>" — the command is one argv element.
    // The prior heredoc form embedded the base64 body in that command string
    // and tripped execve E2BIG once agent-supervisor.sh's b64 crossed 128 KB.
    //
    // Fix: exec cmd stays short (~200 bytes regardless of payload); base64
    // body flows through the channel stdin (CHANNEL_DATA, chunked by ssh2).
    // This test asserts the cmd stays small even for a 200 KB payload.
    const { channel, exec } = makeChannel(async () => "__WRITE_OK__");
    // 200 KB — well past the historic 128 KB argv-element boundary.
    const bytes = Buffer.alloc(200 * 1024);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 2654435761) & 0xff; // cheap deterministic pseudo-random
    }

    const result = await writeInstalledBytesWithMode(
      channel,
      "~/.claude/skills/large/blob.bin",
      bytes,
      0o644,
    );

    expect(result).toEqual({ ok: true });
    const cmd = exec.mock.calls[0][0] as string;
    const stdinBody = exec.mock.calls[0][1] as Buffer | undefined;

    // Load-bearing: command string stays FAR below the 128 KB argv-element cap.
    // ~500 bytes is a generous upper bound for even the longest install path.
    expect(cmd.length).toBeLessThan(2000);
    // The base64 body is not embedded in the command.
    const b64 = bytes.toString("base64");
    expect(cmd).not.toContain(b64.slice(0, 64));
    // Stdin body carries the full base64 body — this is where large payloads
    // flow.
    expect(stdinBody).toBeInstanceOf(Buffer);
    expect(stdinBody?.toString("utf-8")).toBe(b64);
    // Anti-regression: the OLD heredoc marker MUST NOT appear.
    expect(cmd).not.toContain("<<'GSD_B64_EOF'");
    expect(cmd).not.toContain("GSD_B64_EOF");
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

// Phase 114 Plan 03 Task 1: installMode branch on writeInstalledBytesWithMode.
// D-13 + D-18 + Pitfall 2: system-root path uses shellSingleQuote (absolute,
// no tilde), emits chown root:root + chmod + parent-dir mkdir + symlink-guard
// post-condition. Defense-in-depth against T-114-06 (symlink attack at
// /etc/claude-code/CLAUDE.md by a rooted managed host).
describe("writeInstalledBytesWithMode — installMode branching (Phase 114 Plan 03)", () => {
  it("Test T-09 (system-root): emitted command uses absolute-path single-quoting, chown root:root, chmod 644, mkdir parent, symlink guard, and NO tilde", async () => {
    const { channel, exec } = makeChannel(async () => "__WRITE_OK__");
    const bytes = Buffer.from("twinkie-content");

    const result = await writeInstalledBytesWithMode(
      channel,
      "/etc/claude-code/CLAUDE.md",
      bytes,
      0o644,
      { installMode: "system-root" },
    );

    expect(result).toEqual({ ok: true });
    expect(exec).toHaveBeenCalledTimes(1);
    const cmd = exec.mock.calls[0][0] as string;

    // Absolute-path single-quoted (no tilde)
    expect(cmd).toContain("'/etc/claude-code/CLAUDE.md'");
    expect(cmd).not.toContain("~/");
    // Parent-dir mkdir with root:root 0755 (per D-18)
    expect(cmd).toContain("mkdir -p '/etc/claude-code'");
    expect(cmd).toContain("chown root:root '/etc/claude-code'");
    expect(cmd).toMatch(/chmod\s+0?755\s+'\/etc\/claude-code'/);
    // File chown+chmod (per D-18) — defense-in-depth per A6
    expect(cmd).toContain("chown root:root '/etc/claude-code/CLAUDE.md'");
    expect(cmd).toContain("chmod 644 '/etc/claude-code/CLAUDE.md'");
    // Symlink-guard post-condition (T-114-06 mitigation)
    expect(cmd).toContain("test -f");
    expect(cmd).toContain("test ! -L");
    expect(cmd).toContain("__WRITE_SYMLINK_FAIL__");
    // Standard write sentinels still present
    expect(cmd).toContain("__WRITE_OK__");
    expect(cmd).toContain("__WRITE_FAIL__");
    // stderr merging (M2 stdout-wrap) is NOT part of the Phase 114 system-root
    // branch — the origin base doesn't wrap the user-home branch either, and
    // Phase 114 matches that shape for consistency.
    // The base64 body is NOT in the command — it is passed via stdin.
    const b64 = bytes.toString("base64");
    expect(cmd).not.toContain(b64);
    const stdinBody = exec.mock.calls[0][1] as Buffer | undefined;
    expect(stdinBody?.toString("utf-8")).toBe(b64);
  });

  it("Test T-user-home-regression: default (no opts) installMode='user-home' is byte-identical to today — no chown, no symlink guard, tilde preserved", async () => {
    const { channel, exec } = makeChannel(async () => "__WRITE_OK__");
    const bytes = Buffer.from("data");

    await writeInstalledBytesWithMode(
      channel,
      "~/.claude/skills/x",
      bytes,
      0o755,
    );

    const cmd = exec.mock.calls[0][0] as string;
    // Tilde-preservation intact (BLOCKER regression guard from phase 72)
    expect(cmd).toContain("~/");
    expect(cmd).not.toContain("'~/");
    // No system-root artifacts on the user-home path
    expect(cmd).not.toContain("chown root:root");
    expect(cmd).not.toContain("test ! -L");
    expect(cmd).not.toContain("__WRITE_SYMLINK_FAIL__");
    // Mode from argument (0o755 → "755")
    expect(cmd).toContain("chmod 755");
  });

  it("Test T-user-home-explicit: passing { installMode: 'user-home' } explicitly matches the default (no chown, no symlink guard)", async () => {
    const { channel, exec } = makeChannel(async () => "__WRITE_OK__");
    const bytes = Buffer.from("data");

    await writeInstalledBytesWithMode(
      channel,
      "~/.claude/skills/x",
      bytes,
      0o644,
      { installMode: "user-home" },
    );

    const cmd = exec.mock.calls[0][0] as string;
    expect(cmd).toContain("~/");
    expect(cmd).not.toContain("chown root:root");
    expect(cmd).not.toContain("__WRITE_SYMLINK_FAIL__");
  });

  it("Test T-symlink-guard: __WRITE_SYMLINK_FAIL__ sentinel → {ok:false, stage:'verify', errorMessage contains 'symlink'}", async () => {
    const { channel } = makeChannel(async () => "__WRITE_SYMLINK_FAIL__");
    const bytes = Buffer.from("data");

    const result = await writeInstalledBytesWithMode(
      channel,
      "/etc/claude-code/CLAUDE.md",
      bytes,
      0o644,
      { installMode: "system-root" },
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.stage).toBe("verify");
      expect(result.errorMessage.toLowerCase()).toContain("symlink");
      // The path should be included so operators can grep the log for the target.
      expect(result.errorMessage).toContain("/etc/claude-code/CLAUDE.md");
    }
  });

  it("Test T-symlink-guard-with-extra-output: stdout ending in __WRITE_SYMLINK_FAIL__ (with pre-content) still dispatches to verify stage", async () => {
    // Realistic scenario: `test ! -L` fails after all chown/chmod steps succeed
    // silently, so the entire trimmed stdout is just __WRITE_SYMLINK_FAIL__.
    // Still — assert endsWith-based dispatch works with prefix content.
    const { channel } = makeChannel(async () =>
      "some prior noise\n__WRITE_SYMLINK_FAIL__",
    );
    const bytes = Buffer.from("data");

    const result = await writeInstalledBytesWithMode(
      channel,
      "/etc/claude-code/CLAUDE.md",
      bytes,
      0o644,
      { installMode: "system-root" },
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.stage).toBe("verify");
    }
  });

  // T-10 (D-22 byte-compare skip regression) note: byte-compare lives in
  // run-sweep.ts; at the push-helper level we can only assert that
  // writeInstalledBytesWithMode is a distinct call the composer would elide
  // when readInstalledBytes returned matching bytes. Coverage of that decision
  // lives in run-sweep.test.ts (Plan 05); here we guard the tilde-preservation
  // regression (Test 8b) which existed pre-Phase-112 and MUST continue to pass.
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

// Phase 114 Plan 03 Task 2: removeInstalledFile helper.
// D-16 + D-27: fired when the runtime resolver returns null (admin cleared
// the twinkie field or removed the referenced file); the sweep composer
// (Plan 05) issues rm -f on every eligible managed host to reach the
// "clean unset state" invariant. Sibling peer helper to
// writeInstalledBytesWithMode — same never-throws contract, same sentinel-
// dispatch shape as readInstalledBytes. Uses shellSingleQuote (absolute
// path, no tilde expansion — Pitfall 2). No sudo (D-13 composer-level gate
// ensures this only fires against root-SSH hosts).
describe("removeInstalledFile (Phase 114 Plan 03 Task 2)", () => {
  it("Test T-27a: __REMOVE_DID__ sentinel → {ok:true, action:'removed'}", async () => {
    const { channel, exec } = makeChannel(async () => "__REMOVE_DID__");

    const result = await removeInstalledFile(
      channel,
      "/etc/claude-code/CLAUDE.md",
    );

    expect(result).toEqual({ ok: true, action: "removed" });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("Test T-27b: __REMOVE_ALREADY__ sentinel → {ok:true, action:'already-absent'}", async () => {
    const { channel } = makeChannel(async () => "__REMOVE_ALREADY__");

    const result = await removeInstalledFile(
      channel,
      "/etc/claude-code/CLAUDE.md",
    );

    expect(result).toEqual({ ok: true, action: "already-absent" });
  });

  it("Test T-27c: transport failure → {ok:false, stage:'remove', errorMessage:<mock message>}", async () => {
    const { channel } = makeChannel(async () => null); // toExecResult(null) → transport failure

    const result = await removeInstalledFile(
      channel,
      "/etc/claude-code/CLAUDE.md",
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.stage).toBe("remove");
      expect(typeof result.errorMessage).toBe("string");
      // channel.exec returns null on transport failure; removeInstalledFile
      // surfaces "channel returned null" as the stage:"remove" error.
      expect(result.errorMessage).toContain("channel returned null");
    }
  });

  it("Test T-27d: absolute-path shell-quoting invariant — command contains single-quoted absolute path, no tilde, and the __REMOVE_* sentinels", async () => {
    const { channel, exec } = makeChannel(async () => "__REMOVE_ALREADY__");

    await removeInstalledFile(channel, "/etc/claude-code/CLAUDE.md");

    const cmd = exec.mock.calls[0][0] as string;
    // Absolute path present, single-quoted
    expect(cmd).toContain("'/etc/claude-code/CLAUDE.md'");
    // No tilde in the emitted command (absolute path — tilde would be
    // semantically wrong for /etc/ paths per Pitfall 2).
    expect(cmd).not.toContain("~/");
    // Sentinel presence (visible in command source, not in stdout)
    expect(cmd).toContain("__REMOVE_DID__");
    expect(cmd).toContain("__REMOVE_ALREADY__");
    expect(cmd).toContain("__REMOVE_FAIL__");
    // rm -f used (idempotent — matches D-27)
    expect(cmd).toContain("rm -f");
    // No sudo (D-27 mechanics — composer-level gate D-13 already ensures root SSH)
    expect(cmd).not.toContain("sudo");
    // stderr merged into stdout (matches sibling helpers' M2 pattern)
    expect(cmd).toContain("2>&1");
  });

  it("Test T-27e: __REMOVE_FAIL__ sentinel → {ok:false, stage:'verify', errorMessage}", async () => {
    // Non-regular-file entry (e.g. symlink or directory) at the target path
    // — the shell's else-branch emits __REMOVE_FAIL__ without attempting rm.
    const { channel } = makeChannel(async () => "__REMOVE_FAIL__");

    const result = await removeInstalledFile(
      channel,
      "/etc/claude-code/CLAUDE.md",
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.stage).toBe("verify");
      expect(typeof result.errorMessage).toBe("string");
      expect(result.errorMessage).toContain("__REMOVE_FAIL__");
    }
  });

  it("Test T-27f: unknown-shape stdout → {ok:false, stage:'verify'} (defensive)", async () => {
    const { channel } = makeChannel(async () => "unexpected garbage");

    const result = await removeInstalledFile(
      channel,
      "/etc/claude-code/CLAUDE.md",
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.stage).toBe("verify");
    }
  });

  it("Test T-27g: never-throws — synchronous exec throw → {ok:false, stage:'remove', errorMessage starts with __THROW__}", async () => {
    // Mirrors Phase 111 M1 pattern used by writeInstalledBytesWithMode.
    const throwingChannel: SshChannel = {
      exec: async () => {
        throw new Error("channel exploded");
      },
    };

    const result = await removeInstalledFile(
      throwingChannel,
      "/etc/claude-code/CLAUDE.md",
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.stage).toBe("remove");
      expect(result.errorMessage.startsWith("__THROW__ ")).toBe(true);
      expect(result.errorMessage).toContain("channel exploded");
    }
  });
});
