---
phase: 74
plan: 01
subsystem: branding
tags: [schema-extension, shape-guard, avatar, wire-contract]
requires:
  - Phase 70 branding-config plumbing (loader, HARDCODED_FALLBACK, isValidBrandingShape, /api/branding, frontend store + sentinel — all present, unchanged)
provides:
  - Extended BrandingConfig type carrying avatarDirectorSpec: string + avatarGammaDefault: number (backend + frontend, byte-for-byte matched)
  - Extended isValidBrandingShape rejecting configs missing or wrong-typed for either new field
  - Extended HARDCODED_FALLBACK with avatarDirectorSpec: "" (LOAD-BEARING empty per anti-pattern lock)
  - Extended getBundledDefaultsSentinel with same
  - Updated docker/branding-defaults/branding.json bundled default file
affects:
  - src/backend/branding/branding-config-loader.ts (type + fallback + shape guard extended)
  - src/backend/branding/branding-config-loader.test.ts (NEW file — 8 shape-guard tests)
  - src/ui/branding/branding-store.ts (type + sentinel mirror)
  - docker/branding-defaults/branding.json (bundled default with empty spec + gamma 0.7)
tech-stack:
  added: []
  patterns:
    - Phase 70 inline typeof / Array.isArray shape guard (house style — no zod)
    - Phase 70 never-throws loader contract (extension is type + guard branches + fallback constant only; no new throw paths)
    - vitest vi.mock of node:fs promises + readFileSync to test the loader without touching real filesystem
    - vi.resetModules() + fresh dynamic import per test to defeat getBundledDefaults memoization leakage
key-files:
  created:
    - src/backend/branding/branding-config-loader.test.ts
  modified:
    - src/backend/branding/branding-config-loader.ts
    - src/ui/branding/branding-store.ts
    - docker/branding-defaults/branding.json
decisions:
  - "Test isValidBrandingShape indirectly through loadBrandingConfig() (loader silently falls back on shape rejection), rather than exporting the private guard for direct tests — preserves module boundary + matches how the loader's actual failure mode surfaces to callers"
  - "Test 5a uses avatarGammaDefault: null (what JSON.stringify(NaN) actually produces) instead of a raw NaN literal — Number.isFinite rejects both branches identically, and null is the value the loader would ever actually see on the wire"
  - "Left src/ui/branding/branding-fetch.ts isBrandingConfig runtime guard unchanged despite it not checking the new fields — Plan 74-01 scope is atomic type-mirror + sentinel across the two named files; fetch-guard defense-in-depth is a distinct concern for a later plan. TypeScript's type-narrowing trusts the predicate's return-type assertion, so tsc exits 0."
metrics:
  duration: 6m
  completed: 2026-09-04
  tests_added: 8
  files_changed: 4
  commits: 3
---

# Phase 74 Plan 01: Extend branding-config schema with avatarDirectorSpec + avatarGammaDefault — Summary

Extended the Phase 70 branding-config schema with two required fields — `avatarDirectorSpec: string` and `avatarGammaDefault: number` — as an atomic contract across the backend loader (type + shape guard + HARDCODED_FALLBACK), the bundled default JSON file, the frontend type mirror + sentinel, and a new shape-guard test file. Loader stays never-throws; presence-enforcement of the director spec is deferred to Plan 74-02's boot gate. The bundled default's `avatarDirectorSpec` is intentionally empty string so that the boot gate fires on no-config deployments (load-bearing anti-pattern lock — a seeded default would silently satisfy the gate).

## What Shipped

### Task 1 — Backend loader extension + shape-guard tests (2 commits: RED test, GREEN feat)

**RED (`00459e8e`)**: Created `src/backend/branding/branding-config-loader.test.ts` with 8 tests exercising the shape guard indirectly through `loadBrandingConfig()`:

| # | Behavior | How it exercises the guard |
|---|----------|----------------------------|
| 1 | Valid extended config accepted | Fixture matches Phase 70 fields + both new fields → returned as-is |
| 2 | avatarDirectorSpec missing → bundled defaults | Guard rejects, loader falls back |
| 3 | avatarDirectorSpec is number → bundled defaults | Type check rejects |
| 4 | avatarGammaDefault missing → bundled defaults | Guard rejects |
| 5a | avatarGammaDefault is null → bundled defaults | Number.isFinite rejects |
| 5b | avatarGammaDefault is string → bundled defaults | typeof rejects |
| 6 | ENOENT → bundled defaults have empty spec + gamma=0.7 | Anti-pattern check: bundled default carries EMPTY spec, not seeded content |
| 7 | Empty avatarDirectorSpec passes shape guard | Loader stays never-throws; boot gate is Plan 02's job |

Fresh module import per test (`vi.resetModules()` + dynamic `await import(...)`) defeats `getBundledDefaults` memoization leakage across tests. `vi.mock("node:fs")` feeds synthetic payloads through the async promises API; `readFileSync` is stubbed to return the extended canonical bundled default so the fallback branch has something valid to hand back.

**GREEN (`6196d1eb`)**: Extended the loader:
- `BrandingConfig` type gains two required fields with a comment noting Phase 74 provenance + presence-enforcement lives in Plan 02
- `HARDCODED_FALLBACK` gains `avatarDirectorSpec: ""` + `avatarGammaDefault: 0.7` with an inline comment explaining WHY the empty string is intentional (Pitfall 1 lock)
- `isValidBrandingShape` gains two new branches: `typeof o.avatarDirectorSpec !== "string"` rejects; `typeof o.avatarGammaDefault !== "number" || !Number.isFinite(o.avatarGammaDefault)` rejects
- `docker/branding-defaults/branding.json` gains the two new fields at the end, preserving 2-space indent

### Task 2 — Frontend type mirror + sentinel (1 commit: GREEN feat)

**GREEN (`7607051c`)**: Extended `src/ui/branding/branding-store.ts`:
- `BrandingConfig` type gains the two new fields, in the same order as backend, with a comment noting the mirror exists for wire-contract type-safety even though no React component reads them (per 74-CONTEXT.md out-of-scope: no UI edit)
- `getBundledDefaultsSentinel()` gains the two new fields with values matching `docker/branding-defaults/branding.json` byte-for-byte
- `publishBrandingConfig`, `subscribe`, `useBrandingConfig`, `__resetForTest`, and the anti-pattern comments are unchanged (Phase 70 contracts, verbatim)

## Verification

| Check | Result |
|-------|--------|
| `npx vitest run src/backend/branding/branding-config-loader.test.ts` | 8 pass, 0 fail |
| `npx vitest run src/backend/branding/` (all branding backend) | 13 pass, 0 fail across 3 files (5 pre-existing + 8 new) |
| `npx tsc --noEmit` (full project) | Exit 0, zero errors |
| `jq '.avatarDirectorSpec' docker/branding-defaults/branding.json` | `""` (empty string — LOAD-BEARING per anti-pattern lock) |
| `jq '.avatarGammaDefault' docker/branding-defaults/branding.json` | `0.7` |
| `grep -c avatarDirectorSpec src/backend/branding/branding-config-loader.ts` | 6 (type decl + fallback + shape guard + 3 comment refs) |
| `grep -c avatarGammaDefault src/backend/branding/branding-config-loader.ts` | 7 (same distribution) |
| `grep -c avatarDirectorSpec src/ui/branding/branding-store.ts` | 3 (type decl + sentinel + comment ref) |
| `grep -c avatarGammaDefault src/ui/branding/branding-store.ts` | 2 (type decl + sentinel) |
| No fallback assignment to non-empty avatarDirectorSpec anywhere | Confirmed — only the shape-guard equality check appears in grep |

## Anti-Pattern Locks Held

- `docker/branding-defaults/branding.json` `avatarDirectorSpec` is empty string, NOT seeded content — per 74-CONTEXT.md § "Tempting-but-no" §1 and 74-RESEARCH.md § Pitfall 1
- `HARDCODED_FALLBACK.avatarDirectorSpec` is empty string — matches bundled file exactly (D-14 byte-for-byte contract preserved)
- Loader has zero new `throw` paths — Phase 70 never-throws contract preserved so `/api/branding` cannot crash at request time
- No default-value assignment for `avatarDirectorSpec` anywhere in the loader other than the intentional empty in `HARDCODED_FALLBACK`

