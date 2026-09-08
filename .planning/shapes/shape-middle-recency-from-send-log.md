# Shape: middle-list recency, sourced from Ashley's own sends

**Opened:** 2026-09-06
**Vehicle:** GSD phase

## What this is

The middle of the conversation list is meant to answer "who did I last talk
to." Today it answers that by reverse-engineering the answer from each
identity's transcript on its home box, and the reverse-engineering fails often
enough that the middle is noticeably wrong — recently-worked identities sink
below identities that haven't been touched in weeks. This change inverts the
approach: instead of guessing when Ashley last talked to an identity from
downstream evidence, Skynet itself records the moment whenever she sends
something to that identity from Skynet's compose surface, and uses that stamp
to rank the middle.

## Shape

- **Skynet keeps its own record of "when did Ashley last send to this
  identity."** The record is stored inside Skynet's own durable state so it
  survives container restarts and every device Ashley uses (phone and
  desktop both read from the same source of truth).

- **The record is keyed on identity name.** Not on any plumbing underneath —
  not the host the identity happens to live on, not the session mechanism
  that carries the message. Ashley cares about the identity; the key is the
  identity.

- **Anything sent from the compose surface counts, universally.** Every path
  by which the compose box can send something to the identity — typed text
  submit, reset button, thumbs-up button, recap button, any current or
  future button that fires a message-shaped payload — stamps the record. The
  rule is architectural, not a per-button allowlist. If it goes through the
  compose surface, it counts.

- **Attempts count. Delivery is not required.** If Ashley hits send and the
  send actually fails because the target is unreachable, the stamp still
  fires — her intent to talk to that identity is the recency signal.

- **The ranking of the middle reads from the new record.** The zone
  structure, the sort direction, the null-to-bottom fallback, the tie-break
  behavior — all stay exactly as they are today. Only the source of the
  number changes.

- **The old reverse-engineering path stays alive for its other jobs.** It
  still figures out what an identity is currently working on, whether it's
  actively responding, whether it's dormant, and everything else it feeds.
  It simply stops being the source of the recency ranking.

- **No starting-point seeding on first ship.** When the change lands, the
  record is empty. Identities Ashley has talked to before all start at
  "never" and naturally rise as she sends to them. The natural fill happens
  fast enough that no migration step is warranted.

- **The pinned zone and the remote-desktop zone are untouched.** Both keep
  their current stable alphabetical ordering. This change is scoped to the
  middle zone only.

## Philosophy

The current mechanism is elaborate machinery whose central premise is "we
don't have a first-class signal for 'Ashley talked to this agent' so we
reverse-engineer it from the transcript." The transcript-based approach then
needs a strict predicate to filter out noise (assistant activity, incoming
relay messages, wake fires, tool results, skill injections), and every
tightening of that predicate excludes more of the ways Ashley's real
interaction reaches an identity. The result is a fragile filter that
increasingly says "she never talked to this identity" for interactions that
were, in fact, her talking to that identity — just not by typing into
that identity's compose box directly.

The right inversion is to record the fact at the moment it's known for
certain, in the place where it's known for certain, rather than trying to
recover it downstream. When Ashley presses send in Skynet, Skynet knows.
Record it there.

This is deliberately keying on the identity — not on the transport or the
session or the host — because the identity is the durable, meaningful thing.
Sessions recycle, boxes reboot, transports change; the identity Ashley is
talking to persists across all of them.

What this is deliberately NOT doing:

- Not trying to count message activity the identity generates (assistant
  replies, tool output, self-chat). The signal is one-directional: Ashley
  saying something to the identity, not the identity being busy.
- Not trying to capture Ashley's phone Matrix DMs that bypass Skynet's
  compose surface. The old mechanism also didn't count those. Adding that
  path is a different piece of work.
- Not changing the wire shape or the frontend contracts. The consumers of
  the recency number all keep reading it the same way they do today.
- Not adding a manual "reset this identity's recency" affordance. Recency
  decays naturally as other identities are talked to.

## Prior context

- The conversation list's three-zone shape (pinned at top, flat recency
  middle, remote-desktop at bottom) is the direction agreed in
  `shape-conversation-list-recency-sort.md` and shipped in Phase 41 and
  successors. That shape stays. This change lives strictly inside the
  middle zone's ranking source.
- The current source of the recency number is a remote scan of each
  identity's transcript on its home box — the newest transcript file only,
  scanned for lines that pass a strict "Ashley's real user turn" filter
  (locked 2026-08-23). Every time an identity recycles itself (which the
  most active ones do most often because the context-safety valve trips on
  heavy work), a fresh transcript begins with no such lines, and the
  identity sinks to the null-to-bottom zone until Ashley types into that
  new transcript. Concrete case: an identity that stood up a VM yesterday,
  recycled overnight, sits below identities Ashley hasn't touched in
  weeks.
- Additional loss mode: interactions routed through a coordinator, arriving
  over the fleet relay, or fired by a scheduled wake all reach the
  transcript wrapped in a shape the filter deliberately excludes. Those
  interactions are real — Ashley is orchestrating that identity's work —
  but the recency source ignores them.
