# Shape: WIP indicator shell-idle gate

**Opened:** 2026-08-26
**Vehicle:** GSD phase

## What this is

The little "working" indicator that shows on a session's row in the conversation
list is currently lying — some sessions display the indicator when they're
actually just sitting idle, waiting for the user. This is a fix to make it
honest again by adding a second signal the indicator must respect: whether the
harness has told us the session has stopped since its last real state change.

## Shape

Every managed session on every managed box has a state note the harness keeps
current — the note names one of a handful of states, and today's indicator lights
up whenever that note reads "actively generating" or "shell." The problem is
that "shell" often ends up as the terminal state of a completed turn (a shell
command was the last thing that ran), and the harness never rewrites the note
back to "idle" after the turn ends. So the note goes stale in the "shell"
position and the indicator inherits the lie.

The new signal to bring in: the harness fires a "turn ended" event every time
a session finishes. That event already lands on disk on every managed box, and
the backend already reads it every couple of seconds — but only to extract one
side-detail (the list of background monitors running at turn-end). The
timestamp of when that event last fired for a given session is the missing
piece. With it, the indicator rule becomes:

- If the state note reads "actively generating" → indicator on.
- If the state note reads "shell" → indicator on ONLY if the session's state
  has actually CHANGED (transitioned to a different named state) since its own
  most recent "turn ended" event. Otherwise the "shell" reading is just
  leftover from the completed turn, and the indicator stays off.
- If we've never seen a "turn ended" event for a session, treat it as if the
  session is still working — no evidence of any stop yet, so it defaults to on.

There are two derived pieces our own backend needs to track that we don't
today: (1) per-session "last turn-ended time," which requires the harness-side
event file to be written per-session rather than one-shared-per-box (a second
session ending its turn today would overwrite the first session's record), and
(2) per-session "last state actually changed" time, which we derive on our end
by watching for the state note's value transitioning from one polling tick to
the next — not by trusting the file's own modification time (which the harness
bumps for reasons like the user typing into the compose box without submitting).

## Philosophy

Trust the harness's positive signal ("here is proof this session stopped at
time T"), don't trust the harness's negative signal ("the state note still says
shell, so something must be happening"). A completed turn is a fact the harness
observably reports; a stale "shell" is silence, and silence should not be
interpreted as ongoing work.

We are deliberately NOT trying to work around every possible way the
harness could mislead us. The user-typing-without-submitting case, where the
compose box's activity bumps the state file's modification time — we handle
that naturally because our derivation looks at value transitions, not file
timestamps. Fancier edge cases we haven't seen yet are deferred; we can revisit
if they surface in practice.

We are also NOT trying to fix the root cause upstream in the harness. The right
fix upstream would be "always rewrite the state note to 'idle' when a turn ends,
regardless of what pre-end state was." That would be cleaner but is out of our
reach — we ship a local workaround that leans on a signal we do control.

## Prior context

Today's indicator rule includes "shell" in the working set because a previous
tightening (which excluded shell) caused the indicator to flicker off during
real work turns that pass briefly through shell mid-turn. That fix was correct
in intent — real work often oscillates through shell — but overcorrected: it
also lights up every session whose last completed turn happened to end in a
shell state, forever, until the next turn starts.

Live evidence gathered this session: one session on a managed box (Poppy on
workstation) is genuinely idle at her prompt but the indicator is on, because
her session's last state transition landed on "shell." Two other sessions on
the same box (aqua and wilma) have been in the same stale-shell false-positive
state for 18-20 hours. The Poppy case pinpointed the harness-writes-shell-then-
never-rewrites pattern.

## What would make it wrong

- **Turning the indicator off during real work.** If a session is actively
  running a turn — even one that dwells in shell for minutes while waiting on
  tool output — the indicator must not go dark. Missing real work is a much
  worse failure than the current false-positive-when-idle.
- **Waking sleeping sessions to check on them.** Anything we do to derive the
  new signal must not touch the managed boxes in a way that changes their
  behavior — the diagnostic layer stays fully passive.
- **Depending on a signal that vanishes.** If a session's "last turn-ended"
  record can get cleaned up or overwritten while the session is still alive,
  we lose the ability to distinguish stale-shell from mid-turn-shell for that
  session, and we're back where we started.

## Scope edges

**In scope:**
- The harness-side event script is updated to write one record per session
  instead of one shared across the box.
- The backend gains a way to look up "last turn-ended time" per session and
  publishes it as an axis on the wire.
- The backend tracks "last state actually changed" per session by watching
  poll-to-poll state-value transitions.
- The frontend indicator rule uses the two together to decide whether "shell"
  counts as working.

**Out of scope, deferred:**
- The user-typing-into-compose-without-submitting case is naturally handled by
  the derivation (we watch value transitions, not file timestamps). If some
  other edge case surfaces later that our derivation doesn't handle, that's a
  follow-up.
- Bootstrapping stale sessions that already exist at deploy time. The rollout
  is lazy: existing sessions resolve on their next turn-end; sessions currently
  stuck in stale-shell (aqua, wilma) will stay lit until their next real turn.
  Accepted as a clean-rollout trade for zero-magic deploy.
