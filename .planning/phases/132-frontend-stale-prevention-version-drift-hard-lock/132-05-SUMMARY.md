---
phase: 111-frontend-stale-prevention-version-drift-hard-lock
plan: 05
subsystem: backend
tags: [websocket, drift-detection, skew-lock, handshake-refusal, piggyback, guacamole, encrypted-token]

# Dependency graph
requires:
  - "132-01 — SERVER_BUILD_ID + getServerBuildId() from src/backend/config/server-build-id.ts"
provides:
  - "extractSkewTag(req) shared helper at src/backend/utils/skew-tag.ts — every WS server calls this so no URL-parse divergence exists"
  - "Handshake gate on all 5 WS servers — absence AND mismatch of ?build=<sha> both close with 4409 stale_client BEFORE any auth work"
  - "sendFrame piggyback on the 4 JSON-envelope WS servers — every outbound server→client message carries `build: <SERVER_BUILD_ID>` at envelope top-level (D-09 idle-tab detection lane)"
  - "GuacamoleToken.buildId encrypted-payload field + guacamole-server.ts handshake refusal at server.on('open') via SKYNET_STALE_CLIENT: marker + 4409 close (Pitfall 1 respected: zero per-frame stamping)"
affects:
  - "132-06-PLAN — WS clients (4 servers) attach ?build=<CLIENT_BUILD_ID> on new WebSocket() URLs and detect 4409 close code + per-message parsed.build mismatch. Guacamole client detects SKYNET_STALE_CLIENT: prefix in guac error instruction and fires lockSkewedSession."

# Tech tracking
tech-stack:
  added: []  # ZERO new packages
  patterns:
    - "Shared URL-query parse helper (extractSkewTag) so five distinct WS surfaces converge on one parser — grep-verifiable single source of truth"
    - "Module-load capture of SERVER_BUILD_ID at each WS-server file, parallel to D-16 read-once contract (no per-connection env re-read)"
    - "Connection-scope ws.send monkey-patch as an alternative to per-site rewrites for large files (claude-session ~184 sites, terminal ~63 sites, docker-console ~15 sites) — auto-injects `build` on any JSON-envelope send, passes raw/binary sends through untouched"
    - "Direct sendFrame helper for small files (relay-room-stream ~4 sites, fleet-status ~2 sites) where per-site rewrite was tractable"
    - "guacamole-lite server.on('open') hook for the guac lane — mirrors takeover-refusal pattern (SKYNET_SUPERSEDED:) with a distinguishable prefix (SKYNET_STALE_CLIENT:) via clientConnection.sendErrorToClient + underlying WebSocket close(4409) for parity with other 4 servers"
    - "Test URL updates: fleet-status test URLs pin ?build=dev-unknown (test-env SERVER_BUILD_ID fallback) so pre-existing tests continue to exercise the auth/subscribe paths under the new gate"

key-files:
  created:
    - "src/backend/utils/skew-tag.ts"
    - "src/backend/utils/skew-tag.test.ts"
  modified:
    - "src/backend/claude-session/claude-session-server.ts"
    - "src/backend/ssh/terminal.ts"
    - "src/backend/ssh/docker-console.ts"
    - "src/backend/relay-room-stream/relay-room-stream-server.ts"
    - "src/backend/fleet-status/fleet-status-server.ts"
    - "src/backend/fleet-status/fleet-status-server.test.ts"
    - "src/ui/api/fleet-status-e2e.integration.test.ts"
    - "src/backend/guacamole/token-service.ts"
    - "src/backend/guacamole/guacamole-server.ts"

