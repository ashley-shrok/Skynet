/**
 * Regression test for the D-07-vs-serve-url mount-order bug.
 *
 * The Phase 103 D-07 deny in cors-config.ts rejects every
 * *.serve.term.<domain> origin as the primary domain's CSRF defense for the
 * widened JWT cookie (D-02). That deny is correct, but it was mounted ABOVE
 * the serve-url dispatch chain, so it also judged traffic that was only ever
 * bound for an SSH tunnel and never touched the primary API.
 *
 * The bite was ES-module-specific: browsers attach Origin to module script
 * fetches even same-origin, so an HTML shell (no Origin on subresources)
 * loaded fine while every module request behind a serve URL 500'd — i.e.
 * every Vite dev server, the feature's primary use case.
 *
 * Both halves must hold, which is what this file asserts:
 *   1. Serve-subdomain traffic (X-Skynet-Serve-Subdomain present) reaches the
 *      tunnel even when it carries a serve-subdomain Origin.
 *   2. A serve-subdomain Origin on a genuine primary-domain API route is
 *      STILL denied — D-07 must not be weakened by the reorder.
 *
 * Mount order under test mirrors database.ts: cookieParser →
 * subdomainDispatch → serveUrlHandler → cors → routes.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Request, Response, NextFunction } from "express";

const mocks = vi.hoisted(() => ({
  resolveHostByName: vi.fn(),
  canAccessHost: vi.fn(),
  createAuthMiddleware: vi.fn(),
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostByName: mocks.resolveHostByName,
}));

vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: vi.fn(() => ({ canAccessHost: mocks.canAccessHost })),
  },
}));

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: vi.fn(() => ({
      createAuthMiddleware: mocks.createAuthMiddleware,
    })),
  },
}));

vi.mock("../../utils/logger.js", () => ({
  sshLogger: mocks.sshLogger,
  systemLogger: mocks.sshLogger,
  databaseLogger: mocks.sshLogger,
  apiLogger: mocks.sshLogger,
}));

process.env.SKYNET_COOKIE_DOMAIN = "term.example.com";

const { createSubdomainDispatchMiddleware } = await import(
  "../subdomain-dispatch.js"
);
const { createCorsMiddleware } = await import("../../utils/cors-config.js");

const SERVE_ORIGIN = "https://t1000-8901.serve.term.example.com";
const SERVE_HOST = "t1000-8901.serve.term.example.com";

/**
 * Stand up an app with the real production mount order. The serve handler is
 * a stub that reports whether dispatch attached a target — we're testing
 * ordering, not the tunnel itself (tunnel behavior is covered by
 * serve-route.test.ts and no-cookie-egress.integration.test.ts).
 */
function buildApp() {
  const app = express();
  app.set("trust proxy", true);

  app.use(cookieParser());
  app.use(createSubdomainDispatchMiddleware());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const target = (req as Request & { serveTarget?: unknown }).serveTarget;
    if (!target) return next();
    res.status(200).json({ reached: "tunnel" });
  });

  app.use(createCorsMiddleware());

  app.get("/health", (_req, res) => {
    res.status(200).json({ reached: "primary-api" });
  });

  // Express 5 surfaces the cors callback's Error here. Mirror the shape the
  // real stack produces (500 + the D-07 message) so the assertions below key
  // on the deny itself rather than on default-handler formatting.
  app.use(
    (
      err: Error,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      res.status(500).json({ error: err.message });
    },
  );

  return app;
}

let server: http.Server;
let baseUrl: string;

async function listen(app: express.Express): Promise<void> {
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("serve-url dispatch mounts above the D-07 CORS deny", () => {
  beforeEach(() => {
    mocks.resolveHostByName.mockReset();
    mocks.canAccessHost.mockReset();
    mocks.createAuthMiddleware.mockReset();

    // Auth succeeds and populates userId, as the real AuthManager would for a
    // request carrying a valid widened JWT cookie.
    mocks.createAuthMiddleware.mockReturnValue(
      (req: Request, _res: Response, next: NextFunction) => {
        (req as Request & { userId?: string }).userId = "user-1";
        next();
      },
    );
    mocks.resolveHostByName.mockResolvedValue({ id: 7, name: "t1000" });
    mocks.canAccessHost.mockResolvedValue({ hasAccess: true });
  });

  it("lets an ES-module fetch through the tunnel despite a serve-subdomain Origin", async () => {
    await listen(buildApp());

    // Shape of a Vite module fetch behind a serve URL: browsers set Origin on
    // module scripts even same-origin, which is exactly what tripped D-07.
    const res = await fetch(`${baseUrl}/src/main.tsx`, {
      headers: {
        "X-Skynet-Serve-Subdomain": SERVE_HOST,
        Origin: SERVE_ORIGIN,
        Host: SERVE_HOST,
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ reached: "tunnel" });
  });

  it("still denies a serve-subdomain Origin on a primary-domain API route (D-07 preserved)", async () => {
    await listen(buildApp());

    // No X-Skynet-Serve-Subdomain header — Caddy only sets it on the wildcard
    // site block, so this is a genuine primary-domain call claiming a serve
    // origin: the CSRF shape D-07 exists to stop.
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: SERVE_ORIGIN },
    });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Not allowed by CORS (serve subdomain origin)",
    });
  });

  it("leaves ordinary same-origin primary traffic untouched", async () => {
    await listen(buildApp());

    const res = await fetch(`${baseUrl}/health`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ reached: "primary-api" });
  });
});
