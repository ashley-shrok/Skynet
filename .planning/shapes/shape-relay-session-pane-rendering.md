# Shape: relay group conv — sub-slice D: relay-session pane rendering + per-badge affordances

**Opened:** 2026-09-08 (seed only — the sub-slice's `/open` conversation happens at the start of the session that picks this up)
**Vehicle:** `/build` (sub-slice of the parent multi-phase arc)
**Bounty:** `relay-session-pane-rendering` (box-maintainer role)
**Parent shape:** `.planning/shapes/shape-relay-mediated-group-conversations.md`
**Parent bounty:** `relay-mediated-group-conversations-humans-agents-in-rooms`
**Depends on:** sub-slice A (`relay-human-identities-first-class`), sub-slice B (`relay-session-model-generalization`).
**Leans on already-shipped:** `relay-inbound-bubble-sender-hue-recolor` (per-sender-hue + left-align bubble primitive, tiffany 2026-08-18).

> This is a SEED, written from the master shape as a running start for the sub-slice's `/build`. When the `/build` on this shape kicks off, its `/open` refines this into the final agreed shape file — grill remaining unknowns, adjust wording, close out.

## What this is

When a user opens a relay-room-backed session, the conversation pane renders it as a group chat with per-sender-attributed bubbles, per-participant identity presences at the top of the pane (humans first then agents), per-agent context indicators and reset actions bound to each agent's presence tile, and a compose box that sends via the user's relay identity into the room. The pane feels as close as possible to the existing harness-session pane — a user who doesn't know how the two session types differ shouldn't have to learn a different UI.

## Shape

The pane detects it's rendering a relay-room session (via the kind discriminator from sub-slice B) and branches to the relay-session rendering path.

**Bubbles.** Sourced directly from the relay (via the relay's message-history endpoint, plus a live subscription for new messages) — NOT parsed out of any agent's session transcript, unlike the current peer-agent-chatter rendering in the harness pane. Every incoming bubble carries sender attribution. The existing `RelayInboundBubble` primitive already shipped (bounty `relay-inbound-bubble-sender-hue-recolor`, tiffany 2026-08-18) provides per-sender-hue background/border/shadow + left-align + resolved-identity dot. This slice leans on that primitive: the same recipe rendering the sender's identity is exactly what a group-room member's bubble needs. Outbound (user's own) bubbles use the existing "user speaking" right-aligned style unchanged.

**Identity-presence row.** At the top of the pane, a horizontal row of participant tiles. Humans first, then agents, in that order. Each tile shows the participant's name + identity hue + avatar. The viewing user does NOT get a tile in their own view of the pane (right-side sender convention holds).

**Per-agent tile affordances.** Each agent's tile carries a context-window indicator (same visual/semantics as today's harness-session context meter) and a reset action (same behavior as today's reset button). These read from and write to the agent's underlying harness state via the existing per-agent state channel — the same source of truth that drives the context meter and reset in the agent's one-on-one harness pane. So the same agent viewed from either place shows the same context number and reset behaves identically.

**Per-human tile affordances.** Just name + hue + avatar. No context meter (humans don't have bounded context) and no reset action (nothing to reset). Absence of those affordances is enough visual distinction between human and agent.

**Compose box.** Same look and feel as the harness-session compose box. On send: publishes the typed message into the room via the user's relay identity (backed by sub-slice A). The message appears in the pane as an outbound bubble (right-aligned, "you speaking" style). Whether that appears optimistically before the relay confirms, or only after — mirror the harness-session compose semantics, whatever that looks like today.

## Philosophy

Deliberately as close to the harness-session pane as possible. Every affordance the user knows from the existing pane has an equivalent here; where semantics must differ (per-participant context indicators live on tiles rather than on the pane), the difference is small and follows naturally from the multi-participant nature of the conversation.

The already-shipped `RelayInboundBubble` primitive is the anchor for sender attribution. Reusing it means group-room bubbles inherit the same visual identity encoding — sender hue drives bubble color — that the peer-agent-chatter bubbles in harness panes already use. Users who've seen the harness-pane version will recognize the group-pane version immediately.

The per-agent tile affordances come "for free" from Skynet's existing per-agent state channel — the same source of truth that drives the harness-session context meter and reset. This slice doesn't invent new plumbing for agent state; it just renders the existing state in a new UI slot.

## Prior context

Per the master shape and the sub-slice-B seed: session records with kind=relay-room carry the room ID and metadata. Membership + message history are queried live from the relay, not cached in the session record.

The `RelayInboundBubble` primitive already renders inbound-relay bubbles in the harness pane today with per-sender-hue coloring and left-alignment (bounty `relay-inbound-bubble-sender-hue-recolor`, tiffany 2026-08-18). That primitive is exactly what a group-room member's bubble needs; this slice leans on it.

Human avatars are already shipped as an independent prerequisite (landed during the master shape's conversation).

Sub-slice A guarantees the user has a durable relay identity to send with; sub-slice B guarantees the session record exists.

## What would make it wrong

- Bubbles fail to attribute correctly and everyone in a group room looks like the same speaker. The sender attribution model failed — probably a misuse of the `RelayInboundBubble` primitive or a wrong data source.
- Per-agent context/reset on the tile doesn't reflect the same state as the agent's harness-session pane. The per-agent state channel wasn't reused; two sources of truth diverged.
- The pane feels noticeably different from a harness-session pane — different compose behavior, different scroll behavior, different bubble styling for the SAME sender across the two panes. UI parity failed.
- Message history loads all at once on pane open even for rooms with thousands of messages. The lazy-load / pagination piece was skipped.
- Compose sends but the outbound bubble doesn't appear because the round-trip is slow, and the user is left wondering whether it went through. Optimistic-send parity with the harness pane was missed.
- Human tiles somehow acquire a context meter or a reset action (a bug in the per-role-affordance branching), which visually collapses the human/agent distinction.

## Scope edges

**In.**
- Pane detection based on kind discriminator; branch to relay-session rendering path.
- Bubble sourcing from the relay directly (history + live).
- Sender-attributed bubbles via the existing `RelayInboundBubble` primitive.
- Identity-presence row at top of pane, humans-first-then-agents.
- Per-agent tile affordances (context meter, reset action) driven by existing per-agent state channel.
- Per-human tile affordances (name, hue, avatar).
- Compose box that sends via the user's relay identity into the room.
- Message-history pagination / lazy-load as needed for rooms with substantial history.

**Out.**
- Session materialization (sub-slice B).
- Room creation (sub-slice C).
- Agent multi-participant etiquette (sub-slice E — a small directive bank in the identity substrate, not a `/build` cycle).

**Deferred to a later revision.**
- Typing indicators / other multi-party presence affordances.
- Read receipts.
- Message editing, redaction, per-message reply threading, reactions.
- Any "unread" state on the sidebar entry (per master shape — v1 doesn't build this).

**Tempting but no.**
- Adding a per-tile "kick this member" action. Membership is fixed at creation in v1 per master shape.
- Special-casing a "single-human-in-a-group-of-agents" room to look different from a mixed-human-and-agent group. Rooms are rooms; if you're the only human, the tile row just has more agents on it.

## Vehicle notes

`/build` cycle. Depends on sub-slices A and B. Can parallelize with sub-slice C.

When the `/build` fires, its `/open` conversation should:
- Grill the message-history pagination (page size, scroll-back trigger).
- Grill the optimistic-send behavior (match whatever the harness pane does today — needs to be looked up).
- Grill the per-agent-tile layout (how big, where positioned relative to bubbles, mobile responsive shape).
- Grill the ordering-within-a-role of the presence tiles (alphabetical? recency-of-last-message? fixed-at-room-creation?).

Codebase touch points to look at during that discussion (not yet inspected):
- The existing `RelayInboundBubble` component (already shipped — reuse target).
- The existing pretty-view pane component for harness sessions.
- The existing context meter + reset button component.
- The existing per-agent state channel (fleet-status or similar).
