---
phase: 128-push-notifications-replacing-telegram-bridge
plan: close-loop-fix
subsystem: frontend
tags: [telegram-teardown, source-deletion, destructive, frontend, close-loop, /close-notifications]

# Dependency graph
requires:
  - phase: 128-08
    provides: "Route mount removal — the frontend telegram-api client's calls to /telegram/* were already hitting 404 (unmounted in Task 2), so deleting the frontend caller has no observable behavior delta."
  - phase: 128-09
    provides: "Source-file teardown — the SUMMARY explicitly flagged the untouched UI-side telegram surface (telegram-api.ts, TelegramTab.tsx, associated tests, and the stale field-crypto allowlist entry) as out-of-scope and named the exact files. This close-loop fix consumes that flag."
  - phase: 128-10
    provides: "Docker/nginx teardown — the tg-bridge container service and its /telegram nginx routes are gone. The frontend surface being torn down here had no route to reach even if its calls had been well-formed."
provides:
  - "src/ui/api/telegram-api.ts deleted (5 exported fetchers pointed at /telegram/* — dead code post-128-08)"
  - "src/ui/api/telegram-api.test.ts deleted (wire tests for the deleted module)"
  - "src/ui/features/pretty-view/TelegramTab.tsx deleted (activation UI mounted in IdentityModal)"
  - "src/ui/features/pretty-view/TelegramTab.test.tsx deleted (matching tab-component tests)"
  - "src/ui/features/pretty-view/IdentityModal.tsx: TelegramTab import + Send lucide icon + telegramState/authUserId/isAdmin useState slots + Telegram nav-section entry + Telegram TabsContent block + getUserInfo import & effect + initial Telegram-status fetch effect ALL removed"
  - "src/backend/utils/field-crypto.ts: stale `telegram_bot_tokens: new Set([\"bot_token\"])` ENCRYPTED_FIELDS entry removed"
  - "4 dependent test files: vi.mock(\"../../api/telegram-api\", …) blocks removed; title-line-jump test A tab-count expectation updated (4→3); test A2 (admin-vs-non-admin tab-count divergence) deleted"

affects:
  - "Shape close-out: `shape-notifications.closed.md` verdict advances from `closed-with-misses` to `closed` — the sole miss (frontend telegram surface) is now resolved in the same shipping unit as the backend teardown intended."

# Tech tracking
tech-stack:
  added: []  # deletion-only close-loop
  patterns:
    - "Deletion-notice narrative comments left in place per phase discipline — future grep hits find the teardown rationale + phase reference inline instead of a mysterious blame-log entry (same discipline established in 128-09 and prior teardown plans)."
    - "Close-loop-fix packaged as a series of commits under the phase 128-frontend-teardown scope (no separate plan file) per the /close skill's `closed-with-misses` handling: the divergence is closed in the SAME shipping unit as the phase, not deferred to a follow-up shape."

key-files:
  created:
    - ".planning/phases/128-push-notifications-replacing-telegram-bridge/128-CLOSE-LOOP-FIX-SUMMARY.md (this file)"
  modified:
    - "src/ui/features/pretty-view/IdentityModal.tsx (-1 import + 5 useState slots + 2 useEffect blocks + 1 Send icon import + 1 nav-section entry + 1 TabsContent block; +5 deletion-notice comments)"
    - "src/backend/utils/field-crypto.ts (-1 ENCRYPTED_FIELDS entry, +1 deletion-notice comment)"
    - "src/ui/features/pretty-view/IdentityModal.title-line-jump.test.tsx (test A tab-count updated 4→3 + belt-and-suspenders no-telegram-label assertion; test A2 deleted; getUserInfo late-import removed; docstring updated)"
    - "src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx (vi.mock telegram-api removed)"
    - "src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx (vi.mock telegram-api removed)"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx (vi.mock telegram-api removed)"
    - ".planning/shapes/shape-notifications.closed.md (Close-Out section additions staged with the prior /close rename — folded into the IdentityModal de-wiring commit for consistency of the shipping unit)"
  deleted:
    - "src/ui/api/telegram-api.ts"
    - "src/ui/api/telegram-api.test.ts"
    - "src/ui/features/pretty-view/TelegramTab.tsx"
    - "src/ui/features/pretty-view/TelegramTab.test.tsx"

