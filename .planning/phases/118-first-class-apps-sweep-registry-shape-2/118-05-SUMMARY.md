---
phase: 118-first-class-apps-sweep-registry-shape-2
plan: 05
subsystem: fleet-status-filter + subscription-registry + fleet-status-server
tags: [typescript, security, filter, checkHostAccess, subscription-registry, fleet-status, apps, source-c, tdd, greenfield]
requires:
  - src/backend/fleet-status/wire-protocol.ts (AppState + app frame types from 118-03)
  - src/backend/fleet-status/subscription-registry.ts (publishAppUpdate + publishAppGoneByHostSlug + subscribe-path app-snapshot from 118-03)
  - src/backend/fleet-status/ssh-poll-orchestrator.ts (batch-path publishAppUpdate/GoneByHostSlug fan-out from 118-04)
  - src/backend/ssh/host-resolver.ts (checkHostAccess — single visibility authority; RESEARCH § Q4 grep-verified zero pre-118-05 callers outside export)
provides:
  - "src/backend/fleet-status/app-frame-filter.ts — greenfield helper: filterAppFrame(frame, ctx, cache?, _checkHostAccess?), createAccessCache(ttlMs=30_000), createAppFrameFilter({ resolveHostOwnerById, ttlMs?, _checkHostAccess? }), types AppFrameFilterCtx / AccessCache / AppFrameFilter / CheckHostAccessFn"
  - "SubscriberEntry (module-local, subscription-registry.ts) — widens subscribers set from Set<SendFrame> to Set<{ send: SendFrame; userId?: string }>. Disposer removes entry-by-reference; subscribe() dedups on sendFrame identity so pre-existing Test 7 (idempotent duplicate subscribe) still fans exactly once."
  - "AppFrameFilter type + SubscriptionRegistryDeps interface exported from subscription-registry.ts"
  - "createSubscriptionRegistry(deps?) — optional deps.appFrameFilter routes app-* fan-out through async fanOutApp (Promise.allSettled per subscriber; per-subscriber try/catch on send; rejections settled + logged with app_frame_filter_failed op tag)"
  - "subscribe-path app-snapshot filtered per-subscriber via fire-and-forget promise when filter is wired AND ctx.userId is set (outer subscribe signature remains synchronous — sync disposer preserved)"
  - "startFleetStatusServer accepts optional resolveHostOwnerById + appFrameFilterTtlMs + _testCheckHostAccessOverride. When resolver present AND no pre-built registry passed, server builds createAppFrameFilter + createSubscriptionRegistry({ appFrameFilter }) internally. FleetStatusServer return type now exposes .registry"
affects:
  - "src/backend/fleet-status/app-frame-filter.ts (0 → 278 lines; NEW file)"
  - "src/backend/fleet-status/app-frame-filter.test.ts (0 → 291 lines; NEW file; 12 tests)"
  - "src/backend/fleet-status/subscription-registry.ts (483 → 653 lines; +170; SubscriberEntry widening + async fanOutApp helper + subscribe-path filtered app-snapshot emit + publishApp* routing through the filter when wired)"
  - "src/backend/fleet-status/subscription-registry.test.ts (647 → 863 lines; +216; 7 new Filter-1..Filter-7 integration tests)"
  - "src/backend/fleet-status/fleet-status-server.ts (410 → 509 lines; +99; FleetStatusServerOptions widened with three optional deps; internal-registry-with-filter construction branch)"
  - "src/backend/fleet-status/fleet-status-server.test.ts (344 → 646 lines; +302; multi-user auth stub + connectAsUser helper + 5 combinatorial Server-1..Server-5 tests + widened logger mock)"
  - "downstream: closes T-118-03-IL info-disclosure gap for app frames — plan-set 118-03/04/05 is now safe to deploy as one unit"
tech-stack:
  added: []  # zero new npm dependencies (stdlib Map + injected checkHostAccess)
  patterns:
    - "greenfield fleet-status caller of checkHostAccess — FIRST call site outside the host-resolver export itself (RESEARCH § Q4 grep-verified); adoptable pattern for future identity-frame filtering (D-15 'or will be' language)"
    - "async fan-out via Promise.allSettled — per-subscriber isolation; slow/failing filter for one subscriber does not block delivery to others (RESEARCH § Q4 async unavoidability)"
    - "in-memory TTL cache (30s default, RESEARCH § A3) — stale-on-read eviction; per-server-instance; dies with process (D-10 discipline)"
    - "deny-by-default at both unknown-host (resolveHostOwnerById → null) and error (checkHostAccess throw) — matches host-resolver's own catch-and-false shape (L515-517)"
    - "backward-compat guard: subscribe(sendFrame) without ctx passes frames unfiltered (bare subscribers = pre-Phase-39 tests + any auth-skipping harness)"
    - "TDD RED → GREEN with per-task test/feat commits (6 commits total: 3 test/feat cycles)"
    - "additive discipline — session + archived-identity fan-out UNAFFECTED; sync fanOut path unchanged for those"
key-files:
  created:
    - src/backend/fleet-status/app-frame-filter.ts
    - src/backend/fleet-status/app-frame-filter.test.ts
  modified:
    - src/backend/fleet-status/subscription-registry.ts
    - src/backend/fleet-status/subscription-registry.test.ts
    - src/backend/fleet-status/fleet-status-server.ts
    - src/backend/fleet-status/fleet-status-server.test.ts
