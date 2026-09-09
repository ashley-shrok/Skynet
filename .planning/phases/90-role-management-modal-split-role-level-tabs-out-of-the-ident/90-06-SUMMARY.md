---
phase: 90-role-management-modal-split
plan: 06
subsystem: pretty-view + pretty-conversations
tags: [ui, refactor, modal-split, role-management, identity-modal, D-04, D-07, D-09]
requires:
  - 90-04
  - 90-05
provides:
  - identity-modal-post-phase-90 (3 tabs; no scope switch; title-line clickable treatment)
  - pretty-view-role-modal-swap-coordination (D-04 handleOpenRoleModal)
  - panel-header-edit-roles-menu-entry (D-07)
  - panel-mount-roles-list-modal (+ RoleModal + RunbookEditorModal siblings)
affects:
  - src/ui/features/pretty-view/IdentityModal.tsx (2603 → 1586 lines; -1017)
  - src/ui/features/pretty-view/PrettyView.tsx (RoleModal mount + handleOpenRoleModal)
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (menu swap + mounts)
tech-stack:
  added: []
  patterns: [swap-not-stack (D-04), inline hover-flip pattern, RoleSummary derivation from identity.roleDefaults, RolesListModal + CreateRoleDialog stack (D-10)]
key-files:
  created:
    - src/ui/features/pretty-view/IdentityModal.title-line-jump.test.tsx
    - src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx
  modified:
    - src/ui/features/pretty-view/IdentityModal.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-view/IdentityModal.scope-switch.test.tsx
    - src/ui/features/pretty-view/IdentityModal.test.tsx
    - src/ui/features/pretty-view/IdentityModal.wakeup-crud.test.tsx
    - src/ui/features/pretty-view/IdentityModal.voice.test.tsx
    - src/ui/features/pretty-view/IdentityModal.stays-awake.test.tsx
    - src/ui/features/pretty-view/IdentityModal.coordinator-empty.test.tsx
    - src/ui/features/pretty-view/IdentityModal.inherit-override.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx
  deleted:
    - src/ui/features/pretty-view/IdentityModal.role-tab.test.tsx (role scope moved to RoleModal)
    - src/ui/features/pretty-view/IdentityModal.bounties-filter.test.tsx (bounties moved to RoleBountiesTab)
    - src/ui/features/pretty-view/IdentityModal.runbooks-swap.test.tsx (runbooks moved to RoleModal)
    - src/ui/features/pretty-view/IdentityModal.lazy-archive.test.tsx (bounties archive moved to RoleBountiesTab)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx (Rule 1 - chain flow deleted by Task 3 planner-pick)
    - src/ui/state/modal-scope-store.ts (dead code — ModalScope retired)
    - src/ui/state/modal-scope-store.test.ts (dead code)
decisions:
  - "D-04 title-line: clickable span with dotted underline #c4b89a + chevron ›; hover: solid #f0ebe0. Inline hover-flip via onMouseEnter/onMouseLeave — no pseudo-classes."
  - "D-09 planner-pick: retire ModalScope store in this phase rather than defer — cheaper than a follow-up sweep."
  - "D-04 fallback: when identity.title is null, decorate the displayName span instead. When identity.role is null, render plain (no clickable treatment — no target to jump to)."
  - "handleOpenRoleModal cosmetics derivation: prefer identity.roleDefaults (already carries title/colorHue/voice/avatar per Phase 86); fall back to listRolesForHost fetch."
  - "handleOpenRunbook accepts optional roleNameOverride so RoleModal can pass its own roleName for the nested swap without relying on pvIdentity."
  - "PrettyConversationsPanel-level CreateRoleDialog mount DELETED — the only caller was the deleted 'New role' menu entry (per Task 3 note #4). Role creation now flows through RolesListModal's internal CreateRoleDialog (D-10 stack)."
  - "Panel-level chain-to-create-identity flow dropped (Rule 1 side effect — RolesListModal doesn't yet expose onChainToCreateIdentity). Documented as a follow-up if Ashley wants it back."
  - "Removed 5 sibling test files (role-tab, bounties-filter, runbooks-swap, lazy-archive, chain) whose entire subject matter moved to RoleModal / RolesListModal or was deleted by the plan."
