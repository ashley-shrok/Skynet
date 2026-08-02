// ─── identity-artifact-reader — REMOTE-branch atomic-rename API (quick 260802-qrw) ─
//
// Regression test for QRW-02: pins the writeMarkdownFileAtomic helper to
// sftp.ext_openssh_rename (posix-rename@openssh.com) instead of sftp.rename.
//
// WHY THIS EXISTS (root-caused by @stacy on ceo-skynet 2026-08-02, full handoff
// at ~/pretty-view-uploads/2026-08-02/190204-TINA-HANDOFF.md):
//
//   Ashley's IdentityModal saves against an EXISTING identity file were
//   surfacing a generic "Error: Failure" (SFTPv3 code 4). Root cause was
//   writeMarkdownFileAtomic calling sftp.rename(tmp, target, cb), which
//   sends SSH_FXP_RENAME. OpenSSH's process_rename tries link(old,new)
//   first; when `new` already exists, link() returns EEXIST. OpenSSH's
//   errno_to_portable() has no case for EEXIST and falls through to
//   SSH2_FX_FAILURE — every overwrite of an existing identity file
//   therefore failed. Only first-time writes (target missing) succeeded.
//
//   The fix swaps the single call site to sftp.ext_openssh_rename, which
//   has POSIX rename(2) semantics (atomic overwrite). This test is the
//   pinning mechanism: it installs a throwing trap on the mock's `rename`
//   method so any future revert to sftp.rename fails LOUDLY at test time
//   with a diagnostic message that names the fix.
//
// The mock ssh2 Client here only needs .sftp() populated because
// tmux-helper.execCommand is vi.mocked to return "/home/tester" for the
// `echo $HOME` call that writeIdentityFile/writeIdentityHistory/writeIdentityHandoff
// each make before opening SFTP. This keeps the test surface tiny (no fake
// exec channel wiring) and mirrors the pattern already used across the
// claude-session suite (e.g. claude-session-server.aside.test.ts).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client as SSHClientType } from "ssh2";
type SFTPWrapper = import("ssh2").SFTPWrapper;

// Mock tmux-helper.execCommand so writeIdentityFile's `echo $HOME` call
// resolves without a real ssh2 exec channel. Must be declared BEFORE the
// dynamic import of identity-artifact-reader so the mock is active when
// the module is evaluated.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn().mockResolvedValue("/home/tester\n"),
}));

// Import AFTER the vi.mock so the mock is bound to the module graph.
import {
  writeIdentityFile,
  writeIdentityHistory,
  writeIdentityHandoff,
} from "./identity-artifact-reader.js";

// ──────────────────────────────────────────────────────────────────────
// Mock builder
// ──────────────────────────────────────────────────────────────────────

interface RenameCall {
  from: string;
  to: string;
}

/**
 * Build a mock ssh2 Client whose .sftp(cb) yields a mock SFTPWrapper
 * with:
 *   - writeFile: no-op ok
 *   - ext_openssh_rename: recording spy that succeeds  ← the API we want
 *   - rename: throwing trap → "must not call sftp.rename — use ext_openssh_rename"
 *     (proves the swap held; loud diagnostic on regressions)
 *   - unlink: no-op ok
 *   - end: recording spy
 *
 * Only .sftp is populated because tmux-helper.execCommand is vi.mocked
 * above, so the `echo $HOME` path never hits .exec() on the ssh2 client.
 */
