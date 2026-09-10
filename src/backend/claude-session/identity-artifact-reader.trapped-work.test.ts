// ─── identity-artifact-reader — readIdentityTrappedWork (Phase 104 Plan 01) ─
//
// LOCAL + REMOTE branch coverage for the trapped-work detector. Byte-shape
// mirror of the count-bounties.test.ts file — same imports, same
// tmpdir-fixture strategy for LOCAL, same mocked-conn strategy for REMOTE.
//
// Detector semantics (from CONTEXT.md D-01):
//   Eligible project: git repo with at least one remote configured.
//   Eligible trapped state (any of):
//     - Dirty tracked files (staged or unstaged).
//     - Local commits not reachable from any remote (any branch, upstream or not).
//     - Stashes on the reflog.
//   Ignored: untracked files, nested repos (outermost-only), remote-less repos.
//   Silent-fail (D-06): workspace/ absent OR empty → {hasTrappedWork:false}.
//   No role lookup (D-09): trapped-work is workspace-scoped, not role-scoped.
//   Path (D-02): ~/fleet/identities/<key>/workspace/ hard-coded, no override.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { execFileSync } from "child_process";

// Mock the tmux-helper execCommand so the REMOTE branch's execWithTimeout
// wrapper can be driven from tests without a real SSH client (mirror:
// claude-session-server.aside.test.ts's execCommand mock pattern). The mock
// is inert for LOCAL-branch tests (they route through fs, never touching
// execCommand).
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from "../ssh/tmux-helper.js";
import { readIdentityTrappedWork } from "./identity-artifact-reader.js";

// A fake $HOME so the LOCAL branch's expanded ~/fleet/identities/<key>/workspace
// resolves under a tmp dir we control (mirrors count-bounties.test.ts's
// IDENTITIES_HOST_DIR / ROLES_HOST_DIR override, but the trapped-work reader
// keys off os.homedir() directly — we spy on it below).
let fakeHome: string;
let bareRemoteRoot: string;
const KEY = "tina";

/** Init a git repo at `repoDir` with user config; returns nothing. */
function gitInit(repoDir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main", repoDir]);
  execFileSync("git", ["-C", repoDir, "config", "user.email", "t@example.com"]);
  execFileSync("git", ["-C", repoDir, "config", "user.name", "Tester"]);
  execFileSync("git", ["-C", repoDir, "config", "commit.gpgsign", "false"]);
}

/** Init a bare repo at `bareDir` so it can act as `file:///` origin. */
function gitInitBare(bareDir: string): void {
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", bareDir]);
}

/** Commit a single file to `repoDir`; returns the commit sha (short). */
function gitCommitFile(
  repoDir: string,
  filename: string,
  contents: string,
  message: string,
): void {
  const fp = path.join(repoDir, filename);
  execFileSync("bash", ["-c", `mkdir -p "$(dirname "${fp}")" && printf %s ${JSON.stringify(contents)} > "${fp}"`]);
  execFileSync("git", ["-C", repoDir, "add", filename]);
  execFileSync("git", ["-C", repoDir, "commit", "-q", "-m", message]);
}

/** Build a workspace dir at fakeHome/fleet/identities/<key>/workspace. */
async function ensureWorkspace(key: string): Promise<string> {
  const ws = path.join(fakeHome, "fleet", "identities", key, "workspace");
  await fs.mkdir(ws, { recursive: true });
  return ws;
}

beforeEach(async () => {
  fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "tw-home-"));
  bareRemoteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tw-bare-"));
  vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(fakeHome, { recursive: true, force: true });
  await fs.rm(bareRemoteRoot, { recursive: true, force: true });
});

