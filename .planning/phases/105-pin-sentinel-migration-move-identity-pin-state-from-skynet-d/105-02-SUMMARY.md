---
phase: 92-pin-sentinel-migration
plan: 02
subsystem: backend
tags: [pin-sentinel, user-preferences, identities, disk-read, per-identity-file, D-03, D-04, D-05, D-06, D-09, H3-lowercase-on-disk]

requires:
  - phase: 92-01
    provides: per-identity-file primitive (writeIdentityFile / removeIdentityFile / identityFileExists) with H1 write⇔read regex parity lock + ALLOWED_REL_PATHS whitelist
provides:
  - publicIdentity response object with pinned:boolean field populated on-demand from disk (D-03 no DB mirror)
  - PUT /user-preferences pin-fanout that drives per-identity `.pinned` sentinel writes/removes over the primitive (D-05 wire generalization)
  - GET /user-preferences no longer surfaces pinnedConversationIds from the DB row (row column now dead — Plan 03 drops physically)
  - H3 lowercase-on-disk invariant regression traps at BOTH read-side (PUB-92-06) and write-side (PUT-92-08a/b) — the identityKey byte-for-byte contract from parseIdentityHosts's lowercased map / listIdentityKeysOnHost's raw folder enumeration through to the primitive
affects: [92-03-schema-drop, 92-04-frontend]

tech-stack:
  added: []
  patterns:
    - "publicIdentity gains a pinned:boolean field populated by identityFileExists in the SAME Promise.all wave as readIdentityFile — parallel per-identity fan, not a serial second round-trip"
    - "PUT /user-preferences fanout: parseIdentityHosts (lowercased) → dedupe hostIds → one SSH conn per unique host → probe previousSet via identityFileExists → compute delta → parallel writeIdentityFile/removeIdentityFile → re-derive disk-authoritative echo → close all conns in finally"
    - "H3 verbatim-passthrough: no .toLowerCase() coercion between the identityHosts entry boundary and the primitive fanout; the primitive's own IDENTITY_KEY_RE gate throws on any uppercase key (belt-and-suspenders)"
    - "Fail-closed per D-01 at both the read-side (identityFileExists throws → pinned:false in .catch) and pre-fanout probe (previousSet-derivation catches any exists-failure and treats as false)"
    - "Pin-only PUT skips the DB write block entirely (didFanoutSentinels also counts as 'did something' vs the 'No preferences provided' guard) — no forceSave when nothing DB-side changed"

key-files:
  created:
    - src/backend/database/routes/identities.disk-read.test.ts
  modified:
    - src/backend/database/routes/identities.ts
    - src/backend/database/routes/user-preferences.ts
    - src/backend/database/routes/user-preferences.test.ts

key-decisions:
  - "publicIdentity's sixth argument `pinned: boolean` defaults to false (fail-closed per D-01 'presence is meaning' — a caller that omits pinned must never fabricate a truthy state)"
  - "Fan-out probes previousSet across every identityHosts key, NOT just the diff subset — this simplifies the delta math (`toAdd = nextSet - previousSet, toRemove = previousSet - nextSet` are trivially derived) and guarantees the re-derived echo is comprehensive"
  - "Response-echo re-derivation from disk after the write fan (Step 4) — the echoed `pinnedConversationIds` array is the AUTHORITATIVE post-fanout disk state, NOT the client-submitted set (D-06 truth-first invariant)"
  - "identityHosts is a REQUIRED body field whenever pinnedConversationIds is present — defense-in-depth against a silent no-op fanout (PUT-92-06 + PUT-92-07d); mirrors identities.ts:239-255 parseIdentityHosts shape verbatim to avoid a cross-route circular import"
  - "hiddenConversationIds slice untouched (D-02 out-of-scope) — HIDE 1-10 regression pass green; HIDE-X updated to explicitly assert the pin path is DB-independent while the hide path still hits the row"
  - "PIN 1-3 GET tests retired; Test 4/5/6/10 PUT DB-write tests retired; Tests 7/8/9 validation tests preserved as PUT-92-07a/b/c — the DB-column read/write surface for pinnedConversationIds is dead and would be false-positive tests post-migration"

patterns-established:
  - "Per-identity boolean flag surfaced via publicIdentity, backed by an on-demand disk read parallel-fanned with readIdentityFile (candidate pattern for future D-03-style migrations of dormant / recycle / other-sentinel fields)"
  - "Delta-diff over parseIdentityHosts's key set (rather than the client-submitted array alone) — enables symmetric adds+removes in one Promise.all with proven previousSet knowledge"

