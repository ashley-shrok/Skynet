# Shape: Room-case chrome and lifecycle should match session-case except where deliberately case-branched

**Opened:** 2026-09-10
**Vehicle:** GSD phase

## What this is

The chat surface was recently made to serve two data sources — a room and a harness session — with the promise that switching between them is nothing more than swapping the underlying source. In practice, when the surface is pointed at a room, it's silently inheriting behaviors and chrome from the session case. Seven things go wrong: the loading veil never dismisses even after messages paint; drag-and-drop into and out of the surface stops splitting and instead replaces (and, per the report, other split behavior appears disturbed until a full page reload); the compose box's vertical layout looks compressed with a ghost gutter on the left where an intentionally-hidden affordance used to sit, and a top-edge affordance is getting clipped; the participant indicators above the surface sit too far apart and their little usage meters float without proper chrome; the compose placeholder still names the wrong recipient; and the browser URL doesn't record the room the way it records a session. All seven are the same story: the room case wasn't case-branched where it needed to be.

## Shape

Seven findings, one root pattern. The chat surface promises "same shape, different data source." Where a session-case behavior needed to be case-branched for the room case, it wasn't — so the room case inherits session-case chrome and lifecycle silently.

Two of the seven are hard blockers:

- **Loading veil never dismisses.** When a room is opened, the veil comes up and stays up even though the messages themselves arrive and paint underneath it.
- **Drag-and-drop split placement broken.** Dragging a session onto a room-showing surface replaces instead of splitting (in both directions — surface as drop target, room as drag source). The user observed that after a room has been opened, split-view for even plain sessions is disturbed until a full page reload — which suggests the room-showing surface may be corrupting shared drag-and-drop state, not just failing to accept drops.

Four are chrome and copy polish:

- **Compose box vertical fit.** Three symptoms in the room case: input area too short, a ghost padding gutter on the left where the hidden attach affordance used to be, and a top-edge affordance clipped for lack of vertical headroom.
- **Participant-indicator gap too wide.** The indicators are laid out with the session case's outer gap repeated between them; the multi-indicator inner gap should be tighter.
- **Meter chrome floats.** The little usage meter that accompanies each agent participant renders unstyled and appears to float — no visible drawer chrome around it.
- **Compose placeholder still addresses the wrong recipient.** Should just say "message room" in the room case.

One is a lifecycle-signal miss:

- **URL persistence.** The URL bar doesn't record the currently-open room the way it records the currently-open session. Refresh loses the room.

The through-line for all seven: chrome and lifecycle signals in the chat surface were built for the session case and never got a room-case branch. The fix is to identify each unbranched signal and give it its room-case behavior.

## Philosophy

The user doesn't have a concept of "session" vs "room" as separate surface types — to her, it's one chat surface that happens to differ in visible ways where we've deliberately case-branched. The room case should feel identical to the session case except in the places we've explicitly changed for the room. Nothing implicit; no accidental inheritance.

What would violate the spirit even if it passed a test: a room-case treatment that stylistically diverges from the session case just because room mode "feels different." The user's expectation is parity in feel unless we deliberately made it not feel that way. If we're adding a case-branch, it's because we DECIDED to — never because a room case fell into a different code path by accident.

The meter's chrome (decided by tasting) is a **pull-out drawer that peeks from behind the pill** — the "simple slotted" variant. That deliberate ergonomic decision stays in place across polish rounds.

Test discipline: scoped during development; full-suite + playwright smoke are ship-gate only, orchestrator-owned (per standing fleet directive). The push-boundary requires fresh greenlight per ship.

## Prior context

The two-source chat surface just shipped as the "relay rooms use the chat surface" phase and made it to production; the user did a UAT walkthrough and surfaced these seven findings. The surface's overall architecture (one component, two source-adapters, one dispatcher route in each direction) is settled; this arc doesn't change the architecture, it fills in the case-branches the architecture always required.

Ancillary observations from the discussion, held as context:

- The room's list-item in the conversation list looks visually identical to a plain terminal session that has no identity — out of scope for this arc but noted as an adjacent thread for later.
- The room's messages take enough perceived time to arrive that a loading veil DOES make sense in the room case — this is why the fix is to signal the veil correctly, not remove it.
- Drag-and-drop's disturbed state after a room is opened suggests the room case may be corrupting shared drag-and-drop state rather than merely failing to accept drops. This is a diagnostic hypothesis for the blocker, not a locked cause; the plan phase will confirm or replace it.
- Ashley clarified during discussion: the harness case's message content doesn't come from live pane content — it reads from session transcript files. This matters because the loading veil's role is genuinely "the messages haven't arrived yet," in both cases.
- The URL identifier for a room can be opaque — readability doesn't matter — so the room's stable opaque identifier is the natural choice.
- The compose placeholder in the room case should say "message room."

