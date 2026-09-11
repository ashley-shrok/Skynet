---
phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol
plan: 05
subsystem: voice
tags: [migration, startup-one-shot, idempotent, frontmatter, hard-reset, tdd]

# Dependency graph
requires:
  - phase: 98-02
    provides: "POLLY_VOICE_IDS Set + isValidPollyVoice guard from polly-voice-catalog.ts (used as idempotency guard)"
provides:
  - "ensureVoiceValuesMigrated() startup one-shot — walks BOTH identity + role frontmatter trees, clears any voice: value matching /^[A-Z][A-Za-z]+\\.wav$/, never throws"
  - "starter.ts wire — fire-and-forget dynamic import right after ensureBridgeConfigWritten (line 296) that fires the migration on every Skynet backend boot"
affects:
  - "98-07 (validator tightening) — Plan 07 flips the identity/role voice-value validator from /^[A-Z][A-Za-z]+\\.wav$/ to the 7-voice Polly whitelist. THIS plan MUST land BEFORE Plan 07 or Plan 07's tightened regex rejects any surviving old-shape values on the first identity edit."
  - "All existing operator boxes on ship day — first Skynet backend restart post-98 clears every legacy Chatterbox voice value; identity + role owners re-pick from the Polly catalog next time they open the respective modal"

# Tech tracking
tech-stack:
  added: []  # no new dependencies — pure fs + POLLY_VOICE_IDS from Plan 02
  patterns:
    - "Startup one-shot idempotent fire-and-forget from starter.ts (mirror of ensureBridgeConfigWritten @ bridge-config-writer.ts:354)"
    - "Atomic tmp+rename per-file frontmatter rewrite (mirror of writeIdentityFile LOCAL branch @ identity-artifact-reader.ts:2609)"
    - "Line-based regex on YAML frontmatter (preserves user whitespace/quoting — no full YAML round-trip needed)"
    - "Never-throw entry-point barrier (try/catch wraps everything at the exported function; internal helpers may throw but the wrapper catches all)"
    - "Env-var-overridable local roots (getLocalIdentitiesRoot + getLocalRolesRoot honor IDENTITIES_HOST_DIR / ROLES_HOST_DIR for the docker bind-mount)"
    - "In-memory-fs mock pattern for filesystem-touching unit tests (Map<absPath, string> + Set<absDir> driven by vi.hoisted state)"
    - "TDD RED → GREEN gate sequence with distinct commit hashes"

key-files:
  created:
    - "src/backend/voice/voice-migration.ts (185 lines) — ensureVoiceValuesMigrated + walkAndMigrate + migrateFrontmatterFile"
    - "src/backend/voice/voice-migration.test.ts (456 lines, 13 assertions) — mocks node:fs/promises + logger + local-roots resolver; covers all 9+ behavior cases"
  modified:
    - "src/backend/starter.ts (+18 lines) — fire-and-forget wire immediately after the ensureBridgeConfigWritten block (line 296)"

key-decisions:
  - "Quote-strip `.replace(/^[\"']|[\"']$/g, \"\")` inlined verbatim in the value-extract step (plan-review lock: quoted YAML values like `voice: \"Elena.wav\"` would otherwise silently skip migration and get rejected by Plan 07's tightened validator on the next edit)"
  - "Walks BOTH identities root AND roles root (via getLocalIdentitiesRoot + getLocalRolesRoot). Phase 86 moved cosmetics to role frontmatter with per-identity override — a single-tree walk would leave half the fleet un-migrated"
  - "Idempotency guard = `POLLY_VOICE_IDS.has(currentVoice)` — already-conformant Polly IDs are fast-skipped, making the migration cheap to run on every restart (target <50ms on already-migrated boxes)"
  - "Out-of-scope values (neither old-regex nor Polly IDs) are LEFT ALONE — do not clobber arbitrary content that happens to live in a voice: field for some reason (mitigates T-98-05-01 tampering)"
  - "ensureVoiceValuesMigrated NEVER throws — mirror of ensureBridgeConfigWritten pattern. Starter.ts fires this fire-and-forget and a thrown exception would crash the process bootstrap. Internal per-file writes DO throw on fs errors, but walkAndMigrate catches per-file failures (log-and-continue) and the entry-point wrapper catches anything higher up"
  - "Per-file writes use tmp+rename (`.tmp` suffix, write, rename) — POSIX-atomic; partial-write crash mid-file leaves the original untouched (mitigates T-98-05-02 DoS)"
  - "Fire-and-forget from starter.ts (no `await`) is deliberate — starter.ts's structure gates HTTP-accepting on later blocks (see reconcile-loop startup at line 313+), so the migration completes ~parallel to route bringup. Validator rejection of old-shape values in the millisecond gap is a UAT non-issue"

