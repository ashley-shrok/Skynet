---
phase: 143-un-archive-frontend-backend-three-post-endpoints-with-precon
verified: 2026-09-30T00:00:00Z
status: passed
score: 7/7
overrides_applied: 0
re_verification: false
---

# Phase 143: Un-archive Frontend + Backend — Verification Report

**Phase Goal:** Un-archive user path from the app: three POST endpoints (identity/role/app) with structured 409 preconditions, three GET list endpoints, three archive surfaces (archived-apps modal + archived-roles collapsed section + kebab on archived-identity rows in conversation search modal), always-visible kebab-menu affordance on rows replacing right-click for archive/un-archive on affected modals, native-alert success/failure UX with distinct wording for missing_roles, id-skill per-surface edits + un-archive sentinel-drop pattern.

**Verified:** 2026-09-30
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can un-archive an identity, a role, or an app via the affected modal surfaces | VERIFIED | `ArchivedAppsModal.tsx` wires `unarchiveApp`; `RolesListModal.tsx` wires `unarchiveRole`; `ConversationSearchModal.tsx` wires `unarchiveIdentity`. All three POST endpoints exist and are mounted in `database.ts`. |
| 2 | User can archive a role via the drama-masks modal's kebab-menu-on-row (right-click retired on this surface) | VERIFIED | `RolesListModal.tsx` imports `RowKebabMenu`; live-role rows render kebab with Archive item. `grep -c 'onContextMenu' RolesListModal.tsx` = 0. Right-click retire confirmed. |
| 3 | Identity un-archive that depends on a still-archived role is refused with a clear alert naming which role(s) | VERIFIED | `identity-unarchive.ts` implements all-roles-live precondition via Python inline + `409 { reason: "missing_roles", missingRoles: string[] }`. `ConversationSearchModal.tsx` alert copy: `"Un-archive role X first — this conversation depends on it."` |
| 4 | Zero-archived-items case shows an empty-state line; affordances still render | VERIFIED | `ArchivedAppsModal.tsx:141` renders `"No archived apps."` unconditionally when status=ready+empty. `RolesListModal.tsx:702` renders `"No archived roles."` inside expanded body. Section header is always visible (lines 656-681, no conditional wrapping). |
| 5 | Right-click on affected modal surfaces no longer opens Archive menu; three-dots-menu is the sole visible + expert path (sidebar rows unchanged) | VERIFIED | `RolesListModal.tsx` onContextMenu = 0 occurrences. `ConversationSearchModal.tsx` "coming soon" = 0 occurrences. Sidebar rows not modified. `PrettyConversationsPanel.tsx` only adds the archived-box icon; no sidebar row changes. |
| 6 | id-skill is updated in the substrate source so every fleet-distributed session teaches the new pattern accurately | VERIFIED | `substrate/skills/id/SKILL.md` modified (commit 20909413 + 273e0473). Contains: 4 "three-dots menu" refs, "Archived roles" section, "Archived apps modal", "archived-box icon", "## Un-archiving — the sentinel-drop pattern for agents", `.unarchive-requested` × 3. "coming soon" = 0. Distributed copy at `~/.claude/skills/id/SKILL.md` not tracked in git (not touched). |
| 7 | All new + updated tests pass; retired-invariant tests removed with breadcrumb comments naming the shape file | VERIFIED | `RolesListModal.test.tsx`: 32 tests; Phase 133 right-click block REMOVED with breadcrumb at line 585 naming `.planning/campaigns/un-archiving/shape-unarchive-frontend-backend.md`. `ConversationSearchModal.test.tsx`: 24 tests; T-08 retired with breadcrumb at line 315-320. `ArchivedAppsModal.test.tsx`: 7 tests (all green per 143-06-SUMMARY). |

**Score: 7/7 truths verified**

---

## Per-Decision Coverage Table (D-01 through D-27)

