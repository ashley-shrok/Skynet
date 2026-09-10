---
phase: quick-260910-8dp
plan: "01"
subsystem: backend-observability
tags:
  - instrumentation
  - observability
  - auth
  - event-loop
  - performance
dependency_graph:
  requires: []
  provides:
    - event-loop lag telemetry on boot (systemLogger, op: event_loop_lag_sample)
    - per-auth-request timing on /users/* (authLogger, op: auth_req_timing)
  affects:
    - src/backend/starter.ts
    - src/backend/database/routes/users.ts
tech_stack:
  added:
    - node:perf_hooks monitorEventLoopDelay (Node built-in, no new package)
  patterns:
    - co-located SIGTERM cleanup (matches starter.ts:961 pattern)
    - router-level middleware via closure-captured hrtime (no global type augmentation)
key_files:
  modified:
    - src/backend/starter.ts
    - src/backend/database/routes/users.ts
decisions:
  - Used closure capture (Option A) in users.ts timing middleware to avoid global Express.Request type augmentation
  - Added defensive inner VITEST guard in starter.ts sampler (belt-and-suspenders; outer guard at L167 already covers)
  - interval.unref() applied so the sampler timer does not keep the process alive on its own
  - co-located process.once("SIGTERM") handler clears interval + disables histogram for clean exit
metrics:
  duration: "~8 minutes"
  completed: "2026-09-10"
  tasks_completed: 2
  files_modified: 2
---

# Quick Task 260910-8dp: Per-auth-request timing + event-loop lag sampler

**One-liner:** Node perf_hooks monitorEventLoopDelay sampler in starter.ts boot IIFE + Express router-level hrtime middleware on all /users/* routes for auth latency attribution.

## What Was Built

### Task 1 — Event-loop lag sampler in starter.ts (commit: ab104be0)

Added `import { monitorEventLoopDelay } from "node:perf_hooks"` to `src/backend/starter.ts`.

Immediately after the `"Skynet backend initialization started"` systemLogger.info call (L185), inside the existing VITEST-gated boot IIFE, inserted a sampler block:

- Defensive inner `if (process.env.VITEST !== "true")` gate (belt-and-suspenders; outer guard at L167 already covers)
- `monitorEventLoopDelay({ resolution: 20 })` histogram, enabled on boot
- `setInterval(..., 1000)` samples `percentile(50)`, `percentile(99)`, `max` (each nanoseconds → ms via `/ 1_000_000`, rounded to 1dp), logs via `systemLogger.info("Event loop lag sample", { operation: "event_loop_lag_sample", p50Ms, p99Ms, maxMs })`, then resets histogram
- `interval.unref()` so timer does not keep process alive
- Co-located `process.once("SIGTERM", ...)` clears interval and calls `histogram.disable()` — mirrors the existing pattern at starter.ts:961

### Task 2 — Per-auth-request timing middleware in users.ts (commit: 997884a0)

Added `router.use(...)` immediately after `const router = express.Router()` in `src/backend/database/routes/users.ts`, before all route registrations.

- Captures `startTimeNs = process.hrtime.bigint()` via closure
- `res.on("finish", ...)` computes `durationMs = Number((process.hrtime.bigint() - startTimeNs) / 1_000_000n)` (bigint truncation acceptable for logging)
- Logs via `authLogger.info("Auth request timing", { operation: "auth_req_timing", method, path, durationMs, status, userId })`
- `userId` from `(req as AuthenticatedRequest).userId ?? null` (null for unauthenticated requests that haven't hit authenticateJWT yet)
- `req.path` used (route-relative, e.g. `/me`) as specified
- No global Express.Request type augmentation; typing by inline cast only

## Log Operations Introduced

| Operation | Logger | File |
|-----------|--------|------|
| `event_loop_lag_sample` | systemLogger (SYSTEM) | src/backend/starter.ts |
| `auth_req_timing` | authLogger (AUTH) | src/backend/database/routes/users.ts |

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1 | `ab104be0` | feat(quick-260910-8dp): event-loop lag sampler in starter.ts boot IIFE |
| Task 2 | `997884a0` | feat(quick-260910-8dp): per-auth-request timing middleware on /users/* |

## Verification Results

- `npx vitest run src/backend/starter.test.ts` — 18/18 tests passed
- `npx vitest run src/backend/database/routes/users.test.ts` — 39/39 tests passed
- `npm run build:backend` — clean, no TS errors
- `npm run build` — clean, no TS errors (frontend + backend tsc)
- `grep -c 'event_loop_lag_sample' src/backend/starter.ts` (excluding comments) — 1
- `grep -c 'auth_req_timing' src/backend/database/routes/users.ts` (excluding comments) — 1
- No new routes added; `docker/nginx.conf` and `docker/nginx-https.conf` NOT touched
- No push, no docker build, no deploy — executor stopped at commit + tests green

## Deviations from Plan

None — plan executed exactly as written. The `--related` vitest flag is unsupported in this project's vitest version (v4.1.8); test files were run directly by name instead (functionally equivalent).

## Known Stubs

None. Both changes are instrumentation-only log calls with no data flow to UI.

## Threat Flags

None. No new network endpoints, no auth path changes, no schema changes. Pure logging additions inside existing handlers.
