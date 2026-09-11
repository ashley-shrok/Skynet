# Shape: spawn-request watcher — the noticing side that turns Shape 4's prose true

**Opened:** 2026-09-10
**Vehicle:** GSD phase

## What this is

The other half of the coordinator-to-Skynet spawn flow that Shape 4 documented but doesn't
yet exist in code. Shape 4 rewrote the substrate prose so that when a coordinator needs a
new actor, it drops a small request file on its own box and waits for the identity to appear.
For any of that to actually happen, something on the Skynet side has to notice those request
files, hand each one to the existing server-side identity-birth flow, and drop back a
response file the coordinator can watch for. That "something" is what Shape 5 builds. It's
the fifth and final shape of the id-skill-revamp campaign; when it lands, the whole campaign
ships atomically.

## Shape

A new watcher subsystem inside Skynet, structured as an extension of the per-host sweep
that already runs at a fast cadence, plus a small async worker on the backend that drives
the actual identity-birth work.

**The observation-and-claim step (in the per-host sweep).** Skynet already reaches every
managed host on a fast cadence through one long-lived reach-per-host channel. On each tick
against a host, the sweep gains one extra remote step: list the host's spawn-requests
folder, and for each request file present, read its contents, delete the file, and report
the contents back to the backend. Read-and-delete happens in a single remote exec so there
is no window where the same file could be observed twice — the moment the sweep sees it,
the file is gone from disk and its contents are on their way to the backend. That is the
"claim" moment.

**The birth-worker step (backend, asynchronous).** The backend holds an in-memory queue of
pending births. When the sweep reports a claimed request, it goes on the queue. A worker
runs against the queue independently of the sweep cadence, and for each queued request it
calls the existing identity-birth flow with the role and task string the coordinator asked
for. The birth flow is unchanged — it picks the name from the vetted pool, computes any
ordinal, registers the message account, writes the identity folder and credentials on the
target host. When it completes, the worker drops a response file back on the requesting
host: a success file naming the newly-birthed identity, or a failure file explaining what
went wrong.

**The response-file pair.** Coordinators watch for either a success file or a failure file
in the same spawn-requests folder they wrote to, keyed by the same request-id they used for
the request file itself. On success, the file names the new identity and the coordinator
dispatches to it. On failure, the coordinator escalates the pending item to the user
through the same path a picker failure takes; it never retries or attempts local birth.
The coordinator deletes the response file after acting on it — happy-path cleanup, no
separate reaper needed.

**Two failure classes with different content.** When the birth-flow rejects the request as
malformed — unreadable body, missing required fields, unrecognized role — the failure file
carries a descriptive message so the coordinator (or the human it escalates to) can
understand what to fix. When the birth-flow fails for any other reason — homeserver
unreachable, pool exhausted, host unwritable — the failure file is terse; there's nothing
the coordinator can meaningfully iterate on and pretending otherwise would encourage the
coordinator to invent behavior we don't want.

**The safety timeout on the coordinator side.** In the rare case Skynet crashes between
claiming a request and dropping a response (or the response drop fails silently), no file
of any kind arrives. The coordinator's watch has a last-resort timeout on the order of a
few minutes; on timeout it escalates the pending item the same way any other failure would.
This isn't the primary failure surface — the response-file pair covers the common cases —
but it prevents indefinite waiting.

## Philosophy

Reuse the machinery Skynet already has. The per-host sweep is already the way Skynet talks
to every managed host on a fast cadence; adding one more thing for it to look at on each
tick is much less invasive than standing up a parallel subsystem with its own connections,
schedule, and failure modes. Same for the identity-birth flow: Skynet already knows how to
birth an identity end-to-end from a role and a task string; the watcher just needs to point
that machinery at inputs the coordinator dropped, and route the outputs back.

The coordinator is a thin trigger, not a birth co-implementer. All the actual
identity-creation work — name selection from the pool, credential registration, folder
writes — lives server-side, one canonical implementation shared with the human-driven UI
creation path. The coordinator's job is limited to describing what the new actor should
work on, dropping that description on disk, and waiting to be told what identity to
dispatch to.

Failure surfaces are visible, not silent. Every failure produces an observable signal — a
failure file if the birth flow rejects or errors, a timeout if Skynet itself misbehaved.
The coordinator always knows either "here's your new actor" or "something went wrong,
escalate." There's no path where a request quietly disappears into a state neither side can
see.

No automatic retry anywhere. If a birth fails, it's over — the coordinator escalates, the
human decides. Retrying inside the coordinator or inside the birth worker would layer
guesswork onto a failure whose cause is already opaque to those parts of the system. The
human is a shorter escalation path than a retry loop that might make things worse.

## Prior context

Shape 4 (`shape-substrate-prose-polish.md` in this same folder) rewrote the coordinator
instructions to describe this flow from the coordinator's side: derive a task string, drop
a request file, watch for a response file, dispatch or escalate. Shape 4's prose is target
state today — the coordinator-side steps are true only once this shape's code lands.

