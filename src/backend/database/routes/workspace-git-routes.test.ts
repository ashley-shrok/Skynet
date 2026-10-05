// @vitest-environment node
/**
 * Route-level tests for /workspace/git: auth, RBAC, body validation and the
 * { error: "<class>" } contract. The stub SSH client's exec runs the command
 * in a local shell against a temp $HOME, so the happy path goes through the
 * real script and parser too.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let mockUserId: string | null = "user-A";
let mockHasAccess = true;
let home = "";
const execCommands: string[] = [];

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
          if (mockUserId === null) return res.status(401).json({ error: "Unauthorized" });
          (req as express.Request & { userId: string }).userId = mockUserId;
          next();
        },
    }),
  },
}));

const canAccessHost = vi.fn(async () => ({ hasAccess: mockHasAccess }));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: { getInstance: () => ({ canAccessHost }) },
}));

vi.mock("../../utils/logger.js", () => {
  const l = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() };
  return { sshLogger: l, logger: l, databaseLogger: l };
});

vi.mock("../../ssh/host-resolver.js", () => ({ resolveHostById: vi.fn() }));

/** ssh2-shaped client whose exec runs the command in a local shell. */
const stubClient = {
  exec(command: string, cb: (err: Error | null, stream: EventEmitter) => void) {
    execCommands.push(command);
    const child = spawn("sh", ["-c", command], {
      env: { PATH: process.env.PATH ?? "", HOME: home },
    });
    const stream = Object.assign(new EventEmitter(), { stderr: child.stderr });
    child.stdout.on("data", (b: Buffer) => stream.emit("data", b));
    child.on("close", () => stream.emit("close"));
    cb(null, stream);
  },
};

vi.mock("../../ssh/ssh-one-shot.js", () => ({ connectOneShot: vi.fn(async () => stubClient) }));
vi.mock("../../ssh/ssh-connection-pool.js", () => ({
  withConnection: vi.fn(
    async (_k: string, factory: () => Promise<unknown>, fn: (c: unknown) => Promise<unknown>) =>
      fn(await factory()),
  ),
}));

import { resolveHostById } from "../../ssh/host-resolver.js";
const { default: workspaceGitRoutes } = await import("./workspace-git-routes.js");

let server: http.Server;
let base = "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON for assertions
async function post(route: string, body: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const r = await fetch(`${base}/workspace/git${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

beforeAll(async () => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ws-git-route-")));
  const repo = path.join(home, "fleet/identities/alice/workspace/app");
  fs.mkdirSync(repo, { recursive: true });
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "A",
    GIT_AUTHOR_EMAIL: "a@x",
    GIT_COMMITTER_NAME: "A",
    GIT_COMMITTER_EMAIL: "a@x",
  };
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo, env });
  fs.writeFileSync(path.join(repo, "f.txt"), "hi\n");
  execFileSync("git", ["add", "."], { cwd: repo, env });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo, env });
  fs.writeFileSync(path.join(repo, "f.txt"), "hi\nthere\n");

  const app = express();
  app.use("/workspace/git", workspaceGitRoutes);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  mockUserId = "user-A";
  mockHasAccess = true;
  execCommands.length = 0;
  canAccessHost.mockClear();
  vi.mocked(resolveHostById).mockResolvedValue({
    ip: "10.0.0.1",
    port: 22,
    username: "u",
  } as never);
});

const ok = { hostId: 1, identityKey: "alice" };

describe("/workspace/git", () => {
  it("401 without auth", async () => {
    mockUserId = null;
    expect((await post("/repos", ok)).status).toBe(401);
  });

  it("403 permission_denied when the user can't read the host, and never execs", async () => {
    mockHasAccess = false;
    const r = await post("/repos", ok);
    expect(r).toEqual({ status: 403, body: { error: "permission_denied" } });
    expect(canAccessHost).toHaveBeenCalledWith("user-A", 1, "read");
    expect(execCommands).toEqual([]);
  });

  it("404 unknown_host", async () => {
    vi.mocked(resolveHostById).mockResolvedValue(null as never);
    expect(await post("/repos", ok)).toEqual({ status: 404, body: { error: "unknown_host" } });
  });

  it("400 on bad identity key, traversal repoPath, absolute repoPath, bad sha", async () => {
    expect((await post("/repos", { hostId: 1, identityKey: "../x" })).body).toEqual({
      error: "invalid_identity_key",
    });
    expect((await post("/repo", { ...ok, repoPath: "../../etc" })).body).toEqual({
      error: "path_traversal",
    });
    expect((await post("/repo", { ...ok, repoPath: "/etc" })).body).toEqual({
      error: "path_traversal",
    });
    expect((await post("/diff", { ...ok, repoPath: "app", diff: "commit", sha: "HEAD;rm" })).body).toEqual({
      error: "invalid_body",
    });
    expect((await post("/repo", { ...ok, repoPath: 5 })).body).toEqual({ error: "invalid_body" });
    expect(execCommands).toEqual([]);
  });

  it("lists repos", async () => {
    const r = await post("/repos", ok);
    expect(r.status).toBe(200);
    expect(r.body.truncated).toBe(false);
    expect(r.body.repos).toHaveLength(1);
    expect(r.body.repos[0]).toMatchObject({ path: "app", branch: "main", unstaged: 1 });
  });

  it("returns repo detail", async () => {
    const r = await post("/repo", { ...ok, repoPath: "app" });
    expect(r.status).toBe(200);
    expect(r.body.commits[0].subject).toBe("init");
    expect(r.body.status.files[0]).toMatchObject({ path: "f.txt", worktree: "M" });
  });

  it("returns the working diff", async () => {
    const r = await post("/diff", { ...ok, repoPath: "app" });
    expect(r.status).toBe(200);
    expect(r.body.truncated).toBe(false);
    expect(r.body.patch).toContain("+there");
  });

  it("maps script errors to classes", async () => {
    expect(await post("/repo", { ...ok, repoPath: "nope" })).toEqual({
      status: 404,
      body: { error: "not_found" },
    });
    expect(
      await post("/diff", { ...ok, repoPath: "app", diff: "commit", sha: "deadbeef" }),
    ).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("has-repos probes cheaply", async () => {
    expect(await post("/has-repos", ok)).toEqual({ status: 200, body: { hasRepos: true } });
    expect(execCommands[0]).not.toContain("status");
  });

  it("remote-check reports no_upstream for a branch tracking nothing", async () => {
    expect(await post("/remote-check", { ...ok, repoPath: "app" })).toEqual({
      status: 409,
      body: { error: "no_upstream" },
    });
  });
});