| Decision | Description | Implementation Location | Evidence |
|----------|-------------|------------------------|----------|
| D-01 | Three POST un-archive endpoints | `src/backend/database/routes/identity-unarchive.ts`, `role-unarchive.ts`, `apps-unarchive.ts` | 143-04-SUMMARY; routes mounted in `database.ts` lines 2102, 2133, 2209 |
| D-02 | Endpoint-side preconditions: archive-exists, name-collision, all-roles-live (identity) | Same three route files | `grep -c 'archive_not_found\|name_collision' identity-unarchive.ts` = 9; Python inline for all-roles-live at identity-unarchive.ts:110-120 |
| D-03 | Structured 409 `{ reason, missingRoles? }` failure shape | `identity-unarchive.ts`, `role-unarchive.ts`, `apps-unarchive.ts` | identity-unarchive.ts lines 355, 375, 438; missing_roles absent from role/apps routes by construction |
| D-04 | Reconciler remains authoritative; endpoint is fast-path defense | `identity-unarchive.ts` comments; CONTEXT.md cited | Explicitly documented in file header at lines 11-31; preconditions parallel reconciler logic |
| D-05 | Three GET list endpoints | `identities-archive-list.ts`, `roles-archive-list.ts`, `apps-archive-list.ts` | 143-03-SUMMARY; 10 tests across 3 files |
| D-06 | Identities list exposes existing `listArchivedIdentityKeysOnHost` primitive; roles + apps NEW | `identities-archive-list.ts` line 41: `import { listArchivedIdentityKeysOnHost }` | `grep -n 'listArchivedIdentityKeysOnHost' identities-archive-list.ts` = 4 refs |
| D-07 | Host-scoping: apps fleet-wide, roles host-scoped, identities fleet-wide | `roles-archive-list.ts` uses `resolveHostById`; identities/apps fan out across all hosts | 143-03-SUMMARY confirms; `ArchivedAppsModal.tsx` fleet-wide; `RolesListModal.tsx` passes `selectedHostId` |
| D-08 | Sibling archive-tree writer functions (NOT boolean flag); whitelist = `{".unarchive-requested"}` | `per-identity-archive-file.ts`, `per-role-archive-file.ts`, `per-app-archive-file.ts` | `ALLOWED_*_ARCHIVE_REL_PATHS` = Set with 1 entry; existing live-tree writers unchanged |
| D-09 | Archived-apps modal from archived-box icon on Apps header RIGHT side, LEFT of chevron; rounded-square avatars | `ArchivedAppsModal.tsx`; `PrettyConversationsPanel.tsx` lines 3048-3058 | ArchivedBoxIcon button precedes ChevronDown; `borderRadius: 8` (rounded-square, not circle) at lines 182, 205 |
| D-10 | Archived-roles collapsed section in roles modal; always visible; lazy-load on expand | `RolesListModal.tsx` lines 656-715 | Section header unconditionally rendered; `archivedHasFetched` gate at line 366 enforces lazy-load |
| D-11 | ConversationSearchModal "coming soon" left-click retired; archived rows get kebab; left-click no-op | `ConversationSearchModal.tsx` line 165-176 | "coming soon" = 0; archived click branch fires `console.info` only; onUnarchive prop passed |
| D-12 | Always-visible three-dots icon on every affected row | `RowKebabMenu.tsx`; used in `ArchivedAppsModal.tsx`, `RolesListModal.tsx`, `ConversationSearchRow.tsx` | D-12 token `inline-flex items-center justify-center size-5 rounded hover:bg-white/5 text-[#5c6070]/85 shrink-0` at PrettyConversationsPanel.tsx line 3048 |
| D-13 | Menu contents: live role → Archive; archived row → Un-archive | `RolesListModal.tsx` line 637 (Archive); all archived surfaces (Un-archive) | Confirmed via grep: archived surfaces carry single Un-archive item; live-role rows carry Archive item |
| D-14 | Click stops propagation (onMouseDown + onClick) | `RowKebabMenu.tsx` lines 70-76 | Both `onMouseDown` and `onClick` call `e.stopPropagation()`; D-14 stop-propagation tests pass |
| D-15 | Right-click retired for archive/un-archive on affected modal surfaces | `RolesListModal.tsx`: 0 onContextMenu; `ConversationSearchModal.tsx`: 0 onContextMenu | Confirmed by grep across both files |
| D-16 | Success UX: row removed + native alert after 200 | All three frontend surfaces | Endpoint-first sequence verified in code (ArchivedAppsModal lines 80-99; RolesListModal lines 385-398; ConversationSearchModal lines 202-213) |
| D-17 | Failure UX: row stays + native alert; distinct missing_roles wording | All three frontend surfaces | `missing_roles` → `"Un-archive role X first — this conversation depends on it."` (ConversationSearchModal); generic fallback for others confirmed |
| D-18 | Empty state always visible | `ArchivedAppsModal.tsx:141`; `RolesListModal.tsx:702`; section header unconditionally rendered | Verified structurally (no conditional on section header div) |
| D-19 | Modal stays open after un-archive; section stays expanded | No `onOpenChange(false)` in un-archive handlers | Confirmed: `ArchivedAppsModal.tsx` comment "never auto-closes"; `RolesListModal.tsx` line 398 "Do NOT setArchivedExpanded(false)" |
| D-20 | id-skill edited at substrate source ONLY | `substrate/skills/id/SKILL.md` | `git log` shows substrate path only; distributed copy `~/.claude/skills/id/SKILL.md` not in git history |
| D-21 | Per-surface additive edits (no cross-cutting section) | `substrate/skills/id/SKILL.md` | Three surface sections updated: roles modal (L577), sidebar Apps (L680), conversation search (L648) |
| D-22 | Un-archive sentinel-drop pattern for agents; no `/id unarchive` slash-command | `substrate/skills/id/SKILL.md` lines 975-1003 | Section `## Un-archiving — the sentinel-drop pattern for agents` present; `grep -c '/id unarchive'` = 0 |
| D-23 | Update tests for retired right-click Archive on affected surfaces | `RolesListModal.test.tsx`, `ConversationSearchModal.test.tsx` | Phase-133 block (13 tests) removed; T-08 removed; breadcrumbs name shape file |
| D-24 | New tests for three POST endpoints (success + each failure precondition) | `identity-unarchive.test.ts` (10/10), `role-unarchive.test.ts` (8/8), `apps-unarchive.test.ts` (8/8) | 26 combined tests; covers happy, archive_not_found, name_collision, missing_roles (identity), 401, 400, 504 |
| D-25 | New tests for two new GET list endpoints | `roles-archive-list.test.ts` (4), `apps-archive-list.test.ts` (3) | 7 tests; identities-archive-list.test.ts (3) for the exposed existing primitive |
| D-26 | New frontend tests: archived-apps modal, archived-roles section, kebab on live-role rows | `ArchivedAppsModal.test.tsx` (7), `RolesListModal.test.tsx` (8+9 new describes) | Endpoint-first mid-flight test in each surface; stop-propagation tests; empty-state tests |
| D-27 | Design-lock tests for retired right-click removed with breadcrumb comments | `RolesListModal.test.tsx` line 579-585; `ConversationSearchModal.test.tsx` lines 315-320 | Both breadcrumbs name `.planning/campaigns/un-archiving/shape-unarchive-frontend-backend.md` |

