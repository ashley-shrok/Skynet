# Shape: relay-mediated group conversations (humans + agents in rooms)

**Opened:** 2026-09-08
**Vehicle:** multi-phase GSD build
**Bounty:** `relay-mediated-group-conversations-humans-agents-in-rooms` (box-maintainer role)

## What this is

A generalization of Skynet's conversation model — from strict one-to-one human-and-agent pairings to arbitrary multi-participant rooms where any mix of humans and agents can share a durable conversation. The one-on-one conversation Skynet supports today becomes a special case (a room with two members); a room with any other combination — multiple agents, multiple humans, mixed groups — becomes a new session type that runs on the same relay infrastructure agents already use to talk to each other.

## Shape

Two types of session exist in Skynet after this ships. The first is the existing one, which drives a specific agent's harness directly from the front-end compose box — the human types and the message reaches the agent's own working environment; the agent responds, and the response comes back through that same pipe. The second is new: the "session" is a membership in a relay room. When the human types in the compose box for one of these sessions, the message is sent through the human's own relay identity into the room. Every other member of the room — human or agent — receives the message the same way any other room message arrives. Replies come back as normal bubbles from whichever member sent them.

Every participant in a relay session has an identity presence at the top of the conversation pane. Agents carry the affordances they already have in one-on-one sessions — a context-window indicator, a reset action — but bound to their identity presence in this pane, not the pane itself, because each agent has its own working environment separate from the room. Other humans in the room carry their own identity presence, ordered ahead of the agent identities in the presence row. Humans don't carry a context-window indicator or a reset action; that absence is enough to distinguish human from agent visually. The viewing user doesn't carry a presence tile in their own view of the pane — they are the implicit right-side sender across the whole app, and that convention holds here.

Creating a new relay session happens through a new-conversation affordance in the front-end — an icon reminiscent of the "compose new message" icon used elsewhere. Selecting it opens a modal that offers all the humans and all the existing agents the user could include, likely separated into two tabs. The user picks participants one at a time; a single-agent selection is disallowed (a one-on-one conversation with each existing agent is already in the conversation list, so creating a "new" one would be redundant). Any other combination — two or more agents, one or more humans plus any agents, multiple humans — proceeds. Once confirmed, a relay session is created behind the scenes and appears as an additional conversation in the conversation list, mingled with the existing one-on-one sessions and ordered by recent activity.

The compose box, the message bubbles, and the pane behavior are as consistent with the existing session type as possible — a user who doesn't know how the two session types differ should not have to learn a different UI. Where semantics must vary (per-participant context indicators live on identity presences rather than on the pane; sender attribution appears on every incoming bubble because senders vary), the variation is small and follows naturally from the multi-participant nature of the conversation.

On the agent side, no code change is needed. Every agent already has a durable relay identity and a receiver that watches every room the identity is a member of, waking the agent on each new message. Agent-to-agent one-on-one conversations, and agent-only group conversations, already work through this same substrate; a relay session with a human in it is simply another room the agent's receiver is watching. Agents decide whether to reply to a given message by the same prompt-driven judgment they already use in multi-agent chatter — no explicit mention or turn-taking protocol is required.

Human identities on the relay are the load-bearing extension. Some form of human relay identity exists in Skynet's data today, likely tied to the Telegram bridge. Whatever exists is either promoted to a first-class concept the new session type can rely on, or a new provisioning path is added; discovery during the first phase determines which. Every Skynet user needs a durable relay identity by the time they can create or join a relay session.

## Philosophy