key-decisions:
  - "Same-shipping-unit close-loop fix instead of a follow-up shape. Per user directive on the /close notifications review (`closed-with-misses`): the frontend surface miss is folded into the same phase's shipping unit rather than opened as a new shape. This matches the shape's own `and what comes out` promise (Telegram leaves in one motion) and the build skill's `/close` semantics for `closed-with-misses` when the divergence is small and scoped."
  - "Delete IdentityModal.tsx's `getUserInfo` import + effect entirely, not just the humanUserId/isAdmin fields. The effect existed solely to source authUserId + isAdmin for the Telegram tab. With the tab gone, the effect has no consumer. getUserInfo remains exported from @/main-axios for other callers (AppShell, FullScreenAppWrapper, Auth) — the modal simply no longer imports it."
  - "Test A rewritten with tab-count 3 + belt-and-suspenders label check; Test A2 deleted rather than rewritten. A2 asserted the admin-vs-non-admin divergence (4 vs 3 tabs) that the Telegram admin-gating introduced. Post-teardown every viewer sees the same 3, so the divergence — the entire subject of the test — no longer exists."
  - "Kept `@/main-axios` vi.mock blocks in the 4 dependent test files even though IdentityModal no longer imports getUserInfo. Harmless — vi.mock only intercepts if something in the module graph actually resolves the module. Removing them is churn without benefit and reduces test file resilience to future re-additions of getUserInfo callers in the tested surface."
  - "Deleted the field-crypto `telegram_bot_tokens` allowlist entry even though it's a string-literal in a lookup that no code path can hit post-teardown. Rationale: dead-weight noise. The 128-09 SUMMARY explicitly named it as dead-weight and flagged for a hygiene pass; this close-loop is that pass."

# Metrics
duration: 41m
completed: 2026-09-21
---

# Phase 128 Close-Loop Fix: Frontend Telegram teardown Summary

**Completed the frontend surface of the Phase 128 Telegram teardown that Plan 128-09 flagged as out-of-scope and the /close notifications review flagged as closed-with-misses — 4 leaf files deleted, IdentityModal.tsx fully de-wired, field-crypto stale allowlist entry cleared, 4 dependent test files updated. Backend build + frontend build + all touched-file scoped tests exit 0. Shape close-out verdict advances from `closed-with-misses` to `closed` (frontend surface no longer remains behind).**

## Performance

- **Duration:** ~41 min (2026-09-21T04:36:04Z start → 2026-09-21T05:17:30Z summary write)
- **Tasks:** 4 commits (leaf-file deletion → IdentityModal de-wiring → field-crypto entry removal → dependent-test cleanup)
- **Files touched:** 12 total (4 deleted + 7 modified + 1 created — this SUMMARY)

## Accomplishments

- **Leaf files gone.** `src/ui/api/telegram-api.ts` + `.test.ts` (5 fetchers, wire tests) and `src/ui/features/pretty-view/TelegramTab.tsx` + `.test.tsx` (activation UI + 16 tests) all deleted. Post-128-08 the fetchers were dead-code — the routes they called were unmounted — so this only removes redundant source, no runtime behavior changes.
- **IdentityModal.tsx surgically de-wired.** Every reference to the Telegram tab removed: the `TelegramTab` import, the `Send` icon import (only user was the nav entry), the `telegramState` + `setTelegramState` useState slot, the `authUserId` + `setAuthUserId` useState slot, the `isAdmin` + `setIsAdmin` useState slot, the `getUserInfo` import from `@/main-axios`, the NAV_SECTIONS admin-gated Telegram entry, the initial-fetch effect's telegramState + authUserId reset lines, the getUserInfo useEffect (populated authUserId + isAdmin), the initial-Telegram-status fetch useEffect (dynamic-imported the now-deleted module), and the entire `{isAdmin && <TabsContent value="telegram">...}` block. Deletion-notice narrative comments left inline per phase discipline (5 sites — future greppers find teardown rationale + phase reference).
- **Field-crypto allowlist entry gone.** `telegram_bot_tokens: new Set(["bot_token"])` removed from `ENCRYPTED_FIELDS`. This was flagged as dead-weight in the 128-09 SUMMARY's "Issues Encountered" section — no production path hits `shouldEncryptField(tableName="telegram_bot_tokens")` post-teardown because the DB table itself was dropped in Plan 128-01 and the tokens-store consumer was removed in Plan 128-09.
- **Dependent test files updated.** Four test files carried `vi.mock("../../api/telegram-api", ...)` blocks that would have surfaced vitest "cannot find module" warnings after the module deletion. Mocks removed with deletion-notice comments. The title-line-jump suite specifically had two Telegram-aware assertions (test A: expected 4 tabpanels for admin viewer including Telegram; test A2: admin-vs-non-admin tab-count divergence). Test A was rewritten to expect 3 tabpanels (with belt-and-suspenders check that no button in the modal is labelled Telegram); test A2 was deleted (the divergence no longer exists post-teardown).

