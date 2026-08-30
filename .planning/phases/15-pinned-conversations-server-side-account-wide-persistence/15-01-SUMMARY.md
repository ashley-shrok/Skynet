---
phase: 15-pinned-conversations-server-side-account-wide-persistence
plan: 1
subsystem: backend
tags: [backend, drizzle, sqlite, express, user-preferences, phase-15, wave-1]
requirements: [PIN-01, PIN-02, PIN-06, PIN-07, PIN-08]
dependency_graph:
  requires: []
  provides:
    - "userPreferences.pinnedConversationIds Drizzle column definition"
    - "/user-preferences GET returning pinnedConversationIds as parsed string[]"
    - "/user-preferences PUT accepting + validating + persisting pinnedConversationIds"
    - "PUT response body echoes pinnedConversationIds as parsed array (Wave 2 optimistic reconciliation contract)"
    - "handleGetPreferences / handlePutPreferences function-level exports (patch #146 test seam)"
  affects:
    - "src/ui/state/conversation-store.ts (Wave 2 will wire pin mutators through this endpoint)"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (Wave 2/3 will call GET on mount)"
tech_stack:
  added: []
  patterns:
    - "patch #146 debug.ts function-level handler extraction (test seam)"
    - "addColumnIfNotExists (matches theme/font_size/accent_color/language on same table)"
    - "silent-catch JSON parse (matches client-side hydrate patterns)"
    - "response-body echoes persisted state (matches user-preferences upsert baseline)"
key_files:
  created:
    - "src/backend/database/routes/user-preferences.test.ts"
  modified:
    - "src/backend/database/db/schema.ts"
    - "src/backend/database/db/index.ts"
    - "src/backend/database/routes/user-preferences.ts"
decisions:
  - "Storage: Option B (JSON column on user_preferences) locked over Option A (new pinned_conversations table)"
  - "Endpoint: Option A (extend /user-preferences) locked over Option B (new /user/pins) — zero nginx changes required"
  - "Response body echoes state via post-write re-read through pickPreferences (single source of truth for GET+PUT shape)"
  - "Handler extraction via function-level exports (patch #146 seam) — tests bypass AuthManager 5s init timeout"
  - "DoS cap: 1000 items max on pinnedConversationIds array (T-15-06 mitigation)"
metrics:
  duration: "~15 min"
  completed: "2026-07-27"
  commits: 2
  test_count_delta: "+13 (619 -> 632)"
  files_created: 1
  files_modified: 3
---

# Phase 15 Plan 1: Server-side pinned conversation IDs (Wave 1 backend) Summary

Extended the existing `/user-preferences` endpoint with a `pinnedConversationIds: string[]` field, backed by a new nullable `pinned_conversation_ids TEXT` column on the `user_preferences` table storing a JSON-serialized array. Landed the schema column, the endpoint validation + response-echo contract, and 10 pin-specific + 3 regression direct-handler tests — the backbone Wave 2 (store integration) and Wave 3 (panel wire-up) will consume as a stable server surface. Fixes the root cause of Ashley's UAT bug: pins died on tab/PWA close because they lived only in Zustand memory.

## What was built

### 1. Schema column + migration (`1ea7861`)

- **`src/backend/database/db/schema.ts`** (+1 line at L746): Added `pinnedConversationIds: text("pinned_conversation_ids")` to the `userPreferences` sqliteTable definition. Nullable, no default — NULL means "user has never set pins" (semantically equivalent to `[]`).
- **`src/backend/database/db/index.ts`** (+1 line at L675): Added `addColumnIfNotExists("user_preferences", "pinned_conversation_ids", "TEXT")` to `migrateSchema()`, placed immediately after the existing `language` migration. Idempotent — subsequent boots are no-ops per the helper contract.

Both fresh volumes (via `CREATE TABLE IF NOT EXISTS` at L525-534 — Drizzle picks up the schema-level column on any new table it creates) and existing volumes (via the migration path) get the column with zero risk to existing rows.

### 2. Endpoint extension + tests (`b1bd547`)

**`src/backend/database/routes/user-preferences.ts`** (216 insertions, 52 deletions — 154 net):

