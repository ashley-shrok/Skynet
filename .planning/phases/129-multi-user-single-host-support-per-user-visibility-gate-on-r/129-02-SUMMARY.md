---
phase: 129-multi-user-single-host-support-per-user-visibility-gate-on-r
plan: 02
subsystem: backend
tags: [gate, deep-gate-seam, tdd, wave-2, identities-endpoint]
dependency_graph:
  requires:
    - "129-01 (isIdentityVisibleToUser pure gate + getUsernameForUserId DB helper + RawCosmetics.users?)"
  provides:
    - "GET /identities is now per-user filtered — the primary sidebar surface (D-7 deep-gate seam #1 of 4)"
  affects:
    - "Every downstream frontend consumer of GET /identities (conversation-store.ts sidebar joins) sees per-user rows"
    - "Wave 2 siblings 129-03 (session-list), 129-04 (roles-list-for-host role picker), 129-05 (WS frames / search) still needed to close the remaining D-7 surfaces"
tech-stack:
  added: []
  patterns:
    - "Per-request memo discipline for callerUsername (one DB lookup per request, mirrors the per-host roleReadCache pattern this file already uses)"
    - "vi.hoisted for mocks that need to survive vi.mock's factory-hoisting (systemLogger + host-user-counter)"
    - "Sibling-test surgical mock-extension for transitive drizzle-orm imports (channel-cap + disk-read + put-disk each added a two-line mock rather than expanding their drizzle-orm mock)"
key-files:
  created: []
  modified:
    - src/backend/database/routes/identities.ts
    - src/backend/database/routes/identities.get-disk.test.ts
    - src/backend/database/routes/identities.channel-cap.test.ts
    - src/backend/database/routes/identities.disk-read.test.ts
    - src/backend/database/routes/identities.put-disk.test.ts
decisions:
  - "Gate call site placed AFTER cosmetics + roleCosmetics extraction but BEFORE publicIdentity — the hidden row is never constructed, matching the D-7 deep-gate contract (no stripped-down ghost). Return-null collapses onto the existing L450 null-filter with zero shape change."
  - "callerUsername === null (unknown / orphaned userId) DISABLES the gate (fall-open) rather than emptying the sidebar. Locked by D-8: this is a visibility filter, not a permission system. Structured warn log fires so ops can trace the mismatch."
  - "Sibling test files (channel-cap, disk-read, put-disk) stub the two new gate modules directly rather than extending their drizzle-orm mock — the gate has its own coverage in identities.get-disk.test.ts's Phase 129 describe block, and the sibling suites should stay scoped to what they test (channel counting / .pinned probing / PUT disk-write)."
  - "Test A strengthened to assert getUsernameForUserId is called EXACTLY ONCE (per-request-cost discipline lock at the wire). Test B strengthened to assert two requests fire two lookups (no cross-request cache — would be a critical bug)."
metrics:
  duration_seconds: ~360
  duration_human: "~6 min executor time"
  completed_date: 2026-09-23
  new_tests: 7
  total_tests_run: 83
  test_files_touched: 5
  source_files_modified: 1
---

# Phase 129 Plan 02: Per-user visibility gate on GET /identities Summary

**One-liner:** Wires the Phase 129 D-2 intersection gate into
`GET /identities`'s fanout — every fresh sidebar mount now filters
identities against the caller's Skynet username, hidden rows produce zero
evidence in the response, and the per-request username lookup happens
exactly once per request via `getUsernameForUserId` (shipped 129-01).

## What Shipped

### GET /identities per-user gating (D-7 deep-gate seam #1 of 4)

Two coordinated edits in `identities.ts` L294-500:

**1. Per-request callerUsername fetch** (L330-336):

```typescript
const callerUsername = await getUsernameForUserId(userId);
if (callerUsername === null) {
  systemLogger.warn(
    "Phase 129: GET /identities callerUsername lookup failed — gate disabled for this request",
    { operation: "identities_gate_username_missing", userId },
  );
}
```

- Runs EXACTLY ONCE per request (before the per-host fanout — not inside
  `identityKeys.map`, not inside the outer Promise.all). Matches this
  file's per-request-cost discipline: the per-host `roleReadCache` memo
  further down enforces the same one-lookup-per-host-per-request rule for
  role frontmatter reads.