- Fixing the root cause upstream in the harness. Out of our reach.
- Changing what the box-wide "turn ended" file does today (it still carries the
  background-monitors list and stays where it is — the new per-session file is
  additive, not a replacement).

**Tempting-but-no:**
- Reading the harness transcript directly for the "turn ended" event instead of
  installing our own event script. Elegant zero-footprint idea, but the
  per-poll bandwidth cost of tailing every session's transcript over the
  network is higher than reading one small purpose-built file, and we already
  own the event-script install path. Not this time.
- Building a smart cleanup for old per-session event files. Lazy is fine —
  files for dead sessions can be handled by whatever session-lifecycle cleanup
  already exists.

## Vehicle notes

Full GSD phase. Chosen because the change crosses five discrete pieces that
have to move together — the harness-side event script, the install path that
drops it on managed boxes, the backend polling and parsing, the wire between
backend and frontend, and the frontend indicator rule. Tests want coverage at
each layer. Small on any single file, but genuinely phase-shaped.

Rollout is lazy by design (see Scope edges). No bootstrap step needed.

---

## Close-Out

**Closed:** 2026-08-29
**Vehicle used:** GSD phase
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Indicator gate that requires a state transition since the last turn-ended event before shell counts as work.
- **Shape — rule for busy → on** — present · busy is unconditional in the main predicate.
- **Shape — rule for shell → on only if state changed since most recent turn-ended** — present · shellCountsAsWork requires lastStatusChangeAt > lastStopAt.
- **Shape — rule for never-seen turn-ended → default on** — present · lastStopAt === null short-circuits to on.
- **Shape — derived piece 1: per-session last-turn-ended time via per-session hook file** — present · Stop hook now writes per-session stop-<sid>.json in addition to the box-wide file; backend stats its mtime.
- **Shape — derived piece 2: per-session last-state-actually-changed via poll-to-poll transitions (not file mtime)** — present · Server-side status-delta tracking; explicitly forbids sourcing from sessionJson.updatedAt.
- **Philosophy — trust positive stop signal, not stale shell** — present · Predicate treats absence of transition-since-stop as silence and turns off.
- **Philosophy — user-typing-into-compose handled naturally via value transitions** — present · Comparison is against cached previous-tick status value, not updatedAt.
- **Philosophy — not fixing upstream harness** — present · Local workaround only.
- **Prior context — mid-turn shell must still count as work (do not overcorrect)** — present · During real work turns, oscillation keeps lastStatusChangeAt > lastStopAt so indicator stays lit.
- **What would make it wrong: turning indicator off during real work (including long shell dwells)** — present · Mid-turn oscillation ensures lastStatusChangeAt keeps advancing past lastStopAt during work.
- **What would make it wrong: waking sleeping sessions to check on them** — present · Only passive stat + cat reads over the existing SSH poll channel; no behavior-changing operations on managed boxes.
- **What would make it wrong: depending on a signal that vanishes** — present · No cleanup of per-session files; the tempting-but-no 'smart cleanup' was deliberately not built.
- **Scope edges — In scope: harness-side event script updated to per-session write** — present · stop-hook.sh writes per-session file additively.
- **Scope edges — In scope: backend gains lookup for per-session last-turn-ended and publishes on wire** — present · lastStopAt derived via stat -c %Y and published as a wire axis.
- **Scope edges — In scope: backend tracks last-state-actually-changed via poll-to-poll transitions** — present · PidCacheEntry.lastStatus + derivedLastStatusChangeAt logic in orchestrator.
- **Scope edges — In scope: frontend indicator rule uses the two together to decide whether shell counts** — present · shellCountsAsWork predicate in session-working-store.
- **Scope edges — Out of scope: user-typing case deferred (handled naturally)** — present · No explicit handling; derivation naturally handles it.
- **Scope edges — Out of scope: bootstrapping stale sessions at deploy time** — present · No bootstrap step; lazy rollout as specified.
- **Scope edges — Out of scope: fixing root cause upstream in harness** — present · Not attempted.
- **Scope edges — Out of scope: changing what the box-wide turn-ended file does today** — present · Box-wide last-stop-payload.json still written unconditionally and still consumed for background_tasks.
- **Scope edges — Tempting-but-no: reading harness transcript directly instead of installing event script** — present · Not done; per-session file approach used.
- **Scope edges — Tempting-but-no: building smart cleanup for old per-session event files** — present · No cleanup added; lazy handling as specified.

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

The implementation adds a strict regex guard on the session_id in the stop hook to prevent path traversal, and wraps the writes in a 2-second timeout so a full disk cannot hang the hook. Neither was mentioned in the shape, but both are defensive plumbing on the newly-introduced per-session write path rather than product-level additions — the shape's 'write one record per session' commitment naturally raises the question of how to safely name that file, and the implementation answered it conservatively. The frontend also preserves the two new axes across Axis A/B/C/D/E republishes (Pitfall-3 preservation), a defensive plumbing move consistent with the store's existing pattern for prior axes. Tests cover: schema forward/back-compat/type-enforcement (wire), first-appearance seeding, same-status preservation, transition bumping, mtime read (present/absent/hiccup), fingerprint-delta publish, script byte-equality, and the canonical stale-shell/mid-turn-shell/default-on/Pitfall-3 predicate cases in the store.
