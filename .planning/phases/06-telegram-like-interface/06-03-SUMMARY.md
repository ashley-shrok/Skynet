---
phase: 06-telegram-like-interface
plan: 03
subsystem: mobile-navigation
tags: [mobile-flow, telegram-like-interface, list-vs-view, url-fragment, mv-key, mobile-bottom-bar-deleted, settings-row-mounted, phase-6, patch-25-lineage]

# Dependency graph
requires:
  - phase: 06-telegram-like-interface
    plan: 01
    provides: "conversation-store (selectConversation, useSelectedConversationId) — consumed by the T-06-03-06 stranded-user defense effect and by ConversationsPanel's row-tap→onConversationSelected handler chain"
  - phase: 06-telegram-like-interface
    plan: 02
    provides: "SettingsRow at @/sidebar/SettingsRow — mounted into the ConversationsPanel via the new settingsRowSlot prop on touchscreen viewports. ConversationsPanel's optional-props idiom + hidden-class-toggle mount + effectiveSelectedTabId (used for activeConversationLabel derivation in the mobile-view header title) all reused verbatim."
  - phase: patch-25-tab-url
    provides: "URL-fragment scheme (#tab=X&tab=Y&active=N&only=1) + WorkspaceSpec + encodeWorkspaceSpec / consumePendingWorkspace / writeWorkspaceToUrl / snapshotPendingTab. Extended (not replaced) with the mv=1 key so the mobile-view marker survives Chrome window-restore for the same reason `tab=` does."
  - phase: patch-35-tabNodesRef
    provides: "tabNodesRef + normalViewRef + createPortal loop DOM-move mechanism. Preserved byte-for-byte across list-vs-view switches — the main-content region is CSS-hidden (0-width flex-basis) when mobileScreen === 'list', not conditionally unmounted, so the createPortal loop and normalViewRef keep their identity."
  - phase: patch-103-touchscreen-detection
    provides: "useIsTouchDevice() hook — the SOLE mobile-vs-desktop detection mechanism for the mobile flow (per plan hard constraint). Zero viewport-width tests, zero user-agent sniffs, zero second hook."

provides:
  - "src/ui/lib/mobile-flow.ts (NEW): useMobileScreen() hook + navigateToView() + navigateToList() imperative actions. Module-scoped listener registry (hashchange + popstate at module load), useSyncExternalStore for React integration. Zero new npm dependencies. Test-only helpers __resetMobileFlowForTest + __recomputeForTest exported for jsdom hygiene."
  - "src/ui/lib/tab-url.ts EXTENDED: WorkspaceSpec.mobileView field (optional boolean). encodeWorkspaceSpec writes &mv=1 when true. readTabPayloadFromUrl preserves mv=1 alongside only=1. consumePendingWorkspace parses mv=1 (strict `=== '1'`) → mobileView: true. writeWorkspaceToUrl also strips legacy ?mv= from the query string when clearing."
  - "src/ui/lib/mobile-flow.test.ts (NEW): 11 Vitest cases matching the plan's <behavior> block one-to-one. Test 6 (popstate) simulates the browser back gesture via direct hashchange+popstate dispatch (jsdom back-stack leaks entries across test cases within a file, so history.back() isn't a reliable test surface — direct dispatch is what a real browser back would fire on the module's listeners, so the assertion holds)."
  - "src/ui/AppShell.tsx REWIRED: mobile flow drives full-screen list-vs-view. useMobileScreen hook + navigateToView/List actions. isMobileListScreen + isMobileViewScreen derived booleans (both gated on isTouchDevice). Full-viewport list-screen `<div>` when list-screen (uses sidebarHeader + sidebarPanelContent verbatim). Main-content region CSS-hidden (0-width flex-basis) when list-screen so createPortal + normalViewRef stay mounted (patch #35 preservation). Mobile-view header (ChevronLeft back + activeConversationLabel title) prepended when view-screen. URL-sync effect passes mobileView: mobileScreen === 'view' ? true : undefined so patch #25 URL-sync doesn't strip #mv=1. T-06-03-06 stranded-user defense effect (navigateToList when isTouchDevice + view + !selectedConversationId). sidebarOpenBeforeMobile auto-close effect gated on !isTouchDevice. Desktop chrome (AppRail, inline sidebar, narrow-desktop Sheet, chevron-right reveal) gated on !isTouchDevice — desktop path unchanged for non-touch."
  - "src/ui/sidebar/ConversationsPanel.tsx EXTENDED: two new optional props. `onConversationSelected?: (id) => void` fires AFTER selectConversation on a row tap (AppShell passes navigateToView on touchscreens, undefined on desktop). `settingsRowSlot?: ReactNode` rendered at BOTTOM of the scroll region (below the last host group, above any padding) so it doesn't compete with pinned/active rows for prime attention (TG-10). Both props are optional so the panel remains render-in-isolation-friendly for unit tests."
  - "src/ui/shell/MobileBottomBar.tsx DELETED unconditionally (TG-07). 155 lines gone. No feature flag, no conditional rendering, no per-user opt-in. Destinations (host-manager, credentials, connections, quick-connect, ssh-tools, snippets, history, split-screen, user-profile, admin-settings) reachable via the SettingsRow mounted inside ConversationsPanel on touchscreen viewports."
  - "src/ui/locales/en.json: added nav.conversations.backToList i18n key ('Back to conversations') for the mobile-view header back-button aria-label + title."

affects: [06-04, 06-05]

