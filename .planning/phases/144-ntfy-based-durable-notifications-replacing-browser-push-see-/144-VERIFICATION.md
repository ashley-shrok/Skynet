---
phase: 144-ntfy-based-durable-notifications-replacing-browser-push-see-
verified: 2026-10-02T23:03:18Z
status: failed
score: 7/8 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Full test suite scoped to touched paths is green"
    status: failed
    reason: "SND-05 in src/backend/notifications/ntfy-sender.test.ts imports the deleted push-sender.js shim and fails with 'Cannot find module'. Plan 04 deleted push-sender.ts and push-sender.test.ts but did NOT update ntfy-sender.test.ts to remove or rewrite SND-05, which was written in Plan 02 to verify the re-export shim relationship. The test now crashes on import."
    artifacts:
      - path: "src/backend/notifications/ntfy-sender.test.ts"
        issue: "Line 197 imports './push-sender.js' which was deleted by Plan 04 Task 2. SND-05 must be deleted or rewritten (the shim no longer exists; the test intent is moot)."
    missing:
      - "Remove or rewrite SND-05 in ntfy-sender.test.ts. The simplest fix: delete the `it('SND-05: ...')` block entirely (the re-export shim is gone so the test has no subject). Alternatively, rewrite SND-05 as a structural export check: verify ntfy-sender.ts directly exports sendPushToUser and buildClickUrl."
---

# Phase 144: ntfy-based Durable Notifications — Verification Report

**Phase Goal:** Replace Skynet's current browser-based push notification system end-to-end with a self-hosted ntfy server that publishes to a per-user topic, received by the ntfy iOS app via Apple's push infrastructure. Pure cutover — the Phase 128 browser-push system deletes in the same ship as ntfy goes live. No dual-transport window.
**Verified:** 2026-10-02T23:03:18Z
**Status:** FAILED (1 BLOCKER — failing test)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ntfy infrastructure in place (docker, config, env, boot gate) | VERIFIED | All artifacts confirmed present and wired |
| 2 | Backend swap complete (schema, routes, sender, admin client) | VERIFIED | All files exist; schema rebuilt; routes wired |
| 3 | Frontend rebuild complete (ntfy pane, deleted browser-push files) | VERIFIED | ntfy-setup-api.ts exists; browser-push files deleted; pane rebuilt |
| 4 | Deletion sweep complete (pure cutover) | VERIFIED | All browser-push source files deleted; plan's own grep criterion passes at 0 |
| 5 | id-skill update (user-facing change rule) | VERIFIED | SKILL.md Notifications bullet and relay-DM section describe ntfy iOS app flow |
| 6 | Scope-edges adherence | VERIFIED | Only harness_dm trigger; no retry queues; no native iOS app; no durability queue |
| 7 | "What would make it wrong" avoidance | VERIFIED | Pane derives state from backend; publisher logs warn on failure; reading credential is DB-only |
| 8 | Build + test gates | FAILED | `npm run build:backend` exits 0; `npm run build` exits 0; BUT `npx vitest run src/backend/notifications/ntfy-sender.test.ts` FAILS — SND-05 imports deleted push-sender.js |

**Score:** 7/8 truths verified

---

## Check 1: ntfy Infrastructure

### docker/ntfy/server.yml

- **EXISTS:** Yes
- `auth-users:` count: 1 (PASS)
- `auth-tokens:` count: 1 (PASS)
- `NTFY_ADMIN_USER` references: 2 (auth-users + auth-tokens — PASS)
- `NTFY_ADMIN_PASS_BCRYPT` references: 2 (PASS)
- `NTFY_PUBLISH_TOKEN` references: 2 (PASS)
- No literal bcrypt hashes (only `${VAR}` interpolation) — PASS
- HC-2 header comment present — PASS

### docker/docker-compose.yml — ntfy service