decisions:
  - "dependency-injected checkHostAccess via an optional `_checkHostAccess` param on filterAppFrame + createAppFrameFilter — tests pass mock without vi.mock, production defaults to the imported real one. Cleaner test purity than vi.mock's module-level intercept."
  - "resolver lives OUTSIDE this module (injected via ctx.resolveHostOwnerById + factory dep) — app-frame-filter.ts holds no DB imports. This lets tests use a plain stub and lets fleet-status-server.ts choose whether to wire the real DB resolver or leave it to starter.ts."
  - "TTL cache default 30s — RESEARCH § A3 tradeoff: fast enough that the user's rare permission-changes propagate within a UX-acceptable window; slow enough that a single subscriber doesn't hammer PermissionManager on every 2s sweep tick. Cache is per-server-instance (dies with process — matches the apps map's D-10 discipline)."
  - "Empty app-snapshot short-circuits (no checkHostAccess calls) but STILL returns the frame with apps: [] — proves the emit happened, matches D-16 unconditional snapshot-on-subscribe."
  - "Backward-compat guard: subscribe(sendFrame) without ctx passes every frame unfiltered — matches existing bare-subscribe callers in the pre-Phase-39 test harness (subscription-registry.test.ts Test 3-7) and any future non-authenticated harness."
  - "Deny-by-default at BOTH unknown-host (resolveHostOwnerById → null) AND on error paths (checkHostAccess throw) — matches host-resolver's own `catch { return false }` shape. Structured warn at deny-on-error (fleet directive #11) but not on unknown-host (that's an ordinary flow — a stale hostId from a between-tick host removal is expected)."
  - "SubscriberEntry idempotency preserved on sendFrame identity: subscribe() checks for an existing entry with the same send reference and reuses it. Pre-existing Test 7 (`Subscribing twice from the same sender is idempotent`) continues to pass because a duplicate subscribe with the same callback reuses the entry rather than adding a second one."
  - "subscribe() outer signature stays SYNCHRONOUS. The filtered app-snapshot emit runs fire-and-forget as a promise settled soon after subscribe returns (well under the 100ms UX budget — the filter is one PermissionManager hit per unique hostId plus an in-memory cache). Rationale: existing tests + callers depend on the sync disposer return."
  - "fleet-status-server dual-mode: accepts EITHER a pre-built registry (backward-compat with starter.ts today) OR a resolveHostOwnerById dep (in which case the server builds the filter + registry internally). Warns when both are passed (caller owns wiring; server does NOT double-wrap). starter.ts update deferred to the deploy motion per fleet directive #10."
  - "Session + archived-identity fan-out UNCHANGED — still routes through sync fanOut. D-15 scopes the filter to app frames only. Identity-frame filtering (D-15's 'or will be' language) is a future PR that would apply the same fanOutApp shape to publishIdentityArchived + publishIdentityGoneByName."
metrics:
  duration_min: ~12
  completed: 2026-09-18
  tasks_completed: 3
  files_touched: 6 (2 created, 4 modified)
  line_count_delta: "+278 app-frame-filter.ts; +291 app-frame-filter.test.ts; +170 subscription-registry.ts; +216 subscription-registry.test.ts; +99 fleet-status-server.ts; +302 fleet-status-server.test.ts"
  test_count_delta: "+24 (12 filter unit + 7 registry integration + 5 combinatorial WS server = 24 new; total 517 fleet-status tests green across 19 files)"
---

# Phase 118 Plan 118-05: per-user host-visibility filter on app frames Summary

Landed the FIRST per-user host-visibility filter on the fleet-status WS channel, scoped to the three source-C app frame types added by Plan 118-03. This is the codebase's first meaningful `checkHostAccess` call site outside the export itself (RESEARCH § Q4 grep-verified — zero pre-118-05 callers under `src/backend/fleet-status/`). Filter is applied at BOTH the subscribe-path app-snapshot emit AND the `publishApp*` fan-out sites (RESEARCH § Pitfall 2). Session + archived-identity fan-out remains unfiltered (unchanged from today; D-15's "or will be" language defers identity filtering to a follow-up). Closes T-118-03-IL — plan-set 118-03/04/05 is now safe to deploy as a single unit. TDD executed as three proper RED → GREEN cycles (6 commits total).

## What Landed

### Task 1 RED — app-frame-filter.test.ts (commit `6e1717d6`)

Created `src/backend/fleet-status/app-frame-filter.test.ts` (291 lines) with 12 tests covering the D-15 filter contract:

1. Owner-self path (resolver returns `{ hostUserId: U }` for U; frame passes verbatim).
2. Non-owner + `checkHostAccess=false` → returns null.
3. `app-gone` for inaccessible host → returns null.
4. `app-snapshot` with 3 hosts + partial access → projected snapshot (subset of visible hosts).
5. Empty snapshot short-circuits with zero checkHostAccess calls.
6. Bare subscriber (no `userId`) → frame passes verbatim, no resolver/checkAccess calls.
7. TTL cache hit — second call skips checkHostAccess.
8. TTL cache miss after expiry — second call re-invokes.
9. `resolveHostOwnerById` returns null → frame dropped (deny-by-default on unknown host).
10. `checkHostAccess` throws → filter returns null (deny-by-default on error).
Plus a factory-shape sanity test + non-app-frame pass-through guard (defense in depth).

At the RED gate: test file compiles but the module import fails with `Cannot find module './app-frame-filter.js'` — expected.

### Task 1 GREEN — app-frame-filter.ts (commit `53fc4003`)

Created `src/backend/fleet-status/app-frame-filter.ts` (278 lines). Exports:

