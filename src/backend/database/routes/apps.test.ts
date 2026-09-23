/**
 * Phase 119 Plan 05 Task 2 — tests for GET /apps/:hostId/:slug/icon.
 *
 * D-06 mirror of GET /identities/:identityKey/avatar?hostId=<n> but with
 * hostId moved into the URL path (per D-06). Covers the twelve behaviours
 * spelled out in 119-05-PLAN.md Task 2 <behavior>:
 *   1.  401 without JWT
 *   2.  400 on uppercase slug (fails APP_SLUG_RE)
 *   3.  400 on `../` slug
 *   4.  400 on non-numeric hostId
 *   5.  400 on negative hostId
 *   6.  400 on zero hostId
 *   7.  404 when readAppIconFile returns null
 *   8.  200 + image/webp + Content-Length + ETag on present
 *   9.  304 when If-None-Match matches ETag
 *   10. 502 when resolveHostById returns null (cross-tenant or unknown)
 *   11. 502 when connectOneShot throws
 *   12. conn.end() called in finally (REMOTE branch)
 *
 * Scaffold mirrors identities.get-disk.test.ts's supertest-style harness:
 *   - AuthManager mock injects userId (or 401 when mockUserId=null)
 *   - vi.mock on identity-artifact-reader (readAppIconFile + APP_SLUG_RE
 *     + isLocalHostId), ssh-one-shot (connectOneShot), host-resolver
 *     (resolveHostById), tmux-helper (execCommand)
 *   - Bare Express app + Node http.request for the HTTP surface
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth manager mock — always authenticates as "test-user" unless mockUserId=null
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

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Identity-artifact-reader mock — only the two exports the apps route uses
// ---------------------------------------------------------------------------

const readAppIconFileMock = vi.fn();
const isLocalHostIdMock = vi.fn();

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  readAppIconFile: (conn: unknown, slug: string) => readAppIconFileMock(conn, slug),
  isLocalHostId: (n: number | undefined) => isLocalHostIdMock(n),
  APP_SLUG_RE: /^[a-z0-9-]{1,64}$/,
}));

// ---------------------------------------------------------------------------
// SSH mocks
// ---------------------------------------------------------------------------

const connectOneShotMock = vi.fn();
const resolveHostByIdMock = vi.fn();

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: (host: unknown, timeoutMs: number) =>
    connectOneShotMock(host, timeoutMs),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: (hostId: number, userId: string) =>
    resolveHostByIdMock(hostId, userId),
}));

vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn().mockResolvedValue(""),
}));

// ---------------------------------------------------------------------------
// Registry-holder mock — HIGH-1 redirect route reads via getRegistry().
// Individual tests configure getAppSnapshot's return via getAppSnapshotMock.
// ---------------------------------------------------------------------------

const getAppSnapshotMock = vi.fn<() => unknown[]>();
const getRegistryMock = vi.fn<() => unknown>();

vi.mock("../../fleet-status/registry-holder.js", () => ({
  getRegistry: () => getRegistryMock(),
  setRegistry: vi.fn(),
  _resetRegistryForTesting: vi.fn(),
}));

function makeFakeConnWithEnd() {
  return { __fake: "ssh-conn", end: vi.fn() };
}

// ---------------------------------------------------------------------------
// Import router AFTER mocks
// ---------------------------------------------------------------------------

import appsRouter from "./apps.js";

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpGet(
  server: http.Server,
  path: string,
  headers: http.OutgoingHttpHeaders = {},
): Promise<{
  status: number;
  body: unknown;
  headers: http.IncomingHttpHeaders;
  rawBody: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const req = http.request(
      { hostname: "127.0.0.1", port, method: "GET", path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks);
          const text = rawBody.toString();
          let parsed: unknown = text;
          const ct = res.headers["content-type"] || "";
          if (typeof ct === "string" && ct.includes("application/json")) {
            try {
              parsed = JSON.parse(text);
            } catch {
              /* leave as text */
            }
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, headers: res.headers, rawBody });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let server: http.Server;

