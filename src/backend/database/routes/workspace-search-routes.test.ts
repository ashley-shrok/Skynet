// @vitest-environment node
/**
 * Route-level tests for /workspace/search: auth, RBAC, body validation, the
 * { error: "<class>" } contract, the result cap, and the reserved root file.
 * The stub SSH client's exec runs the command in a local shell against a
 * temp $HOME, so the happy path goes through the real script and parser.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let mockUserId: string | null = "user-A";
let mockHasAccess = true;
let home = "";
const execCommands: string[] = [];
let closedEarly = 0;

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

/** ssh2-shaped client whose exec runs the command in a local shell; close() kills it. */
const stubClient = {
  exec(command: string, cb: (err: Error | null, stream: EventEmitter) => void) {
    execCommands.push(command);
    const child = spawn("sh", ["-c", command], {
      env: { PATH: process.env.PATH ?? "", HOME: home },
    });
    let closed = false;
    const stream = Object.assign(new EventEmitter(), {
      stderr: child.stderr,
      close() {
        if (closed) return;
        closed = true;
        closedEarly++;
        child.stdout.removeAllListeners("data");
        child.kill("SIGKILL");
      },
    });
    child.stdout.on("data", (b: Buffer) => stream.emit("data", b));
    child.on("close", () => stream.emit("close"));
    cb(null, stream);
  },
};

vi.mock("../../ssh/ssh-one-shot.js", () => ({ connectOneShot: vi.fn(async () => stubClient) }));
vi.mock("../../ssh/ssh-connection-pool.js", () => ({
  hostPoolKey: (h: { userId?: string; ip: string; port?: number | null; username: string }) =>
    `${h.userId}:${h.ip}:${h.port ?? 22}:${h.username}`,
  withConnection: vi.fn(
    async (_k: string, factory: () => Promise<unknown>, fn: (c: unknown) => Promise<unknown>) =>
      fn(await factory()),
  ),
}));

import { resolveHostById } from "../../ssh/host-resolver.js";
const { default: workspaceSearchRoutes } = await import("./workspace-search-routes.js");

let server: http.Server;
let base = "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON for assertions
async function post(body: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const r = await fetch(`${base}/workspace/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

function touch(rel: string): void {
  const p = path.join(home, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "");
}

beforeAll(async () => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ws-search-route-")));
  touch("fleet/identities/alice/workspace/docs/notes/plan.md");
  touch("fleet/identities/alice/workspace/docs/other.txt");
  for (let i = 0; i < 250; i++) touch(`fleet/identities/alice/workspace/many/item-${i}.log`);
  touch("fleet/roles/ops/ops.md");
  touch("fleet/roles/ops/sub/ops.md");
  touch("fleet/roles/ops/ops-notes.md");
  touch("fleet/projects/p1/project.md");
  touch("fleet/projects/p1/PROJECT-plan.md");
  touch("fleet/roles/big/big.md");
  for (let i = 0; i < 201; i++) touch(`fleet/roles/big/n-${i}.md`);

  const app = express();
  app.use("/workspace/search", workspaceSearchRoutes);
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
  closedEarly = 0;
  canAccessHost.mockClear();
  vi.mocked(resolveHostById).mockResolvedValue({ ip: "10.0.0.1", port: 22, username: "u" } as never);
});

const ok = { hostId: 1, identityKey: "alice", relativePath: "", query: "plan" };

describe("/workspace/search", () => {
  it("401 without auth", async () => {
    mockUserId = null;
    expect((await post(ok)).status).toBe(401);
  });

  it("403 permission_denied when the user can't read the host, and never execs", async () => {
    mockHasAccess = false;
    expect(await post(ok)).toEqual({ status: 403, body: { error: "permission_denied" } });
    expect(canAccessHost).toHaveBeenCalledWith("user-A", 1, "read");
    expect(execCommands).toEqual([]);
  });

  it("404 unknown_host", async () => {
    vi.mocked(resolveHostById).mockResolvedValue(null as never);
    expect(await post(ok)).toEqual({ status: 404, body: { error: "unknown_host" } });
  });

  it("400 on bad query, bad key, traversal or absolute start folder — never execs", async () => {
    expect((await post({ ...ok, query: "  " })).body).toEqual({ error: "invalid_body" });
    expect((await post({ ...ok, query: 5 })).body).toEqual({ error: "invalid_body" });
    expect((await post({ ...ok, query: "x".repeat(201) })).body).toEqual({ error: "invalid_body" });
    expect((await post({ ...ok, identityKey: "../x" })).body).toEqual({ error: "invalid_identity_key" });
    expect((await post({ ...ok, relativePath: "../../etc" })).body).toEqual({ error: "path_traversal" });
    expect((await post({ ...ok, relativePath: "/etc" })).body).toEqual({ error: "path_traversal" });
    expect((await post({ ...ok, relativePath: 7 })).body).toEqual({ error: "invalid_body" });
    expect(execCommands).toEqual([]);
  });

  it("returns matches with paths relative to the target root", async () => {
    const r = await post({ ...ok, relativePath: "docs" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      results: [expect.objectContaining({ name: "plan.md", type: "file", path: "docs/notes/plan.md" })],
      truncated: false,
      timedOut: false,
    });
  });

  it("caps at 200 results, flags truncated, and stops reading", async () => {
    const r = await post({ ...ok, query: "item" });
    expect(r.status).toBe(200);
    expect(r.body.results).toHaveLength(200);
    expect(r.body.truncated).toBe(true);
    expect(closedEarly).toBe(1);
  });

  it("never returns the role file at the role root, but does in subfolders", async () => {
    const r = await post({ hostId: 1, kind: "role", roleSlug: "ops", relativePath: "", query: "ops" });
    expect(r.body.results.map((m: { path: string }) => m.path).sort()).toEqual(["ops-notes.md", "sub/ops.md"]);
  });

  it("never returns the project file (case-insensitive)", async () => {
    const r = await post({ hostId: 1, kind: "project", projectSlug: "p1", relativePath: "", query: "project" });
    expect(r.body.results.map((m: { path: string }) => m.path)).toEqual(["PROJECT-plan.md"]);
  });

  it("the hidden file never eats into the cap, so a cut-short search still says so", async () => {
    const r = await post({ hostId: 1, kind: "role", roleSlug: "big", relativePath: "", query: "md" });
    expect(r.body.results).toHaveLength(200);
    expect(r.body.results.some((m: { path: string }) => m.path === "big.md")).toBe(false);
    expect(r.body.truncated).toBe(true);
  });

  it("hides the role file even when the root is reached as '.'", async () => {
    const r = await post({ hostId: 1, kind: "role", roleSlug: "ops", relativePath: ".", query: "ops" });
    expect(r.body.results.map((m: { path: string }) => m.path).sort()).toEqual(["./ops-notes.md", "./sub/ops.md"]);
  });

  it("404 not_found for a missing start folder", async () => {
    expect(await post({ ...ok, relativePath: "nope" })).toEqual({ status: 404, body: { error: "not_found" } });
  });
});
