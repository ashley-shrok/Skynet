---
phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol
plan: 07
subsystem: identity-validation
tags: [validator, whitelist, polly, voice, tightening, wave-3, no-regex]

# Dependency graph
requires:
  - phase: 98-02
    provides: "isValidPollyVoice type guard + POLLY_VOICE_IDS Set exported from polly-voice-catalog.ts"
  - phase: 98-05
    provides: "ensureVoiceValuesMigrated startup one-shot — clears legacy `.wav` frontmatter BEFORE HTTP traffic accepts requests, so tightened validator has nothing to fight"
provides:
  - "identities.ts PUT /:identityKey — whitelist voice validation (400 with 'supported Polly voice IDs' error message on any non-Polly value)"
  - "identity-birth.ts POST / — whitelist voice validation on birth body.voice"
  - "identity-clone.ts POST / — whitelist voice validation on clone body.voice"
  - "Deletion of IDENTITY_VOICE_RE constant (formerly /^[A-Z][A-Za-z]+\\.wav$/) from identities.ts"
affects:
  - "Every future identity edit that carries a voice value — must be one of Danielle, Joanna, Ruth, Salli, Tiffany, Matthew, Stephen or null/absent"
  - "roles-create.ts (NOT touched by this plan) still carries a mirror ROLE_VOICE_RE at L134 — DEFERRED to follow-up sweep; not blocking Phase 98 ship because roles are edited less frequently than identities and the migration also touches role frontmatter"

# Tech tracking
tech-stack:
  added: []  # no new deps — reuses Plan 98-02's isValidPollyVoice guard
  patterns:
    - "Set-based whitelist over regex for known-fixed-set validation (mirrors polly-voice-catalog's design)"
    - "Comment-annotated deletion of prior validator constant (audit trail without leaving the constant name in code)"
    - "Cross-route validator consistency (identities.ts PUT + identity-birth.ts POST + identity-clone.ts POST all emit the same 400 message shape)"
    - "Wave-3 tightening after Wave-2 migration — the ordering invariant is what makes the hard-reset transparent to operators"

key-files:
  created: []
  modified:
    - "src/backend/database/routes/identities.ts (+14 -3): deleted IDENTITY_VOICE_RE constant, imported isValidPollyVoice, swapped call-site + error message"
    - "src/backend/database/routes/identity-birth.ts (+18): imported isValidPollyVoice, added whitelist gate after the existing typeof-string check on body.voice"
    - "src/backend/database/routes/identity-clone.ts (+24): imported isValidPollyVoice, added whitelist gate after the length-cap check, updated MAX_VOICE_LEN comment"
    - "src/backend/database/routes/identities.get-disk.test.ts (Elena.wav → Joanna in PUB-1 fixture + assertion)"
    - "src/backend/database/routes/identities.put-disk.test.ts (Elena.wav → Joanna in Test 1 fixture + assertion)"
    - "src/backend/database/routes/identity-birth-orchestrator.test.ts (2 sites: makeOpts default + candidate-write test)"
    - "src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts (3 sites: makeOpts, rich-fm opts, rich-fm assertion)"
    - "src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts (1 site: makeOpts default)"
    - "src/backend/database/routes/identity-birth.test.ts (VALID_BODY.voice — Rule 3 out-of-scope-plan-item auto-added because the whitelist gate in identity-birth.ts would 400 every test using VALID_BODY)"

key-decisions:
  - "identity-birth.ts + identity-clone.ts have no `DEFAULT_VOICE` constant to swap — parsedVoice already defaults to null when the client omits the field, and null-safe frontmatter write is preserved. Nothing to change from 'Elena.wav' to 'Joanna' as a hardcoded default because no such hardcoded default exists in the source (only in stale test fixtures)."
  - "IDENTITY_VOICE_RE comment references phrased to avoid the exact constant name after deletion so `grep -c 'IDENTITY_VOICE_RE'` returns 0 per the plan's acceptance criterion. The audit trail lives in commit messages + this SUMMARY, not in code comments."
  - "MAX_VOICE_LEN cap in identity-clone.ts kept as defense-in-depth — all 7 Polly IDs are ≤10 chars, so the 100-char cap is a redundant belt on top of the whitelist. Comment updated to reflect the demotion from primary-check to defense-in-depth."
  - "identity-birth.test.ts's VALID_BODY was NOT in the plan's files_modified list but was updated under Rule 3 (blocking issue caused by the current task) because it hits the identity-birth.ts route with voice: 'Elena.wav' and would 400 on the tightened whitelist gate. Documented as a deviation below."
  - "voice.test.ts's remaining 'Elena.wav' references (4 sites, 2 test cases) are the plan-carve-out — test names verbatim say 'returns 400 when body.voice is the old Chatterbox shape'. These are the NEW coverage the whitelist enforces. Left untouched per Task 3 action text."

