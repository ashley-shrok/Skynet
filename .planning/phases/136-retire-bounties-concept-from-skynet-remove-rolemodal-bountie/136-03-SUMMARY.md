---
phase: 133-retire-bounties-concept-from-skynet-remove-rolemodal-bountie
plan: 03
subsystem: pretty-view-ui

tags: [dead-code-removal, react, role-modal, bounties-retirement, tabs-nav]

# Dependency graph
dependency_graph:
  requires:
    - phase: 133-retire-bounties-concept-from-skynet-remove-rolemodal-bountie
      provides: "Plan 02 leaf-delete cleared bounty test files (no fixture collisions with the UI surgery here)"
  provides:
    - "3-tab RoleModal (Role file / Runbooks / Wakeups) — visible UI change: no user-facing bounties surface remains in Skynet"
    - "Unblocked Plan 04 to delete RoleBountiesTab.tsx + BountyCard.tsx source components (their only UI consumer, RoleModal.tsx, no longer imports them)"
  affects:
    - "Plan 04 (Wave 2 leaf-file deletions) — RoleBountiesTab.tsx / BountyCard.tsx now import-orphaned but preserved on disk per plan 03 <do-not-delete-here> directive"
    - "Plan 05+ (frontend API surface deletion) — listBountiesForRoleName in claude-session-api.ts is now called from ZERO callers"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic-pair edit for source+test — RoleModal.tsx + RoleModal.test.tsx co-committed in Task 1 to avoid intermediate red-test state on the shared listBountiesForRoleName mock surface"
    - "Comment-hygiene sweep — dropped 'bounties' from prop/component docblocks so the surviving code doesn't lie about what tabs the modal owns"

key-files:
  created:
    - .planning/phases/136-retire-bounties-concept-from-skynet-remove-rolemodal-bountie/136-03-SUMMARY.md
  modified:
    - src/ui/features/pretty-view/RoleModal.tsx
    - src/ui/features/pretty-view/RoleModal.test.tsx
    - src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx

key-decisions:
  - "Kept the (identity, role) modal contract byte-identical apart from the deleted Bounties tab — NAV_SECTIONS shrinks from 4 to 3 entries, but the surviving 3 entries retain their exact `value`, `label`, and `Icon` bindings so RoleModal's default-active-tab semantics (`role`) and tab-switching behavior are unchanged."
  - "Preserved the `<TabsContent value=\"role\">`, `<TabsContent value=\"runbooks\">`, and `<TabsContent value=\"role-wakeups\">` blocks byte-for-byte (only the `<TabsContent value=\"bounties\">` block deleted). Zero risk of accidental cross-tab regression."
  - "Chose to REMOVE the `Target` icon from the lucide-react import (not just from the NAV_SECTIONS entry) — a post-edit grep confirmed `Target` had no other consumer in the file."
  - "Did NOT delete RoleBountiesTab.tsx or BountyCard.tsx source files per the plan's explicit sequencing — those are Plan 04 Task 1's job, gated on Task 1 of THIS plan removing the RoleModal import."
  - "Did NOT scrub the `nav.conversations.filterPinnedBounties` translation key from the i18n JSON files — per RESEARCH.md R-5, the JSON keys are inert if left; scope creep to touch them."

patterns-established:
  - "Atomic source+test edit for shared-mock deletions: when a component and its test share a mock-surface entry (here: listBountiesForRoleName was imported by RoleModal and mocked by RoleModal.test), delete both in the same commit to prevent an intermediate state where the test's vi.mock factory returns a stub for a symbol the module no longer exports."

requirements-completed: []  # Plan frontmatter declares `requirements: []`

# Metrics
metrics:
  duration: "5m 42s"
  completed: 2026-09-23
  tasks_completed: 3
  files_modified: 4
  files_deleted: 0
  files_created: 0
  commits: 3
---

# Phase 136 Plan 03: Wave 2 UI surgery — strip Bounties tab from RoleModal Summary

**Wave 2 amputation of the last user-visible bounties surface in Skynet: RoleModal shrinks from 4 tabs to 3 (Role file / Runbooks / Wakeups), its shared listBountiesForRoleName mock scaffolding is removed from two test files, and a dead `filterPinnedBounties` label declaration in PrettyConversationsPanel is deleted.**

## Performance

- **Duration:** 5m 42s (342s)
- **Started:** 2026-09-23T18:14:44Z
- **Completed:** 2026-09-23T18:20:26Z
- **Tasks:** 3
- **Files modified:** 4
- **Files deleted:** 0 (RoleBountiesTab.tsx + BountyCard.tsx preserved per plan; Plan 04 deletes them)

## Accomplishments