- `binwiederhier/ntfy:v2.28.0` image: 1 (PASS)
- `NTFY_UPSTREAM_BASE_URL` env var: 1 (PASS)
- `./ntfy/server.yml:/etc/ntfy/server.yml:ro` bind mount: 1 (PASS)
- `ntfy-data:/var/lib/ntfy` named volume: 1 (PASS)
- Fail-loud guard `${SKYNET_PUBLIC_URL:?...}` in NTFY_BASE_URL: PASS
- `expose: ["2586"]` — internal only, no `ports:` host publish: PASS (confirmed grep: 0 `ports:` blocks in ntfy service)
- `env_file` pointing to skynet.env: PASS
- Joins `skynet-net`: PASS

### docker/caddy-config/Caddyfile.ntfy-additions.snippet

- **EXISTS:** Yes
- `handle_path /ntfy/*`: count 2 (PASS)
- `handle {` fallback block: PASS
- `reverse_proxy ntfy:2586`: PASS
- `Phase 144` header: PASS
- "ship-prep" marker present: PASS

### src/backend/notifications/ntfy-config.ts

- **EXISTS:** Yes, substantive (178 lines)
- Exports: `assertNtfyConfigAtBoot`, `getNtfyBaseUrl`, `getNtfyInternalPublishUrl`, `getNtfyPublishToken`, `getNtfyAdminUser`, `getNtfyAdminPassword` — all 6 present (PASS)
- `assertNtfyConfigAtBoot` throws on missing `SKYNET_PUBLIC_URL` (non-HTTPS), `NTFY_PUBLISH_TOKEN`, `NTFY_ADMIN_USER`, `NTFY_ADMIN_PASS` — verified in code (PASS)
- `getNtfyInternalPublishUrl()` returns `"http://ntfy:2586"` (PASS)
- Trailing slash handled in `getNtfyBaseUrl()` via `replace(/\/+$/, "")` (PASS)

### src/backend/starter.ts

- Imports `assertNtfyConfigAtBoot` from `./notifications/ntfy-config.js` — line 18 (PASS)
- Calls `assertNtfyConfigAtBoot()` — line 463 (PASS)
- `assertVapidConfigAtBoot` references: **0** (PASS — removed by Plan 04)

### docker/skynet.env.example

- `NTFY_PUBLISH_TOKEN` documented: PASS
- `NTFY_ADMIN_USER` documented: PASS
- `NTFY_ADMIN_PASS` documented: PASS
- `NTFY_ADMIN_PASS_BCRYPT` documented: PASS
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: count **0** (PASS — removed)

**Check 1 Result: PASS**

---

## Check 2: Backend Swap Complete

### push_subscriptions schema shape

- Columns confirmed in schema.ts: `id`, `user_id`, `topic_name`, `reading_credential`, `ntfy_username`, `created_at`
- Old columns `endpoint`, `p256dh`, `auth` are NOT in schema.ts (confirmed by schema.test.ts SCH-01 explicitly asserting their absence)
- `UNIQUE(topic_name)` enforced (one row per user) — PASS

### FieldCrypto.ENCRYPTED_FIELDS

- `push_subscriptions: new Set(["reading_credential"])` at line 66 of field-crypto.ts — PASS

### src/backend/notifications/ntfy-admin-client.ts

- **EXISTS:** Yes
- `/v1/users`, `/v1/account/token` endpoints present in the HTTP client — PASS
- Basic auth split (admin vs per-user) — PASS

### src/backend/notifications/ntfy-sender.ts

- **EXISTS:** Yes
- `sendPushToUser` exported — PASS
- `buildClickUrl(agentMxid, agentHostId: string | number | null)` — PASS (null → host param omitted, verified at lines 93-115)
- Posts to `getNtfyInternalPublishUrl()/<topic>` with `Authorization: Bearer <token>` — PASS (line 146)
- Failure path: `databaseLogger.warn("[ntfy] publish failed", {...})` and `databaseLogger.warn("[ntfy] publish threw", {...})` — PASS (not silent)

### Routes

