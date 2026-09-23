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
// Logger mock — silent. systemLogger added for Phase 129 gate-seam warn/debug
// assertions (search_gate_read_error / search_gate_hidden /
// search_gate_username_missing operations).
// ---------------------------------------------------------------------------

const { systemLoggerWarnMock, systemLoggerDebugMock } = vi.hoisted(() => ({
  systemLoggerWarnMock: vi.fn(),
  systemLoggerDebugMock: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  systemLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: systemLoggerWarnMock,
    debug: systemLoggerDebugMock,
  },
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

// Phase 129 Plan 129-04: readIdentityFile + readRoleFileByName mocks power
// the per-host batched gate-fetch (unique identityKeys → cosmetics + role).
// The mocks default to returning empty markdown; individual tests install
// per-identity frontmatter via mockSearchWithIdentityUsers(). vi.hoisted
// gives us a call-counter that survives vi.mock's factory hoisting so Test E
// can assert readIdentityFile is called O(unique keys) not O(hits).
const { readIdentityFileMock, readRoleFileByNameMock } = vi.hoisted(() => ({
  readIdentityFileMock: vi.fn(),
  readRoleFileByNameMock: vi.fn(),
}));

vi.mock(
  "../../claude-session/identity-artifact-reader.js",
  async () => {
    // Use the REAL extractCosmeticsFromFrontmatter + extractRoleFromMarkdown
    // pure parsers so the gate machinery reads the same markdown the route
    // does at runtime. Only the SSH readers are mocked.
    const actual = await vi.importActual<
      typeof import("../../claude-session/identity-artifact-reader.js")
    >("../../claude-session/identity-artifact-reader.js");
    return {
      ...actual,
      listIdentityKeysOnHost: (conn: unknown) => listIdentityKeysOnHostMock(conn),
      readIdentityFile: (conn: unknown, identityKey: string) =>
        readIdentityFileMock(conn, identityKey),
      readRoleFileByName: (conn: unknown, roleName: string) =>
        readRoleFileByNameMock(conn, roleName),
      IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
    };
  },
);

// Phase 129 Plan 129-04: getUsernameForUserId mock powers the per-request
// callerUsername resolution. Tests install per-mockUserId maps to route
// different callers ("ashley" vs "zoe") through the same handler.
const { getUsernameForUserIdMock } = vi.hoisted(() => ({
  getUsernameForUserIdMock: vi.fn(),
}));

vi.mock("../../utils/host-user-counter.js", () => ({
  getUsernameForUserId: (userId: string) => getUsernameForUserIdMock(userId),
  isHostMultiUser: vi.fn().mockResolvedValue(false),
}));

// Phase 129 Plan 129-04: use the REAL isIdentityVisibleToUser gate (Plan
// 129-01 pure function) rather than mocking — the D-2 intersection matrix
// is already exhaustively tested there, so tests here exercise the wiring
// through actual gate semantics. Zero-config: importActual returns the real
// module; no vi.mock override needed for identity-visibility-gate.js.

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

  // Phase 129 Plan 129-04 defaults: readIdentityFile returns empty markdown
  // (no frontmatter → cosmetics {} + role null → gate falls open per D-3).
  // Tests override to inject users:[...] frontmatter. Same discipline for
  // readRoleFileByName. getUsernameForUserId defaults to the pre-129
  // "test-user" so pre-129 tests are unaffected.
  readIdentityFileMock.mockResolvedValue({ markdown: "" });
  readRoleFileByNameMock.mockResolvedValue({ markdown: "" });
  getUsernameForUserIdMock.mockResolvedValue("test-user");
  systemLoggerWarnMock.mockReset();
  systemLoggerDebugMock.mockReset();

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
    listIdentityKeysOnHostMock.mockResolvedValue(["a", "b", "c", "d"]);
    listArchivedIdentityKeysOnHostMock.mockResolvedValue([]);

    // Bulk-discovery + grep response, routed by cmd contents. Four
    // distinct identity → transcript mappings so dedup-by-path leaves
    // all four rows in the result set. (Same-path hits are collapsed
    // post-fix per the "one row per conversation" rule.)
    const discoveryStdout = makeDiscoveryStdout([
      { mtime: 1000, path: "/x/a.jsonl", firstUserLine: makeIdFirstUserLine("a") },
      { mtime: 1000, path: "/x/b.jsonl", firstUserLine: makeIdFirstUserLine("b") },
      { mtime: 1000, path: "/x/c.jsonl", firstUserLine: makeIdFirstUserLine("c") },
      { mtime: 1000, path: "/x/d.jsonl", firstUserLine: makeIdFirstUserLine("d") },
    ]);
    execCommandMock.mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("find ~/.claude/projects")) return discoveryStdout;
      // 4 hits, distinct paths, mtimes 4, 3, 2, 1 (sorted desc after route sort)
      return fakeGrepOutput([
        { mtime: 4, path: "/x/a.jsonl", lineno: 1, rawLine: jsonlLine("row A apple") },
        { mtime: 3, path: "/x/b.jsonl", lineno: 1, rawLine: jsonlLine("row B apple") },
        { mtime: 2, path: "/x/c.jsonl", lineno: 1, rawLine: jsonlLine("row C apple") },
        { mtime: 1, path: "/x/d.jsonl", lineno: 1, rawLine: jsonlLine("row D apple") },
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

// ===========================================================================
// Phase 129 Plan 129-04: search-surface visibility gate (D-7 seam #4)
// ===========================================================================
//
// Tests for the D-2 intersection gate applied AFTER runOneHost returns raw
// hits and BEFORE they flatten into the response. Design constraints:
//   - Batched frontmatter fetch: O(unique identityKeys in the result page),
//     bounded by DEFAULT_LIMIT (Pitfall 4). Verified by Test E's read-
//     count assertion on the readIdentityFile mock.
//   - FAIL-CLOSED on frontmatter read error (Phase 129 exception per
//     PATTERNS.md § "Read-path fail-open, write-path fail-closed"). Search
//     hits are information-disclosure surfaces: a leaked hit for a hidden
//     identity is more visible than a dropped hit. Verified by Test F.
//   - FAIL-OPEN on null callerUsername (unknown/orphaned JWT userId). A
//     null caller is an infra bug, not a gate signal; treating it as "hide
//     everything" would empty every user's search results. Verified by
//     Test G.
//   - Archive branch honors the same gate (Test D).

describe("Phase 129: search-surface visibility gate", () => {
  // -------------------------------------------------------------------------
  // Fixture helpers
  // -------------------------------------------------------------------------

  /**
   * mockSearchWithIdentityUsers — build a per-identity frontmatter fixture.
   * Wires readIdentityFileMock + readRoleFileByNameMock so that when the
   * gate machinery asks for identityKey's markdown, it gets the crafted
   * users:[...] YAML block. roleName / roleUsers are optional; when
   * supplied, the identity file's frontmatter carries role: <roleName>
   * and readRoleFileByNameMock returns a matching role file with its own
   * users: list.
   *
   * Layered: multiple calls before firing a request build a map
   * (identityKey → frontmatter) so heterogeneous batches work correctly.
   */
  const identityFrontmatterMap = new Map<string, string>();
  const roleFrontmatterMap = new Map<string, string>();

  function mockSearchWithIdentityUsers(
    identityKey: string,
    opts: {
      identityUsers?: string[];
      roleName?: string;
      roleUsers?: string[];
    } = {},
  ): void {
    const { identityUsers, roleName, roleUsers } = opts;
    const identityLines: string[] = ["---"];
    if (typeof roleName === "string" && roleName.length > 0) {
      identityLines.push(`role: ${roleName}`);
    }
    if (Array.isArray(identityUsers) && identityUsers.length > 0) {
      identityLines.push(
        `users: [${identityUsers.map((u) => JSON.stringify(u)).join(", ")}]`,
      );
    }
    identityLines.push("---", "", `# ${identityKey}`, "");
    identityFrontmatterMap.set(identityKey, identityLines.join("\n"));

    if (typeof roleName === "string" && roleName.length > 0) {
      const roleLines: string[] = ["---"];
      if (Array.isArray(roleUsers) && roleUsers.length > 0) {
        roleLines.push(
          `users: [${roleUsers.map((u) => JSON.stringify(u)).join(", ")}]`,
        );
      }
      roleLines.push("---", "", `# role: ${roleName}`, "");
      roleFrontmatterMap.set(roleName, roleLines.join("\n"));
    }

    readIdentityFileMock.mockImplementation(async (_conn: unknown, key: string) => ({
      markdown: identityFrontmatterMap.get(key) ?? "",
    }));
    readRoleFileByNameMock.mockImplementation(
      async (_conn: unknown, name: string) => ({
        markdown: roleFrontmatterMap.get(name) ?? "",
      }),
    );
  }

  /**
   * mockSearchHits — install exec-command stubs so runOneHost yields the
   * given (identityKey → hits) map on the single host. Discovery stdout is
   * assembled from the identityKeys and paths; grep stdout is assembled
   * from the hits. Assumes ONE host in simpleDbSelectMock.
   */
  function mockSearchHits(
    hits: Array<{ identityKey: string; mtime: number; content: string; isArchived?: boolean }>,
  ): void {
    // Discovery records: one per identityKey → deterministic path per key.
    const seen = new Set<string>();
    const discoveryRecords: Array<{
      mtime: number;
      path: string;
      firstUserLine: string;
    }> = [];
    for (const h of hits) {
      if (seen.has(h.identityKey)) continue;
      seen.add(h.identityKey);
      discoveryRecords.push({
        mtime: 5000,
        path: `/x/${h.identityKey}.jsonl`,
        firstUserLine: makeIdFirstUserLine(h.identityKey),
      });
    }
    const discoveryStdout = makeDiscoveryStdout(discoveryRecords);

    const grepOut = fakeGrepOutput(
      hits.map((h) => ({
        mtime: h.mtime,
        path: `/x/${h.identityKey}.jsonl`,
        lineno: 1,
        rawLine: jsonlLine(h.content),
      })),
    );

    // Feed listIdentityKeysOnHost (live) + listArchivedIdentityKeysOnHost
    // per hit.isArchived so pathIndex.isArchived tracks correctly.
    const liveKeys: string[] = [];
    const archivedKeys: string[] = [];
    for (const h of hits) {
      const arr = h.isArchived === true ? archivedKeys : liveKeys;
      if (!arr.includes(h.identityKey)) arr.push(h.identityKey);
    }
    listIdentityKeysOnHostMock.mockResolvedValue(liveKeys);
    listArchivedIdentityKeysOnHostMock.mockResolvedValue(archivedKeys);

    execCommandMock.mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("find ~/.claude/projects")) return discoveryStdout;
      return grepOut;
    });
  }

  /**
   * mockReadIdentityFileCounter — reset + return a getter for the number
   * of times readIdentityFileMock was invoked. Test E asserts the gate's
   * batched-lookup discipline: ≤ 1 read per UNIQUE identityKey (Pitfall 4).
   */
  function mockReadIdentityFileCounter(): () => number {
    // The mock's own call count is the counter; caller reads it after the
    // request. Wrap to make the intent audit-visible via grep.
    return () => readIdentityFileMock.mock.calls.length;
  }

  beforeEach(() => {
    identityFrontmatterMap.clear();
    roleFrontmatterMap.clear();
    // Default: single SSH+autoTmux host so tests can just install hits.
    simpleDbSelectMock.mockResolvedValue([
      { id: 1, name: "host-a", enableSsh: true, terminalConfig: null },
    ]);
  });

  // -------------------------------------------------------------------------
  // Test A — single-user host, no gate → zero regression
  // -------------------------------------------------------------------------

  it("Test A: single-user host with no users:[] on any identity — all hits surface for both callers (D-3 fallback preserved)", async () => {
    mockSearchWithIdentityUsers("muffin"); // no users, no role
    mockSearchWithIdentityUsers("scone"); // no users, no role
    mockSearchHits([
      { identityKey: "muffin", mtime: 200, content: "cheese platter" },
      { identityKey: "scone", mtime: 100, content: "cheese and crackers" },
    ]);

    // Caller Ashley
    mockUserId = "uid-ashley";
    getUsernameForUserIdMock.mockResolvedValue("ashley");

    const res = await httpPostJson(server, "/conversation-search", {
      query: "cheese",
    });
    expect(res.status).toBe(200);
    const body = res.body as { results: Array<Record<string, unknown>>; hasMore: boolean };
    expect(body.results).toHaveLength(2);
    const keys = body.results.map((r) => r.identityKey).sort();
    expect(keys).toEqual(["muffin", "scone"]);
  });

  // -------------------------------------------------------------------------
  // Test B — multi-user host, identity users:[ashley] → Zoe filtered
  // -------------------------------------------------------------------------

  it("Test B: identity users:[ashley] — Ashley sees muffin hit; Zoe sees ZERO hits from muffin (D-7 no leak)", async () => {
    mockSearchWithIdentityUsers("muffin", { identityUsers: ["ashley"] });
    mockSearchWithIdentityUsers("scone"); // ungated, both see
    mockSearchHits([
      { identityKey: "muffin", mtime: 200, content: "cheese platter" },
      { identityKey: "scone", mtime: 100, content: "cheese and crackers" },
    ]);

    // Ashley: both muffin + scone
    mockUserId = "uid-ashley";
    getUsernameForUserIdMock.mockResolvedValue("ashley");
    const ashleyRes = await httpPostJson(server, "/conversation-search", {
      query: "cheese",
    });
    expect(ashleyRes.status).toBe(200);
    const ashleyBody = ashleyRes.body as {
      results: Array<Record<string, unknown>>;
    };
    const ashleyKeys = ashleyBody.results.map((r) => r.identityKey).sort();
    expect(ashleyKeys).toEqual(["muffin", "scone"]);

    // Zoe: only scone; muffin FILTERED because users:[ashley] excludes her.
    mockUserId = "uid-zoe";
    getUsernameForUserIdMock.mockResolvedValue("zoe");
    const zoeRes = await httpPostJson(server, "/conversation-search", {
      query: "cheese",
    });
    expect(zoeRes.status).toBe(200);
    const zoeBody = zoeRes.body as {
      results: Array<Record<string, unknown>>;
    };
    const zoeKeys = zoeBody.results.map((r) => r.identityKey);
    expect(zoeKeys).toEqual(["scone"]);
    expect(zoeKeys).not.toContain("muffin");
  });

  // -------------------------------------------------------------------------
  // Test C — role users:[ashley], identity untagged → Zoe filtered (D-2)
  // -------------------------------------------------------------------------

  it("Test C: role users:[ashley] (identity untagged) — Zoe sees ZERO hits under that role (D-2 role-side gate closes)", async () => {
    mockSearchWithIdentityUsers("muffin", {
      roleName: "coordinator",
      roleUsers: ["ashley"],
    });
    mockSearchHits([
      { identityKey: "muffin", mtime: 200, content: "cheese platter" },
    ]);

    // Ashley sees it
    mockUserId = "uid-ashley";
    getUsernameForUserIdMock.mockResolvedValue("ashley");
    const ashleyRes = await httpPostJson(server, "/conversation-search", {
      query: "cheese",
    });
    const ashleyBody = ashleyRes.body as {
      results: Array<Record<string, unknown>>;
    };
    expect(ashleyBody.results.map((r) => r.identityKey)).toEqual(["muffin"]);

    // Zoe does not (role gate closes)
    mockUserId = "uid-zoe";
    getUsernameForUserIdMock.mockResolvedValue("zoe");
    const zoeRes = await httpPostJson(server, "/conversation-search", {
      query: "cheese",
    });
    const zoeBody = zoeRes.body as {
      results: Array<Record<string, unknown>>;
    };
    expect(zoeBody.results).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test D — archive branch also gated
  // -------------------------------------------------------------------------

  it("Test D: archived identity file with users:[ashley] — Zoe's archive-branch search returns ZERO hits from that identity", async () => {
    mockSearchWithIdentityUsers("stale-muffin", { identityUsers: ["ashley"] });
    mockSearchHits([
      {
        identityKey: "stale-muffin",
        mtime: 500,
        content: "cheese archived",
        isArchived: true,
      },
    ]);

    // Ashley sees the archived hit
    mockUserId = "uid-ashley";
    getUsernameForUserIdMock.mockResolvedValue("ashley");
    const ashleyRes = await httpPostJson(server, "/conversation-search", {
      query: "cheese",
    });
    const ashleyBody = ashleyRes.body as {
      results: Array<Record<string, unknown>>;
    };
    expect(ashleyBody.results).toHaveLength(1);
    expect(ashleyBody.results[0].identityKey).toBe("stale-muffin");
    expect(ashleyBody.results[0].isArchived).toBe(true);

    // Zoe does not — archive branch honors the SAME gate as the live branch
    mockUserId = "uid-zoe";
    getUsernameForUserIdMock.mockResolvedValue("zoe");
    const zoeRes = await httpPostJson(server, "/conversation-search", {
      query: "cheese",
    });
    const zoeBody = zoeRes.body as {
      results: Array<Record<string, unknown>>;
    };
    expect(zoeBody.results).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test E — batched-lookup counter (Pitfall 4 O(unique keys) discipline)
  // -------------------------------------------------------------------------

  it("Test E: 20 hits across 3 unique identityKeys → readIdentityFile called ≤ 3 times (batched O(unique-keys) discipline)", async () => {
    mockSearchWithIdentityUsers("alpha");
    mockSearchWithIdentityUsers("beta");
    mockSearchWithIdentityUsers("gamma");
    // 20 hits round-robin across the 3 keys — dedup-by-path collapses hits
    // per-file to one row, so we build 3 discovery records but many grep
    // hits per file. The gate's UNIQUE-key discipline is what we're
    // asserting: even before dedup collapses rows, the gate MUST fetch
    // per-unique-key not per-hit.
    const hits: Array<{ identityKey: string; mtime: number; content: string }> = [];
    for (let i = 0; i < 20; i++) {
      const key = ["alpha", "beta", "gamma"][i % 3];
      hits.push({ identityKey: key, mtime: 1000 - i, content: `cheese ${i}` });
    }
    mockSearchHits(hits);

    mockUserId = "uid-ashley";
    getUsernameForUserIdMock.mockResolvedValue("ashley");

    const readCount = mockReadIdentityFileCounter();
    const res = await httpPostJson(server, "/conversation-search", {
      query: "cheese",
    });
    expect(res.status).toBe(200);
    // The gate MUST have fetched frontmatter per UNIQUE key (≤ 3),
    // never per hit (which would be 20). Equality is the strict form;
    // ≤ 3 permits any legitimate deduping.
    expect(readCount()).toBeLessThanOrEqual(3);
  });

  // -------------------------------------------------------------------------
  // Test F — FAIL-CLOSED on read error (Phase 129 exception)
  // -------------------------------------------------------------------------

  it("Test F: readIdentityFile throws for muffin → muffin hits are DROPPED (fail-CLOSED per PATTERNS.md exception) + search_gate_read_error warn logged", async () => {
    // scone reads normally; muffin's frontmatter read throws
    mockSearchWithIdentityUsers("scone");
    mockSearchHits([
      { identityKey: "muffin", mtime: 200, content: "cheese platter" },
      { identityKey: "scone", mtime: 100, content: "cheese and crackers" },
    ]);
    readIdentityFileMock.mockImplementation(async (_conn: unknown, key: string) => {
      if (key === "muffin") {
        throw new Error("permission denied on identity file read");
      }
      return { markdown: identityFrontmatterMap.get(key) ?? "" };
    });

    mockUserId = "uid-ashley";
    getUsernameForUserIdMock.mockResolvedValue("ashley");

    const res = await httpPostJson(server, "/conversation-search", {
      query: "cheese",
    });
    expect(res.status).toBe(200);
    const body = res.body as { results: Array<Record<string, unknown>> };
    // muffin was DROPPED (fail-closed) — Ashley sees only scone
    const keys = body.results.map((r) => r.identityKey);
    expect(keys).not.toContain("muffin");
    expect(keys).toContain("scone");

    // structured warn log MUST fire with operation:"search_gate_read_error"
    const warnCalls = systemLoggerWarnMock.mock.calls;
    const gateErrorWarn = warnCalls.find((c) => {
      const meta = c[1] as { operation?: string } | undefined;
      return meta?.operation === "search_gate_read_error";
    });
    expect(gateErrorWarn).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Test G — FAIL-OPEN on null callerUsername (defensive per-request)
  // -------------------------------------------------------------------------

  it("Test G: getUsernameForUserId returns null → gate DISABLED (all hits surface) + search_gate_username_missing warn logged", async () => {
    mockSearchWithIdentityUsers("muffin", { identityUsers: ["ashley"] });
    mockSearchHits([
      { identityKey: "muffin", mtime: 200, content: "cheese platter" },
    ]);

    mockUserId = "uid-orphan";
    getUsernameForUserIdMock.mockResolvedValue(null); // caller-username lookup failure

    const res = await httpPostJson(server, "/conversation-search", {
      query: "cheese",
    });
    expect(res.status).toBe(200);
    const body = res.body as { results: Array<Record<string, unknown>> };
    // Gate is disabled — muffin surfaces even though its users:[ashley]
    // would otherwise close for a null caller. This is D-8 fail-open on
    // the PER-REQUEST side (a null caller is an infra bug, not a gate
    // signal). Distinct from Test F which is per-HIT fail-closed.
    expect(body.results).toHaveLength(1);
    expect(body.results[0].identityKey).toBe("muffin");

    // Structured warn log fires so ops can trace missing-username
    const warnCalls = systemLoggerWarnMock.mock.calls;
    const usernameMissingWarn = warnCalls.find((c) => {
      const meta = c[1] as { operation?: string } | undefined;
      return meta?.operation === "search_gate_username_missing";
    });
    expect(usernameMissingWarn).toBeTruthy();
  });
});