describe("readIdentityTrappedWork — LOCAL branch", () => {
  // Test 1
  it("returns {hasTrappedWork:false} when workspace/ is absent (no fleet dir)", async () => {
    // No fleet dir created — silent-fail (D-06).
    const result = await readIdentityTrappedWork(null, KEY);
    expect(result).toEqual({ hasTrappedWork: false });
  });

  // Test 2
  it("returns {hasTrappedWork:false} when workspace/ exists but is empty", async () => {
    await ensureWorkspace(KEY);
    const result = await readIdentityTrappedWork(null, KEY);
    expect(result).toEqual({ hasTrappedWork: false });
  });

  // Test 3
  it("returns {hasTrappedWork:false} for a clean repo with a remote (all commits pushed)", async () => {
    const ws = await ensureWorkspace(KEY);
    const repo = path.join(ws, "foo");
    await fs.mkdir(repo, { recursive: true });
    const bare = path.join(bareRemoteRoot, "foo.git");
    gitInitBare(bare);
    gitInit(repo);
    gitCommitFile(repo, "README.md", "hello\n", "initial");
    execFileSync("git", ["-C", repo, "remote", "add", "origin", `file://${bare}`]);
    execFileSync("git", ["-C", repo, "push", "-q", "origin", "main"]);

    const result = await readIdentityTrappedWork(null, KEY);
    expect(result).toEqual({ hasTrappedWork: false });
  });

  // Test 4
  it("returns {hasTrappedWork:true} for a repo with dirty tracked file", async () => {
    const ws = await ensureWorkspace(KEY);
    const repo = path.join(ws, "foo");
    await fs.mkdir(repo, { recursive: true });
    const bare = path.join(bareRemoteRoot, "foo.git");
    gitInitBare(bare);
    gitInit(repo);
    gitCommitFile(repo, "README.md", "hello\n", "initial");
    execFileSync("git", ["-C", repo, "remote", "add", "origin", `file://${bare}`]);
    execFileSync("git", ["-C", repo, "push", "-q", "origin", "main"]);
    // Modify tracked file — should be trapped.
    await fs.writeFile(path.join(repo, "README.md"), "modified\n", "utf-8");

    const result = await readIdentityTrappedWork(null, KEY);
    expect(result).toEqual({ hasTrappedWork: true });
  });

  // Test 5
  it("returns {hasTrappedWork:true} for a repo with local-only commits (not on any remote)", async () => {
    const ws = await ensureWorkspace(KEY);
    const repo = path.join(ws, "foo");
    await fs.mkdir(repo, { recursive: true });
    const bare = path.join(bareRemoteRoot, "foo.git");
    gitInitBare(bare);
    gitInit(repo);
    gitCommitFile(repo, "README.md", "hello\n", "initial");
    execFileSync("git", ["-C", repo, "remote", "add", "origin", `file://${bare}`]);
    execFileSync("git", ["-C", repo, "push", "-q", "origin", "main"]);
    // New commit not on remote.
    gitCommitFile(repo, "second.md", "second\n", "not pushed");

    const result = await readIdentityTrappedWork(null, KEY);
    expect(result).toEqual({ hasTrappedWork: true });
  });

  // Test 6
  it("returns {hasTrappedWork:true} for a repo with a stash", async () => {
    const ws = await ensureWorkspace(KEY);
    const repo = path.join(ws, "foo");
    await fs.mkdir(repo, { recursive: true });
    const bare = path.join(bareRemoteRoot, "foo.git");
    gitInitBare(bare);
    gitInit(repo);
    gitCommitFile(repo, "README.md", "hello\n", "initial");
    execFileSync("git", ["-C", repo, "remote", "add", "origin", `file://${bare}`]);
    execFileSync("git", ["-C", repo, "push", "-q", "origin", "main"]);
    // Modify + stash — stash entry exists, working tree clean.
    await fs.writeFile(path.join(repo, "README.md"), "modified\n", "utf-8");
    execFileSync("git", ["-C", repo, "stash", "push", "-q", "-m", "wip"]);

    const result = await readIdentityTrappedWork(null, KEY);
    expect(result).toEqual({ hasTrappedWork: true });
  });

  // Test 7 — remote-less repo is IGNORED (silent-fail per D-01)
  it("returns {hasTrappedWork:false} for a dirty repo without any remote (SILENT-FAIL, D-01 ignore)", async () => {
    const ws = await ensureWorkspace(KEY);
    const repo = path.join(ws, "bar");
    await fs.mkdir(repo, { recursive: true });
    gitInit(repo);
    gitCommitFile(repo, "README.md", "hello\n", "initial");
    // NO remote add, but dirty tracked file — should be ignored.
    await fs.writeFile(path.join(repo, "README.md"), "modified\n", "utf-8");

    const result = await readIdentityTrappedWork(null, KEY);
    expect(result).toEqual({ hasTrappedWork: false });
  });

  // Test 8 — untracked-only repo is IGNORED
  it("returns {hasTrappedWork:false} for a repo with only untracked files (D-01 ignore)", async () => {
    const ws = await ensureWorkspace(KEY);
    const repo = path.join(ws, "baz");
    await fs.mkdir(repo, { recursive: true });
    const bare = path.join(bareRemoteRoot, "baz.git");
    gitInitBare(bare);
    gitInit(repo);
    gitCommitFile(repo, "README.md", "hello\n", "initial");
    execFileSync("git", ["-C", repo, "remote", "add", "origin", `file://${bare}`]);
    execFileSync("git", ["-C", repo, "push", "-q", "origin", "main"]);
    // Untracked file only — ignored per D-01.
    await fs.writeFile(path.join(repo, "notes.md"), "scratch\n", "utf-8");

    const result = await readIdentityTrappedWork(null, KEY);
    expect(result).toEqual({ hasTrappedWork: false });
  });

  // Test 9 — outermost-only rule: nested dirty repo inside a clean outer repo is skipped
  it("returns {hasTrappedWork:false} when outer repo is clean and nested inner repo is dirty (outermost-only)", async () => {
    const ws = await ensureWorkspace(KEY);
    const outer = path.join(ws, "outer");
    await fs.mkdir(outer, { recursive: true });
    const outerBare = path.join(bareRemoteRoot, "outer.git");
    gitInitBare(outerBare);
    gitInit(outer);
    gitCommitFile(outer, "README.md", "outer\n", "outer init");
    execFileSync("git", ["-C", outer, "remote", "add", "origin", `file://${outerBare}`]);
    execFileSync("git", ["-C", outer, "push", "-q", "origin", "main"]);

    // Nested repo inside outer, dirty + with remote. Only outermost should be probed.
    const inner = path.join(outer, "vendored");
    await fs.mkdir(inner, { recursive: true });
    const innerBare = path.join(bareRemoteRoot, "inner.git");
    gitInitBare(innerBare);
    gitInit(inner);
    gitCommitFile(inner, "x.md", "x\n", "inner init");
    execFileSync("git", ["-C", inner, "remote", "add", "origin", `file://${innerBare}`]);
    execFileSync("git", ["-C", inner, "push", "-q", "origin", "main"]);
    await fs.writeFile(path.join(inner, "x.md"), "dirty\n", "utf-8");

    const result = await readIdentityTrappedWork(null, KEY);
    // Outer is clean; inner is DIRTY but should be ignored (outermost-only rule).
    // Note: outer.status will show "vendored/" as modified because inner is a subdir
    // with changes not part of outer's index. Because we run `git status --porcelain`
    // on outer, it would appear as modified — but with `-uno`/subdirectory rules,
    // git sees the nested .git and reports it as an untracked entry (submodule-ish).
    // Verify our implementation correctly treats this as false.
    expect(result).toEqual({ hasTrappedWork: false });
  });

  // Test 10 — depth-limit boundary
  it("finds a repo at depth MAX_DEPTH=3 (dirty→true) and does NOT find one at depth 4", async () => {
    // A: repo at depth 3 (workspace/a/b/c/.git), dirty + with remote → true
    const ws = await ensureWorkspace(KEY);
    const depth3 = path.join(ws, "a", "b", "c");
    await fs.mkdir(depth3, { recursive: true });
    const bare3 = path.join(bareRemoteRoot, "d3.git");
    gitInitBare(bare3);
    gitInit(depth3);
    gitCommitFile(depth3, "README.md", "hello\n", "initial");
    execFileSync("git", ["-C", depth3, "remote", "add", "origin", `file://${bare3}`]);
    execFileSync("git", ["-C", depth3, "push", "-q", "origin", "main"]);
    await fs.writeFile(path.join(depth3, "README.md"), "dirty\n", "utf-8");

    let result = await readIdentityTrappedWork(null, KEY);
    expect(result).toEqual({ hasTrappedWork: true });

    // Now wipe fakeHome & rebuild with the repo at depth 4 only — expect false.
    await fs.rm(fakeHome, { recursive: true, force: true });
    fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "tw-home-"));
    vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
    const ws2 = await ensureWorkspace(KEY);
    const depth4 = path.join(ws2, "a", "b", "c", "d");
    await fs.mkdir(depth4, { recursive: true });
    const bare4 = path.join(bareRemoteRoot, "d4.git");
    gitInitBare(bare4);
    gitInit(depth4);
    gitCommitFile(depth4, "README.md", "hello\n", "initial");
    execFileSync("git", ["-C", depth4, "remote", "add", "origin", `file://${bare4}`]);
    execFileSync("git", ["-C", depth4, "push", "-q", "origin", "main"]);
    await fs.writeFile(path.join(depth4, "README.md"), "dirty\n", "utf-8");

    result = await readIdentityTrappedWork(null, KEY);
    expect(result).toEqual({ hasTrappedWork: false });
  });

  // Test 11 — malformed .git swallowed, sibling dirty repo still surfaces
  it("swallows a malformed .git entry and still surfaces a sibling eligible+dirty repo", async () => {
    const ws = await ensureWorkspace(KEY);
    // Broken entry: .git is a file with garbage (not a dir, not a valid gitfile).
    const broken = path.join(ws, "broken");
    await fs.mkdir(broken, { recursive: true });
    await fs.writeFile(path.join(broken, ".git"), "not-a-real-git", "utf-8");
    // Sibling: eligible + dirty.
    const good = path.join(ws, "good");
    await fs.mkdir(good, { recursive: true });
    const bare = path.join(bareRemoteRoot, "good.git");
    gitInitBare(bare);
    gitInit(good);
    gitCommitFile(good, "README.md", "hello\n", "initial");
    execFileSync("git", ["-C", good, "remote", "add", "origin", `file://${bare}`]);
    execFileSync("git", ["-C", good, "push", "-q", "origin", "main"]);
    await fs.writeFile(path.join(good, "README.md"), "dirty\n", "utf-8");

    const result = await readIdentityTrappedWork(null, KEY);
    expect(result).toEqual({ hasTrappedWork: true });
  });

  // Test 12 — path-traversal identityKey rejected
  it("rejects an invalid identity key (defense against path traversal)", async () => {
    await expect(readIdentityTrappedWork(null, "../etc")).rejects.toThrow(
      /invalid identityKey/,
    );
  });

  // Test 13 — D-09 no resolveRoleForIdentity call on LOCAL branch
  it("does NOT read the identity .md file (D-09 skip role lookup) on LOCAL branch", async () => {
    // Spy on fs.readFile — no <key>.md should ever be read.
    const readFileSpy = vi.spyOn(fs, "readFile");
    const ws = await ensureWorkspace(KEY);
    const repo = path.join(ws, "foo");
    await fs.mkdir(repo, { recursive: true });
    const bare = path.join(bareRemoteRoot, "foo.git");
    gitInitBare(bare);
    gitInit(repo);
    gitCommitFile(repo, "README.md", "hello\n", "initial");
    execFileSync("git", ["-C", repo, "remote", "add", "origin", `file://${bare}`]);
    execFileSync("git", ["-C", repo, "push", "-q", "origin", "main"]);
    readFileSpy.mockClear();

    await readIdentityTrappedWork(null, KEY);

    // Assert no <key>.md was read.
    const identityMdReads = readFileSpy.mock.calls.filter((args) =>
      String(args[0]).includes(`${KEY}.md`),
    );
    expect(identityMdReads).toHaveLength(0);
  });
});

