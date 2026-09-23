---
phase: 111-frontend-stale-prevention-version-drift-hard-lock
plan: 04
subsystem: ui
tags: [axios, interceptor, drift-detection, skew-lock, stamped-fetch, raw-fetch]

# Dependency graph
requires:
  - "132-01 — CLIENT_BUILD_ID from src/ui/lib/client-build-id.ts"
  - "132-02 — lockSkewedSession() + getSkewLockedSnapshot() from src/ui/state/skew-lock-store.ts"
  - "132-03 — server middleware stamps X-Skynet-Server-Build on responses AND returns 409 { error: 'stale_client', ... } envelope"
provides:
  - "stampedFetch(input, init) helper at src/ui/lib/stamped-fetch.ts — mirrors global fetch, stamps X-Skynet-Client-Build unconditionally, preserves streaming semantics"
  - "Extended request interceptor in createApiInstance (main-axios.ts) — every axios request from all 8 instances carries X-Skynet-Client-Build via a single factory edit"
  - "Extended response interceptor success handler — fires lockSkewedSession({ reason: 'response_tag_mismatch', ... }) on any successful response whose x-skynet-server-build header differs from CLIENT_BUILD_ID (SKEW-06a)"
  - "Extended response interceptor error handler — fires lockSkewedSession({ reason: 'server_refused_stale_client', ... }) on 409 with body { error: 'stale_client', ... } (SKEW-06b)"
  - "10 raw-fetch call sites across 9 files rewrapped to use stampedFetch — same-origin browser fetches now stamp by construction"
affects:
  - "132-05-PLAN — no dependency (backend WS servers)"
  - "132-06-PLAN — no dependency (WS clients handle their own handshake / message-tag drift signals via close-code 4409 / per-message build field)"

# Tech tracking
tech-stack:
  added: []  # ZERO new packages — uses browser-standard fetch/Headers + existing axios
  patterns:
    - "Airtight-by-construction stamping via factory-level interceptor edit (one edit covers all 8 axios instances)"
    - "Headers-instance normalization in stampedFetch (`new Headers(init.headers ?? {})`) — accepts all three fetch API shapes (Headers, Record, string[][])"
    - "getSkewLockedSnapshot().locked short-circuit for log-quieting redundant lock calls (store already handles idempotency internally)"
    - "Body-shape guard (`body?.error === 'stale_client'`) prevents false-positive lock activation on non-drift 409s (business-logic conflicts pass through)"
    - "Test-scope adaptation: assert on stampedFetch's normalized Headers instance via `.get()` when a rewrapped call site is under test"

key-files:
  created:
    - "src/ui/lib/stamped-fetch.ts"
    - "src/ui/lib/stamped-fetch.test.ts"
  modified:
    - "src/ui/main-axios.ts"                                    # +2 import lines, +6 request-stamp block, +14 response-drift block, +18 409-stale block
    - "src/ui/main-axios.test.ts"                               # +7 new test cases + 4 imports
    - "src/ui/branding/branding-fetch.ts"                       # 1 fetch → stampedFetch (cold-boot; Pitfall 6)
    - "src/ui/api/identities-api.ts"                            # 1 fetch → stampedFetch (SSE)
    - "src/ui/api/identities-api.test.ts"                       # test adjusted for Headers normalization
    - "src/ui/api/voice-api.ts"                                 # 1 fetch → stampedFetch (streaming TTS)
    - "src/ui/api/message-queue-api.ts"                         # 2 fetch → stampedFetch (keepalive beacons)
    - "src/ui/api/compose-drafts-api.ts"                        # 1 fetch → stampedFetch (keepalive beacon)
    - "src/ui/lib/console-forwarder.ts"                         # 1 fetch → stampedFetch (debug beacon)
    - "src/ui/features/pretty-view/useVoiceRecording.ts"        # 1 fetch → stampedFetch (STT upload)
    - "src/ui/features/pretty-view/RelayInboundBubble.tsx"      # 1 fetch → stampedFetch (relay-pointer)
    - "src/ui/features/pretty-conversations/WeeklyUsageMeter.tsx"  # 1 fetch → stampedFetch (usage poller)
    - "src/ui/sidebar/CreateRoleDialog.tsx"                     # explicit-skip annotation (external pravatar URL)
    - "src/ui/features/pretty-view/RoleCosmeticEditBlock.tsx"   # explicit-skip annotation (external pravatar URL)