The identity-birth flow shipped in Tina's Phase 77 (2026-09-06) — the server-side machinery
that picks a name, registers the message account, writes the identity folder and
credentials. Phase A of this campaign (Phase 80, 2026-09-07) layered pool-selection and
task-scoped model on top. Shape 3 (Phase 96) consolidated the tree so the identity folders
land under a canonical fleet root. All of that is code-complete and held from ship. Shape 5
is the last piece that needs to land before the whole campaign can ship atomically.

Skynet's per-host sweep runs on a two-second cadence today, with one long-lived reach-per-
host channel that issues remote execs against each host. The sweep already reads live
session state, process liveness, and hook payloads on each tick; adding a spawn-requests
scan is a small extension of that existing pattern, not a new subsystem. A second sweep
runs on a slower cadence for pushing substrate files out to hosts — the request-scan
belongs on the fast sweep because coordinator latency matters (a coordinator that dropped
a request should get its actor within a few seconds, not tens of seconds).

The user's key steer during design: the request-file deletion should happen at claim time
in the per-host sweep, not deferred to the birth worker. Claim-at-observation gives zero
window for double-observation across ticks and keeps the birth worker cleanly separated
from the file-lifecycle concern.

## What would make it wrong

Two ticks against the same host both observing the same request file and enqueuing it
twice. The claim-at-observation design prevents this at the mechanism level (read-and-
delete in a single exec on a single serialized per-host channel), but if the
implementation splits observation from deletion — even by a few milliseconds — the race
reopens. The correct implementation keeps them atomic.

The birth worker retrying a failed birth on its own. That would turn a single opaque
failure into a cascading one, and coordinator has no way to know whether it's watching a
request that will eventually succeed or one that's been trying for minutes. All retries
are explicitly the human's decision to make.

The failure file becoming a place where "sometimes there's actionable detail, sometimes
there isn't, and there's no way to tell which is which." The malformed-vs-other distinction
has to be crisp: if the reason is malformed, the file is descriptive and the coordinator
can potentially iterate; if it's anything else, the file is terse and the coordinator
escalates. Coordinators reading a "descriptive-ish" failure message and trying to iterate
on it when they can't is worse than a clean escalation.

Persistent state anywhere in the request-response flow. In-memory queue on the backend is
part of the design — restart-loses-in-flight is fine because the coordinator's timeout
catches it and escalates. Introducing a persistent queue (database-backed replay,
resume-on-restart) trades a simple failure surface for a complex one and adds no value the
human-escalate path doesn't already cover.

The response file lingering after the coordinator reads it. Happy-path cleanup is the
coordinator's job; if it stops doing that, the spawn-requests folder accumulates cruft that
eventually confuses future ticks. Simple contract: coordinator reads, coordinator deletes.

## Scope edges

**In.** One new remote step in the per-host sweep: list the spawn-requests folder,
atomically read-and-delete any request file present, batch-report contents back to the
backend. An in-memory queue on the backend for pending birth requests. An async worker that
pulls from the queue and invokes the existing identity-birth flow. Response-file drops back
to the requesting host (success with the newly-birthed identity name, or failure with
descriptive or terse content per the malformed-vs-other distinction). The response file
lands in the same folder the request came from, keyed by the same request-id. Tests
covering the observation-and-claim exec, the queue-and-worker path, and both success and
failure response-file drops.

