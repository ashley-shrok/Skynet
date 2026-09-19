/**
 * Phase 120 Plan 02 Task 1 — Unit tests for app-pane-proxy-factory.
 *
 * Verifies the sibling proxy factory (per D-09) that mirrors
 * `src/backend/serve-url/proxy-factory.ts` with three additions unique to
 * the app-pane path:
 *
 *   (a) Cache key includes `${hostId}:${slug}` per RESEARCH.md Pitfall 2 so
 *       different apps on the same host+tunnelPort get distinct middleware
 *       instances with distinct pathRewrite rules.
 *   (b) `selfHandleResponse: true` + `pathRewrite` + a `responseInterceptor`
 *       proxyRes hook that gates on Content-Type and delegates to Wave 1's
 *       `injectBaseTag` for the D-11 base-tag injection.
 *   (c) `operation: "apps_pane_proxy"` log tag (differentiates from
 *       serve-url's `"serve_url_proxy"` for post-hoc filtering).
 *
 * Inherited from serve-url/proxy-factory.ts verbatim (must NOT drift):
 *   - `stripToAllowlist` header discipline on both proxyReq + proxyReqWs.
 *   - RSV1 WebSocket fix: `sec-websocket-extensions` set to empty string on
 *     the WS upgrade hook (R&D Gotcha 1).
 *   - Shared interstitial + error-classifier composition in `on.error`.
 *   - `writableEnded` guard before writing the interstitial.
 *
 * Pattern reference: 120-PATTERNS.md § app-pane-proxy-factory,
 * 120-RESEARCH.md § Pattern 3 (responseInterceptor caveats), Pitfall 2.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";
import type * as http from "node:http";

/* ------------------------------------------------------------------------ */
/*  Hoisted mocks                                                            */
/* ------------------------------------------------------------------------ */

const mocks = vi.hoisted(() => ({
  // createProxyMiddleware returns a stub RequestHandler and captures its
  // options argument for inspection. Each call yields a FRESH handler
  // reference so cache-hit / cache-miss can be asserted on identity.
  createProxyMiddleware: vi.fn(),
  // responseInterceptor returns the callback verbatim so the test can
  // invoke it directly against a stubbed proxyRes/req/res.
  responseInterceptor: vi.fn((cb: unknown) => cb),
  // injectBaseTag stub — capture calls, return a marker Buffer so the
  // caller-side test can assert the pass-through vs inject decision.
  injectBaseTag: vi.fn(),
  // Shared interstitial + error-classifier mocks — the sibling factory
  // must delegate to these on `on.error` (D-17 reuse).
  renderInterstitial: vi.fn(),
  writeInterstitial: vi.fn(),
  classifyTunnelError: vi.fn(),
  // Header audit mock — proxyReq/proxyReqWs hooks emit to this after the
  // strip runs.
  emitHeaderAudit: vi.fn(),
  // Logger stub — the `on.error` hook logs with only safe fields.
  sshLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: mocks.createProxyMiddleware,
  responseInterceptor: mocks.responseInterceptor,
}));

vi.mock("../base-tag-injector.js", () => ({
  injectBaseTag: mocks.injectBaseTag,
}));

vi.mock("../../serve-url/interstitial.js", () => ({
  renderInterstitial: mocks.renderInterstitial,
  writeInterstitial: mocks.writeInterstitial,
}));

vi.mock("../../serve-url/error-classifier.js", () => ({
  classifyTunnelError: mocks.classifyTunnelError,
}));

vi.mock("../../serve-url/header-audit-sampler.js", () => ({
  emitHeaderAudit: mocks.emitHeaderAudit,
}));

vi.mock("../../utils/logger.js", () => ({
  sshLogger: mocks.sshLogger,
  systemLogger: mocks.sshLogger,
  databaseLogger: mocks.sshLogger,
  apiLogger: mocks.sshLogger,
}));

/* ------------------------------------------------------------------------ */
/*  Helpers                                                                  */
/* ------------------------------------------------------------------------ */

