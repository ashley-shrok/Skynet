---
phase: 143-un-archive-frontend-backend-three-post-endpoints-with-precon
plan: "08"
subsystem: frontend
tags: [un-archive, conversation-search, kebab-menu, modal-reshape]
dependency_graph:
  requires: [143-05]
  provides: [conversation-search-modal-un-archive-surface]
  affects: [143-10]
tech_stack:
  added: []
  patterns: [endpoint-first-sequence, RowKebabMenu-reuse, search-store-remove-primitive]
key_files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/ConversationSearchRow.tsx
    - src/ui/features/pretty-conversations/ConversationSearchModal.tsx
    - src/ui/state/search-store.ts
decisions:
  - "Option B (onUnarchive prop on ConversationSearchRow) chosen over Option A renderRight — keeps kebab-rendering logic co-located with the archived-row branch."
  - "Added removeResultByIdentity to search-store.ts as the post-200 row-removal primitive (no existing equivalent; Rule 2 missing-critical-functionality)."
  - "handleUnarchive is async and calls unarchiveIdentity FIRST with NO optimistic removal — row only drops after endpoint returns 200 per CONTEXT.md Risk Summary."
  - "T-08 test failure is intentional and expected — plan 143-10 migrates it."
metrics:
  duration: "~8 minutes"
  completed: "2026-09-30"
  tasks_completed: 2
  files_modified: 3
---

# Phase 143 Plan 08: ConversationSearchModal Reshape Summary

ConversationSearchRow gains an `onUnarchive` kebab-menu slot for archived rows; ConversationSearchModal retires the "coming soon" left-click alert and wires endpoint-first Un-archive with structured D-17 failure copy that names missing_roles inline.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | ConversationSearchRow — accept onUnarchive prop + render kebab on archived rows | `9811b95b` | `ConversationSearchRow.tsx` |
| 2 | ConversationSearchModal — retire blunt alert + wire Un-archive kebab (endpoint-first) + failure alerts | `e70f56d6` | `ConversationSearchModal.tsx`, `search-store.ts` |

## What Was Built

**Task 1 — ConversationSearchRow kebab seam**

Added an optional `onUnarchive?: (result: ConversationSearchResult) => void` prop. When `result.isArchived === true` AND `onUnarchive` is provided, the row renders a `<RowKebabMenu>` in the right-side header slot (beside the archived pill and timestamp) with a single "Un-archive" item. Stop-propagation on the kebab trigger is handled inside `RowKebabMenu` per D-14. Non-archived rows are completely unaffected. `RowKebabMenu` is imported from `./RowKebabMenu` (Wave 1 artifact from plan 143-05).

**Task 2 — ConversationSearchModal modal reshape + search-store addition**

Three coordinated changes:

1. `handleRowClick` — archived branch no longer fires `window.alert`. Now a no-op (console.info only). The kebab is the sole visible action path (D-11).

2. `handleUnarchive` — strict endpoint-first sequence per CONTEXT.md Risk Summary:
   - Guard: `if (!result.isArchived) return;`
   - Call `unarchiveIdentity(result.hostId, result.identityKey)` FIRST — row untouched in flight
   - On 200: call `removeResultByIdentity(hostId, identityKey)` THEN fire success alert (D-16)
   - On failure: row stays (never removed — no restore branch needed by construction). Failure alert branches (D-17):
     - `missing_roles` → `"Un-archive role X first — this conversation depends on it."` (verbatim, role names inline)
     - `name_collision` → distinct copy naming the key
     - `archive_not_found` → distinct copy suggesting retry
     - Generic fallback for all others
   - No `onOpenChange(false)` — modal stays open throughout (D-19)

3. `<ConversationSearchRow>` call site — added `onUnarchive={r.isArchived ? handleUnarchive : undefined}`.

4. `search-store.ts` — added `removeResultByIdentity(hostId, identityKey)` export. Filters `state.results` by `!(r.hostId === hostId && r.identityKey === identityKey)` and notifies subscribers. This is the post-200 row-removal primitive; no such function existed before.

## Deviations from Plan

### Auto-added Missing Critical Functionality

**1. [Rule 2 - Missing Primitive] Added `removeResultByIdentity` to search-store.ts**
- **Found during:** Task 2 — plan directed "locate the store's remove primitive" but no such export existed (`appendResults`, `clearSearch`, `setError` only)
- **Issue:** Modal needed to remove a single row from `state.results` after endpoint returns 200; no store export supported this
- **Fix:** Added `removeResultByIdentity(hostId: number, identityKey: string): void` to `search-store.ts` with JSDoc citing D-16/D-17 and the endpoint-first contract
- **Files modified:** `src/ui/state/search-store.ts`
- **Commit:** `e70f56d6`

### Expected Test Failures

T-08 in `ConversationSearchModal.test.tsx` (pins the "coming soon" alert) fails as designed. The standing rules and plan both document this: plan 143-10 (Wave 5) is the final test-migration gate. 12/13 tests pass; 1 expected failure.

## Acceptance Criteria Verification

| Criterion | Result |
|-----------|--------|
| "coming soon" / old alert copy gone from ConversationSearchModal.tsx | 0 occurrences |
| `unarchiveIdentity\|UnarchiveError` count >= 3 | 6 |
| `"missing_roles"` count >= 1 | 1 |
| `"depends on it"` fragment present | 1 |
| `onUnarchive` passed to ConversationSearchRow | 1 |
| `onContextMenu` count == 0 (both files) | 0 |
| D-11/D-16/D-17/D-19 cites >= 1 | 12 |
| `RowKebabMenu` in ConversationSearchRow >= 1 | 5 |
| `onUnarchive` in ConversationSearchRow >= 2 | 6 |
| `result.isArchived` in ConversationSearchRow >= 2 | 5 |
| TypeScript `tsc --noEmit` exits 0 | PASSED |
| Pretty-conversations suite: 490/491 pass, T-08 expected fail | PASSED |

## Known Stubs

None. All data paths are wired: `unarchiveIdentity` is a real fetch; `removeResultByIdentity` updates live store state; alert copy is complete.

## Threat Flags

No new threat surface introduced beyond the plan's STRIDE register (T-143-08-01 through T-143-08-03). `window.alert` renders as text; `missingRoles.join(", ")` is plain string interpolation with no HTML. No new network endpoints, file access patterns, or auth paths introduced on the frontend.

## Self-Check: PASSED

- `src/ui/features/pretty-conversations/ConversationSearchRow.tsx` — exists, modified
- `src/ui/features/pretty-conversations/ConversationSearchModal.tsx` — exists, modified
- `src/ui/state/search-store.ts` — exists, modified
- Commit `9811b95b` — exists in git log
- Commit `e70f56d6` — exists in git log
