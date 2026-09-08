# Phase 90: Relay-mediated group conversations sub-slice D — relay-session pane rendering with per-agent badge affordances - Context

**Gathered:** 2026-09-08
**Status:** Ready for planning

> **Seeded from shape file** per `/build` convention — the shape file (`.planning/shapes/shape-relay-session-pane-rendering.md`) already locked all the decisions below via a walked-one-at-a-time `/open` conversation with Ashley (2026-09-08, all greenlit `thumbs up`). This CONTEXT.md is the discuss-phase artifact that translates those decisions into a form downstream agents (researcher, planner) can act on without re-asking. Read the shape file for the fuller narrative; this file is the actionable extract.

<domain>
## Phase Boundary

When the sidebar surfaces one of the new room-backed session records (materialized by Phase 89 slice B) and the user clicks it, the conversation pane needs to render it as a group chat — bubbles attributed per-sender, participants shown as an identity-badge row at the top of the pane, per-agent context meters and reset actions attached to each agent's badge, compose box that sends via the viewing user's own relay identity into the room.

Depends on: Phase 88 (slice A, human relay identities first-class — guarantees the viewing user has a durable relay identity to send with) + Phase 89 (slice B, session-model generalization + room-join materialization — guarantees the room-backed session record exists in Skynet and has a kind discriminator the pane can branch on).

**What ships here:** a new relay-session pane component that renders room-backed sessions end-to-end (bubble list with pagination, identity-badge row with per-agent affordances, compose box). Shared primitive extractions where genuinely useful (outbound "you speaking" bubble, compose textarea + send-button visual shell). Pane-orchestration selection at the sidebar-open level based on the kind discriminator from Phase 89.

**Scope anchor:** slice D adds a NEW pane implementation and MINIMAL shared-primitive extractions. It does NOT modify pretty view (the harness-session pane) in any way; if visual drift between the two panes becomes a real problem later, a separate future convergence slice handles that. Slice D does NOT build the create-room modal (slice C) or the agent multi-participant etiquette directives (slice E).

</domain>

<decisions>
## Implementation Decisions

All 16 decisions below were walked one-at-a-time with Ashley during the `/open` conversation for this shape (2026-09-08). Each was greenlit `thumbs up` before advancing. The shape file's `## Shape` and `## Philosophy` sections are the fuller narrative; below is the actionable extract.

### Architecture

- **D-01: Two panes side-by-side, not one modified pretty view.** The surface similarity between a harness-session pane and a relay-session pane is a trap — every layer that looks the same on screen (bubble list, scroll, compose box, message flow) is driven by radically different plumbing underneath (data source, pagination shape, send round-trip, per-participant state, chrome, attach behavior, stop/recap semantics). Folding both into one pane grows a kind-branch at every one of those layers and puts the accumulating complexity inside the currently-working harness pane, compounding regression risk. Instead: build the relay pane as its own component tree, entirely separate orchestration. Pretty view (the harness pane) is NOT modified in this slice.

- **D-02: Share truly-primitive pieces only. Don't share pane orchestration.** Where both panes genuinely render the same visual piece, extract the primitive and share it. Where orchestration diverges, don't try to unify. Genuinely-shared pieces: (a) the sender-attributed inbound bubble primitive already shipped 2026-08-18 by tiffany (bounty `relay-inbound-bubble-sender-hue-recolor`) — reuse as-is, no extraction needed; (b) the user's outbound "you speaking" bubble — extract from pretty view into a shared primitive that both panes consume; (c) the compose box's visual shell (textarea + send button) — extract as a primitive, each pane passes in what's enabled around it in its own upper area. NOT shared: data fetching, pagination trigger, top-of-pane chrome/presence-row, attach/stop/recap wiring, per-participant state — these live entirely inside their respective pane orchestrations.

- **D-03: Don't refactor pretty view onto the shared primitives in this slice.** Extract shared primitives minimally, land the relay pane on top of them, leave pretty view consuming its current private components. The strongest guarantee pretty view doesn't regress is not editing it. If drift between the two panes becomes real later, a small convergence slice migrates pretty view onto the shared primitives then. Rationale: primitives extracted with only one consumer in mind may have the wrong shape for a second consumer; discovering this via the relay pane rather than by breaking pretty view is safer.

### Compose box

- **D-04: The whole upper area of pretty view's compose box vanishes in the relay pane.** Pretty view's compose has an upper area containing reset button, context window meter, queue-a-message button, stop button, thumbs-up button, and recap button. The relay pane's compose has NO upper area at all. Reset and context meter move to per-agent badge appendages (D-08). Queue-a-message, stop, thumbs-up, and recap are all gone entirely because they have no meaning in a relay-room session: no single agent to stop, no work-in-progress state to acknowledge or queue against (relay sessions never show a WIP indicator), relay's message history IS the transcript so nothing separate to recap.

- **D-05: Attach button HIDDEN entirely for v1.** Not shown-but-disabled with a tooltip — hidden. Absence-as-affordance is cleaner than teasing missing functionality; a disabled button with a "coming later" tooltip would raise "why can't I attach here?" questions from users and take real chrome space for zero present benefit. Trivial to flip to visible when v1.5 attach support lands.