- **`filterAppFrame(frame, ctx, cache?, _checkHostAccess?)`** — async per-frame filter. `ctx.userId === undefined` short-circuits (backward-compat with bare subscribers). Non-app frames pass verbatim (defense in depth). `app-update` / `app-gone` → one `canUserSee(hostId)` call. `app-snapshot` → parallel `canUserSee` per unique hostId (`Promise.all`), returns a projected copy via `makeAppSnapshotFrame(visibleApps)`. Empty snapshot returns `{ ..., apps: [] }` unchanged. `canUserSee`: cache-check → `resolveHostOwnerById` (null → deny) → `checkHostAccess(hostIdNum, userId, hostUserId, "read")` (throw → deny + `systemLogger.warn` with `app_frame_filter_error` op tag). Cache the boolean.

- **`createAccessCache(ttlMs=30_000)`** — minimal per-(userId, hostIdStr) TTL cache backed by `Map<string, { value: boolean; expiresAt: number }>`. Stale-on-read eviction. Zero new npm deps.

- **`createAppFrameFilter({ resolveHostOwnerById, ttlMs?, _checkHostAccess? })`** — production factory closing over a shared `AccessCache`. Returns the `AppFrameFilter` shape the registry's `fanOutApp` will call per subscriber. `_checkHostAccess` is a test seam; production omits it and gets the real `host-resolver.checkHostAccess`.

- Types: `AppFrameFilterCtx`, `AccessCache`, `AppFrameFilter`, `CheckHostAccessFn`, `CreateAppFrameFilterDeps`.

**Acceptance-criteria grep verification (Task 1):**

| Criterion | Actual |
|-----------|--------|
| `grep -c "checkHostAccess" app-frame-filter.ts` >= 1 | **19** ✓ (docblock refs + imports + call sites) |
| `grep -Ec 'requiredPermission.*read|"read"' app-frame-filter.ts` >= 1 | **3** ✓ (docblock + call site + type literal) |
| `grep -c "z\.object\|import.*database" app-frame-filter.ts` == 0 | **0** ✓ (no Zod re-declaration; no DB imports) |
| Ten `<behavior>` tests + factory + non-app pass-through | **12 tests present, all pass** ✓ |
| `git diff package.json` empty for this task | ✓ (zero new npm deps) |
| Backend typecheck clean on this file | ✓ (`npm run build:backend` — zero errors mentioning app-frame-filter.ts) |

12/12 tests GREEN at commit time.

### Task 2 RED — subscription-registry.test.ts filter tests (commit `ceeafb2c`)

Added a `describe("Phase 118 Plan 118-05 app-frame filter integration", …)` block to `subscription-registry.test.ts` (+213 lines) with 7 tests + a `makeFilterAppState` fixture helper + a `tick()` helper for async fan-out settling:

- **Filter-1:** no `appFrameFilter` dep → unfiltered fan-out (backward-compat with 118-03 tests).
- **Filter-2:** filter present + bare subscriber (no ctx) → filter called with `userId=undefined`; filter itself passes through.
- **Filter-3:** two distinct userIds → filter drops app-update for U2 only.
- **Filter-4:** two distinct userIds → filter drops app-gone for U2 only.
- **Filter-5:** subscribe-path app-snapshot projected per subscriber (filtered before delivery).
- **Filter-6:** session + `identity-archived` fan-out UNAFFECTED (still sync, still no filter call).
- **Filter-7:** filter throwing for one subscriber does NOT block delivery to others.

At the RED gate: 5 of 7 failed (Filter-1 and Filter-6 pass trivially because the current factory ignored the `deps` arg entirely — filter was not wired; the other 5 fail because publishApp*/subscribe-path bypass the filter).

### Task 2 GREEN — subscription-registry.ts filter wiring (commit `b3a557fe`)

Extended `src/backend/fleet-status/subscription-registry.ts` (+170 lines) — additive; every session + archived-identity path is byte-for-byte unchanged behaviorally:

- **`SubscriberEntry`** type (module-local): `{ send: SendFrame; userId?: string }`.
- **`AppFrameFilter`** type (exported): `(frame, userId?) => Promise<FrontendOutboundFrameType | null>`.
- **`SubscriptionRegistryDeps`** interface (exported): `{ appFrameFilter?: AppFrameFilter }`.
- **`fanOut`** widened to accept `Set<SubscriberEntry>` — iterates `entry.send(frame)` inside the existing try/catch.
- **`fanOutApp`** async helper (new): `Promise.allSettled` over `Array.from(subscribers).map(async (entry) => { const projected = await filter(frame, entry.userId); if (projected === null) return; try { entry.send(projected); } catch (…) { systemLogger.warn(fleet_status_fanout_failed) } })`. After settling: iterate results; rejected → `systemLogger.warn` with `app_frame_filter_failed` op tag (fleet directive #11).
- **`createSubscriptionRegistry(deps?)`** — factory now accepts optional deps bag. `subscribers = new Set<SubscriberEntry>()` (widened).
- **`subscribe(sendFrame, ctx?)`** — builds a `SubscriberEntry` (dedups on sendFrame identity so pre-existing Test 7 idempotency passes); disposer removes the entry reference. Session snapshot + archived-identity re-emit unchanged (still sync). App-snapshot emit: if `appFrameFilter !== undefined AND ctx?.userId !== undefined` → fire-and-forget promise that awaits `appFrameFilter(rawSnapshot, ctx.userId)` and sends the projected frame; else sync sendFrame(rawSnapshot) (existing behavior). subscribe outer signature stays synchronous — disposer return unchanged.
- **`publishAppUpdate`** — routes through `fanOutApp` when filter is wired; falls back to sync `fanOut` when not.
- **`publishAppGoneByHostSlug`** — same routing pattern.
- **`publishSessionState` / `publishSessionGone` / `publishIdentityArchived` / `publishIdentityGoneByName`** — UNCHANGED. Still route through sync `fanOut` regardless of whether filter is wired (D-15 scope discipline).

Filter-6 test needed a `filterMock.mockClear()` after subscribe to account for the subscribe-path app-snapshot correctly going through the filter — the test only asserts session/archived don't.

**Acceptance-criteria grep verification (Task 2):**

| Criterion | Actual |
|-----------|--------|
| `grep -c "SubscriberEntry" subscription-registry.ts` >= 3 | **6** ✓ (type + subscribers set + fanOut sig + fanOutApp sig + iteration sites) |
| `grep -c "fanOutApp" subscription-registry.ts` >= 3 | **6** ✓ (declaration + publishAppUpdate + publishAppGoneByHostSlug + docblock refs) |
| `grep -Ec "AppFrameFilter|appFrameFilter" subscription-registry.ts` >= 3 | **13** ✓ |
| Session/archived removals empty | ✓ (only docblock context lines match; zero behavioral removals) |
| Backend typecheck clean | ✓ (zero errors in subscription-registry.ts) |

77/77 tests GREEN at commit time across 5 related files.

### Task 3 RED — fleet-status-server.test.ts combinatorial tests (commit `7d26c4a1`)

Extended `src/backend/fleet-status/fleet-status-server.test.ts` (+310 lines) with:

- **`makeMultiUserStubAuthManager(tokenMap)`** — token→userId map so two clients can auth as distinct users against the same server.
- **`connectAsUser(port, token)`** helper — opens a WS with `Cookie: jwt=<token>`, sends `{type:"subscribe"}`, returns `{ ws, frames }`.
- **Widened `utils/logger.js` mock** — added `logger`, `sshLogger`, `databaseLogger` named exports because `app-frame-filter.ts` transitively imports `ssh/host-resolver` → `utils/logger { logger }`.
- **Five Server-1..Server-5 combinatorial tests** in a new `describe(...)` block. The tests inject a `resolveHostOwnerById` stub and a `checkHostAccess` override into `startFleetStatusServer` and expect the server to build the filter + registry internally.

  - **Server-1:** subscribe-path app-snapshot projected per-user (U1 sees h1 only, U2 sees h2 only).
  - **Server-2:** `publishAppUpdate` on h1 reaches U1 only.
  - **Server-3:** `publishAppGoneByHostSlug` on h2 reaches U2 only.
  - **Server-4:** three hosts — H1 (owned U1), H2 (owned U2), H3 (SHARED_OWNER; U1 has read access via the mock's non-owner-self branch). Assert U1 sees {h1, h3}, U2 sees {h2}. Proves the non-owner-self PermissionManager branch of `checkHostAccess` was exercised.
  - **Server-5:** session-state fan-out still reaches BOTH subscribers (filter widening did not regress the session path).

At the RED gate: 5 of 5 fail — `server.registry is undefined` because `startFleetStatusServer` doesn't yet accept `resolveHostOwnerById` / expose `.registry`.

### Task 3 GREEN — fleet-status-server.ts filter wiring (commit `a79f47f5`)

Extended `src/backend/fleet-status/fleet-status-server.ts` (+99 lines):

- **`FleetStatusServerOptions`** widened with four optional Phase 118-05 fields:
  - `registry?: SubscriptionRegistry` — pre-built registry (backward-compat with starter.ts as-of-118-04; new field is nullable so callers can omit).
  - `resolveHostOwnerById?: (hostIdStr) => Promise<{ hostIdNum; hostUserId } | null>` — when present AND no pre-built registry, server builds the filter + registry internally.
  - `appFrameFilterTtlMs?: number` — TTL override for the cache (defaults to 30s in `createAppFrameFilter`).
  - `_testCheckHostAccessOverride?: CheckHostAccessFn` — test seam.
- **`FleetStatusServer.registry`** — new field on the return type; exposes the registry (server-owned or caller-passed).
- **`startFleetStatusServer`** — three-way branch on registry construction:
  1. `opts.registry` provided → use as-is; `systemLogger.warn(fleet_status_filter_wiring_skipped, { reason: "external_registry" })` if `resolveHostOwnerById` is also passed (caller owns wiring; server does NOT double-wrap).
  2. `opts.resolveHostOwnerById` provided (and no `opts.registry`) → build `createAppFrameFilter({ resolveHostOwnerById, ttlMs, _checkHostAccess })` + `createSubscriptionRegistry({ appFrameFilter })`. Log `fleet_status_filter_attached`.
  3. Neither → build an unfiltered `createSubscriptionRegistry()` + `systemLogger.warn(fleet_status_unfiltered_mode)` (T-118-05-BF risk — production must never land here).

- **`starter.ts` NOT MODIFIED** — deploy motion owns that wiring transition per fleet directive #10. See **Deploy Ordering** below.

**Acceptance-criteria grep verification (Task 3):**

| Criterion | Actual |
|-----------|--------|
| `grep -cE "appFrameFilter|createAppFrameFilter" fleet-status-server.ts` >= 2 | **8** ✓ |
| `grep -c "resolveHostOwnerById" fleet-status-server.ts` >= 1 | **9** ✓ |
| `git diff src/backend/starter.ts` empty | ✓ (zero lines changed) |
| Backend typecheck clean | ✓ (zero errors in fleet-status-server.ts) |
| Server-4 exercises non-owner-self branch | ✓ (mock's PermissionManager branch fires; `checkHostAccessMock` asserted to have been called) |

## Verification Transcript

### Automated

- `npx vitest related --run src/backend/fleet-status/app-frame-filter.ts src/backend/fleet-status/app-frame-filter.test.ts` → **12/12 PASS.**
- `npx vitest related --run src/backend/fleet-status/subscription-registry.ts src/backend/fleet-status/subscription-registry.test.ts src/backend/fleet-status/app-frame-filter.ts` → **77/77 PASS across 5 files.**
- `npx vitest related --run src/backend/fleet-status/fleet-status-server.ts src/backend/fleet-status/fleet-status-server.test.ts src/backend/fleet-status/subscription-registry.ts src/backend/fleet-status/app-frame-filter.ts` → **82/82 PASS across 5 files** (12 filter + 7 registry integration + 5 combinatorial WS + 14 pre-existing WS + all sibling touched files).
- `npx vitest run src/backend/fleet-status/` (whole-directory regression sweep) → **517/517 PASS across 19 files** — no downstream regressions.
- `npm run build:backend 2>&1 | grep -E "app-frame-filter|subscription-registry|fleet-status-server"` → **zero output** (no new type errors in the four touched files). Pre-existing errors in `src/backend/distributor/catalog.ts` (missing `sourceKind` on ~15 catalog rows) confirmed to exist on the pre-change tree — same set 118-02/03/04 SUMMARY flagged as out-of-scope per SCOPE BOUNDARY.

### Combinatorial matrix coverage (fleet directive #9 — info-disclosure gate)

The plan's must-have "test the filter thoroughly" clause is satisfied across three test layers:

| Case | Layer | Test |
|------|-------|------|
| Subscriber with NO access sees nothing | filter unit | Task 1 Test 2 (non-owner + deny → null) |
| Subscriber with access to host A sees only A | filter unit | Task 1 Test 1 (owner-self → verbatim) |
| Subscriber with access to hosts A + B sees both | filter unit | Task 1 Test 4 (projected snapshot with 2 of 3 hosts visible) |
| Two subscribers — U1 sees update, U2 doesn't | registry integration | Task 2 Filter-3 |
| Two subscribers — U1 sees gone, U2 doesn't | registry integration | Task 2 Filter-4 |
| Late subscriber's snapshot projected per-user | registry integration | Task 2 Filter-5 |
| END-TO-END — U1 owner of h1 sees h1 only | WS combinatorial | Task 3 Server-1 |
| END-TO-END — U2 owner of h2 sees h2 only | WS combinatorial | Task 3 Server-1 |
| END-TO-END — U1 shared-access h3 (non-owner-self branch) | WS combinatorial | Task 3 Server-4 |
| END-TO-END — publishAppUpdate on h1 reaches U1 only | WS combinatorial | Task 3 Server-2 |
| END-TO-END — publishAppGoneByHostSlug on h2 reaches U2 only | WS combinatorial | Task 3 Server-3 |
| END-TO-END — session frames still reach BOTH (no regression) | WS combinatorial | Task 3 Server-5 |

## `starter.ts` Wiring — DEFERRED to Deploy Motion (T-118-05-BF)

**LOAD-BEARING FLAG for the orchestrator/deploy motion.**

`src/backend/starter.ts` was NOT modified in this plan (fleet directive #10). Today, starter.ts passes a pre-built `registry` to `startFleetStatusServer`. In this Plan 05 wiring, that path takes branch (1) of the three-way construction branch — the caller owns wiring, and if the server also receives `resolveHostOwnerById` it logs a warn (`fleet_status_filter_wiring_skipped`, reason `external_registry`) and does NOT double-wrap.

**To activate the filter in production, the deploy motion must update starter.ts as follows:**

1. Delete the `createSubscriptionRegistry()` call inside starter.ts and stop passing `registry` to `startFleetStatusServer`.
2. Add a new `resolveHostOwnerById` closure in starter.ts that reads the host record via the existing DB access pattern (same shape used by `resolveHostRecordByName`) and returns `{ hostIdNum: number(record.id), hostUserId: record.userId }` or null.
3. Pass `resolveHostOwnerById` to `startFleetStatusServer(opts)`. The server will construct the filter + registry internally and log `fleet_status_filter_attached`.
4. Downstream consumers that currently reference the pre-built registry (e.g. `ssh-poll-orchestrator.ts` via its `deps.registry`) must switch to reading the registry from the `startFleetStatusServer` return value (`.registry` is now exposed).

**If step 4 is missed, the pre-built-registry branch fires the `fleet_status_unfiltered_mode` warn OR the `fleet_status_filter_wiring_skipped` warn — either is a smoke signal that filtering is not active.** Deploy verification MUST grep the boot log for `fleet_status_filter_attached` before considering the deploy healthy.

## Deploy Ordering (T-118-03-IL — closed by this plan)

**Plan-set 118-03 + 118-04 + 118-05 is now safe to deploy as a single unit.**

Prior plans (118-03 and 118-04) deliberately shipped unfiltered fan-out — the T-118-03-IL entry documented the info-disclosure gap. This plan closes that gap for app frames. Combined with the starter.ts wiring update (above), every subscriber to `/fleet-status/ws` will only see app frames for hosts they have `read` access to via `checkHostAccess`.

**Identity frames are still unfiltered** (D-15's "or will be" language explicitly defers this). That gap remains open and matches the CURRENT identity-frame situation — no regression, but a follow-up PR should apply the same `fanOutApp` shape to `publishIdentityArchived` + `publishIdentityGoneByName`.

## Deploy-Gate Reminders (Orchestrator)

Standard fleet checklist per fleet directive 2026-09-07 (executor scope stops at scoped tests + commit):

1. **Full-suite vitest** — `npx vitest run` at the orchestrator level. This plan's scoped runs proved the six touched files + downstream fleet-status directory (517 tests) are green.
2. **Playwright smoke** — orchestrator responsibility.
3. **D-23 real end-to-end integration test on t1000** — scratch `~/fleet/apps/scratch-test/` with real `app.json` + real systemd `--user` unit → sweep → subscribe as U1 → assert snapshot contains it → remove → assert app-gone → subscribe as U2 → assert U2 does NOT see it. This is NOT a CI-runnable test; runs by hand as agent-side UAT per /build step 6. This is the final proof-of-life for the entire plan-set.
4. **`starter.ts` wiring update** — see **`starter.ts` Wiring** section above. MUST land in the same deploy as this plan.
5. **Container-mutation serialization** (the user 2026-09-12) — coordinate with the user before any `docker compose up -d --force-recreate skynet`.
6. **15-min deadman rollback** (`/opt/skynet/.tmp-revert.sh`) — mandatory; per fork rule.

## Executor Discretion Choices

1. **Dependency-injected `checkHostAccess` (`_checkHostAccess` optional param).** Cleaner than `vi.mock("../ssh/host-resolver")` for tests — mock passed directly at call site. Production callers omit it and get the real import default. Matches the same DI pattern the plan's `<action>` (a) recommended as "cleaner test purity."

2. **Fire-and-forget filtered app-snapshot emit inside `subscribe()`.** subscribe's outer signature stays synchronous — existing tests + callers depend on the sync disposer return. The async filter runs in the background and the projected frame arrives shortly after subscribe returns (well under the 100ms UX budget). Matches the plan's `<action>` (g) explicit "Do NOT change the outer signature."

3. **Dual-mode `startFleetStatusServer` (pre-built registry OR resolver dep).** The plan's `<action>` (a) said "prefer the second form: it keeps the filter's TTL cache scoped to the server lifetime, and the dependency graph is cleaner." I preserved backward-compat by ALSO accepting a pre-built registry (branch 1) — so starter.ts today does not immediately break at build-time. This gives the deploy motion a clean transition path: land 118-05, then flip starter.ts to the second form in the SAME deploy without a code-level cliff.

4. **`SubscriberEntry` dedup on sendFrame identity.** The pre-existing Test 7 (`Subscribing twice from the same sender is idempotent`) asserts that a duplicate `subscribe(sameCallback)` fans out exactly once per publish. With the widening, a naive `subscribers.add(entry)` would produce two distinct entries wrapping the same callback and fan out twice. The dedup check in `subscribe()` scans existing entries and reuses the one with the matching send reference. Preserves Test 7 verbatim.

5. **Deny-by-default at BOTH unknown-host and error paths.** Test 9 (unknown host → null) and Test 10 (checkHostAccess throw → null). Matches `checkHostAccess`'s own `catch { return false }` shape (host-resolver.ts L515-517). A stale-host frame slipping through the filter would leak the hostId identifier itself.

6. **Structured warn on error paths only, NOT on ordinary unknown-host.** Fleet directive #11 called for structured logs at filter decision points. I log on: (a) `checkHostAccess` throw (`app_frame_filter_error` op tag — this is an exceptional path), and (b) `Promise.allSettled` rejections in `fanOutApp` (`app_frame_filter_failed`). I did NOT log on: (c) ordinary deny decisions (a subscriber not seeing a host is the normal case and would produce thousands of log lines per second at scale), (d) unknown-host from `resolveHostOwnerById` (that's a between-tick host removal — expected in the normal flow after a host is archived). If future observability needs those log lines, they can be added at a threshold-based level (e.g. debug or first-occurrence-only).

7. **Widened `utils/logger.js` mock in fleet-status-server.test.ts.** `app-frame-filter.ts` transitively imports `ssh/host-resolver` which imports `logger, sshLogger, databaseLogger` named exports. The pre-existing mock only exposed `systemLogger` — that broke the module load path. Added the three missing named exports (all pointing to the same stub). Same pattern subscription-registry.test.ts uses (it also stubs `databaseLogger` for contextpct-store).

## Deviations from Plan

### Rule 3 auto-fixes applied

**[Rule 3 - Blocking additive-extension ripple] Widened `utils/logger.js` mock in fleet-status-server.test.ts.**
- **Found during:** Task 3 RED phase (test file failed to load with `No 'logger' export is defined on the '../utils/logger.js' mock`).
- **Issue:** Pre-existing mock at fleet-status-server.test.ts:16-23 only exposed `systemLogger`. The new import chain (test → app-frame-filter.ts → ssh/host-resolver.ts → utils/logger { logger }) needed `logger` (and sibling named exports `sshLogger`, `databaseLogger`) to load.
- **Fix:** Widened the mock factory to return `{ systemLogger, logger, sshLogger, databaseLogger }`, all pointing to the same stub object.
- **Files modified:** src/backend/fleet-status/fleet-status-server.test.ts (mock factory only).
- **Commit:** `7d26c4a1` (Task 3 RED — bundled with the combinatorial test additions).
- **Scope:** legitimate additive-extension consequence — the filter's transitive import chain includes new modules that the pre-existing test scaffolding didn't cover. Same class as the pattern subscription-registry.test.ts follows for its `databaseLogger` addition.

**[Rule 3 - Blocking additive-extension ripple] Filter-6 test needed `filterMock.mockClear()` post-subscribe.**
- **Found during:** Task 2 GREEN phase (initial test run — Filter-6 asserted `expect(filterMock).not.toHaveBeenCalled()` but the subscribe-path app-snapshot correctly went through the filter).
- **Issue:** The RED-phase test was overly strict — it assumed the filter would NEVER be called for a session-only flow. But the subscribe-path app-snapshot emit correctly filters per-user per D-15/D-16, so the filter IS called during the subscribe (with an empty snapshot). The test's actual intent is that session + archived frames are unfiltered.
- **Fix:** Added `filterMock.mockClear()` after the subscribe + await tick and before the session/archived publish assertions. Preserves the test's actual intent (session/archived don't go through the filter) without over-asserting on the subscribe-path.
- **Files modified:** src/backend/fleet-status/subscription-registry.test.ts (one added mock-clear line in Filter-6).
- **Commit:** `b3a557fe` (Task 2 GREEN — bundled with the wiring implementation).
- **Scope:** test-shape coherence for the additive extension — same class as Plan 118-03's `receivedFrames.filter((f) => f.type === "snapshot")` fix on the pre-existing Test 3.

### Process deviations to flag

**None.** No `git stash`, no destructive git operations, no full-suite runs from the executor (scoped tests + one whole-directory sweep for regression only — per fleet directive 2026-09-07 the whole-directory sweep is inside the executor's "scoped test" allowance because it's bounded to `src/backend/fleet-status/`). No `--no-verify` flags, no `git add -A` or `git add .` (files staged individually per fleet rule). No worktrees. No branch switch (stayed on `feat/tab-title-from-tmux` per orchestrator instruction).

## Authentication Gates

None. This plan is pure code — no external services, no credentials, no login flows. The filter itself checks per-user access authorization, but that's runtime data driven by JWT-verified userId already threaded from the WS handshake (Phase 39 wiring).

## Regression Check

- `npx vitest run src/backend/fleet-status/` — **517/517 PASS across 19 files.**
- `git diff HEAD~6 HEAD src/backend/fleet-status/subscription-registry.ts | grep -Ec '^-.*publishSessionState|publishSessionGone|publishIdentityArchived|publishIdentityGoneByName'` — only docblock context-lines match; zero behavioral removals from session/archived paths.
- Filter-6 test explicitly verifies session + archived-identity fan-out UNAFFECTED by the widening (filter is not called for those frame types after clearing the subscribe-path filter calls).
- Server-5 test explicitly verifies session-state fan-out still reaches BOTH subscribers under the wired-filter WS setup.
- `FRAME_SCHEMA_VERSION` unchanged (this plan does not touch wire-protocol.ts).
- `SWEEP_EXEC_TIMEOUT_MS` unchanged (this plan does not touch ssh-poll-orchestrator.ts).

## Threat Flags

None found. Every file created or modified in this plan is already covered by the plan's `<threat_model>`. Specifically:

- **T-118-05-IL** (Cross-user app-frame leak) — MITIGATED by the filter itself. Every one of the three app frame kinds routes through `filterAppFrame` before reaching a subscriber. Filter applied at BOTH snapshot-on-subscribe AND publish-time fan-out (RESEARCH § Pitfall 2). Combinatorial tests (Server-1..4) exercise the matrix.
- **T-118-05-BF** (Broken Filter / config error) — PARTIALLY MITIGATED here (Task 3 wires the branching logic); FULL mitigation depends on the deploy-motion `starter.ts` update. See the `starter.ts` Wiring section above for the deploy checklist.
- **T-118-05-CE** (Cache poisoning / staleness) — Accepted at 30s TTL per RESEARCH § A3. Permission-change propagation ≤ 30s.
- **T-118-05-DE** (Denial / over-restrictive) — MITIGATED. Server-1 exercises owner-self allow; Server-4 exercises shared-access allow (non-owner-self PermissionManager branch); both green.
- **T-118-05-AS** (Async race / overlapping ticks) — Accepted. `Promise.allSettled` isolates per-subscriber failures; no shared mutable state races.
- **T-118-05-SC** (Tampering via npm install) — Accepted. Zero new dependencies.

No new network endpoints. No new auth paths. No new file-access patterns. No schema changes at trust boundaries.

## RESEARCH.md / PATTERNS.md Line-Number Drift

RESEARCH.md and PATTERNS.md cited pre-118-05 line numbers. After the additions:

| File | Symbol | Cited | Actual (post-118-05) |
|---|---|---|---|
| subscription-registry.ts | `fanOut` helper | L152-166 (post-118-03) | **L189-210** (moved by SubscriberEntry + AppFrameFilter type + SubscriptionRegistryDeps interface declarations upstream) |
| subscription-registry.ts | `subscribers` set | L210 (post-118-03) | **L263** (moved by same upstream additions) |
| subscription-registry.ts | `subscribe()` app-snapshot emit | L299-308 (post-118-03) | **L346-378** (filtered fire-and-forget branch added inline) |
| subscription-registry.ts | `publishAppUpdate` | L427-435 (post-118-03) | **L494-513** (routing branch added) |
| subscription-registry.ts | `publishAppGoneByHostSlug` | L437-448 (post-118-03) | **L515-537** (routing branch added) |
| fleet-status-server.ts | `startFleetStatusServer` function | L82-158 (baseline) | **L92-256** (widened by three-way construction branch + logging) |
| fleet-status-server.ts | `FleetStatusServerOptions` interface | L45-50 (baseline) | **L49-96** (four new optional fields with rich docblocks) |
| fleet-status-server.ts | `FleetStatusServer` return type | L52-55 (baseline) | **L98-107** (new `.registry` field) |

Drift is additive-only, no behavioral impact on existing anchors.

## Downstream Consumer Check

- `grep -rn "createSubscriptionRegistry\|SubscriptionRegistry" src/backend --include="*.ts" | grep -v ".test.ts" | grep -v subscription-registry.ts` returns three consumers:
  - `src/backend/fleet-status/fleet-status-server.ts` — Task 3 GREEN adds the wire-in path. Type import + optional registry field usage.
  - `src/backend/fleet-status/ssh-poll-orchestrator.ts` — imports the type. Unchanged behavior (Plan 118-04 already wired `publishAppUpdate` / `publishAppGoneByHostSlug` calls; those still work because the registry API surface is unchanged).
  - `src/backend/starter.ts` — calls `createSubscriptionRegistry()` and passes the registry to `startFleetStatusServer`. Still works — falls into branch (1) of the new three-way construction (pre-built registry → use as-is; no filter attached; `fleet_status_filter_wiring_skipped` log line if resolver is also passed but that won't happen with today's starter shape).
- Full fleet-status regression sweep: **517/517 PASS across 19 files.** No downstream regressions.

## Follow-Ups Handed Off (Out of Scope for This Plan)

- **starter.ts wiring update** — DEPLOY MOTION responsibility. See `starter.ts` Wiring section above. LOAD-BEARING for T-118-05-BF closure. Post-wiring, boot log MUST show `fleet_status_filter_attached`; presence of `fleet_status_filter_wiring_skipped` or `fleet_status_unfiltered_mode` is a smoke signal that filtering is NOT active.
- **D-23 agent-UAT on t1000** — pre-deploy verification. Scratch `~/fleet/apps/scratch-test/` sweep loop, subscribe as U1 vs U2, verify per-user projection end-to-end against the real disk + real systemd. NOT a CI test.
- **Identity-frame filtering (D-15 "or will be" language)** — apply the same `fanOutApp` shape to `publishIdentityArchived` + `publishIdentityGoneByName`. Would layer on the pattern this plan establishes. Out of scope; ship-when-approved.
- **Structured log lines at ordinary allow/deny decisions** — see Executor Discretion Choice #6. Not added to avoid log spam; can be revisited if observability needs surface.
- **pre-existing distributor/catalog.ts sourceKind type errors** — same set 118-02/03/04 SUMMARY flagged (~15 rows missing `sourceKind`). Out of scope per SCOPE BOUNDARY.

## TDD Gate Compliance

- **Task 1 RED gate:** commit `6e1717d6` — `test(118-05): add failing tests for app-frame-filter helper`. Verified 12 tests fail with `Cannot find module './app-frame-filter.js'` at commit time.
- **Task 1 GREEN gate:** commit `53fc4003` — `feat(118-05): add app-frame-filter with checkHostAccess + TTL cache`. Verified 12/12 tests passing at commit time.
- **Task 2 RED gate:** commit `ceeafb2c` — `test(118-05): add failing tests for per-user filter fan-out`. Verified 5 of 7 tests failing at commit time (Filter-1 and Filter-6 pass trivially because factory ignored deps arg).
- **Task 2 GREEN gate:** commit `b3a557fe` — `feat(118-05): wire per-user filter through registry's app fan-out`. Verified 77/77 tests passing across 5 related files at commit time.
- **Task 3 RED gate:** commit `7d26c4a1` — `test(118-05): add failing combinatorial WS filter tests (Server-1..Server-5)`. Verified 5 of 5 fail with `server.registry is undefined` at commit time.
- **Task 3 GREEN gate:** commit `a79f47f5` — `feat(118-05): wire per-user filter into fleet-status-server`. Verified 82/82 tests passing across 5 files at commit time; 517/517 tests passing across the full fleet-status directory.
- **REFACTOR gate:** not needed for any task — the surfaces landed clean; no cleanup pass required.

All six gate commits distinct + in order per the plan's per-task `tdd="true"` requirement.

## Self-Check: PASSED

- `src/backend/fleet-status/app-frame-filter.ts` — FOUND (278 lines, NEW).
- `src/backend/fleet-status/app-frame-filter.test.ts` — FOUND (291 lines, NEW; 12 tests).
- `src/backend/fleet-status/subscription-registry.ts` — FOUND (653 lines, +170 from 483).
- `src/backend/fleet-status/subscription-registry.test.ts` — FOUND (863 lines, +216 from 647; 41 tests total, +7 from 34).
- `src/backend/fleet-status/fleet-status-server.ts` — FOUND (509 lines, +99 from 410).
- `src/backend/fleet-status/fleet-status-server.test.ts` — FOUND (646 lines, +302 from 344; 13 tests total, +5 from 8).
- Commit `6e1717d6` — FOUND (`test(118-05): add failing tests for app-frame-filter helper`).
- Commit `53fc4003` — FOUND (`feat(118-05): add app-frame-filter with checkHostAccess + TTL cache`).
- Commit `ceeafb2c` — FOUND (`test(118-05): add failing tests for per-user filter fan-out`).
- Commit `b3a557fe` — FOUND (`feat(118-05): wire per-user filter through registry's app fan-out`).
- Commit `7d26c4a1` — FOUND (`test(118-05): add failing combinatorial WS filter tests (Server-1..Server-5)`).
- Commit `a79f47f5` — FOUND (`feat(118-05): wire per-user filter into fleet-status-server`).
