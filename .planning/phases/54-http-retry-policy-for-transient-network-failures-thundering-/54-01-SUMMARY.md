---
phase: 54-http-retry-policy-for-transient-network-failures-thundering-
plan: "01"
subsystem: frontend/http
tags:
  - axios
  - retry
  - backoff
  - jitter
  - thundering-herd
  - resilience
dependency_graph:
  requires: []
  provides:
    - computeBackoffMs (exported from main-axios.ts)
    - isRetryable (exported from main-axios.ts)
    - retry interceptor in createApiInstance()
  affects:
    - all axios instances (authApi, hostApi, statsApi, tunnelApi, fileManagerApi, dashboardApi, rbacApi, dockerApi)
    - db-health-monitor toast lifecycle (sustained errors now fire only after 3 attempts)
tech_stack:
  added:
    - axios-mock-adapter@^2 (devDependency — test harness for MockAdapter)
  patterns:
    - TDD (RED/GREEN via vitest)
    - Full-jitter exponential backoff (AWS Marc Brooker canonical shape)
    - Async Axios response interceptor (Promise-returning error handler)
key_files:
  modified:
    - src/ui/main-axios.ts
    - src/ui/main-axios.test.ts
    - package.json (axios-mock-adapter devDependency added)
    - package-lock.json
decisions:
  - "isRetryable treats status=0 (MockAdapter network error representation) same as status=undefined for connection-level detection — ensures tests accurately simulate ECONNREFUSED without special-casing"
  - "createApiInstance exported for test harness (not in original plan, added as required by integration tests)"
  - "Integration tests use Promise.all([request, vi.runAllTimersAsync()]) pattern to avoid PromiseRejectionHandledWarning from Node.js intermediate promise timing"
metrics:
  duration: "~15 minutes"
  completed: "2026-08-23"
  tasks_completed: 2
  files_modified: 4
---

# Phase 54 Plan 01: Axios HTTP Retry Interceptor with Full-Jitter Backoff Summary

**One-liner:** Full-jitter exponential backoff HTTP retry interceptor (3 attempts, base 300ms, AWS canonical shape) wired into `createApiInstance()` before the existing `dbHealthMonitor.reportDatabaseError` call, with method-aware idempotency safeguard and 401 SESSION_EXPIRED fast-path preserved.

## What Was Built

### `computeBackoffMs(attempt: number): number` (new export, R-54-02)

Exact formula: `Math.floor(Math.random() * (300 * Math.pow(2, attempt)))`.

- attempt=1 → uniform [0, 600ms)
- attempt=2 → uniform [0, 1200ms)

Full-jitter (not base+jitter) — spreads retries across the entire window instead of clustering them offset from the base, which is what defeats thundering herds.

### `isRetryable(error, config)` (new export, R-54-01)

