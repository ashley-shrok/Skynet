---
phase: 126-push-notifications-replacing-telegram-bridge
plan: 02
subsystem: notifications
tags: [push-notifications, web-push, vapid, crypto-boundary, tdd]

# Dependency graph
requires:
  - phase: 126-push-notifications-replacing-telegram-bridge
    plan: 01
    provides: "push_subscriptions table + UNIQUE(user_id, endpoint) index (queryable by sendPushToUser + prunable on 410/404)"
  - phase: 74-branding-boot-gate
    provides: "assertBrandingConfigAtBoot fail-fast shape mirrored by assertVapidConfigAtBoot"
  - phase: 89-relay-room-sessions
    provides: "relay-room-sessions-store.ts:86-105 disk-sat forceSave discipline (byte-mirrored in push-sender's prune path)"
provides:
  - "web-push@3.6.7 + @types/web-push@3.6.4 in package.json + package-lock.json (human-verified npm provenance = web-push-libs org)"
  - "assertVapidConfigAtBoot() — fail-fast VAPID env-var loader with mailto:/https:// subject validation (Pitfall 2 mitigation)"
  - "getVapidDetails() — per-call tuple reader consumed by push-sender's module-load setVapidDetails"
  - "sendPushToUser(userId, payload) — never-throws Promise.all-parallel web-push wrapper with inline 410/404 pruning + if(prunedAny) forceSave gate"
  - "PushPayload interface — {title, body, roomId, agentMxid} wire format for SW push event handler"
affects: [128-03-preview-text, 128-04-resolve-agent-display-name, 128-05-push-subscriptions-route, 128-06-push-trigger-loop, 128-08-starter-integration, 128-09-service-worker, 128-10-enable-notifications-button, 128-11-close]

# Tech tracking
tech-stack:
  added:
    - "web-push@3.6.7 (production dep) — canonical Web Push Protocol library (web-push-libs org)"
    - "@types/web-push@3.6.4 (devDep) — DefinitelyTyped types bundle"
  patterns:
    - "fail-fast-at-boot with structured operator-facing Error (byte-mirror of assertBrandingConfigAtBoot shape)"
    - "vi.hoisted() escape hatch for vi.mock factories that need spy vars declared inside test file"
    - "if(prunedAny) disk-sat guard — DB write-triggered forceSave only fires when the table actually mutated (byte-mirror of relay-room-sessions-store.ts:86-90 hotfix)"
    - "never-throw contract via Promise.all(rows.map(async ... {try/catch})) — outer awaiter never rejects, per-row failures absorbed inside"
    - "endpoint.slice(0, 40) log-truncation applied at BOTH info-level (prune) and warn-level (non-410) paths"
    - "module-top-level webpush.setVapidDetails(...) — configure library once at import time; subsequent sendNotification calls read the cached config"

key-files:
  created:
    - src/backend/notifications/vapid-config.ts
    - src/backend/notifications/vapid-config.test.ts
    - src/backend/notifications/push-sender.ts
    - src/backend/notifications/push-sender.test.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Chose ENV-VAR storage for VAPID keys (not DB row) per RESEARCH.md § Open Question 1 — simpler deploy shape, no ingest route/admin surface, no in-memory-cache footgun. Private key lives only in operator's skynet.env; never in disk-persisted state managed by this codebase (T-128-06 mitigation)."
  - "Kept assertVapidConfigAtBoot module-boundary FREE of the webpush import — vapid-config.ts loads + validates only; push-sender.ts owns the module-top-level webpush.setVapidDetails call. Keeps vapid-config.test.ts test-friendly (no library mocking required)."
  - "Used vi.hoisted() for the web-push mock spies (auto-fixed a Rule 3 blocker where the bare `const sendNotificationMock = vi.fn()` was referenced by the hoisted vi.mock factory before it was initialized). Same pattern any future test that mocks a module + spies on its exports will need."
  - "Emitted the success log with subjectScheme (mailto:|https://) + publicKeyLen ONLY — never the key material itself. Public key length + subject scheme is enough for ops to confirm 'config loaded' without turning the log stream into a key-extraction surface (Security V6/V7)."

