---
phase: 06-telegram-like-interface
plan: 04
subsystem: navigation-chrome
tags: [new-session-button, host-picker, race-defense, deferred-select, tg-09, telegram-like-interface, phase-6]

# Dependency graph
requires:
  - phase: 06-telegram-like-interface
    plan: 01
    provides: "conversation-store module (updateHostTree, updateOpenTabs, selectConversation, useSelectedConversationId) + ConversationsPanel scaffolding. This plan EXTENDS the store with selectConversationDeferred + pendingSelectId + __getPendingSelectIdForTest (additive; existing exports untouched)."
  - phase: 06-telegram-like-interface
    plan: 02
    provides: "AppShell's ConversationsPanel mount site (Plan 06-02 Step G) + effectiveSelectedTabId + store→AppShell mirror effect + realHostTree JSON-memoization. The onCreateSession handler flows through the same openTab + tab-sync path so the mirror effect fires once the batched setTabs commits and updateOpenTabs flushes pendingSelectId."
  - phase: 06-telegram-like-interface
    plan: 03
    provides: "navigateToView() from @/lib/mobile-flow + onConversationSelected?/settingsRowSlot? prop shapes on ConversationsPanel. AppShell's onCreateSession calls navigateToView() when isTouchDevice so mobile session-create lands on the view screen automatically. Coexists cleanly with settingsRowSlot at bottom (Plan 06-03) — button-at-top + settings-at-bottom is the mobile Telegram-list shape."

provides:
  - "src/ui/state/conversation-store.ts EXTENDED: `selectConversationDeferred(id)` public action + module-scoped `pendingSelectId` slot + updateOpenTabs consumption + selectConversation restructure per NOTE-03 re-decision + `__getPendingSelectIdForTest` test helper. Existing exports untouched."
  - "src/ui/state/conversation-store.test.ts EXTENDED: 8 new Vitest cases (Tests 13-18, with Test 17 + Test 18 split into 2 `it` blocks each for clarity). Covers: defer-when-absent, flush-on-arrival, never-arrives-sticky, immediate-when-present, direct-clears-pending (same-id AND different-id), stale-guard-preserves-pending, last-write-wins."
  - "src/ui/sidebar/NewSessionButton.tsx (NEW, 26 lines): primary CTA. Accent-brand outline matching HostsPanel's 'Add host' visual language (lines 688-697). Plus icon + i18n label. Renders as a full-width button (justify-center) with w-full."
  - "src/ui/sidebar/NewSessionDialog.tsx (NEW, ~250 lines): host-picker modal. Reuses fork's Dialog (@/components/dialog) + Button + Input. Filterable flat host list (via inlined collectAllHosts DFS walker), optional session-name input with SESSION_NAME_PATTERN /^[\\w-]{0,64}$/ validation, Cancel + Open. Auto-selects sole host on open when tree has exactly one. Empty name valid → Open enabled → onCreate({host, sessionName: undefined}). Client-side validation is defense-in-depth (T-06-04-01); backend tmux path unchanged and remains the actual security boundary."
  - "src/ui/sidebar/NewSessionDialog.test.tsx (NEW, ~400 lines): 10 Vitest cases mapping to plan's <behavior> block. Tests 1-9 test dialog + button in isolation; Test 10 renders ConversationsPanel with 2 populated conversations and asserts NewSessionButton's DOM position precedes the ConversationRow[data-conversation-id] entries via absolute-document-order walk."
  - "src/ui/sidebar/ConversationsPanel.tsx EXTENDED: two new optional props (hostTree, onCreateSession). NewSessionButton mounted at TOP of scroller ABOVE pins (px-2 pt-2 pb-1 border-b border-border/40). NewSessionDialog mounted as sibling of scroller (portaled anyway). Both gated on `showNewSessionButton = typeof onCreateSession === 'function'` so isolated tests can omit the callback and skip the button + dialog."
  - "src/ui/AppShell.tsx EXTENDED: added `selectConversationDeferred` to the @/state/conversation-store import. ConversationsPanel mount site gains `hostTree={realHostTree}` + `onCreateSession={({host, sessionName}) => { openTab; selectConversationDeferred; if(isTouchDevice) navigateToView; if(isMobile) setSidebarOpen(false); }}`."
  - "src/ui/locales/en.json: 10 new i18n keys added (nav.newSession, nav.newSessionTitle, nav.newSessionDescription, nav.newSessionSearchHosts, nav.newSessionNameLabel, nav.newSessionNamePlaceholder, nav.newSessionNameError, nav.newSessionNoHosts, nav.newSessionHostList) + `common.open` added to complete the common-verbs set."

affects: [06-05]