- **D-06: Compose box lower area (textarea + send button) matches pretty view visually.** Extract the visual shell as a shared primitive (per D-02.c). Each pane passes in what's enabled in its own upper area — pretty view keeps meter/reset/queue/stop/thumbs-up/recap; relay pane has no upper area at all. Same visual bottom, different upper. The compose box PRIMITIVE takes props for what's enabled around it; it doesn't know which mode it's in.

### Identity-badge row

- **D-07: Presence row layout — horizontal row of identity badges at the top of the pane, humans first then agents, alphabetical within each role.** One badge per participant EXCEPT the viewing user (right-side-is-you convention holds — no self-tile). Ordering: humans first, agents second; within humans, alphabetical by name; within agents, alphabetical by name. NOT recency-of-last-message reshuffling (rejected during grill — the row is right at the top of the pane and reshuffling on every message would feel restless during a lively group). NOT fixed-at-room-creation (arbitrary and unreadable).

- **D-08: Per-agent badge shape — existing identity badge + shrunk meter/reset appendage hanging off the bottom.** Reuse the existing identity badges already in use elsewhere in pretty view (fleet-consistent visual language). Each agent's badge has a small area hanging off the bottom containing a shrunk-down version of pretty view's compose-box context meter and reset button. Same visual language, same underlying behavior — just smaller and repositioned per-agent rather than pane-wide. NO new UI controls invented.

- **D-09: Per-human badge shape — plain identity badge, no appendage, no meter, no reset.** Absence of the appendage IS how a viewer visually distinguishes humans from agents in the row. Humans don't have bounded context (nothing to meter) and nothing to reset. Doubling as functional (nothing to render) and as UX distinction (visible role difference at a glance).

- **D-10: Per-agent state source — reuse pretty view's existing per-agent state channel.** The context meter reading and the reset action's underlying behavior come from the same source of truth that drives pretty view's meter + reset today. NO new plumbing invented for per-agent state. Consequence: the same agent viewed in either pane (its dedicated harness pane OR its badge in a relay-room pane) shows identical context number, and reset behaves identically from either surface.

### Bubbles + message history

