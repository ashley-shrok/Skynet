---
phase: 110
status: passed
verified_at: 2026-09-13T19:47:53Z
must_haves_covered: 12/12
tests_run: 72
tests_passed: 72
---

# Phase 110: Global Identity-Birth Throttle — Verification Report

**Phase Goal:** Introduce a single global rate-limiter (`src/backend/identity-birth/global-throttle.ts`) that both entry points to `birthIdentity()` funnel through: POST `/identities/birth` SSE route (throttled with 429 on overflow) and spawn-request worker `processBirth` (bypasses queue-depth limit).

**Verified:** 2026-09-13T19:47:53Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Must-Have Checklist

### 1. Module exists with correct exports

**Status:** PASS

`grep -E "^export"` on `src/backend/identity-birth/global-throttle.ts` shows:

```
export type ThrottleSource = "http" | "spawn-request";
export interface AcquireContext { ... }
export class ThrottleRejectedError extends Error { ... }
export async function acquireBirthSlot(ctx: AcquireContext): Promise<() => void>
export function __resetForTests(): void
```

All three required symbols are exported: `acquireBirthSlot` (line 139), `ThrottleRejectedError` (line 38), `__resetForTests` (line 234).

---

### 2. Env-var config resolution with malformed fallback and config_loaded log

**Status:** PASS

`global-throttle.ts` lines 100-102 read:
- `IDENTITY_BIRTH_MAX_CONCURRENT` (default 1, min 1)
- `IDENTITY_BIRTH_MIN_INTERVAL_MS` (default 0, min 0)
- `IDENTITY_BIRTH_MAX_QUEUE_DEPTH` (default 100, min 1)

Malformed values trigger `systemLogger.warn` with `operation: "identity_birth_throttle_env_malformed"` (line 88). Config resolution fires `systemLogger.info` with `operation: "identity_birth_throttle_config_loaded"` (line 110) on every module init and `__resetForTests()` call.

File: `src/backend/identity-birth/global-throttle.ts:76-121`

---

### 3. POST `/identities/birth` acquires BEFORE flushHeaders; 429 on ThrottleRejectedError; release in finally

**Status:** PASS

- Acquire at line 337: `release = await acquireBirthSlot({ source: "http" })`
- 429 catch at lines 339-344: `res.status(429).json({ error: "identity_birth_queue_full", retry_after_ms: err.retryAfterMs })` with `return` — SSE never opened on 429
- `res.flushHeaders()` at line 355 — after the acquire block
- `try { await birthIdentity(...) } ... } finally { clearInterval(...); consumeCandidate...; res.end(); if (release) release(); }` — release is last in finally after `res.end()`

File: `src/backend/database/routes/identity-birth.ts:335-541`

---

### 4. POST `/identities/birth/retry/:key` similarly wrapped

**Status:** PASS

- Acquire at line 628: `release = await acquireBirthSlot({ source: "http" })`
- 429 at lines 630-634: same JSON shape as POST /
- `res.flushHeaders()` at line 644 — after the acquire block
- `finally { clearInterval(...); conn?.end(); res.end(); if (release) release(); }` (lines 738-755) — release in finally after `res.end()`

File: `src/backend/database/routes/identity-birth.ts:621-756`

---

### 5. `spawn-requests/worker.ts` `processBirth` acquires at top with `bypassQueueDepth:true`; release in finally covering all return paths

**Status:** PASS

`processBirth` (lines 279-296) is structured as:
```typescript
export const processBirth = async (item: PendingBirth, deps: WorkerDeps): Promise<void> => {
  const release = await acquireBirthSlot({
    source: "spawn-request",
    bypassQueueDepth: true,
    requestId: item.uuid,
  });
  try {
    await doBirth(item, deps);
  } finally {
    release();
  }
};
```

All return paths in `doBirth` (the full birth flow including pre-flight checks, retry loop, and response file writes) are covered by the `finally { release(); }` in `processBirth`. The acquire is the first operation before any birth logic.

File: `src/backend/spawn-requests/worker.ts:279-296`

---

### 6. Unit tests for `global-throttle.ts` — 12 tests covering all required behaviors

**Status:** PASS

`src/backend/identity-birth/global-throttle.test.ts` contains 12 named tests:
- Test 1: concurrency cap default 1
- Test 2: FIFO ordering under maxConcurrent=1
- Test 3: maxConcurrent=2
- Test 4: queue-depth reject (ThrottleRejectedError)
- Test 5: bypassQueueDepth=true never rejects
- Test 6: release() idempotency
- Test 7: min-interval spacing with fake timers
- Test 8: __resetForTests clears state
- Test 9: env-var malformed fallback + LOUD warn
- Test 10: config-loaded log fires after __resetForTests
- Test 11: grant log carries source/requestId
- Test 12: reject error shape (instanceof, message, name, retryAfterMs)

All 12 pass (confirmed by test run: 72/72 across 3 files).

---

### 7. Integration test in `identity-birth.test.ts`: 3 concurrent POSTs serialize; 429 at cap

**Status:** PASS

