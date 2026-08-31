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

---

## Close-Out

**Closed:** 2026-08-31
**Vehicle used:** GSD phase (Phase 64) via /build — /gsd:phase add → /gsd:plan-phase --skip-research (CONTEXT.md seeded directly from this shape file per precedent Phases 53/56/57/58/59) → /gsd:execute-phase (2 waves, 6 atomic TDD commits) → /gsd:verifier (12/12 invariants PASS) → orchestrator full-suite ship-gate (3308/3308 pass) → /close.
**Overall verdict:** closed-with-misses (both misses are unsanctioned additions the user asked to fix inline before ship; no shape features missing)

### Shape features (conformance)

- **What this is** — present · Center-of-open-session became a valid drop target with the two source-conditioned outcomes.
- **Shape** — present · Body-of-session hover lights coral; drop from conv-list-row → replace, drop from open badge → swap.
- **Philosophy** — present · Same coral vocabulary for both behaviors; source of drag structurally disambiguates; no mode, no palette, no distinction visual.
- **Prior context** — present · Reuses the existing MIME-payload conventions from Phases 56 (row) and 58 (badge); the center-of-cell region was ignored before this change and now fills that gap.
- **What would make it wrong: coral inconsistent between behaviors** — present · Single overlay branch renders both cases; identical RGBA fill + border + transition; architecturally impossible to distinguish.
- **What would make it wrong: coral appears but release does nothing (silent failure)** — partial · Violated by the two additions surfaced in review (plain-text-only-drop path routing to replace despite bare payload; self-drop lighting coral before no-op'ing). Inline fixes commissioned to restore the contract before ship.
- **What would make it wrong: displaced session ends up half-mounted** — present · Replace is a pure tree-op via setSplitTree; tabs[] array unchanged (integration Test 2 asserts); no closeTab fires; WebSocket lifetime is per-tab and independent of tree position.
- **What would make it wrong: swap mid-swing overlap / blank / wrong-slot** — present · Swap is atomic (single setSplitTree call returning the new tree); both cells re-render in one React commit.
- **What would make it wrong: center-drop competes with edge-zone for the same hover pixel** — present · computeEdgeZone returns exactly one zone per cursor position; no visual competition possible.
- **Scope edges (in)** — present · All five in-scope items delivered.
- **Scope edges (out)** — present · No visual distinction between replace-coral and swap-coral; no guard/confirmation/undo for replace; no touch-specific handling added; no new drag sources; no new drop targets beyond body-of-open-session.
- **Scope edges (deferred/tempting-but-no)** — present · Neither trimmed suggestion (visual distinction, "already-in-grid" edge case) reintroduced; tree invariants make the already-in-grid case fall out cleanly.

### Additions (in the result, not in the shape)

- Focus behavior on replace + swap: after the drop, the "carried" session (the replacement, or the dragged badge's source) takes focus in its new cell. Shape said nothing about focus. — endorsed-as-drift ("not a big deal")
- Plain-text-only drops routing to replace: center-drop accepts bare `text/plain` payload (no rich session MIME) and dispatches to replace, allowing a stray browser drag (text selection, external drag) to clobber a live session. Shape strictly names two rich-payload sources. — unsanctioned (fix lands inline before ship)
- Self-drop silent no-op with coral lit: coral overlay lights on hover over a cell whose session matches the drag source, then release silently no-ops. Shape rule: "coral appeared → release always performs the corresponding action." — unsanctioned (fix lands inline before ship)

### Follow-ups

- Reject plain-text-only drops in the center-drop path — require `application/x-skynet-row` OR `application/x-skynet-badge` to be present before dispatching to replace or swap; bare text/plain drops fall through to silent-no-op (matching the unknown-MIME path). — accepted-as-drift (fix lands inline before ship)
- Suppress the coral overlay when the hovered cell would be a self-drop (drag source and target session are the same). Read source tabId from dataTransfer.types + payload during dragover; compare against target cell's tabId; skip overlay if equal. — accepted-as-drift (fix lands inline before ship)

### Notes

Both unsanctioned additions were flagged during plan-check as MEDIUM findings (M-4 = text/plain fallback breadth, M-3-adjacent behavior for self-drop coral) and I dismissed both as "low probability / defensive helper carries it." The reviewer + user surfaced them as real. Lesson: MEDIUM findings that name a live-session-clobber failure mode aren't "low probability" — they're specifically the failure class the shape's "coral means real action" contract exists to prevent. Fold this into future plan-check-fix-dispositioning as: any MEDIUM that names a class of user-observable regression should default to "fix before ship" not "accept as drift."