function buildMockConn(): {
  conn: SSHClientType;
  sftp: {
    writeFile: ReturnType<typeof vi.fn>;
    ext_openssh_rename: ReturnType<typeof vi.fn>;
    rename: ReturnType<typeof vi.fn>;
    unlink: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  renameCalls: RenameCall[];
} {
  const renameCalls: RenameCall[] = [];

  const sftp = {
    writeFile: vi.fn(
      (
        _path: string,
        _buf: Buffer,
        _opts: unknown,
        cb: (err: Error | undefined) => void,
      ) => {
        cb(undefined);
      },
    ),
    ext_openssh_rename: vi.fn(
      (from: string, to: string, cb: (err: Error | undefined) => void) => {
        renameCalls.push({ from, to });
        cb(undefined);
      },
    ),
    // Load-bearing trap: if a future edit reverts writeMarkdownFileAtomic
    // to sftp.rename, this test will fail with the diagnostic message.
    rename: vi.fn(() => {
      throw new Error("must not call sftp.rename — use ext_openssh_rename");
    }),
    unlink: vi.fn((_p: string, cb: (err: Error | undefined) => void) => {
      cb(undefined);
    }),
    end: vi.fn(),
  };

  const conn = {
    sftp: (cb: (err: Error | undefined, s: SFTPWrapper) => void) => {
      cb(undefined, sftp as unknown as SFTPWrapper);
    },
  } as unknown as SSHClientType;

  return { conn, sftp, renameCalls };
}

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("writeIdentityFile — REMOTE branch atomic-rename API (quick 260802-qrw)", () => {
  it("calls ext_openssh_rename (posix-rename@openssh.com), not sftp.rename, to allow atomic overwrite of existing identity files", async () => {
    const { conn, sftp, renameCalls } = buildMockConn();

    await writeIdentityFile(conn, "tina", "hello world");

    // The load-bearing assertions: extension called exactly once, plain
    // rename NEVER called (the trap would have thrown a rejection if so).
    expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1);
    expect(sftp.rename).not.toHaveBeenCalled();

    // Path shape: writes to <home>/.claude/identities/tina/tina.md.tmp
    // then renames it to <home>/.claude/identities/tina/tina.md.
    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0].from).toBe(
      "/home/tester/.claude/identities/tina/tina.md.tmp",
    );
    expect(renameCalls[0].to).toBe(
      "/home/tester/.claude/identities/tina/tina.md",
    );

    // sftp.writeFile was invoked with the .tmp target BEFORE the rename.
    expect(sftp.writeFile).toHaveBeenCalledTimes(1);
    const writeArgs = sftp.writeFile.mock.calls[0];
    expect(writeArgs[0]).toBe("/home/tester/.claude/identities/tina/tina.md.tmp");

    // finally { sftp.end() } always runs.
    expect(sftp.end).toHaveBeenCalledTimes(1);
  });
});

describe("writeIdentityHistory and writeIdentityHandoff — REMOTE branch (quick 260802-qrw)", () => {
  // Defensive coverage: the shared writeMarkdownFileAtomic helper is the
  // rename call site for ALL three markdown writers. Verifying two more of
  // them documents that the single-helper swap covers the whole surface.
  // (writeIdentityBountyFields also delegates to writeMarkdownFileAtomic
  // but has more setup — left out of scope; the shared helper guarantees
  // the fix transitively.)

  it("writeIdentityHistory routes through ext_openssh_rename to /<home>/.claude/identities/tina/history.md", async () => {
    const { conn, sftp, renameCalls } = buildMockConn();

    await writeIdentityHistory(conn, "tina", "# history\n");

    expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1);
    expect(sftp.rename).not.toHaveBeenCalled();

    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0].from).toBe(
      "/home/tester/.claude/identities/tina/history.md.tmp",
    );
    expect(renameCalls[0].to).toBe(
      "/home/tester/.claude/identities/tina/history.md",
    );

    expect(sftp.end).toHaveBeenCalledTimes(1);
  });

  it("writeIdentityHandoff routes through ext_openssh_rename to /<home>/.claude/identities/tina/handoff.md", async () => {
    const { conn, sftp, renameCalls } = buildMockConn();

    await writeIdentityHandoff(conn, "tina", "# handoff\n");

    expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1);
    expect(sftp.rename).not.toHaveBeenCalled();

    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0].from).toBe(
      "/home/tester/.claude/identities/tina/handoff.md.tmp",
    );
    expect(renameCalls[0].to).toBe(
      "/home/tester/.claude/identities/tina/handoff.md",
    );

    expect(sftp.end).toHaveBeenCalledTimes(1);
  });
});
