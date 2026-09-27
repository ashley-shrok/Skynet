// ─── per-app-file — contract tests (app-archive shape) ─────────────────────
//
// Tests the per-app file-touch primitive. Sibling to writeIdentityFile and
// writeRoleFile — separate module to preserve the audit-surface discipline
// (each primitive's key regex + allowed-basename set is scoped to one fleet
// subtree).
//
// Contracts under test (mirrors per-role-file.test.ts's 7-test structure):
//   T1 LOCAL happy path — writeAppFile writes at APPS_HOST_DIR/<slug>/<relPath>
//      via tmp+rename; tmp file gone after rename.
//   T2 REMOTE happy path — delegates to writeMarkdownFileAtomic with the
//      RELATIVE `fleet/apps/<slug>/<relPath>` path shape (SFTP home-resolves).
//   T3 bad slug rejected before I/O (belt-and-suspenders vs HTTP gate).
//   T4 bad relPath rejected before I/O (defends ALLOWED_APP_REL_PATHS
//      bounded whitelist — future entries must be added deliberately).
//   T5 REMOTE with null conn throws "conn required for remote host" verbatim.
//   T6 ALLOWED_APP_REL_PATHS starts minimal — exactly one entry
//      (".archive-requested"). Pins the whitelist so a future shape adding
//      more entries has to update this test deliberately.
//   T7 LOCAL honors APPS_HOST_DIR env override (containerized-Skynet
//      bind-mount case — mirrors per-identity-file's IDENTITIES_HOST_DIR
//      and per-role-file's ROLES_HOST_DIR handling).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client as SSHClientType } from "ssh2";
type SFTPWrapper = import("ssh2").SFTPWrapper;
import os from "os";
import path from "path";
import fs from "node:fs/promises";

// LOCAL_HOST_IDS is parsed at module-load in identity-artifact-reader (imported
// transitively by per-app-file.ts). Set the env var BEFORE any import
// evaluates via vi.hoisted, which vitest guarantees runs before hoisted imports.
vi.hoisted(() => {
  process.env.IDENTITIES_LOCAL_HOST_IDS = "999";
});

// Mock tmux-helper.execCommand — same reason as per-identity/per-role tests.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn().mockResolvedValue("/home/tester\n"),
}));

// Import AFTER the vi.mocks so the mocks bind to the module graph.
import {
  writeAppFile,
  ALLOWED_APP_REL_PATHS,
} from "./per-app-file.js";

// ──────────────────────────────────────────────────────────────────────
// SFTP mock builder — mirrors per-role-file.test.ts.
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
        "per-app-file wire regressed to sftp.rename — must use ext_openssh_rename via writeMarkdownFileAtomic",
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
// Per-test scratch dir for LOCAL tests.
// ──────────────────────────────────────────────────────────────────────

let scratchRoot: string;
const priorAppsHostDir = process.env.APPS_HOST_DIR;

beforeEach(async () => {
  vi.clearAllMocks();
  scratchRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "per-app-file-test-"),
  );
  process.env.APPS_HOST_DIR = scratchRoot;
});

