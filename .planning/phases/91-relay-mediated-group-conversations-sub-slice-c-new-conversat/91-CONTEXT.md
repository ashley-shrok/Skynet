# Shape: relay group conv — sub-slice C: new-conversation modal + create-room flow

**Opened:** 2026-09-08 (seed) · refined 2026-09-09 with prototype tasting
**Vehicle:** `/build` outer — GSD phase for the code work
**Bounty:** `relay-new-conversation-flow` (box-maintainer role)
**Parent shape:** `.planning/shapes/shape-relay-mediated-group-conversations.md`
**Parent bounty:** `relay-mediated-group-conversations-humans-agents-in-rooms`
**Depends on:** sub-slice A (`relay-human-identities-first-class`), sub-slice B (`relay-session-model-generalization`).
**Tasting prototype:** http://100.99.149.8:8899/index.html — served from the bounty folder for the life of this session; four variants shown across mobile + desktop; Alice picked variant D (sectioned single list + search filter).

## What this is

A new-conversation affordance in the Skynet front-end. From the three-dot menu at the top of the conversation list, a "new conversation" action opens a modal. The modal shows every human and every existing agent in the fleet as a single sectioned list with a type-to-filter search bar above; the user picks any combination of participants and enters a mandatory room name. On confirm, the flow creates a room on the relay via the user's own relay identity, invites the picked participants, and (via the session-model machinery from sub-slice B) materializes a session record so the room appears in the sidebar mingled with existing conversations. The pane opens to the new session, ready for the first message.

Two surfaces, not one. The modal must work equally well as a mobile full-screen modal and as a centered desktop dialog — Skynet is a desktop AND mobile web app, and this modal is validated on both surfaces before it ships.

## Shape

Layout, top to bottom (both surfaces):

