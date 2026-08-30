---
phase: quick-260724-aoq
plan: 01
subsystem: log-forwarder
tags: [patch-146, log-forwarder, frontend-console-intercept, backend-debug-route, nginx]
dependency_graph:
  requires: []
  provides: [debug-console-log-endpoint, frontend-console-forwarder]
  affects: [src/main.tsx, src/backend/database/database.ts, docker/nginx.conf, docker/nginx-https.conf]
tech_stack:
  added: []
  patterns: [ring-buffer, best-effort-file-mirror, beacon-flush-on-pagehide, lazy-env-var-read]
key_files:
  created:
    - src/backend/database/routes/debug.ts
    - src/backend/database/routes/debug.test.ts
    - src/ui/lib/console-forwarder.ts
    - src/ui/lib/console-forwarder.test.ts
  modified:
    - src/backend/database/database.ts
    - src/main.tsx
    - docker/nginx.conf
    - docker/nginx-https.conf
decisions:
  - "Handler logic extracted to exported handleConsoleLog() for function-level testing (no Express harness, no auth middleware mocking) — matching host-normalizers.test.ts pattern"
  - "LOG_PATH read lazily inside handler via getLogPath() (not at module load) so per-test env overrides work without vi.resetModules()"
  - "Test approach for console-forwarder: onEnqueue callback option bag for testability (cleaner than __test_getBuffer leak, though __test_getBuffer also exported for Test 2)"
  - "tabId hard-coded to 'no-tab' placeholder per locked design decision #7 — wired to AppShell active tab in follow-up patch"
metrics:
  duration: "~15min"
  completed: "2026-07-24"
  tasks: 5
  files: 8
---

# Quick Task 260724-aoq: Patch #146 — Log-Forwarder Prototype Summary

**One-liner:** Frontend console.log/warn/error interceptor + authenticated Express POST /debug/console-log endpoint with 1000-entry ring buffer, 5 MB rotating file mirror, and navigator.sendBeacon flush for iOS PWA tab-close delivery.

## What Was Built

### Backend: `src/backend/database/routes/debug.ts`
Express Router (119 lines) mounted at `/debug` in database.ts. POST `/console-log` is auth-gated by `authenticateJWT` (same pattern as compose-drafts.ts). Accepts `{ entries: LogEntry[] }`, validates shape via `isValidEntry()`, pushes valid entries into a module-scoped ring buffer (max 1000), then best-effort appends each entry as a JSON line to the file at `SKYNET_CONSOLE_FORWARD_LOG_PATH` (default `/tmp/skynet-console-forward.log`). File rotates at 5 MB with a `[LOG_ROTATED at <iso-ts>]` marker. File-write errors are caught and logged via `apiLogger.error` — never crash, never fail the HTTP response. Returns 204 on success. Returns 400 for missing entries array or all-invalid entries.

Key implementation note: `getLogPath()` reads the env var lazily (called inside the handler body, not at module load). This allows tests to override `SKYNET_CONSOLE_FORWARD_LOG_PATH` per test without `vi.resetModules()` gymnastics. Handler logic is exported as `handleConsoleLog()` for direct function-level testing.

### Backend test: `src/backend/database/routes/debug.test.ts`
4 tests covering: valid entry → 204 + file written with correct JSON line; missing entries field → 400; entries not an array → 400; all-invalid shapes → 400. Tests call `handleConsoleLog()` directly with a minimal Express mock — no auth middleware involved. Per-test `SKYNET_CONSOLE_FORWARD_LOG_PATH` points to a unique tmpdir file, cleaned up in `afterEach`.

### Backend registration: `src/backend/database/database.ts`
Two surgical edits: `import debugRoutes from "./routes/debug.js"` added after the user-preferences import (line 22 area); `app.use("/debug", debugRoutes)` added after the user-preferences registration (line 1793 area).

