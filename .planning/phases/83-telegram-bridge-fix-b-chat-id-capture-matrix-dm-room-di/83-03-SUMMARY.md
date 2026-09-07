---
phase: 83-telegram-bridge-fix-b
plan: 03
subsystem: telegram-bridge
tags: [telegram, reconcile, sentinel, in-memory-db, forceSave]
requires:
  - src/backend/telegram/shared-volume.ts (TG_BRIDGE_STATE_DIR + assertSafeHumanName from Phase 79 Plan 03)
  - src/backend/telegram/bridge-config-writer.ts (rewriteRegistryFromCurrentState from Phase 79 Plan 04)
  - src/backend/utils/database-save-trigger.ts (forceSave invariant)
  - src/backend/database/db/schema.ts (telegramBotTokens.telegramChatId nullable TEXT column)
provides:
  - scanAndReconcilePendingChatIds (idempotent single-pass sweep)
  - startReconcilePendingChatIdsLoop (fire-and-forget 30s interval, .unref()'d)
  - ReconcilePendingChatIdsResult typedef
  - pendingChatIdPath(agentName) shared-volume path helper
affects:
  - starter.ts boot sequence (one new fire-and-forget import block)
tech-stack:
  added: []
  patterns:
    - sentinel-handshake reconcile (mirrors Phase 79 Plan 08 reconcile-dead-tokens exactly)
    - in-memory-DB forceSave-per-write invariant (host-autostart-routes:173-181 pattern)
    - .unref()'d NodeJS.Timeout for test-safe intervals
key-files:
  created:
    - src/backend/telegram/reconcile-pending-chat-ids.ts (269 lines)
    - src/backend/telegram/reconcile-pending-chat-ids.test.ts (365 lines, 11 tests)
  modified:
    - src/backend/telegram/shared-volume.ts (+16 lines — pendingChatIdPath export)
    - src/backend/telegram/shared-volume.test.ts (+33 lines — SV-01..SV-04)
    - src/backend/starter.ts (+24 lines — reconcile-pending-chat-ids fire-and-forget block)
decisions:
  - "Reject negative chat_ids in v1 (POSITIVE_INT_RE = /^[0-9]+$/) — group chats deferred per CONTEXT § 2 'only DMs so positive integers only'"
  - "Leave sentinel on rewriteRegistryFromCurrentState failure — next-tick DB UPDATE is idempotent same-value (safe retry, CONTEXT § open-questions v1 choice)"
  - "Leave sentinel on no-DB-row (agent name has no telegram_bot_tokens row yet) — race window during activate flow; NOT counted as failed"
  - "Continue past DatabaseSaveTrigger.forceSave failure — data is in RAM, still write registry + unlink (CONTEXT § 2)"
  - "One rewriteRegistryFromCurrentState call per successful DB update (not batched at end of sweep) — mirrors reconcile-dead-tokens.ts behavior; acceptable at 30s cadence and simplifies failure semantics"
metrics:
  duration: 25m
  completed: 2026-09-07
---

# Phase 83 Plan 03: reconcile-pending-chat-ids Summary

Skynet-side reconcile loop that reads `/state/<agent>.pending-chat-id` sentinels (written by the tg-bridge Plan 83-01 on unknown-chat_id detection), persists the chat_id to `telegram_bot_tokens.telegramChatId`, honors the in-memory-DB `DatabaseSaveTrigger.forceSave` invariant, triggers a registry rewrite, and unlinks the sentinel — mirroring the exact shape of `reconcile-dead-tokens.ts`.

## Mirror relationship to reconcile-dead-tokens

Structurally identical to `src/backend/telegram/reconcile-dead-tokens.ts` (Phase 79 Plan 08). Same shape:

| Aspect                          | reconcile-dead-tokens (Phase 79)                   | reconcile-pending-chat-ids (Phase 83)                     |
| ------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| Trigger                         | `<humanName>.token-dead` sentinel                  | `<agentName>.pending-chat-id` sentinel                    |
| Guard                           | `assertSafeHumanName(humanName)` before any op     | `assertSafeHumanName(agentName)` before any op            |
| Contents validation             | (no contents — sentinel is just a flag)            | `POSITIVE_INT_RE = /^[0-9]+$/` after `.trim()`            |
| DB action                       | `mintAndWriteHumanToken(mxid, humanName)`          | `db.update(telegramBotTokens).set({telegramChatId, updatedAt}).where(eq(identityKey, agentName))` |
| Save invariant                  | (mintAndWriteHumanToken handles internally)        | `DatabaseSaveTrigger.forceSave("reconcile-pending-chat-id")` |
| Post-op                         | (nothing — token file already on disk)             | `rewriteRegistryFromCurrentState()`                       |
| Success cleanup                 | `fsp.unlink(humanTokenDeadPath(humanName))`        | `fsp.unlink(pendingChatIdPath(agentName))`                |
| Fail-open semantics             | leave sentinel for next-tick retry                 | leave sentinel for next-tick retry                        |
| Loop shape                      | `setInterval(...) → .unref()`                      | `setInterval(...) → .unref()`                             |
| Wired from                      | `starter.ts:299` — 30s cadence                     | `starter.ts:323` — 30s cadence, sibling of Plan 79-08     |

## Log operation strings (for prod grep)

Ops can grep the docker logs for these strings:

| Operation string                              | Level | When                                                                |
| --------------------------------------------- | ----- | ------------------------------------------------------------------- |
| `reconcile_pending_chat_id_bad_name`          | warn  | assertSafeHumanName rejected — traversal/uppercase/64-char cap fail |
| `reconcile_pending_chat_id_read_failed`       | warn  | `fsp.readFile` on the sentinel threw                                |
| `reconcile_pending_chat_id_bad_contents`      | warn  | Contents failed `POSITIVE_INT_RE` after `.trim()` (empty / non-integer / negative) |
| `reconcile_pending_chat_id_db_failed`         | warn  | drizzle `db.select().from().where().limit()` threw                  |
| `reconcile_pending_chat_id_no_row`            | warn  | Zero rows returned for identityKey (race window; sentinel LEFT)     |
| `reconcile_pending_chat_id_update_failed`     | warn  | drizzle `db.update().set().where()` threw (sentinel LEFT)           |
| `reconcile_pending_chat_id_save_failed`       | warn  | `DatabaseSaveTrigger.forceSave` rejected (non-fatal — data in RAM)  |
| `reconcile_pending_chat_id_rewrite_failed`    | warn  | `rewriteRegistryFromCurrentState` returned `{ok:false}` (sentinel LEFT) |
| `reconcile_pending_chat_id_unlink_failed`     | warn  | Successful sweep, but `fsp.unlink` threw (retry next tick)          |
| `reconcile_pending_chat_id_updated`           | info  | Full success — DB updated + registry rewritten + sentinel unlinked  |
| `reconcile_pending_chat_id_sweep`             | info  | Per-tick sweep-complete summary with scanned/updated/failed counts  |
| `reconcile_pending_chat_id_escaped`           | warn  | Loop-level catch: `scanAndReconcilePendingChatIds()` rejected       |
| `reconcile_pending_chat_id_start_failed`      | warn  | Dynamic import at boot (starter.ts) failed                          |

## Key design choices

### 1. Reject negative chat_ids in v1

`POSITIVE_INT_RE = /^[0-9]+$/` — group chats have negative chat_ids (Telegram API convention) and are explicitly out of scope for Phase 83 (CONTEXT § "Not in scope" and § 2 v1 DM-only). A negative chat_id sentinel logs `reconcile_pending_chat_id_bad_contents`, counts as `failed`, and leaves the sentinel — group-chat support in a later phase can either loosen the regex or introduce a separate loop.

### 2. Leave sentinel on rewrite failure (idempotent retry)

When `rewriteRegistryFromCurrentState()` returns `{ok:false, error}`, the DB update has already happened but the registry is stale. We leave the sentinel; next tick will:

1. Re-detect the sentinel
2. Re-issue the same `UPDATE telegram_bot_tokens SET telegramChatId = <same value>` — a semantic no-op in SQLite
3. Retry `rewriteRegistryFromCurrentState`
4. On success, unlink

Trade-off: one wasted UPDATE per failed rewrite tick. Alternative was tracked-in-memory state or a separate "dirty registry" reconcile loop; both add complexity for a rare failure path. Same choice as CONTEXT open-question resolution ("prefer the second for v1 simplicity").

### 3. No-DB-row is not a failure

A user pastes the bot token in the activate UI; Skynet writes the DB row; the bridge writes the pending-chat-id sentinel; the reconcile loop tick fires. There's an in-memory-DB `saveTrigger` timeout window (~2s) where the row may not yet be visible if the write cadence didn't force-save. Rather than treat this as `failed`, we leave the sentinel with a warn `reconcile_pending_chat_id_no_row` — race window semantics; next tick will retry.

## Verification

- 11/11 tests pass in `reconcile-pending-chat-ids.test.ts` (RP-01..RP-11)
- 24/24 tests pass in `shared-volume.test.ts` (4 new SV-01..SV-04 + 20 pre-existing)
- 18/18 tests pass in `starter.test.ts` (no regression from the new fire-and-forget block; boot IIFE gated by `process.env.VITEST`)
- 6/6 tests pass in `reconcile-dead-tokens.test.ts` (sibling not regressed)
- `npx tsc --noEmit -p tsconfig.json` exits 0

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Acceptance criteria over-strictness (documented, not fixed)

Two grep-based acceptance criteria in the plan slightly under-counted actual grep hits because they didn't account for docstring mentions:

- `grep -c 'pending-chat-id' src/backend/telegram/shared-volume.ts` returned `3` (plan expected exactly `1`) — the extra hits are docstring references in the JSDoc comment above `pendingChatIdPath` (mentions the sentinel name and the reconcile-pending-chat-ids loop). Documentation intent, not a code deviation.
- `grep -c 'DatabaseSaveTrigger.forceSave'` returned `3` (plan expected `1`) — extras are in-file docstrings (`T-83-03-03` threat-contract explanation and the fn-level JSDoc). Only one call site exists (line 181), with the correct `"reconcile-pending-chat-id"` argument.
- Similar over-count for `rewriteRegistryFromCurrentState` (4 vs 2 expected) and `assertSafeHumanName` (4 vs 2 expected) — all extras are docstring lines. All actual code-site counts match plan intent.

No code change was needed; the acceptance criteria were aspirational grep bounds that didn't account for the docstring style the plan itself asked for ("Reliability contract" JSDoc block). Real functional invariants (single call site, correct arguments, `.unref()`'d handle) all hold.

