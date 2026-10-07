/**
 * Phase 134 Plan 134-01 Task 3 — tests for POST/PATCH/DELETE /scheduled-agents.
 *
 * Test coverage (15+ cases, mirrors plan Task 3 <behavior>):
 *   1: 401 without JWT
 *   2: missing host → 400
 *   3: unknown host (resolveHostById → null) → 404
 *   4: spec.name normalizes to empty slug → 400
 *   5: spec missing prompt → 400 (scheduler-parity gate)
 *   6: spec missing schedule → 400 (scheduler-parity gate)
 *   7: spec.schedule.type not in {interval,daily,weekly,one_shot} → 400
 *   8: 409 on clobber (existence probe returns EXISTS)
 *   9: happy CREATE REMOTE — writeMarkdownFileAtomic called with JSON body;
 *      NEVER via sftp.rename (throwing trap installed)
 *  10: happy CREATE LOCAL — writes via writeMarkdownFileAtomic(null, ...)
 *  11: PATCH /:slug happy — 200 + writeMarkdownFileAtomic called (no clobber
 *      probe on update)
 *  12: PATCH /:slug/toggle-enabled happy — enabled bit flipped, atomic write
 *  13: DELETE /:slug — single execCommand call containing BOTH `rm -rf` AND
 *      `rm -f` for the .fired sentinel (D-06 / Pitfall #2 regression pin)
 *  14: semaphore serializes concurrent CREATEs — second CREATE sees the
 *      just-written file and 409s
 *  15: PATCH /:slug/toggle-enabled on missing spec → 404
 *  16: DELETE happy path (REMOTE) — 204 no content
 *
 * Scaffold mirrors roles-create.test.ts + roles-list-for-host.test.ts —
 * bare Express app on random port, vi.mock every I/O boundary.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth manager mock
// ---------------------------------------------------------------------------

let mockUserId: string | null = "test-user";

vi.mock("../../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware: () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          if (mockUserId === null) {
            return res.status(401).json({ error: "Unauthorized" });
          }
          (req as express.Request & { userId: string }).userId = mockUserId;
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Logger mock — silent
// ---------------------------------------------------------------------------

vi.mock("../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// SSH mocks
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

// ---------------------------------------------------------------------------
// identity-artifact-reader mock — writeMarkdownFileAtomic +
// normalizeSpecSlug + IDENTITY_SLUG_RE + isLocalHostId + getLocalScheduledAgentsRoot
// ---------------------------------------------------------------------------

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  writeMarkdownFileAtomic: vi.fn(),
  normalizeSpecSlug: (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
  IDENTITY_SLUG_RE: /^[a-z0-9_-]{1,80}$/i,
  isLocalHostId: vi.fn().mockReturnValue(false),
  getLocalScheduledAgentsRoot: vi.fn().mockReturnValue("/tmp/test-fleet/scheduled-agents"),
  getLocalIdentitiesRoot: vi.fn().mockReturnValue("/tmp/test-fleet/identities"),
}));

// ---------------------------------------------------------------------------
// host-semaphore mock — pass-through wrapper (real implementation is a
// counting semaphore; for tests we want serial semantics + no state leak).
// ---------------------------------------------------------------------------

vi.mock("../../ssh/host-semaphore-registry.js", () => {
  const perHost = new Map<
    string,
    Promise<unknown>
  >();
  // Fix #1 followup: scheduled-agents-write.ts also imports `makeSemaphore` +
  // `HostSemaphore` for its per-slug mutex registry. The mock must expose
  // makeSemaphore so `getSlugMutex` can build slot-1 semaphores. Serial
  // chain-of-promises pattern mirrors getHostSemaphore's mock semantics.
  const makeSemaphore = (_limit: number) => {
    let tail: Promise<unknown> = Promise.resolve();
    return {
      run: <T>(fn: () => Promise<T>): Promise<T> => {
        const next = tail.then(() => fn());
        tail = next.catch(() => {
          /* swallow to keep chain alive */
        });
        return next;
      },
    };
  };
  return {
    makeSemaphore,
    getHostSemaphore: (hostId: string | number) => ({
      run: async <T>(fn: () => Promise<T>): Promise<T> => {
        const key = String(hostId);
        const prev = perHost.get(key) ?? Promise.resolve();
        // Chain onto the previous work so runs are strictly serial per host.
        const next = prev.then(() => fn());
        perHost.set(
          key,
          next.catch(() => {
            /* swallow to keep chain alive */
          }),
        );
        return next;
      },
    }),
  };
});

