---
phase: 107-hide-identity-rows-via-disk-sentinel
plan: 02
subsystem: backend
tags: [hidden-sentinel, user-preferences, identities, disk-read, per-identity-file, D-02, D-03, D-05, D-06, H3-lowercase-on-disk]

requires:
  - phase: 107-01
    provides: ALLOWED_REL_PATHS extended to include ".hidden" — writeIdentityFile / removeIdentityFile / identityFileExists accept ".hidden" relPath

provides:
  - publicIdentity response object with hidden:boolean field populated on-demand from disk (D-03 no DB mirror)
  - PUT /user-preferences hidden-fanout that drives per-identity `.hidden` sentinel writes/removes over the primitive (D-05 wire generalization)
  - GET /user-preferences no longer surfaces hiddenConversationIds from the DB row (row column now dead — Plan 03 drops physically)
  - Shared connByHost map across pin + hidden fanouts — one SSH conn per unique host when both slices arrive in same PUT body
  - H3 lowercase-on-disk invariant regression traps at BOTH read-side (HID-107-06) and write-side (HID-107-PUT-08)

affects: [107-03-schema-drop, 107-04-frontend]

tech-stack:
  added: []
  patterns:
    - "publicIdentity gains a hidden:boolean field as the seventh argument (default false — fail-closed per D-01), parallel to the existing sixth-arg pinned:boolean pattern from Phase 92"
    - "Disk-fanout inner Promise.all: hiddenPromise (identityFileExists('.hidden').catch(()=>false)) launched alongside pinnedPromise and readIdentityFile in the SAME wave — no added round-trip per identity, two stat probes in parallel"
    - "PUT handler: both pin and hidden fanouts share ONE connByHost Map and ONE try/finally block — one SSH conn per unique hostId across BOTH slices (HID-107-PUT-09)"
    - "Delta-diff algorithm: probe previousSet from disk (identityFileExists per identityHosts key), compute symmetric toAdd/toRemove, fan writes+removes in parallel, re-derive echo from disk (trust disk not client)"
    - "Hidden-only PUT skips DB write block entirely (didFanoutSentinels=true) — no forceSave for hidden-only requests (SAVE 107-01 regression trap)"

key-files:
  created: []
  modified:
    - src/backend/database/routes/identities.ts
    - src/backend/database/routes/identities.disk-read.test.ts
    - src/backend/database/routes/user-preferences.ts
    - src/backend/database/routes/user-preferences.test.ts

key-decisions:
  - "hidden:boolean field is the seventh argument in publicIdentity (fail-closed default false per D-01 — a caller that omits it reports the identity as unhidden, never fabricates truthy state)"
  - "Both .pinned and .hidden probes launch in the SAME Promise.all wave as readIdentityFile — no serial second round-trip per identity (HID-107-04)"
  - "connByHost map shared between pin fanout and hidden fanout inside ONE try/finally — the restructure wraps both sibling if-blocks under a single outer try, preserving the pin block's byte-for-byte behavior (HID-107-PUT-09)"
  - "parseHiddenConversationIds deleted; pickPreferences no longer projects hiddenConversationIds — GET response omits the field (D-02 complete)"
  - "Response echo for hidden re-derived from disk post-fanout (trust disk not client — D-06 truth-first invariant, mirrors pin echo pattern)"
  - "H3 anti-coercion: identityHosts keys lowercased at parseIdentityHosts entry boundary; threaded VERBATIM into all .hidden primitive calls — no additional .toLowerCase() between the boundary and the fanout"
  - "PUB-92-04/05/06 tests updated to reflect dual-probe shape (6 identityFileExists calls for 3 identities, not 3) — these are expected regressions of the test assertions, not behavior regressions"

requirements-completed: [D-01, D-02, D-03, D-04, D-05, D-06, SC-2, SC-3]

duration: ~12 min
completed: 2026-09-12T14:53:00Z
---

# Phase 107 Plan 107-02: Rewire backend hidden slice — read/write path Summary

