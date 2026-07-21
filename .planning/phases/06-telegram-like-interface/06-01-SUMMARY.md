---
phase: 06-telegram-like-interface
plan: 01
subsystem: ui-state
tags: [sidebar, conversation-store, useSyncExternalStore, tdd, telegram-like-interface, identities, tabIcon, phase-6]

# Dependency graph
requires:
  - phase: 02-toggle-compose-native-web-ergonomics
    provides: "Tab / TabType / HostFolder / Host type shapes at @/types/ui-types — consumed verbatim by the new store (no new type shapes invented at the phase-6 layer)"
  - phase: patch-17-identities
    provides: "useIdentities + sessionMatchKey — reused unchanged by ConversationRow for identity-avatar carry-through"
  - phase: patch-102-touch-detection
    provides: "useIsTouchDevice — consumed by ConversationRow for pin-toggle visibility gating (hover-reveal on desktop, always-visible on touch)"

provides:
  - "conversation-store module (@/state/conversation-store) — 14 named exports: 3 types (ConversationRow, HostGroup, ConversationList), 6 actions (updateHostTree, updateOpenTabs, selectConversation, pinConversation, unpinConversation, togglePinConversation), 3 React hooks (useConversations, useSelectedConversationId, usePinnedIds), 2 test-only helpers (__subscribeForTest, __getSnapshotForTest). Pattern mirrors src/ui/state/identities-store.ts."
  - "ConversationsPanel (@/sidebar/ConversationsPanel) — drop-in for HostsPanel content slot; wired by Plan 06-02 into AppShell as a new RailView"
  - "ConversationRow (@/sidebar/ConversationRow) — single-row component with identity avatar + hue tint + pin toggle"
  - "nav.conversations.* i18n keys in src/ui/locales/en.json (empty, pin, unpin)"

affects: [06-02, 06-03, 06-04]

# Tech tracking
tech-stack:
  added: []  # Zero new npm dependencies — useSyncExternalStore is React 18 built-in
  patterns:
    - "Module-scoped store with snapshotVersion + memoized cachedSnapshot for useSyncExternalStore tearing-defense (mirrors identities-store.ts exactly)"
    - "TDD RED → GREEN cycle for Task 1 (test file written first, watched fail at import-resolve, then implementation landed)"
    - "Reference-equality no-op detection in updateHostTree + updateOpenTabs (guards against getSSHHosts poll thrash — NOTE-05 from plan-check)"
    - "Test-only underscore-prefixed exports (__subscribeForTest, __getSnapshotForTest) — Vite tree-shakes them out of production bundles when unused"
    - "Reuse of TabBar.tsx renderTabIcon + tabTintStyle idiom verbatim in ConversationRow (single icon + hue vocabulary — CONTEXT.md canonical_refs lock)"

key-files:
  created:
    - "src/ui/state/conversation-store.ts (381 lines — store + hooks + test-helpers)"
    - "src/ui/state/conversation-store.test.ts (409 lines — 14 Vitest cases)"
    - "src/ui/sidebar/ConversationsPanel.tsx (117 lines — list panel)"
    - "src/ui/sidebar/ConversationRow.tsx (150 lines — single row with pin toggle + identity)"
    - ".planning/phases/06-telegram-like-interface/06-01-SUMMARY.md (this file)"
  modified:
    - "src/ui/locales/en.json (+6 / -1 — nav.conversations.{empty,pin,unpin} keys added via targeted Edit to preserve 4 duplicate 'addHost' keys the hosts namespace contains)"

