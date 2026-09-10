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

---

## Close-Out

**Closed:** 2026-09-10
**Vehicle used:** GSD phase (Phase 97: 6 plans across 3 waves, discovery-first on F-2, executed and verified 2026-09-10)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · seven UAT findings all landed as case-branches inside the two-source chat surface; no architectural reshape
- **Shape: Loading veil never dismisses (blocker)** — present · adapter contract carries isMessagesLoaded, relay adapter flips it on history_batch frame, PrettyView has a relay-case peer veil-arm effect mirroring harness's 400ms delay-arm; harness effect is case-gated to preserve regression floor
- **Shape: Drag-and-drop split placement (blocker)** — present · tabId threaded through MultiBadgeAnchor into both HumanBadgeCell and AgentBadgeCell (including through AgentBadgeWithMeter) so relay-case badges become drag sources; F-2 resolved as Verdict A (case-branch fill-in) with Ashley-approved static-analysis basis, live-browser confirmation deferred to phase-end deploy, forensic instrumentation retained to catch the shared-state-corruption symptom if it reappears
- **Shape: Compose box vertical fit (polish)** — present · pl-11 ghost gutter gated by mode !== 'relay' (reflow, not zeroing); invisible aria-hidden Row 1 spacer restores byte-identical vertical envelope (mb-[3px] + min-h-[44px]/min-h-8 conditional on touch device) so QueuePlusTab pebble has its headroom
- **Shape: Participant-indicator inner gap tightened (polish)** — present · ROOT_ANCHOR_CLASS in MultiBadgeAnchor changed gap-2 → gap-1; single-token change, all other position tokens preserved
- **Shape: Meter chrome (polish, tasting-locked)** — present · data-drawer wrapper with -mt-2 (tuck 8px behind pill's bottom), pt-[10px] (breathing room), zIndex 1 (pill's drop-shadow lands on drawer); meter well's rounded-md replaced with rounded-b-md + border-t-0 (invisible tuck edge); matches Variant A prototype byte-for-byte
- **Shape: Compose placeholder addresses wrong recipient (polish)** — present · PrettyView case-branches identityName='room' for relay; renders 'Message room…' with capital-M per harness template convention (Ashley endorsed the ship-cap version — lowercase in shape was casual shorthand)
- **Shape: URL persistence (lifecycle miss)** — present · TabSpec widened to discriminated union with relay variant (opaque roomId, host?: never); parse/encode/specForTab all branched; AppShell URL-sync passes sessionKind + relayRoomId; both top-level open loop AND splitTree resolver key-builder + closure branch on relay:<roomId>; 512-char defensive cap; localpart-masked structured log for URL-restore forensics
- **Philosophy: no accidental inheritance** — present · every new case-branch keyed on source.kind === 'relay' or mode === 'relay'; harness call sites byte-untouched; regression floor tests green
- **Philosophy: meter drawer treatment stays the simple slotted variant** — present · Variant A prototype tuck/border/radius/z-index geometry mirrored byte-for-byte; no hue-tinting drift
- **Prior context: URL identifier is the room's opaque stable id** — present · encodeURIComponent(roomId) into relay:<encoded> — rename-stable, unambiguous, readability explicitly a non-concern
- **Prior context: veil signal is 'messages haven't arrived yet' in both cases** — present · chose history_batch (message-load frame) over session (WS-auth frame) so empty rooms still dismiss on frame arrival, not on events.length
- **Prior context: drag-drop diagnostic hypothesis (corruption may be real, not just failing accepts)** — present · H1-H5 hypotheses walked in discovery notes; H3 ruled out; H1/H2/H4/H5 all inspect clean; Verdict A approved by Ashley — corruption not evidenced under static analysis, live-browser gate deferred to deploy with forensic tape shipped
- **What would make it wrong: room case looks/feels different in un-case-branched places** — present · all new branches gated on the source.kind / mode discriminator; harness IdentityBadge mount at PrettyView L3575 byte-untouched (its pre-existing tabId={tabId} was the mirror this arc copied for relay)
- **What would make it wrong: veil dismisses on wrong signal** — present · signal is history_batch frame arrival (not session frame — too early; not events.length — never for empty rooms); 400ms delay-arm mirrors harness path
- **What would make it wrong: drag-drop fix works for reported cases but leaves state corruption** — present · Verdict A explicitly addressed the corruption hypothesis (H1-H5 walked); Ashley approved the static basis; forensic instrumentation retained to close the loop at deploy; escalation path to Verdict B named if reproduction contradicts
- **What would make it wrong: URL identifier ambiguous or doesn't survive rename** — present · opaque Matrix room ID is rename-stable and unambiguous across similarly-named rooms by construction
- **What would make it wrong: meter drawer doesn't read as peeking from behind the pill** — present · zIndex 1 on drawer + implicit stacking on pill puts pill in front; -mt-2 tuck + rounded-b-md + border-t-0 render the peek geometry; matches prototype
- **What would make it wrong: compose fixes address symptoms, underlying divergence stays** — present · invisible Row 1 spacer preserves vertical envelope byte-for-byte (not a pt-N fine-tune), so future changes to Row 1 in the harness case parallel through the spacer's geometry naturally
- **What would make it wrong: room case ends up case-branched where philosophy said parity** — present · no aesthetic-freedom branches; each new case-branch traces to a specific finding + D-XX decision with inline JSDoc
- **Scope edges: in-arc items shipped** — present · all seven in-scope items landed
- **Scope edges: out-of-arc items untouched** — present · conversation-list row appearance, room-list latency, two-source architecture, session-case chrome — all untouched; regression floor preserved at code level
- **Scope edges: deferred split-out on drag-drop** — present · discovery-first sequencing produced Verdict A (fill-in, not reshape); the six other findings would have shipped regardless per shape, but F-2 stayed in-phase
- **Scope edges: tempting-but-no negatives** — present · no participant-indicator layout reshape beyond the gap tighten; no meter redesign beyond the drawer; no room-case-specific compose affordance replacing the hidden attach; no broader two-source refactor

