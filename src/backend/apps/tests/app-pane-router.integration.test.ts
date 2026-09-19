/**
 * Phase 120 Plan 05 Task 2 — Integration tests for the app-pane router.
 *
 * D-21 backend-proxy layer coverage. Six enumerated cases in CONTEXT.md
 * plus six expansion cases (7-12) per PLAN.md § Task 2:
 *
 *   1.  HTTP GET forwards through the proxy.
 *   2.  HTTP POST with matching Origin forwards.
 *   3.  HTTP POST with mismatched Origin → 403 CSRF failure body;
 *       proxy NOT invoked.
 *   4.  WebSocket upgrade forwards (REAL http.Server — BLOCKER 6 fix).
 *   5.  checkHostAccess false → 403 with info-leak-safe body; proxy
 *       NOT invoked.
 *   6.  Path-prefix strip: factory called with (target, tunnelPort,
 *       hostId, slug) so its pathRewrite regex strips
 *       `^/apps/<hostId>/<slug>/pane`.
 *   7.  resolveHostById null → 403 with the SAME body as case 5
 *       (T-120-26 info-leak invariant).
 *   8.  V5 input validation — slug `../etc/passwd` → 400.
 *   9.  V5 input validation — hostId 0 or negative → 400.
 *  10.  D-17 error surface — resolvePaneTarget rejects → interstitial
 *       rendered with (errorClass, target, originalUrl, PRIMARY_DOMAIN).
 *  11.  Missing Origin on state-changing POST → 403 CSRF failure body.
 *  12.  Port lookup miss — getAppSnapshot() returns no matching app →
 *       404 with "app is not currently serving on a port" body.
 *
 * Scaffold: bare Express app + Node http.request client (mirrors
 * database/routes/apps.test.ts). All boundary I/O is mocked. Auth is a
 * pass-through middleware that stamps req.userId — auth is not the
 * focus (Phase 119 covers auth exhaustively).
 *
 * WS upgrade test (case 4) uses a REAL `http.createServer(app)`
 * instance + `handleAppPaneUpgrade` bound to the upgrade event, then
 * fires a raw upgrade request over a TCP socket. A mocked-middleware
 * unit test would false-pass because mocks cannot distinguish HTTP
 * from WS upgrade (BLOCKER 6 in the checker's iteration-2 review).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Request, Response, NextFunction } from "express";

/* ------------------------------------------------------------------------ */
/*  Env — must be set BEFORE any import that reads it at module load        */
/* ------------------------------------------------------------------------ */

const PRIMARY_ORIGIN = "https://skynet.test";
process.env.SKYNET_COOKIE_DOMAIN = PRIMARY_ORIGIN;

/* ------------------------------------------------------------------------ */
/*  Hoisted mocks                                                            */
/* ------------------------------------------------------------------------ */

// Track whether the current test wants auth to succeed. Reset in beforeEach.
let authAllowUserId: string | null = "u1";

const mocks = vi.hoisted(() => ({
  resolveHostById: vi.fn(),
  checkHostAccess: vi.fn(),
  getRegistry: vi.fn(),
  getAppSnapshot: vi.fn(),
  resolvePaneTarget: vi.fn(),
  getOrCreateAppPaneProxyForTarget: vi.fn(),
  classifyTunnelError: vi.fn(),
  renderInterstitial: vi.fn(),
  writeInterstitial: vi.fn(),
  verifyJWTToken: vi.fn(),
  sshLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware:
        () => (req: Request, res: Response, next: NextFunction) => {
          if (authAllowUserId === null) {
            return res.status(401).json({ error: "Unauthorized" });
          }
          (req as Request & { userId: string }).userId = authAllowUserId;
          next();
        },
      verifyJWTToken: mocks.verifyJWTToken,
    }),
  };
  return { AuthManager };
});

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: mocks.resolveHostById,
  checkHostAccess: mocks.checkHostAccess,
}));

vi.mock("../../fleet-status/registry-holder.js", () => ({
  getRegistry: mocks.getRegistry,
}));

vi.mock("../pane-target-resolver.js", () => ({
  resolvePaneTarget: mocks.resolvePaneTarget,
}));

vi.mock("../app-pane-proxy-factory.js", () => ({
  getOrCreateAppPaneProxyForTarget: mocks.getOrCreateAppPaneProxyForTarget,
}));