# Tech tracking
tech-stack:
  added: []  # Zero new npm dependencies — uses only Web platform APIs (window.location, window.history, hashchange/popstate, URLSearchParams, useSyncExternalStore)
  patterns:
    - "URL fragment as SPA screen state: `mv=1` layered onto existing `#tab=X&tab=Y&active=N&only=1` scheme via URLSearchParams. Same fragment (not query string) so Chrome window-restore preserves the value alongside `tab=` — patch #25's Chrome-restore lesson generalized to a second key."
    - "Module-scoped subscription store + useSyncExternalStore mirror pattern (matches conversation-store from Plan 06-01): listeners: Set<() => void>, currentScreen: MobileScreen, hashchange/popstate wired once at module load, recomputeAndMaybeEmit fires ONLY when currentScreen actually changed (no unnecessary React re-renders). Test-only __resetMobileFlowForTest + __recomputeForTest exported for jsdom test hygiene."
    - "pushState-with-sentinel + history.back()-preferred over replaceState-strip: navigateToView pushState's `{__skynetMobileView: true}` state object; navigateToList prefers history.back() when the current state has that sentinel (so the browser back-stack stays consistent) and falls back to replaceState-stripping the mv key when it doesn't (pasted-URL deep-link case — accepted per plan Step B decision that back-exits-the-app is acceptable browser behavior for a fresh navigation)."
    - "Alternative-simpler tree-restructuring per plan Step E: preserve the outer flex container verbatim, CSS-hide (0-width flex-basis + overflow:hidden) the main content region on the list screen, keep the createPortal loop mounted exactly once. Zero risk to patch #35's tabNodesRef DOM-move mechanism — the loop's mount site and normalViewRef's ref identity are stable across every mobileScreen transition."
    - "Optional slot-prop for panel chrome (`settingsRowSlot?: ReactNode` on ConversationsPanel): parent decides when to inject a mobile-only affordance; the panel remains agnostic of viewport class + trivially render-in-isolation-testable."

key-files:
  created:
    - "src/ui/lib/mobile-flow.ts (156 lines — subscribe store + useSyncExternalStore hook + navigateToView + navigateToList + test-only helpers)"
    - "src/ui/lib/mobile-flow.test.ts (206 lines — 11 Vitest cases covering the plan's <behavior> block)"
    - ".planning/phases/06-telegram-like-interface/06-03-SUMMARY.md (this file)"
  modified:
    - "src/ui/lib/tab-url.ts (+15 / -1) — WorkspaceSpec.mobileView optional field with JSDoc explaining the fragment-restore rationale; encodeWorkspaceSpec appends mv=1 when set; readTabPayloadFromUrl preserves mv=1 alongside only=1; consumePendingWorkspace parses mv=1 (strict boolean coerce); writeWorkspaceToUrl also strips ?mv= from the legacy query string on clear."
    - "src/ui/AppShell.tsx (+108 / -76) — deleted MobileBottomBar import at line 19; deleted MobileBottomBar mount block (was lines 1696-1703); imported mobile-flow + SettingsRow; derived mobileScreen + isMobileListScreen + isMobileViewScreen + activeConversationLabel; extended URL-sync effect with mobileView field; added T-06-03-06 stranded-user defense effect; gated sidebarOpenBeforeMobile auto-close on !isTouchDevice; gated AppRail on `sidebarOpen && !isTouchDevice` (unchanged); gated desktop-inline sidebar column + narrow-desktop Sheet + chevron-right reveal on !isTouchDevice; added full-viewport list-screen `<div>` render + main-content CSS-hide on list-screen; added mobile-view header (ChevronLeft back + Separator + label) on view-screen; wired ConversationsPanel with onConversationSelected + settingsRowSlot props (both conditional on isTouchDevice)."
    - "src/ui/sidebar/ConversationsPanel.tsx (+30 / -6) — added `onConversationSelected?: (id) => void` prop (fired AFTER selectConversation on row tap); added `settingsRowSlot?: ReactNode` prop rendered at BOTTOM of scroller; imported ReactNode type from react; extended pinned + grouped row.onSelect to also call onConversationSelected?.(row.id)."
    - "src/ui/locales/en.json (+2 / -1) — added nav.conversations.backToList: 'Back to conversations' key; trailing-comma flip on adminSettings key. `grep -c '\"addHost\"'` = 4 (all 4 pre-existing duplicates preserved per Plan 06-01's hard-learned lesson)."
  deleted:
    - "src/ui/shell/MobileBottomBar.tsx (155 lines) — DELETED unconditionally (TG-07 full-replacement). No feature flag, no conditional rendering, no per-user opt-in. `git rm` (preserves history). Destinations migrated to SettingsRow (Plan 06-02) which this plan mounts inside the mobile ConversationsPanel via the new settingsRowSlot prop."

