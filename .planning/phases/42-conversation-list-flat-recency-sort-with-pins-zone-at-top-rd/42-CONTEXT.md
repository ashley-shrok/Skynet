# Phase 42: Conversation list — flat recency sort with pins zone at top, RDP zone at bottom, always-hidden-on-load search input; retire ambient-recession visual — Context

**Gathered:** 2026-08-14
**Status:** Ready for planning
**Source:** `/open conversation-list-recency-sort` — shape agreement captured in `.planning/shapes/shape-conversation-list-recency-sort.md` (authoritative)

<domain>
## Phase Boundary

Reshape the conversation list panel (`PrettyConversationsPanel.tsx`) so its middle section is flat and message-recency-sorted, moving away from the host-grouped strict-order model established in Phase 7. Pins remain the only stickiness mechanism and cluster at the top of the list using the existing stable per-row ordering. Remote-desktop sessions get their own section at the bottom, also using the existing stable ordering internally, and their section header hides entirely when zero RDP sessions are running. The ambient-recession visual (dimmed background rows) is retired — every row carries the same visual weight, and position + the ready-dot together carry the whole "where should I look next" story. A search input is always present at the very top of the list but scrolled out of view under the panel header on the app's first render of the list; scrolling up reveals it. Typing flattens the entire list to matches against visible row labels only (no message-body content search).

This phase does NOT change the list's data source (Phase 7 established that — fleet-native, currently-running sessions only). It does NOT change how sessions are discovered, mounted, or persist across sessions. It changes ORDERING and adds SEARCH.

</domain>

<decisions>
## Implementation Decisions

### Sort model — middle section

- **The middle section is flat.** No host grouping, no per-host separators, no strict per-identity order.
- **Sort key: most recent message activity, descending.** Freshest interaction floats to top.
- **"Activity" = a message either direction, and only that.** User-sent messages and agent-sent messages both float the row. Tool-use chatter, streaming ticks, lifecycle events (session going down, coming back up, tmux restart, agent-supervisor recycle) do NOT touch position. Ashley 2026-08-14 verbatim: *"activity counts as me sending them a message, or them sending me a message."*
- **Rows with zero message history float to the top.** Explicit exception in the sort logic — a truly-new session that has never exchanged a message must not sink to the bottom just because it has nothing to sort by. Ashley 2026-08-14 verbatim: *"if there is no history of messages going back and forth then it should show up at the top."*
- **Reorder motion is a snap, not an animation.** Instant position change on activity. Provisional; revisit only if it feels disorienting in practice. Ashley 2026-08-14: *"I say we go with Snap, and if it feels weird, I'll be back."*

### Zones — pins on top, RDP at bottom

- **Pins cluster at the very top of the list.** Above the flat recency middle. The pinned zone uses the SAME existing stable per-row ordering that pins already use today (the pre-existing sort — presumably `(host, role, label)` or similar tuple) — this shape scopes that ordering down to just pins and RDP, not the whole list. Ashley 2026-08-14 verbatim: *"there's a current order for things on the list, pinned or not, and the original intent of that order was to make sure that things always show up in the same spot relative to each other so that things are easy to find. And so I think that system should be used in the pins now."*
- **Pins do NOT shuffle when they receive activity.** Activity does not float pinned rows within the pinned zone; they hold their stable relative position. Findable is the point.
- **Remote-desktop sessions live in a section at the bottom.** Own zone below the flat middle. Uses the SAME existing stable ordering internally, for the same landmark/findability reason. Ashley 2026-08-14 verbatim: *"RDP would want the same kind of stability."*
- **RDP section header hides entirely when zero RDP sessions are running.** No empty placeholder header. Ashley 2026-08-14 verbatim: *"No reason to show the header if there aren't any RDP."*

### Ready-dot uniformity + retirement of ambient recession

- **Ready-dot renders on every row uniformly.** No active-set gate. This is already the live behavior per patch #447 (2026-08-14); this phase formalizes it.
- **RDP rows: possibly no ready-dot.** Ashley 2026-08-14 verbatim: *"all rows carry the ready dot, maybe except for RDP or something."* Planner: leave `maybe except for RDP` as an implementation decision — if RDP rows don't have a chat-bearing surface behind them, the dot has no semantic; if they do, keep it uniform. Default: no ready-dot on RDP rows (RDP is not a message-bearing surface).
- **Ambient-recession visual is retired entirely.** No more dimmed/recessed treatment on background rows. Every row has the same visual weight. Position + dot together carry the "where should I look next" cue. Ashley 2026-08-14 verbatim: *"under this new way of doing things, we wouldn't have the recessed look anymore."*

### Search — always-in-DOM, hidden by scroll on cold load