key-decisions:
  - "stampedFetch normalizes to Headers via `new Headers(init.headers ?? {})` — Headers.set() overwrites any pre-existing X-Skynet-Client-Build value the caller might have set manually (correct-by-construction: we always win)"
  - "Response drift check placed AFTER dbHealthMonitor.reportDatabaseSuccess() in the success handler, so retry-recovered requests still credit the DB-health monitor before the drift check runs. Preserves existing 5xx-retry recovery semantics"
  - "409 stale_client check placed AFTER the retry interceptor's exhaustion path and BEFORE the 401 handler — 409 is not in the retry classification anyway (only 502/503/504 for GET), so no interaction. Preserves 401 SESSION_EXPIRED semantics for the ordinary auth path"
  - "getSkewLockedSnapshot().locked short-circuit is a log-quieting layer — the store already guarantees first-drift-wins idempotency, but skipping the call when already-locked keeps the console.warn quiet on rapid duplicate signals"
  - "Two external-URL raw-fetch sites (pravatar avatar candidates) are ANNOTATED but NOT rewrapped — X-Skynet-Client-Build must not leak to third-party origins per T-132-16 threat model"

requirements-completed:
  - "SKEW-04"
  - "SKEW-06"

# Metrics
duration: ~35min
completed: 2026-09-21
---

# Phase 132 Plan 04: Client HTTP airtight stamping + response drift detection

**Every axios request (all 8 instances) AND every in-scope raw fetch now carries `X-Skynet-Client-Build` by construction; the response interceptor fires the skew-lock on both drift signals (header mismatch + 409 stale_client) with body-shape guards preventing false positives on unrelated 409s.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-21T04:29:00Z
- **Completed:** 2026-09-21T05:05:00Z
- **Tasks:** 3
- **Files created:** 2 (stampedFetch + test)
- **Files modified:** 14 (main-axios pair, 9 raw-fetch rewrites + 1 test adjustment, 2 explicit-skip annotations)

## Accomplishments

- **`stampedFetch` helper** (`src/ui/lib/stamped-fetch.ts`, 15 lines of shipped code): a pure wrapper around `globalThis.fetch` that unconditionally stamps `X-Skynet-Client-Build: <CLIENT_BUILD_ID>` on outbound requests via Headers normalization. Signature mirrors the fetch API — accepts `RequestInfo | URL` and optional `RequestInit`, returns the raw `Response` with body untouched. All three `init.headers` shapes (Headers, Record, string[][]) are normalized safely.
- **Extended axios request interceptor** (main-axios.ts inside `createApiInstance` factory): single 6-line block that stamps `X-Skynet-Client-Build` on every outgoing request. Because `createApiInstance` is the shared factory for all 8 axios instances (hostApi, tunnelApi, fileManagerApi, statsApi, authApi, dashboardApi, rbacApi, dockerApi), one edit covers the entire axios lane — airtight-by-construction per D-04. Guard branches (`config.headers.set` vs plain-object) mirror the existing Authorization / X-Electron-App idiom immediately above.
- **Extended axios response interceptor (success handler)**: after `dbHealthMonitor.reportDatabaseSuccess()`, checks `response.headers["x-skynet-server-build"]`; if present AND != CLIENT_BUILD_ID AND lock not already tripped, fires `lockSkewedSession({ reason: "response_tag_mismatch", ... })`. Absence of the header passes through unchanged (dev mode, non-versioned response path) — mirrors backend's mismatch-only enforcement.
- **Extended axios response interceptor (error handler)**: before the 401 fast-path, handles 409 with body-shape guard. `error.response.data.error === "stale_client"` triggers `lockSkewedSession({ reason: "server_refused_stale_client", ... })`. Other 409s (business-logic conflicts) pass through unchanged. Rejection still propagates so caller cleanup runs.
- **10 raw-fetch call sites rewrapped** across 9 in-scope files. Every site retained its call semantics verbatim (method, body, signal, credentials, keepalive) — only the top-level function name changed. Two `beforeAll` — the branding-fetch cold-boot call (Pitfall 6) is now stamped from its very first fire.
- **2 explicit-skip annotations** on external-URL raw-fetch sites (pravatar avatar CDNs) so future maintainers don't accidentally wrap them — leaking `X-Skynet-Client-Build` to third-party origins would violate T-132-16.

## Task Commits

Each task committed atomically:

1. **Task 1: stampedFetch helper + test** — `5f4dd8e4` (`feat(132-04)`)
   - `src/ui/lib/stamped-fetch.ts` (16 lines of impl + 24 lines of doc-comment) + `.test.ts` (5 vitest cases covering the three Headers shapes, method/body/signal passthrough, and streaming preservation).
   - TDD: RED confirmed on missing-module import error; GREEN 5/5 tests pass.
