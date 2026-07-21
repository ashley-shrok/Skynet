# Phase 6 UAT Checklist — Telegram-like Interface

Post-deploy walk-through for Ashley. Every TG-01..TG-11 requirement gets an observable check, quoted verbatim from `.planning/REQUIREMENTS.md` so you walk the exact contract. Groupings: desktop happy-path first, persistence (TG-05), mobile flow, new-session (TG-09), settings surface (TG-10), then negative-space scope-fence, then regression smoke against pre-existing patches (#25, #35, #57, #60, #100, #102). Blocking gates marked 🚨 (regression = revert immediately); nice-to-have polish unmarked or ✨.

**Trace commits (Phase 6 code + verify artifacts):**

- Plan 06-01: `4bc6b2a` (conversation-store), `1f6ef65` (ConversationsPanel + ConversationRow)
- Plan 06-02: `d70ef63` (atomic swap — TabBar deleted, ConversationsPanel wired, AppShell rewired), `75338e8` (persistence smoke test)
- Plan 06-03: `bbc8c66` (mobile-flow module + tab-url extension), `936ff3d` (AppShell mobile branch, MobileBottomBar deleted, SettingsRow mounted)
- Plan 06-04: `56d74c0` (selectConversationDeferred race defense), `2197282` (NewSessionButton + NewSessionDialog), `12a41a9` (AppShell wiring)
- Plan 06-05: `0cfb5d9` (build-verify log — this deploy-side verification of everything above)

## Sign-off (top-of-page so you can find it fast)

- [ ] All 🚨 items pass → **disarm deadman:**
      ```
      sudo touch /tmp/termix-keep-patched
      sudo pkill -f 'sleep 900; \[ ! -f /tmp/termix-keep-patched'
      ```
      Then help me pin the patch: paste `.planning/phases/06-telegram-like-interface/06-PATCHES-MD-ENTRY.md` into `~/.claude/identities/tina/termix-patches.md` as patch #105 (or next available — check via `grep -n "^\s*[0-9]\+\." ~/.claude/identities/tina/termix-patches.md | tail -3`), bump the "ONE HUNDRED FOUR numbered patches" count near the top of that file to "ONE HUNDRED FIVE" (or actual new count), and commit the pin.
- [ ] Any 🚨 item fails → **let the deadman fire** (15-min timer will auto-revert) OR run `sudo bash /opt/termix/.tmp-revert.sh` immediately for instant rollback.

## Setup — one time

1. Open https://term.gigaashley.click in Chrome on desktop AND on your phone.
2. Have at least 3 hosts configured in Termix (any mix of SSH/RDP is fine).
3. Have at least 2 sessions active on distinct hosts before starting (one identity-attached Claude session in a tmux window, one plain shell — this covers TG-04 "unchanged internals" for both pretty view and plain terminal).
4. Note the URL fragment after opening a specific conversation — you'll compare this against the post-restore URL later (patch #25 regression check + TG-06 mobile-URL survival).

---

## Desktop happy-path (TG-01, TG-02, TG-03, TG-08, TG-11)

> **TG-01 contract:** *"The sidebar becomes a single flat scrollable list of every currently-active session — no tab strip, no per-view chrome carrying 'which tab am I on.' Rows are grouped visually by host with separators, using the SAME host-tree order the current sidebar already presents (no new sort rule, no recency-shuffle). Sessions that end vanish from the list immediately — the list only ever shows what's live right now, same lifecycle as today's tabs"*

- [ ] 🚨 **TG-01 flat list, host-grouped** Sidebar shows a flat scrollable list of currently-active sessions. Sessions are grouped visually by host with separators (semibold host name per group). Order below any pinned rows matches the existing sidebar host-tree order (no new sort rule; RDP hosts fall out at the position they occupy in the host tree — no explicit "RDP-at-bottom" rule).
- [ ] 🚨 **TG-01 session-end vanishes** Kill a tmux session on the receiving box (`ssh <host> tmux kill-session -t <name>`). Wait a few seconds for the store's `updateOpenTabs` to fire on next tabs update (or refresh the list). Verify: the row for that session vanishes from the list. No tombstone, no "recently closed" section, no re-open gesture. This is the T-06-01-01 stale-selection defense in action — if the killed session was the currently-viewed one, selection coerces to null and the main area shows the empty-view fallback.

> **TG-11 contract:** *"The product ships as a full replacement of the tab metaphor, NOT as an alternate mode alongside it. The tab strip is removed unconditionally. There is no user-facing toggle to bring tabs back. Currently-open tabs on the day this ships are free-fire (they may or may not carry into the new list; no migration story is required)"*

- [ ] 🚨 **TG-11 tab strip gone** No tab strip visible along the top of the main content area in ANY window state (sidebar-open, sidebar-collapsed, split-screen active, RailView switched). Nowhere in the UI is there a chrome element for switching between multiple simultaneous tabs. The main content area shows exactly ONE conversation view or the empty-view fallback.
- [ ] 🚨 **TG-11 NO toggle to bring tabs back** Explore the ConversationsPanel gear icon dropdown, the User Profile page, any Admin Settings surface, and any Preferences section. Verify: no toggle labeled "restore tab view," "tab strip mode," "classic view," or similar. Full replacement, not alternate mode.

> **TG-02 contract:** *"Sessions can be pinned individually. Pinned sessions float to the top of the list above all host-grouped rows; unpinning drops the session back into its host group. Pin state is per-session (not per-host) and persists for the life of the session (a session ending removes it from the list and clears any pin state along with it)"*

- [ ] 🚨 **TG-02 pin floats to top** Locate the pin toggle on a conversation row (hover-reveal on desktop per Plan 06-01 — hover over a row and a Pin icon appears at the right; click). Verify: the row floats to the top of the list ABOVE the host-grouped rows. Bare pins-at-top (no explicit "Pinned" header per Plan 06-01's planner discretion; a subtle divider separates pins from the first host group).
- [ ] 🚨 **TG-02 unpin drops back to host group** Unpin the same session (click the now-visible Pin icon on the pinned row). Verify: it returns to its host group at its ORIGINAL host-tree position (NOT appended at the end).
- [ ] 🚨 **TG-02 pin is per-session, not per-host** Pin session A on hostX. Verify: session B on the SAME hostX is NOT also pinned (pinning is per-row, not per-host).
- [ ] 🚨 **TG-02 session-end clears pin** Pin a session, then kill it (`ssh <host> tmux kill-session -t <name>`). Verify: on the next store update the pin is gone along with the row. No orphan pin state, no ghost row.

> **TG-03 contract:** *"Only one conversation is visible at a time. The tab strip currently at the top of the main area is removed entirely — there is no per-tab chrome, no active-tab indicator on multiple entries, no ability to have two conversations side-by-side. The sidebar row's selected state IS the 'which conversation am I viewing' indicator"*

- [ ] 🚨 **TG-03 single view** Only ONE conversation is visible in the main content area at a time. No tab strip, no split-view indicator on multiple rows. Clicking row B when row A is selected replaces A's visible view with B's (does NOT add a second visible view).
- [ ] 🚨 **TG-03 selected row is the "which am I viewing" indicator** The currently-selected sidebar row is visually distinguished (accent-brand chip treatment cloned from AppRail's selected-tab styling). Only one row can be selected at a time.
- [ ] **TG-03 split-screen coexistence** Split-screen mode via SplitScreenPanel (RailView switch) still works — putting conversations in split panes is a distinct feature; clicking a row when NOT in split-screen mode swaps the visible conversation. The split-screen state and the conversation-list selection are orthogonal.

> **TG-08 contract:** *"On desktop, the sidebar holding the list preserves its existing collapsible behavior verbatim: a thin clickable strip when collapsed (no icons, no visible content — just enough to be clickable), expanding to show the list when clicked. The expanded/collapsed state is a persisted preference across page loads, not a per-session toggle"*

- [ ] 🚨 **TG-08 desktop collapse preserved verbatim** Collapse the sidebar (chevron-left in the sidebar header). Verify: the sidebar collapses to a thin clickable strip (no icons on the strip itself; just enough surface to click). Clicking the strip re-expands it.
- [ ] 🚨 **TG-08 collapse state persists across page load** Refresh the browser (Cmd+R or Ctrl+R). Verify: the sidebar collapse state (either "collapsed" or "expanded") is preserved from before the refresh. This is patch-#2-adjacent behavior that Phase 6 explicitly did NOT touch (LOCKED per shape).

## TG-04 — internal experience of a conversation is unchanged

> **TG-04 contract:** *"The internal experience of a conversation is unchanged. Identity-attached Claude sessions still open into the pretty view; plain SSH sessions still open into a terminal; RDP hosts still open into a remote desktop. Nothing about the innards of a tab changes — only the tab strip and sidebar's selection semantics around it"*

- [ ] 🚨 **TG-04 identity Claude session → pretty view unchanged** Click a row whose session is an identity-attached Claude Code session. Verify: pretty view opens with the same appearance and behavior as pre-Phase-6 — chat bubbles, WipBubble (3D orb WIP indicator from patch #99), PlanPendingBubble, compose box with 3D orb, ambient panels shelf, identity badge (patch #17/#38), 3D avatar treatment, jump pill, session-holding overlay, all preserved end-to-end.
- [ ] 🚨 **TG-04 plain SSH → terminal unchanged** Click a row for a plain shell session (no identity attached). Verify: xterm.js terminal renders unchanged; message queue drawer at the bottom still opens with Ctrl+Shift+; (patch #39); keyboard chords all preserved.
- [ ] 🚨 **TG-04 RDP session → remote desktop unchanged** Open an RDP host session. Verify: guacd RDP canvas renders normally; keyboard input reaches the remote desktop; toolbar (`/features/keyboard/`) still available on touchscreens.

## Persistence contract (TG-05) — load-bearing correctness

> **TG-05 contract:** *"Clicking a conversation for the first time in a page-load mounts its view and opens its underlying connection. Clicking a different conversation hides the previous one but does NOT tear it down — the connection stays alive and its state (terminal buffer, pretty-view scroll position, live WebSocket, ambient panel state) is preserved. Clicking back returns to the previous conversation instantly with no reconnect. Persistence is in-memory only; a full browser refresh resets everything from scratch"*

- [ ] 🚨 **TG-05 pretty-view scroll position preserved on A→B→A** Open conversation A (identity Claude session). Wait for the pretty-view to fully load messages. **Scroll UP** in the message list to some earlier position (note approximately where you are — e.g. "3rd bubble from top"). Click conversation B in the list. Then click conversation A again in the list. Verify: (a) the switch back to A is INSTANTANEOUS — no loading indicator, no reconnect message; (b) A's **scroll position is preserved** exactly where you left it (the 3rd bubble is still visible in the same viewport position); (c) no session-changeover holding banner appears (WebSocket was NOT torn down). **This is the ultimate end-to-end proof of the T-06-02-01 mitigation** (patch #35's tabNodesRef DOM-move mechanism preserved byte-for-byte in Plan 06-02).
- [ ] 🚨 **TG-05 terminal buffer preserved** Open a plain terminal session (conversation C). Type `ls -la /tmp | head -20` and press Enter — note the last visible line and the cursor position. Switch to conversation B, then back to C. Verify: the terminal buffer is intact — the `ls` output is STILL there, cursor position preserved, no reconnect flash, no scrollback loss.
- [ ] 🚨 **TG-05 ambient panels preserved** If you have a session with an ambient panel open (backgrounded-agents panel from patch #61, or PlanPendingBubble open, or MessageQueueDrawer open) — switch away and back. Verify: the ambient panel is still open in the same state.
- [ ] 🚨 **TG-05 refresh resets everything** Ctrl+Shift+R (hard refresh). Verify: all conversations reset — the list re-populates from the URL fragment restore (patch #25 preserved), but any transient scroll positions are back to bottom, any ambient panels reset to default state. Persistence is page-load scoped ONLY (no localStorage, no IndexedDB — verified in Plan 06-01 by grep gate).

### Persistence smoke — Tests 4-6 (deferred from Plan 06-02 to UAT per NOTE-08)

Plan 06-02 Task 2's persistence smoke test landed programmatic guards for Tests 1-3 (DOM node identity, mount-count invariant, visibility toggle) via a MountManager scaffold. Tests 4-6 (URL-sync, document.title effect, stale-id no-op end-to-end) were deferred to this UAT walk because full-AppShell mocking would have been fragile:

- [ ] 🚨 **Test 4 (document.title)** Select conversation A (label "thenasty-claude"). Verify: browser tab title becomes `thenasty-claude` (or whatever A's label is). Select B. Verify: browser tab title becomes B's label. This proves the AppShell store→AppShell mirror effect (Plan 06-02) correctly propagates `selectedConversationId` into `activeTabId` and the existing document-title effect fires.
- [ ] 🚨 **Test 5 (stale-id no-op end-to-end)** Manually load a URL fragment that references a nonexistent tab id (e.g. paste `https://term.gigaashley.click/#tab=terminal:nonexistent-host&active=0` into a fresh tab). Verify: the app loads without crashing; the URL fragment is either coerced to a valid one on next state change or the empty-view fallback renders. No console error, no white screen.
- [ ] 🚨 **Test 6 (URL fragment updates on select)** Open conversation A. Note the URL fragment shows `#tab=terminal:hostA:sessionA&active=0` (or similar). Select conversation B (which is currently at index 1 in the tabs array). Verify: the URL fragment updates to reflect B's index (`&active=1` or the new active pointer). This is the patch #25 `#tab=` scheme continuing to work under Phase 6 selection semantics.

## Mobile flow (TG-06, TG-07) — requires touch device

**Ashley:** this section requires a touch device (phone / tablet). Verify on your phone. If you don't have one handy, skip and mark N/A — the mobile-flow module has 11 Vitest cases covering the URL scheme + navigate actions in Plan 06-03, and the AppShell mobile branch is behind `useIsTouchDevice()` (patch #103) which was smoke-verified in the Phase 5 UAT.

> **TG-06 contract:** *"On mobile (any viewport where `useIsTouchDevice()` returns true), the list and the view are two distinct screens — never both visible at once. From the list, tapping a row navigates into that conversation, fully replacing the list view. A back button in the top-left of the view returns to the list, fully replacing the view. The back gesture also works via the browser's back button"*

- [ ] 🚨 **TG-06 initial load = full-screen list** Open Termix on phone (fresh navigation, no `#mv=1` in URL). Verify: the initial view is the ConversationsPanel occupying the full viewport. NO tab strip. NO main content area visible. The AppRail rail is absent on touchscreens (Plan 06-03 gated it on `!isTouchDevice`).
- [ ] 🚨 **TG-06 tap row → full-screen view (list vanishes)** Tap a conversation row. Verify: the list is FULLY REPLACED by the conversation view (the list is NOT visible in the background — this is a screen swap, not a peek/panel). Top-left of the view has a ChevronLeft back button + separator + the conversation's label as the header title (Plan 06-03's MobileViewHeader).
- [ ] 🚨 **TG-06 top-left back → returns to list (view vanishes)** From the conversation view, tap the top-left back button. Verify: the view is FULLY REPLACED by the list. URL fragment loses `mv=1`. NO transition artifact — clean swap.
- [ ] 🚨 **TG-06 browser back gesture** From the conversation view (with `#mv=1` in URL), hit the browser back button (or phone's system back gesture). Verify: returns to the list. From the list (no `mv=1`), hit browser back again. Verify: leaves Termix (navigates back in browser history to whatever page was before Termix).
- [ ] 🚨 **TG-06 URL fragment survives Chrome window-restore (mobile-view marker case)** On the phone, open a specific conversation view. Note the URL fragment (should contain `mv=1` alongside `tab=` — e.g. `#tab=terminal:hostA:sessionA&active=0&mv=1`). Close the Chrome tab. Reopen via Chrome's Recent Tabs menu (or Ctrl+Shift+T on desktop for the same test — the fragment scheme is identical). Verify: the URL survives AND Termix reopens ON THE VIEW SCREEN for that specific conversation, not on the list. **This is patch #25's Chrome-window-restore lesson extended to the `mv=` key** (Plan 06-03) — if `mv=1` were stored in the query string (`?mv=1`), Chrome would strip it on restore; the fragment approach preserves it. If this test fails, `mv=1` did not survive; investigate before pinning.

> **TG-07 contract:** *"The mobile-only bottom navigation bar (whose current entries — host manager, credentials editor, and adjacent admin surfaces — Ashley does not use) is deleted entirely as a surface. It does not appear on any mobile viewport in any state"*

- [ ] 🚨 **TG-07 mobile bottom nav DELETED** On the mobile viewport, verify the bottom navigation bar is GONE. NO bottom-of-screen strip with icons. The full viewport height is either LIST (with SettingsRow at the bottom of the ConversationsPanel scroller — Plan 06-03) or VIEW (with MobileViewHeader at top + conversation content filling the rest).
- [ ] 🚨 **TG-07 no bottom nav in any state** Try every mobile viewport state: fresh load, after tapping a row (view screen), after tapping back (list screen), during split-screen if that renders on mobile, after opening SettingsRow. Verify: no bottom nav bar visible in ANY of these states.

### Stranded-user defense (T-06-03-06 end-to-end)

- [ ] 🚨 **Stranded-user defense** On mobile, open a specific conversation view. From another device (or via SSH from your laptop), kill that tmux session: `ssh <host> tmux kill-session -t <name>`. On the phone, wait a few seconds (or refresh the list) for the store's session-end coercion to fire. Verify: the phone automatically returns to the LIST screen (not stuck on an empty view). This is Plan 06-03's T-06-03-06 defense — a straight-line `useEffect(() => { if (isTouchDevice && mobileScreen === 'view' && !selectedConversationId) navigateToList(); })`.

## TG-09 — new-session button + host picker + auto-navigate

> **TG-09 contract:** *"A visible new-session button lives on the list view (both mobile and desktop) at a position that does not compete with pinned or active rows for attention — top of the list on desktop, and a mobile-appropriate placement (top-of-list or bottom-of-screen FAB) on mobile. Pressing it brings up a host picker; Ashley picks a host, provides a session name, and the new session opens. The exact affordance shape (modal / slide-in / popover), the exact mobile position, and whether the name is mandatory-up-front vs. optional-with-tmux-title-auto-fallback are planning-phase decisions, not shape decisions"*

Plan 06-04 chose: full-width primary CTA at TOP of scroller ABOVE pins (both mobile and desktop), Radix Dialog modal picker, filterable flat host list, optional session name (empty = tmux window title auto-fill), client-side `SESSION_NAME_PATTERN /^[\w-]{0,64}$/` validation.

- [ ] 🚨 **TG-09 button visible on list, both viewports** On desktop: at the top of the ConversationsPanel scroller (above pinned + host-grouped rows), a full-width button labeled "New session" with a Plus icon. On mobile: same button, same position at top of the ConversationsPanel scroller.
- [ ] 🚨 **TG-09 host picker modal opens** Click the "New session" button. A Radix Dialog modal opens with: (a) a search input at the top (with Search icon + placeholder text "Search hosts…" or similar), (b) a filterable flat list of hosts (from the current host-tree, DFS-flattened), (c) an optional "Session name" input below the host list, (d) Cancel + Open buttons at the bottom-right, (e) a Description string explaining the flow.
- [ ] 🚨 **TG-09 host search filters** Type a partial host name / username / IP into the search input. Verify: the host list filters correctly (case-insensitive substring match on name, username, or ip).
- [ ] 🚨 **TG-09 host selection** Click a host in the list. Verify: it becomes visually selected (accent chip treatment). If the fleet has EXACTLY ONE host, verify it's auto-selected on modal open (`sole-host auto-select` per Plan 06-04).
- [ ] 🚨 **TG-09 optional name — empty = auto-fill on server** With a host selected, leave the "Session name" input EMPTY. Click Open. Verify: (a) a new tab appears in the ConversationsPanel; (b) the new conversation's view is displayed in the main area (auto-navigate per Plan 06-04's `selectConversationDeferred` chain); (c) the tab label matches whatever the tmux window title becomes on that session (the fork's `feat/tab-title-from-tmux` auto-fill behavior — patch #1 territory).
- [ ] 🚨 **TG-09 optional name — non-empty = literal label** Click "New session" again. Pick a host. Type a valid session name like `my-session`. Click Open. Verify: (a) new tab appears with label `my-session`; (b) attaches to a tmux session named `my-session` (creating it if it doesn't exist since `allowCreateTmux: true`).
- [ ] 🚨 **TG-09 session-name validation** Click "New session" again. Pick a host. Type an INVALID name like `bad;name` or `bad name with spaces` or `name<script>alert(1)</script>`. Verify: (a) the Open button is DISABLED; (b) an inline error message appears under the input (e.g. "Use letters, numbers, underscores, or dashes (max 64 characters)"). Try to click Open — nothing happens. **Note:** this is client-side defense-in-depth (T-06-04-01); backend tmux path sanitization is unchanged and remains the actual security boundary.
- [ ] 🚨 **TG-09 Cancel dismisses cleanly** Open modal, don't complete the flow, click Cancel. Verify: modal closes cleanly; no new session created; no selection change; on mobile, the sidebar stays open on the list screen.
- [ ] 🚨 **TG-09 dialog close (X + click-outside)** Open modal, click the X in the top-right (or click outside the modal on desktop). Verify: same as Cancel — modal closes, no side effects.
- [ ] 🚨 **TG-09 mobile auto-navigate to view** On mobile: tap "New session", complete the flow with a valid host. Verify: (a) new session opens AND (b) the mobile flow auto-transitions to the VIEW screen (list is replaced by the new conversation's view). NOT "created on the list; tap to enter." Auto-navigate is TG-09 + Plan 06-04's `if (isTouchDevice) navigateToView()` in the onCreateSession callback.
- [ ] 🚨 **TG-09 race defense observable** Click "New session", complete the flow. Verify: the new tab becomes selected AND visible in the SAME interaction (no perceptible flash of "tab opens but old tab still selected"). This is T-06-04-04's mitigation via `selectConversationDeferred` + `pendingSelectId` in Plan 06-04. If the race were unmitigated, you'd see the new tab appear in the list first and only become selected after a tick.

### Plan-06-04 UAT walk items (SUMMARY-provided items 1-9, adapted)

The following are surfaced from Plan 06-04's SUMMARY as the canonical UAT sequence for the new-session flow:

1. **(covered above by "TG-09 button visible")** open Termix at conversations view (default rail). Click the "New session" button at the top of the panel. Modal opens.
2. **(covered by "TG-09 host search filters")** search filter works.
3. **(covered by "TG-09 host selection")** sole-host auto-select on open when tree has exactly one host.
4. **(covered by "TG-09 optional name — empty")** empty session name: server auto-fills from tmux window title.
5. **(covered by "TG-09 optional name — non-empty")** non-empty valid name: tab label = literal name, tmux session created/attached.
6. **(covered by "TG-09 session-name validation")** invalid characters: Open disabled + error message shown.
7. **(covered by "TG-09 race defense observable")** the T-06-04-04 mitigation.
8. **(covered by "TG-09 mobile auto-navigate to view")** mobile auto-transition to view screen.
9. **(covered by "TG-09 Cancel dismisses cleanly" + "dialog close X/click-outside")** clean modal dismissal.

## TG-10 — settings surface (gear icon on desktop, SettingsRow on mobile)

> **TG-10 contract:** *"The admin/settings destinations previously reachable through the mobile bottom navigation bar (host manager, credentials editor, and adjacent admin surfaces) remain reachable in the product, but from an unobtrusive settings surface — a small gear icon in the sidebar header on desktop, and a settings row somewhere in the list view on mobile that does not sit at the top competing for attention with the pinned or active rows. Ashley never uses these; the constraint is 'don't let them occupy real estate she cares about'"*

- [ ] 🚨 **TG-10 desktop gear icon** On desktop, locate the small gear icon in the ConversationsPanel header (right side of the header row, next to the panel title). Click it. Verify: a DropdownMenu opens with routes to all 10 destinations the MobileBottomBar used to reach: Host Manager, Credentials, Connections, Quick Connect, SSH Tools, Snippets, History, Split Screen, User Profile, Admin Settings.
- [ ] 🚨 **TG-10 desktop admin-settings admin-gated** If you're logged in as a non-admin user (or use a browser session where you can toggle roles), verify: the Admin Settings entry is HIDDEN from the dropdown for non-admin users. Admin-only entry stays gated at the menu-render level (T-06-02-04 preserved from Plan 06-02).
- [ ] 🚨 **TG-10 mobile settings row at bottom** On mobile, scroll to the bottom of the ConversationsPanel scroller (below the last host-grouped row). Verify: a SettingsRow appears. Tap it. Verify: same 10 destinations available. Does NOT sit at the top competing with pinned or active rows for attention (Plan 06-03's decision: bottom of the scroll region).
- [ ] 🚨 **TG-10 mobile settings row visible in empty state** On mobile, if the conversation list is EMPTY (or if you can simulate this by closing all sessions), verify: the SettingsRow STILL appears (below the empty-state message). The affordance stays reachable even with zero conversations.

## Negative-space (scope-fence) checks

Ashley MUST verify that certain things are NOT present. These catch scope creep.

- [ ] 🚨 **NO activity/unread indicators anywhere** No dots, no badges, no numbers, no motion signaling "new activity" on any conversation row. Deferred-to-v2 per shape lock. If ANY appear, a plan violated the deferred-items list — surface for revision.
- [ ] 🚨 **NO cross-conversation search** No global search bar anywhere in the list chrome. (Out entirely per shape — "I don't need it" — Ashley 2026-07-21.)
- [ ] 🚨 **NO folder / nested-grouping above host separators** The list has ONE grouping (by host). No folder hierarchy on top.
- [ ] 🚨 **NO drag-to-reorder for pins** Try to drag a pinned row. Verify: nothing happens (or the drag is refused). Pin order is simple; drag reorder is out.
- [ ] 🚨 **NO history / scrollback for ended sessions** After a session ends, verify: there is NO "recently closed" section, NO way to see what was said in that session.
- [ ] 🚨 **NO alternate-mode toggle** Nowhere in the UI (ConversationsPanel gear dropdown, SettingsRow menu, User Profile, Admin Settings, any Preferences panel) is there a setting to restore the tab strip. Full replacement per TG-11.
- [ ] 🚨 **NO tab strip in any window state** Even when the sidebar is collapsed, even when split-screen is active, even in any RailView switch, the tab strip is GONE. If it appears in any state, that state's rendering path missed the TabBar deletion.
- [ ] 🚨 **NO viewport-width-based mobile detection** On a touchscreen device with a LARGE viewport (iPad landscape — useIsTouchDevice=true, useIsMobile=false depending on breakpoint), verify: mobile flow (list-vs-view screens, top-left back button, no AppRail rail) still applies uniformly. The mobile-vs-desktop signal is ENTIRELY `useIsTouchDevice()`, never viewport width (per plan hard constraint + shape lock).
- [ ] 🚨 **NO desktop chrome bleedthrough on touchscreen** On touchscreen, verify the AppRail rail is ABSENT, the inline resizable sidebar column is ABSENT, the narrow-desktop Sheet is ABSENT, and the chevron-right reveal button is ABSENT — every desktop-chrome branch is additionally gated on `!isTouchDevice` per Plan 06-03.

## Regression smoke — pre-existing patches must still work

- [ ] 🚨 **Patch #25 URL scheme survives Chrome window-restore** From a specific conversation on desktop, note the URL fragment (should contain `#tab=<type>:<host>[:<session>]&active=N`). Close the tab. Use Chrome's Ctrl+Shift+T to restore. Verify: the exact same conversation opens (patch #25 preserved). Function-name identifiers `snapshotPendingTab` / `consumePendingWorkspace` are grep-verified in source (2 + 3 refs) though mangled in dist; the observable behavior is what matters here.
- [ ] 🚨 **Patch #35 DOM node stability** The TG-05 pretty-view-scroll-preservation smoke test above IS the direct test of this. The `appendChild` DOM-move mechanism in AppShell.tsx (dist grep = 6) is preserved.
- [ ] 🚨 **Patch #57 compose-drafts** Type into a pretty-view compose box. Close the tab (don't send). Reopen the pane. Verify: the text is restored. `/compose-drafts` URL literal grep-verified in dist Terminal chunk (3 hits).
- [ ] 🚨 **Patch #60 atomic delete-on-send** Open the message queue drawer with Ctrl+Shift+; . Add a message, hit Send. Verify: the drawer row disappears atomically (no ghost row); refresh the page — the sent message is NOT back in the drawer. `message_queue_delete_on_send` marker grep-verified in backend terminal.js (1 hit).
- [ ] 🚨 **Patch #100 split-and-delay Enter** Send a message via a pretty-view compose. Verify: Claude Code REPL treats the input as TYPED (not paste — no character-count-in-status-bar, no bracketed-paste indicator). `ssh_input_delayed_enter` marker grep-verified in backend terminal.js (1 hit).
- [ ] 🚨 **Patch #102 useIsTouchDevice** On desktop, mobile-specific UI (list-vs-view screens, SettingsRow at bottom, MobileViewHeader back button) is ABSENT. On phone, it's present. Same signal drives both. `pointer: coarse` matchMedia string grep-verified in dist Terminal chunk (1 hit).
- [ ] 🚨 **Terminal / RDP / VNC / file manager / dashboard / SplitScreenPanel / AppRail / Command Palette (double-shift)** All render + behave normally. Open at least one RDP tab and one file-manager surface — verify no unexpected changes. Terminal xterm still works. Sidebar still expands/collapses.
- [ ] 🚨 **Identity badge on pretty-view** Still visible with the Phase-4 Glass treatment (patches #17/#38 + Phase-4 machinery). Large avatar (~56px), name + title stacked, subtle breathing brightness animation.
- [ ] 🚨 **3D orb WIP indicator (patch #99)** Still renders — Phase 6 did not touch WipBubble.
- [ ] 🚨 **Backgrounded-agents panel (patch #61)** If any pane is running background agents: still renders above ComposeBox, below HarnessTasksPanel.
- [ ] 🚨 **Session-holding overlay + jump pill (patch #103 + Phase-4 machinery)** Jump pill still hides when a user message anchors scroll (patch #103's fix from 2026-07-20).
- [ ] 🚨 **Pretty-view file upload (Phase 5)** Drag a file onto a pretty-view surface. Verify: it uploads and injects an inline chip message. Phase 5 (patch #104) continues to work.

---

## Post-sign-off actions

Once all 🚨 items pass and you've disarmed the deadman:

1. **Pin the patch.** Paste the content of `06-PATCHES-MD-ENTRY.md` into `~/.claude/identities/tina/termix-patches.md` at the appropriate ordinal position (patch #105 unless an interstitial pinned first — check via `grep -n "^\s*[0-9]\+\." ~/.claude/identities/tina/termix-patches.md | tail -3`).
2. **Bump the count.** Update the "ONE HUNDRED FOUR numbered patches" line near the top of `termix-patches.md` to "ONE HUNDRED FIVE" (or actual new count).
3. **Commit the pin.** Standard conventional-commit style.
4. **Close the bounty.** `~/.claude/identities/tina/bounties/telegram-like-interface/` via `/close telegram-like-interface`.
