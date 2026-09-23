---
phase: 111-frontend-stale-prevention-version-drift-hard-lock
verified: 2026-09-21T06:30:00Z
status: passed
score: 15/15 dimensions verified
overrides_applied: 0
human_verification:
  - test: "Trigger real drift in a live browser during a deploy — with SKYNET_BUILD_SHA changed between two container builds — and confirm the modal appears on the very first response after the deploy and that clicking Reload delivers a fresh session."
    expected: "Modal shows on drift within ~1 request; Reload lands the user back at approximately the same view running the new code; no reload loop; no reappearance of the modal after reload."
    why_human: "The Playwright drift-smoke spec (SKEW-15) is the deploy-time gate but is orchestrator-owned. End-to-end drift-through-a-real-deploy is not exercised by any executor-runnable test — SUMMARY-narrated behavior only becomes user-observable during a real deploy. Reliability was Ashley's explicit spirit anchor; her greenlight to close should hinge on watching this happen once."
  - test: "Run through Guacamole (RDP) drift-refusal in a real browser: open an RDP pane, then simulate a mid-session server-tag change and observe that the shell-level SkewLockModal takes over (not the per-pane connection overlay)."
    expected: "SKYNET_STALE_CLIENT: prefix flows through onError, shell-level modal paints, per-pane connection-error UI does NOT paint."
    why_human: "Guacamole's third-party client rendering + the per-pane error path bypass are visual/UX behaviors — the codebase branches correctly on the prefix but the end-user experience (which surface takes over) can only be judged by eye."
  - test: "Confirm palette-authority modal appearance under both light and dark pv theme variants."
    expected: "Modal contrast, borders, and button styling look correct in both themes; no fallback to shadcn bg/fg tokens."
    why_human: "CSS var resolution is style, not code — the code uses --color-pv-* tokens by contract, but visual correctness across themes is a human check."
---

# Phase 132: Frontend stale-prevention — version-drift hard-lock — Verification Report

**Phase Goal (verbatim from CONTEXT.md and shape file):**
> Guarantee that a user's Skynet browser session is never running client-side code out of agreement with the server it is talking to. On any drift signal, the app hard-locks and surfaces a non-dismissible modal with a single Reload button. There is no in-between state — a session is either provably current or provably stale.

**Verified:** 2026-09-21T06:30:00Z
**Status:** passed (with 3 human-verification items for real-deploy behavioral confirmation)
**Re-verification:** No — initial verification

---

## Dimension-by-Dimension Verification

### 1. Version tag baked in at build time — PASS

**Evidence:**
- `vite.config.ts:74-97`: builds a `buildId` at Vite config eval time via the priority chain (env `VITE_BUILD_ID` → `execSync git rev-parse --short=12 HEAD` → `"dev-<epoch-base36>"`), then bakes it into every bundle via the `define` block at L101-106 as `import.meta.env.VITE_BUILD_ID`.
- `src/ui/lib/client-build-id.ts:25-26`: single-source-of-truth const `CLIENT_BUILD_ID` reads the baked value with a `"dev-unknown"` fallback.
- `src/backend/config/server-build-id.ts:21-27`: reads `process.env.VITE_BUILD_ID` once at module load, exports both `SERVER_BUILD_ID` const and `getServerBuildId()` getter with a matching `"dev-unknown"` fallback.
- `docker/Dockerfile:30-31, 49-50, 86-91`: `ARG SKYNET_BUILD_SHA` declared in all three load-bearing stages (frontend-builder, backend-builder, final runtime); each stage sets `ENV VITE_BUILD_ID=${SKYNET_BUILD_SHA:-dev-unknown}` — the exact re-declaration pattern the plan (Pitfall 3) mandates.
- `docker/docker-compose.yml:47-48`: `build.args.SKYNET_BUILD_SHA: "${SKYNET_BUILD_SHA:-}"` propagates the ship-runbook env into the Dockerfile stages.

Both sides read the same env source (`VITE_BUILD_ID`), which is set from the same Dockerfile `ARG SKYNET_BUILD_SHA`, which is passed by `docker-compose.yml` from the shell's `SKYNET_BUILD_SHA` env. Byte-identical strings on both ends.