- GET `/ntfy-setup` mounted at line 506 — PASS
- POST `/ntfy-setup` mounted at line 515 — PASS
- POST `/ntfy-test` mounted at line 525 — PASS
- POST `/ntfy-regenerate` mounted at line 534 — PASS
- DELETE `/ntfy-setup` mounted at line 543 — PASS
- `/vapid-public-key` deliberately NOT mounted (confirmed at lines 551, 553) — PASS

### ntfy-bootstrap.ts — no hardcoded "skynet-publisher" literal

- `grep -c '"skynet-publisher"' src/backend/notifications/ntfy-bootstrap.ts` → **0** — PASS

### DELETE/regenerate handlers SELECT ntfy_username from stored DB row

- `ntfy_username = row.ntfy_username` (MC-4 fix) present in both DELETE (line 452) and REGENERATE (line 329) handlers — PASS

### push-sender.ts shim GONE

- `! test -f src/backend/notifications/push-sender.ts` → CONFIRMED GONE — PASS

### push-trigger-starter.ts imports ntfy-sender directly

- `import { sendPushToUser } from "./ntfy-sender.js"` at line 65 — PASS
- `deps.sendPushToUser` is injected into push-trigger-loop via dependency injection — PASS

### push-trigger-loop.ts dependency chain

- push-trigger-loop.ts receives `sendPushToUser` as an injected dependency from push-trigger-starter.ts
- push-trigger-starter.ts imports from `./ntfy-sender.js` directly (line 65) — PASS

### ntfy_publish_config table — NOT in schema

- `grep -c 'ntfy_publish_config' src/backend/database/db/schema.ts` → **0** (the schema.ts comment at line 891 explicitly describes it was NOT built per HC-3) — PASS

**Check 2 Result: PASS**

---

## Check 3: Frontend Rebuild Complete

### src/ui/features/notifications/ntfy-setup-api.ts

- **EXISTS:** Yes — PASS

### push-subscription-api.ts and push-support.ts GONE

- `push-subscription-api.ts` — DELETED — PASS
- `push-subscription-api.test.ts` — DELETED — PASS
- `push-support.ts` — DELETED — PASS

### PreferencesNotificationsPane.tsx — ntfy UX, no browser push

- No `requestPermission()`, `pushManager.subscribe`, `applicationServerKey` in active code — PASS
- Line 15 comment explicitly states the component makes no calls to these APIs (itself a test-verifiable contract)
- `ntfy` references count: 39 — substantive ntfy UX present — PASS

### window.confirm mocked in both test paths

- `vi.spyOn(window, "confirm").mockReturnValue(true)` in PANE-06a (line 209) — PASS
- `vi.spyOn(window, "confirm").mockReturnValue(false)` in PANE-06b (line 234) — PASS

### public/sw.js — no push handlers

- `addEventListener("install", ...)` — lifecycle only (line 11)
- `addEventListener("activate", ...)` — lifecycle only (line 24)
- `addEventListener("fetch", ...)` — caching only (line 43)
- No `push`, `pushsubscriptionchange`, or `notificationclick` handlers — PASS

**Check 3 Result: PASS**

---

## Check 4: Deletion Sweep

### Source file deletions

- `src/backend/notifications/vapid-config.ts` — DELETED (PASS)
- `src/backend/notifications/vapid-config.test.ts` — DELETED (PASS)
- `src/backend/notifications/push-sender.ts` — DELETED (PASS)
- `src/backend/notifications/push-sender.test.ts` — DELETED (PASS)
- `src/ui/features/notifications/push-subscription-api.ts` — DELETED (PASS)
- `src/ui/features/notifications/push-subscription-api.test.ts` — DELETED (PASS)
- `src/ui/features/notifications/push-support.ts` — DELETED (PASS)

### package.json

- `"web-push"` dependencies: **0** — PASS
- `"@types/web-push"` devDependencies: **0** — PASS

### Deletion sweep grep (Plan 04's exact acceptance criterion)