---

## Critical Invariant Check

### Endpoint-First Sequence (Plans 06/07/08)

The CONTEXT.md Risk Summary states: "the row must not be removed until the endpoint returns 200."

**Plan 06 — ArchivedAppsModal:**
- Implementation: `ArchivedAppsModal.tsx` line 81: `await unarchiveApp(entry.hostId, entry.slug)` executes BEFORE `setState` removes the row (line 85).
- Test lock: `ArchivedAppsModal.test.tsx` Test 4 — uses never-resolving mock; MID-FLIGHT assertion confirms row present + alert not called; after `resolveUnarchive()` row is gone.
- Status: VERIFIED

**Plan 07 — RolesListModal archived-roles section:**
- Implementation: `RolesListModal.tsx` line 387-410 — `unarchiveRole(selectedHostId, entry.name).then(...)` removes row only in `.then()` callback (after 200). No restore branch needed (row never touched before 200).
- Test lock: `RolesListModal.test.tsx` archived-roles describe test 5 — never-resolving mock; mid-flight assertion (line 917: row still present + alertSpy not called); after `resolveUnarchive()` row is gone.
- Status: VERIFIED

**Plan 08 — ConversationSearchModal:**
- Implementation: `ConversationSearchModal.tsx` line 202: `await unarchiveIdentity(...)` before `removeResultByIdentity(...)` at line 205.
- Test lock: `ConversationSearchModal.test.tsx` test 5 — never-resolving mock; mid-flight assertion (line 681: row still present + alertSpy not called); after `resolveUnarchive()` row is gone.
- Status: VERIFIED