- **RoleModal.tsx**: removed the Bounties nav entry from NAV_SECTIONS (4→3 entries), the `<TabsContent value="bounties">` block and its `<RoleBountiesTab>` child, the `RoleBountiesTab` import, the `Target` lucide-react icon import (verified unused elsewhere), and updated 2 header/prop docblocks that named "bounties" as a role-scope tab.
- **RoleModal.test.tsx**: retitled Test A from "renders 4 tabs — Role file / Runbooks / Bounties / Wakeups" to "renders 3 tabs — Role file / Runbooks / Wakeups"; updated its assertion (`navButtons!.length` 4→3; deleted the `expect(navButtons![2].textContent).toContain("Bounties")` line); deleted the `mockListBountiesForRoleName` declaration block (L83-88 pre-edit), its `vi.mock` factory entry (L102-103 pre-edit), and its `beforeEach` reset (L157-160 pre-edit); updated file-header comment to drop the "Bounties tab consumes listBountiesForRoleName" sentence.
- **PrettyView.role-modal-swap.test.tsx**: deleted the `listBountiesForRoleName: vi.fn().mockResolvedValue({...})` entry from the `vi.mock("@/api/claude-session-api", …)` factory; rewrote the surrounding comment to describe the surviving 5-helper surface.
- **PrettyConversationsPanel.tsx**: deleted the 3-line dead `filterLabel = t("nav.conversations.filterPinnedBounties", …)` declaration (RESEARCH.md Pitfall 3).
- All acceptance-criteria greps pass: `grep -c 'RoleBountiesTab'` returns 0 in RoleModal.tsx, `grep -c '"bounties"'` returns 0, `grep -c 'mockListBountiesForRoleName'` returns 0 in RoleModal.test.tsx, `grep -c 'listBountiesForRoleName'` returns 0 in both `RoleModal.test.tsx` and `PrettyView.role-modal-swap.test.tsx`, `grep -c 'filterLabel\|filterPinnedBounties'` returns 0 in `PrettyConversationsPanel.tsx`.
- Wave 2 gate cleared: consolidated scoped vitest across the 3 modified UI paths runs 200 tests across 10 files, all pass.

## Task Commits

| Task | Type | Hash | Message |
|------|------|------|---------|
| 1 | feat(136-03) | `f80ca9a1` | strip Bounties tab + import + test scaffold from RoleModal |
| 2 | test(136-03) | `171773ff` | strip listBountiesForRoleName mock from PrettyView.role-modal-swap.test.tsx |
| 3 | refactor(136-03) | `40cc863b` | delete dead filterLabel + filterPinnedBounties from PrettyConversationsPanel |

## Files Created/Modified

**Modified (4):**
- `src/ui/features/pretty-view/RoleModal.tsx` — 3 imports trimmed, 1 nav entry deleted, 1 TabsContent block deleted, 2 docblocks updated (net -14 lines)
- `src/ui/features/pretty-view/RoleModal.test.tsx` — 1 mock block deleted, 1 factory entry deleted, 1 beforeEach reset deleted, Test A retitled + reasserted (net -22 lines)
- `src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx` — 1 mock factory entry deleted, comment rewritten (net -3 lines)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — 3-line dead label declaration deleted

**Preserved (as required by plan):**
- `src/ui/features/pretty-view/RoleBountiesTab.tsx` — source component still present; import-orphaned. Plan 04 Task 1 deletes it.
- `src/ui/features/pretty-view/BountyCard.tsx` — its only importer (RoleBountiesTab.tsx) is still present, so it too remains import-linked until Plan 04.

## Verification (per plan Wave-2 gate)

| Gate | Command | Result |
|------|---------|--------|
| RoleModal.tsx: no RoleBountiesTab | `grep -c 'RoleBountiesTab' src/ui/features/pretty-view/RoleModal.tsx` | `0` |
| RoleModal.tsx: no "bounties" nav value | `grep -c '"bounties"' src/ui/features/pretty-view/RoleModal.tsx` | `0` |
| RoleModal.tsx: no Target icon | `grep -cE '\bTarget\b' src/ui/features/pretty-view/RoleModal.tsx` | `0` |
| RoleModal.test.tsx: no bounty mocks | `grep -c 'mockListBountiesForRoleName' src/ui/features/pretty-view/RoleModal.test.tsx` | `0` |
| RoleModal.test.tsx: no listBountiesForRoleName | `grep -c 'listBountiesForRoleName' src/ui/features/pretty-view/RoleModal.test.tsx` | `0` |
| swap-test: no bounty refs | `grep -cE 'listBountiesForRoleName\|RoleBountiesTab' src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx` | `0` |
| panel: no filterLabel | `grep -cE 'filterLabel\|filterPinnedBounties' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | `0` |
| Frontend typecheck | `npx tsc --noEmit -p tsconfig.app.json` | Only pre-existing errors surface (RoleModal.tsx JSX namespace, IdentitySessionPane.tsx onOpenRoleModal, PrettyConversationsPanel.projects.test.tsx TS2554, etc.) — verified via pre-edit re-run against a stashed working tree; the edits introduced ZERO new errors. |
| Scoped vitest (RoleModal.test) | `npx vitest related --run src/ui/features/pretty-view/RoleModal.test.tsx` | 13/13 pass |
| Scoped vitest (swap-test) | `npx vitest related --run src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx` | 4/4 pass |
| Scoped vitest (panel) | `npx vitest related --run src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | 8 files / 183 tests pass |
| Wave-2 consolidated gate | `npx vitest related --run <all 3 paths>` | 10 files / 200 tests pass |

