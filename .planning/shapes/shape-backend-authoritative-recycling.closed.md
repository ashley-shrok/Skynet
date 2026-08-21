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

---

## Close-Out

**Closed:** 2026-08-21
**Vehicle used:** gsd phase (three sequenced plans: 53-01 backend wire + poller, 53-02 browser store axis + hook, 53-03 consumer swaps + bridge-store retirement)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · recycling signal moved to backend; poller reads the marker; wire grew one axis; store grew one hook; both surfaces read that axis
- **Shape — caretaker marker (part 1)** — present · caretaker artifact unmodified; rename at reconcile + 8s delayed removal confirmed on managed box
- **Shape — poller reads marker (part 2)** — present · per-PID stat of .recycled-at added to processPid with fail-open on SSH hiccup and shell-quoting; cached in PidCacheEntry
- **Shape — wire frame grows one boolean axis (part 3)** — present · SessionStateSchema.recycling optional+nullable; FRAME_SCHEMA_VERSION held at 1; participates in fingerprint
- **Shape — browser session store parallel hook (part 4)** — present · Axis E swap-and-notify + useSessionIsRecycling hook; cross-axis preservation defends against Pitfall-3
- **Shape — two consuming surfaces read the axis (part 5)** — present · PrettyView overlay + row spinner both source-swapped; compose-box disable props also swapped (endorsed drift)
- **Shape — client-side recycling bridge retired** — present · session-recycling-store.ts and .test.ts deleted; no live references remain in the tree
- **Philosophy — one source closest to reality** — present · single backend-sourced axis feeds both surfaces (and, per endorsed drift, the compose-box disable props)
- **Prior context — caretaker marker semantics** — present · unbroken window confirmed against agent-supervisor: rename before old PID exits, 8s delayed removal after fresh /id-load
- **Prior context — queue-pending stays client-side** — present · queue-pending store untouched semantically; only docblock references to retired store cleaned up
- **What would make it wrong — row still needs pretty-view mounted to be accurate** — present · row reads useSessionIsRecycling(sessionKey) directly against fleet-status feed; no PrettyView-mounted dependency
- **What would make it wrong — the two surfaces can visually disagree about the same session** — present · both surfaces read the identical Axis E of the same working-store record for the same key
- **What would make it wrong — recycling definition expanded beyond identity-reset** — present · scope-locked in schema block-comment; sourced strictly from .recycled-at; memory-cap / dormancy-wake explicitly excluded
- **What would make it wrong — connection-drop overlay tangled with recycling path** — present · wsTransportState / paneState / usePaneResolvingMachine / case session_holding WS handler all untouched
- **Scope edges — In** — present · all seven in-scope items delivered (poller read, wire axis, store hook, overlay swap, row spinner swap, bridge retirement, tests on both sides)
- **Scope edges — Out** — present · queue-pending stayed client-side; connection-drop overlay untouched; harness-down-without-marker untouched
- **Scope edges — Deferred / tempting-but-no** — present · no fleet-status schema redesign; no broader state-layer refactor; targeted axis addition only

### Additions (in the result, not in the shape)

- ComposeBox isHolding and recycleActive props were also source-swapped to the new working-store recycling axis (shape agreed to one chat-surface swap — the overlay mount — but three consumer sites in PrettyView actually moved). Trade-off: compose-box disable state on a mounted pane shifts from an instantaneous per-pane pane_state signal to the fleet poller's 2s cadence. — endorsed-as-drift
- The pre-existing Phase 52 dormant field was mirrored onto the browser-side SessionState type in the same commit that added the recycling mirror. The shape only asked for the new recycling axis; this backfilled a stale-since-Phase-52 type gap (compiled silently under tsconfig strict:false) while adjacent. — endorsed-as-drift

### Follow-ups

None.

### Notes

Diff-stat against origin was initially misleading: seven unpushed remote commits (quick-260821-shn/suv, plus older commits touching claude-session-server, use-is-touch-device tests, compose-send tests, pv-send-watchdog, user-preferences, ComposeBox, use-auto-scroll) show up in the working-tree diff but are NOT part of Phase 53's 13-commit local set. Confirmed by walking git log per file — every Phase-53 commit is prefixed feat(53-...)/test(53-...)/docs(53-...) and touches only the shape's declared surfaces. Worth carrying forward: Phase 53 revealed the browser-side SessionState type has been silently drifting from the backend wire schema since Phase 52 because tsconfig.app.json has strict:false — any future wire-additive phase should double-check the mirror was actually updated, since a missing field will compile clean. The plan itself already accepted the ComposeBox 2s-cadence trade-off (T-53-03-02) and named the follow-up escape hatch (restore instantaneous pane_state gating for ComposeBox specifically if UAT surfaces a regression) — recorded here rather than as a follow_up because it is a conditional-on-UAT contingency, not an open action.
