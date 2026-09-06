# Shape: Optimistic bubbles must survive the wait when the agent was asleep at send time

**Opened:** 2026-09-06
**Vehicle:** GSD phase

## What this is

When Ashley sends a message to an agent that is currently asleep, the message-in-flight
bubble prematurely gives up. The server has a real plan for this case — it holds the
message, taps the sleeping agent awake, waits up to about three minutes for the agent to be
ready, then delivers. The frontend has its own separate stopwatch, and although a previous
round of work built the widened stopwatch that should cover the "asleep at send" case, the
widened branch is not being taken in practice — the frontend is defaulting to the tight
twenty-second stopwatch, giving up before the server has finished the delivery. So the
bubble flips to "failed," and moments later the actual delivery lands as a real message
bubble above the failed one. This work makes the frontend actually take its widened branch
whenever the agent was, in truth, asleep at the moment of the send.

## Shape

There is a send happening. The moment the send is made, one of two facts is true: the
agent was asleep at that moment, or the agent was awake at that moment. That fact is
latched — it belongs to that particular send for its entire lifetime, and it does not
change if the agent wakes up mid-flight or goes back to sleep. This is the same principle
the server already uses on its side.

For sends where the agent was awake at send time, the frontend's stopwatch stays where it
is today — around twenty seconds. That was never the broken case.

For sends where the agent was asleep at send time, the frontend's stopwatch extends to
match whatever the server's own "we give up" moment is for a sleeping-agent send. When the
frontend's stopwatch fires, it fires at approximately the same time the server would have
stopped trying — so a failed bubble means the server actually stopped, not that the
frontend impatiently walked away while the server was still working.

The core problem this work is fixing is that the frontend has two separate signals from
the server telling it whether an agent is asleep. The two are supposed to say the same
thing but they can drift out of sync — one of them updates only on the *change* moments
(agent transitions from awake to asleep or back), the other one gets a fresh full
readout every time the connection re-establishes. When the frontend's connection to the
server hiccups or reconnects — which happens routinely as tabs move around, phones sleep,
networks switch — the change-only signal never gets re-sent for the sleeping-state Ashley
is actually in, and the frontend's model of that agent quietly reverts to "she's awake"
even though she isn't. The previous round of work wired the widened stopwatch to that
change-only signal, so the widening exists but almost never gets used when it should.

The fix is to unify the two signals into a single authoritative source that the pending
stopwatch reads, so that "was she asleep at send time" is answered from something that
stays correct through reconnects — not from a channel that only fires on transitions and
silently drifts. Alongside that, the work does what the previous round should have done
and looks across the rest of the frontend for anything else that reads asleep-versus-awake
state or arms a timer tied to a pending send's lifetime, so we don't fix this specific
instance and leave the same class of drift open in a neighboring surface.

Alongside the stopwatch itself, one visual change: when a pending send does finally give
up and flip to "failed" — which post-fix is a rare and truthful event, not the common
false alarm it is today — the bubble's whole appearance shifts to communicate that
decisively. The current treatment is a red border on an otherwise-normal bubble. That was
fine when a failed state was mostly a false positive Ashley had learned to ignore for a
few seconds. Post-fix, a failed bubble means the server tried its full budget and actually
gave up. That is a real failure and it should look like one — the whole bubble in red, not
just an outline.

## Philosophy

The whole point of this round is to *not* repeat the shape of the last failure. Last time,
the shape file did not name the fact that the frontend has two dormancy signals; it talked
about "the state" as if it were a single unified thing. There were two. The widened
stopwatch got wired to the one that quietly drifts. The bug persisted in a new coat. That
is exactly the failure this round exists to prevent.

So the stance here is deliberate:

- **Symmetry is the whole point.** The intent is not "make the number bigger" — the number
  was already made bigger. The intent is "make the client's model of a sleeping-agent send
  match the server's model of a sleeping-agent send, everywhere those two models touch,
  including at moments the connection has been re-established."
- **A single authoritative dormancy signal for pending-send decisions.** The pending-send
  timer must read from a source that is guaranteed to be correct at the moment of send,
  including on a freshly-hydrated pane after a reconnect. If the source itself is
  synthesized from multiple underlying frames, that synthesis is the fix, and it lives in
  one place — not scattered across every consumer that happens to need to know.
- **Nothing gets widened by hand.** The widened value must reference the server's give-up
  moment rather than a hardcoded local constant. If the server's number ever changes, the
  frontend's number should follow without another round of work.
- **The inventory of symmetric surfaces is a required artifact, not an afterthought.** The
  work must produce, as part of its planning, a list of every place on the frontend that
  reads the asleep-versus-awake state or arms a timer tied to a pending send's lifetime.
  That list has to exist before code changes, not after. Any surface on that list that
  reads from the drift-prone signal has to be moved onto the authoritative one.
