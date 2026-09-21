---
phase: 128-push-notifications-replacing-telegram-bridge
plan: 08
subsystem: notifications, telegram-teardown
tags: [push-notifications, wiring, boot-integration, telegram-teardown-partial, wave-3]
requires: [128-02, 128-05, 128-06]
provides: [vapid-boot-gate-active, push-trigger-loop-started-on-boot, /push-subscriptions-route-mounted, telegram-boot-dispatches-removed, /telegram-mount-removed]
affects: [src/backend/starter.ts, src/backend/database/database.ts]
tech-stack:
  added: []
  patterns:
    - "Static import for synchronous throw-at-boot gate (assertVapidConfigAtBoot) — mirrors branding assert-boot placement"
    - "Fire-and-forget void-import block with two-layer catch (S3) for push-trigger loop bootstrap — mirrors observation-loop-starter dispatch"
key-files:
  created: []
  modified:
    - src/backend/starter.ts
    - src/backend/database/database.ts
decisions:
  - "Add push-trigger dispatch AFTER observation-loop dispatch (both enumerate users with mxid — symmetry keeps the bootstrap pair visually paired)"
  - "Add assertVapidConfigAtBoot() as a bare call (matching assertBrandingConfigAtBoot's let-throws-propagate style — starter.ts's uncaught-exception handler surfaces the structured error + non-zero exit for the container supervisor)"
  - "Deleted zero orphaned imports from the three telegram-loop deletions: the deleted blocks used dynamic void-imports only (no top-of-file imports were left behind)"
requirements: [D-06, D-11, D-13, D-18]
metrics:
  duration: ~2min
  completed: 2026-09-21
  tasks: 2
  files: 2
---

# Phase 128 Plan 08: Wire Wave 1 + Wave 2 into starter.ts + database.ts (partial telegram teardown) Summary

**One-liner:** Wired assertVapidConfigAtBoot fail-fast gate + startPushTriggerLoopOnBoot fire-and-forget bootstrap into starter.ts, mounted pushSubscriptionsRoutes at /push-subscriptions in database.ts, and deleted the three telegram-loop boot dispatches + telegramRoutes import + /telegram mount — bridge is no longer bootable and /telegram HTTP prefix is no longer exposed from Express.

## Objective (recap)

Bridge the Wave 1 (VAPID + routes) and Wave 2 (push-trigger loop) artifacts into the running server, and begin the telegram teardown by removing every boot-time dispatch of telegram machinery + the /telegram HTTP mount. After this plan, a fresh backend boot:

1. Throws if VAPID env is missing/malformed (assertVapidConfigAtBoot).
2. Mounts /push-subscriptions.
3. Starts the push-trigger loop for users with mxid (with belt-and-suspenders VAPID gate inside the starter).
4. Does NOT boot any telegram-bridge machinery.
5. Does NOT expose /telegram HTTP prefix from Express.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Wire assertVapidConfigAtBoot + startPushTriggerLoopOnBoot into starter.ts; delete 3 telegram-loop dispatches | `4e83e77c` | `src/backend/starter.ts` |
| 2 | Mount /push-subscriptions in database.ts; delete telegramRoutes import + /telegram mount | `f21261d1` | `src/backend/database/database.ts` |

## Acceptance Criteria — Verification

### starter.ts (Task 1)

| Criterion | Expected | Actual | Result |
|---|---|---|---|
| `grep -c "assertVapidConfigAtBoot" src/backend/starter.ts` | ≥ 2 (import + call) | 3 (import + docstring reference + call) | PASS |
| `grep -c "startPushTriggerLoopOnBoot" src/backend/starter.ts` | ≥ 1 | 3 (import call inside .then + 2 log strings) | PASS |
| `grep -c "push_trigger_bootstrap_error\|push_trigger_bootstrap_module_load_failed"` | ≥ 2 | 2 | PASS |
| `grep -c "bridge-config-writer\|reconcile-dead-tokens\|reconcile-pending-chat-ids"` | 0 | 0 | PASS |
| `grep -c 'from "\.\./telegram/' src/backend/starter.ts` | 0 | 0 | PASS |
| `grep -c "assertBrandingConfigAtBoot" src/backend/starter.ts` | ≥ 1 | 4 (preserved) | PASS |
| `grep -c "startObservationLoopOnBoot" src/backend/starter.ts` | ≥ 1 | 3 (preserved) | PASS |
| `npm run build:backend && npm run build` | exit 0 | exit 0 | PASS |
| `npx vitest related --run src/backend/starter.ts` | exit 0 | 18/18 passed | PASS |

### database.ts (Task 2)

| Criterion | Expected | Actual | Result |
|---|---|---|---|
| `grep -c 'app.use("/push-subscriptions"' src/backend/database/database.ts` | 1 | 1 | PASS |
| `grep -c 'pushSubscriptionsRoutes' src/backend/database/database.ts` | ≥ 2 | 2 (import + mount) | PASS |
| `grep -c 'telegramRoutes' src/backend/database/database.ts` | 0 | 0 | PASS |
| `grep -c 'app.use("/telegram"' src/backend/database/database.ts` | 0 | 0 | PASS |
| `grep -c 'from "\.\./telegram/routes' src/backend/database/database.ts` | 0 | 0 | PASS |
| `npm run build:backend && npm run build` | exit 0 | exit 0 | PASS |
| `npx vitest related --run src/backend/database/database.ts` | exit 0 | 18/18 passed | PASS |

### Overall Success Criteria (per objective)

