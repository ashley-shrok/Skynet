# Shape: Relay rooms use the chat surface — one surface, two data sources

**Opened:** 2026-09-09
**Vehicle:** gsd phase (inside `/build` arc)

## What this is

The harness chat surface — the polished view where the user talks to an agent — already gets the design right. Bubbles, compose box, badges, meters, participant colours, sidebar row, tab identity, drag-to-split. Group-mediated relay rooms are currently displayed by a separate second chat surface that was built from scratch, which inherits none of that design work. The fix is to stop treating them as two surfaces. There is ONE chat surface; a data source tells it what to render. When the source is a harness session, the user is talking to an agent; when the source is a relay room, the user is watching a group of participants exchange messages. The standalone relay-room pane dissolves; relay rooms display through the same chat surface everything else already uses.

## Shape

At the centre: one chat surface. It accepts a data source and a participant set. Everything else falls out from those two.

The data source produces messages. Different sources produce different kinds. A harness source can produce agent replies, tool calls, task shells, sub-agent bubbles, work-in-progress signals. A relay source produces text messages from participants and nothing else. The surface renders whatever the source gives it; nothing needs conditional hiding for message kinds the relay source simply does not emit.

The participant set defines who is in the conversation. In a harness session it is the user and one agent — one identity attaches to non-self messages, with a meter under the badge. In a relay room it is the user and many others — a row can carry more than one identity's badge, and no meter for anyone. This is the one place the surface actually grows: rows learn to display multiple badges instead of one. The harness case always supplies exactly one and stays visually unchanged.

Bubbles on the right — belonging to the user viewing this — stay their existing colour. Bubbles on the left take on the sender's identity colour, which is already fully supported. Badges on the left row: harness case shows one and a meter; relay case shows one-or-many and skips the meter.

The compose box carries some ambient chrome that only makes sense when talking to an agent — an attach button on the textarea, and an upper row with reset, context meter, interrupt, thumbs up, recap. In a relay session those simply do not appear. The compose box itself stays; only its ambient chrome differs.

Everything else is unchanged. Tab identity, URL, sidebar row, drag-to-split, hydration, layout — all of that already works, and works for both cases the moment relay rooms live inside the same surface.

## Philosophy

**One chat surface, two data sources.** Not two surfaces that resemble each other. The moment there are two surfaces, they drift, and every fix to either has to be considered against the other. The moment there is one, the group case can never fall behind.

**The reference implementation stays intact.** The harness chat surface is not hollowed out into shared pieces. It IS the shared thing. Extensions grow ON it — multi-badge support, participant-set awareness. The harness case's use is preserved by defaulting to what it does today when the source supplies harness-shaped data.

**Data over configuration.** Wherever possible, differences between the two cases come from the data source, not from surface-side conditional logic. The relay source does not emit a work-in-progress signal, so no indicator appears — no toggle needed. Only where a real element must be present-or-absent regardless of data (compose-box ambient chrome) does the surface take an explicit cue about which case it is in.

**No new duplication.** The standalone relay-room pane retires entirely. Nothing that wraps or embeds the chat surface as its own surface survives. If it did, the drift problem this whole shape is fixing comes back the moment someone adds a feature to one wrapper and not the other.

## Prior context

The current standalone relay-room pane was built by an executor as a fresh chat surface rather than as an extension of what already exists. Consequences visible on inspection during UAT: badges are not clickable, badges and meters are positioned differently from the harness case, meters float detached from the badge, badges come in from the wrong side, message bubbles do not render at all, tab identity is not first-class, drag-to-split does not work, URL does not append. Every one of these is a well-understood behaviour in the existing chat surface and does not need to be re-solved.

Ashley's UAT walkthrough surfaced the disconnect at feel level: the pane looks and behaves nothing like the chat surface it lives next to. Her framing was verbatim: *"we specifically talked about reusing pieces so that it could live as its own thing but we don't have to create everything from scratch."* Then during this shape session, verbatim: *"is there a world where the pretty view stays largely intact and is just fed by different things, like different sources of data, essentially, for most of this? Because everything there already works."*