afterEach(async () => {
  if (priorAppsHostDir === undefined) {
    delete process.env.APPS_HOST_DIR;
  } else {
    process.env.APPS_HOST_DIR = priorAppsHostDir;
  }
  try {
    await fs.rm(scratchRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ──────────────────────────────────────────────────────────────────────
// Test 1 — LOCAL happy path
// ──────────────────────────────────────────────────────────────────────

describe("writeAppFile — LOCAL branch", () => {
  it("Test 1: writes empty .archive-requested at <APPS_HOST_DIR>/<slug>/ via tmp+rename; tmp gone after", async () => {
    const appDir = path.join(scratchRoot, "my-app");
    await fs.mkdir(appDir, { recursive: true });

    await writeAppFile("my-app", ".archive-requested", "", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });

    const finalPath = path.join(appDir, ".archive-requested");
    const stat = await fs.stat(finalPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(0);

    const contents = await fs.readFile(finalPath, "utf-8");
    expect(contents).toBe("");

    const tmpPath = finalPath + ".tmp";
    await expect(fs.stat(tmpPath)).rejects.toThrow(/ENOENT/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 2 — REMOTE happy path
// ──────────────────────────────────────────────────────────────────────

describe("writeAppFile — REMOTE branch", () => {
  it("Test 2: delegates to writeMarkdownFileAtomic with RELATIVE fleet/apps/<slug>/<relPath> path", async () => {
    const { conn, sftp, renameCalls } = buildMockConn();

    await writeAppFile("my-app", ".archive-requested", "", {
      hostId: REMOTE_HOST_ID,
      conn,
    });

    expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1);
    expect(sftp.rename).not.toHaveBeenCalled();

    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0].to).toBe(
      "fleet/apps/my-app/.archive-requested",
    );

    expect(sftp.writeFile).toHaveBeenCalledTimes(1);
    const writeArgs = sftp.writeFile.mock.calls[0];
    expect(writeArgs[0]).toBe(
      "fleet/apps/my-app/.archive-requested.tmp",
    );
    const writtenBuf = writeArgs[1] as Buffer;
    expect(Buffer.isBuffer(writtenBuf)).toBe(true);
    expect(writtenBuf.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 3 — bad slug rejected before I/O
// ──────────────────────────────────────────────────────────────────────

describe("writeAppFile — slug gate (APP_SLUG_RE /^[a-z0-9-]{1,64}$/)", () => {
  it("Test 3: rejects 'BadSlug!' before any I/O; error mentions APP_SLUG_RE source", async () => {
    const { conn, sftp } = buildMockConn();

    await expect(
      writeAppFile("BadSlug!", ".archive-requested", "", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/invalid app slug/);

    await expect(
      writeAppFile("BadSlug!", ".archive-requested", "", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/\[a-z0-9-\]/);

    expect(sftp.writeFile).not.toHaveBeenCalled();
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();
  });

  it("Test 3b: rejects LOCAL bad slug ('../etc/passwd') before any fs touch", async () => {
    const writeSpy = vi.spyOn(fs, "writeFile");

    await expect(
      writeAppFile("../etc/passwd", ".archive-requested", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid app slug/);

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 4 — bad relPath rejected before I/O
// ──────────────────────────────────────────────────────────────────────

describe("writeAppFile — relPath gate (ALLOWED_APP_REL_PATHS bounded whitelist)", () => {
  it("Test 4: rejects 'malicious-file' before any I/O; error mentions allowed list", async () => {
    const writeSpy = vi.spyOn(fs, "writeFile");
    const { conn, sftp } = buildMockConn();

    await expect(
      writeAppFile("my-app", "malicious-file", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid relPath/);

    await expect(
      writeAppFile("my-app", "malicious-file", "", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/\.archive-requested/);

    expect(writeSpy).not.toHaveBeenCalled();
    expect(sftp.writeFile).not.toHaveBeenCalled();
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();

    writeSpy.mockRestore();
  });

  it("Test 4b: rejects path traversal in relPath ('../etc/passwd') before any I/O", async () => {
    const writeSpy = vi.spyOn(fs, "writeFile");

    await expect(
      writeAppFile("my-app", "../etc/passwd", "", {
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

describe("writeAppFile — REMOTE null conn contract", () => {
  it("Test 5: throws 'conn required for remote host' when REMOTE hostId + null conn", async () => {
    await expect(
      writeAppFile("my-app", ".archive-requested", "", {
        hostId: REMOTE_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow("conn required for remote host");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 6 — ALLOWED_APP_REL_PATHS starts minimal (exactly one entry)
// ──────────────────────────────────────────────────────────────────────

describe("ALLOWED_APP_REL_PATHS — bounded-scope discipline", () => {
  it("Test 6: whitelist contains exactly ONE entry ('.archive-requested')", () => {
    expect(ALLOWED_APP_REL_PATHS).toBeInstanceOf(Set);
    expect(ALLOWED_APP_REL_PATHS.size).toBe(1);
    expect([...ALLOWED_APP_REL_PATHS]).toEqual([".archive-requested"]);
    expect(ALLOWED_APP_REL_PATHS.has(".archive-requested")).toBe(true);
    // Anti-drift check — identity/role-scoped entries MUST NOT be in the
    // app whitelist.
    expect(ALLOWED_APP_REL_PATHS.has(".pinned")).toBe(false);
    expect(ALLOWED_APP_REL_PATHS.has("relay.json")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 7 — LOCAL honors APPS_HOST_DIR env override
// ──────────────────────────────────────────────────────────────────────

describe("writeAppFile — LOCAL env-honoring path resolution", () => {
  it("Test 7: with APPS_HOST_DIR set, writes at <APPS_HOST_DIR>/<slug>/<relPath> (bind-mount case)", async () => {
    const appDir = path.join(scratchRoot, "my-app");
    await fs.mkdir(appDir, { recursive: true });

    await writeAppFile("my-app", ".archive-requested", "", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });

    const finalPath = path.join(scratchRoot, "my-app", ".archive-requested");
    const stat = await fs.stat(finalPath);
    expect(stat.isFile()).toBe(true);

    const homedirFallback = path.join(
      os.homedir(),
      "fleet",
      "apps",
      "my-app",
      ".archive-requested",
    );
    if (homedirFallback !== finalPath) {
      await expect(fs.stat(homedirFallback)).rejects.toThrow(/ENOENT/);
    }
  });
});
