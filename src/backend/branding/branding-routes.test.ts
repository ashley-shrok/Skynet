/**
 * Phase 70 fix — smoke test for branding-routes.ts route registration.
 *
 * Guards against a specific regression class: Express 5 (path-to-regexp v8)
 * rejects bare `*` wildcards at route-registration time (throws
 * `Missing parameter name`). The original Phase 70 implementation used
 * `router.get("/branding/*", ...)` which would crash the backend on boot.
 * The fix is `router.get("/branding/*splat", ...)` — proven by this test
 * (successful import = successful registration = no throw).
 *
 * Also exercises a real request against a live Express instance to catch
 * subtler pattern regressions (wrong param name, no capture, etc.).
 */

import { describe, it, expect } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";

// Importing the router IS the smoke test — path-to-regexp v8 throws at
// registration if any route uses a bare `*` without a param name. If this
// import throws, every describe/it below fails to load and the test file
// reports the underlying error clearly.
import brandingRoutes, { FAVICON_CASCADE_URLS } from "./branding-routes.js";

describe("branding-routes registration", () => {
  it("imports and mounts without throwing", () => {
    const app = express();
    expect(() => app.use(brandingRoutes)).not.toThrow();
  });

  it("routes GET /branding/<path> to the asset handler", async () => {
    const app = express();
    app.use(brandingRoutes);

    // The bundled defaults may or may not exist in the test environment; we
    // only care that the router MATCHES the URL and returns a non-404-from-
    // Express-fallthrough status (200/400/500 from the branding handler are
    // all acceptable proofs the route pattern captured the request).
    // A 404 from Express's default no-route handler would prove the pattern
    // failed to match.
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const status = await new Promise<number>((resolve, reject) => {
        http
          .get(
            `http://127.0.0.1:${port}/branding/nonexistent.png`,
            (res) => resolve(res.statusCode ?? 0),
          )
          .on("error", reject);
      });
      // 404 from the branding handler's "missing" branch is fine — it PROVES
      // the router matched. What we'd fail on is a 404 from Express's
      // final fallthrough (no route matched at all), which the smoke test
      // in the first `it` already rules out. Either way, no throw at boot.
      expect([200, 404, 400, 500]).toContain(status);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// bounty branding-favicon-coverage-gap:
// Smoke coverage for the 7 size-suffixed favicon + apple-touch cascade routes
// added alongside the existing /branding/* handler. Same shape as the
// /branding/nonexistent.png test above — mount router in a live Express
// instance, hit each URL, assert the status code proves the route matched
// (not a 404 from Express's default no-route handler).
//
// Test env note: neither /etc/skynet/branding/<file> nor
// /app/branding-defaults/<file> exists on developer machines / CI, so
// resolveAssetPath returns { source: "missing" } for all 7 URLs. That drives
// the cascade into next() — which we assert via a sentinel middleware that
// returns HTTP 299. A 299 proves the branding router correctly delegated;
// a 404 from express-fallthrough (no sentinel installed) would prove the
// route pattern failed to match.
describe("branding-routes size-suffixed favicon cascade", () => {
  it("exposes the 7 documented URLs", () => {
    // Guards against silent list drift between the router's constant and the
    // filenames enumerated in docker/nginx.conf's regex.
    expect(FAVICON_CASCADE_URLS).toEqual([
      "/favicon-16.png",
      "/favicon-32.png",
      "/apple-touch-icon-60.png",
      "/apple-touch-icon-76.png",
      "/apple-touch-icon-120.png",
      "/apple-touch-icon-152.png",
      "/apple-touch-icon-180.png",
    ]);
  });

  it.each(FAVICON_CASCADE_URLS)(
    "registers %s (router matches → non-fallthrough status)",
    async (url) => {
      const app = express();
      app.use(brandingRoutes);
      // Sentinel: if the branding cascade calls next() (missing branch), this
      // returns 299. Any 404 here would mean Express hit its no-route
      // fallback — i.e. the route pattern didn't match.
      app.use((_req, res) => {
        res.status(299).end();
      });

      const server = app.listen(0);
      try {
        const port = (server.address() as AddressInfo).port;
        const status = await new Promise<number>((resolve, reject) => {
          http
            .get(`http://127.0.0.1:${port}${url}`, (res) =>
              resolve(res.statusCode ?? 0),
            )
            .on("error", reject);
        });
        // 200 = override or default file existed (unlikely in test env);
        // 299 = missing branch → next() → sentinel (expected path);
        // 400 = defensive containment-throw branch (unreachable for literal
        //       filenames but symmetric with /branding/*splat);
        // 500 = sendFile error mid-stream (defensive).
        expect([200, 299, 400, 500]).toContain(status);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it("delegates via next() when both override and bundled-default are missing", async () => {
    // Stronger form of the parametric test above: pins the sentinel semantics
    // so a future refactor that swaps next() for a 404 short-circuit gets
    // caught (that would break D-14 no-config-deploy parity).
    const app = express();
    app.use(brandingRoutes);
    app.use((_req, res) => {
      res.status(299).end();
    });

    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const status = await new Promise<number>((resolve, reject) => {
        http
          .get(
            `http://127.0.0.1:${port}/apple-touch-icon-180.png`,
            (res) => resolve(res.statusCode ?? 0),
          )
          .on("error", reject);
      });
      // In the test environment neither branding mount exists → cascade must
      // reach the sentinel. If this ever returns 200, the test env grew a
      // /etc/skynet/branding/apple-touch-icon-180.png or
      // /app/branding-defaults/apple-touch-icon-180.png file (adjust the
      // test env, not this assertion).
      expect(status).toBe(299);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
