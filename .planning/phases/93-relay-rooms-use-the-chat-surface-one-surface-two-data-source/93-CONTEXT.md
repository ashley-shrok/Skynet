# Phase 93: Relay rooms use the chat surface — one surface, two data sources - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

> **Seeded from shape file** per `/build` convention — the shape file (`.planning/shapes/shape-relay-room-pane-reuse-prettyview-pieces.md`) locks the phase's philosophy and scope edges via a `/open` conversation with Ashley (2026-09-09, greenlit `thumbs up` same session, including a mid-flow reshape from Ashley's own framing that reversed the two-panes decision Slice D shipped under). This CONTEXT.md is the discuss-phase artifact translating those shape decisions plus the four implementation gray areas walked one-at-a-time in the discuss session into a form downstream agents (researcher, planner) can act on without re-asking. Read the shape file for the fuller narrative; this file is the actionable extract.

<domain>
## Phase Boundary

Fold the standalone relay-room pane into the existing harness chat surface (`PrettyView`) so that a relay room renders through the SAME chat surface a harness session does, differing only in data source. Extend the chat surface's existing single-badge upper-right anchor to accept a set of N badges growing leftward (with meters attached to the ones that need them). Delete the entire standalone pane tree shipped by Slice D (Phase 90). Route relay-room tabs to the shared chat surface via a discriminated-union source prop the dispatcher constructs. Hide the compose box's ambient chrome (attach button on textarea + upper row with reset/context-meter/interrupt/thumbs/recap) when the source is a relay one.

**Reverses Slice D's D-01 through D-03** (2026-09-08). Slice D built a separate second pane with only truly-primitive pieces shared. Phase 93's answer, per Ashley's UAT reformulation 2026-09-09, is that the harness chat surface IS the reference implementation and IS the shared thing — extensions grow ON it, and the standalone pane retires entirely. The reversal is deliberate; the shape file's "Tempting but no" section explicitly rejects re-doing this as an extract-primitives-and-rebuild refactor.

**What ships here:** the multi-badge extension of the chat surface's existing badge anchor; the discriminated-union source prop and its two `kind` variants (harness / relay); one-message-store-with-source-adapters wiring; the dispatcher-side prop-construction change for the relay-room branch of `TerminalOrIdentitySessionPane`; deletion of `src/ui/features/relay-room-pane/` entirely along with `src/ui/shell/RelayRoomSessionPane.tsx`; conditional hide of compose-box ambient chrome (attach + upper row) when `source.kind === "relay"`; retirement of the routing branches / early-returns / conversation-store shims that reference the standalone pane; test migration (Slice D pane tests retire; equivalent assertions land against the shared surface at relay-source).

**What does NOT ship:** any visible change to the harness case (regression floor — the daily chat surface looks and behaves EXACTLY as today). Redesign of anything else. New message kinds. Deciding what badge-click does in a relay room (no-op for v1, revisited later). Streaming (does not exist and never will). Presence / typing indicators. Sidebar row rendering (Slice D shipped that separately and it works — untouched here).

</domain>

<decisions>
## Implementation Decisions

Four gray areas walked one-at-a-time with Ashley during the discuss-phase session (2026-09-09), each greenlit `thumbs up` before advancing. Combined with the shape file's already-locked philosophy + scope edges, these give the planner everything needed to slice.

### Multi-badge row (the one place the surface grows)

