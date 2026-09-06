/**
 * host.test.ts — Unit tests for the credentialId-required guard for substrate hosts.
 *
 * Plan 75-04 Task 1 (D-08 guard):
 *   POST /host/db/host with runsFleetSubstrate:true AND credentialId absent/null → 400
 *   PUT /host/db/host/:id with runsFleetSubstrate:true AND credentialId absent/null → 400
 *
 * Testing approach:
 *   Direct handler invocation with mock req/res (no supertest / no HTTP server startup).
 *   Mocks: SimpleDBOps.insert/update (prevent DB writes), auth middleware bypassed.
 *   The handler function is extracted from the router and called with a constructed
 *   AuthenticatedRequest-shaped object plus a mock res.
 *
 * Test groups:
 *   P1-P6: POST /host/db/host guard and happy-path
 *   U1-U5: PUT /host/db/host/:id guard and happy-path
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks — must be hoisted before imports
// ---------------------------------------------------------------------------

vi.mock("../../database/db/index.js", () => {
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    limit: vi.fn(() => Promise.resolve([])),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      delete: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    },
    DatabaseSaveTrigger: { forceSave: vi.fn(async () => {}) },
    getDb: vi.fn(() => ({
      select: vi.fn(() => selectChain),
    })),
  };
});

vi.mock("../../utils/simple-db-ops.js", () => ({
  SimpleDBOps: {
    insert: vi.fn(async () => ({ id: 999, userId: "user-1", ip: "1.1.1.1", port: 22 })),
    update: vi.fn(async () => {}),
    select: vi.fn(async () => [{ id: 999, userId: "user-1", ip: "1.1.1.1", port: 22, credentialId: null, authType: "password", connectionType: "ssh", name: "test-host", runsFleetSubstrate: false }]),
  },
}));

vi.mock("../../utils/logger.js", () => ({
  sshLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  databaseLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const passthroughMiddleware = (_req: unknown, _res: unknown, next: () => void) => next();

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: vi.fn(() => ({
      verifyToken: vi.fn(async () => ({ userId: "user-1", valid: true })),
      createAuthMiddleware: vi.fn(() => passthroughMiddleware),
      createDataAccessMiddleware: vi.fn(() => passthroughMiddleware),
    })),
  },
}));

vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: vi.fn(() => ({
      canAccessHost: vi.fn(async () => ({
        hasAccess: true,
        isOwner: true,
      })),
    })),
  },
}));

vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: {
    getUserDataKey: vi.fn(async () => Buffer.from("a".repeat(32))),
  },
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(async () => null),
  resolveHostCredentials: vi.fn(async (host: unknown) => host),
}));

vi.mock("../../utils/ssh-key-utils.js", () => ({
  parseSSHKey: vi.fn(() => ({ success: true })),
}));

vi.mock("./host-normalizers.js", () => ({
  isNonEmptyString: (v: unknown) => typeof v === "string" && v.length > 0,
  isValidPort: (v: unknown) => typeof v === "number" && v > 0 && v <= 65535,
  stripSensitiveFields: (h: unknown) => h,
  transformHostResponse: (h: unknown) => h,
}));

vi.mock("./host-opkssh-routes.js", () => ({ registerHostOpksshRoutes: vi.fn() }));
vi.mock("./host-folder-routes.js", () => ({ registerHostFolderRoutes: vi.fn() }));
vi.mock("./host-file-manager-bookmark-routes.js", () => ({ registerHostFileManagerBookmarkRoutes: vi.fn() }));
vi.mock("./host-command-history-routes.js", () => ({ registerHostCommandHistoryRoutes: vi.fn() }));
vi.mock("./host-autostart-routes.js", () => ({ registerHostAutostartRoutes: vi.fn() }));
vi.mock("./host-internal-routes.js", () => ({ registerHostInternalRoutes: vi.fn() }));
vi.mock("./host-network-routes.js", () => ({ registerHostNetworkRoutes: vi.fn() }));
vi.mock("./host-bulk-routes.js", () => ({ registerHostBulkRoutes: vi.fn() }));

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(async () => null),
}));
vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
}));
vi.mock("axios", () => ({
  default: { post: vi.fn(async () => ({ data: {} })), get: vi.fn(async () => ({ data: {} })) },
}));
vi.mock("multer", () => {
  const multerFn = () => ({
    single: () => (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next(),
    array: () => (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next(),
    fields: () => (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next(),
    none: () => (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next(),
  });
  (multerFn as unknown as { memoryStorage: () => unknown }).memoryStorage = () => ({});
  return { default: multerFn };
});

// Stats server notify — no-op
vi.mock("../../utils/stats-monitor.js", () => ({
  notifyStatsHostUpdated: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { beforeAll } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockRes() {
  const res = {
    _status: 200 as number,
    _body: null as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return res;
}

/**
 * Build a minimal POST-handler-compatible mock request.
 * The host.ts POST handler reads `(req as AuthenticatedRequest).userId` and `req.body`.
 * It also checks `req.file` (for multer key upload), `req.headers`.
 */
