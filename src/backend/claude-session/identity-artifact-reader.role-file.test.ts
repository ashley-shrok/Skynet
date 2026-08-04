// ─── identity-artifact-reader — role file read/write via two-step (Phase 22 SRIC-06) ─
//
// Phase 22 SRIC-06 / Plan 22-06 Task 1: verifies the new readRoleFile + writeRoleFile
// helpers that let the IdentityModal Role tab render + edit
// ~/.claude/roles/<role>/<role>.md for the current identity.
//
// The public wire shape mirrors readIdentityFile/writeIdentityFile: `{markdown}` for
// reads, `Promise<void>` for writes. The role name is discovered internally via
// resolveRoleForIdentity (introduced Plan 22-01) — the caller (WS handler) never sees
// the role name, and the frontend contract stays (identityKey, hostId).
//
// TDD test map (tests 1-9, per plan Task 1 <behavior>):
//   1. readRoleFile LOCAL reads $ROLES_HOST_DIR/<role>/<role>.md
//   2. readRoleFile REMOTE execs `cat "$HOME/.claude/roles/<role>/<role>.md"`
//   3. readRoleFile throws (via resolveRoleForIdentity) when identity file lacks role
//   4. readRoleFile returns {markdown: ""} when role file missing (LOCAL + REMOTE)
//   5. writeRoleFile validates identityKey via IDENTITY_KEY_RE
//   6. writeRoleFile REMOTE calls writeMarkdownFileAtomic with role-scoped path
//   7. writeRoleFile LOCAL writes via fs tmp+rename
//   8. writeRoleFile propagates resolveRoleForIdentity throw
//   9. writeRoleFile caps contents at IDMEDIT_MAX_MARKDOWN_BYTES (matches writeIdentityFile)
//
// Same test scaffolding pattern as identity-artifact-reader.remote-writes.test.ts +
// identity-artifact-reader.two-step.test.ts:
//   - vi.mock('../ssh/tmux-helper.js') so execCommand can be routed per-test.
//   - buildMockConn() gives a fake ssh2 Client with sftp populated; the sftp
//     mock installs a throwing trap on `rename` (regression guard against a
//     revert to raw sftp.rename per quick 260802-qrw / patch #268).
//   - LOCAL-branch tests mkdtemp both IDENTITIES_HOST_DIR + ROLES_HOST_DIR so the
//     real fs path substitution flows through.

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
  readRoleFile,
  writeRoleFile,
  IDMEDIT_MAX_MARKDOWN_BYTES,
} from "./identity-artifact-reader.js";

// ──────────────────────────────────────────────────────────────────────
// Mock SFTP builder — mirrors identity-artifact-reader.remote-writes.test.ts
// so writeRoleFile's REMOTE branch flows through the shared writeMarkdownFileAtomic
// helper without a real ssh2 connection.
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
    // identity-artifact-reader.remote-writes.test.ts exactly (patch #268 lock).
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
// Router builder — inspects the command string and returns the right stub.
// Used by REMOTE-branch tests where readRoleFile does two execs
// (identity file `cat`, then role file `cat`).
// ──────────────────────────────────────────────────────────────────────

