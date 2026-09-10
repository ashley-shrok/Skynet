---
phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2
plan: 04
subsystem: security-test
tags: [integration-test, security-test, cookie-egress, csrf-defense, d-05, d-04, allowlist-strip]

# Dependency graph
requires:
  - phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2
    provides: "Plan 03b's getOrCreateProxyForTarget (proxy-factory.ts stripToAllowlist on both proxyReq + proxyReqWs) + HEADER_ALLOWLIST tuple (types.ts)"
provides:
  - "src/backend/serve-url/tests/no-cookie-egress.integration.test.ts — CI enforcement of D-04 default-deny allowlist-strip contract across 6 transport scenarios × 3 disallowed header classes; MUST pass to merge per D-05"
affects:
  - "Any future refactor of proxy-factory.ts that accidentally drops the stripToAllowlist call (or breaks its coverage of one of the 6 transports — HTTP, WS, SSE, multipart, redirect) fails this test at merge time"
  - "103-05 (subdomain-dispatch + serve-route) — this test guards proxy-factory in isolation; Plan 05 wires it into the request path; a Plan-05-side regression that bypasses the proxy would not be caught here"

# Tech tracking
tech-stack:
  added: []  # No new deps — reuses vitest + ws + undici + express + node http already installed via Plan 03b + fleet baseline
  patterns:
    - "Integration-test structure per user-avatars.integration.test.ts: real http.createServer echo upstream, real Express app, real client via undici fetch + ws WebSocket — no vi.mock of the proxy pipeline itself"
    - "Bypass tunnel-cache by handing the proxy factory `tunnelPort === echoPort` directly (proxy is oblivious — it just pipes to http://127.0.0.1:${tunnelPort}, which happens to be the echo server)"
    - "Two-signal recording: separate recordedHeaders (HTTP requests) and recordedUpgradeHeaders (WebSocket upgrades) arrays, reset in beforeEach; upgrade events wired via echoServer.on('upgrade', ...) with WebSocketServer.handleUpgrade in noServer mode"
    - "Positive-and-negative test integrity: 6 negative transport tests + 2 sanity tests proving the strip is SELECTIVE (Content-Type + Host DO pass through) — mitigates T-103-20 (test that always passes regardless of implementation)"
    - "WS upgrade proxying: after mounting the middleware on Express, manually wire proxyServer.on('upgrade', proxyMiddleware.upgrade) so http-proxy-middleware handles WS upgrade tunneling (Express itself doesn't dispatch upgrade events to middleware)"

key-files:
  created:
    - "src/backend/serve-url/tests/no-cookie-egress.integration.test.ts (399 lines) — D-05 CI integration test: 8 it() blocks covering 6 transport scenarios × 3 disallowed header classes + 2 sanity tests"
  modified: []

key-decisions:
  - "Bypass tunnel-cache entirely by passing echoPort as the tunnelPort argument to getOrCreateProxyForTarget — the proxy factory only needs a loopback TCP port to pipe to; whether that port belongs to an SSH tunnel or a Node http.createServer echo makes no difference at the proxy layer. This isolates proxy-factory.ts's allowlist-strip behavior without pulling ssh2 / connectOneShot / withConnection into the test harness"
  - "Consolidate the 3 disallowed header classes into ONE assertion helper (expectNoDisallowedHeaders) applied once per negative test — 6 negative tests × 3 header-class assertions each = 18 boundary checks, plus 6 more toBeDefined checks in the sanity tests. Plan called for 'at least 8 distinct it() blocks covering the 6 transport scenarios × the 3 header classes … may collapse to 8 test blocks with parameterized assertions each covering all 3 header classes on one transport' — exactly what shipped"
  - "SSE test drains the response body reader to completion before asserting — undici's fetch resolves the promise on response-received, but the request may still be in-flight from the echo's perspective if we don't drain. Server sends one 'data: hello\\n\\n' event then ends, so drain-to-completion is bounded"
  - "WS test uses setImmediate + ws.close() rather than relying on the server-side close race — the echo's WebSocketServer.handleUpgrade fires ws.close() synchronously but the upgrade-headers push happens BEFORE handleUpgrade completes, so recordedUpgradeHeaders is populated by the time the client's close event fires. The setImmediate is defensive spacing between open and close events"
  - "Cast the fakeHost stub with 'as unknown as Host' rather than fully populating every Host-interface field — the proxy-factory only reads target.hostname, target.port, and target.host is opaque from its perspective (never dereferenced in proxy-factory.ts). Full-Host population would be ~30 lines of irrelevant field values. Same test-integration-integrity pattern as user-avatars.integration.test.ts's dbProxy that stubs only what's called"
  - "Include TWO X-Skynet-* headers (X-Skynet-User-Id + X-Skynet-Trace) in the disallowed set rather than one — proves the strip catches the CLASS via prefix match, not just one hard-coded name. The assertion helper filters keys by `.toLowerCase().startsWith('x-skynet-')` and asserts length 0, so both would surface if the strip missed either"