// ---------------------------------------------------------------------------
// fs/promises mock — LOCAL branch reads/writes/rm/unlink
// ---------------------------------------------------------------------------

const fsAccessMock = vi.fn();
const fsMkdirMock = vi.fn();
const fsRmMock = vi.fn();
const fsUnlinkMock = vi.fn();
const fsReadFileMock = vi.fn();
const fsWriteFileMock = vi.fn();
const fsRenameMock = vi.fn();

vi.mock("fs/promises", () => ({
  default: {
    access: (p: string) => fsAccessMock(p),
    mkdir: (p: string, opts?: unknown) => fsMkdirMock(p, opts),
    rm: (p: string, opts?: unknown) => fsRmMock(p, opts),
    unlink: (p: string) => fsUnlinkMock(p),
    readFile: (p: string, enc: string) => fsReadFileMock(p, enc),
    writeFile: (p: string, buf: unknown, opts?: unknown) =>
      fsWriteFileMock(p, buf, opts),
    rename: (a: string, b: string) => fsRenameMock(a, b),
  },
  access: (p: string) => fsAccessMock(p),
  mkdir: (p: string, opts?: unknown) => fsMkdirMock(p, opts),
  rm: (p: string, opts?: unknown) => fsRmMock(p, opts),
  unlink: (p: string) => fsUnlinkMock(p),
  readFile: (p: string, enc: string) => fsReadFileMock(p, enc),
  writeFile: (p: string, buf: unknown, opts?: unknown) =>
    fsWriteFileMock(p, buf, opts),
  rename: (a: string, b: string) => fsRenameMock(a, b),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import {
  writeMarkdownFileAtomic,
  isLocalHostId,
} from "../../claude-session/identity-artifact-reader.js";

// ---------------------------------------------------------------------------
// httpRequest helper (supports GET/POST/PATCH/DELETE with JSON body)
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const bodyStr =
      opts.body === undefined ? "" : JSON.stringify(opts.body);
    const headers: Record<string, string> = {
      ...(opts.headers ?? {}),
    };
    if (bodyStr) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
    }
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => {
          data += c.toString();
        });
        res.on("end", () => {
          let parsed: unknown;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Import router UNDER TEST
// ---------------------------------------------------------------------------

import router, {
  __resetSlugMutexRegistryForTests,
  buildRunNowSpawnRequest,
  prettifyScheduledAgentName,
} from "./scheduled-agents-write.js";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

// stubConn.sftp.rename is a THROWING TRAP — Pitfall #1 regression pin.
// If any code path calls sftp.rename (as opposed to ext_openssh_rename via
// writeMarkdownFileAtomic), this trap fires with a diagnostic. The
// writeMarkdownFileAtomic itself is mocked in these tests so this trap
// hardens the surface against any future direct-SFTP write path.
const sftpRenameTrap = vi.fn().mockImplementation(() => {
  throw new Error(
    "sftp.rename must NOT be called — use ext_openssh_rename per Pitfall #1",
  );
});
const stubSftp = {
  rename: sftpRenameTrap,
  ext_openssh_rename: vi.fn(),
  writeFile: vi.fn(),
};
const stubConn = {
  end: vi.fn(),
  exec: vi.fn(),
  sftp: (cb: (err: Error | null, s: unknown) => void) => cb(null, stubSftp),
};

const stubHost = {
  id: 7,
  ip: "10.0.0.7",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "test-user";
  sftpRenameTrap.mockClear();
  __resetSlugMutexRegistryForTests();

  (resolveHostById as Mock).mockImplementation(async (hostId: number) => {
    if (hostId === 7 || hostId === 1) return stubHost;
    return null;
  });
  (connectOneShot as Mock).mockResolvedValue(stubConn);
  (execCommand as Mock).mockResolvedValue("");
  (writeMarkdownFileAtomic as Mock).mockResolvedValue(undefined);
  (isLocalHostId as Mock).mockReturnValue(false);

  const app = express();
  app.use("/scheduled-agents", router);
  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

const validSpec = {
  name: "Morning digest",
  enabled: true,
  prompt: "Summarize overnight events",
  schedule: { type: "interval", every: "15m" },
  roles: ["box-maintainer"],
  skills: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /scheduled-agents (CREATE)", () => {
  it("Test 1: 401 without JWT", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents",
      body: { host: 7, spec: validSpec },
    });
    expect(res.status).toBe(401);
    expect(resolveHostById).not.toHaveBeenCalled();
  });

  it("Test 2: missing host → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents",
      body: { spec: validSpec },
    });
    expect(res.status).toBe(400);
    expect(resolveHostById).not.toHaveBeenCalled();
  });

  it("Test 3: unknown host → 404", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents",
      body: { host: 99999, spec: validSpec },
    });
    expect(res.status).toBe(404);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 4: spec.name normalizes to empty slug → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents",
      body: { host: 7, spec: { ...validSpec, name: "!!!" } },
    });
    expect(res.status).toBe(400);
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 5: missing prompt → 400 (scheduler-parity gate)", async () => {
    const { prompt: _p, ...noPrompt } = validSpec;
    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents",
      body: { host: 7, spec: noPrompt },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/prompt/i);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 6: missing schedule → 400 (scheduler-parity gate)", async () => {
    const { schedule: _s, ...noSched } = validSpec;
    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents",
      body: { host: 7, spec: noSched },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/schedule/i);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 7: unknown schedule.type → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents",
      body: {
        host: 7,
        spec: { ...validSpec, schedule: { type: "custom-experimental" } },
      },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/type/i);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 8: 409 on clobber (existence probe returns EXISTS)", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("&& echo EXISTS")) return "EXISTS\n";
      return "";
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents",
      body: { host: 7, spec: validSpec },
    });
    expect(res.status).toBe(409);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 9: happy CREATE REMOTE — 201 + writeMarkdownFileAtomic called, sftp.rename never fires", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("&& echo EXISTS")) return "OK\n";
      return "";
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents",
      body: { host: 7, spec: validSpec },
    });
    expect(res.status).toBe(201);
    const rb = res.body as { slug: string; host: number };
    expect(rb.slug).toBe("morning-digest");
    expect(rb.host).toBe(7);
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    // First arg = conn (not null → REMOTE); second arg = target path with slug;
    // third arg = JSON body containing the spec.
    const callArgs = (writeMarkdownFileAtomic as Mock).mock.calls[0];
    expect(callArgs[1]).toContain("morning-digest/scheduled-agent.json");
    expect(callArgs[2]).toContain('"prompt": "Summarize overnight events"');
    // Pitfall #1 regression pin — sftp.rename never invoked.
    expect(sftpRenameTrap).not.toHaveBeenCalled();
  });

  it("Test 10: happy CREATE LOCAL — writeMarkdownFileAtomic(null, ...)", async () => {
    (isLocalHostId as Mock).mockReturnValue(true);
    // LOCAL branch: fs.access rejects (no existing spec → OK to create).
    fsAccessMock.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    fsMkdirMock.mockResolvedValue(undefined);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents",
      body: { host: 1, spec: validSpec },
    });
    expect(res.status).toBe(201);
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    // First arg must be null → LOCAL branch
    expect((writeMarkdownFileAtomic as Mock).mock.calls[0][0]).toBeNull();
    // No SSH connection should have been opened
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 14: semaphore serializes concurrent CREATEs — second 409s", async () => {
    // First CREATE: probe returns OK, write succeeds.
    // Second CREATE (issued in parallel but on the same hostId): probe returns
    // EXISTS because the first write "landed" (semaphore guarantees serial).
    let firstDone = false;
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("&& echo EXISTS")) {
        return firstDone ? "EXISTS\n" : "OK\n";
      }
      return "";
    });
    (writeMarkdownFileAtomic as Mock).mockImplementation(async () => {
      firstDone = true;
    });

    const [resA, resB] = await Promise.all([
      httpRequest(server, {
        method: "POST",
        path: "/scheduled-agents",
        body: { host: 7, spec: validSpec },
      }),
      httpRequest(server, {
        method: "POST",
        path: "/scheduled-agents",
        body: { host: 7, spec: validSpec },
      }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // Exactly one 201 + one 409 — semaphore serialization prevents both from
    // seeing "OK" on the probe.
    expect(statuses).toEqual([201, 409]);
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /scheduled-agents/:slug (UPDATE)", () => {
  it("Test 11: happy PATCH REMOTE — 200 + writeMarkdownFileAtomic called", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("cat ") && cmd.includes("scheduled-agent.json")) {
        return JSON.stringify(validSpec);
      }
      return "";
    });
    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/scheduled-agents/morning-digest",
      body: { host: 7, spec: { ...validSpec, prompt: "updated prompt" } },
    });
    expect(res.status).toBe(200);
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const callArgs = (writeMarkdownFileAtomic as Mock).mock.calls[0];
    expect(callArgs[1]).toContain("morning-digest/scheduled-agent.json");
    expect(callArgs[2]).toContain("updated prompt");
    // UPDATE MUST NOT invoke sftp.rename via any code path
    expect(sftpRenameTrap).not.toHaveBeenCalled();
  });

  it("Test 17: happy PATCH LOCAL — writeMarkdownFileAtomic(null, ...) (code-review fix #9)", async () => {
    (isLocalHostId as Mock).mockReturnValue(true);
    fsReadFileMock.mockResolvedValue(JSON.stringify(validSpec));
    fsMkdirMock.mockResolvedValue(undefined);

    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/scheduled-agents/morning-digest",
      body: { host: 1, spec: { ...validSpec, prompt: "local updated prompt" } },
    });
    expect(res.status).toBe(200);
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    // First arg must be null → LOCAL branch
    expect((writeMarkdownFileAtomic as Mock).mock.calls[0][0]).toBeNull();
    expect((writeMarkdownFileAtomic as Mock).mock.calls[0][2]).toContain(
      "local updated prompt",
    );
    // No SSH connection should have been opened
    expect(connectOneShot).not.toHaveBeenCalled();
    // Pitfall #1 regression pin — sftp.rename never invoked (LOCAL uses
    // fs.rename via writeMarkdownFileAtomic(null, ...), not SFTP).
    expect(sftpRenameTrap).not.toHaveBeenCalled();
  });

  it("Test 18: PATCH rejects rename attempts — submitted spec.name differs from stored name", async () => {
    // Stored spec has name "Morning digest"; body attempts "Evening Review".
    // Guard compares against stored, not URL slug — so legacy folders where
    // stored name doesn't normalize to folder slug still update fine as long
    // as name is unchanged.
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("cat ") && cmd.includes("scheduled-agent.json")) {
        return JSON.stringify(validSpec);
      }
      return "";
    });
    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/scheduled-agents/morning-digest",
      body: { host: 7, spec: { ...validSpec, name: "Evening Review" } },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/spec\.name/);
    // No write should have been attempted
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 18b: PATCH allows update when stored name doesn't normalize to slug (legacy-data regression pin)", async () => {
    // Regression pin for Phase-126-migration-flavored data: folder slug is
    // `box-maintainer-daily-check` but stored spec.name is `daily-check`
    // (the pre-migration unprefixed name). The old guard rejected this on
    // every save; the new guard only trips on actual rename attempts.
    const legacySpec = { ...validSpec, name: "daily-check" };
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("cat ") && cmd.includes("scheduled-agent.json")) {
        return JSON.stringify(legacySpec);
      }
      return "";
    });
    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/scheduled-agents/box-maintainer-daily-check",
      body: {
        host: 7,
        spec: { ...legacySpec, prompt: "new prompt for legacy spec" },
      },
    });
    expect(res.status).toBe(200);
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
  });

  it("Test 18c: PATCH on missing spec → 404", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("cat ") && cmd.includes("scheduled-agent.json")) {
        return "__SCHEDULED_AGENT_MISSING__\n";
      }
      return "";
    });
    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/scheduled-agents/morning-digest",
      body: { host: 7, spec: validSpec },
    });
    expect(res.status).toBe(404);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });
});

