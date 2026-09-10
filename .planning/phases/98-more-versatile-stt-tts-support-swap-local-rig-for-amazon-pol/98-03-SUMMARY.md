---
phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol
plan: 03
subsystem: ui
tags: [voice, polly, react, vitest, kill-list]

# Dependency graph
requires:
  - phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol
    provides: "Plan 02 backend POLLY_VOICES const shape (mirror source of truth)"
provides:
  - Inline POLLY_VOICES const in VoicePicker.tsx (no runtime voice-catalog fetch)
  - getVoices deleted from src/ui/api/voice-api.ts
  - 15 test files swept of getVoices mock references (grep-rn clean)
affects:
  - Plan 06 (voice.ts rewrite — /voice/voices endpoint drop is coordinated here)
  - Plan 07 (identity validator swap — old .wav voice values will no longer render as picker options)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-source-of-truth for static-const catalogs (frontend cannot import from backend/, low drift risk for 7 static strings)"
    - "Inlined module-level const replaces runtime fetch-on-mount for small immutable catalogs"

key-files:
  created: []
  modified:
    - src/ui/features/pretty-view/pickers/VoicePicker.tsx
    - src/ui/api/voice-api.ts
    - src/ui/features/pretty-view/ChatMessage.speak.test.tsx
    - src/ui/features/pretty-view/ChatMessage.autoplay.test.tsx
    - src/ui/features/pretty-view/ChatMessage.instrumentation.test.tsx
    - src/ui/features/pretty-view/IdentityModal.voice.test.tsx
    - src/ui/features/pretty-view/IdentityModal.inherit-override.test.tsx
    - src/ui/features/pretty-view/IdentityModal.stays-awake.test.tsx
    - src/ui/features/pretty-view/RoleCosmeticEditBlock.test.tsx
    - src/ui/features/pretty-view/RoleModal.test.tsx
    - src/ui/features/pretty-view/pickers/VoicePicker.test.tsx
    - src/ui/sidebar/CreateRoleDialog.test.tsx
    - src/ui/sidebar/NewSessionDialog.test.tsx
    - src/ui/sidebar/NewSessionDialog.chain.test.tsx
    - src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx
    - src/ui/sidebar/NewSessionDialog.task-input.test.tsx

key-decisions:
  - "POLLY_VOICES declared as module-level const outside VoicePicker component (const-per-module pattern, not context/state)"
  - "Second source of truth vs backend polly-voice-catalog.ts (Plan 02) accepted per PATTERNS pitfall — 7 static strings, low drift risk"
  - "Dropped 'tiffany' from RoleModal Test E identity-name deny-regex — false positive since Tiffany is now a legitimate Polly voice option label"

patterns-established:
  - "Kill-list execution: delete then sweep every consumer to zero grep hits (validated via `grep -rn <symbol> src/ui/`)"
  - "Frontend-mirrors-backend static-const modules keep local copies rather than crossing the src/backend/src/ui module boundary"

requirements-completed:
  - P98-CAT-01
  - P98-KILL-01
  - Voice-catalog
  - Kill-list

# Metrics
duration: 40min
completed: 2026-09-10
---

# Phase 98 Plan 03: Frontend voice-catalog kill + inline const Summary

**VoicePicker consumes an inlined 7-voice POLLY_VOICES const; getVoices removed from voice-api.ts; all 15 test-mock sites swept clean.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-09-10T02:24:00Z (approx — plan-execute agent spawn)
- **Completed:** 2026-09-10T02:41:00Z
- **Tasks:** 2 / 2
- **Files modified:** 17 (16 source + 0 created)

## Accomplishments

- VoicePicker.tsx now renders 7 Polly voice options + `(default)` fallback synchronously on mount — no useEffect, no HTTP call, no loading state.
- `getVoices` export deleted from `src/ui/api/voice-api.ts`; `postSpeak`, `postSpeakStream`, `SAMPLE_PHRASE` preserved byte-for-byte with unchanged client contract.
- `grep -rn 'getVoices' src/ui/` returns 0 hits — sweep covered 15 test files (6 listed in plan + 9 additional consumers discovered).
- All 172 tests in the touched files pass. `tsc --noEmit` is clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Inline POLLY_VOICES const into VoicePicker.tsx and drop the getVoices useEffect** — `8e2586c0` (feat)
2. **Task 2: Delete getVoices from voice-api.ts and update the test-file mock sites (extended sweep)** — `45f93487` (feat)

