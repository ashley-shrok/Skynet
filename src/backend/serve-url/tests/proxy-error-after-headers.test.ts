/**
 * Regression: an upstream that resets AFTER the response headers have been
 * forwarded must not crash the backend.
 *
 * Live incident 2026-10-17: a serve URL to thenasty:9501 kept ECONNRESET-ing
 * mid-response. The proxy error handler only checked `writableEnded`, so it
 * called writeInterstitial → res.setHeader on a response whose headers were
 * already sent → ERR_HTTP_HEADERS_SENT thrown from an event-emitter callback
 * → uncaught exception → process exit (8 restarts in ~2h).
 *
 * Fix contract: when headers are already sent, the handler destroys the
 * client response (so the client sees a truncated body) instead of trying
 * to render the interstitial. When headers are NOT yet sent, the
 * interstitial still renders.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { getOrCreateProxyForTarget } from "../proxy-factory.js";
import type { ServeTarget } from "../types.js";
import type { Host } from "../../../types/index.js";

let upstream: http.Server;
let upstreamPort: number;
let proxyServer: http.Server;
let proxyPort: number;
const uncaught: unknown[] = [];
const onUncaught = (err: unknown) => {
  uncaught.push(err);
};

beforeAll(async () => {
  process.on("uncaughtException", onUncaught);

  upstream = http.createServer((req, res) => {
    if (req.url === "/reset-mid-body") {
      // Headers + a partial body go out, then the socket is torn down.
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("partial");
      setTimeout(() => req.socket.destroy(), 20);
      return;
    }
    if (req.url === "/reset-before-headers") {
      req.socket.destroy();
      return;
    }
    res.end("ok");
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
  upstreamPort = (upstream.address() as AddressInfo).port;

  const target: ServeTarget = {
    hostname: "reset-test",
    port: upstreamPort,
    host: { id: 1, name: "reset-test", ip: "127.0.0.1", port: 22 } as unknown as Host,
  } as ServeTarget;

  const app = express();
  app.use(getOrCreateProxyForTarget(target, upstreamPort));
  proxyServer = http.createServer(app);
  await new Promise<void>((r) => proxyServer.listen(0, "127.0.0.1", () => r()));
  proxyPort = (proxyServer.address() as AddressInfo).port;
});

afterAll(async () => {
  process.off("uncaughtException", onUncaught);
  await new Promise<void>((r) => proxyServer.close(() => r()));
  await new Promise<void>((r) => upstream.close(() => r()));
});

function get(path: string): Promise<{ status: number; body: string; aborted: boolean }> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: proxyPort, path }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, aborted: false }));
      res.on("error", () => resolve({ status: res.statusCode ?? 0, body, aborted: true }));
      res.on("aborted", () => resolve({ status: res.statusCode ?? 0, body, aborted: true }));
    });
    req.on("error", () => resolve({ status: 0, body: "", aborted: true }));
  });
}

describe("serve-url proxy error after headers sent", () => {
  it("destroys the client response instead of throwing ERR_HTTP_HEADERS_SENT", async () => {
    const res = await get("/reset-mid-body");
    // Give any stray emitter callbacks a tick to surface.
    await new Promise((r) => setTimeout(r, 50));

    expect(uncaught).toEqual([]);
    expect(res.status).toBe(200);
    expect(res.aborted).toBe(true);
    expect(res.body).toBe("partial");
  });

  it("still renders the interstitial when the upstream fails before headers", async () => {
    const res = await get("/reset-before-headers");
    await new Promise((r) => setTimeout(r, 50));

    expect(uncaught).toEqual([]);
    expect(res.aborted).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
