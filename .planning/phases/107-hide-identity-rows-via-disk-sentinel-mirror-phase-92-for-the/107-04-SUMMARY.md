---
phase: 107
plan: "04"
subsystem: frontend
tags: [hidden-slice, disk-sentinel, identities-store, user-preferences-api, conversation-store, panel-affordance]
dependency_graph:
  requires: [107-01, 107-02, 107-03]
  provides: [frontend-hidden-hydrate-from-disk, put-hidden-ids-with-identity-hosts, fleet-identity-row-hide-affordance]
  affects: [PrettyConversationsPanel, conversation-store, identities-store, user-preferences-api]
tech_stack:
  added: []
  patterns:
    - deriveDiskHiddenIds mirrors deriveDiskPinnedIds — same both-loaded-gated single-pass projection
    - isFleetIdentityRow discriminator for affordance narrowing
    - H2 identityHosts lock — buildIdentityHostsFromFleet is the single derivation site
key_files:
  created: []
  modified:
    - src/ui/api/user-preferences-api.ts
    - src/ui/api/identities-api.ts
    - src/ui/state/identities-store.ts
    - src/ui/state/conversation-store.ts
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/api/user-preferences-api.test.ts
    - src/ui/state/identities-store.enrichment.test.ts
    - src/ui/state/conversation-store.test.ts
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.relay-room.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx
    - src/ui/features/pretty-conversations/NewConversationModal.flow.test.tsx
decisions:
  - "H2 lock preserved: buildIdentityHostsFromFleet is the single fleetSessions→identityHosts derivation site in both hideConversation and the panel hydrate effect"
  - "isFleetIdentityRow gate: fleet:: && !relay-room && !rdpHostRow — applied at all 4 onToggleHide render sites (searchMatches, displayedPinned, displayedMiddle, hiddenRows)"
  - "hydratedRef one-shot guards BOTH pinned AND hidden in the same IIFE — prevents double-derivation on re-renders"
  - "__resetHiddenIdsForTest added to global beforeEach to prevent hiddenIds state leakage across STORE-107 tests"
metrics:
  completed_date: "2026-09-12"
  tasks_completed: 2
  files_modified: 14
---

# Phase 107 Plan 04: Frontend Hidden Slice Disk-Sentinel Migration Summary

**One-liner:** Rewired the frontend hidden slice to derive `hiddenIds` from identity disk fields via `deriveDiskHiddenIds`, thread `identityHosts` into `putHiddenIds` for backend fanout, and narrow the Hide button affordance to fleet-synthetic identity rows only.

## What Was Built

### Task 1 — API + Store layer

**`user-preferences-api.ts`**: Retired `getHiddenIds` (GET /user-preferences hidden path). Widened `putHiddenIds` signature from `(ids: string[])` to `(ids: string[], identityHosts: Record<string, number>)`. Sends `identityHosts` alongside `hiddenConversationIds` in PUT body so backend can resolve composite ids to host-scoped writes. Reuses `toBareIdentityKey` (H2 wire-boundary helper, not duplicated).

**`identities-api.ts`**: Added `hidden?: boolean` field to `Identity` interface, populated by Phase 107 Plan 02 backend fanout, fail-closed on missing (undefined treated as unhidden).

**`identities-store.ts`**: Added `deriveDiskHiddenIds(identityHosts)` export immediately after `deriveDiskPinnedIds`. Walks `state.identities`, filters `identity.hidden === true`, projects into `fleet::${hostId}::${lookupKey}` space. `buildIdentityHostsFromFleet` at L111-122 unchanged (H2 lock).

### Task 2 — Panel hydrate effect + affordance narrowing

**`conversation-store.ts`**: Both `hideConversation` and `unhideConversation` now derive `identityHosts = buildIdentityHostsFromFleet(state.fleetSessions)` before calling `putHiddenIds([...ids], identityHosts)`. H2 anti-pattern comment blocks mirror the pin path.

