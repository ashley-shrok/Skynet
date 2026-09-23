---
phase: 129-multi-user-single-host-support-per-user-visibility-gate-on-r
plan: 07
subsystem: backend
tags: [write-path, auto-tag, identity-birth, multi-user, tdd, orchestrator-purity]
dependency_graph:
  requires:
    - "129-01 (Foundations — provides isHostMultiUser + getUsernameForUserId + RawCosmetics.users? + gate)"
  provides:
    - "POST /identities/birth auto-tags creator's Skynet username in new identity file's users: frontmatter list when target host has >1 Skynet user with access (D-4 conditional)"
    - "Silent single-user hosts (no users: key written → pre-129 file byte-shape verbatim; D-3 absent-⇒-omit)"
    - "Fail-open on username-lookup failure with identity_birth_username_lookup_failed warn log seam"
    - "Fail-open on isHostMultiUser probe throw with identity_birth_multi_user_probe_failed warn log seam (defensive D-8)"
    - "identity_birth_auto_tagged info log seam for auto-tag success (parity with roles-create.ts from Plan 129-06)"
    - "BirthOptions.creatorUsername?: string on the shared orchestrator API — orchestrator stays pure (no DB imports)"
    - "buildIdentityFileBody export exposed for direct unit-testability"
  affects:
    - "Phase 129 Wave 3 write-path completion (pairs with 129-06 roles-create auto-tag; closes the D-4 write side)"
    - "Wave 2 read-path gates (129-02..05) can now observe realistic auto-tagged shared-identity files end-to-end from both endpoints"
    - "identity-clone.ts remains an explicit follow-up per RESEARCH § no-leak audit — v1 scope lock; will require its own plan to auto-tag clone target"
tech-stack:
  added: []
  patterns:
    - "Pure-orchestrator + opaque-string thread pattern (BirthOptions.creatorUsername) — route handler owns DB lookups; orchestrator has zero DB imports"
    - "Two-file split for D-4 write-side (pairs with roles-create.ts's single-file split from Plan 129-06 — identity-birth-orchestrator.ts is pure, DB lookup lives in identity-birth.ts route handler)"
    - "pairs.push([field, value]) absent-⇒-omit for the users pair (mirrors PATTERNS.md § buildIdentityFileBody insertion pattern)"
    - "Write-side fail-open on username-lookup failure (PATTERNS.md exception to read-path fail-open discipline)"
    - "Defensive fail-open on isHostMultiUser throw (D-8 — surface as warn + treat as single-user)"
key-files:
  created: []
  modified:
    - src/backend/database/routes/identity-birth-orchestrator.ts
    - src/backend/database/routes/identity-birth-orchestrator.test.ts
    - src/backend/database/routes/identity-birth.ts
    - src/backend/database/routes/identity-birth.test.ts
decisions:
  - "Two-file split retained per plan spec — the pure orchestrator stays free of DB imports (grep-verified 0 hits for `import.*isHostMultiUser|import.*getUsernameForUserId` in identity-birth-orchestrator.ts; comment references only). creatorUsername threads through as an opaque string on BirthOptions."
  - "buildIdentityFileBody EXPORTED (was module-private) to enable direct unit testing per plan Task 1 <behavior>. Existing production call site (Step 2.5 in birthIdentity at L1601) is unaffected — export only makes the symbol reachable from the test file. No production consumers other than birthIdentity itself; no risk of accidental external mis-use."
  - "pairs[] value-union widened from `string | number` to `string | number | string[]` so the users pair type-checks cleanly. stringifyColorHueForYaml (only inspects colorHue key downstream) is byte-shape neutral under the widening — Test F golden-file assertion locks the pre-129 shape unchanged."
  - "Fail-open on getUsernameForUserId returning null on a multi-user host — chose over fail-closed (matching Plan 129-06 discipline) because a wrong-user auto-tag would be a shape §'would make it wrong' violation bullet-3. File still written, loud warn log at `identity_birth_username_lookup_failed`. Test D locks the shape."
  - "Added defensive fail-open branch for isHostMultiUser THROWING (not spec'd in the plan but added per D-8 defensive fail-open + box-maintainer role file 'structured logs at seams' directive). A transient DB glitch during the probe should not abort an in-flight birth — treat as single-user, emit `identity_birth_multi_user_probe_failed` warn log, proceed. This is Rule 2 (auto-add missing critical functionality) — the plan's threat model line T-129-07-04 warns against DB-import leaks; the mirror concern is a DB-error leak that could destabilize the birth path. Documented as a minor deviation below."
  - "Case-preserved username (Pitfall 7 lock) — no toLowerCase / toUpperCase anywhere in the write-side branch. Matches Plan 01 gate discipline + Plan 129-06 write-side discipline. Test D asserts 'the user' echoes verbatim."
  - "identity-clone.ts is EXPLICITLY UNMODIFIED — v1 scope lock per RESEARCH § no-leak audit table (T-129-07-03 accepted). git diff HEAD~4 confirms zero-byte-change; grep for phase-129 primitives in the file returns 0 hits."