describe("PATCH /scheduled-agents/:slug/toggle-enabled", () => {
  it("Test 12: toggle happy REMOTE — 200 + writeMarkdownFileAtomic with enabled flipped", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("cat ") && cmd.includes("scheduled-agent.json")) {
        return JSON.stringify({ ...validSpec, enabled: true });
      }
      return "";
    });

    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/scheduled-agents/morning-digest/toggle-enabled",
      body: { host: 7, enabled: false },
    });
    expect(res.status).toBe(200);
    expect((res.body as { enabled: boolean }).enabled).toBe(false);
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    // Body written must contain "enabled": false
    const written = (writeMarkdownFileAtomic as Mock).mock.calls[0][2] as string;
    expect(written).toContain('"enabled": false');
  });

  it("Test 15: toggle on missing spec → 404", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("cat ") && cmd.includes("scheduled-agent.json")) {
        return "__SCHEDULED_AGENT_MISSING__\n";
      }
      return "";
    });

    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/scheduled-agents/does-not-exist/toggle-enabled",
      body: { host: 7, enabled: true },
    });
    expect(res.status).toBe(404);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });
});

describe("DELETE /scheduled-agents/:slug", () => {
  it("Test 13: DELETE + sentinel cleanup — single execCommand includes BOTH rm -rf AND rm -f .fired", async () => {
    (execCommand as Mock).mockResolvedValue("");

    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/scheduled-agents/morning-digest",
      body: { host: 7 },
    });
    expect(res.status).toBe(204);
    // D-06 + Pitfall #2 regression pin — verify a single execCommand call
    // contains BOTH the folder rmdir AND the .fired sentinel cleanup, glued
    // by a shell && to prevent partial-cleanup / orphan sentinels.
    const relevantCalls = (execCommand as Mock).mock.calls.filter(
      (c) => typeof c[1] === "string" && (c[1] as string).includes(".fired"),
    );
    expect(relevantCalls).toHaveLength(1);
    const cmd = relevantCalls[0][1] as string;
    expect(cmd).toContain("rm -rf");
    expect(cmd).toContain("rm -f");
    expect(cmd).toContain(".fired");
    expect(cmd).toContain("morning-digest");
  });

  it("Test 16: DELETE happy REMOTE — 204 no content", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/scheduled-agents/morning-digest",
      body: { host: 7 },
    });
    expect(res.status).toBe(204);
    // 204 body is empty
    expect(res.body).toBeNull();
  });

  it("Test 19: DELETE happy LOCAL — 204 + fs.rm(dir) AND fs.unlink(sentinel) both called (code-review fix #9)", async () => {
    (isLocalHostId as Mock).mockReturnValue(true);
    fsRmMock.mockResolvedValue(undefined);
    fsUnlinkMock.mockResolvedValue(undefined);

    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/scheduled-agents/morning-digest",
      body: { host: 1 },
    });
    expect(res.status).toBe(204);
    // LOCAL DELETE must call BOTH fs.rm (folder) AND fs.unlink (sentinel).
    // D-06 + Pitfall #2: orphaned .fired sentinel would inherit "already
    // fired" state onto a future scheduled agent with the same slug.
    expect(fsRmMock).toHaveBeenCalledTimes(1);
    const rmPath = fsRmMock.mock.calls[0][0] as string;
    expect(rmPath).toContain("morning-digest");
    expect(rmPath).not.toContain(".state");
    expect(fsUnlinkMock).toHaveBeenCalledTimes(1);
    const unlinkPath = fsUnlinkMock.mock.calls[0][0] as string;
    expect(unlinkPath).toContain(".state");
    expect(unlinkPath).toContain("morning-digest.fired");
    // No SSH connection should have been opened for LOCAL DELETE
    expect(connectOneShot).not.toHaveBeenCalled();
    // No execCommand either — LOCAL uses fs.rm + fs.unlink, not shell
    expect(execCommand).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Users-strip discipline — the per-user visibility gate list is DISK-ONLY.
