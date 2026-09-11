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
 * two command shapes: "tmux list-sessions ..." and "cat $HOME/fleet/identities/..." .
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

// Phase 85 (D-07): mock the identity-name-keyed send-log store so tests
// control what getIdentityLastSend returns per identity. Default resolution
// is null (cold cache — no stamps written yet, matching the D-09 first-ship
// contract). Individual Phase 85 tests override with mockResolvedValue /
// mockImplementation to exercise store-populated + throw-fail-open paths.
vi.mock("../../fleet-status/identity-send-log-store.js", () => ({
  getIdentityLastSend: vi.fn(async () => null),
}));

// Phase 89 Plan 04 (D-15): mock the relay-room-sessions store so tests
// control what listActiveRelayRoomSessions returns per user. Default
// resolution is [] (no active relay-room rows — matches the pre-Phase-89
// behavior where /sessions/list returned harness-only). Individual
// Phase 89-04 tests override with mockResolvedValue / mockRejectedValue
// to exercise the merge, DB-throw fallback, and no-regression scenarios.
vi.mock("../../relay-sessions/relay-room-sessions-store.js", () => ({
  listActiveRelayRoomSessions: vi.fn(async () => []),
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
import { getIdentityLastSend } from "../../fleet-status/identity-send-log-store.js";
import { listActiveRelayRoomSessions } from "../../relay-sessions/relay-room-sessions-store.js";

const mockedDiscover = vi.mocked(discoverIdentitySessionFile);
const mockedGetIdentityLastSend = vi.mocked(getIdentityLastSend);
const mockedListActiveRelayRoomSessions = vi.mocked(listActiveRelayRoomSessions);

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

// Phase 47 Plan 02 fixture — emit the harness `{"type":"ai-title","aiTitle":"…",
// "sessionId":"…"}` line shape (see 47-CONTEXT.md § Backend scraper mechanics).
// scanTailForLatestAiTitle in sessions.ts filters lines whose substring
// includes `"type":"ai-title"` then in-process JSON.parses to extract the
// aiTitle field.
function jsonlAiTitleLine(sessionId: string, aiTitle: string): string {
  return JSON.stringify({
    type: "ai-title",
    aiTitle,
    sessionId,
  });
}

// ---------------------------------------------------------------------------
// Import router under test
// ---------------------------------------------------------------------------

import router, { __scanTailForNewestMessageAtForTests } from "./sessions.js";

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

  // Phase 85 (D-07): default getIdentityLastSend returns null (cold cache).
  // vi.clearAllMocks() above wipes the mock's initial implementation from
  // the factory, so we must re-establish the default per-test.
  mockedGetIdentityLastSend.mockResolvedValue(null);

  // Phase 89 Plan 04 (D-15): default listActiveRelayRoomSessions returns []
  // (no active relay-room rows — matches the pre-Phase-89 behavior). Same
  // vi.clearAllMocks re-establishment requirement as getIdentityLastSend.
  mockedListActiveRelayRoomSessions.mockResolvedValue([]);
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
      aiTitle: string | null;
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

    // Phase 47 Plan 02 — server always emits aiTitle on every row. Default
    // mockedDiscover returns null → aiTitle field carries null (same contract
    // as lastMessageAt).
    expect(poppy?.aiTitle).toBeNull();
    expect(patricia?.aiTitle).toBeNull();

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
      aiTitle: string | null;
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

    // Phase 47 Plan 02 — server always emits aiTitle on every row.
    expect(poppy?.aiTitle).toBeNull();
    expect(ephemeral?.aiTitle).toBeNull();
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
      aiTitle: string | null;
    }>;
    expect(rows).toHaveLength(2);

    const poppy = rows.find((r) => r.sessionName === "poppy");
    expect(poppy?.role).toBeNull(); // hung → timed out → role: null

    const patricia = rows.find((r) => r.sessionName === "patricia");
    expect(patricia?.role).toBe("chef"); // good row unaffected

    // Phase 43 Plan 01 — server always emits lastMessageAt on every row.
    expect(poppy?.lastMessageAt).toBeNull();
    expect(patricia?.lastMessageAt).toBeNull();

    // Phase 47 Plan 02 — server always emits aiTitle on every row.
    expect(poppy?.aiTitle).toBeNull();
    expect(patricia?.aiTitle).toBeNull();

    // Should complete within ~PER_HOST_TIMEOUT_MS (30_000ms) + slack, not hang indefinitely.
    expect(elapsedMs).toBeLessThan(35_000);
  }, 40_000);

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
    // Phase 47 Plan 02: same vacuous satisfaction for the aiTitle contract —
    // zero rows means zero aiTitle fields to check.
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
        // Ashley 2026-08-23 lock: tanya's tail has only an assistant message —
        // excluded by isAshleyRealUserTurn; lastMessageAt is null.
        return Promise.resolve(
          jsonlMessageLine(5000, "assistant", "hi tanya") + "\n",
        );
      }
      if (cmd.includes(TIFFANY_JSONL)) {
        // User message at ts=7000 — KEEP (plain prose, type=user).
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
      aiTitle: string | null;
    }>;
    expect(rows).toHaveLength(2);

    // Phase 85 (D-07): lastMessageAt now sources from the send-log store
    // (getIdentityLastSend), NOT from the JSONL tail scan. This test's mock
    // does not populate the store, so both rows come back with
    // lastMessageAt: null regardless of tail content. The predicate-matrix
    // suite below asserts the retired scanner's contract directly via
    // __scanTailForNewestMessageAtForTests; store-lookup coverage lives in
    // the Phase 85 describe block below.
    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.lastMessageAt).toBeNull();

    const tiffany = rows.find((r) => r.sessionName === "tiffany");
    expect(tiffany?.lastMessageAt).toBeNull();

    // Phase 47 Plan 02 — server always emits aiTitle. Tail here has no
    // ai-title lines, so aiTitle is null on both rows.
    expect(tanya?.aiTitle).toBeNull();
    expect(tiffany?.aiTitle).toBeNull();

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
        // Ashley 2026-08-23 lock: assistant-only tail → null (excluded).
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
      aiTitle: string | null;
    }>;
    expect(rows).toHaveLength(2);

    // Ashley 2026-08-23 lock: tanya's tail has only an assistant message;
    // isAshleyRealUserTurn excludes it → lastMessageAt:null.
    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.lastMessageAt).toBeNull();

    const tiffany = rows.find((r) => r.sessionName === "tiffany");
    expect(tiffany?.lastMessageAt).toBeNull();

    // Phase 47 Plan 02 — no ai-title lines in either tail (tanya's tail has
    // only the message line; tiffany's discovery is null so tail never runs).
    expect(tanya?.aiTitle).toBeNull();
    expect(tiffany?.aiTitle).toBeNull();
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
        // Ashley 2026-08-23 lock: tiffany's tail has only an assistant message
        // ("sibling ok") — excluded by isAshleyRealUserTurn → lastMessageAt:null.
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
      aiTitle: string | null;
    }>;
    expect(rows).toHaveLength(2);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.lastMessageAt).toBeNull(); // hung → timed out → null

    // Ashley 2026-08-23 lock: tiffany's assistant message is excluded;
    // sibling isolation still holds but lastMessageAt is now null too.
    const tiffany = rows.find((r) => r.sessionName === "tiffany");
    expect(tiffany?.lastMessageAt).toBeNull();

    // Phase 47 Plan 02 — timeout on discovery cascades to aiTitle:null (same
    // catch block); sibling tail carries no ai-title lines so tiffany is null too.
    expect(tanya?.aiTitle).toBeNull();
    expect(tiffany?.aiTitle).toBeNull();

    // Bounded by PER_HOST_TIMEOUT_MS (30_000ms).
    expect(elapsedMs).toBeLessThan(35_000);
  }, 40_000);

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
      aiTitle: string | null;
    }>;
    expect(rows).toHaveLength(1);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.lastMessageAt).toBeNull();
    // Phase 47 Plan 02 — tool_use-only tail has no ai-title lines.
    expect(tanya?.aiTitle).toBeNull();
  });

  it("Test 5 (message-bearing filter): user + tool_use + assistant + bg-task → lastMessageAt = USER MSG ts (assistant excluded by Ashley 2026-08-23 lock)", async () => {
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
        // user_ts=1000, tool_use_ts=1500, assistant_ts=2000, bg_task_ts=2500.
        // Ashley 2026-08-23 lock: only the user turn at ts=1000 qualifies —
        // isAshleyRealUserTurn drops the assistant turn (ts=2000), tool_use
        // (kind:"skip" from parseSessionLine → dropped by predicate), and
        // background_task (type not "user" → dropped).
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
      aiTitle: string | null;
    }>;
    expect(rows).toHaveLength(1);

    // Phase 85 (D-07): lastMessageAt now sources from the send-log store,
    // NOT from the JSONL tail scan. The predicate-matrix suite below
    // asserts the retired scanner's contract at the byte level via
    // __scanTailForNewestMessageAtForTests. Store-lookup coverage lives
    // in the Phase 85 describe block appended at the tail of the file.
    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.lastMessageAt).toBeNull();
    // Phase 47 Plan 02 — mixed tail with no ai-title lines → aiTitle:null.
    expect(tanya?.aiTitle).toBeNull();
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
      // Phase 47 Plan 02 — same "always emits, null-when-unknown" contract
      // for aiTitle. Discovery-null cascades to aiTitle:null (same catch
      // block wipes both signals).
      expect("aiTitle" in row).toBe(true);
      expect(row.aiTitle).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// quick-260823-bap — Ashley 2026-08-23 lock predicate matrix
