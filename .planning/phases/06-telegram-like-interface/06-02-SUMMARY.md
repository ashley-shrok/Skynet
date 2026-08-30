---
phase: 06-telegram-like-interface
plan: 02
subsystem: navigation-chrome
tags: [tabbar-deletion, conversation-store-wired, tabNodesRef-preserved, settings-surface, telegram-like-interface, atomic-swap, phase-6, load-bearing]

# Dependency graph
requires:
  - phase: 06-telegram-like-interface
    plan: 01
    provides: "conversation-store module (updateHostTree, updateOpenTabs, useSelectedConversationId, selectConversation) + ConversationsPanel + ConversationRow — all consumed by this plan's AppShell rewire and desktop-gear extension"
  - phase: patch-35-tabNodesRef
    provides: "tabNodesRef + normalViewRef + getTabNode + DOM-move effect at AppShell.tsx lines 285-297 + 1195-1237 + createPortal loop at 1595-1620 — REUSED byte-for-byte; the ONLY change is what value (`effectiveSelectedTabId` instead of `activeTabId`) drives `activeInline`"
  - phase: patch-28-thin-rail-idle
    provides: "sidebarOpen / sidebarWidth / sidebarEditing / sidebar-collapse-mechanism — preserved verbatim; no touches to lines 218 (`sidebarOpen`), 221-226 (`sidebarWidth`), or 1348-1377 (`sidebarHeader`)"

provides:
  - "AppShell rewired: conversation-store.selectedId drives the visible pane via `effectiveSelectedTabId` (falls back to activeTabId for singleton/dashboard tabs the store's ALLOW-list excludes). TabBar mount + import removed."
  - "ConversationsPanel extended with desktop gear-icon dropdown routing to admin destinations (host-manager, credentials, connections, quick-connect, ssh-tools, snippets, history, split-screen, user-profile, admin-settings). Optional `onRailClick`/`isAdmin` props — panel still renders in isolation without the gear (for standalone Vitest usage)."
  - "SettingsRow (NEW file src/ui/sidebar/SettingsRow.tsx) exporting `SettingsRow` (mobile-mount component, positioned by Plan 06-03) + `renderSettingsMenuItems` (canonical shared menu-item renderer consumed by both desktop gear and mobile row)."
  - "AppRail: `conversations` added as first rail entry (top of the icon column), RailView type extended, MessagesSquare icon vocabulary."
  - "AppShell default open-view changed from `hosts` → `conversations`."
  - "AppShell.persistence.test.tsx (3 Vitest cases) — programmatic guard for the T-06-02-01 mount-lifecycle-regression contract via a MountManager scaffold that reproduces the DOM-move mechanism in isolation."
  - "nav.conversations.title + nav.conversations.settings + 10 settings-menu i18n keys added to src/ui/locales/en.json."

affects: [06-03, 06-04, 06-05]

# Tech tracking
tech-stack:
  added: []  # Zero new npm dependencies — reuses existing DropdownMenu, Tooltip, lucide-react, useSyncExternalStore
  patterns:
    - "Effective-selected-id derivation: `effectiveSelectedTabId = selectedConversationId ?? activeTabId` when the store owns the selected tab, activeTabId for singleton tabs. Preserves single-scalar visible-pane semantics that URL-sync + document-title + fit-on-active-change + keyboard-nav effects consume."
    - "One-way store→AppShell mirror effect (`selectedConversationId → activeTabId`) — deliberately NOT bidirectional to avoid feedback loops with URL-restore paths that set activeTabId before tabs is populated. Store consumes tabs via updateOpenTabs and self-coerces via T-06-01-01 stale-selection defense."
    - "Defense-in-depth thrash guard: realHostTree memoized via JSON.stringify key before store.updateHostTree (plan-check NOTE-05). getSSHHosts polling produces content-equal but reference-inequal trees; the JSON key normalizes them so idle polls do NOT bump the store's snapshotVersion."
    - "Shared menu-item renderer pattern: renderSettingsMenuItems({onRailClick, isAdmin, t}) as a pure JSX-array helper (NOT a component) — caller provides `t` from its own useTranslation, hook-free helper safely composes into multiple DropdownMenuContent instances at arbitrary nesting."
    - "MountManager test scaffolding pattern: reproduce a load-bearing mechanism in ~60 lines of test-only scaffolding + assert the mechanism's invariants via reference-equality and mount-counter side channels. Whitebox test of 'the mechanism, done correctly, gives the contract'; UAT catches the 'AppShell uses the mechanism correctly' side."

