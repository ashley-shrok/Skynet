---
phase: 82-branding-config-wip-indicator-image-overridable
plan: 03
subsystem: ui/branding
tags: [branding-config, schema-mirror, phase-70-successor, phase-74-pattern, wire-format-contract]
requires:
  - src/backend/branding/branding-config-loader.ts (Phase 82-01 — extended backend BrandingConfig with wipIndicatorPath)
  - src/ui/branding/branding-store.ts (Phase 70 Plan 03 — original frontend BrandingConfig type + sentinel)
  - src/ui/branding/branding-fetch.ts (Phase 70 Plan 03 — original isBrandingConfig shape guard)
  - docker/branding-defaults/branding.json (Phase 82-01 — bundled JSON default carries wipIndicatorPath)
provides:
  - Frontend BrandingConfig type with required wipIndicatorPath: string (field-for-field mirror of backend after Plan 82-01)
  - Extended getBundledDefaultsSentinel() carrying wipIndicatorPath = "/branding/wip-cube.webp" (byte-for-byte match with backend HARDCODED_FALLBACK + bundled JSON)
  - Extended isBrandingConfig type guard in branding-fetch.ts rejecting missing / wrong-type wipIndicatorPath
affects:
  - Plan 82-04 (WipBubble.tsx rewire) — can now safely read `useBrandingConfig().wipIndicatorPath` and be guaranteed a string (sentinel at initial paint; operator/bundled-default value after boot fetch resolves)
tech-stack:
  added: []
  patterns:
    - "Wire-format contract mirror: frontend BrandingConfig type + sentinel + fetch-boundary shape guard all extended in one atomic plan (Phase 70 + Phase 74 precedent)"
    - "Additive-only schema extension: signatures of publishBrandingConfig / useBrandingConfig / __resetForTest / fetchBrandingConfig unchanged; anti-pattern comment block preserved verbatim"
    - "Byte-for-byte invariant preserved across three files: frontend sentinel value === backend HARDCODED_FALLBACK value === bundled JSON value === literal '/branding/wip-cube.webp'"
key-files:
  created: []
  modified:
    - src/ui/branding/branding-store.ts
    - src/ui/branding/branding-fetch.ts
key-decisions:
  - "wipIndicatorPath placed AFTER faviconPath and BEFORE pwaIcons in the frontend type declaration + sentinel — matches backend order after Plan 82-01 (image-URL group per 82-CONTEXT.md § Claude's Discretion)"
  - "Shape guard branch placed between the faviconPath check and the pwaIcons Array.isArray check — field-order in guard matches type declaration"
  - "No new frontend branding test file created — 82-CONTEXT.md § Test surface locks 'No new test file needed — this is a schema extension along an established pattern'; the plan's must_haves.truths[4] specifies `npx tsc --noEmit` as the automated verification gate"
  - "Phase 74 fields (avatarDirectorSpec / avatarGammaDefault) remain un-validated in isBrandingConfig — Phase 82 does NOT expand validation surface for Phase 74 fields (82-CONTEXT.md § Scope Fence)"
patterns-established:
  - "Frontend fetch-boundary shape guard extension in lockstep with type declaration extension — same commit for a single-file plan, sequential commits for a two-file plan"
requirements-completed: []

# Metrics
duration: 3min
completed: 2026-09-07
---

# Phase 82 Plan 03: Frontend BrandingConfig wipIndicatorPath mirror Summary

**Mirrored Plan 82-01's backend `wipIndicatorPath: string` schema extension onto the frontend `BrandingConfig` type + bundled-default sentinel + `isBrandingConfig` shape guard — preserving the Phase 70 wire-format contract and the Pitfall 5 byte-for-byte sentinel invariant.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-09-07T10:31:14Z
- **Completed:** 2026-09-07T10:34:29Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Frontend `BrandingConfig` type in `src/ui/branding/branding-store.ts` now declares `wipIndicatorPath: string` in field-for-field agreement with the backend type after Plan 82-01 (order: `appName, shortName, iconPath, wordmarkPath, faviconPath, wipIndicatorPath, pwaIcons, avatarDirectorSpec, avatarGammaDefault`).
- `getBundledDefaultsSentinel()` carries `wipIndicatorPath: "/branding/wip-cube.webp"` — byte-for-byte match with backend `HARDCODED_FALLBACK` (branding-config-loader.ts L86) and `docker/branding-defaults/branding.json`. Phase 70 Pitfall 5 mitigation contract preserved.
- `isBrandingConfig` type guard in `branding-fetch.ts` now rejects fetched responses missing or carrying a non-string `wipIndicatorPath`, keeping the network trust boundary defensible against stale backend builds, nginx SPA fallback, or MITM shape corruption.
- Plan 82-04 (WipBubble rewire) is now unblocked and can safely dereference `useBrandingConfig().wipIndicatorPath` with the compile-time guarantee that the value is a `string` from tick 0 (sentinel) through the post-boot operator/bundled-default publish.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend frontend BrandingConfig type + bundled sentinel** — `cffb751a` (feat)
2. **Task 2: Extend isBrandingConfig shape guard** — `57fce264` (feat)

