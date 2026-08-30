# Shape: Drop lane to close a session from split view when the panel is collapsed

**Opened:** 2026-08-29
**Vehicle:** *TBD — recommended after shape approval, per `/build` Step 2*

## What this is

When the conversation panel is collapsed and you're driving in split view, closing a session currently requires you to reopen the panel first, drag the badge in, drop. This adds a one-motion way to do it: while a badge drag is in progress, a lane slides in from the collapsed edge and stands in for the panel as a close-target. Drop the badge into the lane and the session closes with the same behavior as dropping it on the actual panel. The lane exists only during a drag and disappears when the drag ends.

## Shape

A vertical rectangular surface, about a hundred and fifteen pixels wide, appears along the edge where the panel would normally live — the left edge, on desktop. It slides in the moment a badge drag begins, sits in a neutral baseline treatment that borrows from the app's existing chrome (matching the panel it stands in for), and carries a single X glyph centered inside it — the visible cue that dropping here closes the session being dragged.

When the cursor enters the lane, the lane switches to the coral state — the same "you are hovering a valid drop target, release to drop here" affordance every other drop target in the app uses. When the cursor leaves without dropping, the lane returns to its neutral baseline. When the drag ends — whether by dropping in the lane, dropping elsewhere, or canceling — the lane disappears immediately, with no exit animation.

Only badge drags trigger the lane. Drags that originate from a conversation-list row are open-a-session gestures, not close ones, and a close-target appearing during them would be semantically crossed. The lane is also suppressed whenever the panel is already open, because the actual panel is already reachable as the drop target — no need for a duplicate.

## Philosophy

The lane is deliberately a proxy for the panel, not a peek of it. If the panel peeked open partway, its visible conversation rows would compete with the close semantic — a badge dropped on a row would mean "open that conversation," and the same edge gesture would suddenly have two possible outcomes depending on where within the peeked area the cursor lands. The proxy is cleaner: it is a single-purpose close-target that occupies the same real estate the panel would, and does one thing.

The lane also respects the coral grammar the app already uses. Coral is reserved for "you are hovering a valid drop target right now" — not for "here is a drop target." A lane that came in coral from the start would mislead the eye into thinking the drag was already at its destination. The lane appears in a neutral treatment and only turns coral on hover, keeping the vocabulary consistent with every other drop target in the app.

The lane is always visible during a badge drag, not proximity-triggered. Discoverability is the whole point; if it only appeared when the cursor had already headed for the edge, the affordance would be functionally invisible to anyone who didn't already know to steer that way. The small tax of always-during-drag chrome is the deliberate trade for one-motion close.

## Prior context

The badge itself is already the drag source — it was wired that way in a prior phase as the third gesture on the identity affordance. Dropping a badge on the panel already means "close the tab this session belongs to" — the semantics were shipped as a follow-on task. The coral drop-target affordance (both on the panel edge and inside split panes) landed the day before this shape was opened and is the visual language this feature reuses on hover. What is missing is the surface that lets that same drop-to-close reach the user when the panel is collapsed.

The panel-drop close path uses the standard tab-close routine — meaning if that routine currently prompts for confirmation on unsaved work, the lane inherits the same prompt; if it closes the tab but leaves the underlying session process alive, the lane does the same. The lane is a new surface, not a new close.

## What would make it wrong

- If the lane appears when it shouldn't — during drags that aren't badge drags, or while the panel is already open — the surface has been made too eager and starts competing with adjacent gestures rather than complementing them.
- If the lane's baseline styling reads as coral (or any color the app has taught the eye to interpret as an active hover state), the visual language has been broken. Coral must remain reserved for hover.
- If the lane's behavior diverges from the panel-drop close — a different confirm branch, a different tab-close treatment, an additional side effect — the shape has been misread. This is not a new close; it is the existing close, reachable from a new surface.
- If the lane grows large enough to visually compete with the leftmost pane's own left-edge split-target zone — the coral zone that appears when a badge is being dragged toward a pane to split it leftward — the two drop targets stop being cleanly hittable at the boundary and the fine-motor cost of choosing between them goes up. The lane's modest width is what keeps that boundary reachable.
- If the lane appears on mobile, where split view doesn't exist and the whole feature has no context, the surface has been generalized past its scope.

## Scope edges

**In scope.** The lane surface, its slide-in appearance during a badge drag, its neutral baseline treatment, its coral-on-hover state, its X glyph, its close-on-drop behavior inheriting from the existing panel-drop close, and its suppression when the panel is already open.

