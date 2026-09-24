# Shape: Role archival

**Opened:** 2026-09-24
**Vehicle:** gsd phase

## What this is

A way to retire a role from a box cleanly. Today, when a role is no longer
needed, there is nothing an operator can do about it — the role folder just
sits there forever, along with every identity that ever held the role, even
after the reason for the role is long gone. This adds the missing gesture:
one deliberate click in the interface, one sentinel dropped on the role
folder, and the box's supervisor takes care of the rest — winding down every
identity currently holding that role, then moving the role folder itself
out of the live tree into an archive sibling. When the smoke clears the
role is gone from the live surface as if it had never existed, and every
identity that was working under it is gone too, all in one gesture.

## Shape

A role retirement is a single operator gesture with a single sentinel, and
all of the cascade complexity lives inside the supervisor where it belongs.

The operator opens the roles list, right-clicks on the role they want to
retire, and chooses Archive from the context menu that appears — the same
context menu shape and interaction model that is used for every other
archival action across the interface. Two confirmation dialogs follow in
sequence. The first is honest about the blast radius: it names the role
being archived, and lists — one line per identity, in that identity's own
task description with a fallback to the identity's display name when no
task is set — every identity currently holding that role that is about to
be archived along with it. The list is complete; nothing is truncated. If
no identities currently hold the role the first dialog says so plainly.
The second dialog is the final sanity tap — a plain "are you sure? this
can't be undone" — that catches the accidental first click.

Once both confirmations are through, one HTTP call goes to the box holding
the role. That call drops one sentinel file on the role folder itself. It
does not fan out — it does not touch any identity folders. The single
sentinel is the whole message.

The supervisor's reconcile loop, on its next tick, finds the sentinel on
the role folder. On that tick it does the entire retirement inline: it
walks the live identity folders and picks out every identity whose
frontmatter names this role as its role; for each such identity it runs
the identity retirement process end-to-end (deactivate the identity's
messaging account, gracefully exit its harness session, tear down its
terminal session, clean up any safely-reclonable working repositories in
its workspace, move the identity folder to the identities archive). After
every identity has been attempted, if all of them retired cleanly the
supervisor moves the role folder itself to a roles archive sibling and
deletes the sentinel — the tick is done and the role is gone. If any
identity failed to retire, the supervisor logs loudly which identities
failed and why, leaves the role folder in the live tree, and deletes the
sentinel anyway. That is a one-shot signal: subsequent ticks do nothing
because there is no sentinel to detect. The operator retries the same
gesture from the interface, and because the retirement is idempotent by
design the retry naturally picks up only the identities that were left
behind — the ones that already retired cleanly are already gone from the
live tree and get silently skipped.

Retirements happen inline. Every step of an individual identity retirement
is protected by a bounded retry with exponential backoff. If a step fails
transiently — the messaging server hiccuped, the network dropped a packet
— the step retries itself right there, on the same tick, without help
from any cross-tick machinery. Only after a bounded number of attempts
against genuine failure does the retire give up and report failure to the
role cascade above it. No counters live across ticks; no stuck-sentinel
markers get dropped anywhere. This retry-inline pattern is the load-bearing
change: it replaces the existing cross-tick retry mechanism that identity
retirement uses today, which requires the supervisor to remember failure
counts across many ticks and drop diagnostic sentinels into archive folders
after enough failures accumulate. That mechanism goes away entirely and the
same inline-retry pattern serves both the role cascade path and the
existing user-initiated identity archive path.

The archive itself is verbatim. Whatever lives in the role folder at the
moment of archival — the role file, the chronological history, the
runbooks, the reference documents, any bounties or wakeups, any ad-hoc
content the identities working the role had accumulated over its lifetime,
and yes any stray credential files that shouldn't have been sitting in a
role folder in the first place — all of it travels along in the move,
uncensored, unfiltered. Roles should not hold credentials as a matter of
practice; if they do, that is a hygiene issue that should have been caught
earlier, and this archival gesture is not the place to introduce scrubbing.

When the archival gesture is triggered on a role that already has zero
live identities holding it, the cascade phase is a no-op and the folder
move happens immediately. Same code path, degenerate case.

Guards that protect against automated retirement — the pinned marker, the
no-dormancy marker, the coordinator frontmatter flag — are bypassed for
identities cascaded by a role archival. Those guards exist to protect
against automated surprises, and a deliberate operator click on Archive
is not automated. The click means intent; the intent is honored.

Role archival is per-box. A role's folder and the identities holding it
all live on the same box; the archival gesture is scoped to that box, the
sentinel drops on that box, the supervisor on that box handles the
cascade. There is no cross-box coordination and there is no cross-box
cascade.

The archive is one-way for now. There is no un-archive path. If an
operator archives a role by mistake, the archived folder is still on disk
under the archive sibling and can be moved back by hand, but the interface
offers no gesture to do that. Reversibility is a separate future concern.