// Minimal ServeTarget stub. `host` is opaque here — the factory doesn't
// inspect its fields, only threads it through.
function makeTarget(hostname = "t1000", port = 3001) {
  return {
    hostname,
    port,
    host: { id: "1", name: hostname } as unknown as import("../../serve-url/types.js").ServeTarget["host"],
  };
}

// Fake ClientRequest capturing setHeader + removeHeader calls plus a header
// map so `stripToAllowlist` can walk it via getHeaderNames.
function makeProxyReq(initialHeaders: Record<string, string> = {}) {
  const headers = { ...initialHeaders };
  const setHeaderCalls: Array<[string, string]> = [];
  const removeHeaderCalls: string[] = [];
  const req = {
    getHeaderNames: () => Object.keys(headers),
    setHeader: (name: string, value: string) => {
      headers[name] = value;
      setHeaderCalls.push([name, value]);
    },
    removeHeader: (name: string) => {
      delete headers[name];
      removeHeaderCalls.push(name);
    },
  } as unknown as http.ClientRequest;
  return { req, headers, setHeaderCalls, removeHeaderCalls };
}

function makeProxyRes(contentType: string | undefined): http.IncomingMessage {
  return {
    headers: contentType !== undefined ? { "content-type": contentType } : {},
  } as unknown as http.IncomingMessage;
}

function makeExpressReq(): Request {
  return {
    headers: { host: "skynet.test" },
    originalUrl: "/apps/1/todo/pane/api/x",
  } as unknown as Request;
}

function makeExpressRes(writableEnded = false): Response {
  return {
    writableEnded,
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
    end: vi.fn(),
  } as unknown as Response;
}

// Grab the most-recent options arg from createProxyMiddleware. Each call to
// the factory produces one createProxyMiddleware invocation on cache-miss.
type ProxyOptions = Parameters<typeof mocks.createProxyMiddleware>[0];
function lastOptions(): ProxyOptions {
  const calls = mocks.createProxyMiddleware.mock.calls;
  return calls[calls.length - 1][0] as ProxyOptions;
}

/* ------------------------------------------------------------------------ */
/*  Fixture setup                                                            */
/* ------------------------------------------------------------------------ */

beforeEach(() => {
  // Reset mocks + module cache so the module-level proxyCache Map starts
  // empty for every test. This is the cleanest way to test cache-key
  // behavior in isolation.
  vi.resetModules();
  mocks.createProxyMiddleware.mockReset();
  mocks.createProxyMiddleware.mockImplementation(() => {
    // Fresh handler per createProxyMiddleware call so identity comparisons
    // in cache-key tests are meaningful.
    return vi.fn();
  });
  mocks.responseInterceptor.mockReset();
  mocks.responseInterceptor.mockImplementation((cb: unknown) => cb);
  mocks.injectBaseTag.mockReset();
  mocks.injectBaseTag.mockImplementation(async (buf: Buffer) =>
    Buffer.from(`INJECTED:${buf.toString("utf8")}`, "utf8"),
  );
  mocks.renderInterstitial.mockReset();
  mocks.renderInterstitial.mockReturnValue({
    status: 502,
    body: "<html>err</html>",
    headers: { "content-type": "text/html" },
  });
  mocks.writeInterstitial.mockReset();
  mocks.classifyTunnelError.mockReset();
  mocks.classifyTunnelError.mockReturnValue("host_unreachable");
  mocks.emitHeaderAudit.mockReset();
  mocks.sshLogger.info.mockReset();
  mocks.sshLogger.warn.mockReset();
  mocks.sshLogger.error.mockReset();
  // Ensure PRIMARY_DOMAIN's module-load IIFE (in app-proxy-csrf-check.js)
  // has a value — the factory imports PRIMARY_DOMAIN from it.
  if (process.env.SKYNET_COOKIE_DOMAIN === undefined) {
    process.env.SKYNET_COOKIE_DOMAIN = "https://skynet.test";
  }
});

