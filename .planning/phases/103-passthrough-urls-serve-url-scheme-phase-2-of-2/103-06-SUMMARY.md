---
phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2
plan: 06
subsystem: infra
tags: [websocket, origin-check, csrf-defense, verify-client, d-08]

# Dependency graph
requires:
  - phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2
    provides: "Plan 02 cors-config.ts SERVE_SUBDOMAIN_RE (HTTP-layer CSRF reject); Plan 02 widened JWT cookie (D-02) that makes this WS-layer defense necessary"
provides:
  - "src/backend/utils/ws-origin-guard.ts — SERVE_SUBDOMAIN_ORIGIN_RE regex + isServeSubdomainOrigin(origin) + rejectServeSubdomain(req) exports"
  - "verifyClient guard installed on all 5 backend WebSocketServer entry points (terminal, docker-console, tunnel c2sRelayWss, fleet-status, relay-room-stream)"
  - "Structured audit-trail warn logs on every reject with per-WSS identifier"
  - "Import target for Plan 08 (CSRF audit multipart guard) — SERVE_SUBDOMAIN_ORIGIN_RE + isServeSubdomainOrigin available for reuse"
affects:
  - 103-08-csrf-audit-multipart-guard
  - Any future WSS added to backend (must import + verifyClient)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "verifyClient at WebSocketServer construction — rejects at handshake before WS ever opens"
    - "Shared ws-origin-guard.ts module imported by every WSS entry point"
    - "Per-WSS wss: identifier in structured log for audit-trail attribution"

key-files:
  created:
    - src/backend/utils/ws-origin-guard.ts
    - src/backend/utils/ws-origin-guard.test.ts
  modified:
    - src/backend/ssh/terminal.ts
    - src/backend/ssh/docker-console.ts
    - src/backend/ssh/tunnel.ts
    - src/backend/fleet-status/fleet-status-server.ts
    - src/backend/relay-room-stream/relay-room-stream-server.ts

key-decisions:
  - "verifyClient at construction chosen for ALL 5 WSS — none had a pre-existing verifyClient to delegate to, so no fallback to connection-handler gate needed"
  - "Regex tolerates both http:// and https:// schemes (dev/preview coverage), differing intentionally from Plan 02's https-only cors-config regex"
  - "rejectServeSubdomain treats non-string Origin (array/undefined) as non-serve (returns false) — anomalous shapes fall through to false; JWT gate still applies"
  - "Warn-level structured log includes origin string only (already public — browser sends it) + wss identifier — no user PII, no session token"

patterns-established:
  - "verifyClient handshake guard pattern: reject before WS opens, log warn with operation=ws_origin_guard_reject + wss=<name>"
  - "Shared ws-origin-guard.ts as canonical import point for any new WSS"

requirements-completed: []

# Metrics
duration: ~7min
completed: 2026-09-10
---

# Phase 103 Plan 06: WebSocket Origin-Header Rejection Guard for D-08 Summary

**Shared ws-origin-guard.ts helper + verifyClient handshake guard applied to all 5 backend WSS entry points (terminal, docker-console, tunnel, fleet-status, relay-room-stream) rejecting *.serve.term.<domain> origins per D-08.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-09-10T15:43:00Z (approximate — plan-execution start)
- **Completed:** 2026-09-10T15:50:00Z (approximate — final SUMMARY commit)
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 5

## Accomplishments

- Closed the WebSocket-shaped CSRF hole opened by the widened JWT cookie (Plan 02 D-02): a malicious page served at foo-3000.serve.term.<domain> can no longer open a WS to term.<domain>'s command surfaces authenticated as the user.
- All 5 WebSocketServer entry points now refuse cross-origin `*.serve.term.<domain>` upgrades at the HTTP handshake layer via `verifyClient` — no WS ever opens for a rejected origin, saving both compute and attack surface.
- Structured warn logs (`operation: "ws_origin_guard_reject"`, per-file `wss:` identifier) give an audit trail for which surface saw the attempt.
- Existing JWT auth flow untouched — the guard is purely additive.

## Task Commits

1. **Task 1 (RED): failing tests for ws-origin-guard** — `0f68b18c` (test)
2. **Task 1 (GREEN): ws-origin-guard.ts implementation** — `3f24f5e1` (feat)
3. **Task 2: wire verifyClient into 5 WSS entry points** — `1700f8e2` (feat)

_Plan metadata commit follows this SUMMARY._

## Files Created/Modified