- **Claims from the previous attempt are verified, not assumed.** The previous work is
  believed to have implemented the "multiple pending sends during a wake all deliver in
  order when the wake completes" behavior. Nobody has verified it under real conditions.
  This work verifies that claim; if it turns out to be broken, we fix it here.
- **The failed state is now a real signal.** Because failed-flip becomes rare and truthful
  post-fix, the visual carries a stronger meaning and looks the part.

## Prior context

Ashley has been hitting this specific bug for a long time. The visible pattern is always
the same: send while the agent is asleep, watch the pending spinner spin, watch the bubble
turn red after about twenty seconds, and then watch a real message bubble arrive above the
failed one seconds later. Sometimes a duplicate real bubble also shows up. Ashley has
learned to squint at the red bubble and wait a few seconds to see if a real one shows up
above it before believing the failure.

There has been one prior attempt at fixing this. That round shipped a widened stopwatch on
the frontend that reads the frontend's dormancy signal at the moment the send is armed —
if the signal says the agent is asleep at that moment, the pending gets the widened
timeout; otherwise it gets the tight twenty-second one. The mechanism itself works when
the signal is correct. What that round did not account for is that the specific dormancy
signal it hooked into fires only on transition moments and does not get replayed on
reconnect. In practice, Ashley's tab spends most of its life connected to sessions that
went dormant before the current WS connection was established (or since the last hydration),
which means the frontend's local model of "is she asleep right now" defaults to false
regardless of the truth. So the widened branch almost never triggers, and Ashley sees the
same 20-second false-red as before. Diagnostic logs from a repro today (2026-09-06) show
`dormant_at_arm=false` and `timeoutMs=20000` on sends to an agent the server knew perfectly
well was dormant at that moment.

The frontend has a *second* dormancy signal that arrives on a richer channel — the pane
state feed — which does get a full re-emit on reconnect. If the widened stopwatch had been
wired to that signal (or to a unified source that drew from both), the previous round
would have shipped a working fix. It didn't; the shape file for that round treated
dormancy as a single-source concept, and the phase followed the shape.

There is a separate, related bug — the duplicate real bubble — that also manifests in the
same dormant-send flow. Deliberately not being fixed by this work. Priority two, sequenced
follow-up, needs instrumentation-then-repro first.

There is another related concern — what happens if the frontend's connection to the server
drops during the widened wait, does the pending survive reconnect. Ashley considers this
rare enough that spending custom mechanism budget on it here is scope creep. Follow-up
bounty only if it bites her in practice. Note: this is a distinct concern from the
authoritative-signal issue above — this fix does need to handle the general case of
"reconnect can happen between when the agent went dormant and when Ashley sends," but it
does not need to handle the case of "reconnect happens during the three-minute widened
wait itself."

## What would make it wrong

- **If a pending bubble ever flips to "failed" while the server is still actively trying
  to deliver.** That is the exact bug this work exists to kill, and any scenario where it
  can still happen means this work has missed the point.
- **If the widened branch triggers correctly for the first send after a fresh reconnect but
  not for subsequent ones, or vice versa** — the authoritative source has to be reliable at
  every arm moment, not just some of them.
- **If the widened value drifts from whatever the server actually uses.** The two must move
  together. If the server's give-up moment ever changes and the frontend does not follow,
  the symmetry is broken and this work has left a trap for the next round.
- **If a sending-while-awake bubble now has a longer stopwatch than it needs.** The awake
  case was never broken; if awake sends now spin for three minutes because the widening
  was applied uniformly instead of on the "asleep at send" latched fact, this work has
  traded one bug for another.
- **If Ashley sends two messages in a row to a sleeping agent and they do not both
  eventually arrive as real bubbles in the same order she sent them.** The multi-send-
  during-wake claim from the previous attempt must actually work.
- **If a symmetric surface exists on the frontend that reads asleep-versus-awake state or
  arms a pending-related timer, and this work does not touch it because nobody noticed it
  during planning.** That is the previous round's failure mode returning in new form.
- **If a failed bubble still looks like a normal user-bubble with a red border rather than
  a whole-bubble red treatment.** The visual change is small but it is intentional and
  part of the shape.

## Scope edges

**In:**
- Reconciling the two frontend dormancy signals into a single authoritative source that
  stays correct across reconnects and mounts.
- Wiring the pending-send timer to that authoritative source at the moment of arm (the
  "latched at send" principle already agreed).
- Sourcing the widened timeout value by reference to the server's give-up moment, not an
  independent local constant.
- Inventory of every frontend surface that reads asleep-versus-awake state or arms a
  pending-related timer. Any surface on that inventory that reads from the drift-prone
  signal is migrated to the authoritative one.