### 2. HTTP request stamping — airtight-by-construction — PASS

**Axios (all 8 instances):**
- `src/ui/main-axios.ts:474-478`: `config.headers.set("X-Skynet-Client-Build", CLIENT_BUILD_ID)` inside `createApiInstance()` request interceptor (the `else` branch covers `axios-mock-adapter`'s plain-object headers).
- All 8 axios instances derive from `createApiInstance` (grep confirms at L952, 956, 959, 965, 968, 971, 974, 977 for hostApi, tunnelApi, fileManagerApi, statsApi, authApi, dashboardApi, rbacApi, dockerApi). Single edit covers all 8 — airtight-by-construction as D-04 requires.

**Raw fetch (10 rewrapped, 2 explicitly out-of-scope):**
- `src/ui/lib/stamped-fetch.ts:27-38`: `stampedFetch()` helper normalizes headers and forces `X-Skynet-Client-Build`.
- Rewrapped sites (grep confirms): `branding/branding-fetch.ts`, `api/voice-api.ts` (streaming preserved), `api/message-queue-api.ts` (2 sites), `lib/console-forwarder.ts`, `api/identities-api.ts` (streaming preserved), `api/compose-drafts-api.ts`, `features/pretty-view/useVoiceRecording.ts`, `features/pretty-view/RelayInboundBubble.tsx`, `features/pretty-conversations/WeeklyUsageMeter.tsx`.
- Explicitly out-of-scope (documented in code):
  - `sidebar/CreateRoleDialog.tsx:415-418` and `features/pretty-view/RoleCosmeticEditBlock.tsx:258-260` — external avatar-candidate fetches (do NOT leak client-build to third parties).
  - `auth/ElectronServerConfig.tsx:70, 81` — Electron server-config probes hitting user-configured remote installs.
- No other raw-fetch call sites in `src/ui/` outside these annotated exemptions. Coverage complete.

### 3. Server-side global refusal — PASS

**Evidence:**
- `src/backend/database/database.ts:319-330`: mount order is `cookieParser()` → `createSubdomainDispatchMiddleware()` → `serveUrlHandler` → `createSkewLockMiddleware()` → `bodyParser.*`. Correct — after serveUrlHandler (Pitfall 7: `*.serve.term.<domain>` traffic bypasses), before body parsing (header-only check runs cheap).
- `src/backend/database/skew-lock-middleware.ts:40-96`:
  - `serverBuild` captured at factory-call time (L41) — read-once contract per D-16.
  - `res.setHeader("X-Skynet-Server-Build", serverBuild)` always fires (L50) — D-01 lane B.
  - `clientBuild === null` (absence) OR `clientBuild === serverBuild` → `next()` (L57-61) — D-06 mismatch-only enforcement.
  - Array-typed header treated as absence (L52-55) — fail-open on non-browser callers.
  - Dev-mode escape hatch: `process.env.NODE_ENV !== "production"` → `next()` (L69-73) — SKEW-13.
  - Prod mismatch: `res.status(409).json({ error: "stale_client", clientBuild, serverBuild })` with structured warn log (`operation: "skew_lock_stale_client_refused"`) and 32-char log-flood cap (L75-95).

**Note on task prompt clause "or when SERVER_BUILD_ID is empty":** The implementation does not add a dedicated empty-SERVER_BUILD_ID escape, but the plan's SKEW-13 requirement is `NODE_ENV !== "production"`, which is what SUMMARY 03 and REQUIREMENTS.md state. An empty env value cannot arise because `getServerBuildId()` returns `"dev-unknown"` when the env is unset (server-build-id.ts:21), so absence resolves to a non-empty stable string. Match with task-prompt spirit (dev-mode escapes) is preserved.

### 4. WS handshake refusal on 5 servers — PASS

**Shared helper:** `src/backend/utils/skew-tag.ts:12-22` — `extractSkewTag(req)` parses `?build=<tag>` from the upgrade URL, returns `null` on absence.

**Enforcement sites (grep + read confirmed):**
- `src/backend/claude-session/claude-session-server.ts:4127-4133`: `extractSkewTag(req)`, refuses absence OR mismatch with `ws.close(4409, "stale_client")`.
- `src/backend/ssh/terminal.ts:151-157`: same pattern.
- `src/backend/ssh/docker-console.ts:297-303`: same pattern.
- `src/backend/relay-room-stream/relay-room-stream-server.ts:1202-1208`: same pattern.
- `src/backend/fleet-status/fleet-status-server.ts:180-195`: same pattern (scoped to the frontend `/fleet-status/ws` path per SUMMARY 05 — the `/watcher` path is box-side/tailscale-trusted, non-browser, legitimately omits `?build=`).
- **Guacamole (5th "server" — encrypted-token variant):** `src/backend/guacamole/guacamole-server.ts:225-272`. Refuses in `server.on("open")` when `clientConnection.connectionSettings?.buildId !== SERVER_BUILD_ID`. Emits `SKYNET_STALE_CLIENT:<serverBuild>` guac error instruction via `sendErrorToClient(...)`, closes underlying WebSocket with `close(4409, "stale_client")`. `src/backend/guacamole/token-service.ts:161, 184, 207`: all three token issuance paths stamp `buildId: getServerBuildId()`.

All 5 surfaces refuse on mismatch with a distinguishable close code / prefix.

### 5. WS outbound message piggyback on 4 JSON servers — PASS

**Approach split (per plan):** monkey-patched `ws.send` for large files, direct `sendFrame` for small.

- `src/backend/claude-session/claude-session-server.ts:4150-4176`: connection-scope monkey-patch of `ws.send` — any outbound string starting with `{` gets `build: <SERVER_BUILD_ID>` injected top-level. Raw/binary sends pass through.
- `src/backend/ssh/terminal.ts:175-197`: same monkey-patch pattern.
- `src/backend/ssh/docker-console.ts:321-343`: same monkey-patch pattern.
- `src/backend/relay-room-stream/relay-room-stream-server.ts:1255-1272`: direct `sendFrame` at 2 sites (small file).
- `src/backend/fleet-status/fleet-status-server.ts:247-252`: direct `sendFrame` at 2 sites (outFrame + pong).

All 4 JSON-envelope servers stamp outbound with `build: <SERVER_BUILD_ID>`. Guacamole is explicitly OMITTED per Pitfall 1 (third-party wire protocol has no envelope).

### 6. Client WS drift detection — PASS

**All 4 client `new WebSocket()` sites stamp handshake URL AND detect close-4409 + parsed.build mismatch:**

- `src/ui/api/claude-session-api.ts:33` (URL stamp), :72-84 (close 4409 → `ws_handshake_mismatch`), :107-111 (per-message `parsed.build !== CLIENT_BUILD_ID` → `ws_message_tag_mismatch`).
- `src/ui/api/fleet-status-client.ts:77-78` (URL stamp), :235-247 (close 4409), :148-151 (per-message).
- `src/ui/features/pretty-view/sources/relay-room-api.ts:59` (URL stamp), :88-100 (close 4409), :119-123 (per-message).
- `src/ui/features/terminal/Terminal.tsx:1304-1310` (URL stamp), :2201-2213 (close 4409), :1499-1503 (per-message).

All four cover both lanes. Close logs use explicit field extraction (`event.code`, `event.reason`, `event.wasClean`) — never `JSON.stringify(event)` (Pitfall 5 / role-file directive).

### 7. Guacamole client `SKYNET_STALE_CLIENT:` prefix — PASS

- `src/ui/features/guacamole/GuacamoleApp.tsx:51`: `const STALE_CLIENT_MARKER = "SKYNET_STALE_CLIENT:"`.
- `src/ui/features/guacamole/GuacamoleApp.tsx:308-325`: `onError` branches on `err.startsWith(STALE_CLIENT_MARKER)`, extracts the trailing `<serverBuild>`, calls `lockSkewedSession({ reason: "ws_handshake_mismatch", clientBuild: CLIENT_BUILD_ID, serverBuild })`, sets `takenOverRef.current = true` to suppress the reconnect fallback that `onDisconnect` would otherwise fire, then `return` BEFORE `setConnectionError` (so the per-pane overlay does NOT paint — shell-level modal takes over).

Mirrors the takeover-refusal (`SKYNET_SUPERSEDED:`) pattern with a distinguishable prefix.

### 8. Skew-lock store — first-drift-wins idempotency — PASS

- `src/ui/state/skew-lock-store.ts:53-65`: state and listeners are module-scope, not per-component.
- L105-132: `lockSkewedSession()` short-circuits with `if (state.locked) return;` on L110 — first-drift wins. On the first call: state mutates to a fresh immutable object (reference change so `useSyncExternalStore` sees a new snapshot), single `console.warn` with explicit-field structured log, listeners fire once.
- L73-75: `getSkewLockedSnapshot()` returns `state` (reference-stable across calls until a mutation) — satisfies `useSyncExternalStore` snapshot identity contract.
- L83-88: `subscribeSkewLock(fn)` returns a disposer.
- L141-145: `__resetForTest()` guarded on `NODE_ENV === "test"`.

Behavior contract exactly matches SKEW-03. Vitest run of `src/ui/state/skew-lock-store.test.ts` (bundled with 34 other tests below) passes.

### 9. Modal — non-dismissible, single button, palette-authority — PASS

- `src/ui/features/skew-lock/SkewLockModal.tsx:82-131`:
  - `role="dialog"` `aria-modal="true"` `aria-labelledby="skynet-skew-lock-title"` (L91-93).
  - `fixed inset-0 z-[9999]` full-viewport backdrop (L84).
  - Palette: `var(--color-pv-base)`, `var(--color-pv-border-quiet-strong)`, `var(--shadow-pv-root)`, `var(--color-pv-fg)`, `var(--color-pv-fg-muted)` — all `--color-pv-*` tokens, no shadcn bg/fg fallback (L89, 98-101, 106, 112, 121-122).
  - `inert` applied to `#root` while locked via `useEffect` (L53-62).
  - Single Reload button, no X, no escape/click-outside handler (L116-128).
  - Non-dismissible: no `onKeyDown` on Esc, no backdrop `onClick` handler at all.
  - Title "A newer version is available" / body "Reload to continue." / button "Reload" (L108-127).

Mounted at App root: `src/main.tsx:245` as a sibling of `<Toaster>` — verified.

### 10. Reload-loop mitigation — PASS

- `src/ui/features/skew-lock/reload-loop-sentinel.ts:27-29`: `STORAGE_KEY = "skynet_skew_reload_history"`, `WINDOW_MS = 60_000`, `THRESHOLD = 3` (i.e. the 4th trips it — matches plan spec "> 3 activations within 60s").
- L68-73: `recordReloadAttempt()` appends `Date.now()` to a sessionStorage-persisted array, prunes to the 60s window.
- L80-88: `shouldSuppressReload()` returns `true` when `pruned.length > THRESHOLD`.
- L33-58: fail-open on any storage exception (JSON parse, quota, disabled) — does NOT compound.
- Consumed at `SkewLockModal.tsx:69`: top-level `fatal = shouldSuppressReload()` split — fatal-mode renders "Something is wrong" / "Please contact support." / NO Reload button (button rendered inside `{!fatal && ...}` guard at L116).
- Belt-and-suspenders re-check inside click handler (L78) so a race between the record + the render can't reload out of fatal mode.

Fatal-mode does not reload — the Reload button is REPLACED with the support message. sessionStorage isolation gives per-tab counters (D-17).

### 11. Shell-page cache discipline — PASS

**Three enforcement layers, all annotated with Phase 132 cross-reference:**

- `docker/nginx.conf:132-146`: `Phase 132 SKEW-14: no-store on index.html is LOAD-BEARING` comment, `location /` block with `add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" always;`.
- `docker/nginx-https.conf:143-157`: same block, same Phase 132 comment.
- `src/backend/database/database.ts:2074-2081`: Phase 132 SKEW-14 comment above the `express.static` setHeaders callback that stamps no-store on `index.html`/`sw.js`/`manifest.json`.
- `src/backend/database/database.ts:2094-2101`: SECOND Phase 132 SKEW-14 comment above the branding SPA fallback middleware setHeader (covers the templated index.html path).

Assets (JS/CSS bundles) remain aggressively cacheable at `docker/nginx.conf:117` and `docker/nginx-https.conf:128` (`public, max-age=31536000, immutable`) — Vite content-hashed filenames make this safe.

### 12. Assertion vitest guards — PASS

- `src/backend/database/cache-headers.test.ts:32-140`: five tests guard the three enforcement layers:
  1. `docker/nginx.conf` contains the no-store block.
  2. `docker/nginx-https.conf` contains the no-store block.
  3. `database.ts` contains the block at >= 2 sites (static setHeader + SPA fallback).
  4. Nginx parity — both configs contain the block (Pitfall 2).
  5. All three files carry the `"Phase 132 SKEW-14"` cross-reference comment (2+ times in database.ts).

**Executed:** `npx vitest run src/backend/database/cache-headers.test.ts` — 5/5 pass, 273ms.

### 13. Playwright drift-smoke spec parses — PASS

- `tests/e2e/skew-lock.spec.ts:40-105`: Phase 132 SKEW-15 spec. Uses `loginViaUI` + `readCreds` from existing `tests/e2e/helpers/auth.ts`; injects mismatched `x-skynet-server-build` via `page.route("**/host/**", ...)`; asserts the `role="dialog"` modal with title matching `/newer version/i` becomes visible within 5s; unroutes; clicks Reload; asserts modal absent after `waitForLoadState("networkidle")`.
- **Executed:** `npx playwright test --list tests/e2e/skew-lock.spec.ts` — 2 tests listed (chromium + mobile-iphone projects). Spec parses cleanly.

### 14. Deploy safety respected — PASS

`git log` for phase-132 commits (28 total on the current branch) shows only executor-scope conventional commits: `feat`, `docs`, `test`, `chore`. No commit invokes `git push`, `docker build`, or `docker compose up --force-recreate`. Full commit list:

```
docs(132-07), test(132-07), test(132-07), docs(132-07),
docs(132-06), feat(132-06), feat(132-06),
docs(132-05), feat(132-05), feat(132-05), feat(132-05), feat(132-05),
docs(132-04), feat(132-04), feat(132-04), feat(132-04),
docs(132-03), feat(132-03), feat(132-03),
docs(132-02), feat(132-02), feat(132-02), feat(132-02),
docs(132-01), chore(132-01), feat(132-01), feat(132-01),
docs(111), docs(111), docs(111)
```

Deploy motion is orchestrator-exclusive (role file § Standing directives). Respected.

### 15. Test discipline respected — PASS

Every `<automated>` block in every plan file uses `npx vitest --related <specific-files> run`. No `npx vitest run` bare / full-suite invocation in any plan.

**Actual test execution during verification (scoped to phase 111 impacted files):**
- 7 phase-132-core scoped tests (skew-lock-store, skew-lock-middleware, reload-loop-sentinel, skew-tag, server-build-id, client-build-id, stamped-fetch): **35/35 pass**.
- Cache-headers assertion tests: **5/5 pass**.
- SkewLockModal + reload-loop-sentinel `.test.tsx` feature tests: **12/12 pass**.
- Full WS servers + guacamole tests (claude-session, ssh, relay-room-stream, fleet-status, guacamole): **1348 pass, 1 skipped, 0 failing** in 33.62s.
- UI api + main-axios + guacamole tests: **202 pass** in 12.78s.

Total scoped test run: **1602 passing, 1 skipped, 0 failing**.

---

## Requirements Coverage (SKEW-01 through SKEW-15)

| ID | Description | Status | Evidence |
|----|-------------|--------|----------|
| SKEW-01 | Byte-stable build-id at build time via Vite `define` + Docker ARG propagation | SATISFIED | vite.config.ts:86-97, Dockerfile L30/49/86-91, docker-compose.yml:47-48, client-build-id.ts, server-build-id.ts |
| SKEW-02 | Backend module-load capture + boot log line | SATISFIED | server-build-id.ts:21 + database.ts:156-162 (`operation: "server_boot_build_id"`) |
| SKEW-03 | Module-scope idempotent skew-lock store | SATISFIED | skew-lock-store.ts (all API surfaces present + tested) |
| SKEW-04 | Airtight-by-construction client stamping | SATISFIED | main-axios.ts:474-478 (8 instances) + stamped-fetch.ts + 10 rewrapped call sites |
| SKEW-05 | Server middleware, mismatch-only 409 | SATISFIED | skew-lock-middleware.ts + database.ts:320-330 mount |
| SKEW-06 | Client axios response drift detection (2 signals) | SATISFIED | main-axios.ts:527-547 (header mismatch), :643-664 (409 stale_client) |
| SKEW-07 | WS handshake refusal on 5 servers | SATISFIED | All 5 servers grep-confirmed with `extractSkewTag` + `ws.close(4409, "stale_client")` |
| SKEW-08 | WS outbound piggyback on 4 JSON servers | SATISFIED | All 4 servers grep-confirmed with `build: SERVER_BUILD_ID` |
| SKEW-09 | Client WS drift detection (URL stamp + 4409 + parsed.build) on 4 sites | SATISFIED | All 4 client sites grep-confirmed |
| SKEW-10 | Guacamole handshake-only via encrypted token buildId | SATISFIED | token-service.ts:161/184/207, guacamole-server.ts:225-272, GuacamoleApp.tsx:308-325 |
| SKEW-11 | SkewLockModal non-dismissible single-button | SATISFIED | SkewLockModal.tsx + main.tsx:245 mount |
| SKEW-12 | Reload-loop sentinel fatal-mode | SATISFIED | reload-loop-sentinel.ts + SkewLockModal.tsx fatal branching |
| SKEW-13 | Dev-mode escape hatch | SATISFIED | skew-lock-middleware.ts:69-73 |
| SKEW-14 | Cache-Control codification (3 layers, comments, tests) | SATISFIED | nginx.conf L132, nginx-https.conf L143, database.ts L2074+2094, cache-headers.test.ts (5 tests pass) |
| SKEW-15 | Playwright drift-smoke spec parses | SATISFIED | tests/e2e/skew-lock.spec.ts parses under `--list` |

15/15 requirements covered by shipped code.

---

## Ashley's Reliability Anchor Check

*"if what we've designed doesn't work reliably. because we came up with a pretty airtight plan"*

The airtight-by-construction design is intact:
- **HTTP lane:** All 8 axios instances stamp via one interceptor edit; all raw-fetch sites either use stampedFetch or are annotated out-of-scope. No code path a stale session can travel that skips the stamp.
- **WS handshake lane:** All 5 WS surfaces refuse mismatch/absence at handshake. All 4 JSON servers stamp outbound messages so idle tabs learn of drift the moment ANY server message arrives.
- **Global refusal:** Server middleware is mounted BEFORE bodyParser and BEFORE every route handler — no per-route opt-in (D-07, the class-1 defect vms's Phase 29 fixed).
- **Idempotent lock:** Store transitions once per tab lifetime; concurrent burst of drift signals from three lanes can't cause a notify storm or diagnostic-field overwrite.
- **Reload-loop guard:** sessionStorage-per-tab counter goes fatal-mode (no Reload button, contact-support message) after 4th activation in 60s — the user can't get stuck in a loop.
- **Shell cache discipline:** Three enforcement layers plus a vitest guard that fails CI on deletion.
- **Test coverage:** 1602 scoped tests passing (35 phase-132-specific, plus every WS server / client-side lane touched by the diff still green).

---

## Gaps

None material to the phase goal.

## Deferred

None — the 3 items listed in `human_verification` (real-deploy behavioral confirmation, Guacamole visual, palette theme sweep) are visual/behavioral checks that grep can never verify. Ashley's reliability anchor points to at least one of these being observed live before closing.

---

## VERIFICATION COMPLETE

**Verdict: passed**

All 15 verification dimensions pass with concrete codebase evidence. All 15 SKEW-nn requirements are satisfied by shipped code. All scoped tests pass (1602 passing, 1 skipped, 0 failing). The airtight-by-construction philosophy Ashley locked in the shape file is preserved through every lane: HTTP request, HTTP response, WS handshake, WS outbound message, guacamole encrypted-token, shell-page cache. Executor-scope commit discipline respected. Test discipline respected.

Three human-verification items surfaced for real-deploy behavioral confirmation — none are gaps in the shipped code, they are the reliability-anchor UAT that Ashley's spirit calls for before final `/close`.

_Verified: 2026-09-21T06:30:00Z_
_Verifier: Claude (gsd-verifier)_