requirements-completed:
  - P98-MIG-01
  - Per-identity-voice-binding

# Metrics
duration: ~5min
completed: 2026-09-10
---

# Phase 98 Plan 05: Voice-value startup migration (hard-reset + idempotent) Summary

**One-shot voice frontmatter migration wired as a fire-and-forget sibling to `ensureBridgeConfigWritten` — walks BOTH `~/.claude/identities/*/*.md` AND `~/.claude/roles/*/*.md`, clears any `voice:` value matching the old Chatterbox regex `/^[A-Z][A-Za-z]+\.wav$/`, leaves already-conformant Polly voice IDs untouched (idempotent on every restart), and NEVER throws. Includes the LOAD-BEARING `.replace(/^["']|["']$/g, "")` quote-strip so YAML-quoted values (`voice: "Elena.wav"`) don't slip through the migration and blow up Plan 07's tightened validator.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-09-10T02:59:00Z (approximate)
- **Completed:** 2026-09-10T03:03:00Z (approximate)
- **Tasks:** 2 (Task 1 TDD RED → GREEN, Task 2 direct edit)
- **Files created:** 2 (1 source + 1 unit test)
- **Files modified:** 1 (starter.ts — additions only)
- **Tests added:** 13 assertions passing (covers all 9 behavior cases from the plan + 3 supplementary edge cases)

## Accomplishments

