---
phase: 90-role-management-modal-split
plan: 05
subsystem: ui

tags: [react, radix-dialog, pretty-view, roles-list, host-picker, pv-row]

requires:
  - phase: 90-role-management-modal-split-01
    provides: listRolesForHost with extended RoleSummary cosmetics (title, displayName, colorHue, voice, avatar)
  - phase: 90-role-management-modal-split-02
    provides: roleAvatarUrl(hostId, roleName) helper returning /roles/:name/avatar?hostId=<n>
  - phase: 90-role-management-modal-split-04
    provides: RoleModal component (target of onSelectRole row-click swap in Plan 90-06)

provides:
  - RolesListModal — global modal (portals to document.body) with host-picker + alphabetical `.pv-row`-treatment role rows in per-role hue
  - RolesListModalProps API — {open, onOpenChange, hostTree, defaultHostId, onSelectRole(roleName, roleCosmetics, hostId)}
  - '+ New role' header button that stacks CreateRoleDialog on top and refreshes list on onCreated
  - Empty state UX — 'This host has no roles yet.' + prominent secondary + New role affordance

affects:
  - 90-06 (Wave 4) — will wire RolesListModal into PrettyConversationsPanel's three-dots menu 'Edit roles…' entry and coordinate row-click swap-to-RoleModal

tech-stack:
  added: []
  patterns:
    - "Global modal chrome — 4th caller of the portal-to-document.body pattern (GlobalFilesModal → SkillsEditorModal → RoleModal → RolesListModal). D-CTX-30 extract-when-fifth-caller-emerges precedent holds."
    - "`.pv-row` inline-style translation — 3rd caller of the class-based-hue-not-viable inline-hsla-substitution pattern (PrettyConversationRow → PrettyConversationsPanel drag-preview → RolesListModal rows)."
    - "Fetch-version counter for imperative re-fetch — bumps a useState counter to trigger a fetch-effect re-run without invalidating selectedHostId (CreateRoleDialog.onCreated success path)."

key-files:
  created:
    - src/ui/features/pretty-view/RolesListModal.tsx (468 lines) — the new global modal
    - src/ui/features/pretty-view/RolesListModal.test.tsx (525 lines) — 16 tests, all green
  modified: []

key-decisions:
  - "Stack (not swap) for '+ New role' → CreateRoleDialog per D-10 planner-pick — settings-surface convention (Skills, Global Files) puts creation actions in the header and stacks a sub-modal on top. The swap-not-stack philosophy applies to the RolesList → RoleModal navigational transition, not the RolesList → CreateRoleDialog authoring transition."
  - "Fetch-version counter (fetchVersion state + `[selectedHostId, fetchVersion]` deps) is the imperative re-fetch trigger for post-CreateRoleDialog.onCreated success, rather than clearing selectedHostId. Keeps the fetch effect single-sourced and preserves the picked host across the round-trip."
  - "Single Portal per Radix Dialog root — CreateRoleDialog owns its own Radix Dialog + Portal, so stacking it inside RolesListModal's DialogContent gives it a natural z-index ceiling (its own Portal renders above RolesListModal's DialogContent because it's mounted later in the tree)."
  - "`.pv-row` values inlined verbatim from pretty-conversations.css L482-517 (not shared via CSS custom property or util) — jsdom serialization of `hsla()` in background/border collapses to `rgba()`, but preserves it in `box-shadow`; keeping the inline style substrate lets tests assert the hue via the box-shadow slot without a browser-vs-jsdom regression risk."

patterns-established:
  - "Inline `.pv-row` treatment: any modal rendering role-rows in a role's own hue can reuse the exact inline-style structure from RolesListModal.tsx L318-360 (row + avatar disc)."
  - "Empty-state affordance duplication: modals with a header-based creation button should ALSO surface an in-body secondary button in the empty branch — users hunting for '+ New role' in an empty modal shouldn't have to look up at the chrome."

requirements-completed: []

duration: 6min
completed: 2026-09-09
---

# Phase 90 Plan 90-05: RolesListModal Summary

**New global modal `RolesListModal` — host-picker + alphabetical `.pv-row`-treatment role rows in per-role hue + '+ New role' header button that stacks CreateRoleDialog and refreshes the list on success.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-09-09T13:50:00Z (approx from git log)
- **Completed:** 2026-09-09T13:56:29Z (approx from git log)
- **Tasks:** 2 (per plan; TDD RED-then-GREEN structure)
- **Files created:** 2 (new component + new test file)

