# Shape: relay group conv — sub-slice C: new-conversation modal + create-room flow

**Opened:** 2026-09-08 (seed only — the sub-slice's `/open` conversation happens at the start of the session that picks this up)
**Vehicle:** `/build` (sub-slice of the parent multi-phase arc)
**Bounty:** `relay-new-conversation-flow` (box-maintainer role)
**Parent shape:** `.planning/shapes/shape-relay-mediated-group-conversations.md`
**Parent bounty:** `relay-mediated-group-conversations-humans-agents-in-rooms`
**Depends on:** sub-slice A (`relay-human-identities-first-class`), sub-slice B (`relay-session-model-generalization`).

> This is a SEED, written from the master shape as a running start for the sub-slice's `/build`. When the `/build` on this shape kicks off, its `/open` refines this into the final agreed shape file — grill remaining unknowns, adjust wording, close out.

## What this is

A new-conversation affordance in the Skynet front-end that lets a user compose a fresh relay-room conversation with any combination of participants (subject to one constraint — a single-agent selection is disallowed because that combination already exists as a harness session in the sidebar). On confirm, the flow creates a room on the relay, invites the picked participants, and (via the session-model machinery from sub-slice B) materializes a session record so the room appears in the sidebar mingled with existing conversations.

## Shape

Somewhere near the conversation list, a compose-new-message icon appears — the pencil-in-square shape common to messaging apps. Clicking it opens a modal. The modal shows all the humans and all the existing agents in the fleet that could be included in a conversation, likely on two tabs. Each entry has an add control; adding one puts it into a "participants" list for the pending conversation.

Constraints:

- **Single-agent selection is disallowed.** A conversation with exactly one agent and no other members would be redundant with the existing one-on-one harness session for that agent (which is already in the sidebar). The UI should communicate why — some visual signal on the "confirm" button, or a tooltip.
- **Any other combination is valid.** Two or more agents, one or more humans plus any agents, multiple humans alone. Including zero participants — a conversation with just yourself — is a design-decision to grill (probably out).

Once the picker is confirmed:

1. A room is created on the relay via the user's own relay identity (from sub-slice A).
2. The picked participants are invited to the room (agents auto-join via their receivers; humans auto-join via the same observation loop that runs for the user themselves).
3. The session-model machinery (sub-slice B) materializes a session record for the user and adds a sidebar entry.
4. The pane opens to the new session, ready to compose the first message.

Creating a new agent is a completely separate flow that already exists in Skynet. This modal is only for composing conversations with participants that already exist.

## Philosophy

Orthogonal to agent creation. If you want to talk to a new agent, you go make one first through the existing agent-creation flow, then come back here to compose a conversation. Blurring the two would tempt users into accidentally birthing agents when they meant to start a conversation.

Constrained by the master shape's decision that v1 has no leaving and no post-creation membership changes. Participant selection at create time is the ONLY chance for the user to shape the room's membership. If they get it wrong, they discard the room and start over.

The single-agent-disallowed constraint isn't about protocol — it's about UX coherence. Nothing on the relay stops a room of just two members from existing (indeed all agent-to-agent DMs are such rooms). But surfacing that room in a way that overlaps with the existing harness-session sidebar entry would confuse users.

## Prior context

Per the master shape: agents are picked from the existing fleet — the fleet has to already have an agent for you to add them here. Humans are picked from Skynet's user set — with human relay identities as first-class after sub-slice A, every Skynet user is addressable.

Sub-slice B's materialization loop watches the user's relay-identity room memberships. This create-flow WILL trigger that loop naturally when the room is created, so the sidebar entry appears via the same mechanism as any other join.

## What would make it wrong

- The modal lets the user pick a single agent and hit confirm, creating a room that duplicates the harness-session entry. The disallow constraint failed.
- The modal creates a room on the relay successfully, but no session record materializes and the user never sees the room in their sidebar. The sub-slice-B integration is broken.
- The modal only lets you add participants who are currently "online" or "reachable." That's the wrong invariant — relay identities are durable and always addressable.
- Two rapid clicks on confirm create two rooms. The button lacks debounce or the flow lacks idempotency.
- Adding an agent as a participant somehow triggers a "wake" or "prompt" to that agent to accept — no, agents auto-join room invites via their receivers, no ceremony.

## Scope edges

**In.**
- The compose-new-message icon + its placement in the front-end.
- The modal UI: participant browser (probably humans-tab and agents-tab), add-to-list controls, participants-pending display.
- Single-agent-disallowed guard with clear UI communication.
- The create-room-and-invite wiring on confirm.
- Handoff to sub-slice B's materialization → sidebar entry appearance → pane open.

**Out.**
- Pane rendering (sub-slice D).
- Session-model plumbing (sub-slice B).
- Agent creation (existing separate flow, unchanged).
- Adding participants after creation (v1 has fixed membership).

**Deferred to a later revision.**
- Naming the room. V1 probably auto-generates a title from participants; explicit naming may come later.
- Editing the participant list after creation.
- Inviting NEW users (not-yet-Skynet-users) via some external invite flow.
- Any search/filter in the participant browser beyond obvious "type to filter."

**Tempting but no.**
- Auto-suggesting participants based on prior conversation patterns.
- Allowing an "empty" room (zero participants besides yourself) as a private note space. Rooms of one member are just quiet rooms per the master shape, but this is not the flow to intentionally create them.

## Vehicle notes

`/build` cycle. Depends on sub-slices A and B. Can be sequenced with or parallelized against sub-slice D depending on how the session-model shape settles.

When the `/build` fires, its `/open` conversation should:
- Grill the two-tab-versus-single-list decision for the participant browser.
- Grill the visual placement of the compose-new-message icon (which specific spot in the sidebar, how it interacts with mobile layouts).
- Grill the auto-generated room title convention.
- Grill the empty-participant-list case (does confirm gray out, does the whole modal disallow zero participants, etc.).

Codebase touch points to look at during that discussion (not yet inspected):
- Existing sidebar + conversation-list rendering in the front-end.
- The existing agent-creation modal (for design-language consistency).
- Any existing user/agent enumeration APIs.
