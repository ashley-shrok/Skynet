/**
 * Tests for POST /conversation-search — Phase 122 Plan 122-02 Task 2.
 *
 * Route contract exhaustively tested (mocked SSH layer per host.session-kill.test.ts
 * discipline — vi.mock every I/O boundary, drive the handler via express + http.request):
 *
 *   T-01  empty JWT (mockUserId=null) → 401 from auth middleware
 *   T-02  { query: "" } → 200 { results: [], hasMore: false } — empty-query short-circuit
 *   T-03  aggregation across 2 mocked hosts with 3 identities each — up to 6 rows
 *   T-04  results sorted by transcriptMtime desc (recency-first, D-10)
 *   T-05  offset=1, limit=2 slices [1, 3) of the sorted aggregation
 *   T-06  one host's execCommand throws → other host's rows still returned
 *   T-07  one host's execCommand never resolves within PER_HOST_TIMEOUT_MS
 *          → that host contributes [] and endpoint still returns 200
 *   T-08  isArchived:true on rows from listArchivedIdentityKeysOnHost; false on live
 *   T-09  shell-injection safety: query with metacharacters does not create /tmp/OWNED-*
 *   T-10  query > MAX_QUERY_LEN (500) → 400 { error: "query_too_long" }
 *   T-11  every result row has all 10 fields expected by the frontend contract
 *
 * Scaffold mirrors identities.disk-read.test.ts + host.session-kill.test.ts:
 * bare Express + node http.request, vi.mock on every I/O boundary
 * (host-resolver, ssh-one-shot, tmux-helper, identity-artifact-reader,
 * discover-identity-session-file, list-archived-identity-keys, simple-db-ops).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Auth manager mock — flips between authenticated and 401 via mockUserId
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
// drizzle-orm mock — the route only imports `eq`, but be safe.
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
// SimpleDBOps mock — the caller-selected host list
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
// SSH mocks — resolveHostById + connectOneShot + execCommand
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
// Identity enumeration + discovery mocks
// ---------------------------------------------------------------------------

const listIdentityKeysOnHostMock = vi.fn();
const listArchivedIdentityKeysOnHostMock = vi.fn();
const discoverIdentitySessionFileMock = vi.fn();

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  listIdentityKeysOnHost: (conn: unknown) => listIdentityKeysOnHostMock(conn),
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
}));

vi.mock("../../claude-session/list-archived-identity-keys.js", () => ({
  listArchivedIdentityKeysOnHost: (conn: unknown) =>
    listArchivedIdentityKeysOnHostMock(conn),
}));

vi.mock(
  "../../claude-session/discover-identity-session-file.js",
  async () => {
    // Use the REAL pure helpers so the route's bulk-discovery path (which
    // composes buildDiscoveryScript + parseDiscoveryStdout +
    // __matchesIdentityFirstTurnForTests + RECORD_SEPARATOR) works against
    // the test fixtures. Only discoverIdentitySessionFile itself is mocked
    // (retained for any legacy call site; the current endpoint no longer
    // uses it after the bulk-discovery refactor).
    const actual = await vi.importActual<
      typeof import("../../claude-session/discover-identity-session-file.js")
    >("../../claude-session/discover-identity-session-file.js");
    return {
      ...actual,
      discoverIdentitySessionFile: (conn: unknown, identityKey: string) =>
        discoverIdentitySessionFileMock(conn, identityKey),
    };
  },
);

// Helper to build the discovery-script stdout format that
// parseDiscoveryStdout expects. Each record is
// `MTIME\tPATH\n<first-user-line>\n---GSDR-32---\n`. Records are
// concatenated. Callers pass mtime-desc rows for realism, though the
// route resorts defensively.
function makeDiscoveryStdout(
  records: Array<{ mtime: number; path: string; firstUserLine: string }>,
): string {
  const SEP = "---GSDR-32---";
  return records
    .map((r) => `${r.mtime}\t${r.path}\n${r.firstUserLine}\n${SEP}`)
    .join("\n") + (records.length > 0 ? "\n" : "");
}

// Helper to build a first-user-line that satisfies
// __matchesIdentityFirstTurnForTests for a given identity name. Format
// mirrors the shape Claude Code writes for a real /id invocation:
// `{"type":"user",...<command-name>/id</command-name>...<command-args>alice ...}`
function makeIdFirstUserLine(identityName: string): string {
  return `{"type":"user","message":{"role":"user","content":"<command-name>/id</command-name>\\n<command-args>${identityName}</command-args>"}}`;
}

// snippetForHit is a pure function — do NOT mock. The route's tests are
// integration-shaped: given real snippetForHit + mocked SSH stdout, we get
// realistic result rows.

// ---------------------------------------------------------------------------
// Import router AFTER all mocks are declared
// ---------------------------------------------------------------------------

import conversationSearchRoutes from "./conversation-search.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeFakeConn() {
  return { __fake: "ssh-conn", end: vi.fn() };
}

function httpPostJson(
  server: http.Server,
  urlPath: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        path: urlPath,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          let parsed: unknown = text;
          const ct = res.headers["content-type"] || "";
          if (typeof ct === "string" && ct.includes("application/json")) {
            try {
              parsed = JSON.parse(text);
            } catch {
              /* leave as text */
            }
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Build a fake grep-stdout emission. Format matches the route's shell script:
 *   <mtime>\t<path>\t<lineno>\t<raw-line>\n
 */
