# Phase 97 Discussion Log

**Date:** 2026-09-10
**Participants:** Ashley (visionary), taylor (builder)
**Format:** `/build` → `/open` conversation + design tasting; discuss-phase seeded from the shape file without re-elicitation.

## Context on why discussion was short

The `/build` skill's convention is that when a GSD phase is the vehicle, `discuss-phase` is seeded from the shape file rather than re-elicited. The `/open` conversation for this arc did the full pitch → discuss → grill flow and locked every user-facing decision. `discuss-phase` therefore skipped the AskUserQuestion elicitation cycle — the workflow's "skip assessment when no meaningful gray areas remain" rule applied — and translated the shape directly into CONTEXT.md.

Everything below is the discussion that DID happen (during `/open`), reconstructed for the record.

## /open conversation summary

### Beat 1 — Pitch

Ashley reported 7 findings from her UAT walkthrough of the just-shipped Phase 93 (relay rooms use the chat surface). She surfaced them in real time as she clicked through a test room: veil never dismisses, drag-drop split doesn't split, compose vertical layout looks broken with a ghost gutter, badge spacing too wide, meter chrome floats, placeholder still says "message Claude." Later added URL persistence as an 8th (finalized as finding 7 in the shape).

taylor offered the shape back conceptually: seven symptoms, one root pattern — the chat surface promises "same shape, different data source" but the room case is silently inheriting session-case chrome and lifecycle wherever a case-branch was needed but not made. Two blockers (veil, drag-drop) + four polish (compose, badges, meter, placeholder) + one lifecycle miss (URL). Ashley confirmed "yes" and added an inverted-direction observation on drag-drop (dragging the room INTO an empty split slot also fails), plus that plain-session split-view is disturbed after a room has been opened until a full page reload — suggesting shared drag-drop state corruption rather than a missing case-branch.

### Beat 2 — Discussion

Two scoping paths surfaced:
1. Shape all 7 under this arc, drop split-dispatcher at plan time if it turns out structural.
2. Shape only 5 known-sized items; split-dispatcher gets its own `/open` after diagnosis.

Ashley delegated ("you choose this kind of thing"). taylor picked Path 1 — momentum outweighs the risk-transfer, the plan-phase is the natural split-out point. Ashley also added the URL persistence observation during this beat (finding 7).

Ashley clarified that the harness case's message content doesn't come from live pane content (as taylor initially misspoke) — it reads from session transcript files. This clarification is important for the veil signal wiring: in both cases the veil's purpose is genuinely "the messages haven't arrived yet." Booked into CONTEXT.md D-03/D-04.

### Beat 3 — Grill

Grill closed in five sharp questions.

**G1 — Meter chrome treatment.**
- taylor offered 5 stand-in variants (progress ring, corner chip, underline bar, side column, bottom pill) on a naive circular badge stand-in.
- Ashley corrected: "we need to do a tasting for that, where we try to get the exact look of the identity badge as it is now in the app, and then try different versions." Rebuild required.
- taylor rebuilt the tasting with faithful pill replica (56px avatar + name/title + hue-tinted glass), showing 4 variants of how the meter could relate to the pill.
- Ashley: "what I was imagining was basically variant zero. But instead of the meter being free floating, it just was kind of like, on a sort of pull out little area that looks like it's coming out from behind the badge... why don't you try a few different versions of that?"
- taylor sketched 3 pull-out-drawer variants: (A) simple slotted, (B) hue-tinted slotted, (C) wider backing panel.
- Ashley: **"Let's go with variant A."** — Meter chrome direction: simple slotted drawer.
- Ashley also called out: tastings are part of DISCUSSION, not execute-time (correction to /build skill convention taylor was using). Booked as fleet-worthy learning; Ashley said she'd update the /build skill.