- `callerUsername === null` (orphaned JWT with no `users` row — shape-
  violation but MUST NOT throw) does NOT abort the request. Per D-8 the
  gate is a visibility filter, not a permission system; the null value
  short-circuits `isIdentityVisibleToUser` to `true` (Plan 129-01 Task 2
  Test 1) so the caller still sees whatever their host-access predicate
  allows.
- Structured `systemLogger.warn` fires with `operation:"identities_gate_username_missing"` + `{userId}` so ops can grep the mismatch in
  prod. Box-maintainer directive satisfied: gate-seam decisions are
  traceable in `systemLogger` output.

**2. Per-identity gate inside `identityKeys.map`** (L474-491):

```typescript
if (
  !isIdentityVisibleToUser(cosmetics, roleCosmetics, callerUsername)
) {
  systemLogger.debug(
    "Phase 129: identity hidden by visibility gate",
    { operation: "identities_gate_hidden", identityKey, hostId, callerUsername },
  );
  return null;
}
```

- Placed AFTER `cosmetics` (from `extractCosmeticsFromFrontmatter`) and
  `roleCosmetics` (from the memoized `readRoleCosmeticsMemoized`) are
  resolved, so both sides of the D-2 intersection are available.
- Placed BEFORE `publicIdentity(...)` so the row is NEVER constructed
  when hidden — no stripped cosmetics, no ghost (T-129-02-02 mitigated
  in-code).
- `return null` collapses onto the existing L450
  `.filter((x): x is ... => x !== null)` — no new filter, no shape
  change (T-129-02-01 mitigated in-code).
- `debug`-level log with `operation:"identities_gate_hidden"` +
  `{identityKey, hostId, callerUsername}` so a "why don't I see this
  identity?" bug is traceable from logs alone (T-129-02-04 mitigated).

**3. Import discipline preserved:**

`resolveIdentityAppearance` count unchanged (still 3 mentions in
identities.ts, all pre-existing). The gate lives OUTSIDE the
`resolveIdentityAppearance` cascade — Phase 111 T-111-08 one-cascade-
authority invariant preserved (Plan 129-01 design lock).

## Final Signatures (call sites)

```typescript
// src/backend/database/routes/identities.ts L330
const callerUsername = await getUsernameForUserId(userId);
// null → systemLogger.warn identities_gate_username_missing

// src/backend/database/routes/identities.ts L478
if (!isIdentityVisibleToUser(cosmetics, roleCosmetics, callerUsername)) {
  // systemLogger.debug identities_gate_hidden
  return null;
}
```

Both imports added at the top of the file:

```typescript
import { databaseLogger, systemLogger } from "../../utils/logger.js";
import { isIdentityVisibleToUser } from "../../fleet-status/identity-visibility-gate.js";
import { getUsernameForUserId } from "../../utils/host-user-counter.js";
```

## Tests

- **7 net-new tests** in a new `describe("Phase 129: per-user visibility gate", ...)` block in `identities.get-disk.test.ts`.
- **RED → GREEN cycle verified:** on Task 1 commit, `npx vitest related --run` reported `7 failed | 31 passed`. On Task 2 commit, the same command reported `38 passed | 0 failed` for that file, and `83 passed` across all 5 sibling test files that transitively import identities.ts.

