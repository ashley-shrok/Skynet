# Shape: multi-view drop-in-center = replace (from conv list) or swap (from open identity badge)

**Opened:** 2026-08-30
**Vehicle:** GSD phase (via /build)

## What this is

An extension of the existing multi-view drag-and-drop repositioning behavior. Today, when you pick up a session (either from a row in the conversation list, or from the identity badge of a session already open in the grid) and drag it around, the empty seams between and around the existing sessions light coral to show valid drop targets, and dropping there repositions. Dropping onto the body of an already-open session currently does nothing. This change makes those bodies valid drop targets too — with a different outcome depending on where the drag came from: a drop from the conversation list replaces the target session in place, and a drop from an already-open session's identity badge swaps the two.

## Shape

There are two drag sources that already exist:

- A row in the conversation list.
- The identity badge of a session that is currently open in the grid.

There is currently one class of drop target — the coral seams between and around open sessions — and dropping there repositions. This change adds a second class of drop target: the body of an already-open session. When the drag is hovering over the body of an open session (i.e. inside its area, not over one of the seams), the whole body of that session lights coral. On release:

- If the drag came from a conversation list row, the target session is **replaced in place** by the dragged session. The session that was there drops out of the grid — it is still present in the conversation list, just no longer occupying a slot.
- If the drag came from an already-open session's identity badge, the two sessions **swap slots**. Both remain live in the grid, they just trade positions.

The coral highlight looks the same in both cases — no label, no color distinction, no separate visual for replace vs swap. The source of the drag is what decides which behavior fires; the user learns which one they're doing from context.

## Philosophy

Small, consistent extension of a behavior that already exists. The coral vocabulary stays the same — coral means "you can drop here" — and the new drop target just adds another place the coral appears. Which of the two outcomes fires is determined structurally by where the drag started, not by a modifier key or a hold gesture; there is no mode to remember and no palette to consult. The user will pick up the distinction naturally from doing it: dragging in from the list is bringing in a new thing (replace), dragging one open session onto another is rearranging what's already there (swap).

The shape deliberately does not add hint text inside the coral, does not visually distinguish replace-coral from swap-coral, and does not put any guard on "you're about to lose the session in that slot" for the replace case. The bar to cross is a deliberate drag-and-drop gesture with a clearly highlighted target; that is signal enough, and the displaced session is still trivially reachable from the conversation list.

## Prior context

The multi-view drag-and-drop system with coral drop-zone highlighting is already in place. The two drag sources (conversation list row, identity badge of an open session) already produce drag events; the coral seam-drop-target already works for repositioning. The center-of-existing-session region is currently ignored — no highlight, no drop handling — and this change fills that gap.

Ashley uses the app on iPhone and on desktop. Multi-view drag-and-drop is a desktop-only interaction for her in practice — the phone layout can't show the conversation list and pretty view simultaneously, so the drag source and drop target can't coexist onscreen there. Tablet is a plausible third case but untested and out of scope for this change (see § Scope edges).

## What would make it wrong

- If the coral is inconsistent between the two behaviors — different color, different animation, one has a label and the other doesn't — the shape has lost its "one visual vocabulary, source-decides-outcome" spine.
- If dropping onto the body of an open session sometimes does nothing (silent failure), the user cannot trust the coral. The rule is: coral appeared → release always performs the corresponding action.
- If the displaced session on a replace ends up in some intermediate state — not visible in the grid, not visible in the conversation list, still holding grid-side resources — the "still there, just not in a slot" promise is broken.
- If the swap animation or state transition ever leaves the two sessions temporarily overlapping, blank, or attributed to the wrong slot mid-swing, the illusion of "they just traded places" is broken.
- If the new coral drop target competes with the existing seam coral for the same hover pixel and picks the wrong one (e.g. hovering near the edge of a session ambiguously fires the seam or the body), the interaction feels flaky.

## Scope edges

**In:**
- Body-of-open-session as a valid drop target with a whole-body coral highlight.
- Replace behavior on drop from a conversation list row.
- Swap behavior on drop from an already-open session's identity badge.
- Consistency of coral appearance across both new behaviors and against the existing seam coral.
- Correct handoff of the displaced session on replace back to "just a conversation list row, no grid slot."

**Out:**
- Any visual distinction between the two behaviors (color, label, animation variant).
- Any guard, confirmation, or undo affordance for the replace case.
- Touch behavior. Ashley has never exercised the existing multi-view drag-and-drop on touch and is not testing it now; whatever the current touch story is (works, doesn't work, partially works) the new center-drop inherits. Not a scope item for this change either way.
- Any new drag source. Only the two existing sources (conversation list row, open-session identity badge) are considered.
- Any new drop target other than the body of an already-open session.

**Deferred / tempting-but-no:**
- Ashley trimmed two suggestions during the shape discussion that could resurface later if the plain shape needs help: (a) a visual distinction between replace-coral and swap-coral, and (b) special handling for the "drag a session that is already showing elsewhere in the grid onto a different open session" edge case. Both were left out on the principle of not complicating the code beyond what the interaction needs, and letting the user manage their own sessions. If either turns out to actually bite in use, they revisit as a follow-up, not as part of this shape.

## Vehicle notes

GSD phase via /build. Real UI work with three coordinated moving parts (drop-zone hit-testing gains a new region, highlight state gains a whole-body coral mode, drop handler gains a source-conditioned replace-vs-swap branch), each wanting its own tests. Not quick-shaped.

The work lives in the pretty-view multi-view surface. Identity of record: tina (working tree at `~/skynet-tina` on `feat/tab-title-from-tmux`). Standard box-maintainer ship discipline applies (scoped tests during executor waves, full suite as orchestrator ship-gate, coord-room BEFORE/AFTER posts around container mutation, greenlight-gate at git push).

Next step: `/build` continues from here — plan phase, then execute, then close (which reads this shape and verifies conformance both ways).
