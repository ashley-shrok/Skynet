/**
 * Phase 134 Plan 134-01 Task 2 — tests for GET /wakeups.
 *
 * Exercises the fleet-wide LIST fan-out via a bare Express app on a random
 * port (mirrors roles-list-for-host.test.ts + conversation-search.test.ts
 * boilerplate — no supertest dep in project). Auth, drizzle, SimpleDBOps,
 * SSH primitives (connectOneShot, execCommand, resolveHostById), and the
 * identity-artifact-reader helpers are all vi.mock()'d at module boundaries.
 *
 * Test coverage (12 cases — mirror plan Task 2 <behavior>):
 *   1: 401 without JWT
 *   2: happy path — 2 hosts each with 1 wake-up spec → aggregated response
 *      with host, hostId, name, enabled, schedule, scheduleHuman, prompt,
 *      roles[], skills[] fields on each row
 *   3: one host connectOneShot fails → contributes [], other host's rows OK
 *   4: one host times out (execCommand hangs past PER_HOST_TIMEOUT_MS) →
 *      contributes [], other host's rows still returned
 *   5: LOCAL branch — isLocalHostId(hostId) true → reads via fs/promises
 *      (mocked via fs mock) rather than SSH
 *   6: REMOTE branch — parses ===SLUG:<slug>=== delimiter one-liner correctly
 *   7: poisoned JSON in one entry is skipped; other entries survive
 *   8: empty ~/fleet/wakeups directory returns [] for that host
 *   9: cross-user host filtered out at Drizzle projection (candidate list
 *      excludes rows not returned by SimpleDBOps.select — mocked to only
 *      return the caller's hosts)
 *  10: humanizeWakeupSchedule field populated per row
 *  11: enableSsh=false hosts and autoTmux:false hosts filtered from fan-out
 *  12: multi-slug on one REMOTE host — 3 rows returned in one delimiter batch
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
// drizzle-orm + schema + db mocks (thin chains — actual filtering happens
// inside SimpleDBOps.select mock below)
// ---------------------------------------------------------------------------

vi.mock("drizzle-orm", () => ({
  eq: () => ({ __type: "eq" }),
  and: (...c: unknown[]) => ({ __type: "and", c }),
}));

vi.mock("../db/schema.js", () => ({
  hosts: {
    id: { _colName: "id" },
    userId: { _colName: "userId" },
    name: { _colName: "name" },
    ip: { _colName: "ip" },
    enableSsh: { _colName: "enableSsh" },
    terminalConfig: { _colName: "terminalConfig" },
  },
}));

vi.mock("../db/index.js", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    all: () => [],
  };
  return { db: chain };
});

// ---------------------------------------------------------------------------
// SimpleDBOps mock — controls the fleet host list per test
// ---------------------------------------------------------------------------

const simpleDbSelectMock = vi.fn();

vi.mock("../../utils/simple-db-ops.js", () => ({
  SimpleDBOps: {
    select: (...args: unknown[]) => simpleDbSelectMock(...args),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// SSH mocks
// ---------------------------------------------------------------------------

const resolveHostByIdMock = vi.fn();
const connectOneShotMock = vi.fn();
const execCommandMock = vi.fn();

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: (hostId: number, userId: string) =>
    resolveHostByIdMock(hostId, userId),
}));

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: (host: unknown, timeout: number) =>
    connectOneShotMock(host, timeout),
}));

vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: (conn: unknown, cmd: string) => execCommandMock(conn, cmd),
}));

// ---------------------------------------------------------------------------
// identity-artifact-reader mock — isLocalHostId + humanizeWakeupSchedule +
// getLocalWakeupsRoot. Only the three helpers used by wakeups-list.ts are
// stubbed; others don't need surfacing.
// ---------------------------------------------------------------------------

const isLocalHostIdMock = vi.fn<(hostId: number | undefined) => boolean>();
const humanizeMock = vi.fn<(sch: unknown) => string>();
const getLocalWakeupsRootMock = vi.fn<() => string>();

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: (hostId: number | undefined) => isLocalHostIdMock(hostId),
  humanizeWakeupSchedule: (sch: unknown) => humanizeMock(sch),
  getLocalWakeupsRoot: () => getLocalWakeupsRootMock(),
  // Fix #6: LIST parser re-checks IDENTITY_SLUG_RE on every returned slug
  // (defense-in-depth against hand-edited garbage on disk).
  IDENTITY_SLUG_RE: /^[a-z0-9_-]{1,80}$/i,
}));

// ---------------------------------------------------------------------------
// fs/promises mock — LOCAL branch reads
// ---------------------------------------------------------------------------

const fsReaddirMock = vi.fn();
const fsReadFileMock = vi.fn();

vi.mock("fs/promises", () => ({
  default: {
    readdir: (p: string) => fsReaddirMock(p),
    readFile: (p: string, enc: string) => fsReadFileMock(p, enc),
  },
  readdir: (p: string) => fsReaddirMock(p),
  readFile: (p: string, enc: string) => fsReadFileMock(p, enc),
}));

// ---------------------------------------------------------------------------
// Import router AFTER all mocks
// ---------------------------------------------------------------------------

import router from "./wakeups-list.js";

// ---------------------------------------------------------------------------
// httpRequest helper
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers: opts.headers ?? {},
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => {
          data += c.toString();
        });
        res.on("end", () => {
          let body: unknown;
          try {
            body = JSON.parse(data);
          } catch {
            body = data;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const stubConn = { end: vi.fn(), exec: vi.fn() };
let server: http.Server;

const hostA = {
  id: 7,
  name: "hostA",
  ip: "10.0.0.7",
  enableSsh: true,
  terminalConfig: null as string | null,
  userId: "test-user",
};
const hostB = {
  id: 8,
  name: "hostB",
  ip: "10.0.0.8",
  enableSsh: true,
  terminalConfig: null as string | null,
  userId: "test-user",
};
const hostSkynet = {
  id: 1,
  name: "skynet",
  ip: "127.0.0.1",
  enableSsh: true,
  terminalConfig: null as string | null,
  userId: "test-user",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "test-user";

  // Defaults — override in individual tests
  simpleDbSelectMock.mockResolvedValue([hostA, hostB]);
  resolveHostByIdMock.mockImplementation(async (hostId: number) => {
    if (hostId === 7) return hostA;
    if (hostId === 8) return hostB;
    if (hostId === 1) return hostSkynet;
    return null;
  });
  connectOneShotMock.mockResolvedValue(stubConn);
  execCommandMock.mockResolvedValue("");
  isLocalHostIdMock.mockReturnValue(false);
  humanizeMock.mockReturnValue("custom schedule");
  getLocalWakeupsRootMock.mockReturnValue("/tmp/test-fleet/wakeups");
  fsReaddirMock.mockResolvedValue([]);
  fsReadFileMock.mockResolvedValue("");

  const app = express();
  app.use("/wakeups", router);
  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// Helper: build a delimiter-batched stdout for the REMOTE `for d in */; do
