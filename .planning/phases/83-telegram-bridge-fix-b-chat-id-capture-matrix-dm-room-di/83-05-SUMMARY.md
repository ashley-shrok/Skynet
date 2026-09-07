---
phase: 83-telegram-bridge-fix-b
plan: 05
subsystem: telegram-bridge
tags: [telegram, bridge, http-api, react-api-client]
requires: [83-03]
provides:
  - "GET /telegram/status?identityKey=<key> — read-only poll endpoint returning { chatId: string | null }"
  - "getTelegramPendingStatus(identityKey) frontend client method (for Plan 83-06 TelegramTab poll)"
affects:
  - "src/backend/telegram/routes.ts"
  - "src/backend/telegram/routes.test.ts"
  - "src/ui/api/telegram-api.ts"
tech-stack:
  added: []
  patterns:
    - "Mirror of existing IDENTITY_KEY_RE regex-guard on incoming identityKey (400 on fail)"
    - "Mirror of ownership check at POST /telegram/disconnect L225-228 (403 when row.humanUserId ≠ authUserId)"
    - "authApi.get with axios `params` for query-string identityKey (NOT URL-embedded)"
    - "Discriminated-union return shape from client method: { ok:true, chatId } | { ok:false, error, status? }"
key-files:
  created: []
  modified:
    - "src/backend/telegram/routes.ts (route + doc block, inserted before GET /:identityKey)"
    - "src/backend/telegram/routes.test.ts (9 new STS tests inside new describe block)"
    - "src/ui/api/telegram-api.ts (new PendingStatusWireResp interface + getTelegramPendingStatus export)"
decisions:
  - "Route ordering: /status registered BEFORE /:identityKey — Express matches in registration order, so a bare /status would otherwise match /:identityKey with identityKey=\"status\" and fail the IDENTITY_KEY_RE guard with a bogus 400."
  - "Response shape: bare `{ chatId: string | null }` — no botUsername, no botToken. TelegramTab already holds botUsername from the pending-start state; this is a hot poll (every ~3s per CONTEXT § 5) so payload must be minimal."
  - "Nginx configs unchanged: existing `location ~ ^/telegram(/.*)?$` block in docker/nginx.conf:189 + docker/nginx-https.conf:200 already routes /telegram/status to the backend. Grep-verified as regression guard."
  - "identityKey wire form: axios `params: { identityKey }` (query string), NOT URL-embedded — matches backend `req.query.identityKey` parse per CONTEXT § 5."
metrics:
  duration: "~15 min"
  completed: "2026-09-07"
  tasks: 2
  files_changed: 3
  loc_added: "~260 (route + tests + client)"
---

# Phase 83 Plan 05: GET /telegram/status endpoint + telegram-api client method Summary

Read-only backend poll endpoint that lets the TelegramTab UI advance from
"waiting for /start" to "Connected" without a modal close/reopen — bridges
the reconcile-loop-side chat_id capture (Plan 83-03) to the activation UI
(Plan 83-06).

## What was built

### Backend route: `GET /telegram/status?identityKey=<key>`

