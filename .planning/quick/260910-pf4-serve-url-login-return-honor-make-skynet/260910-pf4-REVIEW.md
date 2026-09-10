---
phase: 260910-pf4
reviewed: 2026-09-10T00:00:00Z
depth: medium
files_reviewed: 5
files_reviewed_list:
  - src/ui/auth/return-url.ts
  - src/ui/auth/return-url.test.ts
  - src/ui/auth/Auth.tsx
  - src/ui/auth/Auth.return-url.test.tsx
  - src/main.tsx
findings:
  critical: 0
  high: 1
  medium: 2
  low: 2
  nit: 3
  total: 8
status: issues_found
---

# 260910-pf4: Code Review — Serve URL Login-Return Honor

**Reviewed:** 2026-09-10
**Depth:** medium (security-adjacent, focused on bypass classes + lifecycle correctness)
**Files Reviewed:** 5
**Status:** issues_found

## Summary

The open-redirect validator (`return-url.ts`) is fundamentally sound. The leading-dot suffix rule is correctly implemented, the URL constructor is used without a base (protocol-relative bypass blocked), credentials in userinfo are checked, and only `https:` is permitted. No bypass of the validator's intended invariant was found.

The security findings are all in the auxiliary code: one **High** issue is a misleading comment in `main.tsx` that misrepresents program flow (the IIFE's inner `return` does not suppress `createRoot`), one **Medium** issue is a false-negative where FQDN trailing-dot URLs are wrongly rejected, and one **Medium** coverage gap leaves the IPv4-parentDomain subdomain bypass untested. The remaining findings are low-priority test quality issues.

---

## High Issues

### H-01: Misleading comment — `createRoot` IS called after the IIFE redirects; comment says it is not

**File:** `src/main.tsx:298`

**Issue:** The `return` statement inside the IIFE `tryMainReturnUrlRedirect` exits only the IIFE's own function scope. Module-level execution continues immediately: `prepareClientCacheVersion().finally(() => createRoot(...))` on line 306 fires unconditionally, regardless of whether `window.location.assign()` was called on line 297. The inline comment reads `// Do not call createRoot — browser is navigating away`, which is factually wrong.

In practice the browser starts its navigation before the React tree renders meaningfully, so there is no user-visible consequence. However the comment is a maintenance hazard: a future engineer reading "Do not call createRoot" might conclude the IIFE is the guard mechanism and add code between lines 304 and 306 under that false premise, or might try to reproduce the "early exit" in a Node.js test harness where navigation does not occur and React really does finish mounting.

Additionally, because `createRoot` still runs, several side effects fire on every redirect-path page load:
- The `App` component renders the "verifying" spinner and dispatches `getUserInfo()` over the network before the navigation supersedes the page.
- Any effects inside `RootApp`/`App` that touch `localStorage`, register listeners, or initiate requests all execute.

This is not a security issue but the factual incorrectness of the comment combined with the real side-effects makes this High, not Medium.

**Fix:** Either (a) guard `createRoot` so it is never invoked when a redirect is in flight, or (b) correct the comment to reflect reality.

Option (a) — prevent `createRoot` when redirecting:
```typescript
// Returns true if navigation was initiated, false otherwise.
function tryMainReturnUrlRedirect(): boolean {
  const stored = getStoredAuth();
  if (!stored?.loggedIn) return false;
  const raw = parseReturnFromSearch(window.location.search);
  const validated = validateReturnUrl(raw, window.location.hostname);
  if (validated) {
    window.location.assign(validated);
    return true;
  }
  if (raw !== null) {
    console.warn("[auth] rejecting invalid return url", { returnParam: raw, parentDomain: window.location.hostname });
  }
  return false;
}

if (!tryMainReturnUrlRedirect()) {
  prepareClientCacheVersion().finally(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
          <RootApp />
        </ThemeProvider>
      </StrictMode>,
    );
  });
}
```

Option (b) — fix comment only (if the wasted render is acceptable):
```typescript
    window.location.assign(validated);
    return; // Navigation initiated. createRoot still runs below but will be
            // preempted by the browser navigation before the React tree renders.
```

Option (a) is preferred.

---

## Medium Issues

### M-01: FQDN trailing-dot URLs are silently rejected (false negative)

**File:** `src/ui/auth/return-url.ts:73–75`

**Issue:** RFC 1034 and browsers allow fully-qualified domain names with a trailing dot (`term.gigaashley.click.`). Node.js and Chrome's `URL` constructor preserve the trailing dot in `.hostname`:

```
new URL('https://term.gigaashley.click./').hostname
// → 'term.gigaashley.click.'   (trailing dot retained)
```

The validator compares `host` (`'term.gigaashley.click.'`) against `parent` (`'term.gigaashley.click'`) and `host.endsWith('.' + parent)` (`'.term.gigaashley.click'`). Both comparisons fail. Any return URL in FQDN notation — even a perfectly valid same-domain one — is silently rejected, and the user is dropped at app root after login.

This is not a security bypass (the trailing dot deflects, not bypasses), but it is a functional regression against users whose HTTP clients normalise URLs to FQDN form (some curl defaults, some CDN redirect responses, some corporate proxies). It also has no test coverage.

**Fix:** Strip a single trailing dot from `host` before comparing:
```typescript
// Hostname check with leading-dot suffix rule.
// Strip trailing FQDN dot (RFC 1034 §3.1) before comparing — URL.hostname preserves it.
const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
const parent = parentDomain.toLowerCase();
if (host !== parent && !host.endsWith("." + parent)) return null;
```

Add a test:
```typescript
["A6 FQDN trailing dot (same domain)", "https://term.gigaashley.click./"],
["A7 FQDN trailing dot (subdomain)", "https://sub.term.gigaashley.click./"],
```

### M-02: IPv4 `parentDomain` allows arbitrary subdomains — untested and colon-check does not block IPv4

**File:** `src/ui/auth/return-url.ts:54`, `src/ui/auth/return-url.test.ts` (missing test)

**Issue:** The defensive guard at line 54 rejects `parentDomain` values containing `:` (blocking IPv6 literals like `[::1]`) or `/`. It does **not** reject IPv4 addresses. If `SKYNET_COOKIE_DOMAIN` is set to an IPv4 address in a dev/staging environment (`192.168.1.1`), then:

```
parentDomain = '192.168.1.1'
returnUrl    = 'https://1.192.168.1.1/'
→ host = '1.192.168.1.1'
→ host.endsWith('.192.168.1.1') = true  → ACCEPT
```

This is a `*.192.168.1.1` wildcard. On private networks this is low-risk because `*.192.168.1.x` domains don't resolve to attacker infrastructure, but on public-facing staging environments with public IPv4 addresses it is exploitable if the attacker can register a matching subdomain (which is impossible — IP-form hostnames cannot have subdomains in DNS). However the behaviour is still logically wrong (IP addresses cannot have subdomains) and goes untested.

There is also no test for the `localhost` parentDomain case where `evil.localhost` would be accepted (again, `.localhost` TLD is non-routable, so not exploitable in practice).

**Fix — add a test to document the known behaviour:**
```typescript
it("R16 IPv4 parentDomain — exact-match only (no subdomain of an IP)", () => {
  // IPv4 addresses cannot have DNS subdomains; reject any host that is not
  // exactly the IPv4 address even if endsWith('.x.x.x.x') is true.
  expect(validateReturnUrl("https://1.192.168.1.1/", "192.168.1.1")).toBeNull();
});
```

**Fix — tighten the validator (optional but recommended):** If `parentDomain` is detected to be an IPv4 address (matches `/^\d+\.\d+\.\d+\.\d+$/`), require exact host equality:
```typescript
const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(parent);
if (isIPv4) {
  if (host !== parent) return null;
} else {
  if (host !== parent && !host.endsWith("." + parent)) return null;
}
```

---

## Low Issues

### L-01: `screen` is imported but never used in `Auth.return-url.test.tsx`

**File:** `src/ui/auth/Auth.return-url.test.tsx:21`

**Issue:**
```typescript
import { render, screen } from "@testing-library/react";
```
`screen` is never referenced in any of the 13 tests. The test name for B1 says "form not initially rendered" but never checks it (see L-02 below). `screen` was likely scaffolded in anticipation of that assertion and then omitted.

**Fix:** Remove `screen` from the import, or add the missing assertion (see L-02).

```typescript
import { render } from "@testing-library/react";
```

### L-02: B1 test name promises an assertion it never makes

**File:** `src/ui/auth/Auth.return-url.test.tsx:212`

**Issue:** The test is named:
> "B1 already-authed + valid same-parent-domain return= → window.location.assign called on mount with validated URL, **form not initially rendered**"

The "form not initially rendered" clause is never verified. The test only asserts `window.location.assign` was called. The missing assertion would confirm that the redirect fires before the login form paints, which is the UX guarantee the task is supposed to deliver.

**Fix:** Add a `screen` query to confirm the login form is absent after the redirect fires:
```typescript
// After render, navigation has been initiated — form should not be visible
expect(screen.queryByRole("form")).toBeNull();
// Or more precisely: no username input rendered
expect(screen.queryByPlaceholderText("username")).toBeNull();
```

---

## Nit Issues

### N-01: No test for `validateReturnUrl` with an uppercase exact-match parent domain

**File:** `src/ui/auth/return-url.test.ts`

**Issue:** Test A5 covers an uppercase **subdomain** (`https://FOO.TERM.gigaashley.click/`) but not an uppercase exact match (`https://TERM.GIGAASHLEY.CLICK/`). The mechanism is identical (`.toLowerCase()` on both sides), so coverage is effectively present, but a symmetric accept-case for the root domain would make the test matrix complete.

**Fix:** Add one accept case:
```typescript
["A6 uppercase exact-match parent domain", "https://TERM.GIGAASHLEY.CLICK/"],
```

### N-02: Duplicate redirects are idempotent but architecturally redundant

**File:** `src/main.tsx:291–304`, `src/ui/auth/Auth.tsx:309–312`

**Issue:** When a logged-in user loads `/login?return=<url>`, two separate calls to `window.location.assign(validated)` are issued on the same page load: one from the main.tsx IIFE (synchronous, at module parse time) and one from the Auth component's mount-time `useEffect`. Both navigate to the same destination, so the user experience is correct, but the redundant call generates an extra navigation event in browser history/diagnostics tooling and adds an unnecessary network round-trip initiation.

This is architectural waste rather than a bug — browsers handle duplicate `assign()` calls gracefully. However, if `H-01` is fixed by guarding `createRoot`, the Auth component never mounts in the redirect path, eliminating the second call automatically.

**Fix:** Implement the option (a) fix from H-01. This automatically resolves the redundancy.

### N-03: `console.warn` in production for invalid return URLs may expose internal routing info

**File:** `src/ui/auth/Auth.tsx:127`, `src/main.tsx:302`

**Issue:** The warn log emits:
```
[auth] rejecting invalid return url { returnParam: '<raw user input>', parentDomain: 'term.gigaashley.click' }
```

`parentDomain` in the log reveals `SKYNET_COOKIE_DOMAIN` — the internal subdomain structure. This is low-risk since the information is visible in the URL bar and network tab anyway, but it slightly increases the information density available to an attacker probing reject conditions.

**Fix (optional):** Omit `parentDomain` from the warning in production builds, or emit only the scheme/host portion of the rejected URL rather than the raw `returnParam` (which may contain attacker-controlled characters):
```typescript
console.warn("[auth] rejecting invalid return url", {
  returnScheme: (() => { try { return new URL(raw).protocol; } catch { return "invalid"; } })(),
});
```

---

## Open-Redirect Bypass Class Checklist

| Bypass class | Tested? | Status |
|---|---|---|
| Leading-dot suffix (`eviltermgigaashley.click`) | R3 | BLOCKED |
| Domain-suffix-in-path (`term.gigaashley.click.evil.com`) | R4 | BLOCKED |
| Parent-of-parent (`gigaashley.click`) | R5 | BLOCKED |
| `http://` protocol | R6 | BLOCKED |
| `javascript:` scheme | R7 | BLOCKED |
| `data:` scheme | R8 | BLOCKED |
| Protocol-relative (`//evil.com/x`) | R9 | BLOCKED |
| Malformed URL | R10 | BLOCKED |
| Userinfo credentials (`user:pass@evil.com`) | R11, R12 | BLOCKED |
| Empty `@` in URL (`https://@host/`) | none | BLOCKED (URL constructor strips it; `.username === ''`) |
| `https:` only — `ftp`, `file`, `blob` | implied by R6 + protocol check | BLOCKED |
| Case-insensitive hostname | A5 | BLOCKED (`.toLowerCase()`) |
| Null byte in URL | none | BLOCKED (URL constructor throws) |
| Percent-encoded hostname | none | BLOCKED (URL constructor decodes then normalises) |
| FQDN trailing dot in return URL | none | **FALSE NEGATIVE** — valid URL rejected (M-01) |
| IPv4 `parentDomain` subdomain | none | Theoretical gap (M-02) |
| `localhost` subdomain | none | Non-exploitable (loopback), no test |

---

_Reviewed: 2026-09-10_
_Reviewer: Claude (adversarial code review)_
_Depth: medium_
