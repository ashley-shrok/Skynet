// ─── per-app-archive-file — contract tests (Phase 143 Plan 143-01, D-08) ──────
//
// Tests the archive-tree per-app file-touch primitive introduced in
// Phase 143 Plan 143-01. Sibling to per-app-file.test.ts — separate
// module targeting ~/fleet/apps-archive/ with a narrower whitelist
// (exactly one entry: ".unarchive-requested") per D-08.
//
// Three vitest cases per plan behavior block:
//   Test 1 (LOCAL happy path): with APPS_ARCHIVE_HOST_DIR env pointed at a
//     tmpdir + a pre-created <tmp>/my-app/ folder, call
//     writeAppArchiveFile("my-app", ".unarchive-requested", "", { hostId, conn: null }).
//     Assert the file exists at <tmp>/my-app/.unarchive-requested with empty contents.
//   Test 2 (relPath whitelist rejects): assert
//     writeAppArchiveFile("my-app", ".archive-requested", ...) throws /invalid relPath/.
//   Test 3 (APP_SLUG_RE rejects): assert
//     writeAppArchiveFile("../etc/passwd", ".unarchive-requested", ...) throws /invalid slug/.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "node:fs/promises";

// LOCAL_HOST_IDS is parsed at module-load in identity-artifact-reader (imported
// transitively by per-app-archive-file.ts). Set the env var BEFORE any import
// evaluates via vi.hoisted, which vitest guarantees runs before hoisted imports.
vi.hoisted(() => {
  process.env.IDENTITIES_LOCAL_HOST_IDS = "999";
});

// Mock tmux-helper.execCommand (reachable via writeMarkdownFileAtomic in the
// REMOTE branch — same reason as per-app-file.test.ts).
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn().mockResolvedValue("/home/tester\n"),
}));

// Import AFTER the vi.mocks so the mocks bind to the module graph.
import {
  writeAppArchiveFile,
  ALLOWED_APP_ARCHIVE_REL_PATHS,
} from "./per-app-archive-file.js";

const LOCAL_HOST_ID = 999;

// ──────────────────────────────────────────────────────────────────────
// Per-test scratch dir for LOCAL tests
// ──────────────────────────────────────────────────────────────────────

let scratchRoot: string;
const priorArchiveHostDir = process.env.APPS_ARCHIVE_HOST_DIR;

beforeEach(async () => {
  vi.clearAllMocks();
  scratchRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "per-app-archive-file-test-"),
  );
  process.env.APPS_ARCHIVE_HOST_DIR = scratchRoot;
});

afterEach(async () => {
  // Restore prior env
  if (priorArchiveHostDir === undefined) {
    delete process.env.APPS_ARCHIVE_HOST_DIR;
  } else {
    process.env.APPS_ARCHIVE_HOST_DIR = priorArchiveHostDir;
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

describe("writeAppArchiveFile — LOCAL happy path (D-08 sentinel drop)", () => {
  it("Test 1: writes empty .unarchive-requested at <APPS_ARCHIVE_HOST_DIR>/my-app/ via tmp+rename; file exists with empty contents after", async () => {
    // Precondition: archive folder must exist (writeAppArchiveFile does NOT
    // parent-mkdir — the reconciler already moved the folder to the archive tree).
    const appArchiveDir = path.join(scratchRoot, "my-app");
    await fs.mkdir(appArchiveDir, { recursive: true });

    await writeAppArchiveFile("my-app", ".unarchive-requested", "", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });

    const finalPath = path.join(appArchiveDir, ".unarchive-requested");
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

describe("writeAppArchiveFile — relPath whitelist gate (D-08 narrower whitelist)", () => {
  it("Test 2: rejects '.archive-requested' (live-tree path) with /invalid relPath/ before any I/O", async () => {
    // Whitelist is locked to exactly { ".unarchive-requested" } per D-08.
    await expect(
      writeAppArchiveFile("my-app", ".archive-requested", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid relPath/);

    // Also reject any other non-whitelisted path
    await expect(
      writeAppArchiveFile("my-app", ".pinned", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid relPath/);

    // Verify the allowed set itself
    expect(ALLOWED_APP_ARCHIVE_REL_PATHS.size).toBe(1);
    expect(ALLOWED_APP_ARCHIVE_REL_PATHS.has(".unarchive-requested")).toBe(true);
    expect(ALLOWED_APP_ARCHIVE_REL_PATHS.has(".archive-requested")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 3 — APP_SLUG_RE rejects (T-143-01-04)
// ──────────────────────────────────────────────────────────────────────

describe("writeAppArchiveFile — app slug gate (T-143-01-04, APP_SLUG_RE /^[a-z0-9-]{1,64}$/)", () => {
  it("Test 3: rejects '../etc/passwd' with /invalid slug/ before any I/O", async () => {
    // APP_SLUG_RE excludes `.`, `/`, uppercase, underscore, and every
    // path-traversal shape.
    await expect(
      writeAppArchiveFile("../etc/passwd", ".unarchive-requested", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid slug/);

    // Uppercase rejected
    await expect(
      writeAppArchiveFile("MyApp", ".unarchive-requested", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid slug/);

    // Underscore rejected (APP_SLUG_RE is /^[a-z0-9-]{1,64}$/, no underscore)
    await expect(
      writeAppArchiveFile("my_app", ".unarchive-requested", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid slug/);

    // Empty string rejected
    await expect(
      writeAppArchiveFile("", ".unarchive-requested", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid slug/);
  });
});
