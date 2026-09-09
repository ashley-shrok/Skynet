# Shape: Composebox — buttons cleanup + message queue tab redesign

**Opened:** 2026-09-09
**Vehicle:** gsd quick

## What this is

A UX pass on the compose box that does two things in one hit. First: the row
of action buttons below the primary textarea gets trimmed and one gets
re-purposed — the "recap" button keeps its label but starts sending a
different, more pointed prompt. Second: the way you add a queued message
moves from a small icon in that same button row to a new, quieter affordance
— a small tab with a plus in it that pokes out of the top of whichever
textarea currently sits at the top of the compose stack. Clicking it does the
same thing it does today (adds a new textarea to the queue), just at a
different place, looking different, and inserting at a different position in
the stack.

## Shape

The compose surround has three visible surfaces from top to bottom: a row of
small action buttons (with a meter to their left), any queued-message
textareas stacked in the middle, and the primary textarea at the bottom.
Today the queued-message affordance is one of the buttons in the top row —
same visual weight as the other buttons, part of the group. This redesign
lifts that affordance out of the button row and places it on the top edge of
whichever textarea is currently topmost in the compose stack.

The new affordance is a small pebble-shaped tab with a plus glyph inside it.
The tab sits on the top edge of the topmost textarea, horizontally centered,
its bottom overlapping the textarea's top edge (giving the appearance of a
shallow notch cut into the textarea). Fill matches the compose surround
color, so the tab blends into the surround visually — you see the plus, not
the container. The border is at the barest visible tint. The plus glyph
itself is a thin hairline stroke — small, quiet.

The tab always rides "the topmost textarea." When no queued textareas are
present, that's the primary textarea. When one or more queued textareas are
present, that's whichever is currently topmost in the stack.

Clicking the tab adds a new empty queued textarea to the **top** of the
queue stack (in the position where the tab was), and the tab then rides up
onto the newly-inserted top textarea per the topmost-tracking rule. The
mental model of the stack flips from what it is today: bottom is oldest, top
is newest.

The action-button row loses one button (the queued-message icon that used to
live there) and keeps three: stop, thumbs-up, recap. Thumbs-up and stop are
untouched. Recap keeps its visible label ("Recap"), its icon, its position,
its disable rules — the only thing that changes is the prompt it sends when
clicked. That prompt goes from asking for a recap of the current situation
to asking for an explanation of what has gone on since the user's last
message.

## Philosophy

The tab is chrome, not attention. When you're typing, you should not notice
it. When you go looking for the "queue a message" affordance, it should be
obvious where it is — but obvious in the sense of "oh right, it's on top of
the topmost textarea," not obvious in the sense of shouting.

Locality of interaction matters. The reason to move the affordance out of
the button row and onto the top of the stack is that clicking a plus on top
of a stack SHOULD feel like adding an item to the top of the stack. Today's
button-in-a-row doesn't carry that gesture. The new placement makes the
insertion behavior feel inevitable — click here, thing appears here.

The recap change is a phrasing tweak that the user already knows works well
in her own usage. The button is fine as a button; the words it sends are
what's being upgraded.

## Prior context

Today's queue-a-message button lives as the leftmost of four aux-row
buttons alongside stop, thumbs-up, and recap. It uses the same warm-neutral
glass treatment as its neighbors and adds a new queued textarea at the
BOTTOM of the queue stack when clicked (adjacent to the primary textarea).
Slots today stack oldest-at-top, newest-at-bottom.

Today's recap button sends a canned prompt asking for a recap of the current
situation. In the user's own natural usage she has been reaching for a
slightly different phrasing — asking for an explanation of what has gone on
since her last message — and that phrasing has worked better for her. She
wants the button to send that instead so she uses it more often.

The compose surround already has a rich palette of tokens for cool-black
gradients, warm-off-white text, and glass-treatment buttons. The tab
inherits from those tokens — no new palette needed. A tasting was run at
`http://100.99.149.8:8899/tasting.html` on the day the shape was opened;
variant 1 (the pebble notch) was chosen.

## What would make it wrong

