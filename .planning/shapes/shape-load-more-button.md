# Shape: the load more button

**Opened:** 2026-08-20
**Vehicle:** gsd phase

## What this is

A manual affordance in a chat pane's message list that lets you reveal older
messages you can no longer see. By default a pane holds only its twenty newest
messages; when there is older history behind that default, a button appears at
the top of the list. Click it once, twenty more older messages appear above
your current view. Click again, twenty more. Eventually you have reached the
beginning of the conversation and the button quietly stops appearing. This is
the release valve for the resource-cut default — the pane stays cheap when you
do not need history, and expensive-but-useful when you do.

## Shape

The conversation for a pane is a chronological stream. The pane keeps the
newest twenty in view by default. When there are older messages behind that
view — messages the pane knows exist but is not currently showing — a button
lives at the top of the list. The button has three visible states that
matter: idle (clickable, sits above the topmost message), in-flight (still
visible, disabled, showing that it is fetching), and error (visible, telling
you the last click could not be completed and inviting a retry). If the
request succeeds, the twenty older messages appear above your current view
without shifting your scroll position — you stay where you were reading.

Once you click the button even once, the pane switches modes for the rest of
its lifetime. Before your first click, the pane is actively enforcing its
twenty-cap: each new message that arrives at the bottom of the conversation
drops the oldest off the top. After your first click, that enforcement stops
for this pane. New messages keep arriving, older stays put, the pane grows as
much as you need. Close and reopen the pane (or reload the page) and you are
back to the default: twenty newest, cap enforced, button reappears if there
is still older behind it.

Behind the scenes, the source of truth for the older messages is on the
server. The pane is not cache-fabricating them; it is asking the server to
send the twenty older than what it currently has, and the server draws from
the same underlying conversation record that fed the initial hydration.

## Philosophy

Manual, not automatic. The pane does not guess based on your scroll position
that you want more history — you ask for it deliberately by clicking. This
preserves the resource-cut default: the whole point of holding only twenty is
that most panes never grow beyond that; only the ones you actively dig into
get expensive.

Additive, never subtractive. Once you have loaded older messages, they stay.
No mechanism kicks them out during the pane's lifetime. This is the
counterpart to the click-to-enable behavior — opting in has real, durable
value; you do not have to fight the system to keep what you asked for.

Transient across pane lifetimes. The expanded-history state does not persist.
Close the pane and reopen it and you are back to the default. This is
deliberate — the resource-cut is about the default state; the loaded-older
state is a temporary luxury for as long as you need it.

Fail visibly. Silent failures are the worst outcome; you cannot tell whether
your click missed or the server had a bad moment. A visible error affordance
beats a silent re-enable even if it is occasionally intrusive.

## Prior context

Before the ship that just went out, panes held one hundred and fifty messages
in memory each. That was cut to twenty as an immediate resource-savings move.
The cut was accepted on the understanding that reaching back further would be
a separate follow-up. This is that follow-up.

An earlier version of the system had automatic scroll-to-top pagination — as
you scrolled up, the pane fetched older messages in the background. That
system was intentionally torn out several ships ago. This is not a return to
that; it is a manual button by explicit design.

The server itself already knows the full conversation. The pane's default
hydration comes from the server sending everything, with the pane silently
dropping the oldest as it drains. So the older messages are not lost; they
are simply not held in the pane's memory. The server can be asked for a
specific range of older messages without any new backing store — the record
already exists.

The pane's auto-scroll behavior is currently broken in ways that surface when
the message list changes. That is a separate concern the user will fix later.
This design should not attempt to fix or work around auto-scroll issues; it
should sit alongside them and be addressed when auto-scroll gets its own fix.

## What would make it wrong

- If clicking the button and getting older messages caused the view to jump
  to the top or bottom of the list, that would miss the point. You asked to
  see older, not to lose your reading position.
- If loading older messages did not give you durable access to them — if the
  very next incoming live message evicted them — the feature would be
  pointless. The additive-during-pane-lifetime property is what makes the
  button worth clicking.
- If the button appeared on a conversation that has no older messages behind
  it (all fifteen messages of a short conversation are already visible), it
  would be a lie. The button's presence is a promise that clicking it will
  produce something.
- If a failed request left the user with no indication the click did
  anything, the button would feel unreliable even when it usually worked.
- If the resource-cut default was silently subverted — for example, panes
  ending up staying expanded across close and reopen — the follow-up would
  have undone the ship it was meant to complement.
- If clicking rapidly kicked off multiple concurrent requests and the results
  arrived out of order (or produced duplicates), the pane's top would become
  a mess. The single-request-in-flight rule with the disabled state during
  flight is what prevents this.

## Scope edges

**In scope:**

- The button, its three states (idle, in-flight, error), its lifetime rules
  (visible when older exists, hidden when it does not).
- The mechanism by which the pane asks the server for older messages and the
  server answers with a bounded range.
- The behavior switch on first click — cap enforcement turns off for this
  pane's lifetime.
- Test coverage for the flow, the state transitions, and the interaction
  with incoming live messages while older is loaded.

**Out of scope:**

- Fixing the pane's auto-scroll behavior. Deferred to a separate ship the
  user will drive.
- Automatic scroll-based loading (infinite-scroll style). Explicitly not
  this design.
- Persistence of loaded-older state across pane close or page reload.
- A user-configurable "how many per click" setting. The batch size stays
  at twenty.
- Search across loaded older messages.
- A ceiling on how many total older messages a pane can accumulate. No
  such ceiling exists in this design.
- Any change to how the initial twenty-newest are delivered on hydration.

## Vehicle notes

Chosen as a full GSD phase because the work spans the frontend (button
component, per-pane state including the cap-off flag, scroll anchoring on
prepend, the three visible states), the backend (a new request/response
between the pane and the server for a bounded range of older messages, and
the server-side lookup against the conversation record), and matching test
coverage on both sides. This is not a one-file, one-line change; genuine
design work is needed on the wire contract and on the interaction between
older-loading and the incoming-message stream.

The shape file above should seed the phase's CONTEXT.md directly — the "why,
what, constraints, and scope edges" are already captured here, and re-eliciting
them in a discuss step would waste both the identity's context and the user's
time. Either drop this file in as CONTEXT.md or generate CONTEXT.md from it.

The identity doing the work is the currently-loaded box-maintainer identity
for this repo. The relevant preceding ship is patch #470 (the twenty-cap
reduction). This design is its explicit companion.