key-files:
  created:
    - "src/ui/sidebar/SettingsRow.tsx (198 lines — SettingsRow component + renderSettingsMenuItems shared renderer + 10-entry SETTINGS_MENU_ITEMS registry)"
    - "src/ui/AppShell.persistence.test.tsx (383 lines — 3 Vitest cases via MountManager scaffold)"
    - ".planning/phases/06-telegram-like-interface/06-02-SUMMARY.md (this file)"
  modified:
    - "src/ui/AppShell.tsx (+166 / -74 including TabBar-mount removal and refreshTab-function removal) — conversation-store imports + effects + effectiveSelectedTabId memo + store→AppShell mirror effect; TabBar import + mount removed; refreshTab function removed (only TabBar called it); orphan onReorderTabs wiring removed; sidebarPanelContent gains `conversations` branch at top; sidebarTitle map extended; default railView 'hosts' → 'conversations'; DOM-placement effect activeInline calc swapped activeTabId → effectiveSelectedTabId; createPortal isVisible swapped; normal-view split-gate swapped; fit-on-active-change effect deps extended"
    - "src/ui/sidebar/AppRail.tsx (+8 / -0) — RailView type extended with 'conversations'; MessagesSquare imported; conversations rail entry added as first item"
    - "src/ui/sidebar/ConversationsPanel.tsx (+82 / -13) — desktop gear-icon DropdownMenu added to header; onRailClick + isAdmin props (both optional); renderSettingsMenuItems consumed for menu contents"
    - "src/ui/locales/en.json (+13 / -1) — nav.conversations.title + nav.conversations.settings + 10 settingsMenu* keys added via targeted Edit"
  deleted:
    - "src/ui/shell/TabBar.tsx (-620 lines) — DELETED unconditionally (TG-11 full-replacement). No feature flag, no conditional rendering, no user-facing toggle. `git rm` preferred over gutting-to-stub per plan Step A."

key-decisions:
  - "SettingsRow lives in its own file (src/ui/sidebar/SettingsRow.tsx), not exported from ConversationsPanel.tsx. Rationale: (1) plan Step F recommended new file for testability, (2) plan-check NOTE-07 flagged the ambiguity as needing an explicit choice for Plan 06-03's import path clarity, (3) the shared renderSettingsMenuItems helper needs a natural home separate from either surface. Plan 06-03 imports `SettingsRow` from `@/sidebar/SettingsRow`."
  - "refreshTab function REMOVED entirely (not kept-with-void-marker). Only TabBar called it; grep confirmed zero other callers. Plan Step B offered `void refreshTab;` as a smaller-diff alternative but the executor discretion favored removal for cleanliness — Plan 06-04 or later may re-introduce a per-row refresh affordance if Ashley's workflow needs one (documented as a follow-up thought)."
  - "onReorderTabs prop wiring REMOVED entirely (only TabBar consumed it). setTabs itself is preserved — it's still called from openTab, closeTab, and the tab-order-sync effect."
  - "useKeyboardTabNav kept as-is per plan Step B decision. Ctrl+Shift+[/] continues to cycle through the full tabs array including singleton tabs (host-manager, credentials, admin-settings). Refinement (cycle only through conversation-store's ordered list) explicitly deferred to a future bounty per plan-check NOTE-06 — Ashley rarely uses keyboard tab cycling per user profile inference."
  - "MountManager test scaffolding fallback (per plan-check NOTE-08) chosen over full-AppShell integration test. Rationale: AppShell has ~30 imports including i18n provider, theme provider, backend axios calls, dbHealthMonitor, terminal, guacamole feature panels — mocking all of them creates a test that shifts on every AppShell touch and produces false failures unrelated to persistence. The MountManager scaffold reproduces the DOM-move mechanism verbatim from AppShell.tsx lines 285-297 + 1195-1237 + 1595-1620 and asserts the three load-bearing invariants (Test 1 DOM node identity, Test 2 mount count invariant, Test 3 visibility toggle). Tests 4-6 (URL-sync, activeTabId mirror, stale-id no-op) DEFERRED to UAT in Plan 06-05 — their observable outcomes are covered indirectly by conversation-store.test.ts Test 6 (stale-id no-op) and by the mirror effect firing at the AppShell layer (unchanged effect dep semantics)."
  - "realHostTree memoized via JSON.stringify key before updateHostTree (defense-in-depth against plan-check NOTE-05 polling thrash). buildHostTree rebuilds a fresh tree on every getSSHHosts response; the JSON key normalizes content-equal but reference-inequal trees to a stable string, and the useMemo returns the previous tree reference when the JSON matches. Combined with the store's own reference-equality no-op guard, this means idle host-polls produce zero React work in ConversationsPanel consumers."
  - "ConversationsPanel props are OPTIONAL (`onRailClick?`, `isAdmin?`). The gear icon renders only when onRailClick is provided. Rationale: the panel should be render-able in isolation for unit-test scenarios that don't want to mock the full sidebar-rail routing. AppShell always provides both props, so production always has the gear."
  - "ConversationsPanel wired with the `hidden` class-toggle idiom (matches hosts / credentials panels above) rather than conditional-mount. Rationale: keeps the panel's store subscriptions LIVE across rail-view swaps, which matters for Plan 06-04's deferred-select race defense — the store's listener registry must be registered when a deferred-select's pendingSelectId flushes on tab arrival, even if the panel is not the currently-visible rail view at that moment."
  - "fit-on-active-change effect (AppShell line 442) dep list extended to include effectiveSelectedTabId. In practice activeTabId and effectiveSelectedTabId are kept in sync by the store→AppShell mirror, so this is defense-in-depth — direct-set paths (URL restore, keyboard, singleton open) fire on activeTabId; store-driven paths (ConversationsPanel row click) fire on effectiveSelectedTabId first with activeTabId mirroring in the next render. Both trigger the terminal fit + notifyResize."
  - "SettingsRow menu items include the FULL destination set the MobileBottomBar used to reach: host-manager (via `hosts` view), credentials, connections, quick-connect, ssh-tools, snippets, history, split-screen, user-profile, admin-settings. Chose INCLUDE-ALL (matching bottom-nav's full More-menu contents) rather than a subset — the settings surface truly houses everything the bottom nav used to host, per plan Step F recommendation."