function fakeGrepOutput(
  hits: Array<{ mtime: number; path: string; lineno: number; rawLine: string }>,
): string {
  return (
    hits.map((h) => `${h.mtime}\t${h.path}\t${h.lineno}\t${h.rawLine}`).join("\n") +
    (hits.length > 0 ? "\n" : "")
  );
}

function jsonlLine(content: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content } });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "test-user";

  // Default: no hosts. Individual tests override.
  simpleDbSelectMock.mockResolvedValue([]);

  // Default resolver / connect / exec — will be overridden per-test.
  resolveHostByIdMock.mockResolvedValue({
    ip: "10.0.0.5",
    port: 22,
    username: "ubuntu",
    authType: "key",
    key: "fake-key",
  });
  connectOneShotMock.mockImplementation(async () => makeFakeConn());
  execCommandMock.mockResolvedValue("");
  listIdentityKeysOnHostMock.mockResolvedValue([]);
  listArchivedIdentityKeysOnHostMock.mockResolvedValue([]);
  discoverIdentitySessionFileMock.mockResolvedValue(null);

  const app = express();
  app.use("/conversation-search", conversationSearchRoutes);
  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

// ===========================================================================
// T-01: auth gate
// ===========================================================================

describe("POST /conversation-search — auth gate", () => {
  it("T-01: returns 401 when caller is unauthenticated", async () => {
    mockUserId = null;
    const res = await httpPostJson(server, "/conversation-search", {
      query: "anything",
    });
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// T-02: empty query short-circuit
// ===========================================================================

describe("POST /conversation-search — empty query short-circuit", () => {
  it("T-02: empty query returns 200 { results: [], hasMore: false } and does NOT fan out", async () => {
    simpleDbSelectMock.mockResolvedValue([
      { id: 1, name: "host-a", enableSsh: true, terminalConfig: null },
    ]);
    const res = await httpPostJson(server, "/conversation-search", {
      query: "",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [], hasMore: false });
    // Empty-query MUST short-circuit — no SSH work performed.
    expect(resolveHostByIdMock).not.toHaveBeenCalled();
    expect(connectOneShotMock).not.toHaveBeenCalled();
    expect(execCommandMock).not.toHaveBeenCalled();
  });

  it("T-02b: whitespace-only query is treated as empty (trimmed)", async () => {
    const res = await httpPostJson(server, "/conversation-search", {
      query: "   \t  ",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [], hasMore: false });
    expect(execCommandMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// T-03 / T-04 / T-08 / T-11: aggregation, sort, isArchived, row shape
// ===========================================================================

describe("POST /conversation-search — aggregation, sort, isArchived, row shape", () => {
  it("T-03/T-04/T-08/T-11: aggregates rows across 2 mocked hosts, sorts by mtime desc, flags isArchived per source, and emits all 11 fields per row", async () => {
    // Two SSH+autoTmux hosts
    simpleDbSelectMock.mockResolvedValue([
      { id: 1, name: "host-a", enableSsh: true, terminalConfig: JSON.stringify({ autoTmux: true }) },
      { id: 2, name: "host-b", enableSsh: true, terminalConfig: null },
    ]);

    // Live keys: 1 per host; archived keys: 1 per host
    listIdentityKeysOnHostMock.mockImplementation((_conn: unknown) => Promise.resolve(["alice"]));
    listArchivedIdentityKeysOnHostMock.mockImplementation((_conn: unknown) =>
      Promise.resolve(["bob"]),
    );

    // Bulk-discovery: each host's discovery script call returns records
    // for both alice and bob (with first-user-lines that satisfy the
    // identity-first-turn predicate). Grep call then returns the hits.
    // Distinguish call type by the script contents.
    const discoveryStdout = makeDiscoveryStdout([
      { mtime: 1000, path: "/home/ubuntu/.claude/projects/slug-alice/x.jsonl", firstUserLine: makeIdFirstUserLine("alice") },
      { mtime: 1000, path: "/home/ubuntu/.claude/projects/slug-bob/x.jsonl", firstUserLine: makeIdFirstUserLine("bob") },
    ]);
    let grepCallIdx = 0;
    execCommandMock.mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("find ~/.claude/projects")) {
        return discoveryStdout;
      }
      // Grep call — one per host, in order host-a then host-b
      grepCallIdx += 1;
      if (grepCallIdx === 1) {
        return fakeGrepOutput([
          { mtime: 100, path: "/home/ubuntu/.claude/projects/slug-alice/x.jsonl", lineno: 5, rawLine: jsonlLine("apple pie is good") },
          { mtime: 300, path: "/home/ubuntu/.claude/projects/slug-bob/x.jsonl", lineno: 9, rawLine: jsonlLine("apple pie tastes great") },
        ]);
      }
      return fakeGrepOutput([
        { mtime: 200, path: "/home/ubuntu/.claude/projects/slug-alice/x.jsonl", lineno: 3, rawLine: jsonlLine("apple varieties") },
        { mtime: 400, path: "/home/ubuntu/.claude/projects/slug-bob/x.jsonl", lineno: 7, rawLine: jsonlLine("apple orchard tour") },
      ]);
    });

    const res = await httpPostJson(server, "/conversation-search", {
      query: "apple",
    });

    expect(res.status).toBe(200);
    const body = res.body as { results: Array<Record<string, unknown>>; hasMore: boolean };
    expect(body.hasMore).toBe(false);

    // T-03: aggregate across BOTH hosts (2 live-hits + 2 archive-hits × 2 hosts = 4 rows,
    // but each host has 1 live + 1 archived identity so 4 total rows expected)
    expect(body.results).toHaveLength(4);

    // T-04: sorted by transcriptMtime desc — mtimes are seconds from the shell,
    // route converts to ms (×1000).
    const mtimes = body.results.map((r) => r.transcriptMtime as number);
    for (let i = 1; i < mtimes.length; i++) {
      expect(mtimes[i - 1]).toBeGreaterThanOrEqual(mtimes[i]);
    }
    // The largest mtime is 400 (host-b, bob/archived); *1000 = 400000
    expect(mtimes[0]).toBe(400_000);
    expect(mtimes[mtimes.length - 1]).toBe(100_000);

    // T-08: isArchived reflects source enumerator
    for (const row of body.results) {
      if (row.identityKey === "alice") expect(row.isArchived).toBe(false);
      if (row.identityKey === "bob") expect(row.isArchived).toBe(true);
    }

    // T-11: 11-field row shape (Plan 122-03 Task 1 forward-patch added
    // tmuxSessionName so AppShell.tsx can feed openTab's targetTmuxSession
    // option — see conversation-search.ts ConversationSearchResult docblock).
    const expectedFields = [
      "transcriptPath",
      "transcriptMtime",
      "identityKey",
      "hostId",
      "hostName",
      "aiTitle",
      "snippet",
      "hitStart",
      "hitLength",
      "isArchived",
      "tmuxSessionName",
    ];
    for (const row of body.results) {
      for (const field of expectedFields) {
        expect(row).toHaveProperty(field);
      }
    }

    // tmuxSessionName equals identityKey by fleet convention (directory
    // basename IS the tmux session name — see conversation-store.ts:906
    // and sessionMatchKey.toLowerCase).
    for (const row of body.results) {
      expect(row.tmuxSessionName).toBe(row.identityKey);
    }

    // aiTitle deferred (Task 2 <action> item 7) → always null in this task
    for (const row of body.results) {
      expect(row.aiTitle).toBeNull();
    }

    // hostName populated from the host row's name column
    expect(body.results.map((r) => r.hostName)).toContain("host-a");
    expect(body.results.map((r) => r.hostName)).toContain("host-b");

    // snippet is non-empty and includes the query text (or the ellipsis-windowed
    // window around it, but "apple" is short and present in every content)
    for (const row of body.results) {
      expect(typeof row.snippet).toBe("string");
      expect((row.snippet as string).toLowerCase()).toContain("apple");
    }
  });
});

// ===========================================================================
// T-05: offset/limit slicing
// ===========================================================================

describe("POST /conversation-search — offset/limit slicing", () => {
  it("T-05: offset=1, limit=2 returns rows [1..3) of the sorted aggregation and hasMore=true when more remain", async () => {
    simpleDbSelectMock.mockResolvedValue([
      { id: 1, name: "host-a", enableSsh: true, terminalConfig: null },
    ]);
    listIdentityKeysOnHostMock.mockResolvedValue(["a"]);
    listArchivedIdentityKeysOnHostMock.mockResolvedValue([]);

    // Bulk-discovery + grep response, routed by cmd contents
    const discoveryStdout = makeDiscoveryStdout([
      { mtime: 1000, path: "/x/a.jsonl", firstUserLine: makeIdFirstUserLine("a") },
    ]);
    execCommandMock.mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("find ~/.claude/projects")) return discoveryStdout;
      // 4 hits with mtimes 4, 3, 2, 1 (already sorted desc after route sort)
      return fakeGrepOutput([
        { mtime: 4, path: "/x/a.jsonl", lineno: 1, rawLine: jsonlLine("row A apple") },
        { mtime: 3, path: "/x/a.jsonl", lineno: 2, rawLine: jsonlLine("row B apple") },
        { mtime: 2, path: "/x/a.jsonl", lineno: 3, rawLine: jsonlLine("row C apple") },
        { mtime: 1, path: "/x/a.jsonl", lineno: 4, rawLine: jsonlLine("row D apple") },
      ]);
    });

    const res = await httpPostJson(server, "/conversation-search", {
      query: "apple",
      offset: 1,
      limit: 2,
    });
    expect(res.status).toBe(200);
    const body = res.body as { results: Array<Record<string, unknown>>; hasMore: boolean };
    expect(body.results).toHaveLength(2);
    // Rows [1..3) of desc-sorted 4-4-4-4 = mtimes 3000ms and 2000ms
    expect(body.results.map((r) => r.transcriptMtime)).toEqual([3_000, 2_000]);
    // 4 total > 1+2=3, hasMore should be true
    expect(body.hasMore).toBe(true);
  });

  it("T-05b: offset beyond total returns [] with hasMore=false", async () => {
    simpleDbSelectMock.mockResolvedValue([
      { id: 1, name: "host-a", enableSsh: true, terminalConfig: null },
    ]);
    listIdentityKeysOnHostMock.mockResolvedValue(["a"]);
    const discoveryStdoutB = makeDiscoveryStdout([
      { mtime: 1000, path: "/x/a.jsonl", firstUserLine: makeIdFirstUserLine("a") },
    ]);
    execCommandMock.mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("find ~/.claude/projects")) return discoveryStdoutB;
      return fakeGrepOutput([
        { mtime: 1, path: "/x/a.jsonl", lineno: 1, rawLine: jsonlLine("apple") },
      ]);
    });
    const res = await httpPostJson(server, "/conversation-search", {
      query: "apple",
      offset: 100,
      limit: 20,
    });
    expect(res.status).toBe(200);
    const body = res.body as { results: unknown[]; hasMore: boolean };
    expect(body.results).toEqual([]);
    expect(body.hasMore).toBe(false);
  });
});

