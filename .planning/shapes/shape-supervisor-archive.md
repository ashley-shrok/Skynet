# Shape: supervisor archive extension (Shape 2 of the id-skill-revamp campaign)

**Opened:** 2026-09-09
**Vehicle:** gsd phase

## What this is

The mechanism that automatically retires identities that have been dormant for a very long time. Each host runs a small supervisor that keeps its identities' sessions alive as work comes in. This shape gives that supervisor a second job: notice when an identity has been genuinely unused for 180 days, and take it off the board — quietly, without ceremony.

## Shape

The supervisor already walks its identities on every reconcile tick. On a daily cadence, it does an additional pass: for each identity on the box, decide whether it should be retired now.

The decision has three guard gates. Any one of them being set means "keep this identity, skip." The guards are: the pin sentinel (dropped by the human via the pin action in the fleet chat surface, migrated to disk in Shape 1 of this campaign), the no-dormancy sentinel (dropped by the human to opt an identity out of the fleet's dormancy sweep), and the coordinator marker in the identity's own metadata file (identifying it as its role's routing infrastructure rather than a task-scoped worker).

If all three guards are clear, the supervisor reads the freshness signal: the modification time of the identity's relay receiver cursor. Every time the receiver polls the homeserver — every ~30 seconds while any session for that identity is up — the cursor file gets rewritten with a fresh token, so its modification time is a reliable proxy for "any session for this identity has been active recently." If the cursor file does not exist yet (brand-new identity that has never woken), the mechanism falls back to the identity folder's own modification time as a sensible substitute.

If the freshness signal is older than 180 days, the identity is retired.

The retire action is three steps, deliberately ordered:

1. **Move the identity's folder** from the active tree to an archive sibling. This is the first step because the supervisor's own keep-alive logic reads the active tree; once the folder is out, no new sessions for this identity can spin up regardless of what else happens.
2. **Kill any tmux session** for the identity. If nothing was running, this is a no-op. If a session was live, it goes down cleanly. Either way, no live process is holding the identity anymore.
3. **Deactivate the matrix account** using the identity's own credentials — reads the relay credentials from the (now archived) folder and calls the homeserver's account-deactivate endpoint. No admin credentials required anywhere.

Any step failing aborts the whole retire and the mechanism tries again on the next daily pass. Because move-first ordering means each retry starts from the same place regardless of where the previous attempt failed, retries are safe. If the same identity fails to complete retire three consecutive days in a row, the supervisor drops a retire-stuck sentinel in the identity's archived folder and logs loudly, so the stuck state is grep-able and not silently forever-invisible.

Skynet's periodic per-host identity refresh sees the identity is no longer in the active tree on its next scan and naturally drops it from the conversation list. No push notification wire, no cross-service coordination.

The retirement itself makes no announcement. There is no entry in the role's history log, no DM to the coordinator, no ping to the human. The move-plus-kill-plus-deactivate IS the whole event; discovery is by observation (the identity is no longer in the conversation list) or by looking at the archive folder. Under the task-scoped paradigm, retirement is meant to feel unremarkable.

## Philosophy

Retirement is a **local decision** made by the host that owns the identity. Nothing cross-fleet, nothing centralized. Each host already knows its own identities and their heartbeats; it can make the retire decision on its own.

Retirement is **self-executed**. The identity's own credentials — never an admin credential — deactivate its own matrix account. This preserves the fleet-wide property that no box in the fleet holds a homeserver admin key. The one exception (the admin key used for identity creation at birth-time on the central instance) lives in an entirely separate part of the design and does not participate here.

**Sentinels are the interface.** The supervisor never needs to call across a network boundary to answer "should I retire this." Everything it reads is on the local disk: pin sentinel, no-dormancy sentinel, the coordinator marker in the identity metadata file, and the cursor modification time on a local file. This mirrors the pattern Shape 1 of the campaign established when it moved pin state from a database to a disk sentinel.

Retirement is **silent by design**. Under the task-scoped model where identities are meant to be disposable workers, a routine retirement is not a fleet event worth announcing. Only unusual retirements — the ones that get stuck across multiple daily passes — warrant loud visibility, via the retire-stuck sentinel.

Coordinators are **exempt** because they are infrastructure for their role, not task-scoped workers. Retiring a coordinator is a change to the role's operating model, and that decision belongs to the human, not to a 180-day timer. The exemption lives as a natural consequence of the guard check reading the coordinator marker in the identity metadata file — no special-case code, just one more sentinel-shaped guard alongside pin and no-dormancy.

The signal we chose — cursor modification time — is **trusted as-is**. It is a clean proxy on the current fleet: the cursor lives in the identity folder, nothing else writes to it, it is not on a container volume, it is not separately backed up. Exceptional filesystem operations that could reset modification times en masse (the manual per-box folder migration coming in Shape 3, a backup restore, a filesystem move) are the maintainer's problem to sequence around, not a defensive complexity to bake into the mechanism.

## Prior context

This is Shape 2 of the id-skill-revamp campaign. Shape 1 (pin sentinel migration — moving pin state from the Skynet database to a disk sentinel in the identity folder) is code-complete at head, held from ship until the whole campaign lands. Shape 2 is a hard dependency downstream of Shape 1: the retire mechanism's pin-state guard reads the sentinel that Shape 1 puts on disk. Shape 2 cannot ship until Shape 1 ships (which cannot ship until the whole campaign lands — same ship gate).

The relay receiver's cursor file behavior is the load-bearing mechanical fact this shape rides on. Every successful sync (~30 seconds) rewrites the cursor file with a fresh next-batch token, so its modification time advances anytime any session for the identity is up, not only when inbound messages arrive. Verified against the shipped receiver source: the cursor write is unconditional after the empty-response guard passes, regardless of whether the sync returned any events.

The homeserver's account-deactivation semantics were verified against a live instance by another maintainer during the campaign shape's development. The identity's own access token plus password successfully self-deactivates and produces post-state identical to the admin-side deactivate path. The username stays permanently reserved after deactivation (the homeserver software doesn't allow undelete) but the vetted pool name can be reused for a new registration under an ordinal suffix — that pool-and-ordinal logic lives in Skynet's identity creation flow, separately from this shape.

Un-archive is explicitly out of scope for this shape. If a retirement is later determined to have been in error, the folder move is trivially reversible (move it back), but the matrix account is permanently gone. Formalizing the un-archive path is a later concept, not this shape.

The supervisor currently ticks every ~5 seconds, reconciling live tmux sessions against the identity list. Adding a daily archive-scan branch to the same script is minimal shell code. The supervisor is distributed to every managed box via Skynet's fleet-substrate distributor — so shipping this change lands on every box automatically on the distributor's next sweep.

## What would make it wrong

- **Retiring a pinned identity.** The pin sentinel is the human's primary affordance for "keep this alive." The guard silently missing it (or reading a stale copy of the disk state) defeats the whole affordance.
- **Retiring a coordinator.** Coordinators are structural infrastructure for their role; retiring one is a role-model change that belongs to the human, not to a timer.
- **Retiring an identity whose signal is genuinely fresh but whose cursor got weird for a non-dormancy reason.** For example, if a bug in the mtime read path treated a valid recent write as stale, or if the cursor file were deleted by unrelated maintenance while the identity is still active — the mechanism should be robust to reading the actual signal, not just to setting the right threshold.
- **The retire action stopping between steps and leaving inconsistent state.** A dead matrix account with the folder still in the active tree (agent-supervisor thrashing to keep a dead identity alive) is worse than either alone. The move-first ordering plus retry-from-top exists specifically to prevent this shape of failure.
- **The retirement being announced in any way.** Under the task-scoped model, routine retirements are meant to be unremarkable. Any deliberate notification wire would push in exactly the wrong direction and reintroduce the ceremony this shape is trying to remove.
- **Guarding against filesystem operations that reset modification times en masse.** Baking defenses into the mechanism against problems the current fleet does not have (backup restores that lose mtimes, cross-filesystem moves without preserve, etc.) adds surface for a threat that hasn't happened. Those are the maintainer's responsibility to sequence around when the special event actually occurs.

## Scope edges

- **In:** the daily archive-scan branch inside the per-host supervisor, the three guards (pin sentinel, no-dormancy sentinel, coordinator marker in identity metadata), the cursor modification time read with folder mtime as fallback, the three-step retire action with move-first ordering, retry-from-top on any step failure, the retire-stuck sentinel dropped after three consecutive failed daily passes.
- **Out:** any un-archive mechanism. Any user-facing archive UI in Skynet. Any deliberate notification wire (DM, history log entry, coordinator ping) for retirement. Any admin-credential path for the deactivation. Any cross-box coordination for retirement. Any defensive guards against filesystem operations that reset modification times.
- **Deferred:** un-archive as a formal concept, whenever it becomes needed.
- **Tempting but no:** heuristics beyond cursor modification time for the freshness signal (secondary file checks, content-based heartbeats, multi-signal composite). The signal is clean on the current fleet; adding defensive complexity for problems that haven't happened just increases surface. Also tempting but no: a shorter, more aggressive threshold for coord-spawned identities on the theory that task-scoped actors "should" retire faster than persistent-being ones. The uniform 180-day threshold treats all identities the same and lets the pin and no-dormancy affordances do the "keep this alive" work explicitly.

## Vehicle notes

Full GSD phase, same treatment as Shape 1. Held from ship until the whole id-skill-revamp campaign lands, per the campaign ship gate. Depends on Shape 1's pin sentinel being on-disk (already code-complete at head).

The work touches the per-host supervisor script that lives in the fleet-substrate distribution path — a load-bearing fleet-wide file that lands on every managed box on the distributor's next sweep. Requires the standard phase discipline: spec, discuss, plan with checker rounds, execute with the wave protocol, verify. No worktree isolation (fleet rule).

Phase-number-slot note: Shape 1 sits at slot 92, colliding with two other maintainers' phases (Tina's fleet-status batch sweep, since shipped, and Taylor's relay-rooms chat refactor, rescue-renumbered to 93). Shape 2 should slot into the next free number when its phase entry is created (94 or later, depending on what other work has landed by then).

Campaign hub for cross-shape context: the id-skill-revamp bounty in the box-maintainer role's shared bounty pool. The campaign-level shape file (shape-id-skill-revamp.md) lives alongside the bounty record and provides the broader framing that this shape is one piece of.