- **Search input lives at the very top of the list, always present in the DOM.** Not conditionally mounted; always there.
- **On the app's first render of the list, scroll position is set so the search input sits just out of view behind the panel header.** One-shot effect at cold load. Scrolling up reveals the input. Same reveal pattern on every platform — no separate mobile vs. desktop shape. Ashley 2026-08-14 verbatim: *"the search field is just always in the list at the top. But the app always loads in such a way that it is just out of view, sort of behind the sidebar header area. and all you have to do is scroll up on any platform and you'd be able to see it."*
- **After the first cold-load hide, scroll position is left alone.** Opening a conversation and returning to the panel does NOT reset the scroll — the list stays where the user left it. Ashley 2026-08-14 verbatim: *"we make the effort on first load of the list to hide it and then don't mess with it after that."*

### Filter behavior

- **Typing flattens the entire list to matches.** Pinned zone, flat middle, and RDP section all collapse into ONE list of matches while a filter is active. Section boundaries and pin priority are NOT preserved during filter. Ashley 2026-08-14 verbatim: *"if you're filtering, then the list probably just shrinks down to whatever matches your filter. Like, we don't need to get fancy about it."*
- **Match target: visible row label text only.** Whatever text is visible on the row is what the filter matches. If a row shows identity name + host name, both are searchable. If it only shows one, that's all the filter sees. No hidden-field matching. Ashley 2026-08-14 verbatim on scope: *"we're not doing content search."* Message body content is NEVER indexed or searched.
- **Clearing the filter restores the three-zone view.**

### List scope + lifecycle (unchanged from Phase 7)

- **The list represents currently-running sessions only.** Closed sessions drop off. Identity sessions are kept running permanently by the agent-supervisor script that lives outside Skynet; other sessions come and go with tmux lifecycle. This scope does NOT change.
- **Lifecycle events (session start/stop, supervisor restart) do not float a row.** Only actual message exchanges do. The no-history-to-top exception covers the case of a brand-new never-messaged session.

### Locked by research checkpoint (2026-08-14, after `42-RESEARCH.md` surfaced the fleet-wide-message-signal gap)