// ===========================================================================
// T-06: per-host error isolation
// ===========================================================================

describe("POST /conversation-search — per-host error isolation", () => {
  it("T-06: one host's execCommand throws → other host's rows still returned", async () => {
    simpleDbSelectMock.mockResolvedValue([
      { id: 1, name: "host-a", enableSsh: true, terminalConfig: null },
      { id: 2, name: "host-b", enableSsh: true, terminalConfig: null },
    ]);
    listIdentityKeysOnHostMock.mockResolvedValue(["a"]);

    // Track per-host state via the mocked conn's identity. Each host's
    // execCommand chain is: 1 discovery, then 1 grep. host-a's first
    // execCommand (the discovery) throws; host-b returns discovery + grep.
    const discoveryStdout = makeDiscoveryStdout([
      { mtime: 1000, path: "/x/a.jsonl", firstUserLine: makeIdFirstUserLine("a") },
    ]);
    const connsThatHaveThrown = new WeakSet<object>();
    // First conn to be passed in is host-a's; second is host-b's.
    // Track which conns we've seen and throw on the first one's discovery.
    const seenConns = new Set<object>();
    let firstConn: object | null = null;
    execCommandMock.mockImplementation(async (conn: unknown, cmd: string) => {
      const connObj = conn as object;
      if (!seenConns.has(connObj)) {
        seenConns.add(connObj);
        if (firstConn === null) firstConn = connObj;
      }
      // Any call on firstConn (host-a) throws
      if (connObj === firstConn && !connsThatHaveThrown.has(connObj)) {
        connsThatHaveThrown.add(connObj);
        throw new Error("host-a exploded");
      }
      // host-b (or any subsequent conn) returns proper responses
      if (cmd.includes("find ~/.claude/projects")) return discoveryStdout;
      return fakeGrepOutput([
        { mtime: 5, path: "/x/a.jsonl", lineno: 1, rawLine: jsonlLine("apple survivor") },
      ]);
    });

    const res = await httpPostJson(server, "/conversation-search", { query: "apple" });
    expect(res.status).toBe(200);
    const body = res.body as { results: Array<Record<string, unknown>>; hasMore: boolean };
    // host-a contributed [] due to throw; host-b contributed 1 row
    expect(body.results).toHaveLength(1);
    expect(body.results[0].snippet).toContain("apple survivor");
  });
});