requirements-completed: [D-01, D-03, D-04, D-05, D-06, D-09]

duration: 25min
completed: 2026-09-09
---

# Phase 92 Plan 92-02: Rewire pin state — backend read/write path Summary

**publicIdentity grows `pinned: boolean` populated by on-demand disk read via `identityFileExists(name, ".pinned", ...)`; PUT /user-preferences fans out per-identity `.pinned` writes/removes over the Plan 92-01 primitive; the `user_preferences.pinnedConversationIds` DB column is no longer read or written anywhere in the codebase.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-09T18:50:00Z
- **Completed:** 2026-09-09T19:03:00Z
- **Tasks:** 2 (Task 1 read path + tests; Task 2 write path + tests)
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- **Read path shipped (Task 1):** `publicIdentity` at identities.ts:141 accepts a sixth `pinned: boolean` argument (default false — fail-closed) and emits it in the returned object next to `roleDefaults`. The GET /identities disk-fanout at L282+ launches `identityFileExists(identityKey, ".pinned", { hostId, conn })` in the SAME `Promise.all` wave as `readIdentityFile`, so the pin state is a parallel disk read (not a serial second round-trip). Any exists-failure is caught inline and downgraded to `false` — a stat error can never paint an identity as pinned. 9 new PUB-92-* tests green (including PUB-92-06 H3 verbatim-passthrough lock).

- **Write path shipped (Task 2):** `handlePutPreferences` at user-preferences.ts:161+ now drives per-identity fan-out:
  1. Validate pinnedConversationIds shape (array-of-strings + length cap, retained verbatim).
  2. Require `identityHosts` body field (Record<identityKey, hostId>) — 400 if missing / any pin key lacks a host mapping.
  3. Dedupe hostIds, open one SSH conn per unique host in parallel.
  4. Probe `identityFileExists` across every identityHosts key → `previousSet`.
  5. Compute delta: `toAdd = nextSet - previousSet`, `toRemove = previousSet - nextSet`.
  6. Fan out `writeIdentityFile` + `removeIdentityFile` in parallel; any throw surfaces synchronously as 500 (D-06).
  7. Re-derive disk-authoritative post-fanout set and echo THAT in the response (do not trust client input for the echo).
  8. Close all conns in a finally.

- **Read path retirement in the same handler:** `parsePinnedConversationIds` deleted; `pickPreferences` no longer surfaces `pinnedConversationIds`. GET /user-preferences response body no longer contains the field. 2 new GET-92-01 tests (fresh row + legacy row with non-null column) both assert `"pinnedConversationIds" in body === false`.

- **H3 lowercase-on-disk invariant locked at TWO regression traps:**
  - **Read side (PUB-92-06 in identities.disk-read.test.ts):** disk-fanout iterates listIdentityKeysOnHost's returned folder names; asserts the identityFileExists spy receives each folder name BYTE-FOR-BYTE (`expect(receivedKeys).toContain(expected)`), plus positive-shape lock `expect(k).toBe(k.toLowerCase())` for every call. No downstream `.toLowerCase()` between the reader enumeration and the primitive.
  - **Write side (PUT-92-08a + PUT-92-08b in user-preferences.test.ts):** happy-path `writeIdentityFile` receives `"tina"` byte-for-byte from `identityHosts: { tina: 1 }`. Uppercase `"Tina"` path (via `identityHosts: { Tina: 1 }`) EITHER 400s at `parseIdentityHosts`'s `.toLowerCase()` collapse (input `"Tina"` doesn't resolve to a host once the map is lowercased) OR 500s at the primitive's `IDENTITY_KEY_RE` gate. Both branches acceptable — the invariant is that NO uppercase identityKey ever reaches disk.

- **Documented known-limitation:** if a maintainer manually creates a capitalized folder like `~/.claude/identities/Tina/` on a host, this system's sentinel operations SILENTLY MISS that folder — the reader's `IDENTITY_KEY_RE` rejects the folder-name enumeration entry, so the fanout never fans, so no sentinel probe fires. Documented in the H3 comment block at identities.ts near the identityFileExists callsite so the miss is a known limitation, not a hidden bug.