| # | Test | Coverage | RED | GREEN |
|---|------|----------|-----|-------|
| A | Single-user host, no `users` key | Zero regression + per-request-cost lock (getUsernameForUserId called EXACTLY once with the caller's uid) | fail | pass |
| B | Multi-user host, no `users` key | D-3 fallback = both users see it + no cross-request caching (each request re-fetches its callerUsername) | fail | pass |
| C | Identity `users:[ashley]` | D-2 identity-side gate: Ashley sees it, Zoe gets ZERO rows (D-7 no ghost) | fail | pass |
| D | Role `users:[ashley]` (identity untagged) | D-2 role-side gate: Zoe gets zero rows even though her host access is fine | fail | pass |
| E | Role `users:[ashley,zoe]` + identity `users:[ashley]` | D-2 intersection: identity is narrower, Zoe loses | fail | pass |
| F | `getUsernameForUserId` returns null | D-8 fail-open: gate is DISABLED (identity still surfaces despite `users:[ashley]`) + `identities_gate_username_missing` warn fires | fail | pass |
| G | Identity file read throws mid-fanout | Existing pre-129 null-drop contract preserved: broken row is dropped by the pre-existing warn+null-return path, NOT converted to false-positive visibility | fail | pass |

**Verification commands:**

```bash
# Primary: target test file + module under change
npx vitest related --run \
  src/backend/database/routes/identities.get-disk.test.ts \
  src/backend/database/routes/identities.ts

# Sibling regression check (three files got surgical mock extensions)
npx vitest related --run \
  src/backend/database/routes/identities.get-disk.test.ts \
  src/backend/database/routes/identities.channel-cap.test.ts \
  src/backend/database/routes/identities.disk-read.test.ts \
  src/backend/database/routes/identities.put-disk.test.ts

# Plan 129-01 primitives regression check
npx vitest related --run \
  src/backend/fleet-status/identity-visibility-gate.test.ts \
  src/backend/utils/host-user-counter.test.ts
```

- Combined test-file count: 5 files touched (1 source, 4 tests)
- Combined test count: 83 pass, 0 fail
- Plan 129-01 primitives: 20/20 pass (unchanged)

## Acceptance Criteria — grep verification

**Task 1:**

| Criterion | Command | Expected | Actual |
|-----------|---------|----------|--------|
| Phase 129 describe block exists | `grep -n "Phase 129: per-user visibility gate" src/backend/database/routes/identities.get-disk.test.ts` | 1 hit | 1 hit (L1148) |
| Fixture helpers present | `grep -c "mockGetUsernameForUserId\|mockIdentityWithUsers\|fireGetIdentitiesAs" src/backend/database/routes/identities.get-disk.test.ts` | ≥3 hits | 24 hits (definitions + call sites) |
| Test F warn-log assertion | `grep -n "identities_gate_username_missing\|username.*missing" src/backend/database/routes/identities.get-disk.test.ts` | ≥1 hit | 3 hits |

**Task 2:**

| Criterion | Command | Expected | Actual |
|-----------|---------|----------|--------|
| Per-request username fetch (not per-host) | `grep -n "getUsernameForUserId(userId)" src/backend/database/routes/identities.ts` | 1 hit | 1 hit (L330) |
| Single call site inside fanout | `grep -n "isIdentityVisibleToUser(" src/backend/database/routes/identities.ts` | 1 hit | 1 hit (L478) |
| Gate precedes publicIdentity in fanout | `grep -n "return publicIdentity" src/backend/database/routes/identities.ts` | ≥1 hit, gate precedes | 1 hit (L494); gate on L478 (16 lines above) |
| Both structured log seams present | `grep -n "identities_gate_username_missing\|identities_gate_hidden" src/backend/database/routes/identities.ts` | ≥2 hits | 2 hits (L335 warn, L485 debug) |
| Cascade authority preserved | `grep -c "resolveIdentityAppearance" src/backend/database/routes/identities.ts` | unchanged (3) | 3 (pre-edit and post-edit identical) |

## Line-count Deltas

| File | Type | Lines |
|------|------|-------|
| src/backend/database/routes/identities.ts | modified | +45 (imports + per-request lookup block + per-identity gate block + comments) |
| src/backend/database/routes/identities.get-disk.test.ts | modified | +379 (mocks + fixture helpers + 7 tests) |
| src/backend/database/routes/identities.channel-cap.test.ts | modified | +15 (mock stubs for host-user-counter + identity-visibility-gate) |
| src/backend/database/routes/identities.disk-read.test.ts | modified | +15 (mock stubs for host-user-counter + identity-visibility-gate) |
| src/backend/database/routes/identities.put-disk.test.ts | modified | +18 (mock stubs for host-user-counter + identity-visibility-gate) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking Issue] Sibling test files broken by transitive drizzle-orm imports**