/* ------------------------------------------------------------------------ */
/*  Cache-key tests (Pitfall 2 — per-slug isolation)                         */
/* ------------------------------------------------------------------------ */

describe("cache-key", () => {
  it("returns the SAME middleware for same args (cache hit)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    const target = makeTarget();
    const a = getOrCreateAppPaneProxyForTarget(target, 12345, 1, "todo");
    const b = getOrCreateAppPaneProxyForTarget(target, 12345, 1, "todo");
    expect(a).toBe(b);
    expect(mocks.createProxyMiddleware).toHaveBeenCalledTimes(1);
  });

  it("returns DIFFERENT middleware for different slug on otherwise-identical args (per-slug cache miss)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    const target = makeTarget();
    const a = getOrCreateAppPaneProxyForTarget(target, 12345, 1, "todo");
    const b = getOrCreateAppPaneProxyForTarget(target, 12345, 1, "timer");
    expect(a).not.toBe(b);
    expect(mocks.createProxyMiddleware).toHaveBeenCalledTimes(2);
  });

  it("returns DIFFERENT middleware for different hostId on otherwise-identical args (per-hostId cache miss)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    const target = makeTarget();
    const a = getOrCreateAppPaneProxyForTarget(target, 12345, 1, "todo");
    const b = getOrCreateAppPaneProxyForTarget(target, 12345, 2, "todo");
    expect(a).not.toBe(b);
    expect(mocks.createProxyMiddleware).toHaveBeenCalledTimes(2);
  });

  it("returns DIFFERENT middleware for different tunnelPort on same args (tunnel-rebuild path)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    const target = makeTarget();
    const a = getOrCreateAppPaneProxyForTarget(target, 12345, 1, "todo");
    const b = getOrCreateAppPaneProxyForTarget(target, 22222, 1, "todo");
    expect(a).not.toBe(b);
    expect(mocks.createProxyMiddleware).toHaveBeenCalledTimes(2);
  });
});

/* ------------------------------------------------------------------------ */
/*  Middleware options — createProxyMiddleware invocation shape              */
/* ------------------------------------------------------------------------ */

describe("middleware options", () => {
  it("calls createProxyMiddleware with selfHandleResponse: true (required for responseInterceptor)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 1, "todo");
    const opts = lastOptions() as Record<string, unknown>;
    expect(opts.selfHandleResponse).toBe(true);
  });

  it("calls createProxyMiddleware with ws: true and changeOrigin: true", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 1, "todo");
    const opts = lastOptions() as Record<string, unknown>;
    expect(opts.ws).toBe(true);
    expect(opts.changeOrigin).toBe(true);
  });

  it("targets http://127.0.0.1:${tunnelPort} loopback", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 1, "todo");
    const opts = lastOptions() as Record<string, unknown>;
    expect(opts.target).toBe("http://127.0.0.1:12345");
  });

  it("configures pathRewrite as a function that strips the mount-relative /<hostId>/<slug>/pane prefix (HIGH-2)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as Record<string, unknown>;
    // HIGH-2 code-review fix (2026-09-19): pathRewrite is now a function.
    // The router mounts at `/apps`, so Express strips `/apps` from `req.url`
    // before the proxy sees it — the rewrite works on `/5/todo/pane/...`,
    // NOT `/apps/5/todo/pane/...`. Prior form was `{ "^/apps/5/todo/pane":
    // "" }`, which never matched at runtime.
    expect(typeof opts.pathRewrite).toBe("function");
    const rewrite = opts.pathRewrite as (path: string) => string;
    expect(rewrite("/5/todo/pane/api/list")).toBe("/api/list");
    expect(rewrite("/5/todo/pane/")).toBe("/");
    expect(rewrite("/5/todo/pane")).toBe("/");
    // Non-matching paths pass through unchanged (defence-in-depth).
    expect(rewrite("/other/path")).toBe("/other/path");
  });

  it("wraps proxyRes with responseInterceptor (invoked once with the async callback)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 1, "todo");
    expect(mocks.responseInterceptor).toHaveBeenCalledTimes(1);
    expect(mocks.responseInterceptor.mock.calls[0][0]).toBeTypeOf("function");
  });
});