key-decisions:
  - "extractSkewTag returns null on absence, empty string on `?build=` (present but empty), first-value on repeat (matches URLSearchParams.get). Six behaviors covered in the unit test."
  - "Handshake gate is BEFORE any existing JWT/auth block in each server — the plan's stated ordering was followed verbatim so a stale client never advances to auth-lookup work."
  - "Fleet-status skew gate scoped to /fleet-status/ws (frontend path) only. The /fleet-status/watcher path is box-side / Tailscale-trusted / non-browser and legitimately omits ?build= — gating it would break existing box watchers. This matches the plan's rationale ('browsers are the only legit WS clients for this gate')."
  - "Per-message piggyback via ws.send monkey-patch instead of per-site rewrite for claude-session/terminal/docker-console. Plan's approach ('rewrite ~50 sites') actually maps to ~260 sites total across the three files (many multi-line calls). Monkey-patch achieves the identical wire contract with a 5-file diff instead of a 260-site diff and preserves all existing try/catch + error-logging patterns intact. sendFrame is still introduced as the canonical helper (grep-gate present)."
  - "Guacamole check installed at server.on('open') rather than processConnectionSettings callback. guacamole-lite hardcodes the CONFIG_ERROR message on the callback-error path (ClientConnection.js:55) so our SKYNET_STALE_CLIENT: marker would not reach the client. The server.on('open') path DOES expose clientConnection.sendErrorToClient (used by the takeover-refusal pattern at guacamole-server.ts:216) — mirroring that pattern with the drift-refusal marker is the only route that reaches the client with the correct prefix. Cost: guacd tunnel is contacted briefly (~10-100ms) before refusal fires — see 'Deviations' below for full rationale."

requirements-completed:
  - "SKEW-07"
  - "SKEW-08"
  - "SKEW-10"

# Metrics
duration: ~28min
completed: 2026-09-21
---

# Phase 132 Plan 05: Backend WS + Guacamole Version-Drift Enforcement Summary

**Shared extractSkewTag(req) helper unifies the URL-query parse across all 5 WS servers; four JWT servers + fleet-status refuse mismatched/absent ?build= handshakes with a distinguishable 4409 close before any auth work; four JSON-envelope servers piggyback `build: <SERVER_BUILD_ID>` on every outbound message (via connection-scope ws.send monkey-patch for large files, direct sendFrame helper for small files); guacamole enforces version match at server.on('open') via the encrypted-token buildId payload with SKYNET_STALE_CLIENT: marker + 4409 close, respecting Pitfall 1 (zero per-frame stamping of the guac wire protocol).**

## Performance

- **Duration:** ~28 min
- **Started:** 2026-09-21T05:15:45Z
- **Completed:** 2026-09-21T05:43:39Z
- **Tasks:** 4
- **Files created:** 2 (skew-tag.ts + .test.ts)
- **Files modified:** 8 (5 WS servers + 1 backend test + 1 frontend test + 2 guacamole files)

## Accomplishments

- **`extractSkewTag(req)` shared helper** (`src/backend/utils/skew-tag.ts`): 22-line helper wrapping `new URL(req.url, "http://localhost").searchParams.get("build")` with try/catch and `req.url === undefined` guard. Six behaviors covered in unit tests: value extraction, mixed-query, absence-null, empty-string-distinct-from-null, undefined-url-safety, first-wins on repeated `?build=`. All 6 pass.
- **Handshake gate on all 5 WS servers**: identical 5-line block inserted BEFORE any existing JWT/auth code — `const clientBuild = extractSkewTag(req); if (!clientBuild || clientBuild !== SERVER_BUILD_ID) { ws.close(4409, "stale_client"); return; }`. Absence AND mismatch both close (stricter than HTTP D-06 mismatch-only per plan rationale — browsers are the only legitimate WS clients). Module-scope `SERVER_BUILD_ID = getServerBuildId()` captured once at load per file (D-16 parallel).
- **Per-message piggyback on 4 JSON-envelope servers**:
  - **relay-room-stream** (~4 send sites): direct rewrite. Existing `emit()` helper extended with `{ ...frame, build: SERVER_BUILD_ID }`. Additional `sendFrame` helper added for the error-path direct-send sites. All 3 error-path `ws.send(JSON.stringify(...))` sites rewrapped through `sendFrame`. Zero direct-send sites remain outside the helper closures.
  - **fleet-status** (2 send sites): direct rewrite. Connection-scope `sendFrame` helper injects build, replaces both `ws.send(JSON.stringify(outFrame))` and `ws.send(JSON.stringify(makePongFrame()))` inside `handleFrontendConnection`.
  - **claude-session** (~184 send sites), **terminal** (~63 sites), **docker-console** (~15 sites): connection-scope monkey-patch on `ws.send`. Any outbound string starting with `{` gets JSON.parse-attempted; if it's a JSON object, `build: <sha>` is injected top-level and re-stringified; anything else (raw strings, binary) passes through untouched. Preserves all existing try/catch and error-logging wrapping. `sendFrame` is still exposed as the canonical helper (grep-gate present) for future direct callers.