// ===========================================================================
// T-07: per-host timeout
// ===========================================================================

describe("POST /conversation-search — per-host timeout", () => {
  it("T-07: one host stalls forever → Promise.race times out that host and endpoint still returns 200", async () => {
    // Only ONE host — if it stalls indefinitely, the race must fire.
    simpleDbSelectMock.mockResolvedValue([
      { id: 1, name: "host-slow", enableSsh: true, terminalConfig: null },
      { id: 2, name: "host-fast", enableSsh: true, terminalConfig: null },
    ]);
    listIdentityKeysOnHostMock.mockImplementation(async (_conn: unknown) => ["a"]);

    // Track per-host conns. host-slow: discovery hangs forever.
    // host-fast: discovery + grep both return promptly.
    const discoveryStdout = makeDiscoveryStdout([
      { mtime: 1000, path: "/x/a.jsonl", firstUserLine: makeIdFirstUserLine("a") },
    ]);
    let firstConn: object | null = null;
    execCommandMock.mockImplementation(async (conn: unknown, cmd: string) => {
      const connObj = conn as object;
      if (firstConn === null) firstConn = connObj;
      if (connObj === firstConn) {
        // host-slow: any call hangs forever, exercising the per-host
        // Promise.race timeout branch
        return new Promise<string>(() => {
          /* hang forever */
        });
      }
      // host-fast: normal responses
      if (cmd.includes("find ~/.claude/projects")) return discoveryStdout;
      return fakeGrepOutput([
        { mtime: 5, path: "/x/a.jsonl", lineno: 1, rawLine: jsonlLine("apple fast") },
      ]);
    });

    // Test-only override — the real PER_HOST_TIMEOUT_MS is 30s. Route reads
    // process.env.CONVERSATION_SEARCH_PER_HOST_TIMEOUT_MS if set (test hook).
    process.env.CONVERSATION_SEARCH_PER_HOST_TIMEOUT_MS = "150";
    try {
      const res = await httpPostJson(server, "/conversation-search", {
        query: "apple",
      });
      expect(res.status).toBe(200);
      const body = res.body as { results: Array<Record<string, unknown>>; hasMore: boolean };
      // Only host-fast's row should survive
      expect(body.results).toHaveLength(1);
      expect(body.results[0].snippet).toContain("apple fast");
    } finally {
      delete process.env.CONVERSATION_SEARCH_PER_HOST_TIMEOUT_MS;
    }
  }, 10_000);
});

