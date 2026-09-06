---
phase: 80
plan: 03b
subsystem: backend/identities
tags: [mxid-derivation, pool-picked, ordinal-suffix, birth-orchestrator, A1-lock, tdd, DIVERGE]
dependency_graph:
  requires:
    - phase: 80
      plan: 02
      provides: "countUsersMatching(prefix) → { ok:true, total } | AdminErr primitive from matrix-admin-client (`da93cb32`)"
    - phase: 80
      plan: 03
      provides: "BirthOptions.task?: string field wiring + POST /identities/birth optional-nullable body-validation pattern (`53c16e54`)"
    - phase: 77
      provides: "runRelayMintAndWrite Step 6 admin-mint sequence + BirthDeps wiring pattern for matrix-admin primitives"
  provides:
    - "composeMxidLocalpart(name, role): PascalCase-hyphenated MXID localpart with mxid_role_malformed / mxid_name_not_pool_shape throw contract"
    - "deriveMxidWithOrdinal(base, server, countFn): silent-auto-suffix MXID with MXID_ORDINAL_MAX=100 cap"
    - "BirthOptions.poolPicked?: boolean gate for A1 DIVERGE branch"
    - "BirthDeps.matrixCountUsersMatching wired to plan 80-02's countUsersMatching"
    - "POST /identities/birth accepts + validates poolPicked (nullable optional boolean)"
    - "MXID_ORDINAL_MAX constant (100) for safety-cap tests + downstream reference"
  affects:
    - "Plan 80-04 (pool-pick picker) — picker now only needs to check the BASE handle (`<PoolName>-<Role>:server`); ordinal uniqueness owned server-side inside birthIdentity"
    - "Plan 80-06 (frontend NewSessionDialog) — dialog sets poolPicked=true when name was pool-prefilled by /identities/pool/pick"
tech_stack:
  added: []
  patterns:
    - "Pool-name-shape regex POOL_NAME_RE = /^[a-z][a-z0-9]*$/ (single-lowercase-word, no hyphens, no leading digit)"
    - "Role-name-shape regex ROLE_NAME_RE = /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/ (stricter than existing ROLE_NAME_PATTERN — required for deterministic PascalCase composition; segment-boundary well-formedness)"
    - "PascalCase-first-letter transform: `name[0].toUpperCase() + name.slice(1)` for pool name; `role.split('-').map(seg => seg[0].toUpperCase() + seg.slice(1)).join('-')` for role"
    - "Silent-auto-suffix ordinal iteration: n=1 bare, n=2..MAX with `-<n>` suffix; countFn callback returns `{ok:true,total}` for free-slot polling"
    - "Discriminated-union guard: `if (result.ok === false)` (NOT `!result.ok`) — mirrors existing Step 6 mintResult/loginResult pattern at L677+; required for tsc narrowing under tsconfig.node.json"
    - "Silent fallback via error-code substring match: `catch (e) { if (!msg.startsWith('mxid_name_not_pool_shape')) throw e; }` — narrowly catches ONE error tag while allowing all others (e.g. mxid_role_malformed) to fail Step 6 loudly"
    - "Q2 no-rollback preservation via in-runStep derivation: derivation lives INSIDE existing Step 6's runStep closure — failures attribute to step 6 as SSE step-failed event, no new numbered SSE step introduced, runStep call count baseline (9 total / 6 await runStep) preserved"
key_files:
  created:
    - "src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts (19 tests: 8 composeMxidLocalpart + 6 deriveMxidWithOrdinal + 5 Step 6 integration)"
  modified:
    - "src/backend/database/routes/identity-birth-orchestrator.ts (add POOL_NAME_RE + ROLE_NAME_RE + MXID_ORDINAL_MAX constants; add composeMxidLocalpart + deriveMxidWithOrdinal exported helpers; extend BirthOptions with poolPicked?: boolean; extend BirthDeps with matrixCountUsersMatching; widen runRelayMintAndWrite opts with role? + poolPicked?; refactor Step 6 `const mxid` → `let mxid: string` with derivation branch; thread role+poolPicked through birthIdentity's runRelayMintAndWrite call)"
    - "src/backend/database/routes/identity-birth.ts (import countUsersMatching as matrixCountUsersMatching; destructure poolPicked from body; validate as boolean-or-undefined; parsedPoolPicked tri-state preservation; wire matrixCountUsersMatching into BirthDeps; thread poolPicked into birthIdentity opts)"
    - "src/backend/database/routes/identity-birth.test.ts (extend matrix-admin-client mock with countUsersMatching; extend Test 5 dep assertion; add 4 T-80-03b-birth-* cases for poolPicked=true/false/absent threading + non-boolean 400 validation)"