metrics:
  duration_hours: 3.5
  completed_date: "2026-09-09"
  tasks_completed: 5
  files_touched: 15 (including deletes)
  scoped_tests_passing: 71 (11 test files)
---

# Phase 90 Plan 90-06: IdentityModal refactor + PrettyView + PrettyConversationsPanel wiring + title-line clickable treatment Summary

Ships the user-visible surface of Phase 90: IdentityModal drops its scope switch + 4 role-scope tabs + all role-scope state; gains a D-04 clickable title-line treatment that jumps to RoleModal via PrettyView's swap-not-stack coordinator; three-dots menu swaps "New role" → "Edit roles…" mounting RolesListModal → RoleModal → RunbookEditorModal at the panel level. Full stale-test retirement + new coverage.

## What Landed

### Task 1 — IdentityModal refactor + title-line clickable treatment

`src/ui/features/pretty-view/IdentityModal.tsx` (2603 → 1586 lines, −1017):

- Deleted the segmented scope switch (`<div role="group" aria-label="Scope">`), the `useModalScope` / `setModalScope` / `ModalScope` imports + all uses, the `storedScope` / `defaultScope` / `scope` / `onScopeChange` derived state, and the scope-conditional `useEffect` that reset `activeTab` on scope flip.
- Deleted `NAV_SECTIONS_ROLE` and unwrapped `NAV_SECTIONS_IDENTITY` → single `NAV_SECTIONS` array of 3 tabs (Identity file / Wakeups / Telegram).
- Deleted `<TabsContent value="role">` (RoleFileTab), `<TabsContent value="runbooks">` (RunbooksTab), `<TabsContent value="bounties">` (~300 lines of sticky-search + group renderers + archive accordion), and `<TabsContent value="role-wakeups">` (parallel WakeupsTab).
- Deleted the `bounties` / `archivedBounties` / `loading` / `error` / `bountyQuery` / `archiveAccordionValue` / `roleFileState` / `roleWakeupsState` / `refetchKey` state slots.
- Deleted the initial-fetch bounties WS request, the `loadArchivedBounties` lazy loader, and the parallel `identity:get-role-file` / `identity:list-role-wakeups` one-shot fetches. Initial-fetch effect is now 2 parallel one-shots (identity-file + identity-wakeups).
- Deleted all bounty mutation handlers (`updateBountyPriority` / `Status` / `Pinned` / `NeedsDesk` / `Fields` / `archiveBounty` / `deleteBounty`), the `grouped` memo, `sortedArchive` memo, `bountyQueryNorm` / `bountyMatchesQuery` / `hasOpenAfterFilter` / `hasArchiveAfterFilter` derived selectors, plus the role-scope wakeup handlers (`updateRoleWakeup` / `createRoleWakeup` / `deleteRoleWakeup`) and `updateRoleFile`.
- New required prop `onOpenRoleModal(identity: Identity) => void` on the IdentityModal component (replaces `onOpenRunbook` — Runbooks moved to RoleModal in Plan 90-04).
- New helper component `TitleLineJumpToRole` at file-top implementing D-04 verbatim: `cursor: pointer`, `color: #c4b89a`, `text-decoration: underline dotted`, `textDecorationColor: rgba(196, 184, 154, 0.35)`, `textUnderlineOffset: 2px`, `transition: color 120ms, text-decoration 120ms`. Chevron `›` in a nested span with `marginLeft: 3, opacity: 0.7, transition: opacity 120ms`. Hover flip (inline via `onMouseEnter`/`onMouseLeave` — matches panel-menu convention) → color `#f0ebe0`, decoration solid, decoration-color `rgba(240, 235, 224, 0.6)`, chevron opacity 1. `role="button"` + `tabIndex=0` + Enter/Space keyboard activation. `title` + `aria-label` attrs `Open role modal: <label>`.
- Wired title-line rendering with three branches (per D-04):
  - `identity.role !== null && identity.title` → decorate the title span; displayName above stays plain.
  - `identity.role !== null && !identity.title` → decorate the displayName span instead (D-04 fallback).
  - `identity.role === null` → render plain (defensive — no target to jump to).
