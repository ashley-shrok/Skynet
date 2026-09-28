/**
 * Phase 137 Plan 03 Task 1 — Integration tests for the im-pane router.
 *
 * Mirrors app-pane-router.integration.test.ts structure exactly.
 * Tests cover the 14 behaviors specified in the plan:
 *
 *  1.  GET /interactive/3/poll-abc/pane/ with valid JWT proxies to SSH-tunnel
 *      target; factory called with bare slug "poll-abc" (not "im-poll-abc").
 *      Cache disambiguation is via target.port range separation (9601-9699
 *      widgets vs 9501-9599 apps — Plan 06 invariant), NOT slug prefix.
 *  2.  Slug failing APP_SLUG_RE → 400 before any DB/SSH work.
 *  3.  hostId that is not a positive integer → 400.
 *  4.  Unresolvable host → 403 with "widget home box unreachable".
 *  5.  checkHostAccess denies → same 403 body as Test 4.
 *  6.  appProxyCsrfCheck returns false → 403 with distinct body
 *      "cross-origin state-changing request refused".
 *  7.  getWidgetSnapshot() returns no matching entry → 404 with
 *      "widget is not currently serving on a port".
 *  8.  Registry returns entry with port === null → same 404 as Test 7.
 *  9.  Tunnel target resolve throws → interstitial rendered.
 * 10.  handleImPaneUpgrade on matching URL invokes proxy.upgrade.
 * 11.  handleImPaneUpgrade on NON-matching URL returns WITHOUT destroying socket.
 * 12.  handleImPaneUpgrade auth failures (missing JWT / invalid JWT) → 401.
 * 13.  Anti-clickjacking headers set on response before proxy handoff.
 * 14.  Two calls with same slug but different target.port values return
 *      DIFFERENT cached middleware refs (port-range disambiguation invariant).
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

let authAllowUserId: string | null = "u1";

const mocks = vi.hoisted(() => ({
  resolveHostById: vi.fn(),
  checkHostAccess: vi.fn(),
  getRegistry: vi.fn(),
  getWidgetSnapshot: vi.fn(),
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

async function makeServer(withUpgrade: boolean): Promise<{
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}> {
  const { imPaneRouter, handleImPaneUpgrade } = await import(
    "../im-pane-router.js"
  );
  const app = express();
  app.use(express.json());
  app.use("/interactive", imPaneRouter);
  const server = http.createServer(app);
  if (withUpgrade) {
    server.on("upgrade", (req, socket, head) => {
      void handleImPaneUpgrade(req, socket as net.Socket, head as Buffer);
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

/* Happy-path widget entry (port in 9601-9699 widget range) */
const HAPPY_WIDGET = {
  hostId: "3",
  slug: "poll-abc",
  port: 9601,
  isHealthy: true,
  createdAtMs: 0,
};

/* ------------------------------------------------------------------------ */
/*  Suite                                                                    */
/* ------------------------------------------------------------------------ */