patterns-established:
  - "Store↔AppShell one-way mirror effect — repeatable pattern for module-scoped stores whose selection needs to flow into React state that legacy effects depend on. The forward direction (store→React) is a useEffect on the store hook; the reverse direction (React→store) is a separate effect on the React state; both must be one-way per direction to avoid feedback loops with restore-path code that sets the React state without going through the store."
  - "Optional-props pattern for sidebar panels — panels that consume AppShell-provided routing callbacks default to render-in-isolation-friendly semantics (props marked optional; conditional rendering of chrome that requires the callback). Enables lightweight unit-test scenarios without mocking the full parent."
  - "MountManager scaffolding for testing load-bearing mechanisms extracted from large integration components — reproduce the mechanism in ~60 lines of test-only code + assert invariants via reference equality + side-channel counters. Beats the fragility of full-integration mocking for load-bearing correctness contracts."
  - "JSON.stringify-keyed useMemo for thrash-guarding derived state passed to external stores — normalizes reference-inequal-but-content-equal inputs. Suitable at Ashley's ~20-host scale; NOT suitable for very large trees where the stringify cost would dominate."

requirements-completed: []
# NOTE: TG-03, TG-04, TG-05, TG-10, TG-11 are LISTED in this plan's frontmatter
# but are NOT marked complete here. Plan 06-05 UAT is the requirement-completion
# checkpoint for the whole phase. This mirrors Plan 06-01's approach.

# Metrics
duration: 25min
completed: 2026-07-21
---

# Phase 6 Plan 06-02: The Load-Bearing Atomic Swap Summary

**TabBar deleted unconditionally. ConversationsPanel wired into AppShell as the default sidebar view. conversation-store.selectedId now drives which conversation is visible via a one-line swap in the patch #35 DOM-move mechanism (`activeInline = tab.id === effectiveSelectedTabId`). Persistence contract (TG-05) proven by a MountManager scaffolding test.**

## Performance

- **Duration:** ~25 min (wall clock; straight-line implementation of Task 1 → grep-check pass → full test-suite pass → Task 2 write + iterate on jsdom subscribe pattern → full test-suite pass. Zero deviations, zero blockers, zero architectural surprises.)
- **Started:** 2026-07-21T02:04Z (approximate — first AppRail edit)
- **Completed:** 2026-07-21T02:19Z
- **Tasks:** 2 (Task 1 auto, Task 2 tdd with fallback path)
- **Files created:** 3 (SettingsRow.tsx + AppShell.persistence.test.tsx + this SUMMARY)
- **Files modified:** 4 (AppShell.tsx + AppRail.tsx + ConversationsPanel.tsx + en.json)
- **Files deleted:** 1 (TabBar.tsx — 620 lines gone)
- **Net line change:** +813 / -671 (adds slightly more than the deletion since the store-integration + SettingsRow + test file account for most additions)

## Accomplishments

