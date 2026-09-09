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

---

## Close-Out

**Closed:** 2026-09-09
**Vehicle used:** /build arc → GSD phase 93 (5 slices on branch `feat/tab-title-from-tmux`), ahead of origin by 21 commits (20 code/docs + 1 verification). Rescue-rebased from local Phase 92 slot 2026-09-09 after tina's origin Phase 92 (fleet-status batch sweep) shipped; pure slot collision, file-disjoint.
**Overall verdict:** closed-with-misses

### Shape features (conformance)

- **What this is — relay rooms dissolve into the shared chat surface (one surface, two sources)** — present · Standalone relay-room pane tree and its wrapper shell are gone; the dispatcher for relay-room tabs now mounts the shared chat surface with a relay-kind source.
- **Shape — data source produces messages; participant set defines who is in the conversation; rows learn to display multiple badges** — present · A discriminated-union source type exists; a unified adapter hook calls both source adapters unconditionally; the multi-badge anchor grows leftward from the existing anchor spot, humans-first-alphabetical then agents-alphabetical, viewing-user self-excluded, humans without meter, agents with meter. Harness single-badge subtree preserved byte-identical.
- **Shape — bubbles left take sender identity colour, bubbles right stay viewer blue** — present · Message-list rendering dispatches on message kind to the pre-existing outbound (viewer, right/blue) and sender-attributed inbound (left, sender-hue) bubble components, unchanged.
- **Shape — compose box's ambient chrome hidden when source is relay; textarea + send unchanged** — present · Compose box takes a mode cue; the upper row (meter/reset + interrupt/thumbs-up/recap/queue aux group) and the attach button are gated together monolithically; the textarea + send subtree is byte-identical between modes.
- **Shape — tab identity, URL, sidebar row, drag-to-split, hydration, layout unchanged (works for both cases because relay rides the same surface)** — present · Comment sweep across the app state stores, tab-list, and other reference sites updates them to the new architecture; the tab-level discriminator stays; relay tabs route through the shared surface with the host requirement widened to permit them.
- **Philosophy — one chat surface, two data sources (not two surfaces that resemble each other)** — present · The shared chat surface is the single surface; the relay adapter is a data-source hook, not a wrapper surface. No thin wrapper survives.
- **Philosophy — reference implementation stays intact; extensions grow ON the harness surface** — present · Harness case-branches keep the pre-existing subtree byte-identical; extensions mount alongside via case-alternative mount sites at the same anchor positions.
- **Philosophy — data over configuration (differences come from the data source, not surface-side conditional logic)** — partial · Message-kind rendering is data-driven (relay adapter never emits WIP indicator, task shells, sub-agent bubbles, so they never render). Compose chrome takes an explicit mode cue — this is the shape's named exception. However, additional surface-side case-conditionals exist: the badge-anchor mount site, the message-list mount gate (relay case bypasses the harness streaming-gate so relay content can render), and the error-state mount (see additions).
- **Philosophy — no new duplication (standalone pane retires entirely)** — present · Retirement grep for all eight retired names against `src/` returns zero hits (code and tests). The formerly-standalone directory is deleted.
- **Prior context — UAT gaps fold in as consequence (badges not clickable, bubbles not rendering, tab identity, drag-to-split, URL append, badge positioning, meter position)** — present · Relay tabs now ride tab-identity/URL/drag-to-split/hydration machinery the harness surface already has. Bubbles render via the existing message-list pipeline. Badge-click is a no-op in the relay case per shape.
- **Scope edges — In** — present · Row set-of-badges rendering, source-prop consumption, meter-skip via participant set, compose ambient-chrome hide, relay data path wiring, standalone pane retirement all landed.
- **Scope edges — Out** — drifted · The "redesigning anything visible" edge is bent by the new-type error screen (see additions). Everything else respected: no new message kinds, relay badge-click is no-op, harness case preserved, no streaming, no presence/typing.
- **What would make it wrong: two chat surfaces still exist at the end (even a thin wrapper)** — present · Not violated. No wrapper around the shared surface survives; the dispatcher mounts it directly with a relay-kind source.
- **What would make it wrong: chat surface grows features that only make sense in one case and cannot be turned off cleanly in the other** — present · Not violated for the shape's named case (compose chrome). Multi-badge extension is source-agnostic at the component level (takes explicit participant + viewer props); harness case never mounts it. Extensions turn off cleanly by not-mounting per-case.
- **What would make it wrong: harness case regresses in any visible way** — present · Not violated by reading. Harness subtree is explicitly documented byte-identical; message-list read collapses to local state in the harness case (adapter is inert); all case-conditionals exclude the harness path; the 1061 pre-existing chat-surface tests remain green per the phase's own verification pass.
- **What would make it wrong: relay case relies on hidden per-case conditionals for message kinds** — present · Not violated. No case-conditional hides message kinds; accessory bubbles mount on their own data signals; the relay adapter never emits them.
- **What would make it wrong: standalone relay pane concept comes back later "for one small reason"** — present · Not violated. Deleted, dispatcher rewired, comment sweep done, retirement grep clean.
- **What would make it wrong: multi-badge support is baked into the surface in a way that specifically knows about relay rooms; the row itself does not know the difference** — present · The multi-badge component is source-oblivious: accepts explicit participant + viewer + fleet-identity props, reads no source-kind discriminator internally. Case-branching for which anchor to mount lives at the surface JSX level — the same posture the shape sanctions for compose chrome.