`src/backend/database/routes/identity-birth.test.ts` lines 1096-1239 contain:

- **Test 110-A** (line 1097): Three concurrent POST `/identities/birth` requests use deferred promises to confirm only 1 `birthIdentity` call fires at a time under `maxConcurrent=1`. Asserts call order is `["aaa", "bbb", "ccc"]` (FIFO).
- **Test 110-B** (line 1182): `maxConcurrent=1`, `maxQueueDepth=2`. 4th request gets 429 with `{ error: "identity_birth_queue_full", retry_after_ms: <positive number> }` as `application/json` (not SSE).

Both tests use the REAL global-throttle module (not mocked). Both pass.

---

### 8. Integration test in `worker.test.ts`: 2 parallel `processBirth` serialize; 10 parallel with maxQueueDepth=1 never reject (bypass honored)

**Status:** PASS

`src/backend/spawn-requests/worker.test.ts` lines 861-998 contain:

- **Test 110-W-A** (line 862): Two parallel `processBirth` calls with a deferred to hold item A's birth. Asserts B's `birthIdentity` is NOT called until A releases the slot. Final call order: `["A-birth-start", "A-birth-end", "B-birth-start", "B-birth-end"]`.
- **Test 110-W-B** (line 937): `maxConcurrent=1`, `maxQueueDepth=2`. 10 parallel `processBirth` calls all complete without rejection (`Promise.allSettled` — 0 rejected). `birthIdentity` called exactly 10 times.

Both tests pass.

---

### 9. Coordinator-instructions doc includes batch-drop-safe note referencing Phase 110

**Status:** PASS

`substrate/skills/id/coordinator-instructions.md` lines 271-277:

```
⚠️ **Batch drops are safe.** The Skynet backend paces births internally
via a global throttle (Phase 110 — `src/backend/identity-birth/global-throttle.ts`)
that both entry points funnel through, so dropping many request files at
once will not overwhelm the homeserver, the SSH channel budget, or the
orchestrator. No manual spacing between drops is needed — write the files
as quickly as your role logic decides they are needed, and the backend
will drain them in order at a safe pace.
```

Explicitly references Phase 110 and the module path.

---

### 10. Log operation keys `identity_birth_throttle_{wait,grant,release,reject,config_loaded}` — count ≥ 5

**Status:** PASS

`grep -c "identity_birth_throttle_" global-throttle.ts` returns **7**. Unique keys found:
- `identity_birth_throttle_config_loaded` (line 110)
- `identity_birth_throttle_env_malformed` (line 88)
- `identity_birth_throttle_grant` (line 195)
- `identity_birth_throttle_reject` (line 145)
- `identity_birth_throttle_release` (line 210)
- `identity_birth_throttle_wait` (lines 157, 185 — used for both `reason: "concurrency"` and `reason: "min_interval"`)

All 5 required keys (`wait`, `grant`, `release`, `reject`, `config_loaded`) are present. Count ≥ 5.

---

### 11. NO changes to `identity-birth-orchestrator.ts`

**Status:** PASS

`git log --oneline HEAD~20..HEAD -- src/backend/database/routes/identity-birth-orchestrator.ts` returns empty — no commits to this file in recent history.

---

### 12. NO changes to `spawn-requests/queue.ts`

**Status:** PASS

`git log --oneline HEAD~20..HEAD -- src/backend/spawn-requests/queue.ts` returns empty — no commits to this file in recent history.

---

## Test Run Summary

```
npx vitest run \
  src/backend/identity-birth/global-throttle.test.ts \
  src/backend/database/routes/identity-birth.test.ts \
  src/backend/spawn-requests/worker.test.ts

Test Files  3 passed (3)
      Tests  72 passed (72)
   Start at  19:47:19
   Duration  896ms
```

**Total:** 72 tests run, 72 passed, 0 failed, 0 warnings.

---

## Anti-Patterns Scan

Files modified by this phase:
- `src/backend/identity-birth/global-throttle.ts` — no TODOs, TBDs, FIXMEs, XXX markers; no stub returns; idempotent release uses captured `released` flag correctly
- `src/backend/database/routes/identity-birth.ts` — Phase 110 additions are clean; no stubs
- `src/backend/spawn-requests/worker.ts` — `processBirth` refactored cleanly into acquire/try/finally shell around `doBirth`
- `substrate/skills/id/coordinator-instructions.md` — documentation update, no code

No blockers or warnings found.

---

## Human Verification Required

None. All behaviors are verified programmatically through unit and integration tests that run against the real module.

---

## Verdict

**PASS** — All 12 must-haves verified against the actual codebase. Tests are green (72/72). The global-birth-throttle module is correctly implemented as Option B (counter + waiter queue semaphore), wired into both entry points with correct ordering (acquire before SSE open, release in finally after res.end()), and documented in coordinator-instructions with an explicit Phase 110 reference. Neither `identity-birth-orchestrator.ts` nor `queue.ts` were modified.

No follow-up items for ship-time.

---

_Verified: 2026-09-13T19:47:53Z_
_Verifier: Claude (gsd-verifier)_
