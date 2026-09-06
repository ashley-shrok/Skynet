---
phase: 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool
plan: 09
subsystem: ui
tags: [react, vitest, context-menu, dialog-unification, landmine-11]

# Dependency graph
requires:
  - phase: 80
    provides: NewSessionDialog chain-hook mechanism (plan 80-06 — initialHost + initialRole + initialBrief props); PrettyConversationRow.tsx task-primary body swap (plan 80-08 — modified same file in Wave 3)
provides:
  - Repurposed row context-menu "Clone" action as "Spawn under this role"
  - Unified clone entry-point routed through NewSessionDialog via chainPrefill state (same path CreateRoleDialog uses — Landmine 11 reuse, don't build new)
  - Standalone CloneAgentDialog + its 601-LOC dedicated unit test deleted
  - PrettyConversationsPanel.clone-dialog.test.tsx rewritten to assert Phase 80 flow (3 tests: seed props, open transition, A3 lock — brief NOT prefilled)
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Landmine 11 applied: single unified NewSessionDialog handles birth + clone + chain-from-role-create — one modal, one flow, one state path (chainPrefill)"
    - "A3 lock enforced by test: task/brief field NEVER prefilled from source identity on spawn-under-role — each spawn describes its own why"

key-files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx
    - src/backend/database/routes/identity-clone.ts
    - src/ui/api/identities-api.ts
  deleted:
    - src/ui/sidebar/CloneAgentDialog.tsx
    - src/ui/sidebar/CloneAgentDialog.test.tsx

key-decisions:
  - "Made chainPrefill.description optional (rather than passing empty-string) so clone omits it entirely, giving initialBrief null → NewSessionDialog's field-seed effect is a strict no-op, unambiguously honoring A3."
  - "Added identity.role guard to handleRowClone: cloneless-identities cannot spawn-under-role (no role to spawn under). The row-level items[] gate already hides the menu item when identity is unresolved, but adding this guard is belt-and-suspenders + documents intent."
  - "Kept the onClone prop name in PrettyConversationRow (only user-facing label changed to 'Spawn under this role'). Renaming the prop across all callers is out-of-scope creep per plan Task 2."
  - "Preserved the cloneIdentity() API client + backend route as-is even though the UI no longer uses them — the route is still live; annotated identities-api.ts docstring as a follow-up removal candidate rather than doing a scope-crossing deletion."

patterns-established:
  - "Row context-menu entry-points → unified NewSessionDialog via chainPrefill state. Any new spawn/clone-like entry-point should reuse this same path, NOT invent its own dialog."

requirements-completed: []

# Metrics
duration: 14min
completed: 2026-09-06
---

# Phase 80 Plan 09: Clone entry-point repurpose Summary

**Deleted CloneAgentDialog (651 LOC dialog + 601 LOC test); rewired row context-menu "Clone → Spawn under this role" to open the unified NewSessionDialog with initialHost + identity.role pre-seeded via the existing chainPrefill mechanism, brief field left empty per A3 lock**

## Performance

- **Duration:** 14 min
- **Started:** 2026-09-06T18:28:41Z
- **Completed:** 2026-09-06T18:43:13Z
- **Tasks:** 3
- **Files modified:** 6
- **Files deleted:** 2 (1252 LOC removed)

## Accomplishments
- Row context-menu action renamed from "Clone" to "Spawn under this role" (shape §Frontend creation flow: "cosmetics come from the role, so nothing is being carried from the source")
- `handleRowClone` in PrettyConversationsPanel rewired: guards resolve matchKey → identity → identity.role → row.host → hostId; on success sets `chainPrefill = {role: identity.role, host: row.host}` (no description) and opens NewSessionDialog. Reuses the CreateRoleDialog → NewSessionDialog chain path verbatim (Landmine 11)
- CloneAgentDialog.tsx + CloneAgentDialog.test.tsx deleted; stale `vi.mock('@/sidebar/CloneAgentDialog', …)` scrubbed from PrettyConversationsPanel.chain.test.tsx; comment-only references in identity-clone.ts + identities-api.ts neutralized
- PrettyConversationsPanel.clone-dialog.test.tsx rewritten (3 tests, all pass): seed props verify, open transition verify, A3 lock verify (initialBrief null)

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewire handleRowClone + remove CloneAgentDialog mount** — `133fdbf3` (feat)
2. **Task 2: Rename context-menu 'Clone' → 'Spawn under this role'** — `d41648c2` (feat)
3. **Task 3a: Delete CloneAgentDialog + its dedicated test; scrub references** — `a06de891` (feat)
4. **Task 3b: Rewrite panel clone-dialog suite to assert NewSessionDialog seeding** — `9787d6dc` (test)

## Files Created/Modified
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — handleRowClone rewired; cloneDialogState + CloneAgentDialog mount + import removed; dangling imports (refreshIdentities, getSessionList, updateFleetSessions, Identity type) removed; chainPrefill.description made optional
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — context-menu label swap ("Clone" → "Spawn under this role"); updated adjacent doc comments (items[] builder + onClone prop declaration) so they no longer describe the deleted dialog
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx` — rewritten (3 tests) to assert NewSessionDialog seeding (initialHost by reference, initialRole from identity, initialBrief null per A3)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx` — removed stale `vi.mock('@/sidebar/CloneAgentDialog', …)` (module no longer exists)
- `src/backend/database/routes/identity-clone.ts` — comment-only reference to the deleted UI dialog neutralized
- `src/ui/api/identities-api.ts` — cloneIdentity() docstring updated; annotated as follow-up removal candidate now that UI no longer consumes it
- `src/ui/sidebar/CloneAgentDialog.tsx` — DELETED (651 LOC)
- `src/ui/sidebar/CloneAgentDialog.test.tsx` — DELETED (601 LOC)

## Decisions Made

1. **Made chainPrefill.description optional** rather than passing empty-string. Empty-string would still coerce to `""` at the mount site's `chainPrefill?.description ?? null` (empty-string is not null so it would propagate as prop=""), which is falsy at NewSessionDialog's `if (initialBrief && identityMode)` seed effect — but an *undefined description* → null at the mount → cleanest unambiguous no-op. Test 3 asserts the sentinel "<null>" data-attr, so this decision is directly verified.
2. **Added identity.role guard** to handleRowClone (a new guard on top of the prior matchKey/identity/host chain). Spawn-under-role is nonsensical without a role to spawn under. The row-level items[] gate already prevents the menu item from surfacing when identity is unresolved, but the role gate is belt-and-suspenders — and it materially changed the test's stub identity (`role: 'operator'` seeded so the flow exercises).
3. **Kept the `onClone` prop name** in PrettyConversationRow. Rename would ripple to callers, chain.test, task-primary.test, and every other row wiring — pure scope creep for a user-facing label rename. Documented the semantic shift in the prop's doc block instead.
4. **Preserved cloneIdentity() API client + backend route**. UI no longer calls it, but the route is still live; deleting the client would cross the plan's file-boundaries. Docstring annotated as follow-up removal candidate — flag for a maintenance sweep, not this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Dropped 4 dangling imports after CloneAgentDialog mount removal**
- **Found during:** Task 1
- **Issue:** After deleting the `<CloneAgentDialog>` JSX mount from PrettyConversationsPanel.tsx, its onCloned callback (which called `refreshIdentities()` and `getSessionList()` → `updateFleetSessions()`) went away. The `Identity` type import was also solely for the `cloneDialogState` type. All four became unused imports.
- **Fix:** Removed `refreshIdentities` from the identities-store import; removed `updateFleetSessions` from the conversation-store import; removed the `getSessionList` import line entirely; removed the `type Identity` import line entirely.
- **Files modified:** src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
- **Verification:** `npx tsc --noEmit` returns 0 errors; no other consumers surfaced via grep
- **Committed in:** `133fdbf3` (Task 1 commit)

**2. [Rule 3 — Blocking] Scrubbed stale vi.mock in PrettyConversationsPanel.chain.test.tsx**
- **Found during:** Task 3
- **Issue:** PrettyConversationsPanel.chain.test.tsx L213-216 had `vi.mock("@/sidebar/CloneAgentDialog", () => ({ CloneAgentDialog: () => null }))` — after deleting the module, this mock would break at test-collection time when Vitest tries to resolve the path.
- **Fix:** Replaced the mock with a Phase-80 comment explaining it's no longer needed (the panel no longer imports the module).
- **Files modified:** src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx
- **Verification:** `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx` — 4/4 tests pass
- **Committed in:** `a06de891` (Task 3a commit)

**3. [Rule 3 — Blocking] Neutralized comment-only CloneAgentDialog references in identity-clone.ts + identities-api.ts to satisfy strict grep=0 acceptance**
- **Found during:** Task 3
- **Issue:** After deleting the source module, two docstring-only references remained (in backend/database/routes/identity-clone.ts and ui/api/identities-api.ts). Task 3's `<acceptance_criteria>` specified `grep -rn "CloneAgentDialog" src/` returns 0 matches — strict grep would still count comment mentions.
- **Fix:** Reworded both comments to say "the standalone clone dialog" or "the removed clone dialog" instead of the exact identifier. In identities-api.ts, additionally annotated cloneIdentity() as a follow-up removal candidate since it's now UI-unused.
- **Files modified:** src/backend/database/routes/identity-clone.ts, src/ui/api/identities-api.ts
- **Verification:** `grep -rn "CloneAgentDialog" src/` returns 0
- **Committed in:** `a06de891` (Task 3a commit)

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking / cleanup required for acceptance criteria)
**Impact on plan:** All three were direct downstream cleanup of the plan's own file deletions. No scope creep — every change was inside a file already touched by the plan or an in-scope reference-scrub required by the strict grep=0 gate.