function makePostReq(body: Record<string, unknown>, userId = "user-1") {
  return {
    userId,
    body,
    file: undefined,
    headers: {},
    params: {},
    query: {},
  };
}

/**
 * Build a PUT-handler-compatible mock request.
 */
function makePutReq(
  hostId: string,
  body: Record<string, unknown>,
  userId = "user-1",
) {
  return {
    userId,
    body,
    file: undefined,
    headers: {},
    params: { id: hostId },
    query: {},
  };
}

// ---------------------------------------------------------------------------
// Extract route handlers from the Express router
//
// host.ts uses express.Router() and registers handlers on specific paths.
// We import the router and walk its stack to find the POST and PUT handlers
// for the '/db/host' and '/db/host/:id' paths.
// ---------------------------------------------------------------------------

let postHandler: ((req: unknown, res: unknown) => Promise<void>) | null = null;
let putHandler: ((req: unknown, res: unknown) => Promise<void>) | null = null;

// We need to extract the actual handlers. The approach: import the router
// (which is the default export) and find the route handlers.
// Note: host.ts registers routes in the pattern:
//   router.post("/db/host", ..., handler)
//   router.put("/db/host/:id", ..., handler)

// Import dynamically to avoid issues with the module-level side effects.
// We capture handlers by inspecting the router stack after import.

async function loadHandlers() {
  // Dynamic import ensures mocks are in place before module code runs
  const mod = await import("./host.js");
  const router = mod.default;

  // Walk the router.stack to find the handlers
  for (const layer of (router as unknown as { stack: { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }[] }).stack) {
    if (!layer.route) continue;
    const route = layer.route;

    if (route.path === "/db/host" && route.methods["post"]) {
      // Find the actual endpoint handler (last in the middleware stack, after multer)
      const handlers = route.stack.map((h) => h.handle);
      // The real handler is the last one (after multer middleware)
      const last = handlers[handlers.length - 1];
      postHandler = last as typeof postHandler;
    }

    if (route.path === "/db/host/:id" && route.methods["put"]) {
      const handlers = route.stack.map((h) => h.handle);
      const last = handlers[handlers.length - 1];
      putHandler = last as typeof putHandler;
    }
  }
}

// ---------------------------------------------------------------------------
// Load handlers once before all tests
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await loadHandlers();
}, 60_000);

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(async () => {
  vi.clearAllMocks();

  // Restore defaults
  (SimpleDBOps.insert as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 999,
    userId: "user-1",
    ip: "1.1.1.1",
    port: 22,
    name: "test-host",
    connectionType: "ssh",
    runsFleetSubstrate: false,
    credentialId: null,
    authType: "password",
  });
  (SimpleDBOps.update as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (SimpleDBOps.select as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      id: 999,
      userId: "user-1",
      ip: "1.1.1.1",
      port: 22,
      name: "test-host",
      connectionType: "ssh",
      runsFleetSubstrate: false,
      credentialId: null,
      authType: "password",
    },
  ]);

  // Set up db.select chain to return owner record for PUT handler auth checks
  const { db } = await import("../../database/db/index.js");
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve([{ userId: "user-1", credentialId: null, authType: "password" }])),
  };
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectChain);
});

// ---------------------------------------------------------------------------
// POST /host/db/host tests — P1-P6
// ---------------------------------------------------------------------------

