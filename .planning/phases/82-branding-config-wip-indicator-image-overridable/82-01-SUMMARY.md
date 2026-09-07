---
phase: 82-branding-config-wip-indicator-image-overridable
plan: 01
subsystem: backend/branding
tags: [branding-config, schema-extension, phase-70-successor, phase-74-pattern]
requires:
  - src/backend/branding/branding-config-loader.ts (Phase 70)
  - src/backend/branding/assert-boot.test.ts (Phase 74 test fixture)
  - docker/branding-defaults/branding.json (Phase 70)
provides:
  - Backend BrandingConfig type with required wipIndicatorPath: string
  - Extended isValidBrandingShape rejecting missing/non-string wipIndicatorPath
  - HARDCODED_FALLBACK.wipIndicatorPath = "/branding/wip-cube.webp"
  - Bundled default JSON with wipIndicatorPath = "/branding/wip-cube.webp"
  - Test coverage: accept + reject-missing + reject-wrong-type (Tests 8+9)
affects:
  - Plan 82-02 (asset relocation) — will git mv public/wip-cube.webp to docker/branding-defaults/
  - Plan 82-03 (frontend mirror) — will add wipIndicatorPath to frontend BrandingConfig
  - Plan 82-04 (WipBubble rewire) — will read wipIndicatorPath from useBrandingConfig
tech-stack:
  added: []
  patterns:
    - "Atomic schema extension: type + shape guard + HARDCODED_FALLBACK + bundled JSON edited in one plan (Phase 74 precedent)"
    - "TDD RED/GREEN: failing shape-guard tests committed first, then loader + JSON + fixture updates"
    - "Byte-for-byte fallback invariant: HARDCODED_FALLBACK value === bundled JSON value === literal '/branding/wip-cube.webp'"
key-files:
  created: []
  modified:
    - src/backend/branding/branding-config-loader.ts
    - src/backend/branding/branding-config-loader.test.ts
    - src/backend/branding/assert-boot.test.ts
    - docker/branding-defaults/branding.json
decisions:
  - "wipIndicatorPath placed after faviconPath and before pwaIcons (image-URL group per 82-CONTEXT.md § Claude's Discretion)"
  - "Shape guard branch placed after pwaIcons loop and before Phase 74 avatarDirectorSpec branch — field-order in guard matches type declaration"
  - "No boot gate added: bundled default '/branding/wip-cube.webp' IS the fallback (unlike Phase 74's intentionally-empty avatarDirectorSpec)"
  - "assert-boot.test.ts fixture extended for hygiene only — no new tests, no production change to assert-boot.ts"
  - "TDD split into two commits: RED (Tests 8+9 fail) then GREEN (loader + JSON + fixture) so the failing tests are visible in git history before the fix lands"
metrics:
  duration_minutes: 6
  completed_date: 2026-09-07
---

# Phase 82 Plan 01: Extend backend BrandingConfig with wipIndicatorPath Summary

Extended the Phase 70 backend `BrandingConfig` schema with a new required field `wipIndicatorPath: string` — the image-asset half of Phase 82's atomic contract, mirroring Phase 74's `avatarDirectorSpec` extension mechanics but in the image-URL variant (bundled default IS the fallback; no boot gate needed).

## What Was Built