- **D-01: Extend the EXISTING upper-right badge anchor; N badges grow LEFTWARD from where the current single badge sits.** Not a new top-of-pane participants row (Slice D's model). Not a separate row of any kind. The chat surface already has one badge in the upper right for whoever the viewing user is talking to; Phase 93 lets that anchor carry a set of badges instead of a single one, growing left. The harness case supplies exactly one badge (the agent) — visually unchanged from today. The relay case supplies many (one per non-viewing-user participant). Ashley 2026-09-09 verbatim: *"the current harness session pretty view has one badge in the upper right for whoever you're talking to, and the only differences that are going on here is that we are allowing multiple badges to be displayed if desired... you have the one badge that's already there and every pretty view regardless of the session type is going to have at least that one badge but then you might also have more that grow left from where the original sits. And then some of them might have the context meters as well."*

- **D-02: Meters attach to badges that need them; harness supplies one badge WITHOUT a meter, relay supplies badges WITH meters on the agent ones.** Meters are per-badge, not pane-wide. In the harness case, the meter stays where it lives today (in the compose box's upper row) — the harness's single badge does NOT carry an attached meter. In the relay case, agent badges carry attached meters (Slice D's D-08 shape — shrunk meter+reset appendage below the badge — is the visual reference), human badges do not (Slice D's D-09). This means the meter lives in two different places depending on case; that's intentional and correct given the compose box's upper row is entirely absent in the relay case anyway.

- **D-03: Per-badge ordering — humans first, agents second, alphabetical within each role.** Reuses Slice D's D-07 rule. The set of "additional" badges (i.e. excluding the viewing user, whose right-side-is-you convention holds) orders left-to-right as humans-then-agents each alphabetical. Recency-of-last-message reshuffling was rejected during Slice D grill (row is right at the top and reshuffling on every message would feel restless during a lively group); fixed-at-room-creation is arbitrary and unreadable.

### Retirement of the standalone pane

- **D-04: Delete the entire standalone pane component tree; route relay tabs to the shared chat surface via prop.** No thin wrapper survives. `src/ui/features/relay-room-pane/` deletes entirely (all files: `RelayRoomPane`, `IdentityBadgeRow`, `AgentBadgeWithAppendage`, `RelayMessageList`, `RelayRoomInboundBubble`, `error-state`, `use-relay-room-stream`, `relay-room-api`, and every `*.test.tsx` for those). `src/ui/shell/RelayRoomSessionPane.tsx` deletes entirely (along with its test). The dispatcher (`src/ui/shell/tabUtils.tsx:187` `TerminalOrIdentitySessionPane`) still branches on `tab.sessionKind === "relay-room"`, but the relay branch changes from "mount `RelayRoomSessionPane`" to "mount the shared chat surface with a relay-kind source prop." Cleanest artifact — a single implementation for the chat surface — and cleanest routing.

- **D-05: `sessionKind` STAYS as the tab-level discriminator.** Phase 93 does NOT collapse the "relay-room" sessionKind into "harness." The tab-model change (dropping sessionKind entirely and having the shared surface figure out its case from associated data) is a larger scope-out; the dispatcher's branch on `sessionKind` is fine and stays. What changes is what the branch RENDERS (shared chat surface with relay source, not the deleted standalone pane).

- **D-06: The renderTabContent early-return branch at `tabUtils.tsx:314` for relay-room tabs also retires.** Phase 91 UAT-fix 2026-09-09 added an inline branch above the host-null gate to render `RelayRoomSessionPane` before the harness dispatch would host-null-fail. That branch's whole reason for existing was that the relay-room tab didn't need a host and would otherwise be blocked. With Phase 93's fold-in, the relay branch of `TerminalOrIdentitySessionPane` is the sole entry point and can carry the host-optional handling internally (the harness source-kind requires a host; the relay source-kind does not). The early-return goes away.

### Source-prop shape (case cue)

- **D-07: The shared chat surface consumes a discriminated-union `source` prop.** Shape:

  ```ts
  type ChatSurfaceSource =
    | { kind: "harness"; host: string; sessionId: string; /* etc. */ }
    | { kind: "relay"; roomId: string; viewingUserMxid: string; /* etc. */ };
  ```

  TypeScript makes invalid states unrepresentable — no "harness kind with a roomId set," no "relay kind with a host set," no "both/neither." Every case-based branch inside the shared surface reads `source.kind` (`if (source.kind === "relay") ...`) or delegates via source-shape (see D-08 message-store adapters). The dispatcher constructs the correct variant per tab: harness branch builds `{ kind: "harness", host, sessionId, ... }`, relay branch builds `{ kind: "relay", roomId, viewingUserMxid, ... }`. Alternatives considered and rejected: explicit `mode: "harness" | "relay"` prop (permits invalid state), duck-typed inference from which optional props are present (most fragile — silently mis-behaves on both/neither, unreadable at future call sites).

- **D-08: `source.kind` is the ONE hard case-discriminator inside the surface.** Anywhere the surface must know "am I harness or relay" (hide compose upper row, hide attach button, choose which adapter hook to run, decide badge layout defaults), the check is against `source.kind`. Do NOT sprinkle case-detection logic based on other fields. This concentrates the drift risk at exactly one boundary.

### Message-list source integration

- **D-09: One message store on the shared surface; source-specific adapter hooks feed it.** The chat surface has ONE canonical message-list state. Neither case sees a different store type; both see the same message-shape flowing through the same rendering. What differs is the ADAPTER that populates the store: a harness-adapter hook wraps the existing session-transcript-based ingestion (untouched from today); a relay-adapter hook wraps `use-relay-room-stream`'s WebSocket → history-batch + live-event pipeline. The adapter selected by `source.kind` is the ONLY case-aware layer downstream of D-07. Downstream rendering (scroll, hydration, pagination trigger, empty state, per-message layout) is entirely case-agnostic — it reads from the store, doesn't know or care what fed it.

- **D-10: The relay adapter absorbs the retired `use-relay-room-stream` behavior.** When Slice D's `use-relay-room-stream.ts` deletes with the rest of the pane tree, its WebSocket → history_batch + live_event ingestion logic re-materializes inside the shared surface's relay-adapter hook. Do NOT keep the file at its old path as a shim — inline the useful parts into the new adapter, delete the old file. The relay-room-stream backend WebSocket server itself (`src/backend/relay-room-stream/`, started at boot per the fix landed as `57fcf2c2`) STAYS — it's the wire the adapter connects to; the frontend hook is what retires.

### Compose box case-based hiding

- **D-11: Hide the attach button on the textarea AND the compose box upper row (reset, context meter, interrupt, thumbs, recap) monolithically when `source.kind === "relay"`.** Monolithic case-based conditional, not per-feature applicability. Ashley's framing was list-style ("the attach button goes away from the text areas of the compose box and the upper row of the compose box that contains the reset button and the context window meter and the interrupt button and the thumbs up button and the recap button all go away too but it's just that they're hidden in that type of session") — the whole set drops as a unit. Per-feature applicability (each button individually declaring which cases it applies to) is a scope-out; the current set is genuinely all-or-nothing between the two cases, and if a future upper-row feature turns out to apply to both cases, that's the moment to reshape — not premature abstraction now.

- **D-12: Textarea + Send button visual shell stays exactly as today.** The bottom of the compose box (the actual text-entry surface + the send button) does NOT change appearance or behavior between the two cases. It just wires its `onSend` to a different handler based on `source.kind` (D-13). No visual difference the user could notice by looking at the compose bottom bar.

### Send round-trip

- **D-13: Send handler is case-selected inside the shared surface.** When `source.kind === "harness"`, `onSend` delegates to the existing harness send path (session stdin injection via the current message-queue plumbing). When `source.kind === "relay"`, `onSend` delegates to the relay send path (Matrix `/send` via the room's send-endpoint the standalone pane already used before deletion). The compose box PRIMITIVE (D-12) does not know which mode is active; it just calls whichever `onSend` is wired in.

- **D-14: Optimistic-bubble behavior on the relay case matches whatever the shared surface does today for harness.** Phase 81 (attach-optimistic-bubble arc) locked "every compose-box send emits an optimistic bubble" as a fleet rule. That rule carries over to the relay case — a relay send emits an optimistic bubble on send, replaced when the live_event echo arrives back from the WebSocket. Match-and-replace mechanism follows whatever pattern the harness path uses; concrete plumbing is planner's call.

### Per-message rendering (already resolved by shape/prior work)

- **D-15: Bubbles right = viewer's blue, unchanged.** The viewing user's outbound bubbles render right-aligned in the viewer's existing blue, regardless of case. Same visual style, same primitive, no case-branching.

- **D-16: Bubbles left = other participants' identity colors.** Inbound bubbles render left-aligned, color-coded to each sender's identity `colorHue`. Reuses tiffany's already-shipped sender-attributed inbound bubble primitive (bounty `relay-inbound-bubble-sender-hue-recolor`, 2026-08-18). Slice D's `RelayRoomInboundBubble.tsx` was already a thin reuse of this primitive; it deletes with the rest of the pane tree, and the shared surface's inbound-bubble path is used directly for both cases. No new work here.

- **D-17: Message types the relay data source doesn't emit simply don't appear — data over configuration.** WIP indicator, task shells, sub-agent bubbles never render in the relay case because the relay adapter (D-10) never pushes those message shapes into the store. NO per-case conditional hiding for message kinds. If a future relay-message-kind appears (e.g. system events for participant join/leave), it can either flow through as a new bubble type consumed by both cases or be introduced as a new case-agnostic message kind — but that's Phase 93-out-of-scope.

### Edge cases (fall out from shape)

- **D-18: Badge-click in relay rooms — no-op v1.** In the harness case, badge-click continues to open the agent's bounties (unchanged from today). In the relay case, badge-click does nothing. Revisit later if a real interaction emerges. Ashley 2026-09-09 verbatim in grill: *"clicking on badges in relay rooms just will do nothing right now. We might come back to it later."*

- **D-19: Empty relay room state — same as today's relay pane empty state.** No bubbles, badge row (viewing user + zero other participants would be a degenerate case since a room implies at least one other member — but empty history is normal for a new room), compose box present. No special empty-state chrome. Same fall-out as Slice D's D-17.

- **D-20: Room-not-found / membership-lost — friendly error state.** Same as Slice D's D-18: if the relay source resolves to a room that no longer exists or the viewing user has been kicked from, render a friendly error state ("This conversation is no longer available") rather than crashing or showing an empty pane. The relay adapter surfaces this error; the shared surface has a case-agnostic error rendering path (or grows one — planner's call whether an existing PrettyView error path can absorb it or a new one is warranted).

### Test migration

- **D-21: Slice D pane tests retire; equivalent assertions land at the shared-surface level with a relay-kind source.** `RelayRoomPane.test.tsx`, `IdentityBadgeRow.test.tsx`, `AgentBadgeWithAppendage.test.tsx`, `RelayMessageList.test.tsx`, `RelayRoomInboundBubble.test.tsx`, `use-relay-room-stream.test.ts`, `error-state.test.tsx` all delete with their production siblings. The behavioral assertions they made (attach button hidden, upper row hidden, badges render with meters attached, WebSocket wire-up, error state) re-land as tests of the shared chat surface with `source.kind === "relay"`. `RelayRoomSessionPane.test.tsx` deletes; the routing-dispatcher test (`tabUtils.test.tsx`) gets updated to assert "sessionKind relay-room routes to shared chat surface with relay source" instead of "sessionKind relay-room mounts RelayRoomSessionPane." Planner's call whether the new tests bolt onto existing PrettyView test files or land as new dedicated files.

### Claude's Discretion

- **Concrete file layout for the shared surface's case-aware bits.** Whether the multi-badge extension lives inline in `PrettyView.tsx` or extracts to a small sibling component, whether the adapter hooks live in `pretty-view/` or in a new `pretty-view/sources/` subfolder, whether the source-prop type gets its own module — planner's call, follow existing frontend organization conventions.
- **Slice breakdown for the phase.** Multi-badge extension, source-prop plumbing, adapter-hook wiring, retirement + routing swap, compose-chrome hiding, test migration — how these bundle into slices is planner's call. Constraint: each slice ships with the harness case regression-clean (no visible change to the daily chat surface); breaking that constraint during a slice is a stop-and-check.
- **Retirement ordering.** Whether the shared-surface extensions land FIRST (with the standalone pane still routed to and functional), then the retirement swap, OR whether the retirement happens atomically with the extensions — planner's call. The all-at-once approach risks a broken interim state if extensions land partly; the incremental approach adds an interim state where the shared surface handles a relay source but nothing routes to it yet.
- **Concrete error-state UX / copy.** For D-20's friendly error state, the exact copy + visual match — planner's / designer's call. Slice D's `error-state.tsx` is a starting reference but it deletes with the pane; whatever replaces it can borrow from that.
- **Concrete optimistic-bubble plumbing for relay send.** Match whatever pattern the harness path uses today; planner reads and matches. Do NOT reinvent optimistic-bubble mechanics on the relay side.
- **Whether `use-relay-room-stream`'s content moves as one blob into the new relay-adapter hook or gets factored during migration.** Planner's call; if the current hook is coherent and small, move-as-blob is fine; if it has natural seams the new adapter would benefit from, factor.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 93 own artifacts
- `.planning/shapes/shape-relay-room-pane-reuse-prettyview-pieces.md` — the shape file this phase realizes. Contains the full narrative, philosophy, "what would make it wrong," and scope edges. Read first.

### Shape files this reverses / builds on
- `.planning/shapes/shape-relay-session-pane-rendering.md` — Slice D's shape (Phase 90). D-01 through D-03 of Slice D are what this phase reverses. Read to understand what was built and why it's now being unbuilt.
- `.planning/shapes/shape-relay-mediated-group-conversations.md` — the master arc shape. Phase 93 is a post-arc followup, not part of the original arc; but the master shape is context for the whole "relay rooms in Skynet" story.

### Prior phases that shipped the current substrate this phase modifies / retires
- `.planning/phases/90-relay-mediated-group-conversations-sub-slice-d-relay-session/90-CONTEXT.md` — Slice D's CONTEXT locking the decisions Phase 93 reverses. Read the D-01/D-02/D-03 rationale.
- `.planning/phases/89-relay-mediated-group-conversations-sub-slice-b-session-model/89-CONTEXT.md` — Slice B session-model generalization; the `sessionKind` discriminator lives at this layer and STAYS per D-05.

### Already-shipped primitives this phase reuses
- `bounty relay-inbound-bubble-sender-hue-recolor` (tiffany, 2026-08-18) — the sender-attributed inbound bubble primitive both cases share (D-16). Lives inside `src/ui/features/pretty-view/` as a reusable inbound bubble component.

### Standing directives / fleet rules that constrain execution
- `~/.claude/roles/box-maintainer/box-maintainer.md` § Standing directives — no worktrees, executor doesn't ship, scoped-tests-during-dev-full-suite-at-deploy, no streaming anywhere, multi-identity `git pull --rebase before every push`.

### Related campaign bounties (fold-in siblings)
- `~/.claude/roles/box-maintainer/bounties/relay-arc-uat-followups-campaign/` — master pointer for the post-arc UAT campaign this phase is the structural item of.
- `~/.claude/roles/box-maintainer/bounties/relay-room-pane-reuse-prettyview-pieces/` — this phase's own bounty; contains additional Ashley-verbatim rationale.
- `~/.claude/roles/box-maintainer/bounties/relay-room-message-bubble-render-broken/` — bubble-render bug that folds in as a consequence of D-09 + D-16 (shared surface's tested message-list replaces the broken RelayMessageList; broken symptom disappears).
- `~/.claude/roles/box-maintainer/bounties/relay-room-tab-first-class-integration/` — related; some aspects fold in as a consequence of routing through the shared surface.
- `~/.claude/roles/box-maintainer/bounties/relay-room-sidebar-rendering-polish/` — partly-shipped separately; not touched by this phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/ui/features/pretty-view/PrettyView.tsx` (4087 lines)** — the harness chat surface. The extension target. Adds source-prop consumption, multi-badge extension of its existing upper-right badge anchor, and case-aware wiring for hidden chrome + send handler + adapter selection. Do NOT let this file grow unbounded — Phase 27 already virtualized its message list because of size; if extensions push over a size threshold, extract by feature (e.g. source-prop utilities into a `pretty-view/sources/` subfolder).
- **`src/ui/features/pretty-view/ComposeBox.tsx` (3739 lines)** — the shared compose box. D-11 hides the upper-row features + attach button when `source.kind === "relay"`; D-12 keeps the textarea + send-button visual shell identical between cases. Same size concern as PrettyView.tsx.
- **Sender-attributed inbound bubble primitive** (already inside `pretty-view/`) — shipped by tiffany's `relay-inbound-bubble-sender-hue-recolor` bounty 2026-08-18. Both cases' left-aligned participant bubbles use this. No new work.
- **Existing identity badge component** (used somewhere in `pretty-view/` for the current upper-right badge anchor) — the base primitive multi-badge extension builds around. Locate + reuse; do not invent a new badge component.
- **`src/ui/shell/tabUtils.tsx:187` `TerminalOrIdentitySessionPane`** — the routing dispatcher. Its relay branch changes to pass a `source: { kind: "relay", ... }` prop into the shared chat surface. Its harness branch stays as-is but the shape of what it passes gets restructured into `source: { kind: "harness", ... }`.

### Established Patterns
- **Discriminated-union `kind` props** — already used elsewhere in the codebase (e.g. Slice B's session-model discriminator, Slice D's dispatcher branch). Extending the same pattern to the surface's source prop follows the existing shape.
- **Adapter-hook wrapping** — `use-relay-room-stream` today wraps the WebSocket ingestion; the harness path has its own transcript-based ingestion. Wrapping each in an adapter hook that populates a shared message store is a natural extension of the existing per-source-hook pattern.
- **Monolithic case-based conditional rendering** — Phase 87 (user avatars) + Phase 86 (cosmetics migration) both use case-based conditionals for UI element visibility. D-11's monolithic hide follows the same pattern.

### Integration Points
- **Dispatcher (`tabUtils.tsx`)** — relay branch changes from `<RelayRoomSessionPane ... />` to `<PrettyView source={{ kind: "relay", roomId, viewingUserMxid }} ... />` (concrete prop shape planner's call). Harness branch gets restructured to pass its args as `source={{ kind: "harness", host, sessionId }}` (concrete prop shape planner's call).
- **Compose-box `onSend`** — case-selected inside the shared surface per D-13. Existing harness send path stays; relay send path re-materializes from the retired standalone pane's send wiring.
- **Backend relay-room-stream WebSocket server** (`src/backend/relay-room-stream/`, boot-imported per fix `57fcf2c2` 2026-09-09) — untouched by this phase. It's the wire the new relay-adapter hook connects to.
- **Backend Synapse admin API pivot** (per `771bfcc9` 2026-09-09) — for room name + message reads. Untouched; the frontend just consumes what the backend serves.

</code_context>

<specifics>
## Specific Ideas

- **The harness case is the regression floor.** Ashley's daily chat surface must look and behave EXACTLY as it does today after every slice lands. This is the strongest "what would make it wrong" from the shape. Every slice ships with a "harness case unchanged" as an acceptance gate. If a slice can't clear that gate, stop and rework.
- **The standalone pane concept dissolves and stays dissolved.** No thin wrapper survives. If a future concern makes it tempting to reintroduce a wrapper "for one small reason," resist — the shape's whole point is that duplication doesn't come back later.
- **Ashley's own framing reversed my /open pitch.** My initial /open pitch was "extract shared primitives, rebuild two thin surfaces on top." Her reformulation ("is there a world where the pretty view stays largely intact and is just fed by different things?") reshaped the phase into "one surface, extended once." The shape file's "Tempting but no" section captures this reversal explicitly. Do not slip back into extract-and-rebuild framing during planning.

</specifics>

<deferred>
## Deferred Ideas

- **Badge-click affordance in relay rooms** — no-op v1 per D-18; revisit later when a real interaction need emerges (identity card? peek at participant's status? something else). Own future bounty when it does.
- **Relay-message system-event kinds** — participant joins / leaves / renames as bubble types would be a natural addition, deferred to a later phase per shape scope-out. Data source not currently emitting these.
- **Collapsing `sessionKind` entirely** — the shape decision that the tab-level discriminator stays (D-05) is a scope-out. A future refactor could unify the tab kinds by having tabs carry a source directly and the shared surface derive its case from it. Not this phase.
- **Mobile / narrow-viewport behavior for the multi-badge row when it grows to many participants** — Slice D's D-20 already deferred v1 mobile behavior. Same deferral holds here: reasonable behavior in v1 (row overflow / horizontal scroll / wrap — whichever falls out of the existing PrettyView responsive patterns), revisit once real large rooms surface actual pain.
- **Extract-and-rebuild refactor path** — explicitly rejected per shape "Tempting but no." If ever reconsidered, it's a whole new shape file.

</deferred>

---

*Phase: 93-relay-rooms-use-the-chat-surface-one-surface-two-data-sources*
*Context gathered: 2026-09-09*