// A client sending `users` in a POST or PATCH payload must have it silently
// dropped BEFORE the spec lands on disk AND BEFORE the response echo, so
// a client cannot round-trip the field either. Mirrors how apps + projects
// treat their users tagging (no HTTP write surface for it).
// ---------------------------------------------------------------------------

describe("Users-strip discipline (per-user gate list is disk-only)", () => {
  it("POST with users in payload → 201; users NOT in written body; users NOT in response echo", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("&& echo EXISTS")) return "OK\n";
      return "";
    });

    const specWithUsers = { ...validSpec, users: ["alice", "zoey"] };
    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents",
      body: { host: 7, spec: specWithUsers },
    });
    expect(res.status).toBe(201);

    // On-disk body — the third arg to writeMarkdownFileAtomic is the JSON body.
    const callArgs = (writeMarkdownFileAtomic as Mock).mock.calls[0];
    const writtenBody = callArgs[2] as string;
    expect(writtenBody).not.toContain('"users"');
    expect(writtenBody).not.toContain("alice");

    // Response echo — {slug, host, spec} where spec is the STRIPPED validSpec.
    const rb = res.body as { spec: Record<string, unknown> };
    expect(rb.spec).not.toHaveProperty("users");
    expect(rb.spec).toHaveProperty("prompt");
    expect(rb.spec).toHaveProperty("schedule");
  });

  it("PATCH /:slug with users in payload → 200; users NOT in written body; users NOT in response echo", async () => {
    // PATCH does a read-modify-write: reads the existing spec from disk (for
    // the anti-rename storedName check), then writes the new spec. Mock the
    // read to return a spec with a matching name so the name-drift gate
    // passes and we reach the write path where the strip discipline applies.
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("cat ") && cmd.includes("scheduled-agent.json")) {
        return JSON.stringify(validSpec);
      }
      return "";
    });
    const specWithUsers = { ...validSpec, users: ["alice"] };
    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/scheduled-agents/morning-digest",
      body: { host: 7, spec: specWithUsers },
    });
    expect(res.status).toBe(200);

    const callArgs = (writeMarkdownFileAtomic as Mock).mock.calls[0];
    const writtenBody = callArgs[2] as string;
    expect(writtenBody).not.toContain('"users"');
    expect(writtenBody).not.toContain("alice");

    const rb = res.body as { spec: Record<string, unknown> };
    expect(rb.spec).not.toHaveProperty("users");
  });

  it("PATCH preserves on-disk users tag through a full-spec overwrite", async () => {
    // The modal fetches via GET, which STRIPS users on the wire. The modal
    // then PATCHes the spec back without users in the payload. Without
    // preservation, a disk-side `users: ["alice"]` tag would be wiped on
    // the first UI edit because the client can't see it and can't send it
    // back. Preserve the disk value on the write body (but not on the
    // response echo — strip discipline still holds on the wire).
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("cat ") && cmd.includes("scheduled-agent.json")) {
        // Disk state includes a users tag set by an operator.
        return JSON.stringify({ ...validSpec, users: ["alice"] });
      }
      return "";
    });
    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/scheduled-agents/morning-digest",
      body: { host: 7, spec: { ...validSpec, prompt: "updated" } },
    });
    expect(res.status).toBe(200);

    // Write body MUST contain the disk-side users tag.
    const callArgs = (writeMarkdownFileAtomic as Mock).mock.calls[0];
    const writtenBody = callArgs[2] as string;
    expect(writtenBody).toContain('"users"');
    expect(writtenBody).toContain("alice");
    // Sanity: the edited prompt survives too.
    expect(writtenBody).toContain("updated");

    // Response echo MUST NOT leak users on the wire (strip discipline).
    const rb = res.body as { spec: Record<string, unknown> };
    expect(rb.spec).not.toHaveProperty("users");
  });

  it("PATCH preserves disk users EVEN when client tries to override users in payload", async () => {
    // stripUsersFromSpec runs first (drops client's users), then the disk
    // value is preserved onto the write payload. Net: disk wins,
    // regardless of what the client sent.
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("cat ") && cmd.includes("scheduled-agent.json")) {
        return JSON.stringify({ ...validSpec, users: ["alice"] });
      }
      return "";
    });
    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/scheduled-agents/morning-digest",
      body: {
        host: 7,
        spec: { ...validSpec, users: ["not-alice", "someone-else"] },
      },
    });
    expect(res.status).toBe(200);
    const callArgs = (writeMarkdownFileAtomic as Mock).mock.calls[0];
    const writtenBody = callArgs[2] as string;
    // The disk value wins, client's override is discarded.
    expect(writtenBody).toContain("alice");
    expect(writtenBody).not.toContain("not-alice");
    expect(writtenBody).not.toContain("someone-else");
  });

  it("PATCH with no disk users tag → write body carries no users field either", async () => {
    // If the disk has no users tag, PATCH doesn't invent one. The
    // preservation is one-way (preserve what's there; don't fabricate).
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("cat ") && cmd.includes("scheduled-agent.json")) {
        return JSON.stringify(validSpec); // No users on disk.
      }
      return "";
    });
    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/scheduled-agents/morning-digest",
      body: { host: 7, spec: { ...validSpec, prompt: "updated" } },
    });
    expect(res.status).toBe(200);
    const callArgs = (writeMarkdownFileAtomic as Mock).mock.calls[0];
    const writtenBody = callArgs[2] as string;
    expect(writtenBody).not.toContain('"users"');
  });

  it("POST WITHOUT users field → succeeds unchanged (strip is a no-op)", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("&& echo EXISTS")) return "OK\n";
      return "";
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents",
      body: { host: 7, spec: validSpec },
    });
    expect(res.status).toBe(201);

    const callArgs = (writeMarkdownFileAtomic as Mock).mock.calls[0];
    const writtenBody = callArgs[2] as string;
    expect(writtenBody).toContain('"prompt"');
    expect(writtenBody).not.toContain('"users"');
  });
});

