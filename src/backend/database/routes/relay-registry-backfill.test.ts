/**
 * relay-registry-backfill.test.ts — tests for POST /relay-room/backfill.
 *
 * Covers 5 behaviors:
 *   Test 1: unauthenticated → 401
 *   Test 2: authenticated non-admin → 403 not_authorized (does NOT call backfill)
 *   Test 3: admin happy path (fresh) → 200 with humansAttempted/failed fields
 *   Test 4: admin already-backfilled → 200 { ok:true, skipped:true }
 *   Test 5: admin + ?force=true → passes { force: true } to the utility
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// Auth mock — flip via __authMode.
let __authMode: "pass" | "unauth" = "pass";

vi.mock("../../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          if (__authMode === "unauth") {
            res.status(401).json({ ok: false, error: "unauthenticated" });
            return;
          }
          (req as express.Request & { userId: string }).userId = "user-1";
          next();
        },
    }),
  };
  return { AuthManager };
});

// DB mock — controls the isAdmin lookup result.
let __isAdmin: boolean = true;

vi.mock("../db/index.js", () => {
  const db = {
    select: () => ({
      from: () => ({
        where: async () => (__isAdmin ? [{ id: "user-1", isAdmin: true }] : [{ id: "user-1", isAdmin: false }]),
      }),
    }),
  };
  return { db };
});

// Schema mock — the route imports { users } from schema.js; drizzle's `eq`
// operates on the schema table, so we only need a stub that satisfies TS.
vi.mock("../db/schema.js", () => ({
  users: {},
}));

// Backfill utility mock — spy on invocation + control return value.
// Hoisted so the vi.mock factory (also hoisted) can see it.
const { runRegistryRoomsBackfillMock } = vi.hoisted(() => ({
  runRegistryRoomsBackfillMock: vi.fn(),
}));

vi.mock("../../relay-sessions/registry-rooms-backfill.js", () => ({
  runRegistryRoomsBackfill: runRegistryRoomsBackfillMock,
}));

// databaseLogger mock — silence.
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// drizzle-orm eq stub — the DB mock's chain doesn't inspect its arg.
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

import relayRegistryBackfillRoutes from "./relay-registry-backfill.js";

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/relay-room", relayRegistryBackfillRoutes);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe("POST /relay-room/backfill (admin registry-rooms backfill)", () => {
  beforeEach(() => {
    __authMode = "pass";
    __isAdmin = true;
    runRegistryRoomsBackfillMock.mockReset();
    runRegistryRoomsBackfillMock.mockImplementation(async () => ({
      ok: true as const,
      humansAttempted: 3,
      humansFailed: 0,
      agentsAttempted: 0,
      agentsFailed: 0,
    }));
  });

  it("Test 1: unauthenticated → 401 (does NOT invoke backfill)", async () => {
    __authMode = "unauth";
    await withServer(async (baseUrl) => {
      const r = await fetch(`${baseUrl}/relay-room/backfill`, { method: "POST" });
      expect(r.status).toBe(401);
      expect(runRegistryRoomsBackfillMock).not.toHaveBeenCalled();
    });
  });

  it("Test 2: authenticated non-admin → 403 not_authorized (does NOT invoke backfill)", async () => {
    __isAdmin = false;
    await withServer(async (baseUrl) => {
      const r = await fetch(`${baseUrl}/relay-room/backfill`, { method: "POST" });
      expect(r.status).toBe(403);
      const body = await r.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe("not_authorized");
      expect(runRegistryRoomsBackfillMock).not.toHaveBeenCalled();
    });
  });

  it("Test 3: admin happy path (fresh) → 200 with backfill result", async () => {
    await withServer(async (baseUrl) => {
      const r = await fetch(`${baseUrl}/relay-room/backfill`, { method: "POST" });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body).toEqual({
        ok: true,
        humansAttempted: 3,
        humansFailed: 0,
        agentsAttempted: 0,
        agentsFailed: 0,
      });
      expect(runRegistryRoomsBackfillMock).toHaveBeenCalledTimes(1);
      // Fresh call — no force flag.
      expect(runRegistryRoomsBackfillMock).toHaveBeenCalledWith({});
    });
  });

  it("Test 4: admin already-backfilled → 200 { ok:true, skipped:true }", async () => {
    runRegistryRoomsBackfillMock.mockResolvedValueOnce({
      ok: true as const,
      skipped: true as const,
    });
    await withServer(async (baseUrl) => {
      const r = await fetch(`${baseUrl}/relay-room/backfill`, { method: "POST" });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body).toEqual({ ok: true, skipped: true });
    });
  });

  it("Test 5: admin + ?force=true → passes { force:true } to utility", async () => {
    await withServer(async (baseUrl) => {
      const r = await fetch(`${baseUrl}/relay-room/backfill?force=true`, { method: "POST" });
      expect(r.status).toBe(200);
      expect(runRegistryRoomsBackfillMock).toHaveBeenCalledWith({ force: true });
    });
  });
});
