/**
 * Phase 103 Plan 04 — D-05 no-cookie-egress CI integration test.
 *
 * The belt of the belt-and-suspenders D-04 allowlist-strip enforcement
 * (Plan 03b's proxy-factory.ts is the strip itself; Plan 03b's
 * header-audit-sampler.ts is the runtime suspender; THIS test is the
 * merge-time belt). It stands up:
 *
 *   client HTTP/WS → real proxyApp (Express + getOrCreateProxyForTarget)
 *                  → 127.0.0.1:${echoPort}   ← real Node http.createServer that
 *                                              records every inbound header
 *
 * The "SSH tunnel" is bypassed: the proxy factory expects a tunnelPort and
 * pipes to `http://127.0.0.1:${tunnelPort}`. We hand it the echo server's
 * port directly, so the echo server IS the "upstream" from the proxy's
 * perspective. This isolates proxy-factory.ts's stripToAllowlist behavior
 * without pulling in ssh2 / tunnel-cache infrastructure.
 *
 * For each transport scenario, the client sends the three disallowed header
 * classes (Cookie, Authorization, X-Skynet-*) simultaneously and the test
 * asserts none of them appear in the echo-recorded inbound headers.
 *
 * D-05 enumeration (per 103-CONTEXT.md + 103-PATTERNS.md
 * §no-cookie-egress.integration.test.ts):
 *   - GET
 *   - POST (JSON body)
 *   - WebSocket upgrade
 *   - SSE (Accept: text/event-stream)
 *   - multipart/form-data upload
 *   - 302 redirect follow
 *
 * Plus two SANITY tests proving the strip is SELECTIVE (not wholesale):
 *   - Content-Type DOES pass through
 *   - Host header DOES pass through
 *
 * MUST pass to merge per D-05.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import WebSocket, { WebSocketServer } from "ws";
import { fetch } from "undici";
import { getOrCreateProxyForTarget } from "../proxy-factory.js";
import type { ServeTarget } from "../types.js";
import type { Host } from "../../../types/index.js";

// ---------------------------------------------------------------------------
// Shared recording arrays — reset per test in beforeEach
// ---------------------------------------------------------------------------

type HeaderRecord = Record<string, string | string[] | undefined>;

const recordedHeaders: HeaderRecord[] = [];
const recordedUpgradeHeaders: HeaderRecord[] = [];

// ---------------------------------------------------------------------------
// Servers + ports — assigned in beforeAll
// ---------------------------------------------------------------------------

let echoServer: http.Server;
let echoWss: WebSocketServer;
let echoPort: number;

let proxyServer: http.Server;
let proxyPort: number;

// The disallowed-header set the client sends on EVERY request.
const DISALLOWED_HEADERS = {
  Cookie: "skynet_session=abc123; other_cookie=xyz",
  Authorization: "Bearer test-token-should-be-stripped",
  "X-Skynet-User-Id": "999",
  "X-Skynet-Trace": "req-abc-123",
} as const;

// ---------------------------------------------------------------------------
// beforeAll: stand up echo upstream + proxy app
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // 1. Echo server — records every inbound request/upgrade's headers and
  // responds in a shape that matches the scenario (JSON, SSE stream,
  // redirect, WS upgrade acceptance).
  echoServer = http.createServer((req, res) => {
    recordedHeaders.push({ ...req.headers });

    const url = req.url ?? "/";
    const acceptHeader = req.headers.accept;
    const accept = Array.isArray(acceptHeader) ? acceptHeader[0] : acceptHeader;

    // Redirect scenario: /redirect-me → 302 to /redirected
    if (url === "/redirect-me") {
      res.writeHead(302, { Location: "/redirected" });
      res.end();
      return;
    }

    // SSE scenario: Accept: text/event-stream → stream response
    if (accept && accept.includes("text/event-stream")) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("data: hello\n\n");
      // Close immediately so the client's fetch promise settles fast.
      res.end();
      return;
    }

    // Default (GET / POST / multipart / redirected): 200 JSON
    // Consume body if present so POST / multipart complete cleanly.
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, url, bodyLength: body.length }));
    });
  });

  // WebSocket upgrade recording — record the upgrade headers to a separate
  // array, accept the upgrade so ws() completes cleanly, then close.
  echoWss = new WebSocketServer({ noServer: true });
  echoServer.on("upgrade", (req, socket, head) => {
    recordedUpgradeHeaders.push({ ...req.headers });
    echoWss.handleUpgrade(req, socket, head, (ws) => {
      ws.close();
    });
  });

  await new Promise<void>((resolve) => {
    echoServer.listen(0, "127.0.0.1", () => {
      echoPort = (echoServer.address() as AddressInfo).port;
      resolve();
    });
  });

  // 2. Proxy app — Express mounting getOrCreateProxyForTarget pointed at
  // the echo server directly (bypasses ssh tunnel-cache).
  const proxyApp = express();
  const fakeHost = {
    id: 1,
    name: "echo",
    ip: "127.0.0.1",
    port: 22,
    username: "test",
    folder: "",
    tags: [],
    pin: false,
    authType: "none",
    enableTerminal: true,
    enableTunnel: true,
    enableFileManager: false,
    enableDocker: false,
    showTerminalInSidebar: false,
    showFileManagerInSidebar: false,
    showTunnelInSidebar: false,
    showDockerInSidebar: false,
    showServerStatsInSidebar: false,
    defaultPath: "/",
    tunnelConnections: [],
  } as unknown as Host;

  const target: ServeTarget = {
    hostname: "echo",
    port: echoPort,
    host: fakeHost,
  };

  const middleware = getOrCreateProxyForTarget(target, echoPort);
  proxyApp.use(middleware);

  // 3. Start proxy server + wire WS upgrade to the middleware.
  proxyServer = http.createServer(proxyApp);
  // http-proxy-middleware attaches an .upgrade handler when ws:true.
  // Wire it to the server's upgrade event so WS requests get proxied.
  const proxyMiddleware = middleware as unknown as {
    upgrade: (req: http.IncomingMessage, socket: import("node:net").Socket, head: Buffer) => void;
  };
  if (typeof proxyMiddleware.upgrade === "function") {
    proxyServer.on("upgrade", (req, socket, head) => {
      proxyMiddleware.upgrade(req, socket as import("node:net").Socket, head);
    });
  }

  await new Promise<void>((resolve) => {
    proxyServer.listen(0, "127.0.0.1", () => {
      proxyPort = (proxyServer.address() as AddressInfo).port;
      resolve();
    });
  });
}, 20_000);

afterAll(async () => {
  await new Promise<void>((resolve) => {
    echoWss.close(() => resolve());
  });
  await new Promise<void>((resolve) => {
    echoServer.close(() => resolve());
  });
  await new Promise<void>((resolve) => {
    proxyServer.close(() => resolve());
  });
});

beforeEach(() => {
  recordedHeaders.length = 0;
  recordedUpgradeHeaders.length = 0;
});

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Assert that the given recorded-headers object contains NONE of the three
 * disallowed header classes:
 *   1. cookie
 *   2. authorization
 *   3. any header starting with x-skynet-
 */