decisions:
  - "PascalCase-first-letter rule locked (not full title-case): `willow` → `Willow` (rest verbatim), NOT `Willow` from `WILLOW` normalize — pool names are gate-validated single-lowercase-word per POOL_NAME_RE so the rest is already lowercase; keeping rest-verbatim avoids surprising the caller if pool restriction ever loosens"
  - "Ordinal cap = 100 (MXID_ORDINAL_MAX): arbitrary large ceiling; pool exhaustion beyond 100 same-handle accounts indicates operator intervention needed (pool-list expansion or manual renaming). Cap breach throws mxid_ordinal_exhausted which propagates as Step 6 SSE step-failed event."
  - "Silent-fallback branch ONLY for mxid_name_not_pool_shape (not mxid_role_malformed): shape file says the user can edit the name to anything, so a non-pool-shape name silently falls back to legacy `@<name>:<server>`. Role names are gate-validated upstream (route handler + Step 2.5 re-check) so malformed role at Step 6 is a genuine bug and MUST surface loudly."
  - "MXID derivation lands INSIDE Step 6's runStep (not as a new numbered step): preserves Q2 no-rollback invariant, keeps SSE frontend BirthProgress checklist untouched (still ticks 5 items steps 1..5 + the existing Phase 77 steps 6..8), and attributes admin-API failures during derivation cleanly to step 6."
  - "New stricter ROLE_NAME_RE distinct from existing ROLE_NAME_PATTERN: pre-existing pattern `/^[a-z0-9-]+$/` (used at Step 2.5 role gate) is looser — accepts leading digits, empty segments, all-digit segments — because it's a folder-name safety check, not a composition input. MXID composition needs stricter shape (`/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/`) for deterministic PascalCase output; introduced as a distinct named constant rather than tightening the existing one to avoid regressing Phase 22 role acceptance."
  - "Retry route (POST /retry/:key) intentionally unchanged: retry always operates on an already-on-disk identity folder whose folder name IS the correct MXID localpart source for retry semantics. runRelayMintAndWrite's opts.poolPicked === true gate returns false when retry passes {name, displayName} (poolPicked undefined) → legacy `@<name>:<server>` branch → matrixCountUsersMatching never invoked → retry's Pick<> deps object can safely omit the new dep."
  - "poolPicked tri-state preservation: parsedPoolPicked keeps false ≠ undefined distinction. undefined ⇒ orchestrator legacy branch (backward compat for pre-Phase-80 clients that don't know the field). false ⇒ explicit opt-out (client knows the field but wants legacy shape) — threaded as false, still lands on legacy branch inside orchestrator, no functional difference from undefined but preserves client's intent for auditability."
  - "n=1 = bare handle (no ordinal suffix); n=2..MAX = `-<n>` suffix: matches shape file spec — first collision suffix is `-2` (NOT `-1`), so the base handle is opaquely index-1 in the ordinal namespace."
patterns-established:
  - "MXID composition pattern for future pool-picked identity types: (a) name POOL_NAME_RE gate → throw mxid_name_not_pool_shape (silent-fallback signal), (b) role ROLE_NAME_RE gate → throw mxid_role_malformed (loud-failure signal), (c) PascalCase composition, (d) opaque ordinal iteration via injected countFn. Testable in isolation; call sites gate on opts.<flag> === true."
  - "In-runStep derivation for Q2 no-rollback preservation: any pre-step-work that needs step-attribution (auth token mint, MXID derivation, config resolution) lands INSIDE the step's runStep closure before the primary work — failures propagate through the same catch as the primary work and attribute cleanly."
  - "Backward-compat gate for orchestrator behavior changes: gate new derivation branch on an optional flag (poolPicked?: boolean) with false-y default; existing callers (retry route, legacy clients) automatically take the legacy branch without opt-in changes required."