- **Modal header** — title "New conversation", close X.
- **Room name field** — mandatory. The user enters a name they'll recognize later.
- **Chips strip** — displays who has been added so far. Empty-state placeholder text when nothing is picked. Each chip has a small color swatch (matching that participant's identity color), the name, and an X to remove.
- **Search field** — type-to-filter across both humans and agents by substring on name, case-insensitive. Clear button appears when the field has content. When a filter is active, the section headers show a "N of M" count so it's clear the list is narrowed.
- **Sectioned participant list** — one scrollable list with two section headers: Humans and Agents. Each row is an avatar circle (color-tinted per identity), the name, and (for agents) a subtitle line. Tap or click the row to toggle selection; a check circle on the right fills when the row is selected.
- **Create button** — disabled until three conditions hold: at least one non-self participant picked; the picked set is not exactly one agent alone; and a room name is entered. Hint text below the button explains the current blocker.

Mobile: single-column, fills the phone screen. Desktop: same layout in a centered dialog roughly 560px wide. Same design, adapted to width — both surfaces see the same modal, not a fundamentally different one.

Once the picker is confirmed:

1. A room is created on the relay via the user's own relay identity (from sub-slice A).
2. The picked participants are invited to the room. Agents auto-join via their receivers; humans auto-join via the same observation loop that runs for the user themselves.
3. The session-model machinery (sub-slice B) materializes a session record for the user and adds a sidebar entry.
4. The pane opens to the new session, ready to compose the first message.

Creating a new agent is a completely separate flow that already exists in Skynet. This modal is only for composing conversations with participants that already exist.

## Philosophy

Orthogonal to agent creation. If you want to talk to a new agent, you make one first through the existing agent-creation flow, then come back here to compose a conversation. Blurring the two would tempt users into accidentally birthing agents when they meant to start a conversation.

Constrained by the master shape's decision that v1 has no leaving and no post-creation membership changes. Participant selection at create time is the ONLY chance for the user to shape the room's membership. Get it wrong and you discard the room and start over. Same rule extends to the room name: v1 doesn't offer renaming.

The single-agent-disallowed constraint isn't about protocol — it's about UX coherence. Nothing on the relay stops a room of just two members existing (indeed all agent-to-agent DMs are such rooms). But surfacing that room in a way that overlaps with the existing harness-session sidebar entry would confuse users.

Search-first for browse, not because the fleet is huge today, but because it grows. A modal that requires scrolling through 30 agents to find one gets worse as the fleet grows; filter-as-you-type sidesteps that.

Both surfaces validated. A design that only works on the phone regresses the moment the user opens Skynet on desktop, and vice versa.

Icon placement is v1-throwaway. The compose action lives inside the existing three-dot menu at the top of the conversation list because that whole area is being redesigned soon; adding new chrome that'll be reworked is wasted effort.

## Prior context

Per the master shape: agents are picked from the existing fleet — the fleet has to already have an agent for you to add them here. Humans are picked from Skynet's user set — with human relay identities as first-class after sub-slice A, every Skynet user is addressable.

Sub-slice B's materialization loop watches the user's relay-identity room memberships. This create-flow will trigger that loop naturally when the room is created, so the sidebar entry appears via the same mechanism as any other join.

Design decisions from the tasting (2026-09-09):

- Modal design: variant D — sectioned single list plus search filter.
- Placement: three-dot menu at top of the conversation list, v1 throwaway.
- Zero-participant rooms: disallowed.
- Room name: mandatory at create time.
- Rename after creation: not in v1.

## What would make it wrong

- A single agent gets picked and Create fires, producing a room that duplicates the existing harness-session sidebar entry.
- A room gets created on the relay successfully but no session record materializes and the user never sees the room in the sidebar.
- The modal restricts adding participants to those who are currently "online" or "reachable" — the wrong invariant, since relay identities are durable and always addressable.
- Two rapid clicks on Create produce two rooms. The button lacks debounce or the flow lacks idempotency.
- Adding an agent as a participant triggers a "wake" or "prompt" to that agent to accept an invite. Agents auto-join via their receivers; no ceremony.
- The search filter is broken or missing, so the participant list becomes unusable when the fleet grows past a couple dozen.
- The modal renders correctly on mobile but breaks on desktop, or vice versa. Both surfaces are load-bearing.
- The Create button is enabled while the state is invalid — zero participants, one agent alone, or blank name. The gate exists precisely so misfires are impossible.

## Scope edges

**In.**

- The "new conversation" action inside the existing three-dot menu at the top of the conversation list.
- The modal UI on both mobile and desktop: mandatory room name field, participants chips strip, type-to-filter search field, sectioned single list (Humans + Agents) with tap-to-toggle selection.
- Single-agent-disallowed guard with clear UI communication (Create disabled + hint text).
- Zero-participant guard.
- Mandatory room name enforcement.
- The create-room-and-invite wiring on confirm.
- Handoff to sub-slice B's materialization loop so the sidebar entry appears and the pane opens.
- In-process test coverage for the whole user flow.

**Out.**

- Pane rendering (sub-slice D — separate work).
- Session-model plumbing (sub-slice B — already shipped).
- Human relay identities (sub-slice A — already shipped).
- Agent creation (existing separate flow, unchanged).
- Adding participants after creation (v1 has fixed membership).
- Renaming the room after creation (v1 name is fixed at create time).

**Deferred to a later revision.**

- Editing the participant list after creation.
- Editing the room name after creation.
- Inviting non-Skynet users via some external invite flow.
- Advanced filter or sort options beyond substring-on-name (recent conversations, groups, favorites).
- A dedicated compose-new-conversation icon in the sidebar chrome, once the conversation-list area gets its planned redesign.

**Tempting but no.**

- Auto-suggesting participants based on prior conversation patterns.
- Allowing a solo room (zero participants besides yourself) as a private note space. Solo rooms exist as a natural consequence of the protocol but this is not the flow to create them.
- Adding chrome to the sidebar for the compose action while the whole area is queued for redesign.

## Vehicle notes

`/build` outer vehicle. Inside step 2, execution is a GSD phase — the work is phase-sized (frontend modal UI + backend create-room-and-invite wiring + integration with the sub-slice-B materialization loop + in-process tests + threat model + regression coverage).

Depends on sub-slices A and B (both shipped). Can proceed in parallel with sub-slice D (which is code-complete and awaiting arc-close ship).

The prototype at http://100.99.149.8:8899/index.html is the reference for the modal's shape at both surfaces. The phase's CONTEXT.md should seed from this shape file per `/build` convention — don't re-elicit the discovery `/open` already produced.

`/close relay-new-conversation-flow` closes the sub-slice at the end. The parent arc's `/close relay-mediated-group-conversations` runs later against the master shape once C and E and the ship all complete.