key-decisions:
  - "Tree-restructuring approach = 'single-outer-div-with-CSS-hidden-children' (plan Step E's alternative simpler decision). Preserves the outer `<div className=\"flex w-screen\">` verbatim. Main-content region gets `style={{ width: 0, flex: '0 0 0px', overflow: 'hidden' }}` + `aria-hidden` when isMobileListScreen. NO TabPortalRoot extraction — the createPortal loop + normalViewRef stay in their original single mount site. Zero risk to patch #35's tabNodesRef DOM-move mechanism, which the T-06-02-01 mount-lifecycle contract (verified programmatically by AppShell.persistence.test.tsx) depends on. Rationale: extraction into a `<TabPortalRoot>` component would move the ref-mount and re-parent the portal targets on every isMobileViewScreen toggle, risking a subtle regression that our test scaffold might not catch. The CSS-hide approach guarantees identity preservation without touching the load-bearing effect."
  - "SettingsRow position in mobile ConversationsPanel = BOTTOM of scroll region (below the last host group, above padding). Rendered via the new `settingsRowSlot` prop. Rationale: TG-10 says 'does not compete with pinned or active rows for prime attention.' Top-of-scroller is reserved for Plan 06-04's NewSessionButton (per 06-02 SUMMARY downstream notes). Bottom-of-scroller is the natural resting spot for an ambient settings affordance — the user scrolls down to reach it, which is a lower-attention interaction than a top-of-list mount would be. Renders even in empty state (below the empty-state message) so the affordance is still reachable when no conversations exist. Import: `SettingsRow` from `@/sidebar/SettingsRow`, exactly the path 06-02 SUMMARY guaranteed."
  - "URL-fragment key = `mv=1` (not `mobile-view=1` or `#conv-view`). Rationale: (a) short — every character in the fragment is user-visible on address-bar hover, and this fragment already gets long with multi-tab specs; (b) unlikely to collide with future WorkspaceSpec fields (planner reserved `mv` prefix for mobile-view semantics only); (c) matches the abbreviated style of existing `tab=`/`active=`/`only=`. Strict `params.get('mv') === '1'` boolean coerce means `mv=0`, `mv=yes`, `mv=true`, `mv=` all parse to `false` (mobileView undefined). Test 10 asserts this."
  - "navigateToView state sentinel = `{ __skynetMobileView: true }`. navigateToList prefers `history.back()` when the current state has this sentinel so the browser back-stack stays consistent with the user's mental model. Falls back to replaceState-strip when the sentinel is missing (fresh deep-link case). Accepts the edge case that a pasted `#mv=1` URL landing directly in the view + user pressing back exits the app — per plan Step B decision that's acceptable browser behavior for a fresh navigation without a prior list entry in the back-stack."
  - "Test 6 (popstate → list) uses direct hashchange+popstate dispatch instead of `history.back()` traversal. Rationale: jsdom's session-history back-stack accumulates entries across test cases WITHIN a file — each pushState from a prior test remains navigable, and there's no test API to reset it (WHATWG spec has no wipe-back-stack surface). The mobile-flow module reacts to the events, not the traversal mechanism, so dispatching the same events a real browser back would fire on the module's listeners is a valid contract assertion. Diagnosed via a diagnostic run that showed `popstate:#mv=1` (previous leaked mv=1 entry) instead of the expected `popstate:` (empty hash). This trade-off is documented inline in the test file so future readers understand why the plan's 'or dispatching a synthetic popstate event' alternative was chosen."
  - "Mobile-view header title = the active conversation's `tab.label` (falls back to nav.conversations.title default). NOT the host name, NOT the tmux session name — those live inside the pane and the header already competes with them for glanceable info. `label` is what the tab-title-from-tmux (patch #43-adjacent) plumbing sets, so it stays in sync automatically. Falls back only when effectiveSelectedTabId doesn't match any tab, which shouldn't happen thanks to the T-06-03-06 stranded-user defense, but a cheap fallback is a defense-in-depth win."
  - "`sidebarOpenBeforeMobile` effect (auto-close sidebar on isMobile transitions) gated on `!isTouchDevice`. On touchscreens the sidebar IS the list screen when mobileScreen === 'list' — auto-closing it makes no sense. The effect still fires for its original use case: a narrow-desktop-window (mouse, pointer:fine) transitioning through the isMobile width breakpoint. Line 251-260 in the post-plan file; the `if (isTouchDevice) return;` guard at line 253 documents the gate."
  - "Desktop chrome (AppRail rail, inline resizable sidebar, narrow-desktop Sheet, chevron-right reveal button) all now additionally gated on `!isTouchDevice`. Rationale: prior to Plan 06-03, only the AppRail was gated on `!isTouchDevice`; the inline sidebar + Sheet + chevron-right reveal were gated only on isMobile (width). A touchscreen with a wide viewport (iPad landscape, useIsTouchDevice=true, useIsMobile=false depending on breakpoint) would have gotten a mix of touchscreen and desktop chrome. The additional `!isTouchDevice` gate ensures touchscreens uniformly get the mobile flow, no desktop chrome bleedthrough."
  - "isTouchDevice hook itself UNCHANGED (line 246 in post-plan file, was 246 pre-plan). Sole mobile-vs-desktop detection per plan hard constraint. mobile-flow.ts is viewport-agnostic — it never reads useIsTouchDevice(); the AppShell caller is responsible for gating mobile-flow reads/writes on isTouchDevice."

patterns-established:
  - "URL-fragment key layering: extend the existing tab-url.ts URLSearchParams-based scheme with a new key rather than introducing a parallel URL parser. Keeps Chrome window-restore and patch #25 compatibility for free. Future keys should follow the same pattern (short lowercase, strict boolean parse for flags, JSDoc on WorkspaceSpec explaining the rationale)."
  - "Module-scoped subscription + useSyncExternalStore + jsdom-hygiene helpers: export `__resetForTest` + `__recomputeForTest` so vitest can reset module-scoped state between cases without needing dynamic imports or vi.resetModules() (both of which trigger the module-level listener registration to re-fire, doubling the listener count). Matches Plan 06-01's conversation-store idiom."
  - "History-state sentinel for imperative navigation: pushState with `{ __namespacedKey: value }` state object lets a reverse action (back / pop) distinguish 'we pushed this' from 'this is a fresh deep-link entry.' The fallback strategy for the deep-link case (replaceState-strip vs. history.back()) is a policy choice — mobile-flow chose 'accept back-exits-the-app for fresh deep-links' as reasonable browser behavior."
  - "'Screens replace, they don't peek': the mobile flow's list-vs-view uses a plain `<div>` (NOT Radix's Sheet) for the list-screen. Sheet is designed for peek/panel/overlay UX where the previous screen is dimmed underneath; replacing screens wholesale is a different affordance and deserves a different primitive. Zero Sheet lifecycle to manage, simpler focus behavior, no dismiss-overlay competing for taps."