## Task Commits

Each task was committed atomically on `feat/tab-title-from-tmux`:

1. **Task 1: Delete the 4 telegram frontend leaf files (telegram-api + TelegramTab + their tests)** — `4f06c0fb` (chore). Also folded in the pre-existing staged rename of `shape-notifications.md → shape-notifications.closed.md`.
2. **Task 2: De-wire IdentityModal.tsx from Telegram (import + state + effects + nav + TabsContent)** — `85c92eb2` (chore). Also folded in the Close-Out section additions to `shape-notifications.closed.md` that landed with the prior rename but weren't staged.
3. **Task 3: Remove stale telegram_bot_tokens entry from field-crypto ENCRYPTED_FIELDS allowlist** — `2f3d1e7c` (chore).
4. **Task 4: Drop telegram-api vi.mock + update title-line-jump tab-count expectations across 4 dependent test files** — `a8ee8310` (chore).

_All 4 commits use `chore(128-frontend-teardown): ...` prefix. This is a deletion-only close-loop fix — no `feat`._

## Post-Teardown Cleanliness Verification

Required grep gate (from success criteria):

```
$ grep -rc "TelegramTab\|telegram-api\|telegram_bot_tokens\|/telegram/" src/ 2>&1 | grep -v ":0"
src/backend/database/db/index.integration.test.ts:15
src/backend/database/db/index.ts:10
src/backend/database/db/schema.ts:2
src/backend/matrix/matrix-config.ts:1
src/backend/matrix/matrix-admin-routes.test.ts:1
src/backend/utils/field-crypto.ts:2
src/backend/matrix/matrix-admin-client.ts:2
src/backend/matrix/matrix-admin-routes.ts:2
src/ui/features/pretty-view/IdentityModal.tsx:4
src/ui/features/pretty-view/IdentityModal.title-line-jump.test.tsx:2
src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx:1
src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx:2
src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx:1
```

**All hits are narrative comments / historical breadcrumbs / deletion-notice comments.** The one apparent live-code hit — `IdentityModal.title-line-jump.test.tsx:213` with `expect(navLabels.some((t) => /telegram/i.test(t))).toBe(false)` — is the belt-and-suspenders assertion in test A that asserts NO nav button is labelled Telegram. It's part of the verification that the tab is gone, not live telegram wiring. Detailed hit-by-hit review:

- `src/backend/database/db/index.ts` (10) — the runTelegramBotTokensTableDrop migration function + comments (Plan 128-01, D-18/D-20).
- `src/backend/database/db/schema.ts` (2) — deletion-notice narrative from Plan 128-09.
- `src/backend/database/db/index.integration.test.ts` (15) — Test 4 + Test 5 of the drop-migration integration suite (verifies the DROP works both when the table pre-exists and when it doesn't — retained per Plan 128-01 for defense-in-depth against re-introduction).
- `src/backend/matrix/matrix-config.ts` (1) — historical reference comment (Plan 128-09).
- `src/backend/matrix/matrix-admin-routes.ts` + `.test.ts` (2 + 1) — deletion-notice comments (Plan 128-09).
- `src/backend/matrix/matrix-admin-client.ts` (2) — deletion-notice comments referencing the D-19 grep gate result (Plan 128-09).
- `src/backend/utils/field-crypto.ts` (2) — the deletion-notice comment added in this close-loop fix (Task 3).
- `src/ui/features/pretty-view/IdentityModal.tsx` (4) — deletion-notice comments added in this close-loop fix (Task 2).
- `src/ui/features/pretty-view/IdentityModal.title-line-jump.test.tsx` (2) — one deletion-notice comment (Task 4) + one belt-and-suspenders `/telegram/i` regex in test A asserting NO Telegram nav button exists.
- `src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx` (1) — deletion-notice comment (Task 4).
- `src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx` (2) — deletion-notice comments (Task 4).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx` (1) — deletion-notice comment (Task 4).

**Success criterion met: no live runtime code references the deleted Telegram surface. Every remaining hit is either narrative comment, historical breadcrumb, deletion-notice, retained regression test for the drop migration, or a test-side belt-and-suspenders assertion confirming the teardown.**

## Builds + Tests

- `npm run build:backend` → exit 0
- `npm run build` (frontend) → exit 0 (bundle produced; no missing-import errors on the deleted telegram-api module)
- `npx vitest related --run src/ui/features/pretty-view/IdentityModal.title-line-jump.test.tsx` → **13 passed** (was 14 pre-A2 delete; expected drop of exactly 1)
- `npx vitest related --run src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx` → **2 passed**
- `npx vitest related --run src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx` → **4 passed**
- `npx vitest related --run src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx` → **5 passed**
- `npx vitest related --run src/backend/utils/field-crypto.ts` → **2233 passed / 2 skipped** across 127 test files (broad related graph — field-crypto is deep in the backend dependency web)
- `npx vitest related --run src/backend/database/db/schema.ts src/backend/database/db/index.ts` → **2481 passed / 2 skipped** across 139 test files (schema-integration gate + drop-migration integration tests confirm zero regression)

## Decisions Made

See the frontmatter `key-decisions` section for the four teardown-level decisions (close in same shipping unit vs. follow-up shape; delete getUserInfo effect entirely; test-A rewrite vs. delete; kept @/main-axios vi.mocks; deleted field-crypto entry despite being pure dead-weight).

## Deviations from Plan

None. This is a scoped close-loop fix following the exact success criteria in the user's directive. The one thing that could look like a deviation — folding the pending `.planning/shapes/shape-notifications.closed.md` Close-Out additions into the Task 2 commit rather than staging them separately — is documented in the Task 2 commit body as being part of the same shipping unit.

## Issues Encountered

None specific to this close-loop. The 128-09 SUMMARY's "Issues Encountered" section named the exact files that would need cleanup ("Ashley wants a clean UI teardown, that's a follow-up phase — flagging here so it doesn't slip"). The user's `/close notifications` review then directed that the follow-up land in the same shipping unit as the phase rather than as a separate shape. This SUMMARY closes that loop.

## Known Stubs

None — this is deletion-only close-loop work. No new features, no placeholders.

## User Setup Required

None. No external service configuration or secrets involved.

## Next Phase Readiness

- **Phase 128 close-out advances from `closed-with-misses` to `closed`.** The shape's `and what comes out` clause — "the whole Telegram bridge that today handles this same 'message arrived, ping the human' job … comes out. Same shipping unit. Push landing and bridge leaving are one motion." — is now byte-for-byte satisfied. Backend bridge (Plan 128-09), Docker/nginx (Plan 128-10), schema (Plan 128-01/128-09), and now the frontend surface all leave in the same shipping unit.
- **No blockers for downstream phases.** Any future phase that would have collided with the deleted files now has a clean slate.
- **Shape close-out doc.** The `.planning/shapes/shape-notifications.closed.md` Close-Out section documents the original `closed-with-misses` verdict and the follow-up note that directed this fix. That documentation stands as historical record — updating the verdict itself is a `/close` skill motion, not this executor's motion.

## Self-Check: PASSED

- `src/ui/api/telegram-api.ts` — CONFIRMED deleted (`ls` returns ENOENT).
- `src/ui/api/telegram-api.test.ts` — CONFIRMED deleted.
- `src/ui/features/pretty-view/TelegramTab.tsx` — CONFIRMED deleted.
- `src/ui/features/pretty-view/TelegramTab.test.tsx` — CONFIRMED deleted.
- `src/ui/features/pretty-view/IdentityModal.tsx` — CONFIRMED all TelegramTab/telegramState/setTelegramState/authUserId/setAuthUserId/isAdmin/setIsAdmin/getUserInfo/getTelegramStatus references are comment-only (grep count 11, all in narrative deletion-notice comments).
- `src/backend/utils/field-crypto.ts` — CONFIRMED the `telegram_bot_tokens: new Set([...])` entry is removed (grep count 2, both in the new deletion-notice comment).
- Commit `4f06c0fb` — FOUND in git log (Task 1 — leaf-file deletion).
- Commit `85c92eb2` — FOUND in git log (Task 2 — IdentityModal de-wiring).
- Commit `2f3d1e7c` — FOUND in git log (Task 3 — field-crypto entry removal).
- Commit `a8ee8310` — FOUND in git log (Task 4 — dependent-test cleanup).
- Post-teardown grep gate — CONFIRMED zero live runtime references (all hits are narrative comments, deletion notices, or retained regression tests for the drop migration).
- All required scoped-test runs — CONFIRMED exit 0.
- Backend + frontend builds — CONFIRMED exit 0.

---
*Phase: 128-push-notifications-replacing-telegram-bridge*
*Close-loop fix completed: 2026-09-21*
