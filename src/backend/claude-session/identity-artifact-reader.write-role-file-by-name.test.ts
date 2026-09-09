// ─── identity-artifact-reader — writeRoleFileByName (Phase 90 Plan 90-03 Task 1) ─
//
// Byte-shape mirror of identity-artifact-reader.role-file.test.ts covering
// writeRoleFile, but for the new writeRoleFileByName export that skips the
// identity two-step and takes roleName directly. Resolves D-08.3 (planner-pick
// role-name-keyed companion writer for the RoleModal save path in Plan 90-04).
//
// TDD test map (per plan Task 1 <behavior>):
//   A (LOCAL, valid):  writes to ROLES_HOST_DIR/<roleName>/<roleName>.md via
//                      fs tmp+rename; readRoleFileByName round-trips.
//   B (REMOTE, valid): writes to $HOME/.claude/roles/<roleName>/<roleName>.md
//                      via writeMarkdownFileAtomic (SFTP tmp+rename).
//   C (bad roleName):  throws "invalid roleName" BEFORE any I/O.
//   D (oversized):     throws "markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES"
//                      BEFORE any I/O.
//   E (fresh folder):  LOCAL branch does defensive mkdir -p on the role folder
//                      before write (mirrors writeRoleFile L2632).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";
import type { Client as SSHClientType } from "ssh2";
type SFTPWrapper = import("ssh2").SFTPWrapper;

// Mock tmux-helper.execCommand BEFORE importing the module under test so the
// mock is bound to the module graph when identity-artifact-reader evaluates.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from "../ssh/tmux-helper.js";
import {
  writeRoleFileByName,
  readRoleFileByName,
  IDMEDIT_MAX_MARKDOWN_BYTES,
} from "./identity-artifact-reader.js";

// ──────────────────────────────────────────────────────────────────────
// Mock SFTP builder — mirrors identity-artifact-reader.role-file.test.ts
// so writeRoleFileByName's REMOTE branch flows through the shared
// writeMarkdownFileAtomic helper without a real ssh2 connection.
// ──────────────────────────────────────────────────────────────────────

interface RenameCall {
  from: string;
  to: string;
}

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
    // Load-bearing trap: if a future edit reverts writeMarkdownFileAtomic to
    // sftp.rename, this test will fail with the diagnostic message. Mirrors
    // identity-artifact-reader.role-file.test.ts exactly (patch #268 lock).
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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// Test A — LOCAL branch happy path (fs tmp+rename) + round-trip
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleFileByName — LOCAL branch (conn=null)", () => {
  let rolesRoot: string;
  const ROLE = "box-maintainer";

  beforeEach(async () => {
    rolesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "90-03-roles-"));
    process.env.ROLES_HOST_DIR = rolesRoot;
    // Pre-create the role folder for the baseline LOCAL happy-path test.
    await fs.mkdir(path.join(rolesRoot, ROLE), { recursive: true });
  });

  afterEach(async () => {
    delete process.env.ROLES_HOST_DIR;
    await fs.rm(rolesRoot, { recursive: true, force: true });
  });

  it("test A: writes ROLES_HOST_DIR/<roleName>/<roleName>.md via fs tmp+rename; readRoleFileByName round-trips", async () => {
    const body = "---\ntitle: Skynet\n---\n\nbody\n";
    await writeRoleFileByName(null, ROLE, body);

    const roleFilePath = path.join(rolesRoot, ROLE, `${ROLE}.md`);
    const written = await fs.readFile(roleFilePath, "utf-8");
    expect(written).toBe(body);

    // Round-trip via readRoleFileByName confirms the read/write pair agree on path
    const roundTrip = await readRoleFileByName(null, ROLE);
    expect(roundTrip.markdown).toBe(body);
  });

  it("test E: fresh role folder — LOCAL branch defensively mkdir -p's the role folder before write", async () => {
    // Nuke the pre-created folder so mkdir -p has to build it fresh.
    await fs.rm(path.join(rolesRoot, ROLE), { recursive: true, force: true });

    const body = "# fresh role body\n";
    await writeRoleFileByName(null, ROLE, body);

    // The folder + file both exist post-write.
    const roleFilePath = path.join(rolesRoot, ROLE, `${ROLE}.md`);
    const written = await fs.readFile(roleFilePath, "utf-8");
    expect(written).toBe(body);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test B — REMOTE branch happy path (SFTP tmp+rename)
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleFileByName — REMOTE branch (conn is SSHClientType)", () => {
  it("test B: writes to $HOME/.claude/roles/<roleName>/<roleName>.md via writeMarkdownFileAtomic", async () => {
    const { conn, sftp, renameCalls } = buildMockConn();

    // REMOTE branch does one `echo $HOME` to build the target path.
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd.includes("echo $HOME")) return "/home/tester\n";
        return "";
      },
    );

    await writeRoleFileByName(conn, "box-maintainer", "# new body\n");

    // Load-bearing: ext_openssh_rename hit once, sftp.rename NEVER called.
    expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1);
    expect(sftp.rename).not.toHaveBeenCalled();

    // Path shape: writes to <home>/.claude/roles/box-maintainer/box-maintainer.md
    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0].from).toBe(
      "/home/tester/.claude/roles/box-maintainer/box-maintainer.md.tmp",
    );
    expect(renameCalls[0].to).toBe(
      "/home/tester/.claude/roles/box-maintainer/box-maintainer.md",
    );

    // writeFile hit the .tmp path first (atomic-write pattern)
    expect(sftp.writeFile).toHaveBeenCalledTimes(1);
    const writeArgs = sftp.writeFile.mock.calls[0];
    expect(writeArgs[0]).toBe(
      "/home/tester/.claude/roles/box-maintainer/box-maintainer.md.tmp",
    );

    // finally { sftp.end() } always fires
    expect(sftp.end).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Tests C, D — validation guards fire BEFORE any I/O
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleFileByName — validation guards", () => {
  it("test C: rejects invalid roleName (fails ROLE_NAME_PATTERN) BEFORE opening SFTP or exec", async () => {
    const { conn, sftp } = buildMockConn();
    await expect(
      writeRoleFileByName(conn, "../evil", "x"),
    ).rejects.toThrow(/invalid roleName/);

    // No SFTP nor exec attempted
    expect(sftp.writeFile).not.toHaveBeenCalled();
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("test D: rejects contents that exceed IDMEDIT_MAX_MARKDOWN_BYTES BEFORE any I/O", async () => {
    const { conn, sftp } = buildMockConn();
    const oversized = "a".repeat(IDMEDIT_MAX_MARKDOWN_BYTES + 1);
    await expect(
      writeRoleFileByName(conn, "box-maintainer", oversized),
    ).rejects.toThrow(/IDMEDIT_MAX_MARKDOWN_BYTES|exceeds/);

    // No SFTP nor exec attempted
    expect(sftp.writeFile).not.toHaveBeenCalled();
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });
});
