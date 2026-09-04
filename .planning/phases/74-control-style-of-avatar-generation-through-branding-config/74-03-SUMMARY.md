---
phase: 74
plan: 03
subsystem: branding
tags: [avatar, config-driven, palette-split, gamma, defense-in-depth, tdd]
requires:
  - Phase 74 Plan 01 extended BrandingConfig with avatarDirectorSpec + avatarGammaDefault (loader type + shape guard + HARDCODED_FALLBACK + bundled JSON + frontend mirror)
  - Phase 74 Plan 02 boot gate on avatarDirectorSpec (assertBrandingConfigAtBoot fires process.exit(1) at startup for empty/whitespace spec)
  - Phase 70 loadBrandingConfig() never-throws loader contract (unchanged; still used by /api/branding)
provides:
  - POST /identities/avatar/batch reads avatarDirectorSpec + avatarGammaDefault from the branding config at request time via loadBrandingConfig()
  - The drafter chat/completions system message equals config.avatarDirectorSpec verbatim (byte-for-byte, no wrapping)
  - Gamma pipeline uses config.avatarGammaDefault (hardcoded 0.7 removed from the code path)
  - paletteHueLine() emits only the mechanical hue-degree → color-name fact; aesthetic instruction language deleted from code
  - Request-time defense-in-depth 503 guard: empty/whitespace-only avatarDirectorSpec at request time short-circuits before OpenAI is called
  - All three header-comment references to the deleted avatar-flow runbook file are scrubbed
affects:
  - src/backend/database/routes/identity-avatar-batch.ts (-51 / +74 net; ARCHETYPE_SYSTEM_PROMPT constant deleted, paletteConstraintLine split, applyGamma07 parameterized, POST /batch rewired, runbook comments scrubbed)
  - src/backend/database/routes/identity-avatar-batch.test.ts (+179; vi.mock of loader at file top, mockConfig object, 4 new tests, existing tests preserved)
tech-stack:
  added: []
  patterns:
    - Phase 70 loader consumption via `await loadBrandingConfig()` (never-throws contract preserved)
    - Fresh per-request read (matches how OPENAI_API_KEY is read at request time) — preserves Phase 70's hot-swap property
    - Request-time defense-in-depth 503 mirroring the existing OPENAI_API_KEY-missing branch
    - vitest `vi.mock` of the branding-config-loader module with mutable module-scope `mockConfig` (mirrors the existing mockUserId pattern)
    - beforeEach resets mockConfig to non-empty defaults so per-test mutations don't bleed
key-files:
  created: []
  modified:
    - src/backend/database/routes/identity-avatar-batch.ts
    - src/backend/database/routes/identity-avatar-batch.test.ts
decisions:
  - "Split hueName / paletteHueLine into an app-owned mechanical helper (hueName mapping preserved verbatim; paletteHueLine emits ONLY `Identity color hue: X° (reads as Y).`) — the aesthetic instruction language (PALETTE CONSTRAINT paragraph, ±30-degree guidance, don't-default-to-blue caveat) is DELETED from code per 74-CONTEXT.md Philosophy (The app owns mechanics. The config owns instructions.) and D-06"
  - "Parameterized applyGamma(buf, gamma) — old applyGamma07 renamed with hardcoded 0.7 replaced by parameter threaded from config.avatarGammaDefault at the call site. _applyCorrectionForTest signature extended backwards-compatibly to (inputValue, gamma=0.7) so existing Test 4 signature works and new Test 11 can assert on non-default gammas"
  - "Request-time 503 defense-in-depth (Pitfall 2) is NOT a replacement for Plan 02's boot gate — it's belt-and-suspenders for the case where an operator runtime-edits branding.json, introduces a shape violation, and the loader silently reverts to bundled defaults (empty spec) between requests. Uses the same 503 status as the existing OPENAI_API_KEY-missing branch"
  - "NO fallback constant. NO caching of the branding config in module scope. NO `directorSpec || FALLBACK_SPEC` short-circuit. Per 74-RESEARCH.md § Anti-Patterns to Avoid — a stale fallback silently defeats the whole point of moving the aesthetic into the config"
  - "vi.mock of branding-config-loader at file top is LOAD-BEARING (74-RESEARCH.md § Pitfall 4). Without it, tests read the container filesystem (path does not exist in test env), loader falls back to bundled defaults with avatarDirectorSpec='', request-time 503 fires on every /batch test → every existing test breaks. The mock's default state has non-empty spec so existing Tests 1-9 stay GREEN"