describe("POST /db/host — credentialId guard (P1-P6)", () => {
  it("P1: runsFleetSubstrate:true + credentialId:null → 400 with required error message", async () => {
    const req = makePostReq({
      ip: "1.1.1.1",
      port: 22,
      runsFleetSubstrate: true,
      credentialId: null,
      password: "x",
    });
    const res = makeMockRes();

    await postHandler!(req, res);

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toContain("runsFleetSubstrate=true must use a named credential");
    expect(SimpleDBOps.insert).not.toHaveBeenCalled();
  });

  it("P2: runsFleetSubstrate:true + credentialId omitted → 400 with required error message", async () => {
    const req = makePostReq({
      ip: "1.1.1.1",
      port: 22,
      runsFleetSubstrate: true,
      password: "x",
    });
    const res = makeMockRes();

    await postHandler!(req, res);

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toContain("runsFleetSubstrate=true must use a named credential");
    expect(SimpleDBOps.insert).not.toHaveBeenCalled();
  });

  it("P3: SSH host with runsFleetSubstrate omitted (defaults true for SSH) + no credentialId → 400", async () => {
    // host.ts:244-247: effectiveRunsFleetSubstrate defaults true for SSH when runsFleetSubstrate is undefined
    const req = makePostReq({
      ip: "1.1.1.1",
      port: 22,
      connectionType: "ssh",
      password: "x",
      // runsFleetSubstrate intentionally omitted
      // credentialId intentionally omitted
    });
    const res = makeMockRes();

    await postHandler!(req, res);

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toContain("runsFleetSubstrate=true must use a named credential");
    expect(SimpleDBOps.insert).not.toHaveBeenCalled();
  });

  it("P4: runsFleetSubstrate:false + inline creds → NOT 400 (guard does not trigger)", async () => {
    const req = makePostReq({
      ip: "1.1.1.1",
      port: 22,
      runsFleetSubstrate: false,
      password: "x",
    });
    const res = makeMockRes();

    await postHandler!(req, res);

    expect(res._status).not.toBe(400);
  });

  it("P5: RDP host (non-SSH, defaults runsFleetSubstrate:false) + inline creds → NOT 400", async () => {
    const req = makePostReq({
      ip: "1.1.1.1",
      port: 3389,
      connectionType: "rdp",
      password: "x",
    });
    const res = makeMockRes();

    await postHandler!(req, res);

    expect(res._status).not.toBe(400);
  });

  it("P6: runsFleetSubstrate:true + credentialId:42 → NOT 400 (guard passes)", async () => {
    const req = makePostReq({
      ip: "1.1.1.1",
      port: 22,
      runsFleetSubstrate: true,
      credentialId: 42,
    });
    const res = makeMockRes();

    await postHandler!(req, res);

    expect(res._status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PUT /host/db/host/:id tests — U1-U5
// ---------------------------------------------------------------------------

describe("PUT /db/host/:id — credentialId guard (U1-U5)", () => {
  it("U1: flag flip-on (false→true) + no credentialId → 400", async () => {
    // Existing host has runsFleetSubstrate:false, no credentialId
    const req = makePutReq("1", {
      ip: "1.1.1.1",
      port: 22,
      runsFleetSubstrate: true,
      credentialId: null,
    });
    const res = makeMockRes();

    await putHandler!(req, res);

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toContain("runsFleetSubstrate=true must use a named credential");
    expect(SimpleDBOps.update).not.toHaveBeenCalled();
  });

  it("U2: flag stays true + credentialId:null → 400", async () => {
    const req = makePutReq("1", {
      ip: "1.1.1.1",
      port: 22,
      runsFleetSubstrate: true,
      credentialId: null,
    });
    const res = makeMockRes();

    await putHandler!(req, res);

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toContain("runsFleetSubstrate=true must use a named credential");
    expect(SimpleDBOps.update).not.toHaveBeenCalled();
  });

  it("U3: flag stays false, no credentialId → NOT 400", async () => {
    const req = makePutReq("1", {
      ip: "1.1.1.1",
      port: 22,
      runsFleetSubstrate: false,
      credentialId: null,
    });
    const res = makeMockRes();

    await putHandler!(req, res);

    expect(res._status).not.toBe(400);
  });

  it("U4: flag flip-off (substrate→non-substrate), credentialId:null → NOT 400", async () => {
    const req = makePutReq("1", {
      ip: "1.1.1.1",
      port: 22,
      runsFleetSubstrate: false,
      credentialId: null,
    });
    const res = makeMockRes();

    await putHandler!(req, res);

    expect(res._status).not.toBe(400);
  });

  it("U5: flag stays true with credentialId:42 → NOT 400 (guard passes)", async () => {
    const req = makePutReq("1", {
      ip: "1.1.1.1",
      port: 22,
      runsFleetSubstrate: true,
      credentialId: 42,
    });
    const res = makeMockRes();

    await putHandler!(req, res);

    expect(res._status).not.toBe(400);
  });
});
