// ─── per-role-file — contract tests (Phase 133 Plan 133-01) ─────────────────
//
// Tests the per-role file-touch primitive introduced in Phase 133. Sibling to
// per-identity-file.ts's writeIdentityFile — separate module to preserve the
// H1 write⇔read parity lock on writeIdentityFile (RESEARCH §5): widening
// writeIdentityFile to cover role paths would blur the invariant that every
// key it accepts is also readable by every identity-scoped reader. Roles get
// their own primitive with their own bounded whitelist.
//
// Contracts under test (7 tests per plan behavior block):
//   T1 LOCAL happy path — writeRoleFile writes at ROLES_HOST_DIR/<name>/<relPath>
//      via tmp+rename; tmp file gone after rename.
//   T2 REMOTE happy path — delegates to writeMarkdownFileAtomic with the
//      RELATIVE `fleet/roles/<name>/<relPath>` path shape (SFTP home-resolves).
//   T3 bad role name rejected before I/O (belt-and-suspenders vs HTTP gate).
//   T4 bad relPath rejected before I/O (defends the ALLOWED_ROLE_REL_PATHS
//      bounded whitelist — future-phase entries must be added deliberately).
//   T5 REMOTE with null conn throws "conn required for remote host" verbatim.
//   T6 ALLOWED_ROLE_REL_PATHS starts minimal — exactly one entry
//      (".archive-requested"). Pins the whitelist so a future phase adding
//      more entries has to update this test deliberately.
//   T7 LOCAL honors ROLES_HOST_DIR env override (containerized-Skynet
//      bind-mount case — mirrors per-identity-file's IDENTITIES_HOST_DIR
//      handling).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client as SSHClientType } from "ssh2";
type SFTPWrapper = import("ssh2").SFTPWrapper;
import os from "os";
import path from "path";
import fs from "node:fs/promises";

// LOCAL_HOST_IDS is parsed at module-load in identity-artifact-reader (imported
// transitively by per-role-file.ts). Set the env var BEFORE any import
// evaluates via vi.hoisted, which vitest guarantees runs before hoisted imports.
vi.hoisted(() => {
  process.env.IDENTITIES_LOCAL_HOST_IDS = "999";
});

// Mock tmux-helper.execCommand — same reason as per-identity-file.test.ts.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn().mockResolvedValue("/home/tester\n"),
}));

// Import AFTER the vi.mocks so the mocks bind to the module graph.
import {
  writeRoleFile,
  ALLOWED_ROLE_REL_PATHS,
} from "./per-role-file.js";

// ──────────────────────────────────────────────────────────────────────
// SFTP mock builder — mirrors per-identity-file.test.ts (writeMarkdownFileAtomic
// exercises sftp.writeFile + sftp.ext_openssh_rename under the hood).
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
    rename: vi.fn(() => {
      throw new Error(
        "per-role-file wire regressed to sftp.rename — must use ext_openssh_rename via writeMarkdownFileAtomic",
      );
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

const LOCAL_HOST_ID = 999;
const REMOTE_HOST_ID = 42;

// ──────────────────────────────────────────────────────────────────────
// Per-test scratch dir for LOCAL tests — mirrors the mkdtemp fixture idiom
// from identity-artifact-reader.*.test.ts.
// ──────────────────────────────────────────────────────────────────────

let scratchRoot: string;
const priorRolesHostDir = process.env.ROLES_HOST_DIR;

beforeEach(async () => {
  vi.clearAllMocks();
  scratchRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "per-role-file-test-"),
  );
  // Default env — points to a real scratch dir so LOCAL tests can assert
  // real disk state via fs.stat. Individual tests override / delete as needed.
  process.env.ROLES_HOST_DIR = scratchRoot;
});