- Registered on the same Express Router as the other /telegram/* routes,
  inside `src/backend/telegram/routes.ts`.
- Route ordering: `router.get("/status", ...)` inserted at line 293,
  BEFORE `router.get("/:identityKey", ...)` at line 330. This is
  load-bearing — Express matches routes in registration order, so a bare
  `/status` would otherwise be captured by `/:identityKey` with
  `identityKey="status"`, fail the `IDENTITY_KEY_RE` regex (starts with 's',
  so would actually PASS — bug would be more subtle: real lookup for the
  string "status" as an identityKey), and return the wrong shape.
- Ownership check mirrors POST /telegram/disconnect L225-228 verbatim: 403
  `{ error: "not your identity" }` when the row's humanUserId does not
  match the JWT-authed userId.
- Response is minimal: `{ chatId: string | null }` ONLY. Bot token NEVER
  included (belt-and-braces asserted in test STS-01 body substring checks).

### Status codes:

| Code | Body                                                        | Trigger                                     |
| ---- | ----------------------------------------------------------- | ------------------------------------------- |
| 200  | `{ chatId: string \| null }`                                | Row exists AND humanUserId matches JWT      |
| 400  | `{ error: "identityKey must match [a-z0-9][a-z0-9_-]{0,63}" }` | Query param missing or fails regex        |
| 401  | `{ error: "Missing authentication token" }`                 | JWT middleware short-circuits (no auth)     |
| 403  | `{ error: "not your identity" }`                            | Row's humanUserId ≠ JWT userId              |
| 404  | `{ error: "no telegram binding for identity" }`             | No row for that identityKey                 |
| 500  | `{ error: "Failed to read telegram status" }`               | getTelegramBotToken throws (DB/decrypt err) |

### Frontend client: `getTelegramPendingStatus(identityKey)`

- Appended to `src/ui/api/telegram-api.ts` after the pre-existing
  `getTelegramStatus` function.
- Uses `authApi.get<PendingStatusWireResp>("/telegram/status", { params: { identityKey } })`
  — identityKey passed as an axios `params` query param, NOT URL-embedded.
  Matches the backend's `req.query.identityKey` parse per CONTEXT § 5.
- Returns discriminated union:
  `{ ok: true, chatId: string | null } | { ok: false, error: string, status?: number }`
- No exported test file added — the endpoint's behavior is fully covered by
  the 9 backend tests, and Plan 83-06's TelegramTab tests will mock this
  function directly.

## Route ordering — why /status must precede /:identityKey

Express matches routes in registration order. Both routes are `GET` on the
same router. When a request for `/telegram/status?identityKey=alexander`
comes in:

- If `/status` is registered FIRST → Express matches `/status` exactly →
  handler reads `req.query.identityKey` → correct behavior.
- If `/:identityKey` is registered FIRST → Express matches with
  `identityKey="status"` → handler validates "status" against
  `IDENTITY_KEY_RE` (passes, since "status" is lowercase alphanumeric) →
  `getTelegramBotToken("status")` returns null → responds
  `{ status: "unconfigured" }` — the wrong shape entirely.

The plan explicitly called out this order requirement and the route was
inserted at the correct position (line 293 vs. `/:identityKey` at line 330,
verified via `grep -n`). Acceptance criterion:
`grep -n '"/status"' → less than grep -n '"/:identityKey"'` passed.

## Response shape — why bare `{ chatId }` instead of a richer schema

The existing `GET /telegram/:identityKey` returns
`{ status, botUsername, telegramChatId }` for the modal's initial paint.
This new `/status` endpoint could have mirrored that shape, but did not,
for three reasons:

1. **Hot poll**: TelegramTab hits this every ~3s while awaiting /start (per
   CONTEXT § 5). Payload size and serialization cost matter.
2. **Frontend already has botUsername**: it comes from the response to the
   POST /telegram/activate that put the UI into the "waiting for /start"
   state to begin with. Re-sending botUsername on every poll wastes bytes.
3. **Distinctness**: two endpoints returning nearly the same shape invites
   caller confusion. Naming the poll response `{ chatId }` and the initial
   paint `{ status, botUsername, telegramChatId }` makes their roles
   obvious at the call site.

## Nginx configs — untouched, guarded

Existing `location ~ ^/telegram(/.*)?$` regex blocks in
`docker/nginx.conf:189` and `docker/nginx-https.conf:200` already route
`/telegram/status` to the backend upstream. No nginx edits required.

A regression guard grep (`grep -c '/telegram(/.*)?' docker/nginx.conf`
and same on `nginx-https.conf`) was run before commit and both returned
`1` — confirming the routing block is intact and this plan did not
accidentally remove it.

## Tests

### Backend `src/backend/telegram/routes.test.ts` — 9 new STS tests

| ID     | Case                                                          | Expected                                                                |
| ------ | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| STS-01 | Happy path, chatId populated                                  | 200 `{ chatId: "123456789" }` + bot-token substring absent from body    |
| STS-02 | Happy path, chatId null while waiting for /start              | 200 `{ chatId: null }`                                                  |
| STS-03 | Missing query param                                           | 400 `{ error: "identityKey must match [a-z0-9][a-z0-9_-]{0,63}" }`      |
| STS-04 | Malformed (uppercase Alexander)                               | 400 with same regex-error                                               |
| STS-05 | Path-traversal (`..%2Fetc` → decoded `../etc`)                | 400 with same regex-error                                               |
| STS-06 | No row for identityKey                                        | 404 `{ error: "no telegram binding for identity" }`                     |
| STS-07 | Not owner (row.humanUserId=user-42, JWT userId=user-99)       | 403 `{ error: "not your identity" }`                                    |
| STS-08 | No auth (JWT middleware mock short-circuits)                  | 401 `{ error: "Missing authentication token" }`                         |
| STS-09 | Internal error (getTelegramBotToken throws)                   | 500 `{ error: "Failed to read telegram status" }`                       |

All 9 new tests + 26 pre-existing tests in `routes.test.ts` = **35 passed**.

### Frontend `src/ui/api/telegram-api.test.ts` — no regressions

All 11 pre-existing telegram-api.test.ts tests still pass. New client
method has no dedicated test at this layer — coverage is via the 9 STS
tests + Plan 83-06's TelegramTab tests (which will mock this function).

### TSC

`npx tsc --noEmit -p tsconfig.json` exits 0.

## Deviations from Plan

None — plan executed exactly as written. Route ordering, response shape,
error strings, ownership check pattern, and nginx-guard all match the
plan's `<behavior>` and `<acceptance_criteria>` verbatim.

Minor note: the plan's `<verify>` block spelled the test command as
`npx vitest run --related …`. The installed vitest (v4.1.8) does not
support a `--related` flag — I ran the tests directly by path
(`npx vitest run src/backend/telegram/routes.test.ts` and same for
`src/ui/api/telegram-api.test.ts`). Same coverage, same 35+11 = 46 tests
green. Not a deviation from the intent — just a flag rename.

## Commits

| Task | Kind | Hash       | Subject                                              |
| ---- | ---- | ---------- | ---------------------------------------------------- |
| 1    | RED  | `2531270b` | test(83-05): GET /telegram/status                    |
| 1    | GRN  | `39b05257` | feat(83-05): GET /telegram/status                    |
| 2    | GRN  | `a07430bb` | feat(83-05): getTelegramPendingStatus client method  |

## Wave dependency note

Plan 83-03 (reconcile-pending-chat-ids) is the upstream write-side that
populates `telegram_bot_tokens.telegramChatId` — this endpoint is the
downstream read-side. The Wave 2 sequencing means by the time TelegramTab
in Plan 83-06 starts polling, the reconcile loop is already running and
writing chat_ids as bridge sentinels appear.

## Self-Check: PASSED

- SUMMARY.md exists at `.planning/phases/83-telegram-bridge-fix-b-chat-id-capture-matrix-dm-room-di/83-05-SUMMARY.md`
- Commit `2531270b` present in `git log`
- Commit `39b05257` present in `git log`
- Commit `a07430bb` present in `git log`
- `src/backend/telegram/routes.ts` contains `router.get("/status", ...)` at line 293
- `src/backend/telegram/routes.test.ts` contains `describe("GET /telegram/status", ...)`
- `src/ui/api/telegram-api.ts` contains `export async function getTelegramPendingStatus`