### Additions (in the result, not in the shape)

- Placeholder shipped with capital-M 'Message room…' (matching harness template convention) rather than the shape's verbatim lowercase 'message room' — endorsed-as-drift
- Ambient forensic [pv-split-drop-diag] structured console emits at native dragover and drop inside SplitView, kept after F-2 resolved as fill-in — logs stayed in shipped code as lifecycle-boundary instrumentation for post-deploy F-2 confirmation — endorsed-as-drift

### Follow-ups

- Live-browser confirmation of F-1 veil dismissal on both empty and populated rooms, F-2 drag-drop round-trip (including the plain-session-split-after-room-open reproduction that Verdict A predicts will pass), F-3/F-4/F-5 visual parity checks, F-6 placeholder read, F-7 Chrome window-restore round-trip, and D-01 harness regression floor visual pass — all routed to phase-end deploy per standard fleet pattern — deferred
- If live-browser F-2 reproduction contradicts Verdict A (plain-session split still breaks after a room has been opened), escalate to Verdict B: split F-2 out into its own follow-up phase and use the shipped [pv-split-drop-diag] tape to pinpoint H1/H2/H4/H5 — deferred
- Room list-item appearance in the conversation list looks identical to a plain terminal session with no identity — adjacent thread, out of scope for this arc but worth its own bounty — bounty

### Notes

Both divergences from the shape were case-branched thoughtfully rather than accidentally: the capital-M placeholder ships aligned with an existing template pattern the harness case uses, and the ambient drag-drop diagnostic emits ship as lifecycle-boundary logging (fleet standing directive) that will catch the exact symptom the shape flagged as the F-2 corruption hypothesis if it reappears at deploy. The philosophy 'every case-branch is deliberate' held: nothing quietly diverged, and where the material stepped beyond the shape's letter, the reasoning is legible in the material itself (verifier's WARNING-5 for capitalization; discovery notes' explicit 'may stay as ambient forensic instrumentation' for the diag logs). Also worth carrying forward: the discovery-first sequencing on F-2 (Verdict A/B decision node in the plan) is a strong pattern for future arcs where a shape names a blocker whose structural shape is uncertain — it lets the sizing/split-out call land on evidence rather than guess.