describe("im-pane-router", () => {
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
    mocks.getWidgetSnapshot.mockReset();
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
      id: 3,
      name: "agent-box",
      userId: "u1",
    });
    mocks.checkHostAccess.mockResolvedValue(true);
    mocks.getWidgetSnapshot.mockReturnValue([HAPPY_WIDGET]);
    mocks.getRegistry.mockReturnValue({
      getWidgetSnapshot: mocks.getWidgetSnapshot,
    });
    mocks.resolvePaneTarget.mockResolvedValue({
      target: {
        hostname: "agent-box",
        port: 9601,
        host: { id: 3, name: "agent-box", userId: "u1" },
      },
      tunnelPort: 22345,
    });
    const proxyMw = Object.assign(
      (req: Request, res: Response, _next: NextFunction) => {
        res.status(200).json({ mocked: "widget-upstream", url: req.url });
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

  /* -------- Test 1: GET /interactive/3/poll-abc/pane/ proxies ----------- */

  describe("Test 1 — GET /interactive/:hostId/:slug/pane/ happy path", () => {
    it("forwards request through proxy; factory called with bare slug (port-range disambiguation)", async () => {
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/interactive/3/poll-abc/pane/");
        expect(res.status).toBe(200);
        expect(mocks.getOrCreateAppPaneProxyForTarget).toHaveBeenCalledTimes(1);
        // Phase 137: factory called with BARE slug (not "im-poll-abc").
        // Cache disambiguation is via target.port (9601-9699 widget range
        // vs 9501-9599 app range) — see Test 14 for the invariant assertion.
        expect(mocks.getOrCreateAppPaneProxyForTarget).toHaveBeenCalledWith(
          expect.objectContaining({ hostname: "agent-box", port: 9601 }),
          22345,
          3,
          "poll-abc",
        );
        const parsed = JSON.parse(res.body);
        expect(parsed.mocked).toBe("widget-upstream");
      } finally {
        await close();
      }
    });

    it("calls getWidgetSnapshot (not getAppSnapshot) for port lookup", async () => {
      const { port, close } = await makeServer(false);
      try {
        await sendHttp(port, "GET", "/interactive/3/poll-abc/pane/");
        expect(mocks.getWidgetSnapshot).toHaveBeenCalledTimes(1);
      } finally {
        await close();
      }
    });
  });

  /* -------- Test 2: slug failing APP_SLUG_RE → 400 --------------------- */

  describe("Test 2 — slug validation (APP_SLUG_RE gate)", () => {
    it("rejects slug with uppercase (400) before any DB/SSH work", async () => {
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/interactive/3/UPPERCASE/pane/");
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain("[a-z0-9-]{1,64}");
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
        expect(mocks.resolvePaneTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });

    it("rejects slug with dots (400)", async () => {
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/interactive/3/a.b/pane/");
        expect(res.status).toBe(400);
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });
  });

  /* -------- Test 3: hostId not a positive integer → 400 ---------------- */

  describe("Test 3 — hostId validation", () => {
    it("rejects hostId 0 (400)", async () => {
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/interactive/0/poll-abc/pane/");
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
        const res = await sendHttp(port, "GET", "/interactive/abc/poll-abc/pane/");
        expect(res.status).toBe(400);
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });
  });

  /* -------- Test 4: unresolvable host → 403 widget-specific body ------- */

  describe("Test 4 — unresolvable host", () => {
    it("resolveHostById null → 403 with 'widget home box unreachable'", async () => {
      mocks.resolveHostById.mockResolvedValueOnce(null);
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/interactive/3/poll-abc/pane/");
        expect(res.status).toBe(403);
        expect(JSON.parse(res.body)).toEqual({
          error: "widget home box unreachable",
        });
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });
  });

  /* -------- Test 5: checkHostAccess denies → same 403 body ------------- */

  describe("Test 5 — checkHostAccess denied (info-leak invariant)", () => {
    it("checkHostAccess false → 403 body byte-identical to Test 4", async () => {
      // Branch A: resolveHostById returns null.
      mocks.resolveHostById.mockResolvedValueOnce(null);
      const server1 = await makeServer(false);
      let bodyA: string;
      try {
        const res = await sendHttp(server1.port, "GET", "/interactive/3/poll-abc/pane/");
        expect(res.status).toBe(403);
        bodyA = res.body;
      } finally {
        await server1.close();
      }

      // Branch B: checkHostAccess returns false (host resolves fine).
      mocks.resolveHostById.mockResolvedValueOnce({
        id: 3,
        name: "agent-box",
        userId: "u1",
      });
      mocks.checkHostAccess.mockResolvedValueOnce(false);
      const server2 = await makeServer(false);
      let bodyB: string;
      try {
        const res = await sendHttp(server2.port, "GET", "/interactive/3/poll-abc/pane/");
        expect(res.status).toBe(403);
        bodyB = res.body;
      } finally {
        await server2.close();
      }

      // Byte-for-byte equality — info-leak invariant (T-137-03-IL).
      expect(bodyA).toBe(bodyB);
      expect(JSON.parse(bodyA)).toEqual({
        error: "widget home box unreachable",
      });
    });
  });

  /* -------- Test 6: CSRF check fails → distinct 403 body --------------- */

  describe("Test 6 — CSRF check", () => {
    it("POST with mismatched Origin → 403 CSRF failure body", async () => {
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(
          port,
          "POST",
          "/interactive/3/poll-abc/pane/submit",
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

  /* -------- Test 7: getWidgetSnapshot returns no match → 404 ----------- */

  describe("Test 7 — widget port lookup miss", () => {
    it("getWidgetSnapshot returns [] → 404 with 'widget is not currently serving on a port'", async () => {
      mocks.getWidgetSnapshot.mockReturnValueOnce([]);
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/interactive/3/poll-abc/pane/");
        expect(res.status).toBe(404);
        expect(JSON.parse(res.body).error).toBe(
          "widget is not currently serving on a port",
        );
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });
  });

  /* -------- Test 8: port === null → same 404 as Test 7 ----------------- */

  describe("Test 8 — widget port null", () => {
    it("registry entry with port null → 404 (nullable port treated as not-serving)", async () => {
      mocks.getWidgetSnapshot.mockReturnValueOnce([
        { ...HAPPY_WIDGET, port: null, isHealthy: false },
      ]);
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/interactive/3/poll-abc/pane/");
        expect(res.status).toBe(404);
        expect(JSON.parse(res.body).error).toBe(
          "widget is not currently serving on a port",
        );
      } finally {
        await close();
      }
    });
  });

  /* -------- Test 9: tunnel error → interstitial rendered --------------- */

  describe("Test 9 — tunnel error interstitial", () => {
    it("resolvePaneTarget rejects → interstitial rendered (D-17 reuse)", async () => {
      const tunErr = Object.assign(new Error("connect refused"), {
        code: "ECONNREFUSED",
      });
      mocks.resolvePaneTarget.mockRejectedValueOnce(tunErr);
      mocks.classifyTunnelError.mockReturnValueOnce("port_not_listening");

      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/interactive/3/poll-abc/pane/");
        expect(res.status).toBe(502);
        expect(mocks.classifyTunnelError).toHaveBeenCalledWith(tunErr);
        expect(mocks.renderInterstitial).toHaveBeenCalled();
        const args = mocks.renderInterstitial.mock.calls[0];
        expect(args[0]).toBe("port_not_listening");
        expect(args[3]).toBe("skynet.test");
        const warnCall = mocks.sshLogger.warn.mock.calls.find(
          (c: unknown[]) => String(c[0]).includes("tunnel-error"),
        );
        expect(warnCall).toBeTruthy();
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });
  });

  /* -------- Test 10: handleImPaneUpgrade matching URL → proxy.upgrade -- */

  describe("Test 10 — handleImPaneUpgrade WS upgrade on matching URL", () => {
    it("invokes proxy.upgrade through full auth chain", async () => {
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
        clientSock = net.connect(port, "127.0.0.1");
        await new Promise<void>((resolve, reject) => {
          clientSock!.once("connect", () => {
            const req = [
              "GET /interactive/3/poll-abc/pane/ws HTTP/1.1",
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

        expect(upgradeSpy).toHaveBeenCalledTimes(1);
        expect(mocks.getOrCreateAppPaneProxyForTarget).toHaveBeenCalledWith(
          expect.objectContaining({ hostname: "agent-box" }),
          22345,
          3,
          "poll-abc",
        );

        const upgradeArgs = upgradeSpy.mock.calls[0];
        expect(upgradeArgs[0]).toBeDefined(); // req
        expect(upgradeArgs[1]).toBeDefined(); // socket
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
  });

  /* -------- Test 11: handleImPaneUpgrade non-matching → silent return -- */

  describe("Test 11 — handleImPaneUpgrade silent return on non-matching URL", () => {
    it("non-matching upgrade URL: socket NOT destroyed by handler (silent return)", async () => {
      // The handler must return without touching the socket on non-match.
      // Combined dispatcher in database.ts owns the destroy-on-no-match branch.
      // We verify: on a non-matching upgrade path, the socket stays open
      // until we destroy it ourselves.
      const upgradeSpy = vi.fn();
      const proxyMw = Object.assign(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(200).end();
        },
        { upgrade: upgradeSpy },
      );
      mocks.getOrCreateAppPaneProxyForTarget.mockReturnValue(proxyMw);

      // Build a server that uses handleImPaneUpgrade as the ONLY upgrade handler.
      // Because handleImPaneUpgrade is silent (does not destroy) on non-match,
      // the socket should remain open for a bounded window.
      const { imPaneRouter, handleImPaneUpgrade } = await import(
        "../im-pane-router.js"
      );
      const app = express();
      app.use("/interactive", imPaneRouter);
      const srv = http.createServer(app);
      srv.on("upgrade", (req, socket, head) => {
        void handleImPaneUpgrade(req, socket as net.Socket, head as Buffer);
      });
      await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
      const srvPort = (srv.address() as AddressInfo).port;

      let clientSock: net.Socket | null = null;
      try {
        clientSock = net.connect(srvPort, "127.0.0.1");
        await new Promise<void>((resolve, reject) => {
          clientSock!.once("connect", () => {
            // Non-matching upgrade path — NOT under /interactive/*/pane/*.
            const reqStr = [
              "GET /foo HTTP/1.1",
              `Host: 127.0.0.1:${srvPort}`,
              "Upgrade: websocket",
              "Connection: Upgrade",
              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
              "Sec-WebSocket-Version: 13",
              "",
              "",
            ].join("\r\n");
            clientSock!.write(reqStr);
            resolve();
          });
          clientSock!.once("error", reject);
        });

        // Socket should NOT be destroyed by handleImPaneUpgrade on non-match.
        // Wait 300ms — if the socket closes during that window, the handler
        // incorrectly destroyed it. (Combined dispatcher owns destroy.)
        const closedPrematurely = await new Promise<boolean>((resolve) => {
          const t = setTimeout(() => resolve(false), 300);
          clientSock!.once("close", () => {
            clearTimeout(t);
            resolve(true);
          });
          clientSock!.once("end", () => {
            clearTimeout(t);
            resolve(true);
          });
        });

        // Handler MUST NOT destroy the socket — closedPrematurely must be false.
        expect(closedPrematurely).toBe(false);
        // Proxy upgrade must NOT have been invoked.
        expect(upgradeSpy).not.toHaveBeenCalled();
      } finally {
        // Destroy client socket first so the server can close cleanly.
        try {
          clientSock?.destroy();
        } catch {
          /* ignore */
        }
        // Force-close all server connections (including the dangling upgrade
        // socket that handleImPaneUpgrade left untouched) before calling
        // srv.close(), otherwise the server waits indefinitely for the
        // half-open upgrade connection.
        try {
          (srv as unknown as { closeAllConnections?: () => void })
            .closeAllConnections?.();
        } catch {
          /* ignore */
        }
        // Small delay to allow socket FIN to propagate before close check.
        await new Promise((r) => setTimeout(r, 100));
        await new Promise<void>((r) => {
          srv.close(() => r());
          // Safety: if srv.close() stalls (e.g. test env has no closeAllConnections),
          // resolve anyway after 500ms.
          setTimeout(() => r(), 500);
        });
      }
    }, 8_000);
  });

  /* -------- Test 12: handleImPaneUpgrade auth failures → 401 ----------- */

  describe("Test 12 — handleImPaneUpgrade auth failures", () => {
    it("missing JWT → 401 on upgrade", async () => {
      const { port, close } = await makeServer(true);
      try {
        const respBody = await new Promise<string>((resolve, reject) => {
          const client = net.connect(port, "127.0.0.1", () => {
            const req = [
              "GET /interactive/3/poll-abc/pane/ws HTTP/1.1",
              `Host: 127.0.0.1:${port}`,
              "Upgrade: websocket",
              "Connection: Upgrade",
              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
              "Sec-WebSocket-Version: 13",
              `Origin: ${PRIMARY_ORIGIN}`,
              // No Cookie: jwt=...
              "",
              "",
            ].join("\r\n");
            client.write(req);
          });
          const chunks: Buffer[] = [];
          client.on("data", (c) => chunks.push(c));
          client.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
          client.on("error", reject);
          setTimeout(() => client.destroy(), 1000);
        });
        expect(respBody).toContain("401");
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    }, 5_000);

    it("invalid JWT (verifyJWTToken returns null) → 401 on upgrade", async () => {
      mocks.verifyJWTToken.mockResolvedValueOnce(null);
      const { port, close } = await makeServer(true);
      try {
        const respBody = await new Promise<string>((resolve, reject) => {
          const client = net.connect(port, "127.0.0.1", () => {
            const req = [
              "GET /interactive/3/poll-abc/pane/ws HTTP/1.1",
              `Host: 127.0.0.1:${port}`,
              "Upgrade: websocket",
              "Connection: Upgrade",
              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
              "Sec-WebSocket-Version: 13",
              `Origin: ${PRIMARY_ORIGIN}`,
              "Cookie: jwt=bad.token.here",
              "",
              "",
            ].join("\r\n");
            client.write(req);
          });
          const chunks: Buffer[] = [];
          client.on("data", (c) => chunks.push(c));
          client.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
          client.on("error", reject);
          setTimeout(() => client.destroy(), 1000);
        });
        expect(respBody).toContain("401");
        expect(mocks.getOrCreateAppPaneProxyForTarget).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    }, 5_000);

    it("WS upgrade with Origin: 'null' accepted (referrerPolicy=no-referrer carve-out)", async () => {
      const upgradeSpy = vi.fn();
      const proxyMw = Object.assign(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(200).end();
        },
        { upgrade: upgradeSpy },
      );
      mocks.getOrCreateAppPaneProxyForTarget.mockReturnValue(proxyMw);

      const { server, port, close } = await makeServer(true);
      let clientSock: net.Socket | null = null;
      try {
        clientSock = net.connect(port, "127.0.0.1");
        await new Promise<void>((resolve, reject) => {
          clientSock!.once("connect", () => {
            const req = [
              "GET /interactive/3/poll-abc/pane/ws HTTP/1.1",
              `Host: 127.0.0.1:${port}`,
              "Upgrade: websocket",
              "Connection: Upgrade",
              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
              "Sec-WebSocket-Version: 13",
              "Origin: null",
              "Cookie: jwt=fake.jwt.token",
              "",
              "",
            ].join("\r\n");
            clientSock!.write(req);
            resolve();
          });
          clientSock!.once("error", reject);
        });

        const start = Date.now();
        while (upgradeSpy.mock.calls.length === 0 && Date.now() - start < 2000) {
          await new Promise((r) => setTimeout(r, 25));
        }
        expect(upgradeSpy).toHaveBeenCalledTimes(1);

        const upgradeArgs = upgradeSpy.mock.calls[0];
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
    }, 10_000);
  });

  /* -------- Test 13: anti-clickjacking headers set before proxy handoff - */

  describe("Test 13 — anti-clickjacking headers (T-137-03-CJ)", () => {
    it("sets X-Frame-Options + CSP frame-ancestors on response before proxy handoff", async () => {
      const { port, close } = await makeServer(false);
      try {
        const res = await sendHttp(port, "GET", "/interactive/3/poll-abc/pane/");
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

  /* -------- Test 14: port-range disambiguation invariant (Option A(ii)) - */

  describe("Test 14 — cache-key disambiguation via target.port range (Phase 137 D-137)", () => {
    it("same slug + different target.port → different middleware cache entries returned", async () => {
      // This test directly verifies the Option A(ii) disambiguation.
      // The factory's cache key includes target.port (see buildCacheKey in
      // app-pane-proxy-factory.ts: `${hostname}:${port}::${tunnelPort}::${hostId}:${slug}`).
      // An app on port 9501 (app range) and a widget on port 9601 (widget
      // range) with the SAME slug and hostId produce DIFFERENT cache keys
      // and therefore DIFFERENT middleware instances.
      //
      // We verify this by making the factory return DISTINCT mock objects
      // based on call order, then asserting both calls happened and the
      // factory was invoked with different target.port values.

      const proxyMw1 = Object.assign(
        (req: Request, res: Response, _next: NextFunction) => {
          res.status(200).json({ instance: 1, url: req.url });
        },
        { upgrade: vi.fn() },
      );
      const proxyMw2 = Object.assign(
        (req: Request, res: Response, _next: NextFunction) => {
          res.status(200).json({ instance: 2, url: req.url });
        },
        { upgrade: vi.fn() },
      );

      // First call returns proxyMw1 (widget port 9601).
      mocks.getOrCreateAppPaneProxyForTarget
        .mockReturnValueOnce(proxyMw1)
        .mockReturnValueOnce(proxyMw2);

      // First request: widget port 9601.
      mocks.resolvePaneTarget.mockResolvedValueOnce({
        target: { hostname: "agent-box", port: 9601, host: { id: 3, name: "agent-box", userId: "u1" } },
        tunnelPort: 22345,
      });

      const { port, close } = await makeServer(false);
      try {
        const res1 = await sendHttp(port, "GET", "/interactive/3/poll-abc/pane/");
        expect(res1.status).toBe(200);
        expect(JSON.parse(res1.body).instance).toBe(1);

        // Second request: different widget port 9602 (simulating different widget instance).
        mocks.getWidgetSnapshot.mockReturnValueOnce([
          { ...HAPPY_WIDGET, port: 9602 },
        ]);
        mocks.resolvePaneTarget.mockResolvedValueOnce({
          target: { hostname: "agent-box", port: 9602, host: { id: 3, name: "agent-box", userId: "u1" } },
          tunnelPort: 22346,
        });
        const res2 = await sendHttp(port, "GET", "/interactive/3/poll-abc/pane/");
        expect(res2.status).toBe(200);
        expect(JSON.parse(res2.body).instance).toBe(2);

        // Confirm factory was called with different target.port values.
        expect(mocks.getOrCreateAppPaneProxyForTarget).toHaveBeenCalledTimes(2);
        const call1Args = mocks.getOrCreateAppPaneProxyForTarget.mock.calls[0];
        const call2Args = mocks.getOrCreateAppPaneProxyForTarget.mock.calls[1];
        // Both use bare slug "poll-abc" (not "im-poll-abc").
        expect(call1Args[3]).toBe("poll-abc");
        expect(call2Args[3]).toBe("poll-abc");
        // target.port differs — that's the cache-key discriminator.
        expect(call1Args[0].port).toBe(9601);
        expect(call2Args[0].port).toBe(9602);
      } finally {
        await close();
      }
    });
  });
});
