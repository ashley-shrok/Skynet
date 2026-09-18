// ─── identity-artifact-reader — readAppIconFile + APP_SLUG_RE (Phase 119 Plan 05 Task 1) ──
//
// Phase 119 D-06: adds a new SSH-backed file reader that mirrors readAvatarSiblingFile
// but reads exactly one filename (`icon.webp`) from ~/fleet/apps/<slug>/ — no
// multi-extension cascade (Pitfall 5 lock; shape 1 §80-82 locks the disk filename).
//
// Test map (aligned with PLAN.md Task 1 <behavior>):
//   T1  (regex):  APP_SLUG_RE accepts kebab-case; rejects uppercase, underscores, path chars, >64.
//   T2  (guard):  readAppIconFile throws on slug that fails APP_SLUG_RE (defence-in-depth).
//   T3  (LOCAL):  returns {bytes, mime:"image/webp"} for existing ~/fleet/apps/<slug>/icon.webp.
//   T4  (LOCAL):  returns null when the icon file is absent (ENOENT).
//   T5  (LOCAL):  throws when the icon file exceeds IDMEDIT_MAX_AVATAR_BYTES.
//   T6  (REMOTE): probes with `ls "$HOME/fleet/apps/<slug>/icon.webp"`; returns null when the
//                 ls probe returns empty (file absent).
//   T7  (single-extension lock): source of readAppIconFile MUST NOT reference png/jpg/jpeg/gif/svg.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";
import type { Client as SSHClientType } from "ssh2";

// Mock tmux-helper.execCommand BEFORE importing the module under test.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from "../ssh/tmux-helper.js";
import {
  readAppIconFile,
  APP_SLUG_RE,
  IDMEDIT_MAX_AVATAR_BYTES,
} from "./identity-artifact-reader.js";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// T1 — APP_SLUG_RE shape
// ──────────────────────────────────────────────────────────────────────

