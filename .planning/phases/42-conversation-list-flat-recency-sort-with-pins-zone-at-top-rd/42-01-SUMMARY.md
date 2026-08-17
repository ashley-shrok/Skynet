---
phase: 42-conversation-list-flat-recency-sort-with-pins-zone-at-top-rd
plan: 01
subsystem: ui
tags:
  - conversation-list
  - sort
  - css-retirement
  - fleet-native
  - recency
  - three-zone-shape

# Dependency graph
requires:
  - phase: 07-fleet-native-conversation-list
    provides: openTabs + fleetSessions union, RDP synthesis from hostsFlat, fleetOnly + rdpHostRow routing markers
  - phase: 25
    provides: compareByHostRoleLabel comparator (host outer, role middle, label inner) — surviving sort sites (activeSet / pinned / rdpGroup)
provides:
  - "ConversationList: { activeSet, pinned, middle: ConversationRow[], rdpGroup: HostGroup | null } — three-zone shape replaces the retired grouped: HostGroup[]"
  - "compareByRecencyDesc (Phase 42) — middle-zone comparator with no-history-to-top rule + insertion-order fallback for deterministic stability"
  - "row.lastMessageAt: number | null | undefined — optional pass-through hook wired via test-only __setLastMessageAtForTest injection map; Plan 03 will replace the test hook with a real fleet-status wire-side signal"
  - "Ambient-recession CSS + row-class-toggle RETIRED — every row carries the same visual weight"
  - "Panel: flat middle-zone renderer (no per-host divider chips) + conditional rdpGroup renderer (Ashley lock #7 — no header on zero RDP)"
affects:
  - 42-02-search-and-filter
  - 42-03-fleet-status-recency-signal-wiring
  - pretty-conversations-mount-order-any-future-panel-work

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-zone ConversationList (activeSet + pinned + middle + rdpGroup) — replaces the pre-Phase-41 activeSet + pinned + grouped[] tiering"
    - "Insertion-order fallback for stable sort under no-history conditions (WeakMap keyed on row-object identity)"
    - "Test-only injection map for future-wire fields (__setLastMessageAtForTest) — pattern for staging Plan 03 signal without invasive production plumbing"

key-files:
  created: []
  modified:
    - "src/ui/state/conversation-store.ts — ConversationList reshape (grouped → middle + rdpGroup); compareByRecencyDesc + no-history-to-top; test-only lastMessageAt injection map"
    - "src/ui/state/conversation-store.test.ts — 40+ test-shape retargets grouped → middle/rdpGroup; new Tests A-H; Phase 25 role-clustering retargeted from middle to pinned tier (surviving sort site)"
    - "src/ui/AppShell.persistence.test.tsx — grouped → middle/rdpGroup shape updates in beforeEach + Test 4"
    - "src/ui/features/pretty-conversations/pretty-conversations.css — ambient block L572-621 deleted; L1075 ambient hide-action consolidated to non-ambient hover-reveal; header comment updated to note retirement"
    - "src/ui/features/pretty-conversations/PrettyConversationRow.tsx — isAmbient derivation deleted; ambient className toggle retired; inActiveSet prop + .active-set className toggle PRESERVED"
    - "src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx — Test 18 rewritten as AMBIENT-RETIRED-01 (covers all four inActiveSet × isRdp combos); new READY-DOT-UNIFORM-01 regression"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx — useConversations destructure updated to middle + rdpGroup; displayedGrouped renderer replaced with flat displayedMiddle + conditional displayedRdpGroup; Server icon import retired"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx — mock shape updated to middle + rdpGroup + setSnapshot shim for pre-Phase-41 tests that seed grouped[]; Tests 3, 19A/B/C, 27b rewritten; new Tests 19D (rdp-header-hides-on-zero) and 19E (ready-dot on all non-working middle rows)"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx — useConversations mock updated to new shape"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx — useConversations mock updated to new shape (stubRow moved from grouped[0].rows[0] to middle[0])"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx — useConversations mock updated to new shape"

