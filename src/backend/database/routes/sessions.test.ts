/**
 * Regression test for the 2026-08-06 hotfix — Phase 25's mocked resolveRoleForIdentity
 * tests silently passed with the LOCAL-null-return behavior and missed the whole class of
 * bug. This test uses a real un-mocked resolveRoleForIdentity + fake SSH conn to exercise
 * the full 'list sessions → read frontmatter on same conn → attach role to row' path.
 *
 * Test coverage (4 tests — mirror plan Task 1 <behavior>):
 *   1: happy path — two sessions (poppy/patricia) get real roles from frontmatter
 *   2: missing frontmatter — one row returns role:null, other rows unaffected
 *   3: per-identity timeout — hung cat → role:null, good row keeps its role
 *   4: host-level failure — connectOneShot throws → host silently dropped (no rows)
 *
 * Design: resolveRoleForIdentity is NOT mocked. The fake conn's execCommand responds to
 * two command shapes: "tmux list-sessions ..." and "cat $HOME/.claude/identities/..." .
 * resolveRoleForIdentity calls execWithTimeout(conn, cmd) internally — which calls
 * execCommand on the passed conn — so the real frontmatter parse path is exercised.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth manager mock — passes through with canned userId "1"
// ---------------------------------------------------------------------------

vi.mock("../../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware: () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          (req as express.Request & { userId: string }).userId = "1";
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Mock SSH primitives and host resolver BEFORE importing module under test.
// NOTE: execCommand is mocked so we can control what the fake conn returns.
// resolveRoleForIdentity is NOT mocked — the test exercises the real function.
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

// execCommand is mocked at the module level; resolveRoleForIdentity uses it
// internally via execWithTimeout (also defined in identity-artifact-reader.ts).
// The mock here controls what comes back when the REAL resolveRoleForIdentity
// calls execCommand(conn, cmd) on the fake conn.
vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

// Phase 43 Plan 01: mock the discovery module so tests control the mtime-newest
// path returned per identity, can force null (Test 2), or reject/hang (Test 3).
// This keeps the tests focused on the route's dispatch + failure-isolation
// logic rather than re-testing the Phase 32 shell-script mechanism.
vi.mock("../../claude-session/discover-identity-session-file.js", () => ({
  discoverIdentitySessionFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock the db + SimpleDBOps layer. sessions.ts calls:
//   SimpleDBOps.select(db.select().from(hosts).where(...), "ssh_data", userId)
// We return two candidate hosts with autoTmux: true.
// ---------------------------------------------------------------------------

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../db/schema.js", () => ({
  hosts: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

const mockSimpleDBOpsSelect = vi.fn();
vi.mock("../../utils/simple-db-ops.js", () => ({
  SimpleDBOps: {
    select: (...args: unknown[]) => mockSimpleDBOpsSelect(...args),
  },
}));

// Mock logger to suppress noise
vi.mock("../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import mocked primitives AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { discoverIdentitySessionFile } from "../../claude-session/discover-identity-session-file.js";

const mockedDiscover = vi.mocked(discoverIdentitySessionFile);

// ---------------------------------------------------------------------------
// HTTP helper (mirrors roles-list-for-host.test.ts pattern)
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: { method: string; path: string; headers?: Record<string, string> },
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
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          let body: unknown;
          try { body = JSON.parse(data); } catch { body = data; }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Stub host records
// ---------------------------------------------------------------------------

const stubHostRecord = {
  id: 42,
  name: "box-a",
  ip: "10.0.0.42",
  enableSsh: true,
  terminalConfig: JSON.stringify({ autoTmux: true }),
};

const stubResolvedHost = {
  id: 42,
  ip: "10.0.0.42",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// ---------------------------------------------------------------------------
// JSONL fixture builders (Phase 43 Plan 01)
// Copied verbatim from ssh-poll-orchestrator.test.ts:969-1019 to keep the
// filter-symmetry assertion (Test 5) locked to the same shape the orchestrator
// scans. session-file-parser derives ts from the ISO `timestamp` field via
// Date.parse — same path both sites exercise.
// ---------------------------------------------------------------------------

function jsonlMessageLine(
  tsMillis: number,
  role: "user" | "assistant",
  content: string,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: role,
    message: { role, content },
    timestamp: new Date(tsMillis).toISOString(),
    uuid: `uuid-${tsMillis}-${role}`,
    ...overrides,
  });
}

// tool_use turns are ALWAYS parsed as `kind: "skip"` by parseSessionLine
// (message-content is an array of tool_use blocks with no text) — must NOT
// contribute to lastMessageAt.
function jsonlToolUseLine(tsMillis: number): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: `tool-${tsMillis}`,
          name: "Read",
          input: { file_path: "/tmp/x" },
        },
      ],
    },
    timestamp: new Date(tsMillis).toISOString(),
    uuid: `tool-uuid-${tsMillis}`,
  });
}

// Non-user/non-assistant type → parseSessionLine returns `kind: "skip"`.
function jsonlBackgroundTaskLine(tsMillis: number): string {
  return JSON.stringify({
    type: "background_task_start",
    task_id: `bg-${tsMillis}`,
    timestamp: new Date(tsMillis).toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Import router under test
// ---------------------------------------------------------------------------

import router from "./sessions.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();

  // Default: one candidate host
  mockSimpleDBOpsSelect.mockResolvedValue([stubHostRecord]);
  (resolveHostById as Mock).mockResolvedValue(stubResolvedHost);

  // Default: discovery returns null (dormant / no /id-first-turn JSONL).
  // Route emits lastMessageAt: null on every row. Tests that need a positive
  // discovery override with mockedDiscover.mockImplementation(...).
  mockedDiscover.mockResolvedValue(null);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeApp() {
  const app = express();
  app.use("/sessions", router);
  server = http.createServer(app);
  server.listen(0);
  return server;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /sessions/list — role resolution", () => {
  it("Test 1 (happy path): two sessions get real roles from frontmatter via same conn", async () => {
    // The fake conn: execCommand responds to list-sessions and per-identity cat
    const fakeConn = {
      end: vi.fn(),
      exec: vi.fn(),
    };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    let callCount = 0;
    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      callCount++;
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("poppy|1000\npatricia|2000");
      }
      if (cmd.includes("identities/poppy/poppy.md")) {
        return Promise.resolve("---\nrole: box-maintainer\n---\n# Poppy\n");
      }
      if (cmd.includes("identities/patricia/patricia.md")) {
        return Promise.resolve("---\nrole: chef\n---\n# Patricia\n");
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      sessionName: string;
      role: string | null;
      lastMessageAt: number | null;
    }>;
    expect(rows).toHaveLength(2);

    const poppy = rows.find((r) => r.sessionName === "poppy");
    expect(poppy?.role).toBe("box-maintainer");

    const patricia = rows.find((r) => r.sessionName === "patricia");
    expect(patricia?.role).toBe("chef");

    // Phase 43 Plan 01 — server always emits lastMessageAt. Default mockedDiscover
    // returns null (no /id-first-turn JSONL discovered), so both rows land with
    // lastMessageAt: null (matches Test 2's semantics in the new derivation describe).
    expect(poppy?.lastMessageAt).toBeNull();
    expect(patricia?.lastMessageAt).toBeNull();

    // Both list-sessions AND per-identity cat were called on the SAME conn instance
    expect(execCommand).toHaveBeenCalledWith(fakeConn, expect.stringContaining("tmux list-sessions"));
    expect(execCommand).toHaveBeenCalledWith(fakeConn, expect.stringContaining("identities/poppy/poppy.md"));
    expect(execCommand).toHaveBeenCalledWith(fakeConn, expect.stringContaining("identities/patricia/patricia.md"));
    // No second connectOneShot call for per-identity reads
    expect(connectOneShot).toHaveBeenCalledTimes(1);
  });

  it("Test 2 (missing frontmatter): bad frontmatter → role:null, other rows unaffected", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("poppy|1000\nephemeral-work|2000");
      }
      if (cmd.includes("identities/poppy/poppy.md")) {
        return Promise.resolve("---\nrole: box-maintainer\n---\n# Poppy\n");
      }
      if (cmd.includes("identities/ephemeral-work/ephemeral-work.md")) {
        // Return empty — no frontmatter (simulates missing identity file OR no role: key)
        return Promise.resolve("");
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      sessionName: string;
      role: string | null;
      lastMessageAt: number | null;
    }>;
    expect(rows).toHaveLength(2);

    const poppy = rows.find((r) => r.sessionName === "poppy");
    expect(poppy?.role).toBe("box-maintainer");

    const ephemeral = rows.find((r) => r.sessionName === "ephemeral-work");
    // ephemeral-work has no identity key matching IDENTITY_KEY_RE (contains '-')
    // OR its identity file has no frontmatter → resolveRoleForIdentity throws → role: null
    expect(ephemeral?.role).toBeNull();

    // Phase 43 Plan 01 — server always emits lastMessageAt on every row.
    expect(poppy?.lastMessageAt).toBeNull();
    expect(ephemeral?.lastMessageAt).toBeNull();
  });

  it("Test 3 (per-identity timeout): hung cat → role:null, good row keeps role, response bounded", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("poppy|1000\npatricia|2000");
      }
      if (cmd.includes("identities/poppy/poppy.md")) {
        // poppy hangs — returns a promise that never resolves
        return new Promise(() => undefined);
      }
      if (cmd.includes("identities/patricia/patricia.md")) {
        return Promise.resolve("---\nrole: chef\n---\n# Patricia\n");
      }
      return Promise.resolve("");
    });

    makeApp();

    // The response should return within a bounded time (not wait forever for poppy)
    const startMs = Date.now();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });
    const elapsedMs = Date.now() - startMs;

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      sessionName: string;
      role: string | null;
      lastMessageAt: number | null;
    }>;
    expect(rows).toHaveLength(2);

    const poppy = rows.find((r) => r.sessionName === "poppy");
    expect(poppy?.role).toBeNull(); // hung → timed out → role: null

    const patricia = rows.find((r) => r.sessionName === "patricia");
    expect(patricia?.role).toBe("chef"); // good row unaffected

    // Phase 43 Plan 01 — server always emits lastMessageAt on every row.
    expect(poppy?.lastMessageAt).toBeNull();
    expect(patricia?.lastMessageAt).toBeNull();

    // Should complete well within 2x PER_HOST_TIMEOUT_MS (3000ms), not hang indefinitely
    expect(elapsedMs).toBeLessThan(8000);
  });

  it("Test 4 (host-level failure): connectOneShot throws → host silently dropped, no rows", async () => {
    // connectOneShot throws (whole-host failure — pre-existing behavior preserved)
    (connectOneShot as Mock).mockRejectedValue(new Error("SSH connection refused"));

    // execCommand should never be called (conn was never opened)
    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    // No rows from the failed host (silently dropped at outer try/catch)
    // Phase 43 Plan 01: with an empty rows array there are no lastMessageAt
    // fields to assert — the "server always emits lastMessageAt on every row"
    // contract is satisfied vacuously (zero rows in the response).
    expect(res.body).toEqual([]);
    expect(execCommand).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 43 Plan 01 — /sessions/list lastMessageAt derivation coverage
//
// Mirrors the 6 test cases enumerated in 43-01-PLAN.md Task 1 <behavior>.
// discoverIdentitySessionFile is MOCKED here so these tests exercise the
// route's dispatch + per-session failure isolation, not the Phase 32 shell
// script (that's covered by discover-identity-session-file.test.ts).
// ---------------------------------------------------------------------------

describe("GET /sessions/list — lastMessageAt derivation", () => {
  // Path fixtures the mocked discoverIdentitySessionFile returns per identity.
  const TANYA_JSONL = "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/abc.jsonl";
  const TIFFANY_JSONL = "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tiffany/def.jsonl";

  it("Test 1 (happy path): two sessions each get numeric lastMessageAt from discovered JSONL tail", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    // Discovery: both identities hit a JSONL path.
    mockedDiscover.mockImplementation(async (_conn, identityName: string) => {
      if (identityName === "tanya") return TANYA_JSONL;
      if (identityName === "tiffany") return TIFFANY_JSONL;
      return null;
    });

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("tanya|1000\ntiffany|2000");
      }
      if (cmd.includes("identities/tanya/tanya.md")) {
        return Promise.resolve("---\nrole: box-maintainer\n---\n# Tanya\n");
      }
      if (cmd.includes("identities/tiffany/tiffany.md")) {
        return Promise.resolve("---\nrole: chef\n---\n# Tiffany\n");
      }
      if (cmd.includes(TANYA_JSONL)) {
        // tail -n 200 for tanya's JSONL — assistant message at ts=5000
        return Promise.resolve(
          jsonlMessageLine(5000, "assistant", "hi tanya") + "\n",
        );
      }
      if (cmd.includes(TIFFANY_JSONL)) {
        // tail -n 200 for tiffany's JSONL — user message at ts=7000
        return Promise.resolve(
          jsonlMessageLine(7000, "user", "hey tiffany") + "\n",
        );
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      sessionName: string;
      lastMessageAt: number | null;
    }>;
    expect(rows).toHaveLength(2);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.lastMessageAt).toBe(5000);

    const tiffany = rows.find((r) => r.sessionName === "tiffany");
    expect(tiffany?.lastMessageAt).toBe(7000);

    // Discovery called on the SAME conn for each identity.
    expect(mockedDiscover).toHaveBeenCalledWith(fakeConn, "tanya");
    expect(mockedDiscover).toHaveBeenCalledWith(fakeConn, "tiffany");
  });

  it("Test 2 (discovery returns null): dormant identity with no /id-first-turn JSONL → lastMessageAt:null, siblings unaffected", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    mockedDiscover.mockImplementation(async (_conn, identityName: string) => {
      if (identityName === "tanya") return TANYA_JSONL; // has a hit
      if (identityName === "tiffany") return null; // never invoked /id as first turn
      return null;
    });

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("tanya|1000\ntiffany|2000");
      }
      if (cmd.includes("identities/")) {
        return Promise.resolve("---\nrole: chef\n---\n# X\n");
      }
      if (cmd.includes(TANYA_JSONL)) {
        return Promise.resolve(
          jsonlMessageLine(9000, "assistant", "found me") + "\n",
        );
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      sessionName: string;
      lastMessageAt: number | null;
    }>;
    expect(rows).toHaveLength(2);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.lastMessageAt).toBe(9000);

    const tiffany = rows.find((r) => r.sessionName === "tiffany");
    expect(tiffany?.lastMessageAt).toBeNull();
  });

  it("Test 3 (discovery throws/hangs): rejected/timed-out discovery → lastMessageAt:null, siblings unaffected", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    mockedDiscover.mockImplementation(async (_conn, identityName: string) => {
      if (identityName === "tanya") {
        // Hang forever — the route's Promise.race(PER_HOST_TIMEOUT_MS) must reject.
        return new Promise<string | null>(() => undefined);
      }
      if (identityName === "tiffany") return TIFFANY_JSONL;
      return null;
    });

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("tanya|1000\ntiffany|2000");
      }
      if (cmd.includes("identities/")) {
        return Promise.resolve("---\nrole: chef\n---\n# X\n");
      }
      if (cmd.includes(TIFFANY_JSONL)) {
        return Promise.resolve(
          jsonlMessageLine(4200, "assistant", "sibling ok") + "\n",
        );
      }
      return Promise.resolve("");
    });

    makeApp();
    const startMs = Date.now();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });
    const elapsedMs = Date.now() - startMs;

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      sessionName: string;
      lastMessageAt: number | null;
    }>;
    expect(rows).toHaveLength(2);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.lastMessageAt).toBeNull(); // hung → timed out → null

    const tiffany = rows.find((r) => r.sessionName === "tiffany");
    expect(tiffany?.lastMessageAt).toBe(4200); // sibling unaffected

    // Bounded by PER_HOST_TIMEOUT_MS (3000ms).
    expect(elapsedMs).toBeLessThan(8000);
  }, 10000);

  it("Test 4 (tail zero message-bearing frames): tool_use-only JSONL → lastMessageAt:null", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    mockedDiscover.mockImplementation(async (_conn, identityName: string) => {
      if (identityName === "tanya") return TANYA_JSONL;
      return null;
    });

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("tanya|1000");
      }
      if (cmd.includes("identities/")) {
        return Promise.resolve("---\nrole: chef\n---\n# X\n");
      }
      if (cmd.includes(TANYA_JSONL)) {
        // ONLY tool_use lines — parseSessionLine returns kind:"skip" for each,
        // so scanTailForNewestMessageAt returns null.
        return Promise.resolve(
          jsonlToolUseLine(1000) + "\n" + jsonlToolUseLine(2000) + "\n",
        );
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      sessionName: string;
      lastMessageAt: number | null;
    }>;
    expect(rows).toHaveLength(1);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.lastMessageAt).toBeNull();
  });

  it("Test 5 (message-bearing filter): user + tool_use + assistant + bg-task → lastMessageAt = newest MESSAGE ts (tool_use + bg-task excluded)", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    mockedDiscover.mockImplementation(async (_conn, identityName: string) => {
      if (identityName === "tanya") return TANYA_JSONL;
      return null;
    });

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("tanya|1000");
      }
      if (cmd.includes("identities/")) {
        return Promise.resolve("---\nrole: chef\n---\n# X\n");
      }
      if (cmd.includes(TANYA_JSONL)) {
        // user_ts=1000, tool_use_ts=1500, assistant_ts=2000, bg_task_ts=2500
        // Expected: lastMessageAt=2000 (newest MESSAGE_BEARING_KINDS ts —
        // tool_use and background_task are kind:"skip" and excluded).
        const jsonl =
          jsonlMessageLine(1000, "user", "hi") +
          "\n" +
          jsonlToolUseLine(1500) +
          "\n" +
          jsonlMessageLine(2000, "assistant", "hey") +
          "\n" +
          jsonlBackgroundTaskLine(2500) +
          "\n";
        return Promise.resolve(jsonl);
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      sessionName: string;
      lastMessageAt: number | null;
    }>;
    expect(rows).toHaveLength(1);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.lastMessageAt).toBe(2000);
  });

  it("Test 6 (route always emits lastMessageAt): even when discovery yields null, every row has the field defined (not undefined)", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    // Default beforeEach: mockedDiscover.mockResolvedValue(null) — no override here.

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("tanya|1000\ntiffany|2000");
      }
      if (cmd.includes("identities/")) {
        return Promise.resolve("---\nrole: chef\n---\n# X\n");
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);

    // The route's contract: lastMessageAt is always PRESENT on every row.
    // Discovery-null path lands the field as null (not undefined, not absent).
    for (const row of rows) {
      expect("lastMessageAt" in row).toBe(true);
      expect(row.lastMessageAt).toBeNull();
    }
  });
});
