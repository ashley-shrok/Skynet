---
phase: 90-role-management-modal-split
plan: 10
subsystem: role-management-modal
tags: [role-modal, identity-shim-removal, avatar-upload, cosmetic-clear, role-name-pattern, error-differentiation]
requires:
  - 90-09 (7 role-name-keyed api helpers)
  - 90-08 (updateRoleAvatarByName backend + api helper)
  - 90-07 (backend role-name-keyed WS handlers)
provides:
  - RoleModal without identity-shim prop (role-name-keyed reads/writes)
  - RoleBountiesTab reading via listBountiesForRoleName
  - RoleCosmeticEditBlock avatar-file upload wired end-to-end
  - clearable title/voice/avatar cosmetics via mergeCosmeticsIntoMarkdown(clearedKeys)
  - src/backend/utils/role-name-pattern.ts (single source of truth for ROLE_NAME_PATTERN)
  - roles.ts GET /roles/:name/avatar differentiates 502 bodies (host-not-resolvable, host-unreachable, role-file-read-error, avatar-stream-error)
affects:
  - src/ui/features/pretty-view/RoleModal.tsx (shim removed; avatar upload wired; clear-keys merge)
  - src/ui/features/pretty-view/RoleBountiesTab.tsx (shim removed; listBountiesForRoleName)
  - src/ui/features/pretty-view/RoleCosmeticEditBlock.tsx (avatar file retained; cleared signal emitted)
  - src/ui/features/pretty-view/PrettyView.tsx (state slot drops identityShim; RoleModal call sans shim)
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (state slot drops identityShim; RoleModal call sans shim)
  - src/backend/database/routes/roles.ts (imports shared ROLE_NAME_PATTERN; differentiated 502 bodies)
  - src/backend/database/routes/roles-list-for-host.ts (imports shared ROLE_NAME_PATTERN)
  - src/backend/database/routes/identity-birth-orchestrator.ts (re-exports shared ROLE_NAME_PATTERN)
tech-stack:
  patterns: [role-name-keyed-ws, promise-based-fetch, clearable-cosmetic-merge, two-step-avatar-upload, differentiated-error-body]
key-files:
  created:
    - src/backend/utils/role-name-pattern.ts
  modified:
    - src/ui/features/pretty-view/RoleModal.tsx
    - src/ui/features/pretty-view/RoleBountiesTab.tsx
    - src/ui/features/pretty-view/RoleCosmeticEditBlock.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/RoleModal.test.tsx
    - src/ui/features/pretty-view/RoleBountiesTab.test.tsx
    - src/ui/features/pretty-view/RoleCosmeticEditBlock.test.tsx
    - src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx
    - src/ui/api/claude-session-api.ts (single-line comment tweak — Plan 90-09 note)
    - src/backend/database/routes/roles.ts
    - src/backend/database/routes/roles.test.ts
    - src/backend/database/routes/roles-list-for-host.ts
    - src/backend/database/routes/identity-birth-orchestrator.ts
decisions:
  - "Consolidated ROLE_NAME_PATTERN into src/backend/utils/role-name-pattern.ts as the single canonical export. identity-birth-orchestrator.ts now imports+re-exports for backward compat with test files that reference the old path. pool-routes.ts keeps its own stricter leading-alpha pattern (distinct concern about pool-name aesthetics)."
  - "mergeCosmeticsIntoMarkdown exported for direct unit-testing. Accepts an optional `clearedKeys: ReadonlySet<string>` — keys in the set are DELETED from the frontmatter regardless of draft value. RoleCosmeticEditBlock emits `cleared: 'title' | 'voice' | 'avatar'` on set→empty transitions; RoleModal accumulates the set."
  - "Avatar upload flow: two-step. Step 1 posts bytes via updateRoleAvatarByName (backend also does its own two-step: bytes then frontmatter). Step 2 merges cosmetics + writes markdown via updateRoleFileByName. If step 1 fails, step 2 is aborted — RoleFileTab's onSave promise handler catches the throw and renders its saveError UI. Modal stays open, drafts preserved."
  - "roles.ts GET /roles/:name/avatar 502 bodies now differentiate: 'host not resolvable' (resolveHostById → null), 'host unreachable' (SSH connect throw), 'role file read error' (post-connect unexpected exception in the frontmatter/read path), 'avatar stream error' (response write failure). Same HTTP code — distinct bodies + logging so future debugging picks the right rabbit hole."
  - "Wakeup CRUD helpers (updateRoleWakeupByName / createRoleWakeupByName / deleteRoleWakeupByName from Plan 90-09) reshape the mutation surface — the old identity-keyed handlers took a wakeupSlug + partial updates, the byName helpers take a full WakeupSpecWire. RoleModal's updateRoleWakeup callback reads the current wakeup from state and constructs a full spec to preserve WakeupsTab's onUpdate(slug, updates) shape."