Classification tree:
- `config.__noRetry === true` → false (escape hatch, R-54-04)
- `config.__silentRetry === true` → false (don't double-retry progressive /status polling, R-54-04)
- Status undefined or 0 (connection-level: ECONNREFUSED, ERR_NETWORK, ECONNABORTED, ECONNRESET, ETIMEDOUT) → **true for ALL methods** (connection was never established, idempotent to retry)
- Status 502/503/504 + GET/HEAD/OPTIONS → true
- Status 502/503/504 + POST/PUT/PATCH/DELETE → false (idempotency safeguard — server may have processed)
- Everything else (4xx, 500, 501) → false

### Retry loop in `createApiInstance()` (R-54-01, R-54-02, R-54-05, R-54-06)

Placed **before** the existing 401 fast-path block (lines 473-527). The error handler made `async` to support `await setTimeout`.

Flow:
1. Increment `config.__retryAttempt` (1-indexed).
2. If `attempt < MAX_ATTEMPTS (3)` AND `isRetryable(error, config)`:
   - Compute `delayMs = computeBackoffMs(attempt)`.
   - Log `logger.warn('http_retry_attempt', {requestId, method, url, attempt, delayMs, errorCode, errorMessage})`.
   - `await new Promise(resolve => setTimeout(resolve, delayMs))`.
   - `return instance.request(config)` — re-fires with incremented `__retryAttempt`. On success, the success interceptor branch calls `dbHealthMonitor.reportDatabaseSuccess()` (R-54-06, zero extra code).
3. If `attempt >= MAX_ATTEMPTS` AND error is retryable (give-up):
   - Log `logger.warn('retries_exhausted', {requestId, method, url, attempts, finalErrorCode, finalErrorMessage})`.
   - Fall through to existing 401 fast-path + `dbHealthMonitor.reportDatabaseError` call.
4. If `isRetryable` returned false (4xx, 500/501, escape hatches):
   - Fall through immediately — 401 hits its fast-path with zero retry delay (R-54-03).

### `AxiosRequestConfigExtended` interface extension

Added `__noRetry?: boolean` and `__retryAttempt?: number` fields alongside existing `startTime`, `requestId`, `__silentRetry`.

## Test Results

```
Test Files  1 passed (1)
     Tests  41 passed (41)
  Duration  2.6s
```

Test suite covers:
- `computeBackoffMs`: 4 statistical tests (range bounds × 2 attempts + mean uniformity × 2 attempts)
- `isRetryable`: 24 classification tree tests (GET/POST/PUT/PATCH/DELETE × ECONNREFUSED/5xx/4xx + escape hatches)
- Integration: 9 end-to-end tests via `createApiInstance()` + MockAdapter

## TypeScript Compilation

```
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "main-axios"
# (no output — zero errors)
```

## Deviations from Plan

### Auto-added (Rule 2 — Missing Critical Functionality)

**1. `createApiInstance` exported**
- **Found during:** Writing Task 1 integration tests
- **Issue:** Integration tests need to call `createApiInstance('http://test.local', 'TEST')` to set up a testable axios instance with the retry interceptor. The function was not exported.
- **Fix:** Added `export` keyword to `createApiInstance`.
- **Files modified:** `src/ui/main-axios.ts`
- **Commit:** 1bf301cf

**2. `status === 0` treated as connection-level in `isRetryable`**
- **Found during:** Analyzing MockAdapter behavior
- **Issue:** Real axios ECONNREFUSED sets `error.response === undefined`. MockAdapter `[0, null]` sets `error.response.status === 0`. Without handling `status === 0`, integration tests for ECONNREFUSED behavior would not match the classification logic.
- **Fix:** `isRetryable` treats `status === undefined || status === 0` as connection-level failure (consistent with how the existing `db-health-monitor` detects `ERR_NETWORK` and similar codes).
- **Files modified:** `src/ui/main-axios.ts`
- **Commit:** 1bf301cf

**3. Integration test `Promise.all` pattern**
- **Found during:** First test run with fake timers
- **Issue:** `const p = instance.get(); await vi.runAllTimersAsync(); await expect(p).rejects` caused `PromiseRejectionHandledWarning` from Node.js because intermediate retry promise rejections were momentarily unhandled before the outer `expect` handler connected.
- **Fix:** Changed to `await expect(Promise.all([instance.get(), vi.runAllTimersAsync()])).rejects` which chains all promises before any can be seen as unhandled.
- **Files modified:** `src/ui/main-axios.test.ts`
- **Commit:** 1bf301cf

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The retry interceptor wraps existing Axios calls — no new trust boundaries.

The STRIDE mitigations from the plan's threat model are all implemented:
- T-54-01 (DoS amplification): MAX_ATTEMPTS = 3, full jitter spreads herd
- T-54-02 (POST duplicate writes): method-aware idempotency safeguard in `isRetryable`
- T-54-03 (401 hidden by retry): `isRetryable` returns false for all 4xx BEFORE any sleep
- T-54-04 (silent retries hide forensics): per-attempt + give-up structured logs

## Known Stubs

None.

## Self-Check: PASSED

- `src/ui/main-axios.ts` — exists and modified: confirmed
- `src/ui/main-axios.test.ts` — exists and created: confirmed
- Task 1 commit `d772a255` — confirmed via `git log`
- Task 2 commit `1bf301cf` — confirmed via `git log`
- All 41 tests pass: confirmed
- TypeScript compiles clean: confirmed
