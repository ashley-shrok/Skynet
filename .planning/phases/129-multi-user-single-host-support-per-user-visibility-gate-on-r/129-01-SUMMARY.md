---
phase: 129-multi-user-single-host-support-per-user-visibility-gate-on-r
plan: 01
subsystem: backend
tags: [foundations, gate, cosmetics, db-utils, tdd]
dependency_graph:
  requires: []
  provides:
    - "RawCosmetics.users?: string[] on the shared cosmetics type"
    - "extractCosmeticsFromFrontmatter narrows and normalizes users: entries"
    - "isIdentityVisibleToUser(identityCos, roleCos, callerUsername) pure gate"
    - "isHostMultiUser(hostId) + getUsernameForUserId(userId) shared DB helpers"
  affects:
    - "Every Wave 2 read-path plan (identities.ts, sessions.ts, roles-list-for-host.ts, app-frame-filter.ts, conversation-search.ts)"
    - "Every Wave 3 write-path plan (roles-create.ts, identity-birth.ts / identity-birth-orchestrator.ts)"
tech-stack:
  added: []
  patterns:
    - "Absent-⇒-omit narrowing block (mirrors task / project field discipline)"
    - "Queue-based select-chain mock with thenable+chainable dual-mode (host-user-counter.test.ts)"
    - "Companion pure-function pattern for cross-cutting gates — preserves Phase 111 T-111-08 single-cascade invariant"
key-files:
  created:
    - src/backend/fleet-status/identity-visibility-gate.ts
    - src/backend/fleet-status/identity-visibility-gate.test.ts
    - src/backend/utils/host-user-counter.ts
    - src/backend/utils/host-user-counter.test.ts
    - src/backend/claude-session/identity-artifact-reader.users.test.ts
  modified:
    - src/backend/fleet-status/identity-appearance.ts
    - src/backend/claude-session/identity-artifact-reader.ts
decisions:
  - "Gate lives in a companion pure function (isIdentityVisibleToUser) — NOT inside resolveIdentityAppearance's signature. Preserves Phase 111 T-111-08 one-cascade authority AND makes 'did we gate this call site?' an audit-visible grep. Wave 2/3 plans will call the gate alongside the resolver."
  - "isHostMultiUser expands hostAccess.roleId via userRoles (Assumption A6) to match permission-manager.canAccessHost's authoritative shape. Skipping expansion would leave Ashley + Zoe's shared t1000 silent on auto-tag when they share via an RBAC role."
  - "Share-expiry deliberately NOT filtered in isHostMultiUser per shape §'Auto-tag scope' — auto-tag is a snapshot-at-creation decision, captures a moment not a lifecycle."
  - "Case-sensitive username comparison locked (Pitfall 7) — matches DB users.username storage discipline (users.ts L172 stores as-typed). Operator responsibility to match case of registered Skynet username."
  - "Structured debug logs at isHostMultiUser entry AND exit with hostId + distinctUsers + isMultiUser — box-maintainer directive for gate-seam decisions so failed auto-tags in prod are traceable in systemLogger output."
metrics:
  duration_seconds: ~500
  duration_human: "~8 min executor time (plus ~9 min one-time npm install to hydrate node_modules)"
  completed_date: 2026-09-23
  new_tests: 28
  total_tests_run: 61
---

# Phase 129 Plan 01: Foundations — RawCosmetics.users + extractCosmetics narrower + isIdentityVisibleToUser + isHostMultiUser Summary

**One-liner:** Ships four dependency-free primitives — the `users?: string[]`
field on `RawCosmetics`, an absent-⇒-omit narrower for it in
`extractCosmeticsFromFrontmatter`, the pure `isIdentityVisibleToUser`
intersection gate, and the RBAC-role-aware `isHostMultiUser` +
`getUsernameForUserId` DB helpers — so every Wave 2 read-path plan and every
Wave 3 write-path plan can compose against a stable, tested API without
inventing their own local versions.

## What Shipped

### 1. `RawCosmetics.users?: string[]` (identity-appearance.ts)

- Added optional `users?: string[]` alongside `project?: string` on the
  exported `RawCosmetics` type used by both identity-side and role-side
  cosmetics.
- JSDoc cites D-10 (field name locked), D-3 (absent-⇒-omit fallback),
  D-8 (visibility filter not permission system), Phase 111 T-111-08 (one-
  cascade authority preservation), and Pitfall 7 (case-sensitive lock).