patterns-established:
  - "Integration-test structure for serve-url subsystem: real http.createServer upstream + real Express app mounting the factory + real HTTP/WS client. Future serve-url integration tests (e.g. Plan 05's subdomain-dispatch tests) can copy this shape verbatim, substituting the middleware under test"
  - "Test integrity pattern: pair every negative-class-of-tests with a positive sanity test proving the tested pathway is actually running. Without the sanity tests, a bug that made the middleware a no-op would silently pass every negative assertion (T-103-20 mitigation baked into the test file itself)"

requirements-completed: []  # Plan frontmatter had empty requirements array

# Metrics
duration: ~10min
completed: 2026-09-10
---

# Phase 103 Plan 04: D-05 No-Cookie-Egress Integration Test Summary

**CI integration test enforcing the D-04 default-deny allowlist-strip contract across 6 transport scenarios × 3 disallowed header classes. Real Node http.createServer echo upstream records every inbound HTTP + WebSocket-upgrade header; 8 it() blocks assert none of Cookie / Authorization / X-Skynet-* reach upstream (6 negative) while Content-Type + Host DO pass through (2 sanity). Passes on current proxy-factory implementation; would fail if stripToAllowlist is removed.**

## Performance

- **Duration:** ~10 min (1 autonomous TDD task with implementation already shipped in Plan 03b)
- **Started:** 2026-09-10 (executor spawn after Plan 03b complete)
- **Completed:** 2026-09-10
- **Tasks:** 1
- **Files created:** 1 (no-cookie-egress.integration.test.ts, 399 lines, 8 tests)
- **Files modified:** 0

## Accomplishments

- **Locked in the D-05 belt of the belt-and-suspenders D-04 defense at CI merge time.** Any future refactor of `src/backend/serve-url/proxy-factory.ts` that accidentally drops the `stripToAllowlist` call, misses one of the two hooks (`on.proxyReq` for HTTP + `on.proxyReqWs` for WebSocket upgrades), or narrows the strip's coverage will fail this test at merge time. D-05 called for exactly this: "MUST pass to merge."
- **Covered all 6 transport scenarios from D-05's enumeration:** GET, POST (JSON), WebSocket upgrade, SSE (`Accept: text/event-stream`), multipart/form-data upload, 302 redirect follow. Each test sends ALL THREE disallowed header classes simultaneously (`Cookie`, `Authorization`, `X-Skynet-*` — including TWO X-Skynet-* headers to prove prefix-based stripping) and asserts none reach the echo upstream via the recorded inbound headers.
- **Baked in test integrity via 2 positive sanity tests** — Content-Type and Host DO pass through the strip. Without these, a bug that made the proxy middleware a no-op would silently pass every negative test (the disallowed headers would never even leave the client). The sanity tests prove the pipe IS running end-to-end. Mitigates T-103-20 (repudiation — test that always passes regardless of implementation).
- **Isolated proxy-factory.ts behavior by bypassing tunnel-cache** — hand the factory `tunnelPort === echoPort` directly. The proxy is oblivious: it just pipes to `http://127.0.0.1:${tunnelPort}` regardless of whether that port belongs to a real SSH tunnel or a Node http.createServer echo. This dodges ssh2 / connectOneShot / withConnection entirely in the test harness while still exercising the exact `createProxyMiddleware({ on: { proxyReq, proxyReqWs } })` pipeline that runs in production.
- **All 8 tests pass on first run** — `npx vitest run src/backend/serve-url/tests/no-cookie-egress.integration.test.ts` exits 0 in ~600ms. TypeScript compiles cleanly (`npx tsc --noEmit` exits 0 with no output).
- **Redirect test asserts on BOTH the initial /redirect-me request AND the followed /redirected request** — 302-follow is where a naive strip implementation might slip up (the second hop's headers come from the client's redirect-follow logic, not the original request). Both entries in `recordedHeaders` get validated.

