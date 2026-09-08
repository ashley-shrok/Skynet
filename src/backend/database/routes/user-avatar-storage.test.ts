/**
 * Phase 85 — user-avatar-storage.test.ts
 *
 * Unit tests for the shared user-avatar-storage helper module.
 * Tests are intentionally isolated to pure function calls (no HTTP server)
 * because the helper module has no Express dependency beyond type signatures.
 *
 * NOTE ON MODULE-LEVEL DATA_DIR CAPTURE:
 * user-avatar-storage.ts captures DATA_DIR at module-load time via:
 *   const DATA_DIR = process.env.DATA_DIR || "./db/data";
 * Tests that need a controlled DATA_DIR MUST:
 *   1. Set process.env.DATA_DIR to a tmp dir BEFORE importing the module.
 *   2. Use vi.resetModules() to bust the module cache so the next import()
 *      picks up the new env value.
 * The file-I/O describe block (tests 3-8) follows this pattern via dynamic
 * import inside beforeEach. Tests 1, 2, and 9 use the multer instance and
 * error handler which are module-level values; they don't touch disk at all
 * so they don't need the tmpdir dance.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// describe block 1: validation + error handling (tests 1, 2, 9)
// No tmpdir needed — these tests don't touch the filesystem.
// ---------------------------------------------------------------------------

describe("validation + error handling", () => {
  // Test 1: mime whitelist — rejects image/gif
  it("userAvatarUpload rejects image/gif via fileFilter", async () => {
    // Import the module here to pick up whatever DATA_DIR is set (doesn't matter
    // for this test — no filesystem I/O).
    const { userAvatarUpload } = await import("./user-avatar-storage.js");
    const fakeFile = { mimetype: "image/gif" } as Express.Multer.File;

    await new Promise<void>((resolve) => {
      userAvatarUpload.fileFilter!(null as any, fakeFile, (err, accepted) => {
        expect(err).toBeTruthy();
        expect((err as Error).message).toContain("PNG, JPEG, or WebP");
        expect(accepted).toBeUndefined();
        resolve();
      });
    });
  });

  // Test 2: size cap — fileSize limit is exactly 5 MB
  it("userAvatarUpload has fileSize limit of 5 MB", async () => {
    const { userAvatarUpload } = await import("./user-avatar-storage.js");
    expect((userAvatarUpload as any).limits?.fileSize).toBe(5 * 1024 * 1024);
  });

  // Test 9: error handler routing — four branches
  it("userAvatarMulterErrorHandler routes to correct status codes", async () => {
    const { userAvatarMulterErrorHandler } = await import(
      "./user-avatar-storage.js"
    );

    // Helper: create a mock res with .status(N).json(body) chaining
    function makeRes(): {
      capturedStatus: number | null;
      capturedBody: unknown;
      res: {
        status: (n: number) => { json: (b: unknown) => void };
      };
    } {
      const state: { capturedStatus: number | null; capturedBody: unknown } = {
        capturedStatus: null,
        capturedBody: null,
      };
      const res = {
        status: (n: number) => {
          state.capturedStatus = n;
          return {
            json: (b: unknown) => {
              state.capturedBody = b;
            },
          };
        },
      };
      return { ...state, res };
    }

    // Branch 1: LIMIT_FILE_SIZE → 413
    {
      const { capturedStatus, capturedBody, res } = makeRes();
      const state = { capturedStatus, capturedBody };
      const localRes = { ...res };
      let s: number | null = null;
      let b: unknown = null;
      userAvatarMulterErrorHandler(
        Object.assign(new Error("file too large"), { code: "LIMIT_FILE_SIZE" }),
        null as any,
        {
          status: (n: number) => {
            s = n;
            return { json: (body: unknown) => { b = body; } };
          },
        } as any,
        null as any,
      );
      expect(s).toBe(413);
      expect((b as { error: string }).error).toBe("file too large (max 5 MB)");
    }

    // Branch 2: LIMIT_UNEXPECTED_FILE → 400 "missing avatar field"
    {
      let s: number | null = null;
      let b: unknown = null;
      userAvatarMulterErrorHandler(
        Object.assign(new Error("unexpected field"), {
          code: "LIMIT_UNEXPECTED_FILE",
        }),
        null as any,
        {
          status: (n: number) => {
            s = n;
            return { json: (body: unknown) => { b = body; } };
          },
        } as any,
        null as any,
      );
      expect(s).toBe(400);
      expect((b as { error: string }).error).toBe("missing avatar field");
    }

    // Branch 3: mime-mismatch Error → 400 with the error message
    {
      let s: number | null = null;
      let b: unknown = null;
      userAvatarMulterErrorHandler(
        new Error("Avatar must be PNG, JPEG, or WebP"),
        null as any,
        {
          status: (n: number) => {
            s = n;
            return { json: (body: unknown) => { b = body; } };
          },
        } as any,
        null as any,
      );
      expect(s).toBe(400);
      expect((b as { error: string }).error).toBe(
        "Avatar must be PNG, JPEG, or WebP",
      );
    }

    // Branch 4: other errors → 500
    {
      let s: number | null = null;
      let b: unknown = null;
      userAvatarMulterErrorHandler(
        new Error("something else entirely"),
        null as any,
        {
          status: (n: number) => {
            s = n;
            return { json: (body: unknown) => { b = body; } };
          },
        } as any,
        null as any,
      );
      expect(s).toBe(500);
      expect((b as { error: string }).error).toBe("upload failed");
    }
  });
});

// ---------------------------------------------------------------------------
// describe block 2: file I/O (tests 3-8)
// Uses a fresh tmpdir + vi.resetModules() per test so DATA_DIR is controlled.
// ---------------------------------------------------------------------------

describe("file I/O", () => {
  let tmpDir: string;
  let originalDataDir: string | undefined;
  let writeUserAvatar: (
    userId: string,
    mime: string,
    bytes: Buffer,
  ) => Promise<string>;
  let unlinkUserAvatar: (
    filenameOrNull: string | null | undefined,
  ) => Promise<void>;
  let readUserAvatar: (
    filename: string,
  ) => Promise<{ bytes: Buffer; mime: string }>;
  let USER_AVATARS_DIR: string;

  beforeEach(async () => {
    // Create a fresh tmp dir and point DATA_DIR at it.
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "phase-85-avatar-"));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;

    // Bust the module cache so the next import picks up the new DATA_DIR.
    vi.resetModules();
    const mod = await import("./user-avatar-storage.js");
    writeUserAvatar = mod.writeUserAvatar;
    unlinkUserAvatar = mod.unlinkUserAvatar;
    readUserAvatar = mod.readUserAvatar;
    USER_AVATARS_DIR = mod.USER_AVATARS_DIR;
  });

  afterEach(async () => {
    // Restore original DATA_DIR and clean up the tmp dir.
    if (originalDataDir !== undefined) {
      process.env.DATA_DIR = originalDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Test 3: write round-trip — file created at expected path, returns filename
  it("writeUserAvatar creates file at USER_AVATARS_DIR/${userId}.${ext} and returns filename", async () => {
    const fakeBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const filename = await writeUserAvatar("user123", "image/png", fakeBytes);
    expect(filename).toBe("user123.png");
    const onDisk = await fs.readFile(
      path.join(USER_AVATARS_DIR, "user123.png"),
    );
    expect(onDisk.equals(fakeBytes)).toBe(true);
  });

  // Test 4: ext derivation — .jpg for image/jpeg, .webp for image/webp
  it("writeUserAvatar produces .jpg for image/jpeg, .webp for image/webp", async () => {
    const j = await writeUserAvatar("u1", "image/jpeg", Buffer.from("x"));
    expect(j).toBe("u1.jpg");
    const w = await writeUserAvatar("u2", "image/webp", Buffer.from("x"));
    expect(w).toBe("u2.webp");
  });

  // Test 5: ENOENT-tolerant unlink — three sub-cases
  it("unlinkUserAvatar is ENOENT-tolerant and removes existing files", async () => {
    // Sub-case 1: null returns without throwing.
    await expect(unlinkUserAvatar(null)).resolves.toBeUndefined();

    // Sub-case 2: nonexistent filename returns without throwing (ENOENT swallowed).
    await expect(unlinkUserAvatar("nonexistent.png")).resolves.toBeUndefined();

    // Sub-case 3: existing file is removed.
    await writeUserAvatar("u3", "image/png", Buffer.from("x"));
    await unlinkUserAvatar("u3.png");
    await expect(
      fs.access(path.join(USER_AVATARS_DIR, "u3.png")),
    ).rejects.toThrow();
  });

  // Test 6: read — returns bytes + derived mime from extension
  it("readUserAvatar returns bytes + derived mime from extension", async () => {
    await writeUserAvatar("u4", "image/png", Buffer.from([1, 2, 3]));
    const result = await readUserAvatar("u4.png");
    expect(result.mime).toBe("image/png");
    expect(result.bytes.equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  // Test 7: ENOENT propagates — serve endpoint must see err.code === "ENOENT"
  it("readUserAvatar propagates ENOENT (does not silently 404)", async () => {
    await expect(readUserAvatar("missing.png")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  // Test 8: unrecognized extension throws (not silently returns application/octet-stream)
  it("readUserAvatar throws on unrecognized extension", async () => {
    // Manually create a file with an unknown extension to simulate disk corruption.
    await fs.mkdir(USER_AVATARS_DIR, { recursive: true });
    await fs.writeFile(
      path.join(USER_AVATARS_DIR, "corrupt.bin"),
      Buffer.from("x"),
    );
    await expect(readUserAvatar("corrupt.bin")).rejects.toThrow(
      /unrecognized avatar file extension/,
    );
  });

  // M1 — path-traversal defense on readUserAvatar
  it("readUserAvatar throws on path-traversal filename (../../etc/passwd.png)", async () => {
    await expect(readUserAvatar("../../etc/passwd.png")).rejects.toThrow(
      /disallowed characters|escapes the avatar directory/,
    );
  });

  // M1 — path-traversal defense on unlinkUserAvatar
  it("unlinkUserAvatar throws on path-traversal filename (../../etc/passwd)", async () => {
    await expect(unlinkUserAvatar("../../etc/passwd")).rejects.toThrow(
      /disallowed characters|escapes the avatar directory/,
    );
  });

  // Also tested as part of test 3, but explicitly: mkdir is called even if
  // USER_AVATARS_DIR doesn't exist yet.
  it("writeUserAvatar succeeds even when USER_AVATARS_DIR does not exist yet (mkdir recursive)", async () => {
    // USER_AVATARS_DIR is ${tmpDir}/user-avatars — it doesn't exist yet (tmpDir
    // was created fresh in beforeEach, no user-avatars subdir).
    const filename = await writeUserAvatar(
      "newuser",
      "image/webp",
      Buffer.from("webp-bytes"),
    );
    expect(filename).toBe("newuser.webp");
    const onDisk = await fs.readFile(path.join(USER_AVATARS_DIR, filename));
    expect(onDisk.equals(Buffer.from("webp-bytes"))).toBe(true);
  });
});