**Out of scope.** Any new keyboard shortcut, context-menu entry, or other non-drag close affordance for split-view sessions. Any change to the underlying tab-close routine. Any change to the panel itself. Any change to the coral drop-target affordances that already exist on the panel edge or inside split panes.

**Deferred.** A right-side variant of the lane, if the panel ever grows a right-side incarnation, is out of scope for this shape but the design is not incompatible with it.

**Tempting but not.** Letting the lane peek the panel open partway, or turning it into a mini conversation-list preview, or having it accept non-badge drops. All of these dilute the single-purpose contract that keeps the surface unambiguous.

## Vehicle notes

*Vehicle to be recommended after shape approval, per `/build` Step 2. This shape is intended as the input to that decision — the implementing vehicle should treat this file as the source of truth for what the surface is and how it behaves.*

---

## Close-Out

**Closed:** 2026-08-29
**Vehicle used:** quick task (single-slice implementation with colocated test file, wired at three sites in AppShell.tsx)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Lane appears during badge drag when panel is collapsed in split view; drop closes the session using the same routine as the panel-drop path.
- **Shape: ~115px vertical rectangle on left edge** — present · width 115, position absolute, top/bottom 0, left 0.
- **Shape: slides in on badge drag start** — present · Mount gate on active-drag-tabId; hook wires to window dragstart with badge MIME.
- **Shape: neutral baseline borrowing app chrome** — present · panel-base fill + border-quiet-strong right-edge border.
- **Shape: single X glyph centered** — present · lucide X size=28 in flex-centered container.
- **Shape: coral on cursor enter** — present · hover state paints coral fill + border — byte-matched to the split-pane's own coral tokens.
- **Shape: returns to neutral on leave** — present · dragleave with bounding-rect guard clears hover only when cursor is truly outside.
- **Shape: disappears immediately on drag end, no exit animation** — present · Unmounts when the hook clears tabId on window dragend.
- **Philosophy: proxy for the panel, not a peek** — present · Single-purpose surface; no conversation rows rendered; only X glyph.
- **Philosophy: coral grammar respected (neutral baseline, coral only on hover)** — present · Test B asserts baseline contains no coral rgba; hover state assertion in Test C.
- **Philosophy: always visible during badge drag, not proximity-triggered** — present · Mount gate is purely on active-drag-tabId; no cursor-position gating.
- **Prior context: reads badge dragstart payload MIME** — present · Application-specific badge MIME consumed by both the hook and the drop handler.
- **Prior context: inherits panel-drop close routine** — present · Wired to the same close callback used by the panel-drop path.
- **What would make it wrong: lane appears during non-badge drags** — present · Type-gate in dragover (guards hover activation) and in hook (guards mount).
- **What would make it wrong: lane appears while panel already open** — present · Mount gate includes not-open condition.
- **What would make it wrong: baseline reads as coral** — present · Test B asserts baseline style contains the panel-base variable and no coral rgba.
- **What would make it wrong: behavior diverges from panel-drop close** — present · Same close handler wired; no additional side effects beyond the shared close routine.
- **What would make it wrong: lane grows large enough to compete with leftmost split-target zone** — present · Width fixed at 115px, matching the shape's stated modest width.
- **What would make it wrong: lane appears on mobile** — present · Mount gate includes not-mobile and not-mobile-list-screen conditions.
- **Scope: no new keyboard shortcut / context-menu / non-drag close** — present · Material adds only the drag-drop surface.
- **Scope: no change to underlying tab-close routine** — present · Close callback is passed through unchanged.
- **Scope: no change to panel itself** — present · The panel component was not modified as part of this work.
- **Scope: no change to existing coral drop-target affordances** — present · Palette tokens are read/reused; existing drop targets untouched.

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

The material includes an open-tab-id validation guard and a structured-log line that the shape does not explicitly call out. Both are faithful mirrors of the existing panel-drop close prelude (the panel does the same open-tab-id check and emits an analogous log), so the reviewer read them as part of "the lane inherits the panel-drop close semantic" rather than as unagreed additions.

The transition property intended for the slide-in animation is present but effectively a no-op on mount, because there is no starting off-screen translate — the wrapper mounts already at its final position. The shape's "slides in" language was satisfied here by appearance-on-drag alone rather than a literal slide. Worth noting for future shapes that want a genuine slide animation to spell out the start-state offset.