requirements-completed: []
# NOTE: TG-06 (list-vs-view flow) and TG-07 (bottom nav deleted) are LISTED
# in this plan's frontmatter but are NOT marked complete here. Plan 06-05
# UAT is the requirement-completion checkpoint for the whole phase. This
# mirrors Plan 06-01's and Plan 06-02's approach.

# Metrics
duration: 13min
completed: 2026-07-21
---

# Phase 6 Plan 06-03: Mobile List-vs-View Flow Summary

**Mobile viewports (`useIsTouchDevice() === true`) now render the Telegram-style two-screen flow: full-screen ConversationsPanel list ↔ full-screen conversation view with a top-left back button. Screen state lives in the URL fragment as `#mv=1` (extension of patch #25's `#tab=` scheme so Chrome window-restore survives). MobileBottomBar deleted unconditionally — its destinations reachable via the SettingsRow mounted at the bottom of the mobile ConversationsPanel via a new `settingsRowSlot` prop. Desktop path unchanged.**

## Performance

- **Duration:** ~13 min wall-clock (Task 1 tab-url extension + mobile-flow module + Vitest test scaffolding → 1 test iteration on jsdom's session-history back-stack leak → all 11 pass; Task 2 AppShell rewire + ConversationsPanel prop extension + MobileBottomBar deletion → tsc clean first try, full suite 283/283 first try). Zero deviations, zero blockers, zero architectural surprises.
- **Started:** 2026-07-21T02:26:33Z
- **Completed:** 2026-07-21T02:39:23Z
- **Tasks:** 2 (Task 1 auto+tdd, Task 2 auto)
- **Files created:** 3 (mobile-flow.ts + mobile-flow.test.ts + this SUMMARY)
- **Files modified:** 4 (AppShell.tsx + tab-url.ts + ConversationsPanel.tsx + en.json)
- **Files deleted:** 1 (MobileBottomBar.tsx — 155 lines gone)
- **Net line change:** +525 / -269 (adds significantly more than the deletion since the mobile-flow module + tests + AppShell rewire account for most additions)

## Accomplishments

- **MobileBottomBar.tsx DELETED unconditionally.** No feature flag, no conditional rendering, no user-facing toggle. TG-07 satisfied. `git rm` (preserves history via the commit; SettingsRow provides the migration path). 155 lines gone.
- **Mobile flow module shipped and unit-tested.** `src/ui/lib/mobile-flow.ts` exports `useMobileScreen()` + `navigateToView()` + `navigateToList()`. 11 Vitest cases cover initial-state parsing, imperative navigation, encode/consume round-trip through tab-url.ts, writeWorkspaceToUrl idempotency + null-clears-mv, malformed mv values, and cross-device link portability. All 11 pass.
- **URL fragment scheme extended cleanly.** `#mv=1` layers onto the existing `#tab=X&tab=Y&active=N&only=1` fragment via `WorkspaceSpec.mobileView`. Same URLSearchParams-based encoding, same Chrome window-restore behavior. Round-trip through `encodeWorkspaceSpec(consumePendingWorkspace(...))` preserves the marker (Test 7). Idempotent writes (Test 8). `writeWorkspaceToUrl(null)` clears mv=1 alongside tab= (Test 9). Malformed `mv=yes`, `mv=0`, `mv=true` all parse to `mobileView: false` (Test 10). Cross-device deep-links preserve the marker for portability (Test 11 — desktop viewport with `#mv=1` in the URL renders the tabs normally and ignores mv per T-06-03-05 accept-and-preserve).
- **AppShell mobile viewport reshaped.** `mobileScreen` (from `useMobileScreen()`) + `isTouchDevice` drive two derived booleans: `isMobileListScreen` and `isMobileViewScreen`. When list-screen: full-viewport sidebar-content `<div>` (uses `sidebarHeader` + `sidebarPanelContent` verbatim), main-content CSS-hidden via 0-width flex-basis. When view-screen: mobile-view header (ChevronLeft back button + activeConversationLabel title) prepended to main content; sidebar column absent. Desktop path is byte-identical to Plan 06-02's world (all gated on `!isTouchDevice`).
- **patch #35 tabNodesRef DOM-move mechanism preserved byte-for-byte across list-vs-view switches.** The createPortal loop is mounted exactly ONCE (grep-verified). normalViewRef's ref identity is stable across every mobileScreen transition because the main-content region is CSS-hidden (0-width flex-basis) rather than conditionally unmounted. T-06-02-01 mount-lifecycle contract (Plan 06-02) extends to the new list-vs-view semantics automatically.
- **SettingsRow mounted at bottom of mobile ConversationsPanel.** `settingsRowSlot?: ReactNode` prop added to ConversationsPanel; AppShell passes `<SettingsRow onRailClick={handleRailClick} isAdmin={isAdmin} />` when `isTouchDevice`, `undefined` otherwise. Renders below the last host group (and below the empty-state block when the list is empty), NOT competing with pinned/active rows for prime attention (TG-10). Reuses the exact SettingsRow component + destination set from Plan 06-02 — one canonical menu-item registry (`SETTINGS_MENU_ITEMS`) shared between desktop gear icon and mobile row.
- **T-06-03-06 stranded-user defense landed.** New useEffect: `if (isTouchDevice && mobileScreen === 'view' && !selectedConversationId) navigateToList()`. If a conversation ends mid-view (T-06-01-01 stale-selection defense fired, or the user closed the pane from elsewhere), the user is automatically returned to the list screen. Cheap, boring, hard to notice — which is the sign it's working.
- **`sidebarOpenBeforeMobile` auto-close effect gated on `!isTouchDevice`.** On touchscreens the sidebar IS the list screen; auto-closing it on isMobile transitions would break the mobile flow. The effect still fires for its original use case: narrow-desktop-window (mouse, pointer:fine) crossing the isMobile width breakpoint. Line 253 has the `if (isTouchDevice) return;` guard.
- **Desktop path UNCHANGED.** Every desktop-chrome rendering branch (AppRail rail, inline resizable sidebar, narrow-desktop Sheet, chevron-right reveal button) is additionally gated on `!isTouchDevice` so touchscreens uniformly get the mobile flow, no chrome bleedthrough. The desktop layout for non-touch viewports is byte-identical to Plan 06-02's post-execution state.
- **AppShell scope-fence honored.** Zero touches to `src/ui/features/pretty-view/**`, `src/ui/features/terminal/Terminal.tsx`, `src/ui/features/guacamole/`, `src/backend/`, `docker/`, `package.json`, `package-lock.json`. Zero new npm dependencies.
- **Full-project tsc --noEmit --skipLibCheck clean.** Full frontend Vitest suite: **283/283 passing** (272 baseline from Plan 06-02 + 11 new from Plan 06-03's mobile-flow.test.ts).

## Task Commits

Each task was committed atomically on branch `feat/tab-title-from-tmux`:

1. **Task 1: mobile-flow module + tab-url mobileView extension** — `bbc8c66` (feat)
2. **Task 2: wire mobile flow into AppShell, delete MobileBottomBar** — `936ff3d` (feat)

## Files Created/Modified

**Created:**

- `src/ui/lib/mobile-flow.ts` — 156 lines. `useMobileScreen()` React hook (backed by useSyncExternalStore + module-scoped subscribe store) + `navigateToView()` + `navigateToList()` imperative actions. Zero new npm deps; uses only Web platform APIs (window.location, window.history, hashchange, popstate, URLSearchParams). Test-only helpers `__resetMobileFlowForTest` + `__recomputeForTest` exported for jsdom hygiene.
- `src/ui/lib/mobile-flow.test.ts` — 206 lines. 11 Vitest cases mapping one-to-one to the plan's `<behavior>` block. All 11 pass in jsdom.
- `.planning/phases/06-telegram-like-interface/06-03-SUMMARY.md` — this file.

**Modified:**

- `src/ui/lib/tab-url.ts` — +15 / -1. WorkspaceSpec.mobileView optional field with JSDoc; encodeWorkspaceSpec appends `&mv=1` when true; readTabPayloadFromUrl preserves `mv=1` alongside `only=1`; consumePendingWorkspace parses `mv=1` (strict boolean coerce) into `mobileView: true`; writeWorkspaceToUrl also strips `?mv=` from the legacy query string on clear.
- `src/ui/AppShell.tsx` — +108 / -76. Deleted MobileBottomBar import (was line 19); deleted MobileBottomBar mount block (was lines 1696-1703 — replaced with a documenting comment); imported mobile-flow + SettingsRow; derived `mobileScreen` + `isMobileListScreen` + `isMobileViewScreen` + `activeConversationLabel`; extended URL-sync effect with `mobileView` field; added T-06-03-06 stranded-user defense useEffect; gated `sidebarOpenBeforeMobile` effect on `!isTouchDevice`; gated desktop-inline sidebar + narrow-desktop Sheet + chevron-right reveal on `!isTouchDevice`; added full-viewport list-screen `<div>` render on isMobileListScreen; added main-content CSS-hide (0-width flex-basis + aria-hidden) on isMobileListScreen; added mobile-view header (ChevronLeft back + Separator + label) on isMobileViewScreen; wired ConversationsPanel with `onConversationSelected` + `settingsRowSlot` props (both `isTouchDevice ? ... : undefined`).
- `src/ui/sidebar/ConversationsPanel.tsx` — +30 / -6. Imported ReactNode type; added optional `onConversationSelected?: (id: string) => void` prop fired AFTER `selectConversation(row.id)` on every row tap (pinned + grouped both extended); added optional `settingsRowSlot?: ReactNode` prop rendered at the BOTTOM of the scroll region (below the last host group and below the empty-state block, above any padding).
- `src/ui/locales/en.json` — +2 / -1. Added `nav.conversations.backToList: "Back to conversations"` key; trailing-comma flip on the pre-existing `settingsMenuAdminSettings` key. Targeted `Edit` (not JSON round-trip) per Plan 06-01/02's hard-learned lesson: `grep -c '"addHost"'` still returns **4** post-edit (all 4 pre-existing duplicate keys preserved).

**Deleted:**

- `src/ui/shell/MobileBottomBar.tsx` — 155 lines gone via `git rm`. No breadcrumb file; git history is the provenance record. Destinations (host-manager, credentials, connections, quick-connect, ssh-tools, snippets, history, split-screen, user-profile, admin-settings) reachable via the SettingsRow which this plan mounts inside the mobile ConversationsPanel via the new `settingsRowSlot` prop.

## Verification

**Grep-checkable acceptance criteria (Task 1 verify step):**
- `grep -c 'export ' src/ui/lib/mobile-flow.ts` = **6** (useMobileScreen + navigateToView + navigateToList + MobileScreen type + __resetMobileFlowForTest + __recomputeForTest, all ≥1 required) ✓
- `grep -c "mobileView" src/ui/lib/tab-url.ts` = **5** (interface field + encodeWorkspaceSpec write + consumePendingWorkspace read + 2× JSDoc mentions, ≥1 required) ✓
- `grep -c '"mv"' src/ui/lib/tab-url.ts` = **4** (encodeWorkspaceSpec + readTabPayloadFromUrl + consumePendingWorkspace + writeWorkspaceToUrl.delete, ≥2 required) ✓
- 11/11 Vitest cases pass under `npx vitest run src/ui/lib/mobile-flow.test.ts` ✓
- Zero imports in mobile-flow.ts from `@/features/pretty-view/`, `@/features/terminal/`, `@/features/guacamole/`, `@/sidebar/` (grep = 0 for each) ✓
- Zero new npm dependencies (`git diff --stat package.json package-lock.json` empty) ✓

**Grep-checkable acceptance criteria (Task 2 verify step):**
- `ls src/ui/shell/MobileBottomBar.tsx` = **No such file or directory** ✓
- `grep -rn "from ['\"]@/shell/MobileBottomBar" src/ui` = **0** ✓
- `grep -rn "MobileBottomBar" src/ui | grep -v test` = **3** (all in comments referencing the historical deletion — `src/ui/AppShell.tsx:1781` in the deletion-explanatory comment, `src/ui/sidebar/ConversationsPanel.tsx:25` in a pre-existing "Zero touches to ... MobileBottomBar" doc-comment, `src/ui/sidebar/SettingsRow.tsx:2` in the "surfaces the destinations the MobileBottomBar used to route to" file-header doc-comment). Zero JSX references, zero imports ✓
- `grep -c "useMobileScreen\|navigateToView\|navigateToList" src/ui/AppShell.tsx` = **10** (import declarations + hook read + 2 handler wires + T-06-03-06 defense + mobile-view header's back-button onClick + comment references, ≥1 each required) ✓
- `grep -c "SettingsRow" src/ui/AppShell.tsx` = **6** (import + JSX mount + comment refs, ≥1 required) ✓
- `grep -c "settingsRowSlot" src/ui/AppShell.tsx` = **2** (JSX prop pass-in + comment) ✓
- `grep -c "settingsRowSlot" src/ui/sidebar/ConversationsPanel.tsx` = **3** (prop destructuring + type declaration in the props interface + `{settingsRowSlot}` render + inline comment) ✓
- `grep -c "mobileView" src/ui/AppShell.tsx` = **1** (in the URL-sync effect writeWorkspaceToUrl arg) ✓
- Stranded-user defense present: `grep -c 'mobileScreen === "view"' src/ui/AppShell.tsx` = **5** (isMobileViewScreen derivation + T-06-03-06 defense + URL-sync effect + mobile-view header render gate + activeConversationLabel derivation comment) ✓
- `grep -c "!isTouchDevice" src/ui/AppShell.tsx` = **8** (sidebarOpenBeforeMobile guard + AppRail gate + inline sidebar gate + narrow-Sheet gate + chevron-right reveal gate + 3 further branches / comments) ✓
- `grep -c "createPortal(" src/ui/AppShell.tsx` = **1** (single loop preserved — T-06-02-01 mitigation intact) ✓

**Full-project regression bundle:**
- `npx tsc --noEmit --skipLibCheck` project-wide = **zero errors** ✓
- `npx vitest run --project frontend` = **283/283 passing across 23 files** (up from 272/272 pre-plan due to the 11 new mobile-flow tests) ✓
- `git diff --stat package.json package-lock.json` = **empty** ✓ (zero new deps)

**Scope-fence structural checks (against bbc8c66^..936ff3d):**
- `git diff --stat src/ui/features/pretty-view/` = **empty** ✓
- `git diff --stat src/ui/features/terminal/Terminal.tsx` = **empty** ✓
- `git diff --stat src/ui/features/guacamole/` = **empty** ✓
- `git diff --stat src/backend/` = **empty** ✓
- `git diff --stat docker/` = **empty** ✓
- `git diff --stat package.json package-lock.json` = **empty** ✓

**T-06-03-06 stranded-user defense verification approach: PROGRAMMATIC scoped to the defense itself is deferred to Plan 06-05 UAT.** The effect is a straight-line `if (isTouchDevice && mobileScreen === "view" && !selectedConversationId) navigateToList()`. The individual pieces are covered: the mobile-flow module's 11 tests cover mobileScreen; the conversation-store test suite covers stale-id no-op selectConversation (T-06-01-01); the useEffect wiring itself is a simple predicate over these covered inputs. Full end-to-end (start on view, terminate the tmux session, verify auto-navigate to list) is a Plan 06-05 UAT walk item — matches the persistence contract Test 4-6 UAT split from Plan 06-02.

## Decisions Made

See `key-decisions` in frontmatter for the full list. Highlights that answer the plan's `<output>` block explicitly:

- **Tree-restructuring approach chosen = single-outer-div-with-CSS-hidden-children.** The plan Step E's "alternative simpler decision." Preserves the outer `<div className="flex w-screen">` structure verbatim. Main-content region gets `style={{ width: 0, flex: '0 0 0px', overflow: 'hidden' }}` + `aria-hidden` when isMobileListScreen. NO TabPortalRoot component extracted — the createPortal loop stays in its original single mount site. Zero risk to patch #35's tabNodesRef DOM-move mechanism, which the T-06-02-01 mount-lifecycle contract (verified programmatically by AppShell.persistence.test.tsx) depends on.
- **SettingsRow position = BOTTOM of the mobile ConversationsPanel scroll region.** Rendered via a new `settingsRowSlot: ReactNode` prop. Below the last host group (and below the empty-state block when the list is empty), above any padding. Does not compete with pinned/active rows for prime attention (TG-10). Top-of-scroller is reserved for Plan 06-04's NewSessionButton per 06-02 SUMMARY downstream notes.
- **T-06-03-06 stranded-user defense implemented.** Simple useEffect with `[isTouchDevice, mobileScreen, selectedConversationId]` dep list. Fires only when all three conditions are met. Cannot fire on desktop (isTouchDevice=false short-circuits). Cannot fire when the user is on the list (mobileScreen==='list' short-circuits). Cannot fire spuriously when the user is on the view with a valid conversation (`!selectedConversationId` short-circuits). Sits alongside the store→AppShell mirror effect at AppShell.tsx line ~500.
- **URL-sync edge cases with `mv=1` combined with `tab=` + `active=` + `only=`:** none encountered. The tab-url.ts extension is additive — every existing test path (tab-url.test.ts if it exists, and the manual walkthroughs of patch #25 and #34 behavior) is unchanged. Round-trip idempotency test (Test 8) verified `encodeWorkspaceSpec(consumePendingWorkspace(...))` is stable with all four keys present. The `only=1` key (patch #34, Move-to-new-window one-shot marker) still fires exactly once on the new-window path; it's set explicitly by that call site, not by the URL-sync effect. `mv=1` follows the same pattern but is set by the URL-sync effect based on the current mobileScreen — so it always reflects the live state, never a one-shot marker.
- **`sidebarOpenBeforeMobile` effect gained `!isTouchDevice` guard at AppShell.tsx line 253** (`if (isTouchDevice) return;` early return inside the effect body). Pre-plan the effect was at lines 249-256 unconditionally. Post-plan the effect is at lines 249-266 with the added guard at line 253 + expanded JSDoc comment. Line numbers may drift as the file changes — the sentinel is the specific `if (isTouchDevice) return;` early-return.

## Deviations from Plan

**None.** No auto-fixes for bugs, no auth gates, no architectural questions, no scope-fence violations, no test failures requiring iteration beyond a single Vitest scaffolding refinement (Test 6's popstate simulation — see Rule 3 note below).

- **Rule 3-level adjustment (not a Deviation per se, per plan's <behavior> Test 6 explicit "OR dispatching a synthetic popstate event" alternative):** initial Test 6 implementation used `history.back()` for the browser-back simulation, which failed because jsdom's session-history back-stack leaks entries across test cases WITHIN a file and there's no test API to reset it. Diagnosed via `console.log` on the popstate event's `window.location.hash` at the fire point (showed `popstate:#mv=1`, meaning it navigated to a leaked entry from a prior test). Switched to the plan's stated alternative — direct `window.location.hash = ''` + `window.dispatchEvent(new PopStateEvent('popstate', { state: null }))` — which drives the module's listener path exactly as a real browser back would. Documented inline in the test file so future readers understand the trade-off.

**Zero deviations from the plan's <action> block. Zero blockers. Zero architectural surprises.**

## Issues Encountered

- **jsdom session-history back-stack leak across test cases:** already covered in "Deviations from Plan" above. Not a bug in our code; a well-known jsdom limitation. Test 6 uses direct event dispatch instead.

## User Setup Required

None. Zero new npm dependencies, zero new environment variables, zero new files the user needs to create manually.

## Threat Flags

None. This plan operates within the LOCKED threat model — no new network endpoints, no new auth paths, no new file access patterns, no new schema changes at trust boundaries. Every mitigation the plan's `<threat_model>` block committed to was landed:

- **T-06-03-01 (URL scheme collision with patch #25):** MITIGATED — WorkspaceSpec.mobileView optional field layers onto the existing URLSearchParams-based fragment scheme; `tab=`/`active=`/`only=` unchanged; round-trip preserved (Test 8 idempotency, Test 11 preservation).
- **T-06-03-02 (popstate re-entry loop):** MITIGATED — recomputeAndMaybeEmit compares next screen to current before setting/emitting; no push-then-pop cycle. navigateToView + navigateToList never call each other, no recursive state.
- **T-06-03-03 (information disclosure `mv=1`):** ACCEPTED per plan — `mv=1` reveals only "user is on mobile view screen"; not sensitive; fragment content already public.
- **T-06-03-04 (malformed mv value):** MITIGATED — strict `=== '1'` boolean coerce. Test 10 asserts `mv=0`, `mv=yes`, `mv=true` all parse to `mobileView: false`.
- **T-06-03-05 (deep-linked mobile-view URL from desktop):** MITIGATED — `useMobileScreen()` returns the parsed state regardless of viewport, but AppShell's mobile branches are gated on `isTouchDevice`, so desktop viewports never render the mobile flow. The `mv=1` marker is preserved for cross-device link portability (Test 11).
- **T-06-03-06 (stranded on empty view):** MITIGATED — useEffect at AppShell.tsx (post-plan line ~500) navigateToList()'s when `isTouchDevice && mobileScreen === 'view' && !selectedConversationId`. Firing verified programmatically by short-circuit predicate coverage above; end-to-end (session-termination mid-view) deferred to Plan 06-05 UAT walk.
- **T-06-03-SC (supply chain):** MITIGATED — zero new npm dependencies. mobile-flow.ts uses only Web platform APIs (window.location, window.history, hashchange, popstate, URLSearchParams). `git diff --stat package.json package-lock.json` = empty.

## Next Phase Readiness

**Ready for Plan 06-04 (new-session button + host picker + selectConversationDeferred race defense).**

Downstream notes for Plan 06-04's executor:

- **`navigateToView()` is available at `@/lib/mobile-flow`** — Plan 06-04's new-session button, after creating a session and getting back a new tab id, should call `navigateToView()` on mobile so the user lands on the view screen automatically. Signature: `() => void`. Idempotent — safe to call even when the user is already on the view screen (early-returns).
- **`navigateToList()` also available** — Plan 06-04 doesn't need it directly (the mobile-view header's back button in this plan is the sole caller besides the T-06-03-06 defense), but it's exported and idempotent-safe if 06-04's error path needs to bail out of the view on session-creation failure.
- **`useMobileScreen()` hook** — Plan 06-04 can read the current screen if it wants to gate NewSessionButton's post-create behavior on "am I on the list or view?" (probably not needed — new-session is always initiated from the list, and Ashley expects to land in the new session's view). Signature: `() => "list" | "view"`.
- **`onConversationSelected?` prop on ConversationsPanel** — Plan 06-04's NewSessionButton lives at the TOP of the ConversationsPanel scroller (above the pinned section, per 06-02 SUMMARY downstream notes). If 06-04 wants to trigger navigateToView after the new session tab arrives + is selected, it can (a) directly call navigateToView() from its onCreateSession success handler, OR (b) rely on the existing onConversationSelected wiring (which will fire once the store's selectConversation coerces from pendingSelectId to the new tab id after updateOpenTabs). Both paths work; option (a) is more explicit and matches the "post-create success" moment more naturally.
- **`settingsRowSlot` prop is orthogonal** — 06-04's edits to ConversationsPanel (adding NewSessionButton at the top of the scroller) do not interact with the settingsRowSlot at the bottom. The empty-state branch renders `{settingsRowSlot}` too, so 06-04's new-session button placement above the pinned section will coexist cleanly with the settings row below the empty state.
- **The URL `mv=1` marker survives the store's pendingSelectId flush.** When 06-04's `selectConversationDeferred(newTabId)` sets pendingSelectId, then updateOpenTabs later coerces selectedId to newTabId, the resulting URL-sync effect will fire with `mobileView: true` (because the mobile-view screen is where we started from — navigateToView happened before selectConversationDeferred in 06-04's success handler). So the fragment stays consistent.

**Ready for Plan 06-05 (deploy checkpoint) too.**

Downstream notes for Plan 06-05's executor:

- **UAT walk items for the mobile flow:** Ashley's walkthrough should exercise (1) fresh mobile load with empty hash → renders list; (2) row tap → transitions to view + hash gains `#mv=1`; (3) top-left back button → returns to list + hash loses `mv=1`; (4) browser back gesture from view → returns to list; (5) browser back gesture from list → leaves Skynet; (6) session termination mid-view (via `tmux kill-session` on the target host) → T-06-03-06 defense auto-returns to list; (7) pasted deep-link URL with `#mv=1` on a fresh mobile tab → lands directly on the view screen; (8) same deep-link on desktop → renders side-by-side with `mv=1` preserved (invisible to desktop path); (9) SettingsRow at bottom of list → tap opens dropdown with all destinations; (10) new-session flow (from Plan 06-04) lands on view screen automatically.
- **UAT walk items for regression coverage of Plan 06-02:** (11) desktop conversation switching preserves scroll position (T-06-02-01); (12) desktop gear icon dropdown reaches all destinations; (13) URL fragment `#tab=X&tab=Y&active=N` still restores workspaces on Chrome window-restore (patch #25); (14) `#tab=X&only=1` still fires the move-to-new-window one-shot correctly (patch #34); (15) narrow-desktop-window (mouse, pointer:fine) auto-closes sidebar on isMobile transition — unchanged from Plan 06-02.
- **The `mv` key in the fragment doesn't need a dist bytes grep-gate.** Unlike `tabNodesRef` (which Vite may minify), `mv` is a URL-fragment key string literal that appears in code as `"mv"` (URLSearchParams key). Vite will preserve the string literal. A grep for `mv=` in `dist/assets/*.js` would work as a smoke check.
- **No deploy this plan.** Plan 06-05 is the deploy checkpoint. Mobile flow shipped, MobileBottomBar gone, SettingsRow mounted, URL fragment extended — but nothing in this plan runs `docker compose ... up`. Per the plan's `<hard_constraints>` NO DEPLOY.

## Self-Check: PASSED

**File existence:**
- `src/ui/lib/mobile-flow.ts` — CREATED (156 lines)
- `src/ui/lib/mobile-flow.test.ts` — CREATED (206 lines)
- `src/ui/lib/tab-url.ts` — MODIFIED (+15 / -1)
- `src/ui/AppShell.tsx` — MODIFIED (+108 / -76)
- `src/ui/sidebar/ConversationsPanel.tsx` — MODIFIED (+30 / -6)
- `src/ui/locales/en.json` — MODIFIED (+2 / -1)
- `src/ui/shell/MobileBottomBar.tsx` — DELETED (was 155 lines)

**Commit existence:**
- `bbc8c66` (feat(phase-6): mobile-flow module + tab-url mobileView extension (Plan 06-03 Task 1)) — FOUND in `git log --oneline -3` ✓
- `936ff3d` (feat(phase-6): wire mobile flow into AppShell, delete MobileBottomBar (Plan 06-03 Task 2)) — FOUND in `git log --oneline -3` ✓

**Grep-checkable acceptance criteria bundle:**
- MobileBottomBar.tsx deleted (ls returns No-such-file) ✓
- Zero @/shell/MobileBottomBar imports (0) ✓
- 3 remaining MobileBottomBar refs, all in comments (verified content of each) ✓
- useMobileScreen + navigateToView + navigateToList wired (10) ✓
- SettingsRow mounted (6) ✓
- settingsRowSlot in AppShell (2), in ConversationsPanel (3) ✓
- mobileView in AppShell URL-sync (1) ✓
- Stranded-user defense present (predicate hit count 5) ✓
- !isTouchDevice guards (8) ✓
- createPortal loop mounted exactly ONCE (1) ✓

**Test suite:**
- `npx vitest run src/ui/lib/mobile-flow.test.ts` = 11/11 passing ✓
- `npx vitest run --project frontend` (full frontend suite) = 283/283 passing across 23 files ✓

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
