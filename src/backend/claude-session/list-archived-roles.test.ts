// ─── list-archived-roles — contract tests (Phase 143 Plan 143-02, D-06) ────
//
// Tests the `listArchivedRolesOnHost` primitive introduced in Phase 143
// Plan 143-02. Mirrors the shape of `listArchivedIdentityKeysOnHost` tests.
//
// Three vitest cases:
//   Test 1 (LOCAL happy path): with ROLES_ARCHIVE_HOST_DIR env pointed at a
//     tmpdir containing subfolders box-maintainer/, researcher/, and a rogue
//     Not-A-Role/ (should be filtered by ROLE_NAME_PATTERN), assert
//     listArchivedRolesOnHost(null) returns ["box-maintainer", "researcher"]
//     (sorted, regex-filtered).
//   Test 2 (LOCAL missing dir): with ROLES_ARCHIVE_HOST_DIR pointed at a path
//     that does not exist, assert returns [] (ENOENT graceful degrade).
//   Test 3 (LOCAL filters non-directory entries): with tmpdir containing a
//     subfolder admin/ AND a file some-file.txt, assert only ["admin"] is
//     returned (isDirectory gate).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "node:fs/promises";

// Mock tmux-helper.execCommand — reachable via the REMOTE branch import in
// list-archived-roles.ts. Must be declared before importing the module under test.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn().mockResolvedValue(""),
}));

// Import AFTER vi.mock so the mock binds to the module graph.
import { listArchivedRolesOnHost } from "./list-archived-roles.js";

// ──────────────────────────────────────────────────────────────────────
// Per-test scratch dir for LOCAL tests
// ──────────────────────────────────────────────────────────────────────

let scratchRoot: string;
const priorRolesArchiveHostDir = process.env.ROLES_ARCHIVE_HOST_DIR;

beforeEach(async () => {
  vi.clearAllMocks();
  scratchRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "list-archived-roles-test-"),
  );
  process.env.ROLES_ARCHIVE_HOST_DIR = scratchRoot;
});

afterEach(async () => {
  // Restore prior env
  if (priorRolesArchiveHostDir === undefined) {
    delete process.env.ROLES_ARCHIVE_HOST_DIR;
  } else {
    process.env.ROLES_ARCHIVE_HOST_DIR = priorRolesArchiveHostDir;
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

describe("listArchivedRolesOnHost — LOCAL happy path", () => {
  it("Test 1: returns sorted, ROLE_NAME_PATTERN-filtered directory names; rogue Not-A-Role/ dropped", async () => {
    // Create conforming role subfolders
    await fs.mkdir(path.join(scratchRoot, "box-maintainer"), { recursive: true });
    await fs.mkdir(path.join(scratchRoot, "researcher"), { recursive: true });
    // Rogue name — uppercase, should be filtered by ROLE_NAME_PATTERN /^[a-z0-9-]+$/
    await fs.mkdir(path.join(scratchRoot, "Not-A-Role"), { recursive: true });

    const result = await listArchivedRolesOnHost(null);

    expect(result).toEqual(["box-maintainer", "researcher"]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 2 — LOCAL missing dir → [] (ENOENT graceful degrade)
// ──────────────────────────────────────────────────────────────────────

describe("listArchivedRolesOnHost — LOCAL missing dir", () => {
  it("Test 2: returns [] when ROLES_ARCHIVE_HOST_DIR points at a non-existent path", async () => {
    // Point env at a path that does not exist (scratchRoot + subdir that was never created)
    process.env.ROLES_ARCHIVE_HOST_DIR = path.join(
      scratchRoot,
      "does-not-exist",
    );

    const result = await listArchivedRolesOnHost(null);

    expect(result).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 3 — LOCAL filters non-directory entries (isDirectory gate)
// ──────────────────────────────────────────────────────────────────────

describe("listArchivedRolesOnHost — LOCAL filters non-directory entries", () => {
  it("Test 3: returns only directory entries; file some-file.txt is excluded", async () => {
    // One valid directory
    await fs.mkdir(path.join(scratchRoot, "admin"), { recursive: true });
    // A file — must be excluded even though its name could match the regex
    await fs.writeFile(path.join(scratchRoot, "some-file.txt"), "data", "utf-8");

    const result = await listArchivedRolesOnHost(null);

    expect(result).toEqual(["admin"]);
  });
});
