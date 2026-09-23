/**
 * Phase 111 SKEW-05: skew-lock middleware factory tests.
 *
 * Six behaviors from the plan's <behavior> block:
 *
 *   1. Absence-passes: no X-Skynet-Client-Build header → next() called, response
 *      still carries X-Skynet-Server-Build stamp.
 *   2. Match-passes: matching X-Skynet-Client-Build header → next() called,
 *      response stamped.
 *   3. Mismatch-refused: any mismatched client header → 409 JSON
 *      { error: "stale_client", clientBuild, serverBuild }; response still
 *      carries the server-build stamp. Enforcement is unconditional — there
 *      is no NODE_ENV bypass (removed 2026-09-23 per code-review finding 2:
 *      the shape file forbids environment-marker-based disarm; if no build
 *      tag exists to enforce with, that's a different problem).
 *   4. Query-param lane: EventSource / other non-header transports supply
 *      the tag via `?build=<tag>` query string. Matching value → passes
 *      through; mismatched → 409. Header takes precedence when both are
 *      present.
 *   5. Header value truncated for logging: 2000-char mismatched client header
 *      → 409 fires; the structured log's clientBuild field is truncated to
 *      <= 35 chars (32 + "..." suffix, per Security Domain V5).
 *   6. Array header value: if req.headers["x-skynet-client-build"] is an array
 *      (Express `string | string[]` typing), treat as absence — safe fallback.
 *
 * Test harness follows the routes/sessions.test.ts template: express() app,
 * http.createServer().listen(0), fetch via AddressInfo. Logger is mocked to a
 * spy so Test 5 can inspect the truncated log payload without noise.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mock the server-build-id module so tests control what SERVER_BUILD_ID
// resolves to at factory-call time. vi.mock() hoists above all top-level
// code — TEST_BUILD is declared via vi.hoisted() so the factory closure
// can capture it without hitting the ReferenceError from top-level const.
// ---------------------------------------------------------------------------

const { TEST_BUILD } = vi.hoisted(() => ({ TEST_BUILD: "abc123def456" }));

vi.mock("../config/server-build-id.js", () => ({
  getServerBuildId: () => TEST_BUILD,
  SERVER_BUILD_ID: TEST_BUILD,
}));

// ---------------------------------------------------------------------------
// Mock the shared logger so we can spy on the structured log call in Test 5.
// Keeps the test output clean and lets Test 5 inspect the truncated field.
// ---------------------------------------------------------------------------

const { apiLoggerWarnSpy } = vi.hoisted(() => ({
  apiLoggerWarnSpy: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  apiLogger: {
    warn: (...args: unknown[]) => apiLoggerWarnSpy(...args),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  databaseLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER vi.mock() hoisted declarations.
// ---------------------------------------------------------------------------

import { createSkewLockMiddleware } from "./skew-lock-middleware.js";

// ---------------------------------------------------------------------------
// httpRequest helper — mirrors routes/sessions.test.ts pattern
// ---------------------------------------------------------------------------

interface RequestOpts {
  method: string;
  path: string;
  headers?: Record<string, string>;
}

interface RequestResult {
  status: number;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

function httpRequest(
  server: http.Server,
  opts: RequestOpts,
): Promise<RequestResult> {
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
          resolve({
            status: res.statusCode ?? 0,
            body,
            headers: res.headers,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test app factory — mounts the middleware plus a trivial /probe route.
// The route only executes if next() is called; if the middleware short-
// circuits with 409, the route body never runs.
// ---------------------------------------------------------------------------

interface TestServer {
  server: http.Server;
  routeHit: () => number;
  close: () => Promise<void>;
}

async function startTestServer(): Promise<TestServer> {
  const app = express();
  app.use(createSkewLockMiddleware());
  let hits = 0;
  app.get("/probe", (_req, res) => {
    hits += 1;
    res.status(200).json({ ok: true });
  });
  // Support arbitrary paths (some tests hit /whatever).
  app.use((_req, res) => {
    hits += 1;
    res.status(200).json({ ok: true, fallthrough: true });
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    routeHit: () => hits,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("createSkewLockMiddleware", () => {
  beforeEach(() => {
    apiLoggerWarnSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Test 1 — absence: no client-build header passes through and response is stamped", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const s = await startTestServer();
    try {
      const res = await httpRequest(s.server, { method: "GET", path: "/probe" });
      expect(res.status).toBe(200);
      expect(s.routeHit()).toBe(1);
      expect(res.headers["x-skynet-server-build"]).toBe(TEST_BUILD);
      expect(apiLoggerWarnSpy).not.toHaveBeenCalled();
    } finally {
      await s.close();
    }
  });

  it("Test 2 — match: matching client-build header passes through and response is stamped", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const s = await startTestServer();
    try {
      const res = await httpRequest(s.server, {
        method: "GET",
        path: "/probe",
        headers: { "x-skynet-client-build": TEST_BUILD },
      });
      expect(res.status).toBe(200);
      expect(s.routeHit()).toBe(1);
      expect(res.headers["x-skynet-server-build"]).toBe(TEST_BUILD);
      expect(apiLoggerWarnSpy).not.toHaveBeenCalled();
    } finally {
      await s.close();
    }
  });

  it("Test 3 — mismatch-refused in production: 409 stale_client with response still stamped", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const s = await startTestServer();
    try {
      const res = await httpRequest(s.server, {
        method: "POST",
        path: "/probe",
        headers: { "x-skynet-client-build": "different-build" },
      });
      expect(res.status).toBe(409);
      expect(s.routeHit()).toBe(0); // route never entered
      expect(res.headers["x-skynet-server-build"]).toBe(TEST_BUILD);
      expect(res.body).toEqual({
        error: "stale_client",
        clientBuild: "different-build",
        serverBuild: TEST_BUILD,
      });
      expect(apiLoggerWarnSpy).toHaveBeenCalledTimes(1);
      const logArgs = apiLoggerWarnSpy.mock.calls[0];
      expect(logArgs[0]).toBe("Rejected stale client request");
      expect(logArgs[1]).toMatchObject({
        operation: "skew_lock_stale_client_refused",
        clientBuild: "different-build",
        serverBuild: TEST_BUILD,
        method: "POST",
      });
    } finally {
      await s.close();
    }
  });

  it("Test 4a — query-param match: `?build=<tag>` matching serverBuild passes through", async () => {
    const s = await startTestServer();
    try {
      const res = await httpRequest(s.server, {
        method: "GET",
        path: `/probe?build=${encodeURIComponent(TEST_BUILD)}`,
      });
      expect(res.status).toBe(200);
      expect(s.routeHit()).toBe(1);
      expect(res.headers["x-skynet-server-build"]).toBe(TEST_BUILD);
      expect(apiLoggerWarnSpy).not.toHaveBeenCalled();
    } finally {
      await s.close();
    }
  });

  it("Test 4b — query-param mismatch: `?build=<tag>` mismatching serverBuild 409s", async () => {
    const s = await startTestServer();
    try {
      const res = await httpRequest(s.server, {
        method: "GET",
        path: "/probe?build=different-build",
      });
      expect(res.status).toBe(409);
      expect(s.routeHit()).toBe(0);
      expect(res.body).toEqual({
        error: "stale_client",
        clientBuild: "different-build",
        serverBuild: TEST_BUILD,
      });
      expect(apiLoggerWarnSpy).toHaveBeenCalledTimes(1);
    } finally {
      await s.close();
    }
  });

  it("Test 4c — header wins over query param when both present", async () => {
    const s = await startTestServer();
    try {
      // Header matches server; query would mismatch — header should win, pass through.
      const res = await httpRequest(s.server, {
        method: "GET",
        path: "/probe?build=different-build",
        headers: { "x-skynet-client-build": TEST_BUILD },
      });
      expect(res.status).toBe(200);
      expect(s.routeHit()).toBe(1);
      expect(apiLoggerWarnSpy).not.toHaveBeenCalled();
    } finally {
      await s.close();
    }
  });

  it("Test 4d — enforcement is unconditional (no NODE_ENV bypass)", async () => {
    // Regression: the NODE_ENV=development bypass was removed 2026-09-23 per
    // code-review finding 2. Mismatch must refuse regardless of NODE_ENV.
    vi.stubEnv("NODE_ENV", "development");
    const s = await startTestServer();
    try {
      const res = await httpRequest(s.server, {
        method: "GET",
        path: "/probe",
        headers: { "x-skynet-client-build": "different-build" },
      });
      expect(res.status).toBe(409);
      expect(s.routeHit()).toBe(0);
      expect(res.body).toEqual({
        error: "stale_client",
        clientBuild: "different-build",
        serverBuild: TEST_BUILD,
      });
    } finally {
      await s.close();
    }
  });

  it("Test 5 — log payload's clientBuild truncated to <=35 chars (V5) but response body echoes full value", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const s = await startTestServer();
    const longBuild = "x".repeat(2000);
    try {
      const res = await httpRequest(s.server, {
        method: "GET",
        path: "/probe",
        headers: { "x-skynet-client-build": longBuild },
      });
      expect(res.status).toBe(409);
      // Response body echoes the raw value untruncated — the response is
      // consumed by the caller and does not flood any log store.
      expect(
        (res.body as { clientBuild: string }).clientBuild,
      ).toBe(longBuild);
      expect(apiLoggerWarnSpy).toHaveBeenCalledTimes(1);
      const payload = apiLoggerWarnSpy.mock.calls[0][1] as {
        clientBuild: string;
      };
      // Truncation contract: <= 35 characters (32 preserved + 3-char "...").
      expect(payload.clientBuild.length).toBeLessThanOrEqual(35);
      // Sanity: ends with the ellipsis marker.
      expect(payload.clientBuild.endsWith("...")).toBe(true);
    } finally {
      await s.close();
    }
  });

  it("Test 6 — array header value is treated as absence (fail-open, D-06 spirit)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // Direct middleware invocation (bypass HTTP) because Node's http client
    // collapses duplicate headers into a comma-joined string rather than
    // preserving them as an array — we need to force the array shape that
    // Express's own type (`string | string[]`) documents.
    const mw = createSkewLockMiddleware();
    const req = {
      headers: {
        "x-skynet-client-build": ["a", "b"] as string[],
      },
      method: "GET",
      url: "/probe",
    } as unknown as express.Request;

    const setHeaderCalls: Array<[string, string]> = [];
    let statusCode: number | null = null;
    let jsonBody: unknown = null;
    const res = {
      setHeader: (name: string, value: string) => {
        setHeaderCalls.push([name, value]);
      },
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (body: unknown) => {
        jsonBody = body;
        return res;
      },
    } as unknown as express.Response;
    let nextCalled = 0;
    const next: express.NextFunction = () => {
      nextCalled += 1;
    };

    mw(req, res, next);
    expect(nextCalled).toBe(1);
    expect(statusCode).toBeNull();
    expect(jsonBody).toBeNull();
    expect(setHeaderCalls).toContainEqual(["X-Skynet-Server-Build", TEST_BUILD]);
    expect(apiLoggerWarnSpy).not.toHaveBeenCalled();
  });
});