key-decisions:
  - "Task 1 + Task 2 committed as ONE atomic unit — the store shape change (Task 1) forces the panel's useConversations destructure to change (Task 2), so splitting into two commits would violate the fork's 'full-suite green at each commit' precondition. Plan spirit preserved (both tasks documented distinctly here)."
  - "Retire the ambient VISUAL only — .active-set className toggle + inActiveSet prop SURVIVE (drive deactivate-action hover-reveal at pretty-conversations.css L978/L982/L994 + swipe machinery + context-menu item gating). Ashley lock #1 verified."
  - "Middle-zone insertion-order fallback — implemented via a WeakMap keyed on row-object identity, populated during computeSnapshot's flat-middle push loop. Passed as a parameter into compareByRecencyDesc so the comparator stays pure."
  - "Phase 42 lastMessageAt field wiring — added as an OPTIONAL row field with a test-only __setLastMessageAtForTest injection map. Production callers never touch it; Plan 03 will replace the test hook with a fleet-status protocol extension. This keeps Plan 01 frontend-only per the three-plan split."
  - "Phase 25 role-clustering tests RETARGETED — moved 5 tests from middle-tier assertions to pinned-tier assertions. The (host, role, label) contract SURVIVES for activeSet + pinned + rdpGroup; only the middle tier flipped to compareByRecencyDesc."
  - "Snap-reorder lock verified — grep confirmed no CSS transition on transform/top/order was introduced on .pv-row selectors."
  - "Ready-dot regression locked TWICE — once at the row level (READY-DOT-UNIFORM-01, covers inActiveSet=true and false) and once at the panel level (Test 19E, covers full render pipeline)."
  - "Panel test mock backwards-compat shim added — setSnapshot({ ..., grouped: [...] }) still works and auto-splits into middle + rdpGroup. Preserves pre-Phase-41 test bodies without a bulk rewrite; only tests that assert on the retired shape (per-host divider chips) were rewritten."

patterns-established:
  - "Test-only future-wire injection map: for signal fields that will be populated by a future wave (Plan 03 fleet-status protocol extension), stage a test-only setter via `__setXxxForTest` + `__resetXxxForTest` that the store's row constructors consume. Keeps production code inert until the wave lands; keeps tests deterministic. See __setLastMessageAtForTest for the pattern."
  - "Backwards-compat mock shim for shape changes: when a store returns a new shape, the panel-test mock's setSnapshot helper can accept the OLD shape and auto-translate to the NEW shape, so tests that predate the shape change continue to work without bulk rewriting. See setSnapshot's `grouped` shim in PrettyConversationsPanel.test.tsx."
  - "Weak-typed test files (skynet fork has strict: false) do NOT surface shape-change breakage at tsc time — must be verified with vitest runtime execution. Cascading fixups to auxiliary test files' vi.mock('useConversations', ...) are required whenever a store shape changes."

requirements-completed: []

# Metrics
duration: ~1h 45m
completed: 2026-08-14
---

# Phase 42 Plan 01: Three-zone conversation list + retire ambient-recession visual Summary