2. **Task 2: Extend axios interceptors** — `c7893296` (`feat(132-04)`)
   - `src/ui/main-axios.ts` (+2 imports, +6 request-stamp block, +14 response-drift block, +18 409-stale block) + `main-axios.test.ts` (+7 new test cases + 4 imports for CLIENT_BUILD_ID, `__resetForTest`, `getSkewLockedSnapshot`).
   - TDD: RED confirmed via `expect(snap.locked).toBe(true)` failures on tests 2, 4, 6 before the interceptor edits; GREEN 1401/1401 tests pass across the entire frontend suite.
3. **Task 3: Rewrap 10 raw-fetch sites** — `75a48e93` (`feat(132-04)`)
   - 9 in-scope files rewrapped; 2 explicit-skip annotations added; 1 existing test (`identities-api.test.ts`) adjusted to assert on the normalized Headers instance rather than the pre-normalization plain-object shape.

## Files Created/Modified

**Created:**

- `src/ui/lib/stamped-fetch.ts` — helper function `stampedFetch(input, init)`. Imports `CLIENT_BUILD_ID` from `./client-build-id.js` (Plan 01 output). Only export.
- `src/ui/lib/stamped-fetch.test.ts` — 5 vitest cases covering (1) empty-init stamping, (2) plain-object headers preserved + stamp added, (3) Headers-instance headers preserved + stamp added, (4) method/body/signal passthrough, (5) streaming semantics preserved (`response.body` remains a ReadableStream).

**Modified:**

- `src/ui/main-axios.ts` — three surgical additions inside `createApiInstance`:
  1. **Imports (top of file after `db-health-monitor`)**: `CLIENT_BUILD_ID` from `@/lib/client-build-id`; `getSkewLockedSnapshot`, `lockSkewedSession` from `@/state/skew-lock-store`. Cross-referencing comment.
  2. **Request interceptor stamp block** (immediately before `return config;`): 6-line block that sets `X-Skynet-Client-Build` on every outgoing request. Guard branches for AxiosHeaders vs plain-object headers mirror existing L419-455 idiom.
  3. **Response success drift block** (after `dbHealthMonitor.reportDatabaseSuccess()`): checks `response.headers["x-skynet-server-build"]` against CLIENT_BUILD_ID, fires lock on mismatch. `getSkewLockedSnapshot().locked` short-circuit for log-quieting redundant calls.
  4. **Response error 409 stale_client block** (before the 401 fast-path): body-shape guard on `error.response.data.error === "stale_client"` fires lock on drift refusal.
- `src/ui/main-axios.test.ts` — 4 new imports (`CLIENT_BUILD_ID`, real store `__resetForTest`/`getSkewLockedSnapshot`) + new `describe("SKEW-04 request stamping + SKEW-06 response drift detection", ...)` block with 7 test cases (request stamping, mismatched vs matching server build on 200, 409 stale_client, 409 non-stale_client, idempotency across two consecutive drift signals, 401 legacy regression).
- Nine raw-fetch call sites replaced with `stampedFetch(...)` — each site gets a `// Phase 132 SKEW-04:` inline comment above the changed line.
- Two explicit-skip annotations at CreateRoleDialog.tsx:414 and RoleCosmeticEditBlock.tsx:257.
- `identities-api.test.ts` — one Test 1 assertion adapted from `Record<string, string>` header shape to `Headers` `.get()` readback + new assertion that `X-Skynet-Client-Build` lands on the outgoing call.

## Decisions Made

