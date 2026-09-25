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
 *   (b) `selfHandleResponse: true` + `pathRewrite` + a custom `proxyRes`
 *       hook that dispatches on Content-Type: text/html + application/
 *       xhtml+xml are buffered/decompressed/injected via `injectBaseTag`;
 *       everything else STREAMS through via `proxyRes.pipe(res)` (no
 *       buffering in Node memory — that fix landed 2026-09-25 after the
 *       prior `responseInterceptor` wrapper broke video Range requests
 *       and blew HTTP/2 timeouts on large binary responses).
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
 * 120-RESEARCH.md § Pattern 3 (buffering caveats — historical, superseded
 * by the 2026-09-25 streaming rewrite).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as zlib from "node:zlib";
import { PassThrough } from "node:stream";
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

// Fake IncomingMessage-shaped stream. The proxyRes hook reads
// `.headers`, `.statusCode`, and consumes the stream via `.pipe()`
// (streaming path) or `.on("data"/"end")` (buffered path). PassThrough
// gives us both event-emitter semantics AND a real pipe destination.
function makeProxyResStream(
  headers: Record<string, string | string[]> = {},
  statusCode = 200,
  body: Buffer | string = "",
): http.IncomingMessage & PassThrough {
  const stream = new PassThrough();
  (stream as unknown as { headers: unknown }).headers = headers;
  (stream as unknown as { statusCode: number }).statusCode = statusCode;
  if (body) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
    stream.end(buf);
  } else {
    stream.end();
  }
  return stream as unknown as http.IncomingMessage & PassThrough;
}

function makeExpressReq(method = "GET"): Request {
  return {
    method,
    headers: { host: "skynet.test" },
    originalUrl: "/apps/1/todo/pane/api/x",
  } as unknown as Request;
}

// Fake ServerResponse that captures header/status/body writes AND acts as a
// writable stream so `proxyRes.pipe(res)` works. Backed by PassThrough for
// stream semantics — `writableEnded` is a native getter on Writable and
// CANNOT be re-assigned, so we read the real one via the underlying
// stream's own state. For the initialWritableEnded=true case (error-hook
// guard test) we simply call end() right away, and native writableEnded
// flips to true naturally.
//
// `Object.assign` adds our own spy properties (setHeader / removeHeader /
// hasHeader / statusCode / send / status) — skipping writableEnded and
// headersSent (both native getters).
function makeExpressRes(initialWritableEnded = false) {
  const bodyStream = new PassThrough();
  const chunks: Buffer[] = [];
  bodyStream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));

  const headers: Record<string, string | string[] | number> = {};
  const setHeaderSpy = vi.fn((name: string, value: string | string[] | number) => {
    headers[name.toLowerCase()] = value;
  });
  const removeHeaderSpy = vi.fn((name: string) => {
    delete headers[name.toLowerCase()];
  });

  const res = Object.assign(bodyStream, {
    statusCode: 200,
    setHeader: setHeaderSpy,
    removeHeader: removeHeaderSpy,
    hasHeader: vi.fn((name: string) =>
      Object.prototype.hasOwnProperty.call(headers, name.toLowerCase()),
    ),
    getHeader: vi.fn((name: string) => headers[name.toLowerCase()]),
    getHeaders: vi.fn(() => headers),
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
  });

  // Wrap end() so we can capture the final chunk (native end() clears
  // buffers before the data listener sees them for the last chunk).
  const origEnd = bodyStream.end.bind(bodyStream);
  res.end = ((chunk?: Buffer | string) => {
    if (chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      chunks.push(buf);
    }
    return origEnd();
  }) as typeof res.end;

  // Prime the stream to writableEnded=true if the test wants that starting
  // state (the error-hook guard case).
  if (initialWritableEnded) {
    origEnd();
  }

  return {
    res: res as unknown as Response,
    headers,
    setHeaderSpy,
    removeHeaderSpy,
    getBody: () => Buffer.concat(chunks),
    isEnded: () => bodyStream.writableEnded,
  };
}

// Grab the most-recent options arg from createProxyMiddleware. Each call to
// the factory produces one createProxyMiddleware invocation on cache-miss.
type ProxyOptions = Parameters<typeof mocks.createProxyMiddleware>[0];
function lastOptions(): ProxyOptions {
  const calls = mocks.createProxyMiddleware.mock.calls;
  return calls[calls.length - 1][0] as ProxyOptions;
}

