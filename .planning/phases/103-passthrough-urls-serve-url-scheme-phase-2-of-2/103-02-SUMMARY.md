---
phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2
plan: 02
subsystem: auth
tags: [auth, cookie-domain, cors, csrf, host-registration]
dependencies:
  requires: []
  provides:
    - "getSecureCookieOptions + getClearCookieOptions honor SKYNET_COOKIE_DOMAIN env (D-02)"
    - "createCorsMiddleware rejects *.serve.term.<domain> origins (D-07)"
    - "POST /db/host rejects hostname ending -<digits> (D-12)"
  affects:
    - "Waves 3-6 downstream (assume JWT cookie can reach *.serve.term.<domain> and CORS blocks cross-origin CSRF from serve subdomains)"
tech-stack:
  added: []
  patterns:
    - "Conditional-spread env-driven cookie domain (`...(skynetDomain ? { domain: skynetDomain } : {})`) — backwards-compatible when env unset"
    - "Explicit-deny-wins CORS ordering — reject check placed immediately after !origin guard, before every accept check"
    - "Registration-time validation with structured warn log + 400 error string — inline check on CREATE path only, PUT untouched (host-record-trap avoidance)"
key-files:
  created:
    - ".planning/phases/103-passthrough-urls-serve-url-scheme-phase-2-of-2/103-02-SUMMARY.md"
  modified:
    - "src/backend/utils/auth-manager.ts (getSecureCookieOptions + getClearCookieOptions bodies only)"
    - "src/backend/utils/cors-config.ts (top-level SERVE_SUBDOMAIN_RE + inline reject in createCorsMiddleware origin callback)"
    - "src/backend/database/routes/host.ts (POST /db/host validation block only)"
    - "src/backend/database/routes/host.test.ts (added D-12 describe block with 4 cases)"
decisions:
  - "Kept conditional-spread idiom over `domain: skynetDomain || undefined` — cleaner absence of `domain` key when env unset (per plan L107 acceptable-either-way, chose the former)"
  - "Placed D-12 check between the isNonEmptyString/isValidPort block (L239-252) and the effectiveConnectionType assignment (L254) — before the D-08 credentialId guard (L451) and before any DB insert path (L463+)"
  - "New `POST /db/host — D-12` describe block added rather than folding cases into the existing `credentialId guard (P1-P6)` block — semantic separation makes the D-12 gate independently discoverable"
  - "Accept-case tests use negative assertion (`not.toContain(D12_ERR)`) rather than `res._status === 200` — accept cases may still fail on unrelated guards; the D-12-specific invariant is 'this check did not fire'"
metrics:
  duration_min: 6
  completed_at: "2026-09-10"
  tasks_completed: 3
  files_touched: 4
---

# Phase 103 Plan 02: JWT cookie widen + CORS serve-subdomain reject + host-registration -<digits> guard — Summary

## One-liner

Env-driven domain widening for the JWT session cookie (`getSecureCookieOptions` + matching `getClearCookieOptions` both honor `SKYNET_COOKIE_DOMAIN`), a first-check CORS reject for `*.serve.term.<domain>` origins (browser-preflight CSRF defense for the widened cookie), and a POST-only hostname validation rejecting `-<digits>` suffixes at registration — three defense-in-depth foundation edits realizing D-02, D-07, and D-12 with test coverage.

## What Shipped

### Task 1 — `src/backend/utils/auth-manager.ts` (commit `9e4b3800`)

Modified `getSecureCookieOptions` (L709) and `getClearCookieOptions` (L722) — both now read `const skynetDomain = process.env.SKYNET_COOKIE_DOMAIN;` at the top of the method and conditionally spread `...(skynetDomain ? { domain: skynetDomain } : {})` into the returned options object.

- **Env-driven per D-23**: t1000 sets `SKYNET_COOKIE_DOMAIN=term.example.com` in its `/opt/skynet/skynet.env`; T800 sets its own value independently.
- **Backwards-compatible per D-24**: when env unset (dev, tests, unconfigured envs), the `domain` key is absent from the returned object → today's behavior preserved.
- **Clear-path mirror is load-bearing**: without matching the set-path's `domain`, clearing the cookie would leave the widened-domain instance in place (a stale wider-scope cookie the browser would still send).
- All other fields (`httpOnly`, `secure`, `sameSite`, `maxAge`, `path`) untouched.
- Provenance comments cite D-02, D-23, D-24 inline.