- The frontend has a preserving cache that protects against the backend
  publishing a null after a recycle. It survives within a single browser
  session but not across page refresh or a fresh browser open. Multi-device
  behavior means this cache alone can't be the fix.
- A prior effort unified the compose surface's send paths into a single
  send funnel (`shape-compose-send-funnel.closed.md`). That funnel is the
  natural place to hook the new stamp — one hook covers every send path
  today and any new one added later.

## What would make it wrong

- **If some kind of compose-surface send silently doesn't count.** The rule
  is universal: everything that fires a message-shaped payload from the
  compose surface stamps the record. A specific button being missed is a
  regression to the enumerated-allowlist trap.
- **If the ranking waits for a backend round-trip before it visibly
  reorders.** When Ashley hits send, she should see the row jump. Waiting
  for the next status frame before the list moves is a papercut that
  undoes the point.
- **If the stamp is keyed on anything other than the identity name.**
  Recycles, session-name changes, or moves between hosts must not orphan
  the record. Only identity-keyed storage is durable across those events.
- **If the record fails to survive container restart.** The whole reason
  it lives in durable state is so a restart doesn't wipe recency; if the
  store is in-memory-only, every restart returns the middle to the same
  "everyone at null" state and the sort collapses to fallback ordering.
- **If Ashley's two devices show different orderings.** Phone and desktop
  are both her; both reflect her sends. The store lives on Skynet so both
  read the same value.
- **If the old reverse-engineering path is torn out along with its recency
  role.** Its other consumers (what an identity is currently working on,
  whether it's actively responding, whether it's dormant) still need it.
  Only the recency-derivation role retires.
- **If a failed send doesn't stamp.** Attempts count. Filtering by
  delivery success re-introduces "I meant to talk to Ivy but Ivy's box
  was flaky, so she sinks to the bottom" — the exact class of bug this
  change exists to remove.
- **If the pinned zone or the remote-desktop zone starts reordering
  because the new recency signal leaked into their ranking.** Both zones
  stay alphabetically stable regardless of send activity.

## Scope edges

**In:**

- A new durable per-identity "when did Ashley last send to this identity"
  record living inside Skynet's own persistent state, keyed on identity
  name.
- A hook on the compose surface's universal send funnel that stamps the
  record on every send-attempt, regardless of which button fired it or
  whether the send lands.
- Swap the source of the middle-zone recency ranking from the current
  transcript-scan derivation to the new record.
- Client-side responsiveness: the row moves the instant Ashley hits send,
  not on the next round-trip.
- In-process test coverage for the new record, the hook, the swap, and
  the client-side responsiveness.

**Out:**

- Any change to the pinned zone or the remote-desktop zone.
- Any change to the wire shape, the working-store contract, or the
  frontend comparator.
- Any change to what the old reverse-engineering path does for its other
  consumers (currently-working, dormant, ai-title, etc.).
- Any starting-point seed of the new record — everyone starts at "never,"
  and the natural fill takes it from there.
- Any capture of Ashley's phone Matrix DMs that bypass Skynet's compose
  surface (same limitation as today).
- Any manual "reset this identity's recency" affordance.
- Any change to how sessions are discovered or which rows appear in the
  list.

**Deferred:**

- Multi-user keying — Skynet on this box is single-tenant for Ashley, so
  the record needs no user column today. If Skynet later runs
  multi-tenant, add the user dimension then.
- Capturing non-compose Skynet interactions if any are added later (for
  example, a future action outside the compose surface that talks to an
  identity). Wire those to the same hook when they're added.

**Tempting but no:**

- Broadening the signal to "any message either direction" so assistant
  activity floats rows (rejected: the goal is "who did I last talk to,"
  not "who's noisy").
- A one-shot seed from the current transcript scan on first ship
  (rejected: natural fill is fast enough, no migration step needed).
- Per-button allowlist of which sends count (rejected: universal rule,
  hook is architectural).

## Vehicle notes

Chosen vehicle: **GSD phase.** Sized appropriately — a new durable store
inside Skynet's own state, a hook on the send funnel, a source swap on the
backend derivation, a client-side optimistic stamp for instant reorder, and
coverage on the whole path. Multiple concerns that want to be broken into
plans and executed in waves, with the atomic-commits + goal-backward
verification GSD gives.

Handoff to the planner:

- Prior shape `shape-conversation-list-recency-sort.md` (Aug 14) established
  the three-zone model and the middle-recency direction. Everything in that
  shape stays; this shape narrows to one axis: the source of the middle-zone
  ranking number.
- Prior shape `shape-compose-send-funnel.closed.md` established the
  universal send funnel on the compose surface. That funnel is the intended
  hook point — one hook covers every current send path and any future
  addition automatically.
- The new store must survive container restarts (durable, not in-memory),
  and both of Ashley's devices (phone and desktop) must read the same
  value — so it lives on the backend, not client-only.
- Identity: this work happens under identity `tiffany`, box-maintainer of
  the Skynet EC2 (`t1000`) at `term.gigaashley.click`. The container-mutation
  coordination protocol in the role file applies to every deploy motion
  (BEFORE announce in the box-maintainer coord room, ship, AFTER announce).
  The push→build→recreate greenlight-gate applies (deferred-authorization
  is not standing-authorization; per-push may-I is required).
