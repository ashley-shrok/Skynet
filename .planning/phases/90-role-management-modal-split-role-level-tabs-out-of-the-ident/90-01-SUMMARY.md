---
phase: 90-role-management-modal-split
plan: 01
subsystem: backend-enumeration
tags: [roles, cosmetics, frontmatter, enumeration, backend]
requires:
  - src/backend/claude-session/identity-artifact-reader.ts (extractCosmeticsFromFrontmatter)
  - src/backend/database/routes/roles-list-for-host.ts (pre-Plan-90 handler)
  - src/ui/api/identities-api.ts (pre-Plan-90 RoleSummary type)
provides:
  - GET /roles?hostId=<n> response entries carry optional cosmetic frontmatter fields (title, displayName, colorHue, voice, avatar) alongside {name, description}
  - Widened RoleSummary type on frontend (backward-compat — pure widening)
affects:
  - Plan 90-05 (roles-list modal): .pv-row rows can render in role's own hue + avatar without a follow-up round-trip
tech-stack:
  added: []
  patterns:
    - reuse extractCosmeticsFromFrontmatter for role markdown (Plan 85-01 established this dual-use pattern)
    - spread-optional-fields into response object (missing keys OMITTED, not null-emitted)
key-files:
  created: []
  modified:
    - src/backend/database/routes/roles-list-for-host.ts
    - src/backend/database/routes/roles-list-for-host.test.ts
    - src/ui/api/identities-api.ts
decisions:
  - D-08.1 planner-pick locked here: extend the existing GET /roles endpoint rather than adding a companion (GET /roles/full). Simpler, no new URL to plumb, backwards-compat via optional fields.
  - Only 5 role-facing cosmetic fields forwarded (title, displayName, colorHue, voice, avatar). coordinator/task from the identity-side extractor are NOT surfaced — roles don't consume them.
  - Missing/malformed fields OMITTED from response entries (not defaulted, not null-emitted), matching extractCosmeticsFromFrontmatter's field-narrowing contract.
  - SSH cat-failure fallback path unchanged — entries return {name, description: ""} without cosmetic scaffolding because there's no markdown to extract from.
metrics:
  duration: ~15 min
  completed: 2026-09-09
---

# Phase 90 Plan 90-01: Extend GET /roles Enumerate with Cosmetics Summary

**One-liner:** GET /roles?hostId=<n> now attaches optional cosmetic frontmatter (title, displayName, colorHue, voice, avatar) per entry via the shared `extractCosmeticsFromFrontmatter` helper — feeds Plan 90-05's roles-list modal without a round-trip.

## What Shipped

### Backend handler (`src/backend/database/routes/roles-list-for-host.ts`)

Extended the existing GET /roles?hostId=<n> handler:

