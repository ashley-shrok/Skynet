/**
 * Tests for POST /identities/:key/unarchive (Phase 143 Plan 143-04; reworked
 * for the one-path un-archive — shape-unarchive-one-path-supervisor-reactivation.md).
 *
 * The route no longer does any chat-account (Matrix) work: after the fast
 * preconditions it drops `.unarchive-requested` in the archive folder and
 * waits for the agent-supervisor's outcome (restored / refused / pending).
 *
 * Tests exercise the route via a bare Express app + Node's built-in http module
 * (mirrors apps-archive.test.ts / role-archive.test.ts pattern).
 *
 * Auth middleware is mocked. All I/O primitives (writeIdentityArchiveFile,
 * resolveHostById, connectOneShot, isLocalHostId, fs.access, fs.readFile,
 * python3 execFile, execCommand) are mocked so tests exercise every branch
 * without real disk / SSH. LOCAL disk state lives in a small `disk` object the
 * fs mocks read; the "supervisor" flips it on a chosen poll.
 *
 * Timing: the route's local sleep uses the global setTimeout and Date.now. A
 * setTimeout spy runs every UNARCHIVE_POLL_MS sleep immediately and advances a
 * Date.now offset by the same amount, so the full 2-minute wait runs in ms.
 *
 * Test coverage:
 *   1:  Happy LOCAL — supervisor restores → 200 { ok, outcome: "restored" }; sentinel dropped once with ""; audit log
 *   2:  archive_not_found LOCAL — writer NOT called
 *   3:  name_collision LOCAL — writer NOT called
 *   4:  missing_roles LOCAL (one role archived) → 409 { missingRoles: [...] }
 *   5:  missing_roles LOCAL (both roles archived) → sorted missingRoles
 *   5b: role absent everywhere → missing_roles
 *   5c: roles read from `<key>/<key>.md`
 *   5d: roleless identity → restored normally
 *   5e: identity file missing → 409 identity_unreadable
 *   5f: roles parse failure → 409 identity_unreadable
 *   6:  Idempotent — two calls each drop the sentinel and each get an outcome
 *   7:  401 unauthenticated
 *   8:  400 missing hostId
 *   8b: 400 malformed hostId
 *   9:  400 malformed key (traversal attempt)
 *   9b: 404 host not owned
 *   10: 504 SSH connect failure REMOTE
 *   10b: 500 sentinel write failure → generic error; no wait
 *   11: refused LOCAL — note text returned (trimmed) as 409 { reason: "refused", message }
 *   12: refused LOCAL — empty note → default message; flag gone with no note → still pending
 *   13: refused LOCAL — note capped at 500 chars
 *   14: pending — no outcome within UNARCHIVE_WAIT_MS → 200 { ok, outcome: "pending" } after exactly WAIT/POLL polls
 *   15: outcome waits for the supervisor — pending polls keep going until it acts
 *   16: client disconnects mid-wait → route stops polling and does not respond
 *   17m: REMOTE identity file missing → 409 identity_unreadable
 *   17: Happy REMOTE — restored via one execCommand outcome probe; conn threaded through sentinel write; conn closed
 *   18: REMOTE refused — note from the probe output
 *   19: REMOTE refused with empty note → default message
 *   20: REMOTE probe throws → treated as pending (keeps waiting)
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Hoisted mock variables — must be declared with vi.hoisted so they are
// available inside vi.mock() factories (which are hoisted above regular code).
// ---------------------------------------------------------------------------

// mockFsAccess / mockFsReadFile: node:fs/promises default.access / readFile
// mockExecFile: node:child_process execFile
//
// The route's execFileAsync is a manual Promise wrapper around execFile (not
// util.promisify) so the mock just needs to call its callback(err, stdout, stderr).
const { mockFsAccess, mockFsReadFile, mockExecFile } = vi.hoisted(() => ({
  mockFsAccess: vi.fn().mockResolvedValue(undefined),
  mockFsReadFile: vi.fn(),
  mockExecFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Auth manager mock
// ---------------------------------------------------------------------------

let mockUserId: string | null = "1";

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

// Mute logger during tests.
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock SSH primitives + identity-artifact-reader
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

// REMOTE work runs under a per-host semaphore; pass straight through.
vi.mock("../../ssh/host-semaphore-registry.js", () => ({
  getHostSemaphore: () => ({ run: <T>(fn: () => Promise<T>) => fn() }),
}));

// IDENTITY_KEY_RE is a real constant — pass through verbatim.
// isLocalHostId and the root getters are functions we control per test.
vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: vi.fn(),
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
  getLocalIdentitiesRoot: vi.fn(),
  getLocalRolesRoot: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock archive-tree primitives
// ---------------------------------------------------------------------------

vi.mock("../../claude-session/per-identity-archive-file.js", () => ({
  writeIdentityArchiveFile: vi.fn(),
}));

vi.mock("../../claude-session/list-archived-identity-keys.js", () => ({
  getLocalArchivedIdentitiesRoot: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock node:fs/promises (preconditions + outcome probe + refusal note read).
// Provide BOTH named exports AND default to cover both import styles.
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  access: mockFsAccess,
  readFile: mockFsReadFile,
  default: {
    access: mockFsAccess,
    readFile: mockFsReadFile,
  },
}));

// ---------------------------------------------------------------------------
// Mock node:child_process execFile (python3 role parse)
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

// ---------------------------------------------------------------------------
// Mock execCommand for REMOTE path SSH calls
// ---------------------------------------------------------------------------

vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import {
  isLocalHostId,
  getLocalIdentitiesRoot,
  getLocalRolesRoot,
} from "../../claude-session/identity-artifact-reader.js";
import { writeIdentityArchiveFile } from "../../claude-session/per-identity-archive-file.js";
import { getLocalArchivedIdentitiesRoot } from "../../claude-session/list-archived-identity-keys.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { databaseLogger } from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// Helper: set up execFile mock to return a specific stdout for python3 calls
// ---------------------------------------------------------------------------

type ExecFileCallback = (
  err: Error | null,
  stdout: string,
  stderr: string,
) => void;

function mockPython3Returns(jsonOutput: string): void {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      callback: ExecFileCallback,
    ) => {
      callback(null, jsonOutput, "");
    },
  );
}

// ---------------------------------------------------------------------------
// HTTP request helper
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const bodyStr =
      opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    const headers: Record<string, string> = {
      ...(opts.headers ?? {}),
    };
    if (bodyStr !== undefined) {
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
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
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
    if (bodyStr !== undefined) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const stubConn = {
  end: vi.fn(),
  exec: vi.fn(),
};

const stubHost = {
  id: 42,
  ip: "10.0.0.42",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// Fake roots for LOCAL tests — deliberately non-overlapping paths so
// startsWith() checks don't produce false positives across roots.
const FAKE_ARCHIVE_ROOT = "/tmp/test-identities-archive";
const FAKE_LIVE_ROOT = "/tmp/test-identities-live";
const FAKE_ROLES_LIVE_ROOT = "/tmp/test-roles-live";

const ARCH_DIR = `${FAKE_ARCHIVE_ROOT}/wren`;
const FLAG_PATH = `${ARCH_DIR}/.unarchive-requested`;
const NOTE_PATH = `${ARCH_DIR}/.unarchive-refused`;
const DEFAULT_REFUSAL = "the un-archive was refused without a reason";

function enoent(): Promise<never> {
  return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
}

// ---------------------------------------------------------------------------
// Import the router under test — AFTER all vi.mock() calls
// ---------------------------------------------------------------------------

import router, {
  UNARCHIVE_POLL_MS,
  UNARCHIVE_WAIT_MS,
} from "./identity-unarchive.js";

// ---------------------------------------------------------------------------
// LOCAL disk state + "supervisor" simulation
// ---------------------------------------------------------------------------

/** What the LOCAL fs mocks report. The sentinel write sets `flag`. */
let disk: { archive: boolean; live: boolean; flag: boolean; note: string | null };