patterns-established:
  - "Whitelist validator swap pattern: (a) import guard, (b) delete regex constant with audit-comment, (c) swap call-site inside the same conditional, (d) update error message string, (e) sweep test fixtures that carried the old shape as their happy-path value."
  - "Comment-only audit trail for deleted constants — reference the historical regex pattern verbatim but do NOT reference the constant name (avoids polluting future greps)."

requirements-completed:
  - P98-MIG-02
  - Per-identity-voice-binding

# Metrics
duration: ~10min
completed: 2026-09-10
---

# Phase 98 Plan 07: Tighten identity voice-value validator to Polly whitelist Summary

**Flipped `identities.ts:51`'s legacy `IDENTITY_VOICE_RE = /^[A-Z][A-Za-z]+\.wav$/` regex to `isValidPollyVoice` (Plan 98-02's Polly whitelist guard), extended the same whitelist gate into `identity-birth.ts` + `identity-clone.ts` so all three write paths reject any non-Polly voice value with a consistent 400 message shape, and swept the 5 plan-listed test files + 1 out-of-scope test file (`identity-birth.test.ts`, added under Rule 3) from `Elena.wav` fixtures to `Joanna`. Every voice-write path now enforces the 7-voice whitelist; `voice.test.ts`'s 2 rejection tests continue to hold `Elena.wav` on purpose as the new coverage.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-09-10T03:11:00Z (approximate)
- **Completed:** 2026-09-10T03:22:00Z (approximate)
- **Tasks:** 3
- **Files modified:** 9 (3 source + 6 test — 5 plan-listed + 1 Rule 3 auto-add)
- **Files created:** 0
- **Tests exercised:** 6 test files, 157 assertions passing (identities.get-disk, identities.put-disk, identity-birth-orchestrator, identity-birth-orchestrator.role-frontmatter, identity-birth-orchestrator.mxid-derivation, identity-birth)

## Accomplishments

- Deleted the legacy `IDENTITY_VOICE_RE` regex from `identities.ts` and replaced its call-site with `isValidPollyVoice(meta.voice)`, matching the tightened contract locked in D-Per-identity-voice-binding + P98-MIG-02.
- Extended the same whitelist gate to `identity-birth.ts` (POST /identities/birth) and `identity-clone.ts` (POST /identities/clone) so all three write paths — PUT edit, birth, clone — enforce the identical 7-voice whitelist with the identical 400 error message shape ("voice must be one of the supported Polly voice IDs").
- Swept the 5 plan-listed test files from the legacy `Elena.wav` fixture to `Joanna` (a valid Polly generative voice ID). Verified all 5 files run green individually — no test broke structurally, all substitutions were straight value replacements.
- Detected + auto-fixed a blocking issue under Rule 3: `identity-birth.test.ts`'s `VALID_BODY.voice = "Elena.wav"` was NOT in the plan's `files_modified` list but is used across 30+ test cases as the happy-path fixture; without the sweep, every test would 400-reject at the new whitelist gate. Substituted to "Joanna" and documented as a deviation.
- Preserved the plan-mandated carve-out: `voice.test.ts`'s 2 rejection tests explicitly named "returns 400 when body.voice is the old Chatterbox shape" continue to hold `Elena.wav` as their fixture — these are the new whitelist's coverage tests, not fixtures to sweep.
- Verified the ordering-safety invariant holds: Plan 98-05's boot-time migration wipes any pre-existing `Foo.wav` frontmatter BEFORE HTTP traffic accepts requests, so this validator's tightening cannot 400 an operator's existing identity on first read/edit.

## Task Commits

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| Task 1 | `50f31a57` | feat | swap identities voice validator to Polly whitelist |
| Task 2 | `186b92af` | feat | add Polly whitelist voice validation to birth + clone routes |
| Task 3 | `8bef49e1` | test | sweep Elena.wav fixtures to Joanna in identity route tests |

**Plan metadata:** pending (final docs commit after SUMMARY write)

## Files Created/Modified

### Modified (source)