**Plan metadata:** committed separately after this file lands.

## Files Created/Modified

- `src/ui/branding/branding-store.ts` — Added `wipIndicatorPath: string` to the exported `BrandingConfig` type between `faviconPath` and `pwaIcons` (with a one-line Phase 82 attribution comment above the field), plus `wipIndicatorPath: "/branding/wip-cube.webp"` to the `getBundledDefaultsSentinel()` return object in the same position. Existing anti-pattern comment block ("DO NOT introduce a React Context provider") and all public API signatures unchanged.
- `src/ui/branding/branding-fetch.ts` — Added `if (typeof o.wipIndicatorPath !== "string") return false;` to `isBrandingConfig` between the `faviconPath` check and the `pwaIcons` `Array.isArray` check. `fetchBrandingConfig()` signature, try/catch structure, silent-no-op-on-failure semantics, and the network-trust-boundary comment block are byte-identical to baseline.

## Verification Results

- `grep -c 'wipIndicatorPath' src/ui/branding/branding-store.ts` → **2** (type declaration + sentinel entry; must_haves.truths[0]/[1] and acceptance criterion ≥ 2 satisfied).
- `grep -c 'wipIndicatorPath: "/branding/wip-cube.webp"' src/ui/branding/branding-store.ts` → **1** (only the sentinel — the type declaration uses `: string`, not the literal; acceptance criterion = 1 satisfied).
- `grep -c 'wipIndicatorPath' src/ui/branding/branding-fetch.ts` → **1** (only the new guard branch).
- `grep -c 'typeof o.wipIndicatorPath !== "string"' src/ui/branding/branding-fetch.ts` → **1** (must_haves.truths[2] and acceptance criterion = 1 satisfied).
- Line ordering in branding-fetch.ts guard: `faviconPath` (L52) < `wipIndicatorPath` (L53) < `pwaIcons` (L54) — strictly increasing, order matches type declaration.
- Frontend `BrandingConfig` type declaration order (L51–L68) === backend `BrandingConfig` type declaration order (L41–L61): `appName, shortName, iconPath, wordmarkPath, faviconPath, wipIndicatorPath, pwaIcons, avatarDirectorSpec, avatarGammaDefault` — visually confirmed identical.
- Byte-for-byte sentinel cross-check:
  - Frontend `src/ui/branding/branding-store.ts:85` — `wipIndicatorPath: "/branding/wip-cube.webp"`
  - Backend `src/backend/branding/branding-config-loader.ts:86` — `wipIndicatorPath: "/branding/wip-cube.webp"`
  - Bundled `docker/branding-defaults/branding.json` — `.wipIndicatorPath == "/branding/wip-cube.webp"` (jq/python confirmed)
  - All three strings identical.
- `npx tsc --noEmit` → **exit 0**, no errors of any kind (BrandingConfig-related or otherwise). must_haves.truths[3] satisfied.
- `npx vitest run src/ui/branding/` → **No test files found** (expected — 82-CONTEXT.md § Test surface locks "No new test file needed"; the frontend `src/ui/branding/` folder has no existing test files, and the plan does not mandate adding any).
- Signature preservation grep: `export function publishBrandingConfig`, `export function useBrandingConfig`, `export function __resetForTest`, `function subscribe`, `function notify`, `export async function fetchBrandingConfig` all present at expected line positions with unchanged signatures.
- Anti-pattern comment "DO NOT introduce a React Context provider" — 1 occurrence, present verbatim (unchanged).
- Phase 74 fields un-validated in isBrandingConfig — `grep -c 'avatarDirectorSpec\|avatarGammaDefault' src/ui/branding/branding-fetch.ts` → **0** (unchanged from baseline; scope-fence honored).