## Task Commits

Task committed atomically:

1. **Task 1: Create no-cookie-egress.integration.test.ts covering 6 transports × 3 header classes** — `7e5e9946` (test)

## Files Created/Modified

- `src/backend/serve-url/tests/no-cookie-egress.integration.test.ts` (NEW, 399 lines) — D-05 CI integration test. Contents:
  - `beforeAll`: Stands up `echoServer` (Node http.createServer) recording inbound headers to `recordedHeaders` array; WebSocketServer in noServer mode wired via `echoServer.on('upgrade', ...)` to record upgrade headers to `recordedUpgradeHeaders` array; stands up `proxyServer` (Node http.createServer wrapping Express app mounting `getOrCreateProxyForTarget(target, echoPort)`); wires WS upgrade proxying via `proxyServer.on('upgrade', proxyMiddleware.upgrade)`.
  - `beforeEach`: Resets both recording arrays.
  - `afterAll`: Closes wss, echoServer, proxyServer in order.
  - 6 negative `it(...)` blocks: GET / POST-JSON / WebSocket upgrade / SSE / multipart FormData / 302 redirect follow. Each sends `Cookie: skynet_session=abc123; other_cookie=xyz` + `Authorization: Bearer test-token-should-be-stripped` + `X-Skynet-User-Id: 999` + `X-Skynet-Trace: req-abc-123` simultaneously via undici fetch (or ws.WebSocket for the WS test). Each asserts via `expectNoDisallowedHeaders(headers)` helper that: `headers.cookie === undefined`, `headers.authorization === undefined`, and `Object.keys(headers).filter(k => k.toLowerCase().startsWith('x-skynet-')).length === 0`.
  - 2 sanity `it(...)` blocks: `Content-Type: application/json` on POST → assert `recordedHeaders[0]['content-type']` is defined AND contains `application/json`; plain GET → assert `recordedHeaders[0].host` is defined (changeOrigin:true rewrites to `127.0.0.1:${echoPort}` but the field remains present).
  - Uses `undici` fetch (already in package.json), `ws.WebSocket` + `ws.WebSocketServer` (already in package.json), `express` (already in package.json), native `FormData` + `Blob` (Node 20+ built-ins).

## Decisions Made