requirements-completed: []
metrics:
  duration: "~20 min"
  started: "2026-09-06T14:24:57Z"
  completed: "2026-09-06T14:44:42Z"
tasks_completed: 2
tasks_total: 2
files_created: 1
files_modified: 3
---

# Phase 80 Plan 03b: MXID Handle-Format DIVERGE (A1 Lock) Summary

**Matrix account MXIDs for pool-picked identities become PascalCase-hyphenated `<PoolName>-<Role>[-N]` with silent server-side ordinal auto-suffix while identity folder keys stay lowercase — closes revision blocker 1 (MXID handle format + ordinal derivation) and preps blocker 2 (picker only needs to check the BASE handle since orchestrator owns MXID uniqueness end-to-end).**

## Performance

- **Duration:** 20 min
- **Started:** 2026-09-06T14:24:57Z
- **Completed:** 2026-09-06T14:44:42Z
- **Tasks:** 2 (both TDD: RED → GREEN)
- **Files:** 1 created + 3 modified

## Accomplishments

- **`composeMxidLocalpart(name, role): string`** — pure helper, PascalCase-hyphenated MXID localpart from pool name + role; throws `mxid_role_malformed` (loud) on invalid role, `mxid_name_not_pool_shape` (silent-fallback signal) on non-pool-shape name.
- **`deriveMxidWithOrdinal(baseHandle, serverName, countFn): Promise<string>`** — silent-auto-suffix ordinal iteration against injected countFn (wired to Synapse admin API in production); caps at `MXID_ORDINAL_MAX=100` and throws `mxid_ordinal_exhausted` on breach; propagates admin failures as `admin_count_failed: <error> (<status>)`.
- **`BirthOptions.poolPicked?: boolean`** — optional gate for the A1 DIVERGE branch; backward compatible (undefined ⇒ legacy `@<name>:<server>` shape).
- **`BirthDeps.matrixCountUsersMatching`** — new dep wired to plan 80-02's `countUsersMatching` primitive; called only when poolPicked === true.
- **Step 6 wiring** — runRelayMintAndWrite's Step 6 runStep now derives MXID via composeMxidLocalpart + deriveMxidWithOrdinal when poolPicked === true; catches `mxid_name_not_pool_shape` and falls back to legacy shape silently; all other exceptions (incl. `mxid_role_malformed` and `admin_count_failed`) propagate to fail Step 6 loudly.
- **HTTP handler wiring** — POST /identities/birth accepts + validates `poolPicked` as boolean-or-undefined; 400 with `"poolPicked must be a boolean"` on any other type; parsedPoolPicked tri-state (true/false/undefined) threaded through birthIdentity opts.
- **19 dedicated tests** in new `identity-birth-orchestrator.mxid-derivation.test.ts` covering all composeMxidLocalpart branches (a-h), all deriveMxidWithOrdinal branches (i-n), and 5 Step 6 integration cases (o-s) asserting end-to-end MXID observed by matrixCreateOrUpdateUser per gate branch.
- **4 new HTTP-handler tests** in `identity-birth.test.ts` (T-80-03b-birth-a..d) covering true/false/absent threading + non-boolean 400 validation; extended Test 5 to assert `d.matrixCountUsersMatching` is a function.

## Verification

- **Scoped tests:** 95 passing across 4 files
  - `identity-birth-orchestrator.mxid-derivation.test.ts`: 19/19 pass
  - `identity-birth.test.ts`: 16/16 pass
  - `identity-birth-orchestrator.test.ts`: 38/38 pass (no regressions)
  - `identity-birth-orchestrator.role-frontmatter.test.ts`: 22/22 pass (no regressions)
