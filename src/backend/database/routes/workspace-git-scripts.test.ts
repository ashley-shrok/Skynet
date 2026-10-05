// @vitest-environment node
/**
 * Runs the real /workspace/git shell scripts against real git repos in a
 * temp $HOME, then parses the output — exercises the script ↔ parser
 * contract end to end without SSH.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildDiffScript,
  buildHasReposScript,
  buildRemoteCheckScript,
  buildRepoScript,
  buildReposScript,
} from "./workspace-git-routes.js";
import {
  GitScriptError,
  parseHasRepos,
  parseRemoteCheck,
  parseRepoDetail,
  parseRepoList,
} from "./workspace-git-parse.js";
import type { TargetSpec } from "./workspace-routes.js";

const target: TargetSpec = { kind: "identity", identityKey: "alice" };
let home: string;
let ws: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: home,
      GIT_AUTHOR_NAME: "Alice",
      GIT_AUTHOR_EMAIL: "a@example.com",
      GIT_COMMITTER_NAME: "Alice",
      GIT_COMMITTER_EMAIL: "a@example.com",
    },
  });
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function run(script: string): string {
  const r = spawnSync("sh", ["-c", script], {
    encoding: "utf-8",
    env: { PATH: process.env.PATH ?? "", HOME: home },
  });
  return r.stdout;
}

function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
}

beforeAll(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ws-git-")));
  ws = path.join(home, "fleet/identities/alice/workspace");

  // app: two commits, then staged + unstaged + untracked + rename + spaces.
  const app = path.join(ws, "app");
  initRepo(app);
  write(path.join(app, "a.txt"), "one\n");
  write(path.join(app, "old name.txt"), "rename me\n");
  write(path.join(app, "keep.txt"), "keep\n");
  git(app, "add", ".");
  git(app, "commit", "-q", "-m", "first");
  write(path.join(app, "a.txt"), "one\ntwo\n");
  git(app, "commit", "-q", "-am", "second: add two");
  git(app, "remote", "add", "origin", "https://x-access-token:SECRET@github.com/o/app.git");
  git(app, "stash", "list"); // no-op, keeps stash section empty
  write(path.join(app, "a.txt"), "one\ntwo\nthree\n"); // unstaged
  write(path.join(app, "staged.txt"), "staged\n");
  git(app, "add", "staged.txt"); // staged
  git(app, "mv", "old name.txt", "new name.txt"); // renamed (staged)
  write(path.join(app, "new file.txt"), "untracked\n"); // untracked

  // nested/lib: clean, tracks an upstream it is 1 ahead of.
  const upstream = path.join(home, "upstream.git");
  fs.mkdirSync(upstream);
  git(upstream, "init", "-q", "--bare", "-b", "main");
  const lib = path.join(ws, "nested/lib");
  initRepo(lib);
  write(path.join(lib, "x"), "x\n");
  git(lib, "add", ".");
  git(lib, "commit", "-q", "-m", "lib init");
  git(lib, "remote", "add", "origin", upstream);
  git(lib, "push", "-q", "-u", "origin", "main");
  write(path.join(lib, "x"), "x\ny\n");
  git(lib, "commit", "-q", "-am", "lib ahead");

  // empty: initialised, no commits.
  initRepo(path.join(ws, "empty"));

  // Pruned: repos inside node_modules are never listed.
  initRepo(path.join(ws, "web/node_modules/pkg"));

  // Not a repo, and a symlink that escapes the workspace.
  fs.mkdirSync(path.join(ws, "notes"), { recursive: true });
  const outside = path.join(home, "outside");
  initRepo(outside);
  fs.symlinkSync(outside, path.join(ws, "escape"));
});

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("repos script", () => {
  it("lists repos with branch, counts and last commit; prunes node_modules", () => {
    const { repos, truncated } = parseRepoList(run(buildReposScript(target)));
    expect(truncated).toBe(false);
    expect(repos.map((r) => r.path)).toEqual(["app", "empty", "nested/lib"]);

    const app = repos[0];
    expect(app.error).toBeNull();
    expect(app.branch).toBe("main");
    expect(app.staged).toBe(2); // staged.txt + rename
    expect(app.unstaged).toBe(1); // a.txt
    expect(app.untracked).toBe(1);
    expect(app.conflicted).toBe(0);
    expect(app.upstream).toBeNull();
    expect(app.lastCommit?.subject).toBe("second: add two");
    expect(app.lastCommit?.author).toBe("Alice");

    const lib = repos[2];
    expect(lib.upstream).toBe("origin/main");
    expect(lib.ahead).toBe(1);
    expect(lib.behind).toBe(0);

    const empty = repos[1];
    expect(empty.lastCommit).toBeNull();
    expect(empty.branch).toBe("main");
  });

  it("reports not_found when the workspace does not exist", () => {
    expect(() =>
      parseRepoList(run(buildReposScript({ kind: "identity", identityKey: "nobody" }))),
    ).toThrow(new GitScriptError("not_found"));
  });
});

describe("repo script", () => {
  it("returns files, commits and redacted remotes", () => {
    const d = parseRepoDetail(run(buildRepoScript(target, "app")), "app");
    const byPath = Object.fromEntries(d.status.files.map((f) => [f.path, f]));
    expect(byPath["a.txt"]).toMatchObject({ index: ".", worktree: "M", kind: "changed" });
    expect(byPath["staged.txt"]).toMatchObject({ index: "A", worktree: ".", kind: "changed" });
    expect(byPath["new name.txt"]).toMatchObject({ kind: "renamed", origPath: "old name.txt" });
    expect(byPath["new file.txt"]).toMatchObject({ kind: "untracked" });

    expect(d.commits.map((c) => c.subject)).toEqual(["second: add two", "first"]);
    expect(d.commits[0].refs).toContain("HEAD -> main");
    expect(d.commits[1].parents).toEqual([]);
    expect(d.stashes).toEqual([]);
    expect(d.remotes).toEqual([{ name: "origin", url: "https://github.com/o/app.git" }]);
  });

  it("handles a repo with no commits", () => {
    const d = parseRepoDetail(run(buildRepoScript(target, "empty")), "empty");
    expect(d.commits).toEqual([]);
    expect(d.status.oid).toBeNull();
  });

  it("refuses a symlink that leaves the workspace", () => {
    expect(() => parseRepoDetail(run(buildRepoScript(target, "escape")), "escape")).toThrow(
      new GitScriptError("path_traversal"),
    );
  });

  it("refuses a folder that is not a repo", () => {
    expect(() => parseRepoDetail(run(buildRepoScript(target, "notes")), "notes")).toThrow(
      new GitScriptError("not_a_repo"),
    );
  });

  it("does not run shell metacharacters in the repo path", () => {
    const marker = path.join(home, "pwned");
    const out = run(buildRepoScript(target, `x'; touch ${marker}; '`));
    expect(fs.existsSync(marker)).toBe(false);
    expect(() => parseRepoDetail(out, "x")).toThrow(new GitScriptError("not_found"));
  });
});

describe("diff script", () => {
  it("working diff covers unstaged, staged, renamed and untracked changes", () => {
    const patch = run(buildDiffScript(target, "app", { diff: "working" }));
    expect(patch).toContain("diff --git a/a.txt b/a.txt");
    expect(patch).toContain("+three");
    expect(patch).toContain("+staged");
    expect(patch).toContain("rename from old name.txt");
    expect(patch).toContain("+untracked");
  });

  it("working diff in a repo with no commits shows untracked files", () => {
    write(path.join(ws, "empty/hello.txt"), "hi\n");
    const patch = run(buildDiffScript(target, "empty", { diff: "working" }));
    expect(patch).toContain("+hi");
  });

  it("commit diff is against the first parent, or empty tree for a root commit", () => {
    const shas = execFileSync("git", ["log", "--format=%H"], {
      cwd: path.join(ws, "app"),
      encoding: "utf-8",
    })
      .trim()
      .split("\n");
    const second = run(buildDiffScript(target, "app", { diff: "commit", sha: shas[0] }));
    expect(second).toContain("+two");
    expect(second).not.toContain("keep.txt");
    const root = run(buildDiffScript(target, "app", { diff: "commit", sha: shas[1] }));
    expect(root).toContain("+keep");
  });

  it("unknown commit reports not_found", () => {
    const out = run(buildDiffScript(target, "app", { diff: "commit", sha: "deadbeef" }));
    expect(out).toBe("\x1eX\x1fnot_found");
  });
});

describe("has-repos script", () => {
  it("is true when the workspace holds a repo, false when it holds none", () => {
    expect(parseHasRepos(run(buildHasReposScript(target)))).toBe(true);
    fs.mkdirSync(path.join(home, "fleet/roles/plain"), { recursive: true });
    fs.writeFileSync(path.join(home, "fleet/roles/plain/notes.md"), "x");
    expect(parseHasRepos(run(buildHasReposScript({ kind: "role", roleSlug: "plain" })))).toBe(false);
  });
});

describe("remote-check script", () => {
  const refsOf = (dir: string) => git(dir, "for-each-ref", "--format=%(refname) %(objectname)");

  it("counts commits on the remote that were never fetched, without moving any ref", () => {
    const lib = path.join(ws, "nested/lib");
    // Someone else pushes two commits upstream; lib hasn't fetched them.
    const other = path.join(home, "other");
    git(home, "clone", "-q", path.join(home, "upstream.git"), other);
    for (const n of ["r1", "r2"]) {
      write(path.join(other, n), n);
      git(other, "add", n);
      git(other, "commit", "-q", "-m", n);
    }
    git(other, "push", "-q", "origin", "main");

    const before = refsOf(lib);
    const statusBefore = git(lib, "status", "--porcelain=v2", "--branch");

    const result = parseRemoteCheck(run(buildRemoteCheckScript(target, "nested/lib")));
    expect(result).toEqual({ ahead: 1, behind: 2, upstream: "origin/main" });

    // origin/main still where it was, no peek ref left behind, status unchanged.
    expect(refsOf(lib)).toBe(before);
    expect(git(lib, "status", "--porcelain=v2", "--branch")).toBe(statusBefore);
    expect(fs.existsSync(path.join(lib, ".git/FETCH_HEAD"))).toBe(false);
  });

  it("reports no_upstream for a branch that tracks nothing", () => {
    expect(() => parseRemoteCheck(run(buildRemoteCheckScript(target, "app")))).toThrow(
      new GitScriptError("no_upstream"),
    );
  });

  it("reports fetch_failed when the remote is unreachable", () => {
    const app = path.join(ws, "app");
    git(app, "remote", "set-url", "origin", path.join(home, "missing.git"));
    git(app, "config", "branch.main.remote", "origin");
    git(app, "config", "branch.main.merge", "refs/heads/main");
    try {
      expect(() => parseRemoteCheck(run(buildRemoteCheckScript(target, "app")))).toThrow(
        new GitScriptError("fetch_failed"),
      );
      expect(git(app, "for-each-ref", "refs/skynet-remote-check/")).toBe("");
    } finally {
      git(app, "config", "--unset", "branch.main.remote");
      git(app, "config", "--unset", "branch.main.merge");
    }
  });
});