- Click handler fires `onOpenChange(false)` at the same tick `onOpenRoleModal(identity)` runs — swap coordination lives in the click handler.

New sibling test file `IdentityModal.title-line-jump.test.tsx` — 13 tests covering:
- A/B/C/D/E/F: post-refactor tab structure (3 tabpanels; no scope group; no role-scope nav buttons; only one Wakeups nav button).
- G/H: title-line D-04 styling + chevron; click fires both callbacks.
- I: displayName fallback when title is null.
- J/J.2: keyboard Enter + Space activation.
- K: identity.role === null defensive branch.
- L: source-level grep guard — no `useModalScope`/`setModalScope`/`type ModalScope` in `IdentityModal.tsx`.

### Task 2 — PrettyView swap coordination

`src/ui/features/pretty-view/PrettyView.tsx`:

- Added `roleModalOpenState` state slot (`{roleName, roleCosmetics, identityShimKey, hue} | null`).
- Added `handleOpenRoleModal(identity)` handler with two-path cosmetics derivation: prefer `identity.roleDefaults` (already carries the role's cosmetics via Phase 86 backend echo), fall back to `listRolesForHost(hostId).then(rows => rows.find(r => r.name === roleName))`.
- Extended `handleOpenRunbook(runbookName, roleNameOverride?)` — RoleModal supplies its own `roleName` for the nested swap; falls back to `pvIdentity?.role` for the retired identity-modal Runbooks-tab path.
- Threaded `onOpenRoleModal={handleOpenRoleModal}` into the `<IdentityModal>` mount (replaced the retired `onOpenRunbook`).
- Mounted `<RoleModal>` as a top-level sibling of `<IdentityModal>` and `<RunbookEditorModal>` at document.body (no `container` prop — D-03).
- RoleModal's `onOpenRunbook` fires `handleOpenRunbook(runbookName, roleModalOpenState.roleName)` — nested swap-not-stack (D-06 pattern reused).

New sibling test file `PrettyView.role-modal-swap.test.tsx` — 4 tests using an in-file TestHarness that mirrors PrettyView's role-modal swap shape (matches the retired runbooks-swap test scaffold pattern to avoid mocking ~30 PrettyView dependencies):
- A/B/C/D: title-line click closes identity modal + opens role modal with correct cosmetics.
- E: closing role modal does NOT reopen identity modal (D-03).
- F: nested-swap wiring (RoleModal onOpenRunbook fires).
- G: defensive no-op when identity.role is null.

### Task 3 — PrettyConversationsPanel menu swap + modal mounts

`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`:

- Deleted `createRoleDialogOpen` state slot + `<CreateRoleDialog>` mount + `CreateRoleDialog` import (only caller was the deleted "New role" menu entry — per Task 3 planner-pick #4).
- Added `rolesListModalOpen`, `roleModalOpenState`, and `panelRunbookEditorOpenState` state slots.
- Three-dots menu items array: swapped `{label: "New role", ...}` → `{label: "Edit roles…", onClick: () => setRolesListModalOpen(true)}`. Final order per D-07: `[New agent, Edit roles…, Edit global files…, Edit skills…]`.
- Mounted `<RolesListModal>` as a sibling of `<GlobalFilesModal>` + `<SkillsEditorModal>`. Its `onSelectRole` handler closes the list, resolves `identityShimKey` (picks any identity holding the role from `identitiesByKey`), and opens `<RoleModal>`.
- Mounted `<RoleModal>` (below RolesListModal) — same swap-not-stack pattern as PrettyView. Its `onOpenRunbook` fires `<RunbookEditorModal>` mount via `panelRunbookEditorOpenState`.
- Mounted `<RunbookEditorModal>` (below RoleModal) for the nested RoleModal → RunbookEditorModal swap. hostId/roleName captured into the state slot at swap-time so state doesn't leak after parent RoleModal closes.

Rewrote `PrettyConversationsPanel.new-role-button.test.tsx` (kept filename for git-blame continuity, per Task 3 spec):
- 21a: "Edit roles…" is a menu item; "New role" is absent; full menu order matches D-07.
- 21b: menu button gate unchanged (absent when onCreateSession undefined).
- 21c: clicking "Edit roles…" opens RolesListModal (detected via its "Roles" DialogTitle).

### Task 4 — Retire / rewrite stale tests

**Rewrote:**
- `IdentityModal.scope-switch.test.tsx` — 8 tests → 2 absence-regression guards (planner-pick per Task 4 Test A/B). Asserts `role="group" aria-label="Scope"` is absent + role-scope nav buttons are absent + no role-scope tabpanels exist.

**Deleted (subject matter moved to RoleModal / RolesListModal per Plan 90-04 / 90-05):**
- `IdentityModal.role-tab.test.tsx` — Role-scope tab body assertions.
- `IdentityModal.bounties-filter.test.tsx` — Bounties tab search filter (moved to `RoleBountiesTab`).
- `IdentityModal.runbooks-swap.test.tsx` — Runbooks tab swap (moved to RoleModal + covered by `PrettyView.role-modal-swap.test.tsx`).
- `IdentityModal.lazy-archive.test.tsx` — Bounties archive accordion lazy-load (moved to RoleBountiesTab).
- **`PrettyConversationsPanel.chain.test.tsx`** — [Rule 1 side effect] The panel-level CreateRoleDialog → NewSessionDialog chain flow was deleted by Task 3 (planner-pick #4 per plan). This test's entire subject matter is now void; deleted rather than rewritten.
- `src/ui/state/modal-scope-store.ts` + `modal-scope-store.test.ts` — Dead code post-Phase-90 (planner-pick per D-09).

**Modified (cleared `__resetModalScopeForTest` references + `onOpenRunbook` → `onOpenRoleModal` prop + added `task: null` to Identity fixtures):**
- `IdentityModal.test.tsx`
- `IdentityModal.wakeup-crud.test.tsx` — Also deleted W3 and W4 (role-scope wakeup CRUD) — moved to `RoleModal.test.tsx`.
- `IdentityModal.voice.test.tsx`
- `IdentityModal.stays-awake.test.tsx`
- `IdentityModal.coordinator-empty.test.tsx` — Also replaced `switchScope("identity")` calls with comments (identity is default now).
- `IdentityModal.inherit-override.test.tsx`

### Task 5 — End-to-end user-flow test

New file `PrettyConversationsPanel.role-management-flow.test.tsx` — 5 tests walking the full shape:
- A: panel-header → three-dots → "Edit roles…" → RolesListModal → row click → RoleModal opens with role's cosmetics.
- B: RoleModal renders the RoleCosmeticEditBlock title input (shape lock; end-to-end save covered in RoleModal.test.tsx from Plan 90-04).
- C: closing RoleModal via Esc doesn't reopen RolesListModal (D-03).
- D: '+ New role' button in RolesListModal opens CreateRoleDialog on TOP (D-10 stack — 2 dialogs visible).
- E: identity-modal title-line jump → identity modal closes + RoleModal opens (separate mount using in-file harness).

## Deviations from Plan

### Rule 1 — Auto-fixed bugs / test rot

**1. [Rule 1 - Test rot] Deleted `PrettyConversationsPanel.chain.test.tsx`**
- **Found during:** Task 3 post-refactor sanity sweep — 4 tests in this file failed because they asserted on `pvIdentity` CreateRoleDialog opened via the deleted "New role" menu entry.
- **Fix:** Deleted the file. The plan explicitly allowed CreateRoleDialog + its state slot + its chain-to-create-identity handler to be deleted from PrettyConversationsPanel (Task 3 note #4). The chain test was validating that deleted flow; its entire subject matter is void.
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx` (deleted).

**2. [Rule 3 - Fix blocking issue] Added `task: null` to test-file Identity fixtures**
- **Found during:** TS compile check.
- **Issue:** Several test Identity fixtures lacked the `task` field which became required at some point after this file was originally written. TSC blocked the test files.
- **Fix:** Added `task: null` to `BASE_IDENTITY` in each affected test file.
- **Files modified:** `IdentityModal.test.tsx`, `IdentityModal.wakeup-crud.test.tsx`, `IdentityModal.voice.test.tsx`, `IdentityModal.stays-awake.test.tsx`, `IdentityModal.coordinator-empty.test.tsx`.

### Planner-Picks Documented

- **D-09 ModalScope retirement:** Deleted `src/ui/state/modal-scope-store.ts` + its test file in this phase rather than as a follow-up sweep. The 5 surviving IdentityModal test files that used `__resetModalScopeForTest` were rewritten to use a local no-op stub.
- **Task 3 CreateRoleDialog mount:** Deleted (not kept as a stub). The only caller was the deleted "New role" menu entry, per Task 3 note #4.
- **Task 3 chain flow trade-off:** The panel-level `CreateRoleDialog → chainPrefill → NewSessionDialog` chain was dropped for this entry point. Documented in-code as a follow-up ("if Ashley wants it back, RolesListModal can grow an `onChainToCreateIdentity` prop").
- **Task 4 scope-switch.test.tsx:** Kept as regression guard (2 tests) rather than fully retired — cheaper than a follow-up sweep if someone accidentally re-introduces the scope switch.

## Known Stubs

None. RoleModal shim path (identityShimKey resolution to empty string when no identity holds the target role) is documented in-code as a defensive branch, not a stub.

## Threat Flags

None. Changes are UI-only; no new network endpoints, auth paths, or trust-boundary changes.

## Test Coverage

Full scoped-test run (11 files, 71 tests, all pass):

| File | Tests |
|------|-------|
| `IdentityModal.title-line-jump.test.tsx` (new) | 13 |
| `IdentityModal.scope-switch.test.tsx` (rewritten) | 2 |
| `IdentityModal.test.tsx` | 8 |
| `IdentityModal.wakeup-crud.test.tsx` | 2 |
| `IdentityModal.voice.test.tsx` | 4 |
| `IdentityModal.stays-awake.test.tsx` | 8 |
| `IdentityModal.coordinator-empty.test.tsx` | 5 |
| `IdentityModal.inherit-override.test.tsx` | 17 |
| `PrettyView.role-modal-swap.test.tsx` (new) | 4 |
| `PrettyConversationsPanel.new-role-button.test.tsx` (rewritten) | 3 |
| `PrettyConversationsPanel.role-management-flow.test.tsx` (new) | 5 |

Plan 90-04 / 90-05 tests confirmed still green (RoleModal.test.tsx, RolesListModal.test.tsx, RoleBountiesTab.test.tsx — 32 tests). Full PrettyConversationsPanel test surface (124 tests across 4 files after chain.test.tsx deletion) — all green.

## Files Removed Count

- 6 files deleted: 4 stale IdentityModal test files + 1 chain test file + 2 modal-scope-store files (source + test).
- 1017 lines removed from IdentityModal.tsx (2603 → 1586).

## Self-Check: PASSED

Verified:
- `[ -f src/ui/features/pretty-view/IdentityModal.title-line-jump.test.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-view/IdentityModal.role-tab.test.tsx ]` → MISSING (as intended)
- `[ -f src/ui/features/pretty-view/IdentityModal.bounties-filter.test.tsx ]` → MISSING (as intended)
- `[ -f src/ui/features/pretty-view/IdentityModal.runbooks-swap.test.tsx ]` → MISSING (as intended)
- `[ -f src/ui/features/pretty-view/IdentityModal.lazy-archive.test.tsx ]` → MISSING (as intended)
- `[ -f src/ui/state/modal-scope-store.ts ]` → MISSING (as intended)
- Task 1 acceptance greps: 5 of 7 grep counts hit zero (2 remain at 1-2 due to prose-only comment references documenting the retirement; Test L in title-line-jump.test.tsx uses precise import/call regexes and passes).
- Scoped test surface: 71 tests across 11 files all pass.