### Frontend: `src/ui/lib/console-forwarder.ts`
Exports `initConsoleForwarder(options?)` (idempotent via `initialized` guard). Patches console.log/warn/error: each patch calls the captured original first (preserving DevTools output and Error stack traces), then enqueues a `{ ts, level, tabId, msg }` LogEntry. Batch flushes to `POST /debug/console-log` (with `credentials: 'include'`) every 500ms or at 20 entries. On `visibilitychange→hidden` or `pagehide`, issues a final `navigator.sendBeacon` flush for iOS PWA tab-close delivery. `tabId` is hard-coded to `'no-tab'` (placeholder per design decision #7). Also exports `__test_getBuffer()` and `__test_reset()` for test isolation.

### Frontend test: `src/ui/lib/console-forwarder.test.ts`
2 tests: (1) console-preservation invariant — spy on `console.error` before init, verify the spy is called with the probe message after init + patch; (2) enqueue behavior — call log/warn/error, verify 3 envelopes in buffer with correct level/msg/ts. `vi.useFakeTimers()` prevents 500ms flush timer from triggering real fetch.

### Main entry: `src/main.tsx`
`import { initConsoleForwarder } from "@/lib/console-forwarder"` + `initConsoleForwarder()` call inserted immediately before `snapshotPendingTab()`.

### Nginx routing (CLAUDE.md nginx caveat honored): `docker/nginx.conf` + `docker/nginx-https.conf`
`location ~ ^/debug(/.*)?$` block added to BOTH configs, immediately after the `/compose-drafts` block, with the same 6 `proxy_*` directives pointing to `127.0.0.1:30001`. Without these blocks, nginx would 200 with `index.html` for any `/debug/*` request, crashing the frontend on `.map` file lookups. Both configs confirmed with grep gates.

## Tests

All tests green:
- `src/backend/database/routes/debug.test.ts` — 4 tests
- `src/ui/lib/console-forwarder.test.ts` — 2 tests
- Full subsystem run (`src/backend src/ui/lib`) — 195 tests, 0 failures
- `npm run type-check` — clean
- `npm run build` — clean (4.63s, 2394 modules, Vite @/lib/console-forwarder alias resolved correctly)

## Commit

Single atomic commit: `1ac99b7`

Subject: `feat: patch #146 — log-forwarder prototype (frontend console intercept + backend POST endpoint + file mirror for docker-exec grep read path)`

No Co-Authored-By trailer (fork convention). 8 files changed, 591 insertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Implementation Choice] Used exported function for test harness instead of Express router introspection**

- **Found during:** Task 1 test run
- **Issue:** Initial test approach used `await import("./debug.js")` then walked the router's `stack` array to find and call the POST handler. This timed out (5000ms) because importing the full Express router triggered the `AuthManager.getInstance()` singleton which attempts DB/config initialization during test startup.
- **Fix:** Exported `handleConsoleLog()`, `isValidEntry()`, `getLogPath()`, and `ring` from `debug.ts`. Tests call `handleConsoleLog()` directly with a minimal mock req/res pair — zero timeout, 9ms for all 4 tests.
- **Files modified:** `src/backend/database/routes/debug.ts`, `src/backend/database/routes/debug.test.ts`
- **Commit:** `1ac99b7` (folded into the single atomic commit per Task 5 constraints)

This matches the plan's explicit fallback: "If mocking the auth middleware is heavier than the value here, the test may bypass by exercising the raw handler function directly — see host-normalizers.test.ts pattern."

## Deploy Note

NOT deployed. Batched with patch #145 (active-glow URL-restore fix, commit `efc8e87`) for Ashley's next greenlight. `~/.claude/identities/tina/skynet-patches.md` write-up deferred to deploy-recommendation time per the Ashley 2026-07-23 batch-writeups-until-deploy rule.

## Self-Check: PASSED

All created files exist on disk. Commit `1ac99b7` confirmed in git log. Type check clean, build clean, 6 new tests green, 195 subsystem tests green.