// ===========================================================================
// T-09: shell-injection safety
// ===========================================================================

describe("POST /conversation-search — shell-injection safety", () => {
  it("T-09: query with shell metacharacters produces no side effects (query is passed as argv, never interpolated into shell parser)", async () => {
    simpleDbSelectMock.mockResolvedValue([
      { id: 1, name: "host-a", enableSsh: true, terminalConfig: null },
    ]);
    listIdentityKeysOnHostMock.mockResolvedValue(["a"]);
    discoverIdentitySessionFileMock.mockResolvedValue("/x/a.jsonl");
    execCommandMock.mockResolvedValue("");

    const uniqueHex = `${Date.now().toString(16)}${Math.floor(Math.random() * 1e9).toString(16)}`;
    const canaryPath = `/tmp/OWNED-${uniqueHex}`;
    // Sanity: canary does not exist beforehand.
    expect(fs.existsSync(canaryPath)).toBe(false);
    // Malicious query
    const evil = `foo'; touch ${canaryPath}; #`;

    const res = await httpPostJson(server, "/conversation-search", { query: evil });
    // The endpoint should succeed (mocked exec returns "" — no rows)
    expect(res.status).toBe(200);

    // The canary MUST NOT exist. The mocked execCommand never actually runs a
    // shell, so this is a positive shape assertion — but the assertion that the
    // route composed the shell command with the query as an ARGV (not embedded
    // in the command string) is what makes this the load-bearing gate:
    expect(fs.existsSync(canaryPath)).toBe(false);

    // Positive-shape check: execCommand was called with a string that either
    // (a) contains the query in single-quote-wrapped-with-escaped-quotes form,
    // or (b) references the query as a positional argument. In neither case
    // should the raw metacharacters appear unquoted.
    if (execCommandMock.mock.calls.length > 0) {
      for (const call of execCommandMock.mock.calls) {
        const cmd = call[1] as string;
        // The raw `touch /tmp/OWNED-...; #` sequence MUST NOT appear as an
        // unquoted, active shell command. Either it's not in the string at all
        // (positional-arg case) or it's inside a single-quoted literal.
        // Weaker but robust check: the FULL evil string cannot appear
        // verbatim without being inside single-quote wrapping.
        if (cmd.includes(`touch ${canaryPath}`)) {
          // Then it MUST be inside single-quotes. Find the first occurrence
          // and check the character right before it is a single quote.
          const idx = cmd.indexOf(`touch ${canaryPath}`);
          // Walk back to find the nearest unescaped single-quote boundary.
          // A safe encoding will have `'` before this substring somewhere with
          // NO unescaped `'` in between.
          const preceding = cmd.slice(0, idx);
          // Count unescaped single-quotes in the preceding string. Odd count
          // means we're inside a single-quoted literal at this position.
          let count = 0;
          for (let i = 0; i < preceding.length; i++) {
            if (preceding[i] === "'" && preceding[i - 1] !== "\\") count += 1;
          }
          expect(count % 2).toBe(1); // inside quoted region
        }
      }
    }
  });
});

// ===========================================================================
// T-10: query length cap
// ===========================================================================

describe("POST /conversation-search — query length cap", () => {
  it("T-10: query > 500 chars returns 400 { error: 'query_too_long' }", async () => {
    const longQuery = "x".repeat(501);
    const res = await httpPostJson(server, "/conversation-search", {
      query: longQuery,
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "query_too_long" });
    // No SSH work performed
    expect(execCommandMock).not.toHaveBeenCalled();
  });

  it("T-10b: query exactly 500 chars is accepted", async () => {
    simpleDbSelectMock.mockResolvedValue([]);
    const q = "x".repeat(500);
    const res = await httpPostJson(server, "/conversation-search", {
      query: q,
    });
    expect(res.status).toBe(200);
  });
});