## Issues Encountered

- **grep-count noise on the `onClone` acceptance criterion** (Task 2): the plan specified `grep -c 'onClone'` "unchanged from baseline (prop name unchanged)". Baseline was 6; after edits count is 8 — the extra references are in the doc-comment I added on the prop declaration explaining the Phase 80 semantic shift. The prop *name* is unchanged (still `onClone` — declaration, destructuring, and JSX callsite all preserved). Documented the deviation here rather than trimming the doc comment: the docstring improvement is more valuable than matching a literal count that was measuring intent (no rename), not identifier occurrences.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Row context-menu clone flow now visibly consistent with the unified new-session flow: same modal, same host/role pickers, same task field.
- CloneAgentDialog code paths retired. If a future phase wants to fully remove the cloneIdentity() backend route + client, the docstring in identities-api.ts flags it as a candidate — but that's a maintenance sweep, not a Phase 80 obligation.
- No new dependencies; no schema changes; no backend surface changes on this plan.

## Self-Check: PASSED

Verification:
- `test ! -f src/ui/sidebar/CloneAgentDialog.tsx` → OK (deleted)
- `test ! -f src/ui/sidebar/CloneAgentDialog.test.tsx` → OK (deleted)
- `grep -rn "CloneAgentDialog" src/` → 0 matches
- `grep -c 'CloneAgentDialog' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` → 0
- `grep -c 'label: "Clone"' src/ui/features/pretty-conversations/PrettyConversationRow.tsx` → 0
- `grep -c 'label: "Spawn under this role"' src/ui/features/pretty-conversations/PrettyConversationRow.tsx` → 1
- `grep -c 'initialRole' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` → 9
- `grep -c 'cloneDialogState' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` → 0
- Test count in rewritten file: 3 (>= 3 required)
- `npx tsc --noEmit`: 0 errors
- `npx vitest run PrettyConversationsPanel.clone-dialog.test.tsx`: 3/3 passing
- Regression: `npx vitest run PrettyConversationsPanel.chain.test.tsx PrettyConversationRow.task-primary.test.tsx`: 11/11 passing
- Commits present in git log: `133fdbf3`, `d41648c2`, `a06de891`, `9787d6dc`

---
*Phase: 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool*
*Completed: 2026-09-06*
