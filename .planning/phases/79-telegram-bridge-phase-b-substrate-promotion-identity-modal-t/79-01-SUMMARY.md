---
phase: 79-telegram-bridge-phase-b
plan: 01
subsystem: backend/telegram-storage
tags: [telegram, field-crypto, drizzle, sqlite, per-identity]
requires: [phase-75-matrix-admin-schema-precedent]
provides:
  - telegramBotTokens-schema
  - tokens-store-crud
  - telegram-bot-tokens-encrypted-field-registration
affects:
  - src/backend/database/db/schema.ts
  - src/backend/database/db/index.ts
  - src/backend/utils/field-crypto.ts
  - src/backend/telegram/tokens-store.ts (new)
  - src/backend/telegram/tokens-store.test.ts (new)
tech-stack:
  added: []
  patterns:
    - "per-identity FieldCrypto UPSERT (recordId = String(identityKey), not singleton)"
    - "boot-time forceSave() wrapped in try/catch/warn — phase-75 shape"
key-files:
  created:
    - src/backend/telegram/tokens-store.ts
    - src/backend/telegram/tokens-store.test.ts
  modified:
    - src/backend/database/db/schema.ts
    - src/backend/database/db/index.ts
    - src/backend/utils/field-crypto.ts
decisions:
  - "FieldCrypto HKDF recordId per row = String(identityKey); rotating identity name will strand old ciphertext (out-of-scope for Phase 79 — no rename UX exists)"
  - "deleteTelegramBotToken is silent no-op if row absent — mirrors § 3D disconnect ergonomics (repeat disconnect click must not error)"
  - "listTelegramBotTokens decrypts eagerly (no lazy loading) — acceptable at O(dozens of identities) scale, downstream Plan 04 needs full plaintext set to rebuild registry.json"
metrics:
  duration: "~40 min"
  completed: "2026-09-06"
  tasks: 2/2
  commits: 3
  files_created: 2
  files_modified: 3
  bytes_added: 601 lines
---

# Phase 79 Plan 01: Telegram bot-tokens storage substrate — Summary

**One-liner:** Per-identity Telegram bot tokens table with FieldCrypto AES-256-GCM encryption at rest, CRUD store mirroring `matrix-admin-creds-store.ts` verbatim except keyed per identity instead of singleton, plus boot-time schema migration + forceSave persistence.

## What shipped

### Files created

| File | Bytes | Purpose |
|------|-------|---------|
| `src/backend/telegram/tokens-store.ts` | 8,667 | CRUD store: get/set/delete/list, per-identity FieldCrypto encryption |
| `src/backend/telegram/tokens-store.test.ts` | 9,923 | 5-test unit suite (round-trip, at-rest-encryption, UPSERT, list, delete) |

### Files modified

| File | Added lines | Change |
|------|-------------|--------|
| `src/backend/database/db/schema.ts` | +22 | `telegramBotTokens` sqliteTable export after `matrixAdminCreds` (line ~694) |
| `src/backend/database/db/index.ts` | +42 | `CREATE TABLE IF NOT EXISTS telegram_bot_tokens` DDL at boot (line ~339) + `forceSave("phase-79-telegram-bot-tokens-schema")` block after phase-75's (line ~906) |
| `src/backend/utils/field-crypto.ts` | +5 | `telegram_bot_tokens: new Set(["bot_token"])` in `ENCRYPTED_FIELDS` |

### Commits (per-task atomic)

| Commit | Type | Purpose |
|--------|------|---------|
| `211c69e0` | `feat(79-01)` | Task 1 — schema + FieldCrypto registration + boot-time CREATE TABLE + forceSave |
| `896589fa` | `test(79-01)` | Task 2 RED — 5 failing tokens-store.test.ts before implementation |
| `3aec97a0` | `feat(79-01)` | Task 2 GREEN — tokens-store.ts implementation, all 5 tests pass |

## Verification evidence

### Task 1 acceptance greps (from PLAN.md § Task 1)

