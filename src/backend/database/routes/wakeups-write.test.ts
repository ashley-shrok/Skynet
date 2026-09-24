/**
 * Phase 134 Plan 134-01 Task 3 — tests for POST/PATCH/DELETE /wakeups.
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
// normalizeWakeupSlug + IDENTITY_SLUG_RE + isLocalHostId + getLocalWakeupsRoot
// ---------------------------------------------------------------------------

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  writeMarkdownFileAtomic: vi.fn(),
  normalizeWakeupSlug: (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
  IDENTITY_SLUG_RE: /^[a-z0-9_-]{1,80}$/i,
  isLocalHostId: vi.fn().mockReturnValue(false),
  getLocalWakeupsRoot: vi.fn().mockReturnValue("/tmp/test-fleet/wakeups"),
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
  // Fix #1 followup: wakeups-write.ts also imports `makeSemaphore` +
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

import router, { __resetSlugMutexRegistryForTests } from "./wakeups-write.js";

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
  app.use("/wakeups", router);
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

describe("POST /wakeups (CREATE)", () => {
  it("Test 1: 401 without JWT", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "POST",
      path: "/wakeups",
      body: { host: 7, spec: validSpec },
    });
    expect(res.status).toBe(401);
    expect(resolveHostById).not.toHaveBeenCalled();
  });

  it("Test 2: missing host → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/wakeups",
      body: { spec: validSpec },
    });
    expect(res.status).toBe(400);
    expect(resolveHostById).not.toHaveBeenCalled();
  });

  it("Test 3: unknown host → 404", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/wakeups",
      body: { host: 99999, spec: validSpec },
    });
    expect(res.status).toBe(404);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 4: spec.name normalizes to empty slug → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/wakeups",
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
      path: "/wakeups",
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
      path: "/wakeups",
      body: { host: 7, spec: noSched },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/schedule/i);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 7: unknown schedule.type → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/wakeups",
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
      path: "/wakeups",
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
      path: "/wakeups",
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
    expect(callArgs[1]).toContain("morning-digest/wakeup.json");
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
      path: "/wakeups",
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
        path: "/wakeups",
        body: { host: 7, spec: validSpec },
      }),
      httpRequest(server, {
        method: "POST",
        path: "/wakeups",
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

describe("PATCH /wakeups/:slug (UPDATE)", () => {
  it("Test 11: happy PATCH REMOTE — 200 + writeMarkdownFileAtomic called", async () => {
    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/wakeups/morning-digest",
      body: { host: 7, spec: { ...validSpec, prompt: "updated prompt" } },
    });
    expect(res.status).toBe(200);
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const callArgs = (writeMarkdownFileAtomic as Mock).mock.calls[0];
    expect(callArgs[1]).toContain("morning-digest/wakeup.json");
    expect(callArgs[2]).toContain("updated prompt");
    // UPDATE MUST NOT invoke sftp.rename via any code path
    expect(sftpRenameTrap).not.toHaveBeenCalled();
  });

  it("Test 17: happy PATCH LOCAL — writeMarkdownFileAtomic(null, ...) (code-review fix #9)", async () => {
    (isLocalHostId as Mock).mockReturnValue(true);
    fsMkdirMock.mockResolvedValue(undefined);

    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/wakeups/morning-digest",
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

  it("Test 18: PATCH rejects rename-via-PATCH when spec.name normalizes to different slug (code-review fix #4)", async () => {
    // URL slug is `morning-digest`, body's spec.name normalizes to
    // `evening-review` — mismatch is a 400 without touching disk.
    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/wakeups/morning-digest",
      body: { host: 7, spec: { ...validSpec, name: "Evening Review" } },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/spec\.name/);
    // No write should have been attempted
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });
});

describe("PATCH /wakeups/:slug/toggle-enabled", () => {
  it("Test 12: toggle happy REMOTE — 200 + writeMarkdownFileAtomic with enabled flipped", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.includes("cat ") && cmd.includes("wakeup.json")) {
        return JSON.stringify({ ...validSpec, enabled: true });
      }
      return "";
    });

    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/wakeups/morning-digest/toggle-enabled",
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
      if (cmd.includes("cat ") && cmd.includes("wakeup.json")) {
        return "__WAKEUP_MISSING__\n";
      }
      return "";
    });

    const res = await httpRequest(server, {
      method: "PATCH",
      path: "/wakeups/does-not-exist/toggle-enabled",
      body: { host: 7, enabled: true },
    });
    expect(res.status).toBe(404);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });
});

describe("DELETE /wakeups/:slug", () => {
  it("Test 13: DELETE + sentinel cleanup — single execCommand includes BOTH rm -rf AND rm -f .fired", async () => {
    (execCommand as Mock).mockResolvedValue("");

    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/wakeups/morning-digest",
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
      path: "/wakeups/morning-digest",
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
      path: "/wakeups/morning-digest",
      body: { host: 1 },
    });
    expect(res.status).toBe(204);
    // LOCAL DELETE must call BOTH fs.rm (folder) AND fs.unlink (sentinel).
    // D-06 + Pitfall #2: orphaned .fired sentinel would inherit "already
    // fired" state onto a future wake-up with the same slug.
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