// ---------------------------------------------------------------------------
// Unit test for stripUsersFromSpec — pure helper.
// ---------------------------------------------------------------------------

describe("stripUsersFromSpec (helper)", () => {
  it("removes the users key when present", async () => {
    const { stripUsersFromSpec } = await import("./scheduled-agents-write.js");
    const spec: Record<string, unknown> = {
      name: "x",
      users: ["alice"],
      prompt: "p",
    };
    stripUsersFromSpec(spec);
    expect(spec).not.toHaveProperty("users");
    expect(spec).toHaveProperty("prompt");
    expect(spec).toHaveProperty("name");
  });

  it("is a no-op when users is absent", async () => {
    const { stripUsersFromSpec } = await import("./scheduled-agents-write.js");
    const spec: Record<string, unknown> = { name: "x", prompt: "p" };
    stripUsersFromSpec(spec);
    expect(spec).toEqual({ name: "x", prompt: "p" });
  });

  it("removes users even when the value is null / non-array (defensive)", async () => {
    const { stripUsersFromSpec } = await import("./scheduled-agents-write.js");
    const specNull: Record<string, unknown> = { name: "x", users: null };
    stripUsersFromSpec(specNull);
    expect(specNull).not.toHaveProperty("users");

    const specNonArr: Record<string, unknown> = { name: "x", users: "alice" };
    stripUsersFromSpec(specNonArr);
    expect(specNonArr).not.toHaveProperty("users");
  });
});