## What would make it wrong

- The room case still looks or feels different from the session case in places we did NOT deliberately case-branch — even if every fix passes on its own.
- The loading veil dismisses on a signal that doesn't correspond to "messages have loaded" — e.g., it dismisses immediately on mount, or on an unrelated network event — so the user sees the room mid-load with a naked surface, or the veil re-appears after the messages have already painted.
- The drag-and-drop fix works for the specific reported cases (drag onto a room, drag a room out) but leaves the general drag-and-drop state corruption unaddressed, so a page reload is still needed for split-view to work correctly after a room has been opened at least once.
- The URL persistence lands, but the identifier chosen doesn't survive a room rename or is ambiguous across similarly-named rooms — so a refresh sometimes lands on the wrong room.
- The meter drawer treatment lands but doesn't visually read as "peeking from behind the pill" — either because the pill isn't clearly in front, or because the drawer looks like a separate free-floating chip again.
- The compose fixes address the visible symptoms but the underlying reason the room-case compose diverged from the session-case compose is left uncorrected, so a future change to the session-case compose regresses the room case again.
- The room case ends up with case-branched treatments in places the philosophy said should be parity — an unnecessary "room mode is different because I got creative" divergence.

## Scope edges

**In:**

1. Loading-veil dismissal signal wired to the room case's "messages loaded" signal.
2. Drag-and-drop split-view participation for the room case — both directions (room as drop target, room-showing surface as drag source), including whatever shared-state corruption is causing plain-session split-view to break after a room has been opened.
3. Compose box in the room case: input's vertical space restored to parity with the session case; ghost gutter on the left removed by reflowing the layout when the hidden attach affordance is not present; top-edge affordance given the vertical headroom it needs.
4. Participant-indicator inner gap tightened.
5. Meter chrome: the "simple slotted drawer" treatment picked in tasting.
6. Compose placeholder copy in the room case: "message room."
7. URL persistence for the currently-open room, using the room's opaque stable identifier.

**Out of arc:**

- The room's list-item appearance in the conversation list (noted as adjacent, separate thread).
- The latency of rooms appearing in the conversation list at all (pre-existing "outstanding issue" per user).
- Any architectural change to the two-source chat surface itself.
- Any change to the session-case chrome or behavior.

**Deferred (split-out candidate):**

- If the drag-and-drop item turns out to be structurally larger than a case-branch fill-in (e.g., the drag-and-drop system's registration model needs a reshape to admit rooms as first-class participants), it splits out of this arc into its own follow-up. The plan phase is the natural place to make that call. The other six findings ship regardless.

**Tempting but no:**

- Reshaping the participant-indicator layout beyond tightening the inner gap.
- Redesigning the meter beyond the drawer treatment picked in tasting.
- Adding a room-case-specific compose affordance to replace the attach button that's hidden.
- Widening the philosophy from "no accidental inheritance" into a broader refactor of the two-source surface.

## Vehicle notes

**Why GSD phase:** 7 findings, mixed sizing, diagnosis-then-fix on two blockers, a picked design decision to implement (the drawer), a URL-routing concern that touches routing and history, and a non-trivial test surface (compose layout, badge chrome, veil signal, drag-and-drop, URL round-trip). GSD's discuss → plan → execute → verify pipeline gives dependency planning, atomic commits, and a natural drop-out point for the drag-and-drop item if diagnosis shows it's structural.

**Handoff notes for whoever picks this up:**

- The picked meter treatment (**simple slotted drawer**) has a working prototype at this arc's bounty folder — the drawer HTML/CSS in the tasting page is the visual pattern to match. The prototype lives with the bounty at `~/.claude/roles/box-maintainer/bounties/phase-93-uat-polish-arc/meter-tasting.html`.
- The bounty for this arc is at the role's shared bounty pool under `phase-93-uat-polish-arc` — captures all 7 findings, prior context, and this shape agreement.
- The identity doing this work is taylor. Working tree is `~/skynet-taylor` on branch `feat/tab-title-from-tmux`.
- The just-shipped phase's own planning artifacts are in the repo's phase directory for the "relay rooms use the chat surface" phase — consult them for the current case-branch discipline the arc is extending.
- The philosophy "no accidental inheritance" is load-bearing; if a fix introduces a divergence not deliberately case-branched, the reviewer at close time should call it out.
- Split-dispatcher is a diagnosis-first item — the plan phase should include a discovery task before sizing.