- **Recency signal source: extend the fleet-status WebSocket protocol.** Research found there is no fleet-wide per-message signal today — fleet-status carries status transitions (working/not-working); per-message frames flow only via per-pane `/claude-session/ws`, which is opened only for actively-mounted panes. Ashley 2026-08-14 verbatim: *"it makes sense to me to extend the fleet status protocol."* Backend change; every browser session gets the recency signal live, works even for panes never opened this session. Rejected alternatives: (a) piggyback on Stop-hook mtime — less clean; (b) per-pane client capture with insertion-order fallback — frontend-only but semantically weaker for un-opened panes.
- **Three-plan split.** Plan 01 (sort three-zone + ambient CSS retirement) and Plan 02 (search + one-shot scroll-hide + filter) are frontend-only and ship independently. Plan 03 (fleet-status protocol extension for recency signal + wiring) is full-stack and can slot in whenever it's ready — the middle zone degrades cleanly to insertion-order (or whatever fallback the planner picks) until Plan 03 lands. Plans 01/02 do NOT wait on Plan 03.
- **Filter + hidden rows: hidden rows do NOT appear in filter matches.** Hiding is a user choice; the filter respects it.
- **Mobile search focus: tap-to-focus on reveal.** Do NOT auto-focus the input on scroll-reveal — auto-summoning the mobile keyboard is jarring. Desktop can auto-focus if the reveal happens via an intentional gesture (planner's call); mobile stays tap-to-focus.
- **`activeSet` render tier: retire the VISUAL only.** With ambient-recession gone, the tier has no visual purpose in this phase. Do NOT touch the field's other uses (deactivate-action gating). Ashley 2026-08-14 verbatim on the ambiguity: *"There is no recessed look anymore, so I don't really know what you would be asking for."*

### Claude's Discretion

- **Exact ordering mechanism for the pinned + RDP zones**: whichever pre-existing sort is currently in use for the list. Planner: read the current sort tuple in `conversation-store.ts` (Phase 25 established `(host, role, label)`) and apply the same tuple within pinned zone and RDP zone.
- **Search input UI shape**: precise text, placeholder, X-to-clear vs. auto-clear-on-empty, focus behavior. Not covered in the shape discussion; use messaging-app defaults.
- **Recency data source + persistence**: whether "most recent activity" is derived from live in-memory session state, persisted per-conversation `updatedAt`, or computed from a message-count store. Planner: derive from the most natural existing signal (probably the WebSocket-driven message events already flowing into the store); persistence across reload is desirable so first-render order is meaningful, but this can be phased.
- **Reorder timing**: the reorder happens synchronously on message-event receipt, or debounced? Default synchronous unless there's a perf reason to debounce.
- **How pins interact with the no-history-to-top exception**: does a pinned session with no history sort to the top of the PINNED zone, or does it override into the flat middle? Planner call: keep it in the pinned zone (pins are the stability contract).
- **How to identify RDP sessions**: use the existing RDP-session-detection signal (Phase 7 established a per-host RDP-enabled boolean; consult `conversation-store.ts` or wherever the current sidebar's RDP row logic lives).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape agreement (authoritative)

- `.planning/shapes/shape-conversation-list-recency-sort.md` — the full shape agreement from `/open`. Includes Philosophy, Prior Context, What Would Make It Wrong, and Scope Edges sections. If any planning decision conflicts with the shape, the shape wins.

### Prior phase shape (layered foundation)

- `.planning/shapes/shape-fleet-native-conversation-list.md` — Phase 7 shape (July 21). The data-source model, session-persistence contract, and running-sessions scope all still apply. Only the ordering rules and search affordance change with Phase 42. Phase 7 explicitly said "no recency shuffle, host-grouped, strict order" — that decision is superseded, but everything else Phase 7 established stays.

### Live code — current sort logic (must read before changing)

- `src/ui/state/conversation-store.ts` — three sort call sites at approximately lines 365, 403, 431 (per Phase 25 establishment). Currently `compareByLabel` with `(host, role, label)` tuple. Phase 42 splits this into three: pinned zone stays on `(host, role, label)`, RDP zone stays on `(host, role, label)`, middle flips to `recencyDesc` (with no-history-to-top exception).
- `src/ui/features/pretty-view/PrettyConversationsPanel.tsx` — the rendering surface. Also holds the ambient-recession CSS/props that this phase retires. Panel header + scroll container live here.

### Live code — ready-dot semantics (already correct)

- Wherever the ready-dot render is gated. Patch #447 (2026-08-14) already removed the `inActiveSet` gate; dots now render on any non-working row. This phase does NOT re-implement or move that logic — verify it stays as-is when the ambient-recession CSS is retired.

### Backend fleet-status signal

- `src/backend/fleet-status/*` — the pipeline that emits per-row "isWorking" status. Recency signal likely rides on the same or a sibling channel; read the WS message shape before designing the sort input.

### Adjacent recent patches (aesthetic, not functional)

- Patches #450, #451, #452 (all 2026-08-14, tina) — bubble chrome refinements on `ChatMessage.tsx`. Adjacent surface, no interaction to design around. Not read-required.

</canonical_refs>

<specifics>
## Specific Ideas

- **Section 25's role-clustering sort tuple `(host, role, label)`** is what the pinned + RDP zones inherit.
- **Search reveal pattern**: iOS-native pattern like Messages / Mail — search bar above the first row, hidden by initial scroll offset, pull-to-reveal.
- **The "hidden-on-cold-load" scroll effect** likely needs to run ONCE per browser session, not on every panel remount. If the panel unmounts and remounts (e.g., mobile two-screen flow), the scroll state should NOT be re-clamped — user's scroll position wins after the initial hide.
- **Reorder-on-message wiring** likely fits naturally into an existing WS message handler in `conversation-store.ts` or `PrettyConversationsPanel.tsx`. New activity → touch a per-row `lastMessageAt` field → the sort function reads it.

</specifics>

<deferred>
## Deferred Ideas

Explicit deferrals from the shape (revisit only if the shipped shape feels wrong):

- **Animated reorder** — if snap feels disorienting after real use.
- **Empty-RDP-section landmark header** — if you decide you want the "RDP" label visible even when no RDP sessions are running.
- **Search reveal affordance for very short desktop lists** — if "scroll up" isn't a natural gesture when the list is only a few rows.

Out of scope entirely (rejected):

- Searching inside message bodies (content search).
- Persisting closed sessions in the list.
- Any secondary stickiness beyond pins.
- Any change to session discovery / data source.
- Grouping matches under section headers during filter.
- Separate mobile vs. desktop search-reveal pattern.
- A dedicated "recently active" badge in addition to the dot and position.
- Reintroducing any visual dimming to convey "background."

</deferred>

<scope_fence>
## Scope Fence

**In:**
- Split the current `(host, role, label)` sort into three-zone treatment (pinned/RDP → stable, middle → recency).
- Introduce `lastMessageAt` (or equivalent) as the recency signal, wired to WS message events for both directions.
- Explicit no-history-to-top exception in the middle sort.
- Retire ambient-recession CSS/prop surface. Every row uniform.
- Add search input at top of list, always-in-DOM, hidden by scroll on cold load only, reveals on scroll up.
- Filter: label-only match, flattens all zones.
- Hide RDP section header when zero RDP sessions running.
- Snap reorder (no animation).
- Coverage: unit tests for the sort function's three-zone behavior + no-history exception; component tests for the panel's zone rendering, ready-dot uniformity, search reveal and filter flatten; regression test that pins don't shuffle on activity.

**Out (this phase):**
- Data-source shape changes (Phase 7 stays).
- Ready-dot logic changes (patch #447 stays).
- Message-body content search.
- Persisting closed sessions.
- Animation for reorder.
- Search shape variation by device.

**Deferred (see above).**

</scope_fence>

---

*Phase: 42-conversation-list-flat-recency-sort-with-pins-zone-at-top-rd*
*Context gathered: 2026-08-14 via `/open` shape agreement*