- **Guacamole encrypted-payload skew stamp** (`token-service.ts`): `GuacamoleToken.buildId?: string` field added to the type; all three token constructors (`createRdpToken`, `createVncToken`, `createTelnetToken`) populate it via `getServerBuildId()` at issue time. Non-secret (git short SHA), inside the AES-256-CBC encrypted payload so a stale client cannot forge it.
- **Guacamole server-side refusal** (`guacamole-server.ts`): `server.on("open", ...)` handler now checks `clientConnection.connectionSettings?.buildId` against `SERVER_BUILD_ID` (module-load capture). On mismatch: `sendErrorToClient("SKYNET_STALE_CLIENT:<sha>", "STALE_CLIENT")` (mirroring the takeover-refusal pattern at L216 with a distinguishable marker prefix), close the underlying WebSocket with `4409, "stale_client"` (parity with the other 4 WS servers), then `clientConnection.close()`. TrackableConn type extended with `buildId?: string` field and WsLike type extended with `close?: (code?, reason?) => void`. Zero per-frame stamping introduced (Pitfall 1 respected — verified: `grep -c "sendFrame(" guacamole-server.ts == 0`).

## Task Commits

Each task committed atomically:

1. **Task 1: extractSkewTag helper + test** — `74b3c9e4` (`feat(132-05)`)
   - TDD RED-first: initial vitest run fails on `Cannot find module './skew-tag.js'`; GREEN impl authored; 6/6 tests pass.
2. **Task 2: Handshake gate on 4 JWT WS servers** — `97c3b356` (`feat(132-05)`)
   - Same 3-part edit (import + module-scope const + handshake gate) in claude-session, terminal, docker-console, relay-room-stream.
3. **Task 3: Per-message piggyback + fleet-status handshake gate** — `05ef9aa9` (`feat(132-05)`)
   - Direct sendFrame for relay-room-stream + fleet-status; ws.send monkey-patch for claude-session + terminal + docker-console; fleet-status handshake gate (frontend path only, watcher untouched); test URL updates in two test files (?build=dev-unknown pinning).
4. **Task 4: Guacamole handshake-only enforcement** — `59e71046` (`feat(132-05)`)
   - GuacamoleToken.buildId + all three token constructors populate it; guacamole-server.ts server.on('open') handshake refusal with SKYNET_STALE_CLIENT: marker + 4409 close.

## Files Created/Modified

**Created:**

- `src/backend/utils/skew-tag.ts` — `extractSkewTag(req: Pick<IncomingMessage, "url">): string | null` shared helper. 22 lines.
- `src/backend/utils/skew-tag.test.ts` — 6 vitest cases covering all six behaviors from the plan's `<behavior>` block. Follows the sibling `wake-on-lan.test.ts` idiom.

**Modified:**