| Gate | Expected | Actual | Status |
|------|----------|--------|--------|
| `grep -c "^export const telegramBotTokens" src/backend/database/db/schema.ts` | 1 | **1** | ✓ |
| `grep -c "CREATE TABLE IF NOT EXISTS telegram_bot_tokens" src/backend/database/db/index.ts` | 1 | **1** | ✓ |
| `grep -c 'phase-79-telegram-bot-tokens-schema' src/backend/database/db/index.ts` | 1 | **2** | ⚠ deviation (see below) |
| `grep -v '^\s*//' src/backend/utils/field-crypto.ts \| grep -c '  telegram_bot_tokens: new Set(\["bot_token"\])'` | 1 | **1** | ✓ |
| `npx vitest run src/backend/utils/field-crypto.test.ts` regression | pass | **9/9 pass** | ✓ |
| `npx tsc --noEmit` on modified backend files | no new errors | **0 errors total in backend** | ✓ |

### Task 2 acceptance greps (from PLAN.md § Task 2)

| Gate | Expected | Actual | Status |
|------|----------|--------|--------|
| `test -f tokens-store.ts && test -f tokens-store.test.ts` | both exist | **both exist** | ✓ |
| `grep -c "^export async function get\|set\|delete\|listTelegramBotToken"` | 4 | **4** | ✓ |
| `grep -c 'DatabaseSaveTrigger.triggerSave("telegram_bot_tokens_save")'` | ≥ 2 | **2** (set + delete) | ✓ |
| `grep -c 'FieldCrypto\.encryptField\|FieldCrypto\.decryptField'` | ≥ 3 | **3** (encrypt in set, decrypt in get, decrypt in list) | ✓ |
| Secret-leak guard (`"SECRET`, `console.log.*botToken`, `log.*botToken:`) | 0 | **0** | ✓ |
| `npx vitest run src/backend/telegram/tokens-store.test.ts` | 5/5 pass | **5/5 pass** | ✓ |
| `npx tsc --noEmit` on tokens-store files | no errors | **0 errors** | ✓ |

### Plan-level `<verification>` block

- **`npx vitest run src/backend/telegram/tokens-store.test.ts`** → `Test Files 1 passed (1) / Tests 5 passed (5)` ✓
- **`npx vitest run src/backend/utils/field-crypto.test.ts`** → `Test Files 1 passed (1) / Tests 9 passed (9)` (no regression from adding `telegram_bot_tokens` ENCRYPTED_FIELDS entry) ✓
- **`npx tsc --noEmit -p tsconfig.node.json`** → `exit code 0, 0 errors` (see deviation below re: tsconfig path) ✓

### Plan-level `<success_criteria>` (from PLAN.md § success_criteria)

- ✓ `telegramBotTokens` sqliteTable defined + exportable from `schema.ts`
- ✓ `telegram_bot_tokens` table CREATE'd at boot + force-saved (parallel to phase-75's shape)
- ✓ `bot_token` column registered as encrypted field in `field-crypto.ts`
- ✓ `tokens-store.ts` exports `get/set/delete/listTelegramBotToken` with UPSERT semantics, DatabaseSaveTrigger on every mutation, and never logs bot token values
- ✓ Round-trip encryption test passes (Test 1); raw-column-does-not-contain-plaintext test passes (Test 2)

### `<must_haves>` block from PLAN.md frontmatter

- ✓ **Truth 1**: bot token stored via `setTelegramBotToken()` is AES-encrypted on disk (Test 2 asserts raw `bot_token` column does not contain plaintext substring; parses as FieldCrypto JSON with `{data, iv, tag, salt, recordId}`)
- ✓ **Truth 2**: `getTelegramBotToken(identityKey)` round-trips (Test 1 asserts equality)
- ✓ **Truth 3**: `telegram_bot_tokens` table exists in running RAM SQLite (via CREATE TABLE IF NOT EXISTS at boot) AND persisted to disk (via `forceSave("phase-79-telegram-bot-tokens-schema")` block) → survives container restart
- ✓ **Artifact grep**: every declared `contains` string in artifacts matches (`telegramBotTokens`, `telegram_bot_tokens`, `phase-79`)
- ✓ **Key link 1**: `tokens-store.ts` imports `telegramBotTokens` from `../database/db/schema.js` (line 34)
- ✓ **Key link 2**: `tokens-store.ts` calls `FieldCrypto.encryptField(input.botToken, masterKey, String(identityKey), FIELD_BOT_TOKEN)` (setTelegramBotToken, line 121)
- ✓ **Key link 3**: `db/index.ts` calls `DatabaseSaveTrigger.forceSave("phase-79-telegram-bot-tokens-schema")` (line 936)