patterns-established:
  - "src/backend/notifications/ slice — first module directory in the new push-notifications concern. Future files (preview-text, resolve-agent-display-name, push-trigger-loop, push-trigger-starter) drop into this same slice."
  - "The vapid-config → push-sender import order: vapid-config exports the loader + reader ONLY; push-sender is the sole caller of setVapidDetails. Repeat this pattern for any future 'config loader + library-wrapping wrapper' split (keeps loader test-friendly)."
  - "vi.hoisted() spy-declaration idiom for vi.mock factories — future notification tests (push-sender-related or others) that need to spy on both the module-top-level call AND the per-test call of a mocked library will need this same shape."

requirements-completed: [D-06, D-07, D-13, D-14, D-16]

# Metrics
duration: 25min
completed: 2026-09-21
---

# Phase 128 Plan 02: web-push install + VAPID fail-fast loader + push-sender wrapper Summary

**web-push@3.6.7 installed under a blocking-human legitimacy checkpoint; vapid-config fail-fast boot loader (mailto:/https:// subject validation per Pitfall 2) and push-sender never-throws wrapper (Promise.all fan-out with inline 410/404 pruning + if(prunedAny) forceSave gate) built TDD-first — 20 tests green, backend build gate green.**

## Performance

- **Duration:** ~25 min executor time (Tasks 2 and 3, after the Task 1 blocking-human checkpoint was approved).
- **Started:** 2026-09-21T01:43:00Z (continuation agent picking up from Task 1 approval).
- **Completed:** 2026-09-21T01:56:00Z.
- **Tasks:** 3 total (1 blocking-human checkpoint approved before start, 2 TDD auto tasks).
- **Files created:** 4 (2 modules + 2 colocated test files).
- **Files modified:** 2 (package.json + package-lock.json).

## Accomplishments

- **Task 1 — Package legitimacy checkpoint (T-126-SC mitigation).** Human verified web-push + @types/web-push on npmjs.com before any `npm install` ran. Publisher confirmed as `web-push-libs` org (3.5k GitHub stars, canonical Node library) + DefinitelyTyped types bundle. Approval recorded 2026-09-21 by the user — "approved: web-push legitimate". The checkpoint is what makes T-126-SC (slopsquat / typo-squat / malicious replacement of the crypto library) an ACCEPTABLE risk profile; without it, blindly installing a crypto library at a version pinned by an LLM would be a real backdoor surface.
- **Task 2 — vapid-config fail-fast boot loader.** `assertVapidConfigAtBoot()` reads VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT from env, throws a structured operator-facing Error naming the offender when any is missing/empty, throws when VAPID_SUBJECT does not match `^(mailto:|https:\/\/)` (Pitfall 2 — Apple returns 403 on any other subject shape). Success log emits `subjectScheme` + `publicKeyLen` only — NEVER key material (T-128-06 mitigation, Security V6/V7). `getVapidDetails()` returns the `{subject, publicKey, privateKey}` tuple push-sender consumes at module load. 11/11 colocated tests green.
- **Task 3 — push-sender web-push wrapper.** `sendPushToUser(userId, payload)` fetches every push_subscriptions row for `userId` (D-14 multi-device), dispatches via `Promise.all(rows.map(async ... { try { webpush.sendNotification(...) } catch {...} }))` with `{TTL: 60, urgency: "high"}` (RESEARCH § Pattern 2). Inline-prunes rows whose provider returned 410 Gone or 404 Not Found (D-13 lifecycle) with `endpoint.slice(0, 40)` info log — never full URL (T-128-07 mitigation). Non-410 errors log at warn-level, row NOT deleted. Post-loop `if (prunedAny)` gate triggers `DatabaseSaveTrigger.forceSave("push-subscription-prune-dead")` inside try/catch with .warn fallback on failure — byte-mirror of `relay-room-sessions-store.ts:86-105` per PATTERNS.md §S2. Never throws (T-128-09 contract — Plan 06 trigger loop depends on this). Empty-subscription case is a silent no-op. 9/9 colocated tests green (7 PLAN behavior cases + module-load setVapidDetails contract + cross-user isolation).

## Task Commits

Each auto task followed the TDD gate sequence (test → feat):

1. **Task 2 RED — Install web-push + failing tests for vapid-config** — `1eb2a468` (test)
2. **Task 2 GREEN — Implement vapid-config fail-fast boot loader** — `55d384a9` (feat)
3. **Task 3 RED — Failing tests for push-sender (7 behavior cases + module-load contract)** — `78d5999f` (test)
4. **Task 3 GREEN — Implement push-sender web-push wrapper with 410/404 pruning** — `9cb87d5d` (feat, bundles the vi.hoisted test-file fixup as part of what makes tests actually run green)

Task 1 was a `checkpoint:human-verify gate="blocking-human"` — no commit; approval recorded in the prior executor's return message.

_(Metadata commit follows this SUMMARY.)_

## Files Created/Modified

- `src/backend/notifications/vapid-config.ts` — CREATED: `assertVapidConfigAtBoot()` + `getVapidDetails()` + module-private `readVapidEnv()` shared by both, `VAPID_SUBJECT_PATTERN` regex `^(mailto:|https:\/\/)`.
- `src/backend/notifications/vapid-config.test.ts` — CREATED: 11 tests (missing-each-var × 3, malformed-subject × 3 including bare-domain / http:// / bare-email, happy-path × 2 for mailto: and https://, log-excludes-key-material, getVapidDetails happy + throws-on-missing).
- `src/backend/notifications/push-sender.ts` — CREATED: `sendPushToUser(userId, payload)` + `PushPayload` interface + module-top-level `webpush.setVapidDetails(...)` call. Imports `db + DatabaseSaveTrigger` from `../database/db/index.js`, `databaseLogger` from `../utils/logger.js`, `getVapidDetails` from `./vapid-config.js`.
- `src/backend/notifications/push-sender.test.ts` — CREATED: 9 tests (module-load setVapidDetails contract, 7 behavior cases: happy / 410-prune / 404-prune / mixed / non-410 / forceSave-fail / empty, cross-user isolation). Uses `vi.hoisted` for the web-push spy declarations and a fresh in-memory better-sqlite3 per test (mirrors relay-room-sessions-store.test.ts pattern).
- `package.json` — MODIFIED: added `"web-push": "^3.6.7"` to dependencies + `"@types/web-push": "^3.6.4"` to devDependencies.
- `package-lock.json` — MODIFIED: recorded transitive dep tree for web-push (5 packages added total).

## Decisions Made

- **Env-var VAPID storage (not DB row).** Planner discretion per RESEARCH § Open Question 1. Env vars keep the deploy shape simple (skynet.env line-adds vs. a new admin ingest route + admin-gated table + rotate flow). The private key never touches disk-persisted state managed by this codebase — T-128-06 mitigation is stronger for the env-var path than for a DB row.
- **`readVapidEnv()` private helper shared by both exports.** Rather than duplicate validation logic in `assertVapidConfigAtBoot` and `getVapidDetails`, both call the same private throw-on-fail reader. Contract-preserving refactor: neither export can silently return partial config; a caller (push-sender's setVapidDetails) that gets past the reader knows all three fields are valid.
- **Success log names subjectScheme + publicKeyLen only — NEVER key values.** Security V6/V7 discipline. Ops can confirm "VAPID loaded" from the log; a compromise of the log stream does not compromise the keys.
- **push-sender.ts calls setVapidDetails at MODULE LOAD (not lazily per send).** Belt-and-suspenders after the boot gate. Fails fast at import if VAPID env is broken (starter.ts's uncaughtException handler produces the standard structured-error-log + non-zero-exit that the container supervisor watches for). Also, web-push caches setVapidDetails internally — calling per-send would just be wasted cycles.
- **Cross-user isolation test bundled with the 7 PLAN behavior cases.** The plan asked for 7 behavior cases; I added an 8th (`sendPushToUser(USER)` must not touch OTHER_USER's rows). Free correctness assurance for a table with per-row user_id — cheap insurance against a future refactor that accidentally drops the WHERE clause.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] vi.mock factory referenced hoisted top-level `const` before it was initialized**
- **Found during:** Task 3 GREEN, first `npx vitest related` run.
- **Issue:** The initial test file used bare top-level `const sendNotificationMock = vi.fn()` + `const setVapidDetailsMock = vi.fn()`, then referenced both inside the `vi.mock("web-push", () => ({ ... }))` factory. Vitest hoists `vi.mock` factory to the top of the file, above `const` declarations, so the factory threw `ReferenceError: Cannot access 'setVapidDetailsMock' before initialization` and no tests ran.
- **Fix:** Wrapped both spy declarations in `vi.hoisted(() => ({ sendNotificationMock: vi.fn(), setVapidDetailsMock: vi.fn() }))` — vitest's sanctioned escape hatch for exactly this hoisting order. The mock factory now closes over hoisted references.
- **Files modified:** `src/backend/notifications/push-sender.test.ts` (test file, bundled into the same Task 3 GREEN commit — the fix is what makes the tests actually green, so it belongs with the implementation commit, not as a separate refactor).
- **Commit:** `9cb87d5d` (bundled into Task 3 GREEN).
- **Impact on plan:** none — the test contract is unchanged; only the mock-declaration idiom shifted from bare-`const` to `vi.hoisted`.

**Total deviations:** 1 auto-fixed (Rule 3 blocking issue); zero Rule 1/2/4 events.

## Issues Encountered

None beyond the vi.hoisted test-infrastructure fixup above. Both Tasks 2 and 3 built cleanly on the first GREEN attempt; the module-load setVapidDetails contract worked as designed against the vi.mock("web-push") shape; the byte-mirror of the relay-room-sessions-store forceSave discipline dropped in without adaptation. No auth gates. No Rule 4 architectural questions surfaced.

## Threat Flags

None found — the changes align with the plan's `<threat_model>` register:
- **T-126-SC (Tampering, npm install web-push, mitigate):** Blocking-human legitimacy checkpoint (Task 1) approved by human on npmjs.com before install ran — verified web-push-libs org publisher + DefinitelyTyped provenance. `workflow.auto_advance` did not bypass this checkpoint (per the `gate="blocking-human"` attribute).
- **T-128-06 (Spoofing, VAPID private key handling, mitigate):** Loaded from env only; never logged (success log excludes key material — asserted by test); never written to disk by this code. Boot-time fail-fast on missing/malformed subject (Pitfall 2).
- **T-128-07 (Information Disclosure, endpoint URL logging, mitigate):** All log paths use `endpoint.slice(0, 40)` truncation. Verified via grep (`grep -c "endpoint.slice(0, 40)" src/backend/notifications/push-sender.ts` returns 2 — one for prune-info, one for non-410-warn).
- **T-128-08 (Cryptography, hand-rolled encryption, mitigate):** web-push@3.6.7 handles aes128gcm content-encoding + VAPID ES256 JWT signing + ECDH ephemeral keypair. NO custom crypto in this codebase.
- **T-128-09 (Denial of Service, throws in trigger loop, mitigate):** never-throw contract enforced by Test 6 (forceSave rejection is absorbed) and Test 5 (non-410 error absorbed); all catches inside the sender.
- **T-128-10 (Denial of Service, forceSave storm on happy path, mitigate):** `if (prunedAny)` gate — forceSave only fires when at least one row was DELETEd. Verified by Test 1 (2 successful sends → 0 forceSave calls).
- **T-128-11 (subscription-per-user count growth, mitigate):** UNIQUE(user_id, endpoint) is at Plan 01 layer; 410-prune is at this plan; Plan 05's ON CONFLICT DO NOTHING is the third layer.

## User Setup Required

**Before this code can send its first push, the operator must:**
1. Generate a VAPID keypair once: `npx web-push generate-vapid-keys`
2. Paste the output into skynet.env as:
   - `VAPID_PUBLIC_KEY=<publicKey from step 1>`
   - `VAPID_PRIVATE_KEY=<privateKey from step 1>`
   - `VAPID_SUBJECT=mailto:admin@example.com` (or any https:// URL)
3. Restart the container so `assertVapidConfigAtBoot()` (wired by Plan 08) sees the fresh env.

If step 2 or 3 is skipped, `assertVapidConfigAtBoot` will throw a structured operator-facing Error naming the missing/malformed var, and the container supervisor will surface it as a startup failure. This is the fail-fast design — better to refuse to boot than to run degraded and silently drop every notification.

The deploy step itself is orchestrator-owned per fleet rule (not this plan's remit). Nothing here builds a container image or restarts a running deployment.

## Next Phase Readiness

- **Plan 03 (preview-text)** — ready. Consumes nothing from this plan; landmark is the `PushPayload.body` field which preview-text.ts is the source-of-truth for.
- **Plan 04 (resolve-agent-display-name)** — ready. Consumes nothing from this plan; landmark is the `PushPayload.title` field.
- **Plan 05 (push-subscriptions route)** — ready. The route's INSERT/DELETE on push_subscriptions can now be paired with the same `forceSave("push-subscription-...")` discipline this plan established (byte-mirror of Pattern 1 from RESEARCH).
- **Plan 06 (push-trigger-loop)** — ready. `sendPushToUser(userId, payload)` is the single callable this loop will invoke per matched message. Never-throws contract lets the loop call it from a hot path without defensive try/catch.
- **Plan 08 (starter integration)** — ready. `assertVapidConfigAtBoot` is the callable to wire into starter.ts at the same insertion point as `assertBrandingConfigAtBoot`. `void import("./notifications/push-trigger-starter.js")` block will follow (once Plan 06's starter exists).
- **No blockers** — build clean, all 20 colocated tests green, no architectural questions surfaced.

## Self-Check: PASSED

Verified all claims:

- **Files created exist:**
  - `src/backend/notifications/vapid-config.ts` → FOUND (`export function assertVapidConfigAtBoot` line 107, `export function getVapidDetails` line 138)
  - `src/backend/notifications/vapid-config.test.ts` → FOUND (11 tests)
  - `src/backend/notifications/push-sender.ts` → FOUND (`export async function sendPushToUser` line 109, `export interface PushPayload` line 82)
  - `src/backend/notifications/push-sender.test.ts` → FOUND (9 tests)
- **Files modified:**
  - `package.json` → contains `"web-push": "^3.6.7"` in dependencies and `"@types/web-push": "^3.6.4"` in devDependencies
  - `package-lock.json` → contains web-push@3.6.7 entry
- **Task commits exist (git log):**
  - `1eb2a468` → FOUND (test 128-02-2)
  - `55d384a9` → FOUND (feat 128-02-2)
  - `78d5999f` → FOUND (test 128-02-3)
  - `9cb87d5d` → FOUND (feat 128-02-3)
- **Acceptance-criteria greps (all pass):**
  - `grep -c '"web-push"' package.json` = 1
  - `grep -c '"@types/web-push"' package.json` = 1
  - `grep -n "export function assertVapidConfigAtBoot" src/backend/notifications/vapid-config.ts` = 1 line
  - `grep -n "export function getVapidDetails" src/backend/notifications/vapid-config.ts` = 1 line
  - `grep -c "mailto:\|https:" src/backend/notifications/vapid-config.ts` = 7 (>= 1)
  - `grep -n "export async function sendPushToUser" src/backend/notifications/push-sender.ts` = 1 line
  - `grep -n "export interface PushPayload" src/backend/notifications/push-sender.ts` = 1 line
  - `grep -c "webpush\.setVapidDetails" src/backend/notifications/push-sender.ts` = 2 (>= 1; one at module load, one in the docblock)
  - `grep -c "webpush\.sendNotification" src/backend/notifications/push-sender.ts` = 1 (>= 1)
  - `grep -c "statusCode === 410\|statusCode === 404" src/backend/notifications/push-sender.ts` = 1 line (both statuses in a single OR)
  - `grep -c "endpoint.slice(0, 40)" src/backend/notifications/push-sender.ts` = 2 (info-log + warn-log paths)
  - `grep -c 'DatabaseSaveTrigger\.forceSave("push-subscription-prune-dead")' src/backend/notifications/push-sender.ts` = 1
  - `grep -c "TTL: 60" src/backend/notifications/push-sender.ts` = 1
- **Build gates:** `npm run build:backend` exit 0, `npm run build` exit 0.
- **Test gates:** `npx vitest related --run src/backend/notifications/vapid-config.ts src/backend/notifications/push-sender.ts` → 2 test files / 20 tests / 20 passed / exit 0.

## TDD Gate Compliance

TDD gate sequence verified for BOTH auto tasks: `test(128-02-N)` → `feat(128-02-N)`, in chronological git-log order.

- Task 2: `1eb2a468 test(128-02-2)` (11 tests failing — module not found) → `55d384a9 feat(128-02-2)` (11 tests green).
- Task 3: `78d5999f test(128-02-3)` (0 tests ran — module not found) → `9cb87d5d feat(128-02-3)` (9 tests green, includes the vi.hoisted fixup bundled into GREEN because the test file only runs at all with the fix).

RED phase for Task 3 confirmed via "Cannot find module '/src/backend/notifications/push-sender.js'" — module-not-found is a valid RED signal (0 tests can execute → 0 tests can accidentally pass). No REFACTOR commits were needed; the implementation dropped in cleanly from the RESEARCH § Pattern 2 template.

---
*Phase: 126-push-notifications-replacing-telegram-bridge*
*Completed: 2026-09-21*