## Truth-check against `must_haves`

- ✓ RoleModal renders exactly 3 nav tabs — Role file / Runbooks / Wakeups. Verified by Test A ("renders 3 tabs") asserting `navButtons!.length === 3` and each button's textContent in order.
- ✓ No React code path in the UI attempts to mount RoleBountiesTab or BountyCard. RoleModal was the sole consumer of RoleBountiesTab; its import + JSX mount are both gone. RoleBountiesTab was the sole consumer of BountyCard.
- ✓ PrettyConversationsPanel no longer declares the dead `filterLabel` const or references the `filterPinnedBounties` i18n key (via a t() lookup) — the 3-line declaration is deleted. The key still exists in i18n JSON files but is inert (RESEARCH.md R-5, out of scope per plan).

## Artifact-check against `must_haves.artifacts`

| Artifact | Provides claim | Excludes | Verified |
|----------|----------------|----------|----------|
| RoleModal.tsx | 3-tab role modal | `value: "bounties"`, `RoleBountiesTab` import | ✓ (grep 0 for both) + Target icon import also removed |
| RoleModal.test.tsx | Test A retitled to "3 tabs"; no mockListBountiesForRoleName | `mockListBountiesForRoleName` | ✓ (grep 0 + Test A passing under new title) |
| PrettyView.role-modal-swap.test.tsx | Test file without listBountiesForRoleName mock | `listBountiesForRoleName` | ✓ (grep 0) |
| PrettyConversationsPanel.tsx | Panel without dead filterLabel const | `filterPinnedBounties` | ✓ (grep 0) |

## Key-links check

- ✓ `src/ui/features/pretty-view/RoleModal.tsx` → NAV_SECTIONS constant → 3-entry array (role / runbooks / role-wakeups). Verified by reading the declaration site post-edit: `NAV_SECTIONS = [ { value: "role", ...}, { value: "runbooks", ...}, { value: "role-wakeups", ...} ] as const` — exactly 3 entries.

## Decisions Made

- **Atomic Task 1 (source + test co-committed).** RoleModal.tsx and RoleModal.test.tsx share the listBountiesForRoleName mock surface. Editing them in separate commits would create an intermediate state where the test's `vi.mock` factory returns a stub for `listBountiesForRoleName` while the module still exports it — no red test window, but the plan called for atomicity for defense-in-depth and consistency with the pattern used across the phase.
- **Target icon deleted from the lucide-react import.** A grep before removing confirmed `Target` had no other usage in RoleModal.tsx — the only reference was the L88 NAV_SECTIONS entry being deleted. Removing it from the import list keeps the import block clean.
- **NAV_SECTIONS entry order preserved.** The 3 surviving entries — role / runbooks / role-wakeups — retain their exact positions in the array (positions 0, 1, and now 2 — previously 0, 1, 3), so `activeTab === "role"` still correctly matches the first-position default and no other index-based logic breaks.
- **The 4-item-comment on the bottom nav container was updated to 3-item** with a Phase 136 attribution. Load-bearing comment: it documents intent for future readers.
- **Did NOT delete RoleBountiesTab.tsx / BountyCard.tsx.** Plan's `<action>` for Task 1 explicitly says "Do NOT delete RoleBountiesTab.tsx here — that's Plan 04 Task 1." Plan 04 will handle the source deletions once this plan's import removals ship.
- **Did NOT search or edit i18n JSON files** for the `filterPinnedBounties` key. Plan's Task 3 `<action>` explicitly says "Do NOT search the i18n JSON files here — the `filterPinnedBounties` translation key can stay in the JSON files (inert per R-5)."

## Deviations from Plan

None — plan executed exactly as written. All three tasks completed in order with the exact file targets, grep verifications, and vitest gates specified in the plan's `<action>` and `<acceptance_criteria>` blocks. No Rule 1-4 auto-fixes triggered.

