/**
 * Phase 120 Plan 01 Task 1 — Unit tests for appProxyCsrfCheck.
 *
 * Verifies (D-13):
 *  - GET/HEAD/OPTIONS bypass the Origin check (no Origin required).
 *  - POST/PUT/PATCH/DELETE with an Origin whose hostname matches the
 *    primary hostname are accepted.
 *  - POST/PUT/PATCH/DELETE with a missing Origin are refused
 *    (browsers always send Origin on cross-origin state-changing requests;
 *    missing Origin is anomalous → safer to refuse).
 *  - POST/PUT/PATCH/DELETE with an empty-string Origin are refused.
 *  - POST/PUT/PATCH/DELETE with a mismatched Origin.hostname are refused.
 *  - POST/PUT/PATCH/DELETE with a malformed Origin (non-URL) are refused.
 *  - Method casing is normalized (uppercase before check).
 *  - Module load THROWS if SKYNET_COOKIE_DOMAIN env var is unset (fail-loud per W4).
 *  - Module load normalizes SKYNET_COOKIE_DOMAIN to a bare hostname whether
 *    the env value is bare-hostname or URL-shaped (HIGH-1 fix, 2026-09-19).
 *
 * HIGH-1 fix regression coverage: the pre-fix implementation compared the
 * full Origin URL against the raw env value, so a production config with
 * `SKYNET_COOKIE_DOMAIN=term.example.com` (bare, per auth-manager.ts:713)
 * would 403 every state-changing request from a browser that sends
 * `Origin: https://term.example.com`. New bare-hostname tests below fail
 * against the pre-fix code and pass against the post-fix code.
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

// Test config: URL-shaped env var (backward-compatible path — the module
// normalizes to hostname). Origin header comparisons therefore use the
// hostname portion of this URL, which is what a browser would send in the
// Origin header itself.
const PRIMARY_ORIGIN = "https://skynet.test";
const PRIMARY_HOSTNAME = "skynet.test";

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
      expect(mod.appProxyCsrfCheck(makeReq("GET"), PRIMARY_HOSTNAME)).toBe(true);
    });

    it("returns true for HEAD with no Origin header", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("HEAD"), PRIMARY_HOSTNAME)).toBe(true);
    });

    it("returns true for OPTIONS with no Origin header (RFC 9110 §9.2.1 idempotent+safe)", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("OPTIONS"), PRIMARY_HOSTNAME)).toBe(true);
    });

    it("returns true for GET even with a mismatched Origin (safe method → no check)", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("GET", "https://evil.example"), PRIMARY_HOSTNAME),
      ).toBe(true);
    });
  });

  describe("state-changing methods (POST/PUT/PATCH/DELETE require matching Origin)", () => {
    it("returns true for POST with matching Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("POST", PRIMARY_ORIGIN), PRIMARY_HOSTNAME),
      ).toBe(true);
    });

    it("returns false for POST with missing Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("POST"), PRIMARY_HOSTNAME)).toBe(false);
    });

    it("returns false for POST with empty-string Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("POST", ""), PRIMARY_HOSTNAME)).toBe(false);
    });

    it("returns false for POST with mismatched Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("POST", "https://evil.example"), PRIMARY_HOSTNAME),
      ).toBe(false);
    });

    it("returns true for PUT with matching Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("PUT", PRIMARY_ORIGIN), PRIMARY_HOSTNAME),
      ).toBe(true);
    });

    it("returns false for PUT with missing Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("PUT"), PRIMARY_HOSTNAME)).toBe(false);
    });

    it("returns false for PUT with mismatched Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("PUT", "https://evil.example"), PRIMARY_HOSTNAME),
      ).toBe(false);
    });

    it("returns true for PATCH with matching Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("PATCH", PRIMARY_ORIGIN), PRIMARY_HOSTNAME),
      ).toBe(true);
    });

    it("returns false for PATCH with missing Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("PATCH"), PRIMARY_HOSTNAME)).toBe(false);
    });

    it("returns false for PATCH with mismatched Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("PATCH", "https://evil.example"), PRIMARY_HOSTNAME),
      ).toBe(false);
    });

    it("returns true for DELETE with matching Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("DELETE", PRIMARY_ORIGIN), PRIMARY_HOSTNAME),
      ).toBe(true);
    });

    it("returns false for DELETE with missing Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("DELETE"), PRIMARY_HOSTNAME)).toBe(false);
    });

    it("returns false for DELETE with mismatched Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("DELETE", "https://evil.example"), PRIMARY_HOSTNAME),
      ).toBe(false);
    });
  });

  describe("Origin: \"null\" from pane iframe (referrerPolicy=no-referrer form POST)", () => {
    // See module header § Origin: "null" for the security argument. Browsers
    // serialize origin as the literal string "null" on form-action navigations
    // from an iframe with referrerPolicy="no-referrer" (per Fetch spec §3.5).
    // The pane iframe deliberately sets that policy per D-20; refusing this
    // would break every scaffolded app that uses raw form-action POSTs.
    it("returns true for POST with Origin: \"null\" (pane iframe form nav)", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("POST", "null"), PRIMARY_HOSTNAME)).toBe(true);
    });

    it("returns true for PUT with Origin: \"null\"", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("PUT", "null"), PRIMARY_HOSTNAME)).toBe(true);
    });

    it("returns true for PATCH with Origin: \"null\"", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("PATCH", "null"), PRIMARY_HOSTNAME)).toBe(true);
    });

    it("returns true for DELETE with Origin: \"null\"", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("DELETE", "null"), PRIMARY_HOSTNAME)).toBe(true);
    });

    it("still refuses missing Origin (distinct from the string \"null\")", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("POST"), PRIMARY_HOSTNAME)).toBe(false);
    });

    it("still refuses empty-string Origin (distinct from the string \"null\")", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("POST", ""), PRIMARY_HOSTNAME)).toBe(false);
    });
  });

  describe("method casing (normalized to uppercase before check)", () => {
    it("returns true for lowercase 'post' with matching Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("post", PRIMARY_ORIGIN), PRIMARY_HOSTNAME),
      ).toBe(true);
    });

    it("returns false for lowercase 'post' with missing Origin (still state-changing)", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("post"), PRIMARY_HOSTNAME)).toBe(false);
    });

    it("returns true for lowercase 'get' with no Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(mod.appProxyCsrfCheck(makeReq("get"), PRIMARY_HOSTNAME)).toBe(true);
    });

    it("returns true for mixed-case 'Delete' with matching Origin", async () => {
      const mod = await import("../app-proxy-csrf-check.js");
      expect(
        mod.appProxyCsrfCheck(makeReq("Delete", PRIMARY_ORIGIN), PRIMARY_HOSTNAME),
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

  it("normalizes URL-shaped SKYNET_COOKIE_DOMAIN to hostname (HIGH-1)", async () => {
    vi.resetModules();
    process.env.SKYNET_COOKIE_DOMAIN = "https://skynet.test";
    const mod = await import("../app-proxy-csrf-check.js");
    // Post-fix: PRIMARY_DOMAIN is the hostname regardless of whether the env
    // value was bare-hostname or URL-shaped (HIGH-1 code-review fix,
    // 2026-09-19). Pre-fix this returned the URL verbatim.
    expect(mod.PRIMARY_DOMAIN).toBe("skynet.test");
  });

  it("passes bare-hostname SKYNET_COOKIE_DOMAIN through unchanged (HIGH-1)", async () => {
    vi.resetModules();
    process.env.SKYNET_COOKIE_DOMAIN = "term.example.com";
    const mod = await import("../app-proxy-csrf-check.js");
    expect(mod.PRIMARY_DOMAIN).toBe("term.example.com");
  });
});

/**
 * HIGH-1 regression coverage — production-shape env + browser-shape Origin.
 *
 * Pre-fix: `SKYNET_COOKIE_DOMAIN=term.example.com` (bare hostname, per
 * auth-manager.ts:713) + `Origin: https://term.example.com` (browser shape)
 * compared unequal via strict string equality → every real state-changing
 * request 403'd in production. Test fails pre-fix, passes post-fix.
 */