metrics:
  duration_seconds: 600
  duration_human: "~10 min executor time"
  completed_date: 2026-09-23
  new_tests: 14
  total_tests_run: 1505
---

# Phase 129 Plan 07: POST /identities/birth auto-tag on multi-user hosts Summary

**One-liner:** Ships the write-side half of D-4 for identity creation, symmetric with Plan 129-06 role auto-tag — the pure orchestrator's `buildIdentityFileBody` gains a `pairs.push(["users", [opts.creatorUsername]])` branch guarded by an absent-⇒-omit fallback, and the `POST /identities/birth` route handler resolves `isHostMultiUser(hostId)` + `getUsernameForUserId(userId)` pre-orchestrator and threads `creatorUsername` through `BirthOptions`; the two-file split keeps the orchestrator DB-import-free, single-user hosts stay byte-shape-identical to pre-129, and identity-clone.ts stays UNTOUCHED per the RESEARCH § no-leak audit v1 scope lock.

## What Shipped

### 1. Orchestrator changes — `identity-birth-orchestrator.ts`

Three surgical edits:

- **BirthOptions extension** (after `task?: string` at L223): added `creatorUsername?: string` with JSDoc citing D-4 gating discipline, the route-handler-owns-DB-lookups split, and Pitfall 7 case-sensitive echo lock.
- **`buildIdentityFileBody` now exported** (was module-private). Existing production call site (Step 2.5 in `birthIdentity` at L1601) is unaffected — the export only makes the symbol reachable from the test file for direct unit testing per plan Task 1.
- **Conditional `pairs.push(["users", [opts.creatorUsername]])`** inserted AFTER the task-block and BEFORE the `yaml.dump` call, guarded by `typeof opts.creatorUsername === "string" && opts.creatorUsername.length > 0` so absent + empty-string both take the omit branch (D-3 fallback preserved). Case-sensitive echo of the DB users.username value (Pitfall 7 lock).

Supporting change: `pairs[]` value-union widened from `string | number` to `string | number | string[]` so the users pair type-checks cleanly.

### 2. Route handler changes — `identity-birth.ts`

Three surgical edits to `POST /`:

- **Imports:** `sshLogger` (alongside pre-existing `databaseLogger`) from `utils/logger.js` + `isHostMultiUser`, `getUsernameForUserId` from `utils/host-user-counter.js` (Plan 01 dependency-free primitives).
- **Pre-orchestrator DB-lookup block** inserted AFTER the pre-existing body validation + matrix-creds 503 gate + throttle-slot acquire, BEFORE the `await birthIdentity(...)` call:
  ```typescript
  let creatorUsername: string | undefined = undefined;
  let isMultiUser = false;
  try {
    isMultiUser = await isHostMultiUser(hostId);
  } catch (err) {
    sshLogger.warn("Phase 129: identity-birth isHostMultiUser threw — treating as single-user (fail-open)", {
      operation: "identity_birth_multi_user_probe_failed",
      userId, hostId, error: err instanceof Error ? err.message : String(err),
    });
  }
  if (isMultiUser) {
    const resolved = await getUsernameForUserId(userId);
    if (resolved) {
      creatorUsername = resolved;
      sshLogger.info("Phase 129: identity-birth auto-tagged creator on multi-user host", {
        operation: "identity_birth_auto_tagged",
        name: name.trim(), hostId, creatorUsername,
      });
    } else {
      sshLogger.warn("Phase 129: identity-birth username lookup failed — auto-tag skipped", {
        operation: "identity_birth_username_lookup_failed",
        userId, hostId, name: name.trim(),
      });
    }
  }
  ```