**G2 — Loading veil semantics.**
- taylor asked: should the relay case even HAVE a loading veil, or is the "loading participants" placeholder in the badge anchor enough?
- Ashley: harness reads from session transcript files (not tmux hydration — corrected taylor's misspeaking); veil should appear if messages take perceptible time to load, absent otherwise; guess is relay does take some time.
- Direction: keep the veil in the room case; wire its dismissal to the relay adapter's "messages loaded" signal — plumbing miss, not a design change.

**G3 — URL persistence identifier.**
- taylor asked: opaque room ID (survives rename, unambiguous) vs human-readable slug (pleasant URL, needs uniqueness discipline)?
- Ashley: **"the readability doesn't matter."** — Direction: opaque Matrix room ID.

**G4 — Placeholder copy.**
- taylor asked: what should the placeholder say in a relay room — addressees, room-shaped, blank?
- Ashley: **"it should probably just say room, like message room, I guess."** — Direction: `"message room"`.

**G5 — Overall philosophy.**
- taylor asked: is the guiding principle "relay mode should feel identical to harness mode except in the specific case-branches"?
- Ashley: *"relay sessions should feel no different other than the deliberate changes we have made, like removing certain buttons and things like that. So to the user, they don't have a concept of a harness or the relay backing what they're looking at."* — Locked as D-01 philosophy in CONTEXT.md; load-bearing at `/close` review.

### Vehicle decision

- taylor recommended GSD phase — scope is genuinely phase-sized, plan-phase is the natural split-out point for drag-drop, diagnostics-first for two blockers.
- Ashley: **thumbs up**.
- Shape file written to `.planning/shapes/shape-phase-93-uat-polish-arc.md`.
- Ashley greenlit the shape file with thumbs up.

### Roadmap slot

- `gsd-sdk phase.add` returned Phase 96 (next after Phase 95).
- Slot collision: tanya rescue-rebased her id-skill-revamp Shape 2 → Phase 96 earlier the same day (coord post `$WjQ3xDij1ghuxGJjOYrphLkMIcq0f1SwjYCjDpIiQ2g` during taylor's tasting turn).
- taylor is the later mover; renumbered to Phase 97 per the fleet phase-collision auto-resolve rule. ~36th known `gsd-sdk phase.add` cross-tree race.
- Phase 97 roadmap entry + shape file committed as `plan(97): roadmap entry + shape file — Phase 93 UAT polish arc` at HEAD `fe588e32`.

## Areas discussed vs skipped

**Discussed and locked (via /open):**
- Meter chrome direction (tasting: variant A "simple slotted drawer")
- Loading veil intent (keep it, wire to messages-loaded signal)
- URL persistence identifier (opaque Matrix room ID)
- Placeholder copy (`"message room"`)
- Philosophy (no accidental inheritance; relay = harness except explicit case-branches)
- Scoping (all 7 in one arc; drag-drop is split-out candidate at plan time)

**Skipped (no genuine gray area):**
- Compose vertical fix approach — reflow direction locked in shape; executor decides mechanism
- Meter drawer exact geometry — prototype at bounty is source of truth; executor tunes
- Badge inner gap value — direction is "halve"; executor fine-tunes
- URL routing shape (path vs query) — matches session case's pattern; researcher traces
- URL history behavior (push vs replace) — matches session case's pattern; researcher traces

**Diagnostic (for the researcher, not user-facing gray areas):**
- Exact "messages loaded" signal in the relay adapter for veil dismissal
- Root cause of drag-drop state corruption after room mount
- Whether drag-drop fix is a case-branch fill-in or a structural reshape (splits the arc if structural)

## Deferred ideas (surfaced during discussion, not for this arc)

- **Room list-item visual distinction** — Ashley noted a relay-room row in the conversation list looks identical to a plain terminal session with no identity. Worth its own thread later.
- **Latency of rooms appearing in the conversation list** — "outstanding issue" per Ashley; pre-existing.

## Claude's discretion (booked for executor)

- Exact drawer geometry within the visual pattern (tuck depth 6–10px, corner-radius, exact CSS values) — from prototype, fine-tuned during execution.
- Reflow mechanism for the ghost attach-padding gutter.
- Structured-log instrumentation on adapter/veil/drag-drop/URL lifecycle boundaries.

## Next steps

- Roadmap entry: `.planning/ROADMAP.md` — Phase 97 committed at `fe588e32`.
- Shape file: `.planning/shapes/shape-phase-93-uat-polish-arc.md` (locked).
- CONTEXT.md: this phase's `97-CONTEXT.md` (this workflow's output).
- Next: `/gsd:plan-phase 97` — auto-advance per fleet standing directive.