- `src/backend/database/routes/identities.ts` (+14 −3):
  - Deleted `const IDENTITY_VOICE_RE = /^[A-Z][A-Za-z]+\.wav$/;` at former L51.
  - Added `import { isValidPollyVoice } from "../../voice/polly-voice-catalog.js";` with a 6-line audit comment.
  - Replaced call-site `!IDENTITY_VOICE_RE.test(meta.voice)` with `!isValidPollyVoice(meta.voice)` at the PUT body-validation branch.
  - Replaced error message `"voice must match [A-Z][A-Za-z]+\\.wav"` with `"voice must be one of the supported Polly voice IDs"`.
  - Left the `meta.voice !== undefined && meta.voice !== null` outer guards unchanged so null / absent voice still slips through unmodified.

- `src/backend/database/routes/identity-birth.ts` (+18):
  - Added `import { isValidPollyVoice } from "../../voice/polly-voice-catalog.js";` with a 5-line audit comment.
  - Added a new gate immediately after the existing `typeof voice !== "string"` check: returns 400 with `"voice must be one of the supported Polly voice IDs"` when the string voice value fails `isValidPollyVoice`.
  - The existing `parsedVoice` narrowing at L232 is unchanged — the whitelist gate happens BEFORE parsedVoice, so if we reach the write step the value is either null or a validated Polly ID.

- `src/backend/database/routes/identity-clone.ts` (+24):
  - Added `import { isValidPollyVoice } from "../../voice/polly-voice-catalog.js";` with a 5-line audit comment.
  - Updated the `MAX_VOICE_LEN = 100` comment to reflect that the length cap is now defense-in-depth and the whitelist is the primary check.
  - Added a new whitelist gate immediately after the existing typeof + length checks: returns 400 with the same message shape when the voice value fails `isValidPollyVoice`.
  - The clone frontmatter write at L682-683 (`if (voice !== null && voice.trim().length > 0) { pairs.push(["voice", voice]); }`) is preserved verbatim — the null-safe emission behavior is unchanged.

### Modified (tests — 5 plan-listed)

- `src/backend/database/routes/identities.get-disk.test.ts` (2 lines): PUB-1 fixture voice + assertion swapped `Elena.wav` → `Joanna`.
- `src/backend/database/routes/identities.put-disk.test.ts` (2 lines): Test 1 present-updates-overlay fixture voice + assertion swapped.
- `src/backend/database/routes/identity-birth-orchestrator.test.ts` (2 lines): `makeOpts` default voice + the candidate-write test's opts voice.
- `src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts` (3 lines): `makeOpts` default + rich-frontmatter opts voice + rich-frontmatter yaml.parsed.voice assertion.
- `src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts` (1 line): `makeOpts` default voice.

### Modified (tests — 1 Rule 3 out-of-scope auto-add)

- `src/backend/database/routes/identity-birth.test.ts` (1 line): `VALID_BODY.voice` swapped `Elena.wav` → `Joanna` because identity-birth.ts's route (touched in Task 2) now runs `isValidPollyVoice` on incoming `body.voice`, which would 400 every VALID_BODY-consuming test (~30 cases across the file) without the sweep. Added a 3-line audit comment noting the reason for the swap.

## Decisions Made