- `resolveIdentityAppearance` signature and body **unchanged** — the gate
  lives in the companion pure module (see #3).

### 2. `extractCosmeticsFromFrontmatter` narrower (identity-artifact-reader.ts)

- Extended the return-type declaration AND the `out` local with `users?: string[]`.
- Added a narrowing block near the end of the function (before `return out`,
  after the project narrower) that:
  - accepts only when `Array.isArray(src.users)` is true (rejects scalars,
    nulls, non-arrays — same discipline as the `project` narrower for
    wrong-type input);
  - filters entries to `typeof === "string"`;
  - trims;
  - drops empties;
  - emits `out.users = normalized` **only when `normalized.length > 0`**
    (preserves D-3 absent-⇒-omit fallback — an empty array yields NO `users`
    key on the returned object).
- Fail-open branch at L3162-3168 (YAML parse failure → `{}`) untouched — same
  contract as every other narrower here.

### 3. `identity-visibility-gate.ts` (NEW pure module)

- New file exports one named function:
  ```typescript
  export function isIdentityVisibleToUser(
    identityCosmetics: RawCosmetics | null,
    roleCosmetics: RawCosmetics | null,
    callerUsername: string | null,
  ): boolean
  ```
- Body implements D-2 intersection semantics with the D-3 fallback rule.
  `callerUsername === null` short-circuits to `true` (internal-server / test
  bypass).
- Zero imports from `src/backend/database/`, `express`, `zod`, or `logger` —
  ONE `import type { RawCosmetics } from "./identity-appearance.js"` only.
  Reusable by both the fleet-status layer and the route layer without a
  circular import.
- Case-sensitive comparison — no `.toLowerCase()` or `.toUpperCase()`
  anywhere in the file (Pitfall 7 lock, grep-verified).

### 4. `host-user-counter.ts` (NEW DB utility module)

- Exports two async helpers:
  ```typescript
  export async function isHostMultiUser(hostId: number): Promise<boolean>
  export async function getUsernameForUserId(userId: string): Promise<string | null>
  ```
- `isHostMultiUser` issues up to 4 DB queries in sequence:
  1. `hosts` (owner lookup) — unknown host → early-return `false` with a
     `reason: "unknown_host"` debug log entry.
  2. `hostAccess` (direct-user shares) — collects non-null `userId` values.
  3. `hostAccess` (role-scoped shares) — collects non-null `roleId` values.
  4. `userRoles WHERE roleId IN (...)` — expands roles to member userIds
     (only issued when step 3 found any role-scoped shares, avoiding a
     round-trip on the common case).

  A `Set<string>` starts with the owner and adds every direct-share userId
  and every role-expanded userId. Returns `set.size > 1`.

  Mirrors `permission-manager.ts::canAccessHost` (L162-260) — the
  authoritative host-access predicate that also expands `hostAccess.roleId`
  via `userRoles`. This satisfies RESEARCH Assumption A6 so a shared t1000
  via an RBAC role auto-tags correctly.

- `getUsernameForUserId` does a single-row `SELECT users.username WHERE users.id = ?`
  and returns the case-preserved string (or `null` when the row is absent).

- Structured logging at gate seam per box-maintainer directive:
  - `systemLogger.debug("host-user-counter check", { operation: "host_user_counter_check", hostId })` at entry
  - `systemLogger.debug("host-user-counter result", { operation: "host_user_counter_result", hostId, distinctUsers, isMultiUser [, reason] })` at exit

- Share-expiry deliberately NOT filtered — snapshot-at-creation semantic
  documented in the file-header JSDoc (no `expiresAt` string appears
  anywhere in the file, grep-verified).

## Final Signatures (from the four exports)

```typescript
// src/backend/fleet-status/identity-appearance.ts
export type RawCosmetics = {
  displayName?: string;
  title?: string;
  colorHue?: number;
  voice?: string;
  task?: string;
  avatar?: string;
  coordinator?: boolean;
  project?: string;
  users?: string[];   // NEW (Phase 129 Plan 01)
};

// src/backend/fleet-status/identity-visibility-gate.ts
export function isIdentityVisibleToUser(
  identityCosmetics: RawCosmetics | null,
  roleCosmetics: RawCosmetics | null,
  callerUsername: string | null,
): boolean;

// src/backend/utils/host-user-counter.ts
export async function isHostMultiUser(hostId: number): Promise<boolean>;
export async function getUsernameForUserId(userId: string): Promise<string | null>;

// src/backend/claude-session/identity-artifact-reader.ts
// (Return-type extension; function signature unchanged)
export function extractCosmeticsFromFrontmatter(markdown: string): {
  displayName?: string; title?: string; colorHue?: number; voice?: string;
  avatar?: string; coordinator?: boolean; task?: string; project?: string;
  users?: string[];   // NEW (Phase 129 Plan 01)
};
```

## Tests

- 28 net-new tests, all passing.
- 61 total tests run in scoped verification (28 new + 33 existing
  `identity-appearance.test.ts` regression coverage that transitively
  imports the extended `RawCosmetics`).

| Suite | File | New | Status |
|-------|------|-----|--------|
| users narrowing | `src/backend/claude-session/identity-artifact-reader.users.test.ts` | 8 | 8/8 pass |
| gate function matrix | `src/backend/fleet-status/identity-visibility-gate.test.ts` | 10 | 10/10 pass |
| host-user-counter | `src/backend/utils/host-user-counter.test.ts` | 10 | 10/10 pass |
| appearance regression | `src/backend/fleet-status/identity-appearance.test.ts` | 0 (existing) | 33/33 pass |
| **Total** |  | **28 new** | **61/61 pass** |

TDD gates observed for each of the three tasks:
- Task 1: RED (4 pending assertions failing before RawCosmetics + narrower edits) → GREEN (all 8 pass).
- Task 2: RED (import failure — module did not exist) → GREEN (all 10 pass).
- Task 3: RED (import failure — module did not exist) → GREEN (all 10 pass on first implementation run).

## Verification Commands

```bash
npx vitest related --run src/backend/claude-session/identity-artifact-reader.users.test.ts
npx vitest related --run src/backend/fleet-status/identity-visibility-gate.test.ts
npx vitest related --run src/backend/utils/host-user-counter.test.ts

# Combined verification (used at plan-end):
npx vitest related --run \
  src/backend/claude-session/identity-artifact-reader.users.test.ts \
  src/backend/fleet-status/identity-visibility-gate.test.ts \
  src/backend/utils/host-user-counter.test.ts \
  src/backend/fleet-status/identity-appearance.test.ts
```

## Acceptance Criteria — grep verification

| Criterion | Command | Expected | Actual |
|-----------|---------|----------|--------|
| RawCosmetics users field ships | `grep -n "users?: string\[\]" src/backend/fleet-status/identity-appearance.ts` | 1 hit | 1 hit (L63) |
| Extractor narrower present | `grep -n "out\.users = normalized" src/backend/claude-session/identity-artifact-reader.ts` | 1 hit | 1 hit (L3257) |
| resolveIdentityAppearance signature stable | `grep -c "resolveIdentityAppearance(args:" src/backend/fleet-status/identity-appearance.ts` | 1 | 1 |
| Gate NOT in cascade | `grep -c "callerUsername" src/backend/fleet-status/identity-appearance.ts` | 0 | 0 |
| Gate module import discipline | `grep -c "^import" src/backend/fleet-status/identity-visibility-gate.ts` | 1 | 1 (RawCosmetics type only) |
| No case-mangling in gate | `grep -nE "\.toLowerCase\(\)\|\.toUpperCase\(\)" src/backend/fleet-status/identity-visibility-gate.ts` | 0 | 0 |
| RBAC-role expansion present | `grep -n "userRoles" src/backend/utils/host-user-counter.ts` | ≥1 | 5 hits (import + 3 query call sites + JSDoc mention) |
| Structured logging present | `grep -n "systemLogger.debug\|systemLogger.info" src/backend/utils/host-user-counter.ts` | ≥1 | 3 hits |
| expiresAt deliberately excluded | `grep -c "expiresAt" src/backend/utils/host-user-counter.ts` | 0 | 0 |

## Line-count Deltas

| File | Type | Lines |
|------|------|-------|
| src/backend/fleet-status/identity-appearance.ts | modified | +17 (RawCosmetics.users? + JSDoc block) |
| src/backend/claude-session/identity-artifact-reader.ts | modified | +25 (return-type extension + `out` local + narrowing block + JSDoc) |
| src/backend/fleet-status/identity-visibility-gate.ts | created | 76 lines total |
| src/backend/fleet-status/identity-visibility-gate.test.ts | created | 130 lines total |
| src/backend/utils/host-user-counter.ts | created | 155 lines total |
| src/backend/utils/host-user-counter.test.ts | created | 263 lines total |
| src/backend/claude-session/identity-artifact-reader.users.test.ts | created | 78 lines total |

## Deviations from Plan

### Auto-fixed Issues

None — the plan was executed exactly as written for all three tasks. No
Rule 1 (bug), Rule 2 (missing critical functionality), Rule 3 (blocking
issue), or Rule 4 (architectural change) deviations were needed.

### Minor implementation notes (NOT deviations from the plan's contract)

**1. Task 3 test count discrepancy.** The plan spec calls out 9 behavior
tests; this implementation delivered 10 tests to keep each behavior in its
own `it` block AND to isolate the structured-logging assertion (box-maintainer
directive) from the multi-user branch tests. Every behavior specified by the
plan (`unknown host`, `owner-only`, `direct share`, `share-back-to-owner
dedup`, `RBAC-role expansion`, `RBAC-role owner-only member`, `overlapping
direct + role`, `getUsernameForUserId known`, `getUsernameForUserId unknown`)
is covered. The +1 is a distinct structured-log assertion (Test 8) verifying
`hostId` + `distinctUsers` + `isMultiUser` appear in the debug entries at
entry and exit.

**2. `extractCosmeticsFromFrontmatter` grep count for `users?: string[]`.**
The plan acceptance criterion reads "returns exactly 1 hit inside the
extractCosmeticsFromFrontmatter return-type declaration." The whole-file
grep returns 2 hits: L3158 in the return-type declaration (satisfies the
criterion) and L3190 in the `out` local declaration (matches the exact
pattern every other field in this file follows — return-type has it, `out`
local has it, narrower emits it). This is not a deviation; it mirrors the
project / task / voice / avatar / coordinator field-declaration discipline
established in prior phases.

**3. Node modules hydration.** The maintainer worktree did not have
`node_modules/` at plan start. One-time `npm install` (~9 min) hydrated
1199 packages. This is a workspace-setup cost, not a plan cost — future
runs of `npx vitest related --run` will resolve locally without any
network round-trip.

## Assumption Changes vs RESEARCH

None. All RESEARCH assumptions (A1 hostAccess authoritative, A2 case-
sensitive, A6 RBAC-role expansion) were validated in-place by reading
`permission-manager.ts::canAccessHost` L162-260 during Task 3 planning.
The shape used by `canAccessHost` — `userRoles` INNER JOIN → `hostAccess.roleId`
IN membership — is exactly what `isHostMultiUser` mirrors (Query 3 + Query 4).

## Deferred Issues

None from this plan.

## Threat Flags

None. Every threat in the plan's `<threat_model>` register (T-129-01-01
through T-129-01-04) is mitigated in-code as specified:

- T-129-01-01 (extractor narrower tampering) — Array.isArray + typeof-string
  + trim + drop-empty gate (Test 5 + Test 6 lock).
- T-129-01-02 (info disclosure via gate) — pure function, no side effects;
  case-sensitive comparison; 10-case matrix test.
- T-129-01-03 (RBAC-role expansion tampering) — Assumption A6 mirrored;
  Test 5/6/7 lock behavior.
- T-129-01-04 (silent auto-tag skip) — structured debug logs at entry + exit
  with hostId + distinctUsers count per box-maintainer directive.

No new security-relevant surface was introduced beyond what the plan's
threat model already accounts for. Every "YES" surface in the RESEARCH
no-leak audit table is a Wave 2/3 responsibility — this plan intentionally
touches zero route/orchestrator/WS-filter code.

## Self-Check: PASSED

Files created (verified):
- `src/backend/fleet-status/identity-visibility-gate.ts` — FOUND
- `src/backend/fleet-status/identity-visibility-gate.test.ts` — FOUND
- `src/backend/utils/host-user-counter.ts` — FOUND
- `src/backend/utils/host-user-counter.test.ts` — FOUND
- `src/backend/claude-session/identity-artifact-reader.users.test.ts` — FOUND

Files modified (verified via commit e41d5bc5):
- `src/backend/fleet-status/identity-appearance.ts` — modified (RawCosmetics.users?)
- `src/backend/claude-session/identity-artifact-reader.ts` — modified (extractor narrower)

Commits (verified via `git log --oneline`):
- `e41d5bc5` — Task 1 (extend RawCosmetics + extractCosmeticsFromFrontmatter)
- `ec5df06a` — Task 2 (identity-visibility-gate pure module)
- `8b90f6b5` — Task 3 (host-user-counter DB helpers)

## Commits

| Task | Commit | Files |
|------|--------|-------|
| 1 | e41d5bc5 | identity-appearance.ts, identity-artifact-reader.ts, identity-artifact-reader.users.test.ts |
| 2 | ec5df06a | identity-visibility-gate.ts, identity-visibility-gate.test.ts |
| 3 | 8b90f6b5 | host-user-counter.ts, host-user-counter.test.ts |