- [x] `src/backend/starter.ts`:
  - [x] Calls `assertVapidConfigAtBoot()` before route mounts (adjacent to `assertBrandingConfigAtBoot`).
  - [x] Fire-and-forget dispatch of `startPushTriggerLoopOnBoot()` after observation-loop dispatch, two-layer catch matching S3 discipline.
  - [x] Removes the 3 telegram-loop boot dispatches (bridge-config-writer, reconcile-dead-tokens, reconcile-pending-chat-ids).
- [x] `src/backend/database/database.ts`:
  - [x] Mounts `app.use("/push-subscriptions", pushSubscriptionsRoutes)`.
  - [x] Removes `app.use("/telegram", telegramRoutes)` mount AND `telegramRoutes` import.
- [x] Post-teardown grep: `grep -c "telegram-loop\|telegramRoutes" src/backend/starter.ts src/backend/database/database.ts` = 0.
- [x] Tasks committed atomically with `feat(128-08-N):` prefixes.
- [x] Scoped tests exit-0.
- [x] `npm run build:backend && npm run build` exit-0.

## Post-Teardown Residual Scan

**In-scope files (starter.ts + database.ts):** ZERO remaining references to `telegramRoutes` OR `telegram-loop` OR any `./telegram/`/`../telegram/` import.

Two narrative comments in database.ts mention "/telegram" — one in the pushSubscriptionsRoutes import comment ("the /telegram mount that used to live at this position is DELETED"), one on the mount block ("structural position of the deleted /telegram mount"). Both are historical context for future readers explaining WHY /push-subscriptions is mounted at that specific position; no runtime effect.

**Out-of-scope residuals (deferred to Plan 128-09):**

- `src/backend/telegram/routes.test.ts:125,133` still imports `telegramRoutes` and mounts it inside test setup — the entire `src/backend/telegram/` directory (22 files) is deleted in Plan 09 per D-18 teardown scope. Documented as expected in this plan's action step.
- nginx `/telegram` blocks in `docker/nginx.conf:252-262` + `docker/nginx-https.conf:263-273` still present — nginx-side teardown lands in Plan 128-09.
- `docker/docker-compose.yml` still declares `tg-bridge` service + `tg-bridge-state` volume — Plan 128-09.

## Boot Sequence After This Plan

```
1. AutoSSLSetup.initialize()
2. dbModule.initializeDatabase()
3. void import voice-migration (unchanged, preserved)
4. void import observation-loop-starter → startObservationLoopOnBoot()
5. void import push-trigger-starter → startPushTriggerLoopOnBoot()  [NEW]
6. await assertBrandingConfigAtBoot()  [preserved]
7. assertVapidConfigAtBoot()  [NEW — sync throw if VAPID env missing/malformed]
8. loadFeedbackConfig()  [preserved]
9. authManager, dbServer route mounts, ...
```

Both boot dispatches (observation-loop + push-trigger) fire before the assert-boot gates return — the void-import chain is truly fire-and-forget. If assertVapidConfigAtBoot throws, the promise from push-trigger-starter is orphaned but harmless (worker gets `unhandledRejection` on missing VAPID at its own belt-and-suspenders `getVapidDetails()` call — logs then returns `{ok:false, reason:"vapid_missing"}` cleanly). This is the intended defense-in-depth pattern.

## Deviations from Plan

None — plan executed exactly as written. Both tasks matched their action specs byte-for-byte:
- No orphaned static imports of `../telegram/*` needed removal from starter.ts (the three deleted blocks used dynamic `void import(...)` only; nothing at the top of the file to clean up).
- The new push-trigger dispatch block landed verbatim from PATTERNS.md §14's template.
- The `assertVapidConfigAtBoot()` call landed as a bare call (matching `assertBrandingConfigAtBoot`'s let-throws-propagate style — no try/catch wrap needed).

## Known Stubs

None. Both files now reference concrete artifacts delivered in Plans 128-02 (`vapid-config.ts`), 128-05 (`push-subscriptions.ts`), and 128-06 (`push-trigger-starter.ts`). All three imports resolve to real code with matching exported symbol names verified by the backend TS build.

## Downstream Work Enabled

- **Plan 128-09** (nginx dual-conf update + /telegram block deletion + tg-bridge Docker service deletion): the Express side is now fully torn down; nginx-side and Docker-side follow.
- **Plan 128-10** (source-code teardown: `rm -rf src/backend/telegram/`): telegramRoutes has zero import sites in the running application after this plan (only the test file inside the doomed directory still references it), so the rm is safe.
- **Runtime:** on next backend boot, the /push-subscriptions POST endpoint is reachable (assuming VAPID env is set) and the push-trigger loop starts polling for DM messages to fire notifications on. Frontend opt-in surface from Plan 128-07 can now successfully POST subscriptions and expect them to persist.

## Test / Verification Log

- Task 1 build: `npm run build:backend` exit 0; `npm run build` exit 0.
- Task 1 scoped tests: `npx vitest related --run src/backend/starter.ts` = 18 passed / 0 failed in 4.39s.
- Task 2 build: `npm run build:backend` exit 0; `npm run build` exit 0.
- Task 2 scoped tests: `npx vitest related --run src/backend/database/database.ts` = 18 passed / 0 failed in 4.60s.
- No pre-existing warnings surfaced; no auto-fix attempts triggered (Rules 1-3 not exercised).

## Self-Check: PASSED

- `src/backend/starter.ts` present and modified (verified via grep of new symbols).
- `src/backend/database/database.ts` present and modified (verified via grep).
- Commit `4e83e77c` present in `git log`: yes.
- Commit `f21261d1` present in `git log`: yes.