## Threat Flags

None — no new trust boundaries introduced. All new fs and DB ops are guarded by pre-existing `assertSafeHumanName` (Phase 79) and parameterized `db.update().where(eq(...))` (drizzle). `POSITIVE_INT_RE` regex validates chat_id contents before any DB mutation.

## Known Stubs

None — the loop is fully wired, tested end-to-end at the unit level, and boot-integrated via `starter.ts`. Future phase (integration test / FIXB-07) will exercise the full activate → /start → chat_id captured → room populated path against real Docker containers.

## Self-Check: PASSED

Files exist:

- `src/backend/telegram/reconcile-pending-chat-ids.ts` FOUND
- `src/backend/telegram/reconcile-pending-chat-ids.test.ts` FOUND
- `src/backend/telegram/shared-volume.ts` MODIFIED (grep 'pendingChatIdPath' = 1 export)
- `src/backend/telegram/shared-volume.test.ts` MODIFIED (grep 'SV-01' = 1 test)
- `src/backend/starter.ts` MODIFIED (grep 'startReconcilePendingChatIdsLoop' = 1 call)

Commits exist:

- `7cff4532` test(83-03): add failing tests for pendingChatIdPath — FOUND
- `b9817015` feat(83-03): pendingChatIdPath helper — FOUND
- `2f274085` test(83-03): add failing tests for reconcile-pending-chat-ids — FOUND
- `0bb83dea` feat(83-03): reconcile-pending-chat-ids loop — FOUND
- `6eba5de8` feat(83-03): wire startReconcilePendingChatIdsLoop from starter — FOUND
