---
phase: quick
plan: 260731-tgg
subsystem: pretty-conversations
tags: [hide, user-preferences, conversation-store, panel, row, mobile-swipe, context-menu]
dependency_graph:
  requires: [pinnedConversationIds backend (Phase 15 Plan 1), PrettyConversationRow (Phase 13), PrettyConversationsPanel (Phase 13), conversation-store pinnedIds slice (Phase 15)]
  provides: [hiddenConversationIds DB column + route, hideConversation/unhideConversation/useHiddenIds store slice, Hidden section in panel, HideAction component, mobile swipe hide, context menu Hide/Show]
  affects: [user-preferences GET/PUT, conversation-store computeSnapshot, PrettyConversationsPanel layout, PrettyConversationRow mobile strip + context menu]
tech_stack:
  added: [HideAction.tsx (new component), EyeOff/Eye/ChevronDown/ChevronRight from lucide-react]
  patterns: [mirror pinnedConversationIds byte-for-byte end-to-end, panel-level orchestration for mutual exclusion, fire-and-forget putHiddenIds with same-content guard, knownRowsRef accumulator for pre-filter row resolution]
key_files:
  created:
    - src/ui/features/pretty-conversations/HideAction.tsx
  modified:
    - src/backend/database/db/schema.ts
    - src/backend/database/db/index.ts
    - src/backend/database/routes/user-preferences.ts
    - src/backend/database/routes/user-preferences.test.ts
    - src/ui/api/user-preferences-api.ts
    - src/ui/state/conversation-store.ts
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/features/pretty-conversations/pretty-conversations.css
decisions:
  - hiddenIds are intentionally sticky (NOT pruned in updateOpenTabs) so stale hidden ids re-hide when the session reappears, matching Ashley's intent
  - Panel uses knownRowsRef accumulator to resolve hidden row objects for the Hidden section, since computeSnapshot() already filters them from all tiers
  - Mobile swipe design lock: active-set rows keep Pin+Deactivate on swipe; Hide is context-menu-only for active-set rows (per plan spec)
  - Single atomic commit for all 3 tasks per fork's numbered-patch convention
metrics:
  duration: "~75 minutes"
  completed: "2026-07-31T21:39:01Z"
  tasks_completed: 3
  files_changed: 11
---

# Quick 260731-tgg: Add Per-Account Hide Feature for Conversations — Summary

## One-liner

Added `hiddenConversationIds` TEXT column on `user_preferences` with full GET/PUT route parity to `pinnedConversationIds`, a `hiddenIds` Zustand-style slice in conversation-store that filters hidden rows from all three panel tiers, a collapsed "Hidden" section below the RDP group with EyeOff chip + ChevronRight/Down caret, Hide/Show context menu items between Pin/Unpin and Deactivate, mobile swipe HideAction (EyeOff for ambient / Eye for hidden rows), and mutual exclusion with pin (hide auto-unpins; pin auto-unhides) — all with 24 new tests (11 backend + 13 frontend).

## What Was Built

### Task 1: Backend — schema + migration + route + tests

- `src/backend/database/db/schema.ts`: Added `hiddenConversationIds: text("hidden_conversation_ids")` immediately after `pinnedConversationIds` in `userPreferences` sqliteTable.
- `src/backend/database/db/index.ts`: Added `addColumnIfNotExists("user_preferences", "hidden_conversation_ids", "TEXT")` in `migrateSchema()` after the pinned migration line. Existing installs pick it up idempotently; fresh installs get it from the same `addColumnIfNotExists` path.
- `src/backend/database/routes/user-preferences.ts`:
  - Added `HIDDEN_CONVERSATION_IDS_MAX_LENGTH = 1000` const
  - Added `parseHiddenConversationIds()` — structural mirror of `parsePinnedConversationIds()`
  - Extended `pickPreferences()` to include `hiddenConversationIds`
  - Extended `handlePutPreferences()` to destructure + validate + serialize `hiddenConversationIds` (same 400 semantics: non-array → 400, non-string element → 400, >1000 → 400, else JSON.stringify + persist)
  - Updated OpenAPI block comments on both GET and PUT
