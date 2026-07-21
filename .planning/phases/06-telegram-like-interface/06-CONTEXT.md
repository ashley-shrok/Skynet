# Phase 6: Telegram-like interface — Context

**Gathered:** 2026-07-21
**Status:** Ready for planning
**Source:** Synthesized from shape file `.planning/shapes/shape-telegram-like-interface.md` — that file is authoritative and every philosophical / scope-edge question was locked during a `/open` discussion with Ashley on 2026-07-21 (see the shape's "What would make it wrong" and "Scope edges" sections for provenance). This CONTEXT.md restates the shape as locked planning decisions plus the concrete Termix-fork integration points. **The shape is not to be re-litigated; the planner's job is HOW, not WHAT.**

<domain>
## Phase Boundary

This phase reshapes Termix's top-level navigation model — sidebar, tab strip, mobile chrome — around a Telegram-style single-select conversation list, without disturbing the internals of any conversation type. Scope:

1. **Sidebar as conversation list (both mobile and desktop).** The existing expanding sidebar becomes a flat single-select list of currently-active sessions grouped by host with visual separators. The current host-tree order is preserved (no new sort rule); per-session pins float above the host-grouped rows. Rows show whichever session-shape indicator makes sense (host name + session label + type badge — planner's call, matching existing sidebar chrome).
2. **Tab strip removed from the main view area.** The current per-tab chrome (tab strip along the top of the main content region) is deleted unconditionally. There is no user-facing toggle to bring tabs back. Only one conversation view is mounted-and-visible at a time; the sidebar row's selected state IS the "which conversation" indicator.
3. **Session-persistence contract (the load-bearing engineering change).** Clicking a conversation for the first time in a page-load mounts its view and opens its connection. Clicking a different conversation HIDES the previous view (e.g. `display:none` or an equivalent that preserves DOM state, WebSocket lifecycle, and React state) but does NOT unmount it. Clicking back returns instantly with no reconnect. Persistence is in-memory only; a full browser refresh resets everything from scratch. The concrete mechanism (single-mounted-tree-with-visibility-toggle vs. multi-mounted-tree-with-z-index-swap vs. React portal per session) is a planner call — the OBSERVABLE contract is what matters, not the implementation shape.
4. **Mobile — list-vs-view two-screen flow.** On viewports where `useIsTouchDevice()` returns true, list and view are two distinct screens (never both visible). Tapping a list row navigates into the conversation; a top-left back button returns to the list. Browser back gesture also works. The current mobile bottom navigation bar is deleted entirely as a surface — its destinations migrate to the settings surface below.
5. **Desktop — sidebar collapse behavior preserved verbatim.** The existing thin-clickable-strip idle state stays as-is; expanded/collapsed is a persisted preference across page loads. This part is a "do not touch" for the phase.
6. **Per-session pin capability.** Sessions can be pinned/unpinned individually; pinned sessions float to the top of the list above host-grouped rows. Pin state is per-session (session ending clears its pin along with the row).
7. **New-session button on the list view.** A visible button (both mobile and desktop, positioned to not compete with pinned or active rows for attention) opens a host picker; user picks a host + provides a session name; new session opens. Affordance shape (modal / slide-in / popover), mobile position (top-of-list vs. FAB), and name-mandatory-vs-optional are planning decisions.
8. **Settings surface migration.** The destinations currently reachable through the mobile bottom navigation (host manager, credentials editor, and adjacent admin surfaces) migrate to a small gear icon in the sidebar header on desktop and to a settings row on mobile positioned somewhere in the list view that does not compete for prime attention. The destinations themselves are unchanged; only the entry points relocate.

Phase 6 does NOT touch: pretty-view internals (chat rendering, ComposeBox, WipBubble, PlanPendingBubble, session-changeover banners, ambient panels — everything under `src/ui/features/pretty-view/**` is stable), the terminal rendering pipeline, the RDP/VNC/guac panes, the session-file tail/WS bridge, the identity registry, host records, credentials editor internals, Filestash, Caddy, the deploy pipeline. If the planner surfaces tasks in those areas, that is a scope violation — this phase reshapes navigation chrome only.

</domain>

<decisions>
## Implementation Decisions

All items below are **LOCKED** by the shape file — do NOT re-open them during planning. Where the shape used "planner's call" the planner still has room; those cases are flagged explicitly.

### The list (TG-01, TG-02)

- **Flat single-select list of currently-active sessions.** No tab strip. No secondary view slot. No side-by-side. One conversation visible, ever.
- **Grouped visually by host with separators.** The current expanding sidebar already does this — reuse the existing grouping mechanism, don't invent a new one. Whatever visual treatment the sidebar uses today for host separators stays.
- **Order below the pins = current sidebar host-tree order.** No new sort rule, no recency-shuffle, no alphabetical override. "The way it currently works is fine" (Ashley 2026-07-21). This means RDP-at-bottom falls out naturally from where RDP hosts sit in the tree today; no explicit sort rule for RDP is needed.
- **Session-ended = row vanishes.** Same lifecycle as today's tabs — the list only ever shows live sessions. No tombstones, no "ended" indicator, no history, no scrollback for ended sessions. If a session dies, its row disappears.
- **Pins float above host-grouped rows.** Per-session (not per-host). Pin state is session-scoped: session ends → row and pin gone together. No pin-cap, no drag-to-reorder (both explicitly out).
- **Planner call:** The concrete visual treatment for the "pinned" section header (or lack thereof — pins may simply appear at the top without any explicit "Pinned" label if that reads cleanly), and whether the pin action is a per-row icon vs. a right-click/long-press menu, is planner's discretion. Whatever fits the existing sidebar chrome.

### Single-view + session persistence (TG-03, TG-04, TG-05)

- **Only ONE conversation visible at a time.** Tab strip deleted. No "recent tabs" shelf, no split-view. The sidebar row's selected state is the ONLY "which conversation" indicator.
- **Internal experience of a conversation is UNCHANGED.** Identity-attached Claude sessions → pretty view. Plain SSH sessions → terminal. RDP hosts → remote desktop. The innards of each session-type view are not touched by this phase. If a specific integration point in the pretty view (e.g. how the pane receives its parent's "you are now visible / hidden" signal) needs a small hook, that's fine — but any behavioral change to what the user sees inside a mounted pretty view is out of scope.
- **Session persistence within a page-load = mounted-and-hidden, not unmounted-and-remounted.** OBSERVABLE contract: switching from A to B and back to A must be instantaneous with zero reconnect, zero terminal-buffer loss, zero pretty-view-scroll-position reset, zero ambient-panel state loss, zero WebSocket teardown. A must be indistinguishable from having never left.
- **Persistence is page-load scoped.** A full browser refresh resets everything from scratch — no persistence to localStorage / sessionStorage / any browser storage layer. This is a deliberate simplifier: no serialization contract, no crash-recovery-restore code path, no stale-tab confusion.
- **Planner call:** The mechanism for "mounted but hidden" is planner discretion. Two candidate shapes:
  - **A. Single mounted tree with visibility toggle.** All ever-clicked sessions live in a single tree of mounted components; a CSS-driven `display:none` (or equivalent) hides all but the selected one. Simpler, no portal boundary. Risk: some interactive UIs (guacd RDP canvas, xterm.js) may not tolerate `display:none` cleanly (canvas resize on show, keyboard focus routing).
  - **B. Multi-mounted with z-index / absolute positioning.** Sessions stack in the DOM; the visible one is on top. Handles keyboard focus + canvas measurement more cleanly, at the cost of layout complexity.
  - Planner picks based on how the current tab implementation already handles unfocused-but-mounted tabs — extend the same mechanism rather than inventing a new one.
- **Existing tab-focus signal handling.** The current tab manager (or equivalent) already routes "you are now focused / unfocused" signals to mounted panes. That signal contract must be preserved through the rewiring — pretty-view's PlanPendingBubble, WipBubble, session-changeover holding banner, and MessageQueueDrawer all rely on knowing whether their pane is user-visible. Any change to focus signalling is a compat regression.

### Mobile flow (TG-06, TG-07)

- **List and view are two distinct screens.** Never both visible on mobile. Tap row → navigate to view; back button → navigate to list. The "in view" state visually replaces the list, and vice versa. NOT a peek/panel/overlay — a full screen swap.
- **Top-left back button on the view screen.** Native mobile pattern. Also wired to the browser back gesture (fragment or history entry — see below).
- **Browser back also works.** URL fragment or history entry stack such that pressing hardware/browser back from a view lands on the list; from the list, browser back leaves Termix. Consistent with the existing `#tab=xxx` fragment pattern from patch #25 (which was learned-the-hard-way to survive Chrome window-restore) — the equivalent under this phase is probably `#conv=<session-id>` or `#list`. Planner picks the exact scheme; must survive whole-window restore per the patch #25 learning.
- **Bottom navigation bar DELETED entirely.** Whatever mobile-only gate the current bottom nav sits behind (`useIsTouchDevice()` per the recent gating patch) — the entire bottom-nav surface is removed from the tree. Not conditionally rendered based on a state; simply gone.
- **`useIsTouchDevice()` is the mobile-vs-desktop signal.** Not viewport width. This is the same gate that patch #103 (or whichever recent one shipped the mobile-only bottom-nav gate) uses. Reuse verbatim; do not introduce a second detection mechanism.

### Desktop sidebar collapse (TG-08)

- **Preserve current collapse behavior VERBATIM.** Thin-clickable-strip idle state; click to expand; persisted preference across page loads. No changes to the mechanism. This is a "do not touch" for the phase.
- **When the sidebar is collapsed, the conversation view takes the freed real estate.** That's already the current behavior; the phase just needs to keep it working under the new selection semantics.

### New-session button + host picker (TG-09)

- **Visible button on the list view, both mobile and desktop.** Not tucked in a menu, not gated behind a keyboard shortcut.
- **Not competing with pinned or active rows for attention.** Top-of-list (above pins) is fine; a floating action button at the bottom on mobile is fine; a plus-icon in the sidebar header is fine. The constraint is "visible without demanding attention."
- **Picker flow:** user picks a host → provides a session name → new session opens.
- **Planner call:** Affordance shape (modal, slide-in from side, popover, inline expansion), mobile position (top vs. FAB), and whether the session name is mandatory-up-front vs. optional-with-default-from-tmux-window-title (patch #NN, the fork's `feat/tab-title-from-tmux` behavior) are all planning-phase decisions. Whichever picker shape reads best with the rest of the fork's UI is fine.
- **On new-session-created:** the new row appears in the list AND becomes the currently-selected view (i.e. auto-navigate to the new session). Not silent-add-to-list-and-let-user-click.

### Settings surface migration (TG-10)

- **Destinations preserved, entry points relocated.** The routes / views for host manager, credentials editor, and adjacent admin surfaces do not change — only where the user reaches them changes.
- **Desktop:** small gear icon in the sidebar header. Unobtrusive.
- **Mobile:** a settings row somewhere in the list view — planner picks the exact position, constrained to "not at the top competing with pins / active rows for attention." Options include: bottom of the list; between the pins section and the host-grouped section (with a divider); as a fixed row above the new-session button. Whichever fits the visual chrome.
- **The bottom-nav destinations are:** host manager, credentials editor, and adjacent admin surfaces — planner should enumerate these by inspecting the current bottom-nav component's contents and preserve every destination the bottom nav currently reaches.

### Ended-session lifecycle (TG-01 subset)

- **No history, no tombstones, no ended-state indicator, no scrollback for ended sessions.** When a session ends, its row simply vanishes from the list. Same behavior as today's tab-close.
- **Explicit non-goals here (do NOT accidentally implement any of these):**
  - "Recently closed" section at the bottom of the list
  - Re-open-ended-session gesture
  - Session end reason indicator (crashed / disconnected / normal exit)
  - Grey-out-instead-of-vanish transition

### Full-replacement, not additive mode (TG-11)

- **Tab strip is deleted unconditionally.** No feature flag, no user-facing toggle to "restore tab view," no A/B, no config setting. Ashley wants full replacement; a version that keeps both modes is explicitly WRONG (per shape file's "What would make it wrong").
- **Currently-open tabs on ship-day are free-fire.** No migration story. Users may need to re-open sessions after the deploy; that's fine.
- **Deploy behind the standard fork deadman** (see `deploy-runbook.md` under Tina's identity). This is a substantial user-visible change, so the deadman + narrow-`pkill` disarm-on-Ashley-engagement pattern is especially important here.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape agreement (authoritative)
- `.planning/shapes/shape-telegram-like-interface.md` — the shape file. LOCKED. Every "philosophy" and "would make it wrong" statement here is a hard constraint on the plan.

### Requirements
- `.planning/REQUIREMENTS.md` § Telegram-like Interface (Phase 6) — TG-01..TG-11.

### Related shipped work (context for the "existing behavior to preserve" side)
- Patch #43 (pretty session view — the pretty view itself, not touched here but critical that it stays working under new mount lifecycle).
- Patch #NN (the recent one that added `useIsTouchDevice()` gating for the mobile bottom nav — Phase 6 both consumes that hook AND removes the bottom nav entirely, so the gate becomes moot).
- Patch #NN (the recent one adding the sidebar's expanding + thin-strip-when-collapsed behavior — Phase 6 preserves this verbatim, do not touch).
- Patch #25 (URL fragment survives Chrome window-restore, `#tab=xxx` — the mobile back-button URL scheme in Phase 6 must apply the same lesson).
- Patch #17 / #38 (identities registry + identity badge — used INSIDE conversation views, not touched by Phase 6 chrome changes).

### Fork operating baseline
- `~/.claude/identities/tina/box-map.md` — Termix operational context (docker stack, managed hosts, ops commands).
- `~/.claude/identities/tina/termix-patches.md` — full catalog of the 104 shipped patches on top of upstream v2.3.x. Downstream agents should scan this for any patch touching sidebar / tab-manager / mobile-chrome to understand what's already there.
- `~/.claude/identities/tina/deploy-runbook.md` — mandatory deadman + deploy flow for the fork. Any plan whose acceptance criteria includes "deploy" must reference this runbook.

### Existing GSD phase artifacts (for reuse of pattern + integration hooks)
- `.planning/phases/05-pretty-view-file-upload-support/05-CONTEXT.md` — pattern reference for how a Termix fork phase's CONTEXT.md is structured.
- `.planning/phases/02-toggle-compose-native-web-ergonomics/02-*.md` — reference for how tab-and-mode navigation has been reshaped in prior phases.

</canonical_refs>

<specifics>
## Specific Ideas + Integration Points

Concrete things the planner will need to touch or understand. These are not exhaustive — the planner will discover more during codebase mapping — but they name the load-bearing surfaces so the planner can find them fast.

### Current surfaces that change
- **Sidebar component (expanding, collapsible).** Currently presents a host tree with per-host session children. Under Phase 6: reshaped into a flat single-select list with pins on top, host-grouping preserved via visual separators, plus new-session button and (on desktop) gear icon.
- **Tab strip in the main view area.** Currently renders a strip of tabs across the top of the main content region. Under Phase 6: deleted entirely. The main view is a single-slot region that renders whichever conversation is currently selected.
- **Tab manager / pane store.** Whatever state layer currently tracks "which tabs are open, which is focused." Under Phase 6: reshaped so that "which conversations have ever been clicked this page-load" is a set of mounted-but-possibly-hidden panes, and "which is currently visible" is a single selected-session pointer. Selecting a session either mounts it (first click) or reveals it (subsequent click).
- **Mobile bottom navigation bar.** Currently rendered on `useIsTouchDevice()`. Under Phase 6: deleted entirely.
- **Routing / URL state.** Currently `#tab=xxx` (from patch #25) tracks the active tab. Under Phase 6: some equivalent fragment (`#conv=<id>` or `#list`) tracks the currently-visible conversation and the "am I on list or view" state on mobile. Must survive Chrome window-restore per the patch #25 learning.

### Signals to preserve through the rewiring
- **Per-pane visibility signal.** The current tab-manager signals visibility state changes (visible / hidden) to mounted panes. This signal is consumed by pretty view's WipBubble (throttle rendering when hidden?), PlanPendingBubble (same), MessageQueueDrawer (auto-close behavior on send-empties-queue relies on the pane being visible), and session-changeover banners. Whatever new selection mechanism replaces the tab manager MUST route the same visibility signal to every mounted pane, with the same semantics.
- **Keyboard focus routing to xterm.js and guacd canvas.** Currently the focused tab receives keyboard events. Under Phase 6, the visible session must receive them; hidden sessions must not. If `display:none` breaks keyboard focus routing on any browser, planner picks a different hide mechanism.
- **Canvas resize on show.** guacd's RDP canvas and xterm.js's terminal both may need to react to being shown after being hidden (viewport dimensions may have changed). Planner ensures this works.

### New surfaces
- **New-session button (list-view chrome).** Visible on both mobile and desktop. Opens a host picker.
- **Host picker (modal / slide-in / popover — planner call).** Lists hosts from the existing host registry; on selection, prompts for a session name; on submit, creates and auto-navigates to a new session.
- **Gear icon (desktop sidebar header).** Opens the settings-surface router — same destinations that the mobile bottom nav used to route to.
- **Settings row (mobile, in list view).** Same routing, different entry point.
- **Mobile top-left back button (view-screen chrome).** Visible only when a conversation is being viewed on a mobile viewport. Also wired to the browser back gesture.

### Behavior touchpoints — deliberate reuse
- **`useIsTouchDevice()`** — the exact same hook the current bottom-nav uses. Consumed by: the "should I be in mobile mode" logic (list-vs-view flow, back button visibility, new-session button position). Do NOT introduce a second touch/mobile detection mechanism.
- **URL fragment persistence pattern from patch #25.** The mobile flow's URL state must survive Chrome window-restore. Reuse the fragment approach, not query params.
- **Sidebar's current collapse mechanism.** Preserved verbatim. Any change here is a scope violation.

### Behavior touchpoints — deliberate replacement
- **The tab-manager as a mental model.** Every place in the code that reasons about "tabs" needs to be reshaped to reason about "conversations" (a set of mounted sessions with exactly one currently visible). Do NOT leave the tab-manager as a hidden intermediary that maintains a 1:1 mapping with conversations — the mental model change is part of the shape.

</specifics>

<deferred>
## Deferred Ideas

Items explicitly acknowledged during shape conversation but deferred to a later version.

### Deferred to v2 (worth having eventually)
- **Any per-conversation activity/unread signal.** Dots, badges, counts, motion, sound. Ashley said "we can save it for version two" on 2026-07-21. Do NOT preemptively wire in any signal channel; do NOT leave hooks that would silently emit signals if a future flag turned them on.

### Out entirely (no v2 promise)
- **Cross-conversation search.** Ashley said "I don't need it" on 2026-07-21. Not v2, not later — out.
- **A folder / nested-grouping concept above host separators.** Explicitly ruled out. The flat host-grouping with separators is the whole grouping story.
- **Drag-to-reorder for pins.** Simple pin-toggle only; pin order = pin-creation order or host-tree order. No drag reorder.
- **History / scrollback for sessions that have already ended.** Ended sessions vanish; there is no "look at what was said" after the fact.

### Tempting but explicitly not in scope
- **Persisting the currently-selected conversation across browser refreshes.** In-memory only; refresh = clean slate.
- **Auto-restoring the "last set of open conversations" on a fresh page load.** Would require serialization + reconnect orchestration; explicitly out.
- **A per-session view toggle that flips pretty view to raw terminal for debugging on mobile.** Ashley: "I don't need something on mobile to access the underlying session." Desktop already has an existing keyboard shortcut for this, preserved.

</deferred>

<scope_fence>
## Scope Fence — what would violate this phase

Any of the following is a scope violation and must be caught in the plan-checker / verification passes:

1. **A plan that changes behavior INSIDE a mounted pretty view / terminal / RDP pane.** Phase 6 is chrome + selection semantics only. If a plan touches `src/ui/features/pretty-view/**` for reasons other than integrating with a new pane-visibility signal from the selection layer, that plan is out of scope.
2. **A plan that ships the new list layout AND leaves the tab strip functional as a parallel mode.** Full replacement is the shape. A parallel-mode ship is explicitly WRONG.
3. **A plan that ships the sidebar reshape without the session-persistence contract.** Switching between conversations MUST be hide-not-unmount from the first shipped plan onward; otherwise every switch drops the WS and Ashley experiences it as worse than tabs.
4. **A plan that keeps the mobile bottom navigation bar in any form on mobile.** Its destinations migrate to the settings surface; the bar itself is deleted as a UI element.
5. **A plan that adds an activity/unread indicator "as a placeholder for v2."** Deferred means deferred — no placeholder chrome, no dormant signal channel, no "if flag enabled" branches.
6. **A plan that introduces a second mobile-vs-desktop detection mechanism** (viewport width, media query, user-agent) instead of consuming `useIsTouchDevice()`.
7. **A plan that changes the desktop sidebar collapse behavior in any way.** The thin-strip-when-collapsed mechanism is preserved verbatim.
8. **A plan that adds history / scrollback / ended-session persistence.** Ended sessions vanish; if a plan introduces a "recently ended" section or a re-open gesture, it's out of scope.
9. **A plan that reorders the sidebar by recency / alphabetically / any rule other than the current host-tree order.** "The way it currently works is fine" (Ashley 2026-07-21).
10. **A plan whose deploy step does not reference `deploy-runbook.md` and the mandatory deadman.** This is a substantial user-visible change; the standard fork deploy discipline applies.

</scope_fence>

<success_criteria>
## Success Criteria (goal-backward)

The phase is DONE when all of the following are true from Ashley's perspective on the deployed fork:

1. **Sidebar shows a flat list of currently-active sessions, grouped by host with separators, pins on top.** No tab strip anywhere. Rows disappear the moment a session ends.
2. **Clicking a sidebar row displays that conversation in the main view; only one is visible at a time.** No side-by-side, no stacked tabs.
3. **Clicking away and back to a conversation is instant with no reconnect or state loss.** Terminal buffers, pretty-view scroll positions, ambient-panel state, WebSocket connections all preserved across switches within a page-load.
4. **Refreshing the browser resets everything from scratch.** No session auto-restore, no persisted selection.
5. **On mobile, tapping a list row navigates to a full-screen conversation view with a top-left back button.** The list is not visible while viewing. Bottom nav bar is gone.
6. **Mobile browser-back from view returns to list; from list, leaves Termix.**
7. **A visible new-session button on the list view opens a host picker and creates + navigates to a new session.**
8. **Admin destinations (host manager, credentials editor, etc.) reachable through a small gear icon on desktop and a settings row on mobile that doesn't compete for prime attention.**
9. **A session can be pinned; it floats to the top of the list above host groups. Unpinning drops it back into its host group. Session-end clears pin + row together.**
10. **Deployed behind the fork's mandatory 15-min deadman rollback.** No exceptions.

If Ashley's UAT reveals ANY of these does not hold, the phase is not done.

</success_criteria>

---

*Phase: 06-telegram-like-interface*
*Context gathered: 2026-07-21 via `/open` → CONTEXT.md synthesis from shape file*
*Bounty tracker: `~/.claude/identities/tina/bounties/telegram-like-interface/` (flips to in_progress when Plan 06-01 enters execution)*