- **TabBar.tsx DELETED unconditionally.** No feature flag, no conditional rendering, no user-facing toggle to bring the strip back. TG-11 full-replacement contract satisfied. `git rm` (not gut-to-stub) per plan Step A preferred path. 620 lines gone.
- **ConversationsPanel wired into AppShell as the default RailView.** New rail entry at the top of the icon column; `railView === "conversations"` branch inserted at the top of `sidebarPanelContent`; default open-view changed from `"hosts"` → `"conversations"`. TG-03 single-view contract satisfied.
- **Patch #35 tabNodesRef DOM-move mechanism PRESERVED byte-for-byte.** T-06-02-01 mount-lifecycle-regression mitigation is the load-bearing correctness change of this plan: the DOM-placement effect at AppShell.tsx lines 1195-1237, `getTabNode` at 285-297, `normalViewRef` at 286, and the `createPortal` loop at 1595-1620 are UNCHANGED except for the ONE value driving `activeInline` (was `tab.id === activeTabId`, now `tab.id === effectiveSelectedTabId`). Same appendChild-based DOM re-parenting, same visibility/display toggles, same node caching in `tabNodesRef.current`. TG-05 persistence contract satisfied.
- **conversation-store fully consumed by AppShell.** `updateOpenTabs(tabs)` fires on every tabs change; `updateHostTree(stableHostTree)` fires on every host-tree change (with defense-in-depth JSON-key thrash-guard per plan-check NOTE-05); `useSelectedConversationId()` drives `effectiveSelectedTabId`; store→AppShell mirror effect keeps `activeTabId` synced one-way so URL-sync / document-title / fit-on-active-change / keyboard-nav all continue to fire.
- **Desktop gear icon added to ConversationsPanel header** routing to admin destinations (host-manager, credentials, connections, quick-connect, ssh-tools, snippets, history, split-screen, user-profile, admin-settings). Routes via AppShell's existing `handleRailClick`. Admin-settings entry is admin-gated at the menu-render level (matches existing AppRail behavior). TG-10 (desktop half) satisfied.
- **SettingsRow (mobile settings-row component) created in its own file** `src/ui/sidebar/SettingsRow.tsx` per planner-recommended new-file path (NOTE-07). Shared canonical menu-item registry (`SETTINGS_MENU_ITEMS`) and shared JSX-array renderer (`renderSettingsMenuItems`) mean desktop gear + mobile row render from ONE source of truth. TG-10 (mobile half) is ready for Plan 06-03's mount — 06-03 imports `SettingsRow` from `@/sidebar/SettingsRow` and drops it into the mobile-list layout.
- **AppShell scope-fence honored.** Zero touches to `src/ui/features/pretty-view/**`, `src/ui/features/terminal/Terminal.tsx`, `src/ui/features/guacamole/`, `src/backend/`, `docker/`, `package.json`, `package-lock.json`. Zero new npm dependencies.
- **Split-screen coexistence preserved.** SplitView + SplitScreenPanel + `splitTabQuick` / `addTabToSplit` / `removeTabFromSplit` / `paneTabIds` state all untouched. Normal-view split-gate at AppShell.tsx line 1581 now uses `effectiveSelectedTabId` (same substitution as everywhere else) so a conversation in a pane still hides the normal-view.
- **Persistence smoke test (3 cases) programmatically asserts T-06-02-01 contract.** MountManager scaffolding reproduces the DOM-move mechanism in ~60 lines and drives it via the REAL conversation-store (not mocked): Test 1 asserts DOM node identity across A→B→A via `expect(nodeAfter).toBe(nodeBefore)` reference equality; Test 2 asserts mount-count invariant (mock content component's mount count stays 1, unmount count stays 0 across the full switch cycle); Test 3 asserts visibility toggle applied on switch.
- **Full-project tsc --noEmit --skipLibCheck clean.** Full frontend Vitest suite: **272/272 passing** (269 baseline from Plan 06-01 + 3 new from Plan 06-02's persistence test).

## Task Commits

Each task was committed atomically on branch `feat/tab-title-from-tmux`:

1. **Task 1: atomic swap — delete TabBar, wire ConversationsPanel** — `d70ef63` (feat)
2. **Task 2: persistence-contract smoke test — T-06-02-01 defense** — `75338e8` (test)

## Files Created/Modified

**Created:**

- `src/ui/sidebar/SettingsRow.tsx` — 198 lines. `SettingsRow` component (mobile-mount) + `renderSettingsMenuItems` shared JSX-array renderer + `SETTINGS_MENU_ITEMS` 10-entry registry. Consumed by ConversationsPanel's desktop gear (immediately) and Plan 06-03's mobile-list layout (deferred mount).
- `src/ui/AppShell.persistence.test.tsx` — 383 lines. 3 Vitest cases via a MountManager scaffold that reproduces the patch #35 DOM-move mechanism. Uses the REAL conversation-store (not mocked). Fallback path per plan-check NOTE-08 chosen over full-AppShell integration test — rationale in decision log above.
- `.planning/phases/06-telegram-like-interface/06-02-SUMMARY.md` — this file.

**Modified:**

- `src/ui/AppShell.tsx` — +166 / -74 (net +92 including the TabBar-mount deletion at lines 1453-1466 and refreshTab-function deletion at old lines 986-997).
  - Import of `TabBar` deleted (line 35).
  - Imports of ConversationsPanel + conversation-store added.
  - Default `useState<RailView>` value changed from `"hosts"` to `"conversations"`.
  - `sidebarTitle` map extended with `conversations` key.
  - conversation-store sync effects added (updateOpenTabs, updateHostTree with JSON-key memoization) + `useSelectedConversationId()` hook read + `effectiveSelectedTabId` memo + one-way store→AppShell mirror effect.
  - Fit-on-active-change effect (line 442) dep list extended to `[activeTabId, effectiveSelectedTabId]`.
  - DOM-placement effect at old lines 1133-1176: single-line `activeInline` calc swap.
  - createPortal loop's `activeInline` calc: single-line swap.
  - Normal-view split-gate at old line 1499: `paneTabIds.includes(activeTabId)` → `paneTabIds.includes(effectiveSelectedTabId)`.
  - sidebarPanelContent: `railView === "conversations"` branch inserted at TOP (before hosts branch) — mounted-always with `hidden` class toggle to preserve store subscription lifetime across rail-view swaps.
  - TabBar mount at old lines 1453-1466 DELETED. Replaced with an explanatory comment about scope of deletion (refresh/reorder callbacks removed alongside).
  - `refreshTab(id)` function at old lines 986-997 DELETED (zero other callers per grep; the only call site was TabBar's ctx-menu which is now gone).
- `src/ui/sidebar/AppRail.tsx` — +8 / -0.
  - `MessagesSquare` icon imported from lucide-react.
  - `RailView` type extended with `"conversations"` as the first member.
  - `buildRailButtons` gains a `conversations` entry as the FIRST rail button (topmost) followed by a separator, then the existing hosts/sessions/etc. entries.
- `src/ui/sidebar/ConversationsPanel.tsx` — +82 / -13.
  - `Settings` icon + `DropdownMenu*` + `Tooltip*` imports added.
  - `renderSettingsMenuItems` + `RailView` imports added.
  - `onRailClick?` and `isAdmin?` props added (both optional so the panel renders in isolation for unit tests).
  - Header row extended: when `onRailClick` is provided, renders a right-aligned gear-icon `DropdownMenu` whose contents are `renderSettingsMenuItems({onRailClick, isAdmin, t})`. When absent (unit-test surface), header stays as a zero-height spacer — preserves 06-01's chrome-slot-reserved-for-06-04-NewSessionButton contract.
- `src/ui/locales/en.json` — +13 / -1 (single trailing-comma flip on the existing `"unpin"` key + additive `title` + `settings` + 10 `settingsMenu*` keys inside the pre-existing `nav.conversations` namespace). Targeted `Edit` used (not JSON round-trip) per Plan 06-01's hard-learned lesson: `grep -c '"addHost"'` still returns **4** post-edit (all 4 pre-existing duplicate keys preserved).

**Deleted:**

- `src/ui/shell/TabBar.tsx` — 620 lines gone via `git rm`. No breadcrumb file; git history + 06-05's patches-md entry are the provenance record.

## Verification

**Grep-checkable acceptance criteria (Task 1 verify step):**
- `ls src/ui/shell/TabBar.tsx` = **No such file or directory** ✓
- `grep -rn "from ['\"]@/shell/TabBar" src/ui` = **0** ✓
- `grep -rn "import.*TabBar" src/ui | grep -v test` = **0** ✓
- `grep -c "ConversationsPanel" src/ui/AppShell.tsx` = **5** (≥2 required — import + mount) ✓
- `grep -c "conversation-store\|updateOpenTabs\|useSelectedConversationId" src/ui/AppShell.tsx` = **10** (≥1 each required) ✓
- `grep -c '"conversations"' src/ui/sidebar/AppRail.tsx` = **2** (RailView member + buildRailButtons entry) ✓
- `grep -c 'useState<RailView>("conversations")' src/ui/AppShell.tsx` = **1** ✓
- `grep -c "onRailClick" src/ui/sidebar/ConversationsPanel.tsx` = **6** (prop declaration + destructuring + conditional guard + callback wiring + JSX prop + destructuring rename) ✓
- `grep -c "SettingsRow\|renderSettingsMenuItems" src/ui/sidebar/SettingsRow.tsx` = **5** ✓
- `grep -c "SettingsRow\|renderSettingsMenuItems" src/ui/sidebar/ConversationsPanel.tsx` = **4** (import + usage in gear DropdownMenuContent) ✓
- `grep -c "tabNodesRef\|normalViewRef\|getTabNode" src/ui/AppShell.tsx` = **13** post-plan vs **12** pre-plan. The +1 is my new explanatory comment describing the T-06-02-01 mitigation; the load-bearing occurrences at lines 285-297 (getTabNode + tabNodesRef.current mutations), 1197-1206 (normalViewRef ref access + tabNodesRef.current iteration), 1581 (ref={normalViewRef}), 1598 (getTabNode inside createPortal loop) are byte-identical to pre-plan ✓

**Grep-checkable acceptance criteria (Task 2 verify step):**
- `test -f src/ui/AppShell.persistence.test.tsx` = **EXISTS** ✓
- `grep -c ".toBe(t1NodeBefore\|.toBe(t2NodeBefore\|.toBe(t1NodeAfter\|.toBe(t2NodeAfter" src/ui/AppShell.persistence.test.tsx` = **4** (≥1 required for reference-equality semantics test) ✓
- `grep -c "vi.mock.*conversation-store" src/ui/AppShell.persistence.test.tsx` = **0** ✓ (test uses REAL store, does NOT mock — the store's own unit tests in Plan 06-01 covered the store surface separately)

**Full-project regression bundle:**
- `npx tsc --noEmit --skipLibCheck` project-wide = **zero errors** ✓
- `npx vitest run --project frontend` = **272/272 passing across 22 files** (up from 269/269 pre-plan due to the 3 new persistence tests) ✓
- `git diff --stat package.json package-lock.json` = **empty** ✓ (zero new deps)

**Scope-fence structural checks (against d70ef63^..75338e8):**
- `git diff --stat src/ui/features/pretty-view/` = **empty** ✓
- `git diff --stat src/ui/features/terminal/Terminal.tsx` = **empty** ✓
- `git diff --stat src/ui/features/guacamole/` = **empty** ✓
- `git diff --stat src/backend/` = **empty** ✓
- `git diff --stat docker/` = **empty** ✓
- `git diff --stat package.json package-lock.json` = **empty** ✓

**T-06-02-01 defense verification approach: PROGRAMMATIC (Tests 1-3) via MountManager scaffold.** The load-bearing DOM-node-identity + mount-count-invariant + visibility-toggle assertions all fire on every CI. Fallback path per plan-check NOTE-08 was invoked (rationale in decision log); the resulting split is: programmatic guards for the mechanism, UAT (Plan 06-05) for the integration wiring.

**Persistence-contract verification split summary:**
- Test 1 (DOM node identity) — PROGRAMMATIC (this plan). Direct reference-equality assertion.
- Test 2 (mount count invariant) — PROGRAMMATIC (this plan). Mock content component's mount/unmount counters.
- Test 3 (visibility toggle) — PROGRAMMATIC (this plan). Direct DOM `style.visibility` assertion.
- Test 4 (activeTabId mirrors selectedConversationId → document.title updates) — UAT (Plan 06-05). The document-title effect at AppShell.tsx line 407 fires on `activeTabId`; the store→AppShell mirror keeps activeTabId in sync with selectedConversationId. Ashley's manual title-check during UAT walk confirms.
- Test 5 (stale-id no-op end-to-end) — INDIRECTLY COVERED. conversation-store.test.ts Test 6 (T-06-01-01 stale-selection defense) proves the store's silent-no-op guard at the module level; AppShell's mirror effect only fires when `selectedConversationId !== activeTabId AND tabs.some(t => t.id === selectedConversationId)` (see AppShell rewire code), so a stale id (rejected by store) never triggers the mirror.
- Test 6 (URL fragment updates on select) — UAT (Plan 06-05). The URL-sync effect at AppShell.tsx line 420 fires on `activeTabId`; the store→AppShell mirror keeps them in sync. Patch #25's #tab=...&active=N scheme is preserved verbatim.

## Decisions Made

See `key-decisions` in frontmatter for the full list. Highlights that answer the plan's `<output>` block explicitly:

- **`refreshTab` was FULLY REMOVED (not kept-with-void-marker).** Rationale: `grep -rn refreshTab src/ui | grep -v ".test.\|.json"` shows zero callers post-TabBar-deletion. Void-marker would leak an unused function into the file. Plan 06-04 or later may re-introduce a per-row refresh via ConversationRow ctx-menu if Ashley's workflow demands it — that's a followup, not a debt this plan should carry.
- **Persistence test used the EXTRACTED-SCAFFOLD FALLBACK path (per NOTE-08), NOT the full-AppShell integration path.** Rationale: AppShell imports ~30 modules including i18n provider, theme provider, backend axios calls (getSSHHosts, getUserPreferences, getActiveSessions, getUserInfo, getOpenTabs), dbHealthMonitor, terminal, guacamole, all sidebar panels, MobileBottomBar, CommandPalette, TransferMonitor. Mocking all of them creates a test whose signal is dominated by mock-drift noise rather than persistence-contract regressions. The MountManager scaffold at ~60 lines reproduces the load-bearing patch #35 mechanism VERBATIM and drives it via the REAL conversation-store, so Tests 1-3 assert the mechanism's invariants directly. Tests 4-6 (integration wiring) go to UAT in Plan 06-05. This split preserves the load-bearing correctness guard as a CI-runnable programmatic test while accepting that the AppShell-integration side is best validated via the UAT walk (which was going to happen anyway per Plan 06-05).
- **AppShell logic BEYOND the DOM-placement effect + createPortal loop + sync effects that needed adjustment:** the fit-on-active-change effect at line 442 needed its dep array extended to `[activeTabId, effectiveSelectedTabId]`. In practice this is defense-in-depth (activeTabId and effectiveSelectedTabId stay in sync via the mirror effect), but explicitly firing on both makes the terminal-fit path robust to any future re-ordering of the sync/mirror effect. NO other AppShell effects needed changes — URL-sync, document-title, tmux-session cleanup, tab-order sync, useKeyboardTabNav all continue to fire off `activeTabId` and remain correct because activeTabId mirrors selectedConversationId.
- **SettingsRow lives in its own file `src/ui/sidebar/SettingsRow.tsx`.** Plan 06-03 imports it as `import { SettingsRow } from "@/sidebar/SettingsRow"` — unambiguous path, no chance of confusion. NOTE-07 resolved.
- **realHostTree JSON-memoized before store.updateHostTree.** Plan-check NOTE-05 defense-in-depth. Simple, safe at Ashley's ~20-host scale.
- **ConversationsPanel props are OPTIONAL.** Gear icon renders only when onRailClick is provided. Panel remains render-in-isolation-friendly for unit tests.
- **Panel mounted with `hidden` class-toggle (not conditional-mount).** Keeps store subscriptions live across rail-view swaps — matters for Plan 06-04's deferred-select race defense.
- **SETTINGS_MENU_ITEMS includes ALL destinations the MobileBottomBar reached** (host-manager, credentials, connections, quick-connect, ssh-tools, snippets, history, split-screen, user-profile, admin-settings). Full parity with the old bottom-nav's More menu.

## Deviations from Plan

**None.** No auto-fixes, no auth gates, no architectural questions, no scope-fence violations, no test failures requiring iteration beyond the initial jsdom-subscribe-pattern refinement (which was a first-draft cleanup, not a bug — moved from require() to static import + used __subscribeForTest properly).

The plan was extremely well-shaped by 06-PLAN-CHECK's PASS_WITH_NOTES verdict. Every NOTE that applied to 06-02 (NOTE-04 tabNodesRef grep gate — the grep-count comparison approach worked cleanly here since the source file grep isn't the minified-bundle case that NOTE-04 flagged; NOTE-05 realHostTree thrash — proactively memoized; NOTE-07 SettingsRow file-vs-inline — chose new-file per planner recommendation; NOTE-08 persistence test fallback — invoked cleanly with the split documented) was proactively addressed.

**Zero deviations. Zero blockers. Zero architectural surprises.** Plan executed as written.

## Issues Encountered

None. Zero blockers.

## User Setup Required

None. Zero new npm dependencies, zero new environment variables, zero new files the user needs to create manually.

## Threat Flags

None. This plan operates within the LOCKED threat model — no new network endpoints, no new auth paths, no new file access patterns, no new schema changes at trust boundaries. Every mitigation the plan's `<threat_model>` block committed to was landed:

- **T-06-02-01 (mount lifecycle regression):** MITIGATED via the byte-for-byte preservation of the patch #35 mechanism + a programmatic guard (persistence smoke test Tests 1-3).
- **T-06-02-02 (URL-sync feedback loop):** MITIGATED — no second URL-sync effect introduced. The existing effect reads activeTabId; activeTabId mirrors selectedConversationId one-way; no feedback loop possible.
- **T-06-02-03 (tab-labels in URL):** ACCEPTED per plan (pre-existing surface, no Phase-6 new exposure).
- **T-06-02-04 (settings-surface authorization):** MITIGATED — the ConversationsPanel gear icon's admin-settings menu entry is admin-gated at the menu-render level (via `isAdmin` prop filter inside `renderSettingsMenuItems`), and AppShell's existing `railView === "admin-settings" && isAdmin && (<AdminSettingsPanel/>)` guard at line 1339 is UNCHANGED.
- **T-06-02-05 (URL-scheme collision under Plan 06-03):** MITIGATED — this plan does NOT introduce the `#conv=` or `#mv=` schemes (Plan 06-03 owns them). The `#tab=...&active=N` scheme is preserved verbatim.
- **T-06-02-SC (supply chain):** MITIGATED — zero new npm dependencies, `git diff package.json package-lock.json` is empty.

## Next Phase Readiness

**Ready for Plan 06-03 (mobile list-vs-view flow).**

Downstream notes for Plan 06-03's executor:

- **SettingsRow lives at `@/sidebar/SettingsRow`** — the import path Plan 06-03 needs is unambiguous: `import { SettingsRow } from "@/sidebar/SettingsRow"`. The `renderSettingsMenuItems` helper is also exported from the same file if 06-03 needs to compose the menu into a different chrome shape.
- **SettingsRow requires `onRailClick` and `isAdmin` props.** Same signature as ConversationsPanel's optional props. 06-03 wires them via `<SettingsRow onRailClick={handleRailClick} isAdmin={isAdmin} />`. Ashley expects the mobile row to route to the same destinations as the desktop gear (parity with the pre-Phase-6 MobileBottomBar destinations).
- **ConversationsPanel's `onRailClick`/`isAdmin` props are OPTIONAL.** 06-03 mounting SettingsRow inside the ConversationsPanel scroller on mobile viewports should not conflict — SettingsRow is a separate component consumed by AppShell's mobile branch (not ConversationsPanel's internals). If 06-03 chooses to pass SettingsRow as a child slot into ConversationsPanel (planner discretion per shape), extend ConversationsPanel with an optional `settingsRowSlot?: React.ReactNode` prop.
- **The ConversationsPanel is mounted-always (via `hidden` class-toggle) rather than conditional-mount.** This means its store subscriptions stay LIVE across rail-view swaps. 06-03's mobile flow can rely on `useSelectedConversationId()` being subscribed continuously — no need to re-mount to re-subscribe.
- **`useIsTouchDevice()` at AppShell.tsx line 241 is UNCHANGED.** 06-03's mobile-vs-desktop signal is the same hook 06-02 preserved.

**Ready for Plan 06-04 (new-session button + race defense) too.**

Downstream notes for Plan 06-04's executor:

- **The store's `selectConversation` guard is at conversation-store.ts lines 285-295** (T-06-01-01 stale-selection defense). Plan 06-04 needs to insert `pendingSelectId = null` **AFTER** the stale-id guard (line 294 return) but **BEFORE** the state mutation on line 296 (`state = { ...state, selectedId: id }`). Per plan-check NOTE-03, the plan itself first-drafted "at the top of selectConversation" then re-decided the correct placement; the store's guards are clearly commented so the insertion is straight-line.
- **AppShell's store→AppShell mirror effect at AppShell.tsx (around old-line 393 area) only fires when the id EXISTS in tabs.** This means Plan 06-04's `selectConversationDeferred(newTabId)` inside `onCreateSession` will correctly NO-OP the mirror until the newly-added tab arrives in the tabs state (React batches the setTabs, so `tabs.some(t => t.id === selectedConversationId)` returns false on the first render); on the next render after the batched setTabs commits, `updateOpenTabs(tabs)` fires, the store's pendingSelectId flushes, selectedConversationId becomes the new tab, and the mirror effect at last runs. Race handled.
- **`realHostTree` is JSON-memoized before passing to `updateHostTree`.** This is Plan 06-02's NOTE-05 defense-in-depth. If Plan 06-04 needs to trigger a host-tree refresh (e.g. after a new host is added in the picker), it should still call the existing `loadHosts()` at AppShell.tsx line 510 — the memoization only elides content-equal re-emissions, not real new-host additions.
- **ConversationsPanel's `<div className="shrink-0">` header slot is NOW OCCUPIED by the gear icon** (when onRailClick is provided, which AppShell always provides). Plan 06-04's NewSessionButton should be inserted inside the `flex-1 min-h-0 overflow-y-auto` scroll region, ABOVE the pinned section render — that's a Plan-06-04-owned edit to ConversationsPanel.tsx. The button-before-rows DOM order that 06-04's Test 10 asserts still holds because the pinned section is emitted after the button in the scroller.

**Ready for Plan 06-05 (deploy checkpoint).**

Downstream notes for Plan 06-05's executor:

- **UAT walk items for Tests 4-6 (deferred from Plan 06-02 Task 2):** the UAT checklist should explicitly cover:
  1. Selecting a conversation updates `document.title` to the conversation's label (matches Plan 06-02 Test 4 semantics).
  2. Selecting a nonexistent conversation id (e.g. via a stale bookmark) does NOT change the visible view or the URL fragment (matches Plan 06-02 Test 5).
  3. Selecting a conversation updates the URL fragment `#tab=...&active=N` to reflect the new index (matches Plan 06-02 Test 6 — patch #25's Chrome-window-restore contract).
  4. Selecting conversation A, scrolling in a pretty-view pane, selecting B, then selecting A back — the scroll position is preserved (the ultimate end-to-end proof of the T-06-02-01 mitigation).
- **The tabNodesRef grep-gate for dist bytes (NOTE-04):** since Vite minification may mangle `tabNodesRef`, Plan 06-05's grep gate should look for a more distinctive marker. Suggested: `grep -c 'appendChild' dist/assets/*.js` combined with `grep -c 'ConversationsPanel' dist/assets/*.js ≥ 1`. This plan does not need to fix the gate itself — 06-05 owns that.
- **No deploy this plan.** Plan 06-05 is the deploy checkpoint. The tab strip is gone, ConversationsPanel is wired, TG-05 persistence is proven — but nothing in this plan runs `docker compose ... up`. Per the plan's `<hard_constraints>` NO DEPLOY, no deadman armed, no `/opt/skynet/docker-compose.yml` edit.

## Self-Check: PASSED

**File existence:**
- `src/ui/AppShell.tsx` — MODIFIED (166 insertions, 74 deletions net)
- `src/ui/sidebar/AppRail.tsx` — MODIFIED (+8 lines)
- `src/ui/sidebar/ConversationsPanel.tsx` — MODIFIED (+82 / -13)
- `src/ui/sidebar/SettingsRow.tsx` — CREATED (198 lines)
- `src/ui/AppShell.persistence.test.tsx` — CREATED (383 lines)
- `src/ui/locales/en.json` — MODIFIED (+13 / -1)
- `src/ui/shell/TabBar.tsx` — DELETED (was 620 lines)

**Commit existence:**
- `d70ef63` (feat(phase-6): atomic swap — delete TabBar, wire ConversationsPanel) — FOUND in `git log --oneline -3`
- `75338e8` (test(phase-6): persistence-contract smoke test — T-06-02-01 defense) — FOUND in `git log --oneline -3`

**Grep-checkable acceptance criteria bundle:**
- TabBar.tsx deleted (ls returns No-such-file) ✓
- Zero @/shell/TabBar imports (0) ✓
- Zero TabBar imports (0, excluding test files) ✓
- ConversationsPanel in AppShell (5 hits — import + JSX) ✓
- conversation-store imports (10) ✓
- AppRail conversations (2 — RailView + button entry) ✓
- Default RailView "conversations" (1) ✓
- onRailClick in ConversationsPanel (6) ✓
- SettingsRow + renderSettingsMenuItems (5 in SettingsRow, 4 in Panel) ✓
- tabNodesRef mechanism intact (13 post vs 12 pre; +1 is explanatory comment) ✓
- Persistence test file exists ✓
- Reference-equality assertions present (4) ✓
- Test does NOT mock conversation-store (0 hits) ✓

**Test suite:**
- `npx vitest run src/ui/AppShell.persistence.test.tsx` = 3/3 passing ✓
- `npx vitest run --project frontend` (full frontend suite) = 272/272 passing across 22 files ✓

**Type-check:**
- `npx tsc --noEmit --skipLibCheck` project-wide = zero errors ✓

**Scope-fence structural checks (post-plan):**
- No changes under `src/ui/features/pretty-view/` ✓
- No changes to `src/ui/features/terminal/Terminal.tsx` ✓
- No changes under `src/ui/features/guacamole/` ✓
- No changes under `src/backend/` ✓
- No changes under `docker/` ✓
- No changes to `package.json` / `package-lock.json` ✓

---
*Phase: 06-telegram-like-interface*
*Completed: 2026-07-21*