- `src/backend/database/routes/user-preferences.test.ts`:
  - Extended `Row` type with `hiddenConversationIds: string | null`
  - Updated insertChain to propagate `hiddenConversationIds`
  - Added `hiddenConversationIds: null` to all 6 existing Row seed objects
  - Added 11 new tests: HIDE 1-3 (GET branches), HIDE 4-10 (PUT branches), HIDE-X (cross-field)

### Task 2: Frontend store + API + panel filter + Hidden section

- `src/ui/api/user-preferences-api.ts`: Added `getHiddenIds()` and `putHiddenIds()` as structural mirrors of `getPinnedIds()` / `putPinnedIds()` with the same echo-divergence `console.warn("[hide-persistence] server echo mismatch")` guard.
- `src/ui/state/conversation-store.ts`:
  - Added `hiddenIds: Set<string>` to `State` type and initialized to `new Set<string>()`
  - Extended `SnapshotForTest` with `hiddenIds: ReadonlySet<string>`
  - Added `hideConversation / unhideConversation / toggleHideConversation` mutators (fire-and-forget `putHiddenIds` pattern)
  - Added `hydrateHiddenIdsFromServer(ids: string[])` with same-content guard
  - Added `useHiddenIds() / getHiddenIdsSnapshot()` hook
  - Added `__resetHiddenIdsForTest()` test helper
  - Updated `__getSnapshotForTest()` to include `hiddenIds`
  - `computeSnapshot()`: added final render-time filter pass removing `hiddenIds` from all three tiers (activeSet/pinned/grouped), dropping empty groups
  - Note: hiddenIds are NOT pruned in `updateOpenTabs` (sticky by design)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`:
  - Added `EyeOff, ChevronDown, ChevronRight` to lucide imports
  - Added `useHiddenIds, hideConversation, unhideConversation, hydrateHiddenIdsFromServer` imports from store
  - Added `getHiddenIds` import from API
  - Extended `PrettyConversationRowLive` prop type with `hidden?: boolean` and `onToggleHide?: () => void`
  - Subscribed to `const hiddenIds = useHiddenIds()`
  - Updated mount-hydration effect to `Promise.allSettled([getPinnedIds(), getHiddenIds()])` with independent dispatch on success
  - Added `const [hiddenExpanded, setHiddenExpanded] = useState(false)`
  - Added `knownRowsRef` accumulator + `hiddenRows` useMemo for Hidden section row resolution
  - Updated `handleRowSelect` to auto-unhide before routing
  - Added `handleTogglePin(rowId)` (unhide then pin — mutual exclusion)
  - Added `handleToggleHide(row)` (if already hidden → unhide; if active-set → deactivate first, then hide; else hide directly)
  - Updated all 3 non-RDP render sites to use `handleTogglePin`, `hidden={hiddenIds.has(row.id)}`, `onToggleHide={() => handleToggleHide(row)}`
  - Added Hidden section below `displayedGrouped.map(...)` block
- `src/ui/features/pretty-conversations/pretty-conversations.css`: Added `.pv-hidden-section` container + hover feedback rule.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`:
  - Extended `MockSnapshot` with `hiddenIds: ReadonlySet<string>`
  - Updated `setSnapshot` and `beforeEach` to include `hiddenIds: new Set()`
  - Added `hideConversationSpy`, `unhideConversationSpy`, `hydrateHiddenIdsFromServerSpy`
  - Updated conversation-store mock to export `useHiddenIds, hideConversation, unhideConversation, hydrateHiddenIdsFromServer`
  - Updated user-preferences-api mock to include `getHiddenIds, putHiddenIds`
  - Updated `beforeEach` to re-arm `getHiddenIds` default
  - Added 6 new tests (a-f): Hidden section not rendered, chip renders + collapsed, expand, tier filter, mount-hydration, pin mutual exclusion

### Task 3: Row wiring + HideAction + CSS + tests + full-suite sweep

