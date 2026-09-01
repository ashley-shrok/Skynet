---
phase: 67-mark-coordinators-in-skynet-right-side-mdhub-watermark-on-id
plan: 01
wave: 1
type: execute
subsystem: identity-cosmetics-backend
tags: [coordinator, cosmetics, reader, publicIdentity, identity-type, backend, tdd]
requires:
  - Phase 66's disk-cosmetic pipeline (extractCosmeticsFromFrontmatter + publicIdentity + GET /identities disk-overlay)
provides:
  - "extractCosmeticsFromFrontmatter narrows coordinator?: boolean (6th and final optional cosmetic scalar)"
  - "publicIdentity emits coordinator: boolean (false safe-default) on every response row"
  - "Frontend Identity type carries non-nullable coordinator: boolean"
  - "publicIdentity is now exported for direct test import (was module-private)"
affects:
  - src/backend/claude-session/identity-artifact-reader.ts
  - src/backend/database/routes/identities.ts
  - src/ui/api/identities-api.ts
tech_stack:
  added: []
  patterns:
    - "Additive extension of Phase 66 narrowing contract — same typeof gate pattern"
    - "Safe-default non-nullable-boolean matches avatarMime/avatarEtag non-nullable-string pattern"
    - "Export-for-test-only pattern (function exported so colocated unit tests can call it directly)"
key_files:
  created:
    - .planning/phases/67-mark-coordinators-in-skynet-right-side-mdhub-watermark-on-id/67-01-SUMMARY.md
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts
    - src/backend/database/routes/identities.ts
    - src/backend/database/routes/identities.get-disk.test.ts
    - src/ui/api/identities-api.ts
decisions:
  - "coordinator overlay is READ-only (no POST/PUT write path added) per CONTEXT boundary rule"
  - "Safe-default is boolean false (not null, not missing) so Wave 2's surface components branch on a plain boolean without null-safety plumbing"
  - "publicIdentity() gains export keyword so the four PUB-* unit tests can call it directly; no other consumers change"
  - "coordinator field positioned between avatarEtag and createdAt in Identity interface — keeps cosmetics grouped before timestamps"
  - "Test file's mock extractCosmeticsFromFrontmatter also gained the coordinator narrowing branch — the mock stays lockstep with the real reader"
metrics:
  tasks_completed: 2
  duration: "~15 minutes"
  completed_date: "2026-09-01"
  files_touched: 5
  new_tests_added: 12   # 6 reader unit + 4 publicIdentity unit + 2 route-level
  commits_landed: 4
---

# Phase 67 Plan 67-01: coordinator field backend end-to-end (Wave 1) — Summary

Threads the `coordinator: true|false` boolean from an identity's on-disk YAML
frontmatter through the Phase 66 disk-cosmetic pipeline and into the frontend
`Identity` type, unlocking Wave 2's three surface components (Plan 67-02) so
they can branch on `identity.coordinator` without further backend plumbing.

## What shipped

### Backend reader — `identity-artifact-reader.ts`

`extractCosmeticsFromFrontmatter` narrows a sixth optional field alongside
the existing five:

```ts
if (typeof src.coordinator === "boolean") {
  out.coordinator = src.coordinator;
}
```

Same narrowing contract Phase 66 established: boolean → keep;
non-boolean/absent/malformed → drop (verifiable with `'coordinator' in
result === false`). Field order canonicalized as `[displayName, title,
colorHue, voice, avatar, coordinator]` in both the return-type annotation and
the local `out` variable.

The JSDoc block above the function grows one bullet documenting the new gate.

### Backend route — `identities.ts` `publicIdentity()`

Three changes to `publicIdentity`:

1. Function is now `export`ed (was module-private). Colocated PUB-* unit
   tests in `identities.get-disk.test.ts` need direct access; the existing
   in-module callers are unchanged.
2. The `cosmetics` parameter type widens to include `coordinator?: boolean`
   as the 7th optional key.