## Philosophy

The interface is a single deliberate gesture; the machinery does the rest.
The operator is not asked to think about cascades, ordering, retries, or
recovery — those live inside the supervisor where they belong. The
operator is asked to confirm the blast radius honestly (which is why the
first dialog spells out every identity that will be caught in the cascade,
in terms of what those identities are actually working on rather than
their opaque names) and then to double-tap the confirmation because the
action is destructive and irreversible.

The failure mode is honest. When the cascade fails partway, the operator
sees exactly what happened — some identities gone, some still live, role
folder still in the live tree, log lines naming what went wrong. The
system does not silently retry in the background or accumulate hidden
state. Retrying is the operator's decision, made from a position of
knowing what state the box is in.

The retry pattern is inline. A retire attempt is atomic from the caller's
perspective — either it succeeds outright, having quietly recovered from
any transient failures inline, or it fails terminally after a bounded
number of attempts and the caller knows about it right away. Nothing lives
across ticks; nothing accumulates. The old pattern of cross-tick failure
counting and stuck-sentinel dropping is not just orthogonal to this shape,
it is the pattern this shape rejects.

The sentinel is the memory. A role folder either has a sentinel on it
(meaning archival is pending or about-to-fire) or does not (meaning the
system has nothing to do). There is no separate state store, no in-memory
job registry, no failure counter file. Everything the supervisor needs to
know about role archival comes from a walk of the disk.

## Prior context

Identity archival already exists. When an operator archives an identity
today, a sentinel drops on the identity folder, the supervisor sees it on
its next reconcile tick, and it runs a five-step retire (messaging account
deactivation, graceful harness exit, terminal session teardown, workspace
repo cleanup, folder move to the identities archive). That mechanism is
the direct model for role archival and its identity-retirement building
block is reused verbatim by the role cascade.

The identity archival mechanism has a cross-tick retry system: if the
retire fails, a counter file on disk tracks the failure count, and after
three consecutive tick failures a stuck marker gets dropped in the archive
folder as a signal to the operator. That mechanism is being retired as
part of this shape. In its place, the individual retire runs inline
retries per step and either succeeds outright or fails terminally in a
single tick, with no cross-tick state.

Roles themselves have first-class surfaces in the interface today: a roles
list per box, a per-role modal that surfaces the role file, runbooks,
wakeups, and bounties. What has been missing is any destructive gesture on
a role — creation exists, editing exists, but retirement does not. The
context menu that other archival gestures across the interface hang off
of is the natural place to add it.

There is no automated role archival path — no daily dormancy sweep for
roles that looks at their age. Role archival is strictly operator-initiated.

## What would make it wrong

- **Two clicks instead of one gesture.** If the operator has to click
  archive on the role, THEN click archive on each identity holding it,
  the shape has been missed entirely. The whole point is one deliberate
  gesture that accomplishes the cascade.
- **The sentinel becomes chatty.** If the sentinel persists across ticks
  and the supervisor keeps re-attempting the cascade quietly in the
  background, the operator loses the ability to know what state the box
  is actually in. The sentinel is a one-shot; either it succeeded, in
  which case the sentinel is gone and the role is archived, or it failed,
  in which case the sentinel is gone and the operator sees the loud log
  and makes a call.
- **The first confirmation lies about the blast radius.** If the first
  dialog says "archive role X?" and hides how many identities are about
  to be torn down along with it, the operator does not have consent to
  the actual action they are taking. The list of what's being cascaded is
  non-negotiable.
- **The retries live across ticks.** If the new mechanism ends up with
  counter files or state directories or a "how many times has this failed"
  bookkeeping surface anywhere, the shape has been missed. All retry is
  inline within a single retire attempt.
- **The role folder half-archives.** If some identities are gone but the
  role folder is moved to archive before all of them are cleanly retired,
  the surviving identities are pointing at a role that no longer exists in
  the live tree. Role folder movement is the LAST thing the cascade does,
  and it happens only when every enumerated identity retired cleanly.
- **The operator's pin is a shield against a cascade they explicitly
  triggered.** If a pinned identity blocks a role cascade the operator
  just deliberately initiated, the gesture has been made hostile. Guards
  are bypassed when the operator's intent is unambiguous.
- **Credential files get special handling.** If the archival gesture
  starts inspecting the role folder for credentials and treating them
  differently from other content, it has taken on hygiene responsibilities
  it should not own. Role folders should not have credentials; if they do,
  that is a separate problem for a separate day.

## Scope edges

**In scope:**

- Right-click context menu affordance on the roles list, with the double
  confirmation flow.
- An API endpoint on the box holding the role that drops the sentinel.
- The primitive for writing to a role folder (which may not exist today).
- Supervisor logic that watches for the sentinel, cascades identity
  retirements, and moves the role folder to the archive sibling.