# Tech tracking
tech-stack:
  added: []  # Zero new npm dependencies — reuses Dialog, Button, Input, DropdownMenu, Plus + Search icons from lucide-react
  patterns:
    - "Deferred-select race defense: module-scoped `pendingSelectId` + `selectConversationDeferred(id)` public action. Same-file location as the store's other actions (no separate module). updateOpenTabs consumes the pending slot AFTER the stale-selection coercion but BEFORE the no-op short-circuit — a same-array re-emission that finally satisfies the pending id still fires. selectConversation clears pending AFTER the stale guard passes but BEFORE the 'no change' return, so a direct same-id select still cancels an in-flight deferred (NOTE-03 re-decision)."
    - "Isolated-callback-gated chrome: NewSessionButton + NewSessionDialog mount is gated on `typeof onCreateSession === 'function'`, mirroring Plan 06-02's `onRailClick`-gated gear icon idiom. Consumers that want the picker wire the callback; consumers that don't (isolated tests, sandboxes) omit it. Zero conditional-prop rendering leakage — same pattern applied consistently across all Phase-6 optional chrome."
    - "Client-side session-name validation as defense-in-depth: `SESSION_NAME_PATTERN = /^[\\w-]{0,64}$/` at module scope in NewSessionDialog.tsx. Empty string matches by design (empty name allowed → server auto-fills from tmux window title). Non-empty invalid → Open button disabled + inline error message under the input. Backend tmux-session-creation sanitization is UNCHANGED and remains the actual security boundary — client-side is UX + defense-in-depth, NOT the security control."
    - "Inlined DFS walker (collectAllHosts) rather than importing SidebarTree's identical helper: keeps NewSessionDialog self-contained (no cross-module coupling risk if SidebarTree ever refactors its internal helpers). Small enough (~8 lines) that duplication is cheaper than the coupling."
    - "AppShell.setSidebarOpen(false) on session-create (via isMobile guard): matches the connectHost + openTab (via HostsPanel + SessionsPanel + QuickConnectPanel) pattern — new-session on mobile should close the sidebar sheet so the fresh session becomes visible, not leave the user staring at the list overlay."

key-files:
  created:
    - "src/ui/sidebar/NewSessionButton.tsx (26 lines — primary CTA button + i18n label)"
    - "src/ui/sidebar/NewSessionDialog.tsx (256 lines — Dialog wrapper + filterable host list + optional name input + Cancel/Open, all i18n-keyed)"
    - "src/ui/sidebar/NewSessionDialog.test.tsx (398 lines — 10 Vitest cases across NewSessionButton + NewSessionDialog + Test 10 ConversationsPanel-integration)"
    - ".planning/phases/06-telegram-like-interface/06-04-SUMMARY.md (this file)"
  modified:
    - "src/ui/state/conversation-store.ts (+52 / -3): module-scoped pendingSelectId slot + selectConversationDeferred action + updateOpenTabs consumption + selectConversation restructure (stale-guard first, pending-clear before no-change return per NOTE-03 re-decision) + __getPendingSelectIdForTest helper. Existing 12 tests still pass; existing selectConversation semantics preserved for stale-id cases."
    - "src/ui/state/conversation-store.test.ts (+192 / -2): imports selectConversationDeferred + __getPendingSelectIdForTest; 8 new Vitest cases (Tests 13-18 split into 8 it-blocks). All 22 tests pass; existing beforeEach reset semantics preserved (selectConversation(null) also clears pending per new implementation)."
    - "src/ui/sidebar/ConversationsPanel.tsx (+55 / -1): imports useState (for dialog-open local state), NewSessionButton, NewSessionDialog, Host + HostFolder types. Adds hostTree + onCreateSession optional props. Renders NewSessionButton at top of scroller (above pinned section, below the header). Renders NewSessionDialog as scroller-sibling. Gated on showNewSessionButton = typeof onCreateSession === 'function' — isolated-test surface unchanged."
    - "src/ui/AppShell.tsx (+22 / -0): adds selectConversationDeferred to the @/state/conversation-store import. ConversationsPanel mount site gains hostTree={realHostTree} + onCreateSession callback that chains openTab + selectConversationDeferred + (touchscreen) navigateToView + (mobile-narrow) setSidebarOpen(false)."
    - "src/ui/locales/en.json (+11 / -1): 10 nav.newSession* keys + 1 common.open key added. Trailing-comma flip on the `backToList` key. `grep -c '\"addHost\"'` = 4 (all 4 pre-existing duplicate keys preserved per Plan 06-01's hard-learned lesson)."