- **Attention theft.** If the pebble draws the eye while typing — through
  color, size, glow, or hover — it's stopped being quiet chrome. It should
  not compete with the message being composed.
- **Findability loss.** On the flip side, if the affordance becomes
  invisible enough that a user goes to add a queued message and can't spot
  where it went, "quiet" has crossed into "gone."
- **Locality break.** If clicking the plus while it's on top of textarea T
  causes the new slot to appear somewhere other than immediately above T,
  the whole reason for moving the affordance is defeated.
- **Recap regression.** If the recap button visibly changes in any way
  other than its send payload — icon, label, position, disable rules — that
  is out of scope and reads as a redesign that wasn't asked for.

## Scope edges

- **In.** Removing the queue-a-message button from the aux-row. Adding the
  pebble tab on the topmost textarea's top edge. Wiring click → new slot
  inserted at TOP of the stack. Recap payload phrasing change.
- **In (test upkeep).** Any existing tests that locate the old queued-
  message button by role/label/icon get updated to locate the new tab. New
  test coverage for topmost-tracking and top-insertion.
- **Out.** The queue-slot textareas themselves (behavior, look, wiring).
  The send order / arm-for-idle mechanics of queued slots. The thumbs-up
  button. The stop button. Anything else in the compose surround.
- **Out.** Mobile-specific sizing decisions upfront. Ship the natural
  default (following the existing aux-button mobile scale where
  reasonable) and iterate post-UAT if the touch target feels wrong.
- **Deferred.** Any polish on the tab's motion when a slot is added or
  removed (snap vs. animate). Ship whichever falls out of the layout;
  iterate later if it feels wrong.
- **Tempting-but-no.** Introducing a "keyboard shortcut to add a queued
  message" alongside the visual change. Adjusting the queue-slot's own
  send/delete/mic buttons to match the new visual language. Both are
  separate conversations.

## Vehicle notes

`/gsd:quick` is right-sized here. Scope is contained: primary touch is one
component file (the compose box), a small number of existing tests to
relocate their selectors, plus a couple of new tests for the topmost-
tracking + top-insertion behavior. No cross-file coordination, no backend
surface, no security-shaped edges. Atomic commits carry their weight; a full
phase's discuss / plan / wave sequencing would be ceremony for the size.

**Tasting artifact** — the static prototype used during shape discussion
lives at
`~/.claude/roles/box-maintainer/bounties/composebox-buttons-and-queue-tab-redesign/tasting/tasting.html`
and is served on `http://100.99.149.8:8899/tasting.html` for the duration
of the session. Variant 1 (pebble notch) is the chosen visual; tint at
~4% border, fill matches compose surround, plus glyph is 1.5px hairline.

**Campaign context** — this is bounty 6/8 of the UX-pass campaign. Deploy
is deferred to the campaign ship gate (after all remaining bounties land
and the user greenlights). Push + scoped tests are fine; no docker build,
no `docker cp`, no `force-recreate` in this bounty. `git pull --rebase`
before pushing; announce on the coord room per multi-identity discipline
if a peer is active.

**Recap payload verbatim** — the string the recap button sends after this
change: `/explain what has gone on since my last message`. Exact
capitalization, exact spacing, no trailing punctuation.

**Close-out** — `/close composebox-buttons-and-queue-tab-redesign` closes
the arc against this shape once the quick lands.

---

## Close-Out