## Accomplishments

- New `RolesListModal.tsx` (468 lines) — 4th caller of the global-modal-portal-to-document.body pattern, joining GlobalFilesModal, SkillsEditorModal, and RoleModal
- Host-picker mirrors the Edit-global-files pattern verbatim (per D-02): single-host users see their sole host auto-selected + picker hidden; multi-host users pick from `<select>`
- Each role row rendered as a `<button>` in exact `.pv-row` treatment with the role's `colorHue` inlined into the linear-gradient, border, box-shadow hue-glow, and 40px `.pv-avatar`-style disc (per D-05). Fallback hue 190 when a role frontmatter lacks `colorHue`.
- Alphabetical sort by `displayName` (fallback: title-cased kebab-slug)
- Row click emits `onSelectRole({roleName, roleCosmetics: RoleSummary, hostId})` — full cosmetics ship in the callback so Plan 90-06's parent wiring can pass them straight to `<RoleModal>` without a re-fetch
- '+ New role' header button opens `CreateRoleDialog` on top of RolesListModal (stack per D-10 planner-pick). `onCreated` bumps a fetch-version counter → roles list refreshes so the new role appears without closing the modal.
- Empty state surfaces "This host has no roles yet." + a prominent secondary + New role button so users don't have to hunt for the header affordance
- 16 tests, all green — covers portal target, host-picker (multi + single + placeholder), fetch on host change, loading/error/reset-on-close, defaultHostId auto-select, full-cosmetics row style tokens, no-cosmetics fallback, displayName fallback, alphabetical sort, row-click payload shape, `+ New role` opens CreateRoleDialog, onCreated refetch, empty state

## Task Commits

Each task step was committed atomically per TDD RED/GREEN:

1. **Task 1+2 RED — failing tests for RolesListModal** — `309445d0` (`test(90-05): add failing tests for RolesListModal (RED phase)`)
2. **Task 1+2 GREEN — RolesListModal implementation satisfying all 16 tests** — `bd8a61b7` (`feat(90-05): implement RolesListModal — host-picker + .pv-row rows + '+ New role' header (GREEN phase)`)

The plan structured Task 1 (shell + host-picker + fetch) and Task 2 (rows + '+ New role' + empty state) as separate TDD cycles. In practice the test-file contained all 16 tests before the component was written, and the component satisfied both task groups in a single implementation pass — the Task-2 features (rows, empty state, CreateRoleDialog stack) all live inside the same body branches as Task-1's layered-branch shell, so extracting them into separate feat commits would have produced a first commit whose component didn't compile against its own tests. TDD gate compliance holds: one RED commit followed by one GREEN commit, both aligned to the plan's task boundaries via the test-file structure (tests A-H = Task 1 behavior, I-P = Task 2 behavior).

**Plan metadata:** _pending — will commit SUMMARY.md separately at the end of this session per fleet rules (no ROADMAP.md updates, no requirements to mark since this plan has `requirements: []`)._

## Files Created/Modified

- `src/ui/features/pretty-view/RolesListModal.tsx` (created, 468 lines) — the new global modal component
- `src/ui/features/pretty-view/RolesListModal.test.tsx` (created, 525 lines) — 16 scoped tests

No modifications to existing source files — RolesListModal is a leaf component that will be consumed in Plan 90-06 (PrettyConversationsPanel three-dots menu + parent-side swap-not-stack row-click wiring).

## Decisions Made

See `key-decisions` in frontmatter above for the machine-readable list. In prose:

1. **Stack, not swap, for the '+ New role' → CreateRoleDialog transition** (per D-10 discretion). Settings-surface convention (Skills, Global Files) has always stacked authoring sub-modals on top of the parent list; the swap-not-stack philosophy applies to navigational transitions (RolesList → RoleModal for viewing/editing an existing role), not authoring transitions.
2. **Fetch-version counter (`useState<number>` + effect dep) for imperative re-fetch after CreateRoleDialog success.** Alternative was clearing + re-setting `selectedHostId` (fires the existing effect); the version counter preserves picked-host UX without re-triggering the host-select mount effect.
3. **Inline `.pv-row` values verbatim, not via a shared util.** jsdom serialization of `hsla()` collapses `background`/`border` to `rgba()` but preserves `hsla()` in `box-shadow`. Keeping the inline style shape lets tests assert on the box-shadow slot (raw hue survives), avoiding a browser-vs-jsdom regression trap that a shared util would have obscured.
4. **Empty-state duplicates the '+ New role' affordance.** The header button always renders; the empty-state body adds its own secondary. Rationale: users hitting a genuinely empty modal shouldn't have to hunt the chrome for the primary action.