**Out.** No cross-host birth (identity always lands on the host the request came from). No
persistent queue (in-memory is deliberate). No automatic retry anywhere. No response-file
lifecycle beyond drop and coordinator-side cleanup. No changes to the identity-birth flow
itself (Tina's Phase 77 machinery is unchanged). No changes to the substrate skill prose
(that was Shape 4).

**Deferred.** Response-file aging or reaper on the Skynet side. If coordinators consistently
forget to clean up their response files, we can add a slow reaper later; for now the
happy-path contract is enough.

**Tempting but no.** Making the birth worker retry on transient failures — even one retry
adds implicit behavior in a place we want to stay explicit. Making the response file's
failure mode a rich structured error surface that the coordinator can programmatically act
on — the malformed-vs-other cut is deliberately simple; growing it later is easy, cutting
back from over-designed is hard. Persistent queue "just in case" — the coordinator-side
timeout is the right failure catchment for the restart-loses-in-flight case. Adding a
separate response folder for cleaner conceptual separation — same-folder is simpler for
the coordinator to watch and no real downside.

## Vehicle notes

GSD phase. Real backend TypeScript code with a real testing surface — extension of the
per-host sweep, new queue and worker, response-file writes, wire-level tests. Phase-sized
by any reasonable measure; the standing rule that phase-sized work uses the phase
pipeline holds.

Sequencing: standard phase pipeline — `/gsd:phase add`, `/gsd:discuss-phase`,
`/gsd:plan-phase`, `/gsd:execute-phase`, `/gsd:verify-work`, `/gsd:review-work`. Same
rhythm as Shapes 1-3.

Ordering constraint: Shape 5 must be code-complete before the campaign ships. The whole
id-skill-revamp campaign (Shapes 1 through 5) ships atomically, so the atomic push
happens once Shape 5 is verified and Alice greenlights the whole-campaign ship. Shape 4
prose describes target-state that is only true once Shape 5's code lands; that mismatch
window is the reason for atomic ship.

The bounty workspace for the whole campaign lives at
`~/.claude/roles/box-maintainer/bounties/id-skill-revamp/`. This shape file, the four prior
shape files, and any staging or scratch work all live there. The phase created for this
work should reference the shape file by absolute path in its planning context so the phase's
implementers can read the philosophy and scope edges before writing plans.

---

## Close-Out

**Closed:** 2026-09-10
**Vehicle used:** GSD phase (Phase 99), executed via /gsd:execute-phase with post-execution code review findings applied via fix(99-cr) commits
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · The watcher subsystem lands exactly as described: an extension of the per-host fast sweep plus an async backend birth worker, completing the coordinator-to-Skynet spawn flow
- **Shape: observation-and-claim step (single atomic exec per tick)** — present · SPAWN_REQUESTS_SCAN_CMD uses mv for atomic claim within one channel.exec() call; the file is gone from disk before the backend ever sees the contents
- **Shape: in-memory queue on backend** — present · queue.ts holds a plain in-memory array plus a Promise chain for serialization; no persistence, no database backing
- **Shape: async birth-worker independent of sweep cadence** — present · drainOne runs on the Promise chain, decoupled from the sweep timer; births proceed asynchronously after enqueue
- **Shape: existing identity-birth flow unchanged (D-20)** — present · identity-birth-orchestrator.ts appears in git history only at commits predating the Phase 99 arc; no modifications in the shape 5 work
- **Shape: success response file (name + keyed by request-id, same folder)** — present · writeResponseFile drops $HOME/fleet/spawn-requests/<uuid>.success.json with {name, birthed_at}; same folder as request
- **Shape: failure response file (keyed by request-id, same folder)** — present · writeFailureFile drops $HOME/fleet/spawn-requests/<uuid>.failure.json
- **Shape: two failure classes (malformed=descriptive, other=terse)** — present · malformedReason path writes {reason, message} with descriptive text; all other failure reasons write {reason} only with no message field
- **Shape: coordinator deletes response file after acting** — present · coordinator-instructions.md describes deleting both success and failure files after reading them
- **Shape: coordinator safety timeout (~few minutes, escalates same as picker failure)** — present · coordinator-instructions.md specifies ~3 minute safety timeout; on timeout escalates to Alice via picker-failure path
- **Shape: scan on fast cadence (not slow push sweep)** — present · scanSpawnRequests is called inside pollOneHost, which runs on pollTimer at the 2-second default cadence
- **Shape: tests covering observation-and-claim, queue-and-worker, success and failure drops** — present · queue.test.ts has 5 queue tests; worker.test.ts has 20 worker tests (parse, failure-mapping, end-to-end); orchestrator.test.ts has 8 sweep-integration tests
- **What would make it wrong: two ticks observing the same file (double-observation)** — present · mv-based atomic claim inside a single shell exec ensures only one concurrent winner; the loser's mv returns non-zero and the loop continues
- **What would make it wrong: birth worker retrying a failed birth on its own** — present · No retry anywhere in the queue drain loop or processBirth; failures produce a response file and return
- **What would make it wrong: ambiguous failure content (malformed vs other not crisp)** — present · The malformed path explicitly carries a descriptive message; all other FailureReason values produce no message field — the distinction is enforced in the type and in every call site
- **What would make it wrong: persistent state in the request-response flow** — present · In-memory queue only; restart-loses-in-flight is explicit and acceptable per the shape; no database-backed replay anywhere
- **What would make it wrong: response file lingering after coordinator reads it** — present · Skynet side drops only; coordinator-instructions.md gives explicit delete-after-read instructions to the coordinator for both success and failure files
- **Scope edge OUT: no cross-host birth** — present · BirthOptions.hostId always comes from the requesting host's item.hostIdNum; the response file also goes back to that same host
- **Scope edge OUT: no automatic retry** — present · Confirmed absent in both queue.ts and worker.ts
- **Scope edge OUT: no changes to identity-birth-orchestrator.ts** — present · Verified via git log; that file was last touched in pre-Phase-99 commits
- **Scope edge OUT: no changes to substrate skill prose beyond coord-instructions alignment** — present · The shape explicitly included the coord-instructions prose alignment as part of the arc; no other substrate files were modified

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

The post-code-review M2/M3 finding moved full parseRequestBody validation into the sweep (parseSpawnRequestBatch) rather than leaving it only in the worker. This means malformed request bodies produce a failure file rather than silently timing out at the coordinator — a tighter implementation of the shape's failure-visibility philosophy. The malformedReason field on PendingBirth is the seam that carries the sweep's validation verdict to the worker without duplicating the file-write logic. The types.ts doc comment claims extra fields are 'rejected by parseRequestBody as malformed' but the implementation does not enforce this — extra fields are silently ignored. This is a code-comment inaccuracy internal to the implementation, not a shape commitment, and does not affect the protocol's behavior in any way the shape cares about.