/* ------------------------------------------------------------------------ */
/*  proxyReq hook — allowlist strip on outbound HTTP                          */
/* ------------------------------------------------------------------------ */

describe("proxyReq hook (HEADER_ALLOWLIST strip on HTTP outbound)", () => {
  it("removes headers not in the allowlist (Cookie, Authorization stripped)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 1, "todo");
    const opts = lastOptions() as { on: { proxyReq: Function } };
    const { req, removeHeaderCalls } = makeProxyReq({
      host: "127.0.0.1:12345",
      cookie: "session=abc",
      authorization: "Bearer xxx",
      "x-skynet-user": "1",
      "content-type": "application/json",
    });
    opts.on.proxyReq(req, {} as unknown as Request, {} as unknown as Response, {} as unknown as import("http-proxy-middleware").Options);
    expect(removeHeaderCalls).toContain("cookie");
    expect(removeHeaderCalls).toContain("authorization");
    expect(removeHeaderCalls).toContain("x-skynet-user");
    // Allowlisted headers remain (not removed).
    expect(removeHeaderCalls).not.toContain("host");
    expect(removeHeaderCalls).not.toContain("content-type");
  });
});

/* ------------------------------------------------------------------------ */
/*  proxyReqWs hook — RSV1 fix + allowlist strip                             */
/* ------------------------------------------------------------------------ */

describe("proxyReqWs hook (RSV1 WebSocket fix + allowlist strip)", () => {
  it("strips headers via the allowlist AND force-sets sec-websocket-extensions to empty string", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 1, "todo");
    const opts = lastOptions() as { on: { proxyReqWs: Function } };
    const { req, setHeaderCalls, removeHeaderCalls } = makeProxyReq({
      host: "127.0.0.1:12345",
      cookie: "session=abc",
      "sec-websocket-extensions": "permessage-deflate",
    });
    opts.on.proxyReqWs(
      req,
      {} as unknown as Request,
      {} as unknown as Response,
      {} as unknown as import("http-proxy-middleware").Options,
    );
    // Strip removed cookie and sec-websocket-extensions (both not in allowlist);
    // then the RSV1 fix explicitly setHeader('sec-websocket-extensions', '').
    expect(removeHeaderCalls).toContain("cookie");
    expect(removeHeaderCalls).toContain("sec-websocket-extensions");
    // The RSV1 fix: exactly one setHeader call for sec-websocket-extensions with "".
    const rsv1 = setHeaderCalls.filter(([k]) => k === "sec-websocket-extensions");
    expect(rsv1).toEqual([["sec-websocket-extensions", ""]]);
  });
});

/* ------------------------------------------------------------------------ */
/*  responseInterceptor callback — Content-Type gate                         */
/* ------------------------------------------------------------------------ */