### Additions (in the result, not in the shape)

- **New-type error screen in the relay case.** A friendly-copy screen ("This conversation is no longer available." with optional subline) replaces the message list when the relay adapter reports an error (kicked from room, room deleted, WS inactive). Ashley's criterion at close: matches existing overlays = endorsed drift; new-type screen = unsanctioned. The existing overlays for the harness case (connection-failed, session-recycling) are full-surface scrims (z-band overlay layer + backdrop blur + iOS-Safari hardening + `animate-in fade-in`) with a centered glass card and a static glyph under an explicit motion-channel guardrail. The new screen has no scrim, no z-band overlay layer, no glyph, different card gradient / padding / gap, a max-width cap, and replaces the message list in-flow via a flex-1 slot rather than layering above the surface. Structurally a distinct visual pattern — a new-type error screen — not a case-adapted reuse of the existing overlay pattern. **disposition: unsanctioned**

### Follow-ups

- **Reshape the relay-case error screen to match the existing chat-surface overlay pattern.** Same full-surface scrim + centered glass card + static glyph + iOS-Safari hardening + z-band as the harness case's connection-failed / session-recycling overlays. Copy stays "This conversation is no longer available." with the same optional subline. That converts the finding from a new-type screen (unsanctioned) into a case-adapted reuse of the existing overlay pattern (endorsed). **disposition: new-shape**

### Notes

Retirement was thorough — 17 files deleted from the standalone tree, dispatcher rewired to mount the shared surface with a relay-kind source, comment sweep covers seven external ref sites, retirement grep clean in the code area. Adapter symmetry preserved: both source adapters always called (rules-of-hooks discipline), the harness one is a documented inert shim and the harness ingestion still lives inside the shared surface. Case-conditionals at the surface JSX level: badge-anchor mount branch, message-list mount gate (relay case bypasses the harness streaming-gate so relay content can render even though harness status isn't streaming), error-state mount, compose mode prop. The message-list mount gate is a real element that must be present-or-absent regardless of data (analogous to the compose-chrome case cue the shape sanctions) and was not raised as a divergence. Ashley set the endorsement criterion for the error screen at close: matches existing overlays = drift-endorsed; new-type screen = unsanctioned. The material shows a new-type screen; the follow-up above converts it into the endorsed shape.