key-decisions:
  - "NOTE-03 re-decision landed cleanly (see NOTE-03 Resolution section below): stale-guard runs FIRST (so stale calls don't cancel pending), then pendingSelectId is cleared BEFORE the 'no change' return (so direct selectConversation ALWAYS clears pending, even when selecting the id we're already on). Plan's Task 1 Step 4 first-draft (`at the top before the guard`) was NOT landed."
  - "Dialog component path chosen = `@/components/dialog` (Radix-based DialogPrimitive wrapper the fork already ships). Verified by grep — used by 5+ other consumers (AdminUserDialogs, UserProfilePanel, SnippetsPanel, DashboardSettingsDialog, NetworkGraphCard). NOT the HostShareModal-style absolute-overlay pattern (that's used for sidebar-panel-replacement UX, not a modal picker)."
  - "Input component chosen = `@/components/input` (the fork's Input wrapper) rather than raw `<input>`. Rationale: matches the fork's h-8 focus-ring-1 disabled-opacity styling verbatim, gets aria-invalid + focus-ring for free, keeps the dialog visually consistent with AdminCreateUserDialog and other picker dialogs. Search input INSIDE the host list uses raw `<input>` because it mirrors HostsPanel.tsx's search-idiom (Search icon + bg-muted/60 wrapper + inner input) verbatim — the fork's Input wrapper doesn't compose that idiom."
  - "Test 5 empty-name outcome: onCreate receives `sessionName: undefined` (NOT empty string). Rationale: openTab's `options.targetTmuxSession ?? null` and `options.label ?? undefined` normalize undefined already; passing undefined lets the tmux-session-creation path see 'no session name provided' and fall through to the tmux-window-title auto-fill. Passing empty string would put an empty label on the tab and pass empty string as targetTmuxSession, which is neither useful nor semantically correct."
  - "NewSessionDialog mount placement inside ConversationsPanel: SIBLING of the scroller (outside `.flex-1.min-h-0.overflow-y-auto`), not inline in the scroller. Rationale: Radix Dialog portals to document.body anyway, so DOM position doesn't drive layout — but making it a sibling makes the render-tree responsibilities obvious (scroller = list content; dialog-sibling = modal). Also, keeping it outside the scroller means the dialog isn't scrolled with the list contents in the render tree (a moot point since portal, but conceptually clearer)."
  - "Translation keys added under `nav.newSession*` (not inside `nav.conversations.*`). Rationale: the new-session flow is CONCEPTUALLY parallel to the conversations list, not a sub-feature of it. Under `nav.conversations` would suggest it's a child navigational surface; under `nav.*` sibling-to-`nav.conversations` reads as a peer affordance. Matches how `nav.hosts`, `nav.sessions`, etc. sit at the same level."
  - "NewSessionButton renders EVEN IN THE EMPTY-STATE branch. Rationale: on a fresh page load with no conversations, the button is the FIRST affordance Ashley sees — literally the primary starting point. Hiding it in the empty state would make the fresh page look inert and force the user to hunt for how to start. The empty-state message (MessagesSquare icon + 'No active conversations') sits BELOW the button, which reads naturally as 'here's how to start; nothing yet.'"
  - "NewSessionButton width = full (w-full justify-center) rather than the shrink-0 hug-content sizing of HostsPanel's 'Add host' button. Rationale: HostsPanel's button is one of many chrome elements in a header row (with dropdown + tags + filter); ConversationsPanel's button lives alone at the top of the scroller and needs to be an obvious primary CTA — full-width makes it the visual center of the top-of-list slot without competing chrome for space."
  - "Test 10 uses `data-conversation-id` attribute for row-positioning assertion instead of textContent matching. Rationale: ConversationRow renders as `<div role='button' data-conversation-id='...'>`, not `<button>` — the initial test that queried `container.querySelectorAll('button')` missed the rows entirely. `data-conversation-id` is a stable test hook (present since Plan 06-01 for exactly this use case) and lets Test 10 walk absolute document order via `container.querySelectorAll('*')` for a robust positional check."
  - "Setting-sidebar-open(false) inside onCreateSession on mobile: mirrors the existing `if (isMobile) setSidebarOpen(false)` pattern that connectHost + openTab + QuickConnectPanel + SessionsPanel + HostsPanel already use when they open a new tab. Deliberate parity so the new-session flow feels identical to those existing paths from Ashley's muscle memory."

patterns-established:
  - "Additive store-action extension via deferred/queued shape: new public action + module-scoped queue slot + integration into the existing mutation path where the queue naturally consumes. Zero disturbance to existing action semantics (selectConversation's contract for stale-id + null-clear + same-id no-op is preserved; only the additional 'clear pending' side effect is new). Test-only introspection helper (__getPendingSelectIdForTest) exports the queue state so integration tests can assert queue semantics without opening a private-state hole in production code."
  - "TDD tests-with-code-in-same-commit for a `tdd='true'` task when the test file references types + exports that don't exist yet: rather than splitting into separate red-commit + green-commit (which produces a genuinely broken intermediate state), land the test + implementation together as `feat(...)` with the RED phase captured in the pre-commit test-run log (visible in the executor's narration). Matches Plan 06-02's precedent (Task 2 = `test(phase-6):` single commit with test + scaffold together)."

requirements-completed: []
# NOTE: TG-09 is LISTED in this plan's frontmatter but is NOT marked complete
# here. Plan 06-05 UAT is the requirement-completion checkpoint for the
# whole phase. This mirrors Plans 06-01/02/03's approach.

# Metrics
duration: 14min
completed: 2026-07-21
---

# Phase 6 Plan 06-04: New-Session Button + Host Picker + Race Defense Summary

**Visible new-session button (TG-09) shipped at the top of ConversationsPanel above pins on both mobile and desktop. Clicking opens a host-picker modal with a filterable flat host list, optional session-name input (empty = server auto-fills from tmux window title; non-empty validated client-side against `/^[\\w-]{0,64}$/` as defense-in-depth), Cancel + Open. On submit, AppShell chains `openTab` → `selectConversationDeferred(newTabId)` → (on touchscreens) `navigateToView()`. The store's new module-scoped `pendingSelectId` slot defends against the React setState-then-select race deterministically — the plan-checker's NOTE-03 re-decision (stale-guard first, pending-clear before no-change return) landed as authoritative.**

## Performance