- **Bypass tunnel-cache by using `echoPort` as `tunnelPort`** — the proxy factory only needs a loopback port to pipe to; whether that port belongs to an SSH tunnel or a Node http server makes no difference at the proxy layer. Alternatives considered: (a) mock `withConnection` + `sshClient.forwardOut` to intercept the pipe — rejected because it would test the mock, not the proxy; (b) stand up a real SSH server in the test — rejected as unnecessarily heavy for a proxy-header-strip test. The bypass keeps the test 400 lines instead of ~800 and matches the plan's action-text guidance ("since proxy-factory expects a tunnelPort and the 'tunnel' is a real localhost socket to the echo, passing echoPort directly bypasses tunnel-cache").
- **Consolidate assertions per negative test into one `expectNoDisallowedHeaders` helper** — the plan explicitly allowed this ("may collapse to 8 test blocks with parameterized assertions each covering all 3 header classes on one transport"). Result: 6 negative tests × 3 header-class assertions each = 18 boundary checks; 2 sanity tests × 1-2 assertions each = 3 more; 8 it() blocks total. Meets the plan's "AT LEAST 8 distinct `it(` blocks" acceptance floor exactly.
- **Include TWO `X-Skynet-*` headers (User-Id + Trace) rather than just one** — proves the strip catches the CLASS via prefix match, not just one hard-coded name. If a future refactor accidentally hard-codes `.removeHeader('x-skynet-user-id')` instead of iterating and prefix-matching, this test would catch it because `X-Skynet-Trace` would still leak.
- **Cast the fakeHost stub with `as unknown as Host` rather than fully populating every Host-interface field** — the proxy-factory reads `target.hostname`, `target.port`, and treats `target.host` as opaque (never dereferenced in proxy-factory.ts). A minimal stub (~18 fields, most set to false / [] / "") is enough to satisfy TypeScript's structural check via the cast escape hatch, and the alternative — fully populating all ~30 Host fields including tunnelConnections + statsConfig + terminalConfig — would be ~30 lines of irrelevant noise. Same integration-test-boundary pattern as user-avatars.integration.test.ts's dbProxy stubbing only what's called.
- **SSE test drains the response body to completion via `res.body.getReader()`** — undici's fetch resolves the promise on response-received (headers + first byte), but the request may still be in-flight from the echo's perspective if we don't drain. The echo sends one `data: hello\n\n` event then ends, so drain-to-completion is bounded (single read → done=true on the next read). Without draining, the assertion would sometimes race the request-recording write.
- **WS test uses `setImmediate` + `ws.close()` after `open`** — the echo's WebSocketServer.handleUpgrade pushes to `recordedUpgradeHeaders` BEFORE the WS is accepted, so recording is complete by the time the client's `open` event fires. The `setImmediate` gives one event-loop turn of spacing between open and close so the accept-then-close race stays deterministic. Timeout of 5s handles the (unlikely) case where WS negotiation stalls.
- **Redirect test uses `redirect: "follow"` on undici fetch** — undici transparently follows the 302, which sends a NEW GET to `/redirected` through the proxy again. Both hops get recorded on the echo, and both `recordedHeaders[0]` (initial `/redirect-me`) and `recordedHeaders[1]` (followed `/redirected`) are asserted. This tests that the strip doesn't have a "first-request-only" bug — every request through the proxy pipeline gets stripped independently.

## Deviations from Plan

None. The plan's action text mapped 1:1 to the shipped test file. The plan explicitly allowed the "8 test blocks with parameterized assertions each covering all 3 header classes on one transport" collapse — which is exactly what shipped.

**Mutation-test spot-check:** the plan's `<verification>` allows skipping the actual mutation edit and instead verifying via grep that the tests exercise the removeHeader path. Confirmed via `grep 'removeHeader\|stripToAllowlist' src/backend/serve-url/proxy-factory.ts`: shows `stripToAllowlist` called in both `on.proxyReq` (L184) and `on.proxyReqWs` (L199), which is the code path this test's negative assertions exercise via the proxy pipeline. If either call were removed, the test's Cookie/Authorization/X-Skynet-* assertions would fail because the disallowed headers would reach the echo. The sanity tests (Content-Type + Host) additionally would still pass in that scenario, distinguishing "strip is broken" from "middleware is broken."

## Issues Encountered

None. Tests passed on first run; TypeScript compiled clean; no auth gates; no missing deps (ws + undici + express + http-proxy-middleware all present from prior plans + fleet baseline).

## Threat Register Realization

Realizes the following threats from the plan's `<threat_model>`:

| Threat ID | Category | Component | Realized by |
|-----------|----------|-----------|-------------|
| T-103-19 | Tampering | Test coverage gap allowing regression in allowlist-strip | 6 transport scenarios × 3 header classes = 18 boundary assertions via `expectNoDisallowedHeaders(recordedHeaders[N])` per test. Mutation-test spot-check documented via grep in the Deviations section — if `stripToAllowlist` were removed from either hook, negative tests would fail |
| T-103-20 | Repudiation | Test that always passes regardless of implementation | 2 sanity tests assert Content-Type + Host DO pass through the strip. If the middleware were a no-op (pipeline broken), the sanity tests would still pass because raw headers would flow, but the negative tests would ALSO all fail because the disallowed headers would leak. If the strip were TOO aggressive (wholesale delete), sanity tests would fail. The combination of both signals uniquely identifies "strip is correct" from "strip is broken" from "middleware is broken" |
| T-103-21 | Denial of service | Test flakiness from real network I/O | Localhost-only echo + localhost proxy = deterministic. Explicit timeouts on WS open (5s), SSE stream-drain bounded by server ending after one event, afterAll uses Promise-wrapped server.close() to avoid hanging. Tests run in ~600ms wall-clock total |