## Deviations from Plan

None — plan executed exactly as written. All 8 plan-listed behaviors for Task 1 and all 8 plan-listed behaviors for Task 2 were tested and satisfied. All 5 acceptance-criteria greps pass (`container=0`, `listRolesForHost>=1`, `onSelectRole>=1`, `CreateRoleDialog>=1`, `npm run build clean`).

The one intentional style consolidation in the test assertions — Test I/J assert on box-shadow's `hsla()` slot rather than background's `hsla()` (jsdom serialization detail, no code change) — is documented inline in the test comments.

## Issues Encountered

Two minor test-authoring rough edges surfaced during the GREEN phase and were resolved without code changes:

1. **jsdom serializes `hsla()` in background/border to `rgba()`.** Initial Test I/J assertions on the background hsla stops failed because jsdom pre-computes the sRGB equivalent. Fix: assert on the box-shadow slot which retains the raw `hsla()` (hue-glow ring stop). Documented in test comments; no component change needed.
2. **`<img alt="">` has no implicit ARIA role.** Empty alt marks the image as presentational; `within(row).getByRole("img")` failed. Fix: query by `querySelector("img")` and assert `not.toBeNull()`. Documented in test comments.

Neither issue is a production concern; both are jsdom / testing-library quirks that surfaced only in the assertion phase.

## User Setup Required

None — this plan touches only frontend TS files and adds no new environment variables, backend routes, or external service dependencies.

## Next Phase Readiness

**Ready for Plan 90-06 (Wave 4)** — the final wave of Phase 90 will wire `RolesListModal` into `PrettyConversationsPanel.tsx`:

- Three-dots menu entry swap: "New role" → "Edit roles…" (per D-07).
- Menu entry opens `<RolesListModal open={rolesListOpen} .../>` alongside the sibling `<GlobalFilesModal />` + `<SkillsEditorModal />` mounts.
- Row click coordination: `onSelectRole={(p) => { setRolesListOpen(false); setRoleModalOpen(true); setActiveRole(p.roleCosmetics); ... }}` (swap-not-stack per D-03).
- Retire the stale `PrettyConversationsPanel.new-role-button.test.tsx` (per D-07 test collateral) or rewrite it for the new "Edit roles…" entry.
- Identity-modal title-line clickable treatment (per D-04) — likely a sibling task in Plan 90-06 or a separate plan.

No blockers. RolesListModal is a leaf component; its API contract is stable and typed.

## Self-Check: PASSED

Verified via `git log --oneline --all | grep -q "<hash>"`:
- `309445d0` (test commit) — FOUND
- `bd8a61b7` (feat commit) — FOUND

Verified via filesystem:
- `/home/ubuntu/skynet-tabitha/src/ui/features/pretty-view/RolesListModal.tsx` — EXISTS (468 lines)
- `/home/ubuntu/skynet-tabitha/src/ui/features/pretty-view/RolesListModal.test.tsx` — EXISTS (525 lines)

Verified via scoped test run:
- `npx vitest run --project frontend src/ui/features/pretty-view/RolesListModal.test.tsx` → 16 passed, 0 failed
- `npm run build` → clean (only the pre-existing INEFFECTIVE_DYNAMIC_IMPORT warning for telegram-api.ts, unchanged by this plan)

Verified via grep gates:
- `grep -c "container" src/ui/features/pretty-view/RolesListModal.tsx` → 0 ✓
- `grep -c "listRolesForHost" src/ui/features/pretty-view/RolesListModal.tsx` → 2 ✓
- `grep -c "onSelectRole" src/ui/features/pretty-view/RolesListModal.tsx` → 4 ✓
- `grep -c "CreateRoleDialog" src/ui/features/pretty-view/RolesListModal.tsx` → 14 ✓

---
*Phase: 90-role-management-modal-split*
*Completed: 2026-09-09*
