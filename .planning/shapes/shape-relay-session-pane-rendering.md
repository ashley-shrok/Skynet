# Shape: relay group conv — sub-slice D: relay-session pane rendering + per-badge affordances

**Opened:** 2026-09-08 (refined from seed during this session's `/open`)
**Vehicle:** `/gsd:phase`
**Bounty:** `relay-session-pane-rendering` (box-maintainer role)
**Parent shape:** `.planning/shapes/shape-relay-mediated-group-conversations.md`
**Parent bounty:** `relay-mediated-group-conversations-humans-agents-in-rooms`
**Depends on:** sub-slice A (`relay-human-identities-first-class`), sub-slice B (`relay-session-model-generalization`).
**Leans on already-shipped:** the sender-hue inbound-relay bubble primitive shipped 2026-08-18 (tiffany, bounty `relay-inbound-bubble-sender-hue-recolor`).

## What this is

When a user opens a conversation in the sidebar that turns out to be one of the new room-backed sessions, the conversation pane renders it as a group chat — bubbles attributed to whoever sent them, participants shown as an identity-badge row at the top of the pane, per-agent context meters and reset actions attached to each agent's badge, compose box that sends via the user's own relay identity into the room. Feels as close to pretty view as possible so a user doesn't have to reason about which kind of conversation they're in.

## Shape

The pane detects it's rendering a room-backed session (via the kind discriminator from sub-slice B) and takes a different rendering path from pretty view — a whole separate pane implementation, not a branch inside pretty view. See Philosophy for why.

**Bubbles.** Sourced directly from the relay — the relay's own message-history for older messages, plus a live subscription for new messages arriving in the room. Every incoming bubble is attributed to its sender; the same sender-hue visual encoding used elsewhere for inbound-relay traffic (the primitive already shipped mid-August) drives the bubble color, border, and left-alignment. The user's own outbound bubbles use the existing right-aligned "you speaking" style, unchanged.

**Identity-badge row.** At the top of the pane, a horizontal row of the existing identity badges — the same badges used elsewhere in pretty view — one per participant other than the viewing user. Humans first, then agents. Within humans, alphabetical by name; within agents, alphabetical by name. The viewing user does NOT get a badge for themselves (the right-side-is-you convention holds across the app and holds here).

**Per-agent badge appendage.** Each agent's badge has a small area hanging off the bottom, containing a shrunk-down version of the context meter and reset button that live in pretty view's compose box today. Same visual language, same behavior — just smaller, and positioned per-agent rather than pane-wide. State comes from the same underlying per-agent channel that drives pretty view's meter + reset today, so the same agent viewed in either pane shows the same context number and reset behaves identically.

**Per-human badge.** Just the badge — name, hue, avatar. No appendage. No meter, no reset. Absence of the appendage IS how a viewer visually distinguishes humans from agents in the row.

**Compose box.** The lower half of pretty view's compose box — the textarea and the send button — reused visually as close to identical as possible. The upper half of pretty view's compose box (reset button, context window meter, queue-a-message button, stop button, thumbs-up button, recap button) does NOT appear here. Reset and context meter moved to per-agent badges. Queue-a-message, stop, thumbs-up, and recap have no meaning in a relay-room session (no single agent to stop, no work-in-progress state to acknowledge, relay's message history IS the transcript so there's nothing separate to recap). Attach is hidden entirely for v1 — deferred to a later revision because inbound/outbound file support on the relay is a genuine sub-project of its own.

**Send round-trip.** On send, the typed message goes out through the viewing user's own relay identity into the room (backed by the first-class human relay identity from sub-slice A). The message appears in the pane as an outbound bubble. Optimistic-vs-confirmed behavior matches whatever pretty view does today.

**Message history pagination.** Same behavior as pretty view — same initial load size when the pane opens, same scroll-back trigger, same batch size on load-more. The plumbing underneath is entirely different (relay message-history endpoint vs. session-transcript parsing) but the observable behavior at the surface is identical.

## Philosophy

**Two panes, side-by-side. Not one pane with a branch.** The surface similarity between a harness-session pane and a relay-session pane is a trap. Every layer that looks the same on screen — bubble list, scroll, compose box, message flow — is driven by radically different plumbing underneath. Data source, pagination shape, send round-trip, per-participant state, chrome at the top of the pane, attach behavior, stop and recap semantics. Trying to fold both into one pane would grow a kind-branch at every one of those layers, and the accumulating complexity would live inside the currently-working harness pane — every future edit would have to reason about both paths, and the risk of regressing the working thing would compound. Building the relay pane as its own thing keeps pretty view untouched (no branch cluttering it, no chance of a relay-specific edit regressing harness behavior) and lets the relay pane own its plumbing end-to-end.

**Share truly-primitive pieces. Don't share pane orchestration.** Where the two panes genuinely render the same thing — the sender-attributed inbound bubble, the user's outbound bubble, the compose textarea and send button — extract the primitive and share it. Where the pane's orchestration diverges — data-fetching, pagination trigger, top-of-pane chrome, attach/stop/recap wiring — don't try to unify. The compose box is a case worth naming explicitly: extract the visual shell (textarea + send button), then let each pane pass in what's enabled in its upper area. The harness pane keeps its upper area with meter/reset/queue/stop/thumbs-up/recap; the relay pane has no upper area at all. Same visual bottom, different upper.

**Don't touch pretty view in this slice.** Extract shared primitives minimally, build the relay pane on top, leave pretty view consuming its current private components. If visual drift between the two panes becomes a real problem later, a small convergence slice can pull pretty view onto the same shared primitives then. The strongest guarantee that pretty view doesn't regress is not editing it in this slice.

**Existing visual language, reused. No new controls invented.** The per-agent badge appendage is literally the pretty-view compose box's meter + reset, shrunk and repositioned. The identity badges are the same identity badges used elsewhere. The bubble primitives are the ones already shipped. This slice adds a new pane implementation and a new place-things-hang-off-badges layout, but it doesn't invent any new UI vocabulary — everything the user sees is a control they already recognize from elsewhere in pretty view, worn in a slightly different arrangement.

**Absence-as-affordance.** The absence of the pane's upper compose area, the absence of an appendage on human badges, the absence of an attach button — each of these is doing UX work. Users learn that "the compose here doesn't have those controls because they don't apply" without needing explanatory chrome or tooltips. Adding a disabled attach button with a tooltip would be worse than hiding it; it would tease functionality that isn't there and add visual noise for zero present benefit.

**Mobile is intentionally v1.5.** Designing the mobile shape perfectly upfront requires guessing at how a variable number of participant badges (each with an appendage or not) reflows in a narrow viewport. Ship v1 with reasonable behavior and revisit once real rooms are being used and the actual pain points show themselves — better than over-planning a mobile design in the abstract.

## Prior context

Per the master shape and the sub-slice-B design: session records carry a kind discriminator distinguishing harness-session records from room-backed records. Room-backed records carry the room ID and enough metadata for the pane to open; membership and message history are queried live from the relay when the pane opens, not cached in the session record.

The sender-attributed inbound bubble primitive shipped 2026-08-18 — it renders inbound-relay bubbles today in the harness pane with per-sender hue, left-alignment, and a resolved-identity dot. This primitive is exactly what a group-room member's bubble needs; this slice leans on it. Same primitive, same visual result, new context — group-room bubbles inherit the visual encoding harness-pane peer-chatter bubbles already use.

Pretty view for harness sessions has an existing compose box with an upper area (reset button, context window meter, queue-a-message button, stop button, thumbs-up button, recap button) and a lower area (textarea, attach button, send button). The relay pane reuses the lower area and drops the upper area entirely.

Pretty view also has existing behavior for optimistic-send, scroll-back to load older messages, and page size on initial load — the specifics don't need to be re-derived here; the relay pane matches them by design.

Human avatars are already shipped as an independent prerequisite (landed during the master shape's conversation), so the humans-first identity-badge row has real per-human visual identity to render.

Sub-slice A guarantees the viewing user has a durable relay identity to send with; sub-slice B guarantees the room-backed session record exists and can be materialized.

## What would make it wrong

- The relay pane is a branch inside pretty view. The two-panes architecture agreement failed; every future pretty-view edit now carries relay-pane regression risk.
- Bubbles fail to attribute correctly and every message in a group room looks like it came from the same speaker. The shared bubble primitive was misused or the wrong data flowed into it.
- The per-agent badge's meter or reset shows a different state than the same agent's meter/reset in its own harness pane. Two sources of truth for per-agent state diverged; the shared state channel wasn't reused.
- The compose box looks or feels noticeably different from pretty view's compose in ways beyond the deliberate upper-area removal. Visual parity on the shared parts failed.
- Message history loads all at once on pane open in a room with thousands of messages. Pagination was skipped.
- The user hits send and the outbound bubble doesn't appear because the send is waiting on relay confirmation and the user is left wondering whether it went through. Optimistic-send parity with pretty view was missed.
- A human's badge acquires an appendage, or an agent's badge is missing one. The role-based branching for the appendage failed and the human/agent visual distinction collapsed.
- Pretty view for harness sessions has a behavior regression after this slice ships. The "don't touch pretty view" agreement was violated somewhere and the harness path suffered.
- The user picks a conversation from the sidebar, and instead of the pane opening, they see a broken-looking error state because the underlying room doesn't exist anymore (they were kicked, room was closed, etc.). This edge case wasn't handled gracefully.

## Scope edges

**In.**
- Pane detection based on session kind discriminator; branch to the new relay pane implementation.
- The new relay pane itself: bubble list sourced from the relay (history + live subscription), identity-badge row at top humans-first-then-agents alphabetical within each role, per-agent badge appendage with shrunk context meter + reset, per-human badge with just the identity, compose box with just the lower area (textarea + send).
- Extraction of genuinely-shared bubble primitives (the sender-attributed inbound bubble is already shipped; the outbound "you speaking" bubble and the compose textarea + send button are the main new extractions).
- Wiring the per-agent badge appendage to the same underlying per-agent state channel pretty view already uses for its meter + reset.
- Message-history pagination behavior mirroring pretty view (initial load size, scroll-back trigger, batch size).
- Optimistic-send behavior mirroring pretty view.
- Attach button hidden in the relay compose box.
- Defensive rendering for edge cases: empty room (no messages yet), room-not-found or membership-lost (friendly error state, not a crash), inbound message with an attachment (minimal placeholder text, media rendering deferred to when attach itself ships).

**Out.**
- Any modification to pretty view for harness sessions. Pretty view stays untouched.
- Session materialization (sub-slice B).
- Room creation (sub-slice C).
- Agent multi-participant etiquette (sub-slice E — a small directive bank in the identity substrate, not a `/build` cycle).
- Attach support in either direction. Inbound placeholder rendering is minimal; outbound attach button is hidden. Full attach lands in a later slice.
- Any convergence work to migrate pretty view onto the shared bubble/compose primitives. If drift becomes a real problem, that's a separate future slice.

**Deferred to a later revision.**
- Mobile-specific layout of the identity-badge row when the row would overflow (many participants, small viewport). V1 does something reasonable; v1.5 revisits once real usage shows the pain points.
- Attach support (both outbound send and inbound rich media rendering).
- Typing indicators, read receipts, per-message reply threading, message editing, message redaction, reactions.
- Any "unread" state on the sidebar entry for room-backed sessions (per master shape — v1 doesn't build this).

**Tempting but no.**
- A disabled attach button with a "coming later" tooltip. Absence-as-affordance is cleaner; users don't need to be told about features that don't exist yet.
- A per-tile "kick this member" action. Membership is fixed at creation in v1 per master shape.
- Trying to unify the harness pane and relay pane into one component with a kind-branch. Rejected — see Philosophy.
- Special-casing a "single-human-in-a-group-of-agents" room to look different from a mixed-human-and-agent group. Rooms are rooms; if you're the only human, the badge row just has more agents on it.
- Reshuffling the identity-badge row by recency-of-last-message. Rejected during grill — the row is right at the top of the pane and reshuffling on every message would feel restless during a lively group.

## Vehicle notes

`/gsd:phase`. Same shape as Slice B (Phase 89). Standing fleet directive: if it's phase-sized, it's a phase — no shortcut around ceremony.

Phase seeding: this shape file IS the CONTEXT.md for `/gsd:discuss-phase`. Don't re-elicit the "why + what + constraints + scope edges" already captured here.

The one shape decision the plan phase needs to reason from directly — and that most affects the phase's task breakdown — is the two-panes-with-shared-primitives architecture. Task breakdown should carve out the primitive extractions (bubble primitives, compose visual shell) as their own early tasks, then build the relay pane on top, rather than trying to do it all in one monolithic "build the relay pane" task.

Depends on sub-slices A (human relay identities first-class) and B (session-model generalization) — both landed prior to this session. Can be run in parallel with sub-slice C (new-conversation flow) per the master shape; C wasn't the pick for this session but is unblocked whenever it starts.

The identity implementing this work is box-maintainer (taylor), working out of `~/skynet-taylor/`. The bounty's timeline is where cross-phase context and decisions taken during execution should be recorded. Per Ashley standing plan: this phase lands as commits only; no push. Ship for the whole arc happens after Slices C + E land and `/close relay-mediated-group-conversations` passes against the master shape.