describe("buildPatchWritePayload (helper)", () => {
  it("copies valid disk users onto the write payload; leaves input untouched", async () => {
    const { buildPatchWritePayload } = await import("./scheduled-agents-write.js");
    const spec: Record<string, unknown> = { name: "x", prompt: "p" };
    const disk = { name: "x", users: ["alice"] };
    const out = buildPatchWritePayload(spec, disk);
    expect(out.users).toEqual(["alice"]);
    // Input untouched — response echo must stay users-free.
    expect(spec).not.toHaveProperty("users");
  });

  it("returns plain shallow copy when disk has no users field", async () => {
    const { buildPatchWritePayload } = await import("./scheduled-agents-write.js");
    const spec: Record<string, unknown> = { name: "x", prompt: "p" };
    const disk = { name: "x" };
    const out = buildPatchWritePayload(spec, disk);
    expect(out).not.toHaveProperty("users");
    expect(out.prompt).toBe("p");
  });

  it("ignores malformed disk users (non-array or non-string entries)", async () => {
    const { buildPatchWritePayload } = await import("./scheduled-agents-write.js");
    const spec: Record<string, unknown> = { name: "x" };

    expect(buildPatchWritePayload(spec, { users: null })).not.toHaveProperty("users");
    expect(buildPatchWritePayload(spec, { users: "alice" })).not.toHaveProperty("users");
    expect(
      buildPatchWritePayload(spec, { users: ["alice", 42, null] }),
    ).not.toHaveProperty("users");
  });

  it("handles null / non-object disk gracefully", async () => {
    const { buildPatchWritePayload } = await import("./scheduled-agents-write.js");
    const spec: Record<string, unknown> = { name: "x" };
    expect(buildPatchWritePayload(spec, null)).not.toHaveProperty("users");
    expect(buildPatchWritePayload(spec, "not-an-object")).not.toHaveProperty("users");
  });
});

