// ─── identity-artifact-reader — role-cosmetic extractor + role-by-name readers ──
//
// Phase 85 Plan 85-01 Task 1: verifies three new/reused exports that Wave-1
// consumers need to merge role cosmetics into publicIdentity and to serve
// role-folder avatar fallbacks:
//
//   1. readRoleFileByName(conn, roleName)              — role-name-keyed .md read
//      WITHOUT the identity two-step. Mirrors readRoleFile's LOCAL/REMOTE branch
//      shape but takes roleName directly. Validates via ROLE_NAME_PATTERN.
//
//   2. extractCosmeticsFromFrontmatter(markdown)       — EXISTING function reused
//      unchanged on role markdown (same YAML shape, same narrowing rules — no
//      new extractor needed per Plan 85-01 Task 1 step 2).
//
//   3. readAvatarSiblingFileByRole(conn, roleName, avatarFilename)
//      — role-side avatar reader mirroring readAvatarSiblingFile's shape but
//      rooted at ~/fleet/roles/<roleName>/<avatarFilename> with the filename
//      passed in explicitly (already known from role frontmatter).
//
// Test map (10 tests, per plan Task 1 <behavior>):
//   Test 1 (LOCAL):  readRoleFileByName returns the role file body.
//   Test 2 (LOCAL):  extractCosmeticsFromFrontmatter narrows all four fields.
//   Test 3 (LOCAL):  extractor returns subset-only for subset frontmatter.
//   Test 4 (LOCAL):  extractor returns {} for no-frontmatter role file.
//   Test 5 (LOCAL):  readRoleFileByName returns {markdown: ""} on ENOENT.
//   Test 6 (REMOTE): readRoleFileByName execs exact expected shell command.
//   Test 7 (invalid): readRoleFileByName throws on invalid roleName.
//   Test 8 (LOCAL):  readAvatarSiblingFileByRole returns bytes+mime+ext for existing file.
//   Test 9 (LOCAL):  readAvatarSiblingFileByRole returns null when role folder has no sibling.
//   Test 10 (LOCAL): readAvatarSiblingFileByRole rejects bytes over IDMEDIT_MAX_AVATAR_BYTES.
//
// Scaffold mirrors identity-artifact-reader.role-file.test.ts:
//   - vi.mock('../ssh/tmux-helper.js') so REMOTE-branch execCommand routes per-test.
//   - LOCAL-branch tests mkdtemps ROLES_HOST_DIR + IDENTITIES_HOST_DIR.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";
import type { Client as SSHClientType } from "ssh2";

// Mock tmux-helper.execCommand BEFORE importing the module under test so the
// mock is bound to the module graph when identity-artifact-reader evaluates.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from "../ssh/tmux-helper.js";
import {
  readRoleFileByName,
  readAvatarSiblingFileByRole,
  extractCosmeticsFromFrontmatter,
  IDMEDIT_MAX_AVATAR_BYTES,
} from "./identity-artifact-reader.js";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// Tests 1, 3, 4, 5 — readRoleFileByName + extractor (LOCAL branch)
// ──────────────────────────────────────────────────────────────────────