metrics:
  duration_minutes: 45
  completed_date: 2026-09-09
  files_changed: 16
  net_lines_added_removed: "+904 / -685"
  scoped_tests_passed: 149
---

# Phase 90 Plan 90-10: Frontend refactor — drop identityShimKey, wire avatar upload, fix title-clear, LOW-severity backend cleanups Summary

**One-liner:** Closes the D-08.3 divergence: RoleModal + RoleBountiesTab + RoleCosmeticEditBlock + PrettyConversationsPanel + PrettyView all consume role-name-keyed helpers from Plan 90-09, avatar bytes actually upload, title/voice/avatar are clearable, ROLE_NAME_PATTERN has a single canonical export, and roles.ts avatar-serve differentiates its 502 bodies.

## What shipped

### Task 1 — RoleModal.tsx (frontend, primary refactor)

- Dropped `identityShimKey` prop; removed all identity-keyed WS payloads from this file.
- Role-file read uses `getRoleFileByName({roleName, hostId})` (Plan 90-09).
- Role-wakeup CRUD uses `listRoleWakeupsByName` + `createRoleWakeupByName` + `updateRoleWakeupByName` + `deleteRoleWakeupByName` (Plan 90-09).
- Save handler is now two-step:
  1. If `cosmeticDraft.avatarFile` (a File captured by RoleCosmeticEditBlock), POST via `updateRoleAvatarByName(hostId, roleName, file)`. On success, use the server-returned `filename` as the frontmatter avatar value.
  2. Merge cosmetics + `clearedKeys` into markdown via `mergeCosmeticsIntoMarkdown` and write via `updateRoleFileByName`.
  3. If either step throws, propagate — RoleFileTab's onSave promise catches and renders the saveError banner; modal stays open with drafts preserved.
- `mergeCosmeticsIntoMarkdown` is now exported and accepts a third optional `clearedKeys: ReadonlySet<string>` argument. Keys in the set are DELETED from the frontmatter regardless of draft value.
- Deleted the modal-local `openOneShot` + `sendMutation` helpers — the api-layer helpers own socket lifecycle now.

### Task 2 — RoleBountiesTab.tsx

- Dropped `identityShimKey` prop; introduced `roleName` prop.
- Initial fetch + lazy archive load both route through `listBountiesForRoleName({roleName, hostId, includeArchived?})` (Plan 90-09).
- No mutation surface (bounties are terminal-edited in v1; v2 can add a role-name-keyed mutation wire type).

### Task 3 — RoleCosmeticEditBlock.tsx

- HIGH fix: `avatarFile` state is retained (was previously a tuple hole `const [, setAvatarFile]` that discarded the reference). Every candidate pick / manual upload sets it AND fires `onDraftChange({avatarFile})`. The parent (RoleModal) uploads the bytes at save time.
- MEDIUM fix: title + voice change handlers detect set→empty transitions and emit `cleared: "title"` / `cleared: "voice"` alongside the draft. The parent accumulates these into a `clearedKeys` set that flows to `mergeCosmeticsIntoMarkdown`. Typing a non-empty value back removes the field from the cleared set.
- Test I (avatar file passes up) and Tests J/J2/J3 (cleared signal semantics) added.