- **Found during:** Task 2 first `npx vitest related --run` — 3 sibling test files failed to load with `Error: No "isNotNull" export is defined on the "drizzle-orm" mock`.
- **Root cause:** Adding `import { getUsernameForUserId } from "../../utils/host-user-counter.js"` to identities.ts transitively pulled in `host-user-counter.ts`, which imports `isNotNull` (and `inArray`) from `drizzle-orm`. Three sibling test files (`identities.channel-cap.test.ts`, `identities.disk-read.test.ts`, `identities.put-disk.test.ts`) each had their own `vi.mock("drizzle-orm", ...)` factory that only exposed `eq` + `and`. The module-load failure propagated to their whole suites.
- **Fix:** Rather than extending each drizzle-orm mock (would require re-implementing 2 exports per file, and future drizzle-orm export additions would repeat the pattern), each sibling test now stubs the two new gate modules DIRECTLY:
  ```typescript
  vi.mock("../../utils/host-user-counter.js", () => ({
    isHostMultiUser: vi.fn().mockResolvedValue(false),
    getUsernameForUserId: vi.fn().mockResolvedValue("test-user"),
  }));
  vi.mock("../../fleet-status/identity-visibility-gate.js", () => ({
    isIdentityVisibleToUser: () => true,
  }));
  ```