// ---------------------------------------------------------------------------
// POST /:slug/run-now — manual fire drops a spawn-request, schedule untouched
// ---------------------------------------------------------------------------

describe("POST /scheduled-agents/:slug/run-now", () => {
  const UUID_JSON_RE = /\/spawn-requests\/[0-9a-f-]{36}\.json$/;

  function mockRemoteSpec(spec: unknown): void {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("scheduled-agent.json")) {
        return spec === undefined ? "__SCHEDULED_AGENT_MISSING__\n" : JSON.stringify(spec);
      }
      return "";
    });
  }

  it("happy REMOTE — 202 + spawn-request written atomically to ~/fleet/spawn-requests/<uuid>.json", async () => {
    mockRemoteSpec({ ...validSpec, users: ["zoey"] });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents/morning-digest/run-now",
      body: { host: 7 },
    });
    expect(res.status).toBe(202);
    const out = res.body as { slug: string; host: number; requestId: string };
    expect(out.slug).toBe("morning-digest");
    expect(out.host).toBe(7);
    expect(out.requestId).toMatch(/^[0-9a-f-]{36}$/);

    // The read exec also ensures the drop folder exists.
    const readCmd = (execCommand as Mock).mock.calls[0][1] as string;
    expect(readCmd).toContain('mkdir -p "$HOME/fleet/spawn-requests"');

    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const [connArg, target, body] = (writeMarkdownFileAtomic as Mock).mock.calls[0];
    expect(connArg).toBe(stubConn);
    expect(target).toBe(`$HOME/fleet/spawn-requests/${out.requestId}.json`);
    const parsed = JSON.parse(body as string);
    expect(parsed.roles).toEqual(["box-maintainer"]);
    expect(parsed.skills).toEqual([]);
    expect(parsed.task).toBe("⏰ Morning digest");
    expect(parsed.users).toEqual(["zoey"]);
    expect(parsed.requested_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(parsed.prompt).toContain("> Summarize overnight events");
    expect(parsed.prompt).toContain("started manually");
    expect(parsed.prompt).toContain("~/fleet/scheduled-agents/morning-digest/scheduled-agent.json");

    // Schedule state is never touched by a manual run.
    for (const c of (execCommand as Mock).mock.calls) {
      expect(c[1] as string).not.toMatch(/\.last|\.anchored|\.fired/);
    }
  });

  it("happy LOCAL — writes via writeMarkdownFileAtomic(null, ...) under the fleet root, no SSH", async () => {
    (isLocalHostId as Mock).mockReturnValue(true);
    fsReadFileMock.mockResolvedValue(JSON.stringify(validSpec));
    fsMkdirMock.mockResolvedValue(undefined);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents/morning-digest/run-now",
      body: { host: 1 },
    });
    expect(res.status).toBe(202);
    expect(fsReadFileMock.mock.calls[0][0]).toBe(
      "/tmp/test-fleet/scheduled-agents/morning-digest/scheduled-agent.json",
    );
    expect(fsMkdirMock.mock.calls[0][0]).toBe("/tmp/test-fleet/spawn-requests");
    const [connArg, target] = (writeMarkdownFileAtomic as Mock).mock.calls[0];
    expect(connArg).toBeNull();
    expect(target).toMatch(UUID_JSON_RE);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("disabled spec still runs (manual run is how you test a paused task)", async () => {
    mockRemoteSpec({ ...validSpec, enabled: false });
    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents/morning-digest/run-now",
      body: { host: 7 },
    });
    expect(res.status).toBe(202);
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
  });

  it("missing spec → 404, nothing written", async () => {
    mockRemoteSpec(undefined);
    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents/nope/run-now",
      body: { host: 7 },
    });
    expect(res.status).toBe(404);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("one_shot spec → 400, nothing written", async () => {
    mockRemoteSpec({ ...validSpec, schedule: { type: "one_shot", at: "2030-01-01T09:00" } });
    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents/morning-digest/run-now",
      body: { host: 7 },
    });
    expect(res.status).toBe(400);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("invalid slug → 400; unknown host → 404; missing host → 400", async () => {
    const bad = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents/bad.slug/run-now",
      body: { host: 7 },
    });
    expect(bad.status).toBe(400);
    const unknown = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents/morning-digest/run-now",
      body: { host: 99 },
    });
    expect(unknown.status).toBe(404);
    const noHost = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents/morning-digest/run-now",
      body: {},
    });
    expect(noHost.status).toBe(400);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("401 without JWT", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "POST",
      path: "/scheduled-agents/morning-digest/run-now",
      body: { host: 7 },
    });
    expect(res.status).toBe(401);
  });
});