### Task 2 — `src/backend/utils/cors-config.ts` (commit `15d39c87`)

Added top-level constant `SERVE_SUBDOMAIN_RE = /^https:\/\/[^/]+\.serve\.term\.[a-zA-Z0-9.-]+$/` (with a D-07 provenance comment) and a first-check reject inside the `createCorsMiddleware` origin callback.

Ordering (verified by inspection of L52-79):
1. `if (!origin) return callback(null, true)` — no-origin guard preserved first (non-browser / same-origin requests unaffected per D-07)
2. **`if (SERVE_SUBDOMAIN_RE.test(origin)) return callback(new Error("Not allowed by CORS (serve subdomain origin)"))`** — new explicit deny
3. `isLocalRequest(req)`, `DEV_ORIGINS.includes(origin)`, `ELECTRON_FILE_ORIGIN`, allowlist from `getAllowedOrigins()`, `getRequestOrigin(req)` same-origin — all pre-existing accept checks unchanged, all placed AFTER the reject

"Explicit deny always wins" invariant enforced by placement. No other function in this file modified.

### Task 3 — `src/backend/database/routes/host.ts` + `host.test.ts` (commits `46d4dc1c` RED, `cd922e52` GREEN)

**Test (RED, `46d4dc1c`)**: Added new `describe("POST /db/host — D-12 hostname-collision-with-serve-url-grammar", ...)` block in `host.test.ts` with 4 `it(...)` cases:
- `rejects hostname ending -<digits> with 400` — sends `name: "foo-42"`, asserts status 400, error string contains `"reserved for serve URL grammar"`, `SimpleDBOps.insert` NOT called
- `accepts hostname with non-terminal digit (aither-cloud2)` — sends `name: "aither-cloud2"`, asserts D-12 error string absent (may still fail on unrelated guards)
- `accepts hostname without dash (t800)` — sends `name: "t800"`, same negative assertion
- `accepts hostname with dash and non-digit suffix (foo-bar)` — sends `name: "foo-bar"`, same negative assertion

Confirmed RED before implementation: first case failed with `AssertionError: expected 200 to be 400`.

**Implementation (GREEN, `cd922e52`)**: Inserted D-12 check in `host.ts` POST handler immediately after the existing `isNonEmptyString(userId) / isNonEmptyString(ip) / isValidPort(port)` block (L252) and BEFORE `effectiveConnectionType` assignment (L254), well before the D-08 credentialId guard (L451+) and the DB insert path (L463+):

```typescript
if (typeof name === "string" && /-\d+$/.test(name)) {
  sshLogger.warn("[host-db] host-name-collision-with-serve-url-grammar", {
    operation: "host_create",
    userId,
    name,
  });
  return res.status(400).json({
    error: "Hostname cannot end in -<number> (reserved for serve URL grammar)",
  });
}
```

- **CREATE path only**: PUT handlers on `/db/host/:id` are unchanged — respects the host-record-trap warning that editing a host nulls its SSH key.
- **Structured log**: `operation: "host_create"` + `userId` + `name` — auditable via T-103-11 mitigation.
- **Info-leak invariant T-40-05**: message string doesn't interpolate userId bytes (only in structured context); error response returns a static classified sentence, not the user-supplied name.
- **Fleet compatibility**: all 10 current hostnames pass (thenasty, workstation, ashley-beelink, aither-cloud, aither-cloud2, aither-sftp, t1000, t800, GIGAASHLEYPC, ZoeyBattlestation) — validated against the D-12 constraint at plan time.

## Verification Results