- **Filter checks:** `-t "Step 6"` → 5 passing; `-t "poolPicked"` → 4 passing
- **Typecheck:** `npx tsc --noEmit -p tsconfig.node.json` exits 0
- **Grep gates (all met):**
  - `export function composeMxidLocalpart` = 1 ✓
  - `export async function deriveMxidWithOrdinal` = 1 ✓
  - `poolPicked?: boolean` in orchestrator = 2 (BirthOptions + runRelayMintAndWrite opts) ≥ 1 ✓
  - `matrixCountUsersMatching` in orchestrator = 2 ≥ 1 ✓
  - `MXID_ORDINAL_MAX` in orchestrator = 5 ≥ 1 ✓
  - `mxid_role_malformed | mxid_name_not_pool_shape | mxid_ordinal_exhausted | admin_count_failed` in orchestrator = 16 ≥ 4 ✓
  - `opts.poolPicked` in orchestrator = 4 ≥ 1 ✓
  - `deriveMxidWithOrdinal(` call sites in orchestrator = 2 ≥ 1 ✓
  - `composeMxidLocalpart(` call sites in orchestrator = 6 ≥ 1 ✓
  - `mxid_name_not_pool_shape` in orchestrator = 6 ≥ 2 ✓
  - `poolPicked must be a boolean` in identity-birth.ts = 1 ✓
  - `matrixCountUsersMatching` in identity-birth.ts = 2 ≥ 1 ✓
  - `parsedPoolPicked` in identity-birth.ts = 3 ≥ 2 ✓
  - `const mxid = ` @` in orchestrator = 0 (was 1 pre-plan) ✓
  - `let mxid: string` in orchestrator = 1 ✓
  - `runStep(N)` total in orchestrator = 9 (matches baseline; no new numbered step) ✓
  - `await runStep(N)` in orchestrator = 6 (semantic invariant — call sites only) ✓
- **Q2 no-rollback preservation:** derivation lives inside Step 6's runStep; runStep call count baseline preserved.
- **Legacy compat:** case (q) integration test asserts poolPicked=undefined → matrixCreateOrUpdateUser receives `@willow:mock.homeserver.local` (legacy shape); matrixCountUsersMatching NOT called.
- **User-edited-name silent fallback:** case (r) integration test asserts poolPicked=true + name="my-custom" (fails POOL_NAME_RE) → matrixCreateOrUpdateUser receives `@my-custom:mock.homeserver.local`; matrixCountUsersMatching NOT called.
- **Admin-count failure attribution:** case (s) integration test asserts step:6:failed event with sanitized `admin_count_failed` reason + ended{ok:false, failedStep:6}; matrixCreateOrUpdateUser NOT called.

## Commits

| # | Task | Prefix | Hash | Files |
|---|------|--------|------|-------|
| 1 | Helpers + Step 6 wiring + dedicated test file | `feat(80-03b)` | `9f2ba0e4` | orchestrator.ts (+232) + mxid-derivation.test.ts (+484 new) |
| 2 | HTTP handler wiring + tests + tsc narrowing fix | `feat(80-03b)` | `2ddb104e` | orchestrator.ts (+7 fix) + identity-birth.ts (+32) + identity-birth.test.ts (+75) |

## Deviations from Plan

**1. [Rule 3 - Task ordering] Merged Task 2's orchestrator-side Step 6 wiring into Task 1's commit.**
- **Found during:** Task 1 RED phase (wrote helpers + test file).
- **Reason:** The Task 1 test file spec included 5 Step 6 integration cases (o-s) that require the runRelayMintAndWrite Step 6 wiring to pass. Splitting the wiring into Task 2 would have meant Task 1's RED phase couldn't produce a natural GREEN — cases o-s would still fail after "Task 1 complete". Committed helpers + wiring together in `9f2ba0e4` for coherence; Task 2's `2ddb104e` focused solely on the identity-birth.ts HTTP handler + its tests + the tsc narrowing fix (see Deviation 2). Plan's Task 2 action step already specified "Extend `identity-birth-orchestrator.mxid-derivation.test.ts` (created in Task 1) with a Step 6 integration describe block" — the integration tests were always co-located with Task 1's test file; only the commit boundary shifted.
- **Impact:** Two commits total, both with `feat(80-03b)` prefix. Zero functional impact; commit-history readability preserved (each commit is a coherent unit).

**2. [Rule 1 - Bug] tsc narrowing fix for `deriveMxidWithOrdinal`.**
- **Found during:** Post-Task-1 typecheck (`tsc --noEmit -p tsconfig.node.json`).
- **Issue:** `if (!result.ok)` on a discriminated union `{ ok: true; total: number } | { ok: false; status: number; error: string }` did NOT narrow to the ok:false branch under `tsconfig.node.json`'s strict setup — tsc reported `TS2339: Property 'error' does not exist on type '{ ok: true; total: number; }'` at the throw expression.
- **Fix:** Switched to `if (result.ok === false)` — the explicit `=== false` pattern that already exists at Step 6's `mintResult` / `loginResult` guards (`identity-birth-orchestrator.ts` L677+). Added a code comment cross-referencing the existing precedent.
- **Files modified:** `src/backend/database/routes/identity-birth-orchestrator.ts` (single line + comment)
- **Commit:** `2ddb104e` (folded into Task 2's commit since both are trivial post-Task-1 corrections)

## Threat Register Delta (from PLAN threat_model)

| Threat ID | Status | Notes |
|-----------|--------|-------|
| T-80-03b-01 (malformed role → malformed MXID) | ✓ Mitigated | ROLE_NAME_RE gate in composeMxidLocalpart throws mxid_role_malformed. Cases (d/e/f) test all three malformed shapes: uppercase, leading-digit, empty-segment. |
| T-80-03b-02 (attacker exhausts ordinals) | ✓ Accepted per plan | MXID_ORDINAL_MAX=100 cap enforced; case (l) tests the exhaustion path — countFn called exactly 100 times, throws mxid_ordinal_exhausted. |
| T-80-03b-03 (admin token leak via error path) | ✓ Mitigated | admin_count_failed error string composed as `<error> (<status>)` where <error> is one of the fixed error-tag strings from matrix-admin-client (ERR_CREDS_MISSING / ERR_NON_2XX / ERR_TIMEOUT / ERR_PROXY / ERR_NO_TOKEN). No bearer token or upstream body ever surfaces. |
| T-80-03b-04 (poolPicked=true but name off-shape → silent malformed MXID) | ✓ Mitigated | composeMxidLocalpart throws mxid_name_not_pool_shape; Step 6 catches this specific error tag and falls back to legacy `@<name>:<server>`. Case (r) verifies. |
| T-80-03b-05 (attacker sets poolPicked=true to reroute existing identity) | ✓ Accepted per plan | poolPicked only affects new mints (Step 6 runs during birth); identity-name collision gated at Step 1 (folder existence check). No Phase-80 change to existing identities. |
| T-80-03b-06 (concurrent births race for same ordinal) | ✓ Accepted per plan | Skynet is single-user single-process; concurrent births serialized upstream. Race → Step 6 admin-mint 409 with existing attribution. |
| T-80-03b-07 (Q2 no-rollback invariant violated by new SSE step) | ✓ Mitigated | Derivation lives INSIDE existing Step 6 runStep; grep gate confirms runStep call count baseline (9 total / 6 await runStep) preserved. Case (s) confirms failure inside derivation attributes to step 6 via sanitizeError. |

## Known Stubs

None — this plan lands complete Skynet-side backend derivation logic. The frontend wiring (`poolPicked=true` set by NewSessionDialog when the name field was pool-prefilled) is scoped to plan 80-06 per the plan spec.

## Self-Check: PASSED

- ✓ `src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts` exists
- ✓ `src/backend/database/routes/identity-birth-orchestrator.ts` modified
- ✓ `src/backend/database/routes/identity-birth.ts` modified
- ✓ `src/backend/database/routes/identity-birth.test.ts` modified
- ✓ Commit `9f2ba0e4` exists in `git log --oneline`
- ✓ Commit `2ddb104e` exists in `git log --oneline`
- ✓ All 19 mxid-derivation.test.ts cases pass
- ✓ All 16 identity-birth.test.ts cases pass (4 new + 12 pre-existing)
- ✓ All 60 pre-existing orchestrator tests pass (no regressions)
- ✓ tsc --noEmit exits 0
- ✓ runStep(N) baseline preserved (9 total / 6 await)