describe("HIGH-1 — production-shape config + browser-shape Origin", () => {
  const ORIGINAL_ENV = process.env.SKYNET_COOKIE_DOMAIN;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.SKYNET_COOKIE_DOMAIN;
    } else {
      process.env.SKYNET_COOKIE_DOMAIN = ORIGINAL_ENV;
    }
  });

  it("accepts POST with browser Origin matching bare-hostname config", async () => {
    vi.resetModules();
    process.env.SKYNET_COOKIE_DOMAIN = "term.example.com";
    const mod = await import("../app-proxy-csrf-check.js");
    // A real browser sends Origin as `scheme://host[:port]`. The check must
    // compare the *hostname* against PRIMARY_DOMAIN (the normalized bare
    // hostname), not the raw URL string. Pre-fix this returned false.
    expect(
      mod.appProxyCsrfCheck(
        makeReq("POST", "https://term.example.com"),
        mod.PRIMARY_DOMAIN,
      ),
    ).toBe(true);
  });

  it("accepts POST with port-carrying browser Origin against bare-hostname config", async () => {
    vi.resetModules();
    process.env.SKYNET_COOKIE_DOMAIN = "term.example.com";
    const mod = await import("../app-proxy-csrf-check.js");
    // Origin may carry an explicit port (dev / non-standard scheme). The
    // hostname portion must still match.
    expect(
      mod.appProxyCsrfCheck(
        makeReq("POST", "https://term.example.com:8443"),
        mod.PRIMARY_DOMAIN,
      ),
    ).toBe(true);
  });

  it("rejects POST with different hostname on same TLD", async () => {
    vi.resetModules();
    process.env.SKYNET_COOKIE_DOMAIN = "term.example.com";
    const mod = await import("../app-proxy-csrf-check.js");
    expect(
      mod.appProxyCsrfCheck(
        makeReq("POST", "https://evil.example.com"),
        mod.PRIMARY_DOMAIN,
      ),
    ).toBe(false);
  });

  it("rejects POST with malformed (non-URL) Origin header", async () => {
    vi.resetModules();
    process.env.SKYNET_COOKIE_DOMAIN = "term.example.com";
    const mod = await import("../app-proxy-csrf-check.js");
    expect(
      mod.appProxyCsrfCheck(
        makeReq("POST", "not a url at all"),
        mod.PRIMARY_DOMAIN,
      ),
    ).toBe(false);
  });
});