- **Deleted the `IDENTITY_VOICE_RE` constant entirely rather than commenting it out.** The audit trail lives in the commit message + this SUMMARY. The alternative (leaving it commented as `// const IDENTITY_VOICE_RE = ...`) would satisfy the acceptance criterion `grep -c 'IDENTITY_VOICE_RE' → 0` only if the comment is edited to avoid the identifier, which is exactly what the deletion accomplishes without commented-out dead code.
- **Referenced the historical regex pattern in comments but NOT the constant name.** The two audit comments in identities.ts mention `/^[A-Z][A-Za-z]+\.wav$/` verbatim (so a future maintainer greps the regex and finds the migration story) but avoid the `IDENTITY_VOICE_RE` identifier (so `grep -c 'IDENTITY_VOICE_RE'` returns 0 per the plan's acceptance criterion).
- **MAX_VOICE_LEN in identity-clone.ts kept as defense-in-depth.** All 7 Polly IDs are ≤10 chars, so a 100-char cap is redundant on top of the whitelist. But removing it would widen the pre-whitelist surface area (an attacker could send a 10-MB voice string that still fails the whitelist — the length cap short-circuits earlier). Comment updated to reflect the demotion.
- **identity-birth.test.ts's VALID_BODY was updated under Rule 3.** This test file was NOT in the plan's `files_modified` list but is directly broken by Task 2's changes to identity-birth.ts's route (`VALID_BODY.voice = "Elena.wav"` → 400 rejection). Rule 3 handles blocking issues caused by the current task's changes; the plan's Task 3 action was scoped to 5 files but the ripple was 6. Documented as a deviation below.
- **voice.test.ts's `Elena.wav` fixtures NOT touched.** These are the plan-mandated carve-out — test names verbatim reference the old shape as the fixture for the 400-rejection tests. Task 3's action text says explicitly: "Do NOT touch test files that reference `Elena.wav` in scenarios explicitly testing REJECTION". Left as-is.

## Deviations from Plan

### [Rule 3 — Blocking Issue] Auto-updated identity-birth.test.ts's VALID_BODY fixture

- **Found during:** Task 2 (after adding the whitelist gate to identity-birth.ts)
- **Issue:** `identity-birth.test.ts` (NOT in the plan's `files_modified` list) uses a shared `VALID_BODY` constant at L237-246 with `voice: "Elena.wav"`. This constant is spread across ~30 test cases as the happy-path fixture. Task 2's whitelist gate on identity-birth.ts's route would 400-reject every VALID_BODY-consuming request, breaking those tests.
- **Fix:** Substituted `voice: "Elena.wav"` → `voice: "Joanna"` in VALID_BODY, added a 3-line audit comment explaining the swap. Same value-only change as the 5 plan-listed test files — no structural rework.
- **Files modified:** `src/backend/database/routes/identity-birth.test.ts` (1 line changed, 3 lines of comment added)
- **Commit:** `8bef49e1` (same commit as Task 3's plan-listed sweeps)
- **Scope note:** Per Rule 3's scope boundary — only auto-fix issues DIRECTLY caused by the current task's changes. This test breaks specifically because Task 2 added a whitelist gate to the same route. Not pre-existing warning; not unrelated failure. In scope for Rule 3.

### [Documentation Note — NOT a deviation under Rules 1-4] roles-create.ts's mirror ROLE_VOICE_RE

- `src/backend/database/routes/roles-create.ts:134` carries `const ROLE_VOICE_RE = /^[A-Z][A-Za-z]+\.wav$/;` — an explicit mirror of the deleted IDENTITY_VOICE_RE — with a comment saying "mirrors IDENTITY_VOICE_RE in identities.ts L51 verbatim". This constant validates role-cosmetic voice values on POST /roles.
- **Left untouched** because: (a) the plan's `files_modified` does not include roles-create.ts, (b) roles are edited less frequently than identities, (c) Plan 98-05's boot-time migration walks BOTH identity + role trees so role frontmatter voice values are ALSO wiped on ship day, (d) the plan's threat_model does not flag role voice-write paths as in-scope for this plan.
- **Added to deferred-items.md** as a follow-up sweep — should get the same isValidPollyVoice + whitelist treatment in a subsequent sweep plan. Not blocking Phase 98 ship because the migration's role-tree walk already clears the pre-existing values.

## Issues Encountered

None. All three tasks executed straight through on the first attempt.

- Task 1's tsc pass was clean on first run.
- Task 2's tsc pass was clean on first run (import path `../../voice/polly-voice-catalog.js` resolved correctly — same relative depth as identities.ts).
- Task 3's test run was clean on first run — 157 assertions passing across 6 files (5 plan-listed + 1 Rule 3 auto-add).

The initial identities.ts comment mentioned the constant name `IDENTITY_VOICE_RE` verbatim, which would have failed the acceptance criterion's strict `grep -c 'IDENTITY_VOICE_RE' == 0`. Caught during Task 1 verification, rephrased the comments to reference only the regex pattern (not the identifier). Not a genuine issue — just a self-caught pre-commit polish.

## User Setup Required

None — this plan is self-contained. The tightened validator takes effect at the next Skynet backend restart post-98-07 deploy. Because Plan 98-05's migration runs BEFORE HTTP traffic on the same boot, operators observe zero rejections on their existing identities. The next identity edit (via the pretty-view identity modal's voice picker, which Plan 98-03/08 wires to the 7-voice hardcoded catalog) will either preserve a valid Polly ID or clear the voice field entirely.

## Next Phase Readiness

**All remaining Phase 98 plans (08, 10) are decoupled from this validator tightening:**

- **Plan 98-08 (frontend VoicePicker inline catalog)** owns the frontend copy of the 7-voice catalog and does not touch backend validators.
- **Plan 98-10 (deploy-time doc + operator runbook)** documents the AWS-side setup; validator behavior is invisible to the operator except as "identity modal only shows 7 voices".

**Backend contract for future callers:**
- Any code that writes an identity's `voice:` frontmatter field via the PUT /identities/:key, POST /identities/birth, or POST /identities/clone routes must pass a value in `POLLY_VOICE_IDS` OR null / absent. Anything else 400-rejects with `"voice must be one of the supported Polly voice IDs"`.
- The migration guarantees that pre-existing on-disk voice values are either (a) already a valid Polly ID, (b) absent, or (c) some out-of-scope arbitrary value (extremely rare — the migration only wipes old-regex matches, not arbitrary values).

**No blockers. No open questions.**

## Known Stubs

None. This plan introduces no placeholder/stub code — every change is a direct validator swap, comment update, or fixture value substitution.

## Deferred Issues

- **`roles-create.ts:134` ROLE_VOICE_RE mirror** — carries the same legacy regex that was deleted from identities.ts. Should get an identical `isValidPollyVoice` swap in a follow-up sweep. Not urgent because Plan 98-05's migration walks the role tree AND role frontmatter is edited far less frequently than identity frontmatter. Scope: single-file swap + one comment update.
- **Other codebase `Elena.wav` references** (from `grep -rln 'Elena.wav' src/`): identity-birth-orchestrator implementations, frontend tests (IdentityModal.voice.test.tsx, CreateRoleDialog.test.tsx, PrettyConversationRow.clone-menu.test.tsx, PrettyConversationsPanel.clone-dialog.test.tsx), api client test (identities-api.test.ts), db migration test (index.migration.test.ts), identity-artifact-reader.avatar-read.test.ts. None of these tests exercise the tightened backend validator; they either test frontmatter parsing (avatar-read), DB migration seed data, frontend fixtures against mocked backends, or the api client's payload shape. All can pass with `Elena.wav` fixtures because they never reach the whitelist gate. Follow-up: sweep in a cosmetic-cleanup pass. Not blocking Phase 98 ship.

## Self-Check: PASSED

**Files verified present:**
- FOUND: `src/backend/database/routes/identities.ts` (modified)
- FOUND: `src/backend/database/routes/identity-birth.ts` (modified)
- FOUND: `src/backend/database/routes/identity-clone.ts` (modified)
- FOUND: `src/backend/database/routes/identities.get-disk.test.ts` (modified)
- FOUND: `src/backend/database/routes/identities.put-disk.test.ts` (modified)
- FOUND: `src/backend/database/routes/identity-birth-orchestrator.test.ts` (modified)
- FOUND: `src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts` (modified)
- FOUND: `src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts` (modified)
- FOUND: `src/backend/database/routes/identity-birth.test.ts` (Rule 3 auto-add)

**Commits verified present in git log:**
- FOUND: `50f31a57` (feat 98-07 identities validator swap)
- FOUND: `186b92af` (feat 98-07 birth + clone whitelist gates)
- FOUND: `8bef49e1` (test 98-07 fixture sweep)

**Acceptance-criteria greps:**
- `grep -c 'IDENTITY_VOICE_RE' src/backend/database/routes/identities.ts` → **0** ✓
- `grep -c 'isValidPollyVoice' src/backend/database/routes/identities.ts` → **3** (import + audit-comment + call-site) ✓ (≥1 required)
- Error message references "Polly voice IDs" ✓ (identities.ts L496)
- `grep -c 'Elena.wav' src/backend/database/routes/identity-birth.ts` → **0** ✓
- `grep -c 'Elena.wav' src/backend/database/routes/identity-clone.ts` → **0** ✓
- `grep -c 'isValidPollyVoice' src/backend/database/routes/identity-birth.ts` → **3** ✓
- `grep -c 'isValidPollyVoice' src/backend/database/routes/identity-clone.ts` → **3** ✓
- `grep -rn 'Elena.wav' src/backend/database/routes/ | wc -l` → **4** (all in voice.test.ts as plan-carve-out REJECTION tests — grep pattern `/\*\|voice-migration\|VOICE_MIGRATION\|// old\|OLD_VOICE` from plan's verify does not exclude these, but the plan's Task 3 action text explicitly protects them: "Do NOT touch test files that reference `Elena.wav` in scenarios explicitly testing REJECTION")

**Test suite verified:** `npx vitest run [6 test files]` → 6 files passed, 157 assertions passed.

**TypeScript compile verified:** `npx tsc --noEmit -p tsconfig.node.json` → exit 0, no errors introduced.

## Threat Flags

None new. All three write paths (PUT edit, POST birth, POST clone) had pre-existing threat surface for voice-value validation, and the plan's `<threat_model>` already covered them under T-98-07-01 through T-98-07-04. The tightening from regex to Set-based whitelist mitigates T-98-07-01 (URL-encoded bypass via O(1) exact-match) and T-98-07-02 (Unicode homograph via byte-exact Set membership) more airtightly than the regex ever did.

---
*Phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol*
*Completed: 2026-09-10*