## Deviations from plan

### 1. `[Rule 3 - blocker]` tsconfig path — `tsconfig.backend.json` does not exist

- **Found during:** Task 1 verification (`npx tsc --noEmit -p tsconfig.backend.json`)
- **Issue:** PLAN.md acceptance criteria and `<verification>` block reference `tsconfig.backend.json`, which is not a file in this repo. Actual configs: `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`.
- **Fix:** Used `tsconfig.node.json` (which has `"include": ["src/backend/**/*.ts", ...]` — the backend project). Verified 0 errors across the entire backend, no regressions attributable to Phase 79 files.
- **Files modified:** none (config-only issue in verification command).
- **Commit:** N/A (verification-only substitution).

### 2. `[Rule 3 - blocker]` vitest `--reporter=basic` flag not supported

- **Found during:** Task 1 verification and Task 2 verification.
- **Issue:** PLAN.md and acceptance criteria specify `npx vitest run <file> --reporter=basic`; vitest v4.1.8 in this tree does not resolve `basic` as a reporter and errors with `Failed to load url basic`.
- **Fix:** Ran tests with default reporter (still produces `Test Files X passed / Tests Y passed` summary lines needed for evidence). Also, `--related` (mentioned in fleet-rules) is `CACError: Unknown option \`--related\`` in this vitest version; used targeted-path invocations per fleet-rule OR clause.
- **Files modified:** none.
- **Commit:** N/A.

### 3. `[Rule 3 - blocker]` grep-count acceptance criterion under-specified vs. analog

- **Found during:** Task 1 verification.
- **Issue:** PLAN.md § Task 1 acceptance-criteria states `grep -c 'phase-79-telegram-bot-tokens-schema' src/backend/database/db/index.ts` returns 1. But the phase-75 analog (which the plan says to mirror "verbatim") has 2 references: the `forceSave("phase-75-matrix-admin-schema")` argument AND the `reason: "phase-75-matrix-admin-schema"` field inside the warn payload. Following the analog shape exactly produces 2, not 1.
- **Fix:** Adjusted my initial CREATE TABLE comment to reference "phase-75" and "a forceSave() block" in English instead of citing the schema-migration string verbatim, bringing the grep count to exactly 2 (matches phase-75 baseline). The forceSave call + reason field both carry the string, mirroring phase-75 exactly.
- **Rationale:** The `= 1` acceptance criterion was itself a plan-drafting slip against its own "mirror verbatim" mandate. Deviating from the analog by removing the `reason:` field would introduce log-shape drift from phase-75; the safer move is to match analog shape and document the count mismatch here.
- **Files modified:** `src/backend/database/db/index.ts` (comment wording only, no semantic change).
- **Commit:** part of `211c69e0`.

## Threat-model coverage

All four `mitigate` dispositions from PLAN.md `<threat_model>` are addressed:

| Threat ID | Category | Mitigation shipped in this plan | Evidence |
|-----------|----------|--------------------------------|----------|
| T-79-01-01 | Information Disclosure — logging | `tokens-store.ts` logs only `operation`, `identityKey`, `botUsername` (display-safe); never logs `botToken` value | Acceptance grep gate (0 matches for `console.log.*botToken\|log.*botToken:\|"SECRET`) |
| T-79-01-02 | Information Disclosure — disk file | `bot_token` column FieldCrypto-encrypted before every INSERT/UPDATE; HKDF context binds ciphertext to `identityKey` | Test 2 (raw-column-does-not-contain-plaintext + JSON-shape assertion) |
| T-79-01-03 | Tampering — ENCRYPTED_FIELDS registration | `telegram_bot_tokens: new Set(["bot_token"])` added to `field-crypto.ts` ENCRYPTED_FIELDS | Task 1 gate 4 grep = 1 |
| T-79-01-04 | DoS — forceSave failure on first boot | Wrapped in try/catch/warn (non-fatal); CREATE TABLE IF NOT EXISTS is idempotent so next boot retries | Code shape matches phase-75 precedent verbatim (`index.ts` line 928-946) |
| T-79-01-SC | Supply-chain — package installs | Zero new npm dependencies introduced | `git diff HEAD~3..HEAD -- package.json package-lock.json` returns empty |

## Known stubs

None — every function is fully wired, no `TODO`/`FIXME`/placeholder returns.

## Threat flags

None — no new surface introduced beyond what the plan and threat register anticipated. (No new network endpoints in this plan; Plan 03 adds routes.)

## Gotchas for downstream waves

1. **Do NOT use SINGLETON_ID pattern in downstream consumers.** Every read/write to `telegram_bot_tokens` MUST supply an `identityKey`. There is no "get the one row" — there are N rows, one per identity. Plan 03 routes' `/telegram/:identityKey` and Plan 04's `listTelegramBotTokens()` are the canonical consumption patterns.

2. **`listTelegramBotTokens()` decrypts eagerly.** Every call performs N HKDF derivations + N AES-GCM decrypts (where N = identity count). Fine at Phase 79's scale (~few dozen identities per Skynet), but Plan 08 reconcile-loop callers should cache the result across a sweep rather than call it repeatedly per row.

3. **Identity rename is stranded ciphertext.** If Skynet ever grows an "rename identity" UX, the FieldCrypto HKDF context (`${identityKey}:bot_token`) means the old ciphertext will fail to decrypt under the new key. Out-of-scope for Phase 79 (no rename UX exists), but any future rename plan must include a re-encrypt migration for this table.

4. **Deletion is idempotent by design.** Second/third calls to `deleteTelegramBotToken("alexander")` return `undefined` and log a "deleted (idempotent)" line. This is intentional per PLAN.md § 3D — the frontend disconnect button must never surface an error on a repeat click. Plan 03 route callers should NOT wrap this in "does row exist?" pre-checks.

5. **`.token-dead` sentinel / reconcile pathway is out-of-scope for this plan.** Plan 08 owns the dead-token detection loop; this plan only ships the storage substrate.

6. **DatabaseSaveTrigger.triggerSave is best-effort.** The try/catch/warn shape means a write can land in RAM without persisting to disk on the first-boot race (before `DatabaseSaveTrigger` is initialized). Consumers that need synchronous durability (unlikely — bot-token writes are user-driven, not startup-driven) should call `saveMemoryDatabaseToFile()` from `db/index.js` directly, mirroring `matrix-admin-routes.ts:66-73`.

## Self-Check: PASSED

- ✓ `src/backend/telegram/tokens-store.ts` exists (8,667 bytes)
- ✓ `src/backend/telegram/tokens-store.test.ts` exists (9,923 bytes)
- ✓ `src/backend/database/db/schema.ts` contains `export const telegramBotTokens` (git grep confirms)
- ✓ `src/backend/database/db/index.ts` contains `CREATE TABLE IF NOT EXISTS telegram_bot_tokens` and `phase-79-telegram-bot-tokens-schema`
- ✓ `src/backend/utils/field-crypto.ts` contains `telegram_bot_tokens: new Set(["bot_token"])`
- ✓ Commit `211c69e0` exists in git log (Task 1)
- ✓ Commit `896589fa` exists in git log (Task 2 RED)
- ✓ Commit `3aec97a0` exists in git log (Task 2 GREEN)
- ✓ 5 tokens-store tests pass; 9 field-crypto tests still pass; tsc backend exits 0
