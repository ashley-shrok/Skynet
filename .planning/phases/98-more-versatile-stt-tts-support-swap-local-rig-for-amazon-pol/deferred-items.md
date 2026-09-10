# Phase 98 — Deferred Items

Items discovered during Phase 98 plan execution that are out of scope for the current plan but worth tracking for a follow-up sweep.

## From Plan 98-07 (2026-09-10)

### ~~roles-create.ts still carries the old regex~~ — CLOSED 2026-09-10 (fix landed inline mid-Wave-3 by tabitha)

- **File:** `src/backend/database/routes/roles-create.ts:134`
- **Issue:** `const ROLE_VOICE_RE = /^[A-Z][A-Za-z]+\.wav$/;` explicitly mirrors the now-deleted IDENTITY_VOICE_RE. Rejects Polly voice IDs on POST /roles cosmetics.voice.
- **Resolution:** Fix landed inline mid-Wave-3 orchestration — see fix commit prefixed `fix(98-07-followon)`. Import isValidPollyVoice, delete ROLE_VOICE_RE, swap call-site, sweep Kate.wav test fixtures → Joanna to match Plan 07's Elena.wav → Joanna pattern. 20/20 roles-create tests pass.
- **Original why-deferred:** Not in Plan 98-07's `files_modified` list. Plan 98-05's migration walks the role tree, so pre-existing role frontmatter voice values are wiped by the time HTTP accepts traffic — a fresh POST /roles with a Polly voice value would 400-reject, but this is a rare path (roles created less frequently than identities edited).
- **Follow-up scope:** Single-file swap — delete ROLE_VOICE_RE, import isValidPollyVoice from `../../voice/polly-voice-catalog.js`, swap the call-site at L396, update the error message to match the identities.ts / identity-birth.ts / identity-clone.ts shape.

### Cosmetic `Elena.wav` fixtures scattered across the codebase

- **Files with `Elena.wav` refs after Plan 98-07 (from `grep -rln`):**
  - `src/backend/database/routes/voice.test.ts` — 2 sites, PLAN-CARVE-OUT REJECTION TESTS, leave as-is
  - `src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts` — frontmatter extraction test, doesn't hit validator
  - `src/backend/database/db/index.migration.test.ts` — DB migration seed, historical
  - `src/backend/voice/polly-voice-catalog.test.ts` — REJECT-Elena-wav test, KEEP
  - `src/backend/voice/voice-migration.test.ts` — MIGRATION test cases, KEEP
  - `src/backend/voice/polly-voice-catalog.ts` — module docstring reference to old regex, KEEP
  - `src/backend/voice/voice-migration.ts` — OLD_VOICE_RE regex definition, KEEP
  - `src/ui/api/identities-api.test.ts` — frontend API client test payload
  - `src/ui/sidebar/CreateRoleDialog.test.tsx` — frontend create-role dialog test fixture
  - `src/ui/features/pretty-view/IdentityModal.voice.test.tsx` — docstring reference, mentions the swap intent
  - `src/ui/features/pretty-conversations/PrettyConversationRow.clone-menu.test.tsx` — frontend clone-menu test fixture
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx` — frontend clone-dialog test fixture
- **Why deferred:** None of these tests hit the tightened backend validator (they either test frontmatter parsing at a lower level, test frontend UI with mocked backends, or test the api client's payload shape — none reach isValidPollyVoice). Cosmetic cleanup only.
- **Follow-up scope:** Sweep in a cosmetic-cleanup pass. Substitute Elena.wav → Joanna in frontend fixtures + api tests; leave voice-migration/polly-voice-catalog test files intact (their references are load-bearing coverage for the migration + validator).