metrics:
  duration: 8m
  completed: 2026-09-04
  tests_added: 4
  files_changed: 2
  commits: 2
---

# Phase 74 Plan 03: Rewire avatar-batch route to consume config — Summary

Rewired `POST /identities/avatar/batch` so 100% of its aesthetic content comes from the branding config at request time. The in-file `ARCHETYPE_SYSTEM_PROMPT` constant (16 lines of MOBA-champion / LoL-splash prose) is DELETED — the app owns zero aesthetic content after this ships. A differently-branded instance can now produce entirely different-looking avatars purely by editing `branding.json`, no code deploy required. Split `paletteConstraintLine` so the mechanical hue-to-color-name fact stays app-owned (`hueName` + `paletteHueLine`, injected into every request with a set hue) while the aesthetic instruction language moves out of code entirely — it belongs in the operator-authored `avatarDirectorSpec`. Parameterized `applyGamma07` → `applyGamma(buf, gamma)` so the gamma value flows from `config.avatarGammaDefault` through the sharp pipeline. Added a request-time defense-in-depth 503 guard mirroring the OPENAI_API_KEY-missing pattern. Scrubbed all three header-comment references to the deleted `avatar-flow` runbook file.

## What Shipped

### Task 2 first (TDD RED) — Test file extensions (1 commit: `c323c1bd`)

**RED (`c323c1bd`)**: Modified `src/backend/database/routes/identity-avatar-batch.test.ts`:

- Added `vi.mock("../../branding/branding-config-loader.js", ...)` at file top with a mutable module-scope `mockConfig` object mirroring the existing `mockUserId` pattern. Default state has a non-empty `avatarDirectorSpec` so existing Tests 1-9 stay GREEN once Task 1 lands.
- Added `beforeEach` reset of `mockConfig.avatarDirectorSpec` and `mockConfig.avatarGammaDefault` to defaults so per-test mutations (Tests 12/13 setting empty/whitespace, Test 11 setting custom gamma) don't leak across tests.
- Added 4 new tests exercising the Phase 74 config-driven contract:

| # | Behavior | Assertion |
|---|----------|-----------|
| 10 | Spec verbatim flow | Sets `mockConfig.avatarDirectorSpec = "SENTINEL DIRECTOR SPEC 12345 UNIQUE MARKER — must appear verbatim in the system slot"`; intercepts the outbound fetch to `api.openai.com/v1/chat/completions`; asserts `JSON.parse(body).messages[0].content === SENTINEL_SPEC` byte-for-byte |
| 11 | Gamma-value flow | `_applyCorrectionForTest(128, 0.5)` returns ≈181 (in [179, 183]); `_applyCorrectionForTest(128, 0.7)` returns ≈157 (in [155, 160]); the two values must differ — proves gamma is actually threaded through, not silently ignored |
| 12 | Empty-spec 503 defense | Sets `mockConfig.avatarDirectorSpec = ""`; POST /batch with valid inputs; asserts status === 503, body === `{ error: "avatar generation misconfigured" }`, fetch was NEVER called |
| 13 | Whitespace-only 503 defense | Same as Test 12 but `mockConfig.avatarDirectorSpec = "   \n\t  "` — trims to empty; validates the trim-then-length pattern is applied consistently at request time as well as at boot time |

**RED verification:** After Task 2's test-only commit, `npx vitest run …identity-avatar-batch.test.ts` reported 4 failures (Tests 10, 11, 12, 13) and 18 passes — exactly the expected RED state proving the new tests actually exercise the not-yet-shipped Task 1 contract.

### Task 1 (TDD GREEN) — Source file rewire (1 commit: `86d6cfbe`)

**GREEN (`86d6cfbe`)**: Modified `src/backend/database/routes/identity-avatar-batch.ts`:

1. **Imported `loadBrandingConfig`** alongside the other imports at the top of the file.