// HIGH-1 redirect route defaults: SKYNET_COOKIE_DOMAIN is preserved across
// tests only because unrelated code paths in this project read it at module
// load. The redirect route itself no longer consults it — the serve-URL
// parent is derived from the incoming request's Host header (see apps.ts
// module-header for rationale).
const ORIGINAL_COOKIE_DOMAIN = process.env.SKYNET_COOKIE_DOMAIN;

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "test-user";
  // Sensible default: REMOTE branch; host resolves; connectOneShot works;
  // readAppIconFile returns null (404). Individual tests override as needed.
  isLocalHostIdMock.mockReturnValue(false);
  resolveHostByIdMock.mockResolvedValue({
    // HIGH-1: host.name IS the tailscale hostname the redirect route uses
    // to build `<hostname>-<port>.serve.<domain>`. Default to "t1000" so
    // tests that don't override see a realistic value.
    name: "t1000",
    ip: "10.0.0.5",
    port: 22,
    username: "ubuntu",
    authType: "key",
    key: "fake-key",
  });
  connectOneShotMock.mockResolvedValue(makeFakeConnWithEnd());
  readAppIconFileMock.mockResolvedValue(null);
  // HIGH-1 redirect defaults: registry present, app absent (individual
  // tests populate the snapshot for the 302 path).
  getAppSnapshotMock.mockReturnValue([]);
  getRegistryMock.mockReturnValue({
    getAppSnapshot: () => getAppSnapshotMock(),
  });
  // HIGH-1 default: SKYNET_COOKIE_DOMAIN set so the route can build a URL.
  process.env.SKYNET_COOKIE_DOMAIN = "term.example.com";

  const app = express();
  app.use("/apps", appsRouter);
  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  if (ORIGINAL_COOKIE_DOMAIN === undefined) {
    delete process.env.SKYNET_COOKIE_DOMAIN;
  } else {
    process.env.SKYNET_COOKIE_DOMAIN = ORIGINAL_COOKIE_DOMAIN;
  }
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ===========================================================================
// Test 1 — 401 without JWT (authenticateJWT gate)
// ===========================================================================