| Check | Result |
|---|---|
| `npx vitest run src/backend/database/routes/host.test.ts` | ✅ 35/35 pass (31 pre-existing + 4 new D-12 cases) |
| `npx tsc --noEmit` | ✅ EXIT:0 |
| `grep -c 'process.env.SKYNET_COOKIE_DOMAIN' src/backend/utils/auth-manager.ts` | ✅ 2 (once each in get/clear cookie options) |
| `grep -c 'SERVE_SUBDOMAIN_RE' src/backend/utils/cors-config.ts` | ✅ 2 (declaration + `.test()` call) |
| `grep -c 'reserved for serve URL grammar' src/backend/database/routes/host.ts` | ✅ 1 (single CREATE-path occurrence) |
| `grep -cE '/-\\d\+\$/' src/backend/database/routes/host.ts` | ✅ 1 |
| Ordering invariant: SERVE_SUBDOMAIN_RE reject before isLocalRequest/DEV_ORIGINS/allowlist/getRequestOrigin | ✅ verified L59-63 in cors-config.ts |
| Scope: PUT /db/host handler unchanged | ✅ `git diff` shows only POST-handler insertion in host.ts |
| Scope: enableSsh/enableRdp/enableTerminal field handling unchanged | ✅ `git diff` shows no touches to enable-flag logic |
| `npx vitest run src/backend/database/routes/sessions.test.ts` (AuthManager smoke) | ✅ 41/41 pass |

## TDD Gate Compliance

- **RED gate** (Task 3 only — Tasks 1 & 2 modify functions with no direct unit tests): commit `46d4dc1c` `test(103-02): ...` — verified failing (`AssertionError: expected 200 to be 400`) before implementation.
- **GREEN gate** (Task 3): commit `cd922e52` `feat(103-02): reject hostname ending -<digits> ...` — all 35 host.test.ts cases pass.
- **REFACTOR gate**: not needed — implementation is a minimal 12-line insertion, no cleanup required.

Tasks 1 & 2 were `tdd="true"` in the plan but the plan's `<action>` blocks did not specify new tests to add (the existing test surface for `auth-manager.ts` and `cors-config.ts` is indirect via integration tests). Verified no existing tests broke via `sessions.test.ts` (AuthManager consumer) + full `tsc --noEmit`.

## Threat Model Realized

| Threat | Mitigation shipped |
|---|---|
| T-103-06 (EoP: cookie scope) | Cookie widens to exactly `term.<domain>` via env — siblings on registrable domain (`files.example.com`) untouched |
| T-103-07 (CSRF from serve subdomains) | `SERVE_SUBDOMAIN_RE` reject in CORS middleware blocks any preflight-triggering cross-origin request from `*.serve.term.<domain>` at browser layer |
| T-103-10 (Tampering: hostname collision) | POST /db/host rejects `-\d+$` hostnames at 400 with structured warn log — collision with serve URL grammar (`<host>-<port>.serve.term.<domain>` per D-11) prevented at DB write boundary |
| T-103-11 (Repudiation: silent hostname rejects) | sshLogger.warn emits `[host-db] host-name-collision-with-serve-url-grammar` with operation/userId/name — auditable |

## Deviations from Plan

None — plan executed exactly as written. All three files modified in place per the plan's `files_modified` list; test file extended with a fresh describe block per the plan's Task 3 test-additions spec.

## Self-Check

- Files modified exist:
  - `src/backend/utils/auth-manager.ts` — FOUND
  - `src/backend/utils/cors-config.ts` — FOUND
  - `src/backend/database/routes/host.ts` — FOUND
  - `src/backend/database/routes/host.test.ts` — FOUND
- Commits exist in `git log`:
  - `9e4b3800` (Task 1 feat) — FOUND
  - `15d39c87` (Task 2 feat) — FOUND
  - `46d4dc1c` (Task 3 test) — FOUND
  - `cd922e52` (Task 3 feat) — FOUND

## Self-Check: PASSED

## Ready for downstream

Waves 3-6 (subdomain dispatch, tunnel cache, proxy factory, serve route, interstitials, header audit, no-cookie-egress integration test, frontend URL detection, id-skill rewrite, CSRF audit) can now assume:

1. JWT cookie widens to `term.<domain>` when `SKYNET_COOKIE_DOMAIN` env is set at deploy time (per D-24 single-deploy) → cookie reaches `*.serve.term.<domain>` requests, letting the edge proxy validate it.
2. Cross-origin fetch from any `foo-3000.serve.term.<domain>` to `term.<domain>` is CORS-blocked at preflight → CSRF from serve subdomains cannot exploit the widened cookie for preflight-triggering endpoints. (Non-preflight vectors — multipart uploads, WebSocket Origin checks — remain Wave 8 work per D-10/D-08.)
3. No fleet host may register with a name ending `-\d+` → the split-on-last-dash parse in the subdomain-dispatch middleware (Wave 4) can safely treat the trailing token as the port without ambiguity.