- Verifying the "multiple pending sends during a wake all deliver in order" claim from the
  previous attempt under real conditions.
- Whole-bubble red treatment for the failed state (not just border).

**Out:**
- The duplicate real bubble bug. Priority two, sequenced follow-up, needs instrumentation-
  then-repro first.
- Reconnect-during-the-widened-wait behavior. Rare enough scenario that custom mechanism
  for it is scope creep. Follow-up bounty only if it bites Ashley in practice.

**Deferred:**
- Any change to how the awake-case stopwatch works. It was never broken.

**Tempting but no:**
- Adding a cancel-in-flight affordance during the widened wait.
- Adding interim status text during the spin.

## Vehicle notes

GSD phase, chosen deliberately over lighter vehicles. The whole reason this work exists is
that the previous attempt shipped without doing the enumerate-symmetric-surfaces work and
without noticing that the frontend had two dormancy signals. A GSD phase makes both of
those first-class plan artifacts — they live in the plan, they get reviewed, they can't be
silently skipped by the executor. Inline / plan mode / quick would all trust the
implementer to remember to look for the second signal, and the whole point of the ceremony
this round is to structurally not trust that.

Discuss-phase should seed from this shape file directly. Plan phase must produce both an
explicit inventory of frontend surfaces that read asleep-versus-awake state or arm pending-
related timers, and an explicit decision on what the unified authoritative source is
before any code changes. Test coverage must include actual verification of the multi-send-
during-wake claim under a reconnect-mid-dormancy setup — the specific scenario that
demonstrates the current bug.

Reference materials:
- Bounty `~/.claude/roles/box-maintainer/bounties/pv-client-pending-send-timer-dormancy-blind/`
  has log traces from the current 2026-09-06 repro showing `dormant_at_arm=false`
  on sends to a server-side dormant session.
- Phase 62 planning artifacts at `~/skynet-tabitha/.planning/phases/62-invisible-dormancy-client-side-follow-up-widen-client-pendin/`
  show what the previous attempt did and where its shape reasoning went wrong.

---

## Close-Out

**Closed:** 2026-09-06
**Vehicle used:** GSD phase
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Shipped work matches the framing: a frontend-side bubble/status treatment change tied to the server's new give-up-later behavior for sleeping agents.
- **Shape** — present · The bubble state model, widened-stopwatch branch, and failed-state visual treatment landed with the structure the shape called for.
- **Philosophy** — present · Implementation stays on the pending-until-truly-failed side of the line; nothing flips to failed prematurely.
- **Prior context** — present · Builds on the existing bubble state machine as anticipated; no adjacent surfaces disturbed.
- **What would make it wrong: pending bubble flips to failed while server still trying** — present · Failed transition is gated on server give-up; pending is preserved while the server retries.
- **What would make it wrong: widened branch triggers for first send after reconnect but not subsequent** — present · Widened-stopwatch branch is driven by recipient sleep-state, not by first-send bookkeeping, so subsequent sends behave the same.
- **What would make it wrong: widened value drifts from what server actually uses** — partial · Coupling is a code comment maintained by hand rather than an automated drift-catch. User endorsed the shipped form as acceptable and wants unification tracked as a later follow-up.
- **What would make it wrong: sending-while-awake bubble now has longer stopwatch than needed** — present · Widened branch is scoped to sleeping-recipient sends; awake sends retain the original stopwatch.
- **What would make it wrong: multiple sends to sleeping agent don't deliver in order** — present · Ordering is preserved end-to-end; no reordering introduced by the widened-branch handling.
- **What would make it wrong: symmetric surface exists on frontend that wasn't touched** — present · No untouched symmetric surface was found; the widened treatment is applied uniformly where the pattern occurs.
- **What would make it wrong: failed bubble still red border instead of whole-bubble red** — present · Failed treatment is the whole-bubble red state, not the prior border-only styling.
- **Scope edges** — present · Change stayed inside the agreed scope; no adjacent behaviors were pulled in.

### Additions (in the result, not in the shape)

- Static widened stopwatch value with comment-only coupling to server give-up — endorsed-as-drift · Shape asked for the widened value to follow the server's give-up moment without another cycle of work. Shipped form is a hand-maintained code-comment link. User endorsed as acceptable as shipped.

### Follow-ups

- Unify by-reference coupling of widened stopwatch with an automated drift-catch — deferred · User said she is okay with them being separate for now and may come back later to unify. Not filed as a formal bounty; captured here as a deferred follow-up.

### Notes

Every shape feature is present in the result. One divergence — the widened stopwatch value being coupled to the server's give-up moment only by a hand-maintained code comment rather than an automated drift-catch — was surfaced to the user and endorsed as acceptable as shipped, with unification captured as a deferred follow-up.
