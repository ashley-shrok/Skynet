/**
 * Phase 134 Plan 134-01 Task 2 — tests for GET /scheduled-agents.
 *
 * Exercises the fleet-wide LIST fan-out via a bare Express app on a random
 * port (mirrors roles-list-for-host.test.ts + conversation-search.test.ts
 * boilerplate — no supertest dep in project). Auth, drizzle, SimpleDBOps,
 * SSH primitives (connectOneShot, execCommand, resolveHostById), and the
 * identity-artifact-reader helpers are all vi.mock()'d at module boundaries.
 *
 * Test coverage (12 cases — mirror plan Task 2 <behavior>):
 *   1: 401 without JWT
 *   2: happy path — 2 hosts each with 1 scheduled-agent spec → aggregated response
 *      with host, hostId, name, enabled, schedule, scheduleHuman, prompt,
 *      roles[], skills[] fields on each row
 *   3: one host connectOneShot fails → contributes [], other host's rows OK
 *   4: one host times out (execCommand hangs past PER_HOST_TIMEOUT_MS) →
 *      contributes [], other host's rows still returned
 *   5: LOCAL branch — isLocalHostId(hostId) true → reads via fs/promises
 *      (mocked via fs mock) rather than SSH
 *   6: REMOTE branch — parses ===SLUG:<slug>=== delimiter one-liner correctly
 *   7: poisoned JSON in one entry is skipped; other entries survive
 *   8: empty ~/fleet/scheduled-agents directory returns [] for that host
 *   9: cross-user host filtered out at Drizzle projection (candidate list
 *      excludes rows not returned by SimpleDBOps.select — mocked to only
 *      return the caller's hosts)
 *  10: humanizeWakeupSchedule field populated per row
 *  11: enableSsh=false hosts and autoTmux:false hosts filtered from fan-out
 *  12: multi-slug on one REMOTE host — 3 rows returned in one delimiter batch
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
// getLocalScheduledAgentsRoot. Only the three helpers used by scheduled-agents-list.ts are
// stubbed; others don't need surfacing.
// ---------------------------------------------------------------------------

const isLocalHostIdMock = vi.fn<(hostId: number | undefined) => boolean>();
const humanizeMock = vi.fn<(sch: unknown) => string>();
const getLocalScheduledAgentsRootMock = vi.fn<() => string>();

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: (hostId: number | undefined) => isLocalHostIdMock(hostId),
  humanizeWakeupSchedule: (sch: unknown) => humanizeMock(sch),
  getLocalScheduledAgentsRoot: () => getLocalScheduledAgentsRootMock(),
  // Fix #6: LIST parser re-checks IDENTITY_SLUG_RE on every returned slug
  // (defense-in-depth against hand-edited garbage on disk).
  IDENTITY_SLUG_RE: /^[a-z0-9_-]{1,80}$/i,
}));

// ---------------------------------------------------------------------------
// host-user-counter mock — the users-gate resolves the caller's Skynet
// username through this helper. Default is null (gate DISABLED / falls open
// on every row), so pre-existing tests keep their happy paths without
// having to reason about a users list. Individual gate-behavior tests
// override with mockResolvedValueOnce.
// ---------------------------------------------------------------------------

vi.mock("../../utils/host-user-counter.js", () => ({
  getUsernameForUserId: vi.fn().mockResolvedValue(null),
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

import router from "./scheduled-agents-list.js";
import { getUsernameForUserId } from "../../utils/host-user-counter.js";
import { sshLogger } from "../../utils/logger.js";

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
  getLocalScheduledAgentsRootMock.mockReturnValue("/tmp/test-fleet/scheduled-agents");
  fsReaddirMock.mockResolvedValue([]);
  fsReadFileMock.mockResolvedValue("");

  const app = express();
  app.use("/scheduled-agents", router);
  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// Helper: build a delimiter-batched stdout for the REMOTE `for d in */; do
// echo "===SLUG:${slug}==="; cat "$d/scheduled-agent.json"; done` command shape.
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