**publicIdentity grows `hidden: boolean` populated by on-demand disk read via `identityFileExists(name, ".hidden", ...)`; PUT /user-preferences fans out per-identity `.hidden` writes/removes over the Plan 107-01 primitive; the `user_preferences.hiddenConversationIds` DB column is no longer read or written anywhere in the codebase — disk is authoritative for both pinned and hidden state.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-09-12T14:40:53Z
- **Completed:** 2026-09-12T14:52:44Z
- **Tasks:** 2 (Task 1 read path + tests; Task 2 write path + tests)
- **Files modified:** 4

## Accomplishments

### Read path shipped (Task 1)

`publicIdentity` at identities.ts now accepts a seventh `hidden: boolean` argument (default false — fail-closed per D-01). The returned object emits `hidden` as a sibling field to `pinned` (both follow the same "presence is meaning" pattern).

The GET /identities disk-fanout launches `identityFileExists(identityKey, ".hidden", { hostId, conn })` in the SAME `Promise.all` wave as `identityFileExists(identityKey, ".pinned", ...)` and `readIdentityFile`. Any exists-failure is caught inline and downgraded to `false` — a stat error can never paint an identity as hidden.

**9 new tests pass:**
- PUB-107-signature-1/2/3: publicIdentity's seventh arg `hidden:boolean` shape
- HID-107-01: .hidden sentinel false → hidden:false
- HID-107-02: .hidden sentinel true → hidden:true
- HID-107-03: .hidden probe throws → fail-closed hidden:false (D-01)
- HID-107-04: parallel-wave assertion (both probes fire before readIdentityFile resolves)
- HID-107-05: 2 calls per identity (one .pinned, one .hidden) — no memo dedup
- HID-107-06: H3 verbatim-passthrough lock — identityKey VERBATIM to identityFileExists for .hidden

**PUB-92-04/05/06 updated** to reflect the dual-probe reality (3 identities → 6 identityFileExists calls, not 3).

### Write path shipped (Task 2)

`handlePutPreferences` now drives per-identity hidden fan-out:
1. Validate hiddenConversationIds shape (array-of-strings + length cap) — preserved verbatim (HID-107-PUT-07a/b/c).
2. Require `identityHosts` body field when `hiddenConversationIds` present (HID-107-PUT-07d).
3. Shared connByHost map — both pin and hidden fanouts open conns inside ONE outer try/finally. When both slices arrive in the same PUT, one SSH conn per unique host serves BOTH (HID-107-PUT-09).
4. Probe `identityFileExists` across every identityHosts key → `previousSet` for `.hidden`.
5. Compute delta: `toAdd = nextSet - previousSet`, `toRemove = previousSet - nextSet`.
6. Fan out `writeIdentityFile(k, ".hidden", "", ...)` + `removeIdentityFile(k, ".hidden", ...)` in parallel. Any throw surfaces synchronously as 500 (D-06).
7. Re-derive disk-authoritative post-fanout set and echo THAT in the response (do not trust client input for the echo — D-06 truth-first).
8. Close all conns in the shared finally.

**GET path retirement:** `parseHiddenConversationIds` deleted. `pickPreferences` no longer projects `hiddenConversationIds`. GET /user-preferences response body no longer contains the field. Both `pinnedConversationIds` AND `hiddenConversationIds` are absent from GET response.

**39 tests pass** (previously 24; 15 new HID-107-* tests added, HIDE 1-10/HIDE-X retired):

New tests:
- HID-107-GET-01: hiddenConversationIds absent from GET response
- HID-107-PUT-01..10: fanout contract (writes/removes/no-op/failure/validation/H3/conn-sharing/echo)
- HID-107-DB-01/01b: D-02 regression trap — both DB columns untouched post-fanout
- SAVE 107-01: hidden-only PUT skips DB write + forceSave (mirrors SAVE 92-02)

## Task Commits

Task 1 (TDD RED → GREEN):
1. `8fe73185` (test) — RED: 9 failing tests (PUB-107-signature-1/2/3 + HID-107-01..06) for publicIdentity hidden:boolean + disk-fanout .hidden probe
2. `581e20ac` (feat) — GREEN: publicIdentity seventh arg + disk-fanout hiddenPromise in same Promise.all wave + publicIdentity(.., hidden) call updated; PUB-92-04/05/06 updated for dual-probe