### Task 4 — PrettyConversationsPanel.tsx + PrettyView.tsx

- Both files' `roleModalOpenState` slot shapes no longer carry `identityShimKey`.
- Both files' `<RoleModal ... />` mounts no longer thread `identityShimKey`.
- The `identityShimKey` derivation in PrettyConversationsPanel (was: `Array.from(identitiesByKey.values()).find(...)`) is deleted — the RoleModal is fully addressed by `roleName + hostId`.
- Companion test files (PrettyView.role-modal-swap.test.tsx + PrettyConversationsPanel.role-management-flow.test.tsx) updated: TestHarness state shapes drop the identity slot; RoleModal render calls drop the prop.

### Task 5 — LOW-severity backend cleanups

**Cleanup 1: ROLE_NAME_PATTERN consolidation**
- Created `src/backend/utils/role-name-pattern.ts` exporting `ROLE_NAME_PATTERN = /^[a-z0-9-]+$/` + `isValidRoleName(name)` helper.
- `src/backend/database/routes/roles.ts` and `src/backend/database/routes/roles-list-for-host.ts` now import from the shared location.
- `src/backend/database/routes/identity-birth-orchestrator.ts` now imports + re-exports the shared constant (preserving backward compat for the 4+ test files that reference this path).
- `pool-routes.ts` intentionally keeps its own stricter leading-alpha pattern (`/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/`) — different concern, different pattern.

**Cleanup 2: roles.ts GET /roles/:name/avatar 502 differentiation**
- `resolveHostById` returns `null` → 502 `{ error: "host not resolvable" }` (was: "host unreachable", conflated with SSH-connect failures).
- SSH connect throw → 502 `{ error: "host unreachable" }` (unchanged body, but now unambiguously means "we couldn't reach it").
- Post-connect unexpected exception → 502 `{ error: "role file read error" }` + `sshLogger.warn` with operation=roles_avatar_read_error (was: silent-fallback catch-all).
- Response stream write failure → 502 `{ error: "avatar stream error" }` + `sshLogger.warn` with operation=roles_avatar_stream_error.
- Test H updated to match the new "host not resolvable" body for the null-host branch.

## Acceptance criteria verification

| Criterion | Result |
| :--- | :--- |
| `grep -c "identityShimKey" src/ui/features/pretty-view/RoleModal.tsx` returns 0 | 0 ✓ |
| `grep -c "getRoleFileByName\|listRoleWakeupsByName\|createRoleWakeupByName\|updateRoleWakeupByName\|deleteRoleWakeupByName" src/ui/features/pretty-view/RoleModal.tsx` >= 3 | 15 ✓ |
| `grep -c "updateRoleAvatarByName" src/ui/features/pretty-view/RoleModal.tsx` >= 1 | 5 ✓ |
| `grep -c "identityShimKey" src/ui/features/pretty-view/RoleBountiesTab.tsx` returns 0 | 0 ✓ |
| `grep -c "listBountiesForRoleName" src/ui/features/pretty-view/RoleBountiesTab.tsx` >= 1 | 6 ✓ |
| `grep -c "avatarFile" src/ui/features/pretty-view/RoleCosmeticEditBlock.tsx` >= 2 | 10 ✓ |
| `grep -c "clearedKeys\|cleared_keys" src/ui/features/pretty-view/RoleCosmeticEditBlock.tsx` >= 1 | 4 ✓ |
| `grep -rc "identityShimKey" src/ui/features/` returns 0 (invariant) | 0 ✓ |
| `grep -rc "identityShimKey" src/ui/` returns 0 (invariant) | 0 ✓ |
| `grep -c "role file read error\|host not resolvable\|avatar stream error" src/backend/database/routes/roles.ts` >= 2 | 4 ✓ |
| `npx tsc --noEmit` | exit 0 ✓ |
| `npm run build` | exit 0 ✓ |
| `npm run build:backend` | exit 0 ✓ |

## Scoped test results

