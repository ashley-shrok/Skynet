# Phase 7: Fleet-native conversation list — Context

**Gathered:** 2026-07-21
**Status:** Ready for planning
**Source:** Synthesized from shape file `.planning/shapes/shape-fleet-native-conversation-list.md` — that file is authoritative and every philosophical / scope-edge question was locked during a `/open` discussion with Ashley on 2026-07-21 (see the shape's "What would make it wrong" and "Scope edges" sections for provenance). This CONTEXT.md restates the shape as locked planning decisions plus the concrete Termix-fork integration points. **The shape is not to be re-litigated; the planner's job is HOW, not WHAT.**

<domain>
## Phase Boundary

Phase 7 is a follow-up to Phase 6 addressing the two UAT gaps Ashley surfaced on 2026-07-21 after patch #105 shipped: (a) a small chrome bug where the mobile settings surface renders in duplicate (header gear AND bottom settings row both visible on mobile, both routing to the same menu), and (b) the load-bearing shape gap where the conversation list's data source mirrored only the browser-tab's currently-open Termix tabs, causing a fresh mobile page-load to show "no active conversations" even when Ashley had running sessions across her fleet.

Scope:

1. **Reshape the conversation-list data source from "openTabs mirror" to "fleet-native + openTabs union."** The store gets a NEW upstream input alongside the existing openTabs input: a snapshot of every tmux session on every reachable host, discovered the same way the current sidebar host-tree + double-shift menu discover them. The row set is `fleet-discovered ∪ openTabs`, deduplicated by session identity (host + tmux-session-name pair). Every visible row that Phase 6 already renders continues to render; net-new to Phase 7 are the "detached" rows — sessions discovered on hosts but not yet clicked in this browser tab.
2. **Render remote-desktop host rows at the bottom of the list.** One row per RDP-enabled host, monitor icon in the avatar slot, no identity hue, no identity name — just the host name + monitor glyph. Persistent as fleet fact (row exists as long as the host is RDP-enabled, regardless of whether an RDP tab is currently open).
3. **Re-style the existing New Session button as the Telegram-native pencil.** Function unchanged (pick a host, name a session, opens as identity tmux row); only the visual affordance changes. This is the ONLY creation button — plain SSH one-shot shells are explicitly not in the list, and the pencil is not overloaded to create them.
4. **Fix the mobile gear/settings-row duplication.** The gear icon in the ConversationsPanel header renders on desktop viewports only; the settings row inside the ConversationsPanel scroller renders on mobile viewports only. Neither renders in both places.
5. **Snapshot-on-page-load discovery, no polling.** The fleet-discovery signal fires once on mount and populates the store's `fleet` input. No polling, no push, no live-update chrome. Ashley refreshes to update.

Phase 7 does NOT touch: any tab lifecycle mechanism (how RDP tabs disconnect/reconnect, how identity-tmux sessions attach/detach, how pretty view mounts on identity resolution — all preserved verbatim from today's behavior), any pretty-view internals, any Terminal.tsx behavior, any RDP/guac backend behavior, any backend session-file tail / WS bridge, any nginx / caddy / docker configuration, any host record CRUD, any identity registry behavior, any package.json dependencies. This phase is a data-source reshape and a rendering addition; the tab machinery underneath is left alone.

</domain>

<decisions>
## Implementation Decisions

All items below are **LOCKED** by the shape file — do NOT re-open them during planning. Where the shape used "planner's discretion" the planner still has room; those cases are flagged explicitly.

### Data source reshape (TG-12, TG-13, TG-14)

- **Fleet-native input added to the conversation-store.** The store currently consumes `openTabs` (from AppShell's tab state) as its row source. This phase adds a NEW input: `fleetSessions` — a snapshot of every tmux session on every reachable host, sourced from the same signal the current sidebar host-tree consumes. The store's derived row list becomes `fleet ∪ openTabs`, deduplicated by session identity (host id + tmux session name / id).
- **Session identity for dedup.** A row is the same session iff the (host id, tmux session name/id) pair matches. When both `fleetSessions` and `openTabs` contain a row for the same identity, they collapse to a single row — the openTabs entry wins for anything the store already tracks (pin state, selection state, per-tab metadata), and fleetSessions contributes only the discovery signal ("this exists on the box").
- **Snapshot on page-load, no polling (TG-17).** The `fleetSessions` input fires ONCE on component mount (the initial React effect that dispatches the discovery fetch). It does NOT re-poll on an interval, does NOT subscribe to real-time push, does NOT re-fetch on window focus or tab visibility change. If a session dies on a box Ashley isn't looking at, the row persists in the list stale until she refreshes. Explicitly agreed by Ashley: "I can refresh if I need to see the latest list."
  - **Planner reuse-vs-fresh call:** the current sidebar host-tree already fetches host data and knows about tmux sessions per host. If reusing that data source comes with polling attached, planner MUST disable the polling for the new list's purposes OR extract the one-shot fetch so the polling doesn't manifest as visible list mutations after page-load. Snapshot-on-load is the shape lock; free polling that leaks into visible mutations violates the shape.
- **No attached/detached visual distinction (TG-13).** A row that has been clicked earlier this page-load (WebSocket open, pane warm) MUST look identical to a row that has not been clicked yet (exists on the box, not-yet-mounted). No brightness delta, no italic, no dot, no per-row indicator, no spinner-visible-only-for-detached. Rows are rows.
- **Click-a-detached = transparent attach + mount + show (TG-14).** The user experience of clicking a detached row is functionally identical to clicking an attached row — no dialog, no confirmation, no separate "connect" step. Under the hood, clicking a detached row triggers `openTab(host, type, sessionName, opts)` (existing Phase 6 mechanism, reused verbatim) followed by `selectConversation(newTabId)` — the row's row-state changes from detached to attached, and it renders in the main view slot. From Ashley's perspective it's "click, see it."

### RDP row rendering (TG-15)

- **One row per RDP-enabled host.** Ashley confirmed: "we don't really have a concept of multiple RDP sessions per host, so it would just be one per host."
- **Row content: monitor icon + host name.** No identity hue, no avatar, no identity name. The monitor icon takes the avatar slot; the row otherwise matches the visual chrome of the identity-tmux rows (same row height, same click affordance, same host-name treatment).
- **Placement: bottom of the list.** Below pins, below identity-tmux rows in the current sidebar's host-tree order. RDP rows form a distinct bottom section, either with a visual separator between them and the identity-tmux section above, or (planner's call) implicitly by grouping. On both mobile and desktop.
- **Click = attach + mount + show.** Same as identity rows. Uses the existing RDP tab lifecycle mechanism (unchanged from Phase 6 and today).
- **Row persistence tied to RDP-enabled host fact, NOT tab state.** The row exists as long as the host is RDP-enabled (per host record), regardless of whether an RDP tab is currently open. If the RDP tab dies server-side, the row stays (because the desktop is still available as a fleet fact); if the host record's RDP-enabled flag is turned off, the row vanishes.
- **Pin capability on RDP rows: planner's call.** Ashley said "I don't think I really care if you could pin them or not, whatever's easier." Simplest is probably no-pin (RDP rows can't move above other RDP rows meaningfully, and they're already grouped at the bottom); the store's existing pin mechanism can be extended if pinning is trivial or left off if it isn't. Not shape-load-bearing.

### Pencil re-style (TG-16)

- **Same button, different visual.** The existing New Session button (added in Phase 6, Plan 06-04) is re-styled as the Telegram-native pencil-analog. Function is UNCHANGED — pick a host, name a session, open. The dialog / host picker / session-name capture flow is exactly what Phase 6 shipped; the button that opens the dialog gets a new icon (pencil glyph) and possibly a new position (see below).
- **Placement: planner's discretion.** Ashley: "not too worried about the pencil placement." Two Telegram-native defaults to consider:
  - Per-viewport: FAB bottom-right on mobile, small pencil icon in the sidebar header on desktop.
  - Consistent-both-viewports: top-of-list button on both (matches Phase 6's current position).
  - Either is fine. Planner picks based on visual chrome fit.
- **This is the ONLY creation button.** Plain SSH creation is explicitly NOT in scope — Ashley never creates plain-SSH sessions in her workflow, so no second affordance is added. The pencil creates a new tmux session (identity workflow); Ashley does the identity setup inside the pane (cd, start claude-code, run `/id`).
- **New-session flow behavior UNCHANGED from Phase 6.** Pick host, name it (empty allowed — auto-fills from tmux window title per the fork's feat/tab-title-from-tmux behavior), open, auto-navigate to view on mobile. The pending-select-id race defense from Plan 06-04 stays as-is; do not re-implement.

### Mobile gear/settings-row duplication fix (TG-18)

- **Cause of the current duplication.** In `src/ui/sidebar/ConversationsPanel.tsx`, `showGear = typeof onRailClick === "function"` — gated only on whether the `onRailClick` prop was passed, not on viewport. On mobile, the gear renders in the header AND the SettingsRow (mounted in Plan 06-03's mobile flow) renders at the bottom, both routing to the same menu.
- **Fix shape:** gate `showGear` on `!useIsTouchDevice()` (in addition to the existing `onRailClick` typeof check) so the gear renders on desktop viewports only. The SettingsRow's existing render condition (mobile-only, via Plan 06-03's `isTouchDevice` gate in AppShell) stays unchanged. Result: desktop sees gear (no settings row), mobile sees settings row (no gear), neither sees both.
- **Both entry points continue to route to the same menu.** No change to what happens after the user opens the menu; only which entry point renders where.

### Scope-fence discipline (Ashley's explicit lock)

- **Tab lifecycle is UNTOUCHABLE.** RDP tab disconnect/reconnect behavior, identity-tmux session attach/detach behavior, pretty-view mount-on-identity-resolution, session-persistence-within-page-load (Plan 06-02's tabNodesRef DOM-move mechanism), URL fragment scheme (patch #25 + Plan 06-03's `#mv=1` extension), any per-pane visibility signal contract — ALL preserved verbatim. Ashley: "under the hood of this conversation list, we are still using the tabs. And so I feel like we really don't need to be adjusting that stuff."
- **Pretty-view internals UNTOUCHABLE.** `src/ui/features/pretty-view/**` — same rule as Phase 6, no touches.
- **Terminal.tsx UNTOUCHABLE.** Same rule as Phase 6.
- **Guacamole / RDP backend UNTOUCHABLE.** Same rule as Phase 6.
- **Backend UNTOUCHABLE.** `src/backend/**` — no changes. The fleet-discovery signal already exists (whatever the current sidebar host-tree consumes); this phase reuses it.
- **`package.json` UNTOUCHABLE.** No new dependencies.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape agreements (authoritative)
- `.planning/shapes/shape-fleet-native-conversation-list.md` — this phase's shape. LOCKED. Every "Philosophy" and "What would make it wrong" statement is a hard constraint.
- `.planning/shapes/shape-telegram-like-interface.md` — Phase 6's shape, which this phase extends. Also LOCKED. This phase's scope fence inherits verbatim from Phase 6's.

### Phase 6 planning + summary artifacts (integration points)
- `.planning/phases/06-telegram-like-interface/06-CONTEXT.md` — Phase 6's decisions, especially §Signals to preserve through the rewiring (the per-pane visibility signal contract that any store change must preserve).
- `.planning/phases/06-telegram-like-interface/06-01-SUMMARY.md` — conversation-store public API surface (updateHostTree, updateOpenTabs, useSelectedConversationId, selectConversation, selectConversationDeferred). Phase 7 EXTENDS this store with a new `fleetSessions` input; do not replace the existing inputs.
- `.planning/phases/06-telegram-like-interface/06-02-SUMMARY.md` — atomic-swap outcomes, tabNodesRef DOM-move preservation, SettingsRow location. The `showGear` line that needs the `!useIsTouchDevice()` gate lives here.
- `.planning/phases/06-telegram-like-interface/06-03-SUMMARY.md` — mobile-flow module, `#mv=1` URL fragment scheme, navigateToView / navigateToList exports, SettingsRow mount location on mobile.
- `.planning/phases/06-telegram-like-interface/06-04-SUMMARY.md` — new-session flow (pick host + name + open + auto-navigate), selectConversationDeferred race defense, NewSessionButton + NewSessionDialog components (the pencil re-style targets NewSessionButton's visual only).

### Requirements
- `.planning/REQUIREMENTS.md` § Fleet-native Conversation List (Phase 7) — TG-12..TG-18.
- `.planning/REQUIREMENTS.md` § Telegram-like Interface (Phase 6) — TG-01..TG-11 (preserved verbatim; Phase 7 does not modify any Phase 6 requirement).

### Fork operating baseline
- `~/.claude/identities/tina/box-map.md` — Termix operational context.
- `~/.claude/identities/tina/termix-patches.md` — full patch catalog through patch #105 (Phase 6). Phase 7 will be pinned as patch #106 (or next available at ship time).
- `~/.claude/identities/tina/deploy-runbook.md` — mandatory deadman + deploy flow.

</canonical_refs>

<specifics>
## Specific Ideas + Integration Points

Concrete surfaces the planner will need to touch or understand. Non-exhaustive — the planner will discover more during codebase mapping — but names the load-bearing surfaces.

### Surfaces that change

- **Conversation-store (`src/ui/state/conversation-store.ts`).** Add a new input `fleetSessions: FleetSession[]` and an updater `updateFleetSessions(sessions)`. Extend the derived row list to be `fleet ∪ openTabs` deduplicated by session identity. Extend the derived row list rendering to include RDP-host-derived rows at the bottom. Preserve every existing input (openTabs, hostTree, pinnedIds) and every existing hook (useConversations, useSelectedConversationId, usePinnedIds, selectConversation, selectConversationDeferred, pinConversation, unpinConversation) with unchanged public semantics.
- **ConversationsPanel (`src/ui/sidebar/ConversationsPanel.tsx`).** `showGear` gate becomes `typeof onRailClick === "function" && !useIsTouchDevice()`. NewSessionButton visual re-style (icon change from generic to pencil glyph; possibly position change if planner picks per-viewport placement — Phase 6 currently mounts it top-of-scroller). RDP row rendering path added at the bottom of the scroller.
- **AppShell (`src/ui/AppShell.tsx`).** Wire the fleet-discovery signal into the conversation-store: on mount, fetch the fleet's tmux sessions across all reachable hosts (reusing whatever signal the current sidebar host-tree consumes) and call `updateFleetSessions(...)` once. If the current sidebar's host-tree fetch mechanism includes polling, either extract a one-shot variant or disable the polling for the store's purposes.
- **NewSessionButton (`src/ui/sidebar/NewSessionButton.tsx`).** Icon re-style to pencil glyph. If placement changes to per-viewport (FAB on mobile, header icon on desktop), the mount point in ConversationsPanel adjusts and the button itself may need a variant prop.

### Signals to preserve through the rewiring

- **Per-pane visibility signal.** Phase 6's contract: the store's `selectedId` drives AppShell's `effectiveSelectedTabId`, which drives the `activeInline` calc, which drives which mounted pane receives the "visible" signal (consumed by WipBubble, PlanPendingBubble, MessageQueueDrawer, SessionHoldingOverlay). Adding fleet rows to the store MUST NOT change this contract — a detached row that becomes selected still needs to attach + mount + become visible via the same signal path.
- **Session-persistence within page-load.** Plan 06-02's tabNodesRef DOM-move mechanism (AppShell.tsx lines 280-293 and 1133-1176) is byte-for-byte preserved. Selecting a fleet-native row that becomes attached must plug into the same DOM-move mechanism; the store's `selectedId` still drives `effectiveSelectedTabId`, unchanged.
- **URL fragment scheme.** Patch #25's `#tab=X&tab=Y&active=N` for tab persistence and Plan 06-03's `#mv=1` for mobile list-vs-view state both stay as-is. Fleet-native rows don't need their own URL representation — they're a rendering of the discovery signal, not persisted state.
- **`useIsTouchDevice()` hook.** Sole mobile-vs-desktop detection mechanism. Used to gate `showGear` (new in this phase) alongside its existing use by mobile-flow (Phase 6) and MobileBottomBar-deletion decisions. Do NOT introduce a second detection mechanism.

### New surfaces
- **FleetSession type + updateFleetSessions action.** New store input alongside openTabs/hostTree. Shape roughly `{ hostId: string, sessionName: string, sessionId?: string, hasClaudeAttached?: boolean }`.
- **RDP row render path.** New branch in the row-render loop that emits RDP rows below the identity-tmux group. Uses the host record's RDP-enabled flag as the source.
- **Fleet-discovery fetch invocation.** Wherever it lives (AppShell mount effect, ConversationsPanel mount effect — planner's call), it must be a one-shot call, not a poll.

### Behavior touchpoints — deliberate reuse
- Existing sidebar host-tree fleet-discovery signal (whatever backend endpoint / store the current sidebar consumes to know about hosts + their tmux sessions).
- Existing `openTab(host, type, sessionName, opts)` flow (Plan 06-04).
- Existing `selectConversationDeferred(newTabId)` race defense (Plan 06-04).
- Existing tabNodesRef DOM-move persistence mechanism (Plan 06-02).
- Existing mobile-flow (`navigateToView`, `navigateToList`, `#mv=1` fragment, `useMobileScreen` hook — all from Plan 06-03).
- Existing NewSessionDialog (Plan 06-04) — the pencil button opens THIS dialog, unchanged.

### Behavior touchpoints — deliberate no-touch
- Backend fleet-discovery mechanism (already exists; don't re-implement).
- Tab lifecycle for any tab type (identity-tmux, plain-SSH, RDP).
- Pretty-view mount-on-identity-resolution.
- The entire `src/ui/features/pretty-view/**` tree.
- `src/ui/features/terminal/Terminal.tsx`.
- `src/ui/features/guacamole/**`.
- `src/backend/**`.
- `docker/**`.
- `package.json`.

</specifics>

<deferred>
## Deferred Ideas

### Deferred to v2 (from Phase 6, still deferred)
- Any per-conversation activity/unread signal — dots, badges, counts, motion, sound.

### Out entirely (this phase's own additions to the "out" list)
- Real-time polling / push / notification chrome of any kind on the conversation list.
- Plain-SSH host rows in the list.
- Any visual attached-vs-detached distinction.
- A second creation affordance for plain-SSH or any non-identity-tmux flow.
- Cross-device / cross-session state sync (a session created on Ashley's phone doesn't automatically show up on her desktop without a refresh).

### Tempting but not in scope
- Persisting the currently-selected conversation across browser refreshes.
- Reusing the current sidebar's polling for the new list even if it comes for free. Even free polling that manifests as visible list mutations after page-load violates the shape lock (TG-17).
- Distinguishing "identity attached" from "identity not-yet-attached" for a newly-created row while Ashley is doing her cd / claude / `/id` setup inside the pane.
- Turning the pencil into a two-action popover that offers "new identity session" and "raw shell." Ashley never uses raw shell one-shots; keep the pencil single-purpose.

</deferred>

<scope_fence>
## Scope Fence — what would violate this phase

1. **Any change to identity-tmux, RDP, or plain-SSH tab lifecycle behavior.** Rows are a new rendering of existing tab-lifecycle state; the underlying lifecycle stays exactly as it is.
2. **Any real-time polling / push mechanism on the fleet-discovery input.** Snapshot-on-load only. If free polling comes with the reused sidebar host-tree signal, disable it for this list's purposes.
3. **Any visual distinction between attached and detached rows** — brightness, italic, dot, spinner-only-for-detached, badge.
4. **Any plain-SSH host row category in the list.**
5. **Any second creation button beyond the pencil.**
6. **Changing the desktop sidebar collapse behavior** (already locked from Phase 6).
7. **Changing the mobile list-vs-view flow, back button, or bottom-nav-deletion state** (already locked from Phase 6).
8. **Adding history / scrollback / ended-session persistence** (already locked from Phase 6).
9. **Any deploy step not referencing `deploy-runbook.md` + the mandatory 15-min deadman.**
10. **Any touch to `src/ui/features/pretty-view/**`, `src/ui/features/terminal/Terminal.tsx`, `src/ui/features/guacamole/**`, `src/backend/**`, `docker/**`, or `package.json`.**

</scope_fence>

<success_criteria>
## Success Criteria (goal-backward)

The phase is DONE when all of the following are true from Ashley's perspective on the deployed fork:

1. **Fresh mobile page-load shows the fleet's running tmux sessions in the list** — not "no active conversations." The rows match what the current sidebar host-tree + double-shift menu would show.
2. **Attached and detached rows are visually indistinguishable.** Ashley cannot tell from the row rendering whether she has clicked it earlier this page-load.
3. **Clicking a detached row transparently attaches, mounts, and shows the session** — no separate connect step, no dialog, no confirmation.
4. **Remote-desktop host rows sit at the bottom of the list** — one row per RDP-enabled host, monitor icon, no identity hue, clickable to open the desktop.
5. **The New Session button is re-styled as a pencil.** Same function, new icon (and possibly new position per planner's placement choice).
6. **Mobile no longer shows duplicate settings entry points.** The gear renders only on desktop; the settings row renders only on mobile.
7. **The list does not auto-update after page-load.** No polling indicator, no live-count, no "syncing…" — Ashley refreshes to see cross-device or cross-session state changes.
8. **Every existing Phase 6 behavior is preserved verbatim** — per-session pins, host grouping with separators, mobile list-vs-view flow, tab-strip absence, sidebar collapse, session persistence within page-load, URL fragment schemes.
9. **Every existing tab lifecycle behavior is preserved verbatim** — RDP tab disconnect/reconnect, identity-tmux attach/detach, pretty-view mount-on-identity-resolution.
10. **Deployed behind the fork's mandatory 15-min deadman rollback.** No exceptions.

If Ashley's UAT reveals ANY of these does not hold, the phase is not done.

</success_criteria>

---

*Phase: 07-fleet-native-conversation-list*
*Context gathered: 2026-07-21 via `/open fleet-native-conversation-list` → CONTEXT.md synthesis from shape file*
*Bounty tracker: SAME as Phase 6 — `~/.claude/identities/tina/bounties/telegram-like-interface/` (stays in_progress until Phase 7 ships + UAT sign-off, then `/close telegram-like-interface`)*