describe("readIdentityTrappedWork — REMOTE branch", () => {
  beforeEach(() => {
    vi.mocked(execCommand).mockReset();
  });

  // Test 14 — happy path: python3 command, expected path, {"hasTrappedWork":true}
  it("sends python3 command with hard-coded fleet/identities/<key>/workspace path and returns parsed answer", async () => {
    vi.mocked(execCommand).mockResolvedValueOnce('{"hasTrappedWork":true}\n');
    const fakeConn = {} as unknown as Parameters<
      typeof readIdentityTrappedWork
    >[0];

    const result = await readIdentityTrappedWork(fakeConn, "tina");

    expect(result).toEqual({ hasTrappedWork: true });
    expect(execCommand).toHaveBeenCalledTimes(1);
    const cmdArg = vi.mocked(execCommand).mock.calls[0][1] as string;
    expect(cmdArg).toContain("python3 -c");
    expect(cmdArg).toContain('"$HOME/fleet/identities/tina/workspace"');
  });

  // Test 15 — malformed payload (not JSON)
  it("throws malformed-payload on non-JSON stdout", async () => {
    vi.mocked(execCommand).mockResolvedValueOnce("not-json\n");
    const fakeConn = {} as unknown as Parameters<
      typeof readIdentityTrappedWork
    >[0];

    await expect(readIdentityTrappedWork(fakeConn, "tina")).rejects.toThrow(
      /malformed payload/,
    );
  });

  // Test 16 — malformed shape (JSON but wrong key)
  it("throws malformed-payload on JSON with wrong shape", async () => {
    vi.mocked(execCommand).mockResolvedValueOnce('{"other":1}\n');
    const fakeConn = {} as unknown as Parameters<
      typeof readIdentityTrappedWork
    >[0];

    await expect(readIdentityTrappedWork(fakeConn, "tina")).rejects.toThrow(
      /malformed payload/,
    );
  });

  // Test 17 — D-09: conn.exec called EXACTLY ONCE (no role-file round-trip)
  it("calls execCommand EXACTLY ONCE on REMOTE branch (D-09 no role-file round-trip)", async () => {
    vi.mocked(execCommand).mockResolvedValueOnce('{"hasTrappedWork":false}\n');
    const fakeConn = {} as unknown as Parameters<
      typeof readIdentityTrappedWork
    >[0];

    await readIdentityTrappedWork(fakeConn, "tina");

    expect(execCommand).toHaveBeenCalledTimes(1);
  });
});