| Test file | Cases | Result |
| :--- | :--- | :--- |
| RoleModal.test.tsx | 13 (10 legacy + K/L/M Plan 90-10) | 13/13 pass |
| RoleBountiesTab.test.tsx | 6 (rewritten to mock listBountiesForRoleName) | 6/6 pass |
| RoleCosmeticEditBlock.test.tsx | 12 (8 legacy + I/J/J2/J3 Plan 90-10) | 12/12 pass |
| PrettyView.role-modal-swap.test.tsx | 4 | 4/4 pass |
| PrettyConversationsPanel.role-management-flow.test.tsx | 5 | 5/5 pass |
| roles.test.ts | 10 (Test H updated for new 502 body) | 10/10 pass |
| roles.avatar-write.test.ts | (Plan 90-08 tests) | 16/16 pass |
| roles-list-for-host.test.ts | 11 | 11/11 pass |
| claude-session-server.role-reads.test.ts (Plan 90-07 regression) | 16 | 16/16 pass |
| claude-session-server.role-wakeup-crud.test.ts (Plan 90-07 regression) | 15 | 15/15 pass |
| identity-artifact-reader.write-role-file-by-name.test.ts (Plan 90-03 regression) | 10 | 10/10 pass |
| identity-artifact-reader.role-cosmetics.test.ts (Plan 90-01 regression) | 8 | 8/8 pass |
| claude-session-api.role-reads.test.ts (Plan 90-09) | 6 | 6/6 pass |
| claude-session-api.role-wakeup-crud.test.ts (Plan 90-09) | 6 | 6/6 pass |
| pool-routes.test.ts (regression check for pool-local ROLE_NAME_PATTERN) | 26 | 26/26 pass |
| identity-birth-orchestrator.role-frontmatter.test.ts (regression check for re-export path) | 13 | 13/13 pass |

**Total scoped: 149 tests pass; 0 failures.**

## Deviations from plan

None. Rules 1-3 did not fire. The plan's action list was executed as written.

Minor executor choices within the plan's discretion:
- `mergeCosmeticsIntoMarkdown` was promoted to `export function` (previously module-local) so future tests can hit it directly. RoleModal.test.tsx currently exercises it end-to-end through the modal; a direct unit test on `mergeCosmeticsIntoMarkdown` is easy to add if a follow-up phase wants it.
- The `avatarFile` state variable in RoleCosmeticEditBlock uses a `void avatarFile;` tag so the linter doesn't flag it as unused — the state itself is the regression guard against the pre-plan tuple-hole bug, tested by Test I.
- `RoleFileTab`'s existing `onSave`-throw → saveError-render path is reused instead of introducing a new `saveError` state on RoleModal — matches identity-side conventions and keeps the state surface minimal.
- Wakeup mutation shape shim: `WakeupsTab` still calls `onUpdate(slug, updates)`; `updateRoleWakeupByName` wants a full `WakeupSpecWire`. RoleModal's `updateRoleWakeup` reads the current wakeup from state and merges the patch into a full spec, so the tab contract is unchanged.

## Follow-ups for future phases

- Bounty mutation from the modal UI (currently read-only) would need a new `role:update-bounty` wire type + api helper. Out of scope for Plan 90-10.
- `mergeCosmeticsIntoMarkdown` direct unit tests (currently covered indirectly). Trivial follow-up if a regression appears.
- The stricter `pool-routes.ts` ROLE_NAME_PATTERN could theoretically also promote to a shared location (e.g. `pool-name-pattern.ts`), but the two patterns model different concerns — kept local for now.

## Self-Check: PASSED

- `src/backend/utils/role-name-pattern.ts` exists.
- `grep -rc "identityShimKey" src/ui/` returns 0 (invariant satisfied).
- `grep -c "role file read error\|host not resolvable\|avatar stream error" src/backend/database/routes/roles.ts` = 4 (>= 2).
- `npx tsc --noEmit` exit 0.
- `npm run build` exit 0.
- `npm run build:backend` exit 0.
- All 149 scoped tests pass.