1. **Import** — `extractCosmeticsFromFrontmatter` imported from `src/backend/claude-session/identity-artifact-reader.ts` (reuses the identity-side helper unchanged, per Plan 85-01's precedent that role markdown carries the same YAML frontmatter shape).
2. **Parse loop** — In the batched-cat parse loop at L208, alongside `descByName.set(name, extractRoleDescription(body))` a parallel `cosByName` map is populated. The body from `.split(/^===ROLE:.../m)` has a leading `\n` (from the delimiter line's newline), so it's stripped with `body.replace(/^\s*\r?\n/, "")` before being fed to the extractor — otherwise the extractor's `^---` anchor doesn't match.
3. **Field narrowing** — The extractor returns `{title?, displayName?, colorHue?, voice?, avatar?, coordinator?, task?}`. Only the 5 role-facing keys are forwarded; `coordinator`/`task` are dropped (roles don't consume them, per Plan 90-01 Task 1 acceptance criteria).
4. **Response spread** — At the result construction: `{name, description: descByName.get(name) ?? "", ...(cosByName.get(name) ?? {})}`. Missing keys simply don't appear on the entry.
5. **Fallback path unchanged** — On SSH cat failure at L199, the graceful path `validRoles.map(name => ({name, description: ""}))` still returns entries without cosmetic scaffolding (can't extract from markdown never fetched).

### Test coverage (`src/backend/database/routes/roles-list-for-host.test.ts`)

7 new cases (A–G) mirroring the plan's `<behavior>` clauses:

- **Test A**: full frontmatter (all 5 fields present) → response entry carries all 5 cosmetic fields.
- **Test B**: no frontmatter block → response entry has ONLY `{name, description}`; cosmetic keys entirely absent (not null, not undefined-explicit).
- **Test C**: partial frontmatter (`colorHue: 190` only) → only `colorHue` added; other cosmetic keys absent.
- **Test D**: malformed YAML frontmatter → `try/catch` in the extractor swallows it, entry returns `{name, description}` only.
- **Test E**: `colorHue: 400` (out of `[0, 359]`) → range gate drops it; `title` (co-present, valid) is kept.
- **Test F**: mixed roles (one with cosmetics, one without) — both still have `{name, description}` populated; backwards-compat gate.
- **Test G**: SSH cat failure fallback → entries return with empty descriptions and NO cosmetic keys.

All 17 tests (10 pre-existing + 7 new) pass under `npx vitest run src/backend/database/routes/roles-list-for-host.test.ts`.

### Frontend type widening (`src/ui/api/identities-api.ts`)

`RoleSummary` widened from `{name: string; description: string}` to include optional `title`, `displayName`, `colorHue`, `voice`, `avatar`. Pure widening — existing two-field callers keep compiling untouched. No companion `listRolesForHostWithCosmetics` function (explicitly rejected by D-08.1 planner-pick — extend-not-companion).

## Decisions Made

- **D-08.1 locked (planner-pick):** Extend existing endpoint over adding companion `/roles/full`. Rationale: simpler, no new URL to plumb, backwards-compat via optional field spread. The two-field callers ignore the extra keys; new callers (Plan 90-05) read them.
- **Field allow-list vs. spread-all:** Explicit narrowing to 5 role-facing fields rather than spreading the whole extractor return. Rationale: `coordinator` (Phase 67) and `task` (Phase 80) are identity-scope semantics; leaking them into the /roles response would create implicit API surface future callers might rely on.
- **Body pre-trim before extractor:** The delimiter split leaves a leading `\n` in each body block. Rather than change the extractor's regex (used by many callers), the roles handler strips the leading whitespace locally. Isolates the concern to this call site.

## Deviations from Plan

**None** — plan executed exactly as written. The one micro-adjustment (body pre-trim before feeding to the extractor) is a Rule 3 mechanical fix for the split-artifact newline; documented in the code comment at the touch site.

## Verification

- `npx vitest run src/backend/database/routes/roles-list-for-host.test.ts` → **17/17 passing** (10 pre-existing + 7 new A–G).
- `npm run build:backend` → clean (backend TS compiles).
- `npm run build` → clean (frontend TS compiles; RoleSummary widening doesn't break any consumers).
- `grep -v '^#' src/backend/database/routes/roles-list-for-host.ts | grep -c extractCosmeticsFromFrontmatter` → 4 (import line + type import + call).
- `grep -n "listRolesForHostWithCosmetics" src/ui/api/identities-api.ts` → 0 (no companion function, per D-08.1).

## Commits

- `fc745806` — feat(90-01): extend /roles endpoint with cosmetic frontmatter fields

## Files Modified

- `src/backend/database/routes/roles-list-for-host.ts` (+40 lines: import, RoleCosmetics type, parse-loop extension, response spread)
- `src/backend/database/routes/roles-list-for-host.test.ts` (+246 lines: 7 new tests A–G)
- `src/ui/api/identities-api.ts` (+18 lines: widened RoleSummary type + Phase 90 comment)

## Known Stubs

None. Every field lands on the response entry when present on disk; every gate rejects invalid values by dropping (not defaulting, not null-emitting).

## Self-Check: PASSED

- File `src/backend/database/routes/roles-list-for-host.ts`: FOUND
- File `src/backend/database/routes/roles-list-for-host.test.ts`: FOUND
- File `src/ui/api/identities-api.ts`: FOUND
- Commit `fc745806`: FOUND
- Scoped tests: 17/17 passing
- `npm run build:backend`: clean
- `npm run build`: clean