This is a generalization, not a bolt-on. The current one-on-one experience is preserved wholly; the new session type is orthogonal to it. Users should recognize both as "conversations" and shouldn't need to reason about which kind they're in unless something explicitly per-participant is happening on screen (a reset on one agent's presence, for example).

Existing multi-agent chatter is intentionally left in the background. Two agents talking one-to-one — or a group of agents talking among themselves — continues to appear only as expandable bubbles in each participating agent's one-on-one conversation with the user, the way it does today. That mechanism is genuinely valuable ("I want to peek at what my agent is up to with its peers") and stays exactly as it is. Only rooms the user is a member of become explicit relay sessions in the sidebar; rooms the user isn't a member of remain observed through the participating agents' one-on-one panes.

Turn-taking among agents in a multi-participant room is handled by prompting, not by protocol. Directives like "not every message needs a response," "only speak when you have something to add," "don't get into acknowledgment echoes with other agents" go into the identity substrate all agents inherit, so this behavior falls out uniformly across the fleet without any addressing scheme in the room protocol itself.

The absence of a context indicator on human identity presences is deliberate. It's simultaneously accurate (humans don't have a bounded context) and functional as a lightweight visual distinction between human and agent participants without adding any per-role decoration.

The Telegram bridge — which today delivers one-on-one human-agent traffic to the user's phone — is fully out of scope. Because relay sessions can never be exactly one human plus one agent (that combination is disallowed by the new-conversation flow), the two systems have no overlap in the rooms they touch. The bridge continues to work as it does today, untouched.

## Prior context

Skynet today supports exactly one shape of user-facing conversation: a human in the browser front-end driving a single agent's harness through the compose box. The relay is present but the human never talks through it directly — the user's traffic goes to the agent's working environment, and inbound relay messages the agent receives from other agents are surfaced back in the same pane as expandable bubbles parsed out of the agent's own session transcript.

Every agent already has a durable relay identity, provisioned on the identity's first wake, and a receiver process that watches every room the identity is a member of and wakes the agent on every message. Agent-to-agent one-on-one and agent-only group rooms already run on this substrate. Auto-joining invited rooms and cursor-resumed catch-up after downtime already work.

Human relay identities exist somewhere in the current system, likely as a piece of the Telegram-bridge machinery. What that looks like — where the credentials live, whether every Skynet user has one today, whether provisioning is eager or lazy — is not fully known and is a discovery task in the first phase of this build.

The front-end already renders inbound relay traffic in one-on-one panes with some form of sender attribution (a hue or badge on the bubble), which suggests the primitives for member-attributed bubbles in a multi-participant room may already partially exist and could be leaned on rather than re-built.

Human avatars, a genuine prerequisite for the humans-first identity-presence row to render with visual identity, is a separately-shipped feature that landed independently during the conversation that produced this shape file.

## What would make it wrong

If a user has to think about "which kind of session am I in" to know what will happen when they type, the two session types haven't been unified well enough at the surface.

If agents in a multi-participant room step on each other's replies or get into acknowledgment echoes, the prompt-directive layer isn't doing its job and needs strengthening rather than switching to explicit-mention addressing (which was deliberately rejected).

If relay sessions accumulate silent chatter that pushes the sidebar-ordering-by-recent-activity into noise (unimportant traffic constantly re-sorting real conversations), the mingled-sidebar decision is wrong for real use and needs revisiting.

If the current one-on-one experience degrades in any way — new latency, new bugs, new behaviors — the orthogonality invariant has been broken and the parallel-session-type architecture wasn't actually parallel.

If a human's own bubbles show up in the pane as somehow different from what other humans in the same room see when they look at that same bubble, the sender attribution model has drifted and different viewers are seeing different truths about the same message.

If users start avoiding relay sessions because they're less pleasant than one-on-one panes for the same conversation content, the UI parity goal has failed in practice even if it holds on paper.

## Scope edges

**In.**
- A second session type, alongside the existing one, backed by relay-room membership.
- The new-conversation modal and its flow (participants picker, disallowed single-agent selection, mingled-with-existing sidebar entry).
- Sender attribution on every incoming bubble in relay sessions.
- Identity presences at the top of relay-session panes, humans-first-then-agents, with per-agent context indicators and reset actions bound to the identity presence.
- First-class human relay identities in Skynet's data (promoting or replacing whatever exists today).
- Prompt-directive updates in the identity substrate so agents handle multi-participant rooms well by default.
- Discovery of the current state of human relay identities as the opening act of the first phase.
- Materializing a relay-session record when the user's relay identity joins a room by any route (invited from outside the new-conversation flow, added by another user's action, etc.).