2. **Scrubbed the header comment (L1-27 in new file):**
   - "output = input^0.7 per the avatar-flow runbook § 5" → "output = input^gamma per the operator's avatarGammaDefault (from branding config)"
   - Added a paragraph documenting the Phase 74 Plan 03 config-driven pattern

3. **Deleted the `ARCHETYPE_SYSTEM_PROMPT` constant** (16 lines including the 3-line comment block header that referenced the runbook file). The value now lives in the branding config, seeded pre-ship (orchestrator-owned).

4. **Rewrote the gamma-helper comment block** — swapped "Applies gamma 0.7 per the avatar-flow runbook § 5" for "Applies operator-configured gamma per branding config's avatarGammaDefault". Preserved the mechanical explanation of why sharp's `.gamma()` isn't used (sRGB linearization vs. plain power curve — true regardless of gamma value).

5. **Split `paletteConstraintLine` → `paletteHueLine`:**
   - `hueName(hue: number): string` — preserved verbatim (mechanical, app-owned)
   - `paletteHueLine(hue: number | null): string` — new, emits ONLY `\n\nIdentity color hue: ${hue}° (reads as ${hueName(hue)}).` when hue is set; empty string when null
   - The old function's aesthetic instruction language (PALETTE CONSTRAINT paragraph) is DELETED
   - Updated the surrounding comment block to describe the split (mechanical stays / aesthetic lives in config)

6. **Parameterized the gamma helper:**
   - `applyGamma07(buf)` → `applyGamma(buf, gamma)`. Hardcoded 0.7 in `Math.pow(v/255, 0.7)` replaced with `gamma` parameter. Alpha-channel skip logic preserved.
   - `_applyCorrectionForTest(inputValue: number, gamma: number = 0.7): Promise<number>` — signature extended backwards-compatibly so existing Test 4's `_applyCorrectionForTest(128)` still resolves to ≈157 while Test 11 can pass explicit gamma values

7. **Rewired POST /batch handler** — after the OPENAI_API_KEY check and before the archetype-draft fetch:
   ```typescript
   const branding = await loadBrandingConfig();
   const directorSpec = (branding.avatarDirectorSpec ?? "").trim();
   if (directorSpec.length === 0) {
     res.status(503).json({ error: "avatar generation misconfigured" });
     return;
   }
   const gammaValue = branding.avatarGammaDefault;
   ```
   - Replaced `content: ARCHETYPE_SYSTEM_PROMPT` in the fetch body's system message with `content: directorSpec`
   - Replaced `paletteConstraintLine(paletteHue)` in the user message with `paletteHueLine(paletteHue)`
   - Replaced `applyGamma07(pngBuffer)` at the sharp step with `applyGamma(pngBuffer, gammaValue)`

**GREEN verification:** After Task 1's source commit, all 22 tests pass (18 existing + 4 new Phase 74 Test 10-13).

## Verification