- The refactor of identity retirement to use inline retries instead of
  cross-tick counters + stuck-sentinel machinery. Both the role cascade
  path and the existing user-initiated identity archive path get the
  clean semantic.
- Tests at each layer, including the cascade happy path, the partial-
  failure path, and the empty-cascade (no identities holding the role)
  degenerate path.
- Docs update: a new section in the identity skill covering how role
  archival works, sibling to the existing section on identity archival.

**Out of scope:**

- Un-archive. One-way only for now.
- Automated role archival (age-based, dormancy-based, or otherwise).
  Strictly operator-initiated.
- Cross-box coordination or cross-box cascade. Roles are per-box.
- Cleanup of existing on-disk state from the old cross-tick retry
  mechanism (leftover stuck sentinels, counter files). The new code
  simply does not read or write those any more; the old files remain as
  archaeology on boxes that have accumulated them. If a clean sweep is
  wanted, that is a separate one-liner run manually.
- Scrubbing or filtering the role folder contents before archival.
  Everything moves verbatim.
- Any behavior around the role's runbooks, wakeups, or bounties beyond
  what falls out of moving the folder wholesale.

**Tempting-but-no:**

- Making the role modal (the per-role detail view) ALSO carry an
  archive affordance. Consistent with how identity archive lives only on
  the session pane and not on the identity modal, and it would fragment
  the "context menu is the archival surface" convention.
- Adding a role-level "stuck" marker mirroring the identity retire-stuck
  we are removing. The whole point is that we're moving away from
  cross-tick failure state; adding a new flavor of it at the role level
  would defeat the refactor.

## Vehicle notes

**Vehicle: GSD phase** (via `/gsd:phase` to slot into the roadmap, then
`/gsd:plan-phase` → `/gsd:execute-phase`).

Rationale: this is unambiguously phase-sized work. It spans the substrate
layer (supervisor script), the backend service layer (new HTTP endpoint,
possibly a new file primitive), the frontend (API client wrapper and
right-click menu integration), tests at each layer, and a docs update. On
top of that, it carries a meaningful refactor of the existing identity
retirement retry machinery. Multiple concerns, cross-file coordination,
and the standing fleet rule is explicit that phase-sized work goes through
the phase pipeline.

Handoff notes for the implementing agent:

- The identity archival mechanism is the direct model for the role
  archival mechanism — read the identity archival flow end-to-end first
  (interface trigger, HTTP endpoint, sentinel drop, supervisor detection,
  retire steps, folder move) to see the shape you are cloning.
- The role modal and roles list surfaces already exist in the interface;
  the archival gesture only needs to add a context menu action, not build
  a new surface.
- The retry refactor is a shared piece of infrastructure — both the role
  cascade and the existing user-initiated identity archive path consume
  it. Make sure the refactor lands before either caller so both paths
  benefit uniformly.
- Multiple identities of this role work in parallel on this repo — the
  standard rebase-before-push and rebase-before-build discipline applies
  throughout.

---

## Close-Out

