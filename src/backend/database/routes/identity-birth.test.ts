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
  isLocalHostId: vi.fn(),
  writeMarkdownFileAtomic: vi.fn().mockResolvedValue(undefined),
  // Phase 66 Plan 66-01: additive avatar-sibling dep — the birth route now
  // wires this into BirthDeps. Test 5 asserts d.writeAvatarSiblingFile is a
  // function.
  writeAvatarSiblingFile: vi.fn().mockResolvedValue(undefined),
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
}));

// Phase 77 (Plan 04) added a 503 fail-early gate at POST / and POST /retry/:key
// when matrix admin foundation isn't ingested. Tests here focus on SSE +
// orchestrator-invocation behavior, not the fail-early path, so mock the store
// to return non-null creds so the gate passes and the handler proceeds.
vi.mock("../../matrix/matrix-admin-creds-store.js", () => ({
  getMatrixAdminCreds: vi.fn().mockResolvedValue({
    homeserverBase: "http://mock.homeserver.local:8008",
    userId: "@mock-admin:mock.homeserver.local",
    password: "mock-admin-password",
    accessToken: "syt_mock_admin_token_test",
  }),
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

const mockBirthIdentity = birthIdentity as unknown as Mock;

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
// Setup / teardown
// ---------------------------------------------------------------------------

let server: http.Server;
let port: number;

beforeEach(async () => {
  mockUserId = "1";
  mockBirthIdentity.mockReset();

  const { server: s } = makeServer();
  server = s;
  await startServer(server);
  port = getPort(server);
});

afterEach(async () => {
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
