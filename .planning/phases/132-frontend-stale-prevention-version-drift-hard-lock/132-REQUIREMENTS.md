# Phase 132 Requirements Map

**Phase:** 111 — Frontend stale-prevention: version-drift hard-lock
**Minted:** 2026-09-21
**Source:** Derived from CONTEXT.md `<decisions>` block (D-01..D-20) and RESEARCH.md architectural map.

## Requirements

Each SKEW-nn is a testable outcome. Every plan's frontmatter `requirements:` field lists the SKEW-nn IDs its tasks satisfy; the union across all seven plans covers SKEW-01..SKEW-15.

| ID | Requirement | Ties to CONTEXT decisions | Plan owner(s) |
|----|-------------|---------------------------|---------------|
| SKEW-01 | Build-ID (git short SHA, 12 hex chars) is emitted at Vite build time via `import.meta.env.VITE_BUILD_ID` (see `vite.config.ts:75-79` `define` block extension). Byte-identical value read at backend startup from `process.env.VITE_BUILD_ID`. Dockerfile declares `ARG SKYNET_BUILD_SHA` in frontend-builder + backend-builder + final runtime stages; `docker/docker-compose.yml` passes the compose-level `SKYNET_BUILD_SHA` build-arg into every stage. Two exported getter modules exist: `src/ui/lib/client-build-id.ts` (`CLIENT_BUILD_ID` const) and `src/backend/config/server-build-id.ts` (`getServerBuildId()` fn). Fallback strategy for missing SHA: `dev-<epoch-base36>` (Vite eval-time via `execSync git rev-parse --short=12 HEAD`) or `dev-unknown` (backend runtime, when env unset). | D-18, D-16, D-01 | Plan 01 |
| SKEW-02 | Backend captures its build-id exactly once at module-load of `src/backend/config/server-build-id.ts`; a structured log line (`operation: "server_boot_build_id"`, `buildId`) is emitted at Express boot in `src/backend/database/database.ts` near L138 so operators can spot stale-env misconfigurations from the running container's logs. | D-16, Pitfall 4 | Plan 01 (getter) + Plan 03 (boot log) |
| SKEW-03 | A module-scope roll-your-own store at `src/ui/state/skew-lock-store.ts` exposes `lockSkewedSession({reason, clientBuild, serverBuild})`, `getSkewLockedSnapshot()`, `subscribeSkewLock(fn): () => void`, and `__resetForTest()` (behind `NODE_ENV === "test"`). Transition to locked state is idempotent (first drift wins). Structured console.warn on lock activation, never `JSON.stringify(event)` on DOM Events. | D-11, D-17 | Plan 02 |
| SKEW-04 | Client-side stamping of `X-Skynet-Client-Build: <CLIENT_BUILD_ID>` is airtight-by-construction on every outbound request. Axios: single edit to `createApiInstance()` in `src/ui/main-axios.ts:456` covers all 8 axios instances. Raw fetch: 15 in-scope fetch sites enumerated in RESEARCH.md Q2 are rewrapped via a new helper `stampedFetch()` in `src/ui/lib/stamped-fetch.ts` (Electron server-config + external-avatar-candidate fetches are explicitly skipped and commented). | D-04, D-05 | Plan 04 |
| SKEW-05 | Server-side global middleware inserted in `src/backend/database/database.ts` between L295 (`app.use(serveUrlHandler)`) and L296 (first `bodyParser.json`). Every response gets `X-Skynet-Server-Build: <SERVER_BUILD_ID>` header. On `X-Skynet-Client-Build` header present AND != server: return `409 { error: "stale_client", clientBuild, serverBuild }` with a structured warn log (`operation: "skew_lock_stale_client_refused"`). Absence passes through (D-06 mismatch-only). Client-build header value read + logged is byte-length capped at 32 bytes (V5 input-validation hardening). Dev-mode NODE_ENV escape hatch: in `process.env.NODE_ENV !== "production"`, still stamp response but skip refusal. | D-06, D-07, D-15 | Plan 03 |
| SKEW-06 | Client axios response interceptor at `src/ui/main-axios.ts` detects two drift signals: (a) success response with `x-skynet-server-build` header != `CLIENT_BUILD_ID` → `lockSkewedSession({reason: "response_tag_mismatch"})`; (b) error response `status === 409 && body.error === "stale_client"` → `lockSkewedSession({reason: "server_refused_stale_client"})`. Existing error-path logic (401 refresh, 5xx retry) remains untouched. | D-01, D-15 | Plan 04 |
| SKEW-07 | Backend WS handshake refusal on 5 servers. Each `wss.on("connection", ...)` handler reads `?build=<CLIENT_BUILD_ID>` from `req.url` BEFORE existing JWT auth work. On absence OR mismatch, `ws.close(4409, "stale_client")` and return. Servers: `src/backend/claude-session/claude-session-server.ts:4115`, `src/backend/ssh/terminal.ts:139`, `src/backend/ssh/docker-console.ts:285`, `src/backend/relay-room-stream/relay-room-stream-server.ts:1190`, `src/backend/fleet-status/fleet-status-server.ts` (line near `on("connection"`). A shared helper `extractSkewTag(req): string \| null` in a new file `src/backend/utils/skew-tag.ts` factors the URL-query parse. | D-08, D-14 | Plan 05 |
| SKEW-08 | Backend per-message piggyback on the 4 JSON-envelope WS servers. Each server routes all outbound `ws.send(JSON.stringify(...))` through a `sendFrame(ws, frame)` helper (or extends an existing `emit()` such as `relay-room-stream-server.ts:1234-1240`) which injects `build: <SERVER_BUILD_ID>` at envelope top-level. Applies to: claude-session, terminal, docker-console, relay-room-stream, fleet-status. Guacamole (5th server, third-party framing) explicitly OMITTED — Pitfall 1. | D-09, D-10, Pitfall 1 | Plan 05 |
| SKEW-09 | Client WS drift detection on the 4 JSON-envelope client sites. On `event.code === 4409` in `onclose` → `lockSkewedSession({reason: "ws_handshake_mismatch"})`. On `onmessage`, parse `event.data` as JSON; if `parsed.build && parsed.build !== CLIENT_BUILD_ID` → `lockSkewedSession({reason: "ws_message_tag_mismatch"})` and drop the frame (do not process further). Structured close logs use explicit field extraction (`event.code`, `event.reason`, `event.wasClean`), NEVER `JSON.stringify(event)`. Client sites: `src/ui/api/claude-session-api.ts:22`, `src/ui/api/fleet-status-client.ts:81`, `src/ui/features/pretty-view/sources/relay-room-api.ts:49`, `src/ui/features/terminal/Terminal.tsx:1314`. Each new-WebSocket URL grows `&build=<CLIENT_BUILD_ID>` (D-08 handshake stamp). | D-08, D-09 | Plan 06 |
| SKEW-10 | Guacamole handshake-only enforcement via encrypted-token payload. `src/backend/guacamole/token-service.ts` `GuacamoleToken` type at L135 gains `buildId: string` field. Token issuance sets `buildId: SERVER_BUILD_ID`. `src/backend/guacamole/guacamole-server.ts` decrypt path compares `token.buildId === SERVER_BUILD_ID` BEFORE contacting guacd; on mismatch, emit `SKYNET_STALE_CLIENT:` Guacamole error instruction (same pattern as the takeover `SKYNET_SUPERSEDED:` at L178) and close. Client-side guacamole-lite JS distinguishes the prefix and calls `lockSkewedSession({reason: "ws_handshake_mismatch"})`. Guacamole per-frame stamping is EXPLICITLY OMITTED (Pitfall 1). | D-08, Pitfall 1 | Plan 05 (server) + Plan 06 (client) |
| SKEW-11 | `SkewLockModal` component at `src/ui/features/skew-lock/SkewLockModal.tsx` (new dir). Subscribes to store via `useSyncExternalStore`. On `snapshot.locked === false` returns `null`. On `true`, renders a `fixed inset-0 z-[9999]` div with `role="dialog"` `aria-modal="true"`; palette draws from `--color-pv-*` tokens; contains title "A newer version is available", body "Reload to continue.", single button "Reload" that calls `window.location.reload()`. A `useEffect` applies `document.getElementById("root")?.setAttribute("inert", "")` while locked. Mounted at `src/main.tsx:243` as a sibling of `<Toaster>`. No `X` close, no escape/click-outside dismissal, no countdown. | D-11, D-12, D-13, D-17, Palette authority | Plan 02 |
| SKEW-12 | Reload-loop-break sentinel. Before `window.location.reload()`, the Reload handler reads `sessionStorage.getItem("skynet_skew_reload_count")` + a timestamp; if > 3 activations within 60s, the modal switches to a "Something is wrong — please contact support" fatal-mode variant that does NOT reload. The counter is per-tab (sessionStorage isolated by tab). | Pitfall 4 | Plan 02 |
| SKEW-13 | Vite dev-mode escape hatch: server middleware skips refusal (still stamps response header) when `process.env.NODE_ENV !== "production"`. Client-side interceptor still stamps requests in dev — no behavior change client-side. Vite config `execSync("git rev-parse --short=12 HEAD")` fallback covers dev where `VITE_BUILD_ID` env is unset. | Q11.2 | Plan 03 |
| SKEW-14 | Cache-Control codification for `index.html`. Existing three enforcement layers get comments cross-referencing Phase 132: `docker/nginx.conf:131-140`, `docker/nginx-https.conf:142-151`, `src/backend/database/database.ts:2039-2043` + `2056-2058`. A new vitest at `src/backend/database/cache-headers.test.ts` reads each of the three source files and greps for the `no-store` block; test fails if any is deleted. NO structural change; D-19 is codification. | D-19, D-20.1 | Plan 07 |
| SKEW-15 | Playwright drift smoke test at `tests/e2e/skew-lock.spec.ts`. Logs in via `loginViaUI`, uses `page.route` to inject a mismatched `x-skynet-server-build` header on the next axios request, asserts the `role="dialog"` skew-lock modal becomes visible within 5s, then restores the route and clicks Reload, asserts modal is not visible after reload. Uses existing `tests/e2e/helpers/auth.ts` `readCreds()` + `loginViaUI`. | D-11, D-13, D-15 | Plan 07 |