Task 2 (TDD RED → GREEN):
3. `bd587127` (test) — RED: 15 failing tests; HIDE 1-10/HIDE-X retired; HID-107-PUT-01..10 + HID-107-GET-01 + HID-107-DB-01/01b added; SAVE 1/4 updated; SAVE 107-01 added; GET-92-01/01b updated for hiddenConversationIds-absent assertion
4. `654e7b6f` (feat) — GREEN: parseHiddenConversationIds deleted; pickPreferences no longer projects hiddenConversationIds; hidden fanout block added sibling to pin block; shared connByHost; disk-authoritative echo; _echoHidden stashed; type assertions for TS narrowing; backend build clean

## connByHost Sharing Invariant (HID-107-PUT-09)

The load-bearing architectural invariant: when both `pinnedConversationIds` AND `hiddenConversationIds` arrive in the same PUT body, they share ONE connByHost map opened ONCE per unique hostId, inside ONE try/finally block. The pin fanout runs first (existing order), the hidden fanout extends the connByHost map with any new hostIds not already mapped by pin (filter: `!connByHost.has(hostId)`), then both fanouts complete and the single finally closes all conns.

## Response Echo Re-derivation (D-06 Truth-first)

After the hidden fanout writes/removes, the handler re-derives the authoritative disk state by running `identityFileExists(key, ".hidden", ...)` for every identityHosts key. The echoed `hiddenConversationIds` array is this post-fanout disk state — NOT the client-submitted set. HID-107-PUT-10 locks this: if the disk probe returns true for a key the client didn't submit (e.g. bob), the echo includes bob.

## H3 Lowercase-on-disk Invariant

- **Read side (HID-107-06):** The disk-fanout iterates listIdentityKeysOnHost's folder names; identityFileExists for `.hidden` receives each folder name BYTE-FOR-BYTE — no case coercion.
- **Write side (HID-107-PUT-08):** writeIdentityFile / removeIdentityFile for `.hidden` receive the identityKey byte-for-byte from the parseIdentityHosts-lowercased map. The primitive's IDENTITY_KEY_RE gate is belt-and-suspenders.
- **Entry boundary:** The sole `.toLowerCase()` call in the file is at parseIdentityHosts L63 (`out[k.toLowerCase()] = v`) — unchanged from Phase 92. Zero new case coercion introduced.

## Pin Path Preserved (Phase 92 unchanged)

The pin fanout block is byte-for-byte functionally unchanged — only the outer wrapping scope expanded to include the hidden sibling. All existing PUT-92-* tests pass verbatim.

## DB Decoupling Complete (D-02)

Both DB columns are now dead-code for the hidden slice:
- `grep -c 'row\.hiddenConversationIds\|updates\.hiddenConversationIds'` → 0
- `grep -c 'parseHiddenConversationIds'` → 1 (comment only, not actual usage)
- HID-107-DB-01/01b confirms both columns untouched post-fanout

Plan 03 can safely drop the `hidden_conversation_ids` column from `user_preferences`.

## Grep-hygiene Snapshot

| Check | Result | Expected |
|-------|--------|----------|
| `grep -c 'parseHiddenConversationIds' user-preferences.ts` | 1 (comment only) | 0 actual usage |
| `grep -c 'row.hiddenConversationIds\|updates.hiddenConversationIds'` | 0 | 0 |
| `grep -c 'writeIdentityFile.*\.hidden\|removeIdentityFile.*\.hidden'` | 3 | >= 2 |
| `grep -c 'identityFileExists.*\.hidden' user-preferences.ts` | 3 | >= 1 |
| `grep -c 'identityFileExists.*\.hidden' identities.ts` | 1 | >= 1 |
| `grep -c 'H3 lowercase-on-disk invariant' user-preferences.ts` | 4 | >= 2 |
| Backend build (`npm run build:backend`)| exits 0 | exits 0 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] PUB-92-04/05/06 test assertions updated for dual-probe shape**