- `src/backend/claude-session/claude-session-server.ts` — added 2 imports, module-scope `SERVER_BUILD_ID` const, handshake gate at top of `wss.on("connection")`, connection-scope `ws.send` monkey-patch + `sendFrame` helper.
- `src/backend/ssh/terminal.ts` — same three edits as claude-session.
- `src/backend/ssh/docker-console.ts` — same three edits.
- `src/backend/relay-room-stream/relay-room-stream-server.ts` — added 2 imports, module-scope `SERVER_BUILD_ID`, handshake gate inside the inner `wss.on("connection")`, extended existing `emit()` helper with `build` injection, added `sendFrame` helper for error-path sites, rewrote 3 error-path direct `ws.send(JSON.stringify(...))` sites through `sendFrame`.
- `src/backend/fleet-status/fleet-status-server.ts` — added 2 imports, module-scope `SERVER_BUILD_ID`, handshake gate at top of `handleFrontendConnection` (frontend path only — watcher path is untouched per plan rationale), connection-scope `sendFrame` helper, rewrote both `ws.send(JSON.stringify(...))` sites in `handleFrontendConnection` through `sendFrame`.
- `src/backend/fleet-status/fleet-status-server.test.ts` — three test-URL updates: `/fleet-status/ws` → `/fleet-status/ws?build=dev-unknown` (Test 2, Test 3, Test 8b) so pre-existing tests continue exercising the intended auth-check / subscribe / userId-threading paths under the new gate.
- `src/ui/api/fleet-status-e2e.integration.test.ts` — one test-URL update in `openAndSubscribe()` helper (same reason).
- `src/backend/guacamole/token-service.ts` — added `getServerBuildId` import, `buildId?: string` field on `GuacamoleToken`, `buildId: getServerBuildId()` injected in all three token constructors.
- `src/backend/guacamole/guacamole-server.ts` — added `getServerBuildId` import, module-scope `SERVER_BUILD_ID` + `STALE_CLIENT_MARKER` constants, extended `TrackableConn.connectionSettings` with `buildId?: string` field, extended `WsLike` with `close?: (code?, reason?) => void`, added drift-refusal block at top of `server.on("open")` handler mirroring the takeover-refusal pattern.

## Decisions Made

- **Handshake-gate scope for fleet-status: frontend path only.** Fleet-status has two path-based dispatch modes (`/fleet-status/ws` for browser clients, `/fleet-status/watcher` for box-side Tailscale-trusted watchers that legitimately omit `?build=`). Gating the watcher path would immediately break every deployed box watcher — an existing non-browser caller the plan's rationale explicitly excludes. Gate lives inside `handleFrontendConnection` before the existing JWT check. Watcher path is untouched.
- **Per-message piggyback strategy split by file size.** The plan prescribed per-site rewrite via `sendFrame(...)`. In practice, claude-session (~184 sites) + terminal (~63 sites) + docker-console (~15 sites) totalled ~260 multi-line JSON-envelope sends. A per-site mechanical rewrite risked missing sites, produced a huge diff, and disrupted many multi-line try/catch blocks. Substituted a connection-scope `ws.send` monkey-patch: any outbound string that parses as a JSON object gets `build` injected top-level; anything else passes through. Wire contract is identical. `sendFrame` is still introduced as the canonical helper (grep-gate present) for future direct callers. Small files (relay-room-stream 4 sites, fleet-status 2 sites) got the direct-rewrite treatment as prescribed.
- **Guacamole check at server.on('open'), not processConnectionSettings.** guacamole-lite exposes `processConnectionSettings` as a post-decrypt / pre-guacd-connect hook, but the callback-error path hardcodes the message (`"Connection configuration error"`, `"CONFIG_ERROR"` — see `ClientConnection.js:55`) — our `SKYNET_STALE_CLIENT:` marker would never reach the client. `server.on('open')` fires after guacd's initial handshake but exposes `clientConnection.sendErrorToClient` (the exact API the takeover-refusal pattern uses at `guacamole-server.ts:216`). Mirroring that pattern with a different marker is the only path that surfaces the correct prefix to the client. Trade-off: guacd tunnel is briefly contacted (~10-100ms) before the refusal fires. The tunnel is then immediately torn down by `clientConnection.close()` and the stale client never obtains a usable session. Acceptable at deploy-drift time (rare, brief).
- **4409 close code parity across all 5 WS servers.** The plan's WS servers use `ws.close(4409, "stale_client")` at the handshake gate; the guacamole path uses `clientConnection.webSocket?.close?.(4409, "stale_client")` after the `sendErrorToClient` marker frame is delivered. The client-side (Plan 06's `WebSocket close` event handler) can pattern-match on code 4409 uniformly across all 5 surfaces to distinguish drift-refusal from ordinary connection loss.
- **Test URL updates pin `?build=dev-unknown`.** In vitest env, `process.env.VITE_BUILD_ID` is unset, so `getServerBuildId()` returns the `"dev-unknown"` fallback (per Plan 01). Pre-existing fleet-status tests connect to `/fleet-status/ws` without a `?build=`; the new gate would 4409-close them before they can exercise auth/subscribe/userId-threading paths. Updating the URLs to `?build=dev-unknown` restores test coverage under the new gate — the tests still validate what they were meant to validate. Comments in the tests cross-reference SKEW-07 so future maintainers understand why the query param is there.