function makeRouter(opts: {
  identityFile?: string;
  roleFile?: string;
  home?: string;
}): (conn: unknown, cmd: string) => Promise<string> {
  return async (_conn, cmd) => {
    if (cmd.includes("echo $HOME")) return (opts.home ?? "/home/tester") + "\n";
    if (cmd.includes(".claude/identities/") && cmd.startsWith("cat "))
      return opts.identityFile ?? "";
    if (cmd.includes(".claude/roles/") && cmd.includes(".md") && cmd.startsWith("cat "))
      return opts.roleFile ?? "";
    return "";
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// Tests 1-4 — readRoleFile
// ──────────────────────────────────────────────────────────────────────

describe("readRoleFile — LOCAL branch (conn=null)", () => {
  let identitiesRoot: string;
  let rolesRoot: string;
  const KEY = "tina";
  const ROLE = "box-maintainer";

  beforeEach(async () => {
    identitiesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "22-06-identities-"));
    rolesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "22-06-roles-"));
    process.env.IDENTITIES_HOST_DIR = identitiesRoot;
    process.env.ROLES_HOST_DIR = rolesRoot;

    // Identity file with role: frontmatter (drives the two-step)
    const identityDir = path.join(identitiesRoot, KEY);
    await fs.mkdir(identityDir, { recursive: true });
    await fs.writeFile(
      path.join(identityDir, `${KEY}.md`),
      `---\nrole: ${ROLE}\n---\n\n# ${KEY}\n`,
      "utf-8",
    );
  });

  afterEach(async () => {
    delete process.env.IDENTITIES_HOST_DIR;
    delete process.env.ROLES_HOST_DIR;
    await fs.rm(identitiesRoot, { recursive: true, force: true });
    await fs.rm(rolesRoot, { recursive: true, force: true });
  });

  it("test 1: reads ROLES_HOST_DIR/<role>/<role>.md and returns {markdown}", async () => {
    // Seed the role file
    const roleDir = path.join(rolesRoot, ROLE);
    await fs.mkdir(roleDir, { recursive: true });
    await fs.writeFile(
      path.join(roleDir, `${ROLE}.md`),
      "# Box Maintainer\n\n## Role\n\nKeeps the boxes running.\n",
      "utf-8",
    );

    const result = await readRoleFile(null, KEY);
    expect(result.markdown).toContain("Keeps the boxes running.");
    expect(result.markdown).toContain("# Box Maintainer");
  });

  it("test 4a: returns {markdown: ''} when role file is missing on disk (LOCAL ENOENT) but identity file has valid role frontmatter", async () => {
    // Note: rolesRoot exists but no <role>/<role>.md file within it
    const result = await readRoleFile(null, KEY);
    expect(result.markdown).toBe("");
  });
});

describe("readRoleFile — REMOTE branch (conn is SSHClientType)", () => {
  it("test 2: execs `cat \"$HOME/.claude/roles/<role>/<role>.md\"` and returns {markdown: <stdout>}", async () => {
    const identityMd = "---\nrole: box-maintainer\n---\n\n# tina\n";
    const roleMd = "# Box Maintainer\n\n## Role\n\nKeeps the boxes running.\n";
    const capturedCommands: string[] = [];
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        capturedCommands.push(cmd);
        if (cmd.includes(".claude/identities/") && cmd.startsWith("cat ")) return identityMd;
        if (cmd.includes(".claude/roles/box-maintainer/box-maintainer.md")) return roleMd;
        return "";
      },
    );

    const conn = {} as SSHClientType;
    const result = await readRoleFile(conn, "tina");

    // Path substitution: role folder queried; identity-side artifact path NOT queried for role file
    const roleCmd = capturedCommands.find((c) =>
      c.includes(".claude/roles/box-maintainer/box-maintainer.md"),
    );
    expect(roleCmd).toBeDefined();
    expect(roleCmd).toContain("$HOME/.claude/roles/box-maintainer/box-maintainer.md");

    // Two-step: identity file read happened first
    const identityCmd = capturedCommands.find((c) =>
      c.includes(".claude/identities/tina/tina.md"),
    );
    expect(identityCmd).toBeDefined();

    // Response payload propagated
    expect(result.markdown).toBe(roleMd);
  });

  it("test 3: throws (via resolveRoleForIdentity) when identity file has no role frontmatter", async () => {
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd.includes(".claude/identities/")) return "# no frontmatter here\n";
        return "";
      },
    );
    const conn = {} as SSHClientType;
    await expect(readRoleFile(conn, "moxie")).rejects.toThrow(/no role|moxie/);
  });

  it("test 4b: returns {markdown: ''} when role file itself is missing (REMOTE empty stdout via `|| true`) but identity file had valid role", async () => {
    const identityMd = "---\nrole: box-maintainer\n---\n";
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd.includes(".claude/identities/") && cmd.startsWith("cat ")) return identityMd;
        // role file cat returns empty (the `|| true` swallows the ENOENT)
        return "";
      },
    );
    const conn = {} as SSHClientType;
    const result = await readRoleFile(conn, "tina");
    expect(result.markdown).toBe("");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Tests 5-9 — writeRoleFile
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleFile — validation + byte cap", () => {
  it("test 5: rejects invalid identityKey (fails IDENTITY_KEY_RE) BEFORE opening SFTP or doing the two-step", async () => {
    const { conn, sftp } = buildMockConn();
    await expect(
      writeRoleFile(conn, "not/a/valid key", "contents"),
    ).rejects.toThrow(/identityKey/);
    // No SFTP nor exec attempted
    expect(sftp.writeFile).not.toHaveBeenCalled();
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();
  });

  it("test 9: rejects contents that exceed IDMEDIT_MAX_MARKDOWN_BYTES (same cap as writeIdentityFile)", async () => {
    const { conn, sftp } = buildMockConn();
    // Build contents that exceed the cap (+1 byte).
    const oversized = "a".repeat(IDMEDIT_MAX_MARKDOWN_BYTES + 1);
    await expect(writeRoleFile(conn, "tina", oversized)).rejects.toThrow(
      /IDMEDIT_MAX_MARKDOWN_BYTES|exceeds/,
    );
    // No SFTP nor exec attempted
    expect(sftp.writeFile).not.toHaveBeenCalled();
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();
  });
});