vi.mock("../../serve-url/error-classifier.js", () => ({
  classifyTunnelError: mocks.classifyTunnelError,
}));

vi.mock("../../serve-url/interstitial.js", () => ({
  renderInterstitial: mocks.renderInterstitial,
  writeInterstitial: mocks.writeInterstitial,
}));

vi.mock("../../utils/logger.js", () => ({
  sshLogger: mocks.sshLogger,
  logger: mocks.sshLogger,
  systemLogger: mocks.sshLogger,
  databaseLogger: mocks.sshLogger,
  apiLogger: mocks.sshLogger,
}));

/* ------------------------------------------------------------------------ */
/*  Test scaffold helpers                                                    */
/* ------------------------------------------------------------------------ */

interface HttpResult {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Send an HTTP request via Node's native http.request against a bare
 * Express app listening on 127.0.0.1. Returns status + body + headers.
 */
function sendHttp(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          ...headers,
          ...(body ? { "content-length": String(Buffer.byteLength(body)) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Build a bare Express app + start an http.Server on an ephemeral port.
 * Returns the server, port, and a cleanup function.
 */
async function makeServer(withUpgrade: boolean): Promise<{
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}> {
  // Import router lazily so mocks are wired first.
  const { appPaneRouter, handleAppPaneUpgrade } = await import(
    "../app-pane-router.js"
  );
  const app = express();
  app.use(express.json());
  app.use("/apps", appPaneRouter);
  const server = http.createServer(app);
  if (withUpgrade) {
    server.on("upgrade", (req, socket, head) => {
      void handleAppPaneUpgrade(req, socket as net.Socket, head as Buffer);
    });
  }
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        // Force-close any open sockets (WS upgrade tests leave the
        // socket owned by the proxy mock; without this the server's
        // close() waits indefinitely on the half-open connection).
        try {
          (server as unknown as { closeAllConnections?: () => void })
            .closeAllConnections?.();
          (server as unknown as { closeIdleConnections?: () => void })
            .closeIdleConnections?.();
        } catch {
          /* ignore */
        }
        server.close(() => resolve());
      }),
  };
}

/* ------------------------------------------------------------------------ */
/*  Suite                                                                    */
/* ------------------------------------------------------------------------ */

describe("app-pane-router", () => {
  beforeAll(() => {
    process.env.SKYNET_COOKIE_DOMAIN = PRIMARY_ORIGIN;
  });

  afterAll(() => {
    delete process.env.SKYNET_COOKIE_DOMAIN;
  });

  beforeEach(() => {
    authAllowUserId = "u1";
    mocks.resolveHostById.mockReset();
    mocks.checkHostAccess.mockReset();
    mocks.getRegistry.mockReset();
    mocks.getAppSnapshot.mockReset();
    mocks.resolvePaneTarget.mockReset();
    mocks.getOrCreateAppPaneProxyForTarget.mockReset();
    mocks.classifyTunnelError.mockReset();
    mocks.renderInterstitial.mockReset();
    mocks.writeInterstitial.mockReset();
    mocks.verifyJWTToken.mockReset();
    mocks.sshLogger.info.mockClear();
    mocks.sshLogger.warn.mockClear();
    mocks.sshLogger.error.mockClear();
    mocks.sshLogger.debug.mockClear();

    // Happy defaults; individual tests override.
    mocks.resolveHostById.mockResolvedValue({
      id: 5,
      name: "t1000",
      userId: "u1",
    });
    mocks.checkHostAccess.mockResolvedValue(true);
    mocks.getAppSnapshot.mockReturnValue([
      {
        hostId: "5",
        slug: "todo",
        title: "Todo",
        description: "",
        port: 3001,
        hasIcon: false,
        createdAtMs: 0,
        isHealthy: true,
        healthMessage: null,
      },
    ]);
    mocks.getRegistry.mockReturnValue({
      getAppSnapshot: mocks.getAppSnapshot,
    });
    mocks.resolvePaneTarget.mockResolvedValue({
      target: {
        hostname: "t1000",
        port: 3001,
        host: { id: 5, name: "t1000", userId: "u1" },
      },
      tunnelPort: 12345,
    });
    // Default proxy middleware returns a mock 200 JSON so we can assert
    // handoff occurred; the .upgrade method is attached for the WS test.
    const proxyMw = Object.assign(
      (req: Request, res: Response, _next: NextFunction) => {
        res.status(200).json({ mocked: "upstream", url: req.url });
      },
      {
        upgrade: vi.fn(),
      },
    );
    mocks.getOrCreateAppPaneProxyForTarget.mockReturnValue(proxyMw);
    mocks.classifyTunnelError.mockReturnValue("host_unreachable");
    mocks.renderInterstitial.mockReturnValue({
      status: 502,
      body: "<html>interstitial</html>",
      headers: { "content-type": "text/html" },
    });
    mocks.writeInterstitial.mockImplementation((res: Response) => {
      res.status(502).setHeader("content-type", "text/html");
      res.send("<html>interstitial</html>");
    });
    mocks.verifyJWTToken.mockResolvedValue({ userId: "u1" });
  });

  /* -------------------- HTTP GET (case a) -------------------- */

  describe("HTTP GET", () => {
    it("forwards a GET request through the proxy middleware", async () => {
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/apps/5/todo/pane/api/list");
        expect(res.status).toBe(200);
        expect(mocks.getOrCreateAppPaneProxyForTarget).toHaveBeenCalledTimes(1);
        // Body reflects the mock middleware — factory handoff happened.
        const parsed = JSON.parse(res.body);
        expect(parsed.mocked).toBe("upstream");
      } finally {
        await close();
      }
    });

    it("sets X-Frame-Options + CSP frame-ancestors on the response", async () => {
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/apps/5/todo/pane/");
        expect(res.status).toBe(200);
        expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
        expect(res.headers["content-security-policy"]).toContain(
          "frame-ancestors 'self'",
        );
      } finally {
        await close();
      }
    });
  });