**Out.**
- Explicit mention-based addressing or any protocol-level turn-taking; prompt-directives handle this.
- Any change to Telegram-bridge behavior; the two systems don't overlap.
- Rendering agent-only room traffic as its own session type; it stays in the existing one-on-one panes as expandable bubbles.
- Any coordinator-versus-actor special-casing; both are just agents that can be invited to rooms.
- Any dedicated read-only-observer concept; a human who wants to watch just joins and doesn't type.
- Human avatars — a separately-shipped prerequisite already landed.

**Deferred to a later revision.**
- Leaving a relay session; the affordance isn't in v1 but is easy to imagine wanting later.
- Agents creating rooms that pull humans in (or inviting humans to existing rooms); v1 confines room-creation-that-includes-humans to human-initiated flows through the new-conversation modal.
- Visual distinction between relay sessions and one-on-one sessions in the sidebar; v1 mingles them by recent activity with no distinguishing chrome, and this may be revised after using it.
- Message editing, redaction, reactions, per-message reply threading — none of these are v1.
- Kicking or removing other members from a room after creation; membership is fixed at creation for v1.
- Typing indicators, read receipts, and other multi-party presence affordances.

**Tempting but no.**
- Adding a "you're alone in this room" empty state or any other special case for degenerate memberships. Rooms with only one member are just quiet rooms.
- Building any "unread messages" or notification-dot mechanism on the sidebar as part of this build. If the existing sidebar has such a mechanism relay sessions naturally participate; if it doesn't, this build doesn't add one.
- Trying to hide or dedupe the peer-agent chatter that appears in one-on-one panes now that relay sessions exist. It stays exactly as it does today — visible-if-you-expand-the-collapsed-bubbles — because it's still useful.

## Vehicle notes

Multi-phase GSD build. Approximate slicing (subject to plan-phase refinement):

1. **Discover-and-promote human relay identities.** Figure out what exists in Skynet today for per-user relay credentials (likely near the Telegram-bridge machinery), promote it to a first-class Skynet-side concept the new session type can rely on, and backfill any users missing an identity. Every Skynet user should have a durable relay identity by the end of this phase, whether or not they've ever tried to open a relay session.

2. **Session-model generalization on the back end.** Introduce the second session type in Skynet's session storage. Every session record carries enough state to render as either a one-on-one harness session or a relay-room session. All existing sessions stay intact and behave identically. Also picks up the sibling piece: when the user's relay identity joins a room by any route (invited from outside the modal, joined via another user's action), Skynet materializes the session record and adds a sidebar entry.

3. **New-conversation modal and room-creation flow.** Front-end affordance (compose-new-message icon), participant picker with tabs for humans and agents, disallowed single-agent selection, create-room-and-materialize-session-record wiring end-to-end.

4. **Relay-session pane rendering.** Uncollapsed bubbles sourced directly from the relay (not from parsed session transcripts). Sender-attributed on every incoming bubble. Identity presences at the top of the pane, humans-first-then-agents, per-agent context indicator and reset action on each agent's presence. Compose sends the user's typed message via their relay identity into the room.

5. **Identity substrate directive bank.** Adds the multi-agent-etiquette directives ("not every message needs a reply," "don't echo acknowledgments," "only speak when you have something to add") to the substrate all agents inherit. Small; could be shipped standalone as a quick task, or bundled with any other phase's ship.

Phases 1 and 2 are backend-heavy; 3 and 4 are front-end-heavy; 5 is a standalone directive bank in the identity substrate that doesn't touch Skynet code at all. Phase 1 unblocks everything downstream because every other phase assumes durable per-user relay identities exist. Phases 3 and 4 can potentially be sequenced or partially parallelized depending on how the session-model shape settles in phase 2.

The human-avatars prerequisite has already shipped independently during the shaping conversation, so the humans-first identity-presence row has visual identity to show by the time phase 4 renders it.

The identity implementing this work is box-maintainer, working out of `~/.claude/roles/box-maintainer/bounties/relay-mediated-group-conversations-humans-agents-in-rooms/`. The bounty's timeline is where cross-phase context and decisions taken during execution should be recorded.