## Union coverage verification

| Plan | requirements: (frontmatter) |
|------|------------------------------|
| 132-01-PLAN | SKEW-01 (partially SKEW-02 — getter module) |
| 132-02-PLAN | SKEW-03, SKEW-11, SKEW-12 |
| 132-03-PLAN | SKEW-02 (boot log), SKEW-05, SKEW-13 |
| 132-04-PLAN | SKEW-04, SKEW-06 |
| 132-05-PLAN | SKEW-07, SKEW-08, SKEW-10 (server side) |
| 132-06-PLAN | SKEW-09, SKEW-10 (client side) |
| 132-07-PLAN | SKEW-14, SKEW-15 |

Every SKEW-nn appears in at least one plan's `requirements:` field. Every plan's `requirements:` field is non-empty.

## Notes on decision-to-requirement traceability

- D-01, D-02, D-03: shape-of-mechanism decisions, embedded in SKEW-04 through SKEW-10.
- D-04, D-05: SKEW-04 (client airtight stamping).
- D-06, D-07: SKEW-05 (server middleware placement + mismatch-only).
- D-08, D-09, D-10: SKEW-07 through SKEW-10 (WS handshake + piggyback discipline).
- D-11, D-12, D-13, D-14: SKEW-11, SKEW-12, SKEW-15 (modal + reload semantics + playwright verification).
- D-15: SKEW-05 + SKEW-06 (mismatch != failure distinction) + SKEW-15 (test).
- D-16: SKEW-01 + SKEW-02 (single startup capture).
- D-17: SKEW-11 (independent-per-tab; no BroadcastChannel).
- D-18: SKEW-01 (git short SHA choice).
- D-19: SKEW-14 (codification).
- D-20 audits: baked into RESEARCH.md; SKEW-14 codifies the finding.