afterEach(async () => {
  // Restore prior env
  if (priorRolesHostDir === undefined) {
    delete process.env.ROLES_HOST_DIR;
  } else {
    process.env.ROLES_HOST_DIR = priorRolesHostDir;
  }
  // Cleanup scratch dir
  try {
    await fs.rm(scratchRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ──────────────────────────────────────────────────────────────────────
// Test 1 — LOCAL happy path
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleFile — LOCAL branch", () => {
  it("Test 1: writes empty .archive-requested at <ROLES_HOST_DIR>/<name>/ via tmp+rename; tmp gone after", async () => {
    // Precondition: role folder must exist (writeRoleFile does NOT parent-mkdir —
    // roles-create.ts owns folder creation; archive-requested is only
    // meaningful on an existing role).
    const roleDir = path.join(scratchRoot, "box-maintainer");
    await fs.mkdir(roleDir, { recursive: true });

    await writeRoleFile("box-maintainer", ".archive-requested", "", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });

    const finalPath = path.join(roleDir, ".archive-requested");
    const stat = await fs.stat(finalPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(0);

    // Contents empty (D-01 "presence is meaning")
    const contents = await fs.readFile(finalPath, "utf-8");
    expect(contents).toBe("");

    // Tmp gone (tmp+rename atomically renamed away)
    const tmpPath = finalPath + ".tmp";
    await expect(fs.stat(tmpPath)).rejects.toThrow(/ENOENT/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 2 — REMOTE happy path
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleFile — REMOTE branch", () => {
  it("Test 2: delegates to writeMarkdownFileAtomic with RELATIVE fleet/roles/<name>/<relPath> path", async () => {
    const { conn, sftp, renameCalls } = buildMockConn();

    await writeRoleFile("box-maintainer", ".archive-requested", "", {
      hostId: REMOTE_HOST_ID,
      conn,
    });

    // ext_openssh_rename discipline (via writeMarkdownFileAtomic); NEVER
    // falls back to sftp.rename (the throwing trap would fail loudly).
    expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1);
    expect(sftp.rename).not.toHaveBeenCalled();

    // Byte-shape invariant: SFTP path is RELATIVE (no leading `/`, no
    // `$HOME/` prefix). Same discipline as per-identity-file.ts:143.
    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0].to).toBe(
      "fleet/roles/box-maintainer/.archive-requested",
    );

    // sftp.writeFile invoked with .tmp target BEFORE the rename
    expect(sftp.writeFile).toHaveBeenCalledTimes(1);
    const writeArgs = sftp.writeFile.mock.calls[0];
    expect(writeArgs[0]).toBe(
      "fleet/roles/box-maintainer/.archive-requested.tmp",
    );
    // Empty contents threaded through unchanged (D-01: presence is meaning)
    const writtenBuf = writeArgs[1] as Buffer;
    expect(Buffer.isBuffer(writtenBuf)).toBe(true);
    expect(writtenBuf.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 3 — bad role name rejected before I/O
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleFile — role name gate (ROLE_NAME_PATTERN /^[a-z0-9-]+$/)", () => {
  it("Test 3: rejects 'BadName!' before any I/O; error mentions ROLE_NAME_PATTERN source", async () => {
    const { conn, sftp } = buildMockConn();

    await expect(
      writeRoleFile("BadName!", ".archive-requested", "", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/invalid role name/);

    // Second assertion — error message MUST include ROLE_NAME_PATTERN source
    // (mirrors per-identity-file.ts:154 shape).
    await expect(
      writeRoleFile("BadName!", ".archive-requested", "", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/\[a-z0-9-\]/);

    // No SFTP work happened
    expect(sftp.writeFile).not.toHaveBeenCalled();
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();
  });

  it("Test 3b: rejects LOCAL bad name before any fs touch", async () => {
    // Setup: LOCAL scratch role dir that WOULD succeed if the gate didn't fire.
    // We spy on fs.writeFile to confirm zero calls.
    const writeSpy = vi.spyOn(fs, "writeFile");

    await expect(
      writeRoleFile("../etc/passwd", ".archive-requested", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid role name/);

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 4 — bad relPath rejected before I/O
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleFile — relPath gate (ALLOWED_ROLE_REL_PATHS bounded whitelist)", () => {
  it("Test 4: rejects 'malicious-file' before any I/O; error mentions allowed list", async () => {
    const writeSpy = vi.spyOn(fs, "writeFile");
    const { conn, sftp } = buildMockConn();

    await expect(
      writeRoleFile("box-maintainer", "malicious-file", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid relPath/);

    // Error message must mention `.archive-requested` (the sole allowed entry)
    await expect(
      writeRoleFile("box-maintainer", "malicious-file", "", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/\.archive-requested/);

    // No fs work
    expect(writeSpy).not.toHaveBeenCalled();
    // No SFTP work
    expect(sftp.writeFile).not.toHaveBeenCalled();
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();

    writeSpy.mockRestore();
  });

  it("Test 4b: rejects path traversal in relPath ('../etc/passwd') before any I/O", async () => {
    const writeSpy = vi.spyOn(fs, "writeFile");

    await expect(
      writeRoleFile("box-maintainer", "../etc/passwd", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid relPath/);

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 5 — REMOTE with null conn throws verbatim message
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleFile — REMOTE null conn contract", () => {
  it("Test 5: throws 'conn required for remote host' when REMOTE hostId + null conn", async () => {
    await expect(
      writeRoleFile("box-maintainer", ".archive-requested", "", {
        hostId: REMOTE_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow("conn required for remote host");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 6 — ALLOWED_ROLE_REL_PATHS starts minimal (exactly one entry)
// ──────────────────────────────────────────────────────────────────────

describe("ALLOWED_ROLE_REL_PATHS — bounded-scope discipline", () => {
  it("Test 6: whitelist contains exactly ONE entry ('.archive-requested')", () => {
    expect(ALLOWED_ROLE_REL_PATHS).toBeInstanceOf(Set);
    expect(ALLOWED_ROLE_REL_PATHS.size).toBe(1);
    expect([...ALLOWED_ROLE_REL_PATHS]).toEqual([".archive-requested"]);
    expect(ALLOWED_ROLE_REL_PATHS.has(".archive-requested")).toBe(true);
    // Explicit anti-drift check — .pinned, relay.json (identity-scoped entries)
    // MUST NOT be in the role whitelist.
    expect(ALLOWED_ROLE_REL_PATHS.has(".pinned")).toBe(false);
    expect(ALLOWED_ROLE_REL_PATHS.has("relay.json")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 7 — LOCAL honors ROLES_HOST_DIR env override
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleFile — LOCAL env-honoring path resolution", () => {
  it("Test 7: with ROLES_HOST_DIR set, writes at <ROLES_HOST_DIR>/<name>/<relPath> (bind-mount case)", async () => {
    // beforeEach already sets process.env.ROLES_HOST_DIR = scratchRoot.
    // Precondition: role dir exists at that root.
    const roleDir = path.join(scratchRoot, "box-maintainer");
    await fs.mkdir(roleDir, { recursive: true });

    await writeRoleFile("box-maintainer", ".archive-requested", "", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });

    // Assert file landed under ROLES_HOST_DIR — NOT under os.homedir()/fleet/roles
    const finalPath = path.join(scratchRoot, "box-maintainer", ".archive-requested");
    const stat = await fs.stat(finalPath);
    expect(stat.isFile()).toBe(true);

    // Cross-check: the homedir fallback path SHOULD NOT contain our file
    // (unless os.homedir() happens to be scratchRoot's parent, which is
    // vanishingly unlikely under mkdtemp).
    const homedirFallback = path.join(
      os.homedir(),
      "fleet",
      "roles",
      "box-maintainer",
      ".archive-requested",
    );
    if (homedirFallback !== finalPath) {
      // Only assert the fallback doesn't exist if it's a distinct path
      await expect(fs.stat(homedirFallback)).rejects.toThrow(/ENOENT/);
    }
  });
});
