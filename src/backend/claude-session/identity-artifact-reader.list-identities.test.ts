// ─── identity-artifact-reader — listIdentityKeysOnHost (Phase 68 Plan 02 Task 1) ─
//
// Phase 68 disk-fanout enumeration primitive. Verifies the new exported
// listIdentityKeysOnHost() function that lists identity folder names on a host
// (LOCAL bind-mount or REMOTE SSH), used by the GET /identities fanout handler.
//
// TDD test map (tests 1-4, per plan Task 1 <behavior>):
//   1. LOCAL happy path: readdir returns mixed entries; BADCAP + .DS_Store filtered out;
//      result is sorted array of valid lowercase keys.
//   2. LOCAL ENOENT: readdir throws ENOENT → returns [].
//   3. REMOTE happy path: execCommand returns multiline stdout; .hidden + BADCAP
//      filtered; empty lines dropped; result sorted.
//   4. REMOTE error propagation: execCommand rejects → listIdentityKeysOnHost
//      REJECTS with the same error (does NOT swallow).
//
// Mock pattern: vi.mock('../ssh/tmux-helper.js') so execCommand can be
// stubbed per-test without touching real SSH. fs mock for LOCAL-branch tests.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client as SSHClientType } from "ssh2";

// Mock tmux-helper BEFORE importing the module under test.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

// Mock fs/promises for LOCAL-branch tests.
vi.mock("fs/promises", () => ({
  default: {
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    rm: vi.fn(),
    mkdtemp: vi.fn(),
    stat: vi.fn(),
    access: vi.fn(),
  },
}));

import { execCommand } from "../ssh/tmux-helper.js";
import fs from "fs/promises";
import { listIdentityKeysOnHost } from "./identity-artifact-reader.js";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// Test 1: LOCAL happy path — Dirent filtering + IDENTITY_KEY_RE filter
// ──────────────────────────────────────────────────────────────────────

describe("listIdentityKeysOnHost — LOCAL branch (conn=null)", () => {
  it("test 1: LOCAL happy path — returns sorted valid keys; filters .DS_Store (non-dir) + BADCAP (uppercase fails IDENTITY_KEY_RE) + tools-dir allowed", async () => {
    // Mixed Dirent entries: some dirs, some not, one uppercase-named
    (fs.readdir as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "tina", isDirectory: () => true },
      { name: "poppy", isDirectory: () => true },
      { name: ".DS_Store", isDirectory: () => false },
      { name: "tools-dir", isDirectory: () => true },
      { name: "BADCAP", isDirectory: () => true }, // fails IDENTITY_KEY_RE (uppercase)
    ]);

    const result = await listIdentityKeysOnHost(null);

    // BADCAP fails /^[a-z0-9_-]{1,64}$/ (uppercase).
    // .DS_Store fails isDirectory() filter.
    // tools-dir passes isDirectory() and IDENTITY_KEY_RE (lowercase, hyphen OK).
    expect(result).toEqual(["poppy", "tina", "tools-dir"]);
  });

  it("test 2: LOCAL ENOENT — readdir throws ENOENT → returns []", async () => {
    const enoentErr = Object.assign(new Error("ENOENT: no such file or directory"), {
      code: "ENOENT",
    });
    (fs.readdir as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(enoentErr);

    const result = await listIdentityKeysOnHost(null);

    expect(result).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Tests 3-4: REMOTE branch (conn !== null)
// ──────────────────────────────────────────────────────────────────────

describe("listIdentityKeysOnHost — REMOTE branch (conn is SSHClientType)", () => {
  it("test 3: REMOTE happy path — stdout with .hidden + BADCAP + empty lines → filtered + sorted", async () => {
    // find -printf '%f\n' stdout: valid keys + dotfile + uppercase + empty lines
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      "tina\npoppy\n\n.hidden\nBADCAP\n",
    );

    const conn = {} as SSHClientType;
    const result = await listIdentityKeysOnHost(conn);

    // .hidden filtered by IDENTITY_KEY_RE (starts with '.').
    // BADCAP filtered by IDENTITY_KEY_RE (has uppercase).
    // empty line stripped before filter.
    expect(result).toEqual(["poppy", "tina"]);
  });

  it("test 4: REMOTE error propagation — execCommand rejects → listIdentityKeysOnHost REJECTS (does not swallow)", async () => {
    const sshErr = new Error("SSH connection lost");
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(sshErr);

    const conn = {} as SSHClientType;

    await expect(listIdentityKeysOnHost(conn)).rejects.toThrow("SSH connection lost");
  });
});