describe("writeRoleFile — REMOTE branch", () => {
  it("test 6: writes to $HOME/.claude/roles/<role>/<role>.md via writeMarkdownFileAtomic (SFTP tmp+rename)", async () => {
    const { conn, sftp, renameCalls } = buildMockConn();

    // Route execCommand: first `echo $HOME` (from writeRoleFile OR
    // resolveRoleForIdentity), then identity-file `cat` (from readIdentityFile
    // inside resolveRoleForIdentity), then final `echo $HOME` (from writeRoleFile
    // for the write target path). The router treats them all uniformly.
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      makeRouter({
        home: "/home/tester",
        identityFile: "---\nrole: box-maintainer\n---\n\n# tina\n",
      }),
    );

    await writeRoleFile(conn, "tina", "# new body\n");

    // Load-bearing: ext_openssh_rename hit exactly once, sftp.rename NEVER called.
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

  it("test 8: propagates resolveRoleForIdentity throw when identity file has no role frontmatter", async () => {
    const { conn, sftp } = buildMockConn();
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd.includes("echo $HOME")) return "/home/tester\n";
        if (cmd.includes(".claude/identities/")) return "# no frontmatter\n";
        return "";
      },
    );
    await expect(writeRoleFile(conn, "moxie", "# body")).rejects.toThrow(
      /no role|moxie/,
    );
    // No SFTP fired (throw happens before writeMarkdownFileAtomic)
    expect(sftp.writeFile).not.toHaveBeenCalled();
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();
  });
});

describe("writeRoleFile — LOCAL branch (conn=null)", () => {
  let identitiesRoot: string;
  let rolesRoot: string;
  const KEY = "tina";
  const ROLE = "box-maintainer";

  beforeEach(async () => {
    identitiesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "22-06-identities-"));
    rolesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "22-06-roles-"));
    process.env.IDENTITIES_HOST_DIR = identitiesRoot;
    process.env.ROLES_HOST_DIR = rolesRoot;

    // Identity file with role frontmatter drives the two-step
    const identityDir = path.join(identitiesRoot, KEY);
    await fs.mkdir(identityDir, { recursive: true });
    await fs.writeFile(
      path.join(identityDir, `${KEY}.md`),
      `---\nrole: ${ROLE}\n---\n\n# ${KEY}\n`,
      "utf-8",
    );

    // Role folder exists (plan 22-04 semantics — role folder is created by
    // create-role flow before any write). writeRoleFile also defensively
    // mkdirs but the folder is expected to already be present.
    await fs.mkdir(path.join(rolesRoot, ROLE), { recursive: true });
  });

  afterEach(async () => {
    delete process.env.IDENTITIES_HOST_DIR;
    delete process.env.ROLES_HOST_DIR;
    await fs.rm(identitiesRoot, { recursive: true, force: true });
    await fs.rm(rolesRoot, { recursive: true, force: true });
  });

  it("test 7: writes ROLES_HOST_DIR/<role>/<role>.md via fs tmp+rename atomic pattern", async () => {
    const body = "# Box Maintainer\n\n## Role\n\nUpdated by Ashley.\n";
    await writeRoleFile(null, KEY, body);

    const roleFilePath = path.join(rolesRoot, ROLE, `${ROLE}.md`);
    const written = await fs.readFile(roleFilePath, "utf-8");
    expect(written).toBe(body);

    // Round-trip via readRoleFile confirms the read/write pair agrees on path
    const roundTrip = await readRoleFile(null, KEY);
    expect(roundTrip.markdown).toBe(body);
  });
});