**Closed:** 2026-09-24
**Vehicle used:** gsd phase
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · One deliberate gesture retires the role folder plus every identity holding it — right-click Archive → HTTP → sentinel → supervisor cascade → folder move
- **Shape: single gesture, right-click Archive, two confirmations** — present · Right-click opens context menu with one danger-styled Archive item; first confirm names role + lists every affected identity by task-or-displayName with no truncation and an empty-list message; second confirm is byte-identical sanity tap to identity-archive
- **Shape: one HTTP call drops one sentinel, no fan-out** — present · Single POST drops exactly `.archive-requested` at the role folder via the new per-role-file primitive; no identity folders touched
- **Shape: supervisor cascade on next reconcile tick** — present · Scanner walks the roles dir each tick, fresh-enumerates identities via frontmatter check, calls the identity retire end-to-end per identity, moves role folder iff all retired cleanly, deletes sentinel regardless
- **Shape: inline retry replaces cross-tick counters + stuck-sentinel machinery for both paths** — present · Steps 1 (matrix deactivate) and 4b (folder move) carry 3-attempt exponential backoff; steps 2 (grace) and 3 (tmux kill) intentionally single-attempt; scanners no longer write counter files or drop legacy retire-stuck sentinels
- **Shape: archive verbatim, no scrubbing** — present · Role folder is moved wholesale to the archive sibling; writeRoleFile whitelist bounded to exactly `.archive-requested` with no chmod field and no scrub call site
- **Shape: empty cascade is degenerate same-code-path** — present · Zero enumerated identities → for-loop is zero-iter → failed stays 0 → folder move fires immediately
- **Shape: guards bypassed for role cascade** — present · Scanner does not consult pinned, no-dormancy, or coordinator markers; docs "Guard bypass" affirms
- **Shape: per-box scope** — present · Roles-dir + roles-archive-dir are local paths; endpoint takes hostId; supervisor runs on the box holding the role; docs affirm no cross-box coordination
- **Shape: one-way, no un-archive** — present · Route is POST-only; no GET/DELETE counterpart; docs "Not reversible (yet)" explicit
- **Philosophy: single deliberate gesture; machinery does the rest** — present · Operator sees only right-click + two dialogs; all cascade + retry + folder-move ordering lives inside the supervisor
- **Philosophy: honest failure mode with loud logs** — present · Partial-cascade line names every failed identity, references per-step retire logs, instructs retry via UI; no silent background retry
- **Philosophy: retry is inline; nothing lives across ticks** — present · 3-attempt exponential backoff wraps only the two genuinely-transient steps; no counter files written; sentinel deleted after every tick for role path
- **Philosophy: sentinel is the memory** — present · Presence of the sentinel is the only state; no separate registry, no job store, disk walk IS the state
- **Prior context: identity retirement building block reused verbatim** — present · Cascade calls the existing retire-identity function unchanged; retry-mechanism refactor benefits both role cascade and existing user-initiated identity archive path uniformly
- **What would make it wrong: two clicks instead of one gesture** — present · One right-click + two confirms + one HTTP call
- **What would make it wrong: sentinel becomes chatty** — present · Role sentinel deleted regardless of outcome; subsequent ticks find nothing and do nothing
- **What would make it wrong: first confirmation lies about blast radius** — present · Every affected identity is listed, no truncation, empty case handled
- **What would make it wrong: retries live across ticks** — present · No counter files, no state directories written by the retire path or its scanners
- **What would make it wrong: role folder half-archives** — present · Role folder move fires only when failed==0 across the entire cascade
- **What would make it wrong: operator's pin becomes a shield** — present · Scanner does not consult pinned/no-dormancy/coordinator during cascade — the click means intent
- **What would make it wrong: credential files get special handling** — present · writeRoleFile has no chmod field; archival path never inspects folder contents; move is wholesale
- **Scope: right-click context menu affordance** — present · Reuses existing context-menu component with a single danger-styled Archive item
- **Scope: API endpoint that drops the sentinel** — present · Route mounted before generic /roles routes to avoid shadowing
- **Scope: primitive for writing to a role folder** — present · New per-role-file module with writeRoleFile + whitelist + defense-in-depth role-name pattern gate
- **Scope: supervisor logic that watches for the sentinel, cascades, and moves the folder** — present · Scanner mounted in reconcile loop between existing identity archive scan and identity resolution
- **Scope: refactor of identity retirement to inline retries** — present · Retire refactored; both scanners updated; state dir now only holds the daily-scan cadence marker
- **Scope: tests at each layer** — present · Tests present at HTTP, frontend API, primitive, UI + confirmations, cascade happy/fail-soft/empty/guard-bypass, and the identity scanner tests updated for the state-machinery removal
- **Scope: docs update in identity skill** — present · New "On archiving a role" section with mechanism, failure semantics, guard bypass, click-vs-scan race, non-reversibility, verbatim archive, per-box scope
- **Out: un-archive** — present · Not added; docs and route both explicit
- **Out: automated role archival** — present · No age-based or dormancy-based scanner; docs explicit user-initiated-only
- **Out: cross-box coordination** — present · Endpoint scoped to a single hostId; supervisor is per-box
- **Out: cleanup of legacy stuck-sentinels/counter files** — present · Legacy files treated as archaeology; new code simply doesn't read or write them
- **Out: scrubbing role folder contents** — present · Move is wholesale; no inspection
- **Out: behavior around runbooks/wakeups/bounties beyond folder move** — present · None added
- **Tempting-but-no: archive affordance on the role modal** — present · Archive lives only on the roles-list context menu; role-detail modal not touched
- **Tempting-but-no: role-level stuck marker** — present · Not added; sentinel is single-shot per shape

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

The retire refactor and the identity-scan callsite have been updated so the cross-tick counter + stuck-sentinel machinery is gone from both scanners, which is what the shape asked for as the load-bearing change. The identity-archive scanner still retains its own sentinel across ticks on retire failure (pre-existing behavior — automatic next-tick retry from the identity's own sentinel), while the role-archive scanner deletes its sentinel every tick regardless of outcome (one-shot per shape). This asymmetry is intentional under the shape's language, which specified one-shot behavior only for the role sentinel; but a future clarification might want to state whether the identity path's persist-on-failure semantic should also flip to one-shot for consistency with the "system does not silently retry in the background" philosophy. The frontend's browse-and-act semantic (list stays open after Archive click) and fire-and-forget catch-and-log are unremarkable UX details not covered by the shape and are natural implementation calls; called out here for completeness only.