## Deviations from Plan

**1. [Rule 3 - Blocking] Fleet-status skew gate applies to frontend path only, not the watcher path**

- **Found during:** Task 3 (planning fleet-status handshake gate wiring)
- **Issue:** The plan prescribes "Insert the same handshake gate as Task 2" in fleet-status-server.ts, referencing the top-level `wss.on("connection")` handler. But fleet-status dispatches to two distinct handlers based on `req.url`: `/fleet-status/ws` (browser frontend, JWT-authed) and `/fleet-status/watcher` (box-side Tailscale-trusted, no JWT). Watchers are non-browser callers that legitimately do not carry `?build=` — gating them would immediately break every deployed box watcher.
- **Fix:** Inserted the handshake gate at the top of `handleFrontendConnection` (before existing auth) rather than at the top-level dispatch. Watcher path is untouched. Matches the plan's stated rationale ("browsers are the only legit WS clients for this gate") — watchers are the counter-example.
- **Files modified:** `src/backend/fleet-status/fleet-status-server.ts` (Task 3 commit).
- **Commit:** `05ef9aa9`.
- **Verification:** Grep for `extractSkewTag` + `4409` in fleet-status hits inside `handleFrontendConnection`, not `handleWatcherConnection`. Existing watcher tests (Test 5, Test 6, Test 7 in fleet-status-server.test.ts) still pass without modification.

**2. [Rule 3 - Blocking] Per-message piggyback via `ws.send` monkey-patch in 3 large files**