```
grep -rE "VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|VAPID_SUBJECT|web-push|webpush|vapid-config|applicationServerKey|urlBase64ToUint8Array|pushNotificationsSupported|pushsubscriptionchange" src/ public/ | wc -l
```
Result: **0** — PASS

### Note on broader grep from verification context

The verification context asked a broader grep (adding `VAPID`, `vapid`, `p256dh`, `pushManager`). This finds 37 hits. Analysis:
- All 37 are in comments/docstrings, test fixture data simulating the old schema for migration testing (`index.integration.test.ts`), or test assertion strings that confirm browser-push APIs are ABSENT from the component (`PreferencesNotificationsPane.test.tsx`).
- No active runtime code uses any of these identifiers for browser-push functionality.
- The `p256dh` hits in `index.integration.test.ts` are SQL fixture data in a Phase 128 schema-integration test that tests the upgrade migration — they represent the historical shape being dropped, not active code.

**Check 4 Result: PASS** (Plan's own criterion passes; broader hits are benign)

---

## Check 5: id-skill Update

### substrate/skills/id/SKILL.md

- Notifications bullet (line 751): Describes ntfy iOS app setup UX, server address, topic, reading credential, test button, regenerate button, iPhone-only in v1 — PASS
- Old text "enable/disable notifications (mobile + desktop)": **0 matches** — PASS
- Relay-DM section (lines 843-844): "she gets a push notification on her iPhone (via the ntfy iOS app). Desktop push is not available in v1." — PASS
- Old text "push notification (mobile or desktop)": **0 matches** — PASS
- `grep -c "ntfy iOS app"` → **2** (sidebar footer + relay-DM section) — PASS

**Check 5 Result: PASS**

---

## Check 6: Scope-Edges Adherence

- Filter in push-trigger-loop.ts: only `harness_dm` events dispatch notifications (4-step filter pipeline at lines 338-558) — PASS
- No deploy/login/task-done triggers — PASS
- No per-agent muting or coalescing — PASS
- No desktop push — PASS
- No native iOS wrapper app files (no .swift, .m, .xcodeproj) — PASS
- No proactive drift detection / heartbeats on preferences pane — PASS
- No durability queue or retry logic: ntfy-sender.ts comment line 16: "Fires and forgets — no retry, no queue, no circuit breaker." — PASS

**Check 6 Result: PASS**

---

## Check 7: "What Would Make It Wrong" Avoidance

### Preferences pane state derives from backend truth

- `GET /push-subscriptions/ntfy-setup` endpoint drives the pane state (ntfy-setup-api.ts line 36) — PASS
- No dependency on `Notification.permission` or browser permission bit — PASS

### Publishing failure path logs a warning

- `databaseLogger.warn("[ntfy] publish failed", {...})` on non-2xx (line 157)
- `databaseLogger.warn("[ntfy] publish threw", {...})` on fetch exception (line 165)
- PASS — not silent

### Publishing credential not in env/config reachable from agent context

- `NTFY_PUBLISH_TOKEN` is a server-side env var in `skynet.env` (backend process only)
- The reading credential (per-user token) is stored encrypted in the `push_subscriptions` DB table via FieldCrypto
- `docker/skynet.env.example` does not expose actual credentials — placeholder only — PASS

### No hostname hardcoding in active source

- `term.gigaashley.click` appears 14 times in src/ — all in test files (ntfy-config.test.ts, ntfy-setup-api.test.ts, PreferencesNotificationsPane.test.tsx) and in a docstring example comment in ntfy-config.ts (lines 58 and 113)
- No hardcoding in production runtime code — PASS

**Check 7 Result: PASS**

---

## Check 8: Build + Test Gates

### Build gates

| Command | Result |
|---------|--------|
| `npm run build:backend` | Exit 0 — PASS |
| `npm run build` | Exit 0 — PASS |

### Test gates

| Test suite | Command | Result |
|-----------|---------|--------|
| ntfy-config.test.ts | `npx vitest run src/backend/notifications/ntfy-config.test.ts` | PASS (9/9) |
| ntfy-admin-client.test.ts | `npx vitest run src/backend/notifications/ntfy-admin-client.test.ts` | PASS |
| ntfy-bootstrap.test.ts | `npx vitest run src/backend/notifications/ntfy-bootstrap.test.ts` | PASS |
| ntfy-sender.test.ts | `npx vitest run src/backend/notifications/ntfy-sender.test.ts` | **FAIL** — SND-05 fails |
| push-trigger-loop.test.ts | `npx vitest run src/backend/notifications/push-trigger-loop.test.ts` | PASS (13/13) |
| push-trigger-starter.test.ts | `npx vitest run src/backend/notifications/push-trigger-starter.test.ts` | PASS (6/6) |
| ntfy-setup-api.test.ts | `npx vitest run src/ui/features/notifications/ntfy-setup-api.test.ts` | PASS |
| PreferencesNotificationsPane.test.tsx | `npx vitest run src/ui/features/pretty-view/PreferencesNotificationsPane.test.tsx` | PASS |
| schema.test.ts | `npx vitest run src/backend/database/db/schema.test.ts` | PASS |
| push-subscriptions.test.ts | `npx vitest run src/backend/database/routes/push-subscriptions.test.ts` | PASS |

**BLOCKER: SND-05 in ntfy-sender.test.ts**

```
Error: Cannot find module '/src/backend/notifications/push-sender.js'
  imported from ntfy-sender.test.ts:197

  it("SND-05: push-sender.ts re-exports sendPushToUser from ntfy-sender.ts", async () => {
    const pushSender = await import("./push-sender.js");  // <-- deleted file
```

Root cause: `ntfy-sender.test.ts` was created in Plan 02 with SND-05 verifying the re-export shim relationship (`push-sender.ts` → `ntfy-sender.ts`). Plan 04 correctly deleted `push-sender.ts` and `push-sender.test.ts`, but it did NOT update `ntfy-sender.test.ts` to remove SND-05. The Plan 04 SUMMARY says `ntfy-sender.ts` received a "docblock comment scrub" but the test file was not updated to remove the now-invalid SND-05 assertion.

**Check 8 Result: FAIL (BLOCKER)**

---

## Gaps Summary

One gap blocks phase completion.

**Gap: SND-05 test in ntfy-sender.test.ts crashes on the deleted push-sender.js module**

Plan 04 Task 2 deleted `push-sender.ts` and `push-sender.test.ts` — the shim and its dedicated tests — but failed to update `ntfy-sender.test.ts`, which contained SND-05 as a cross-file verification that the shim re-exported correctly. With the shim gone, SND-05 has no subject and crashes on import.

Fix (1 line change): Delete the SND-05 `it(...)` block (lines 195-202) from `src/backend/notifications/ntfy-sender.test.ts`. Update the test file header comment on line 18 to remove `SND-05` from the test list. The remaining SND-01..SND-04, SND-06..SND-08 tests all pass and provide complete coverage of ntfy-sender.ts's behavior.

This is the only gap. All other must-haves are verified. The ntfy system is functionally complete — the builds pass, the pane works, the deletion sweep is clean, the routes exist, the schema is correct. This is a cleanup omission in Plan 04's execution, not a functional defect in the ntfy system itself.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/backend/notifications/ntfy-config.ts` | 90 | Stale comment: "until Plan 04 removes the VAPID gate" (Plan 04 already ran) | Info | Documentation drift only — no runtime impact |

---

## Human Verification Required

None — all functional behaviors are verifiable programmatically. The ntfy iOS app integration itself requires a live environment with the ntfy container running and an iPhone with the ntfy app, but that is a deploy-time verification outside scope of code-level verification.

---

_Verified: 2026-10-02T23:03:18Z_
_Verifier: Claude (gsd-verifier)_