**Closed:** 2026-09-09
**Vehicle used:** gsd-quick (2-task test-first plan, atomic commit 8f87f722, docs commit a71ff34f)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Two-motion UX pass landed atomically — aux-row trimmed + Recap payload swapped + new pebble-notch queue affordance.
- **Shape: aux-row trim to three (Stop, ThumbsUp, Recap)** — present · ListPlus button and its import are gone; the aux flex-row now hosts only Stop, ThumbsUp, Recap; stale group comment updated.
- **Shape: Recap payload swap, all other Recap attributes preserved** — present · onClick sends verbatim `/explain what has gone on since my last message`; icon, aria-label, title, position, disable rules, className unchanged.
- **Shape: pebble tab visual (small, rounded, plus glyph, blended fill, hairline border, thin stroke)** — present · `w-10 h-[22px] rounded-full` pebble; `--color-pv-base` → `--color-pv-base-mid` gradient matches surround; 4%-opacity border; Plus size-3 strokeWidth 1.5.
- **Shape: tab position (top edge, horizontally centered, bottom overlapping textarea)** — present · absolute `top-[-12px] left-1/2 -translate-x-1/2 z-10` — the tab's bottom overlaps the wrapper's top edge.
- **Shape: tab rides the topmost textarea (primary when empty, first slot when populated)** — present · Primary wrapper gates render on `queueSlots.length === 0`; QueuedRow gates on `isTopmostInStack` (index === 0). Exactly one host at a time.
- **Shape: click prepends new empty slot at top of stack (locality)** — present · `setQueueSlots((prev) => [{...new}, ...prev])` inverts the old append-at-end pattern; tab rides up onto the newly-inserted top slot.
- **Shape: aria-label preserved so existing selectors resolve** — present · "Queue a message" aria-label carried over from the retired button to the new tab; existing getByRole selectors work unchanged.
- **Philosophy: chrome-not-attention** — present · Fill blends into surround, glyph is thin hairline, border 4% opacity, muted text color — quiet by construction.
- **Philosophy: locality of interaction** — present · Plus on top of stack now adds a slot on top of the stack; the gesture matches the wiring.
- **Prior context: today's queue-a-message button removed, palette tokens inherited** — present · Old warm-neutral glass button gone; tab uses `--color-pv-base`/`-base-mid` gradient and `--color-pv-fg-muted` — inherits from the existing palette, no new tokens introduced.
- **Scope: test upkeep (relocate selectors + new topmost/prepend coverage)** — present · ComposeBox.test.tsx QS 3 selector re-queried per click; send-funnel Test 4 payload literals updated; new ComposeBox.queue-plus-tab.test.tsx has 4 tests covering topmost-on-primary, topmost-on-first-slot, prepend-not-append, and Recap payload.
- **What would make it wrong: attention theft** — present · Guarded — surround-matching fill, 4% border, size-3 glyph with 1.5 stroke, muted fg, no glow; hover is a modest brightness bump only.
- **What would make it wrong: findability loss** — present · Guarded — tab is horizontally centered at the top edge of the topmost textarea, plus glyph is visible against surround, hover darkens the glyph to aid discovery.
- **What would make it wrong: locality break** — present · Guarded — Test C in the new suite asserts DOM order after two clicks is [newest, first-created], proving prepend semantics.
- **What would make it wrong: recap regression (icon/label/position/disable rules)** — present · Guarded — diff of the Recap block shows only the onClick payload string changed; every other Recap attribute untouched.
- **Scope-out: no keyboard shortcut, no queue-slot internal changes, no thumbs-up/stop changes** — present · Nothing beyond the compose file's aux-row and topmost-tab region was touched.
- **Scope-out: no mobile-sizing decision upfront** — present · The tab has no `max-md:` variants — ships at the natural default per shape's "iterate post-UAT" guidance.
- **Scope-out: no deploy in this bounty** — present · Commits committed only; no push, no docker build, no `force-recreate` — deferred to campaign ship gate.

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Clean pass in both directions. The internal wiring additions (`data-testid="compose-primary-wrapper"`, new `QueuedRowProps` fields `isTopmostInStack` + `onAddSlotAtTop`, index-aware map callsite) are natural implementation cost of the shape's explicit test-coverage and topmost-tracking commitments — not user-visible additions. A modest hover treatment (brightness-110 + text-fg swap) exists on the tab; this is not called out in the shape but is consistent with the surround's existing button conventions and does not activate "while typing," so it doesn't cross the attention-theft failure mode. One structural note worth carrying: because the tab re-parents between the primary wrapper and the first slot wrapper across a click, any future test that holds a DOM reference across clicks (as the old aux-row button allowed) will need to re-query — the QS-3 fix already sets that precedent.
