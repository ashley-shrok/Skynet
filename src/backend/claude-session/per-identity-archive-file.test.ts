// ─── per-identity-archive-file — contract tests (Phase 143 Plan 143-01, D-08) ─
//
// Tests the archive-tree per-identity file-touch primitive introduced in
// Phase 143 Plan 143-01. Sibling to per-identity-file.test.ts — separate
// module targeting ~/fleet/identities-archive/ with a narrower whitelist
// (exactly one entry: ".unarchive-requested") per D-08.
//
// Three vitest cases per plan behavior block:
//   Test 1 (LOCAL happy path): with IDENTITIES_ARCHIVE_HOST_DIR env pointed at
//     a tmpdir + a pre-created <tmp>/wren/ folder, call
//     writeIdentityArchiveFile("wren", ".unarchive-requested", "", { hostId, conn: null }).
//     Assert the file exists at <tmp>/wren/.unarchive-requested with empty contents.
//   Test 2 (relPath whitelist rejects): assert
//     writeIdentityArchiveFile("wren", ".pinned", ...) throws /invalid relPath/.
//   Test 3 (identity-key regex rejects): assert
//     writeIdentityArchiveFile("../etc/passwd", ".unarchive-requested", ...) throws
//     /invalid identity key/.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "node:fs/promises";

// LOCAL_HOST_IDS is parsed at module-load in identity-artifact-reader (imported
// transitively by per-identity-archive-file.ts). Set the env var BEFORE any
// import evaluates via vi.hoisted, which vitest guarantees runs before hoisted
// imports.
vi.hoisted(() => {
  process.env.IDENTITIES_LOCAL_HOST_IDS = "999";
});

// Mock tmux-helper.execCommand (reachable via writeMarkdownFileAtomic in the
// REMOTE branch — same reason as per-identity-file.test.ts).
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn().mockResolvedValue("/home/tester\n"),
}));

// Import AFTER the vi.mocks so the mocks bind to the module graph.
import {
  writeIdentityArchiveFile,
  ALLOWED_IDENTITY_ARCHIVE_REL_PATHS,
} from "./per-identity-archive-file.js";

const LOCAL_HOST_ID = 999;

// ──────────────────────────────────────────────────────────────────────
// Per-test scratch dir for LOCAL tests
// ──────────────────────────────────────────────────────────────────────

let scratchRoot: string;
const priorArchiveHostDir = process.env.IDENTITIES_ARCHIVE_HOST_DIR;

beforeEach(async () => {
  vi.clearAllMocks();
  scratchRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "per-identity-archive-file-test-"),
  );
  process.env.IDENTITIES_ARCHIVE_HOST_DIR = scratchRoot;
});

afterEach(async () => {
  // Restore prior env
  if (priorArchiveHostDir === undefined) {
    delete process.env.IDENTITIES_ARCHIVE_HOST_DIR;
  } else {
    process.env.IDENTITIES_ARCHIVE_HOST_DIR = priorArchiveHostDir;
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

describe("writeIdentityArchiveFile — LOCAL happy path (D-08 sentinel drop)", () => {
  it("Test 1: writes empty .unarchive-requested at <IDENTITIES_ARCHIVE_HOST_DIR>/wren/ via tmp+rename; file exists with empty contents after", async () => {
    // Precondition: archive folder must exist (writeIdentityArchiveFile does NOT
    // parent-mkdir — the reconciler already moved the folder to the archive tree).
    const identityArchiveDir = path.join(scratchRoot, "wren");
    await fs.mkdir(identityArchiveDir, { recursive: true });

    await writeIdentityArchiveFile("wren", ".unarchive-requested", "", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });

    const finalPath = path.join(identityArchiveDir, ".unarchive-requested");
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
// Test 2 — relPath whitelist rejects (T-143-01-01)
// ──────────────────────────────────────────────────────────────────────

describe("writeIdentityArchiveFile — relPath whitelist gate (T-143-01-01)", () => {
  it("Test 2: rejects '.pinned' (a live-tree path) with /invalid relPath/ before any I/O", async () => {
    // Whitelist is locked to exactly { ".unarchive-requested" } per D-08.
    await expect(
      writeIdentityArchiveFile("wren", ".pinned", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid relPath/);

    // Also verify the allowed set itself
    expect(ALLOWED_IDENTITY_ARCHIVE_REL_PATHS.size).toBe(1);
    expect(ALLOWED_IDENTITY_ARCHIVE_REL_PATHS.has(".unarchive-requested")).toBe(true);
    expect(ALLOWED_IDENTITY_ARCHIVE_REL_PATHS.has(".pinned")).toBe(false);
    expect(ALLOWED_IDENTITY_ARCHIVE_REL_PATHS.has(".archive-requested")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 3 — identity-key regex rejects (T-143-01-02)
// ──────────────────────────────────────────────────────────────────────

describe("writeIdentityArchiveFile — identity key gate (T-143-01-02)", () => {
  it("Test 3: rejects '../etc/passwd' with /invalid identity key/ before any I/O", async () => {
    // IDENTITY_KEY_RE excludes `.`, `/`, and every path-traversal shape.
    await expect(
      writeIdentityArchiveFile("../etc/passwd", ".unarchive-requested", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid identity key/);

    // Additional traversal shapes also rejected
    await expect(
      writeIdentityArchiveFile("tina/subpath", ".unarchive-requested", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid identity key/);

    await expect(
      writeIdentityArchiveFile("Uppercase", ".unarchive-requested", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid identity key/);
  });
});