describe("proxyRes content-type gating (responseInterceptor callback)", () => {
  it("invokes injectBaseTag on text/html responses and returns its result", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    // The responseInterceptor mock returns the async callback verbatim; grab it.
    const cb = mocks.responseInterceptor.mock.calls[0][0] as (
      buffer: Buffer,
      proxyRes: http.IncomingMessage,
      req: Request,
      res: Response,
    ) => Promise<Buffer>;
    const input = Buffer.from("<html><head></head></html>", "utf8");
    const proxyRes = makeProxyRes("text/html");
    const result = await cb(input, proxyRes, makeExpressReq(), makeExpressRes());
    expect(mocks.injectBaseTag).toHaveBeenCalledTimes(1);
    expect(mocks.injectBaseTag).toHaveBeenCalledWith(input, 5, "todo");
    // Stub returns Buffer("INJECTED:<html>...")
    expect(result.toString("utf8")).toContain("INJECTED:");
  });

  it("fires injection on text/html with extra params like charset=utf-8 (.startsWith gate)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const cb = mocks.responseInterceptor.mock.calls[0][0] as (
      buffer: Buffer,
      proxyRes: http.IncomingMessage,
      req: Request,
      res: Response,
    ) => Promise<Buffer>;
    const input = Buffer.from("<html></html>", "utf8");
    const proxyRes = makeProxyRes("text/html; charset=utf-8");
    await cb(input, proxyRes, makeExpressReq(), makeExpressRes());
    expect(mocks.injectBaseTag).toHaveBeenCalledTimes(1);
  });

  it("returns the input buffer UNCHANGED for application/json (pass-through invariant)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const cb = mocks.responseInterceptor.mock.calls[0][0] as (
      buffer: Buffer,
      proxyRes: http.IncomingMessage,
      req: Request,
      res: Response,
    ) => Promise<Buffer>;
    const input = Buffer.from(`{"foo":"<head>","bar":"baz"}`, "utf8");
    const proxyRes = makeProxyRes("application/json");
    const result = await cb(input, proxyRes, makeExpressReq(), makeExpressRes());
    expect(mocks.injectBaseTag).not.toHaveBeenCalled();
    // Identity check: pass-through returns the exact input buffer.
    expect(result).toBe(input);
  });

  it("returns the input buffer UNCHANGED when Content-Type header is absent", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const cb = mocks.responseInterceptor.mock.calls[0][0] as (
      buffer: Buffer,
      proxyRes: http.IncomingMessage,
      req: Request,
      res: Response,
    ) => Promise<Buffer>;
    const input = Buffer.from("raw bytes", "utf8");
    const proxyRes = makeProxyRes(undefined);
    const result = await cb(input, proxyRes, makeExpressReq(), makeExpressRes());
    expect(mocks.injectBaseTag).not.toHaveBeenCalled();
    expect(result).toBe(input);
  });
});

/* ------------------------------------------------------------------------ */
/*  error hook — interstitial + writableEnded guard                          */
/* ------------------------------------------------------------------------ */