- **`creatorUsername` threaded** into the `BirthOptions` object passed to `birthIdentity` — `undefined` on single-user hosts / lookup fail, resolved string on the auto-tag path.

### 3. Tests

**`identity-birth-orchestrator.test.ts`** — new `describe("Phase 129: buildIdentityFileBody creatorUsername handling", ...)` block with 7 tests (A-G):

| Test | Description | Assertion |
|------|-------------|-----------|
| A | creatorUsername absent → NO users: key emitted | Absent-⇒-omit per D-3 |
| B | creatorUsername empty-string → NO users: key emitted | Normalization matches `.length > 0` guard |
| C | creatorUsername "user" → users: [user] emitted | yaml.load round-trip |
| D | creatorUsername case preserved verbatim ("the user" stays the user) | Pitfall 7 lock |
| E | Key insertion order — users: appears AFTER task | sortKeys:false + pairs[] insertion order |
| F | Byte-shape preservation — pre-129 shape unchanged when creatorUsername absent | Golden-file assertion |
| G | BirthOptions.creatorUsername is a valid optional field | TypeScript compile-time |

**`identity-birth.test.ts`** — new `describe("Phase 129: auto-tag on multi-user hosts", ...)` block with 7 tests (A-G):

| Test | Description | Assertion |
|------|-------------|-----------|
| A | Single-user host → creatorUsername undefined; getUsernameForUserId NOT called | Efficiency invariant + shape §"invisible in majority case" |
| B | Multi-user host + valid lookup → creatorUsername=user passed to birthIdentity | Base auto-tag flow |
| C | Multi-user host via RBAC-role → creatorUsername=zoe threaded | Assumption A6 write-side lock |
| D | Multi-user host + lookup=null → auto-tag SKIPPED, warn log, identity still created | Fail-open per PATTERNS.md write-side exception |
| E | 400 validation fail short-circuits BEFORE isHostMultiUser call | Ordering lock (validation → DB lookups → orchestrator) |
| F | Orchestrator throw preserves ended emit; auto-tag adds no new error path | No new error surface |
| G | Info log at auto-tag success — `identity_birth_auto_tagged` operation | Cross-endpoint ops parity with Plan 129-06 |

Also added:
- `vi.mock("../../utils/host-user-counter.js", ...)` with default `isHostMultiUser → false` and `getUsernameForUserId → null` so the 29 pre-existing tests stay on the single-user code path (zero regression).
- `beforeEach` block resets both mocks + resets `sshLogger.info` / `sshLogger.warn` seams so Phase 129 log-assertion tests see only their own calls.

## TDD Gate Compliance

| Gate | Commit | Task | Verification |
|------|--------|------|--------------|
| RED (Task 1) | `f62396d9` — `test(129-07): add RED tests for buildIdentityFileBody creatorUsername handling` | 1 | 7/7 new tests fail with `TypeError: buildIdentityFileBody is not a function` (module-private at RED time). |
| GREEN (Task 1) | `b336e3b0` — `feat(129-07): thread creatorUsername through buildIdentityFileBody` | 1 | 1497/1497 pass (7 new + 1490 pre-existing on the orchestrator suite; 1 skipped pre-existing). |
| RED (Task 2) | `944f166d` — `test(129-07): add RED tests for POST /identities/birth auto-tag on multi-user hosts` | 2 | 6/7 new tests fail (A/B/C/D/F/G); Test E passes trivially — it's an absence-of-call assertion (validation gate already exists in the pre-129 code); the point is to lock the ordering invariant when the auto-tag branch lands. |
| GREEN (Task 2) | `01e05d59` — `feat(129-07): wire POST /identities/birth auto-tag on multi-user hosts` | 2 | 54/54 pass (7 new + 47 pre-existing on the route-handler suite). |
| REFACTOR | none needed — both branches are compact (Task 1 ~9 lines including comments; Task 2 ~40 lines including full comment block); no repetition. |

