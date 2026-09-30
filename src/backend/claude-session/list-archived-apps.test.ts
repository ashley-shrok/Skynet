// ─── list-archived-apps — contract tests (Phase 143 Plan 143-02, D-06) ─────
//
// Tests the `listArchivedAppsOnHost` primitive introduced in Phase 143
// Plan 143-02. Mirrors the shape of `listArchivedRolesOnHost` tests.
//
// Three vitest cases:
//   Test 1 (LOCAL happy path): with APPS_ARCHIVE_HOST_DIR env pointed at a
//     tmpdir containing subfolders my-app/, data-pipeline/, and a rogue
//     Not_Valid_App/ (should be filtered by APP_SLUG_RE), assert
//     listArchivedAppsOnHost(null) returns ["data-pipeline", "my-app"]
//     (sorted, regex-filtered).
//   Test 2 (LOCAL missing dir): with APPS_ARCHIVE_HOST_DIR pointed at a path
//     that does not exist, assert returns [] (ENOENT graceful degrade).
//   Test 3 (LOCAL filters non-directory entries): with tmpdir containing a
//     subfolder my-app/ AND a file some-file.txt, assert only ["my-app"] is
//     returned (isDirectory gate).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "node:fs/promises";

// Mock tmux-helper.execCommand — reachable via the REMOTE branch import in
// list-archived-apps.ts. Must be declared before importing the module under test.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn().mockResolvedValue(""),
}));

// Import AFTER vi.mock so the mock binds to the module graph.
import { listArchivedAppsOnHost } from "./list-archived-apps.js";

// ──────────────────────────────────────────────────────────────────────
// Per-test scratch dir for LOCAL tests
// ──────────────────────────────────────────────────────────────────────

let scratchRoot: string;
const priorAppsArchiveHostDir = process.env.APPS_ARCHIVE_HOST_DIR;

beforeEach(async () => {
  vi.clearAllMocks();
  scratchRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "list-archived-apps-test-"),
  );
  process.env.APPS_ARCHIVE_HOST_DIR = scratchRoot;
});

afterEach(async () => {
  // Restore prior env
  if (priorAppsArchiveHostDir === undefined) {
    delete process.env.APPS_ARCHIVE_HOST_DIR;
  } else {
    process.env.APPS_ARCHIVE_HOST_DIR = priorAppsArchiveHostDir;
  }
  // Cleanup scratch dir
  try {
    await fs.rm(scratchRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ──────────────────────────────────────────────────────────────────────
// Test 1 — LOCAL happy path (sorted, regex-filtered, dirs only)
// ──────────────────────────────────────────────────────────────────────

describe("listArchivedAppsOnHost — LOCAL happy path", () => {
  it("Test 1: returns sorted, APP_SLUG_RE-filtered directory names; rogue Not_Valid_App/ dropped", async () => {
    // Create conforming app slug subfolders
    await fs.mkdir(path.join(scratchRoot, "my-app"), { recursive: true });
    await fs.mkdir(path.join(scratchRoot, "data-pipeline"), { recursive: true });
    // Rogue name — underscore, uppercase, should be filtered by APP_SLUG_RE /^[a-z0-9-]{1,64}$/
    await fs.mkdir(path.join(scratchRoot, "Not_Valid_App"), { recursive: true });

    const result = await listArchivedAppsOnHost(null);

    expect(result).toEqual(["data-pipeline", "my-app"]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 2 — LOCAL missing dir → [] (ENOENT graceful degrade)
// ──────────────────────────────────────────────────────────────────────

describe("listArchivedAppsOnHost — LOCAL missing dir", () => {
  it("Test 2: returns [] when APPS_ARCHIVE_HOST_DIR points at a non-existent path", async () => {
    // Point env at a path that does not exist (scratchRoot + subdir that was never created)
    process.env.APPS_ARCHIVE_HOST_DIR = path.join(
      scratchRoot,
      "does-not-exist",
    );

    const result = await listArchivedAppsOnHost(null);

    expect(result).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 3 — LOCAL filters non-directory entries (isDirectory gate)
// ──────────────────────────────────────────────────────────────────────

describe("listArchivedAppsOnHost — LOCAL filters non-directory entries", () => {
  it("Test 3: returns only directory entries; file some-file.txt is excluded", async () => {
    // One valid directory
    await fs.mkdir(path.join(scratchRoot, "my-app"), { recursive: true });
    // A file — must be excluded even though its name could potentially match the regex
    await fs.writeFile(path.join(scratchRoot, "some-file.txt"), "data", "utf-8");

    const result = await listArchivedAppsOnHost(null);

    expect(result).toEqual(["my-app"]);
  });
});
