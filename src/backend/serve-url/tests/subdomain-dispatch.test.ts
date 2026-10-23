/**
 * Phase 103 Plan 05 Task 1 — Unit tests for subdomain-dispatch middleware.
 *
 * Verifies the four-stage gate + fall-through behavior + fail-loud env
 * enforcement per D-03, D-11, D-13, D-17, D-23.
 *
 * Focused unit tests: mocks AuthManager / PermissionManager / resolveHostByUniversalId
 * so we exercise ONLY the middleware's decision tree, not the real DB stack.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Hoisted mocks — mutable spies + return-value overrides per-test
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  return {
    resolveHostByUniversalId: vi.fn(),
    canAccessHost: vi.fn(),
    createAuthMiddleware: vi.fn(),
    getAppSnapshot: vi.fn(() => [] as unknown[]),
    canUserSeeIdentity: vi.fn(async () => true),
    sshLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostByUniversalId: mocks.resolveHostByUniversalId,
}));

vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: vi.fn(() => ({
      canAccessHost: mocks.canAccessHost,
    })),
  },
}));

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: vi.fn(() => ({
      createAuthMiddleware: mocks.createAuthMiddleware,
    })),
  },
}));

vi.mock("../../fleet-status/registry-holder.js", () => ({
  getRegistry: () => ({ getAppSnapshot: mocks.getAppSnapshot }),
}));

vi.mock("../../fleet-status/identity-gate-holder.js", () => ({
  canUserSeeIdentity: mocks.canUserSeeIdentity,
}));

vi.mock("../../utils/logger.js", () => ({
  sshLogger: mocks.sshLogger,
  systemLogger: mocks.sshLogger,
  databaseLogger: mocks.sshLogger,
  apiLogger: mocks.sshLogger,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(
  overrides: Partial<Request> & {
    subdomainHeader?: string | undefined;
    userId?: string;
  } = {},
): Request {
  const { subdomainHeader, userId, ...rest } = overrides;
  const req = {
    headers: subdomainHeader === undefined ? {} : { "x-skynet-serve-subdomain": subdomainHeader },
    originalUrl: "/some/path",
    userId,
    ...rest,
  } as unknown as Request;
  return req;
}

function makeRes(): {
  res: Response;
  statusCalls: number[];
  endCalls: number;
  sendCalls: string[];
  headers: Record<string, string>;
} {
  const state = {
    statusCalls: [] as number[],
    endCalls: 0,
    sendCalls: [] as string[],
    headers: {} as Record<string, string>,
  };
  const res = {
    status(code: number) {
      state.statusCalls.push(code);
      return this;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
      return this;
    },
    send(body: string) {
      state.sendCalls.push(body);
      return this;
    },
    end() {
      state.endCalls++;
      return this;
    },
    json(_body: unknown) {
      // Auth middleware may call res.status(401).json(...). We record status only.
      return this;
    },
  } as unknown as Response;
  return { res, ...state };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("subdomain-dispatch middleware", () => {
  const ORIGINAL_ENV = process.env.SKYNET_COOKIE_DOMAIN;

  beforeEach(() => {
    process.env.SKYNET_COOKIE_DOMAIN = "term.example.com";
    mocks.resolveHostByUniversalId.mockReset();
    mocks.canAccessHost.mockReset();
    mocks.createAuthMiddleware.mockReset();
    mocks.getAppSnapshot.mockReset();
    mocks.getAppSnapshot.mockReturnValue([]);
    mocks.canUserSeeIdentity.mockReset();
    mocks.canUserSeeIdentity.mockResolvedValue(true);
    mocks.sshLogger.info.mockClear();
    mocks.sshLogger.warn.mockClear();
    mocks.sshLogger.error.mockClear();
    // Default: auth middleware succeeds and sets userId
    mocks.createAuthMiddleware.mockReturnValue(
      async (req: Request, _res: Response, next: NextFunction) => {
        (req as Request & { userId: string }).userId = "user-abc";
        next();
      },
    );
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.SKYNET_COOKIE_DOMAIN;
    } else {
      process.env.SKYNET_COOKIE_DOMAIN = ORIGINAL_ENV;
    }
    vi.resetModules();
  });

  it("THROWS at factory invocation if SKYNET_COOKIE_DOMAIN is unset (W4 fail-loud)", async () => {
    delete process.env.SKYNET_COOKIE_DOMAIN;
    const mod = await import("../subdomain-dispatch.js");
    expect(() => mod.createSubdomainDispatchMiddleware()).toThrow(
      /SKYNET_COOKIE_DOMAIN/,
    );
  });

  it("falls through (calls next()) when x-skynet-serve-subdomain header absent", async () => {
    const mod = await import("../subdomain-dispatch.js");
    const middleware = mod.createSubdomainDispatchMiddleware();
    const req = makeReq({ subdomainHeader: undefined });
    const { res } = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it("renders an interstitial when subdomain has no dash (parse failure)", async () => {
    const mod = await import("../subdomain-dispatch.js");
    const middleware = mod.createSubdomainDispatchMiddleware();
    const req = makeReq({ subdomainHeader: "malformed.serve.term.example.com" });
    const { res, statusCalls } = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    // Parse failure results in some non-2xx status; must NOT be a success.
    expect(statusCalls.length).toBe(1);
    expect(statusCalls[0]).toBeGreaterThanOrEqual(400);
  });

  it("renders an interstitial when subdomain port is non-digit", async () => {
    const mod = await import("../subdomain-dispatch.js");
    const middleware = mod.createSubdomainDispatchMiddleware();
    const req = makeReq({ subdomainHeader: "myhost-abc.serve.term.example.com" });
    const { res, statusCalls } = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(statusCalls[0]).toBeGreaterThanOrEqual(400);
  });

  it("renders an interstitial when subdomain port is out of range", async () => {
    const mod = await import("../subdomain-dispatch.js");
    const middleware = mod.createSubdomainDispatchMiddleware();
    const req = makeReq({ subdomainHeader: "myhost-99999.serve.term.example.com" });
    const { res, statusCalls } = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(statusCalls[0]).toBeGreaterThanOrEqual(400);
  });

  it("renders auth_missing interstitial (302 redirect) when auth middleware writes 401", async () => {
    mocks.createAuthMiddleware.mockReturnValue(
      async (_req: Request, res: Response, _next: NextFunction) => {
        res.status(401).json({ error: "Missing authentication token" });
      },
    );
    const mod = await import("../subdomain-dispatch.js");
    const middleware = mod.createSubdomainDispatchMiddleware();
    const req = makeReq({ subdomainHeader: "42-3000.serve.term.example.com" });
    const { res, statusCalls, headers } = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    // auth_missing branch is a 302 redirect (per interstitial.ts)
    expect(statusCalls).toContain(302);
    expect(headers["location"]).toMatch(/^https:\/\/term\.example\.com\/login/);
  });

  it("renders host_unreachable interstitial when resolveHostByUniversalId returns null", async () => {
    mocks.resolveHostByUniversalId.mockResolvedValue(null);
    const mod = await import("../subdomain-dispatch.js");
    const middleware = mod.createSubdomainDispatchMiddleware();
    const req = makeReq({ subdomainHeader: "42-3000.serve.term.example.com" });
    const { res, statusCalls } = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(statusCalls[0]).toBeGreaterThanOrEqual(500);
    expect(mocks.resolveHostByUniversalId).toHaveBeenCalledWith(42, "user-abc");
  });

  it("rejects a host-name label — serve URLs are `<machineId>-<port>` only", async () => {
    const mod = await import("../subdomain-dispatch.js");
    const middleware = mod.createSubdomainDispatchMiddleware();
    const req = makeReq({ subdomainHeader: "myhost-3000.serve.term.example.com" });
    const { res, statusCalls, sendCalls } = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    // invalid_link page, not "port N isn't responding"
    expect(statusCalls[0]).toBe(400);
    expect(sendCalls.join("")).toContain("serve link isn");
    expect(sendCalls.join("")).not.toContain("responding");
    expect(mocks.resolveHostByUniversalId).not.toHaveBeenCalled();
  });

  it("renders permission_denied interstitial (403) when canAccessHost returns hasAccess=false", async () => {
    mocks.resolveHostByUniversalId.mockResolvedValue({
      id: 42,
      name: "MyHost",
      ip: "10.0.0.5",
      port: 22,
      username: "user",
    });
    mocks.canAccessHost.mockResolvedValue({ hasAccess: false });
    const mod = await import("../subdomain-dispatch.js");
    const middleware = mod.createSubdomainDispatchMiddleware();
    const req = makeReq({ subdomainHeader: "42-3000.serve.term.example.com" });
    const { res, statusCalls } = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(statusCalls).toContain(403);
    expect(mocks.canAccessHost).toHaveBeenCalledWith("user-abc", 42, "read");
  });

  it("attaches serveTarget to req and calls next() when all checks pass", async () => {
    const hostRow = {
      id: 42,
      name: "MyHost",
      ip: "10.0.0.5",
      port: 22,
      username: "user",
    };
    mocks.resolveHostByUniversalId.mockResolvedValue(hostRow);
    mocks.canAccessHost.mockResolvedValue({ hasAccess: true });
    const mod = await import("../subdomain-dispatch.js");
    const middleware = mod.createSubdomainDispatchMiddleware();
    const req = makeReq({ subdomainHeader: "42-3000.serve.term.example.com" });
    const { res, statusCalls } = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(statusCalls).toHaveLength(0);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    const target = (req as Request & { serveTarget?: unknown }).serveTarget as {
      hostname: string;
      port: number;
      host: unknown;
    };
    expect(target).toBeDefined();
    // hostname is the caller's display name for the box (interstitials only)
    expect(target.hostname).toBe("MyHost");
    expect(target.port).toBe(3000);
    expect(target.host).toBe(hostRow);
  });

  // convo-scoped apps: box access isn't enough for a conversation app's port.
  describe("conversation app ports", () => {
    const hostRow = { id: 42, name: "MyHost", ip: "10.0.0.5", port: 22, username: "user" };
    const convoApp = { hostId: "42", slug: "tally", port: 9505, owner: "alpha" };

    it.each([
      ["public port", "42-9505.serve.term.example.com"],
      ["private port behind the relay", "42-19505.serve.term.example.com"],
    ])("refuses the %s when the caller can't see the owning identity", async (_label, sub) => {
      mocks.resolveHostByUniversalId.mockResolvedValue(hostRow);
      mocks.canAccessHost.mockResolvedValue({ hasAccess: true });
      mocks.getAppSnapshot.mockReturnValue([convoApp]);
      mocks.canUserSeeIdentity.mockResolvedValue(false);
      const mod = await import("../subdomain-dispatch.js");
      const middleware = mod.createSubdomainDispatchMiddleware();
      const req = makeReq({ subdomainHeader: sub });
      const { res, statusCalls } = makeRes();
      const next = vi.fn();
      await middleware(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(statusCalls).toContain(403);
      expect(mocks.canUserSeeIdentity).toHaveBeenCalledWith("alpha", "42", "user-abc");
    });

    it("allows it when the caller can see the owning identity", async () => {
      mocks.resolveHostByUniversalId.mockResolvedValue(hostRow);
      mocks.canAccessHost.mockResolvedValue({ hasAccess: true });
      mocks.getAppSnapshot.mockReturnValue([convoApp]);
      const mod = await import("../subdomain-dispatch.js");
      const middleware = mod.createSubdomainDispatchMiddleware();
      const req = makeReq({ subdomainHeader: "42-9505.serve.term.example.com" });
      const { res } = makeRes();
      const next = vi.fn();
      await middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("never consults the identity gate for other ports", async () => {
      mocks.resolveHostByUniversalId.mockResolvedValue(hostRow);
      mocks.canAccessHost.mockResolvedValue({ hasAccess: true });
      mocks.getAppSnapshot.mockReturnValue([convoApp, { hostId: "42", slug: "side", port: 9506, owner: null }]);
      const mod = await import("../subdomain-dispatch.js");
      const middleware = mod.createSubdomainDispatchMiddleware();
      for (const sub of ["42-3000.serve.term.example.com", "42-9506.serve.term.example.com"]) {
        const next = vi.fn();
        await middleware(makeReq({ subdomainHeader: sub }), makeRes().res, next);
        expect(next).toHaveBeenCalledTimes(1);
      }
      expect(mocks.canUserSeeIdentity).not.toHaveBeenCalled();
    });
  });

  it("rejects a dashed non-numeric prefix like 'foo-12-3000'", async () => {
    const mod = await import("../subdomain-dispatch.js");
    const middleware = mod.createSubdomainDispatchMiddleware();
    const req = makeReq({
      subdomainHeader: "foo-12-3000.serve.term.example.com",
    });
    const { res, statusCalls } = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(statusCalls[0]).toBeGreaterThanOrEqual(400);
    expect(mocks.resolveHostByUniversalId).not.toHaveBeenCalled();
  });
});