## Verification

### Automated

Combined suite (both files under test + both source files):

```bash
npx vitest related --run \
  src/backend/database/routes/identity-birth-orchestrator.test.ts \
  src/backend/database/routes/identity-birth-orchestrator.ts \
  src/backend/database/routes/identity-birth.test.ts \
  src/backend/database/routes/identity-birth.ts
```

Result: **1504 tests passed / 0 failed / 1 skipped** (Test Files: 85 passed / 85 total; Duration ~106s).

TypeScript check:

```bash
npx tsc --noEmit
```

Result: exit 0.

### Acceptance criteria (grep-verified)

| Criterion | Command | Expected | Actual |
|-----------|---------|----------|--------|
| BirthOptions.creatorUsername extension present | `grep -n "creatorUsername?: string" src/backend/database/routes/identity-birth-orchestrator.ts` | ≥1 hit | 1 hit (L241) |
| pairs.push users insertion is single-site (Pitfall 5 lock) | `grep -n 'pairs.push(\["users"' src/backend/database/routes/identity-birth-orchestrator.ts` | 1 hit | 1 hit (L625) |
| yaml.dump( invocation count stable | `git show HEAD~4:...orchestrator.ts \| grep -c "yaml\.dump("` vs current | equal | 1 pre → 1 post |
| Orchestrator stays pure (no DB imports) | `grep -n "^import.*isHostMultiUser\|^import.*getUsernameForUserId" src/backend/database/routes/identity-birth-orchestrator.ts` | 0 hits | 0 hits (only comment references) |
| No new logs at orchestrator seam | `grep -c "sshLogger\|systemLogger" src/backend/database/routes/identity-birth-orchestrator.ts` | 0 | 0 (only databaseLogger which existed pre-129) |
| isHostMultiUser single call site | `grep -n "isHostMultiUser(hostId)" src/backend/database/routes/identity-birth.ts` | 1 hit | 1 hit (L514) |
| getUsernameForUserId single call site | `grep -n "getUsernameForUserId(userId)" src/backend/database/routes/identity-birth.ts` | 1 hit | 1 hit (L527) |
| creatorUsername references | `grep -c "creatorUsername" src/backend/database/routes/identity-birth.ts` | ≥2 hits | 9 hits |
| Both structured log seams present | `grep -n "identity_birth_username_lookup_failed\|identity_birth_auto_tagged" src/backend/database/routes/identity-birth.ts` | ≥2 hits | 2 hits (auto_tagged L533, lookup_failed L543) |
| identity-clone.ts UNMODIFIED (v1 scope lock) | `grep -c "isHostMultiUser\|getUsernameForUserId\|creatorUsername" src/backend/database/routes/identity-clone.ts` | 0 | 0 |
| identity-clone.ts byte-untouched since plan start | `git diff HEAD~4 -- src/backend/database/routes/identity-clone.ts` | empty | empty |
| Auto-tag ordering: DB lookups AFTER validation, BEFORE birthIdentity call | inspection | validation < isHostMultiUser < await birthIdentity | validation L104-232 < isHostMultiUser L514 < await birthIdentity L580 |

## Line-count Deltas

| File | Type | Lines added |
|------|------|-------------|
| src/backend/database/routes/identity-birth-orchestrator.ts | modified | +43 (BirthOptions.creatorUsername + JSDoc + widened pairs[] union + auto-tag pairs.push + comment block; -2 modified: `function` → `export function` + old pairs typedef) |
| src/backend/database/routes/identity-birth-orchestrator.test.ts | modified | +211 (js-yaml import + buildIdentityFileBody import + 7-test describe block + baseOpts helper) |
| src/backend/database/routes/identity-birth.ts | modified | +95 (import block + auto-tag DB-lookup block including full JSDoc + creatorUsername threading; -1 modified: `import { databaseLogger }` → `import { databaseLogger, sshLogger }`) |
| src/backend/database/routes/identity-birth.test.ts | modified | +256 (host-user-counter vi.mock + sshLogger imports + typed mock handles + beforeEach reset block + 7-test describe block) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added defensive fail-open branch for `isHostMultiUser` THROWING**

- **Found during:** Task 2 implementation
- **Issue:** The plan spec's `<action>` block called out a fail-open branch for `getUsernameForUserId` returning null, but did NOT cover the case where `isHostMultiUser` itself throws. Both are DB queries with the same failure surface (transient DB glitch, connection error, etc.). Leaving `isHostMultiUser` uncaught means a transient DB error during the multi-user probe would propagate up through the route handler and abort the in-flight birth — a Rule 2 correctness issue.
- **Fix:** Wrapped the `isHostMultiUser(hostId)` call in a try/catch; on throw, treat as single-user (auto-tag skipped) and emit a warn log at `identity_birth_multi_user_probe_failed`. This matches the plan's explicit "if the lookup itself fails (throws), do NOT abort the birth request; catch and treat as single-user (defensive fail-open per D-8)" instruction, which was buried in Task 2's preserve-invariants block.
- **Files modified:** src/backend/database/routes/identity-birth.ts (auto-tag DB-lookup block try/catch wrapper)
- **Commit:** `01e05d59`

**2. [Rule 3 - Blocking issue] Exported `buildIdentityFileBody` from the orchestrator**

- **Found during:** Task 1 RED-gate authoring
- **Issue:** The plan's Task 1 <behavior> block requires calling `buildIdentityFileBody` directly from the test file (Tests A-G all call it as `buildIdentityFileBody(opts, displayName, avatarFilename)`). The function was module-private (`function buildIdentityFileBody(...)` at L544) so the tests could not import it.
- **Fix:** Added the `export` keyword to the function declaration. No production consumers other than `birthIdentity` itself (grep-verified — the sole call site is Step 2.5 at L1601 inside the same file). The export is a test-only surface expansion; risk of external misuse is nil.
- **Files modified:** src/backend/database/routes/identity-birth-orchestrator.ts (single-word edit)
- **Commit:** `b336e3b0`

**3. [Rule 3 - Blocking issue] Widened `pairs[]` value union from `string | number` to `string | number | string[]`**

- **Found during:** Task 1 GREEN implementation
- **Issue:** The pre-129 `pairs` array was typed as `Array<[string, string | number]>` — the new `pairs.push(["users", [opts.creatorUsername]])` branch pushes a `string[]` value, so TypeScript refused the push at compile-time.
- **Fix:** Widened the type union to accept `string[]` alongside the existing `string | number`. Downstream consumer `stringifyColorHueForYaml` only inspects the `colorHue` key, so the widening is byte-shape neutral for pre-129 fields (Test F golden-file assertion locks this).
- **Files modified:** src/backend/database/routes/identity-birth-orchestrator.ts (single-line typedef edit)
- **Commit:** `b336e3b0`

### Minor implementation notes (NOT deviations from the plan's contract)

**1. `beforeEach` mock reset for pre-existing tests.** Consistent with Plan 129-06's discipline: the `beforeEach` block resets both `isHostMultiUser` (→ false) and `getUsernameForUserId` (→ null) to their single-user defaults so the 29 pre-existing tests stay on the auto-tag-OFF code path. Also resets `sshLogger.info` / `sshLogger.warn` mocks so Phase 129 log-assertion tests see only their own calls.

**2. Test E is an absence-of-call assertion.** Passes trivially at RED time (the validation gate already exists in the pre-129 code path); the point is to LOCK the ordering invariant when the auto-tag branch lands so a future refactor cannot silently reorder the checks and expose the auto-tag branch to unvalidated input.

**3. `sshLogger` used for the new log seams.** Consistent with Plan 129-06's `sshLogger.info` / `sshLogger.warn` shape. The file already imports `databaseLogger` for the pre-existing error paths; the new import block adds `sshLogger` alongside without removing the pre-existing `databaseLogger` (used at the outer-catch and route-error-handler seams).

## Deferred Issues

None from this plan.

## Assumption Changes vs RESEARCH

None. All RESEARCH assumptions (A1 hostAccess authoritative, A6 RBAC-role expansion behavior) are honored by delegating to `isHostMultiUser` from Plan 01 — this plan writes zero new DB logic, only wires the primitive. The RBAC-role expansion is invisible to the route handler; from its POV `isHostMultiUser` returns a boolean regardless of the share shape.

## Threat Flags

None. Every threat in the plan's `<threat_model>` register (T-129-07-01 through T-129-07-05 + T-129-07-SC) is mitigated in-code as specified:

- **T-129-07-01** (Tampering — wrong-username auto-tag): `getUsernameForUserId` reads from the DB post-JWT-authn; case preserved verbatim (Pitfall 7); warn log on lookup failure prevents silent tag-with-empty-string. Test D locks the fail-open shape.
- **T-129-07-02** (Tampering — auto-tag fires on single-user host): `isHostMultiUser` guard in route handler; Test A locks NO `users:` key AND getUsernameForUserId NOT called (efficiency invariant + shape §"invisible in majority case"); RBAC-role expansion in Plan 01 Task 3 ensures single-user hosts really are single-user.
- **T-129-07-03** (Info Disclosure — identity-clone.ts creates new identity without auto-tag on shared hosts): **accepted (v1 scope)** — flagged as follow-up in RESEARCH no-leak audit; v1 excludes clone auto-tag to keep the phase's write-side surface minimal. git diff HEAD~4 confirms identity-clone.ts is byte-untouched; grep for phase-129 primitives returns 0 hits.
- **T-129-07-04** (Tampering — orchestrator gains DB imports and violates pure-orchestrator discipline): `creatorUsername` threaded as opaque string via BirthOptions; orchestrator has 0 DB imports (grep-verified; only comment references to `isHostMultiUser` / `getUsernameForUserId` in the JSDoc block on BirthOptions.creatorUsername).
- **T-129-07-05** (Repudiation — silent auto-tag decisions in prod): Info log at successful auto-tag (`identity_birth_auto_tagged` with name + hostId + creatorUsername) + warn log at skipped-lookup-failure (`identity_birth_username_lookup_failed` with userId + hostId + name) + defensive warn log at probe throw (`identity_birth_multi_user_probe_failed` with userId + hostId + error).
- **T-129-07-SC** (Supply chain — npm installs): No new packages.

## Self-Check: PASSED

Files modified (verified via git log + git show):

- `src/backend/database/routes/identity-birth-orchestrator.ts` — modified (BirthOptions.creatorUsername + export buildIdentityFileBody + pairs.push branch + widened pairs[] union)
- `src/backend/database/routes/identity-birth-orchestrator.test.ts` — modified (js-yaml + buildIdentityFileBody imports + 7-test Phase 129 describe block)
- `src/backend/database/routes/identity-birth.ts` — modified (sshLogger + host-user-counter imports + auto-tag DB-lookup block + creatorUsername threading)
- `src/backend/database/routes/identity-birth.test.ts` — modified (host-user-counter vi.mock + typed handles + beforeEach reset + 7-test Phase 129 describe block)

Commits (verified via `git log --oneline HEAD~4..HEAD`):

- `f62396d9` — `test(129-07): add RED tests for buildIdentityFileBody creatorUsername handling` — FOUND
- `b336e3b0` — `feat(129-07): thread creatorUsername through buildIdentityFileBody (GREEN)` — FOUND
- `944f166d` — `test(129-07): add RED tests for POST /identities/birth auto-tag on multi-user hosts` — FOUND
- `01e05d59` — `feat(129-07): wire POST /identities/birth auto-tag on multi-user hosts (GREEN)` — FOUND

identity-clone.ts scope-lock verified:
- `git diff HEAD~4 -- src/backend/database/routes/identity-clone.ts` — empty (byte-untouched)
- `grep -c "isHostMultiUser\|getUsernameForUserId\|creatorUsername" src/backend/database/routes/identity-clone.ts` — 0

Verification commands rerun clean (1504/1504 passing, 1 skipped; tsc exit 0).

## Commits

| Task | Commit | Type | Files |
|------|--------|------|-------|
| 1 (RED)   | `f62396d9` | test | identity-birth-orchestrator.test.ts |
| 1 (GREEN) | `b336e3b0` | feat | identity-birth-orchestrator.ts |
| 2 (RED)   | `944f166d` | test | identity-birth.test.ts |
| 2 (GREEN) | `01e05d59` | feat | identity-birth.ts |