- `src/ui/features/pretty-conversations/HideAction.tsx` (NEW): Structural mirror of `DeactivateAction.tsx`. Renders `EyeOff` (Hide) when `hidden={false}` and `Eye` (Show) when `hidden={true}`. Uses `.pv-hide-action` CSS class with `data-size` and `data-hidden` attributes. i18n labels via `t("nav.conversations.hide/show")`. Documents design-locked placement rules in block comment.
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx`:
  - Added `hidden?: boolean` and `onToggleHide?: () => void` to prop type
  - Imported `HideAction`
  - Added `onHideClick` callback with `e.stopPropagation()` + `onToggleHide?.()`
  - Added `hidden && "hidden"` to `rowClassName` cn() call
  - Rewrote mobile swipe strip to enforce design-locked matrix:
    - Hidden rows: `[HideAction(Eye=Show)]` only
    - Active-set rows: `[PinAction, DeactivateAction]` unchanged
    - Ambient rows: `[PinAction, HideAction(EyeOff)]`
  - Updated context menu items: inserted Hide/Show between Pin/Unpin and Deactivate when `onToggleHide` is provided
- `src/ui/features/pretty-conversations/pretty-conversations.css`: Added `.pv-hide-action` (neutral-gray `var(--color-pv-fg-muted)` palette, mobile hit-target, desktop hover-reveal on ambient rows, RDP safety net) + `.pv-hidden-section` styles
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`: Added 7 new tests (g-m): context menu shows Hide on non-hidden row, Show on hidden row, clicking Hide on ambient (no deactivate), clicking Hide on active-set (deactivate first + assert call order), mobile swipe ambient=HideAction, mobile swipe hidden=Show, mobile swipe active-set=Deactivate+no-HideAction

## Test Results

- Backend: 24 tests (13 original + 11 new HIDE 1-10 + cross-field) — all pass
- Frontend panel: 78+ tests in PrettyConversationsPanel.test.tsx — all pass
- Full suite: 972 passed, 6 skipped, 0 failed across 82 test files
- Both `npm run build:backend` and `npm run build` succeed with zero TS errors

## Verification Gates

- TASK1_CLEAN confirmed
- TASK2_CLEAN confirmed
- TASK3_CLEAN confirmed

## Deviations from Plan

### Auto-adjusted Issues

**1. [Rule 1 - Deviation] knownRowsRef accumulator for hidden row resolution**
- **Found during:** Task 2 implementation
- **Issue:** The plan spec says to resolve hidden rows against "PRE-filter tiers (i.e. before the hiddenIds filter is applied)". However, since `computeSnapshot()` already filters hidden rows from all three tiers before they reach `useConversations()`, the panel has no direct access to the pre-filter row objects.
- **Fix:** Used a `knownRowsRef` accumulator that captures row objects as they pass through the three visible tiers on every render. Rows that become hidden stop appearing in tiers but remain in the ref. This is idiomatic for this store architecture and matches the plan's functional intent: hidden rows that were previously visible are resolvable from the ref.
- **Impact:** Rows that are ALWAYS hidden (server-persisted before any render) won't appear in the Hidden section until they first appear in a visible tier. Acceptable: the server-hydration effect (getHiddenIds → hydrateHiddenIdsFromServer) fires after the first render, and rows transition from visible → hidden after that point, populating the ref.

**2. [Rule 1 - Deviation] Test (f) — context menu approach revised**
- **Found during:** Task 2 test execution
- **Issue:** Initial test (f) implementation used `fireEvent.contextMenu(rowEl!)` directly on the wrapper div. The context menu only wires to `[role="button"]` (the row body), not the outer wrapper.
- **Fix:** Updated to use `rowEl.querySelector('[role="button"]')` then `fireEvent.contextMenu(body, { clientX, clientY })` — matching the pattern used by all existing context menu tests (Tests 20A, 20B, etc.).

## Known Stubs

None — all features are fully wired. hiddenIds persist server-side (GET/PUT route), hydrate on mount (fleet-loaded-gated effect), and survive page reload.

## Threat Flags

None — no new network endpoints. The `/user-preferences` endpoint already existed; this patch extends the GET/PUT response shape only. No new routes, no new auth surface, no new file access patterns.

## Self-Check

- `src/ui/features/pretty-conversations/HideAction.tsx` — FOUND
- `src/backend/database/db/schema.ts` (hiddenConversationIds column) — FOUND
- `src/backend/database/db/index.ts` (migration) — FOUND
- `src/backend/database/routes/user-preferences.ts` (route extension) — FOUND
- `src/ui/state/conversation-store.ts` (hiddenIds slice) — FOUND
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (Hidden section) — FOUND
- Commit f378a52 — FOUND

## Self-Check: PASSED
