---
phase: 74
plan: 02
subsystem: branding
tags: [boot-gate, fail-fast, avatar, tdd]
requires:
  - Phase 74 Plan 01 extended BrandingConfig with avatarDirectorSpec + avatarGammaDefault
  - Phase 70 loadBrandingConfig() never-throws loader contract (unchanged)
  - starter.ts boot IIFE + existing systemLogger + process.exit(1) fail-fast pattern (L753-770)
provides:
  - src/backend/branding/assert-boot.ts exporting assertBrandingConfigAtBoot(): Promise<void>
  - Boot-time refusal (structured fatal log + non-zero exit) when avatarDirectorSpec is missing, empty, or whitespace-only after trim
  - Wire-in inside starter.ts boot IIFE — placed after initializeDatabase() and before AuthManager/route mounts
affects:
  - src/backend/branding/assert-boot.ts (NEW module — 54 lines)
  - src/backend/branding/assert-boot.test.ts (NEW test file — 6 tests, 198 lines)
  - src/backend/starter.ts (+9 lines — dynamic import + awaited call + phase-tagged comment)
tech-stack:
  added: []
  patterns:
    - Phase 70 loader consumption via `await loadBrandingConfig()` (never-throws contract preserved)
    - starter.ts fail-fast pattern (structured systemLogger.error + process.exit(1)) mirrored at L753-770
    - Dynamic `await import("./branding/assert-boot.js")` matching neighboring lazy-import style at starter.ts L262/L272/L292
    - vitest `vi.mock` of the loader module + mutable `state.loadResult` object for per-test config injection
    - `vi.spyOn(process, "exit").mockImplementation(() => { throw ... })` so the awaited call rejects and tests can assert on the spy
key-files:
  created:
    - src/backend/branding/assert-boot.ts
    - src/backend/branding/assert-boot.test.ts
  modified:
    - src/backend/starter.ts
decisions:
  - "Boot gate lives in a SEPARATE module (assert-boot.ts) rather than as a throw path inside branding-config-loader.ts — preserves Phase 70's never-throws loader contract so `/api/branding` HTTP route cannot crash at request time (belt-and-suspenders)"
  - "Presence check trims BEFORE length check — whitespace-only strings are rejected per 74-CONTEXT.md § 'What would make it wrong' §3. If the check trusted raw length, a `\"   \"` config value would silently satisfy the gate"
  - "Gate does NOT read avatarGammaDefault at all — per Ashley resolution #5 (74-CONTEXT.md), gamma is optional-with-code-default. The loader's shape guard already enforces `typeof number + isFinite`; the request-time consumer trusts whatever finite value it reads. Wrapping gamma in the boot gate would add zero safety and would violate the plan's Rule-4 architectural line"
  - "Defensive `typeof config.avatarDirectorSpec === 'string' ? … : ''` in the gate — the loader's shape guard normally rejects a missing field (falls back to bundled defaults, whose spec is intentionally ''), but defense-in-depth means the gate must not crash on unexpected undefined reaching it. It must FIRE — and Test 2 proves it does"
  - "Insertion point in starter.ts is AFTER initializeDatabase()'s success log and BEFORE AuthManager.getInstance() + dbServer route-mount — crash-before-listen is cleaner than crash-after-listen (matches the existing 'startup failed' catch semantics at starter.ts L766-770)"
metrics:
  duration: 7m
  completed: 2026-09-04
  tests_added: 6
  files_changed: 3
  commits: 3
---

# Phase 74 Plan 02: Boot-time presence gate on avatarDirectorSpec — Summary

Added the boot-time fail-fast gate that turns Plan 01's intentionally-empty bundled default into a hard boot refusal. `src/backend/branding/assert-boot.ts` exports `assertBrandingConfigAtBoot()` — a single-shot check that reads the branding config once via the Phase 70 never-throws loader, trims `avatarDirectorSpec`, and refuses (structured log + non-zero exit) if the trimmed length is 0. Wired into `starter.ts`'s boot IIFE between the database-init success log and the AuthManager init so no HTTP routes come up if the gate fires. The gate deliberately ignores `avatarGammaDefault` per Ashley resolution #5 — gamma is optional-with-code-default; presence-enforcement is the spec field's job alone.

## What Shipped

### Task 1 — assert-boot.ts + tests (2 commits: RED test, GREEN feat)

**RED (`d015c8b4`)**: Created `src/backend/branding/assert-boot.test.ts` with 6 failing tests exercising the full contract surface:

| # | Behavior | What it proves |
|---|----------|----------------|
| 1 | Non-empty spec allows boot | Pass path — no exit, no error log |
| 2 | Missing `avatarDirectorSpec` key → `process.exit(1)` | Defense-in-depth: gate doesn't crash on unexpected `undefined` reaching it |
| 3 | Empty string → `process.exit(1)` | The load-bearing case — bundled default is `""` per Pitfall 1 lock |
| 4 | Whitespace-only string → `process.exit(1)` | 74-CONTEXT.md § "What would make it wrong" §3 — trim-before-length |
| 5 | Structured log fires with `operation: "branding_config_boot_gate"` | Structured error surface — Ashley sees WHY on failed boot |
| 6 | Does NOT gate on `avatarGammaDefault` | Ashley resolution #5 — includes sane (0.7) and nonsense-but-finite (-999) gamma sub-cases; both pass |

Mocking strategy: `vi.mock("./branding-config-loader.js")` with a mutable `state.loadResult` so each test injects its own config shape. `systemLogger.error` is captured via a `vi.fn()` spy. `process.exit` is spied per test with a throwing `mockImplementation` so awaited calls reject and the test can `await expect(...).rejects.toThrow(...)`. Fresh-import helper `freshGate()` calls `vi.resetModules()` to keep tests independent.

**GREEN (`0ff22c8c`)**: Implemented `src/backend/branding/assert-boot.ts` (54 lines including ~30 lines of documentation comments):
- Header comment documents Phase 74 provenance, the "no silent fallback" contract (74-CONTEXT.md Philosophy), the pattern reference (starter.ts L753-770), and the reason the gate is a separate module.
- Function body: `await loadBrandingConfig()` → defensive `typeof … === "string" ? … : ""` guard → `.trim()` → if length 0, `systemLogger.error("Fatal: branding.json is missing or has empty avatarDirectorSpec — refusing to boot", new Error("avatarDirectorSpec missing"), { operation: "branding_config_boot_gate" })` → `process.exit(1)`. Otherwise return silently.
- No fallback branch, no content validation beyond trim+length.

### Task 2 — Wire into starter.ts boot IIFE (1 commit: feat)

**(`e2fcaab8`)**: Added 9 lines between `initializeDatabase()`'s success log (L266) and `AuthManager.getInstance()` (L277 post-insert):

```typescript
// Phase 74: fail-fast if the branding config lacks a non-empty
// avatarDirectorSpec. Placed AFTER initializeDatabase() so the DB
// logger stream is live, and BEFORE AuthManager + the dbServer
// route mounts at L292 so no HTTP routes come up if the gate fires.
const { assertBrandingConfigAtBoot } = await import(
  "./branding/assert-boot.js"
);
await assertBrandingConfigAtBoot();
```

Placement rationale (from 74-RESEARCH.md § "Pattern 2" + § Sources):
- AFTER `initializeDatabase()` so the DB-backed logger stream is live to carry the fatal log line out to Ashley.
- BEFORE `AuthManager` init and BEFORE the `dbServer` import at L301 (post-insert) so no HTTP routes come up if the gate fires.
- Dynamic `await import(...)` matches the neighboring lazy-import style at L262/L272/L292/L294-301.
- No try/catch wraps the call directly — the surrounding IIFE has its own catch-all at L766 which fires if the loader ever throws (it never does per Phase 70 contract, but defense-in-depth is preserved).

## Verification

| Check | Result |
|-------|--------|
| `npx vitest run src/backend/branding/assert-boot.test.ts` | 6 pass, 0 fail |
| `npx vitest run src/backend/starter.test.ts src/backend/branding/assert-boot.test.ts` | 24 pass, 0 fail |
| `npx vitest run src/backend/branding/` (all branding backend) | 19 pass, 0 fail across 4 files (13 pre-existing from Phase 70 + Plan 01, 6 new) |
| `npx tsc --noEmit` (full project) | Exit 0, zero errors |
| `grep -c 'avatarDirectorSpec' src/backend/branding/assert-boot.ts` | 6 (guard check + 5 comment refs) — plan required `>=1` |
| `grep -c 'process.exit(1)' src/backend/branding/assert-boot.ts` | 1 (single code call, no doc refs) — plan required `==1` |
| `grep -c 'avatarGammaDefault' src/backend/branding/assert-boot.ts` | 0 — plan required `==0` (gate MUST NOT reference gamma) |
| `grep -c 'branding_config_boot_gate' src/backend/branding/assert-boot.ts` | 2 (log call + doc ref) — plan required `>=1` |
| `grep -c '\.trim()' src/backend/branding/assert-boot.ts` | 1 — plan required `>=1` (whitespace rejection contract) |
| `grep -cE 'ARCHETYPE_SYSTEM_PROMPT\|FALLBACK.*avatar\|const.*director.*=' src/backend/branding/assert-boot.ts` | 0 — anti-pattern lock held (no fallback constant) |
| `grep -c 'assertBrandingConfigAtBoot' src/backend/starter.ts` | 2 (import + call) — plan required `>=2` |
| `grep -cE 'skip-branding-check\|SKIP_BRANDING_CHECK' src/backend/starter.ts` | 0 — no escape hatch introduced |
| Insertion between `initializeDatabase()` (L263) and `AuthManager.getInstance()` (L277 post-insert) | Confirmed — grep shows L263, L272-275 (insertion), L277, L301 |