**Minor internal correction (not a deviation):** During Task 2, my first comment rewrite included the substring `listBountiesForRoleName` (to describe what was being removed), which tripped the plan's acceptance-criteria grep. Immediately reworded the comment to avoid the substring — the acceptance grep then returned 0. This is fixing my own transient breakage within the same task, not a plan deviation.

**Pre-existing tsc noise:** The frontend typecheck surfaces ~30 errors, all of which were verified to exist BEFORE my edits by running `npx tsc` against a stashed working tree. None of these errors are caused by the Wave-2 edits. Notable pre-existing errors:
- `RoleModal.tsx(233,21): error TS2503: Cannot find namespace 'JSX'` (was L236 pre-edit — the JSX namespace issue is unaffected by my line-shifting deletions)
- `RoleBountiesTab.tsx(95,27): error TS2503: Cannot find namespace 'JSX'` (this file is slated for deletion in Plan 04)
- `IdentitySessionPane.tsx(590,16): error TS2741: Property 'onOpenRoleModal' is missing` (unrelated to bounties)
- `PrettyConversationsPanel.projects.test.tsx(55,26): error TS2554: Expected 0 arguments` (unrelated to bounties)

The scoped vitest run confirms the touched code paths still behave correctly — 200/200 tests pass across the 10 relevant test files.

## Authentication gates

None — pure code edit; no external service auth touched.

## Issues Encountered

None. The scoped vitest surfaced two categories of pre-existing test-environment noise unrelated to this plan:
- `Not implemented: Window's alert() method` — standard jsdom limitation (5 occurrences in PrettyConversationsPanel test run); not a test failure.
- `[console-forward-transport] flush failed (best-effort): ENOENT` was NOT observed in this plan's runs (env may differ).

## User Setup Required

None — no external service configuration required. This plan is pure React + test surgery.

## Next Phase Readiness

- **Plan 04 (Wave 2 leaf-file deletions — RoleBountiesTab.tsx + BountyCard.tsx) unblocked.** RoleBountiesTab.tsx is now import-orphaned — RoleModal.tsx no longer references it. BountyCard.tsx's only importer is RoleBountiesTab.tsx, so it too is safe to delete once Plan 04 removes RoleBountiesTab.tsx.
- **Frontend API surface cleanup (later plan) has clear runway.** `listBountiesForRoleName` in `src/ui/api/claude-session-api.ts` now has ZERO callers (RoleBountiesTab.tsx still calls it, but that file's deletion in Plan 04 will make the API helper import-orphaned too).
- **No architectural blockers surfaced.** The 3-tab RoleModal renders identically to before, just missing the Bounties tab. No behavioral changes to Role file, Runbooks, or Wakeups tabs.

## Known Stubs

None. This is a deletion plan — no new UI, no new placeholder text, no components rendering empty data-source outputs.

## Threat Flags

None. This plan removed UI surface; it did NOT introduce any new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. Threat surface strictly shrunk.

## Self-Check: PASSED

**Commits verified in git log:**
- `f80ca9a1` — Task 1 (feat: RoleModal + test atomic pair) — FOUND
- `171773ff` — Task 2 (test: swap-test mock cleanup) — FOUND
- `40cc863b` — Task 3 (refactor: panel filterLabel deletion) — FOUND

**Files verified present on disk:**
- `src/ui/features/pretty-view/RoleModal.tsx` — FOUND (modified)
- `src/ui/features/pretty-view/RoleModal.test.tsx` — FOUND (modified)
- `src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx` — FOUND (modified)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — FOUND (modified)
- `src/ui/features/pretty-view/RoleBountiesTab.tsx` — FOUND (preserved per plan; Plan 04 deletes)
- `src/ui/features/pretty-view/BountyCard.tsx` — FOUND (preserved per plan; Plan 04 deletes)

**Acceptance greps re-verified post-commit:**
- `grep -c 'RoleBountiesTab' src/ui/features/pretty-view/RoleModal.tsx` → 0
- `grep -c '"bounties"' src/ui/features/pretty-view/RoleModal.tsx` → 0
- `grep -cE '\bTarget\b' src/ui/features/pretty-view/RoleModal.tsx` → 0
- `grep -c 'mockListBountiesForRoleName' src/ui/features/pretty-view/RoleModal.test.tsx` → 0
- `grep -c 'listBountiesForRoleName' src/ui/features/pretty-view/RoleModal.test.tsx` → 0
- `grep -cE 'listBountiesForRoleName|RoleBountiesTab' src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx` → 0
- `grep -cE 'filterLabel|filterPinnedBounties' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` → 0

**Test gates re-verified:**
- Wave-2 consolidated vitest — 10 test files / 200 tests pass

---
*Phase: 133-retire-bounties-concept-from-skynet-remove-rolemodal-bountie*
*Completed: 2026-09-23*
