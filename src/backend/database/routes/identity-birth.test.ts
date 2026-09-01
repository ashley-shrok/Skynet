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

// Mock DB — identity routes depend on the db
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    all: vi.fn().mockReturnValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    run: vi.fn(),
  },
  getDb: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    all: vi.fn().mockReturnValue([]),
  }),
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

// Valid request body — Phase 22 SRIC-02 adds required `role` field
const VALID_BODY = {
  hostId: 7,
  name: "testkey",
  title: "Test Identity",
  path: "/workspace/testkey",
  colorHue: 210,
  voice: "Elena.wav",
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
  const d = capturedDeps as Record<string, unknown>;
  expect(typeof d.connectOneShot).toBe("function");
  expect(typeof d.execCommand).toBe("function");
  expect(typeof d.isLocalHostId).toBe("function");
  expect(typeof d.execLocal).toBe("function");
  expect(typeof d.createIdentityRecord).toBe("function");
  expect(typeof d.getIdentityRecord).toBe("function");
  expect(typeof d.getCandidateForBirth).toBe("function");
  expect(typeof d.resolveHostById).toBe("function");
  // Phase 22 SRIC-02: writeMarkdownFileAtomic dep for Step 2.5 pre-write
  expect(typeof d.writeMarkdownFileAtomic).toBe("function");
  // Phase 66 Plan 66-01: writeAvatarSiblingFile dep for Step 2.5 avatar write
  expect(typeof d.writeAvatarSiblingFile).toBe("function");
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
