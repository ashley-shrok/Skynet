/**
 * Bounty 260910-pf4-serve-url-login-return-honor-make-skynet — Unit tests.
 *
 * Verifies:
 *  - parseReturnFromSearch: parse & normalize the ?return= query param
 *  - validateReturnUrl: accept same-parent-domain HTTPS URLs; reject
 *    cross-domain, non-https, credential-injected, malformed, and
 *    parentDomain-poison inputs.
 *
 * Origin: 103-10-SUMMARY.md GAP 4 — subdomain-dispatch appends
 *   ?return=<encoded> when it 302-redirects unauthenticated traffic to
 *   /login. The frontend was ignoring it; after login users land on app
 *   root instead of the serve URL they intended. This module closes that gap.
 *
 * Security invariant tested here:
 *   Leading-dot suffix rule: reject "eviltermexample.com" which plain
 *   endsWith("termexample.com") but is NOT ".termexample.com".
 */

import { describe, it, expect } from "vitest";
import { parseReturnFromSearch, validateReturnUrl } from "./return-url";

const PARENT = "term.example.com";

// ---------------------------------------------------------------------------
// parseReturnFromSearch
// ---------------------------------------------------------------------------
describe("parseReturnFromSearch", () => {
  it("T1 empty string → null", () => {
    expect(parseReturnFromSearch("")).toBeNull();
  });

  it("T2 '?return=' (empty value) → null", () => {
    expect(parseReturnFromSearch("?return=")).toBeNull();
  });

  it("T3 '?return=%20%20' (whitespace-only after decode) → null", () => {
    expect(parseReturnFromSearch("?return=%20%20")).toBeNull();
  });

  it("T4 '?return=https%3A%2F%2Fx.term.example.com%2F' → decoded url string", () => {
    expect(parseReturnFromSearch("?return=https%3A%2F%2Fx.term.example.com%2F")).toBe(
      "https://x.term.example.com/"
    );
  });

  it("T5 leading '?' optional: 'return=x' AND '?return=x' both work", () => {
    expect(parseReturnFromSearch("return=foo")).toBe("foo");
    expect(parseReturnFromSearch("?return=foo")).toBe("foo");
  });

  it("T6 first occurrence wins if multiple return= params present", () => {
    expect(parseReturnFromSearch("?return=first&return=second")).toBe("first");
  });
});

// ---------------------------------------------------------------------------
// validateReturnUrl — accept cases
// ---------------------------------------------------------------------------
describe("validateReturnUrl accept cases", () => {
  it.each([
    ["A1 exact-match", "https://term.example.com/"],
    ["A2 direct subdomain", "https://thenasty-8899.serve.term.example.com/"],
    ["A3 subdomain with path+query+hash", "https://foo.term.example.com/deep/path?x=1#h"],
    ["A4 subdomain with port", "https://foo.term.example.com:8443/"],
    ["A5 case-insensitive hostname (URL constructor lowercases)", "https://FOO.TERM.example.com/"],
    ["A6 FQDN trailing dot on hostname (M-01)", "https://foo.term.example.com./"],
    ["A7 FQDN trailing dot on exact-match parent (M-01)", "https://term.example.com./"],
  ])("%s", (_label, url) => {
    const result = validateReturnUrl(url, PARENT);
    expect(result).not.toBeNull();
    // Must return a normalized URL (URL constructor preserves trailing dot in href even
    // when we accept the URL; the validator strips it for comparison but returns
    // parsed.href verbatim, so A6/A7 assert accept-not-null rather than href equality.)
  });

  it("A8 accepts trailing-dot parentDomain input (defensive normalization)", () => {
    const result = validateReturnUrl("https://foo.term.example.com/", "term.example.com.");
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateReturnUrl — reject cases
// ---------------------------------------------------------------------------
describe("validateReturnUrl reject cases", () => {
  it.each([
    ["R1 null input", null],
    ["R2 empty string", ""],
    ["R3 plain-suffix bypass (eviltermexample.com)", "https://eviltermexample.com/"],
    ["R4 domain-suffix-in-path bypass", "https://term.example.com.evil.com/"],
    ["R5 parent-of-parent (example.com)", "https://example.com/"],
    ["R6 http:// protocol", "http://term.example.com/"],
    ["R7 javascript: URL", "javascript:alert(1)"],
    ["R8 data: URL", "data:text/html,<script>alert(1)</script>"],
    ["R9 protocol-relative (//evil.com/x)", "//evil.com/x"],
    ["R10 malformed ('not a url')", "not a url"],
    ["R11 credentials-in-userinfo (evil host)", "https://term.example.com:9999@evil.com/"],
    ["R12 credentials without evil host", "https://user:pass@foo.term.example.com/"],
  ] as [string, string | null][])(
    "%s",
    (_label, url) => {
      expect(validateReturnUrl(url, PARENT)).toBeNull();
    }
  );

  it("R13 empty parentDomain '' → null for any input", () => {
    expect(validateReturnUrl("https://term.example.com/", "")).toBeNull();
  });

  it("R14 parentDomain contains slash → null for any input", () => {
    expect(validateReturnUrl("https://term.example.com/", "term.example.com/x")).toBeNull();
  });

  it("R15 parentDomain contains colon → null for any input", () => {
    expect(validateReturnUrl("https://term.example.com/", "term.example.com:8080")).toBeNull();
  });

  it("R16 IPv4 parentDomain — subdomain-shaped spoof rejected (M-02)", () => {
    // If SKYNET_COOKIE_DOMAIN=192.168.1.1 (dev/staging), '1.192.168.1.1' must NOT
    // pass under the leading-dot rule — IPv4 literals have no DNS subdomain semantics.
    expect(validateReturnUrl("https://1.192.168.1.1/", "192.168.1.1")).toBeNull();
  });

  it("R17 IPv4 parentDomain — exact match still accepted", () => {
    // The IPv4 guard only rejects the subdomain-shaped case; exact host === parent still works.
    expect(validateReturnUrl("https://192.168.1.1/", "192.168.1.1")).not.toBeNull();
  });
});
