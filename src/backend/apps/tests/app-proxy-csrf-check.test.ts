/**
 * Phase 120 Plan 01 Task 1 — Unit tests for appProxyCsrfCheck.
 *
 * Verifies (D-13):
 *  - GET/HEAD/OPTIONS bypass the Origin check (no Origin required).
 *  - POST/PUT/PATCH/DELETE with an Origin exactly matching the primary
 *    origin are accepted.
 *  - POST/PUT/PATCH/DELETE with a missing Origin are refused
 *    (browsers always send Origin on cross-origin state-changing requests;
 *    missing Origin is anomalous → safer to refuse).
 *  - POST/PUT/PATCH/DELETE with an empty-string Origin are refused.
 *  - POST/PUT/PATCH/DELETE with a mismatched Origin are refused.
 *  - Method casing is normalized (uppercase before check).
 *  - Module load THROWS if SKYNET_COOKIE_DOMAIN env var is unset (fail-loud per W4).
 *  - Module load returns SKYNET_COOKIE_DOMAIN verbatim as PRIMARY_DOMAIN when set.
 *
 * Pattern mirror: src/backend/serve-url/tests/serve-route.test.ts
 * (vi.hoisted + minimal fake-Request, no supertest, no Express app).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request } from "express";

function makeReq(method: string, origin?: string): Request {
  const headers = origin !== undefined ? { origin } : {};
  return {
    method,
    headers,
  } as unknown as Request;
}

const PRIMARY_ORIGIN = "https://skynet.test";

describe("appProxyCsrfCheck", () => {
  // Ensure the module-load IIFE has a valid env var so dynamic imports below
  // succeed. Each dynamic import re-reads the cached module unless
  // vi.resetModules() has been called (which the "module load" describe does).
  beforeEach(() => {
    if (process.env.SKYNET_COOKIE_DOMAIN === undefined) {
      process.env.SKYNET_COOKIE_DOMAIN = PRIMARY_ORIGIN;
    }
  });

  describe("safe methods (GET/HEAD/OPTIONS bypass Origin check)", () => {
    it("returns true for GET with no Origin header", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("GET"), PRIMARY_ORIGIN)).toBe(true);
    });

    it("returns true for HEAD with no Origin header", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("HEAD"), PRIMARY_ORIGIN)).toBe(true);
    });

    it("returns true for OPTIONS with no Origin header (RFC 9110 §9.2.1 idempotent+safe)", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("OPTIONS"), PRIMARY_ORIGIN)).toBe(true);
    });

    it("returns true for GET even with a mismatched Origin (safe method → no check)", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("GET", "https://evil.example"), PRIMARY_ORIGIN),
      ).toBe(true);
    });
  });

  describe("state-changing methods (POST/PUT/PATCH/DELETE require matching Origin)", () => {
    it("returns true for POST with matching Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("POST", PRIMARY_ORIGIN), PRIMARY_ORIGIN),
      ).toBe(true);
    });

    it("returns false for POST with missing Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("POST"), PRIMARY_ORIGIN)).toBe(false);
    });

    it("returns false for POST with empty-string Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("POST", ""), PRIMARY_ORIGIN)).toBe(false);
    });

    it("returns false for POST with mismatched Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("POST", "https://evil.example"), PRIMARY_ORIGIN),
      ).toBe(false);
    });

    it("returns true for PUT with matching Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("PUT", PRIMARY_ORIGIN), PRIMARY_ORIGIN),
      ).toBe(true);
    });

    it("returns false for PUT with missing Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("PUT"), PRIMARY_ORIGIN)).toBe(false);
    });

    it("returns false for PUT with mismatched Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("PUT", "https://evil.example"), PRIMARY_ORIGIN),
      ).toBe(false);
    });

    it("returns true for PATCH with matching Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("PATCH", PRIMARY_ORIGIN), PRIMARY_ORIGIN),
      ).toBe(true);
    });

    it("returns false for PATCH with missing Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("PATCH"), PRIMARY_ORIGIN)).toBe(false);
    });

    it("returns false for PATCH with mismatched Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("PATCH", "https://evil.example"), PRIMARY_ORIGIN),
      ).toBe(false);
    });

    it("returns true for DELETE with matching Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("DELETE", PRIMARY_ORIGIN), PRIMARY_ORIGIN),
      ).toBe(true);
    });

    it("returns false for DELETE with missing Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("DELETE"), PRIMARY_ORIGIN)).toBe(false);
    });

    it("returns false for DELETE with mismatched Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("DELETE", "https://evil.example"), PRIMARY_ORIGIN),
      ).toBe(false);
    });
  });

  describe("method casing (normalized to uppercase before check)", () => {
    it("returns true for lowercase 'post' with matching Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("post", PRIMARY_ORIGIN), PRIMARY_ORIGIN),
      ).toBe(true);
    });

    it("returns false for lowercase 'post' with missing Origin (still state-changing)", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("post"), PRIMARY_ORIGIN)).toBe(false);
    });

    it("returns true for lowercase 'get' with no Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("get"), PRIMARY_ORIGIN)).toBe(true);
    });

    it("returns true for mixed-case 'Delete' with matching Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("Delete", PRIMARY_ORIGIN), PRIMARY_ORIGIN),
      ).toBe(true);
    });
  });
});

describe("module load (PRIMARY_DOMAIN IIFE — fail-loud per W4)", () => {
  const ORIGINAL_ENV = process.env.SKYNET_COOKIE_DOMAIN;

  beforeEach(() => {
    // Fresh module cache per test so the IIFE runs anew.
    // Vitest module cache is per-worker; resetModules purges it.
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.SKYNET_COOKIE_DOMAIN;
    } else {
      process.env.SKYNET_COOKIE_DOMAIN = ORIGINAL_ENV;
    }
    // Purge the cached module so the next test's dynamic import re-runs the IIFE.
    // (Imported dynamically inside vi.resetModules-aware code path.)
  });

  it("THROWS at module load when SKYNET_COOKIE_DOMAIN is unset", async () => {
    vi.resetModules();
    delete process.env.SKYNET_COOKIE_DOMAIN;
    await expect(async () => {
      await import("../app-proxy-csrf-check.js");
    }).rejects.toThrow(/SKYNET_COOKIE_DOMAIN/);
  });

  it("exports PRIMARY_DOMAIN as the SKYNET_COOKIE_DOMAIN env value verbatim when set", async () => {
    vi.resetModules();
    process.env.SKYNET_COOKIE_DOMAIN = "https://skynet.test";
    const mod = await import("../app-proxy-csrf-check.js");
    expect(mod.PRIMARY_DOMAIN).toBe("https://skynet.test");
  });
});