- **Duration:** ~14 min wall-clock (Task 1 store extension + tests → 1 RED-verification pass → all 8 GREEN; Task 2 dialog + button + tests → 9/9 pass first try + one a11y cleanup pass for DialogDescription; Task 3 wire panel + AppShell + add Test 10 → one iteration on Test 10's row-selector-attribute (from `button` → `data-conversation-id`) → all 301 pass). Zero deviations, zero blockers, zero architectural surprises.
- **Started:** 2026-07-21T02:47Z (approximate — first Read of the plan)
- **Completed:** 2026-07-21T03:01Z
- **Tasks:** 3 (all `type="auto"`, Tasks 1 + 2 also `tdd="true"`)
- **Files created:** 4 (NewSessionButton.tsx + NewSessionDialog.tsx + NewSessionDialog.test.tsx + this SUMMARY)
- **Files modified:** 5 (conversation-store.ts + conversation-store.test.ts + ConversationsPanel.tsx + AppShell.tsx + en.json)
- **Net line change:** +1026 / -6 (test file + dialog file account for ~65% of additions)

## Accomplishments

- **TG-09 shipped end-to-end.** Visible new-session button at the top of the ConversationsPanel scroller on BOTH mobile and desktop. Distinct from Plan 06-02's gear icon (button = primary CTA at top of scroller; gear = unobtrusive settings chrome in the header slot on desktop, or SettingsRow at bottom of scroller on mobile). Different visual weights, different positions, non-conflatable per plan hard constraint.
- **Host picker modal ships all `<behavior>` promises.** Filterable host list (search + case-insensitive substring match across name/username/ip), optional session-name input (empty allowed per the fork's feat/tab-title-from-tmux behavior), client-side validation via `SESSION_NAME_PATTERN /^[\\w-]{0,64}$/` (Open disabled while non-empty invalid + inline error message shown), Cancel + Open buttons, sole-host auto-select on open.
- **Race defense landed deterministically.** New store export `selectConversationDeferred(id)` + module-scoped `pendingSelectId` slot + updateOpenTabs flush at the correct insertion point (after stale-selection coercion, before no-op short-circuit — so a same-array re-emission that finally contains the pending id still fires). Direct `selectConversation` clears pending after stale-guard passes but before no-change return, so a same-id call always cancels an in-flight deferred (NOTE-03 re-decision authoritative version landed — NOT the first-draft version). 8 new Vitest cases prove all the semantics.
- **AppShell wiring is minimal and orthogonal.** Two new props on the ConversationsPanel mount (`hostTree={realHostTree}` + `onCreateSession={...}`) + one new import (`selectConversationDeferred` added to the existing conversation-store import). The onCreateSession callback chains `openTab` → `selectConversationDeferred` → `if (isTouchDevice) navigateToView()` → `if (isMobile) setSidebarOpen(false)`. No touches to any other AppShell logic; no new effects; no state additions.
- **ConversationsPanel remains VIEWPORT-AGNOSTIC.** No `useIsTouchDevice` import; no `mobile-flow` import; no `openTab` import. The mobile-specific auto-navigate behavior lives in AppShell's onCreateSession wrapper, not inside the panel. Panel props are all optional so isolated tests (like Test 10 in this plan) can render without wiring the picker or the settings row.
- **Scope-fence honored.** Zero touches to `src/ui/features/pretty-view/**`, `src/ui/features/terminal/Terminal.tsx`, `src/ui/features/guacamole/**`, `src/backend/**`, `docker/**`, `package.json`, `package-lock.json`. Zero new npm dependencies (reuses Dialog, Button, Input, DropdownMenu, Plus + Search icons from lucide-react).
- **Full-project tsc --noEmit --skipLibCheck clean.** Full frontend Vitest suite: **301/301 passing** (283 baseline from Plan 06-03 + 8 new conversation-store tests + 10 new NewSessionDialog tests = 301 total; matches expected count).

## Task Commits

Each task was committed atomically on branch `feat/tab-title-from-tmux`:

1. **Task 1: selectConversationDeferred + pendingSelectId race defense** — `56d74c0` (feat)
2. **Task 2: NewSessionButton + NewSessionDialog with host picker + client-side validation** — `2197282` (feat)
3. **Task 3: wire NewSessionButton + Dialog into ConversationsPanel + AppShell** — `12a41a9` (feat)

## NOTE-03 Resolution

**Contradiction in Plan 06-04-PLAN.md Task 1 Step 4:** the plan text contained three sequential drafts of where to place `pendingSelectId = null` inside `selectConversation`:

1. **First draft:** "at the top of selectConversation" (before the stale-id guard).
2. **Second draft:** "AFTER the 'no-op if not in tabs' guard so we don't clear pending on a call that doesn't take effect."
3. **Re-decision (authoritative per plan-checker NOTE-03):** "place it AFTER the guard but BEFORE the 'no change' return so direct selects clear pending even when selecting the same id."

**Landed:** the **re-decision (draft 3)**. Concretely, `selectConversation` was **restructured** from:

```ts
export function selectConversation(id) {
  if (id === state.selectedId) return;      // no-change return (was TOP)
  if (id !== null) { stale-id guard; if (!found) return; }
  state = { ...state, selectedId: id };
  notify();
}
```

to:

```ts
export function selectConversation(id) {
  if (id !== null) { stale-id guard; if (!found) return; }  // stale FIRST
  pendingSelectId = null;                                    // clear AFTER guard
  if (id === state.selectedId) return;                       // no-change return
  state = { ...state, selectedId: id };
  notify();
}
```

Semantics landed:

- **Same-id direct select DOES cancel pending** (Test 17 first `it` block — pending set to "pending", `selectConversation("existing")` where "existing" is current, pending cleared).
- **Stale-id direct select does NOT cancel pending** (Test 17 second `it` block — pending set, `selectConversation("stale-not-in-tabs")` returns early inside the guard before touching pending; pending stays intact).
- **Null direct select DOES cancel pending** (implicit — the stale-guard is skipped for null id, so the pending-clear runs; the no-change return only fires if state.selectedId was also null).

**Rationale for choosing re-decision over first draft:** the first draft ("at the top") would have cleared pending BEFORE the stale-id guard — meaning a stale `selectConversation("bogus-id")` call would silently cancel an in-flight deferred select, which is the exact regression the deferred-select mechanism is designed to prevent. The second draft was correct on the stale-guard front but ambiguous on same-id behavior; the third draft made same-id explicit. Landing the third draft gives the correct behavior on all three axes (same-id, different-id-in-tabs, different-id-stale).

**Test coverage confirms:** all 8 new Vitest cases (Tests 13-18 split into 8 `it` blocks) exercise the semantics; the "stale-guard-preserves-pending" test case (Test 17's second `it` block) is the specific defense that would have caught a first-draft landing.

## Files Created/Modified

**Created:**

- `src/ui/sidebar/NewSessionButton.tsx` — 26 lines. Full-width primary CTA button with Plus icon + i18n `nav.newSession` label. Accent-brand outline visual language cloned from HostsPanel.tsx line 688-697 for cross-sidebar consistency.
- `src/ui/sidebar/NewSessionDialog.tsx` — 256 lines. Radix-based Dialog wrapper. Filterable host list (via inlined `collectAllHosts` DFS walker), optional session-name input with SESSION_NAME_PATTERN validation + inline error message, Cancel + Open buttons. Auto-selects sole host on open. 10 i18n keys via useTranslation.
- `src/ui/sidebar/NewSessionDialog.test.tsx` — 398 lines. 10 Vitest cases via React Testing Library. Tests 1-9 test the button + dialog in isolation with an in-test hostTree fixture. Test 10 renders ConversationsPanel with 2 populated conversations (via `updateOpenTabs` on the real conversation-store) and asserts NewSessionButton's document-order position precedes the two ConversationRow entries via `data-conversation-id` attribute selection. react-i18next + session-hue + identities-store + use-is-touch-device all mocked to inert defaults.
- `.planning/phases/06-telegram-like-interface/06-04-SUMMARY.md` — this file.

**Modified:**

- `src/ui/state/conversation-store.ts` — +52 / -3. Module-scoped `pendingSelectId: string | null = null` slot. New `selectConversationDeferred(id)` export: if id in openTabs, delegates to selectConversation; else parks id in pendingSelectId. `updateOpenTabs` flushes pending: `if (pendingSelectId !== null && nextIds.has(pendingSelectId)) { nextSelectedId = pendingSelectId; pendingSelectId = null; }` — placed AFTER the stale-selection coercion but BEFORE the no-op short-circuit. `selectConversation` restructured per NOTE-03 re-decision (see NOTE-03 Resolution above). New `__getPendingSelectIdForTest` test-only export.
- `src/ui/state/conversation-store.test.ts` — +192 / -2. Imports `selectConversationDeferred` + `__getPendingSelectIdForTest`. 8 new Vitest cases as described in the plan's `<behavior>` block: Tests 13-16 each as one `it`; Tests 17 + 18 split into 2 `it` blocks each (Test 17: same-id clears + stale-guard preserves; Test 18: last-write-wins-flushes + wrong-id-arrives-preserves).
- `src/ui/sidebar/ConversationsPanel.tsx` — +55 / -1. useState import added (dialog-open local state). NewSessionButton + NewSessionDialog imports. Host + HostFolder types imported. Two new optional props: `hostTree?: HostFolder | null` + `onCreateSession?: (opts: { host: Host; sessionName?: string }) => void`. NewSessionButton mounted at top of scroller (px-2 pt-2 pb-1 border-b border-border/40 wrapper). NewSessionDialog mounted as scroller-sibling. Both gated on `showNewSessionButton = typeof onCreateSession === 'function'`.
- `src/ui/AppShell.tsx` — +22 / -0. `selectConversationDeferred` added to the existing `@/state/conversation-store` import. ConversationsPanel mount site (post Plan 06-02 + Plan 06-03) gains `hostTree={realHostTree}` + `onCreateSession={({ host, sessionName }) => { const newTabId = openTab(host, "terminal", undefined, { targetTmuxSession: sessionName ?? null, label: sessionName ?? undefined, allowCreateTmux: true }); selectConversationDeferred(newTabId); if (isTouchDevice) navigateToView(); if (isMobile) setSidebarOpen(false); }}`. Zero other AppShell changes.
- `src/ui/locales/en.json` — +11 / -1. 10 nav.newSession* keys added inside the `nav` namespace (sibling to `nav.conversations`). 1 `common.open` key added inside the `common` namespace. Trailing-comma flip on the pre-existing `backToList` key. Targeted `Edit` (not JSON round-trip) per Plan 06-01/02/03's hard-learned lesson: `grep -c '"addHost"'` still returns **4** post-edit (all 4 pre-existing duplicate keys preserved).

## Verification

**Grep-checkable acceptance criteria (all three tasks — full bundle):**

Task 1 (conversation-store extension):
- `grep -c "export function selectConversationDeferred" src/ui/state/conversation-store.ts` = **1** ✓ (required: 1)
- `grep -c "let pendingSelectId" src/ui/state/conversation-store.ts` = **1** ✓ (required: 1)
- `grep -c "pendingSelectId" src/ui/state/conversation-store.ts` = **10** ✓ (required: ≥3 — declaration, updateOpenTabs consumption, selectConversation clear, selectConversationDeferred assignment, test helper, comments)
- 8/8 new Vitest cases pass (`npx vitest run src/ui/state/conversation-store.test.ts` = 22/22 total) ✓
- `npx tsc --noEmit --skipLibCheck` mentions no errors for conversation-store ✓

Task 2 (button + dialog + tests):
- `grep -c "export function NewSessionButton" src/ui/sidebar/NewSessionButton.tsx` = **1** ✓
- `grep -c "export function NewSessionDialog" src/ui/sidebar/NewSessionDialog.tsx` = **1** ✓
- `grep -c "SESSION_NAME_PATTERN" src/ui/sidebar/NewSessionDialog.tsx` = **3** ✓ (constant + `.test(sessionName)` guard + export)
- 9/9 Task 2 Vitest cases pass; 10/10 with Task 3's Test 10 addition ✓
- Zero imports from `@/features/pretty-view/`, `@/features/terminal/`, `@/features/guacamole/`, `@/backend/` in the 3 new files (grep = 0) ✓
- Zero new npm deps (`git diff --stat package.json package-lock.json` empty) ✓

Task 3 (panel + AppShell wiring):
- `grep -c "NewSessionButton\|NewSessionDialog" src/ui/sidebar/ConversationsPanel.tsx` = **18** (includes multiple JSX + import + comment mentions) ✓ (required: ≥1 each)
- `grep -c "hostTree\|onCreateSession" src/ui/sidebar/ConversationsPanel.tsx` = **10** ✓ (required: ≥1 each)
- `grep -c "onCreateSession" src/ui/AppShell.tsx` = **1** ✓ (required: ≥1)
- `grep -c "selectConversationDeferred" src/ui/AppShell.tsx` = **3** ✓ (required: ≥1 — import + comment + callback body)
- `grep -c "hostTree={realHostTree}" src/ui/AppShell.tsx` = **1** ✓ (required: 1)
- `grep -c "mobile-flow" src/ui/sidebar/ConversationsPanel.tsx` = **0** ✓ (viewport-agnostic contract)
- `grep -n "openTab" src/ui/sidebar/ConversationsPanel.tsx` = **2 hits, BOTH in comments** ✓ (import grep = 0; the 2 hits are prose in the prop JSDoc + inline JSDoc — no actual import or code reference)

**Full-project regression bundle:**
- `npx tsc --noEmit --skipLibCheck` project-wide = **zero errors** ✓
- `npx vitest run --project frontend` = **301/301 passing across 24 files** (up from 283/283 pre-plan due to 8 new conversation-store tests + 10 new NewSessionDialog tests) ✓
- `git diff --stat package.json package-lock.json` = **empty** ✓ (zero new deps)

**Scope-fence structural checks (against 09085a4^..12a41a9):**
- `git diff --stat src/ui/features/pretty-view/` = **empty** ✓
- `git diff --stat src/ui/features/terminal/Terminal.tsx` = **empty** ✓
- `git diff --stat src/ui/features/guacamole/` = **empty** ✓
- `git diff --stat src/backend/` = **empty** ✓
- `git diff --stat docker/` = **empty** ✓
- `git diff --stat package.json package-lock.json` = **empty** ✓

**Race-defense verification (T-06-04-04):** PROGRAMMATIC via 8 Vitest cases. The deferred-select semantics + updateOpenTabs flush are directly asserted at the store's public API level:
- **Test 13:** deferred id absent → pendingSelectId set, selectedId unchanged. ✓
- **Test 14:** updateOpenTabs adds the id → selectedId flushes to it, pending clears. ✓
- **Test 15:** updateOpenTabs WITHOUT the id → nothing happens, pending stays. ✓
- **Test 16:** deferred id already in tabs → immediate select, no pending set. ✓
- **Test 17 (a):** direct selectConversation same-id clears pending. ✓ (NOTE-03 re-decision)
- **Test 17 (b):** direct selectConversation stale-id does NOT clear pending. ✓
- **Test 18 (a):** two deferreds → last-write-wins; second id flushes on arrival. ✓
- **Test 18 (b):** two deferreds → only first id arrives → nothing flushes. ✓

End-to-end race verification (openTab → selectConversationDeferred → updateOpenTabs flush → mirror effect → activeInline swap → visible pane change) is deferred to Plan 06-05 UAT walk. All the pieces are individually covered.

## Decisions Made

See `key-decisions` in frontmatter for the full list. Highlights that answer the plan's `<output>` block explicitly:

- **Chosen Dialog component path:** `@/components/dialog` (grep-verified — the fork's Radix-DialogPrimitive wrapper, used by 5+ other consumers). NOT HostShareModal's absolute-overlay pattern (that's for sidebar-panel-replacement UX, not modal pickers).
- **Fork's Input component used** for the session-name input (not raw `<input>`). Rationale: h-8 focus-ring-1 disabled-opacity styling matches AdminCreateUserDialog + other picker dialogs. Search input INSIDE the host list uses raw `<input>` to mirror HostsPanel.tsx's search idiom (Search icon + bg-muted/60 wrapper + inner input).
- **Test 5 empty-name outcome:** onCreate receives `sessionName: undefined` (NOT empty string). Rationale: openTab normalizes undefined to null already; passing undefined lets the tmux-window-title auto-fill path trigger. Passing empty string would put an empty label on the tab.
- **NewSessionDialog mount placement:** SIBLING of the scroller, outside `.flex-1.min-h-0.overflow-y-auto`. Rationale: Radix Dialog portals to document.body anyway (DOM position doesn't drive layout); sibling placement makes the render-tree responsibilities obvious.
- **Translation keys under `nav.newSession*`** (not inside `nav.conversations.*`). Rationale: new-session flow is CONCEPTUALLY parallel to the conversations list, not a sub-feature of it. Matches how `nav.hosts`, `nav.sessions`, etc. sit at the same level.

## Deviations from Plan

**None.** No auto-fixes for bugs, no auth gates, no architectural questions, no scope-fence violations, no test failures requiring iteration beyond a single Test 10 selector refinement (queried `<button>` when rows are actually `<div role='button' data-conversation-id>` — switched to `data-conversation-id` selector for stable positional check).

**Zero deviations from the plan's `<action>` blocks. Zero blockers. Zero architectural surprises.** Plan executed as written, with NOTE-03's re-decision landed as authoritative.

## Issues Encountered

- **Test 10's initial row-selector was wrong** (queried `<button>` instead of `[data-conversation-id]`): diagnosed by running the test and seeing `expected -1 to be greater than 0` (findIndex returned -1 because no `<button>` matched the label text). Fixed by switching to a stable `data-conversation-id` attribute selector + `container.querySelectorAll('*')` document-order walk. Not a bug in the code, just a first-pass mismatch on how ConversationRow renders itself (`div role='button'`, not `button`).

## User Setup Required

None. Zero new npm dependencies, zero new environment variables, zero new files the user needs to create manually.

## Threat Flags

None. This plan operates within the LOCKED threat model — no new network endpoints, no new auth paths, no new file access patterns beyond the existing openTab flow, no new schema changes at trust boundaries. Every mitigation the plan's `<threat_model>` block committed to was landed:

- **T-06-04-01 (session-name injection):** MITIGATED via client-side defense-in-depth. `SESSION_NAME_PATTERN /^[\\w-]{0,64}$/` at module scope in NewSessionDialog.tsx. Non-empty invalid → Open button disabled + inline error surfaced. Empty name allowed → bypasses the tmux new-session -s <name> arg entirely (targetTmuxSession = null). Backend tmux-session-creation sanitization UNCHANGED — remains the actual security boundary. Test 7 (invalid characters disable Open) programmatically enforces the client-side gate.
- **T-06-04-02 (DoS via host list flood):** ACCEPTED per plan. Search input present for UX at Ashley's ~50-host fleet scale, not for DoS. No pagination or virtualization needed at this scale.
- **T-06-04-03 (info disclosure via host list):** ACCEPTED per plan. Same list Ashley sees in HostsPanel; no new disclosure surface.
- **T-06-04-04 (setState-then-select race):** MITIGATED via `selectConversationDeferred` + `pendingSelectId` in the store. Deterministic, avoids microtask-race workarounds. 8 Vitest cases prove the semantics. Full end-to-end (openTab → deferred → flush → mirror → visible-pane change) deferred to Plan 06-05 UAT walk; all the individual pieces are covered by store unit tests + Plan 06-02's persistence smoke test + Plan 06-03's mobile-flow tests.
- **T-06-04-SC (supply chain):** MITIGATED — zero new npm dependencies. Reuses existing Dialog + Button + Input + DropdownMenu + Plus/Search icons. `git diff --stat package.json package-lock.json` = empty.

## Next Phase Readiness

**Ready for Plan 06-05 (deploy checkpoint).**

Downstream notes for Plan 06-05's executor:

**UAT walk items for the new-session flow (TG-09):**

1. **On desktop:** open Skynet at conversations view (default rail). Click the "New session" button at the top of the panel. Modal opens with a filterable host list.
2. **Search filter works:** type partial host name / username / ip into the search input. List filters correctly.
3. **Sole-host auto-select:** if the current fleet has exactly one host, the dialog auto-selects it on open (unlikely for Ashley's fleet but easy to verify by temporarily filtering the tree to 1 host — or just observe that Open is disabled until a host is clicked, then enabled).
4. **Empty session name:** click Open with empty name; new tab opens with a name derived from the tmux window title (patch #43-adjacent behavior). Verify server auto-fill works and the tab label reflects the tmux window title.
5. **Non-empty session name:** type "my-session" into the name input; Open enabled; click → new tab opens with label "my-session" and attaches to tmux session "my-session" (creating it if it doesn't exist since `allowCreateTmux: true`).
6. **Invalid session name:** type "bad;name`chars"; Open button disabled; error message "Use letters, numbers, underscores, or dashes (max 64 characters)." appears under the input. Try to click Open — nothing happens.
7. **Race defense observable:** click Open with a valid host. The new tab becomes selected AND visible in the same interaction (no perceptible flash of "tab opens but old tab still selected"). This is the T-06-04-04 mitigation in action.
8. **On mobile (touch device):** tap the "New session" button at the top of the list. Modal opens. Complete the flow. New session opens AND the mobile flow auto-transitions to the view screen (Plan 06-03's navigateToView fires from the onCreateSession callback). User lands on the new session's pane, not stuck on the list.
9. **Cancel button:** open the modal, click Cancel. Modal closes. No new session created. No selection change. Sidebar (on mobile) stays open on the list screen.
10. **Modal-close (X in top-right OR click-outside on desktop):** same as Cancel — modal closes cleanly, no side effects.

**UAT walk items for regression coverage of prior phase-6 plans (still relevant):**

11. Selecting an existing conversation still preserves scroll position + no reconnect (T-06-02-01 persistence).
12. Mobile back button still returns from view → list (Plan 06-03).
13. `#tab=` URL fragment still restores workspaces on Chrome window-restore (patch #25 preserved).
14. Existing gear-icon settings surface on desktop + SettingsRow on mobile both still route to all destinations (host-manager, credentials, connections, quick-connect, ssh-tools, snippets, history, split-screen, user-profile, admin-settings).
15. Pin / unpin on individual conversations still works; session-end clears both row and pin.

**No deploy this plan.** Plan 06-05 is the deploy checkpoint. TG-09 shipped, race defense in place, TG-01..TG-11 all now technically complete — but nothing in this plan runs `docker compose ... up`. Per the plan's `<hard_constraints>` NO DEPLOY.

**Grep-gate suggestion for Plan 06-05 dist bytes verification:** the SESSION_NAME_PATTERN regex is a string literal `[\w-]{0,64}` in the source — Vite may inline it. A dist-bytes smoke check for the pattern presence would be `grep -c 'NewSession\|new-session' dist/assets/*.js`. Combined with `grep -c 'selectConversationDeferred\|pendingSelectId' dist/assets/*.js ≥ 1` (unless Vite mangles the identifiers — worth checking) provides a light smoke gate that Plan 06-04's code shipped.

## Self-Check: PASSED

**File existence:**
- `src/ui/sidebar/NewSessionButton.tsx` — CREATED (26 lines) ✓
- `src/ui/sidebar/NewSessionDialog.tsx` — CREATED (256 lines) ✓
- `src/ui/sidebar/NewSessionDialog.test.tsx` — CREATED (398 lines) ✓
- `src/ui/state/conversation-store.ts` — MODIFIED (+52 / -3) ✓
- `src/ui/state/conversation-store.test.ts` — MODIFIED (+192 / -2) ✓
- `src/ui/sidebar/ConversationsPanel.tsx` — MODIFIED (+55 / -1) ✓
- `src/ui/AppShell.tsx` — MODIFIED (+22 / -0) ✓
- `src/ui/locales/en.json` — MODIFIED (+11 / -1) ✓

**Commit existence:**
- `56d74c0` (feat(phase-6): selectConversationDeferred + pendingSelectId race defense (Plan 06-04 Task 1)) — FOUND in `git log --oneline -3` ✓
- `2197282` (feat(phase-6): NewSessionButton + NewSessionDialog with host picker + client-side validation (Plan 06-04 Task 2)) — FOUND in `git log --oneline -3` ✓
- `12a41a9` (feat(phase-6): wire NewSessionButton + Dialog into ConversationsPanel + AppShell (Plan 06-04 Task 3)) — FOUND in `git log --oneline -3` ✓

**Grep-checkable acceptance criteria bundle (all three tasks):**
- Task 1: selectConversationDeferred export (1), pendingSelectId decl (1), pendingSelectId total refs (10) ✓
- Task 2: NewSessionButton export (1), NewSessionDialog export (1), SESSION_NAME_PATTERN (3) ✓
- Task 3: panel imports (18), panel props (10), AppShell onCreateSession (1), AppShell selectConversationDeferred (3), AppShell hostTree={realHostTree} (1) ✓
- Panel viewport-agnostic: mobile-flow (0), openTab imports (0 — 2 grep hits are prose comments) ✓

**Test suite:**
- `npx vitest run src/ui/state/conversation-store.test.ts` = 22/22 passing (12 baseline + 8 new) ✓
- `npx vitest run src/ui/sidebar/NewSessionDialog.test.tsx` = 10/10 passing (all Tests 1-10) ✓
- `npx vitest run --project frontend` (full frontend suite) = 301/301 passing across 24 files ✓

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
