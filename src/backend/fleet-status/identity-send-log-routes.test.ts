/**
 * Phase 85-03: HTTP surface tests for identity-send-log-routes.
 *
 * Covers auth-gate, input validation, success, and error paths of the
 * POST /identity-send-log/stamp endpoint. Follows the identity-no-dormancy
 * test pattern (bare Express + node:http + mocked AuthManager) rather than
 * supertest, which is not in project deps.
 *
 * Test coverage (9 cases per plan 85-03 Task 3):
 *   Test 1: POST /stamp without JWT → 401; store NOT called.
 *   Test 2: POST /stamp with valid JWT but no body → 400 { error: "invalid identityName" }; store NOT called.
 *   Test 3: POST /stamp with { identityName: "" } → 400; store NOT called.
 *   Test 4: POST /stamp with { identityName: "x".repeat(257) } → 400; store NOT called.
 *   Test 5: POST /stamp with { identityName: "ivy" } (no ts) → 204; store called with ("ivy", <~Date.now()>).
 *   Test 6: POST /stamp with { identityName: "ivy", ts: 1234567890000 } → 204; store called with ("ivy", 1234567890000).
 *   Test 7: POST /stamp with { identityName: "ivy", ts: "not-a-number" } → 400 { error: "invalid ts" }; store NOT called.
 *   Test 8: POST /stamp with { identityName: "ivy", ts: -1 } → 400; store NOT called.
 *   Test 9: POST /stamp when stampIdentityLastSend rejects → 500 { error: "failed to stamp send log" }; store call happened before the rejection was thrown.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth manager mock — mirrors identity-no-dormancy.test.ts's shape.
// mockUserId=null → middleware returns 401; otherwise attaches userId + next().
// ---------------------------------------------------------------------------

let mockUserId: string | null = "1";

vi.mock("../utils/auth-manager.js", () => {
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
// Mock the store — the route dispatches into this. We spy on the exported
// function to assert call args and to simulate rejection in Test 9.
// ---------------------------------------------------------------------------

vi.mock("./identity-send-log-store.js", () => ({
  stampIdentityLastSend: vi.fn(async () => {}),
}));

// ---------------------------------------------------------------------------
// Mock the logger — keep test output quiet.
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import mocked module refs AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { stampIdentityLastSend } from "./identity-send-log-store.js";

// ---------------------------------------------------------------------------
// Import router under test — AFTER all vi.mock() calls.
// ---------------------------------------------------------------------------

import router from "./identity-send-log-routes.js";

// ---------------------------------------------------------------------------
// HTTP request helper — same shape as identity-no-dormancy.test.ts.
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

    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
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
            body = data.length > 0 ? JSON.parse(data) : undefined;
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
// Test app + server lifecycle
// ---------------------------------------------------------------------------

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: authenticated user "1"
  mockUserId = "1";
  // Default: store resolves without throwing
  (stampIdentityLastSend as Mock).mockResolvedValue(undefined);

  const app = express();
  app.use(express.json());
  app.use("/identity-send-log", router);
  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /identity-send-log/stamp", () => {
  it("Test 1: without JWT → 401; store NOT called", async () => {
    mockUserId = null;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identity-send-log/stamp",
      body: { identityName: "ivy" },
    });

    expect(res.status).toBe(401);
    expect(stampIdentityLastSend).not.toHaveBeenCalled();
  });

  it("Test 2: valid JWT, empty body → 400 { error: 'invalid identityName' }", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identity-send-log/stamp",
      body: {},
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid identityName" });
    expect(stampIdentityLastSend).not.toHaveBeenCalled();
  });

  it("Test 3: empty identityName → 400; store NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identity-send-log/stamp",
      body: { identityName: "" },
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid identityName" });
    expect(stampIdentityLastSend).not.toHaveBeenCalled();
  });

  it("Test 4: identityName > 256 chars → 400; store NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identity-send-log/stamp",
      body: { identityName: "x".repeat(257) },
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid identityName" });
    expect(stampIdentityLastSend).not.toHaveBeenCalled();
  });

  it("Test 5: identityName 'ivy' (no ts) → 204; store called with ivy + ~Date.now()", async () => {
    const before = Date.now();
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identity-send-log/stamp",
      body: { identityName: "ivy" },
    });
    const after = Date.now();

    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
    expect(stampIdentityLastSend).toHaveBeenCalledTimes(1);
    const [name, ts] = (stampIdentityLastSend as Mock).mock.calls[0] as [string, number];
    expect(name).toBe("ivy");
    expect(typeof ts).toBe("number");
    // Allow up to 1s of clock drift per plan spec.
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });

  it("Test 6: identityName 'ivy' + explicit ts → 204; store called with exact ts", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identity-send-log/stamp",
      body: { identityName: "ivy", ts: 1234567890000 },
    });

    expect(res.status).toBe(204);
    expect(stampIdentityLastSend).toHaveBeenCalledTimes(1);
    expect(stampIdentityLastSend).toHaveBeenCalledWith("ivy", 1234567890000);
  });

  it("Test 7: ts = 'not-a-number' → 400 { error: 'invalid ts' }; store NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identity-send-log/stamp",
      body: { identityName: "ivy", ts: "not-a-number" },
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid ts" });
    expect(stampIdentityLastSend).not.toHaveBeenCalled();
  });

  it("Test 8: ts = -1 → 400; store NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identity-send-log/stamp",
      body: { identityName: "ivy", ts: -1 },
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid ts" });
    expect(stampIdentityLastSend).not.toHaveBeenCalled();
  });

  it("Test 9: store rejects → 500 { error: 'failed to stamp send log' }; store WAS called", async () => {
    (stampIdentityLastSend as Mock).mockRejectedValue(new Error("db exploded"));

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identity-send-log/stamp",
      body: { identityName: "ivy", ts: 1234567890000 },
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "failed to stamp send log" });
    // The call happened BEFORE the rejection surfaced.
    expect(stampIdentityLastSend).toHaveBeenCalledTimes(1);
    expect(stampIdentityLastSend).toHaveBeenCalledWith("ivy", 1234567890000);
  });
});