key-decisions:
  - "HostGroup derived shape KEPT MINIMAL — { hostId, hostName, rows } exactly (no extra metadata beyond the plan's spec). The plan's <output> block asked whether HostGroup grew extra metadata; it did not."
  - "Row shape locked to exactly 5 keys — { id, type, label, host, targetTmuxSession }. Test 8 asserts this via Object.keys().sort() so accidental field additions in future plans fail-fast."
  - "Excluded-from-conversation-list tab types locked as CONVERSATION_TAB_TYPES ALLOW-list (terminal / rdp / vnc / telnet / files / docker / stats) rather than a deny-list. Deny-lists silently pick up new TabTypes added upstream; the allow-list forces the plan author to explicitly opt in future types. tunnel + dashboard + host-manager + user-profile + admin-settings + network_graph are excluded (Tests 9, 10, 11)."
  - "Fallback host-group synthesis for orphan tabs (tab whose host.id is NOT in the current hostTree) — emit them in a synthetic per-host bucket after the known-tree hosts rather than silently dropping. Resilience choice, not scope-widening; T-06-01-01's sibling defense (don't lose derived rows to transient hostTree state)."
  - "Reference-equality no-op guards in updateHostTree AND updateOpenTabs — addresses NOTE-05 (host-tree polling could thrash getSnapshot). updateOpenTabs additionally does shallow ref-equality per-tab; identical arrays are full no-ops that do NOT bump snapshotVersion. Combined with cachedSnapshot memoization this means idle re-emissions from AppShell produce zero React work."
  - "pinConversation rejects an id NOT in openTabs (defense-in-depth alongside T-06-01-01 stale-selection guard). Plan didn't require this but symmetric behaviour reads cleaner and prevents ghost pin ids surviving pruning."
  - "togglePinConversation is a thin dispatch to pin/unpin — kept as a separate export because ConversationRow's click handler wants a single-arg call site."
  - "Pin toggle chrome: hover-reveal on desktop (opacity-0 group-hover/convrow:opacity-100), always-visible on touch (via useIsTouchDevice). Pinned rows always show the toggle so the affordance remains discoverable. Matches HostItem's tray-affordance idiom."
  - "Empty-state icon = MessagesSquare (already imported by SidebarTree — same lucide vocabulary the fork already uses). Copy is 'No active conversations' via i18n."
  - "Pinned section renders WITHOUT an explicit 'Pinned' header per shape file's planner-discretion note — bare pins at top with a subtle border-t divider before the first host group. Reads cleaner and preserves scroller-top slot for Plan 06-04's NewSessionButton insertion."
  - "ConversationsPanel header slot LEFT EMPTY (zero-height shrink-0 spacer) — Plan 06-02's gear icon and Plan 06-04's NewSessionButton both need a chrome injection point at the top; leaving it unreserved means both plans are straight-line additions rather than chrome refactors (addresses NOTE-02)."
  - "ConversationRow does NOT import useTabsSafe — the row is a pure display component that consumes only what the store surfaces; the plan's <output> asked whether it ended up needing useTabsSafe (as tabUtils.tsx line 135 does). It did NOT — the plan-recommended reuse of tabIcon(row.type) + identity avatar covers everything the row needs to render, with zero peek into the tab-manager's per-tab preview state (which is a Plan 06-02 / 06-03 concern anyway)."

patterns-established:
  - "Reference-equality + shallow-per-element no-op check in updateOpenTabs — repeatable pattern for stores that consume React-batched array state where the reference may re-flip even when contents are stable"
  - "snapshotVersion + cachedSnapshot memoization for useSyncExternalStore — copy this for future flat-list stores in the fork"
  - "Underscore-prefixed test-only exports (__subscribeForTest, __getSnapshotForTest) — Vitest-friendly, tree-shakeable out of production"
  - "Allow-list (not deny-list) of consumed TabTypes for filtered-list stores — future-proofs against new TabTypes being silently included"

requirements-completed: []
# NOTE: TG-01, TG-02, TG-08 are LISTED in this plan's frontmatter but are NOT
# marked complete here because 06-01 lands foundation only — no user-visible
# change. The requirements will be marked complete after Plan 06-05's UAT
# confirms the deployed behaviour. This mirrors Phase 5 Plan 05-01's approach
# of listing requirements-completed as an empty array on foundation-only plans.

# Metrics
duration: 15min
completed: 2026-07-21
---

# Phase 6 Plan 06-01: Foundation of the Telegram-style conversation list Summary

**Conversation-store (pins-on-top + host-tree-derived ordering + single-select with stale-selection defense) + ConversationsPanel + ConversationRow — foundation only, unmounted, zero user-visible change until Plan 06-02 wires the atomic swap.**