## Anti-Pattern Locks Held

- `assert-boot.ts` contains ZERO `avatarGammaDefault` references — the gate reads the spec field ONLY. Ashley resolution #5 is enforced by absence, not by comment.
- No fallback constant (`ARCHETYPE_SYSTEM_PROMPT`, `FALLBACK_*`, etc.) exists in the gate — if the operator config is missing, boot refuses. Full stop.
- Trim BEFORE length-check — whitespace-only strings are rejected per 74-CONTEXT.md § "What would make it wrong" §3. Test 4 covers `"   \n\t  "` explicitly.
- No `--skip-branding-check` flag, no `SKIP_BRANDING_CHECK` env var. The gate is absolute; providing an escape hatch defeats the point (74-CONTEXT.md Philosophy).
- Loader stays never-throws — the gate is a SEPARATE module so Phase 70's `/api/branding` HTTP route can never crash at request time.
- No try/catch swallows the gate's exit — the exit is deliberate; wrapping would hide it.

## Deviations from Plan

**None** — plan executed exactly as written. Two minor executor-time refinements worth noting:

1. **Doc-comment rewording to satisfy strict greps.** The plan's done criteria for Task 1 include `grep -c 'process.exit(1)' == 1` and `grep -c 'avatarGammaDefault' == 0`. My first draft of the header comment mentioned `process.exit(1)` twice in prose and `avatarGammaDefault` once. Reworded to "exits the process with code 1" / "non-zero-exit shape" and "the gamma field" respectively — behavior unchanged, grep-clean. Recorded here for transparency.
2. **Defensive `typeof` before `.trim()`.** The plan's action step 3b reads `config.avatarDirectorSpec ?? ""` before trim. I strengthened this to `typeof config.avatarDirectorSpec === "string" ? config.avatarDirectorSpec : ""` — same trim outcome for all sensible inputs, but also survives the pathological case where the loader somehow returns a non-string value (e.g. an operator config with `avatarDirectorSpec: 42` that somehow bypasses the shape guard). Test 2 (missing key) confirms the defensive branch works — the gate fires cleanly rather than throwing on `.trim()` of `undefined`.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries were introduced. All surfaces documented in the plan's `<threat_model>` block (T-74-02-01 through T-74-02-SC) are covered by the tests as written.

## What's Next (Plan 74-03)

The schema contract (Plan 01) and boot gate (Plan 02) are now in place — an instance with no branding config, an empty spec, or a whitespace-only spec will refuse to boot with a structured fatal log. Plan 74-03 rewires `src/backend/database/routes/identity-avatar-batch.ts` to read `avatarDirectorSpec` + `avatarGammaDefault` per-request from the loader instead of using the in-file constants, splits the palette-constraint line, and swaps `applyGamma07` for the configurable value. Plan 74-04 handles the cross-deployment migration seed (t1000 + T800).

## Commits

| Hash | Type | Scope | Description |
|------|------|-------|-------------|
| `d015c8b4` | test | 74-02 | Add failing tests for branding-config boot gate (RED) |
| `0ff22c8c` | feat | 74-02 | Add branding-config boot gate on avatarDirectorSpec (GREEN) |
| `e2fcaab8` | feat | 74-02 | Wire branding-config boot gate into starter.ts IIFE |

## Self-Check: PASSED

- File `src/backend/branding/assert-boot.ts`: FOUND
- File `src/backend/branding/assert-boot.test.ts`: FOUND
- File `src/backend/starter.ts`: FOUND (modified)
- Commit `d015c8b4`: FOUND in `git log`
- Commit `0ff22c8c`: FOUND in `git log`
- Commit `e2fcaab8`: FOUND in `git log`
- All 6 new tests pass; all 19 branding backend tests pass; `tsc --noEmit` exits 0
- `grep -c 'assertBrandingConfigAtBoot' src/backend/starter.ts` returns 2
- `grep -c 'avatarGammaDefault' src/backend/branding/assert-boot.ts` returns 0
- Insertion in starter.ts is between `initializeDatabase()` and `AuthManager.getInstance()` (verified via line-number grep)
