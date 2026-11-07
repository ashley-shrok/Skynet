/**
 * Unit tests for the app pane CSRF check (D-13).
 *
 * Verifies:
 *  - GET/HEAD/OPTIONS bypass the check (no Origin required).
 *  - POST/PUT/PATCH/DELETE pass when the Origin hostname equals the
 *    request's own Host hostname — on any address, with no config
 *    (2026-11-07: an instance on two addresses with a parent cookie domain
 *    refused every pane save under the old cookie-domain comparison).
 *  - Origin "null" (pane iframe form navigations) passes.
 *  - Missing/empty/malformed Origin, missing/malformed Host, and a
 *    different hostname (other sites, serve-URL pages) are refused, with
 *    the refusal reason and both hostnames reported for logging.
 *  - Module load THROWS if SKYNET_COOKIE_DOMAIN is unset (fail-loud per W4)
 *    and normalizes it to a bare hostname.
 *
 * Pattern mirror: src/backend/serve-url/tests/serve-route.test.ts
 * (vi.hoisted + minimal fake-Request, no supertest, no Express app).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request } from "express";

const APP_HOST = "skynet.test";

function makeReq(method: string, origin?: string, host: string | null = APP_HOST): Request {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers.origin = origin;
  if (host !== null) headers.host = host;
  return { method, headers } as unknown as Request;
}

async function load() {
  return import("../app-proxy-csrf-check.js");
}

describe("appProxyCsrfCheck", () => {
  beforeEach(() => {
    if (process.env.SKYNET_COOKIE_DOMAIN === undefined) {
      process.env.SKYNET_COOKIE_DOMAIN = "https://skynet.test";
    }
  });

  describe("safe methods bypass the check", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      it(`passes ${method} with no Origin`, async () => {
        const mod = await load();
        expect(mod.appProxyCsrfCheck(makeReq(method)).ok).toBe(true);
      });
    }

    it("passes GET even with a foreign Origin", async () => {
      const mod = await load();
      expect(mod.appProxyCsrfCheck(makeReq("GET", "https://evil.example")).ok).toBe(true);
    });
  });

  describe("state-changing methods require Origin hostname === Host hostname", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post", "Delete"]) {
      it(`passes ${method} from the same address`, async () => {
        const mod = await load();
        expect(mod.appProxyCsrfCheck(makeReq(method, "https://skynet.test")).ok).toBe(true);
      });

      it(`refuses ${method} with a missing Origin`, async () => {
        const mod = await load();
        expect(mod.appProxyCsrfCheck(makeReq(method))).toMatchObject({
          ok: false,
          reason: "missing_origin",
        });
      });

      it(`refuses ${method} from a foreign site`, async () => {
        const mod = await load();
        expect(mod.appProxyCsrfCheck(makeReq(method, "https://evil.example"))).toEqual({
          ok: false,
          reason: "origin_host_mismatch",
          originHost: "evil.example",
          requestHost: "skynet.test",
        });
      });
    }
  });

  describe("instance reached at several addresses (parent cookie domain)", () => {
    // Shape of the 2026-11-07 report: SKYNET_COOKIE_DOMAIN=aithercloud.com,
    // app served at skynet.aithercloud.com and ai.aithercloud.com.
    beforeEach(() => {
      vi.resetModules();
      process.env.SKYNET_COOKIE_DOMAIN = "aithercloud.com";
    });

    afterEach(() => {
      vi.resetModules();
      process.env.SKYNET_COOKIE_DOMAIN = "https://skynet.test";
    });

    it("passes a POST from the first address", async () => {
      const mod = await load();
      const req = makeReq("POST", "https://skynet.aithercloud.com", "skynet.aithercloud.com");
      expect(mod.appProxyCsrfCheck(req).ok).toBe(true);
    });

    it("passes a POST from the second address", async () => {
      const mod = await load();
      const req = makeReq("POST", "https://ai.aithercloud.com", "ai.aithercloud.com");
      expect(mod.appProxyCsrfCheck(req).ok).toBe(true);
    });

    it("refuses a POST from one address into the other", async () => {
      const mod = await load();
      const req = makeReq("POST", "https://ai.aithercloud.com", "skynet.aithercloud.com");
      expect(mod.appProxyCsrfCheck(req)).toMatchObject({ ok: false, reason: "origin_host_mismatch" });
    });

    it("refuses a POST from a serve-URL page under the same parent domain", async () => {
      const mod = await load();
      const req = makeReq(
        "POST",
        "https://1-9507.serve.skynet.aithercloud.com",
        "skynet.aithercloud.com",
      );
      expect(mod.appProxyCsrfCheck(req)).toEqual({
        ok: false,
        reason: "origin_host_mismatch",
        originHost: "1-9507.serve.skynet.aithercloud.com",
        requestHost: "skynet.aithercloud.com",
      });
    });

    it("refuses a POST from the bare parent domain", async () => {
      const mod = await load();
      const req = makeReq("POST", "https://aithercloud.com", "skynet.aithercloud.com");
      expect(mod.appProxyCsrfCheck(req).ok).toBe(false);
    });
  });

  describe("Origin: \"null\" from the pane iframe (referrerPolicy=no-referrer form POST)", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      it(`passes ${method} with Origin "null"`, async () => {
        const mod = await load();
        expect(mod.appProxyCsrfCheck(makeReq(method, "null")).ok).toBe(true);
      });
    }

    it("still refuses an empty-string Origin", async () => {
      const mod = await load();
      expect(mod.appProxyCsrfCheck(makeReq("POST", ""))).toMatchObject({
        ok: false,
        reason: "missing_origin",
      });
    });
  });

  describe("header shapes", () => {
    it("ignores ports on both sides", async () => {
      const mod = await load();
      expect(mod.appProxyCsrfCheck(makeReq("POST", "https://skynet.test:8443", "skynet.test")).ok).toBe(true);
      expect(mod.appProxyCsrfCheck(makeReq("POST", "https://skynet.test", "skynet.test:443")).ok).toBe(true);
    });

    it("compares hostnames case-insensitively", async () => {
      const mod = await load();
      expect(mod.appProxyCsrfCheck(makeReq("POST", "https://Skynet.Test", "SKYNET.test")).ok).toBe(true);
    });

    it("handles bracketed IPv6 hosts", async () => {
      const mod = await load();
      expect(mod.appProxyCsrfCheck(makeReq("POST", "http://[::1]:5173", "[::1]:5173")).ok).toBe(true);
    });

    it("refuses a malformed Origin", async () => {
      const mod = await load();
      expect(mod.appProxyCsrfCheck(makeReq("POST", "not a url"))).toMatchObject({
        ok: false,
        reason: "malformed_origin",
      });
    });

    it("refuses a missing Host", async () => {
      const mod = await load();
      expect(mod.appProxyCsrfCheck(makeReq("POST", "https://skynet.test", null))).toEqual({
        ok: false,
        reason: "missing_host",
        originHost: "skynet.test",
        requestHost: null,
      });
    });

    it("refuses a malformed Host", async () => {
      const mod = await load();
      expect(mod.appProxyCsrfCheck(makeReq("POST", "https://skynet.test", "bad host/x"))).toMatchObject({
        ok: false,
        reason: "malformed_host",
      });
    });
  });
});

describe("checkSameOrigin (WebSocket upgrade path — no method gate)", () => {
  it("passes a matching Origin and Host", async () => {
    const mod = await load();
    expect(mod.checkSameOrigin({ origin: "https://skynet.test", host: "skynet.test" }).ok).toBe(true);
  });

  it("passes Origin \"null\"", async () => {
    const mod = await load();
    expect(mod.checkSameOrigin({ origin: "null", host: "skynet.test" }).ok).toBe(true);
  });

  it("refuses a missing Origin even though upgrades are GETs", async () => {
    const mod = await load();
    expect(mod.checkSameOrigin({ host: "skynet.test" })).toMatchObject({
      ok: false,
      reason: "missing_origin",
    });
  });

  it("refuses an array-valued Origin", async () => {
    const mod = await load();
    const headers = { origin: ["https://skynet.test"], host: "skynet.test" } as unknown as Record<string, string>;
    expect(mod.checkSameOrigin(headers).ok).toBe(false);
  });
});

describe("serve-URL traffic is refused even when Origin === Host", () => {
  // The session cookie reaches serve-URL hostnames, and WS upgrades are
  // dispatched by path alone — a serve page calling the pane path on its
  // own hostname has Origin === Host and a valid session.
  const SERVE = "1-9507.serve.skynet.test";

  it("refuses a serve-URL Host", async () => {
    const mod = await load();
    expect(mod.checkSameOrigin({ origin: `https://${SERVE}`, host: SERVE })).toEqual({
      ok: false,
      reason: "serve_host",
      originHost: null,
      requestHost: SERVE,
    });
  });

  it("refuses a serve-URL Host with a port", async () => {
    const mod = await load();
    expect(mod.checkSameOrigin({ origin: `https://${SERVE}`, host: `${SERVE}:443` })).toMatchObject({
      ok: false,
      reason: "serve_host",
    });
  });

  it("refuses when the edge marked the request as serve traffic", async () => {
    const mod = await load();
    expect(
      mod.checkSameOrigin({
        origin: "https://skynet.test",
        host: "skynet.test",
        "x-skynet-serve-subdomain": SERVE,
      }),
    ).toMatchObject({ ok: false, reason: "serve_host" });
  });

  it("refuses serve traffic even with Origin \"null\"", async () => {
    const mod = await load();
    expect(mod.checkSameOrigin({ origin: "null", host: SERVE }).ok).toBe(false);
  });

  it("refuses a state-changing HTTP request from serve traffic", async () => {
    const mod = await load();
    expect(mod.appProxyCsrfCheck(makeReq("POST", `https://${SERVE}`, SERVE))).toMatchObject({
      ok: false,
      reason: "serve_host",
    });
  });

  it("does not treat a hostname merely containing 'serve' as serve traffic", async () => {
    const mod = await load();
    const req = makeReq("POST", "https://serve.skynet.test", "serve.skynet.test");
    expect(mod.appProxyCsrfCheck(req).ok).toBe(true);
  });
});

describe("Host header parsing", () => {
  for (const host of ["skynet.test/x", "x@skynet.test", "skynet.test?x", "skynet.test#x", "skynet.test\\x", "skynet .test"]) {
    it(`refuses a URL-structural Host (${JSON.stringify(host)})`, async () => {
      const mod = await load();
      expect(mod.checkSameOrigin({ origin: "https://skynet.test", host })).toMatchObject({
        ok: false,
        reason: "malformed_host",
      });
    });
  }

  it("caps logged hostnames at 253 characters", async () => {
    const mod = await load();
    const long = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(60)}.test`;
    const res = mod.checkSameOrigin({ origin: `https://${long}`, host: "skynet.test" });
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.originHost?.length).toBe(253);
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