Bubbles-not-rendering is confirmed in both directions — send at the network layer works (Matrix acknowledges the event), but no bubble appears in the message list on either side. That symptom is expected to disappear as a side-effect of relay rooms rendering through the chat surface, whose message list already works.

Sibling bounties exist in the campaign for each individual UAT gap (badges, bubbles, sidebar rendering polish, tab first-class integration). Most fold into this refactor and close as a consequence of it landing.

## What would make it wrong

- Two chat surfaces still exist at the end — even if one is a thin wrapper around the other. That is the failure mode; nothing about the group room survives as its own surface concept.
- The chat surface grows features that only make sense in one case and cannot be turned off cleanly in the other. Every extension has to be shaped so that the case that does not need it looks exactly like today.
- The harness case regresses in any visible way. The daily chat surface must keep its exact current look and behaviour after the change — same bubbles, same badge position, same meter under the badge, same compose box, same everything. If a harness session looks any different than it does today, the seam is wrong.
- The relay case relies on hidden per-case conditionals for message kinds. The reason the work-in-progress indicator is absent in relay must be that the relay source never emits the signal, not that the surface has "if relay then hide" logic. Anything else is drift-in-waiting.
- The standalone relay pane concept comes back later "for one small reason." Once it dissolves, it stays dissolved.
- Multi-badge support is baked into the surface in a way that specifically knows about relay rooms. The row extension is about carrying a set of identities; whether the set has one member or many is the caller's business. The row itself does not know the difference between "harness case" and "relay case."

## Scope edges

**In.** Extending the chat surface's row rendering to accept a set of badges instead of a single one. Extending it to accept a data source rather than assuming a harness session. Skipping the meter when the participant set says so. Hiding the compose box's ambient chrome (attach + upper row) when the source is a relay one. Wiring the relay data path — history and live events from the relay backend, sends to the relay backend — as a data source the chat surface consumes. Retiring the standalone relay-room pane and every path that routed to it (tab type, routing, sidebar row rendering).

**Out.** Redesigning anything visible. Adding new message kinds. Deciding badge-click behaviour in relay rooms — no-op for now, revisited later. Changing how the harness case looks or behaves. Streaming (does not exist and never will in this codebase). Adding presence or typing indicators to relay rooms.

**Deferred.** Badge-click affordance in relay rooms — parked for a later pass. Any relay-room-specific message kinds (system events for participants joining or leaving, for example) — not needed for the base case; add later if wanted.

**Tempting but no.** Doing this as an "extract shared primitives from the chat surface and rebuild two thin surfaces on top" refactor. That was the first-instinct shape; the right shape is smaller — extend the existing surface, retire the duplicate, done.

## Vehicle notes

`/build` arc containing a single GSD phase. Slice breakdown deferred to `/gsd:plan-phase`. Not split across phases: the user-visible outcome is "relay rooms work through the same chat surface," which requires all pieces landing together. Splitting would double the ceremony without doubling the value.

Working tree: `/home/ubuntu/skynet-taylor`, branch `feat/tab-title-from-tmux`. Standing multi-identity rules apply (rebase-before-push, container-mutation coord-room announces, executor gate is scoped tests only with full-suite at deploy time).

Master campaign bounty: `relay-arc-uat-followups-campaign`. Individual UAT bounties in the campaign that fold into this phase's outcome (either as direct fix or as consequence of the retirement): `relay-room-message-bubble-render-broken`, `relay-room-tab-first-class-integration`, `relay-room-sidebar-rendering-polish` (partly already shipped), and the badges-not-clickable / meters-positioning items captured under `relay-room-pane-reuse-prettyview-pieces` itself. Those close as consequences of this phase landing; not extra work on top.

Identity holding the work: taylor. Coordinate container mutations with box-maintainer coord room per standing directive.