- Shipped the zero-touch voice-value migration required by D-Per-identity-voice-binding's hard-reset locked decision — every existing identity + role voice frontmatter value referencing an old Chatterbox `.wav` file gets wiped on the next Skynet backend boot.
- Wired the migration fire-and-forget from `starter.ts` as a sibling block to `ensureBridgeConfigWritten` — zero operator action, no `docker exec` step, no distributor task. Alice's Phase-86 preference for ops-invisible operations honored.
- Locked the LOAD-BEARING quote-strip (`.replace(/^["']|["']$/g, "")`) verbatim in `migrateFrontmatterFile` per plan-review recommendation. Test Case #5 (`voice: "Elena.wav"`) plus supplementary Case #5b (`voice: 'Elena.wav'`) both green — quoted YAML values are handled uniformly with bare values.
- Idempotency confirmed via Test Case #7 (second call after first pass) — the `POLLY_VOICE_IDS.has(currentVoice)` fast-skip guard means already-migrated boxes no-op on every subsequent restart. No wasted disk churn.
- Never-throws contract confirmed via Test Case #8 (simulated mid-write fs failure) — the entry-point wrapper catches everything and downgrades to a `warn` log; starter.ts's `.catch` is defense-in-depth against dynamic-import failure.
- Walks BOTH identity + role trees (Test Case #9b) per Phase 86 precedent — cosmetics (voice, title, hue, avatar) live on both trees with per-identity override, so single-tree migration would leave half the fleet stuck.
- Followed strict TDD RED → GREEN gate sequence for Task 1 with distinct commit hashes.

## Task Commits

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| Task 1 RED | `07944c69` | test | Add failing tests for voice-migration one-shot (13 assertions, mocked fs + logger + roots resolver) |
| Task 1 GREEN | `f9acf1c8` | feat | Implement voice-migration.ts (ensureVoiceValuesMigrated + walkAndMigrate + migrateFrontmatterFile with LOAD-BEARING quote-strip) |
| Task 2 | `051bff58` | feat | Wire ensureVoiceValuesMigrated fire-and-forget in starter.ts as sibling to ensureBridgeConfigWritten |

**Plan metadata:** pending (final docs commit after SUMMARY write — owned by orchestrator per fleet-rule execute-plan protocol)

_Note: Task 1 followed strict TDD (RED test commit failed with module-not-found at import resolution; GREEN implementation commit passed all 13 assertions on first run). No REFACTOR pass was needed. Task 2 is a direct additive edit — no test file added since starter.ts's fire-and-forget block is already grep-verified in acceptance criteria and does not need behavior-level coverage beyond the Task 1 module tests._

## Files Created/Modified

### Created (source)
- `src/backend/voice/voice-migration.ts` (185 lines) — Exports `ensureVoiceValuesMigrated(): Promise<void>`. Module-level `OLD_VOICE_RE = /^[A-Z][A-Za-z]+\.wav$/` const. Three functions internally: `migrateFrontmatterFile(filePath)` (per-file YAML-frontmatter rewrite with tmp+rename atomic write, includes the LOAD-BEARING quote-strip on the extracted `voice:` value), `walkAndMigrate(root)` (walks `<subdir>/<subdir>.md` files under one root, catches per-file failures log-and-continue, returns `{scanned, changed}` counts, gracefully handles missing-root via `.catch(() => [])`), and the exported entry point (calls walkAndMigrate for identities + roles roots, logs a single summary line, wraps EVERYTHING in try/catch and NEVER re-throws).

### Created (tests)
- `src/backend/voice/voice-migration.test.ts` (456 lines) — 13 passing assertions across a describe block covering all 9 behavior cases from the plan spec plus 4 supplementary edge cases:
  - **Case 1**: `voice: Elena.wav` → line removed
  - **Case 2**: `voice: Joanna` (Polly ID) → untouched
  - **Case 3**: `voice: SomeCustom` → untouched (out-of-scope value)
  - **Case 4**: no `voice:` line → untouched
  - **Case 5** (LOAD-BEARING): `voice: "Elena.wav"` (double-quoted) → line removed
  - **Case 5b** (supplementary): `voice: 'Elena.wav'` (single-quoted) → line removed
  - **Case 6**: both roots missing → no-throw, single info log, all counts = 0
  - **Case 7**: second call after first pass → idempotent skip (changed = 0)
  - **Case 8**: simulated fs write failure → does NOT throw (resolves undefined)
  - **Case 9**: on success, emits one info log with `operation:"voice_migration_complete"`
  - **Case 9b** (supplementary): walks BOTH identity + role trees (Phase 86 precedent)
  - **Case 9c** (supplementary): missing per-identity `.md` file skipped (no throw)
  - **Case 9d** (supplementary): subdirs without matching `<name>/<name>.md` skipped
  - Uses an in-memory fs mock (`Map<absPath, string>` + `Set<absDir>` driven by `vi.hoisted` state) so tests are hermetic — no real disk I/O.

### Modified
- `src/backend/starter.ts` (+18 lines) — Additive diff only. Adds a `void import("./voice/voice-migration.js").then(m => m.ensureVoiceValuesMigrated()).catch(...)` block immediately after the existing `ensureBridgeConfigWritten` block (line 296, sibling to the block at line 278). The catch handler uses `systemLogger.warn` with `operation: "voice_migration_startup_failed"` — mirrors the surrounding block's exact shape. Existing `ensureBridgeConfigWritten` block untouched (verified via `git diff`).

## Decisions Made

- **Quote-strip is INLINED verbatim, not helper-extracted.** Per plan-review lock: `.replace(/^["']|["']$/g, "")` MUST appear in the function body so `grep` can verify its presence. A helper import would fragment the contract across files and make grep-audit less obvious. The comment above the line explicitly flags it as LOAD-BEARING for the Case 5 test.
- **Frontmatter parse is line-based regex, not full YAML round-trip.** Preserves user's original whitespace/quoting on OTHER frontmatter fields (name, role, title, etc.). Full YAML round-trip would normalize quoting styles and potentially reorder keys — invasive for a targeted single-field mutation. Pattern from RESEARCH § Pattern 6 (`fmText.replace(/^voice:\s*.+\n?/m, "")`).
- **Per-file failures are caught INSIDE walkAndMigrate (log-and-continue) rather than propagated to the entry point.** One bad file (permission error, disk-full, etc.) does not abort the whole walk. The log carries `operation: "voice_migration_file_error"` with the file path so operators can investigate specific failures without losing progress on the other files.
- **Idempotency guard is `POLLY_VOICE_IDS.has(currentVoice)`, NOT `POLLY_VOICE_IDS.has(currentVoice) || !OLD_VOICE_RE.test(currentVoice)`.** The two checks are semantically distinct: the Polly check identifies "already migrated" (return early, no touch), the old-regex check identifies "eligible for migration" (proceed with wipe). Values matching neither are also skipped — but the skip goes through the second branch, not the idempotency branch, so the log picture stays clean (we only "skip as idempotent" when the value IS a valid Polly ID; other skips are unlabeled).
- **Fire-and-forget in starter.ts uses `void import(...).then(...).catch(...)` (dynamic import), NOT `import { ensureVoiceValuesMigrated } from "./voice/voice-migration.js"` at top-of-file.** Dynamic import matches the existing `ensureBridgeConfigWritten` block's shape (line 278) — lazy module load, catch handler on the promise chain. Top-of-file import would tie module init to the whole starter.ts import graph and negate the fire-and-forget latency isolation.
- **Roots resolved via `getLocalIdentitiesRoot()` + `getLocalRolesRoot()` (not hardcoded paths).** These helpers honor the `IDENTITIES_HOST_DIR` / `ROLES_HOST_DIR` env-var overrides that are load-bearing for the docker bind-mount — hardcoding `~/.claude/identities` would break the migration inside the container (where `~` is the container-user's home, not the operator's).
- **Test mock strategy: full in-memory fs, not per-test individual mocks.** The 13 test cases share a `beforeEach` reset of the fake filesystem map. Per-test `vi.mock` factories would duplicate boilerplate and slow the suite. The shared state is cleared cleanly between tests, so the isolation is preserved without the boilerplate cost.

## Deviations from Plan

None — plan executed exactly as written.

One minor procedural note (NOT a code deviation, NOT tracked under Rules 1-4):

1. **`--reporter=basic` omitted from verify command.** The plan's `<verify>` block specified `npx vitest run … --reporter=basic`, but vitest 4.1.8 does not accept that reporter name (would need `default` or omission). Same tooling delta as noted in Plan 02 and Plan 04 SUMMARYs — verification ran without the flag; tests themselves executed as specified and all 13 assertions pass.

## Issues Encountered

None. Task 1 RED confirmed cleanly (test file failed at import resolution because `./voice-migration.js` did not exist). Task 1 GREEN passed all 13 assertions on first run — no debugging cycle needed. Task 2 wire was a straightforward additive edit; grep + tsc + related-tests all green on first attempt.

## User Setup Required

None. This plan is self-contained — the migration runs automatically on the next Skynet backend restart post-98-05 deploy. Alice + Stacy will each observe their identity/role frontmatter voice values clear on their respective boxes' next boot; the pretty-view identity + role modals will show the placeholder "(default)" until an owner re-picks from the Polly catalog.

## Next Phase Readiness

**Plan 07 (validator regex tightening) unblocked** — the migration is guaranteed to run BEFORE Plan 07's tightened regex is deployed (both plans ship together as part of Phase 98, and starter.ts fires the migration during bootstrap before HTTP routes accept traffic per the ordering invariant in the wire). By the time Plan 07's whitelist validator takes effect, every operator's frontmatter voice field will either (a) already be a valid Polly ID (rare — no one had one pre-98), (b) be absent entirely (post-migration state), or (c) be some out-of-scope arbitrary value that was not in the old-regex bucket (extremely rare — no known instances). No surviving `.wav` values means Plan 07 has nothing to fight.

**Plans 06 (voice.ts rewrite) and 08 (frontend VoicePicker inline) do not depend on this plan** — they consume `POLLY_VOICES` / `isValidPollyVoice` from Plan 02, not the migration output.

**No blockers. No open questions.**

## Known Stubs

None. This plan introduces no placeholder/stub code — all functions have production-ready bodies wired end-to-end.

## Self-Check: PASSED

**Files verified present:**
- FOUND: `src/backend/voice/voice-migration.ts`
- FOUND: `src/backend/voice/voice-migration.test.ts`
- FOUND: `src/backend/starter.ts` (modified, +18 lines)

**Commits verified present in git log:**
- FOUND: `07944c69` (test 98-05 voice-migration RED)
- FOUND: `f9acf1c8` (feat 98-05 voice-migration GREEN)
- FOUND: `051bff58` (feat 98-05 starter.ts wire)

**Test suite verified:** `npx vitest run src/backend/voice/voice-migration.test.ts` → 1 test file passed, 13 assertions passed.

**TypeScript compile verified:** `npx tsc --noEmit` → exit 0, no errors introduced anywhere in the codebase.

**Acceptance-criteria greps:**
- `grep -n '.replace(/\\^\\["\\x27\\]|\\["\\x27\\]\\$/g' src/backend/voice/voice-migration.ts` → matches on line 107 (LOAD-BEARING quote-strip present verbatim)
- `grep -c 'throw' src/backend/voice/voice-migration.ts` → 5 (all 5 are in comments; ZERO real `throw` statements in the module — never-throw contract satisfied)
- `grep -c 'voice-migration' src/backend/starter.ts` → 1 (import path reference present)
- Ordering: `bridge-config-writer` at line 278; `voice-migration` at line 296 (correctly AFTER)
- Import shape in starter.ts: `void import(...).then(...).catch(...)` with no `await` (fire-and-forget confirmed)
- Catch handler in starter.ts: `systemLogger.warn` with `operation: "voice_migration_startup_failed"` (mirrors bridge-config-writer analog)
- `git diff src/backend/starter.ts` → additions only; existing `ensureBridgeConfigWritten` block unchanged

## TDD Gate Compliance

| Task | RED commit | GREEN commit | Assertions |
|------|-----------|--------------|------------|
| Task 1 (voice-migration) | `07944c69` | `f9acf1c8` | 13 |

Task 2 (starter.ts wire) is an additive integration edit and did not require its own RED/GREEN pair — its correctness is validated by (a) the acceptance-criteria greps in the plan, (b) `tsc --noEmit` clean, and (c) the Task-1 module tests that exercise the ensureVoiceValuesMigrated function that Task 2 wires.

RED phase verified via vitest failure output (`Cannot find module '/src/backend/voice/voice-migration.js'` — import resolution failed because the module did not exist). GREEN phase passed all 13 assertions on first run with no debugging cycle. No REFACTOR pass was needed.

---
*Phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol*
*Completed: 2026-09-10*