//
// Byte-parallel with ssh-poll-orchestrator.test.ts predicate-matrix describe
// block. Tested via the /sessions/list HTTP route (scanTailForNewestMessageAt
// as the observable) rather than the private predicate helper directly.
// ---------------------------------------------------------------------------

describe("isAshleyRealUserTurn — Ashley 2026-08-23 lock predicate matrix", () => {
  // Phase 85 (D-08): the /sessions/list route no longer calls
  // scanTailForNewestMessageAt on the lastMessageAt axis (source-swapped to
  // the send-log store). But the function definition + its
  // isAshleyRealUserTurn dependency stay alive in sessions.ts per the
  // byte-parallel-copy discipline with ssh-poll-orchestrator. This
  // predicate-matrix suite asserts the retired scanner's byte-level
  // contract via the test-only export `__scanTailForNewestMessageAtForTests`
  // (mirroring the pattern established in Phase 85-04 for the orchestrator
  // side). The helpers below call the export directly, bypassing the
  // orchestration layer that no longer exercises this code path.

  // Helper: run a single raw JSONL line through the byte-parallel scanner
  // and return the extracted newest ts (or null).
  async function scanSingleLine(rawLine: string): Promise<number | null> {
    return __scanTailForNewestMessageAtForTests(rawLine + "\n");
  }

  // Helper: run multiple raw JSONL lines through the byte-parallel scanner
  // and return the extracted newest ts (or null). Preserved as an async
  // function to keep test-body signatures unchanged.
  async function scanMultiLine(lines: string[]): Promise<number | null> {
    return __scanTailForNewestMessageAtForTests(lines.join("\n") + "\n");
  }

  it("Case 1 (KEEP — typed prose): user turn with plain-string prose content counts", async () => {
    const ts = Date.parse("2026-08-23T10:00:00.000Z");
    const rawLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: "Hello Amelia" },
      timestamp: "2026-08-23T10:00:00.000Z",
      uuid: "u1",
    });
    // Ashley 2026-08-23 lock: typed prose is a real message → KEEP.
    expect(await scanSingleLine(rawLine)).toBe(ts);
  });

  it("Case 2 (KEEP — slash-command invocation): user turn with <command- prefixed content counts", async () => {
    const ts = Date.parse("2026-08-23T10:01:00.000Z");
    const rawLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content:
          "<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>tina</command-args>",
      },
      timestamp: "2026-08-23T10:01:00.000Z",
      uuid: "u2",
    });
    // Starts with "<command-" → KEEP per predicate step 4a.
    expect(await scanSingleLine(rawLine)).toBe(ts);
  });

  it("Case 3 (DROP — task-notification wrapper): <task-notification>…</task-notification> must NOT count", async () => {
    const rawLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: "<task-notification>wakeup</task-notification>" },
      timestamp: "2026-08-23T10:02:00.000Z",
      uuid: "u3",
    });
    // Trimmed content starts with "<" and ends with ">" and does NOT start with
    // "<command-" → DROP per predicate step 4b.
    expect(await scanSingleLine(rawLine)).toBeNull();
  });

  it("Case 4 (DROP — system-reminder wrapper): <system-reminder>…</system-reminder> must NOT count", async () => {
    const rawLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: "<system-reminder>reminder body</system-reminder>" },
      timestamp: "2026-08-23T10:03:00.000Z",
      uuid: "u4",
    });
    // Same XML-wrapper shape → DROP.
    expect(await scanSingleLine(rawLine)).toBeNull();
  });

  it("Case 5 (DROP — tool_result list content, regression lock): list-content user turn must NOT count", async () => {
    const rawLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          { tool_use_id: "toolu_x", type: "tool_result", content: "...", is_error: false },
        ],
      },
      timestamp: "2026-08-23T10:04:00.000Z",
      uuid: "u5",
    });
    // content is an array → predicate step 3 (typeof !== "string") → DROP.
    expect(await scanSingleLine(rawLine)).toBeNull();
  });

  it("Case 6 (DROP — skill-body list-content injection, NEW exclusion): [{type:'text',text:'…'}] must NOT count", async () => {
    const rawLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "skill body..." }],
      },
      timestamp: "2026-08-23T10:05:00.000Z",
      uuid: "u6",
    });
    // pre-Aug-23 this was silently counted (MESSAGE_BEARING_KINDS included
    // "message" kind, and parseSessionLine returned kind:"message" for some
    // list-content user turns). Ashley 2026-08-23 lock: list content → DROP.
    expect(await scanSingleLine(rawLine)).toBeNull();
  });

  it("Case 7 (DROP — assistant turn + relay_outbound): assistant turns must NOT count", async () => {
    // Assertion 1: plain assistant reply.
    const rawAssistant = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: "reply" },
      timestamp: "2026-08-23T10:06:00.000Z",
      uuid: "u7",
    });
    expect(await scanSingleLine(rawAssistant)).toBeNull();

    // Assertion 2: assistant relay_outbound frame (curl -X PUT rooms/…/send/m.room.message shape).
    const rawRelayOutbound = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_relay",
            name: "Bash",
            input: {
              command:
                "curl -s -X PUT 'https://matrix.example.com/_matrix/client/v3/rooms/!abc:example.com/send/m.room.message/1' -d '{\"msgtype\":\"m.text\",\"body\":\"hello\"}'",
            },
          },
        ],
      },
      timestamp: "2026-08-23T10:07:00.000Z",
      uuid: "u7b",
    });
    expect(await scanSingleLine(rawRelayOutbound)).toBeNull();
  });

  it("Case 8 (DROP — Ctrl-C kill signal, 2026-08-29 refinement): control-chars-only content must NOT count", async () => {
    const rawLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: "\x03\x03" },
      timestamp: "2026-08-29T15:12:49.598Z",
      uuid: "u8",
    });
    // Supervisor-injected Ctrl-C kill signal — pure control-char payload → DROP.
    expect(await scanSingleLine(rawLine)).toBeNull();
  });

  it("Case 9 (DROP — /exit slash-command, 2026-08-29 refinement): agent-supervisor /exit command must NOT count", async () => {
    const rawLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content:
          "<command-name>/exit</command-name>\n            <command-message>exit</command-message>\n            <command-args></command-args>",
      },
      timestamp: "2026-08-29T15:13:00.000Z",
      uuid: "u9",
    });
    // Agent-supervisor /exit before recycle — contains <command-name>/exit</command-name> → DROP.
    expect(await scanSingleLine(rawLine)).toBeNull();
  });

  it("Case 10 (DROP — resumed-injection sentinel, 2026-08-29 refinement): supervisor resume sentinel must NOT count", async () => {
    const rawLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content:
          "Your session was just resumed by the agent-supervisor. Your background Monitors stopped with the previous session — start them again per the id skill.",
      },
      timestamp: "2026-08-29T15:14:00.000Z",
      uuid: "u10",
    });
    // Agent-supervisor resume sentinel — prefix matches the locked string → DROP.
    expect(await scanSingleLine(rawLine)).toBeNull();
  });

  it("2026-08-29 refinement — positive regression: real chat + real slash-command still count", async () => {
    // Real chat prose still returns the parsed ts.
    const tsChat = Date.parse("2026-08-29T16:00:00.000Z");
    const chatLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: "hey can you look at this thing" },
      timestamp: "2026-08-29T16:00:00.000Z",
      uuid: "pos-chat",
    });
    expect(await scanSingleLine(chatLine)).toBe(tsChat);

    // Real /id slash-command still returns the parsed ts.
    const tsCmd = Date.parse("2026-08-29T16:01:00.000Z");
    const cmdLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content:
          "<command-name>/id</command-name>\n            <command-message>id</command-message>\n            <command-args>tina</command-args>",
      },
      timestamp: "2026-08-29T16:01:00.000Z",
      uuid: "pos-cmd",
    });
    expect(await scanSingleLine(cmdLine)).toBe(tsCmd);
  });

  it("Mixed-tail integration: DROP lines interleaved with KEEP lines → newest KEEP ts returned", async () => {
    // Tail order: [Case5, Case7, Case3, Case1@T1, Case2@T2, Case8@T3] where T3 > T2 > T1.
    // Case8 (Ctrl-C kill signal) is NEWER than T2 — must still be dropped, returning T2.
    const T1 = Date.parse("2026-08-23T11:00:00.000Z");
    const T2 = Date.parse("2026-08-23T11:01:00.000Z");
    const T3 = Date.parse("2026-08-23T11:02:00.000Z");

    const case5Line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ tool_use_id: "toolu_x", type: "tool_result", content: "x", is_error: false }],
      },
      timestamp: "2026-08-23T10:55:00.000Z",
      uuid: "mix-c5",
    });
    const case7Line = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: "reply" },
      timestamp: "2026-08-23T10:56:00.000Z",
      uuid: "mix-c7",
    });
    const case3Line = JSON.stringify({
      type: "user",
      message: { role: "user", content: "<task-notification>wake</task-notification>" },
      timestamp: "2026-08-23T10:57:00.000Z",
      uuid: "mix-c3",
    });
    const case1Line = JSON.stringify({
      type: "user",
      message: { role: "user", content: "Hello Amelia" },
      timestamp: new Date(T1).toISOString(),
      uuid: "mix-c1",
    });
    const case2Line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: "<command-message>id</command-message>\n<command-name>/id</command-name>",
      },
      timestamp: new Date(T2).toISOString(),
      uuid: "mix-c2",
    });
    // Case 8 fixture (Ctrl-C kill signal) with timestamp NEWER than T2 — must be dropped.
    const case8Line = JSON.stringify({
      type: "user",
      message: { role: "user", content: "\x03\x03" },
      timestamp: new Date(T3).toISOString(),
      uuid: "mix-c8",
    });

    // T2 is the newest KEEP line — DROP lines (including Case8 newer than T2) must not interfere.
    expect(
      await scanMultiLine([case5Line, case7Line, case3Line, case1Line, case2Line, case8Line]),
    ).toBe(T2);
  });
});

