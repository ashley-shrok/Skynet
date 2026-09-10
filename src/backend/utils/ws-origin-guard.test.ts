import { describe, it, expect } from "vitest";
import {
  SERVE_SUBDOMAIN_ORIGIN_RE,
  isServeSubdomainOrigin,
  rejectServeSubdomain,
} from "./ws-origin-guard.js";

// Phase 103 Plan 06 — Origin-guard for WebSocketServer endpoints. Tests are
// the RED-gate; source lives at ./ws-origin-guard.ts. Behavior enumerated in
// the plan's Task 1 <behavior> block — each `it()` below maps 1:1 to a bullet.

describe("SERVE_SUBDOMAIN_ORIGIN_RE", () => {
  it("is a RegExp instance", () => {
    expect(SERVE_SUBDOMAIN_ORIGIN_RE).toBeInstanceOf(RegExp);
  });

  it("matches a real https serve-subdomain origin", () => {
    expect(
      SERVE_SUBDOMAIN_ORIGIN_RE.test("https://x-1.serve.term.example.com"),
    ).toBe(true);
  });
});

describe("isServeSubdomainOrigin", () => {
  it("returns true for https://foo-8080.serve.term.gigaashley.click", () => {
    expect(
      isServeSubdomainOrigin("https://foo-8080.serve.term.gigaashley.click"),
    ).toBe(true);
  });

  it("returns true for http:// scheme (dev/preview)", () => {
    expect(
      isServeSubdomainOrigin("http://foo-8080.serve.term.gigaashley.click"),
    ).toBe(true);
  });

  it("returns false for primary origin https://term.gigaashley.click", () => {
    expect(isServeSubdomainOrigin("https://term.gigaashley.click")).toBe(false);
  });

  it("returns false for sibling origin https://files.gigaashley.click", () => {
    expect(isServeSubdomainOrigin("https://files.gigaashley.click")).toBe(
      false,
    );
  });

  it("returns false for undefined origin (non-browser clients)", () => {
    expect(isServeSubdomainOrigin(undefined)).toBe(false);
  });

  it("returns false for empty-string origin", () => {
    expect(isServeSubdomainOrigin("")).toBe(false);
  });

  it("returns false for null origin", () => {
    expect(isServeSubdomainOrigin(null)).toBe(false);
  });

  it("returns false for bare serve.term.<domain> (no subdomain prefix)", () => {
    // Regex requires a subdomain segment BEFORE `.serve.term.`, so bare
    // is naturally excluded — Plan 01 redirects it away anyway; this is
    // extra safety.
    expect(isServeSubdomainOrigin("https://serve.term.gigaashley.click")).toBe(
      false,
    );
  });
});

describe("rejectServeSubdomain", () => {
  it("returns true when request Origin matches serve subdomain", () => {
    expect(
      rejectServeSubdomain({
        headers: { origin: "https://foo-8080.serve.term.gigaashley.click" },
      }),
    ).toBe(true);
  });

  it("returns false for a request with primary-domain Origin", () => {
    expect(
      rejectServeSubdomain({
        headers: { origin: "https://term.gigaashley.click" },
      }),
    ).toBe(false);
  });

  it("returns false for a request with no Origin header", () => {
    expect(rejectServeSubdomain({ headers: {} })).toBe(false);
  });

  it("returns false when Origin is an array (defensive — non-browser weirdness)", () => {
    expect(
      rejectServeSubdomain({
        headers: {
          origin: [
            "https://foo-8080.serve.term.gigaashley.click",
          ] as unknown as string,
        },
      }),
    ).toBe(false);
  });
});