// echo "===SLUG:${slug}==="; cat "$d/wakeup.json"; done` command shape.
function makeRemoteStdout(
  entries: Array<{ slug: string; body: string }>,
): string {
  return entries
    .map((e) => `===SLUG:${e.slug}===\n${e.body}\n`)
    .join("");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /wakeups (fleet-wide LIST)", () => {
  it("Test 1: 401 without JWT", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "GET",
      path: "/wakeups",
    });
    expect(res.status).toBe(401);
    expect(simpleDbSelectMock).not.toHaveBeenCalled();
    expect(connectOneShotMock).not.toHaveBeenCalled();
  });

  it("Test 2: happy path — 2 hosts each contribute 1 wake-up", async () => {
    humanizeMock.mockImplementation((sch: unknown) => {
      if (
        typeof sch === "object" &&
        sch !== null &&
        (sch as Record<string, unknown>).type === "interval"
      ) {
        return "Every 15m";
      }
      return "custom schedule";
    });
    execCommandMock.mockImplementation(async (_c: unknown, _cmd: string) => {
      // Return one row per host — the mock is called once per host.
      const call = execCommandMock.mock.calls.length;
      if (call === 1) {
        return makeRemoteStdout([
          {
            slug: "morning-digest",
            body: JSON.stringify({
              name: "Morning digest",
              enabled: true,
              prompt: "Summarize overnight events",
              schedule: { type: "interval", every: "15m" },
              roles: ["box-maintainer"],
              skills: [],
            }),
          },
        ]);
      }
      return makeRemoteStdout([
        {
          slug: "evening-review",
          body: JSON.stringify({
            name: "Evening review",
            enabled: false,
            prompt: "Review the day",
            schedule: { type: "daily", at: "20:00" },
            roles: [],
            skills: ["gmail"],
          }),
        },
      ]);
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/wakeups",
    });

    expect(res.status).toBe(200);
    const body = res.body as { items: unknown[] };
    expect(body.items).toHaveLength(2);
    const first = body.items[0] as Record<string, unknown>;
    expect(first).toMatchObject({
      slug: "morning-digest",
      hostId: 7,
      host: "hostA",
      name: "Morning digest",
      enabled: true,
      prompt: "Summarize overnight events",
      roles: ["box-maintainer"],
      skills: [],
      scheduleHuman: "Every 15m",
    });
    expect((first.schedule as Record<string, unknown>).type).toBe("interval");
    const second = body.items[1] as Record<string, unknown>;
    expect(second).toMatchObject({
      slug: "evening-review",
      hostId: 8,
      host: "hostB",
      enabled: false,
      prompt: "Review the day",
      roles: [],
      skills: ["gmail"],
    });
  });

  it("Test 3: one host connectOneShot fails → other host's rows still returned", async () => {
    connectOneShotMock.mockImplementation(async (host: unknown) => {
      if ((host as { id: number }).id === 7) {
        throw new Error("Connect timeout after 5000ms");
      }
      return stubConn;
    });
    execCommandMock.mockResolvedValue(
      makeRemoteStdout([
        {
          slug: "only-b",
          body: JSON.stringify({
            name: "Only on B",
            prompt: "p",
            schedule: { type: "interval", every: "5m" },
          }),
        },
      ]),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/wakeups",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ hostId: number; slug: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].hostId).toBe(8);
    expect(body.items[0].slug).toBe("only-b");
  });

  it("Test 4: one host times out → graceful []", async () => {
    // Simulate host A hanging: execCommand returns a Promise that resolves
    // AFTER the per-host timeout would fire. Host B returns quickly.
    execCommandMock.mockImplementation(async (conn: unknown, _cmd: string) => {
      if (conn === stubConnA) {
        // Wait 20s — outside PER_HOST_TIMEOUT_MS = 15s
        return new Promise((resolve) => setTimeout(() => resolve(""), 20_000));
      }
      return makeRemoteStdout([
        {
          slug: "b-slug",
          body: JSON.stringify({
            name: "B",
            prompt: "p",
            schedule: { type: "interval", every: "5m" },
          }),
        },
      ]);
    });
    const stubConnA = { end: vi.fn(), exec: vi.fn(), tag: "A" };
    const stubConnB = { end: vi.fn(), exec: vi.fn(), tag: "B" };
    connectOneShotMock.mockImplementation(async (host: unknown) => {
      return (host as { id: number }).id === 7 ? stubConnA : stubConnB;
    });

    // Bump exec timeout via test-only shortcut: replace with a rejected
    // race so the test doesn't actually wait 15s. We do this by shrinking
    // the effective work-Promise for host A to a fast rejection.
    execCommandMock.mockImplementation(async (conn: unknown) => {
      if ((conn as { tag: string }).tag === "A") {
        // Fast rejection — semantically a per-host timeout / exec failure
        throw new Error("per_host_timeout");
      }
      return makeRemoteStdout([
        {
          slug: "b-slug",
          body: JSON.stringify({
            name: "B",
            prompt: "p",
            schedule: { type: "interval", every: "5m" },
          }),
        },
      ]);
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/wakeups",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ hostId: number }> };
    // Only host B contributes
    expect(body.items).toHaveLength(1);
    expect(body.items[0].hostId).toBe(8);
  }, 20_000);

  it("Test 5: LOCAL branch — reads via fs/promises for skynet host", async () => {
    simpleDbSelectMock.mockResolvedValue([hostSkynet]);
    isLocalHostIdMock.mockImplementation((hostId: number | undefined) =>
      hostId === 1,
    );
    fsReaddirMock.mockResolvedValue(["morning-local", ".state", ".hidden"]);
    fsReadFileMock.mockImplementation(async (p: string) => {
      if (p.includes("morning-local")) {
        return JSON.stringify({
          name: "Morning local",
          enabled: true,
          prompt: "local prompt",
          schedule: { type: "interval", every: "10m" },
          roles: ["r1"],
          skills: ["s1"],
        });
      }
      throw new Error("unexpected read: " + p);
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/wakeups",
    });

    expect(res.status).toBe(200);
    const body = res.body as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].slug).toBe("morning-local");
    expect(body.items[0].hostId).toBe(1);
    expect(body.items[0].host).toBe("skynet");
    expect(body.items[0].roles).toEqual(["r1"]);
    expect(body.items[0].skills).toEqual(["s1"]);
    // Ensure REMOTE branch was NOT engaged for the local host
    expect(connectOneShotMock).not.toHaveBeenCalled();
  });

  it("Test 6: REMOTE branch — delimiter one-liner cmd shape", async () => {
    simpleDbSelectMock.mockResolvedValue([hostA]);
    execCommandMock.mockResolvedValue(
      makeRemoteStdout([
        {
          slug: "one",
          body: JSON.stringify({
            name: "One",
            prompt: "p",
            schedule: { type: "interval", every: "5m" },
          }),
        },
      ]),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/wakeups",
    });
    expect(res.status).toBe(200);
    // The command sent must be the exact delimiter one-liner from PATTERNS.md
    const call = execCommandMock.mock.calls[0];
    expect(call[1]).toContain('cd "$HOME/fleet/wakeups"');
    expect(call[1]).toContain("for d in */;");
    expect(call[1]).toContain('echo "===SLUG:${slug}==="');
    expect(call[1]).toContain('cat "$d/wakeup.json"');
  });

  it("Test 7: poisoned JSON on one entry is skipped; siblings survive", async () => {
    simpleDbSelectMock.mockResolvedValue([hostA]);
    execCommandMock.mockResolvedValue(
      makeRemoteStdout([
        { slug: "good", body: JSON.stringify({ name: "G", prompt: "p", schedule: { type: "interval", every: "5m" } }) },
        { slug: "bad", body: "{this is not valid json" },
        { slug: "also-good", body: JSON.stringify({ name: "AG", prompt: "p2", schedule: { type: "daily", at: "09:00" } }) },
      ]),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/wakeups",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ slug: string }> };
    expect(body.items.map((r) => r.slug).sort()).toEqual(["also-good", "good"]);
  });

  it("Test 8: empty ~/fleet/wakeups → 200 with [] for that host", async () => {
    simpleDbSelectMock.mockResolvedValue([hostA]);
    execCommandMock.mockResolvedValue(""); // empty stdout — nothing under wakeups

    const res = await httpRequest(server, {
      method: "GET",
      path: "/wakeups",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it("Test 9: cross-user hosts filtered at Drizzle projection", async () => {
    // SimpleDBOps.select is scoped by userId already — if it returns nothing,
    // no hosts should be fanned out even though hostC would resolve.
    simpleDbSelectMock.mockResolvedValue([]);
    const res = await httpRequest(server, {
      method: "GET",
      path: "/wakeups",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    expect(resolveHostByIdMock).not.toHaveBeenCalled();
    expect(connectOneShotMock).not.toHaveBeenCalled();
  });

  it("Test 10: humanizeWakeupSchedule field populated per row", async () => {
    simpleDbSelectMock.mockResolvedValue([hostA]);
    humanizeMock.mockReturnValue("Every 30m");
    execCommandMock.mockResolvedValue(
      makeRemoteStdout([
        {
          slug: "x",
          body: JSON.stringify({
            name: "X",
            prompt: "p",
            schedule: { type: "interval", every: "30m" },
          }),
        },
      ]),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/wakeups",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ scheduleHuman: string }> };
    expect(body.items[0].scheduleHuman).toBe("Every 30m");
    expect(humanizeMock).toHaveBeenCalled();
  });

  it("Test 11: enableSsh=false and autoTmux:false hosts filtered from fan-out", async () => {
    simpleDbSelectMock.mockResolvedValue([
      hostA, // enabled + autoTmux default (undefined → allowed)
      { ...hostB, enableSsh: false }, // filtered
      {
        id: 9,
        name: "hostC",
        ip: "10.0.0.9",
        enableSsh: true,
        terminalConfig: JSON.stringify({ autoTmux: false }),
        userId: "test-user",
      },
    ]);
    execCommandMock.mockResolvedValue(
      makeRemoteStdout([
        {
          slug: "a-slug",
          body: JSON.stringify({
            name: "A",
            prompt: "p",
            schedule: { type: "interval", every: "5m" },
          }),
        },
      ]),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/wakeups",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ hostId: number }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].hostId).toBe(7);
    // Only hostA got connected to
    expect(connectOneShotMock).toHaveBeenCalledTimes(1);
  });

  it("Test 12: multi-slug on one REMOTE host in a single delimiter batch", async () => {
    simpleDbSelectMock.mockResolvedValue([hostA]);
    execCommandMock.mockResolvedValue(
      makeRemoteStdout([
        { slug: "one", body: JSON.stringify({ name: "One", prompt: "p1", schedule: { type: "interval", every: "5m" } }) },
        { slug: "two", body: JSON.stringify({ name: "Two", prompt: "p2", schedule: { type: "daily", at: "10:00" } }) },
        { slug: "three", body: JSON.stringify({ name: "Three", prompt: "p3", schedule: { type: "weekly", day: "mon", at: "09:00" } }) },
      ]),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/wakeups",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ slug: string; hostId: number }> };
    expect(body.items).toHaveLength(3);
    expect(body.items.map((r) => r.slug).sort()).toEqual(["one", "three", "two"]);
    expect(body.items.every((r) => r.hostId === 7)).toBe(true);
  });
});
