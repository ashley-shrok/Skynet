// ─── per-identity-archive-file — contract tests (Phase 143 Plan 143-01, D-08) ─
//
// Tests the archive-tree per-identity file-touch primitive introduced in
// Phase 143 Plan 143-01, extended 2026-10-01 for the identity-unarchive
// matrix-cred-location correction. Sibling to per-identity-file.test.ts —
// separate module targeting ~/fleet/identities-archive/ with a tightly bounded
// whitelist:
//   - ".unarchive-requested" (D-08 original)
//   - "relay.json" (2026-10-01 — un-archive route rewrites token in-place)
//
// Tests:
//   Test 1 (LOCAL happy path): writes empty .unarchive-requested; file exists.
//   Test 2 (relPath whitelist rejects): .pinned is a live-tree-only basename.
//   Test 3 (identity-key regex rejects): path-traversal shapes.
//   Test 4 (LOCAL relay.json write with chmod 0o600): file content + mode.
//   Test 5 (readIdentityArchiveFile LOCAL): round-trip relay.json contents.
//   Test 6 (readIdentityArchiveFile whitelist gate): rejects disallowed relPath.
//   Test 7 (writeIdentityArchiveFile chmod failure tagged): tagged error shape.

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
// REMOTE branch, and used directly by readIdentityArchiveFile REMOTE + the
// chmod step on REMOTE writes).
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn().mockResolvedValue("/home/tester\n"),
}));

// Import AFTER the vi.mocks so the mocks bind to the module graph.
import {
  writeIdentityArchiveFile,
  readIdentityArchiveFile,
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
    // Whitelist is bounded to { ".unarchive-requested", "relay.json" } —
    // .pinned is live-tree-only and must not be accepted here.
    await expect(
      writeIdentityArchiveFile("wren", ".pinned", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid relPath/);

    // Verify the allowed set shape (2026-10-01 — relay.json added)
    expect(ALLOWED_IDENTITY_ARCHIVE_REL_PATHS.size).toBe(2);
    expect(ALLOWED_IDENTITY_ARCHIVE_REL_PATHS.has(".unarchive-requested")).toBe(true);
    expect(ALLOWED_IDENTITY_ARCHIVE_REL_PATHS.has("relay.json")).toBe(true);
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

// ──────────────────────────────────────────────────────────────────────
// Test 4 — LOCAL relay.json write with chmod 0o600 (2026-10-01 correction)
// ──────────────────────────────────────────────────────────────────────

describe("writeIdentityArchiveFile — LOCAL relay.json write with chmod (un-archive route)", () => {
  it("Test 4: writes relay.json content and applies 0o600 chmod", async () => {
    const identityArchiveDir = path.join(scratchRoot, "wren");
    await fs.mkdir(identityArchiveDir, { recursive: true });

    const relayJsonBody = JSON.stringify({
      base: "https://t1000.taild9b663.ts.net/_matrix/client/v3",
      user_id: "@wren:t1000.taild9b663.ts.net",
      password: "pw-preserved",
      token: "fresh-tok",
      access_token: "fresh-tok",
    }, null, 2);

    await writeIdentityArchiveFile("wren", "relay.json", relayJsonBody, {
      hostId: LOCAL_HOST_ID,
      conn: null,
      chmod: 0o600,
    });

    const finalPath = path.join(identityArchiveDir, "relay.json");
    const stat = await fs.stat(finalPath);
    expect(stat.isFile()).toBe(true);

    // 0o600 = owner rw only (no group, no other). Mask the file-type bits.
    expect(stat.mode & 0o777).toBe(0o600);

    const contents = await fs.readFile(finalPath, "utf-8");
    expect(JSON.parse(contents)).toEqual({
      base: "https://t1000.taild9b663.ts.net/_matrix/client/v3",
      user_id: "@wren:t1000.taild9b663.ts.net",
      password: "pw-preserved",
      token: "fresh-tok",
      access_token: "fresh-tok",
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 5 — readIdentityArchiveFile LOCAL round-trip
// ──────────────────────────────────────────────────────────────────────

describe("readIdentityArchiveFile — LOCAL round-trip (un-archive route)", () => {
  it("Test 5: reads relay.json contents written by writeIdentityArchiveFile", async () => {
    const identityArchiveDir = path.join(scratchRoot, "wren");
    await fs.mkdir(identityArchiveDir, { recursive: true });

    const relayJsonBody = JSON.stringify({
      base: "https://t1000.taild9b663.ts.net/_matrix/client/v3",
      user_id: "@wren:t1000.taild9b663.ts.net",
      password: "pw-abc",
      token: "stale-tok",
      access_token: "stale-tok",
    });

    await writeIdentityArchiveFile("wren", "relay.json", relayJsonBody, {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });

    const roundTrip = await readIdentityArchiveFile("wren", "relay.json", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });
    expect(JSON.parse(roundTrip)).toEqual({
      base: "https://t1000.taild9b663.ts.net/_matrix/client/v3",
      user_id: "@wren:t1000.taild9b663.ts.net",
      password: "pw-abc",
      token: "stale-tok",
      access_token: "stale-tok",
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 6 — readIdentityArchiveFile whitelist gate
// ──────────────────────────────────────────────────────────────────────

describe("readIdentityArchiveFile — relPath whitelist gate", () => {
  it("Test 6: rejects disallowed relPath BEFORE any I/O", async () => {
    await expect(
      readIdentityArchiveFile("wren", ".pinned", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid relPath/);
  });

  it("Test 6b: rejects path-traversal identity key BEFORE any I/O", async () => {
    await expect(
      readIdentityArchiveFile("../etc/passwd", "relay.json", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid identity key/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 7 — chmod failure tagged (parity with per-identity-file.ts)
// ──────────────────────────────────────────────────────────────────────

describe("writeIdentityArchiveFile — chmod failure tagged error shape", () => {
  it("Test 7: chmod failure re-thrown as /chmod_<mode>_failed/", async () => {
    // Create the file so the write succeeds but chmod can be forced to fail.
    const identityArchiveDir = path.join(scratchRoot, "wren");
    await fs.mkdir(identityArchiveDir, { recursive: true });

    // Monkey-patch fs.chmod to throw once.
    const origChmod = fs.chmod.bind(fs);
    const chmodSpy = vi
      .spyOn(fs, "chmod")
      .mockRejectedValueOnce(new Error("boom"));

    try {
      await expect(
        writeIdentityArchiveFile("wren", "relay.json", "{}", {
          hostId: LOCAL_HOST_ID,
          conn: null,
          chmod: 0o600,
        }),
      ).rejects.toThrow(/chmod_600_failed: boom/);
    } finally {
      chmodSpy.mockRestore();
      // Make sure fs.chmod is actually restored for subsequent tests.
      void origChmod;
    }
  });
});