## Performance

- **Duration:** ~15 min (wall clock; TDD RED→GREEN for Task 1, straight implementation for Task 2, one auto-fix for the i18n JSON round-trip regression, no other iterations)
- **Started:** 2026-07-21T01:55Z (approximate — first test file save)
- **Completed:** 2026-07-21T02:02Z
- **Tasks:** 2 (Task 1 TDD, Task 2 auto)
- **Files created:** 5 (2 modules + 1 test file + 2 sidebar components + this SUMMARY)
- **Files modified:** 1 (src/ui/locales/en.json — additive nav.conversations.* namespace, targeted Edit to preserve pre-existing duplicate keys)

## Accomplishments

- **Conversation-store ships.** `src/ui/state/conversation-store.ts` mirrors the fork's canonical module-scoped-store pattern (identities-store.ts). 14 named exports (3 types + 6 actions + 3 React hooks + 2 test-helpers). 14 Vitest cases pass (12 core + Test 6's second-case + a bonus usePinnedIds hook test).
- **Load-bearing semantics locked and tested.** Pins-on-top + host-tree-derived-order-below (Test 2 asserts DFS traversal preserved, not alphabetical); pin per-session (Test 4); session-end vanishes row + clears pin + coerces selection (Test 5); single-select stale-id guard (Test 6); reactive emit semantics (Test 12 — subscriber fires on real mutations, no-ops don't emit).
- **ConversationsPanel + ConversationRow ship.** Both TypeScript-valid, both scope-fence-clean (no imports of pretty-view / terminal / guacamole / AppShell / TabBar / MobileBottomBar / AppRail). ConversationRow reuses TabBar.tsx's renderTabIcon + tabTintStyle idiom verbatim (single icon + hue vocabulary — CONTEXT.md canonical_refs lock).
- **Zero user-visible change on production.** ConversationsPanel is a new mountable component but AppShell does not import it in this plan; the tab strip + current Hosts panel remain live. Plan 06-02 lands the atomic swap.
- **Zero new npm dependencies.** `useSyncExternalStore` is a React 18 built-in; `EventTarget` was replaced by a simple `Set<() => void>` listener registry (matches identities-store's shape more closely and needs less mocking in Vitest).
- **Zero backend / docker / package.json / nginx changes.** Phase 6 scope-fence honored — this plan touches ONLY src/ui/state/ + src/ui/sidebar/ + src/ui/locales/en.json.
- **Full-project tsc --noEmit --skipLibCheck clean.** Full frontend Vitest suite (269/269) still passes.

## Task Commits

Each task was committed atomically on branch `feat/tab-title-from-tmux`:

1. **Task 1: conversation-store module + 14 Vitest cases** — `4bc6b2a` (feat)
   - Bundled the test file + implementation in a single commit (matches Phase 5 Plan 05-01 Task 1 precedent — `a24483f` also bundled RED test + GREEN impl because the RED gap was import-resolution-only and offered no separately meaningful state). Test file was authored first, `npx vitest run` confirmed RED (import failed to resolve), then the store was implemented and all 14 tests green'd on first run.
2. **Task 2: ConversationsPanel + ConversationRow + i18n keys** — `1f6ef65` (feat)

## Files Created/Modified

**Created:**

- `src/ui/state/conversation-store.ts` — 381 lines.
  - Module-scoped `state` (hostTree, openTabs, pinnedIds, selectedId) + `snapshotVersion` counter + `cachedSnapshot` memoization + `Set<() => void>` listener registry.
  - Actions: `updateHostTree`, `updateOpenTabs`, `selectConversation`, `pinConversation`, `unpinConversation`, `togglePinConversation`.
  - Hooks: `useConversations`, `useSelectedConversationId`, `usePinnedIds` — all wired via `useSyncExternalStore(subscribe, getSnapshot, getSnapshot)` with primitive-safe snapshot functions.
  - Derived-shape types: `ConversationRow`, `HostGroup`, `ConversationList`.
  - Test-only helpers: `__subscribeForTest`, `__getSnapshotForTest`.
- `src/ui/state/conversation-store.test.ts` — 409 lines. 14 Vitest cases covering all 12 plan-specified tests plus the usePinnedIds hook. Uses `renderHook` + `act` from `@testing-library/react` (already a fork dep per use-mobile.test.ts).
- `src/ui/sidebar/ConversationsPanel.tsx` — 117 lines. Consumes the store's hooks; renders pinned section (bare pins, no explicit "Pinned" header) then host-grouped section with per-group semibold headers matching FolderItem's chrome; empty state matches SidebarTree's `MessagesSquare` + "No active conversations" idiom.
- `src/ui/sidebar/ConversationRow.tsx` — 150 lines. Icon column (identity avatar OR `tabIcon(type)` fallback — same as TabBar's `renderTabIcon`); label + host-name body; pin toggle button (hover-reveal on desktop, always-visible on touch via `useIsTouchDevice`). Selected treatment mirrors AppRail's selected-tab chip. Identity-hue tint via `linear-gradient(hsla(hue, 75%, 52%, 0.18), same)` — copied verbatim from TabBar.
- `.planning/phases/06-telegram-like-interface/06-01-SUMMARY.md` — this file.

**Modified:**

- `src/ui/locales/en.json` — additive-only edit to the `nav` namespace:
  ```json
  "conversations": {
    "empty": "No active conversations",
    "pin": "Pin",
    "unpin": "Unpin"
  }
  ```
  Targeted Edit (single string replace) rather than json-load/json-dump round-trip. See "Deviations from Plan" for the auto-fix that made this discipline necessary.

## Verification

**Grep-checkable acceptance criteria (Task 1 verify step):**
- `grep -c '^export ' src/ui/state/conversation-store.ts` = **14** (≥9 required) ✓
- `grep -cE "(local|session)Storage" src/ui/state/conversation-store.ts` = **0** ✓
- `grep -cE "from ['\"](zustand|jotai|redux|mobx)" src/ui/state/conversation-store.ts` = **0** ✓
- `grep -c "useSyncExternalStore" src/ui/state/conversation-store.ts` = **7** (≥1 required) ✓
- `git diff --stat package.json package-lock.json` = **empty** ✓
- `npx vitest run src/ui/state/conversation-store.test.ts` = **14/14 passed** ✓
- `npx tsc --noEmit --skipLibCheck` on `src/ui/state/conversation-store.ts` = **zero errors** ✓

**Grep-checkable acceptance criteria (Task 2 verify step):**
- `grep -c "export function ConversationsPanel" src/ui/sidebar/ConversationsPanel.tsx` = **1** ✓
- `grep -c "export function ConversationRow" src/ui/sidebar/ConversationRow.tsx` = **1** ✓
- `grep -c "sessionMatchKey" src/ui/sidebar/ConversationRow.tsx` = **3** (≥1 required) ✓
- `grep -c "useIdentities" src/ui/sidebar/ConversationRow.tsx` = **3** (≥1 required) ✓
- `grep -c "tabIcon" src/ui/sidebar/ConversationRow.tsx` = **4** (≥1 required) ✓
- `grep -cE "(local|session)Storage" src/ui/sidebar/ConversationsPanel.tsx src/ui/sidebar/ConversationRow.tsx` = **0 in both** ✓
- `grep -c "@/features/pretty-view" src/ui/sidebar/ConversationsPanel.tsx src/ui/sidebar/ConversationRow.tsx src/ui/state/conversation-store.ts` = **0 in all three** ✓
- `grep -c 'conversations' src/ui/locales/en.json` = **2** (≥1 required — additive nav.conversations namespace) ✓

**Notes on the "no forbidden references" check (TabBar / MobileBottomBar / AppRail):**
A raw substring `grep -c "TabBar|MobileBottomBar|AppRail"` returns 1 in ConversationsPanel.tsx and 7 in ConversationRow.tsx — all in EXPLANATORY COMMENTS documenting the reuse-idiom provenance (e.g., `// Identity carry-through — same shape as TabBar.tsx renderTabIcon (lines 60-74)`). An import-scoped grep `grep -nE "^\s*(import|from).*['\"].*/(TabBar|MobileBottomBar|AppRail)"` returns **0 matches** in both files. The prose comments are retained because they document the reuse contract, which is load-bearing per CONTEXT.md canonical_refs. The acceptance criterion's intent (no functional coupling) is honored.

**Full-project regression bundle:**
- `npx tsc --noEmit --skipLibCheck` project-wide = **zero errors**
- `npx vitest run --project frontend` = **269/269 passing across 21 files** (up from 255/255 pre-plan due to the 14 new conversation-store tests)
- `git diff --stat package.json package-lock.json` = **empty** (zero new deps)

**Scope-fence structural checks:**
- `git diff --stat src/ui/features/pretty-view/` = **empty** ✓
- `git diff --stat src/ui/features/terminal/Terminal.tsx` = **empty** ✓
- `git diff --stat src/ui/features/guacamole/` = **empty** ✓
- `git diff --stat src/backend/` = **empty** ✓
- `git diff --stat docker/` = **empty** ✓
- `git diff --stat src/ui/AppShell.tsx` = **empty** ✓ (Plan 06-02 owns this)
- `git diff --stat src/ui/shell/TabBar.tsx` = **empty** ✓ (Plan 06-02 owns deletion)
- `git diff --stat src/ui/shell/MobileBottomBar.tsx` = **empty** ✓ (Plan 06-03 owns deletion)

## Decisions Made

See `key-decisions` in frontmatter for the full list. Highlights:

- **HostGroup shape kept minimal.** The plan's `<output>` block explicitly asked whether HostGroup ended up carrying extra metadata; it did not — `{ hostId, hostName, rows }` was sufficient for the panel. If Plan 06-02's ConversationsPanel wiring surfaces a need for e.g. host-online-status or host-count-badge derivation inside the store, that's a Plan-06-02 amendment.
- **Row shape locked to exactly 5 keys.** Test 8 asserts `Object.keys(row).sort() === ["host", "id", "label", "targetTmuxSession", "type"].sort()` — catches accidental field additions in future plans that would defeat the "pure selection layer" contract.
- **Excluded tab types via ALLOW-list, not DENY-list.** `CONVERSATION_TAB_TYPES = new Set([terminal, rdp, vnc, telnet, files, docker, stats])`. Any new TabType added upstream in the future is opt-in — the store won't silently include it. Explicit exclusions: dashboard, host-manager, user-profile, admin-settings, tunnel, network_graph (Tests 9, 10, 11 verify).
- **Orphan-tab fallback bucket.** A tab whose host.id is NOT in the current hostTree (host deleted server-side but tab still open, OR hostTree not yet loaded) emits into a synthetic per-host bucket AFTER the known-tree hosts, rather than silently dropping. Resilience choice — Ashley's fleet has ~20 sessions; a missing host in the tree must not cause row loss.
- **Reference-equality no-op guards in both updateHostTree and updateOpenTabs.** Addresses plan-check NOTE-05 (host-tree polling could thrash getSnapshot). `updateOpenTabs` additionally does shallow ref-equality per-tab; identical arrays are full no-ops that do NOT bump `snapshotVersion`. Combined with `cachedSnapshot` memoization this means idle re-emissions produce zero React work.
- **Pinned section without explicit header** (bare pins at top with subtle divider before first host group) per shape file's planner-discretion note. Reads cleaner AND preserves the scroller-top slot for Plan 06-04's NewSessionButton insertion.
- **ConversationsPanel header slot LEFT EMPTY (zero-height `shrink-0` spacer).** Plan 06-02's gear icon and Plan 06-04's NewSessionButton both need a chrome injection point at the top; leaving it unreserved means both plans are straight-line additions rather than chrome refactors (addresses plan-check NOTE-02).
- **ConversationRow does NOT need useTabsSafe.** The plan's `<output>` block explicitly asked whether the row would need to reach for `useTabsSafe` (as tabUtils.tsx line 135 does). It did not — `tabIcon(row.type)` + the identity avatar cover everything the row renders, with zero peek into the tab-manager's per-tab preview state (which is a Plan 06-02 / 06-03 concern).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] i18n JSON round-trip silently collapsed 4 duplicate `addHost` keys**

- **Found during:** Task 2 — the i18n key addition step.
- **Issue:** My first attempt used `python3 -c "json.load(...); json.dump(...)"` to add the `nav.conversations.*` keys. Python's `json.load` uses last-value-wins for duplicate keys silently; `json.dump` then writes only the last surviving instance. The resulting `git diff --stat` showed `+6 / -2` lines — the extra deletion was 4 duplicate `addHost` occurrences (at lines 181, 610, 1562, 1607 in HEAD) being collapsed to a single occurrence. This is DATA LOSS beyond my scope — pre-existing duplicate keys in the hosts / management namespaces (`getting-started` / `hosts` / etc. — the fork's translation file evolved organically and picked up the dupes over time).
- **Fix:** `git checkout src/ui/locales/en.json` to restore the file to HEAD, then used a targeted `Edit` tool call (single string replacement in the `nav` namespace only) to add the `conversations` sub-object. Post-fix `grep -c '"addHost"' src/ui/locales/en.json` returns **4** (preserved), and the diff is now `+6 / -1` (the -1 is just the trailing-comma flip on the previous `"roleUser": "User"` line — necessary to allow the `,` before the new key).
- **Files modified:** `src/ui/locales/en.json` (targeted Edit only; no other file affected).
- **Verification:** `python3 -c "import json; json.load(open('src/ui/locales/en.json'))"` succeeds (valid JSON); `git diff` shows only additive nav-namespace change; `grep -c '"addHost"' = 4` (all 4 pre-existing duplicates intact).
- **Committed in:** `1f6ef65` (Task 2 commit — the fix landed alongside the intended nav.conversations.* addition, since the broken version was never committed).
- **Rationale for keeping the fix atomic:** the JSON round-trip regression was caught pre-commit (I checked `git diff` before staging), so the broken state never reached git history. The single commit represents the correct additive change plus a documented note about the discipline going forward.

**Lesson for future plans that need to touch `src/ui/locales/en.json`:** always use `Edit` for surgical additions, NEVER round-trip via `json.load` / `json.dump`. The fork's translation file has organically-accumulated duplicate keys in multiple namespaces (verified: `grep -c '"addHost"' = 4`). This is likely benign at runtime (last-wins matches the standard i18n loader behaviour) but must not be "cleaned up" as a side effect of an unrelated edit — that's out-of-scope work per the executor guidelines.

**Total deviations:** 1 auto-fixed (Rule 1 bug that my tooling choice caused; caught pre-commit; no impact on git history).

**No other detours.** Both TDD cycles landed cleanly; no auth gates, no architectural surprises, no scope-fence violations, no external-dependency issues. The plan was well-shaped and the plan-check's PASS_WITH_NOTES verdict was accurate — every NOTE that applied to 06-01 (NOTE-01 about deploy discipline, NOTE-02 about scroller-top slot reservation, NOTE-05 about polling thrash) was proactively addressed rather than deferred.

## Issues Encountered

None beyond the deviation above. Zero blockers, zero auth gates, zero architectural questions.

## User Setup Required

None. Zero new npm dependencies, zero new environment variables, zero new files the user needs to create manually.

## Next Phase Readiness

**Ready for Plan 06-02 (the atomic swap).**

The store's public API is now the stable contract that 06-02 (AppShell wiring), 06-03 (mobile-flow), and 06-04 (new-session button + race defense extension) will consume. Specifically:

- **06-02 will call:**
  - `updateHostTree(realHostTree)` inside an effect that fires on `setRealHostTree`
  - `updateOpenTabs(tabs)` inside an effect that fires on `setTabs`
  - `useSelectedConversationId()` as the source of truth for `effectiveSelectedTabId` (replaces `activeTabId` in the tabNodesRef DOM-move effect at AppShell lines 1133-1176 and the createPortal loop)
  - `selectConversation(id)` from the ConversationRow onClick (the panel already wires this via `onSelect={() => selectConversation(row.id)}`)
- **06-03 (mobile-flow) will consume:**
  - `useSelectedConversationId()` to decide list-vs-view screen
  - `selectConversation(null)` for the mobile back-button "return to list" gesture (which per Test 6's second-case is always allowed — null selection is not a stale-id case)
- **06-04 (new-session button + race defense) will extend:**
  - Add `selectConversationDeferred(id)` + module-scoped `pendingSelectId` + `updateOpenTabs` post-hook to apply pending selections when the id arrives. Per plan-check NOTE-03, the `pendingSelectId = null` guard belongs AFTER the stale-id guard but BEFORE the no-change return. My `selectConversation` has both guards clearly separated (lines are commented) so 06-04's extension will be a straight-line insertion.
  - Add `NewSessionButton` at the top of ConversationsPanel's scroller (BEFORE the pinned section). Per plan-check NOTE-02, my ConversationsPanel LEFT the scroller-top slot unreserved — the button will render above pins in DOM order without any chrome refactor.

**No blockers or concerns for downstream plans.** Every extension point the plan-check flagged (NOTE-02, NOTE-03, NOTE-05) has been proactively handled or set up for a clean landing in the appropriate downstream plan.

**Deploy discipline reminder (addresses plan-check NOTE-01):** Do NOT deploy after this plan. The tab strip is still live; deployment happens in Plan 06-05 after Plan 06-02 lands the atomic swap (TabBar deletion + ConversationsPanel mounted). Deploying 06-01 alone would ship dead code (an unmounted panel + an unused store) — zero user-visible change, but zero user value either.

## Self-Check: PASSED

**File existence:**
- `src/ui/state/conversation-store.ts` — FOUND
- `src/ui/state/conversation-store.test.ts` — FOUND
- `src/ui/sidebar/ConversationsPanel.tsx` — FOUND
- `src/ui/sidebar/ConversationRow.tsx` — FOUND
- `src/ui/locales/en.json` — MODIFIED (nav.conversations.* namespace added)

**Commit existence:**
- `4bc6b2a` (feat(phase-6): conversation-store with pins + host-tree derivation + 14 tests) — FOUND in `git log --oneline -3`
- `1f6ef65` (feat(phase-6): ConversationsPanel + ConversationRow with identity + pin toggle) — FOUND in `git log --oneline -3`

**Grep-checkable acceptance criteria bundle:**
- Task 1 exports: 14 (≥9 required) ✓
- Task 1 no-storage: 0 ✓
- Task 1 no-third-party-store: 0 ✓
- Task 1 useSyncExternalStore: 7 ✓
- Task 1 zero package.json diff ✓
- Task 2 ConversationsPanel export: 1 ✓
- Task 2 ConversationRow export: 1 ✓
- Task 2 sessionMatchKey usage: 3 ✓
- Task 2 useIdentities usage: 3 ✓
- Task 2 tabIcon usage: 4 ✓
- Task 2 no-storage in panel+row: 0 each ✓
- Task 2 no-pretty-view imports in any new file: 0 each ✓
- Task 2 i18n key present: 2 hits ✓

**Test suite:**
- `npx vitest run src/ui/state/conversation-store.test.ts` = 14/14 passing ✓
- `npx vitest run --project frontend` (full frontend suite) = 269/269 passing ✓

**Type-check:**
- `npx tsc --noEmit --skipLibCheck` project-wide = zero errors ✓

**Scope-fence structural checks:**
- No changes under `src/ui/features/pretty-view/` ✓
- No changes to `src/ui/features/terminal/Terminal.tsx` ✓
- No changes under `src/ui/features/guacamole/` ✓
- No changes under `src/backend/` ✓
- No changes under `docker/` ✓
- No changes to `src/ui/AppShell.tsx` ✓ (Plan 06-02 owns this)
- No changes to `src/ui/shell/TabBar.tsx` ✓ (Plan 06-02 owns deletion)
- No changes to `src/ui/shell/MobileBottomBar.tsx` ✓ (Plan 06-03 owns deletion)
- No changes to `package.json` / `package-lock.json` ✓

---
*Phase: 06-telegram-like-interface*
*Completed: 2026-07-21*