| Check | Result |
|-------|--------|
| `npx vitest run src/backend/database/routes/identity-avatar-batch.test.ts` | 22 pass, 0 fail |
| `npx vitest run src/backend/branding/ src/backend/database/routes/identity-avatar-batch.test.ts` | 41 pass, 0 fail across 5 files (19 pre-existing branding + 22 avatar-batch) |
| `npx tsc --noEmit` (full project) | Exit 0, zero errors |
| `grep -c 'ARCHETYPE_SYSTEM_PROMPT' identity-avatar-batch.ts` | 0 (deleted) |
| `grep -c 'MOBA-champion' identity-avatar-batch.ts` | 0 (aesthetic content deleted) |
| `grep -c 'avatar-flow' identity-avatar-batch.ts` | 0 (all 3 runbook refs scrubbed) |
| `grep -c 'PALETTE CONSTRAINT (LOAD-BEARING)' identity-avatar-batch.ts` | 0 (aesthetic instruction language deleted) |
| `grep -c 'loadBrandingConfig' identity-avatar-batch.ts` | 2 (import + call) |
| `grep -c 'paletteHueLine' identity-avatar-batch.ts` | 3 (declaration + call + comment ref) |
| `grep -c 'hueName' identity-avatar-batch.ts` | 3 (declaration + call from paletteHueLine + comment ref) |
| `grep -c 'avatarDirectorSpec' identity-avatar-batch.ts` | 3 (2 comment refs + call-site read) |
| `grep -c 'avatarGammaDefault' identity-avatar-batch.ts` | 4 (3 comment refs + call-site read) |
| `grep -v '^\s*[/*]' identity-avatar-batch.ts \| grep -c 'Math.pow(data\[i\] / 255, 0.7)'` | 0 (hardcoded 0.7 in gamma calc gone) |
| `grep -c 'vi.mock("../../branding/branding-config-loader.js"' identity-avatar-batch.test.ts` | 1 (LOAD-BEARING per Pitfall 4) |
| `grep -c 'mockConfig' identity-avatar-batch.test.ts` | 12 (declaration + 2 beforeEach resets + 6+ test mutations across Tests 10-13) |
| `grep -c 'avatar generation misconfigured' identity-avatar-batch.test.ts` | 2 (Tests 12 + 13 assertion strings) |
| `grep -c 'SENTINEL DIRECTOR SPEC' identity-avatar-batch.test.ts` | 1 (Test 10 unique marker) |
| Test `it(` count | 22 (was 18, +4 new Phase 74 tests — matches plan's `>=3 more`) |
| `grep -E 'avatar-flow\|runbook §' identity-avatar-batch.ts` | empty (all header refs scrubbed) |

## Anti-Pattern Locks Held

- **NO ARCHETYPE_SYSTEM_PROMPT dead code** — grep returns 0. Constant deleted outright per 74-RESEARCH.md § Anti-Patterns to Avoid #1 and Ashley `<additional_context>` load-bearing anti-pattern list.
- **NO fallback constant** — no `FALLBACK_ARCHETYPE`, no `FALLBACK_SPEC`, no `directorSpec || "…"` short-circuit anywhere in the route. Either the route has a real spec or it returns 503; those are the only two paths.
- **NO caching layer** — `await loadBrandingConfig()` is fresh per request. Preserves Phase 70's hot-swap property (operator can edit `branding.json` and next request picks it up). Loader is fast — single small `fs.readFile`.
- **NO aesthetic instruction language in code** — the PALETTE CONSTRAINT paragraph, the ±30-degree guidance, the don't-default-to-blue caveat all live in the operator-authored `avatarDirectorSpec` now (Plan 04's ship-migration seed content, orchestrator-owned).
- **NO trim-optional guard** — the request-time 503 guard trims BEFORE length-check, matching the boot gate's whitespace-rejection contract (74-CONTEXT.md § "What would make it wrong" §3). Test 13 covers `"   \n\t  "` explicitly.
- **vi.mock at file top is LOAD-BEARING** — without it, tests read the container filesystem (nonexistent in test env), loader falls back to bundled defaults with empty spec, and every existing /batch test breaks via the request-time 503. The mock's default state (`avatarDirectorSpec = "TEST DIRECTOR SPEC — not the real thing"`) keeps Tests 1-9 GREEN.

## Deviations from Plan

**None** — plan executed exactly as written. Two minor executor-time notes:

1. **TDD ordering**: The plan lists Task 1 first (source rewire) then Task 2 (test file). Because Task 1 alone would break existing tests (no mock → loader returns bundled defaults with empty spec → request-time 503 fires on every /batch test), I executed Task 2's test additions FIRST as the RED commit (all Phase 74 tests fail against current code), then Task 1's source rewire as the GREEN commit (all 22 tests pass). This is the true TDD RED→GREEN cadence and matches the plan's `tdd="true"` frontmatter on both tasks. Existing Tests 1-9 stayed GREEN through both commits because the mock's default non-empty spec kept them working.

2. **Header-comment rewrite scope**: The plan's Task 1 action step 2 specifies rewriting L15-17 of the file header to reference config-driven gamma. I did that AND added a paragraph on the aesthetic-director spec being config-driven — the second paragraph didn't exist in the plan action list but it's the same category of scrub (documentation kept in sync with the code's new provenance). No functional change; no plan drift.

## Deferred Items

