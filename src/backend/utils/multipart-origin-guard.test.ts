import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  multipartOriginGuard,
  assertNotServeSubdomainOrigin,
} from "./multipart-origin-guard.js";

// Phase 103 Plan 08 D-10 — origin-guard for multipart POST endpoints.
// Complements Plan 06's ws-origin-guard (WebSocket layer) and Plan 02's
// cors-config.ts SERVE_SUBDOMAIN_RE (preflight-triggering HTTP layer).

// Silence the sshLogger for the reject-warns; the module logs on every reject.
vi.mock("./logger.js", () => ({
  sshLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function mkReq(origin: string | undefined | string[]): Request {
  return {
    headers: origin === undefined ? {} : { origin },
    path: "/some/path",
    method: "POST",
  } as unknown as Request;
}

function mkRes(): Response & { _status?: number; _body?: unknown } {
  const res = {} as Response & { _status?: number; _body?: unknown };
  res.status = vi.fn((code: number) => {
    res._status = code;
    return res;
  }) as unknown as Response["status"];
  res.json = vi.fn((body: unknown) => {
    res._body = body;
    return res;
  }) as unknown as Response["json"];
  return res;
}

describe("multipartOriginGuard middleware", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects request from *.serve.term.<domain> with 403 + classified error", () => {
    const req = mkReq("https://foo-8080.serve.term.example.com");
    const res = mkRes();
    multipartOriginGuard(req, res, next);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: "Origin not permitted for this endpoint" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects http:// serve subdomain (dev/preview matches too)", () => {
    const req = mkReq("http://x-3000.serve.term.example.com");
    const res = mkRes();
    multipartOriginGuard(req, res, next);
    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through request with primary origin https://term.<domain>", () => {
    const req = mkReq("https://term.example.com");
    const res = mkRes();
    multipartOriginGuard(req, res, next);
    expect(res._status).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes through request with no Origin header (non-browser curl / server-to-server)", () => {
    const req = mkReq(undefined);
    const res = mkRes();
    multipartOriginGuard(req, res, next);
    expect(res._status).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes through request whose Origin is an array (defensive — anomalous shape falls through)", () => {
    const req = mkReq([
      "https://foo-8080.serve.term.example.com",
    ] as unknown as string);
    const res = mkRes();
    multipartOriginGuard(req, res, next);
    // Array shape doesn't match string check → falls through, JWT gate still applies.
    expect(res._status).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes through sibling origin https://files.example.com", () => {
    const req = mkReq("https://files.example.com");
    const res = mkRes();
    multipartOriginGuard(req, res, next);
    expect(res._status).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("assertNotServeSubdomainOrigin", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws a 403-tagged Error when Origin matches serve subdomain", () => {
    const req = mkReq("https://foo-8080.serve.term.example.com");
    expect(() => assertNotServeSubdomainOrigin(req)).toThrow(
      "Origin not permitted for this endpoint",
    );
    try {
      assertNotServeSubdomainOrigin(req);
    } catch (e) {
      expect((e as Error & { status: number }).status).toBe(403);
    }
  });

  it("does not throw when Origin is primary term.<domain>", () => {
    const req = mkReq("https://term.example.com");
    expect(() => assertNotServeSubdomainOrigin(req)).not.toThrow();
  });

  it("does not throw when Origin header is missing", () => {
    const req = mkReq(undefined);
    expect(() => assertNotServeSubdomainOrigin(req)).not.toThrow();
  });

  it("does not throw when Origin is an array (defensive)", () => {
    const req = mkReq([
      "https://foo-8080.serve.term.example.com",
    ] as unknown as string);
    expect(() => assertNotServeSubdomainOrigin(req)).not.toThrow();
  });
});