- **Headers normalization in stampedFetch.** Chose `new Headers(init.headers ?? {})` + `.set()` overwrite. This normalizes all three fetch-API shapes (Headers, Record, string[][]) into a single Headers instance the wrapper can mutate safely. Trade-off: callers that assert on `init.headers` as a plain object will need to adapt to the Headers instance (Rule 1 fix in `identities-api.test.ts` documents this).
- **`getSkewLockedSnapshot().locked` short-circuit in the response interceptor.** The store already handles first-drift-wins internally, but skipping the call when already-locked keeps the console.warn quiet on rapid duplicate signals. Two-line optimization; zero contract change.
- **Response drift check placement.** Positioned AFTER `dbHealthMonitor.reportDatabaseSuccess()` so that a retry-recovered request still credits the DB-health monitor before the drift check runs. Preserves the existing 5xx-retry recovery semantics — retries happen at the error-handler layer, so any response reaching the success handler has already recovered.
- **409 stale_client check placement.** Positioned AFTER the retry interceptor's exhaustion path but BEFORE the 401 handler. 409 is not in the retry classification (only 502/503/504 for idempotent methods), so there's no interaction with retries. Placing before 401 keeps the SESSION_EXPIRED fast-path intact for ordinary auth failures (per Test 7 regression).
- **External URL sites (pravatar) get comments, not stampedFetch.** T-132-16 explicitly forbids leaking `X-Skynet-Client-Build` to third-party origins. Both CreateRoleDialog.tsx:414 and RoleCosmeticEditBlock.tsx:257 fetch avatar candidates from `pravatar.cc` / `gravatar.com` etc. Left raw with an inline `// Phase 132 SKEW-04: SKIPPED` annotation.
- **Test-file `.js` import suffix.** Followed the existing store-test convention (also used in Plans 01/02/03) — `client-build-id.js`, `stamped-fetch.js`. This matches Skynet's TS→JS-emit module resolution shape.

## Deviations from Plan