describe("readRoleFileByName + extractCosmeticsFromFrontmatter — LOCAL branch (conn=null)", () => {
  let rolesRoot: string;
  const ROLE = "box-maintainer";

  beforeEach(async () => {
    rolesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "85-01-roles-"));
    process.env.ROLES_HOST_DIR = rolesRoot;
  });

  afterEach(async () => {
    delete process.env.ROLES_HOST_DIR;
    await fs.rm(rolesRoot, { recursive: true, force: true });
  });

  it("Test 1: readRoleFileByName reads ROLES_HOST_DIR/<role>/<role>.md and returns {markdown}", async () => {
    const roleDir = path.join(rolesRoot, ROLE);
    await fs.mkdir(roleDir, { recursive: true });
    const body =
      "---\n" +
      "title: Box maintainer\n" +
      "colorHue: 190\n" +
      'voice: "Kate.wav"\n' +
      'avatar: "box-maintainer.webp"\n' +
      "---\n\n# Box maintainer\n";
    await fs.writeFile(path.join(roleDir, `${ROLE}.md`), body, "utf-8");

    const result = await readRoleFileByName(null, ROLE);
    expect(result.markdown).toBe(body);
  });

  it("Test 2: extractCosmeticsFromFrontmatter on role markdown returns all four fields narrowed", async () => {
    const body =
      "---\n" +
      "title: Box maintainer\n" +
      "colorHue: 190\n" +
      'voice: "Kate.wav"\n' +
      'avatar: "box-maintainer.webp"\n' +
      "---\n\n# Box maintainer\n";

    const cos = extractCosmeticsFromFrontmatter(body);
    expect(cos.title).toBe("Box maintainer");
    expect(cos.colorHue).toBe(190);
    expect(cos.voice).toBe("Kate.wav");
    expect(cos.avatar).toBe("box-maintainer.webp");
  });

  it("Test 3: extractor returns subset-only when role file has only title + colorHue", async () => {
    const body =
      "---\n" +
      "title: Partial role\n" +
      "colorHue: 42\n" +
      "---\n";

    const cos = extractCosmeticsFromFrontmatter(body);
    expect(cos.title).toBe("Partial role");
    expect(cos.colorHue).toBe(42);
    // Absent fields MUST NOT appear
    expect("voice" in cos).toBe(false);
    expect("avatar" in cos).toBe(false);
  });

  it("Test 4: extractor returns {} for role file with no frontmatter block", async () => {
    const body = "# Just a heading\n\nNo YAML at the top.\n";
    const cos = extractCosmeticsFromFrontmatter(body);
    expect(cos).toEqual({});
  });

  it("Test 5: readRoleFileByName returns {markdown: ''} on ENOENT (missing role file)", async () => {
    // rolesRoot exists but no <role>/<role>.md file within
    const result = await readRoleFileByName(null, "does-not-exist");
    expect(result.markdown).toBe("");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 6 — readRoleFileByName (REMOTE branch)
// ──────────────────────────────────────────────────────────────────────

describe("readRoleFileByName — REMOTE branch (conn is SSHClientType)", () => {
  it("Test 6: execs exact `cat \"$HOME/fleet/roles/<role>/<role>.md\" 2>/dev/null || true` and returns {markdown: <stdout>}", async () => {
    const roleMd = "---\ntitle: Box maintainer\n---\n\n# body\n";
    const capturedCommands: string[] = [];
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        capturedCommands.push(cmd);
        if (cmd.includes("fleet/roles/box-maintainer/box-maintainer.md")) {
          return roleMd;
        }
        return "";
      },
    );

    const conn = {} as SSHClientType;
    const result = await readRoleFileByName(conn, "box-maintainer");

    // Path substitution: role folder queried directly, NO identity two-step
    const roleCmd = capturedCommands.find((c) =>
      c.includes("fleet/roles/box-maintainer/box-maintainer.md"),
    );
    expect(roleCmd).toBeDefined();
    expect(roleCmd).toBe(
      `cat "$HOME/fleet/roles/box-maintainer/box-maintainer.md" 2>/dev/null || true`,
    );

    // Two-step MUST NOT happen — no identity file read
    const identityCmd = capturedCommands.find((c) =>
      c.includes("fleet/identities/"),
    );
    expect(identityCmd).toBeUndefined();

    // Response propagated
    expect(result.markdown).toBe(roleMd);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 7 — readRoleFileByName invalid roleName gate
// ──────────────────────────────────────────────────────────────────────

describe("readRoleFileByName — invalid roleName (ROLE_NAME_PATTERN gate)", () => {
  it("Test 7: rejects `../etc/passwd` before opening SFTP / doing any I/O", async () => {
    // LOCAL branch (conn=null) — should throw synchronously via the pattern gate.
    await expect(readRoleFileByName(null, "../etc/passwd")).rejects.toThrow(
      /invalid roleName/,
    );
  });

  it("Test 7b: rejects other non-kebab-case values (uppercase, dots, slashes)", async () => {
    await expect(readRoleFileByName(null, "Box-Maintainer")).rejects.toThrow(
      /invalid roleName/,
    );
    await expect(readRoleFileByName(null, "box.maintainer")).rejects.toThrow(
      /invalid roleName/,
    );
    await expect(readRoleFileByName(null, "box/maintainer")).rejects.toThrow(
      /invalid roleName/,
    );
    await expect(readRoleFileByName(null, "")).rejects.toThrow(/invalid roleName/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Tests 8, 9, 10 — readAvatarSiblingFileByRole
// ──────────────────────────────────────────────────────────────────────

describe("readAvatarSiblingFileByRole — LOCAL branch (conn=null)", () => {
  let rolesRoot: string;
  const ROLE = "box-maintainer";

  beforeEach(async () => {
    rolesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "85-01-role-avatar-"));
    process.env.ROLES_HOST_DIR = rolesRoot;
  });

  afterEach(async () => {
    delete process.env.ROLES_HOST_DIR;
    await fs.rm(rolesRoot, { recursive: true, force: true });
  });

  it("Test 8: returns {bytes, mime, ext} when role folder contains the named sibling avatar", async () => {
    const roleDir = path.join(rolesRoot, ROLE);
    await fs.mkdir(roleDir, { recursive: true });
    const webpBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]); // "RIFF" prefix
    await fs.writeFile(path.join(roleDir, `${ROLE}.webp`), webpBytes);

    const result = await readAvatarSiblingFileByRole(
      null,
      ROLE,
      `${ROLE}.webp`,
    );
    expect(result).not.toBeNull();
    expect(result!.bytes.equals(webpBytes)).toBe(true);
    expect(result!.mime).toBe("image/webp");
    expect(result!.ext).toBe("webp");
  });

  it("Test 9: returns null when role folder contains no sibling image at the named path", async () => {
    // Role folder exists but no webp file
    const roleDir = path.join(rolesRoot, ROLE);
    await fs.mkdir(roleDir, { recursive: true });

    const result = await readAvatarSiblingFileByRole(
      null,
      ROLE,
      `${ROLE}.webp`,
    );
    expect(result).toBeNull();
  });

  it("Test 10: rejects bytes exceeding IDMEDIT_MAX_AVATAR_BYTES (defense-in-depth cap)", async () => {
    const roleDir = path.join(rolesRoot, ROLE);
    await fs.mkdir(roleDir, { recursive: true });
    // +1 over the cap so it fails the guard
    const oversized = Buffer.alloc(IDMEDIT_MAX_AVATAR_BYTES + 1, 0);
    await fs.writeFile(path.join(roleDir, `${ROLE}.webp`), oversized);

    await expect(
      readAvatarSiblingFileByRole(null, ROLE, `${ROLE}.webp`),
    ).rejects.toThrow(/exceeds|IDMEDIT_MAX_AVATAR_BYTES/);
  });

  it("Test 10b: rejects invalid avatarFilename (fails ext regex) before any I/O", async () => {
    // Filename must match `^[a-z0-9-]+\.(webp|png|jpg|gif|svg)$` per Task 1 step 3
    await expect(
      readAvatarSiblingFileByRole(null, ROLE, "not-an-image.exe"),
    ).rejects.toThrow(/invalid avatarFilename|avatar/);
  });

  it("Test 10c: rejects invalid roleName (ROLE_NAME_PATTERN gate) before any I/O", async () => {
    await expect(
      readAvatarSiblingFileByRole(null, "../etc", "avatar.webp"),
    ).rejects.toThrow(/invalid roleName/);
  });
});