// Wait for stream 'end' events + all chained async work (including native
// zlib decompress callbacks — brotli takes several I/O ticks — and the
// awaited injectBaseTag) to complete. Six setImmediate ticks + one
// setTimeout(5) covers the worst observed case (brotli decompress); tests
// still run in <100ms each.
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setImmediate(r));
  }
  await new Promise((r) => setTimeout(r, 5));
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
  mocks.injectBaseTag.mockReset();
  mocks.injectBaseTag.mockImplementation((buf: Buffer) =>
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
  it("calls createProxyMiddleware with selfHandleResponse: true", async () => {
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
    expect(typeof opts.pathRewrite).toBe("function");
    const rewrite = opts.pathRewrite as (path: string) => string;
    expect(rewrite("/5/todo/pane/api/list")).toBe("/api/list");
    expect(rewrite("/5/todo/pane/")).toBe("/");
    expect(rewrite("/5/todo/pane")).toBe("/");
    expect(rewrite("/other/path")).toBe("/other/path");
  });

  it("registers a plain proxyRes function (no responseInterceptor wrapper)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 1, "todo");
    const opts = lastOptions() as { on: { proxyRes: unknown } };
    expect(typeof opts.on.proxyRes).toBe("function");
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
    opts.on.proxyReq(
      req,
      {} as unknown as Request,
      {} as unknown as Response,
      {} as unknown as import("http-proxy-middleware").Options,
    );
    expect(removeHeaderCalls).toContain("cookie");
    expect(removeHeaderCalls).toContain("authorization");
    expect(removeHeaderCalls).toContain("x-skynet-user");
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
    expect(removeHeaderCalls).toContain("cookie");
    expect(removeHeaderCalls).toContain("sec-websocket-extensions");
    const rsv1 = setHeaderCalls.filter(([k]) => k === "sec-websocket-extensions");
    expect(rsv1).toEqual([["sec-websocket-extensions", ""]]);
  });
});

/* ------------------------------------------------------------------------ */
/*  proxyRes buffered path — text/html injection                             */
/* ------------------------------------------------------------------------ */

describe("proxyRes buffered path (text/html + application/xhtml+xml)", () => {
  it("buffers text/html, calls injectBaseTag, writes result", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const bodyText = "<html><head></head></html>";
    const proxyRes = makeProxyResStream(
      { "content-type": "text/html" },
      200,
      bodyText,
    );
    const { res, getBody, isEnded } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(mocks.injectBaseTag).toHaveBeenCalledTimes(1);
    expect(mocks.injectBaseTag).toHaveBeenCalledWith(
      Buffer.from(bodyText, "utf8"),
      5,
      "todo",
    );
    expect(isEnded()).toBe(true);
    expect(getBody().toString("utf8")).toContain("INJECTED:");
  });

  it("buffers text/html; charset=utf-8 (startsWith match)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream(
      { "content-type": "text/html; charset=utf-8" },
      200,
      "<html></html>",
    );
    const { res } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(mocks.injectBaseTag).toHaveBeenCalledTimes(1);
  });

  it("buffers application/xhtml+xml (injection-eligible per RFC)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream(
      { "content-type": "application/xhtml+xml" },
      200,
      "<html></html>",
    );
    const { res } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(mocks.injectBaseTag).toHaveBeenCalledTimes(1);
  });

  it("decompresses gzip-encoded html before injection", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const html = "<html><head></head></html>";
    const gzipped = zlib.gzipSync(Buffer.from(html, "utf8"));
    const proxyRes = makeProxyResStream(
      { "content-type": "text/html", "content-encoding": "gzip" },
      200,
      gzipped,
    );
    const { res, headers } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    // injectBaseTag receives DECOMPRESSED bytes.
    expect(mocks.injectBaseTag).toHaveBeenCalledWith(
      Buffer.from(html, "utf8"),
      5,
      "todo",
    );
    // content-encoding is stripped on the response (we sent uncompressed).
    expect(headers["content-encoding"]).toBeUndefined();
  });

  it("decompresses brotli-encoded html before injection", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const html = "<html><head></head></html>";
    const brotlied = zlib.brotliCompressSync(Buffer.from(html, "utf8"));
    const proxyRes = makeProxyResStream(
      { "content-type": "text/html", "content-encoding": "br" },
      200,
      brotlied,
    );
    const { res } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(mocks.injectBaseTag).toHaveBeenCalledWith(
      Buffer.from(html, "utf8"),
      5,
      "todo",
    );
  });

  it("recomputes Content-Length after injection", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const bodyText = "<html></html>";
    const proxyRes = makeProxyResStream(
      { "content-type": "text/html", "content-length": String(bodyText.length) },
      200,
      bodyText,
    );
    const { res, headers } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    // Injection prepends "INJECTED:" (stub) — new length must reflect that,
    // not the original body length.
    expect(headers["content-length"]).toBe(
      String(`INJECTED:${bodyText}`.length),
    );
  });
});

/* ------------------------------------------------------------------------ */
/*  proxyRes streaming path — non-HTML flows through without buffering       */
/* ------------------------------------------------------------------------ */

