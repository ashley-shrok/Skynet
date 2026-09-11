---
phase: 79-telegram-bridge-phase-b
plan: 08
subsystem: telegram-bridge
tags: [reconcile, migration, matrix-admin, tokens, dead-tokens, phase-79, wave-5]
requires:
  - 79-04 (bridge-config-writer + human-token-writer + shared-volume + starter.ts Plan 04 marker)
  - 79-06 (bridge-side .token-dead sentinel writer — Plan 08 consumes what Plan 06 produces)
provides:
  - src/backend/telegram/reconcile-dead-tokens.ts (scanAndReconcileDeadTokens, startReconcileLoop)
  - POST /matrix-admin/migrate-cred-files (admin-gated one-shot migration endpoint)
  - 30s fire-and-forget reconcile interval wired in starter.ts (AFTER Plan 04 anchor, W-1 order asserted)
affects:
  - src/backend/starter.ts (added Plan 08 fire-and-forget block after Plan 04's)
  - src/backend/matrix/matrix-admin-routes.ts (extended with migrate-cred-files handler)
tech-stack:
  added: []                  # zero new deps
  patterns: [dynamic-import-to-avoid-boot-cycle, atomic-fs-writes-via-mint-writer, sentinel-based-dead-token-detection, admin-middleware-mirror, per-row-status-response, TG_BRIDGE_STATE_DIR_OVERRIDE-test-shim]
key-files:
  created:
    - src/backend/telegram/reconcile-dead-tokens.ts       (188 lines)
    - src/backend/telegram/reconcile-dead-tokens.test.ts  (216 lines)
  modified:
    - src/backend/starter.ts                              (+24 lines, Plan 08 block after L285)
    - src/backend/matrix/matrix-admin-routes.ts           (+118 lines, migrate-cred-files handler + imports)
    - src/backend/matrix/matrix-admin-routes.test.ts      (+201 lines, 7 new tests + mocks)
decisions:
  - Reactive-to-401s only for dead-token detection — zero polling of live tokens (per CONTEXT § 4B + RESEARCH § Q6, admin-minted Synapse tokens don't TTL-expire)
  - Migration endpoint does NOT gate on "already-migrated" state — always re-mints (idempotent by design; Synapse loginAsUser is cheap + stateless per RESEARCH § Q9)
  - migrate-cred-files handler uses dynamic import for db + schema (mirrors existing /creds handler's dynamic-import pattern to dodge boot cycles)
  - Test file mocks `../telegram/shared-volume.js` with a getter (rather than resetting modules) because matrix-admin-routes is imported once at file scope; a const export would freeze TG_BRIDGE_STATE_DIR before per-test tempDir was set
  - `users.username` column confirmed lowercase in prod (blocker B-4 verified at revision time); defensive `.toLowerCase()` kept as no-op safety
metrics:
  duration_min: 11
  completed_date: 2026-09-06
requirements:
  - TGB-07
---

# Phase 79 Plan 08: Reconcile-dead-tokens + POST /matrix-admin/migrate-cred-files Summary

Closed Phase 79's reliability loop with (a) a periodic 30s reconcile sweep that detects dead Matrix tokens via `<humanName>.token-dead` sentinel files the bridge writes on 401 and re-mints them via the Phase 77 admin `loginAsUser` primitive, and (b) a one-shot admin-gated `POST /matrix-admin/migrate-cred-files` endpoint that mints fresh tokens for every registered human and deletes any legacy `.cred` files under `TG_BRIDGE_STATE_DIR` — making cutover from Nina's install to the Docker service a single HTTP call.

## What shipped

### Task 1 — Reconcile-dead-tokens sweep + 30s starter.ts wiring
- **New:** `src/backend/telegram/reconcile-dead-tokens.ts`
  - `scanAndReconcileDeadTokens(): Promise<ReconcileResult>` — single-pass scan of `TG_BRIDGE_STATE_DIR` for `*.token-dead` sentinels. Runs `assertSafeHumanName` on every filename BEFORE any fs op (T-79-08-01). Resolves each human's mxid via `db.select({name, mxid}).from(users)`. Calls `mintAndWriteHumanToken(mxid, humanName)` from Plan 04; on success, unlinks the sentinel; on failure, leaves the sentinel for next-tick retry. Never throws — every failure mode is a warn log + continue. Returns `{scanned, minted, failed}`.
  - `startReconcileLoop(intervalMs): NodeJS.Timeout` — `setInterval` wrapper that `.catches` escaped rejections + `.unref()`s the timer so tests don't linger (T-79-08-06).
- **Modified:** `src/backend/starter.ts` (lines 287-311) — fire-and-forget block that dynamic-imports `./telegram/reconcile-dead-tokens.js` and calls `startReconcileLoop(30_000)` after DB init AND after the Plan 04 `bridge_config_write_startup_failed` block. Ordering asserted below.
- **New tests:** 6/6 pass — empty state, happy path, malformed sentinel filename (uppercase → guard trips), no-mxid (Laura case), mint rejects (sentinel left for retry), startReconcileLoop returns an `.unref`'d Timeout.

### Task 2 — POST /matrix-admin/migrate-cred-files admin-gated migration
- **Modified:** `src/backend/matrix/matrix-admin-routes.ts` — added handler mirroring the existing `POST /creds` shape:
  - `requireAdmin` middleware → 401 unauth, 403 non-admin (mirrors T-79-08-03).
  - Dynamic-imports `db` + `users` schema at handler time (avoids boot cycle).
  - Per-row response: `{humanName, mxid, status: 'minted' | 'failed' | 'skipped-no-mxid', error?}`.
  - Laura-like rows (mxid === null) → `status: 'skipped-no-mxid'`.
  - Scans `TG_BRIDGE_STATE_DIR` for `*.cred` files and deletes each — reports in `deletedCredFiles: string[]`.
  - Idempotent: no artificial "already-migrated" gate; second call re-mints (Synapse loginAsUser is cheap + stateless).
- **Modified tests:** 7 new tests + 10 existing tests, all 17/17 pass — auth (401/403), skipped-no-mxid, mixed mint outcomes, .cred-file deletion (with non-.cred survival check), idempotency (two consecutive calls both 200), empty users table.

## Test evidence

```
npx vitest run src/backend/telegram/reconcile-dead-tokens.test.ts \
              src/backend/matrix/matrix-admin-routes.test.ts

 ✓ src/backend/telegram/reconcile-dead-tokens.test.ts  (6/6)
 ✓ src/backend/matrix/matrix-admin-routes.test.ts     (17/17 — 10 existing + 7 new)

 Test Files  2 passed (2)
      Tests  23 passed (23)
```

Reconcile sweep tests:
- Test 1 empty state → `{scanned:0, minted:0, failed:0}`, mint never called — **PASS**
- Test 2 happy path → sentinel unlinked, `{scanned:1, minted:1, failed:0}` — **PASS**
- Test 3 malformed name (uppercase) → skipped with `reconcile_dead_tokens_bad_name` warn, sentinel left, mint never called — **PASS**
- Test 4 no mxid → `reconcile_dead_tokens_no_mxid` warn, mint never called, sentinel left — **PASS**
- Test 5 mint rejects → `{scanned:1, minted:0, failed:1}`, sentinel LEFT for next-tick retry — **PASS**
- Test 6 startReconcileLoop returns valid Timeout with `.unref` — **PASS** (confirms sweep does not keep tests alive)

Migration endpoint tests:
- 401 no auth — **PASS**
- 403 non-admin — **PASS**
- Mixed (Alice w/mxid + Laura w/o mxid) → minted + skipped-no-mxid — **PASS**
- Per-row failure isolation → Alice failed, Zoey still minted — **PASS**
- `.cred` file deletion → alice.cred + zoey.cred deleted, registry.json survives — **PASS**
- Idempotency → two consecutive calls both 200, mint called twice — **PASS**
- Empty users table → ok:true, results:[], deletedCredFiles:[] — **PASS**

## W-1 anchor / ordering assertion (blocker closed)

Pre-flight (per PLAN.md § Task 1 <acceptance_criteria>):
```
grep -c 'bridge_config_write_startup_failed' src/backend/starter.ts
→ 2   (was 1 before this plan; my Plan 08 comment mentions the anchor name too)
```

Line-number ordering (the load-bearing assertion):
```
grep -n 'bridge_config_write_startup_failed' src/backend/starter.ts
→ 282:          operation: "bridge_config_write_startup_failed",
       (line 296 is a doc reference in the Plan 08 comment block)

grep -n 'reconcile_dead_tokens_start_failed' src/backend/starter.ts
→ 305:          operation: "reconcile_dead_tokens_start_failed",

Plan 04 anchor line: 282
Plan 08 marker line: 305
Result: 282 < 305 → W-1 ORDER PASS ✓
```

The reconcile loop's fire-and-forget block is positioned strictly AFTER Plan 04's `ensureBridgeConfigWritten` block, honoring the invariant that shared-volume initialization completes before the reconcile sweep starts.

## Reconcile sweep is unref'd (does not keep tests alive)

Confirmed by Test 6 in `reconcile-dead-tokens.test.ts`:
```ts
const handle = startReconcileLoop(60_000);
expect(handle).toBeDefined();
expect(typeof handle.unref).toBe("function");
clearInterval(handle);
```
`startReconcileLoop` implementation calls `handle.unref()` if the method exists (Node semantics), so the interval never blocks event-loop shutdown. Test run finishes in ~5s — no lingering timer.

## Migration endpoint idempotency test

`src/backend/matrix/matrix-admin-routes.test.ts` "200 — idempotent: two consecutive calls both succeed with same response shape":
- First POST → `{ok:true, results:[{humanName:'alice', mxid, status:'minted'}], deletedCredFiles:[]}`
- Second POST → identical shape
- `mintAndWriteHumanTokenMock` called exactly 2 times (once per POST — re-mint, not no-op)

Confirms idempotency contract from PLAN.md § Task 2 <behavior>: "second call reports `status: 'minted'` again (no artificial 'already-migrated' gate — the endpoint's job is to guarantee tokens exist + .cred files don't)."

## Acceptance-criteria grep counts

Task 1:
| Criterion | Expected | Actual |
| --- | --- | --- |
| Exports (scanAndReconcileDeadTokens + startReconcileLoop) | 2 | 2 |
| `mintAndWriteHumanToken` refs in reconcile.ts | ≥ 2 | 6 |
| `assertSafeHumanName` refs in reconcile.ts | ≥ 2 | 4 |
| `startReconcileLoop` in starter.ts | 1 (call) | 3 (call + doc + warn-log msg — the actual invocation is `m.startReconcileLoop(30_000)`) |
| `reconcile_dead_tokens_start_failed` in starter.ts | 1 | 1 |
| Vitest Task 1 tests pass | all | 6/6 |
| tsc clean for reconcile-dead-tokens + starter | ∅ errors | ∅ errors |

Task 2:
| Criterion | Expected | Actual |
| --- | --- | --- |
| `router.post("/migrate-cred-files"` | 1 (multi-line style: URL on line after `router.post(`) | 1 (formatting mirrors existing `/creds` handler; single-line grep as written in PLAN.md returns 0 due to line-wrap style — verified via `grep -Pzo` multiline that the route is defined) |
| `mintAndWriteHumanToken` in routes.ts | ≥ 2 | 3 (import + call + comment) |
| `TG_BRIDGE_STATE_DIR` in routes.ts | ≥ 2 | 5 (import + comment refs + call) |
| `.cred` in routes.ts | ≥ 2 | 4 (comment + filter + reported literal + doc) |
| `requireAdmin` in routes.ts | ≥ 3 | 4 (declaration at ~L28 + 3 uses across POST /creds, GET /creds, POST /migrate-cred-files) |
| `status` labels (minted / failed / skipped-no-mxid) | ≥ 3 | 7 (used across TS type union + literal assignments) |
| Vitest routes tests pass | all | 17/17 (10 existing + 7 new) |
| tsc clean for matrix-admin-routes | ∅ errors | ∅ errors |

**Note on the one grep-count discrepancy:** PLAN.md's `startReconcileLoop` count of `1` assumed a single occurrence in starter.ts. The actual code has `startReconcileLoop` in three places: (1) the doc comment mentioning what will start, (2) the actual `m.startReconcileLoop(30_000)` invocation, (3) the `systemLogger.warn("startReconcileLoop failed to start", ...)` error-path message. All three are prescribed by the plan's `<action>` block verbatim — the acceptance-criteria grep count was under-specified relative to what the action block asked for. Load-bearing check passes: exactly one call site (`m.startReconcileLoop(30_000)`).

## Users column verification (blocker B-4 closure)

`src/backend/database/db/schema.ts`:
- Line 4: `export const users = sqliteTable("users", { ... })`
- Line 6: `username: text("username").notNull()`
- Line 32: `mxid: text("mxid")` (nullable per Plan 75)

Both reconcile-dead-tokens and migrate-cred-files use `db.select({name: users.username, mxid: users.mxid}).from(users)` — matches schema. Prod values for `username` are lowercase (Alice/Zoey verified during revision pass); defensive `.toLowerCase()` in the migration handler is a no-op today, safety net for future drift.

## Nginx caveat (CLAUDE.md rule)

Both `docker/nginx.conf` (line 153) and `docker/nginx-https.conf` (line 164) already contain wildcard `location ~ ^/matrix-admin(/.*)?$` blocks that route ALL paths under `/matrix-admin/` to the backend. The new `POST /matrix-admin/migrate-cred-files` route is covered automatically — no nginx changes required. Verified via `grep -n "matrix-admin" docker/nginx*.conf`.

## Threat model coverage (from PLAN.md § threat_model)

| Threat ID | Category | Status | Evidence |
| --- | --- | --- | --- |
| T-79-08-01 | Elevation of Privilege — sentinel filename traversal | mitigated | `assertSafeHumanName` runs on every filename BEFORE any fs op; Test 3 covers uppercase (guard trips) |
| T-79-08-02 | DoS — reconcile hangs on stuck loginAsUser | accepted | inherited from matrix-admin-client REQUEST_TIMEOUT_MS; per-tick promise wrapped in .catch (T-79-08-06 mitigation) |
| T-79-08-03 | Spoofing — migration endpoint access | mitigated | `requireAdmin` middleware; 401/403 tests pass |
| T-79-08-04 | Information Disclosure — mxid in response body | accepted | mxids already visible in POST/GET /creds surface; no new exposure |
| T-79-08-05 | Tampering — bulk unlink of .cred files | mitigated | `entries.filter(e => e.endsWith(".cred"))` scoped to TG_BRIDGE_STATE_DIR readdir; non-.cred survival verified by test (registry.json test) |
| T-79-08-06 | DoS — startReconcileLoop crashes container | mitigated | fire-and-forget wrapper in starter.ts .catches; scanAndReconcileDeadTokens itself wraps mint calls; interval .unref'd (Test 6 verifies) |
| T-79-08-07 | Tampering — insertion-order regression | mitigated | W-1 pre-flight + post-flight line-number assertion (282 < 305) |
| T-79-08-SC | Package-install threat surface | mitigated | zero new packages |

## Deviations from Plan

None. Plan 08 executed exactly as written. Minor cosmetic observations:
1. Test file added a 7th test ("empty users table returns ok:true with results: []") beyond the plan's 6 listed cases — extra defensive coverage of an edge that the migration endpoint will hit in tests. No behavior change.
2. Test file mocks `../telegram/shared-volume.js` with a getter (not called out explicitly in PLAN.md) because the routes module is imported at file scope; the const would otherwise freeze before per-test `TG_BRIDGE_STATE_DIR_OVERRIDE` fires. This is the standard workaround for testing const-at-module-load env-var readers and does not affect production behavior.

## Files + line ranges

**Created:**
- `src/backend/telegram/reconcile-dead-tokens.ts` — 188 lines
  - L37-52: `ReconcileResult` interface + doc
  - L54-165: `scanAndReconcileDeadTokens` body (guard → users lookup → per-sentinel loop with mint + conditional unlink)
  - L167-188: `startReconcileLoop` — setInterval wrapper with `.catch` + `.unref`
- `src/backend/telegram/reconcile-dead-tokens.test.ts` — 216 lines
  - L25-70: mocks (mintAndWriteHumanToken, databaseLogger spies, db.select, users schema)
  - L72-92: beforeEach/afterEach with tempDir + TG_BRIDGE_STATE_DIR_OVERRIDE + vi.resetModules
  - L94-215: 6 tests

**Modified:**
- `src/backend/starter.ts`
  - L287-311: new Plan 08 fire-and-forget block (dynamic import + startReconcileLoop(30_000) + warn-log catch)
- `src/backend/matrix/matrix-admin-routes.ts`
  - L14: added `import { promises as fsp } from "node:fs"`
  - L21-22: added imports for `mintAndWriteHumanToken` + `TG_BRIDGE_STATE_DIR`
  - L128-244 (new): migrate-cred-files handler (users iteration → per-row mint → .cred deletion → per-row status response + audit log)
- `src/backend/matrix/matrix-admin-routes.test.ts`
  - L74-113 (modified vi.hoisted block + additional mocks): dbSelectMock, users schema mock, mintAndWriteHumanTokenMock, shared-volume getter mock
  - L285-484 (new): 7 tests for POST /migrate-cred-files

## Commits

- `c88ad43b` test(79-08): add failing tests for reconcile-dead-tokens sweep + startReconcileLoop
- `0f98d5b6` feat(79-08): implement reconcile-dead-tokens sweep + wire 30s loop in starter.ts
- `f09b2a01` test(79-08): add failing tests for POST /matrix-admin/migrate-cred-files
- `3cf357b3` feat(79-08): add POST /matrix-admin/migrate-cred-files admin-gated migration

## Ready for Plan 09

Wave 5's second slot is Plan 09 — the go-live human-verify checkpoint against t1000. Everything Plan 08 promised is in place:
- Reconcile loop fires every 30s inside the Skynet container, reacts to bridge-side 401 sentinels, silently self-heals dead tokens.
- Migration endpoint is one POST away from being called against t1000 as part of cutover.
- All security guards (path traversal, admin gate, atomic writes) test-verified.

## Self-Check: PASSED

**Files verified to exist:**
```
[ -f src/backend/telegram/reconcile-dead-tokens.ts ] → FOUND
[ -f src/backend/telegram/reconcile-dead-tokens.test.ts ] → FOUND
[ -f src/backend/matrix/matrix-admin-routes.ts ] → FOUND (modified)
[ -f src/backend/matrix/matrix-admin-routes.test.ts ] → FOUND (modified)
[ -f src/backend/starter.ts ] → FOUND (modified)
```

**Commits verified in git log:**
```
c88ad43b → FOUND (test RED, Task 1)
0f98d5b6 → FOUND (feat GREEN, Task 1)
f09b2a01 → FOUND (test RED, Task 2)
3cf357b3 → FOUND (feat GREEN, Task 2)
```

**Verification commands re-run:**
- `npx vitest run` for both test files: 23/23 pass.
- `npx tsc --noEmit -p tsconfig.backend.json` for Plan 08 files: zero errors.
- W-1 order assertion `282 < 305`: PASS.
- Users column check: `users.username` at schema.ts:6, `users.mxid` at schema.ts:32, both used correctly.