## Files Created/Modified

**Source (2):**
- `src/ui/features/pretty-view/pickers/VoicePicker.tsx` — Replaced fetch-on-mount effect with module-level POLLY_VOICES readonly array (7 Polly voice IDs); pruned unused `useState` import; preserved sample-play button verbatim.
- `src/ui/api/voice-api.ts` — Deleted `getVoices` function; `handleApiError` import retained (still used by `postSpeak`).

**Tests (15):**
- `ChatMessage.speak.test.tsx`, `ChatMessage.autoplay.test.tsx`, `ChatMessage.instrumentation.test.tsx`, `IdentityModal.stays-awake.test.tsx`, `RoleModal.test.tsx`, `NewSessionDialog.test.tsx`, `NewSessionDialog.chain.test.tsx`, `NewSessionDialog.role-dropdown.test.tsx`, `NewSessionDialog.task-input.test.tsx` — Deleted `getVoices` entry from `vi.mock("@/api/voice-api", ...)` block; other mocked exports preserved.
- `CreateRoleDialog.test.tsx` — Updated stale comment referencing `getVoices` to describe the Phase 98 kill (no code change).
- `RoleCosmeticEditBlock.test.tsx` — Mock updated (getVoices removed); **Test D rewritten** to assert 8 static options synchronously and pick `"Ruth"` (a Polly voice ID) instead of the old `"echo"` filename.
- `RoleModal.test.tsx` — **Test E deny-regex updated**: dropped `tiffany` from `/tabitha|tina|tiffany|tanya|taylor/i` since Tiffany now legitimately appears as a Polly voice option in the RoleCosmeticEditBlock voice picker (false-positive fix).
- `VoicePicker.test.tsx` — **Full rewrite**: removed all getVoices mocks and `mockedGetVoices`; new Test 1 asserts the exact 8-option array synchronously; Tests 2/3/6 switched from `Alice.wav`/`Elena.wav` filenames to Polly voice IDs (`Joanna`).
- `IdentityModal.voice.test.tsx` — **Full rewrite**: removed getVoices mocks; new Test 1 asserts 8 options synchronously; Tests 2b/3/4/5/6 switched from `Elena.wav` filename to `Joanna` voice ID.
- `IdentityModal.inherit-override.test.tsx` — Mock updated (getVoices removed); `Marcus.wav` → `Matthew` (a Polly voice ID) in fixtures and assertions to keep the inheritance semantics testable against a value the new validator will accept.

## Decisions Made