**ConversationList reshaped to { activeSet, pinned, middle: ConversationRow[], rdpGroup: HostGroup | null }; middle-zone compareByRecencyDesc with no-history-to-top + insertion-order fallback; ambient-recession CSS + row-class-toggle retired; panel middle-zone flattened (no per-host divider chips); rdpGroup=null suppresses the entire RDP section (Ashley lock #7).**

## Performance

- **Duration:** ~1h 45m
- **Started:** 2026-08-14T21:14:00Z (approx.)
- **Completed:** 2026-08-14T23:02:00Z
- **Tasks:** 2 (Task 1 store reshape + comparator; Task 2 CSS retirement + panel + row updates)
- **Files modified:** 11 (2 source + 9 test/mock/CSS)

## Accomplishments

- **Store shape reshape**: `ConversationList: { activeSet, pinned, middle: ConversationRow[], rdpGroup: HostGroup | null }` replaces the pre-Phase-41 `grouped: HostGroup[]`. Middle is FLAT — no per-host bucketing, no hostTree walk. rdpGroup carries the sentinel HostGroup or is `null` when zero hosts have `enableRdp === true`.
- **New middle-zone comparator**: `compareByRecencyDesc` — rows with `lastMessageAt == null` sort to the TOP (Ashley no-history-to-top lock); rows with real timestamps sort DESC (freshest first); ties + no-history rows fall back to insertion-order key (WeakMap keyed on row-object identity) for deterministic stability across snapshot recomputes.
- **Insertion-order fallback ready for Plan 03**: since Plan 03 has not yet landed the real `lastMessageAt` signal, EVERY row currently has `lastMessageAt: null` and the middle degrades entirely to insertion-order. Plan 03 will populate the field via a fleet-status protocol extension without changing the comparator.
- **Ambient-recession visual retired**: the ~50-line `.pv-row.ambient` CSS block (background, avatar, hover, label, host) is deleted from `pretty-conversations.css`. The row component no longer derives `isAmbient` or toggles the `.ambient` className. Every row carries the same visual weight regardless of active-set membership — position + the ready-dot together carry the "where should I look next" story.
- **Ashley lock #5 (.active-set survives)**: the `.active-set` CSS class + row-class-toggle SURVIVE — they gate the deactivate-action hover-reveal at `pretty-conversations.css:978/L982/L994`, drive swipe-machinery composite logic, and gate the Deactivate context-menu item. Only the ambient VISUAL axis retired; the `inActiveSet` prop is preserved with all its downstream consumers.
- **Panel middle-zone flattened**: `displayedGrouped.map((group) => ...)` renderer replaced with a flat `displayedMiddle` renderer inside one `pv-panel-group` container. No per-host `[data-testid="host-divider"]` chips render anywhere in the panel (Ashley 2026-08-14 lock).
- **Panel RDP-header-hides-on-zero regression locked**: when `snapshot.rdpGroup === null`, the entire RDP section — divider chip + rows — is suppressed. Regression test in `PrettyConversationsPanel.test.tsx` (Test 19D) asserts `container.querySelector('[data-testid="rdp-divider"]') === null` when rdpGroup=null.
- **Ready-dot uniformity regression locked TWICE**: at the row level (`AMBIENT-RETIRED-01` covers all four `(inActiveSet, isRdp)` combos; `READY-DOT-UNIFORM-01` covers `inActiveSet=true` and `inActiveSet=false` for `isWorking===false`) AND at the panel level (Test 19E asserts every non-working middle row renders `[data-pv-conv-ready-dot="true"]` regardless of active-set membership). Patch #447 behavior survives the ambient CSS retirement.

## Task Commits

Task 1 + Task 2 committed as ONE atomic unit (see Decisions Made for the rationale). Commit hash recorded post-commit.

1. **Task 1 (store reshape + comparator) + Task 2 (ambient retirement + panel flat middle)** — single commit `plan(42-01): ...`

_Note: The plan called for per-task commits, but the two tasks are tightly coupled — the store shape change forces the panel's `useConversations()` destructure to change simultaneously. Committing Task 1 alone would leave the panel runtime-broken (grouped is undefined → for-of throws), violating the fork's "full-suite green at each commit" rule. See Deviations from Plan below._

## Files Created/Modified

- `src/ui/state/conversation-store.ts` — ConversationList type reshape (retired `grouped: HostGroup[]`; added `middle: ConversationRow[]` + `rdpGroup: HostGroup | null`); new `compareByRecencyDesc` comparator with no-history-to-top + insertion-order fallback; rewrote `computeSnapshot` middle-build (retired per-host bucketing + hostTree walk + orphan-host fallback); added `resolveLastMessageAt` hook + `__setLastMessageAtForTest`/`__resetLastMessageAtForTest` test-only injection API for Plan 03 forward-compat; updated `__getSnapshotForTest` + `__getFleetOnlyRowsForTest` for the new shape.
- `src/ui/state/conversation-store.test.ts` — 40+ test-shape retargets grouped → middle/rdpGroup; rewrote Test 2 (host-tree-order → middle-flat + insertion-order); Phase 25 role-clustering tests (7 tests) retargeted from middle to pinned tier (surviving sort site); added new Tests A/C/D/E/F/G/H for the Phase 42 comparator contract + rdpGroup null-when-zero + pinned-and-rdp stay-stable regressions; added `__resetLastMessageAtForTest` to beforeEach.
- `src/ui/AppShell.persistence.test.tsx` — beforeEach + Test 4 updated: `snap.grouped` → `snap.middle` / `snap.rdpGroup`.
- `src/ui/features/pretty-conversations/pretty-conversations.css` — deleted the entire `.pv-row.ambient*` selector block (L572-621); consolidated the `.pv-row.pv-row--desktop.ambient:not(:hover):not(:focus-within) .pv-hide-action` selector at L1075 to `.pv-row.pv-row--desktop:not(:hover):not(:focus-within) .pv-hide-action` (dropped the `.ambient` gate); updated the file's header comment to document the retirement.
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — deleted `const isAmbient = !isRdp && !inActiveSet;` derivation; retired `isAmbient && "ambient"` from the className composition; updated 6 header/inline comments to reflect the retirement; `inActiveSet` prop + `.active-set` className toggle PRESERVED (still gate deactivate-action visibility + swipe machinery).
- `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` — Test 12 comment updated (assertion is now trivially true); Tests 18 + 18b rewritten as a single `AMBIENT-RETIRED-01` regression covering all four `(inActiveSet, isRdp)` combos; new `READY-DOT-UNIFORM-01` regression asserts the ready-dot renders when `isWorking===false` regardless of `inActiveSet`.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — `useConversations()` destructure updated (`grouped` → `middle` + `rdpGroup`); `groupedRef` → `middleRef` + `rdpGroupRef`; `displayedGrouped` derivation retired; new `displayedMiddle` + `displayedRdpGroup` derivations; render tree's `displayedGrouped.map((group) => ...)` replaced with flat middle renderer inside `pv-panel-group[data-middle-group="true"]` + conditional rdpGroup renderer; `Server` icon import retired alongside the per-host divider chips; poller `getTargets` + `knownRowsRef` accumulator + `hiddenRows` useMemo updated to walk middle + rdpGroup.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — mock shape updated (`useConversations()` returns `{ activeSet, pinned, middle, rdpGroup }`); `MockSnapshot` type + `setSnapshot` helper reshape (with backwards-compat shim that accepts the pre-Phase-41 `grouped: MockGroup[]` field and auto-splits into `middle` + `rdpGroup`); Tests 3, 19A, 19B, 19C, 27b rewritten; new Tests 19D (rdp-header-hides-on-zero regression) + 19E (ready-dot on all non-working middle rows regression).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx` — `useConversations()` mock updated to new shape.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx` — `useConversations()` mock updated to new shape (stubRow moved from `grouped[0].rows[0]` to `middle[0]`).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx` — `useConversations()` mock updated to new shape.

## Decisions Made

- **One commit instead of two per-task commits**: the store shape change (Task 1) forces the panel's `useConversations()` destructure to change (Task 2) — post-Task-1-alone, the panel destructures a now-undefined `grouped` field and crashes at runtime with `for (const group of grouped) → TypeError: grouped is not iterable`. Committing Task 1 in isolation would violate the fork rule "NEVER commit code while the suite is red". Both tasks are committed together with the message documenting both. The SUMMARY.md preserves the Task 1 / Task 2 distinction for future reference.
- **Test-only injection map for `lastMessageAt`**: rather than adding wire-side plumbing that Plan 03 will supersede, staged an `__setLastMessageAtForTest(rowId, ts)` API in the store. Production callers never touch it; tests seed known timestamps to exercise the comparator's Rules 1/3/4. Plan 03 will replace the injection map with the fleet-status protocol extension without changing the comparator or the row constructors.
- **Phase 25 role-clustering tests retargeted from middle to pinned tier**: Phase 25 established `compareByHostRoleLabel` at 5 sort sites (activeSet, pinned, two middle-tier sites, RDP). Phase 42 retired the two middle-tier sites; the contract survives on activeSet + pinned + RDP. The 7 role-clustering tests were retargeted from `snap.grouped[0].rows` assertions to `snap.pinned` assertions so the contract stays locked at its surviving sort sites.
- **Backwards-compat mock shim in the panel test**: rather than bulk-rewriting every panel test that seeds `setSnapshot({ ..., grouped: [...] })`, added a `grouped` shim to `setSnapshot` that auto-splits into `middle` + `rdpGroup`. Only tests that assert on the retired shape (per-host divider chips) were explicitly rewritten. This preserves ~60 pre-Phase-41 test bodies verbatim.
- **`.pv-row.pv-row--desktop.ambient:not(:hover) .pv-hide-action` → `.pv-row.pv-row--desktop:not(:hover) .pv-hide-action`**: with `.ambient` retired, the hide-action hover-reveal that was previously scoped to ambient rows now applies to ALL desktop rows. Same behavioral contract for the user (hover-reveal on non-hovered rows); the CSS just no longer scopes it under the retired class.
- **`.active-set` deactivate-action hover-reveal preserved verbatim**: Ashley lock #1 — the `.active-set` CSS selectors at `pretty-conversations.css:978/L982/L994` are load-bearing for the deactivate-button hover-reveal AND for the "safety net" desktop guard that hides the deactivate-action on non-active-set rows. Retiring the `.active-set` className toggle would have broken all three. Only the ambient VISUAL axis retired.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended `useConversations` mock updates to 3 auxiliary panel test files**
- **Found during:** Task 2 full-suite verify
- **Issue:** The plan's Task 2 <files> block enumerated 5 files (CSS + Row + Row test + Panel + Panel test). However, three OTHER panel test files (`PrettyConversationsPanel.chain.test.tsx`, `PrettyConversationsPanel.clone-dialog.test.tsx`, `PrettyConversationsPanel.new-role-button.test.tsx`) each mock `useConversations()` inline with `grouped: []` returns. Post-Task-1's store shape change, the panel .tsx destructures `middle` from `useConversations()` — these auxiliary mocks returned `undefined` for `middle`, crashing the panel with "middle is not iterable" during render. This is a Rule 3 (blocking) auto-fix — the plan's scope did not include these files, but they had to be updated to preserve full-suite green.
- **Fix:** Updated `useConversations` mock returns in all three files: `{ activeSet: [], pinned: [], grouped: [...] }` → `{ activeSet: [], pinned: [], middle: [...], rdpGroup: null }`. In `PrettyConversationsPanel.clone-dialog.test.tsx`, moved the single `stubRow` from `grouped[0].rows[0]` position to `middle[0]` position.
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx`, `src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx`, `src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx`
- **Verification:** All 9 previously-failing tests in these files now pass; full suite goes from 9 failed to 0 failed.
- **Committed in:** part of the atomic commit

**2. [Rule 3 - Blocking] Added `lastMessageAt` OPTIONAL field to ConversationRow + test-only injection API**
- **Found during:** Task 1 test write for Tests C/D/G/H
- **Issue:** The plan's `<behavior>` for Task 1 requires tests that exercise `compareByRecencyDesc` with specific `lastMessageAt` values. The store's `rowFromTab`/fleet-synthetic/RDP row constructors did not have any mechanism to inject those values. A test-first attempt to mutate `snap.middle[i].lastMessageAt` post-hoc failed because the snapshot cache is invalidated on any notify(), causing `computeSnapshot` to construct FRESH row objects that lose the patched values.
- **Fix:** Added an OPTIONAL `lastMessageAt?: number | null` field to `ConversationRow`; added a module-scoped `lastMessageAtByRowId: Map<string, number|null>` injection map that `rowFromTab` + fleet-synthetic + RDP row builders consume via a `resolveLastMessageAt(rowId)` helper; exposed `__setLastMessageAtForTest` + `__resetLastMessageAtForTest` test-only API. This is strictly forward-compatible with Plan 03 (which will replace the map with a real wire-side signal).
- **Files modified:** `src/ui/state/conversation-store.ts` (added the field + injection map + resolver + test-only setters), `src/ui/state/conversation-store.test.ts` (imported the setters, added to beforeEach)
- **Verification:** Tests C/D/G/H (Phase 42 comparator contract) all pass; existing shape-lock test (Test 8) updated to filter `lastMessageAt` out of the exact-key-set assertion alongside `fleetOnly` + `rdpHostRow`.
- **Committed in:** part of the atomic commit

**3. [Rule 3 - Blocking] Retired unused `Server` icon import in PrettyConversationsPanel.tsx**
- **Found during:** Task 2 render tree cleanup
- **Issue:** The per-host divider chip renderer used `<Server className="..." />` from `lucide-react`. Post-retirement of the per-host chip, the `Server` import at line 56 became unused. If `noUnusedLocals` were enabled the tsc pass would fail; without that flag, this is a warning-only cleanup.
- **Fix:** Removed `Server` from the lucide-react import list; added a comment noting the retirement alongside the per-host divider chips.
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
- **Verification:** No remaining `Server` references outside the pre-existing `hydratePinnedIdsFromServer` API function name; `npx tsc --noEmit` still exits 0.
- **Committed in:** part of the atomic commit

---

**Total deviations:** 3 auto-fixed (all Rule 3 - Blocking)
**Impact on plan:** All auto-fixes necessary to preserve full-suite green and to exercise the plan's required test contracts. No scope creep — the fixes stay within the plan's <files_modified> spirit even where they extend to auxiliary test-file mocks (unavoidable given the store shape change fanout).

## Issues Encountered

- **Full-suite log initially unreadable**: two of my three earlier full-suite background runs completed with exit=0 but their output files were empty or deleted. Worked around by piping to `/tmp/skynet-fullsuite.log` explicitly on the final run. Full-suite result verified: 2368 tests pass, 6 skipped, 1 todo, 0 failed, exit 0.
- **Ashley lock #6 (snap reorder — no animation) verified via grep**: `grep -nE "\.pv-row[^{}]*\{[^}]*transition[^}]*(transform|top|order)"` returned no matches. No CSS transition on transform/top/order was introduced on `.pv-row` selectors.

## Ashley Locks — Verification Matrix

| Lock | Location | Status |
|------|----------|--------|
| #1 Middle FLAT | `snapshot.middle: ConversationRow[]` (not `HostGroup[]`) — 40+ tests assert against flat array | ✓ Verified |
| #2 Pinned zone (host, role, label) — no shuffle on activity | Test G — asserts pinned tier stays label-ordered even when zebra-row.lastMessageAt is fresher than alpha-row | ✓ Verified |
| #3 RDP zone (host, role, label) — no shuffle on activity | Test H — asserts rdpGroup stays label-ordered even when zebra-box.lastMessageAt is fresher than alpha-box | ✓ Verified |
| #4 RDP section header hides on zero rows | `snap.rdpGroup === null` when zero enableRdp hosts (Test in Test 31 second `it`); Panel Test 19D asserts no rdp-divider chip renders | ✓ Verified |
| #5 activeSet field + inActiveSet prop survive; .active-set className survives | inActiveSet prop count in Row.tsx ≥ 28; .active-set string count ≥ 1; CSS .active-set count = 10 (deactivate hover-reveal at L978/L982/L994 intact) | ✓ Verified |
| #6 No animation on middle-zone reorder | grep for `transition[^}]*(transform\|top\|order)` on .pv-row selectors returned 0 matches | ✓ Verified |
| #7 No-history rows sort to TOP of middle | Test C — asserts r2 (lastMessageAt=null) sorts before r1 (lastMessageAt=1000) | ✓ Verified |
| #8 Ready-dot on all non-working non-RDP rows | AMBIENT-RETIRED-01 (row-level, covers all four inActiveSet × isRdp combos); READY-DOT-UNIFORM-01 (row-level, covers inActiveSet true+false); Panel Test 19E (panel-level render pipeline) | ✓ Verified |

## Self-Check

Per fork rule + step self_check:
- **tsc exit code:** 0 ✓
- **Full-suite vitest:** 188 test files passed, 2368 tests passed, 0 failed, exit 0 ✓
- **npm run build:** exit 0, Vite bundle succeeded ✓
- **Snap-reorder CSS lock:** grep returned 0 matches ✓
- **.ambient selector count in CSS (non-comment):** 0 ✓
- **isAmbient references in PrettyConversationRow.tsx (non-comment):** 0 ✓
- **snapshot.grouped / state.grouped / list.grouped in conversation-store.ts:** 0 ✓
- **snapshot.grouped / state.grouped in conversation-store.test.ts:** 0 ✓
- **displayedGrouped / snapshot.grouped in PrettyConversationsPanel.tsx (non-comment):** 0 ✓

## User Setup Required

None — no external service configuration required. This plan is frontend-only + backend-inert (no backend routes added; no schema changes; no wire protocol changes). Plan 03 will land the real fleet-status wire-side signal for `lastMessageAt`.

## Next Phase Readiness

- **Plan 42-02 (search + one-shot scroll-hide + filter)**: independent of Plan 42-01; can proceed in parallel or after. The three-zone shape from Plan 42-01 is what Plan 42-02's filter-flatten pass will collapse.
- **Plan 42-03 (fleet-status protocol extension + recency signal wiring)**: waits on backend design. When it lands, replace the `__setLastMessageAtForTest` injection hook with the real fleet-status wire-side signal in `rowFromTab` + fleet-synthetic + RDP row builders. No changes to `compareByRecencyDesc` needed — the comparator is already Plan-03-ready.

## Self-Check: PASSED

---
*Phase: 42-conversation-list-flat-recency-sort-with-pins-zone-at-top-rd*
*Completed: 2026-08-14*