3. The response body gains
   `coordinator: typeof cosmetics.coordinator === "boolean" ? cosmetics.coordinator : false`
   — false safe-default mirrors the `avatarMime`/`avatarEtag` non-nullable
   safe-default pattern. Absence of coordinator on disk = actor = no
   marker rendered on the Wave 2 surfaces.

### Frontend type — `identities-api.ts`

`Identity` interface grows one non-nullable field:

```ts
coordinator: boolean;
```

Positioned between `avatarEtag` and `createdAt` to keep the cosmetic block
grouped before the timestamp block. Non-nullable matches the backend's
false safe-default; Wave 2 branches on a plain boolean without null-safety
plumbing.

## Tests

**12 new tests total, TDD RED-then-GREEN pattern with atomic commits at each gate.**

### Task 1 — 6 reader unit tests (`identity-artifact-reader.avatar-read.test.ts`)

New describe block `extractCosmeticsFromFrontmatter — coordinator field (Phase 67 Plan 67-01)` colocated with existing Tests F-I:

- COORD-1: coordinator: true + other cosmetics → coordinator: true present
- COORD-2: coordinator: false → coordinator: false present (NOT dropped)
- COORD-3: no coordinator key → coordinator absent (`'coordinator' in result === false`)
- COORD-4: coordinator: "yes" (string) → coordinator DROPPED
- COORD-5: coordinator: 1 (number) → coordinator DROPPED
- COORD-6: malformed YAML → {} returned; coordinator absent

RED signal at task-1 commit `c212899e`: COORD-1 + COORD-2 failed against
unmodified reader (coordinator missing from return object); COORD-3/4/5/6
passed by default because the pre-fix reader simply didn't extract the key.

GREEN at commit `ffb14cf2`: all 18 tests in the file pass (12 pre-existing
+ 6 new); backend build green.

### Task 2 — 4 publicIdentity unit tests + 2 GET /identities route tests (`identities.get-disk.test.ts`)

Two new/extended describe blocks:

New describe block `publicIdentity — coordinator overlay (Phase 67 Plan 67-01)` at the top of the file (before the two pre-existing describe blocks):

- PUB-1: cosmetics `{ coordinator: true }` → `out.coordinator === true`
- PUB-2: cosmetics `{ coordinator: false }` → `out.coordinator === false`
- PUB-3: cosmetics `{}` → `out.coordinator === false` (safe-default; not null, not missing)
- PUB-4: no cosmetics argument → `out.coordinator === false`

Appended to existing `GET /identities — disk-derived cosmetics` block:

- GET-COORD-1: `identityHosts={coordinator-test:1}` + on-disk `coordinator: true` + `displayName: Nelly` → response row has `coordinator: true` AND `displayName: "Nelly"`
- GET-COORD-2: `identityHosts={actor-test:1}` + on-disk NO coordinator key + `displayName: Tina` → response row has `coordinator: false` (safe-default) AND `displayName: "Tina"`

Each route test seeds a fresh `dbState.identities` array so pre-existing
Tests 1-3 setup is untouched.

The vitest mock's `extractCosmeticsFromFrontmatter` in this test file also
grows the coordinator narrowing branch — the mock stays lockstep with the
real reader so the wire path is exercised end-to-end.

RED signal at task-2 commit `6d2d45cb`: all 6 new tests failed (4 PUB-*
failed on `Cannot resolve export publicIdentity` before that plus
`coordinator undefined`; 2 GET-COORD-* failed on `coordinator undefined`
in response body). Pre-existing 8 tests still passed.

GREEN at commit `c94143e4`: 14/14 pass in this file (8 pre-existing + 6
new); put-disk sibling file still 10/10; backend build green; frontend
tsc --noEmit green.

## Verification (plan's overall block)

Ran the plan's overall verification suite:

```bash
npx vitest run src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts \
               src/backend/database/routes/identities.get-disk.test.ts \
               src/backend/database/routes/identities.put-disk.test.ts
```