  /* -------------------- HTTP POST with matching Origin (case b) -------------------- */

  describe("HTTP POST with Origin", () => {
    it("forwards a POST with matching Origin", async () => {
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(
          port,
          "POST",
          "/apps/5/todo/pane/api/create",
          {
            "content-type": "application/json",
            origin: PRIMARY_ORIGIN,
          },
          JSON.stringify({ x: 1 }),
        );
        expect(res.status).toBe(200);
        expect(mocks.getOrCreateAppPaneProxyForTarget).toHaveBeenCalledTimes(1);
      } finally {
        await close();
      }
    });

    /* -------------------- HTTP POST mismatched Origin (case c) -------------------- */

    it("refuses a POST with mismatched Origin (403 CSRF failure body)", async () => {
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(
          port,
          "POST",
          "/apps/5/todo/pane/api/create",
          {
            "content-type": "application/json",
            origin: "https://evil.example",
          },
          JSON.stringify({ x: 1 }),
        );
        expect(res.status).toBe(403);
        expect(JSON.parse(res.body)).toEqual({
          error: "cross-origin state-changing request refused",
        });
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });
  });

  /* -------------------- WS upgrade (case d — REAL http.Server, BLOCKER 6) -------------------- */

  describe("WebSocket upgrade", () => {
    it("dispatches WS upgrade through the same chain and invokes proxy.upgrade", async () => {
      // Attach a spy proxy middleware whose .upgrade is watchable.
      const upgradeSpy = vi.fn();
      const proxyMw = Object.assign(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(200).json({ shouldNotHitHttp: true });
        },
        { upgrade: upgradeSpy },
      );
      mocks.getOrCreateAppPaneProxyForTarget.mockReturnValue(proxyMw);

      const { server, port, close } = await makeServer(true);
      let clientSock: net.Socket | null = null;
      try {
        // Fire a raw WebSocket upgrade over TCP. The upgrade handler is
        // expected to call proxyMw.upgrade(req, socket, head). Poll for
        // that invocation rather than waiting a fixed duration — this
        // avoids racing the async chain in handleAppPaneUpgrade.
        clientSock = net.connect(port, "127.0.0.1");
        await new Promise<void>((resolve, reject) => {
          clientSock!.once("connect", () => {
            const req = [
              "GET /apps/5/todo/pane/ws HTTP/1.1",
              `Host: 127.0.0.1:${port}`,
              "Upgrade: websocket",
              "Connection: Upgrade",
              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
              "Sec-WebSocket-Version: 13",
              `Origin: ${PRIMARY_ORIGIN}`,
              "Cookie: jwt=fake.jwt.token",
              "",
              "",
            ].join("\r\n");
            clientSock!.write(req);
            resolve();
          });
          clientSock!.once("error", reject);
        });

        // Poll for the upgrade spy invocation (up to ~2s).
        const start = Date.now();
        while (upgradeSpy.mock.calls.length === 0 && Date.now() - start < 2000) {
          await new Promise((r) => setTimeout(r, 25));
        }

        // The proxy middleware's .upgrade method should have been called
        // — dispatching through auth+validation+access+CSRF+port+target.
        expect(upgradeSpy).toHaveBeenCalledTimes(1);
        expect(mocks.getOrCreateAppPaneProxyForTarget).toHaveBeenCalledWith(
          expect.objectContaining({ hostname: "t1000" }),
          12345,
          5,
          "todo",
        );

        // Inspect the socket argument: it must be a real net.Socket
        // (BLOCKER 6 asserts a REAL http.Server + REAL socket flow).
        const upgradeArgs = upgradeSpy.mock.calls[0];
        expect(upgradeArgs[0]).toBeDefined(); // req
        expect(upgradeArgs[1]).toBeDefined(); // socket

        // The mock proxy.upgrade did not consume the socket — destroy
        // it here so server.close() can complete.
        try {
          (upgradeArgs[1] as net.Socket).destroy();
        } catch {
          /* ignore */
        }
      } finally {
        try {
          clientSock?.destroy();
        } catch {
          /* ignore */
        }
        try {
          (server as unknown as { closeAllConnections?: () => void })
            .closeAllConnections?.();
        } catch {
          /* ignore */
        }
        await close();
      }
    }, 15_000);

    it("rejects a WS upgrade with mismatched Origin", async () => {
      const upgradeSpy = vi.fn();
      const proxyMw = Object.assign(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(200).end();
        },
        { upgrade: upgradeSpy },
      );
      mocks.getOrCreateAppPaneProxyForTarget.mockReturnValue(proxyMw);

      const { port, close } = await makeServer(true);
      try {
        const respBody = await new Promise<string>((resolve, reject) => {
          const client = net.connect(port, "127.0.0.1", () => {
            const req = [
              "GET /apps/5/todo/pane/ws HTTP/1.1",
              `Host: 127.0.0.1:${port}`,
              "Upgrade: websocket",
              "Connection: Upgrade",
              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
              "Sec-WebSocket-Version: 13",
              "Origin: https://evil.example",
              "Cookie: jwt=fake.jwt.token",
              "",
              "",
            ].join("\r\n");
            client.write(req);
          });
          const chunks: Buffer[] = [];
          client.on("data", (c) => chunks.push(c));
          client.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
          client.on("error", reject);
          setTimeout(() => client.destroy(), 500);
        });
        expect(respBody).toContain("403");
        expect(upgradeSpy).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    }, 10_000);

    // HIGH-3 code-review fix (2026-09-19). Non-matching upgrade paths must
    // be explicitly destroyed by the dispatcher. Pre-fix, the handler
    // returned WITHOUT touching the socket on non-pane paths — because
    // Node's http.Server only auto-destroys upgrade sockets when NO
    // listener is attached, and we're the only listener, this leaked every
    // non-matching upgrade socket forever (slow-DoS surface).
    //
    // Test: fire a WS upgrade at a NON-matching path (e.g. `/foo`) and
    // assert the socket closes within a bounded window. Pre-fix the socket
    // would remain open indefinitely; the test fails via timeout.
    it("destroys the socket on non-matching upgrade paths (HIGH-3 leak fix)", async () => {
      const upgradeSpy = vi.fn();
      const proxyMw = Object.assign(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(200).end();
        },
        { upgrade: upgradeSpy },
      );
      mocks.getOrCreateAppPaneProxyForTarget.mockReturnValue(proxyMw);

      const { port, close } = await makeServer(true);
      let clientSock: net.Socket | null = null;
      try {
        clientSock = net.connect(port, "127.0.0.1");
        await new Promise<void>((resolve, reject) => {
          clientSock!.once("connect", () => {
            // Non-matching upgrade path — NOT under /apps/*/pane/*.
            const req = [
              "GET /foo HTTP/1.1",
              `Host: 127.0.0.1:${port}`,
              "Upgrade: websocket",
              "Connection: Upgrade",
              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
              "Sec-WebSocket-Version: 13",
              "",
              "",
            ].join("\r\n");
            clientSock!.write(req);
            resolve();
          });
          clientSock!.once("error", reject);
        });

        // Wait for the server side to close the socket. Pre-fix this
        // resolves via the 2000ms timeout branch (leak). Post-fix the
        // server destroys the socket immediately and the client sees a
        // "close" event within a few milliseconds.
        const closedFast = await new Promise<boolean>((resolve) => {
          const t = setTimeout(() => resolve(false), 2000);
          clientSock!.once("close", () => {
            clearTimeout(t);
            resolve(true);
          });
          clientSock!.once("end", () => {
            clearTimeout(t);
            resolve(true);
          });
        });
        expect(closedFast).toBe(true);
        // Proxy upgrade must NOT have been invoked for a non-matching path.
        expect(upgradeSpy).not.toHaveBeenCalled();
      } finally {
        try {
          clientSock?.destroy();
        } catch {
          /* ignore */
        }
        await close();
      }
    }, 5_000);
  });

  /* -------------------- Access control (case e) -------------------- */

  describe("access control", () => {
    it("refuses request when checkHostAccess returns false (403 info-leak-safe body)", async () => {
      mocks.checkHostAccess.mockResolvedValue(false);
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/apps/5/todo/pane/");
        expect(res.status).toBe(403);
        expect(JSON.parse(res.body)).toEqual({
          error: "app home box unreachable",
        });
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });
  });

  /* -------------------- Path-prefix strip (case f) -------------------- */

  describe("path-prefix strip", () => {
    it("passes (target, tunnelPort, hostId, slug) so pathRewrite strips prefix", async () => {
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/apps/5/todo/pane/api/list");
        expect(res.status).toBe(200);
        expect(mocks.getOrCreateAppPaneProxyForTarget).toHaveBeenCalledWith(
          expect.objectContaining({ hostname: "t1000", port: 3001 }),
          12345,
          5,
          "todo",
        );
      } finally {
        await close();
      }
    });
  });

  /* -------------------- Info-leak invariant (case 7) -------------------- */

  describe("info-leak invariant", () => {
    it("resolveHostById null → 403 body byte-identical to checkHostAccess false", async () => {
      // Branch A: resolveHostById returns null.
      mocks.resolveHostById.mockResolvedValueOnce(null);
      const server1 = await makeServer(false);
      let bodyA: string;
      try {
        const res = await sendHttp(server1.port, "GET", "/apps/5/todo/pane/");
        expect(res.status).toBe(403);
        bodyA = res.body;
      } finally {
        await server1.close();
      }

      // Branch B: checkHostAccess returns false (host resolves fine).
      mocks.resolveHostById.mockResolvedValueOnce({
        id: 5,
        name: "t1000",
        userId: "u1",
      });
      mocks.checkHostAccess.mockResolvedValueOnce(false);
      const server2 = await makeServer(false);
      let bodyB: string;
      try {
        const res = await sendHttp(server2.port, "GET", "/apps/5/todo/pane/");
        expect(res.status).toBe(403);
        bodyB = res.body;
      } finally {
        await server2.close();
      }

      // Byte-for-byte equality — the "app home box unreachable" invariant.
      expect(bodyA).toBe(bodyB);
      expect(JSON.parse(bodyA)).toEqual({
        error: "app home box unreachable",
      });
    });
  });

  /* -------------------- Slug validation (case 8) -------------------- */

  describe("slug validation", () => {
    it("rejects a path-traversal slug (400)", async () => {
      const { port, close } = await makeServer(false);
      try {
        // Express's :slug param won't match `../etc/passwd` because `/`
        // isn't allowed by default param parsing. Try an invalid but
        // path-legal slug (uppercase — outside APP_SLUG_RE).
        const res = await sendHttp(
          port,
          "GET",
          "/apps/5/UPPERCASE/pane/",
        );
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain("[a-z0-9-]{1,64}");
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
        expect(mocks.resolvePaneTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });

    it("rejects a slug containing dots (400)", async () => {
      const { port, close } = await makeServer(false);
      try {
        // Dot-containing slug — outside APP_SLUG_RE (which is /^[a-z0-9-]{1,64}$/).
        const res = await sendHttp(port, "GET", "/apps/5/a.b/pane/");
        expect(res.status).toBe(400);
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });
  });

  /* -------------------- hostId validation (case 9) -------------------- */

  describe("hostId validation", () => {
    it("rejects hostId 0 (400)", async () => {
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/apps/0/todo/pane/");
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain("positive integer");
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });

    it("rejects non-numeric hostId (400)", async () => {
      const { port, close } = await makeServer(false);
      try {
        // Express default :param rejects `/`, but a plain alpha string
        // matches. Number("abc") is NaN so we hit the 400 branch.
        const res = await sendHttp(port, "GET", "/apps/abc/todo/pane/");
        expect(res.status).toBe(400);
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });
  });

  /* -------------------- Tunnel error interstitial (case 10) -------------------- */

  describe("tunnel error interstitial", () => {
    it("renders shared interstitial when resolvePaneTarget rejects", async () => {
      const tunErr = Object.assign(new Error("connect refused"), {
        code: "ECONNREFUSED",
      });
      mocks.resolvePaneTarget.mockRejectedValueOnce(tunErr);
      mocks.classifyTunnelError.mockReturnValueOnce("port_not_listening");

      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/apps/5/todo/pane/");
        expect(res.status).toBe(502);
        // classifyTunnelError invoked with the raw thrown err.
        expect(mocks.classifyTunnelError).toHaveBeenCalledWith(tunErr);
        // renderInterstitial called with the classified class,
        // target-ish object, originalUrl string, and PRIMARY_DOMAIN.
        expect(mocks.renderInterstitial).toHaveBeenCalled();
        const args = mocks.renderInterstitial.mock.calls[0];
        expect(args[0]).toBe("port_not_listening");
        // HIGH-1 fix (2026-09-19): PRIMARY_DOMAIN is now the normalized
        // hostname (stripped of scheme) — asserting on the hostname here
        // instead of the URL. Router forwards PRIMARY_DOMAIN → the
        // interstitial callsite. Env is `https://skynet.test`, hostname
        // is `skynet.test`.
        expect(args[3]).toBe("skynet.test");
        // Structured warn emitted with safe fields only.
        const warnCall = mocks.sshLogger.warn.mock.calls.find(
          (c: unknown[]) => String(c[0]).includes("tunnel-error"),
        );
        expect(warnCall).toBeTruthy();
        // Proxy handoff MUST NOT happen on the tunnel-error branch.
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });
  });

  /* -------------------- Missing Origin on state-changing (case 11) -------------------- */

  describe("missing origin on state-changing POST", () => {
    it("refuses a POST without any Origin (403 CSRF failure body)", async () => {
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(
          port,
          "POST",
          "/apps/5/todo/pane/api/create",
          { "content-type": "application/json" },
          JSON.stringify({ x: 1 }),
        );
        expect(res.status).toBe(403);
        expect(JSON.parse(res.body)).toEqual({
          error: "cross-origin state-changing request refused",
        });
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });
  });

  /* -------------------- Port lookup miss (case 12) -------------------- */

  describe("port lookup", () => {
    it("returns 404 when getAppSnapshot has no matching app", async () => {
      mocks.getAppSnapshot.mockReturnValueOnce([]);
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/apps/5/todo/pane/");
        expect(res.status).toBe(404);
        expect(JSON.parse(res.body).error).toBe(
          "app is not currently serving on a port",
        );
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });

    it("returns 404 when the matching app has a null port", async () => {
      mocks.getAppSnapshot.mockReturnValueOnce([
        {
          hostId: "5",
          slug: "todo",
          title: "Todo",
          description: "",
          port: null,
          hasIcon: false,
          createdAtMs: 0,
          isHealthy: false,
          healthMessage: null,
        },
      ]);
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/apps/5/todo/pane/");
        expect(res.status).toBe(404);
        expect(JSON.parse(res.body).error).toBe(
          "app is not currently serving on a port",
        );
      } finally {
        await close();
      }
    });
  });
});