describe("proxyRes streaming path (non-HTML)", () => {
  it("does NOT call injectBaseTag on application/json", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream(
      { "content-type": "application/json" },
      200,
      `{"foo":"<head>"}`,
    );
    const { res, getBody } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(mocks.injectBaseTag).not.toHaveBeenCalled();
    expect(getBody().toString("utf8")).toBe(`{"foo":"<head>"}`);
  });

  it("streams video/mp4 body through unchanged (no injection)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "videos");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const videoBytes = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]);
    const proxyRes = makeProxyResStream(
      { "content-type": "video/mp4" },
      200,
      videoBytes,
    );
    const { res, getBody } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(mocks.injectBaseTag).not.toHaveBeenCalled();
    expect(Buffer.compare(getBody(), videoBytes)).toBe(0);
  });

  it("passes upstream compressed responses through UNCHANGED on the streaming path (no decompression)", async () => {
    // A gzipped JS bundle should reach the client still gzipped — the
    // streaming path pipes bytes verbatim so the browser can decompress.
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const jsBody = "console.log('hi');";
    const gzipped = zlib.gzipSync(Buffer.from(jsBody, "utf8"));
    const proxyRes = makeProxyResStream(
      {
        "content-type": "application/javascript",
        "content-encoding": "gzip",
      },
      200,
      gzipped,
    );
    const { res, headers, getBody } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(headers["content-encoding"]).toBe("gzip");
    expect(Buffer.compare(getBody(), gzipped)).toBe(0);
  });

  it("preserves 206 Partial Content + Content-Range + Accept-Ranges for video seek", async () => {
    // <video> playback issues Range: bytes=X-Y and the response comes back
    // as 206 with Content-Range: bytes X-Y/total. If ANY of these get
    // mangled, seeking silently breaks.
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "videos");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const rangeBytes = Buffer.from("...partial video chunk...");
    const proxyRes = makeProxyResStream(
      {
        "content-type": "video/mp4",
        "content-range": "bytes 1024-2047/1048576",
        "accept-ranges": "bytes",
        "content-length": String(rangeBytes.length),
      },
      206,
      rangeBytes,
    );
    const { res, headers, getBody } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(res.statusCode).toBe(206);
    expect(headers["content-range"]).toBe("bytes 1024-2047/1048576");
    expect(headers["accept-ranges"]).toBe("bytes");
    expect(headers["content-length"]).toBe(String(rangeBytes.length));
    expect(Buffer.compare(getBody(), rangeBytes)).toBe(0);
  });

  it("passes upstream 404 through with its body (app response, not tunnel error)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream(
      { "content-type": "text/plain" },
      404,
      "Not Found",
    );
    const { res, getBody } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(res.statusCode).toBe(404);
    expect(getBody().toString("utf8")).toBe("Not Found");
    // Not classified as a tunnel error — classifyTunnelError never called.
    expect(mocks.classifyTunnelError).not.toHaveBeenCalled();
    expect(mocks.writeInterstitial).not.toHaveBeenCalled();
  });

  it("passes upstream 500 through with its body", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream(
      { "content-type": "application/json" },
      500,
      `{"error":"internal"}`,
    );
    const { res, getBody } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(res.statusCode).toBe(500);
    expect(getBody().toString("utf8")).toBe(`{"error":"internal"}`);
    expect(mocks.writeInterstitial).not.toHaveBeenCalled();
  });

  it("streams tiny single-chunk responses (no min-body-size assumption)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream(
      { "content-type": "application/json" },
      200,
      `{"ok":true}`,
    );
    const { res, getBody } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(getBody().toString("utf8")).toBe(`{"ok":true}`);
  });
});

/* ------------------------------------------------------------------------ */
/*  proxyRes bodyless responses — HEAD, 1xx, 204, 304                        */
/* ------------------------------------------------------------------------ */

describe("proxyRes bodyless responses (HEAD / 1xx / 204 / 304)", () => {
  it("ends with no body on HEAD requests (Content-Length preserved for probe)", async () => {
    // Some players (Safari) issue HEAD to read Content-Length + Accept-Ranges
    // before the range GET. HEAD must return headers only, empty body.
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "videos");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream(
      {
        "content-type": "video/mp4",
        "content-length": "1048576",
        "accept-ranges": "bytes",
      },
      200,
      "", // upstream sends no body for HEAD anyway
    );
    const { res, headers, getBody } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq("HEAD"), res);
    await flush();
    expect(headers["content-length"]).toBe("1048576");
    expect(headers["accept-ranges"]).toBe("bytes");
    expect(getBody().length).toBe(0);
  });

  it("ends with no body on 304 Not Modified", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream(
      { "content-type": "text/css" },
      304,
      "",
    );
    const { res, getBody } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(res.statusCode).toBe(304);
    expect(getBody().length).toBe(0);
  });

  it("ends with no body on 204 No Content", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream({}, 204, "");
    const { res, getBody } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(res.statusCode).toBe(204);
    expect(getBody().length).toBe(0);
  });
});