Result: `Test Files 3 passed (3) | Tests 42 passed (42)` — zero regression
to Phase 66 territory.

```bash
npm run build:backend                          # exit 0
cd src/ui && npx tsc --noEmit                 # exit 0
```

Both compile clean.

## Commits (atomic, 4 total)

| Hash | Type | Scope | Description |
|------|------|-------|-------------|
| `c212899e` | test | 67-01 | RED: coordinator field cosmetic narrowing (6 cases) |
| `ffb14cf2` | feat | 67-01 | GREEN: coordinator field in extractCosmeticsFromFrontmatter |
| `6d2d45cb` | test | 67-01 | RED: publicIdentity + GET /identities coordinator overlay |
| `c94143e4` | feat | 67-01 | GREEN: publicIdentity emits coordinator + widen Identity type |

TDD gate sequence per task: `test(...)` RED commit landed BEFORE the
`feat(...)` GREEN commit that makes it pass. Two full RED/GREEN cycles.

## Deviations from Plan

**One micro-deviation — non-material, cosmetic-only:**

The plan's grep-gate acceptance criterion `grep -c "extractCosmeticsFromFrontmatter — coordinator field" src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts` returns exactly 1 required a small reshape: my initial draft had that exact string appearing twice (once in the section-header comment, once in the `describe()` header). To meet the "exactly 1" gate I renamed the section-header comment to `Phase 67 Plan 67-01: coordinator field narrowing` — the `describe()` header is the load-bearing occurrence for test-grouping semantics. Zero test-behavior impact; grep-gate now passes exactly.

**Position of coordinator key in publicIdentity response body:** Plan gave a choice — before OR after `role`. I placed it **between `avatarEtag` and `createdAt`** (grouped with cosmetics before the timestamp block), which matches the corresponding position in the Identity interface. This is a documentable choice per the plan's "document your choice in the summary" instruction.

**Export addition:** `publicIdentity` was previously module-private (no `export` keyword). Per plan Task 2 (f), I added `export` so the four PUB-* unit tests can import it directly. No other consumers change — the module's own route handlers still call it via lexical scope. Noted per plan instruction.

## What Wave 2 (Plan 67-02) now has

Frontend surface consumers can read `identity.coordinator` from the store
without any additional backend plumbing:

- `IdentityBadge.tsx` — read the flag, render `MdHub` watermark when `true`
- `PrettyConversationRow.tsx` — same
- `IdentityModal.tsx` header — same

Backend response shape is stable; the frontend Identity type is widened;
TSC agrees end-to-end. No wire-schema round-trip, no re-verification of
Phase 66 territory, no changes to POST/PUT paths.

## What is NOT in this plan (per CONTEXT boundary rule)

- No frontend rendering pass — Wave 2 (Plan 67-02) scope
- No POST /identities changes — coordinator is READ-only from Skynet
- No PUT /identities/:id changes — same
- No IdentityModal editor UI for coordinator — same
- No modifications to any file under `.planning/phases/66-.../` — Phase 66's paused-mid-ship state is preserved untouched

## Self-Check: PASSED

Files verified as present on disk:

- src/backend/claude-session/identity-artifact-reader.ts — coordinator narrowing block present at expected location
- src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts — 6 new COORD-* tests present in the new describe block
- src/backend/database/routes/identities.ts — publicIdentity exported, coordinator overlay field present in return body
- src/backend/database/routes/identities.get-disk.test.ts — 4 PUB-* + 2 GET-COORD-* tests present; publicIdentity imported directly
- src/ui/api/identities-api.ts — Identity interface has coordinator: boolean field

Commits verified in git log:

- c212899e — FOUND (test RED cycle 1)
- ffb14cf2 — FOUND (feat GREEN cycle 1)
- 6d2d45cb — FOUND (test RED cycle 2)
- c94143e4 — FOUND (feat GREEN cycle 2)