## Verification

- `npx vitest run src/backend/serve-url/tests/no-cookie-egress.integration.test.ts`: exit 0, 8 tests passed in ~584ms
- `npx tsc --noEmit`: exit 0, no output
- `test -f src/backend/serve-url/tests/no-cookie-egress.integration.test.ts`: exit 0
- `grep -c '^\s*it(' src/backend/serve-url/tests/no-cookie-egress.integration.test.ts`: 8 (meets `≥ 8` floor)
- `grep -c 'expectNoDisallowedHeaders' src/backend/serve-url/tests/no-cookie-egress.integration.test.ts`: 8 (definition + 6 negative test calls + 1 helper docblock reference = 8 hits)
- `grep -c 'http.createServer' src/backend/serve-url/tests/no-cookie-egress.integration.test.ts`: 3 (echo + proxy + docblock reference)
- `grep -c 'new WebSocket' src/backend/serve-url/tests/no-cookie-egress.integration.test.ts`: 2 (test creation + import inline reference)
- `grep -c 'text/event-stream' src/backend/serve-url/tests/no-cookie-egress.integration.test.ts`: 6 (SSE server-side branch + client Accept header + test name + docblock refs)
- `grep -c 'FormData' src/backend/serve-url/tests/no-cookie-egress.integration.test.ts`: 3 (test body — new FormData + form.append + docblock)
- `grep -c 'redirect' src/backend/serve-url/tests/no-cookie-egress.integration.test.ts`: 10 (server-side 302 branch + client `redirect: "follow"` + test name + docblock refs)
- Mutation-test spot-check via grep: `stripToAllowlist` called at proxy-factory.ts L184 (HTTP hook) + L199 (WS hook) — the negative tests exercise both hooks via the fetch (HTTP) and ws.WebSocket (WS) transports

## Next Phase Readiness

- **Plan 05 (subdomain-dispatch + serve-route) — READY.** Plan 05 wires proxy-factory into the actual request-dispatch layer (parsing `<hostname>-<port>` subdomain labels, resolving hosts via `resolveHostByName(name, userId)`, getting a tunnel from tunnel-cache, then calling `getOrCreateProxyForTarget(target, tunnelPort)`). This test guards proxy-factory in ISOLATION. Any Plan-05 dispatch bug that bypasses the proxy or fails to invoke `getOrCreateProxyForTarget` would need its own test — this file guards the proxy-factory itself, not the plumbing that reaches it.
- **CI gate for D-05 is now in place.** Any PR against the main branch that touches proxy-factory.ts (or its dependencies types.ts + header-audit-sampler.ts) automatically runs this test via `npx vitest run` in the ship-gate. The gate is at container-deploy time per box-maintainer's test discipline (Ashley 2026-09-07: scoped during dev, full suite as first step of deploy motion). D-05's "MUST pass to merge" is now structurally enforced.
- **No blockers.** All acceptance criteria met; test file exists at the expected path; tests pass; tsc clean.

## Self-Check: PASSED

Files verified to exist on disk:
- FOUND: `src/backend/serve-url/tests/no-cookie-egress.integration.test.ts`

Commits verified in git log:
- FOUND: `7e5e9946` (test(103-04): add D-05 no-cookie-egress integration test for proxy-factory)

Test suite verified:
- FOUND: 8 `it(` blocks (meets `≥ 8` requirement)
- FOUND: 6 negative transport scenarios (GET, POST-JSON, WebSocket, SSE, multipart, redirect) — each asserting all 3 disallowed header classes via `expectNoDisallowedHeaders` helper
- FOUND: 2 sanity tests (Content-Type + Host pass-through)
- FOUND: real `http.createServer` echo upstream + real Express proxy app (not fully mocked, per D-05 integration-test intent)
- FOUND: `npx vitest run` on this file exits 0 (8 tests pass in ~584ms)
- FOUND: `npx tsc --noEmit` exits 0

---
*Phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2*
*Completed: 2026-09-10*
