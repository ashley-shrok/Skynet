/**
 * identity-artifact-reader.avatar-read.test.ts — Phase 66 Plan 66-03 Task 1
 *
 * Unit tests for the two new READ-side exports co-located in
 * identity-artifact-reader.ts under section "6c. Cosmetics reads — Phase 66
 * Plan 03":
 *
 *   1) readAvatarSiblingFile(conn, identityKey) → {bytes, mime, ext} | null
 *      - LOCAL branch (conn === null): fs.readFile with extension-discovery
 *        cascade through AVATAR_EXT_VALUES = [webp,png,jpg,gif,svg]
 *      - REMOTE branch (conn is SSHClient): single `ls` round-trip to find
 *        the sibling file's extension, then SFTP-reads that file.
 *      - Frontmatter is AUTHORITATIVE when present — if the identity's .md
 *        names avatar: <key>.<ext>, that ext wins.
 *      - Returns null when no sibling file exists (LOCAL ENOENT / REMOTE
 *        empty ls output).
 *      - Throws on SSH-layer errors, invalid identityKey, or oversized files.
 *
 *   2) extractCosmeticsFromFrontmatter(markdown) → { displayName?, title?,
 *      colorHue?, voice?, avatar? }
 *      - Same regex + yaml.load pattern as extractRoleFromMarkdown.
 *      - Type-narrows each field (typeof string+non-empty for scalars;
 *        typeof number + 0-359 range for colorHue).
 *      - Malformed / missing → {} (empty object; caller sees "no cosmetics").
 *
 * Test layout follows identity-artifact-reader.remote-writes.test.ts:
 *   - vi.mock tmux-helper for the REMOTE branch's ls exec
 *   - mock ssh2 Client's .sftp() for sftp.readFile spy
 *   - LOCAL branch: vi.mock node:fs/promises for fs.readFile
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client as SSHClientType } from "ssh2";
type SFTPWrapper = import("ssh2").SFTPWrapper;

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE the dynamic import of identity-artifact-reader
// ---------------------------------------------------------------------------

const execCommandMock = vi.fn();
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: (conn: unknown, cmd: string) => execCommandMock(conn, cmd),
}));

// Mock fs/promises for LOCAL-branch tests. The mock's readFile is a spy that
// we swap behavior per-test (per-ext success/ENOENT). Same shape as the
// concrete node:fs/promises API used by writeAvatarSiblingFile's LOCAL branch.
const fsReadFileMock = vi.fn();
vi.mock("fs/promises", () => ({
  default: {
    readFile: (p: string, opts?: unknown) => fsReadFileMock(p, opts),
    writeFile: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    unlink: vi.fn(),
  },
  readFile: (p: string, opts?: unknown) => fsReadFileMock(p, opts),
  writeFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn(),
}));

// Import AFTER the vi.mock so the mock is bound to the module graph.
import {
  readAvatarSiblingFile,
  extractCosmeticsFromFrontmatter,
  AVATAR_MIME_FROM_EXT,
  IDMEDIT_MAX_AVATAR_BYTES,
} from "./identity-artifact-reader.js";

// ---------------------------------------------------------------------------
// Mock SSH client builder for REMOTE branch
// ---------------------------------------------------------------------------

function buildMockConn(sftpReadResult: Buffer | Error): {
  conn: SSHClientType;
  sftp: {
    readFile: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
} {
  const sftp = {
    readFile: vi.fn((_path: string, cb: (err: Error | undefined, data?: Buffer) => void) => {
      if (sftpReadResult instanceof Error) return cb(sftpReadResult);
      cb(undefined, sftpReadResult);
    }),
    end: vi.fn(),
  };

  const conn = {
    sftp: (cb: (err: Error | undefined, s: SFTPWrapper) => void) => {
      cb(undefined, sftp as unknown as SFTPWrapper);
    },
  } as unknown as SSHClientType;

  return { conn, sftp };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // ENOENT by default for every LOCAL fs.readFile — tests override per-case.
  fsReadFileMock.mockImplementation(() => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    return Promise.reject(err);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// readAvatarSiblingFile
// ===========================================================================

describe("readAvatarSiblingFile — LOCAL branch (fs)", () => {
  it("Test A: LOCAL, sibling file exists as tina.png (no frontmatter avatar key) → returns {bytes, mime:'image/png', ext:'png'} after ext cascade", async () => {
    // No frontmatter .md read succeeds (ENOENT) → fall through to ext cascade.
    // Cascade order: webp, png, jpg, gif, svg. Fail webp (ENOENT), succeed png.
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    fsReadFileMock.mockImplementation((filePath: string) => {
      if (filePath.endsWith("tina.md")) {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        return Promise.reject(err);
      }
      if (filePath.endsWith("tina.png")) return Promise.resolve(pngBytes);
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      return Promise.reject(err);
    });

    const result = await readAvatarSiblingFile(null, "tina");
    expect(result).not.toBeNull();
    expect(result!.mime).toBe("image/png");
    expect(result!.ext).toBe("png");
    expect(result!.bytes.equals(pngBytes)).toBe(true);
  });

  it("Test B: LOCAL, no sibling file at all → returns null", async () => {
    // ENOENT default for every path.
    const result = await readAvatarSiblingFile(null, "ghost");
    expect(result).toBeNull();
  });

  it("Test C: LOCAL, frontmatter names tina.webp AND file exists → returns webp result (frontmatter authoritative)", async () => {
    const webpBytes = Buffer.from([0x52, 0x49, 0x46, 0x46]);
    const markdown = "---\nrole: box-maintainer\navatar: tina.webp\n---\n\n# tina\n";
    fsReadFileMock.mockImplementation((filePath: string, opts?: unknown) => {
      if (filePath.endsWith("tina.md") && opts === "utf-8") return Promise.resolve(markdown);
      if (filePath.endsWith("tina.webp")) return Promise.resolve(webpBytes);
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      return Promise.reject(err);
    });

    const result = await readAvatarSiblingFile(null, "tina");
    expect(result).not.toBeNull();
    expect(result!.mime).toBe("image/webp");
    expect(result!.ext).toBe("webp");
    expect(result!.bytes.equals(webpBytes)).toBe(true);
  });
});

describe("readAvatarSiblingFile — REMOTE branch (SSH)", () => {
  it("Test D: REMOTE, ls returns 'tina.webp' → SFTP-reads webp, returns webp result", async () => {
    const webpBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0xde, 0xad]);
    // First exec: read markdown (frontmatter). Return empty (no md file) so we
    // fall through to the ls-cascade. Second exec: the ls command returns basename.
    execCommandMock.mockImplementation((_conn: unknown, cmd: string) => {
      if (cmd.includes(".md")) return Promise.resolve(""); // no md file
      if (cmd.includes("ls ")) return Promise.resolve("tina.webp\n");
      if (cmd.includes("echo $HOME")) return Promise.resolve("/home/tester\n");
      return Promise.resolve("");
    });

    const { conn, sftp } = buildMockConn(webpBytes);
    const result = await readAvatarSiblingFile(conn, "tina");

    expect(result).not.toBeNull();
    expect(result!.mime).toBe("image/webp");
    expect(result!.ext).toBe("webp");
    expect(result!.bytes.equals(webpBytes)).toBe(true);
    expect(sftp.readFile).toHaveBeenCalledTimes(1);
    expect(sftp.end).toHaveBeenCalledTimes(1);
  });

  it("Test E: REMOTE, ls returns empty → returns null (no sibling file exists)", async () => {
    execCommandMock.mockImplementation((_conn: unknown, cmd: string) => {
      if (cmd.includes(".md")) return Promise.resolve("");
      if (cmd.includes("ls ")) return Promise.resolve(""); // ls found nothing
      if (cmd.includes("echo $HOME")) return Promise.resolve("/home/tester\n");
      return Promise.resolve("");
    });

    const { conn, sftp } = buildMockConn(Buffer.alloc(0));
    const result = await readAvatarSiblingFile(conn, "ghost");

    expect(result).toBeNull();
    expect(sftp.readFile).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// extractCosmeticsFromFrontmatter
// ===========================================================================

describe("extractCosmeticsFromFrontmatter", () => {
  it("Test F: all 5 keys present → returns all 5", async () => {
    const md =
      "---\nrole: box-maintainer\ndisplayName: Tina\ntitle: The Coder\ncolorHue: 220\nvoice: Elena.wav\navatar: tina.png\n---\n\n# tina\n";
    const cos = extractCosmeticsFromFrontmatter(md);
    expect(cos.displayName).toBe("Tina");
    expect(cos.title).toBe("The Coder");
    expect(cos.colorHue).toBe(220);
    expect(cos.voice).toBe("Elena.wav");
    expect(cos.avatar).toBe("tina.png");
  });

  it("Test G: malformed YAML → returns {}", async () => {
    const md = "---\n: : broken : : yaml : :\n  invalid: [unclosed\n---\n\n# body\n";
    const cos = extractCosmeticsFromFrontmatter(md);
    expect(cos).toEqual({});
  });

  it("Test H: colorHue out of range (400) → colorHue omitted from result", async () => {
    const md = "---\nrole: x\ndisplayName: Tina\ncolorHue: 400\n---\n\n# body\n";
    const cos = extractCosmeticsFromFrontmatter(md);
    expect(cos.displayName).toBe("Tina");
    expect("colorHue" in cos).toBe(false);
  });

  it("Test I: explicit YAML null (title: null) → title omitted", async () => {
    const md = "---\nrole: x\ndisplayName: Tina\ntitle: null\n---\n\n# body\n";
    const cos = extractCosmeticsFromFrontmatter(md);
    expect(cos.displayName).toBe("Tina");
    expect("title" in cos).toBe(false);
  });
});

// ===========================================================================
// Invalid identityKey guard
// ===========================================================================

describe("readAvatarSiblingFile — invalid identityKey", () => {
  it("Test J: invalid identityKey ('Bad Key') throws", async () => {
    await expect(readAvatarSiblingFile(null, "Bad Key")).rejects.toThrow(
      /invalid identityKey/,
    );
  });
});

// ===========================================================================
// AVATAR_MIME_FROM_EXT sanity
// ===========================================================================

describe("AVATAR_MIME_FROM_EXT", () => {
  it("has correct MIME strings for all 5 canonical extensions", () => {
    expect(AVATAR_MIME_FROM_EXT.webp).toBe("image/webp");
    expect(AVATAR_MIME_FROM_EXT.png).toBe("image/png");
    expect(AVATAR_MIME_FROM_EXT.jpg).toBe("image/jpeg");
    expect(AVATAR_MIME_FROM_EXT.gif).toBe("image/gif");
    expect(AVATAR_MIME_FROM_EXT.svg).toBe("image/svg+xml");
  });
});

// Reference IDMEDIT_MAX_AVATAR_BYTES to keep the import used (defensive
// upper-bound behavior is documented in the impl comments; not a functional
// test case because a 5MB sibling file mock would slow the suite unnecessarily).
describe("IDMEDIT_MAX_AVATAR_BYTES", () => {
  it("is exposed and equals 5_000_000", () => {
    expect(IDMEDIT_MAX_AVATAR_BYTES).toBe(5_000_000);
  });
});