- **New `parsePinnedConversationIds()` helper**: silent-catch on malformed rows, returns `[]` for `null | undefined | bad JSON | non-array | non-string element`. Defense-in-depth mirror of the client-side hydrate pattern.
- **`pickPreferences()`** now emits `pinnedConversationIds` as a parsed `string[]` — single source of truth for both GET and PUT response bodies.
- **PUT validation** for the new field: `Array.isArray` + every element `typeof === "string"` + `length <= 1000`. Serializes to JSON at the DB boundary via `JSON.stringify` because the column is `TEXT`.
- **PUT response body echoes persisted state** via a post-write re-read through `pickPreferences` — so `pinnedConversationIds` comes back as a **parsed array**, not the raw JSON string. Load-bearing for Wave 2's optimistic reconciliation (Test 5 asserts this explicitly with `Array.isArray` + deep-equals).
- **Handlers extracted** as `handleGetPreferences(userId, res)` / `handlePutPreferences(userId, body, res)` module exports (patch #146 debug.ts pattern) — tests call directly without the AuthManager 5s singleton init timeout in the Express test harness.
- **Auth unchanged**: `router.get("/", authenticateJWT, ...)` and `router.put("/", authenticateJWT, ...)` still wrap the middleware. 401 for unauth inherited by construction (T-15-01 mitigated).

**`src/backend/database/routes/user-preferences.test.ts`** (new file, 483 lines):

Mocks `../db/index.js` with a hand-rolled in-memory `Map<userId, Row>` implementing the 3 Drizzle chains the handlers use (`select().from().where().all()`, `insert().values().run()`, `update().set().where().run()`). Uses a `vi.mock("drizzle-orm", ...)` intercept on `eq()` to smuggle the userId through the where-predicate to the terminal `.all()` / `.run()` calls. Also stubs `AuthManager` + `databaseLogger` to load the route module instantly with zero side effects.

10 pin-specific tests + 3 regression tests (plan-checker Warning #3 renumbering satisfied):

| # | Focus | Assertion |
|---|-------|-----------|
| Test 1 | GET when no row exists | `pinnedConversationIds` is `[]`, `Array.isArray` true |
| Test 2 | GET when column is NULL | `pinnedConversationIds` is `[]`, `Array.isArray` true |
| Test 3 | GET with valid JSON | returns the parsed array (deep-equals `["id1","id2","id3"]`) |
| Test 4 | PUT persistence | raw column value in mockDb is the JSON string `'["a","b"]'` |
| **Test 5** | **PUT response body echo (PIN-08)** | **`Array.isArray(body.pinnedConversationIds)` true AND deep-equals `["x","y","z"]` — DISTINCT test, load-bearing for Wave 2** |
| Test 6 | PUT with `[]` (unpin-all) | persists `"[]"` string in column, response echoes `[]` array |
| Test 7 | PUT non-array → 400 | error message exact, row unchanged |
| Test 8 | PUT non-string element → 400 | error message exact, row unchanged |
| Test 9 | PUT length > 1000 → 400 | error message exact, row unchanged (T-15-06) |
| Test 10 | Round-trip PUT-then-GET | deep-equals `["x","y"]` |
| REG 1 | reopenTabsOnLogin non-boolean | still 400 |
| REG 2 | theme non-string | still 400 |
| REG 3 | empty updates | still 400 ("No preferences provided") |

## Design decisions (locked per 15-CONTEXT.md, honored during execution)

### Storage: Option B (JSON column on `user_preferences`)

Locked over Option A (new `pinned_conversations` table) because:

1. `pinnedIds` is semantically a flat opaque `Set<string>` with no per-pin metadata/ordering/timestamps (per CONTEXT § Scope fences).
2. `addColumnIfNotExists` is the proven pattern on this exact table — theme/font_size/accent_color/language all use it. Zero migration risk.
3. Set-size is 1 (single-tenant Skynet) — a whole table for one row per user is over-engineered.
4. Read-modify-write fits naturally with the existing PUT upsert contract.

### Endpoint: Option A (extend `/user-preferences`)

Locked over Option B (new `/user/pins`) and Option C (extend `/identities`) because:

1. **Zero nginx changes.** The existing `location ~ ^/user-preferences(/.*)?$` block at `docker/nginx.conf:258` and `docker/nginx-https.conf:265` already routes /user-preferences/* to backend :30001. Option B would need matching blocks in BOTH configs (CLAUDE.md nginx caveat).
2. **Zero new auth wiring.** The existing PUT handler already runs `authenticateJWT` middleware — PIN-07 (401-for-unauth) is inherited for free.
3. **JSON body, response echoes state** — no PATCH #77 multipart silent-200 risk. Optimistic reconciliation is safe from the PUT response alone.
4. **Option C rejected by inspection** — multipart/form-data field-name-drop trap.

## PUT response body shape (Test 5 assertion, load-bearing for Wave 2)

Exact shape of the JSON returned by `PUT /user-preferences` with body `{"pinnedConversationIds": ["x","y","z"]}`:

```json
{
  "success": true,
  "reopenTabsOnLogin": false,
  "theme": null,
  "fontSize": null,
  "accentColor": null,
  "language": null,
  "pinnedConversationIds": ["x", "y", "z"]
}
```

Key properties (captured from Test 5 output):
- `pinnedConversationIds` is a **parsed array**, not the raw JSON string. `Array.isArray(res._body.pinnedConversationIds) === true`.
- Deep-equals the input array passed in the request body (`["x", "y", "z"]`).
- Full pickPreferences shape is echoed alongside — Wave 2 can reconcile all preference fields from one write, no follow-up GET needed.

## Confirmation: no nginx changes required

Grep-verified twice — before and after the plan:

```
docker/nginx.conf:258:        location ~ ^/user-preferences(/.*)?$ {
docker/nginx-https.conf:265:        location ~ ^/user-preferences(/.*)?$ {
```

`git diff --stat docker/` returned empty. Wave 2 + Wave 3 executors do NOT need to touch nginx configs either.

## Verification results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | clean (exit 0, no output) |
| `npx vitest run` | **632 passed / 50 files** (baseline 619 + 13 new = 632; no regressions) |
| `npx vitest run src/backend/database/routes/user-preferences.test.ts` | 13 passed |
| `npm run build` | clean (`✓ built in 4.34s`) |
| `grep 'pinnedConversationIds' src/backend/database/db/schema.ts` | 1 match at L746 |
| `grep 'pinned_conversation_ids' src/backend/database/db/index.ts` | 1 match at L675 |
| `grep 'pinnedConversationIds' src/backend/database/routes/user-preferences.ts` | 18 matches (>= 5 required) |
| `grep 'handleGetPreferences\|handlePutPreferences' src/backend/database/routes/user-preferences.ts` | 4 matches (>= 4 required) |
| `grep 'authenticateJWT' src/backend/database/routes/user-preferences.ts` | 3 matches (matches baseline — import + get + put) |
| `grep '/user-preferences' docker/nginx*.conf` | 2 matches (both baseline, unchanged) |

## Deviations from Plan

**None** — plan executed as written.

Minor spec-vs-baseline note: the acceptance criterion "grep `authenticateJWT` returns exactly 2" was a spec imprecision — the baseline file also has 3 hits (1 import assignment + 2 route wires). Current file has 3, matches baseline count exactly, matches the criterion's intent ("auth wraps both, unchanged from baseline"). No code change made in response.

## Auth gates

None encountered.

## Surprises for Wave 2 executors

1. **Test 5's response-body echo is contract-critical.** The PUT response includes `pinnedConversationIds` as an actual array (via `pickPreferences` post-write re-read), NOT the raw JSON string. Wave 2's `putPinnedIds()` client helper can do `Array.isArray(response.data.pinnedConversationIds) ? response.data.pinnedConversationIds : []` for defensive reconciliation, mirroring the `open-tabs-api.ts` shape.

2. **`pickPreferences` is the single source of truth for both GET and PUT responses.** If Wave 2 needs additional fields in the reconciliation path, extend `pickPreferences` — both endpoints will emit them.

3. **Vitest `vi.mock()` hoisting gotcha.** The test file uses a getter (`get db() { return mockDb; }`) inside `vi.mock("../db/index.js", ...)` because the factory is hoisted above local `const` declarations. If Wave 2 adds a store-level test file that mocks the pins-api similarly, mirror the getter pattern rather than referencing the const directly in the factory.

4. **Handler signature difference from debug.ts.** `handleGetPreferences(userId, res)` and `handlePutPreferences(userId, body, res)` take the extracted userId as a parameter (unlike debug.ts's `handleConsoleLog(req, res)` which takes the raw Request). This is intentional — the auth middleware attaches userId to the Request, and passing it explicitly keeps the handler pure and easy to test.

5. **The `updates` length-1 guard still works.** `updates` starts with just `{updatedAt}` (length 1) and any single user field including `pinnedConversationIds` pushes it to length 2, which passes. If Wave 2 adds another optional field, mirror the pattern.

## Commit trail

| SHA | Type | Description |
|-----|------|-------------|
| `1ea7861` | feat(schema) | add pinned_conversation_ids column to user_preferences |
| `b1bd547` | feat(user-preferences) | extend GET+PUT with pinnedConversationIds |

## Self-Check: PASSED

- `.planning/phases/15-pinned-conversations-server-side-account-wide-persistence/15-01-PLAN.md`: FOUND
- `src/backend/database/db/schema.ts`: FOUND (contains `pinnedConversationIds: text("pinned_conversation_ids")`)
- `src/backend/database/db/index.ts`: FOUND (contains `addColumnIfNotExists("user_preferences", "pinned_conversation_ids", "TEXT")`)
- `src/backend/database/routes/user-preferences.ts`: FOUND (contains extracted handlers + pinnedConversationIds logic)
- `src/backend/database/routes/user-preferences.test.ts`: FOUND (13 tests)
- Commit `1ea7861`: FOUND in git log
- Commit `b1bd547`: FOUND in git log