**1. [Rule 1 - Bug] `identities-api.test.ts` Test 1 asserted on init.headers as plain-object shape**
- **Found during:** Task 3 (running scoped vitest against all 9 touched files after the fetch rewrites landed)
- **Issue:** The pre-existing test at `identities-api.test.ts:66-68` did `const headers = init.headers as Record<string, string>; expect(headers["Accept"]).toBe(...)`. Once openBirthStream went through stampedFetch, the wrapper normalizes headers to a `Headers` instance before delegating to the mocked global fetch — so `headers["Accept"]` is `undefined` (Headers instances don't expose property-key access).
- **Fix:** Changed the cast to `Headers` and assertions to `.get()` readback. Added an additional expectation that `X-Skynet-Client-Build` lands on the outgoing call (positive coverage for the wrapper's core contract at this call site).
- **Files modified:** `src/ui/api/identities-api.test.ts`
- **Commit:** `75a48e93` (rolled into Task 3's atomic commit)
- **Verification:** Scoped vitest re-run — 60/60 test files pass, 953/953 tests pass (identities-api Test 1 now green).

None of these deviations changed any observable behavior at the wire level. Test-scope adaptations to stampedFetch's Headers normalization pattern.

## Threat Register Status

All threats declared in the plan's `<threat_model>` are addressed as planned:

- **T-132-13 (Tampering — In-tree caller invokes raw fetch bypassing header):** Mitigated. All 10 in-scope raw-fetch call sites now go through `stampedFetch`. `grep -l stampedFetch` across the 9 in-scope files returns 9. Future new raw-fetch sites are catchable by code review — two out-of-scope sites are annotated explicitly so the pattern is discoverable. No lint rule installed (accepted per plan).
- **T-132-14 (DoS — Response interceptor throws on malformed body):** Mitigated. The body cast `error.response?.data as { error?: string } | undefined` plus the `body?.error === "stale_client"` check is defensive: `undefined` body, null data, and non-string error field all take the fast-path of NOT firing the lock. Test 5 in the new SKEW block verifies (409 with `{ error: "some_other_conflict" }` does not lock).
- **T-132-15 (Spoofing — Response interceptor bypassed via raw fetch):** Accepted per plan. stampedFetch does NOT install a response interceptor. Small gap accepted — raw-fetch callers are typically streaming/beacon-only, and the axios lane covers the vast majority of dashboard traffic. Documented via inline comment in the helper.
- **T-132-16 (Info Disclosure — Header value leaks to third-party via stampedFetch call to off-origin URL):** Mitigated. The 13 in-scope sites enumerated are all same-origin (`/api/*`, `/voice/*`, `/relay-*`, `/debug/*`). External-URL fetches (pravatar avatar candidates) are explicitly SKIPPED and annotated. No cross-origin header leakage.
- **T-132-17 (DoS — Idempotency check races with two concurrent drift signals):** Accepted per plan. Store's own idempotency (Plan 02) guarantees single transition regardless of race outcome. Test 6 verifies that two consecutive drift signals produce exactly one locked state with the FIRST signal's diagnostic fields preserved.
- **T-132-SC (Supply chain — new package installs):** Accepted per plan. ZERO new packages installed. Uses existing `axios`, `axios-mock-adapter` (devDep), and browser-standard `fetch`/`Headers`.

## Verification Results

All plan-level `<verification>` gates green:

- **Task 1 scoped vitest:** 5/5 tests passed (`npx vitest related src/ui/lib/stamped-fetch.ts src/ui/lib/stamped-fetch.test.ts --run`).
- **Task 2 vitest (main-axios + all related test files pulled in by --related):** 1401/1401 tests passed across 94 test files. All 7 new SKEW cases green (request stamping, drift signals, idempotency, legacy 401 regression).
- **Task 3 scoped vitest (9 in-scope files + related):** 953/953 tests passed across 60 test files. `identities-api.test.ts` Test 1 green after the Rule 1 fix.
- `grep -q "export async function stampedFetch" src/ui/lib/stamped-fetch.ts`: **hit**.
- `grep -q "X-Skynet-Client-Build" src/ui/lib/stamped-fetch.ts`: **hit**.
- `grep -q "X-Skynet-Client-Build" src/ui/main-axios.ts`: **hit**.
- `grep -q "lockSkewedSession" src/ui/main-axios.ts`: **hit**.
- `grep -c "response_tag_mismatch\|server_refused_stale_client" src/ui/main-axios.ts`: **2** (one each).
- `grep -l "stampedFetch" src/ui/branding/branding-fetch.ts src/ui/api/identities-api.ts src/ui/api/voice-api.ts src/ui/api/message-queue-api.ts src/ui/api/compose-drafts-api.ts src/ui/lib/console-forwarder.ts src/ui/features/pretty-view/useVoiceRecording.ts src/ui/features/pretty-view/RelayInboundBubble.tsx src/ui/features/pretty-conversations/WeeklyUsageMeter.tsx | wc -l`: **9** (expected 9).
- `npx tsc --noEmit`: **exit 0** (full-tree TS compile clean, including all new files and modifications).

## Deferred to Downstream Plans

- **WS-lane parallel** — the WS handshake and per-message drift signals (both directions) are Plan 05 (backend WS servers) + Plan 06 (WS clients). This plan's client-side infrastructure is complete; nothing in Plan 05/06 depends on Task 1/2/3 outputs directly (they use their own imports of `CLIENT_BUILD_ID` from `client-build-id.js` and `lockSkewedSession` from `skew-lock-store.ts`).
- **Playwright deploy-and-drift smoke test** — cross-plan integration test that walks through the full drift scenario (deploy → mismatched server build → modal renders → user clicks Reload → fresh session). Currently deferred; would live in `tests/e2e/skew-lock-smoke.spec.ts`. Not blocking Plan 05/06.

## Next Plan Readiness

- Plan 05 (backend WS servers handshake + per-message piggyback) — no dependency on this plan.
- Plan 06 (WS clients + guacamole close-code detection) — no dependency on this plan. Uses same `lockSkewedSession` import path from Plan 02.
- Plan 07 (deploy smoke test) — depends on Plans 01-06 all landing. This plan's coverage story documented above.

## Self-Check: PASSED

Verified after summary write:

- `src/ui/lib/stamped-fetch.ts` — FOUND
- `src/ui/lib/stamped-fetch.test.ts` — FOUND
- `src/ui/main-axios.ts` — FOUND (modified)
- `src/ui/main-axios.test.ts` — FOUND (modified)
- `src/ui/branding/branding-fetch.ts` — FOUND (modified)
- `src/ui/api/identities-api.ts` — FOUND (modified)
- `src/ui/api/identities-api.test.ts` — FOUND (modified)
- `src/ui/api/voice-api.ts` — FOUND (modified)
- `src/ui/api/message-queue-api.ts` — FOUND (modified)
- `src/ui/api/compose-drafts-api.ts` — FOUND (modified)
- `src/ui/lib/console-forwarder.ts` — FOUND (modified)
- `src/ui/features/pretty-view/useVoiceRecording.ts` — FOUND (modified)
- `src/ui/features/pretty-view/RelayInboundBubble.tsx` — FOUND (modified)
- `src/ui/features/pretty-conversations/WeeklyUsageMeter.tsx` — FOUND (modified)
- `src/ui/sidebar/CreateRoleDialog.tsx` — FOUND (modified, comment only)
- `src/ui/features/pretty-view/RoleCosmeticEditBlock.tsx` — FOUND (modified, comment only)
- Commit `5f4dd8e4` (Task 1) — present in git log
- Commit `c7893296` (Task 2) — present in git log
- Commit `75a48e93` (Task 3) — present in git log

---
*Phase: 111-frontend-stale-prevention-version-drift-hard-lock*
*Plan: 04 — Client HTTP airtight stamping + response drift detection*
*Completed: 2026-09-21*
