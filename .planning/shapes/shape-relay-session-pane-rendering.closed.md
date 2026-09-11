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

The identity implementing this work is box-maintainer (taylor), working out of `~/skynet-taylor/`. The bounty's timeline is where cross-phase context and decisions taken during execution should be recorded. Per Alice standing plan: this phase lands as commits only; no push. Ship for the whole arc happens after Slices C + E land and `/close relay-mediated-group-conversations` passes against the master shape.

---

## Close-Out

**Closed:** 2026-09-09
**Vehicle used:** /gsd:phase
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · sidebar row-click opens a room-backed session in a distinct pane with bubbles attributed by sender, participant badges at top, per-agent meter+reset appendages, viewer-identity compose
- **Shape: pane detection + separate pane** — present · kind='relay-room' routed at the shell dispatcher to a distinct pane implementation — not a branch inside pretty view
- **Shape: bubbles (relay-sourced, sender-attributed, hue-encoded)** — present · inbound bubbles use the already-shipped sender-hue primitive (forked to expanded-always for relay-room), outbound bubbles use the you-speaking right-aligned style
- **Shape: identity-badge row (humans first alpha, agents alpha, viewer excluded)** — present · sort + self-exclusion filter present; overflow-x-auto narrow-viewport fallback matches D-20
- **Shape: per-agent badge appendage (shrunk meter + reset)** — present · reads via the same per-agent context source pretty view reads, writes reset through the same shared endpoint pretty view now uses — no drift risk by construction
- **Shape: per-human badge (name/hue/avatar, no appendage)** — present · plain badge cell, no meter, no reset — absence-as-affordance intact
- **Shape: compose box (lower half only, no reset/meter/queue/stop/thumbs-up/recap, attach hidden)** — present · upper-area slot passed undefined; attach slot passed undefined (hidden entirely, not disabled-with-tooltip)
- **Shape: send round-trip via viewing user's own relay identity** — present · send goes out through viewer's mxid via the relay-room WS with a client-supplied correlation id
- **Shape: message-history pagination mirrors pretty view** — present · load-older button reused, page size matches pretty view's 20
- **Philosophy: two panes side-by-side, not one pane with a branch** — present · peer shell wrapper mounted from the dispatcher; zero branching inside pretty view
- **Philosophy: share truly-primitive pieces, don't share pane orchestration** — present · outbound-bubble + compose-shell + inbound-bubble extracted/forked as standalone primitives; pane orchestration is bespoke to the relay pane
- **Philosophy: don't touch pretty view in this slice** — present · production diff in pretty view is confined to ONE file, ONE function (the reset dispatch rewire) — even tighter than the shape's TWO-edit note
- **Philosophy: existing visual language reused, no new controls invented** — present · meter well + reset button are verbatim-shrunk copies of the pretty-view compose meter; identity badges are the shared primitive
- **Philosophy: absence-as-affordance (no appendage = human)** — present · human cell has no appendage; agent cell always has one; distinguishing marker is the absence itself
- **Philosophy: mobile is intentionally v1.5** — present · narrow-viewport fallback is a horizontal scroll only; no mobile-specific chrome introduced
- **Scope edges: IN** — present · all in-scope items present: pane detection, new pane, shared primitives extracted, per-agent state channel wired, pagination, optimistic-send scaffolding (see WAF drift below), attach hidden, defensive error states for empty/not-found/attachment
- **Scope edges: OUT** — present · no changes to pretty-view harness behavior; no room creation; no agent multi-participant etiquette; no attach support; no shared-primitive convergence for pretty view
- **Scope edges: deferred + tempting-but-no** — present · no disabled-attach-with-tooltip, no kick-member action, no unified component with kind-branch, no single-human-in-agent-group special case, no recency-based row reshuffle
- **What would make it wrong: relay pane is a branch inside pretty view** — present · guarded — dispatch happens at the shell layer, pane is a standalone implementation
- **What would make it wrong: bubbles fail to attribute correctly** — present · inbound bubbles resolve sender via mxid → identity → hue; every event carries its own sender-scoped rendering
- **What would make it wrong: per-agent meter/reset shows a different state than the same agent's own harness pane** — present · same store, same key format, same endpoint on both sides — correctness by construction
- **What would make it wrong: compose box looks or feels noticeably different from pretty view's compose** — present · compose shell is a verbatim copy of pretty view's row-2, same textarea styling and same Enter-to-send semantic
- **What would make it wrong: message history loads all at once (pagination skipped)** — present · hasMore/loadOlder scaffolding wired end-to-end; initial batch + load-older-button + WS fetch-older-range frame
- **What would make it wrong: outbound bubble doesn't appear because send is waiting on relay confirmation** — drifted · bubble in fact only appears once the relay echoes the sent event back; the pending-send record is a lookup table, not its own rendered bubble — user: 'since it's not done, maybe we leave it, and then I'll be back if I think this new type of session needs optimistic bubbles'
- **What would make it wrong: human's badge acquires an appendage / agent's badge missing one** — present · role-branched at the row cell; human cell renders plain badge, agent cell renders badge + appendage
- **What would make it wrong: pretty view for harness sessions has a behavior regression after this slice ships** — present · production edit is confined to reset-dispatch rewire only; the dispatch changed from WS-funnel to an HTTP endpoint but every other observable (drain-sweep, text-clear, on-reset-clicked-on-success-only invariant, error-message discipline) is preserved verbatim
- **What would make it wrong: sidebar row-click hits a broken-looking error state when the room doesn't exist** — present · quiet card 'This conversation is no longer available.' with optional subline; no retry button, no shouty warning icon

### Additions (in the result, not in the shape)

- Shell wrapper exposes a session-pane handle surface (toggle-pretty-mode, toggle-message-queue, disconnect, reconnect, fit, send-input, notify-resize, refresh, open-file-manager) as no-ops so any polymorphic tab-handle consumer keeps working on a relay pane — endorsed-as-drift
- Second error-state variant beyond room-not-found: 'Session expired / Please refresh to sign back in.' fired when the participants fetch returns an auth failure — endorsed-as-drift

### Follow-ups

- Decide whether relay sessions need optimistic-on-Enter outbound bubbles (as pretty view has) — will re-open as a separate piece of work if it turns out this new session type needs them — new-shape
- App-wide vs per-pane auth-expired handling — the per-pane session-expired card here touches a broader question about where auth-lapse UX should live — accepted-as-drift

### Notes

Pretty-view protection came out tighter than the shape guarded — the shape said TWO explicit mechanical edits landed in pretty-view under waiver; the actual production diff is ONE file (ComposeBox) and ONE function (the reset dispatch rewire), with test files updated to match. Untouched-in-production files include PrettyView.tsx itself. Also worth carrying forward: the AgentBadgeWithAppendage 'correctness by construction' pattern — reading from the same store key format and writing through the same endpoint pretty view uses, at the same resolution site, so drift between the two surfaces cannot happen silently. And the compose-shell + outbound-bubble + inbound-bubble were extracted as standalone copies rather than shared imports, deliberately: the shape's 'don't touch pretty view' invariant is stronger than a dedupe would be. Optimistic-send behavior is the one place the shape's WAF turned out to be a real behavioral gap accepted-as-deferred rather than caught-and-fixed — worth flagging for the future new-shape if relay-room UX starts feeling laggy on send.