- **Justification:** These 3 suites cover channel-cap counting, `.pinned` probing, and PUT disk-write behavior — the D-7 gate has its own coverage in `identities.get-disk.test.ts`'s Phase 129 describe block. Stubbing keeps each suite scoped to what it tests without expanding the drizzle-orm mock or adding a real DB dependency.
- **Files modified:** `identities.channel-cap.test.ts`, `identities.disk-read.test.ts`, `identities.put-disk.test.ts`
- **Commit:** `fac89a7e` (Task 2, all 4 file edits in one commit — the sibling stubs are strictly the wire-up cost of Task 2's identities.ts import addition and belong in the same atomic commit as the change that necessitated them).

### Minor implementation notes (NOT deviations from the plan's contract)

**1. Test A / Test B strengthening for RED discrimination.** The plan
spec described Tests A and B as pure "regression locks" (single-user host
zero-regression + multi-user untagged D-3 fallback). Read literally, both
tests would PASS on RED because the pre-129 code path — with no gate wired
— already surfaces both muffin identities. To satisfy the plan's stated
acceptance criterion "All 7 new tests currently FAIL (RED phase)", Test A
was extended with an `expect(getUsernameForUserIdMock).toHaveBeenCalledTimes(1)`
+ `HaveBeenCalledWith("uid-ashley")` assertion (the per-request-cost lock),
and Test B was extended with `HaveBeenNthCalledWith` per-request assertions
(the no-cross-request-cache lock). Both fail on RED because
identities.ts does not call `getUsernameForUserId` at all pre-Task-2. Both
pass on GREEN because the lookup runs exactly once per request. This
strengthens Test A + Test B beyond the plan spec while preserving both
their original assertions — the additions are per-request-cost + no-cross-
request-cache invariant locks that the plan's own `<behavior>` section
mentions ("The username fetch is called EXACTLY ONCE per request").

**2. vi.hoisted usage for mock references.** The first RED-phase test run
failed with `ReferenceError: Cannot access 'systemLoggerWarnMock' before
initialization`. Vitest hoists `vi.mock` factory calls above imports, so
top-level `const systemLoggerWarnMock = vi.fn()` isn't visible when the
factory runs. Standard workaround: `vi.hoisted(() => ({ ... }))` co-hoists
the mock instances alongside the `vi.mock` factories. Both
`systemLoggerWarnMock`+`systemLoggerDebugMock` and `getUsernameForUserIdMock`
use this pattern — no functional impact, just idiomatic vitest scaffolding.

**3. Doc comment adjustment for grep acceptance.** The initial gate-import
docblock in identities.ts self-referentially cited the grep pattern
`isIdentityVisibleToUser(` inside backticks, which caused
`grep -n "isIdentityVisibleToUser(" identities.ts` to return 2 hits (the
comment + the real call site). The plan acceptance criterion requires
"exactly 1 hit". The comment was rewritten to name the invariant without
including the parenthesized pattern verbatim. No semantic change to the
docblock's meaning; it now says "answered by grepping for the gate
function name in this file" rather than embedding the exact grep string.

## Assumption Changes vs RESEARCH

None. All RESEARCH assumptions from Plan 129-01 (A1 hostAccess authoritative,
A2 case-sensitive, A6 RBAC-role expansion) carry through unchanged. The gate
call site placement (after `roleCosmetics`, before `publicIdentity`) matches
PATTERNS.md § "identities.ts (MODIFY — GET / fanout L294-485)" exactly.

The plan's RESEARCH note about gating "BEFORE publicIdentity rather than
plumbing raw cosmetics through the row" was validated as-designed —
`publicIdentity`'s existing null-cosmetics safe-default path is unrelated
to the gate and does not require signature changes.

## Deferred Issues

None from this plan.

**Wave 2 remaining deep-gate seams (not this plan's scope):**

- **129-03:** Session-list gating in `/sessions/list` (SSH-poll orchestrator
  side) — hidden identities must also not surface as orphan session rows.
- **129-04:** Role picker gating in `GET /roles?hostId=<n>` (the "+ New
  role" flow's role dropdown) — role-side D-2 filter must apply here too.
- **129-05:** WS frame filtering + conversation-search filtering — every
  live-status heartbeat and every search result must respect the gate.

Together these four Wave 2 plans close the D-7 deep-gate contract
("Hidden identities leave no evidence anywhere") end-to-end.

## Threat Flags

None. Every threat in the plan's `<threat_model>` register is mitigated
in-code as specified:

- **T-129-02-01** (info disclosure via response leak) — mitigated by
  per-identity `isIdentityVisibleToUser` call inside the fanout;
  hidden identities return null and collapse onto L450's null-filter.
- **T-129-02-02** (ghost row with stripped cosmetics) — mitigated by
  placing the gate BEFORE `publicIdentity`; the row is never constructed.
- **T-129-02-03** (defective username lookup empties sidebar) —
  accepted per D-8; null callerUsername disables the gate;
  `identities_gate_username_missing` warn logs the mismatch.
- **T-129-02-04** (silent gate decisions unobservable in prod) —
  mitigated by `identities_gate_hidden` debug log at every hidden
  decision with `{identityKey, hostId, callerUsername}`.
- **T-129-02-SC** (npm installs) — accepted; no new packages installed.

No new security-relevant surface beyond what the plan's threat model
accounts for. No new endpoints, no schema changes, no auth path changes.

## Self-Check: PASSED

Files modified (verified via `git log --stat`):

- `src/backend/database/routes/identities.ts` — FOUND (commit `fac89a7e`)
- `src/backend/database/routes/identities.get-disk.test.ts` — FOUND (commits `a9156f58` + `fac89a7e`)
- `src/backend/database/routes/identities.channel-cap.test.ts` — FOUND (commit `fac89a7e`)
- `src/backend/database/routes/identities.disk-read.test.ts` — FOUND (commit `fac89a7e`)
- `src/backend/database/routes/identities.put-disk.test.ts` — FOUND (commit `fac89a7e`)

Commits (verified via `git log --oneline`):

- `a9156f58` — Task 1 (7 RED tests + fixture helpers + gate-module mocks)
- `fac89a7e` — Task 2 (GREEN wiring + sibling test stub extensions)

Verification test runs (all pass):

- `npx vitest related --run src/backend/database/routes/identities.get-disk.test.ts src/backend/database/routes/identities.ts` → `5 files passed, 83/83 tests passed`
- `npx vitest related --run src/backend/fleet-status/identity-visibility-gate.test.ts src/backend/utils/host-user-counter.test.ts` → `2 files passed, 20/20 tests passed`

## Commits

| Task | Commit | Files |
|------|--------|-------|
| 1 (RED) | a9156f58 | identities.get-disk.test.ts (+ vi.hoisted mocks + 7 new tests) |
| 2 (GREEN) | fac89a7e | identities.ts (per-request lookup + per-identity gate), identities.channel-cap.test.ts + identities.disk-read.test.ts + identities.put-disk.test.ts (sibling mock stubs) |