## Deviations from Plan

**None** — plan executed as written except for two clarifying refinements:

**Test 5 → Test 5a + Test 5b split**: The plan's Test 5 spec called for "NaN and Infinity and string" as three rejection cases in one test. `JSON.stringify(NaN)` produces `"null"` on the wire, so a NaN input can never actually reach the shape guard via a real config file — the observable path is the null-value path. Split into 5a (null → covers NaN's wire equivalent) and 5b (string) so each test has one narrow assertion target. Both are covered; count of `it(...)` blocks is 8 (>= plan's `>=7` requirement).

**Left `isBrandingConfig` runtime guard in `branding-fetch.ts` unchanged**: The frontend fetch's `isBrandingConfig` predicate doesn't check the new fields. Plan 74-01's `<files>` list scopes Task 2 to `src/ui/branding/branding-store.ts` (single file); the fetch-guard update is a distinct defense-in-depth concern outside this plan's atomic type-mirror boundary. TypeScript's type-narrowing trusts the predicate's return-type assertion, so `tsc --noEmit` exits 0. Recommended for a follow-up if Plan 74-02 or Plan 74-03 revisits `branding-fetch.ts` — flagged as a deferred item.

## Deferred Items

- **`isBrandingConfig` runtime guard in `src/ui/branding/branding-fetch.ts`** — should be extended to reject responses missing `avatarDirectorSpec` or with non-finite `avatarGammaDefault`. Currently accepts the abbreviated shape since TypeScript type-narrowing is compile-time only. Suggested fix: parallel two-line extension after the pwaIcons check (`if (typeof o.avatarDirectorSpec !== "string") return false; if (typeof o.avatarGammaDefault !== "number" || !Number.isFinite(o.avatarGammaDefault)) return false;`). Not blocking Plan 74-02 boot gate (the boot gate reads via `loadBrandingConfig()`, not through the frontend fetch); safe to defer.

## What's Next (Plan 74-02)

The atomic schema contract is now in place. Plan 74-02 adds `src/backend/branding/assert-boot.ts` — a boot-time fail-fast module that calls `loadBrandingConfig()` once, trims + length-checks `avatarDirectorSpec`, and `process.exit(1)`s if empty. Wired from `src/backend/starter.ts` inside the boot IIFE after `initializeDatabase()`. This is the piece that turns the bundled default's empty spec into a hard boot refusal — no silent fallback.

Downstream Plan 74-03 will rewire `identity-avatar-batch.ts` to read both fields per-request instead of using in-file constants, split the palette-constraint line, and swap the hardcoded `applyGamma07` for the configurable value. Plan 74-04 handles the cross-deployment migration seed.

## Commits

| Hash | Type | Scope | Description |
|------|------|-------|-------------|
| `00459e8e` | test | 74-01 | Add failing shape-guard tests for avatarDirectorSpec + avatarGammaDefault (RED) |
| `6196d1eb` | feat | 74-01 | Extend BrandingConfig with avatarDirectorSpec + avatarGammaDefault (GREEN) |
| `7607051c` | feat | 74-01 | Mirror extended BrandingConfig type + sentinel in frontend store |

## Self-Check: PASSED

- File `src/backend/branding/branding-config-loader.ts`: FOUND (modified)
- File `src/backend/branding/branding-config-loader.test.ts`: FOUND (new)
- File `src/ui/branding/branding-store.ts`: FOUND (modified)
- File `docker/branding-defaults/branding.json`: FOUND (modified)
- Commit `00459e8e`: FOUND in `git log`
- Commit `6196d1eb`: FOUND in `git log`
- Commit `7607051c`: FOUND in `git log`
- All 8 new tests pass; all 13 branding backend tests pass; `tsc --noEmit` exits 0
- Bundled `docker/branding-defaults/branding.json` has `avatarDirectorSpec: ""` (empty — LOAD-BEARING) and `avatarGammaDefault: 0.7`