describe("APP_SLUG_RE — kebab-case shape (Phase 119 D-06 shell-safety gate)", () => {
  it("T1a: accepts lowercase alphanumerics and hyphens (1-64)", () => {
    expect(APP_SLUG_RE.test("scratch-test")).toBe(true);
    expect(APP_SLUG_RE.test("a")).toBe(true);
    expect(APP_SLUG_RE.test("app-with-hyphens-123")).toBe(true);
    expect(APP_SLUG_RE.test("a".repeat(64))).toBe(true);
  });
  it("T1b: rejects uppercase", () => {
    expect(APP_SLUG_RE.test("Scratch-Test")).toBe(false);
    expect(APP_SLUG_RE.test("APP")).toBe(false);
  });
  it("T1c: rejects underscore (shape 1 kebab-case-only)", () => {
    expect(APP_SLUG_RE.test("scratch_test")).toBe(false);
  });
  it("T1d: rejects path characters and shell metacharacters", () => {
    expect(APP_SLUG_RE.test("../etc/passwd")).toBe(false);
    expect(APP_SLUG_RE.test("scratch/test")).toBe(false);
    expect(APP_SLUG_RE.test("scratch.test")).toBe(false);
    expect(APP_SLUG_RE.test("scratch;test")).toBe(false);
    expect(APP_SLUG_RE.test("scratch$test")).toBe(false);
    expect(APP_SLUG_RE.test("scratch`test")).toBe(false);
    expect(APP_SLUG_RE.test("scratch test")).toBe(false);
  });
  it("T1e: rejects empty and >64 length", () => {
    expect(APP_SLUG_RE.test("")).toBe(false);
    expect(APP_SLUG_RE.test("a".repeat(65))).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// T2 — defensive slug gate at the helper (defence-in-depth)
// ──────────────────────────────────────────────────────────────────────

describe("readAppIconFile — defensive slug validation", () => {
  it("T2: throws immediately on invalid slug (both LOCAL and REMOTE entrypoints)", async () => {
    await expect(readAppIconFile(null, "BAD/SLUG")).rejects.toThrow(/invalid slug/i);
    // Even with a fake conn, invalid slug must throw before any exec.
    const fakeConn = {} as unknown as SSHClientType;
    await expect(readAppIconFile(fakeConn, "../etc/passwd")).rejects.toThrow(/invalid slug/i);
    expect(execCommand).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────
// T3, T4, T5 — LOCAL branch (conn=null)
// ──────────────────────────────────────────────────────────────────────

describe("readAppIconFile — LOCAL branch (conn=null)", () => {
  let fakeHome: string;
  let originalHome: string | undefined;
  const SLUG = "scratch-test";

  beforeEach(async () => {
    fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "119-05-apps-"));
    originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await fs.rm(fakeHome, { recursive: true, force: true });
  });

  it("T3: returns {bytes, mime:'image/webp'} for an existing icon.webp", async () => {
    // Prefer the same HOME-relative path readAppIconFile uses:
    //   ~/fleet/apps/<slug>/icon.webp
    const appsRoot =
      process.env.HOME === fakeHome
        ? path.join(fakeHome, "fleet", "apps")
        : path.join(os.homedir(), "fleet", "apps");
    const appDir = path.join(appsRoot, SLUG);
    await fs.mkdir(appDir, { recursive: true });
    const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x57, 0x45, 0x42, 0x50]); // fake WEBP prelude
    await fs.writeFile(path.join(appDir, "icon.webp"), bytes);

    const result = await readAppIconFile(null, SLUG);
    expect(result).not.toBeNull();
    expect(result!.mime).toBe("image/webp");
    expect(result!.bytes.equals(bytes)).toBe(true);
  });

  it("T4: returns null when the icon file is absent (ENOENT)", async () => {
    const result = await readAppIconFile(null, "no-such-app");
    expect(result).toBeNull();
  });

  it("T5: throws when the icon file exceeds IDMEDIT_MAX_AVATAR_BYTES", async () => {
    const appsRoot = path.join(fakeHome, "fleet", "apps");
    const appDir = path.join(appsRoot, "toobig-app");
    await fs.mkdir(appDir, { recursive: true });
    const oversized = Buffer.alloc(IDMEDIT_MAX_AVATAR_BYTES + 1, 0x00);
    await fs.writeFile(path.join(appDir, "icon.webp"), oversized);
    await expect(readAppIconFile(null, "toobig-app")).rejects.toThrow(/exceeds cap/i);
  });
});

// ──────────────────────────────────────────────────────────────────────
// T6 — REMOTE branch (conn is SSHClientType)
// ──────────────────────────────────────────────────────────────────────

describe("readAppIconFile — REMOTE branch (conn is SSHClientType)", () => {
  it("T6: returns null when the remote ls probe reports the file absent", async () => {
    const fakeConn = { __fake: "ssh-conn" } as unknown as SSHClientType;
    const SLUG = "no-such-app";
    // execCommand is called at least twice: `echo $HOME` and the ls probe.
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return Promise.resolve("/home/ubuntu\n");
        if (cmd.startsWith("ls ")) return Promise.resolve(""); // absent
        return Promise.resolve("");
      },
    );
    const result = await readAppIconFile(fakeConn, SLUG);
    expect(result).toBeNull();
    // Assert the ls probe targeted exactly icon.webp (Pitfall 5 lock at runtime).
    const calls = (execCommand as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<
      [unknown, string]
    >;
    const lsCalls = calls.filter(([, cmd]) => cmd.startsWith("ls "));
    expect(lsCalls.length).toBeGreaterThanOrEqual(1);
    expect(lsCalls[0][1]).toContain(`/fleet/apps/${SLUG}/icon.webp`);
    // Must not probe any other extension.
    for (const [, cmd] of lsCalls) {
      expect(cmd).not.toMatch(/icon\.(png|jpg|jpeg|gif|svg)/i);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// T7 — source-level Pitfall 5 lock (no multi-extension cascade)
// ──────────────────────────────────────────────────────────────────────

describe("readAppIconFile — source-level Pitfall 5 lock", () => {
  it("T7: source of readAppIconFile does not reference png/jpg/jpeg/gif/svg", async () => {
    const src = await fs.readFile(
      path.join(process.cwd(), "src/backend/claude-session/identity-artifact-reader.ts"),
      "utf-8",
    );
    // Extract the readAppIconFile function body.
    const startIdx = src.indexOf("export async function readAppIconFile");
    expect(startIdx).toBeGreaterThan(0);
    // Find the closing brace by matching indentation — use the next top-level `\nexport ` or
    // `\n// ---` marker (safe with the file's existing sectioning).
    const rest = src.slice(startIdx);
    const nextTopLevel = rest.slice(1).search(/\nexport \b|\n\/\/ ---/);
    const body = nextTopLevel > 0 ? rest.slice(0, nextTopLevel + 1) : rest;
    expect(body).not.toMatch(/icon\.png/i);
    expect(body).not.toMatch(/icon\.jpg/i);
    expect(body).not.toMatch(/icon\.jpeg/i);
    expect(body).not.toMatch(/icon\.gif/i);
    expect(body).not.toMatch(/icon\.svg/i);
  });
});