- **Found during:** Task 1 GREEN (after adding `.hidden` probe to disk-fanout)
- **Issue:** PUB-92-04 expected 2 identityFileExists calls (one per identity for .pinned only); now there are 4 (two per identity: .pinned + .hidden). PUB-92-05 expected 3 calls for 3 identities; now 6. PUB-92-06 asserted all calls used ".pinned" relPath; now ".hidden" calls also exist.
- **Fix:** Updated call-count assertions to reflect dual-probe (2 per identity), filtered PUB-92-06's relPath assertion to .pinned-only calls, added positive shape-lock asserting all relPaths are either ".pinned" or ".hidden".
- **Files modified:** src/backend/database/routes/identities.disk-read.test.ts
- **Commit:** 581e20ac

**2. [Rule 3 - Blocking] TypeScript type narrowing broken by fanout restructure**

- **Found during:** Task 2 GREEN — `npm run build:backend` reported 6 type errors on `pinnedConversationIds.length`, `for...of pinnedConversationIds`, `new Set(pinnedConversationIds)` and the hidden parallels.
- **Issue:** Moving validation checks outside the inner try/finally block into shared pre-checks broke TypeScript's control-flow narrowing — `pinnedConversationIds` (typed as `unknown`) wasn't narrowed to `string[]` inside the try block.
- **Fix:** Added `const pinnedIds = pinnedConversationIds as string[];` and `const hiddenIds = hiddenConversationIds as string[];` type assertions inside each fanout block, after the validation pre-checks established the actual type. All downstream references in each block use the typed aliases.
- **Files modified:** src/backend/database/routes/user-preferences.ts
- **Commit:** 654e7b6f

**3. [Rule 1 - Bug] SAVE 1 and SAVE 4 tests updated for hidden-no-longer-DB path**

- **Found during:** Task 2 RED test writing — SAVE 1 and SAVE 4 used `hiddenConversationIds: ["a"]` to test DB insert/forceSave. Post-107-02, this body triggers the hidden fanout (not a DB write) and requires `identityHosts`.
- **Fix:** Updated SAVE 1 body to `{ language: "en" }` and SAVE 4 body to `{ language: "fr" }` — both still exercise the DB write path + forceSave correctly. SAVE 1 description updated from "hidden-only PUT" to "language-write path".
- **Files modified:** src/backend/database/routes/user-preferences.test.ts
- **Commit:** bd587127

## Known Stubs

None — all disk-fanout paths are fully wired. The response echo re-derives from disk (not a stub). No hardcoded empty values or placeholder text introduced.

## Threat Flags

None — no new network endpoints, no new auth paths, no new file access patterns beyond what the plan's threat model covers. The hidden fanout reuses the same primitive gates (IDENTITY_KEY_RE + ALLOWED_REL_PATHS) as the pin fanout. The trust boundary analysis from the plan's `<threat_model>` applies verbatim.

## Self-Check: PASSED

- Modified files (all verified via grep):
  - `src/backend/database/routes/identities.ts` — FOUND (`identityFileExists.*\.hidden` → 1, `hidden:` → 4)
  - `src/backend/database/routes/identities.disk-read.test.ts` — FOUND (HID-107 → 6 tests)
  - `src/backend/database/routes/user-preferences.ts` — FOUND (`writeIdentityFile.*\.hidden` → 3, `parseHiddenConversationIds` → 0 actual usage)
  - `src/backend/database/routes/user-preferences.test.ts` — FOUND (HID-107 → 15 tests)
- Commits (all short hashes exist on `feat/tab-title-from-tmux`):
  - `8fe73185` — FOUND (Task 1 RED)
  - `581e20ac` — FOUND (Task 1 GREEN)
  - `bd587127` — FOUND (Task 2 RED)
  - `654e7b6f` — FOUND (Task 2 GREEN)
- Scoped-test result: 88/88 tests green across 3 test files
- Backend build: `npm run build:backend` exits 0

---

*Phase: 107-hide-identity-rows-via-disk-sentinel*
*Completed: 2026-09-12*