- `src/backend/utils/ws-origin-guard.ts` (NEW) — Exports `SERVE_SUBDOMAIN_ORIGIN_RE`, `isServeSubdomainOrigin`, `rejectServeSubdomain`. Regex matches `^https?://[^/]+\.serve\.term\.[a-zA-Z0-9.-]+$` (both http and https for dev/preview coverage).
- `src/backend/utils/ws-origin-guard.test.ts` (NEW) — 14 test cases across 3 describe blocks; covers primary + sibling + undefined + bare + null + array shape.
- `src/backend/ssh/terminal.ts` (MODIFIED) — Added import + `verifyClient` on port-30002 WSS. Warn log via `sshLogger`, `wss: "terminal"`.
- `src/backend/ssh/docker-console.ts` (MODIFIED) — Added import + `verifyClient` on port-30009 WSS. Warn log via `sshLogger` (aliased to `systemLogger`), `wss: "docker-console"`.
- `src/backend/ssh/tunnel.ts` (MODIFIED) — Added import + `verifyClient` on `c2sRelayWss` (`/ssh/tunnel/c2s/stream`). Warn log via `tunnelLogger`, `wss: "tunnel"`.
- `src/backend/fleet-status/fleet-status-server.ts` (MODIFIED) — Added import + `verifyClient` on port-30012 WSS inside `startFleetStatusServer`. Warn log via `systemLogger`, `wss: "fleet-status"`.
- `src/backend/relay-room-stream/relay-room-stream-server.ts` (MODIFIED) — Added import + `verifyClient` on `RELAY_ROOM_STREAM_PORT` WSS inside `startWebSocketServer`. Warn log via `databaseLogger`, `wss: "relay-room-stream"`.

## Decisions Made

- **verifyClient for all 5, no connection-handler fallback needed.** Read-first confirmed none of the 5 WSS already had a `verifyClient` option — no delegation logic required. Handshake-layer reject is cheaper (WS never opens) and per D-08's stated preference.
- **`http` schema tolerated in the regex** — Plan 02's `cors-config.ts` `SERVE_SUBDOMAIN_RE` is https-only, but a WS handshake's Origin header on a dev/preview environment may legitimately be `http`. Both schemes are equally suspect from the serve subdomain, so both match. The plan's Task 1 action block explicitly documents this deliberate divergence.
- **Per-logger routing preserved.** Each file uses its ambient logger (`sshLogger`/`tunnelLogger`/`systemLogger`/`databaseLogger`) rather than importing a new one, to minimize the diff surface and keep the change strictly additive.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- `npx vitest run --related …` was rejected as an unknown flag on this vitest version (v4.1.8); switched to `npx vitest related … --run` subcommand form. Not a Rule-anything deviation — same test intent, correct invocation for the installed version. 4 related test files (89 tests) all pass.

## Verification

- `npx vitest run src/backend/utils/ws-origin-guard.test.ts` → 14/14 pass, exit 0
- `npx vitest related src/backend/{ssh/terminal,ssh/docker-console,ssh/tunnel,fleet-status/fleet-status-server,relay-room-stream/relay-room-stream-server,utils/ws-origin-guard}.ts --run --exclude='**/*.integration.test.ts'` → 4 test files, 89 tests, all pass, exit 0
- `npx tsc --noEmit` → exit 0, no output
- `grep 'rejectServeSubdomain\|isServeSubdomainOrigin'` on each of the 5 WSS files → 2 references each (import + verifyClient body)

## Threat Register Realization

| Threat ID | Mitigated |
|-----------|-----------|
| T-103-29 (CSRF via WS from serve subdomain) | ✅ verifyClient rejects at 403 handshake |
| T-103-30 (EoP: malicious serve-subdomain page drives term.<domain> WS as user) | ✅ Same verifyClient path — the exact scenario D-08 addresses |
| T-103-31 (DoS via cross-origin handshake flood) | Accepted per plan — regex + string comparison is O(1); rate limiting is the edge tier's job |
| T-103-32 (Info-disclosure via reject log) | ✅ Log includes only origin string (browser-public) + wss identifier — no PII, no session token |

## Next Phase Readiness

- **Plan 08 (CSRF audit multipart guard) unblocked.** Can now `import { SERVE_SUBDOMAIN_ORIGIN_RE, isServeSubdomainOrigin } from "../utils/ws-origin-guard.js"` for its origin classification.
- **Any future WSS added to the backend must import and install this guard** — the pattern is now the standard.
- No push, no build, no deploy performed per box-maintainer directive (executor scope stops at code + commit + scoped-green).

## Self-Check: PASSED

- File `src/backend/utils/ws-origin-guard.ts` FOUND
- File `src/backend/utils/ws-origin-guard.test.ts` FOUND
- Commit `0f68b18c` FOUND (test RED)
- Commit `3f24f5e1` FOUND (feat GREEN)
- Commit `1700f8e2` FOUND (5 WSS wiring)
- All 5 target files grep-match `rejectServeSubdomain` (2 refs each)
- tsc --noEmit exit 0
- Scoped vitest exit 0 (14/14 unit, 89/89 related)

---
*Phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2*
*Completed: 2026-09-10*