/** REMOTE outcome-probe stdout (`restored` / `pending` / `refused\n<note>`). */
let remoteProbe: () => Promise<string>;

/** Number of UNARCHIVE_POLL_MS sleeps the route has started. */
let pollCount = 0;
/** Called as each poll sleep starts — tests use it to act as the supervisor. */
let onPoll: ((n: number) => void) | null = null;

function supervisorRestoresOnPoll(n: number): void {
  onPoll = (c) => {
    if (c !== n) return;
    disk.live = true;
    disk.archive = false;
    disk.flag = false;
    remoteProbe = () => Promise.resolve("restored\n");
  };
}

function supervisorRefusesOnPoll(n: number, note: string | null): void {
  onPoll = (c) => {
    if (c !== n) return;
    disk.flag = false;
    disk.note = note;
    remoteProbe = () =>
      Promise.resolve(note === null ? "pending\n" : `refused\n${note}`);
  };
}

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();

  // Reset module-scope mocks that vi.clearAllMocks doesn't automatically
  // reset implementations for (they live outside vi.mock() factories).
  mockFsAccess.mockReset();
  mockFsReadFile.mockReset();
  mockExecFile.mockReset();

  disk = { archive: true, live: false, flag: false, note: null };
  remoteProbe = () => Promise.resolve("pending\n");
  pollCount = 0;
  onPoll = null;

  // Fast clock: each poll sleep resolves on the next tick and advances
  // Date.now by the poll interval. Other timers are untouched.
  const realSetTimeout = globalThis.setTimeout;
  const realDateNow = Date.now.bind(Date);
  let clockOffset = 0;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    fn: (...a: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    if (ms === UNARCHIVE_POLL_MS) {
      pollCount += 1;
      clockOffset += ms;
      onPoll?.(pollCount);
      return realSetTimeout(fn, 0, ...args);
    }
    return realSetTimeout(fn, ms, ...args);
  }) as unknown as typeof setTimeout);
  vi.spyOn(Date, "now").mockImplementation(() => realDateNow() + clockOffset);

  // Default: user owns hostId 42 (local), 43 (remote); hostId 99 not owned
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 42 || hostId === 43) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  // Default: hostId 42 is local, 43 is remote
  (isLocalHostId as Mock).mockImplementation((hostId: number) => hostId === 42);

  // Default: SSH connect resolves to stubConn
  (connectOneShot as Mock).mockResolvedValue(stubConn);

  // Default: writeIdentityArchiveFile succeeds and the flag appears on disk.
  (writeIdentityArchiveFile as Mock).mockImplementation(() => {
    disk.flag = true;
    return Promise.resolve();
  });

  // Default: root helpers return fake paths
  (getLocalArchivedIdentitiesRoot as Mock).mockReturnValue(FAKE_ARCHIVE_ROOT);
  (getLocalIdentitiesRoot as Mock).mockReturnValue(FAKE_LIVE_ROOT);
  (getLocalRolesRoot as Mock).mockReturnValue(FAKE_ROLES_LIVE_ROOT);

  // Default LOCAL fs.access reads `disk`:
  //   - flag path → disk.flag
  //   - anything in the archived folder (incl. the identity file) → disk.archive
  //   - live identity folder → disk.live
  //   - live roles, anything else → exists
  mockFsAccess.mockImplementation((p: string) => {
    if (p === FLAG_PATH) return disk.flag ? Promise.resolve() : enoent();
    if (p === NOTE_PATH) return disk.note !== null ? Promise.resolve() : enoent();
    if (p.startsWith(ARCH_DIR)) return disk.archive ? Promise.resolve() : enoent();
    if (p.startsWith(FAKE_LIVE_ROOT)) return disk.live ? Promise.resolve() : enoent();
    return Promise.resolve();
  });
  mockFsReadFile.mockImplementation((p: string) =>
    p === NOTE_PATH && disk.note !== null ? Promise.resolve(disk.note) : enoent(),
  );

  // Default: python3 returns one live role (happy path — fs.access resolves)
  mockPython3Returns('["researcher"]');

  // Default REMOTE: archive exists, no live folder, one live role, and the
  // outcome probe answers from `remoteProbe`.
  (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string) => {
    if (cmd.includes("echo restored")) return remoteProbe();
    if (cmd.includes("if [ -f")) return Promise.resolve("---\nroles: [researcher]\n---\n");
    if (cmd.includes("python3")) return Promise.resolve('["researcher"]');
    if (cmd.includes("identities-archive/wren")) return Promise.resolve("yes\n");
    if (cmd.includes("identities/wren")) return Promise.resolve("no\n");
    if (cmd.includes("fleet/roles/")) return Promise.resolve("yes\n");
    return Promise.resolve("");
  });

  const app = express();
  app.use(express.json());
  app.use("/identities", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  mockUserId = "1";
  vi.restoreAllMocks();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

const post = (hostId: unknown, key = "wren") =>
  httpRequest(server, {
    method: "POST",
    path: `/identities/${key}/unarchive`,
    body: { hostId },
  });

const sentinelWrites = () =>
  (writeIdentityArchiveFile as Mock).mock.calls.filter(
    (c) => c[1] === ".unarchive-requested",
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /identities/:key/unarchive", () => {
  // -------------------------------------------------------------------------
  // Preconditions / auth / validation
  // -------------------------------------------------------------------------

  it("Test 1: happy LOCAL → supervisor restores → 200 { ok, outcome: 'restored' }; sentinel dropped once with ''; audit log", async () => {
    supervisorRestoresOnPoll(2);

    const res = await post(42);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, outcome: "restored" });

    // Exactly one write: the sentinel, with empty contents, into the archive tree.
    expect(writeIdentityArchiveFile).toHaveBeenCalledTimes(1);
    expect(writeIdentityArchiveFile).toHaveBeenCalledWith(
      "wren",
      ".unarchive-requested",
      "",
      { hostId: 42, conn: null },
    );
    // Outcome was found on the poll where the supervisor acted.
    expect(pollCount).toBe(2);

    // LOCAL branch must not open an SSH connection
    expect(connectOneShot).not.toHaveBeenCalled();

    // Audit log
    const infoMsgs = (databaseLogger.info as unknown as Mock).mock.calls.map((c) => c[0]);
    const audit = infoMsgs.find(
      (m) => typeof m === "string" && /identity unarchive requested/.test(m),
    ) as string;
    expect(audit).toMatch(/userId=1/);
    expect(audit).toMatch(/hostId=42/);
    expect(audit).toMatch(/key=wren/);
  });

  it("Test 2: archive folder absent LOCAL → 409 { reason: 'archive_not_found' }; writer NOT called", async () => {
    disk.archive = false;
    const res = await post(42);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "archive_not_found" });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
    expect(pollCount).toBe(0);
  });

  it("Test 2b: archive gone + live folder present LOCAL (already un-archived) → 200 restored; writer NOT called", async () => {
    disk.archive = false;
    disk.live = true;
    const res = await post(42);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, outcome: "restored" });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
    expect(pollCount).toBe(0);
  });

  it("Test 2c: archive gone + live folder present REMOTE → 200 restored; writer NOT called", async () => {
    const base = (execCommand as Mock).getMockImplementation()!;
    (execCommand as Mock).mockImplementation((conn: unknown, cmd: string) => {
      if (cmd.includes("identities-archive/wren")) return Promise.resolve("no\n");
      if (cmd.includes("identities/wren")) return Promise.resolve("yes\n");
      return base(conn, cmd);
    });
    const res = await post(43);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, outcome: "restored" });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  it("Test 3: live folder exists LOCAL → 409 { reason: 'name_collision' }; writer NOT called", async () => {
    disk.live = true;
    const res = await post(42);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "name_collision" });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  it("Test 4: one role still archived → 409 { reason: 'missing_roles', missingRoles: ['ops-oncall'] }; writer NOT called", async () => {
    mockPython3Returns('["ops-oncall","researcher"]');
    mockFsAccess.mockImplementation((p: string) => {
      if (p.startsWith(FAKE_LIVE_ROOT)) return enoent(); // no collision
      // Live-roles gate (matches the supervisor): ops-oncall has no live folder.
      if (p === `${FAKE_ROLES_LIVE_ROOT}/ops-oncall`) return enoent();
      return Promise.resolve();
    });

    const res = await post(42);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      reason: "missing_roles",
      missingRoles: ["ops-oncall"],
    });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  it("Test 5: both roles archived → missingRoles sorted with both; writer NOT called", async () => {
    mockPython3Returns('["researcher","ops-oncall"]');
    mockFsAccess.mockImplementation((p: string) => {
      if (p.startsWith(FAKE_LIVE_ROOT) || p.startsWith(FAKE_ROLES_LIVE_ROOT)) return enoent();
      return Promise.resolve();
    });

    const res = await post(42);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      reason: "missing_roles",
      missingRoles: ["ops-oncall", "researcher"],
    });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  it("Test 5b: a role absent from the live roles tree is reported missing (supervisor would refuse it)", async () => {
    mockPython3Returns('["deleted-role"]');
    mockFsAccess.mockImplementation((p: string) => {
      if (p.startsWith(FAKE_LIVE_ROOT) || p.startsWith(FAKE_ROLES_LIVE_ROOT)) return enoent();
      return Promise.resolve();
    });
    const res = await post(42);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "missing_roles", missingRoles: ["deleted-role"] });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  it("Test 5c: roles are read from the real identity file `<key>/<key>.md`", async () => {
    mockPython3Returns('["ops-oncall"]');
    supervisorRestoresOnPoll(1);
    await post(42);
    const parsedPaths = mockExecFile.mock.calls.map((c: unknown[]) => (c[1] as string[])?.[2]);
    expect(parsedPaths).toContain(`${ARCH_DIR}/wren.md`);
  });

  it("Test 5d: roleless archived identity → sentinel dropped, restored normally", async () => {
    mockPython3Returns("[]");
    supervisorRestoresOnPoll(1);
    const res = await post(42);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, outcome: "restored" });
    expect(sentinelWrites()).toHaveLength(1);
  });

  it("Test 5e: archived identity file missing → 409 identity_unreadable; writer NOT called", async () => {
    mockPython3Returns("[]");
    mockFsAccess.mockImplementation((p: string) => {
      if (p.startsWith(FAKE_LIVE_ROOT) || p.endsWith(".md")) return enoent();
      return Promise.resolve();
    });
    const res = await post(42);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "identity_unreadable" });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  it("Test 5f: roles parse failure → 409 identity_unreadable (never treated as roleless)", async () => {
    mockExecFile.mockImplementation((_c: string, _a: string[], callback: ExecFileCallback) => {
      callback(new Error("python3 crashed"), "", "boom");
    });
    const res = await post(42);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "identity_unreadable" });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  it("Test 6: idempotent — two calls each drop the sentinel and each get an outcome", async () => {
    supervisorRestoresOnPoll(1);
    const res1 = await post(42);
    expect(res1.body).toEqual({ ok: true, outcome: "restored" });

    // Second request: archive is still there (e.g. a refused first attempt was retried).
    disk = { archive: true, live: false, flag: false, note: null };
    pollCount = 0;
    supervisorRestoresOnPoll(1);
    const res2 = await post(42);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ ok: true, outcome: "restored" });
    expect(sentinelWrites()).toHaveLength(2);
  });

  it("Test 7: 401 without JWT; no downstream calls", async () => {
    mockUserId = null;
    const res = await post(42);
    expect(res.status).toBe(401);
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 8: 400 missing hostId", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/unarchive",
      body: {},
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId/);
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  it("Test 8b: 400 malformed hostId", async () => {
    const res = await post(-3);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "hostId must be a positive integer" });
    expect(resolveHostById).not.toHaveBeenCalled();
  });

  it("Test 9: 400 uppercase key rejected by IDENTITY_KEY_RE (traversal-shape guard)", async () => {
    // Express normalizes real ../ sequences before the handler; uppercase
    // exercises the regex gate directly.
    const res = await post(42, "INVALID_KEY");
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/identity key must match/);
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  it("Test 9b: host not owned → 404; nothing touched", async () => {
    const res = await post(99);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Host not found" });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 10: REMOTE connectOneShot throws → 504 (not a precondition failure); writer NOT called", async () => {
    (connectOneShot as Mock).mockRejectedValue(new Error("Connect timeout after 3000ms"));
    const res = await post(43);
    expect(res.status).toBe(504);
    expect(res.body).toEqual({ error: "Host unreachable" });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  it("Test 10b: sentinel write fails → 500 generic error; no wait", async () => {
    (writeIdentityArchiveFile as Mock).mockRejectedValue(new Error("EACCES: secret path detail"));
    const res = await post(42);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "failed to drop unarchive sentinel" });
    expect(pollCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Outcome wait — LOCAL
  // -------------------------------------------------------------------------

  it("Test 11: LOCAL refused → 409 { reason: 'refused', message: <note, trimmed> }", async () => {
    supervisorRefusesOnPoll(3, "  role ops-oncall is still archived\n");
    const res = await post(42);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      reason: "refused",
      message: "role ops-oncall is still archived",
    });
    expect(mockFsReadFile).toHaveBeenCalledWith(NOTE_PATH, "utf8");
    expect(pollCount).toBe(3);
    expect(sentinelWrites()).toHaveLength(1);
  });

  it("Test 12: LOCAL refused with an empty note → default message", async () => {
    supervisorRefusesOnPoll(1, "   \n");
    const res = await post(42);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "refused", message: DEFAULT_REFUSAL });
  });

  it("Test 12b: LOCAL flag gone but no refusal note (success path mid-move) → not refused, keeps waiting", async () => {
    supervisorRefusesOnPoll(1, null);
    const res = await post(42);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, outcome: "pending" });
  });

  it("Test 13: LOCAL refusal note is capped at 500 chars", async () => {
    supervisorRefusesOnPoll(1, "x".repeat(800));
    const res = await post(42);
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toBe("x".repeat(500));
  });

  it("Test 14: no outcome within UNARCHIVE_WAIT_MS → 200 { ok, outcome: 'pending' } after WAIT/POLL polls", async () => {
    const res = await post(42);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, outcome: "pending" });
    expect(pollCount).toBe(UNARCHIVE_WAIT_MS / UNARCHIVE_POLL_MS);
    expect(sentinelWrites()).toHaveLength(1);
    expect(databaseLogger.warn).toHaveBeenCalledWith(
      "identity unarchive: still pending after wait",
      expect.objectContaining({ identityKey: "wren", timeoutMs: UNARCHIVE_WAIT_MS }),
    );
  });

  it("Test 15: flag still present and no live folder → keeps polling until the supervisor acts", async () => {
    supervisorRestoresOnPoll(10);
    const res = await post(42);
    expect(res.body).toEqual({ ok: true, outcome: "restored" });
    expect(pollCount).toBe(10);
  });

  it("Test 16: client disconnects mid-wait → route stops polling and does not respond", async () => {
    const { port } = server.address() as AddressInfo;
    const body = JSON.stringify({ hostId: 42 });
    let gotResponse = false;
    const clientReq = http.request({
      hostname: "127.0.0.1",
      port,
      method: "POST",
      path: "/identities/wren/unarchive",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(body)),
      },
    }, () => {
      gotResponse = true;
    });
    clientReq.on("error", () => {});
    onPoll = (c) => {
      if (c === 2) clientReq.destroy();
    };
    clientReq.end(body);

    await vi.waitFor(
      () => {
        expect(databaseLogger.info).toHaveBeenCalledWith(
          "identity unarchive: client left during wait",
          expect.objectContaining({ identityKey: "wren" }),
        );
      },
      { timeout: 500, interval: 5 },
    );
    expect(gotResponse).toBe(false);
    expect(pollCount).toBeLessThan(UNARCHIVE_WAIT_MS / UNARCHIVE_POLL_MS);
    expect(databaseLogger.warn).not.toHaveBeenCalledWith(
      "identity unarchive: still pending after wait",
      expect.anything(),
    );
  });

  // -------------------------------------------------------------------------
  // REMOTE
  // -------------------------------------------------------------------------

  it("Test 17m: REMOTE archived identity file missing → 409 identity_unreadable", async () => {
    const base = (execCommand as Mock).getMockImplementation()!;
    (execCommand as Mock).mockImplementation((conn: unknown, cmd: string) =>
      cmd.includes("if [ -f")
        ? Promise.resolve("__SKYNET_IDENTITY_FILE_MISSING__")
        : base(conn, cmd),
    );
    const res = await post(43);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "identity_unreadable" });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  it("Test 17: happy REMOTE → restored via the SSH outcome probe; conn threaded through sentinel write; conn closed", async () => {
    supervisorRestoresOnPoll(2);

    const res = await post(43);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, outcome: "restored" });
    expect(connectOneShot).toHaveBeenCalledTimes(1);
    expect(writeIdentityArchiveFile).toHaveBeenCalledTimes(1);
    expect(writeIdentityArchiveFile).toHaveBeenCalledWith(
      "wren",
      ".unarchive-requested",
      "",
      { hostId: 43, conn: stubConn },
    );
    // One probe command per poll, run over the same conn; LOCAL fs untouched.
    const probes = (execCommand as Mock).mock.calls.filter((c) =>
      (c[1] as string).includes("echo restored"),
    );
    expect(probes).toHaveLength(2);
    expect(probes[0][0]).toBe(stubConn);
    expect(probes[0][1]).toContain('"$HOME/fleet/identities-archive/wren"');
    expect(mockFsAccess).not.toHaveBeenCalled();
    expect(mockFsReadFile).not.toHaveBeenCalled();
    expect(stubConn.end).toHaveBeenCalled();
  });

  it("Test 18: REMOTE refused → 409 with the note from the probe output", async () => {
    supervisorRefusesOnPoll(1, "name collision on host\nsecond line");
    const res = await post(43);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      reason: "refused",
      message: "name collision on host\nsecond line",
    });
    expect(stubConn.end).toHaveBeenCalled();
  });

  it("Test 19: REMOTE refused with an empty note → default message", async () => {
    supervisorRefusesOnPoll(1, "");
    const res = await post(43);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "refused", message: DEFAULT_REFUSAL });
  });

  it("Test 20: REMOTE probe throws → treated as pending, keeps waiting", async () => {
    remoteProbe = () => Promise.reject(new Error("channel closed"));
    supervisorRestoresOnPoll(3);
    const res = await post(43);
    expect(res.body).toEqual({ ok: true, outcome: "restored" });
    expect(pollCount).toBe(3);
  });

  it("Test 21: REMOTE pending until timeout → 200 { ok, outcome: 'pending' }", async () => {
    const res = await post(43);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, outcome: "pending" });
    expect(pollCount).toBe(UNARCHIVE_WAIT_MS / UNARCHIVE_POLL_MS);
    expect(sentinelWrites()).toHaveLength(1);
  });
});