function expectNoDisallowedHeaders(headers: HeaderRecord | undefined): void {
  expect(headers).toBeDefined();
  const h = headers as HeaderRecord;
  // Node lowercases inbound header names on req.headers.
  expect(h.cookie).toBeUndefined();
  expect(h.authorization).toBeUndefined();
  const xSkynetKeys = Object.keys(h).filter((k) =>
    k.toLowerCase().startsWith("x-skynet-"),
  );
  expect(xSkynetKeys).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// Negative transport scenarios — each MUST show no disallowed header
// egress across all three header classes.
// ---------------------------------------------------------------------------

describe("Phase 103 D-05 — no cookie / authorization / x-skynet-* egress", () => {
  it("GET: strips Cookie + Authorization + X-Skynet-* headers", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/get-target`, {
      method: "GET",
      headers: DISALLOWED_HEADERS,
    });
    expect(res.status).toBe(200);
    // Drain body so the connection releases before we assert.
    await res.text();
    expect(recordedHeaders.length).toBeGreaterThanOrEqual(1);
    expectNoDisallowedHeaders(recordedHeaders[0]);
  });

  it("POST JSON: strips Cookie + Authorization + X-Skynet-* headers", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/post-json`, {
      method: "POST",
      headers: {
        ...DISALLOWED_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ping: 1 }),
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(recordedHeaders.length).toBeGreaterThanOrEqual(1);
    expectNoDisallowedHeaders(recordedHeaders[0]);
  });

  it("WebSocket upgrade: strips Cookie + Authorization + X-Skynet-* headers", async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/ws-target`, {
        headers: DISALLOWED_HEADERS as Record<string, string>,
      });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error("WS test timeout"));
      }, 5_000);
      ws.on("open", () => {
        // Give the server a tick to record the upgrade headers before we
        // close. handleUpgrade → ws.close() runs synchronously but the
        // event-loop turn matters.
        setImmediate(() => {
          ws.close();
        });
      });
      ws.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        // WS closed uncleanly is fine for this test — we only care that
        // the upgrade headers reached the echo server without the
        // disallowed set.
        if (recordedUpgradeHeaders.length > 0) {
          resolve();
        } else {
          reject(err);
        }
      });
    });
    expect(recordedUpgradeHeaders.length).toBeGreaterThanOrEqual(1);
    expectNoDisallowedHeaders(recordedUpgradeHeaders[0]);
  });

  it("SSE (Accept: text/event-stream): strips Cookie + Authorization + X-Skynet-* headers", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/sse-target`, {
      method: "GET",
      headers: {
        ...DISALLOWED_HEADERS,
        Accept: "text/event-stream",
      },
    });
    expect(res.status).toBe(200);
    // Drain the SSE body (server closes after one event).
    if (res.body) {
      const reader = res.body.getReader();
      // Read until done — server has already ended the stream.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
    expect(recordedHeaders.length).toBeGreaterThanOrEqual(1);
    expectNoDisallowedHeaders(recordedHeaders[0]);
  });

  it("multipart/form-data upload: strips Cookie + Authorization + X-Skynet-* headers", async () => {
    const form = new FormData();
    form.append("field1", "value1");
    form.append(
      "file",
      new Blob([Buffer.from("hello world")], { type: "application/octet-stream" }),
      "hello.txt",
    );
    const res = await fetch(`http://127.0.0.1:${proxyPort}/multipart-target`, {
      method: "POST",
      headers: DISALLOWED_HEADERS,
      body: form,
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(recordedHeaders.length).toBeGreaterThanOrEqual(1);
    expectNoDisallowedHeaders(recordedHeaders[0]);
  });

  it("302 redirect follow: strips Cookie + Authorization + X-Skynet-* headers on BOTH the initial and followed request", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/redirect-me`, {
      method: "GET",
      headers: DISALLOWED_HEADERS,
      redirect: "follow",
    });
    expect(res.status).toBe(200);
    await res.text();
    // We should have recorded TWO inbound requests on the echo server:
    // the /redirect-me GET and the /redirected GET.
    expect(recordedHeaders.length).toBeGreaterThanOrEqual(2);
    expectNoDisallowedHeaders(recordedHeaders[0]);
    expectNoDisallowedHeaders(recordedHeaders[1]);
  });

  // -------------------------------------------------------------------------
  // Sanity tests — prove the strip is SELECTIVE (not wholesale). Content-Type
  // and Host are IN the allowlist and MUST pass through, otherwise the strip
  // would be silently breaking every real request while trivially passing
  // the negative tests above.
  // -------------------------------------------------------------------------

  it("SANITY: Content-Type passes through the allowlist strip", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/sanity-content-type`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(recordedHeaders.length).toBeGreaterThanOrEqual(1);
    const h = recordedHeaders[0] as HeaderRecord;
    const contentType = h["content-type"];
    expect(contentType).toBeDefined();
    expect(String(contentType)).toContain("application/json");
  });

  it("SANITY: Host header passes through the allowlist strip", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/sanity-host`, {
      method: "GET",
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(recordedHeaders.length).toBeGreaterThanOrEqual(1);
    const h = recordedHeaders[0] as HeaderRecord;
    // proxy-factory uses changeOrigin:true so Host is rewritten to the
    // target's origin (127.0.0.1:${echoPort}) rather than the client's
    // 127.0.0.1:${proxyPort}. Either way the Host header MUST be present.
    expect(h.host).toBeDefined();
  });
});