- **hiddenConversationIds slice UNTOUCHED (D-02 out-of-scope):** HIDE 1-10 pass verbatim; HIDE-X test updated to explicitly assert the pin path is DB-independent (row.pinnedConversationIds stays null after pin fanout) while the hide path still persists to the row (row.hiddenConversationIds contains the JSON.stringify'd value). This is the D-02 regression trap.

## Task Commits

Task 1 (TDD RED → GREEN):
1. `59601550` (test) — RED: 9 failing tests (PUB-92-signature-1..3 + PUB-92-01..06) for publicIdentity `pinned:boolean` + disk-fanout `.pinned` probe. Test file `identities.disk-read.test.ts` created.
2. `f659d032` (feat) — GREEN: publicIdentity signature extended; disk-fanout probes identityFileExists in the same Promise.all wave as readIdentityFile.

Task 2 (TDD RED → GREEN):
3. `ab21372d` (test) — RED: 12 failing tests (PUT-92-01..08 + GET-92-01a/b + HIDE-X rewrite + SAVE 92-02) for the fan-out contract + GET pin-omission. Pre-92 Test 4/5/6/10 + PIN 1-3 retired; SAVE 1/2/4 rewritten to drive DB writes via hidden/theme instead of pin.
4. `ea2c99ba` (feat) — GREEN: handlePutPreferences rewired to fan-out per-identity `.pinned` writes/removes; parsePinnedConversationIds deleted; GET response no longer carries pinnedConversationIds; parseIdentityHosts mirrored into user-preferences.ts to avoid cross-route circular import.

## Files Created/Modified

- **`src/backend/database/routes/identities.disk-read.test.ts`** (created, 501 lines) — 9 new tests: 3 direct publicIdentity signature unit tests + 6 GET /identities disk-fanout tests covering pinned:false/true, fail-closed exception path, parallel-with-readIdentityFile fan shape, no-per-identity-memo, and the H3 verbatim-passthrough regression trap.
- **`src/backend/database/routes/identities.ts`** (modified) — imports `identityFileExists` from per-identity-file primitive; publicIdentity signature extended with `pinned: boolean = false` sixth arg; disk-fanout at L282+ launches the `.pinned` probe in the same Promise.all wave as readIdentityFile with a fail-closed `.catch(() => false)`; H3 lowercase-on-disk invariant comment block near the callsite.
- **`src/backend/database/routes/user-preferences.ts`** (modified) — imports writeIdentityFile / removeIdentityFile / identityFileExists / isLocalHostId / connectOneShot / resolveHostById; parsePinnedConversationIds deleted; parseIdentityHosts mirrored from identities.ts:239-255 (lowercased entry boundary); pickPreferences no longer surfaces pinnedConversationIds; handlePutPreferences intercepts the pinnedConversationIds branch BEFORE the DB write path and drives the fanout; pin-only requests skip the DB write block via a `didFanoutSentinels` boolean; response-echo re-derived from disk after the fanout.
- **`src/backend/database/routes/user-preferences.test.ts`** (modified) — adds mocks for per-identity-file, isLocalHostId, connectOneShot, resolveHostById; PIN 1-3 GET tests replaced by GET-92-01a/b; Test 4/5/6/10 PUT tests replaced by PUT-92-01..05; Tests 7/8/9 preserved as PUT-92-07a/b/c; new PUT-92-06 (identityKey-not-in-map 400), PUT-92-07d (missing identityHosts 400), PUT-92-08a/b (H3 verbatim-passthrough); HIDE-X rewritten to assert pin/hide decoupling; SAVE 1/2/4 rewritten to use hidden/theme; new SAVE 92-02 (pin-only PUT no forceSave).

## Decisions Made

- **`pinned:boolean` field name (not `isPinned`, not `pin`)** — matches D-04's shape ("post-migration `getPinnedIds` API becomes a projection over identity metadata") and reads naturally against the sibling `coordinator: boolean` field already on `publicIdentity`. Frontend Plan 04 will consume via `identity.pinned` — no adaptation layer needed.

- **Default `pinned: false` in publicIdentity signature (not required arg)** — a Plan 92-04 frontend consumer that constructs a synthetic publicIdentity in a test context, or a future consumer that doesn't have host context yet, defaults to unpinned. Fail-closed per D-01 "presence is meaning" — the absence of a pin claim MUST NOT surface as pinned. PUB-92-signature-2 locks this.

- **Fan-out probes previousSet across ALL identityHosts keys, not just the pinnedConversationIds subset** — this is a symmetry win: with the previousSet computed uniformly, the delta math is trivially symmetric (`toAdd = new - prev, toRemove = prev - new`). If we only probed the pinnedConversationIds subset, we couldn't detect keys to REMOVE (since we wouldn't know they were previously pinned). Note that the practical DoS surface is bounded by the frontend Plan 04 sending only the identities in the pinned+recently-touched set — Ashley's real fleet identityHosts map is well under 20 entries.