**`PrettyConversationsPanel.tsx`**:
- Added `deriveDiskHiddenIds` to identities-store import; removed `getHiddenIds` import.
- Hydrate effect: derives `hiddenIds = deriveDiskHiddenIds(identityHosts)` in the same both-loaded-gated IIFE as `pinnedIds`, using the same `identityHosts` and `hydratedRef`. Deleted the old `getHiddenIds` try/catch block.
- Added `isFleetIdentityRow(row)` helper: `row.id.startsWith("fleet::") && row.kind !== "relay-room" && row.rdpHostRow !== true`.
- Applied gate at all 4 `onToggleHide` render sites (searchMatches, displayedPinned, displayedMiddle, hiddenRows). RDP rows, relay-room rows, and dev-tab rows lose the Hide affordance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tests (g)-(j) used non-fleet:: row IDs incompatible with affordance gate**
- **Found during:** Task 2 GREEN phase when running panel tests
- **Issue:** Pre-existing tests (g), (h), (i), (j) in the Hide/Show wiring describe block used bare row ids (`"active-row-g"`, `"hidden-row-h"`, etc.) that don't pass `isFleetIdentityRow`. The Hide context-menu item disappeared for these rows, breaking the tests.
- **Fix:** Updated all 4 tests to use `fleet::1::` prefixed ids (e.g., `"fleet::1::active-row-g"`). Updated `hideConversationSpy.toHaveBeenCalledWith` assertions to match the new ids.
- **Files modified:** `PrettyConversationsPanel.test.tsx`
- **Commits:** `dbbf5b5e`

**2. [Rule 1 - Bug] `__resetHiddenIdsForTest` missing from global beforeEach causing STORE-107-04 state leak**
- **Found during:** Task 2 GREEN phase when STORE-107-04 failed (putHiddenSpy called 0 times)
- **Issue:** STORE-107-01 and STORE-107-03 both called `hideConversation("fleet::1::tina")`, leaving the id in `state.hiddenIds`. STORE-107-04 then called `hideConversation("fleet::1::tina")` but the guard `if (state.hiddenIds.has(id)) return` fired — 0 calls to putHiddenIds. The global `beforeEach` called `__resetPinnedIdsForTest()` but not `__resetHiddenIdsForTest()`.
- **Fix:** Added `__resetHiddenIdsForTest` to import and to `beforeEach` alongside `__resetPinnedIdsForTest`. Added `vi.mocked(UserPreferencesApi.putHiddenIds).mockClear()` alongside the pin spy clear.
- **Files modified:** `conversation-store.test.ts`
- **Commits:** `dbbf5b5e`

## Test Results

| File | Tests | Result |
|------|-------|--------|
| user-preferences-api.test.ts | 11 | PASS |
| identities-store.enrichment.test.ts | 17 | PASS |
| conversation-store.test.ts | 121 | PASS |
| PrettyConversationsPanel.test.tsx | 123 | PASS |
| PrettyConversationsPanel.relay-room.test.tsx | 3 | PASS |
| PrettyConversationsPanel.new-role-button.test.tsx | 3 | PASS |
| PrettyConversationsPanel.clone-dialog.test.tsx | 8 | PASS |
| PrettyConversationsPanel.role-management-flow.test.tsx | 4 | PASS |
| NewConversationModal.flow.test.tsx | 8 | PASS |
| **Total** | **298** | **ALL PASS** |

TypeScript: `npx tsc --noEmit` — 0 errors.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `dfa919ad` | test | RED — API-107-01..04 + SEL-107-01..05 |
| `8646218c` | feat | GREEN — putHiddenIds widened, getHiddenIds retired, deriveDiskHiddenIds added, Identity.hidden field |
| `2228808d` | test | RED — PANEL-107-01..04, AFF-107-01..06, STORE-107-01..04, mock hygiene for 5 sibling files |
| `dbbf5b5e` | feat | GREEN — panel hydrate effect + identityHosts threading + isFleetIdentityRow affordance gate |

## TDD Gate Compliance

- RED gate: `dfa919ad` (test) + `2228808d` (test)
- GREEN gate: `8646218c` (feat) + `dbbf5b5e` (feat)
- REFACTOR: not required (implementation was clean)

## Known Stubs

None. All data paths are wired end-to-end.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes beyond what the plan's threat model covers.

## Self-Check: PASSED

- `src/ui/api/user-preferences-api.ts` — exists, `getHiddenIds` absent, `putHiddenIds` has 2-arg signature
- `src/ui/state/identities-store.ts` — `deriveDiskHiddenIds` export present
- `src/ui/state/conversation-store.ts` — `buildIdentityHostsFromFleet` called in both hide/unhide
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — `isFleetIdentityRow` at 4 sites, `deriveDiskHiddenIds` in hydrate effect
- All 4 commits exist in `git log --oneline -10`