- **`isBrandingConfig` runtime guard in `src/ui/branding/branding-fetch.ts`** — carried forward from Plan 01's deferred list. Frontend fetch's `isBrandingConfig` predicate doesn't check `avatarDirectorSpec` or `avatarGammaDefault`. Plan 74-03's scope is the backend route + its tests, not the frontend fetch. Backend rewire is unaffected because it reads via `loadBrandingConfig()`, not through the frontend fetch. Suggested fix (unchanged from Plan 01): parallel two-line extension after the pwaIcons check.

## Threat Flags

None. All threats documented in the plan's `<threat_model>` block (T-74-03-01 through T-74-03-SC) are covered:

- **T-74-03-01 (prompt-injection via operator config → accepted)** — per 74-CONTEXT.md Philosophy "Trust the admin who writes the branding config". No mitigation implemented; accepted as documented.
- **T-74-03-02 (ARCHETYPE_SYSTEM_PROMPT dead code → mitigate)** — grep confirms 0 occurrences of the constant name AND 0 occurrences of `MOBA-champion` (the aesthetic phrase). Automated verify held.
- **T-74-03-03 (silent revert to bundled defaults on runtime shape violation → mitigate)** — request-time 503 defense is in place; Test 12 covers empty spec via mock; Test 13 covers whitespace-only.
- **T-74-03-04 (test suite silently passes without exercising new contract → mitigate)** — vi.mock at file top; mockConfig with non-empty default keeps existing tests GREEN AND forces the mock to be present.
- **T-74-03-SC (zero new npm/pip installs)** — confirmed via commit diff: only two existing TS files modified.

## What's Next (Plan 74-04)

The route is fully rewired, the boot gate holds, and both existing deployments will refuse to boot if their branding.json lacks a real `avatarDirectorSpec`. Plan 74-04 handles the cross-deployment migration seed — commits `scripts/deploy/branding-seed-example.json` with the LoL-champion director spec + gamma=0.7, drafts the Stacy-briefing DM for T800/AI+, and documents the SSM apply steps for t1000/Skynet so both instances boot cleanly on ship day. Plan 74-04 also handles the `rm` of the local box's `~/.claude/roles/box-maintainer/runbooks/avatar-flow.md` + the 4 avatar-prompts archive files (`amelia.md`, `beatrice.md`, `becky.md`, `george.md`).

## Commits

| Hash | Type | Scope | Description |
|------|------|-------|-------------|
| `c323c1bd` | test | 74-03 | Add loader mock + config-driven assertions to avatar-batch tests (RED) |
| `86d6cfbe` | refactor | 74-03 | Rewire avatar-batch to read director spec + gamma from branding config |

## Self-Check: PASSED

- File `src/backend/database/routes/identity-avatar-batch.ts`: FOUND (modified)
- File `src/backend/database/routes/identity-avatar-batch.test.ts`: FOUND (modified)
- Commit `c323c1bd`: FOUND in `git log`
- Commit `86d6cfbe`: FOUND in `git log`
- All 22 avatar-batch tests pass; all 41 branding-domain tests pass; `tsc --noEmit` exits 0
- `grep -c 'ARCHETYPE_SYSTEM_PROMPT'` on identity-avatar-batch.ts returns 0
- `grep -c 'vi.mock("../../branding/branding-config-loader'` on identity-avatar-batch.test.ts returns 1
- `grep -E 'avatar-flow|runbook §'` on identity-avatar-batch.ts is empty (all three header refs scrubbed)
- `hueName(hue: number): string` still present (mechanical mapping preserved verbatim)
- `PALETTE CONSTRAINT (LOAD-BEARING)` absent (aesthetic instruction language removed)

## TDD Gate Compliance

- RED gate: `c323c1bd` — `test(74-03): add loader mock + config-driven assertions to avatar-batch tests (RED)` ✓
- GREEN gate: `86d6cfbe` — `refactor(74-03): rewire avatar-batch to read director spec + gamma from branding config` ✓
- REFACTOR gate: not needed — GREEN commit is already the minimal shape the plan calls for (constant deleted, split executed, gamma parameterized, guard added). No subsequent cleanup pass improved clarity enough to warrant a separate commit.