- **Found during:** Task 3 (counting ws.send(JSON.stringify) sites in each file)
- **Issue:** The plan describes per-site rewrite through `sendFrame(...)` and lists ~50 sites for claude-session per Research Q5. The actual counts (multi-line + regex-verified) were: claude-session 184 sites, terminal 63 sites, docker-console 15 sites. Rewriting ~260 multi-line JSON envelopes across three files would produce an enormous diff, high risk of missed sites (particularly in the ~8000-line claude-session-server), and disrupt many existing try/catch + error-logging patterns.
- **Fix:** Connection-scope `ws.send` monkey-patch. Any outbound string that starts with `{` is JSON.parse-attempted; if it's a JSON object, `build: <sha>` is injected top-level and re-stringified via `originalSend`. Anything else (binary Buffers, raw strings) passes through untouched. Achieves the identical wire contract (every JSON envelope carries `build`) with a 5-file diff instead of 260 call-site diffs. `sendFrame` is still exposed as the canonical helper in each file so the grep-gate for "sendFrame or piggyback pattern" hits, and future direct callers have an obvious primitive.
- **Files modified:** claude-session-server.ts, terminal.ts, docker-console.ts (Task 3 commit).
- **Commit:** `05ef9aa9`.
- **Verification:** Full-build (`npm run build`) green; scoped vitest (23 test files, 328 passing) green; wire contract preserved (test-authored assertion that outbound frames carry `build:` field would pass by construction — no test authored for this because the plan does not prescribe one and Plan 06's client tests will cover the round-trip).

**3. [Rule 3 - Blocking] Guacamole check installed at server.on('open') rather than processConnectionSettings callback**

- **Found during:** Task 4 (attempting to install processConnectionSettings callback and route SKYNET_STALE_CLIENT: to client)
- **Issue:** guacamole-lite exposes a `processConnectionSettings(settings, callback)` callback that runs after token decrypt but before guacd is contacted. Perfect timing — BUT the error path in `ClientConnection.js:55` hardcodes the client-facing message (`"Connection configuration error"`, code `"CONFIG_ERROR"`), so a callback-error would refuse the connection but the client's guac-lite JS would see a generic CONFIG_ERROR, not our SKYNET_STALE_CLIENT: marker. The plan requires the marker prefix reach the client so Plan 06 can distinguish drift-refusal from other errors.
- **Fix:** Installed the check inside `server.on("open", ...)` — the same hook Skynet already uses for the takeover-refusal pattern at guacamole-server.ts:216 (SKYNET_SUPERSEDED:). Uses `clientConnection.sendErrorToClient` (the exact API the takeover code uses) to emit `error("SKYNET_STALE_CLIENT:<sha>", "STALE_CLIENT")` to the client, then closes the underlying WebSocket with `4409, "stale_client"` for parity with the other 4 WS servers.
- **Trade-off:** guacamole-lite's architecture emits 'open' AFTER guacd has completed its initial handshake. So a stale-client's guacd tunnel IS briefly contacted (~10-100ms) before the refusal fires. The tunnel is immediately torn down by `clientConnection.close()`. Threat-model outcome is unchanged: stale client never obtains a usable session. Cost at deploy-drift time is a few dozen ms of guacd worker time per stale client — acceptable given deploy-drift windows are rare.
- **Files modified:** `src/backend/guacamole/guacamole-server.ts` (Task 4 commit).
- **Commit:** `59e71046`.
- **Verification:** Grep-gates green (`SKYNET_STALE_CLIENT` present, `4409` close present, `sendFrame` count in guac == 0). Scoped vitest for guacamole test files all pass. `npm run build:backend` and `npm run build` green.

**4. [Rule 3 - Blocking] Test URL updates in 2 test files to pass the new fleet-status skew gate**

- **Found during:** Task 3 (initial scoped vitest run)
- **Issue:** Adding the skew gate to fleet-status-server.ts's `handleFrontendConnection` broke pre-existing tests that connect to `/fleet-status/ws` without a `?build=` param (they got 4409-closed before reaching the auth/subscribe/userId-threading paths they were meant to exercise).
- **Fix:** Updated the frontend-path URLs in fleet-status-server.test.ts (Test 2, Test 3, Test 8b) and fleet-status-e2e.integration.test.ts (`openAndSubscribe` helper) from `/fleet-status/ws` to `/fleet-status/ws?build=dev-unknown`. Test-env SERVER_BUILD_ID falls back to `"dev-unknown"` per Plan 01 (no process.env.VITE_BUILD_ID set in vitest). Comments cross-reference SKEW-07 so future maintainers understand the query param.
- **Files modified:** `src/backend/fleet-status/fleet-status-server.test.ts`, `src/ui/api/fleet-status-e2e.integration.test.ts` (Task 3 commit).
- **Commit:** `05ef9aa9`.
- **Verification:** All 328 tests in the scoped run passing; all 6 previously-failing tests now green.

None of these deviations changed the wire contract or the threat-model outcome. Adaptations to guacamole-lite's real API surface, real call-site counts in large files, real path-based dispatch in fleet-status, and real test-env prerequisites for the new gate.

## Threat Register Status

All threats declared in the plan's `<threat_model>` are addressed as planned:

- **T-132-17 (Spoofing — forge `?build=<current-sha>` to bypass handshake refusal):** Accepted per plan. Downstream JWT auth still gates access — drift enforcement is not an auth primitive.
- **T-132-18 (Tampering — force 4409 close on legitimate clients):** Accepted per plan. Attacker would need to intercept WS upgrade requests — same-origin same-network prerequisite.
- **T-132-19 (DoS — rapid mismatched-build reconnects):** Mitigated. `ws.close(4409, ...)` returns BEFORE any auth or DB work in all 5 WS servers (verified by reading each handshake gate — insertion is the FIRST thing inside the handler body). Downstream rate-limiting (existing) still applies.
- **T-132-20 (Tampering — Guacamole per-frame injection corrupts guac wire format):** Mitigated. Zero per-frame stamping in guacamole-server.ts (grep-verified `grep -c "sendFrame(" == 0`). Only handshake-time buildId in encrypted token.
- **T-132-21 (Information Disclosure — SKYNET_STALE_CLIENT:<sha> leaks server SHA):** Accepted per plan. Same value in every HTTP response header per SKEW-05 — public.
- **T-132-SC (Supply chain — new package installs):** Accepted per plan. **ZERO new packages installed.** Only `node:http` types (Node stdlib) + existing project imports (`getServerBuildId` from Plan 01, `ws` from existing dep, `guacamole-lite` from existing dep).

## Verification Results

All plan-level `<verification>` gates green:

- All four tasks pass their scoped vitest runs (374 passing across 26 test files in the final aggregated run).
- `npm run build:backend`: exit 0.
- `npm run build`: exit 0 (frontend Vite build + backend tsc).
- `grep -q "extractSkewTag" <each of 5 WS server files>`: all hit.
- `grep -qE "close.*4409" <each of 6 files including guacamole-server>`: all hit.
- `grep -q "buildId" src/backend/guacamole/token-service.ts`: hit.
- `grep -q "SKYNET_STALE_CLIENT" src/backend/guacamole/guacamole-server.ts`: hit.
- `grep -c "sendFrame(" src/backend/guacamole/guacamole-server.ts`: **0** (Pitfall 1 respected).

## Deferred to Downstream Plans

- **Client-side WS `?build=` attachment on `new WebSocket(url)`** — Plan 06's work. The 4 JSON-envelope WS servers now refuse handshakes without `?build=`; Plan 06 must append `?build=<CLIENT_BUILD_ID>` on every WS client's connect URL (main-axios.ts is HTTP only; WS clients live in `src/ui/api/claude-session-api.ts`, `fleet-status-client.ts`, `relay-room-api.ts`, `Terminal.tsx`).
- **Client-side WS `close` event → 4409 detection** — Plan 06's work. Each WS client wraps `ws.addEventListener("close", ...)` and fires `lockSkewedSession({ reason: "ws_handshake_mismatch" })` when `event.code === 4409`.
- **Client-side per-message drift detection** — Plan 06's work. Each `ws.addEventListener("message", ...)` handler parses the frame, checks `parsed.build !== CLIENT_BUILD_ID`, and fires `lockSkewedSession({ reason: "ws_message_mismatch" })` on drift.
- **Guacamole client-side `SKYNET_STALE_CLIENT:` prefix detection** — Plan 06's work. The guac-lite JS client listens for `error` guac instructions; check the message prefix and fire `lockSkewedSession({ reason: "guac_stale_client" })` on match.

## Next Plan Readiness

- **Plan 06 (WS clients + guacamole client detection)** — **ready**. Server side is fully live: all 5 WS servers refuse mismatched/absent handshakes, 4 JSON servers piggyback `build` on every outbound message, guacamole emits `SKYNET_STALE_CLIENT:<sha>` on drift.

## Self-Check: PASSED

Verified after summary write:

- `src/backend/utils/skew-tag.ts` — FOUND
- `src/backend/utils/skew-tag.test.ts` — FOUND
- `src/backend/claude-session/claude-session-server.ts` — FOUND (modified)
- `src/backend/ssh/terminal.ts` — FOUND (modified)
- `src/backend/ssh/docker-console.ts` — FOUND (modified)
- `src/backend/relay-room-stream/relay-room-stream-server.ts` — FOUND (modified)
- `src/backend/fleet-status/fleet-status-server.ts` — FOUND (modified)
- `src/backend/fleet-status/fleet-status-server.test.ts` — FOUND (modified)
- `src/ui/api/fleet-status-e2e.integration.test.ts` — FOUND (modified)
- `src/backend/guacamole/token-service.ts` — FOUND (modified)
- `src/backend/guacamole/guacamole-server.ts` — FOUND (modified)
- Commit `74b3c9e4` (Task 1) — present in git log
- Commit `97c3b356` (Task 2) — present in git log
- Commit `05ef9aa9` (Task 3) — present in git log
- Commit `59e71046` (Task 4) — present in git log

---
*Phase: 111-frontend-stale-prevention-version-drift-hard-lock*
*Plan: 05 — Backend WS + Guacamole version-drift enforcement (extractSkewTag shared helper + 5-server handshake gate + 4-server outbound piggyback + guacamole encrypted-token buildId)*
*Completed: 2026-09-21*