describe("GET /scheduled-agents (fleet-wide LIST)", () => {
  it("Test 1: 401 without JWT", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "GET",
      path: "/scheduled-agents",
    });
    expect(res.status).toBe(401);
    expect(simpleDbSelectMock).not.toHaveBeenCalled();
    expect(connectOneShotMock).not.toHaveBeenCalled();
  });

  it("Test 2: happy path — 2 hosts each contribute 1 scheduled agent", async () => {
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
      path: "/scheduled-agents",
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
      path: "/scheduled-agents",
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
      path: "/scheduled-agents",
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
      path: "/scheduled-agents",
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

  it("Test 5b: LOCAL branch — .anchored sentinel feeds nextFireAt reference", async () => {
    // Sentinel-split regression (2026-10-05). An anchor-only spec (first-sight
    // seen but never fired) must have lastFiredAt=null and a nextFireAt
    // computed from the .anchored epoch, not from `now`.
    simpleDbSelectMock.mockResolvedValue([hostSkynet]);
    isLocalHostIdMock.mockImplementation((hostId: number | undefined) => hostId === 1);
    const anchoredEpoch = Math.floor(Date.now() / 1000) - 3600; // 1h ago
    fsReaddirMock.mockImplementation(async (p: string) => {
      if (p.endsWith("/.state")) return ["morning-local.anchored"];
      return ["morning-local"];
    });
    fsReadFileMock.mockImplementation(async (p: string) => {
      if (p.includes(".state/morning-local.anchored")) return `${anchoredEpoch}\n`;
      if (p.endsWith("scheduled-agent.json") && p.includes("morning-local")) {
        return JSON.stringify({
          name: "Morning local",
          enabled: true,
          prompt: "local prompt",
          schedule: { type: "interval", every: "2h" },
          roles: ["r1"],
          skills: [],
        });
      }
      throw new Error("unexpected read: " + p);
    });

    const res = await httpRequest(server, { method: "GET", path: "/scheduled-agents" });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].lastFiredAt).toBeNull();
    // nextFireAt = anchoredEpoch + 2h — within a few seconds of now_secs + 1h
    const nowSecs = Math.floor(Date.now() / 1000);
    const expected = anchoredEpoch + 2 * 3600;
    expect(body.items[0].nextFireAt).toBeGreaterThan(nowSecs);
    expect(Math.abs((body.items[0].nextFireAt as number) - expected)).toBeLessThan(60);
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
      path: "/scheduled-agents",
    });
    expect(res.status).toBe(200);
    // The command sent must be the exact delimiter one-liner from PATTERNS.md
    const call = execCommandMock.mock.calls[0];
    expect(call[1]).toContain('cd "$HOME/fleet/scheduled-agents"');
    expect(call[1]).toContain("for d in */;");
    expect(call[1]).toContain('echo "===SLUG:${slug}==="');
    expect(call[1]).toContain('cat "$d/scheduled-agent.json"');
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
      path: "/scheduled-agents",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ slug: string }> };
    expect(body.items.map((r) => r.slug).sort()).toEqual(["also-good", "good"]);
  });

  it("Test 8: empty ~/fleet/scheduled-agents → 200 with [] for that host", async () => {
    simpleDbSelectMock.mockResolvedValue([hostA]);
    execCommandMock.mockResolvedValue(""); // empty stdout — nothing under scheduled-agents

    const res = await httpRequest(server, {
      method: "GET",
      path: "/scheduled-agents",
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
      path: "/scheduled-agents",
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
      path: "/scheduled-agents",
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
      path: "/scheduled-agents",
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
      path: "/scheduled-agents",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ slug: string; hostId: number }> };
    expect(body.items).toHaveLength(3);
    expect(body.items.map((r) => r.slug).sort()).toEqual(["one", "three", "two"]);
    expect(body.items.every((r) => r.hostId === 7)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-user visibility gate — mirrors Phase 130 apps-tagging gate discipline.
// A scheduled-agent spec on disk may carry an optional `users: string[]`
// field naming the Skynet usernames allowed to see it in the list. Absent,
// non-array, or empty = "no gate" (falls open, D-3 default). The `users`
// field is stripped from every row in the response body — gate-only, never
// on the wire (T-129-HIGH-1 mirror).
// ---------------------------------------------------------------------------

describe("GET /scheduled-agents — per-user users-tagging gate", () => {
  it("caller on the users list → row visible; users field stripped from response", async () => {
    (getUsernameForUserId as Mock).mockResolvedValueOnce("alice");
    simpleDbSelectMock.mockResolvedValue([hostA]);
    execCommandMock.mockResolvedValue(
      makeRemoteStdout([
        {
          slug: "for-alice",
          body: JSON.stringify({
            name: "For Alice",
            prompt: "p",
            schedule: { type: "interval", every: "5m" },
            users: ["alice"],
          }),
        },
      ]),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/scheduled-agents",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].slug).toBe("for-alice");
    // Strip discipline — the field MUST NOT appear on the wire.
    expect(body.items[0]).not.toHaveProperty("users");
  });

  it("caller NOT on the users list → row filtered out", async () => {
    (getUsernameForUserId as Mock).mockResolvedValueOnce("zoey");
    simpleDbSelectMock.mockResolvedValue([hostA]);
    execCommandMock.mockResolvedValue(
      makeRemoteStdout([
        {
          slug: "for-alice",
          body: JSON.stringify({
            name: "For Alice",
            prompt: "p",
            schedule: { type: "interval", every: "5m" },
            users: ["alice"],
          }),
        },
        {
          slug: "for-zoey",
          body: JSON.stringify({
            name: "For Zoey",
            prompt: "p",
            schedule: { type: "daily", at: "09:00" },
            users: ["zoey"],
          }),
        },
      ]),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/scheduled-agents",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ slug: string }> };
    expect(body.items.map((r) => r.slug).sort()).toEqual(["for-zoey"]);
  });

  it("D-3 fallback: null/absent users list → falls open for any caller", async () => {
    (getUsernameForUserId as Mock).mockResolvedValueOnce("zoey");
    simpleDbSelectMock.mockResolvedValue([hostA]);
    execCommandMock.mockResolvedValue(
      makeRemoteStdout([
        {
          slug: "untagged",
          body: JSON.stringify({
            name: "Untagged",
            prompt: "p",
            schedule: { type: "interval", every: "5m" },
            // No users field — pre-migration spec.
          }),
        },
      ]),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/scheduled-agents",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ slug: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].slug).toBe("untagged");
  });

  it("D-3 fallback: empty users list → falls open for any caller", async () => {
    (getUsernameForUserId as Mock).mockResolvedValueOnce("zoey");
    simpleDbSelectMock.mockResolvedValue([hostA]);
    execCommandMock.mockResolvedValue(
      makeRemoteStdout([
        {
          slug: "empty-tag",
          body: JSON.stringify({
            name: "Empty Tag",
            prompt: "p",
            schedule: { type: "interval", every: "5m" },
            users: [],
          }),
        },
      ]),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/scheduled-agents",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ slug: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].slug).toBe("empty-tag");
  });

  it("null caller username (lookup returns null) → gate disabled, all rows visible", async () => {
    // Default mock resolves to null — gate is disabled per the internal-server
    // bypass semantics. Every row should surface regardless of tagging.
    simpleDbSelectMock.mockResolvedValue([hostA]);
    execCommandMock.mockResolvedValue(
      makeRemoteStdout([
        {
          slug: "for-alice",
          body: JSON.stringify({
            name: "For Alice",
            prompt: "p",
            schedule: { type: "interval", every: "5m" },
            users: ["alice"],
          }),
        },
        {
          slug: "for-zoey",
          body: JSON.stringify({
            name: "For Zoey",
            prompt: "p",
            schedule: { type: "daily", at: "09:00" },
            users: ["zoey"],
          }),
        },
      ]),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/scheduled-agents",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ slug: string }> };
    expect(body.items.map((r) => r.slug).sort()).toEqual(["for-alice", "for-zoey"]);
  });

  it("username lookup THROWS → fail-OPEN (gate disabled, all rows visible)", async () => {
    // Fail-OPEN matches project-list.ts + wave-2 identity-gate discipline —
    // a null callerUsername is an infra bug, not a gate signal; treating it
    // as "hide everything" would empty every user's list on the affected path.
    (getUsernameForUserId as Mock).mockRejectedValueOnce(new Error("db down"));
    simpleDbSelectMock.mockResolvedValue([hostA]);
    execCommandMock.mockResolvedValue(
      makeRemoteStdout([
        {
          slug: "for-alice",
          body: JSON.stringify({
            name: "For Alice",
            prompt: "p",
            schedule: { type: "interval", every: "5m" },
            users: ["alice"],
          }),
        },
      ]),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/scheduled-agents",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ slug: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].slug).toBe("for-alice");

    // The route MUST log the lookup failure at warn so a silent swallow
    // regression is caught (code-review M-2). Verify the operation key so
    // a future refactor that drops the log but keeps the fail-open branch
    // is caught by test rather than only in production log-diving.
    const warnCalls = (sshLogger.warn as Mock).mock.calls;
    const matched = warnCalls.find(
      ([, meta]) =>
        typeof meta === "object" &&
        meta !== null &&
        (meta as Record<string, unknown>).operation ===
          "scheduled_agents_list_username_lookup_threw",
    );
    expect(matched).toBeDefined();
  });

  it("case-sensitive comparison — 'Alice' does NOT match 'alice'", async () => {
    (getUsernameForUserId as Mock).mockResolvedValueOnce("alice");
    simpleDbSelectMock.mockResolvedValue([hostA]);
    execCommandMock.mockResolvedValue(
      makeRemoteStdout([
        {
          slug: "capital-a",
          body: JSON.stringify({
            name: "Capital A",
            prompt: "p",
            schedule: { type: "interval", every: "5m" },
            users: ["Alice"],
          }),
        },
      ]),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/scheduled-agents",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: unknown[] };
    expect(body.items).toHaveLength(0);
  });

  it("malformed users field (non-string entries) coerces to null → falls open", async () => {
    // specToRow is lenient: Array.isArray + every-string check → keep;
    // otherwise → null (falls open). Prevents a hand-edited garbage entry
    // from silently locking out every caller.
    (getUsernameForUserId as Mock).mockResolvedValueOnce("zoey");
    simpleDbSelectMock.mockResolvedValue([hostA]);
    execCommandMock.mockResolvedValue(
      makeRemoteStdout([
        {
          slug: "garbage-users",
          body: JSON.stringify({
            name: "Garbage",
            prompt: "p",
            schedule: { type: "interval", every: "5m" },
            users: ["alice", 42, null], // non-strings
          }),
        },
      ]),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/scheduled-agents",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ slug: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].slug).toBe("garbage-users");
  });

  it("LOCAL branch — users field is stripped from the response too", async () => {
    // Code-review M-3: every other gate/strip test exercises the REMOTE
    // branch. This pins that a caller-visible LOCAL row also has its users
    // field stripped before emit, so a future refactor that accidentally
    // scopes the strip to the REMOTE branch can't slip past the tests.
    (getUsernameForUserId as Mock).mockResolvedValueOnce("alice");
    isLocalHostIdMock.mockImplementation(
      (hostId: number | undefined) => hostId === 1,
    );
    resolveHostByIdMock.mockImplementation(async (hostId: number) => {
      if (hostId === 1) return hostSkynet;
      return null;
    });
    simpleDbSelectMock.mockResolvedValue([hostSkynet]);
    fsReaddirMock.mockResolvedValue(["for-alice-local"]);
    fsReadFileMock.mockImplementation(async (p: string) => {
      if (p.includes("for-alice-local")) {
        return JSON.stringify({
          name: "For Alice Local",
          prompt: "p",
          schedule: { type: "interval", every: "5m" },
          users: ["alice"],
        });
      }
      return "";
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/scheduled-agents",
    });
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].slug).toBe("for-alice-local");
    // Strip discipline holds on LOCAL branch too — no users leak on the wire.
    expect(body.items[0]).not.toHaveProperty("users");
  });
});
