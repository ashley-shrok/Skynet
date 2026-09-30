// ─── per-role-archive-file — contract tests (Phase 143 Plan 143-01, D-08) ─────
//
// Tests the archive-tree per-role file-touch primitive introduced in
// Phase 143 Plan 143-01. Sibling to per-role-file.test.ts — separate
// module targeting ~/fleet/roles-archive/ with a narrower whitelist
// (exactly one entry: ".unarchive-requested") per D-08.
//
// Three vitest cases per plan behavior block:
//   Test 1 (LOCAL happy path): with ROLES_ARCHIVE_HOST_DIR env pointed at a
//     tmpdir + a pre-created <tmp>/box-maintainer/ folder, call
//     writeRoleArchiveFile("box-maintainer", ".unarchive-requested", "", { hostId, conn: null }).
//     Assert the file exists at <tmp>/box-maintainer/.unarchive-requested with empty contents.
//   Test 2 (relPath whitelist rejects): assert
//     writeRoleArchiveFile("box-maintainer", ".archive-requested", ...) throws /invalid relPath/.
//   Test 3 (ROLE_NAME_PATTERN rejects): assert
//     writeRoleArchiveFile("../etc/passwd", ".unarchive-requested", ...) throws /invalid role name/.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "node:fs/promises";

// LOCAL_HOST_IDS is parsed at module-load in identity-artifact-reader (imported
// transitively by per-role-archive-file.ts). Set the env var BEFORE any import
// evaluates via vi.hoisted, which vitest guarantees runs before hoisted imports.
vi.hoisted(() => {
  process.env.IDENTITIES_LOCAL_HOST_IDS = "999";
});

// Mock tmux-helper.execCommand (reachable via writeMarkdownFileAtomic in the
// REMOTE branch — same reason as per-role-file.test.ts).
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn().mockResolvedValue("/home/tester\n"),
}));

// Import AFTER the vi.mocks so the mocks bind to the module graph.
import {
  writeRoleArchiveFile,
  ALLOWED_ROLE_ARCHIVE_REL_PATHS,
} from "./per-role-archive-file.js";

const LOCAL_HOST_ID = 999;

// ──────────────────────────────────────────────────────────────────────
// Per-test scratch dir for LOCAL tests
// ──────────────────────────────────────────────────────────────────────

let scratchRoot: string;
const priorArchiveHostDir = process.env.ROLES_ARCHIVE_HOST_DIR;

beforeEach(async () => {
  vi.clearAllMocks();
  scratchRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "per-role-archive-file-test-"),
  );
  process.env.ROLES_ARCHIVE_HOST_DIR = scratchRoot;
});

afterEach(async () => {
  // Restore prior env
  if (priorArchiveHostDir === undefined) {
    delete process.env.ROLES_ARCHIVE_HOST_DIR;
  } else {
    process.env.ROLES_ARCHIVE_HOST_DIR = priorArchiveHostDir;
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

describe("writeRoleArchiveFile — LOCAL happy path (D-08 sentinel drop)", () => {
  it("Test 1: writes empty .unarchive-requested at <ROLES_ARCHIVE_HOST_DIR>/box-maintainer/ via tmp+rename; file exists with empty contents after", async () => {
    // Precondition: archive folder must exist (writeRoleArchiveFile does NOT
    // parent-mkdir — the reconciler already moved the folder to the archive tree).
    const roleArchiveDir = path.join(scratchRoot, "box-maintainer");
    await fs.mkdir(roleArchiveDir, { recursive: true });

    await writeRoleArchiveFile("box-maintainer", ".unarchive-requested", "", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });

    const finalPath = path.join(roleArchiveDir, ".unarchive-requested");
    const stat = await fs.stat(finalPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(0);

    // Contents empty — D-08 presence-is-meaning sentinel
    const contents = await fs.readFile(finalPath, "utf-8");
    expect(contents).toBe("");

    // Tmp file gone (tmp+rename atomically renamed away)
    const tmpPath = finalPath + ".tmp";
    await expect(fs.stat(tmpPath)).rejects.toThrow(/ENOENT/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 2 — relPath whitelist rejects
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleArchiveFile — relPath whitelist gate (D-08 narrower whitelist)", () => {
  it("Test 2: rejects '.archive-requested' (live-tree path) with /invalid relPath/ before any I/O", async () => {
    // Whitelist is locked to exactly { ".unarchive-requested" } per D-08.
    await expect(
      writeRoleArchiveFile("box-maintainer", ".archive-requested", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid relPath/);

    // Also reject any other non-whitelisted path
    await expect(
      writeRoleArchiveFile("box-maintainer", ".pinned", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid relPath/);

    // Verify the allowed set itself
    expect(ALLOWED_ROLE_ARCHIVE_REL_PATHS.size).toBe(1);
    expect(ALLOWED_ROLE_ARCHIVE_REL_PATHS.has(".unarchive-requested")).toBe(true);
    expect(ALLOWED_ROLE_ARCHIVE_REL_PATHS.has(".archive-requested")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 3 — ROLE_NAME_PATTERN rejects (T-143-01-03)
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleArchiveFile — role name gate (T-143-01-03, ROLE_NAME_PATTERN /^[a-z0-9-]+$/)", () => {
  it("Test 3: rejects '../etc/passwd' with /invalid role name/ before any I/O", async () => {
    // ROLE_NAME_PATTERN excludes `.`, `/`, uppercase, underscore, and every
    // path-traversal shape.
    await expect(
      writeRoleArchiveFile("../etc/passwd", ".unarchive-requested", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid role name/);

    // Uppercase rejected
    await expect(
      writeRoleArchiveFile("BadName!", ".unarchive-requested", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid role name/);

    // Underscore rejected (ROLE_NAME_PATTERN excludes underscore — only [a-z0-9-])
    await expect(
      writeRoleArchiveFile("bad_name", ".unarchive-requested", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid role name/);
  });
});