- **`src/backend/branding/branding-config-loader.ts`** — Type declaration gains `wipIndicatorPath: string` between `faviconPath` and `pwaIcons` (image-URL group). `HARDCODED_FALLBACK` carries `wipIndicatorPath: "/branding/wip-cube.webp"`. `isValidBrandingShape` gets one new rejection branch: `if (typeof o.wipIndicatorPath !== "string") return false;` (placed after pwaIcons loop, before Phase 74's avatarDirectorSpec branch — field order in guard matches type declaration).
- **`docker/branding-defaults/branding.json`** — New field `"wipIndicatorPath": "/branding/wip-cube.webp"` inserted between `faviconPath` and `pwaIcons`. Byte-for-byte matches `HARDCODED_FALLBACK` per Phase 70 D-14 no-config-deploy-preserves-behavior rule. Existing `appName: "SKYNET"` uppercase preserved (not normalized).
- **`src/backend/branding/branding-config-loader.test.ts`** — `bundledDefaultJson` mock + `validFixture()` extended with `wipIndicatorPath` so existing Phase 74 Tests 1–7 keep passing. Two new tests added:
  - Test 8: rejects when `wipIndicatorPath` is missing → bundled defaults returned (asserts `cfg.wipIndicatorPath === "/branding/wip-cube.webp"`).
  - Test 9: rejects when `wipIndicatorPath` is a number → bundled defaults returned (asserts BOTH `cfg.wipIndicatorPath` value AND `cfg.pwaIcons.length === 2` — the 2-icon bundled shape distinguishes from validFixture's 1-icon shape).
- **`src/backend/branding/assert-boot.test.ts`** — Local `LoadResult` type + `makeValidLoadResult()` factory extended with `wipIndicatorPath: "/branding/wip-cube.webp"` — pure test-hygiene edit to keep the full-shape fixture valid against the extended backend `BrandingConfig`. No new tests. No change to `assert-boot.ts` production code (Phase 82 explicitly does NOT modify the boot gate per 82-CONTEXT.md § "No boot gate" LOCKED and § "Scope Fence" bullet 1).

## Commits

| Commit     | Type    | Summary                                                        |
| ---------- | ------- | -------------------------------------------------------------- |
| `7439240d` | test    | RED — Tests 8 + 9 fail against unextended shape guard + mock  |
| `c4cadd0a` | feat    | GREEN — type + fallback + guard branch + JSON + fixture edits |
| `1f9772b4` | test    | assert-boot.test.ts fixture-hygiene extension                  |

## Verification Results

- `npx vitest run src/backend/branding/branding-config-loader.test.ts` → **10 passed** (8 existing Phase 74 + 2 new Phase 82). exit 0.
- `npx vitest run src/backend/branding/assert-boot.test.ts` → **6 passed** (all pre-existing tests unchanged). exit 0.
- Combined scoped run: **16 passed / 0 failed**. exit 0.
- `jq -e '.wipIndicatorPath == "/branding/wip-cube.webp"' docker/branding-defaults/branding.json` → exit 0.
- `grep -c 'wipIndicatorPath' src/backend/branding/branding-config-loader.ts` → **4** (type + fallback + guard branch + guard comment; ≥3 required).
- Non-comment `grep -c '^\s*wipIndicatorPath' src/backend/branding/branding-config-loader.ts` → **2** (type + fallback; ≥2 required).
- `grep -c 'wipIndicatorPath' src/backend/branding/branding-config-loader.test.ts` → **11** (≥5 required).
- `grep -c 'wipIndicatorPath' src/backend/branding/assert-boot.test.ts` → **2** (LoadResult + factory; ≥2 required).
- All 8 pre-existing Phase 74 tests in loader test file (Tests 1, 2, 3, 4, 5a, 5b, 6, 7) still present verbatim.
- All 6 pre-existing tests in assert-boot.test.ts still present verbatim.
- `git status --short src/backend/branding/assert-boot.ts` → empty (production boot gate untouched).
- Baseline `grep -c 'it('` in assert-boot.test.ts = 9 → post-change count = 9 (no new `it(...)` blocks).

## TDD Gate Compliance

Plan 82-01 followed the RED/GREEN cycle for Task 1 explicitly:

- **RED (commit `7439240d`)**: Added Tests 8 + 9 with no other changes. Ran `npx vitest run src/backend/branding/branding-config-loader.test.ts` → 2 failed / 8 passed. Failures observed at the exact assertions (`expect(cfg.wipIndicatorPath).toBe("/branding/wip-cube.webp")` — got `undefined` in Test 8, got `42` in Test 9), confirming (a) the shape guard did not yet reject the missing/wrong-type field and (b) the bundled default did not yet carry the field. Fail-fast rule: no unexpected passes; RED was genuine.
- **GREEN (commit `c4cadd0a`)**: Loader type + fallback + guard branch + JSON edit + test file fixture/mock updates landed together in one commit (all interlocked — bundled JSON mock must have the field for `getBundledDefaults()` to succeed, `validFixture()` must have the field for existing tests 1–7 to keep passing, guard must reject for Tests 8+9 to observe bundled-defaults substitution). Ran scoped verify → 10/10 pass. exit 0.

Task 2 (`1f9772b4`) is a fixture-hygiene edit, not a new behavior — no TDD cycle required (no assertion on the new field, just keeping the local `LoadResult` type + factory in shape with the extended backend `BrandingConfig`).

## Deviations from Plan

None — plan executed exactly as written. Zero deviation rules triggered. No auth gates. No checkpoints. No follow-up bounties. No architectural changes. No package installs.

## Threat Register Compliance

| Threat ID   | Disposition | Mitigation Verified                                                                                                                                                              |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-82-01-01  | mitigate    | Extended `isValidBrandingShape` rejects `wipIndicatorPath: 42` (Test 9); loader returns bundled defaults carrying valid string. WipBubble (post-Plan-82-04) never sees bad src. |
| T-82-01-02  | mitigate    | `HARDCODED_FALLBACK.wipIndicatorPath === "/branding/wip-cube.webp"` byte-for-byte matches `wipIndicatorPath` in `docker/branding-defaults/branding.json`. jq verified.          |
| T-82-01-03  | accept      | wipIndicatorPath is a public URL path — matches existing disposition for iconPath / wordmarkPath / faviconPath. No PII. No credentials.                                        |
| T-82-01-SC  | accept      | Zero new package installs in this plan.                                                                                                                                          |

## Downstream Handoff

- **Plan 82-02**: File-move plan — will `git mv public/wip-cube.webp docker/branding-defaults/wip-cube.webp` so the file becomes discoverable at `/app/branding-defaults/wip-cube.webp` inside the container. No overlap with this plan's files.
- **Plan 82-03**: Frontend mirror — will add `wipIndicatorPath: string` to the frontend `BrandingConfig` type in `src/ui/branding/branding-store.ts` + parallel guard in `branding-fetch.ts`. Bundled default value must match this plan's byte-for-byte: `"/branding/wip-cube.webp"`.
- **Plan 82-04**: `WipBubble.tsx` rewire — will import `useBrandingConfig` and use `<img src={wipIndicatorPath}>` in place of hardcoded `/wip-cube.webp` string.

## Ship Status

HEAD `1f9772b4` LOCAL on `feat/tab-title-from-tmux`. Not pushed. Not built. Not deployed. Held at push boundary per fleet no-deploy rule; ship motion (docker build + force-recreate) is orchestrator territory once Phase 82 completes.

## Known Stubs

None. This plan is pure schema extension — no UI-facing rendering, no placeholder data, no unwired data sources. The frontend + WipBubble wiring lands in Plans 82-03 and 82-04.

## Self-Check: PASSED

Verified before writing this section:

- File `src/backend/branding/branding-config-loader.ts` exists and contains `wipIndicatorPath` (4 references).
- File `src/backend/branding/branding-config-loader.test.ts` exists and contains Tests 8 + 9.
- File `src/backend/branding/assert-boot.test.ts` exists and carries `wipIndicatorPath` (2 references).
- File `docker/branding-defaults/branding.json` exists and `jq -e '.wipIndicatorPath == "/branding/wip-cube.webp"'` returns true.
- Commit `7439240d` (test 82-01 RED) present in `git log`.
- Commit `c4cadd0a` (feat 82-01 GREEN) present in `git log`.
- Commit `1f9772b4` (test 82-01 fixture) present in `git log`.
- `src/backend/branding/assert-boot.ts` production code unmodified (empty `git status --short` for that path).