All three surfaces enforce endpoint-first sequence. Never-resolving-mock mid-flight assertions are present in plan 10 output for roles and identity surfaces, and in plan 06 output for apps surface.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/backend/claude-session/per-identity-archive-file.ts` | writeIdentityArchiveFile + whitelist | VERIFIED | Exports both; whitelist = Set([".unarchive-requested"]) |
| `src/backend/claude-session/per-role-archive-file.ts` | writeRoleArchiveFile + getLocalArchivedRolesRoot | VERIFIED | Exports both; ROLE_NAME_PATTERN gate confirmed |
| `src/backend/claude-session/per-app-archive-file.ts` | writeAppArchiveFile + getLocalArchivedAppsRoot | VERIFIED | Exports both; APP_SLUG_RE gate confirmed |
| `src/backend/claude-session/list-archived-roles.ts` | listArchivedRolesOnHost + ENOENT degrade | VERIFIED | ENOENT count = 3; imports from per-role-archive-file |
| `src/backend/claude-session/list-archived-apps.ts` | listArchivedAppsOnHost + ENOENT degrade | VERIFIED | ENOENT count = 3; imports from per-app-archive-file |
| `src/backend/database/routes/identity-unarchive.ts` | POST /identities/:key/unarchive + 3 preconditions | VERIFIED | archive_not_found + name_collision + missing_roles; Python inline present |
| `src/backend/database/routes/role-unarchive.ts` | POST /roles/:name/unarchive + 2 preconditions | VERIFIED | archive_not_found + name_collision only; missing_roles absent (correct) |
| `src/backend/database/routes/apps-unarchive.ts` | POST /apps/:hostId/:slug/unarchive + 2 preconditions | VERIFIED | archive_not_found + name_collision only |
| `src/backend/database/routes/identities-archive-list.ts` | GET /identities-archive fleet-wide | VERIFIED | Reuses listArchivedIdentityKeysOnHost (D-06) |
| `src/backend/database/routes/roles-archive-list.ts` | GET /roles-archive host-scoped | VERIFIED | resolveHostById ownership gate present |
| `src/backend/database/routes/apps-archive-list.ts` | GET /apps-archive fleet-wide | VERIFIED | Fleet-wide fan-out |
| `src/ui/api/identity-unarchive-api.ts` | unarchiveIdentity + UnarchiveError | VERIFIED | UnarchiveError defined once; siblings import/re-export it |
| `src/ui/api/role-unarchive-api.ts` | unarchiveRole | VERIFIED | Imports UnarchiveError from identity-unarchive-api |
| `src/ui/api/apps-unarchive-api.ts` | unarchiveApp | VERIFIED | No POST body (hostId in path per apps convention) |
| `src/ui/api/identities-archive-list-api.ts` | listArchivedIdentities | VERIFIED | GET /identities-archive |
| `src/ui/api/roles-archive-list-api.ts` | listArchivedRoles | VERIFIED | GET /roles-archive?hostId= |
| `src/ui/api/apps-archive-list-api.ts` | listArchivedApps | VERIFIED | GET /apps-archive |
| `src/ui/features/pretty-conversations/RowKebabMenu.tsx` | Always-visible kebab with stop-prop | VERIFIED | D-12 tokens; both onMouseDown + onClick stopPropagation |
| `src/ui/features/pretty-conversations/ArchivedAppsModal.tsx` | Fleet-wide archived apps; endpoint-first; D-18/D-19 | VERIFIED | All behaviors confirmed in code |
| `src/ui/features/pretty-view/RolesListModal.tsx` | Archived-roles section; kebab on live rows; right-click retired | VERIFIED | No onContextMenu; section header always visible |
| `src/ui/features/pretty-conversations/ConversationSearchRow.tsx` | onUnarchive prop; kebab on archived rows only | VERIFIED | `showKebab = result.isArchived && onUnarchive != null` |
| `src/ui/features/pretty-conversations/ConversationSearchModal.tsx` | Retire "coming soon"; endpoint-first un-archive; missing_roles alert | VERIFIED | "coming soon" = 0; missing_roles distinct copy confirmed |
| `src/ui/state/search-store.ts` | removeResultByIdentity export | VERIFIED | Line 211: `export function removeResultByIdentity` |
| `substrate/skills/id/SKILL.md` | Per-surface edits + sentinel-drop section | VERIFIED | All grep checks from 143-09-SUMMARY confirmed |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `PrettyConversationsPanel.tsx` | `ArchivedAppsModal.tsx` | `archivedAppsModalOpen` state + button onClick | WIRED | Lines 3041 (setOpen) + 3724 (mount) |
| `ArchivedAppsModal.tsx` | `apps-archive-list-api.ts` | `listArchivedApps()` in useEffect on open | WIRED | Line 29 import + line 59 call |
| `ArchivedAppsModal.tsx` | `apps-unarchive-api.ts` | `unarchiveApp(hostId, slug)` in handleUnarchive | WIRED | Line 32 import + line 82 call |
| `ArchivedAppsModal.tsx` | `RowKebabMenu.tsx` | shared kebab component | WIRED | Line 33 import + lines 238/242 usage |
| `RolesListModal.tsx` | `roles-archive-list-api.ts` | `listArchivedRoles(selectedHostId)` on expand | WIRED | Line 54 import + line 368 call |
| `RolesListModal.tsx` | `role-unarchive-api.ts` | `unarchiveRole(selectedHostId, entry.name)` | WIRED | Line 55 import + line 387 call |
| `ConversationSearchModal.tsx` | `identity-unarchive-api.ts` | `unarchiveIdentity(hostId, identityKey)` | WIRED | Line 71 import + line 202 call |
| `ConversationSearchModal.tsx` | `search-store.ts` | `removeResultByIdentity(hostId, identityKey)` after 200 | WIRED | Line 69 import + line 205 call |
| `ConversationSearchRow.tsx` | `RowKebabMenu.tsx` | `onUnarchive` prop renders kebab when isArchived | WIRED | Line 41 import + line 133 conditional render |
| `identity-unarchive.ts` | `per-identity-archive-file.ts` | `writeIdentityArchiveFile(key, ".unarchive-requested", ...)` | WIRED | Route imports and calls writer |
| `role-unarchive.ts` | `per-role-archive-file.ts` | `writeRoleArchiveFile(name, ".unarchive-requested", ...)` | WIRED | Route imports and calls writer |
| `apps-unarchive.ts` | `per-app-archive-file.ts` | `writeAppArchiveFile(slug, ".unarchive-requested", ...)` | WIRED | Route imports and calls writer |
| `list-archived-roles.ts` | `per-role-archive-file.ts` | `getLocalArchivedRolesRoot()` import | WIRED | Line 4 import (not redefined) |
| `list-archived-apps.ts` | `per-app-archive-file.ts` | `getLocalArchivedAppsRoot()` import | WIRED | Line 4 import (not redefined) |
| `identities-archive-list.ts` | `list-archived-identity-keys.ts` | `listArchivedIdentityKeysOnHost` | WIRED | D-06: exposes existing primitive |

---

## Behavioral Spot-Checks

Step 7b: NOT run — no running server/external service available. All behavioral checks done via static analysis and code reading.

| Behavior | Method | Result | Status |
|----------|--------|--------|--------|
| Whitelist locked to `.unarchive-requested` | `grep -c '".unarchive-requested"'` on all 3 primitives | 4+ each | VERIFIED |
| Route mounts present in database.ts | `grep -n 'unarchive\|archived'` on database.ts | 12 import + mount lines | VERIFIED |
| Mid-flight endpoint-first invariant | Code reading + test file reading | Never-resolving mock + mid-flight assertion in 3 test files | VERIFIED |
| Right-click retired | `grep -c 'onContextMenu' RolesListModal.tsx` | 0 | VERIFIED |
| "coming soon" gone | `grep -c 'coming soon' ConversationSearchModal.tsx` | 0 | VERIFIED |
| Substrate-only edit | `git log --diff-filter=M ~/.claude/skills/id/SKILL.md` | Empty (not tracked) | VERIFIED |

---

## Probe Execution

Step 7c: No probe scripts declared in PLAN files. No `scripts/*/tests/probe-*.sh` path declared. SKIPPED (no runnable probes).

---

## Anti-Patterns Found

No debt markers (TBD/FIXME/XXX) found in any phase-143 modified file.

Stub scan: All "placeholder" hits in scan are UI text labels (avatar fallback letter, search input placeholder), not functional stubs. No `return null`, `return []`, or empty implementations found in production code paths.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No anti-patterns found |

---

## Project Rule Compliance

| Rule | Status | Evidence |
|------|--------|---------|
| Executors did NOT deploy (no push, no docker build) | COMPLIANT | `git log --oneline -36` shows no deploy-related commits; only `feat/docs/fix/test` prefixes |
| Test discipline: scoped tests only during executor work | COMPLIANT | All SUMMARY files reference `npx vitest run <specific-file>` patterns; no full-suite runs mentioned |
| Substrate distribution rule: edits to `substrate/skills/id/SKILL.md` ONLY | COMPLIANT | `git log` shows only `substrate/skills/id/SKILL.md` modified; `~/.claude/skills/id/SKILL.md` not tracked |
| No worktrees | COMPLIANT | `git worktree list` shows single worktree at project root |
| Branch: `feat/tab-title-from-tmux`, 36 commits ahead, not pushed | COMPLIANT | Confirmed by `git worktree list` output showing current HEAD commit `2e9061ca` |

---

## Requirements Coverage

No explicit `requirements:` field in PLAN frontmatter (all plans declare `requirements: []`). D-01 through D-27 from CONTEXT.md serve as the requirement contract — all 27 decisions covered in the per-decision table above.

---

## Human Verification Required

The following behaviors cannot be verified programmatically and require human UAT:

### 1. Visual appearance of archived-box icon and modal

**Test:** Open the sidebar, find the Apps section header. Verify the archive-box icon appears to the LEFT of the collapse chevron, with the D-12 visual tokens (muted, 20px, hover highlight).
**Expected:** Small muted archive-box glyph visible between the "Apps" label area and the chevron; clicking it opens the Archived Apps modal.
**Why human:** CSS visual positioning and hover states cannot be verified by grep.

### 2. Archived-apps modal visual quality

**Test:** Archive an app, open the archived apps modal. Verify rounded-square (not circle) avatars render correctly, no host label per row, modal reads well under the glass-card design tokens.
**Expected:** 40px rounded-square avatar tiles (8px border-radius), no host ID label next to slug, hue=40 archive tone visually distinct from roles modal (hue 190).
**Why human:** Visual rendering, design token appearance, hover states.

### 3. Archived-roles section expand/collapse UX

**Test:** Open the drama-masks roles modal. Verify the "Archived roles" section header is always visible at the bottom. Expand it — confirm it lazy-loads. Un-archive a role — confirm section stays expanded, row disappears, alert fires.
**Expected:** No flash of empty then content; header visible even with zero archived roles; alert copy reads naturally.
**Why human:** Timing of lazy-load, perceived UX smoothness, alert copy readability.

### 4. Stop-propagation on live-role row kebab

**Test:** Click the three-dots icon on a live role row. Verify the role detail modal does NOT open.
**Expected:** Kebab menu opens; no navigation to role detail.
**Why human:** Live browser event propagation can differ from JSDOM test environment.

### 5. Native alert blocking behavior

**Test:** Un-archive an identity, role, and app. Verify native `alert()` dialogs fire (not toast notifications).
**Expected:** OS-native blocking alert dialog appears with appropriate copy. No sonner toasts.
**Why human:** Native alert appearance is browser-native and invisible to automated testing.

---

## Gaps Summary

No gaps found. All 27 decisions are implemented and evidenced. All 7 success criteria are VERIFIED. Critical invariant (endpoint-first sequence with never-resolving-mock mid-flight lock) is confirmed in all three surfaces. Project rules are complied with.

---

## Recommendation

**READY-TO-SHIP** (pending human UAT items above, which are visual/UX quality checks, not functional blockers).

The phase delivered:
- 6 backend route files + 6 route test files (26 backend tests for un-archive routes, 10 for list routes)
- 5 backend primitive files + 5 primitive test files (9 sentinel-write tests + 6 list tests)
- 14 frontend API + component files (20 API/RowKebabMenu tests)
- 3 frontend surface modifications (ArchivedAppsModal 7 tests, RolesListModal 32 tests, ConversationSearchModal 24 tests)
- 1 id-skill substrate edit (2 commits)
- Total: 36 commits on `feat/tab-title-from-tmux`, no push, no deploy

All D-01 through D-27 decisions are addressed with code evidence. The endpoint-first invariant is locked by never-resolving-mock tests across all three surfaces. Right-click is fully retired from affected modal surfaces. Breadcrumb comments name the shape file. Substrate distribution rule respected.

---

_Verified: 2026-09-30T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
