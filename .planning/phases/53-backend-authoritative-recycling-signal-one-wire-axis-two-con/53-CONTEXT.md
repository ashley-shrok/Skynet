# Shape: backend-authoritative recycling signal — one source of truth for both surfaces

**Opened:** 2026-08-21
**Vehicle:** gsd phase

## What this is

Today the "session is being recycled" state is derived on the browser side
from the chat surface's own connection health, then published into a shared
store that the conversation list reads. That means a session's row in the
conversation list only ever reflects recycling if the pretty-view for THAT
session is currently mounted somewhere — an unmounted row is blind to its own
session recycling.

The fix is to move the source of truth to the backend. The caretaker on each
managed box already drops a marker file the entire time a recycle is in
flight, and Skynet's poller already reads that folder every second. The
poller grows to read the marker, and the wire frame grows a new boolean axis.
Then both the chat surface's holding overlay AND the conversation list row
spinner read from that single axis. Two surfaces, one truth, both accurate
for any row regardless of what's mounted.

## Shape

Five moving parts, top to bottom:

1. **On each managed box, the caretaker's recycling marker.** Already exists
   as of today — the caretaker renames the identity's own reset-intent marker
   to a recycling marker at the moment reconcile picks it up (before the old
   instance is even killed), and removes it with an 8-second delay after the
   fresh instance is up and has been driven through its identity-load. The
   whole window is unbroken — no gaps, no races.

2. **On the central box, the poller.** Every second it reaches out to each
   managed box over SSH and reads several files per identity to derive
   session state. It grows to also read the recycling marker on the same
   tick.

3. **The wire frame.** Currently carries several per-session axes (working,
   waiting, dormant, etc.). It grows one more optional boolean axis for
   recycling. Old browsers on new backends read the field as absent → treat
   as not-recycling (safe default).

4. **The browser-side session store.** Currently exposes hooks for each of
   the existing axes. It grows a parallel hook for the recycling axis,
   sourced from the new wire field.

5. **The two consuming surfaces.**
   - The chat surface's holding overlay: today derived from the pane's own
     connection health. In the new shape, it reads the recycling axis from
     the store. The connection-drop case (browser lost its wire to the
     central box) is a separate concern and its existing overlay path stays
     untouched.
   - The conversation list row spinner: today OR's a client-published
     recycling signal in with two other inputs. In the new shape, the
     recycling input comes from the store instead.

The client-side recycling store that today bridges the pane to the row goes
away entirely — nothing else consumes it once the row is rewired.

## Philosophy

The signal for "this session is currently being replaced with a fresh one"
belongs at the backend, because the caretaker is the only thing that
actually knows for sure. Any client-side derivation of it is a proxy at
best, and proxies necessarily fail for surfaces that aren't currently
mounted. The design principle is: if two surfaces should agree about the
same fact, they should read from the same source, and that source should be
the one closest to reality.

What this is deliberately NOT doing: it is not expanding the definition of
"recycling" to include other things that also happen to kill and relaunch
the harness (memory-cap restarts, dormancy-wake, etc.). Recycling means
specifically "the identity itself is being replaced with a fresh one via the
reset routine." Other harness-down states are their own concerns with their
own overlays.

What would violate the spirit even if it passed a test: any implementation
that leaves the row still blind when the pretty-view isn't mounted — that's
the exact bug this exists to fix, and any variant that still requires a
mounted pane to be accurate has missed the point.

## Prior context

The signal chain today: chat surface observes its own connection state →
publishes overlay-visibility into a per-session store → conversation list
reads from that store. Symmetric-looking but actually asymmetric: only the
row whose pretty-view is currently mounted publishes, so unmounted rows
never see recycling.

The caretaker's marker mechanism was extended today (mid-conversation)
specifically to make this redesign possible: the marker is placed the moment
the reset intent is detected (before the old instance even exits) and held
continuously through the entire recycle window with an explicit buffer past
the fresh instance being up. The full window is on-disk with no gaps.

The earlier queue-pending idea (making that signal also backend-authoritative)
was ruled out in the same conversation because queue-pending state genuinely
doesn't survive the pretty-view's own X-minute cleanup — the client is the
only source that knows whether the queue is still armed.

## What would make it wrong

- If a row in the conversation list still needs its pretty-view to be
  currently mounted for its recycling indicator to be accurate. That's the
  whole reason for this design.
- If the two surfaces (chat overlay + row spinner) can visually disagree
  about the same session's recycling state.
- If the fix expands the recycling definition beyond "identity is being
  reset" and starts lighting the overlay for unrelated harness-restart cases.
- If the pretty-view's connection-drop overlay gets tangled up with the
  recycling path — those are separate concerns and shouldn't share code
  paths.

## Scope edges

**In:** caretaker marker read at the poller, one new wire axis, one new
store hook, one source-swap in the chat surface's holding overlay logic,
one source-swap in the row spinner, retirement of the client-side
recycling bridge store, tests on both sides of the wire.

**Out:** queue-pending going backend-authoritative (deferred / decided
against). The chat surface's connection-drop overlay path (separate
concern, stays as-is). Any behavior for "harness is down but no recycling
marker" — that's a different state with its own existing (or to-be-added,
separately) treatment.

**Deferred / tempting-but-no:** unifying the fleet-status wire into some
grand session-state framework. This is a targeted axis addition, not a
schema redesign. Same restraint on the client-side stores — the fix
retires one bridge store, not a broader refactor of the state layer.

## Vehicle notes

GSD phase because it has 5-7 discrete tasks (poller read, wire type widen,
backend publish plumbing, store axis add, chat overlay source swap, row
spinner source swap, tests on each side) that benefit from atomic per-fork
commits.

The /open discussion covers everything a discuss-phase would elicit; drop
this shape file straight in as the phase's CONTEXT.md (or seed CONTEXT.md
from it) rather than re-running discussion.

Identity doing the work: tina (this identity). Phase number claimed at
ship time via the fork's rescue-rebase-and-renumber protocol; no need to
pre-negotiate the number.