- **Response-echo re-derives disk state AFTER the fanout, not before** — this preserves D-06's "success flips the row's rendered state on the next read" invariant. The echoed `pinnedConversationIds` is authoritative disk-state, NOT the client-submitted input. If the client submitted `["tina"]` but the write silently rejected (e.g. host unreachable — although that path 500s, so this is more theoretical), the echo would NOT contain `tina`. Test PUT-92-05 exercises the write-throws path (500 response, no echo).

- **`identityHosts` REQUIRED body field, not optional-with-fallback** — a request that carries `pinnedConversationIds: ["tina"]` but omits `identityHosts` gives the fanout no way to route the write. Without the required-field lock, the fanout would silently no-op (fanout iterates over `identityHosts`'s keys, which would be empty), the response would echo `[]`, and the user's pin toggle would silently fail. PUT-92-07d locks this at 400. Frontend Plan 04 knows to include the map because it already has one (conversation-store's `fleetSessions` — same source GET /identities uses).

- **Pin-only PUT skips the DB write block entirely** — pre-92 `Object.keys(updates).length === 1` guard would false-positive on a pin-only request post-92 (since `pinnedConversationIds` no longer contributes to `updates`). Added a `didFanoutSentinels` boolean that ALSO counts as "did something"; the DB write block is skipped when `Object.keys(updates).length === 1 && didFanoutSentinels`. This avoids a spurious DB update-with-only-updatedAt for pure pin toggles. SAVE 92-02 test locks this: pin-only PUT → no `forceSave` call, no row inserted/updated.

- **`parseIdentityHosts` mirrored (not imported) into user-preferences.ts** — importing from `identities.ts` would create a route-file → route-file dependency edge that risks a circular import (identities.ts currently doesn't import from user-preferences, but this could reverse in future refactors). The mirror is 15 lines of trivial code, easy to grep for divergence. Comment near the mirror explicitly names identities.ts:239-255 as the reference and calls out that behavior MUST stay identical.

## Deviations from Plan

### None (Rule 1/2/3 clean)

No auto-fix Deviations were needed for correctness or scope. The plan's stated action steps mapped cleanly onto the implementation. The one design choice worth noting (not a deviation, just a decision within Claude's Discretion per the plan):

**Retired old tests rather than adapting them.** The plan's Part A + Part B rewire the semantics fundamentally — `pinnedConversationIds` no longer flows through the DB row. Tests 4/5/6/10 asserted DB row state (`row!.pinnedConversationIds === '["a","b"]'`) which is now dead behavior. Rather than adapt to `row!.pinnedConversationIds === null` (which would be a weak assertion), I retired those tests and replaced them with the strong PUT-92-01..05 tests that assert the fanout SHAPE (writes/removes per identity + response-echo re-derivation). This matches the plan's "Test coverage" list at the top of the file, which explicitly names PUT-92-* / GET-92-* / SAVE 92-02 as the new surface.

## Threat Flags

None. The write-side attack surface is REDUCED by this plan:
- Pre-92: `pinnedConversationIds` was a JSON-serialized TEXT column on the user_preferences row. A malformed payload could bloat the row (mitigated by the 1000-entry cap) or leak into GET response projection.
- Post-92: writes fan out to sentinel files gated by the primitive's stricter `IDENTITY_KEY_RE` + `ALLOWED_REL_PATHS` whitelist. The DB column is dead code (Plan 03 physically drops it).
- No new network endpoints. No new auth paths. Trust boundary at PUT /user-preferences → primitive is JWT-gated + validated by primitive gates.
- T-92-02-02 (unauthorized write) mitigation: primitive's gates are defense-in-depth against a compromised handler.
- T-92-02-04 (DoS via massive pinnedConversationIds) mitigation: PINNED_CONVERSATION_IDS_MAX_LENGTH cap preserved (PUT-92-07c).
- T-92-02-05 (DoS via 1000 different hostIds) mitigation: `[...new Set(Object.values(identityHosts))]` dedupe before conn open; per-conn 5s timeout from `connectOneShot(host, 5_000)`.
- T-92-02-08 (H3 stealth case coercion) mitigation: PUT-92-08a + PUT-92-08b regression traps; primitive's own regex is the belt-and-suspenders lock.

## Issues Encountered

None — no blockers, no auth gates, no architectural surprises. The plan's `<action>` sections gave a precise implementation blueprint; execution followed it directly.

**One out-of-scope discovery, logged to deferred-items.md:** `src/backend/database/routes/relay-room-create.test.ts` has 8 pre-existing test failures unrelated to Phase 92 (confirmed via `git stash` — same failures on the pre-plan state). Not fixed here per fleet-rule scope discipline.

## User Setup Required

None — pure backend refactor. No new dependencies, no new env vars, no external service configuration, no nginx changes (routes unchanged). Frontend consumers of GET /identities will automatically pick up the new `pinned: boolean` field on next request; Plan 92-04 rewires the frontend `conversation-store` pinnedIds derivation to consume it.

## Next Phase Readiness

- **Plan 92-03 (schema drop) is unblocked:** `user_preferences.pinned_conversation_ids` is now dead code — grep confirms 0 refs to `row.pinnedConversationIds | updates.pinnedConversationIds | userPreferences.pinnedConversationIds` in the backend routes. Plan 03 can safely drop the column via drizzle migration + `DatabaseSaveTrigger.forceSave` after the migration ships.
- **Plan 92-04 (frontend) is unblocked:** GET /identities response objects now carry `pinned: boolean`; PUT /user-preferences accepts `identityHosts` body field and echoes disk-authoritative `pinnedConversationIds`. Frontend `getPinnedIds` API can be rewired to a projection over `useIdentitiesStore().identities.filter(id => id.pinned).map(id => id.identityKey)`; `putPinnedIds` signature preserved (still accepts a string[] of pin keys) but must add the `identityHosts` companion body field, sourced from `conversation-store.fleetSessions`.
- **H3 invariant contracts locked:** PUB-92-06 + PUT-92-08a/b are the regression traps for future refactors. Anyone editing the fanout code (identities.ts disk-fanout, user-preferences.ts pin-fanout, parseIdentityHosts) that accidentally introduces a `.toLowerCase()` or `.toUpperCase()` between the entry boundary and the primitive will break these tests loudly.
- **Documented known-limitation:** capitalized folder names on disk (e.g. `~/.claude/identities/Tina/`) are silently skipped by the read-side fanout AND the write-side primitive gate. This is by design (H3 invariant), documented in the plan and in the code comments near both fanout call sites.

## Self-Check: PASSED

- Created files:
  - `src/backend/database/routes/identities.disk-read.test.ts` — FOUND
- Modified files (all touched at git-diff level):
  - `src/backend/database/routes/identities.ts` — verified `identityFileExists` import, publicIdentity `pinned` arg, disk-fanout probe call, H3 comment block
  - `src/backend/database/routes/user-preferences.ts` — verified parseIdentityHosts, fan-out block, forceSave-skip-on-pin-only guard, H3 comment block
  - `src/backend/database/routes/user-preferences.test.ts` — verified new mocks + PUT-92-* / GET-92-* / SAVE 92-02 tests + HIDE-X rewrite + retired PIN/Test 4-10
- Commits (all short hashes exist on `feat/tab-title-from-tmux`):
  - `59601550` — FOUND (Task 1 RED)
  - `f659d032` — FOUND (Task 1 GREEN)
  - `ab21372d` — FOUND (Task 2 RED)
  - `ea2c99ba` — FOUND (Task 2 GREEN)
- Scoped-test result: 88/88 in-scope tests green across 4 test files (identities.disk-read.test.ts + identities.get-disk.test.ts + identities.put-disk.test.ts + user-preferences.test.ts). Adjacent identity tests unregressed.
- Grep-hygiene:
  - `row.pinnedConversationIds | updates.pinnedConversationIds | userPreferences.pinnedConversationIds` in user-preferences.ts → 0 refs ✓
  - `writeIdentityFile.*\.pinned | removeIdentityFile.*\.pinned` in user-preferences.ts → 2 refs ✓
  - `identityFileExists.*\.pinned` in identities.ts → 1 ref ✓
  - `H3 lowercase-on-disk invariant` in identities.ts → 1, in user-preferences.ts → 2 (total 3 across `/routes/`) ✓
  - `.toLowerCase()` in user-preferences.ts → 1 call at the parseIdentityHosts entry boundary only ✓

---

*Phase: 92-pin-sentinel-migration*
*Completed: 2026-09-09*