## Decisions Made

None beyond what was already locked in 82-CONTEXT.md and pre-specified in the plan. Two clarifying notes:

- **Scoped test discipline:** Per fleet directive and 82-CONTEXT.md § Test surface, no new frontend test file was added; the plan's automated verification is `npx tsc --noEmit`. `npx vitest run --related` is not supported on this vitest version (4.1.8 rejects the flag), so fell back to `npx vitest run src/ui/branding/` (targeted path). No test files exist in that folder — outcome matches expectation.
- **Byte-for-byte invariant enforcement:** Cross-file grep + jq cross-check performed manually in the verification step above; matches Phase 70 D-14 rule and 82-CONTEXT.md § Bundled default value LOCKED contract.

## Deviations from Plan

None — plan executed exactly as written. Zero deviation rules triggered. No auth gates. No checkpoints. No package installs. No architectural changes. No follow-up bounties.

## Threat Register Compliance

| Threat ID   | Disposition | Mitigation Verified                                                                                                                                                                                                                                                                                     |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-82-03-01  | mitigate    | `isBrandingConfig` now rejects responses missing or carrying non-string `wipIndicatorPath` (branding-fetch.ts L53). Store retains bundled-default sentinel (`"/branding/wip-cube.webp"`) via `publishBrandingConfig` not being called on shape-guard failure. WipBubble (post-Plan-82-04) never sees `<img src={undefined}>`. |
| T-82-03-02  | mitigate    | Frontend sentinel value `"/branding/wip-cube.webp"` (branding-store.ts L85) === backend HARDCODED_FALLBACK L86 === bundled JSON `.wipIndicatorPath` — cross-file grep + jq/python confirmed byte-for-byte agreement in the verification section above.                                                    |
| T-82-03-03  | accept      | `wipIndicatorPath` is a public URL path — matches existing disposition for `iconPath` / `wordmarkPath` / `faviconPath` (Phase 70 T-70-03-04). No PII, no credentials.                                                                                                                                    |
| T-82-03-SC  | accept      | Zero new npm installs in this plan. `git status` shows only the two touched source files staged; `package.json` / `package-lock.json` untouched.                                                                                                                                                          |

## Issues Encountered

None — clean execution.

## User Setup Required

None — no external service configuration required for this plan. Operator workflow for supplying a custom WIP indicator image is documented in 82-CONTEXT.md § Operator workflow and lands operationally after Plan 82-04.

## Next Phase Readiness

- Plan 82-04 (`WipBubble.tsx` rewire) is unblocked: can import `useBrandingConfig` from `@/branding/branding-store`, read `wipIndicatorPath`, and pass it as `<img src={wipIndicatorPath}>` with a compile-time guarantee that the value is a `string` from tick 0.
- Wire-format contract intact: `/api/branding` publishes the whole extended `BrandingConfig`; a shape mismatch between backend and frontend would now surface as a TypeScript compile error at the `publishBrandingConfig(json)` call site in `branding-fetch.ts` — the invariant is enforced by construction.
- No blockers or concerns for downstream plans.

## Known Stubs

None. This plan is pure schema mirror + shape-guard extension — no UI rendering yet, no placeholder data, no unwired data sources. The frontend consumer (WipBubble) rewire lands in Plan 82-04.

## Self-Check: PASSED

Verified before writing this section:

- File `src/ui/branding/branding-store.ts` exists and contains `wipIndicatorPath` (2 references — type + sentinel).
- File `src/ui/branding/branding-fetch.ts` exists and contains `wipIndicatorPath` (1 reference — guard branch).
- Commit `cffb751a` (feat 82-03 type + sentinel) present in `git log --oneline`.
- Commit `57fce264` (feat 82-03 shape guard) present in `git log --oneline`.
- Backend field order (branding-config-loader.ts L42-61) === frontend field order (branding-store.ts L51-68).
- Byte-for-byte cross-file sentinel value agreement confirmed via grep + jq/python.
- `npx tsc --noEmit` exit 0.

---
*Phase: 82-branding-config-wip-indicator-image-overridable*
*Completed: 2026-09-07*