// ---------------------------------------------------------------------------
// Phase 47 Plan 02 — /sessions/list aiTitle derivation coverage
//
// Mirrors the 7 test cases enumerated in 47-02-PLAN.md Task 1 <behavior>.
// discoverIdentitySessionFile is MOCKED here so these tests exercise the
// route's dispatch + per-session failure isolation for the new ai-title
// axis. scanTailForLatestAiTitle in sessions.ts filters lines containing
// the substring `"type":"ai-title"`, in-process JSON.parses each match,
// and returns the LAST match's aiTitle string (last-wins per CONTEXT.md).
//
// The tail buffer is shared between scanTailForNewestMessageAt and
// scanTailForLatestAiTitle — one `tail -c 262144` exec per session-row
// feeds BOTH signals (OPTION A per 47-02-PLAN.md Task 1 <action>).
// ---------------------------------------------------------------------------

describe("GET /sessions/list — aiTitle derivation (Phase 47 Plan 02)", () => {
  const TANYA_JSONL = "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/abc.jsonl";
  const TIFFANY_JSONL = "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tiffany/def.jsonl";

  it("Test 1 (happy path): single ai-title line in tail → row.aiTitle equals the string", async () => {
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
      if (cmd.includes("identities/tanya/tanya.md")) {
        return Promise.resolve("---\nrole: box-maintainer\n---\n# Tanya\n");
      }
      if (cmd.includes(TANYA_JSONL)) {
        return Promise.resolve(
          jsonlMessageLine(4000, "assistant", "hi") +
            "\n" +
            jsonlAiTitleLine("sess-tanya", "Fix bug X") +
            "\n",
        );
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      sessionName: string;
      aiTitle: string | null;
    }>;
    expect(rows).toHaveLength(1);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.aiTitle).toBe("Fix bug X");
  });

  it("Test 2 (last-wins on multiple ai-title lines): three ai-title lines → row.aiTitle equals the LAST one in file order", async () => {
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
        // Three ai-title lines — LAST one wins per CONTEXT.md § working-store
        // third axis (topic drifts across a session; last-wins reflects the
        // freshest topic).
        return Promise.resolve(
          jsonlAiTitleLine("sess-tanya", "Investigating segfault") +
            "\n" +
            jsonlMessageLine(1500, "user", "actually let's rebuild") +
            "\n" +
            jsonlAiTitleLine("sess-tanya", "Rebuilding parser") +
            "\n" +
            jsonlMessageLine(2500, "assistant", "done") +
            "\n" +
            jsonlAiTitleLine("sess-tanya", "Reviewing test coverage") +
            "\n",
        );
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      sessionName: string;
      aiTitle: string | null;
    }>;
    expect(rows).toHaveLength(1);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.aiTitle).toBe("Reviewing test coverage");
  });

  it("Test 3 (discovery-null cascade): one row has discovery success + ai-title, sibling has discovery null → sibling aiTitle:null, first row keeps string", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    mockedDiscover.mockImplementation(async (_conn, identityName: string) => {
      if (identityName === "tanya") return TANYA_JSONL;
      if (identityName === "tiffany") return null; // dormant
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
          jsonlAiTitleLine("sess-tanya", "Migrating auth flow") + "\n",
        );
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      sessionName: string;
      aiTitle: string | null;
    }>;
    expect(rows).toHaveLength(2);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.aiTitle).toBe("Migrating auth flow");

    const tiffany = rows.find((r) => r.sessionName === "tiffany");
    expect(tiffany?.aiTitle).toBeNull(); // discovery-null → no scan → null
  });

  it("Test 4 (no ai-title lines in tail): discovery succeeds, tail has messages + tool_use only → aiTitle:null", async () => {
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
        // Real messages + tool_use — NO ai-title lines.
        return Promise.resolve(
          jsonlMessageLine(1000, "user", "let's start") +
            "\n" +
            jsonlToolUseLine(1500) +
            "\n" +
            jsonlMessageLine(2000, "assistant", "on it") +
            "\n",
        );
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      sessionName: string;
      aiTitle: string | null;
    }>;
    expect(rows).toHaveLength(1);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.aiTitle).toBeNull();
  });

  it("Test 5 (malformed ai-title JSON): line matches substring but JSON.parse fails / missing aiTitle field → aiTitle:null, no throw", async () => {
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
        // Line 1: substring matches `"type":"ai-title"` but is not valid JSON
        //         (trailing garbage after the closing brace) — JSON.parse throws.
        // Line 2: valid JSON, matches `"type":"ai-title"` substring, but has
        //         no `aiTitle` field — filtered by the typeof check.
        // Line 3: valid JSON, matches, but aiTitle is a number (wrong type)
        //         — filtered by the typeof check.
        // Overall: zero valid ai-title lines → scanTailForLatestAiTitle
        // returns null → row.aiTitle = null.
        return Promise.resolve(
          `{"type":"ai-title","aiTitle":"malformed}} garbage\n` +
            JSON.stringify({ type: "ai-title", sessionId: "sess-tanya" }) +
            "\n" +
            JSON.stringify({ type: "ai-title", aiTitle: 42, sessionId: "sess-tanya" }) +
            "\n",
        );
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      sessionName: string;
      aiTitle: string | null;
    }>;
    expect(rows).toHaveLength(1);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    // No throw — malformed lines are silently skipped (matches Phase 44's
    // scanTailForNewestMessageAt best-effort semantics).
    expect(tanya?.aiTitle).toBeNull();
  });

  it("Test 6 (timeout): discovery hangs → Promise.race trips → aiTitle:null, sibling unaffected, response bounded", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    mockedDiscover.mockImplementation(async (_conn, identityName: string) => {
      if (identityName === "tanya") {
        // Hang forever — PER_HOST_TIMEOUT_MS trip on the recency-signal race.
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
          jsonlAiTitleLine("sess-tiffany", "Debugging websocket") + "\n",
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
      aiTitle: string | null;
    }>;
    expect(rows).toHaveLength(2);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    expect(tanya?.aiTitle).toBeNull(); // hung → race timed out → null

    const tiffany = rows.find((r) => r.sessionName === "tiffany");
    expect(tiffany?.aiTitle).toBe("Debugging websocket"); // sibling unaffected

    // Bounded by PER_HOST_TIMEOUT_MS (30_000ms).
    expect(elapsedMs).toBeLessThan(35_000);
  }, 40_000);

  it("Test 7 (contract lock): every row has aiTitle key present (server-always-emits, null-when-unknown)", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    // Default beforeEach: mockedDiscover.mockResolvedValue(null) — no override.

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("tanya|1000\ntiffany|2000\npatricia|3000");
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
    expect(rows).toHaveLength(3);

    // Phase 47 Plan 02 — aiTitle contract: present-on-every-row, null-when-unknown.
    for (const row of rows) {
      expect("aiTitle" in row).toBe(true);
      expect(row.aiTitle).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// quick-260821-m36 — connect vs discovery timeout split
// ─────────────────────────────────────────────────────────────────────────────
//
// Lock the split introduced in quick-260821-m36: `CONNECT_TIMEOUT_MS = 5_000`
// caps the TCP+SSH connect (`connectOneShot`) so an unreachable candidate host
// fails fast (was previously wrapped in the same 30_000 cap as the three
// post-connect discovery blocks — a phantom-host row with a stale IP would
// hang the /sessions/list wall-clock past the frontend's axios 30s ceiling).
// `PER_HOST_TIMEOUT_MS = 30_000` still wraps the three legitimate discovery
// Promise.race blocks (tmux list-sessions, per-session role resolve, per-
// session recency-signals derivation) — tanya's patch #477 30s rationale
// holds for those.
//
// The single test below asserts `connectOneShot` receives 5_000 (not 30_000).
// A future refactor that collapses the two constants back to one fails this
// test loudly BEFORE Ashley's cold-cache clients get stuck at "Loading agents…"
// again.
describe("GET /sessions/list — connect vs discovery timeout split (quick-260821-m36)", () => {
  it("connectOneShot receives CONNECT_TIMEOUT_MS (5_000), not PER_HOST_TIMEOUT_MS (30_000)", async () => {
    // Fake conn + fast happy path (mockedDiscover already returns null from
    // the beforeEach default → recency-signals block finishes immediately).
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    // list-sessions returns one row so the per-session Promise.all fires, but
    // the per-session role/recency blocks resolve fast (empty frontmatter +
    // discovery null default).
    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("s|1000");
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);

    // ── split lock ──────────────────────────────────────────────────────────
    // connectOneShot MUST be called with 5_000 (CONNECT_TIMEOUT_MS), not
    // 30_000 (PER_HOST_TIMEOUT_MS). If the two constants are ever collapsed
    // back into one, this assertion fires and points at quick-260821-m36.
    expect(connectOneShot).toHaveBeenCalled();
    expect((connectOneShot as Mock).mock.calls[0][1]).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// Phase 85 Plan 05 — /sessions/list lastMessageAt sourced from send-log store
//
// Round-trip coverage for the D-07 source-swap. The /sessions/list route is
// the initial-seed path AppShell reads on page-load to feed
// seedSessionLastMessageAt in the frontend working store. Plan 85-04 already
// swapped the WS-live orchestrator frame to the store; this plan does the
// same for the initial seed so both sources of truth converge from the
// moment the page paints (no ~2s flicker).
//
// The 5 test cases mirror the plan's <behavior> block:
//   85-05-01: no stamps → all rows lastMessageAt:null
//   85-05-02: stampIdentityLastSend("ivy", 9000) → ivy row.lastMessageAt = 9000
//             (other rows still null)
//   85-05-03: aiTitle unaffected by the swap (tail-scan pathway intact)
//   85-05-04: SSH tail timeout does NOT regress row.lastMessageAt (store
//             lookup is independent of the SSH pathway)
//   85-05-05: getIdentityLastSend throws → row.lastMessageAt:null,
//             siblings unaffected (fail-open on the per-row block)
// ---------------------------------------------------------------------------

describe("GET /sessions/list — lastMessageAt from send-log store (Phase 85 Plan 05)", () => {
  const TANYA_JSONL = "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/abc.jsonl";

  it("Test 85-05-01 (cold cache): no stamps in store → every row lastMessageAt:null", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    // Default beforeEach: mockedGetIdentityLastSend.mockResolvedValue(null).
    // Do not override — every getIdentityLastSend(name) returns null.
    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("ivy|1000\nlulabelle|2000\nstacy|3000");
      }
      if (cmd.includes("identities/")) {
        return Promise.resolve("---\nrole: chef\n---\n# X\n");
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
    expect(rows).toHaveLength(3);

    for (const row of rows) {
      expect(row.lastMessageAt).toBeNull();
    }

    // getIdentityLastSend was called once per row (SSH pathway succeeded, so
    // all three rows made it into the sendLogLookupBlock).
    expect(mockedGetIdentityLastSend).toHaveBeenCalledWith("ivy");
    expect(mockedGetIdentityLastSend).toHaveBeenCalledWith("lulabelle");
    expect(mockedGetIdentityLastSend).toHaveBeenCalledWith("stacy");
  });

  it("Test 85-05-02 (store populated): stamp of ivy → 9000 makes ivy row.lastMessageAt:9000, others null", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    // Simulate a prior stampIdentityLastSend("ivy", 9000) — the store returns
    // 9000 for ivy, null for everyone else.
    mockedGetIdentityLastSend.mockImplementation(
      async (identityName: string): Promise<number | null> => {
        if (identityName === "ivy") return 9000;
        return null;
      },
    );

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("ivy|1000\nlulabelle|2000");
      }
      if (cmd.includes("identities/")) {
        return Promise.resolve("---\nrole: chef\n---\n# X\n");
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

    const ivy = rows.find((r) => r.sessionName === "ivy");
    expect(ivy?.lastMessageAt).toBe(9000);

    const lulabelle = rows.find((r) => r.sessionName === "lulabelle");
    expect(lulabelle?.lastMessageAt).toBeNull();
  });

  it("Test 85-05-03 (aiTitle unaffected by swap): tail carries ai-title → row.aiTitle preserved alongside store-sourced lastMessageAt", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    // Store: tanya → 8500. AiTitle path unchanged; must still be scanned
    // from the JSONL tail.
    mockedGetIdentityLastSend.mockImplementation(
      async (identityName: string): Promise<number | null> => {
        if (identityName === "tanya") return 8500;
        return null;
      },
    );

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
        // Tail with a single ai-title line — scanTailForLatestAiTitle must
        // still fire and populate row.aiTitle.
        return Promise.resolve(
          jsonlAiTitleLine("sess-tanya", "Debugging websocket") + "\n",
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
      aiTitle: string | null;
    }>;
    expect(rows).toHaveLength(1);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    // Store-sourced lastMessageAt.
    expect(tanya?.lastMessageAt).toBe(8500);
    // Tail-sourced aiTitle (unaffected by D-07 swap).
    expect(tanya?.aiTitle).toBe("Debugging websocket");
  });

  it("Test 85-05-04 (SSH tail timeout does NOT null row.lastMessageAt): store lookup is independent of SSH pathway", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    // Store: tanya → 7777.
    mockedGetIdentityLastSend.mockImplementation(
      async (identityName: string): Promise<number | null> => {
        if (identityName === "tanya") return 7777;
        return null;
      },
    );

    // Discovery hangs — the recency-signals Promise.race trips and the
    // aiTitleBlock catches → row.aiTitle = null. row.lastMessageAt was
    // already set to 7777 by the independent sendLogLookupBlock.
    mockedDiscover.mockImplementation(async (_conn, identityName: string) => {
      if (identityName === "tanya") {
        return new Promise<string | null>(() => undefined); // hang forever
      }
      return null;
    });

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("tanya|1000");
      }
      if (cmd.includes("identities/")) {
        return Promise.resolve("---\nrole: chef\n---\n# X\n");
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
      aiTitle: string | null;
    }>;
    expect(rows).toHaveLength(1);

    const tanya = rows.find((r) => r.sessionName === "tanya");
    // The critical assertion: SSH timeout on the aiTitleBlock did NOT
    // regress row.lastMessageAt. Pre-D-07 this test would have failed
    // because the recency-signals catch wiped both signals to null.
    expect(tanya?.lastMessageAt).toBe(7777);
    // aiTitle IS null (SSH tail timed out).
    expect(tanya?.aiTitle).toBeNull();

    // Bounded by PER_HOST_TIMEOUT_MS (30_000ms).
    expect(elapsedMs).toBeLessThan(35_000);
  }, 40_000);

  it("Test 85-05-05 (store throws → fail-open, siblings unaffected): getIdentityLastSend throws for one identity → that row lastMessageAt:null, other rows keep their values", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    // ivy → throw; lulabelle → 4200; stacy → null.
    mockedGetIdentityLastSend.mockImplementation(
      async (identityName: string): Promise<number | null> => {
        if (identityName === "ivy") {
          throw new Error("simulated drizzle transient failure");
        }
        if (identityName === "lulabelle") return 4200;
        return null;
      },
    );

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("ivy|1000\nlulabelle|2000\nstacy|3000");
      }
      if (cmd.includes("identities/")) {
        return Promise.resolve("---\nrole: chef\n---\n# X\n");
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
    expect(rows).toHaveLength(3);

    const ivy = rows.find((r) => r.sessionName === "ivy");
    // Store throw → try/catch in sendLogLookupBlock caught → null (fail-open).
    expect(ivy?.lastMessageAt).toBeNull();

    const lulabelle = rows.find((r) => r.sessionName === "lulabelle");
    // Sibling unaffected by ivy's throw.
    expect(lulabelle?.lastMessageAt).toBe(4200);

    const stacy = rows.find((r) => r.sessionName === "stacy");
    expect(stacy?.lastMessageAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 89 Plan 04 (D-15) — /sessions/list merge with relay-room rows + kind marker
//
// The handler was extended to append active relay-room rows (from
// listActiveRelayRoomSessions) to the derived harness sessions list. Every
// item in the merged response carries a `kind` marker: 'harness' for the
// derived-tmux items, 'relay-room' for the appended stored-table items.
//
// D-01 scope anchor: the harness-derivation path is byte-identical to the
// pre-Phase-89 shape. The 6 tests below cover:
//   Test 1 — harness-only + kind='harness' marker on every row
//   Test 2 — relay-only (no autoTmux hosts) → kind='relay-room' rows only
//   Test 3 — merged (harness + relay) with correct kind on each partition
//   Test 4 — DB-throw fallback: listActiveRelayRoomSessions throws → harness rows
//            returned with 200 (best-effort merge, log-and-swallow)
//   Test 5 — timeout budget: relay lookup fires AFTER the Promise.all resolves
//            (no setTimeout wrapper, cheap in-process DB call)
//   Test 6 — no regression: existing harness-shape fields byte-identical, kind
//            is the ONLY added field
// ---------------------------------------------------------------------------

describe("GET /sessions/list — Phase 89 Plan 04 merge (D-15)", () => {
  const relayRowA = {
    id: "row-uuid-a",
    roomId: "!room-a:matrix.local",
    roomTitle: "Ashley + Taylor",
    lastActivityAt: "2026-09-08T14:30:00Z",
    createdAt: "2026-09-08T13:00:00Z",
    updatedAt: "2026-09-08T14:30:00Z",
  };
  const relayRowB = {
    id: "row-uuid-b",
    roomId: "!room-b:matrix.local",
    roomTitle: "planning-room",
    lastActivityAt: "2026-09-08T14:00:00Z",
    createdAt: "2026-09-08T12:00:00Z",
    updatedAt: "2026-09-08T14:00:00Z",
  };
  const relayRowC = {
    id: "row-uuid-c",
    roomId: "!room-c:matrix.local",
    roomTitle: null,
    lastActivityAt: null,
    createdAt: "2026-09-08T11:00:00Z",
    updatedAt: "2026-09-08T11:00:00Z",
  };

  it("Test 1 (harness-only + kind marker): 2 harness sessions, 0 relay rows → each carries kind='harness'", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);
    mockedListActiveRelayRoomSessions.mockResolvedValue([]);

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("poppy|1000\npatricia|2000");
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{ kind: string; sessionName?: string; id?: string }>;
    expect(rows).toHaveLength(2);
    // Every row carries the kind marker.
    expect(rows.every((r) => r.kind === "harness")).toBe(true);
    // Harness rows sorted by created DESC (patricia=2000 first, poppy=1000 second).
    expect(rows[0].sessionName).toBe("patricia");
    expect(rows[1].sessionName).toBe("poppy");
  });

  it("Test 2 (relay-only): 0 harness sessions, 3 relay rows → each carries kind='relay-room' with relay fields", async () => {
    // No autoTmux hosts → candidates array is empty → harness derivation yields 0 rows.
    mockSimpleDBOpsSelect.mockResolvedValue([]);
    mockedListActiveRelayRoomSessions.mockResolvedValue([
      relayRowA,
      relayRowB,
      relayRowC,
    ]);

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      kind: string;
      id?: string;
      roomId?: string;
      roomTitle?: string | null;
      lastActivityAt?: string | null;
      createdAt?: string;
      updatedAt?: string;
    }>;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.kind === "relay-room")).toBe(true);
    // Fields carried through from the store shape.
    expect(rows[0].id).toBe("row-uuid-a");
    expect(rows[0].roomId).toBe("!room-a:matrix.local");
    expect(rows[0].roomTitle).toBe("Ashley + Taylor");
    expect(rows[0].lastActivityAt).toBe("2026-09-08T14:30:00Z");
    expect(rows[0].createdAt).toBe("2026-09-08T13:00:00Z");
    expect(rows[0].updatedAt).toBe("2026-09-08T14:30:00Z");
    // Null-tolerant fields survive.
    expect(rows[2].roomTitle).toBeNull();
    expect(rows[2].lastActivityAt).toBeNull();
    // connectOneShot never called (no candidates).
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 3 (merged): 2 harness + 3 relay = 5-item response, harness first (sorted DESC), relay appended", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);
    mockedListActiveRelayRoomSessions.mockResolvedValue([
      relayRowA,
      relayRowB,
      relayRowC,
    ]);

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("poppy|1000\npatricia|2000");
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      kind: string;
      sessionName?: string;
      id?: string;
      created?: number;
    }>;
    expect(rows).toHaveLength(5);
    // First 2: harness rows, sorted by created DESC.
    expect(rows[0].kind).toBe("harness");
    expect(rows[0].sessionName).toBe("patricia");
    expect(rows[1].kind).toBe("harness");
    expect(rows[1].sessionName).toBe("poppy");
    // Last 3: relay rows appended in the store's input order.
    expect(rows[2].kind).toBe("relay-room");
    expect(rows[2].id).toBe("row-uuid-a");
    expect(rows[3].kind).toBe("relay-room");
    expect(rows[3].id).toBe("row-uuid-b");
    expect(rows[4].kind).toBe("relay-room");
    expect(rows[4].id).toBe("row-uuid-c");
  });

  it("Test 4 (DB-throw fallback): listActiveRelayRoomSessions rejects → response is harness rows only with 200", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);
    mockedListActiveRelayRoomSessions.mockRejectedValue(
      new Error("simulated relay-room-sessions DB failure"),
    );

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("poppy|1000\npatricia|2000");
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    // 200 (best-effort merge — do NOT fail the endpoint on relay side).
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ kind: string; sessionName?: string }>;
    // Harness rows returned; relay side silently swallowed.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "harness")).toBe(true);
    expect(rows.map((r) => r.sessionName).sort()).toEqual(["patricia", "poppy"]);
  });

  it("Test 5 (timeout budget): relay lookup fires AFTER Promise.all resolves — no setTimeout wrapper", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);
    mockedListActiveRelayRoomSessions.mockResolvedValue([]);

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("poppy|1000");
      }
      return Promise.resolve("");
    });

    makeApp();
    const startMs = Date.now();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });
    const elapsedMs = Date.now() - startMs;

    expect(res.status).toBe(200);
    // The relay lookup ran (mocked call recorded).
    expect(mockedListActiveRelayRoomSessions).toHaveBeenCalledWith("1");
    // In-process DB lookup is cheap; total elapsed must remain well within
    // the existing 30s per-host budget. Assert < 5s to prove no accidental
    // slow path (no setTimeout wrapper around the DB call).
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it("Test 6 (no regression on harness path): existing harness-shape fields byte-identical, kind is the ONLY added field", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);
    mockedListActiveRelayRoomSessions.mockResolvedValue([]);

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("poppy|1000");
      }
      if (cmd.includes("identities/poppy/poppy.md")) {
        return Promise.resolve("---\nrole: box-maintainer\n---\n# Poppy\n");
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const poppy = rows[0];
    // All Phase 44/47 harness fields present and unchanged.
    expect(poppy.hostId).toBe(42);
    expect(poppy.hostName).toBe("box-a");
    expect(poppy.sessionName).toBe("poppy");
    expect(poppy.created).toBe(1000);
    expect(poppy.role).toBe("box-maintainer");
    expect(poppy.lastMessageAt).toBeNull();
    expect(poppy.aiTitle).toBeNull();
    // The ONLY new field: kind.
    expect(poppy.kind).toBe("harness");
    // Sanity: no unexpected extra fields creep in beyond kind.
    const expectedKeys = new Set([
      "hostId",
      "hostName",
      "sessionName",
      "created",
      "role",
      "lastMessageAt",
      "aiTitle",
      "kind",
    ]);
    for (const key of Object.keys(poppy)) {
      expect(expectedKeys.has(key)).toBe(true);
    }
  });
});