- **D-11: Inbound bubbles sourced directly from the relay — NOT from parsed session transcripts.** Unlike the current peer-agent-chatter rendering in the harness pane (which parses expandable bubbles out of the agent's session transcript), relay-room bubbles come straight from the relay's own message-history endpoint (for older messages) plus a live subscription (for new messages arriving in the room). Every incoming bubble is attributed to its sender.

- **D-12: Inbound bubble visual — reuse the already-shipped sender-attributed inbound bubble primitive.** The primitive shipped 2026-08-18 by tiffany (bounty `relay-inbound-bubble-sender-hue-recolor`) renders inbound-relay bubbles today in the harness pane with per-sender hue, left-alignment, and resolved-identity dot. This primitive is exactly what a group-room member's bubble needs; reuse as-is. Same visual encoding harness-pane peer-chatter bubbles use today — users who've seen the harness-pane version will recognize the group-pane version immediately.

- **D-13: Outbound bubbles use the existing right-aligned "you speaking" visual style.** The viewing user's own bubbles render right-aligned in the pane FOR ASHLEY, using the same visual style pretty view uses for user-turn bubbles. Extract this bubble style as a shared primitive per D-02.b (both panes render the same-shaped user bubble in the same way).

- **D-14: Message-history pagination — behavior matches pretty view 1:1.** Same initial load size when the pane opens, same scroll-back trigger (whatever UX pretty view has for loading older messages — infinite scroll on approach to top, or explicit button, whichever pretty view does today), same batch size on load-more. The plumbing underneath is entirely different (relay message-history endpoint vs. session-transcript parsing) but the OBSERVABLE behavior at the surface is identical. Concrete numbers not being locked here — the planner reads pretty view's implementation and matches.

### Send round-trip

- **D-15: Send via the viewing user's own relay identity into the room.** On send, the typed message goes out through the viewing user's own relay identity (guaranteed durable by Phase 88 slice A) into the room ID from the session record. The message appears in the pane as an outbound bubble (right-aligned, "you speaking" style).

- **D-16: Optimistic-send behavior matches pretty view.** Whatever pretty view does today for the "message appears in pane before/after server confirmation" behavior — the relay pane does the same. Concrete behavior not being locked here — the planner reads pretty view's implementation and matches.

### Edge cases (defensive defaults)

- **D-17: Empty room state — empty middle area + normal compose bar.** A pane opened on a fresh room with no messages yet renders the presence row at the top, an empty middle area (no "empty state" chrome or messaging), and the normal compose bar at the bottom. User types, sends, and the first bubble appears. No special empty-state handling required.

- **D-18: Room-not-found / membership-lost — friendly error state, not a crash.** If the pane opens on a session record whose underlying room the relay says doesn't exist anymore, or where the viewing user is no longer a member, render a friendly error state in the pane area (something like "This conversation is no longer available") rather than crashing or showing an empty pane. Sidebar entry handling is out of scope for this slice — slice B's observation loop transitions the record to inactive on external kick (per Phase 89 D-03), and inactive rows are filtered from the sidebar anyway; the pane-level error state is a defensive fallback for the transient window between kick and observation-tick.

- **D-19: Inbound attachment — minimal placeholder text, media rendering deferred.** If an inbound message arrives with an attachment (rare in v1 rooms since outbound attach is hidden, but possible via Element clients or already-existing agent-to-agent rooms with media), render it as a minimal placeholder (e.g. "attachment: <filename>" text). Full media rendering (image thumbs, file chips, etc.) is deferred to when outbound attach itself ships.

### Mobile

- **D-20: Mobile layout intentionally deferred to v1.5.** Ship v1 with reasonable behavior (identity-badge row does something sensible in narrow viewports — horizontal scroll or wrap, whichever falls out most naturally from the primitive extractions and the existing responsive patterns in pretty view). Revisit once real rooms with real participant counts show the actual pain points. Ashley 2026-09-08 verbatim: *"for version one, if we have to figure out something different or how to handle it exactly on mobile then i feel like that's something i could come back with after this stuff is already in place rather than think i can try to perfectly plan it right now."*

### Claude's Discretion

- Concrete component tree structure for the relay pane (single file vs split across modules) — planner's call, follow existing frontend organization conventions.
- Concrete primitive extraction shape: outbound "you speaking" bubble as a single component vs. two components (a bubble shell + a text renderer), compose box shell as `<ComposeBoxShell>` with slot props vs. sub-components — planner's call.
- Concrete kind-discriminator branching site (at `PrettyView` entry vs. at a higher shell component vs. at a router level) — planner's call, follow existing pane-selection conventions.
- Concrete "friendly error state" copy + visual for D-18 — designer/planner's call, should match existing empty-state / error-state visuals in Skynet.
- Concrete pagination page-size + trigger match with pretty view — planner reads pretty view's implementation and matches; do NOT re-invent.
- Concrete optimistic-send match with pretty view — planner reads pretty view's implementation and matches; do NOT re-invent.
- Concrete "inbound attachment placeholder" text/rendering — planner's call, must be recognizable as an attachment without inventing media rendering.
- Concrete responsive breakpoint / overflow behavior for the identity-badge row on narrow viewports — planner picks a reasonable default; v1.5 will revisit.
- Concrete data-fetching shape for message history + live subscription against the relay — planner reads existing relay-fetching conventions (recv.sh cursor pattern for reference, but frontend needs its own primitives).

</decisions>

<constraints>
## Constraints From Fleet Rules

- **No worktrees** (fleet rule). All work in main working tree on `feat/tab-title-from-tmux`.
- **Push not authorized as part of phase execution.** Deploy motion is orchestrator-owned per fleet rule. Push happens at arc-close after slices C + E land and `/close relay-mediated-group-conversations` passes against the master shape.
- **No streaming anywhere.** Skynet has no message streaming, ever — bubbles render atomically after send/receive lands. Do NOT design around streaming state, do NOT add streaming affordances (typing indicators, "streaming…" spinners, auto-expand-while-streaming behaviors).
- **Scoped tests during dev; full suite deferred to deploy gate** (fleet rule, Ashley 2026-08-20 + 2026-09-07 refinement). Executor's own green-gate is scoped tests only (`--related <files>` or targeted `src/ui/features/<feature>/`); full suite runs at orchestrator ship-gate AFTER Ashley's explicit ship greenlight, which is deferred to arc-close.
- **Executor doesn't ship** (fleet rule, Ashley 2026-08-08). Plans must NOT include a "ship" task at executor scope. Executor's remit stops at code + commit + scoped tests green.
- **Every backend write to a user row must be paired with `DatabaseSaveTrigger.forceSave`** (Skynet in-memory-DB invariant). NOT expected to apply in this slice — slice D is frontend-primary — but flag if any backend touch surfaces.

</constraints>

<references>
## References

- **Shape file:** `.planning/shapes/shape-relay-session-pane-rendering.md`
- **Master arc shape:** `.planning/shapes/shape-relay-mediated-group-conversations.md`
- **Slice A shape (dependency):** `.planning/shapes/shape-relay-human-identities-first-class.md`
- **Slice B shape (dependency):** `.planning/shapes/shape-relay-session-model-generalization.md`
- **Slice C shape (sibling):** `.planning/shapes/shape-relay-new-conversation-flow.md`
- **Bounty:** `~/.claude/roles/box-maintainer/bounties/relay-session-pane-rendering/`
- **Parent bounty (pinned):** `~/.claude/roles/box-maintainer/bounties/relay-mediated-group-conversations-humans-agents-in-rooms/`
- **Sender-attributed inbound bubble (already shipped, reuse target):** `bounty relay-inbound-bubble-sender-hue-recolor` (tiffany, 2026-08-18)
- **Pretty view (harness pane, do NOT modify):** `src/ui/features/pretty-view/`

</references>