- **POLLY_VOICES const outside the component.** Placed as a module-level `readonly { voiceId: string; displayName: string }[]` rather than inside a `useMemo` or context — trivial re-render savings and matches how backend `distributor/catalog.ts` declares its `FLEET_SUBSTRATE_CATALOG` (readonly array, no `as const` needed).
- **Second source of truth accepted.** Frontend cannot import from `src/backend/`, so `POLLY_VOICES` in VoicePicker.tsx mirrors the same list Plan 02 authored in `src/backend/voice/polly-voice-catalog.ts`. PATTERNS pitfall explicitly greenlights this for 7 static strings.
- **Marcus.wav → Matthew (not deletion).** `IdentityModal.inherit-override.test.tsx` uses a role-default voice value to test inheritance — the value must survive the Plan 07 whitelist validator, so it was upgraded to a Polly voice ID rather than nulled out.
- **RoleModal Test E identity-name regex trimmed.** The test guards against identity-name leakage in a role-only surface. `tiffany` collided with a Polly voice option label rendered in VoicePicker — dropped from the regex with a comment noting the Phase 98 rationale.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended sweep to 9 additional test files not listed in plan**
- **Found during:** Task 2 initial grep sweep
- **Issue:** Plan Task 2 listed 6 test files, but `grep -rn 'getVoices' src/ui/` at task start returned 15 hits across 10 test files (plus stale comments in `CreateRoleDialog.test.tsx`). Plan acceptance criteria mandated a 0-hit grep sweep, so leaving the additional consumers alone would either (a) break the acceptance test or (b) fail the tests themselves once `getVoices` is gone from voice-api.ts (all `vi.mock(...)` entries would still work — mocks don't need real exports — but the intent-of-plan was clearly full cleanup).
- **Fix:** Updated all 15 sites in the same Task 2 commit: dropped `getVoices` from every `vi.mock("@/api/voice-api", ...)` block, rewrote two test files (`VoicePicker.test.tsx`, `IdentityModal.voice.test.tsx`) whose test bodies still asserted on mocked `getVoices` calls, and adjusted stale comments in `CreateRoleDialog.test.tsx`.
- **Files modified:** VoicePicker.test.tsx, IdentityModal.voice.test.tsx, IdentityModal.inherit-override.test.tsx, IdentityModal.stays-awake.test.tsx, ChatMessage.autoplay.test.tsx, ChatMessage.instrumentation.test.tsx, RoleModal.test.tsx, CreateRoleDialog.test.tsx
- **Verification:** `grep -rn 'getVoices' src/ui/` → 0 hits (`exit 1` from grep). All 172 tests pass across the extended file set.
- **Committed in:** `45f93487` (Task 2 commit)

**2. [Rule 1 - Bug] RoleModal Test E false positive on "tiffany"**
- **Found during:** Task 2 test run
- **Issue:** RoleModal Test E asserts `document.body.textContent` does not match `/tabitha|tina|tiffany|tanya|taylor/i` (identity-name deny-regex, to catch identity leakage into a role-only header). After Task 1 inlined POLLY_VOICES, the mounted VoicePicker now renders `<option>Tiffany</option>` in the RoleCosmeticEditBlock — text content matches, test fails.
- **Fix:** Dropped `tiffany` from the deny-regex and added a comment explaining the Phase 98 rationale. The test still guards against the other four identity names.
- **Files modified:** src/ui/features/pretty-view/RoleModal.test.tsx
- **Verification:** RoleModal.test.tsx — 13/13 pass.
- **Committed in:** `45f93487` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking, 1 Rule 1 regression fix)
**Impact on plan:** Both auto-fixes necessary to satisfy the plan's own 0-hit grep sweep acceptance criteria and to keep sibling tests green after inlining the Polly voice options. No scope creep beyond the frontend voice-catalog kill.

## Issues Encountered

- None material. The only friction was discovering the additional test consumers of `getVoices` — resolved by an inline extended sweep (see Rule 3 above). Vitest runs comfortably under 30s across all 14 affected test files.

## User Setup Required

None — no external service configuration required for this plan. (Plans 05/06/07/etc. will handle the AWS-side setup.)

## Next Phase Readiness

- **Plan 06 (voice.ts rewrite)** can now safely drop the `/voice/voices` route without breaking any frontend consumer — no code path in `src/ui/` still calls it.
- **Plan 07 (identity validator)** will reject old-shape `.wav` voice values; the fixtures in `IdentityModal.inherit-override.test.tsx` were upgraded to `Matthew` to survive that validator.
- **Plan 08 (migration script)** still needs to clear on-disk `.wav` values from identity/role frontmatter; the frontend already assumes post-migration values.

## Self-Check: PASSED

- `src/ui/features/pretty-view/pickers/VoicePicker.tsx` — FOUND (modified)
- `src/ui/api/voice-api.ts` — FOUND (modified)
- Commit `8e2586c0` (Task 1 feat) — FOUND in `git log --oneline`
- Commit `45f93487` (Task 2 feat) — FOUND in `git log --oneline`
- `grep -rn 'getVoices' src/ui/` → 0 hits (verified post-Task-2)
- `npx tsc --noEmit` → exit 0
- Vitest across 14 touched files → 172/172 pass

---
*Phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol*
*Completed: 2026-09-10*