/* ------------------------------------------------------------------------ */
/*  Security headers survive on both paths (MEDIUM-1 invariant)              */
/* ------------------------------------------------------------------------ */

describe("MEDIUM-1 — anti-clickjacking headers on both paths", () => {
  it("sets X-Frame-Options=SAMEORIGIN + CSP frame-ancestors on the buffered (HTML) path", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream(
      { "content-type": "text/html" },
      200,
      "<html></html>",
    );
    const { res, headers } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["content-security-policy"]).toBe("frame-ancestors 'self'");
  });

  it("sets X-Frame-Options=SAMEORIGIN + CSP frame-ancestors on the streaming (non-HTML) path", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream(
      { "content-type": "application/json" },
      200,
      `{"ok":true}`,
    );
    const { res, headers } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["content-security-policy"]).toBe("frame-ancestors 'self'");
  });

  it("upstream X-Frame-Options DENY does NOT overwrite our SAMEORIGIN (buffered path)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream(
      { "content-type": "text/html", "x-frame-options": "DENY" },
      200,
      "<html></html>",
    );
    const { res, headers } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("upstream CSP frame-ancestors DENY does NOT overwrite our 'self' (streaming path)", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream(
      {
        "content-type": "application/json",
        "content-security-policy": "frame-ancestors 'none'",
      },
      200,
      `{"ok":true}`,
    );
    const { res, headers } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(headers["content-security-policy"]).toBe("frame-ancestors 'self'");
  });
});

/* ------------------------------------------------------------------------ */
/*  MEDIUM-2 — upstream Set-Cookie dropped on both paths                     */
/* ------------------------------------------------------------------------ */

describe("MEDIUM-2 — upstream Set-Cookie dropped", () => {
  it("does NOT forward upstream Set-Cookie on the buffered (HTML) path", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream(
      {
        "content-type": "text/html",
        "set-cookie": "app_session=xyz; Path=/",
      },
      200,
      "<html></html>",
    );
    const { res, headers } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(headers["set-cookie"]).toBeUndefined();
  });

  it("does NOT forward upstream Set-Cookie on the streaming (non-HTML) path", async () => {
    const { getOrCreateAppPaneProxyForTarget } = await import(
      "../app-pane-proxy-factory.js"
    );
    getOrCreateAppPaneProxyForTarget(makeTarget(), 12345, 5, "todo");
    const opts = lastOptions() as { on: { proxyRes: Function } };
    const proxyRes = makeProxyResStream(
      {
        "content-type": "application/json",
        "set-cookie": "app_session=xyz; Path=/",
      },
      200,
      `{"ok":true}`,
    );
    const { res, headers } = makeExpressRes();
    opts.on.proxyRes(proxyRes, makeExpressReq(), res);
    await flush();
    expect(headers["set-cookie"]).toBeUndefined();
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
    const { res } = makeExpressRes(false);
    opts.on.error(err, req, res);
    expect(mocks.classifyTunnelError).toHaveBeenCalledWith(err);
    expect(mocks.sshLogger.warn).toHaveBeenCalledTimes(1);
    const [, payload] = mocks.sshLogger.warn.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload.operation).toBe("apps_pane_proxy");
    const forbidden = ["stack", "cookie", "authorization", "userId", "req"];
    for (const k of forbidden) {
      expect(payload).not.toHaveProperty(k);
    }
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
    const { res } = makeExpressRes(true);
    opts.on.error(err, req, res);
    expect(mocks.writeInterstitial).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ */
/*  buildPaneMountPathRewrite — HIGH-2 dedicated coverage                    */
/* ------------------------------------------------------------------------ */

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
    expect(rewrite("/5/todo/pane/api/x?foo=bar&baz=qux")).toBe(
      "/api/x?foo=bar&baz=qux",
    );
  });

  it("passes through paths that don't match this middleware's (hostId, slug) tuple", async () => {
    const { buildPaneMountPathRewrite } = await import(
      "../app-pane-proxy-factory.js"
    );
    const rewrite = buildPaneMountPathRewrite(5, "todo");
    expect(rewrite("/6/todo/pane/api/list")).toBe("/6/todo/pane/api/list");
    expect(rewrite("/5/timer/pane/api/list")).toBe("/5/timer/pane/api/list");
    expect(rewrite("/5/todo/other/x")).toBe("/5/todo/other/x");
    expect(rewrite("5/todo/pane")).toBe("5/todo/pane");
  });

  it("does NOT match the pre-fix `/apps/...` shape (regression guard)", async () => {
    const { buildPaneMountPathRewrite } = await import(
      "../app-pane-proxy-factory.js"
    );
    const rewrite = buildPaneMountPathRewrite(5, "todo");
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