describe("GET /apps/:hostId/:slug/icon — auth gate", () => {
  it("T1: returns 401 when the caller has no JWT", async () => {
    mockUserId = null;
    const res = await httpGet(server, "/apps/1/scratch-test/icon");
    expect(res.status).toBe(401);
    expect(connectOneShotMock).not.toHaveBeenCalled();
    expect(readAppIconFileMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Tests 2, 3 — slug validation (APP_SLUG_RE)
// ===========================================================================

describe("GET /apps/:hostId/:slug/icon — slug validation", () => {
  it("T2: returns 400 on uppercase slug (fails APP_SLUG_RE)", async () => {
    const res = await httpGet(server, "/apps/1/BADSLUG/icon");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: expect.stringMatching(/slug must match/i),
    });
    expect(connectOneShotMock).not.toHaveBeenCalled();
  });

  it("T3: returns 400 on traversal-shaped slug (`../etc/passwd`)", async () => {
    // Express URL-decodes; the intermediate `../etc/passwd` yields multiple
    // path segments so no `:slug` binding is reached — Express returns 404.
    // But a pure percent-encoded traversal still fails the regex gate.
    const res = await httpGet(server, "/apps/1/%2E%2E%2Fetc%2Fpasswd/icon");
    expect(res.status).toBe(400);
    expect(connectOneShotMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Tests 4, 5, 6 — hostId validation (positive integer)
// ===========================================================================

describe("GET /apps/:hostId/:slug/icon — hostId validation", () => {
  it("T4: returns 400 on non-numeric hostId", async () => {
    const res = await httpGet(server, "/apps/abc/scratch-test/icon");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: expect.stringMatching(/hostId/i),
    });
    expect(connectOneShotMock).not.toHaveBeenCalled();
  });

  it("T5: returns 400 on negative hostId", async () => {
    const res = await httpGet(server, "/apps/-1/scratch-test/icon");
    expect(res.status).toBe(400);
    expect(connectOneShotMock).not.toHaveBeenCalled();
  });

  it("T6: returns 400 on zero hostId", async () => {
    const res = await httpGet(server, "/apps/0/scratch-test/icon");
    expect(res.status).toBe(400);
    expect(connectOneShotMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Test 7 — 404 when the icon file is absent on disk
// ===========================================================================

describe("GET /apps/:hostId/:slug/icon — 404 on missing icon", () => {
  it("T7: returns 404 with canned body when readAppIconFile returns null", async () => {
    readAppIconFileMock.mockResolvedValueOnce(null);
    const res = await httpGet(server, "/apps/1/scratch-test/icon");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "no icon on disk for this app" });
  });
});

// ===========================================================================
// Tests 8, 9 — 200 with bytes + ETag + 304 on match
// ===========================================================================

describe("GET /apps/:hostId/:slug/icon — 200 + ETag + 304", () => {
  const FAKE_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x57, 0x45, 0x42, 0x50]);

  it("T8: returns 200 + image/webp + Content-Length + ETag + bytes on present", async () => {
    readAppIconFileMock.mockResolvedValueOnce({ bytes: FAKE_BYTES, mime: "image/webp" });
    const res = await httpGet(server, "/apps/1/scratch-test/icon");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/webp");
    expect(res.headers["content-length"]).toBe(String(FAKE_BYTES.byteLength));
    expect(res.headers["etag"]).toBeDefined();
    expect(res.headers["etag"]).toMatch(/^"disk-[0-9a-f]+"$/);
    expect(res.rawBody.equals(FAKE_BYTES)).toBe(true);
  });

  it("T9: returns 304 when If-None-Match matches the current ETag", async () => {
    readAppIconFileMock.mockResolvedValue({ bytes: FAKE_BYTES, mime: "image/webp" });
    // First request to discover the ETag.
    const first = await httpGet(server, "/apps/1/scratch-test/icon");
    expect(first.status).toBe(200);
    const etag = first.headers["etag"];
    expect(typeof etag).toBe("string");
    // Second request with If-None-Match → 304 empty body.
    const second = await httpGet(server, "/apps/1/scratch-test/icon", {
      "if-none-match": etag as string,
    });
    expect(second.status).toBe(304);
    expect(second.rawBody.byteLength).toBe(0);
  });
});

// ===========================================================================
// Test 10 — 502 when resolveHostById returns null
// ===========================================================================

describe("GET /apps/:hostId/:slug/icon — 502 on unreachable / cross-tenant", () => {
  it("T10: returns 502 when resolveHostById returns null (unknown OR no access)", async () => {
    resolveHostByIdMock.mockResolvedValueOnce(null);
    const res = await httpGet(server, "/apps/999/scratch-test/icon");
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "app home box unreachable" });
    // Must not attempt connect after resolve fails.
    expect(connectOneShotMock).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test 11 — 502 when connectOneShot throws
  // -----------------------------------------------------------------------
  it("T11: returns 502 when connectOneShot throws", async () => {
    connectOneShotMock.mockRejectedValueOnce(new Error("SSH refused"));
    const res = await httpGet(server, "/apps/999/scratch-test/icon");
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "app home box unreachable" });
  });
});

// ===========================================================================
// Test 12 — SSH conn cleanup in finally
// ===========================================================================

describe("GET /apps/:hostId/:slug/icon — SSH connection lifecycle", () => {
  it("T12: conn.end() is called after a successful REMOTE-branch request", async () => {
    const fakeConn = makeFakeConnWithEnd();
    connectOneShotMock.mockResolvedValueOnce(fakeConn);
    readAppIconFileMock.mockResolvedValueOnce({
      bytes: Buffer.from([0x00, 0x01, 0x02]),
      mime: "image/webp",
    });
    const res = await httpGet(server, "/apps/1/scratch-test/icon");
    expect(res.status).toBe(200);
    expect(fakeConn.end).toHaveBeenCalledTimes(1);
  });

  it("T12b: conn.end() is called after a 404 REMOTE-branch request (readAppIconFile null)", async () => {
    const fakeConn = makeFakeConnWithEnd();
    connectOneShotMock.mockResolvedValueOnce(fakeConn);
    readAppIconFileMock.mockResolvedValueOnce(null);
    const res = await httpGet(server, "/apps/1/scratch-test/icon");
    expect(res.status).toBe(404);
    expect(fakeConn.end).toHaveBeenCalledTimes(1);
  });

  it("T12c: conn.end() is called after a 502 REMOTE-branch request (readAppIconFile throws)", async () => {
    const fakeConn = makeFakeConnWithEnd();
    connectOneShotMock.mockResolvedValueOnce(fakeConn);
    readAppIconFileMock.mockRejectedValueOnce(new Error("SFTP timeout"));
    const res = await httpGet(server, "/apps/1/scratch-test/icon");
    expect(res.status).toBe(502);
    expect(fakeConn.end).toHaveBeenCalledTimes(1);
  });

  it("T12d: LOCAL branch never invokes connectOneShot", async () => {
    isLocalHostIdMock.mockReturnValueOnce(true);
    readAppIconFileMock.mockResolvedValueOnce({
      bytes: Buffer.from([0xff]),
      mime: "image/webp",
    });
    const res = await httpGet(server, "/apps/1/scratch-test/icon");
    expect(res.status).toBe(200);
    expect(connectOneShotMock).not.toHaveBeenCalled();
    expect(readAppIconFileMock).toHaveBeenCalledWith(null, "scratch-test");
  });
});

// ===========================================================================
// Code-review MEDIUM-4 (fix pass 2026-09-18): three coverage-gap tests
//   T13 — LOCAL branch 502 when readAppIconFile throws (oversize / IO error).
//         T12d asserted the 200-on-present path but no test covered the
//         LOCAL branch's throw → 502 mapping (the route's outer catch block).
//   T14 — route-boundary APP_SLUG_RE rejects a slug that would pass a naive
//         length check but fails the regex (e.g., contains `_`). Asserts
//         readAppIconFile is NEVER called — the defence-in-depth guard at
//         the route boundary catches it before the reader ever runs.
//   T15 — If-None-Match provided but does NOT match the current ETag → 200
//         with fresh bytes + the fresh ETag. T9 covers the match → 304 path;
//         this closes the "stale client ETag → correct fresh delivery" case.
// ===========================================================================

describe("GET /apps/:hostId/:slug/icon — code-review MEDIUM-4 coverage gaps", () => {
  it("T13: LOCAL branch — readAppIconFile throws → 502 (canned body)", async () => {
    isLocalHostIdMock.mockReturnValueOnce(true);
    readAppIconFileMock.mockRejectedValueOnce(
      new Error("icon exceeds cap on disk"),
    );
    const res = await httpGet(server, "/apps/1/scratch-test/icon");
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "app home box unreachable" });
    // Sanity: LOCAL branch skipped connect entirely; reader was called.
    expect(connectOneShotMock).not.toHaveBeenCalled();
    expect(readAppIconFileMock).toHaveBeenCalledTimes(1);
  });

  it("T14: slug with underscore fails route-boundary APP_SLUG_RE → 400, reader never called", async () => {
    // `scratch_test` passes a naive [a-z0-9_-]{1,64} check but fails the
    // strict APP_SLUG_RE `[a-z0-9-]{1,64}` (no underscore allowed).
    const res = await httpGet(server, "/apps/1/scratch_test/icon");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: expect.stringMatching(/slug must match/i),
    });
    // Defence-in-depth invariant: the route-boundary regex catches it
    // BEFORE any host resolution, SSH work, or reader invocation.
    expect(resolveHostByIdMock).not.toHaveBeenCalled();
    expect(connectOneShotMock).not.toHaveBeenCalled();
    expect(readAppIconFileMock).not.toHaveBeenCalled();
  });

  it("T15: If-None-Match provided but does NOT match current ETag → 200 + fresh bytes + fresh ETag", async () => {
    const FRESH_BYTES = Buffer.from([0xff, 0xee, 0xdd, 0xcc]);
    readAppIconFileMock.mockResolvedValueOnce({
      bytes: FRESH_BYTES,
      mime: "image/webp",
    });
    const res = await httpGet(server, "/apps/1/scratch-test/icon", {
      "if-none-match": '"disk-stale-etag-value"',
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/webp");
    expect(res.headers["content-length"]).toBe(String(FRESH_BYTES.byteLength));
    // ETag must be the fresh md5(FRESH_BYTES), NOT the stale one the
    // caller sent. Route uses strict-equality on If-None-Match, so any
    // mismatch (including the sentinel above) must fall through to 200.
    expect(res.headers["etag"]).toBeDefined();
    expect(res.headers["etag"]).toMatch(/^"disk-[0-9a-f]+"$/);
    expect(res.headers["etag"]).not.toBe('"disk-stale-etag-value"');
    expect(res.rawBody.equals(FRESH_BYTES)).toBe(true);
  });
});

// ===========================================================================
// Code-review HIGH-1 (fix pass 2026-09-18): GET /apps/:hostId/:slug — 302
// redirect to the app's serve-URL. The route:
//   1. Authenticates via authenticateJWT (401 without token)
//   2. Validates slug via APP_SLUG_RE (400 on fail)
//   3. Validates hostId as positive integer (400 on fail)
//   4. Resolves host via resolveHostById → 502 on null/throw
//   5. Reads app from registry.getAppSnapshot() → 404 on missing OR null-port
//   6. Redirects 302 to `https://<hostname>-<port>.serve.<request-host>`,
//      where <request-host> is the incoming request's own Host header —
//      NOT SKYNET_COOKIE_DOMAIN (multi-parent fix, see apps.ts module-header).
//
// Every branch is exercised below. The 302 path also asserts the Location
// header matches the constructed serve-URL exactly, including a
// multi-parent case (T-HIGH-1-T5) that would have shipped a broken URL
// under the old cookie-domain-derived construction.
// ===========================================================================

describe("GET /apps/:hostId/:slug — HIGH-1 redirect route", () => {
  // -----------------------------------------------------------------------
  // Helper: HEAD-style GET that does NOT auto-follow redirects. The default
  // httpGet helper above doesn't follow redirects either (Node's http.request
  // returns whatever the server sent), so we can reuse it and inspect
  // res.status + res.headers.location directly.
  // -----------------------------------------------------------------------

  it("HIGH-1-T1: 401 without JWT", async () => {
    mockUserId = null;
    const res = await httpGet(server, "/apps/1/scratch-test");
    expect(res.status).toBe(401);
    // Downstream mocks should not have been called at all.
    expect(resolveHostByIdMock).not.toHaveBeenCalled();
    expect(getAppSnapshotMock).not.toHaveBeenCalled();
  });

  it("HIGH-1-T2: 400 on invalid slug (uppercase)", async () => {
    const res = await httpGet(server, "/apps/1/BADSLUG");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: expect.stringMatching(/slug must match/i),
    });
    expect(resolveHostByIdMock).not.toHaveBeenCalled();
  });

  it("HIGH-1-T3: 400 on invalid hostId (non-numeric)", async () => {
    const res = await httpGet(server, "/apps/abc/scratch-test");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: expect.stringMatching(/hostId/i),
    });
    expect(resolveHostByIdMock).not.toHaveBeenCalled();
  });

  it("HIGH-1-T4: 400 on zero hostId", async () => {
    const res = await httpGet(server, "/apps/0/scratch-test");
    expect(res.status).toBe(400);
    expect(resolveHostByIdMock).not.toHaveBeenCalled();
  });

  it("HIGH-1-T5: multi-parent — Location parent matches the request Host, NOT SKYNET_COOKIE_DOMAIN", async () => {
    // Repro of the T800 bug Stacy diagnosed 2026-09-23: an instance
    // reachable via BOTH `ai.aithercloud.com` and `skynet.aithercloud.com`
    // has to set SKYNET_COOKIE_DOMAIN to the eTLD+1 (`aithercloud.com`)
    // so login cookies span both subdomains. Under the pre-fix code, that
    // umbrella got pasted into the serve URL and produced
    // `<host>-<port>.serve.aithercloud.com` — a subdomain that isn't
    // served on the edge. The fix derives the parent from the click's
    // origin, so a click from either parent stays on that parent.
    process.env.SKYNET_COOKIE_DOMAIN = "aithercloud.com";
    getAppSnapshotMock.mockReturnValue([
      {
        hostId: "1",
        slug: "scratch-test",
        title: "Scratch Test",
        description: "",
        port: 9502,
        hasIcon: false,
        createdAtMs: 0,
        isHealthy: true,
        healthMessage: null,
        users: null,
      },
    ]);

    // Click from skynet.aithercloud.com → Location stays on that parent.
    const res1 = await httpGet(server, "/apps/1/scratch-test", {
      Host: "skynet.aithercloud.com",
    });
    expect(res1.status).toBe(302);
    expect(res1.headers["location"]).toBe(
      "https://t1000-9502.serve.skynet.aithercloud.com",
    );

    // Click from ai.aithercloud.com → Location stays on THAT parent.
    const res2 = await httpGet(server, "/apps/1/scratch-test", {
      Host: "ai.aithercloud.com",
    });
    expect(res2.status).toBe(302);
    expect(res2.headers["location"]).toBe(
      "https://t1000-9502.serve.ai.aithercloud.com",
    );
  });

  it("HIGH-1-T6: 502 when resolveHostById returns null (unknown host OR no access)", async () => {
    resolveHostByIdMock.mockResolvedValueOnce(null);
    const res = await httpGet(server, "/apps/999/scratch-test");
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "app home box unreachable" });
    // Registry NOT consulted after host-resolve fails.
    expect(getAppSnapshotMock).not.toHaveBeenCalled();
  });

  it("HIGH-1-T7: 502 when resolveHostById throws", async () => {
    resolveHostByIdMock.mockRejectedValueOnce(new Error("DB error"));
    const res = await httpGet(server, "/apps/1/scratch-test");
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "app home box unreachable" });
  });

  it("HIGH-1-T8: 503 when registry-holder returns null (boot-order regression)", async () => {
    getRegistryMock.mockReturnValueOnce(null);
    const res = await httpGet(server, "/apps/1/scratch-test");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      error: expect.stringMatching(/registry not yet available/i),
    });
  });

  it("HIGH-1-T9: 404 when app is not in the registry snapshot", async () => {
    // Registry has SOME app but not the one requested.
    getAppSnapshotMock.mockReturnValueOnce([
      {
        hostId: "1",
        slug: "different-app",
        title: "Different",
        description: "",
        port: 3000,
        hasIcon: false,
        createdAtMs: 0,
        isHealthy: true,
        healthMessage: null,
        users: null,
      },
    ]);
    const res = await httpGet(server, "/apps/1/scratch-test");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      error: expect.stringMatching(/no longer present/i),
    });
  });

  it("HIGH-1-T10: 404 when app is present in registry but port is null", async () => {
    // Unhealthy stopped-unit case: sweep observed the folder but no
    // listening port. Cannot construct a serve URL.
    getAppSnapshotMock.mockReturnValueOnce([
      {
        hostId: "1",
        slug: "scratch-test",
        title: "Scratch Test",
        description: "",
        port: null,
        hasIcon: false,
        createdAtMs: 0,
        isHealthy: false,
        healthMessage: "unit exists but currently stopped",
        users: null,
      },
    ]);
    const res = await httpGet(server, "/apps/1/scratch-test");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      error: expect.stringMatching(/not currently serving/i),
    });
  });

  it("HIGH-1-T11: 302 redirect on happy path — Location = https://<hostname>-<port>.serve.<request-host>", async () => {
    // Host resolves to name "t1000" (beforeEach default); registry has
    // the app on port 3020. Client requests Host: term.example.com →
    // expected target: https://t1000-3020.serve.term.example.com
    getAppSnapshotMock.mockReturnValueOnce([
      {
        hostId: "1",
        slug: "scratch-test",
        title: "Scratch Test",
        description: "",
        port: 3020,
        hasIcon: false,
        createdAtMs: 0,
        isHealthy: true,
        healthMessage: null,
        users: null,
      },
    ]);
    const res = await httpGet(server, "/apps/1/scratch-test", {
      Host: "term.example.com",
    });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe(
      "https://t1000-3020.serve.term.example.com",
    );
  });

  it("HIGH-1-T12: 302 uses the host record's `name` (case preserved per D-13)", async () => {
    // the user's t1000 stores display case as "Skynet". D-13 preserves it
    // on the returned host row; the LOWER() lookup happens in
    // resolveHostByName, not in resolveHostById. The redirect route just
    // consumes host.name verbatim.
    resolveHostByIdMock.mockResolvedValueOnce({
      name: "Skynet",
      ip: "10.0.0.1",
      port: 22,
      username: "ubuntu",
      authType: "key",
      key: "fake-key",
    });
    getAppSnapshotMock.mockReturnValueOnce([
      {
        hostId: "42",
        slug: "my-app",
        title: "My App",
        description: "",
        port: 8080,
        hasIcon: true,
        createdAtMs: 0,
        isHealthy: true,
        healthMessage: null,
        users: null,
      },
    ]);
    const res = await httpGet(server, "/apps/42/my-app", {
      Host: "term.example.com",
    });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe(
      "https://Skynet-8080.serve.term.example.com",
    );
  });
});
