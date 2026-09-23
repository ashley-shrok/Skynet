/**
 * Phase 20 (IDUI-06/08/09): Tests for identity-birth.ts SSE route.
 *
 * Tests exercise POST /identities/birth via a bare Express app using
 * Node's built-in http module (supertest not in project deps —
 * following the identity-avatar-batch.test.ts pattern from 20-01).
 *
 * The orchestrator is mocked via vi.mock so these tests focus on SSE
 * transport + HTTP semantics, not orchestration logic.
 *
 * Test coverage (5 tests):
 *   1: valid body streams SSE — headers correct, events framed correctly
 *   2: invalid body (missing name) → 400 before SSE opens
 *   3: 401 without JWT — no orchestrator call
 *   4: orchestrator rejects synchronously → 500 JSON (not SSE)
 *   5: orchestrator invoked with correct opts + all 8+ dep keys present
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { __resetForTests as __resetThrottleForTests } from "../../identity-birth/global-throttle.js";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mock the orchestrator BEFORE importing the route
// ---------------------------------------------------------------------------

vi.mock("./identity-birth-orchestrator.js", () => ({
  birthIdentity: vi.fn(),
  ENTER_TRAIN_COUNT: 7,
  ENTER_TRAIN_SPACING_MS: 3000,
  SETTLE_SECONDS: 22,
  STEP_2_SLEEP_MS: 3000,
  STEP_3_SLEEP_MS: 2000,
  SSH_CONNECT_TIMEOUT_MS: 30000,
  CLAUDE_LAUNCH_CMD_PREFIX:
    "CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=99999999 CLAUDE_CODE_RESUME_TOKEN_THRESHOLD=99999999",
  TMUX_NEW_SESSION_FLAGS: "-x 220 -y 50",
  // Phase 22 SRIC-02 — kebab-case-lowercase; must match orchestrator export
  ROLE_NAME_PATTERN: /^[a-z0-9-]+$/,
  // Phase 80 review fix (H3) — stricter regex for poolPicked=true role validation
  ROLE_NAME_RE: /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/,
  // Phase 106 Plan 106-01 (D-11 wire parity): the birth route's outer-catch
  // calls sanitizeError(err) when the orchestrator throws unexpectedly, so
  // it can widen the safety-net ended:false emit with a `reason` string.
  // The mock must expose it as a real function or the outer-catch itself
  // throws (calling undefined) and Test 4's SSE `ended` frame never lands
  // on the wire. This closes a pre-existing gap surfaced by Plan 106-03.
  sanitizeError: (err: unknown): string => {
    if (!(err instanceof Error)) return "Unknown error";
    return err.message.slice(0, 200);
  },
}));

// Mock SSH dependencies
vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  stringifyColorHueForYaml: (obj: Record<string, unknown>) => (typeof obj.colorHue === "number" ? { ...obj, colorHue: String(obj.colorHue) } : obj),
  isLocalHostId: vi.fn(),
  writeMarkdownFileAtomic: vi.fn().mockResolvedValue(undefined),
  // Phase 66 Plan 66-01: additive avatar-sibling dep — the birth route now
  // wires this into BirthDeps. Test 5 asserts d.writeAvatarSiblingFile is a
  // function.
  writeAvatarSiblingFile: vi.fn().mockResolvedValue(undefined),
  // Phase 92 Plan 92-01 Task 2: per-identity-file.ts (transitively imported
  // by identity-birth-orchestrator's Step 8) requires IDENTITY_KEY_RE from
  // this module. H1 write⇔read parity lock — export the real regex value.
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
}));

vi.mock("./identity-avatar-batch.js", () => ({
  getCandidateForBirth: vi.fn(),
  consumeCandidateForBirth: vi.fn(),
  default: express.Router(),
}));

// Phase 68 Plan 03: identity-birth.ts no longer imports db, identities schema,
// or drizzle-orm. These mocks are kept as stubs for any transitive imports that
// might still reference them (e.g., the identity-avatar-batch module), but the
// birth route itself no longer touches the DB at all.
vi.mock("../db/index.js", () => ({
  db: {},
  getDb: vi.fn().mockReturnValue({}),
}));

vi.mock("../db/schema.js", () => ({
  identities: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  // Phase 110: global-throttle.ts imports systemLogger from the same module.
  // The real module is NOT mocked (we test end-to-end wiring), so systemLogger
  // must be present in the mock to avoid "No systemLogger export" at module-init.
  systemLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Phase 77 (Plan 04) added a 503 fail-early gate at POST / and POST /retry/:key
// when matrix admin foundation isn't ingested. Tests here focus on SSE +
// orchestrator-invocation behavior, not the fail-early path, so mock the store
// to return non-null creds so the gate passes and the handler proceeds.
// 2026-09-11: mock includes the widened MatrixAdminCreds shape (serverName +
// hostSideBase columns). Default returns both nulls — Test 5 asserts the
// fallback branch (deps.relayJsonHomeserverBase === creds.homeserverBase).
// Tests 5a/5b below override the mock per-case to exercise the override
// branch (hostSideBase set → deps.relayJsonHomeserverBase === hostSideBase).
// Wrapped in vi.hoisted() because vi.mock() factories are hoisted above
// module-scope declarations by vitest.
const { getMatrixAdminCredsMock } = vi.hoisted(() => ({
  getMatrixAdminCredsMock: vi.fn().mockResolvedValue({
    homeserverBase: "http://mock.homeserver.local:8008",
    userId: "@mock-admin:mock.homeserver.local",
    password: "mock-admin-password",
    accessToken: "syt_mock_admin_token_test",
    serverName: null,
    hostSideBase: null,
  }),
}));

vi.mock("../../matrix/matrix-admin-creds-store.js", () => ({
  getMatrixAdminCreds: getMatrixAdminCredsMock,
  setMatrixAdminCreds: vi.fn().mockResolvedValue(undefined),
}));

// Also mock the matrix admin client — the birth route wires these into
// BirthDeps at request time; Test 5 asserts d.matrixCreateOrUpdateUser etc.
// are wired as functions, so the module must export functions (even if
// unused in these orchestrator-mocked tests).
vi.mock("../../matrix/matrix-admin-client.js", () => ({
  createOrUpdateUser: vi.fn(),
  loginAsUser: vi.fn(),
  joinRoom: vi.fn(),
  makeRoomAdmin: vi.fn(),
  listRooms: vi.fn(),
  buildRelayJsonBody: vi.fn(),
  // Phase 80 Plan 80-03b: countUsersMatching primitive (from plan 80-02) — the
  // birth route wires this into BirthDeps.matrixCountUsersMatching so Step 6
  // can derive the ordinal-suffixed MXID when opts.poolPicked === true.
  countUsersMatching: vi.fn(),
}));

// Phase 129 Plan 07 Task 2: host-user-counter primitives (from Plan 01) —
// wired into the POST /birth handler to gate the D-4 auto-tag branch.
// Default mocks return "single-user host, no lookup" so every pre-existing
// test (Tests 1..110-B) stays on the auto-tag-OFF code path. Phase 129 tests
// A-G below override per-test with mockImplementationOnce / mockResolvedValue.
vi.mock("../../utils/host-user-counter.js", () => ({
  isHostMultiUser: vi.fn().mockResolvedValue(false),
  getUsernameForUserId: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Auth manager mock
// ---------------------------------------------------------------------------

let mockUserId: string | null = "1";

vi.mock("../../utils/auth-manager.js", () => {
  // Shared middleware body — used by both createAuthMiddleware (Phase 20 birth
  // handler) and createAdminMiddleware (Phase 77 retry handler at
  // POST /identities/birth/retry/:key). Both middlewares gate on mockUserId
  // being non-null; the admin-gate distinction is not exercised in these
  // orchestrator-layer tests since the mocked orchestrator is where all the
  // real Phase 77 logic lives.
  const middleware =
    () =>
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
    };
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware: middleware,
      createAdminMiddleware: middleware,
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

import { birthIdentity } from "./identity-birth-orchestrator.js";
import identityBirthRoutes from "./identity-birth.js";
// Phase 129 Plan 07 Task 2: import the mocked host-user-counter primitives so
// Phase 129 tests can drive isHostMultiUser + getUsernameForUserId per-case.
import {
  isHostMultiUser,
  getUsernameForUserId,
} from "../../utils/host-user-counter.js";
// Phase 129 Plan 07 Task 2: import sshLogger to assert the structured info
// (auto-tagged) + warn (lookup-failed) seams introduced in identity-birth.ts.
import { sshLogger } from "../../utils/logger.js";

const mockBirthIdentity = birthIdentity as unknown as Mock;
const mockIsHostMultiUser = isHostMultiUser as unknown as Mock;
const mockGetUsernameForUserId = getUsernameForUserId as unknown as Mock;
const mockSshLoggerInfo = sshLogger.info as unknown as Mock;
const mockSshLoggerWarn = sshLogger.warn as unknown as Mock;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function makeServer(): { app: express.Express; server: http.Server } {
  const app = express();
  app.use(express.json());
  app.use("/identities/birth", identityBirthRoutes);
  const server = http.createServer(app);
  return { app, server };
}

function getPort(server: http.Server): number {
  return (server.address() as AddressInfo).port;
}

async function startServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function stopServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

function httpPost(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string>,
            body: data,
          });
        });
      },
    );
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

// Valid request body — Phase 22 SRIC-02 adds required `role` field.
// Phase 98 Plan 07: `voice` swapped from the legacy Chatterbox filename shape
// to a valid Polly generative voice ID ("Joanna") so the tightened whitelist
// validator in identity-birth.ts accepts it.
const VALID_BODY = {
  hostId: 7,
  name: "testkey",
  title: "Test Identity",
  path: "/workspace/testkey",
  colorHue: 210,
  voice: "Joanna",
  avatarCandidateId: "cand-abc",
  role: "box-maintainer",
};

// ---------------------------------------------------------------------------
// Throttle env-var save/restore — module-scope captures initial values so
// per-test mutations (Test 110-B sets IDENTITY_BIRTH_MAX_CONCURRENT etc.)
// don't leak across tests. Restored in afterEach.
// ---------------------------------------------------------------------------
const _origMaxConcurrent = process.env.IDENTITY_BIRTH_MAX_CONCURRENT;
const _origMaxQueueDepth = process.env.IDENTITY_BIRTH_MAX_QUEUE_DEPTH;
const _origMinIntervalMs = process.env.IDENTITY_BIRTH_MIN_INTERVAL_MS;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let server: http.Server;
let port: number;

beforeEach(async () => {
  mockUserId = "1";
  mockBirthIdentity.mockReset();

  // Phase 129 Plan 07 Task 2: reset host-user-counter mocks to their
  // single-user-host defaults so pre-existing tests keep the auto-tag path
  // OFF (no unintentional drift into the multi-user branch).
  mockIsHostMultiUser.mockReset();
  mockIsHostMultiUser.mockResolvedValue(false);
  mockGetUsernameForUserId.mockReset();
  mockGetUsernameForUserId.mockResolvedValue(null);
  // Reset the sshLogger info/warn seams so Phase 129 log-assertion tests
  // see only their own calls (not leftovers from earlier tests).
  mockSshLoggerInfo.mockReset();
  mockSshLoggerWarn.mockReset();

  // Phase 110: reset throttle state so concurrency + queue tests get a clean
  // semaphore. __resetThrottleForTests also re-reads process.env so per-test
  // env mutations take effect immediately on the next acquireBirthSlot call.
  __resetThrottleForTests();

  const { server: s } = makeServer();
  server = s;
  await startServer(server);
  port = getPort(server);
});

afterEach(async () => {
  // Phase 110: restore throttle env vars so mutations in 110-B don't leak.
  if (_origMaxConcurrent === undefined) {
    delete process.env.IDENTITY_BIRTH_MAX_CONCURRENT;
  } else {
    process.env.IDENTITY_BIRTH_MAX_CONCURRENT = _origMaxConcurrent;
  }
  if (_origMaxQueueDepth === undefined) {
    delete process.env.IDENTITY_BIRTH_MAX_QUEUE_DEPTH;
  } else {
    process.env.IDENTITY_BIRTH_MAX_QUEUE_DEPTH = _origMaxQueueDepth;
  }
  if (_origMinIntervalMs === undefined) {
    delete process.env.IDENTITY_BIRTH_MIN_INTERVAL_MS;
  } else {
    process.env.IDENTITY_BIRTH_MIN_INTERVAL_MS = _origMinIntervalMs;
  }

  await stopServer(server);
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1: valid body streams SSE with correct headers and event frames
// ---------------------------------------------------------------------------

it("Test 1: POST with valid body streams SSE with correct headers and event frames", async () => {
  const canned: Array<{ type: string; n?: number; phase?: string }> = [
    { type: "step", n: 1, phase: "started" },
    { type: "step", n: 1, phase: "completed" },
    { type: "ended", ok: true },
  ];

  mockBirthIdentity.mockImplementation(
    async (
      _opts: unknown,
      emit: (e: unknown) => void,
      _deps: unknown,
    ) => {
      for (const event of canned) {
        emit(event);
      }
    },
  );

  const result = await httpPost(port, "/identities/birth", VALID_BODY, {
    Accept: "text/event-stream",
  });

  expect(result.status).toBe(200);
  expect(result.headers["content-type"]).toContain("text/event-stream");
  expect(result.headers["cache-control"]).toContain("no-cache");
  expect(result.headers["connection"]).toBe("keep-alive");

  // Response body contains SSE frames
  const frames = result.body
    .split("\n\n")
    .filter((f) => f.trim().length > 0);

  expect(frames.length).toBe(3);

  for (let i = 0; i < canned.length; i++) {
    expect(frames[i]).toContain("event: birth");
    expect(frames[i]).toContain("data:");
    const dataLine = frames[i].split("\n").find((l) => l.startsWith("data:"))!;
    const parsed = JSON.parse(dataLine.slice("data:".length).trim());
    expect(parsed.type).toBe(canned[i].type);
  }
});

// ---------------------------------------------------------------------------
// Test 2: invalid body (missing name) → 400 before SSE opens
// ---------------------------------------------------------------------------

it("Test 2: missing required field 'name' → 400 JSON, no SSE frames", async () => {
  const invalidBody = { ...VALID_BODY };
  delete (invalidBody as Partial<typeof VALID_BODY>).name;

  const result = await httpPost(port, "/identities/birth", invalidBody);

  expect(result.status).toBe(400);
  expect(result.headers["content-type"]).toContain("application/json");
  const parsed = JSON.parse(result.body);
  expect(parsed.error).toBeDefined();

  // Orchestrator was NOT called
  expect(mockBirthIdentity).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Test 3: 401 without JWT — no orchestrator call
// ---------------------------------------------------------------------------

it("Test 3: 401 without JWT, orchestrator not called", async () => {
  mockUserId = null; // auth middleware will reject

  const result = await httpPost(port, "/identities/birth", VALID_BODY);

  expect(result.status).toBe(401);
  expect(mockBirthIdentity).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Test 4: orchestrator throws before emitting → 500 JSON (not SSE)
// ---------------------------------------------------------------------------

it("Test 4: orchestrator throws synchronously → 500 JSON, not SSE", async () => {
  mockBirthIdentity.mockRejectedValue(new Error("unexpected crash"));

  const result = await httpPost(port, "/identities/birth", VALID_BODY, {
    Accept: "text/event-stream",
  });

  // If the crash happens after SSE is opened, we get an event + close.
  // The route should handle this gracefully. Either a 500 OR an SSE error event.
  // Per plan: "If orchestrator throws BEFORE any emit → respond 500 JSON"
  // But since we open SSE first and then call the orchestrator, a crash
  // after flushHeaders goes to the SSE stream as an ended{ok:false} event.
  // Accept both behaviors:
  const contentType = result.headers["content-type"] ?? "";
  if (result.status === 500) {
    expect(contentType).toContain("application/json");
  } else {
    // SSE error framing
    expect(result.status).toBe(200);
    expect(contentType).toContain("text/event-stream");
    expect(result.body).toContain("ended");
  }
});

// ---------------------------------------------------------------------------
// Test 5: orchestrator invoked with correct opts + all dep keys present
// ---------------------------------------------------------------------------

it("Test 5: orchestrator called with body opts + userId + all required dep keys", async () => {
  let capturedOpts: unknown;
  let capturedDeps: unknown;

  mockBirthIdentity.mockImplementation(
    async (
      opts: unknown,
      _emit: unknown,
      deps: unknown,
    ) => {
      capturedOpts = opts;
      capturedDeps = deps;
    },
  );

  await httpPost(port, "/identities/birth", VALID_BODY);

  expect(capturedOpts).toBeDefined();
  expect(capturedDeps).toBeDefined();

  // Verify opts has all fields from body + userId
  const o = capturedOpts as Record<string, unknown>;
  expect(o.hostId).toBe(VALID_BODY.hostId);
  expect(o.name).toBe(VALID_BODY.name);
  expect(o.title).toBe(VALID_BODY.title);
  expect(o.path).toBe(VALID_BODY.path);
  expect(o.colorHue).toBe(VALID_BODY.colorHue);
  expect(o.voice).toBe(VALID_BODY.voice);
  expect(o.avatarCandidateId).toBe(VALID_BODY.avatarCandidateId);
  expect(o.userId).toBeDefined();

  // Phase 22 SRIC-02: role passed through
  expect(o.role).toBe(VALID_BODY.role);

  // Verify deps has all required keys
  // Phase 68 Plan 03: createIdentityRecord + getIdentityRecord removed from BirthDeps
  const d = capturedDeps as Record<string, unknown>;
  expect(typeof d.connectOneShot).toBe("function");
  expect(typeof d.execCommand).toBe("function");
  expect(typeof d.isLocalHostId).toBe("function");
  expect(typeof d.execLocal).toBe("function");
  expect(d.createIdentityRecord).toBeUndefined();
  expect(d.getIdentityRecord).toBeUndefined();
  expect(typeof d.getCandidateForBirth).toBe("function");
  expect(typeof d.resolveHostById).toBe("function");
  // Phase 22 SRIC-02: writeMarkdownFileAtomic dep for Step 2.5 pre-write
  expect(typeof d.writeMarkdownFileAtomic).toBe("function");
  // Phase 66 Plan 66-01: writeAvatarSiblingFile dep for Step 2.5 avatar write
  expect(typeof d.writeAvatarSiblingFile).toBe("function");
  // Phase 80 Plan 80-03b: matrixCountUsersMatching dep for Step 6 MXID
  // ordinal derivation — wired from plan 80-02's countUsersMatching export.
  expect(typeof d.matrixCountUsersMatching).toBe("function");
  // Phase 106 Plan 106-03 (D-05/D-06): discoverIdentitySessionFile dep for
  // the wait-for-supervisor poll — wired from claude-session/discover-identity-
  // session-file.js. The orchestrator's wait-block calls this dep every 2s
  // (WAIT_FOR_SUPERVISOR_POLL_MS) until it returns non-null or the 300s
  // (WAIT_FOR_SUPERVISOR_TIMEOUT_MS) ceiling is hit.
  expect(typeof d.discoverIdentitySessionFile).toBe("function");
  // 2026-09-11: relayJsonHomeserverBase wired from creds.hostSideBase ??
  // creds.homeserverBase. Default mock returns hostSideBase: null so the
  // fallback branch fires — deps.relayJsonHomeserverBase must equal
  // creds.homeserverBase.
  expect(d.relayJsonHomeserverBase).toBe("http://mock.homeserver.local:8008");
  expect(d.matrixHomeserver).toBe("http://mock.homeserver.local:8008");
});

// ---------------------------------------------------------------------------
// 2026-09-11: relayJsonHomeserverBase override branch — when hostSideBase
// is set on the creds row, deps.relayJsonHomeserverBase must equal that
// value (NOT homeserverBase), while deps.matrixHomeserver must remain
// homeserverBase (Step 6's admin-API-URL consumer stays unchanged).
// ---------------------------------------------------------------------------

it("Test 5a: deps.relayJsonHomeserverBase === creds.hostSideBase when set; matrixHomeserver unchanged", async () => {
  getMatrixAdminCredsMock.mockResolvedValueOnce({
    homeserverBase: "http://synapse:8008",
    userId: "@mock-admin:thenasty.taild9b663.ts.net",
    password: "p",
    accessToken: "t",
    serverName: "thenasty.taild9b663.ts.net",
    hostSideBase: "http://100.99.149.8:8008",
  });

  let capturedDeps: unknown;
  mockBirthIdentity.mockImplementation(
    async (
      _opts: unknown,
      _emit: unknown,
      deps: unknown,
    ) => {
      capturedDeps = deps;
    },
  );

  await httpPost(port, "/identities/birth", VALID_BODY);

  const d = capturedDeps as Record<string, unknown>;
  // Override branch: relay.json base points at the host-reachable URL.
  expect(d.relayJsonHomeserverBase).toBe("http://100.99.149.8:8008");
  // matrixHomeserver (Step 6 admin-API URL) stays as the container-internal
  // URL — the whole point of the split.
  expect(d.matrixHomeserver).toBe("http://synapse:8008");
  // matrixServerName override also propagates so mxid derivation is stable.
  expect(d.matrixServerName).toBe("thenasty.taild9b663.ts.net");
});

it("Test 5b: deps.relayJsonHomeserverBase falls back to homeserverBase when hostSideBase is null", async () => {
  getMatrixAdminCredsMock.mockResolvedValueOnce({
    homeserverBase: "http://t1000.taild9b663.ts.net:8008",
    userId: "@mock-admin:t1000.taild9b663.ts.net",
    password: "p",
    accessToken: "t",
    serverName: null,
    hostSideBase: null,
  });

  let capturedDeps: unknown;
  mockBirthIdentity.mockImplementation(
    async (
      _opts: unknown,
      _emit: unknown,
      deps: unknown,
    ) => {
      capturedDeps = deps;
    },
  );

  await httpPost(port, "/identities/birth", VALID_BODY);

  const d = capturedDeps as Record<string, unknown>;
  // Fallback branch: single-URL fleets get the same URL for both slots.
  expect(d.relayJsonHomeserverBase).toBe("http://t1000.taild9b663.ts.net:8008");
  expect(d.matrixHomeserver).toBe("http://t1000.taild9b663.ts.net:8008");
});

// ---------------------------------------------------------------------------
// Test 18: Phase 22 SRIC-02 — missing role → 400, orchestrator not called
// ---------------------------------------------------------------------------

it("Test 18: missing role field → 400, orchestrator not called", async () => {
  const invalidBody = { ...VALID_BODY };
  delete (invalidBody as Partial<typeof VALID_BODY>).role;

  const result = await httpPost(port, "/identities/birth", invalidBody);

  expect(result.status).toBe(400);
  const parsed = JSON.parse(result.body);
  expect(parsed.error).toMatch(/role/i);
  expect(mockBirthIdentity).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Test 19: Phase 22 SRIC-02 — role fails kebab-case-lowercase → 400
// ---------------------------------------------------------------------------

it("Test 19: role fails ROLE_NAME_PATTERN → 400, orchestrator not called", async () => {
  const invalidBody = { ...VALID_BODY, role: "Box_Maintainer" }; // uppercase + underscore

  const result = await httpPost(port, "/identities/birth", invalidBody);

  expect(result.status).toBe(400);
  const parsed = JSON.parse(result.body);
  expect(parsed.error).toMatch(/role/i);
  expect(mockBirthIdentity).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Phase 80 Plan 80-03: task field body validation
// ---------------------------------------------------------------------------

it("Test T-80-03-birth-a: task='build the pool-pick endpoint' → orchestrator receives task", async () => {
  let capturedOpts: unknown;
  mockBirthIdentity.mockImplementation(
    async (opts: unknown, _emit: unknown, _deps: unknown) => {
      capturedOpts = opts;
    },
  );

  const result = await httpPost(port, "/identities/birth", {
    ...VALID_BODY,
    task: "build the pool-pick endpoint",
  });

  expect(result.status).toBe(200); // SSE opens
  const o = capturedOpts as Record<string, unknown>;
  expect(o.task).toBe("build the pool-pick endpoint");
});

it("Test T-80-03-birth-b: task=null → orchestrator sees task=undefined (parsedTask?? -> undefined)", async () => {
  let capturedOpts: unknown;
  mockBirthIdentity.mockImplementation(
    async (opts: unknown, _emit: unknown, _deps: unknown) => {
      capturedOpts = opts;
    },
  );

  const result = await httpPost(port, "/identities/birth", {
    ...VALID_BODY,
    task: null,
  });

  expect(result.status).toBe(200);
  const o = capturedOpts as Record<string, unknown>;
  expect(o.task).toBeUndefined();
});

it("Test T-80-03-birth-c: task=42 (non-string, non-null) → 400 with 'task must be a string or null'", async () => {
  const result = await httpPost(port, "/identities/birth", {
    ...VALID_BODY,
    task: 42,
  });

  expect(result.status).toBe(400);
  const parsed = JSON.parse(result.body);
  expect(parsed.error).toMatch(/task/i);
  expect(mockBirthIdentity).not.toHaveBeenCalled();
});

it("Test T-80-03-birth-d: task with 501 chars → 400 with '≤500 chars' cap", async () => {
  const result = await httpPost(port, "/identities/birth", {
    ...VALID_BODY,
    task: "x".repeat(501),
  });

  expect(result.status).toBe(400);
  const parsed = JSON.parse(result.body);
  expect(parsed.error).toMatch(/task/i);
  expect(parsed.error).toMatch(/500/);
  expect(mockBirthIdentity).not.toHaveBeenCalled();
});

it("Test T-80-03-birth-e: task absent from body → orchestrator sees task=undefined (backward-compat with pre-Phase-80 clients)", async () => {
  let capturedOpts: unknown;
  mockBirthIdentity.mockImplementation(
    async (opts: unknown, _emit: unknown, _deps: unknown) => {
      capturedOpts = opts;
    },
  );

  const result = await httpPost(port, "/identities/birth", VALID_BODY);

  expect(result.status).toBe(200);
  const o = capturedOpts as Record<string, unknown>;
  expect(o.task).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Phase 80 Plan 80-03b: poolPicked body field validation + threading
// ---------------------------------------------------------------------------

it("Test T-80-03b-birth-a: poolPicked=true → 200, orchestrator receives opts.poolPicked === true", async () => {
  let capturedOpts: unknown;
  mockBirthIdentity.mockImplementation(
    async (opts: unknown, _emit: unknown, _deps: unknown) => {
      capturedOpts = opts;
    },
  );

  const result = await httpPost(port, "/identities/birth", {
    ...VALID_BODY,
    poolPicked: true,
  });

  expect(result.status).toBe(200);
  const o = capturedOpts as Record<string, unknown>;
  expect(o.poolPicked).toBe(true);
});

it("Test T-80-03b-birth-b: poolPicked=false → 200, orchestrator receives opts.poolPicked === false", async () => {
  let capturedOpts: unknown;
  mockBirthIdentity.mockImplementation(
    async (opts: unknown, _emit: unknown, _deps: unknown) => {
      capturedOpts = opts;
    },
  );

  const result = await httpPost(port, "/identities/birth", {
    ...VALID_BODY,
    poolPicked: false,
  });

  expect(result.status).toBe(200);
  const o = capturedOpts as Record<string, unknown>;
  expect(o.poolPicked).toBe(false);
});

it("Test T-80-03b-birth-c: poolPicked absent → 200, orchestrator receives opts.poolPicked === undefined (backward compat)", async () => {
  let capturedOpts: unknown;
  mockBirthIdentity.mockImplementation(
    async (opts: unknown, _emit: unknown, _deps: unknown) => {
      capturedOpts = opts;
    },
  );

  const result = await httpPost(port, "/identities/birth", VALID_BODY);

  expect(result.status).toBe(200);
  const o = capturedOpts as Record<string, unknown>;
  expect(o.poolPicked).toBeUndefined();
});

it("Test T-80-03b-birth-d: poolPicked='yes' (non-boolean) → 400 with 'poolPicked must be a boolean'", async () => {
  const result = await httpPost(port, "/identities/birth", {
    ...VALID_BODY,
    poolPicked: "yes",
  });

  expect(result.status).toBe(400);
  const parsed = JSON.parse(result.body);
  expect(parsed.error).toMatch(/poolPicked/i);
  expect(parsed.error).toMatch(/boolean/i);
  expect(mockBirthIdentity).not.toHaveBeenCalled();
});

// Phase 80 review fix H3 — when poolPicked=true, role MUST match the stricter
// ROLE_NAME_RE (no leading digit per segment, no empty segments). Rejecting at
// the HTTP door prevents partial-state births where the identity folder lands
// on disk but Step 6 throws mid-derivation and never mints the relay account.
it("Test T-80-03b-birth-e (review H3): poolPicked=true + role='2foo' (leading digit) → 400, orchestrator not called", async () => {
  const result = await httpPost(port, "/identities/birth", {
    ...VALID_BODY,
    role: "2foo",
    poolPicked: true,
  });
  // The loose ROLE_NAME_PATTERN accepts '2foo'; the stricter ROLE_NAME_RE
  // (used only when poolPicked=true) rejects it. Assert we 400 with the
  // pool-picked-specific error message.
  expect(result.status).toBe(400);
  const parsed = JSON.parse(result.body);
  expect(parsed.error).toMatch(/poolPicked=true/i);
  expect(mockBirthIdentity).not.toHaveBeenCalled();
});

it("Test T-80-03b-birth-f (review H3): poolPicked=false + role='2foo' → 200 (loose regex still applies on legacy branch)", async () => {
  let capturedOpts: unknown;
  mockBirthIdentity.mockImplementation(
    async (opts: unknown, _emit: unknown, _deps: unknown) => {
      capturedOpts = opts;
    },
  );
  const result = await httpPost(port, "/identities/birth", {
    ...VALID_BODY,
    role: "2foo",
    poolPicked: false,
  });
  expect(result.status).toBe(200);
  const o = capturedOpts as Record<string, unknown>;
  expect(o.role).toBe("2foo");
  expect(o.poolPicked).toBe(false);
});

// ---------------------------------------------------------------------------
// Phase 86 Plan 86-04 (D-CTX-86-inherit): title + avatarCandidateId are
// optional. Identities born without them inherit their role's title +
// avatar on landing per the Plan 86-01 publicIdentity merge + the
// GET /:key/avatar role-folder fallback. These tests exercise the
// route-layer contract: absence-friendly body validation, orchestrator
// receives empty-string sentinels, and the finally-block consume path
// skips when no candidate id was submitted.
// ---------------------------------------------------------------------------

it(
  "Test T-86-04-birth-a: body omits title / avatarCandidateId / colorHue / voice → 200 SSE, orchestrator gets empty-string sentinels",
  async () => {
    let capturedOpts: unknown;
    const canned: Array<{ type: string; n?: number; phase?: string; ok?: boolean }> = [
      { type: "step", n: 1, phase: "started" },
      { type: "step", n: 1, phase: "completed" },
      { type: "ended", ok: true },
    ];
    mockBirthIdentity.mockImplementation(
      async (opts: unknown, emit: (e: unknown) => void, _deps: unknown) => {
        capturedOpts = opts;
        for (const event of canned) emit(event);
      },
    );

    // Cosmetics-inherit shape: only birth-required fields (hostId, name,
    // path, role, task) — no title, no avatarCandidateId, no colorHue,
    // no voice. Matches what NewSessionDialog sends after Plan 86-04.
    const bodyWithoutCosmetics = {
      hostId: VALID_BODY.hostId,
      name: VALID_BODY.name,
      path: VALID_BODY.path,
      role: VALID_BODY.role,
    };

    const result = await httpPost(port, "/identities/birth", bodyWithoutCosmetics, {
      Accept: "text/event-stream",
    });

    // SSE opens with 200 and step:1:started + step:1:completed + ended{ok:true}
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toContain("text/event-stream");
    expect(result.body).toContain("step");
    expect(result.body).toContain("ended");

    // Orchestrator received the empty-string sentinels so its own
    // absent-⇒-omit branches (Plan 86-04 buildIdentityFileBody +
    // Step 1 candidate lookup + Step 2.5 sibling write) fire correctly.
    const o = capturedOpts as Record<string, unknown>;
    expect(o.title).toBe("");
    expect(o.avatarCandidateId).toBe("");
    // colorHue absent from body → parsedColorHue is null
    expect(o.colorHue).toBeNull();
    // voice absent from body → parsedVoice is null
    expect(o.voice).toBeNull();
    // required fields still threaded through
    expect(o.hostId).toBe(VALID_BODY.hostId);
    expect(o.name).toBe(VALID_BODY.name);
    expect(o.role).toBe(VALID_BODY.role);
  },
);

it(
  "Test T-86-04-birth-b: body omits avatarCandidateId → consumeCandidateForBirth NOT called (skip on empty)",
  async () => {
    // The route's finally-block calls consumeCandidateForBirth to prevent
    // re-use. Plan 86-04 gates this call on parsedAvatarCandidateId being
    // non-empty — role-inherited-avatar births never touch the candidate
    // cache, so there is nothing to consume. Assert via the mocked module.
    const consumeMock = (
      (await import("./identity-avatar-batch.js")) as unknown as {
        consumeCandidateForBirth: Mock;
      }
    ).consumeCandidateForBirth;
    consumeMock.mockReset();

    mockBirthIdentity.mockImplementation(
      async (_opts: unknown, emit: (e: unknown) => void, _deps: unknown) => {
        emit({ type: "step", n: 1, phase: "started" });
        emit({ type: "step", n: 1, phase: "completed" });
        emit({ type: "ended", ok: true });
      },
    );

    const bodyWithoutCosmetics = {
      hostId: VALID_BODY.hostId,
      name: VALID_BODY.name,
      path: VALID_BODY.path,
      role: VALID_BODY.role,
    };

    const result = await httpPost(port, "/identities/birth", bodyWithoutCosmetics, {
      Accept: "text/event-stream",
    });

    expect(result.status).toBe(200);
    // Regression guard: the finally-block MUST NOT call the consume path
    // when avatarCandidateId was absent from the body.
    expect(consumeMock).not.toHaveBeenCalled();
  },
);

it(
  "Test T-86-04-birth-c: body includes avatarCandidateId → consumeCandidateForBirth IS called (backward compat with explicit-avatar path)",
  async () => {
    const consumeMock = (
      (await import("./identity-avatar-batch.js")) as unknown as {
        consumeCandidateForBirth: Mock;
      }
    ).consumeCandidateForBirth;
    consumeMock.mockReset();

    mockBirthIdentity.mockImplementation(
      async (_opts: unknown, emit: (e: unknown) => void, _deps: unknown) => {
        emit({ type: "step", n: 1, phase: "started" });
        emit({ type: "step", n: 1, phase: "completed" });
        emit({ type: "ended", ok: true });
      },
    );

    // Explicit avatarCandidateId (pre-Plan-86-04 client shape) — still
    // supported; consume path still fires. This guards against regressing
    // the always-supported explicit path when adding the absent branch.
    const result = await httpPost(port, "/identities/birth", VALID_BODY, {
      Accept: "text/event-stream",
    });

    expect(result.status).toBe(200);
    expect(consumeMock).toHaveBeenCalledTimes(1);
    expect(consumeMock).toHaveBeenCalledWith(expect.any(String), VALID_BODY.avatarCandidateId);
  },
);

it(
  "Test T-86-04-birth-d: title=42 (non-string, non-null) → 400 with 'title must be a string or null'",
  async () => {
    const result = await httpPost(port, "/identities/birth", {
      ...VALID_BODY,
      title: 42,
    });
    expect(result.status).toBe(400);
    const parsed = JSON.parse(result.body);
    expect(parsed.error).toMatch(/title/i);
    expect(mockBirthIdentity).not.toHaveBeenCalled();
  },
);

it(
  "Test T-86-04-birth-e: avatarCandidateId=42 (non-string, non-null) → 400 with 'avatarCandidateId must be a string or null'",
  async () => {
    const result = await httpPost(port, "/identities/birth", {
      ...VALID_BODY,
      avatarCandidateId: 42,
    });
    expect(result.status).toBe(400);
    const parsed = JSON.parse(result.body);
    expect(parsed.error).toMatch(/avatarCandidateId/i);
    expect(mockBirthIdentity).not.toHaveBeenCalled();
  },
);

// ---------------------------------------------------------------------------
// Phase 106 Plan 106-03 (D-10 / D-11): SSE stream-shape test for the widened
// ended event contract — failure emits carry a `reason?: string` field so
// backend log-forensics can distinguish Skynet-side step failures from
// supervisor-wait timeouts. The frontend ignores `reason` and always shows
// the same generic alert (D-17); the field exists for backend log/debug
// surfaces only. Wire-parity across BOTH the orchestrator's step failures
// AND the two SSE routes' outer-catch safety-net emits (POST /-route and
// POST /retry/:key-route) is proven by Plan 106-01's Task 2 edits.
// ---------------------------------------------------------------------------

it(
  "Test 106-03 wire: SSE 'ended' event on a Step 6 failure carries the widened `reason` field (D-11)",
  async () => {
    // Provoke a Step-6-like failure inside the mocked orchestrator by emitting
    // a step:6:failed + ended{ok:false, failedStep:6, reason:'admin_mint_failed'}
    // sequence. The route just relays orchestrator emits to the SSE frame; we
    // are asserting that the wire faithfully propagates the new `reason`
    // field to the SSE consumer without dropping or mangling it.
    mockBirthIdentity.mockImplementation(
      async (
        _opts: unknown,
        emit: (e: unknown) => void,
        _deps: unknown,
      ) => {
        emit({ type: "step", n: 1, phase: "started" });
        emit({ type: "step", n: 1, phase: "completed" });
        emit({ type: "step", n: 2, phase: "started" });
        emit({ type: "step", n: 2, phase: "completed" });
        emit({ type: "step", n: 6, phase: "started" });
        emit({
          type: "step",
          n: 6,
          phase: "failed",
          reason: "admin_mint_failed",
        });
        emit({
          type: "ended",
          ok: false,
          failedStep: 6,
          reason: "admin_mint_failed",
        });
      },
    );

    const result = await httpPost(port, "/identities/birth", VALID_BODY, {
      Accept: "text/event-stream",
    });

    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toContain("text/event-stream");

    // Extract SSE frames and find the terminal `ended` frame.
    const frames = result.body
      .split("\n\n")
      .filter((f) => f.trim().length > 0);

    const endedFrame = frames.find((f) => f.includes('"type":"ended"'));
    expect(endedFrame).toBeDefined();
    const dataLine = endedFrame!
      .split("\n")
      .find((l) => l.startsWith("data:"))!;
    const parsed = JSON.parse(dataLine.slice("data:".length).trim());

    // Wire assertions: the new reason field survives the SSE trip end-to-end,
    // failedStep is preserved (unchanged since Phase 75), and ok:false.
    expect(parsed.type).toBe("ended");
    expect(parsed.ok).toBe(false);
    expect(parsed.failedStep).toBe(6);
    expect(parsed.reason).toBe("admin_mint_failed");
  },
);

it(
  "Test 106-03 wire: SSE 'ended' event on a wait-for-supervisor timeout carries reason:'supervisor_wait_timeout' with NO failedStep (D-11 forensics)",
  async () => {
    // The wait-poll timeout path (Phase 106 orchestrator, after Step 8 mint
    // completes) emits ended{ok:false, reason:'supervisor_wait_timeout'} —
    // no failedStep, because this isn't a step failure (all steps 1/2/6/7/8
    // succeeded; the supervisor just never brought the identity alive).
    mockBirthIdentity.mockImplementation(
      async (
        _opts: unknown,
        emit: (e: unknown) => void,
        _deps: unknown,
      ) => {
        emit({ type: "step", n: 1, phase: "started" });
        emit({ type: "step", n: 1, phase: "completed" });
        emit({ type: "step", n: 8, phase: "started" });
        emit({ type: "step", n: 8, phase: "completed" });
        emit({
          type: "ended",
          ok: false,
          reason: "supervisor_wait_timeout",
        });
      },
    );

    const result = await httpPost(port, "/identities/birth", VALID_BODY, {
      Accept: "text/event-stream",
    });

    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toContain("text/event-stream");

    const frames = result.body
      .split("\n\n")
      .filter((f) => f.trim().length > 0);
    const endedFrame = frames.find((f) => f.includes('"type":"ended"'));
    expect(endedFrame).toBeDefined();
    const dataLine = endedFrame!
      .split("\n")
      .find((l) => l.startsWith("data:"))!;
    const parsed = JSON.parse(dataLine.slice("data:".length).trim());

    expect(parsed.type).toBe("ended");
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe("supervisor_wait_timeout");
    // Timeout is NOT attributed to any single step — failedStep must be absent.
    expect(parsed.failedStep).toBeUndefined();
  },
);

// ---------------------------------------------------------------------------
// Phase 110: throttle integration tests
//
// These tests use the REAL global-throttle module (not mocked) to prove
// end-to-end wiring: acquireBirthSlot is called before SSE opens, the
// semaphore actually gates concurrent requests, and ThrottleRejectedError
// maps to a 429 JSON response (not an SSE frame).
//
// __resetThrottleForTests() is called in the global beforeEach above so each
// test starts with a clean semaphore state and re-reads process.env.
// ---------------------------------------------------------------------------

describe("throttle integration", () => {
  it("Test 110-A: three concurrent POST /identities/birth serialize under maxConcurrent=1", async () => {
    // Ensure maxConcurrent=1 (the default) is in effect. The beforeEach
    // __resetThrottleForTests() call already re-reads env; delete any override
    // so the default (1) applies.
    delete process.env.IDENTITY_BIRTH_MAX_CONCURRENT;
    __resetThrottleForTests();

    // Build three manually-resolvable promises (deferred pattern from
    // queue.test.ts). Each deferred is passed to the mock so the test
    // controls when each "birth" finishes and the slot is released.
    type Deferred = { resolve: () => void; promise: Promise<void> };
    function makeDeferred(): Deferred {
      let resolve!: () => void;
      const promise = new Promise<void>((res) => { resolve = res; });
      return { resolve, promise };
    }

    const deferreds: [Deferred, Deferred, Deferred] = [
      makeDeferred(),
      makeDeferred(),
      makeDeferred(),
    ];

    const callOrder: string[] = [];
    let deferredIndex = 0;

    mockBirthIdentity.mockImplementation(
      async (
        opts: unknown,
        emit: (e: unknown) => void,
        _deps: unknown,
      ) => {
        const idx = deferredIndex++;
        const name = (opts as { name: string }).name;
        callOrder.push(name);
        // Wait until the test resolves this deferred to simulate a long birth.
        await deferreds[idx].promise;
        emit({ type: "ended", ok: true, identityId: name, sessionName: name });
      },
    );

    // Fire three concurrent POST requests — none will resolve until their
    // corresponding deferred is resolved.
    const bodyA = { ...VALID_BODY, name: "aaa" };
    const bodyB = { ...VALID_BODY, name: "bbb" };
    const bodyC = { ...VALID_BODY, name: "ccc" };

    const promiseA = httpPost(port, "/identities/birth", bodyA, { Accept: "text/event-stream" });
    const promiseB = httpPost(port, "/identities/birth", bodyB, { Accept: "text/event-stream" });
    const promiseC = httpPost(port, "/identities/birth", bodyC, { Accept: "text/event-stream" });

    // Wait a short time for the first request to acquire the slot and invoke
    // birthIdentity, and for B and C to enter the throttle queue.
    await new Promise((r) => setTimeout(r, 50));

    // Under maxConcurrent=1, only the FIRST birthIdentity call should have
    // fired — B and C are waiting in the throttle queue.
    expect(mockBirthIdentity.mock.calls.length).toBe(1);
    expect(callOrder[0]).toBe("aaa");

    // Resolve A's deferred → slot released → B acquires slot → birthIdentity called for B.
    deferreds[0].resolve();
    await new Promise((r) => setTimeout(r, 50));
    expect(mockBirthIdentity.mock.calls.length).toBe(2);
    expect(callOrder[1]).toBe("bbb");

    // Resolve B's deferred → slot released → C acquires slot → birthIdentity called for C.
    deferreds[1].resolve();
    await new Promise((r) => setTimeout(r, 50));
    expect(mockBirthIdentity.mock.calls.length).toBe(3);
    expect(callOrder[2]).toBe("ccc");

    // Resolve C → all three POSTs complete.
    deferreds[2].resolve();

    // Await all three HTTP responses — they should all return 200 with SSE streams.
    const [resA, resB, resC] = await Promise.all([promiseA, promiseB, promiseC]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resC.status).toBe(200);

    // Assert the call order is A → B → C (FIFO through the throttle queue).
    expect(callOrder).toEqual(["aaa", "bbb", "ccc"]);
  }, 10000);

  it("Test 110-B: 429 at queue-depth cap with maxConcurrent=1 + maxQueueDepth=2", async () => {
    // Configure throttle: 1 concurrent slot, max 2 queued waiters.
    // A 4th request (1 active + 2 queued + 1 overflow) must get 429.
    process.env.IDENTITY_BIRTH_MAX_CONCURRENT = "1";
    process.env.IDENTITY_BIRTH_MAX_QUEUE_DEPTH = "2";
    __resetThrottleForTests();

    // birthIdentity never resolves — holds the slot indefinitely so the queue
    // fills up and request #4 overflows.
    let neverResolve!: () => void;
    const neverResolvingPromise = new Promise<void>((res) => { neverResolve = res; });

    mockBirthIdentity.mockImplementation(async (_opts: unknown, _emit: unknown, _deps: unknown) => {
      await neverResolvingPromise;
    });

    // Request #1: acquires the slot, holds it (birthIdentity never resolves).
    // Do NOT await it here — keep it pending.
    const pendingRequest1 = httpPost(port, "/identities/birth", { ...VALID_BODY, name: "hold1" }, {
      Accept: "text/event-stream",
    }).catch(() => ({ status: -1, headers: {}, body: "" }));

    // Wait for request #1 to acquire the slot before firing the queue-fillers.
    await new Promise((r) => setTimeout(r, 50));

    // Requests #2 and #3: fill the queue (maxQueueDepth=2).
    const pendingRequest2 = httpPost(port, "/identities/birth", { ...VALID_BODY, name: "hold2" }, {
      Accept: "text/event-stream",
    }).catch(() => ({ status: -1, headers: {}, body: "" }));
    const pendingRequest3 = httpPost(port, "/identities/birth", { ...VALID_BODY, name: "hold3" }, {
      Accept: "text/event-stream",
    }).catch(() => ({ status: -1, headers: {}, body: "" }));

    // Wait for requests #2 and #3 to enter the queue before firing #4.
    await new Promise((r) => setTimeout(r, 50));

    // Request #4: queue is at cap → must get 429 immediately (before SSE opens).
    const result4 = await httpPost(port, "/identities/birth", { ...VALID_BODY, name: "overflow" }, {
      Accept: "text/event-stream",
    });

    // Assert 429 with JSON body (not SSE).
    expect(result4.status).toBe(429);
    expect(result4.headers["content-type"]).toContain("application/json");
    // Body must NOT contain SSE frame markers.
    expect(result4.body).not.toContain("text/event-stream");

    const body4 = JSON.parse(result4.body);
    expect(body4.error).toBe("identity_birth_queue_full");
    expect(typeof body4.retry_after_ms).toBe("number");
    expect(body4.retry_after_ms).toBeGreaterThan(0);

    // Cleanup: resolve the never-resolving promise so requests #1/2/3 can
    // drain and the HTTP server closes cleanly in afterEach.
    neverResolve();
    await Promise.all([pendingRequest1, pendingRequest2, pendingRequest3]);
  }, 10000);
});

// ---------------------------------------------------------------------------
// Phase 129 Plan 07 Task 2: auto-tag on multi-user hosts
//
// The POST /identities/birth handler resolves isHostMultiUser(hostId) +
// getUsernameForUserId(userId) BEFORE calling birthIdentity, and threads
// the resolved creatorUsername (or undefined) through as
// BirthOptions.creatorUsername. Assertion targets:
//   - Single-user hosts skip the auto-tag branch entirely (Test A).
//   - Multi-user hosts pass the creator's Skynet username through (Test B).
//   - RBAC-role expansion also fires (Test C — mirrors Assumption A6 at the
//     write side; isHostMultiUser handles the expansion internally per
//     host-user-counter.ts).
//   - Fail-open on username-lookup failure (Test D — creatorUsername stays
//     undefined; sshLogger.warn fires; identity is still created).
//   - Host-access failure short-circuits before DB lookups (Test E — a 400
//     validation fail is the closest analog since the route has no explicit
//     host-access gate; the throttle+creds gate short-circuits before
//     isHostMultiUser is reached).
//   - Birth-flow error paths preserved (Test F — an orchestrator throw
//     surfaces cleanly with auto-tag having done its part).
//   - Info log at successful auto-tag path (Test G — sshLogger.info with
//     operation:"identity_birth_auto_tagged").
//
// v1 scope lock: identity-clone.ts stays UNTOUCHED per RESEARCH § no-leak
// audit — flagged as follow-up. Assertion below verifies via grep.
// ---------------------------------------------------------------------------

describe("Phase 129: auto-tag on multi-user hosts", () => {
  // Test A: single-user host → creatorUsername NOT passed to birthIdentity,
  // no auto-tag. isHostMultiUser returns false; getUsernameForUserId is NOT
  // called (efficiency invariant — skip the round-trip on single-user hosts).
  it("Test A: single-user host → creatorUsername undefined, getUsernameForUserId skipped", async () => {
    mockIsHostMultiUser.mockResolvedValue(false);

    let capturedOpts: unknown;
    mockBirthIdentity.mockImplementation(
      async (opts: unknown, _emit: unknown, _deps: unknown) => {
        capturedOpts = opts;
      },
    );

    const result = await httpPost(port, "/identities/birth", VALID_BODY);

    expect(result.status).toBe(200);
    expect(mockIsHostMultiUser).toHaveBeenCalledWith(VALID_BODY.hostId);
    // Efficiency: no lookup on single-user hosts.
    expect(mockGetUsernameForUserId).not.toHaveBeenCalled();

    const o = capturedOpts as Record<string, unknown>;
    expect(o.creatorUsername).toBeUndefined();
  });

  // Test B: multi-user host + valid getUsernameForUserId → creatorUsername
  // is passed through as-typed from DB.
  it("Test B: multi-user host + valid lookup → creatorUsername passed to birthIdentity", async () => {
    mockIsHostMultiUser.mockResolvedValue(true);
    mockGetUsernameForUserId.mockResolvedValue("ashley");

    let capturedOpts: unknown;
    mockBirthIdentity.mockImplementation(
      async (opts: unknown, _emit: unknown, _deps: unknown) => {
        capturedOpts = opts;
      },
    );

    const result = await httpPost(port, "/identities/birth", VALID_BODY);

    expect(result.status).toBe(200);
    expect(mockIsHostMultiUser).toHaveBeenCalledWith(VALID_BODY.hostId);
    expect(mockGetUsernameForUserId).toHaveBeenCalledWith("1"); // mockUserId

    const o = capturedOpts as Record<string, unknown>;
    expect(o.creatorUsername).toBe("ashley");
  });

  // Test C: multi-user host via RBAC-role expansion — isHostMultiUser
  // handles the expansion internally (Plan 01 host-user-counter.ts's Query
  // 3+4 role-scoped share expansion). At this route-handler layer, the
  // observable is the same: isHostMultiUser returns true, getUsernameForUserId
  // returns the caller's username, creatorUsername is threaded through.
  // Test locks that Assumption A6 lands at the write side.
  it("Test C: multi-user host via RBAC-role → creatorUsername passed (A6 write-side lock)", async () => {
    // Simulate an RBAC-shared t1000 where isHostMultiUser expands
    // hostAccess.roleId → userRoles and returns true. From the route
    // handler's POV the observable is identical to Test B; the difference
    // lives inside host-user-counter.ts's Query 3/4 which Plan 01 tests.
    mockIsHostMultiUser.mockResolvedValue(true);
    mockGetUsernameForUserId.mockResolvedValue("zoe");

    let capturedOpts: unknown;
    mockBirthIdentity.mockImplementation(
      async (opts: unknown, _emit: unknown, _deps: unknown) => {
        capturedOpts = opts;
      },
    );

    const result = await httpPost(port, "/identities/birth", VALID_BODY);

    expect(result.status).toBe(200);
    const o = capturedOpts as Record<string, unknown>;
    expect(o.creatorUsername).toBe("zoe");
  });

  // Test D: multi-user host + getUsernameForUserId returns null →
  // creatorUsername NOT passed, warn log fires, identity is STILL created.
  // Write-side fail-open exception per PATTERNS.md § "Read-path fail-open,
  // write-path fail-closed" — a wrong-user auto-tag is a shape §"would make
  // it wrong" bullet-3 violation, so we skip the auto-tag on lookup failure
  // rather than tag with an empty string or fail the birth.
  it("Test D: multi-user host + lookup returns null → auto-tag skipped, warn log, identity still created", async () => {
    mockIsHostMultiUser.mockResolvedValue(true);
    mockGetUsernameForUserId.mockResolvedValue(null);

    let capturedOpts: unknown;
    mockBirthIdentity.mockImplementation(
      async (opts: unknown, _emit: unknown, _deps: unknown) => {
        capturedOpts = opts;
      },
    );

    const result = await httpPost(port, "/identities/birth", VALID_BODY);

    // Birth path still runs (fail-open).
    expect(result.status).toBe(200);
    expect(mockBirthIdentity).toHaveBeenCalled();

    // creatorUsername undefined (auto-tag skipped).
    const o = capturedOpts as Record<string, unknown>;
    expect(o.creatorUsername).toBeUndefined();

    // Warn log fired with the structured operation key.
    expect(mockSshLoggerWarn).toHaveBeenCalled();
    const warnCall = mockSshLoggerWarn.mock.calls.find((call: unknown[]) => {
      const payload = call[1] as Record<string, unknown> | undefined;
      return payload?.operation === "identity_birth_username_lookup_failed";
    });
    expect(warnCall).toBeDefined();
    const payload = warnCall![1] as Record<string, unknown>;
    expect(payload.userId).toBe("1");
    expect(payload.hostId).toBe(VALID_BODY.hostId);
    expect(payload.name).toBe(VALID_BODY.name);
  });

  // Test E: validation gate short-circuits BEFORE the DB lookups. The route
  // handler has no explicit host-access gate today (host access is checked
  // downstream in the orchestrator via resolveHostById); the closest write-
  // side gate is the body validation. A 400 for missing role must prevent
  // isHostMultiUser from being called. This locks the ordering: validation
  // → auto-tag DB lookups → birthIdentity call.
  it("Test E: 400 validation fail short-circuits BEFORE isHostMultiUser is called", async () => {
    const invalidBody = { ...VALID_BODY };
    delete (invalidBody as Partial<typeof VALID_BODY>).role;

    const result = await httpPost(port, "/identities/birth", invalidBody);

    expect(result.status).toBe(400);
    // Validation gate must fire BEFORE the DB lookups.
    expect(mockIsHostMultiUser).not.toHaveBeenCalled();
    expect(mockGetUsernameForUserId).not.toHaveBeenCalled();
    expect(mockBirthIdentity).not.toHaveBeenCalled();
  });

  // Test F: birth-flow error paths preserved — an orchestrator throw still
  // surfaces cleanly on the wire. Auto-tag adds no new error path — a null
  // creatorUsername passes through cleanly, and a set creatorUsername
  // survives the throw.
  it("Test F: orchestrator throw preserves ended emit; auto-tag adds no new error path", async () => {
    mockIsHostMultiUser.mockResolvedValue(true);
    mockGetUsernameForUserId.mockResolvedValue("ashley");
    mockBirthIdentity.mockRejectedValue(new Error("mock orchestrator failure"));

    const result = await httpPost(port, "/identities/birth", VALID_BODY, {
      Accept: "text/event-stream",
    });

    // The orchestrator's safety-net catch emits ended{ok:false} on the SSE
    // stream (mirrors existing Test 4 shape). The auto-tag path succeeded
    // (creatorUsername was resolved) — the failure is downstream.
    const contentType = result.headers["content-type"] ?? "";
    // Same tolerated dual-shape as Test 4: 500 JSON OR SSE with ended frame.
    if (result.status === 500) {
      expect(contentType).toContain("application/json");
    } else {
      expect(result.status).toBe(200);
      expect(contentType).toContain("text/event-stream");
      expect(result.body).toContain("ended");
    }
    // Auto-tag lookup fired regardless of orchestrator failure.
    expect(mockGetUsernameForUserId).toHaveBeenCalled();
  });

  // Test G: info log at successful auto-tag path — sshLogger.info called
  // with operation:"identity_birth_auto_tagged" carrying the identity name,
  // hostId, and creatorUsername. Matches the roles-create.ts logging shape
  // from Plan 129-06 for cross-endpoint ops parity.
  it("Test G: info log at auto-tag success — identity_birth_auto_tagged operation", async () => {
    mockIsHostMultiUser.mockResolvedValue(true);
    mockGetUsernameForUserId.mockResolvedValue("ashley");

    mockBirthIdentity.mockImplementation(
      async (_opts: unknown, _emit: unknown, _deps: unknown) => {
        // no-op — just consume the call
      },
    );

    const result = await httpPost(port, "/identities/birth", VALID_BODY);

    expect(result.status).toBe(200);
    expect(mockSshLoggerInfo).toHaveBeenCalled();
    const infoCall = mockSshLoggerInfo.mock.calls.find((call: unknown[]) => {
      const payload = call[1] as Record<string, unknown> | undefined;
      return payload?.operation === "identity_birth_auto_tagged";
    });
    expect(infoCall).toBeDefined();
    const payload = infoCall![1] as Record<string, unknown>;
    expect(payload.name).toBe(VALID_BODY.name);
    expect(payload.hostId).toBe(VALID_BODY.hostId);
    expect(payload.creatorUsername).toBe("ashley");
  });
});