describe("buildRunNowSpawnRequest (helper)", () => {
  const at = "2026-10-07T12:00:00Z";

  it("rejects empty roles (parse-request-body would reject the request as malformed)", () => {
    const r = buildRunNowSpawnRequest({ ...validSpec, roles: [] }, "x", at);
    expect(r.ok).toBe(false);
  });

  it("rejects missing prompt", () => {
    const r = buildRunNowSpawnRequest({ ...validSpec, prompt: "" }, "x", at);
    expect(r.ok).toBe(false);
  });

  it("omits users when absent; task null when name absent", () => {
    const { name: _name, ...noName } = validSpec;
    const r = buildRunNowSpawnRequest(noName, "x", at);
    expect(r.ok).toBe(true);
    if (r.ok === true) {
      expect("users" in r.body).toBe(false);
      expect(r.body.task).toBeNull();
    }
  });

  it("blockquotes every prompt line, trailing newline dropped like Python splitlines()", () => {
    const r = buildRunNowSpawnRequest({ ...validSpec, prompt: "one\ntwo\n" }, "x", at);
    expect(r.ok).toBe(true);
    if (r.ok === true) {
      expect((r.body.prompt as string).endsWith("> one\n> two")).toBe(true);
    }
  });

  it("prettifyScheduledAgentName mirrors the scheduler's _prettify_name", () => {
    expect(prettifyScheduledAgentName("news-watcher_zoey")).toBe("News watcher zoey");
    expect(prettifyScheduledAgentName("")).toBe("");
  });
});