describe("error hook", () => {
  it("classifies the tunnel error, logs via sshLogger.warn with operation='apps_pane_proxy', and writes the interstitial", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 1, "todo");
    const opts = lastOptions() as { on: { error: Function } };
    const err = Object.assign(new Error("upstream refused"), {
      code: "ECONNREFUSED",
      name: "Error",
      level: "",
    });
    const req = makeExpressReq();
    const res = makeExpressRes(false);
    opts.on.error(err, req, res);
    // Classified via classifyTunnelError.
    expect(mocks.classifyTunnelError).toHaveBeenCalledWith(err);
    // Logged with the differentiating log-stream tag.
    expect(mocks.sshLogger.warn).toHaveBeenCalledTimes(1);
    const [, payload] = mocks.sshLogger.warn.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload.operation).toBe("apps_pane_proxy");
    // Only safe fields — no stack, no headers, no user data.
    const forbidden = ["stack", "cookie", "authorization", "userId", "req"];
    for (const k of forbidden) {
      expect(payload).not.toHaveProperty(k);
    }
    // Interstitial was rendered + written.
    expect(mocks.renderInterstitial).toHaveBeenCalledTimes(1);
    expect(mocks.writeInterstitial).toHaveBeenCalledTimes(1);
  });

  it("returns early WITHOUT writing when res.writableEnded is true (mirror of proxy-factory.ts guard)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 1, "todo");
    const opts = lastOptions() as { on: { error: Function } };
    const err = Object.assign(new Error("late error"), { code: "ECONNRESET" });
    const req = makeExpressReq();
    const res = makeExpressRes(true); // client disconnected mid-error
    opts.on.error(err, req, res);
    // No interstitial write attempted.
    expect(mocks.writeInterstitial).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ */
/*  buildPaneMountPathRewrite — HIGH-2 dedicated coverage                    */
/* ------------------------------------------------------------------------ */

/**
 * HIGH-2 code-review fix (2026-09-19). The router mounts under `/apps`,
 * so Express strips `/apps` from `req.url` before the proxy middleware
 * sees it. The rewrite therefore operates on `/<hostId>/<slug>/pane/...`,
 * not `/apps/<hostId>/<slug>/pane/...`. This suite exercises the exported
 * `buildPaneMountPathRewrite` factory directly with the exact URL shapes
 * Express would deliver post-mount — a regression against the pre-fix
 * regex (`^/apps/...`) fails these cases because none of them start with
 * `/apps`.
 */
describe("buildPaneMountPathRewrite (HIGH-2 unit coverage)", () => {
  it("rewrites `/5/todo/pane/api/list` → `/api/list`", async () => {
    const { buildPaneMountPathRewrite } = await import(
      "../app-pane-proxy-factory.js"
    );
    const rewrite = buildPaneMountPathRewrite(5, "todo");
    expect(rewrite("/5/todo/pane/api/list")).toBe("/api/list");
  });

  it("rewrites trailing-slash-only `/5/todo/pane/` → `/`", async () => {
    const { buildPaneMountPathRewrite } = await import(
      "../app-pane-proxy-factory.js"
    );
    const rewrite = buildPaneMountPathRewrite(5, "todo");
    expect(rewrite("/5/todo/pane/")).toBe("/");
  });

  it("rewrites no-trailing-slash `/5/todo/pane` → `/`", async () => {
    const { buildPaneMountPathRewrite } = await import(
      "../app-pane-proxy-factory.js"
    );
    const rewrite = buildPaneMountPathRewrite(5, "todo");
    expect(rewrite("/5/todo/pane")).toBe("/");
  });

  it("preserves query strings inside the tail (they're part of the path arg to pathRewrite)", async () => {
    const { buildPaneMountPathRewrite } = await import(
      "../app-pane-proxy-factory.js"
    );
    const rewrite = buildPaneMountPathRewrite(5, "todo");
    // http-proxy-middleware passes path+search to pathRewrite; the whole
    // tail after `/pane` (including `?foo=bar`) belongs to the app.
    expect(rewrite("/5/todo/pane/api/x?foo=bar&baz=qux")).toBe(
      "/api/x?foo=bar&baz=qux",
    );
  });

  it("passes through paths that don't match this middleware's (hostId, slug) tuple", async () => {
    const { buildPaneMountPathRewrite } = await import(
      "../app-pane-proxy-factory.js"
    );
    const rewrite = buildPaneMountPathRewrite(5, "todo");
    // Different hostId — passthrough (upstream routing dispatch shouldn't
    // send us this; defence-in-depth guarantees we don't accidentally
    // strip the wrong prefix).
    expect(rewrite("/6/todo/pane/api/list")).toBe("/6/todo/pane/api/list");
    // Different slug — passthrough.
    expect(rewrite("/5/timer/pane/api/list")).toBe("/5/timer/pane/api/list");
    // No `/pane` segment — passthrough.
    expect(rewrite("/5/todo/other/x")).toBe("/5/todo/other/x");
    // Missing leading slash — passthrough.
    expect(rewrite("5/todo/pane")).toBe("5/todo/pane");
  });

  it("does NOT match the pre-fix `/apps/...` shape (regression guard)", async () => {
    const { buildPaneMountPathRewrite } = await import(
      "../app-pane-proxy-factory.js"
    );
    const rewrite = buildPaneMountPathRewrite(5, "todo");
    // If someone reverts to `/apps/...` this passes through unchanged
    // rather than stripping. In production this shape does not occur
    // (Express mount-strips `/apps` first) — asserted here so the guard
    // is explicit.
    expect(rewrite("/apps/5/todo/pane/api/list")).toBe(
      "/apps/5/todo/pane/api/list",
    );
  });

  it("handles slugs containing hyphens (APP_SLUG_RE-legal characters)", async () => {
    const { buildPaneMountPathRewrite } = await import(
      "../app-pane-proxy-factory.js"
    );
    const rewrite = buildPaneMountPathRewrite(5, "my-cool-app");
    expect(rewrite("/5/my-cool-app/pane/api/list")).toBe("/api/list");
  });
});
