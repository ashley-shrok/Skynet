# Phase 99: spawn-request-watcher — Skynet-side noticing of coord-dropped request files (Shape 5, final, of id-skill-revamp campaign) — Context

**Gathered:** 2026-09-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend Skynet with the ability to notice a small request file that a coordinator has dropped on one of the boxes it manages, run the existing server-side identity-birth flow (Tina's Phase 77 orchestrator) with the request's role + task string, and drop back a paired response file the coordinator can watch for. The request-file protocol was documented from the coordinator's side in Shape 4's prose commits (`ae3ca224`, `c84ed41f`, `57182a28`); this phase implements the Skynet side that makes that prose true. When it lands, the whole four-shape id-skill-revamp campaign ships atomically.

The observation happens as a small extension of the fleet-status per-host sweep that already reaches every managed box on a two-second tick through one long-lived reach-per-host channel. On each tick, the sweep gains one extra remote step: enumerate any request files under `~/fleet/spawn-requests/`, read their contents, delete them (single atomic exec — zero double-observation window), and report the batched contents back to Skynet's backend. The backend holds an in-memory queue of pending births; an async worker drains it by invoking the existing identity-birth orchestrator with the coord-provided role + task. On completion the worker drops a success or failure response file back on the requesting host, keyed by the same request-id the coordinator used.

Shape 5 of 5 in the id-skill-revamp campaign. Depends on Shape 3 (Phase 96) for the `~/fleet/` tree layout the request-file paths live under, and Shape 4 (prose commits `ae3ca224`/`c84ed41f`/`57182a28`) for the coordinator-side description of the flow. Both are code-complete and held from ship; this phase is the last remaining piece before atomic-ship of the whole campaign.

</domain>

<decisions>
## Implementation Decisions

### Observation-and-claim (fleet-status sweep extension)
- **D-01:** Piggyback on the existing fleet-status per-host sweep, not a new subsystem. `src/backend/fleet-status/ssh-poll-orchestrator.ts` already maintains one long-lived reach-per-host channel and issues execs on a two-second tick against each host — the natural home for the request-file scan. No new SSH plumbing, no parallel poller subsystem, no independent cadence to reason about.
- **D-02:** **Single atomic read-and-delete exec per tick per host.** In one remote exec, the sweep lists `~/fleet/spawn-requests/`, reads each file present, deletes it, and returns the batched contents. Deletion happens at observation time — this is the claim moment. Zero window between "observed" and "claimed" means a subsequent tick can never see the same file twice. Alice 2026-09-10 verbatim: *"the deletion should happen on the fleet status tick so that it goes away right away and can't accidentally be picked up by the next one."*
- **D-03:** **Missing folder is not an error.** If `~/fleet/spawn-requests/` doesn't exist on a host (fresh box, coordinator has never run), the exec returns empty batched contents. No mkdir, no warn-log, no failure — coordinator is responsible for creating the folder on its first request drop (already in Shape 4's coord-instructions prose).

### Request file schema
- **D-04:** Request file contents: `{role, task, requested_at}` in JSON. `role` and `task` are the two functional inputs the birth-orchestrator needs. `requested_at` is an ISO-Z timestamp for debugging stuck requests (Skynet logs can show elapsed time from drop to pickup without guessing from filename mtime). The request-id is in the filename (`<uuid>.json`), NOT the file body — filename IS the primary key. Coord derives the uuid via any standard UUID generator.
- **D-05:** Explicitly NOT in the request schema: `coord_mxid` (over-attribution — the host itself already identifies the coord's realm since coord drops on its own box), any target-host field (coord always drops on its own box, identity always lands on same box — cross-host birth is out of scope), any priority / ordinal / retry-count / etc.

### Backend queue + birth-worker
- **D-06:** **In-memory queue on the backend.** No persistent queue, no database backing, no replay-on-restart. Coord's safety timeout catches the rare Skynet-crashed-mid-birth case — same escalation path as any failure. Alice 2026-09-10 accepted this as the tradeoff — persistent adds real complexity (schema, replay logic, partial-processing tracking) for a case coord-timeout-escalate already handles cleanly.
- **D-07:** **Birth-worker concurrency = 1 (serialized).** Coord-triggered spawns are rare in steady state (only fires on picker `no_fit`). Birth work is Synapse admin API + SFTP writes — I/O-bound, not CPU-bound; parallelism doesn't buy latency. Serialized keeps error diagnostics simple (one birth at a time, one thing that can go wrong). A burst of 3-5 pending requests drains sequentially over ~15-25 seconds, well inside the coord-side minute-scale safety timeout. Upgrade path if we ever see queue backup as a real problem: bumped to bounded-N is a small change.
- **D-08:** Queue holds pending request objects; each object carries the parsed request contents (`{role, task, requested_at}`) plus the metadata Skynet needs to route the birth: the source host id (which host the fleet-status sweep read the file from — trivially known since the sweep is per-host), the source uuid (from the filename — trivially known since the sweep captures filenames alongside contents), and the derived owner-userId per D-14.

### Response file schemas
- **D-09:** Success response file at `~/fleet/spawn-requests/<uuid>.success.json` — same folder as the request, same uuid. Contents: `{name, mxid, birthed_at}`. `name` is what coord dispatches on. `mxid` (fully-qualified `@<localpart>:<homeserver>`) saves coord one directory-search lookup on the happy path. `birthed_at` is an ISO-Z audit-trail timestamp.
- **D-10:** Failure response file at `~/fleet/spawn-requests/<uuid>.failure.json` — same folder, same uuid. Contents: `{reason, message?}`. `reason` is a small closed enum: `malformed`, `role_unknown`, `birth_failed`, `homeserver_unreachable`, and any other classes the birth-orchestrator distinguishes internally (the planner enumerates the concrete list from the orchestrator's actual failure modes; the shape is the enum + optional message). `message` is PRESENT and descriptive when `reason == "malformed"` (coord may potentially iterate — Shape 4 prose covers this branch). `message` is ABSENT or short-terse for every other reason (coord escalates opaquely; there's nothing actionable in a rich message for those cases).
- **D-11:** Response file lives in the SAME folder the request was written to (`~/fleet/spawn-requests/`). Coord watches ONE folder for either file matching its uuid. Alice 2026-09-10 accepted same-folder over separate-response-folder as the simpler contract.
- **D-12:** Response file write happens over the same SSH channel the fleet-status sweep uses (or via SFTP from the birth-worker; planner decides based on what's cheaper). The response file is small; the write is not on the critical path of the sweep tick.
- **D-13 [informational]:** Response file cleanup is the COORDINATOR's job on the happy path (coord reads, coord deletes). Skynet does NOT auto-reap orphaned response files. If coordinators consistently forget to clean up, the folder accumulates cruft — deferred as a future problem worth its own bounty at that time; not this phase. **Coord-side behavior only — no Skynet-side must_have.**

### Ownership attribution
- **D-14:** The `userId` argument passed to the birth-orchestrator is the **owner-userId of the host the request came from** — looked up via Skynet's existing host-record scope (the same lookup the frontend does when it resolves `hostId` to its owner). Rationale: identities themselves have no DB record (Phase 69 killed the identity table), so there's no "identity ownership" per se — the question is purely about which userId's slice of Skynet-side state the birth-orchestrator call operates against (SSH credentials for the target host, avatar-candidate scope, etc.). On single-user boxes (t1000, only Alice) this routes everything to Alice's userId — moot in practice. On multi-user boxes (T800, Stacy + potentially others), Stacy's coord births under Stacy's userId; if a hypothetical additional user has their own coord on T800, their births route under their userId. Natural multi-user isolation boundary matching the rest of Skynet's model. No dedicated "system userId" — that would open messy questions about who can see/delete/manage system-owned artifacts.

### Failure semantics + safety timeout
- **D-15:** **No automatic retry anywhere.** If a birth fails, it's over. The failure file drops (per D-10), coord escalates through its usual picker-failure path, human decides what to do. Retrying inside the birth-worker or inside the coord layers implicit behavior on top of an opaque failure — makes state harder to reason about and can make problems worse. The human is a shorter and cleaner escalation path than a retry loop.
- **D-16 [informational]:** **Coord-side safety timeout for the rare Skynet-crashed-mid-birth case.** After the fleet-status sweep claims a request (deletes it) but before the birth-worker drops a response file, Skynet might crash — the request is gone, no response file will ever appear, coord watches forever. The coord-side safety timeout catches this. Planner picks a concrete value; range on the order of a few minutes (long enough that a normal birth completes well inside; short enough that a broken Skynet is visible to coord). Timeout escalates the same way any failure would (picker-failure path). **Coord-side behavior only — no Skynet-side must_have. Concrete value picked in coord-instructions.md prose (Shape 4) at 3 minutes per research recommendation.**

### Code change surface
- **D-17:** Extension to `src/backend/fleet-status/ssh-poll-orchestrator.ts`. Adds the atomic-read-and-delete step per tick, parses the batched contents, hands each parsed request to the backend's spawn-request queue. Existing sweep behavior (session state, PID liveness, hook payloads) is unchanged — this is one additional exec per tick alongside what already runs.
- **D-18:** New in-memory queue + worker module (planner names the file; conceptually `src/backend/spawn-requests/queue.ts` + `src/backend/spawn-requests/worker.ts` or a single combined module). The worker imports and calls the existing `runIdentityBirthOrchestrator` from `src/backend/database/routes/identity-birth-orchestrator.ts`.
- **D-19:** Wire-level types: shared types for the request-file body (`{role, task, requested_at}`), the success response (`{name, mxid, birthed_at}`), and the failure response (`{reason, message?}`). These types are internal-to-backend for now (no frontend consumer); they may become shared frontend/backend types in a future phase if a UI ever surfaces spawn-request state.
- **D-20:** No changes to `src/backend/database/routes/identity-birth-orchestrator.ts` itself — the orchestrator's public interface (`runIdentityBirthOrchestrator(options: BirthOptions, deps: BirthDeps): Promise<...>`) is unchanged; this phase just adds a new caller of it. Any updates to how the orchestrator handles missing/absent cosmetic-field arguments (title, colorHue, voice, avatar — all now role-inherited per Phase 86) are OUT of scope — the caller passes them through however the frontend passes them today when it doesn't have them.

### Test surface
- **D-21:** New unit tests for the request-file body parser (validates schema, handles malformed JSON, missing fields, extra fields). Tests for the queue module (enqueue, dequeue, empty-queue behavior, restart-clears-in-flight semantic verification). Tests for the birth-worker (invokes orchestrator with correct arguments derived from the request + host owner-userId lookup; drops correctly-shaped success and failure response files; handles orchestrator success + failure cases). Integration test for the fleet-status sweep's atomic-read-and-delete exec (mocked SSH channel).
- **D-22:** End-to-end wire test: coordinator drops a request file (mocked), fleet-status sweep tick reads-and-deletes, backend enqueues, worker births (mocked orchestrator success), response file drops back to the requesting host at the correct path with the correct schema. Explicitly not a full birth-orchestrator integration — that's Phase 77's own test suite. This test validates the wire from fleet-status → queue → worker → response file, not the birth mechanics themselves.

### Ship coordination
- **D-23:** All changes in this phase ship as part of the atomic id-skill-revamp campaign ship. Held from ship until Alice greenlights the whole campaign (Shapes 1, 2, 3, 4, 5 land together). Push is NOT authorized as part of phase execution; deploy motion is orchestrator-owned per fleet rule.

### Claude's Discretion (implementation-level, planner decides)
- Exact number of plans and wave breakdown. Given the phase has three natural work surfaces (fleet-status extension, queue + worker module, response-file drop), a 3-plan-in-2-waves layout is reasonable (queue + worker in Wave 1 as independent modules, fleet-status extension + response-drop in Wave 2 with the queue as a dependency); planner may split differently based on file overlap and test-surface coupling.
- Precise concrete value for the coord-side safety timeout (D-16 range: "a few minutes"). Range is set; a specific number gets picked based on measured birth-orchestrator latency during planning research.
- Exact concrete list of failure `reason` enum values (D-10). The planner enumerates the orchestrator's actual failure modes and picks the enum shape.
- The atomic read-and-delete exec's shell (D-02). Multiple ways to structure it (find + xargs, a small inline script embedded in the exec, etc.); planner picks the one that's shell-portable and fastest to write. Correctness requirement: the read and delete must be atomic per file (a partial read followed by a delete-that-succeeded-anyway would strand a birth request).
- Whether the queue module is its own file or a small module inside the worker's file. Small enough that either works.
- Whether to add observability hooks (log lines around enqueue, worker start, orchestrator invocation, response drop). Standing directive from role file: "Logging is cheap and batched to the console-forward server; look at logs FIRST when diagnosing" — planner should add logs at every meaningful state transition.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (authoritative for this phase)
- `.planning/shapes/shape-spawn-request-watcher.md` — Alice's locked shape from the /open pass 2026-09-10 (settled in 3 grill exchanges: birth-queue persistence in-memory vs persistent → in-memory; response-file location same-folder vs separate → same-folder; response-file cleanup coord-vs-reaper → coord-side). All D-01..D-23 above are derived from it plus this discuss-phase session's decisions on request/response schemas, host-owner userId, serialized worker.

### Campaign context
- `~/.claude/roles/box-maintainer/bounties/id-skill-revamp/shape-id-skill-revamp.md` — original whole-campaign shape (multi-phase). This phase is Shape 5 of 5. The campaign shape describes the request-file protocol Alice co-designed with tanya during Shape 4's /open; Shape 5 implements the Skynet side of it.
- `~/.claude/roles/box-maintainer/bounties/id-skill-revamp/bounty.json` — campaign hub bounty with cross-shape timeline.

### Upstream dependencies in same campaign (code-complete at HEAD, held from ship)
- `.planning/phases/92-pin-sentinel-migration-move-identity-pin-state-from-skynet-d/92-CONTEXT.md` — Shape 1's context (pin sentinel migration). Not directly touched by this phase but part of the atomic-ship batch.
- `.planning/phases/94-supervisor-archive-extension-daily-archive-scan-for-180-day-/94-CONTEXT.md` — Shape 2's context (supervisor archive extension). Not directly touched by this phase.
- `.planning/phases/96-on-disk-tree-consolidation-consolidate-identity-metadata-and/96-CONTEXT.md` — Shape 3's context (on-disk tree consolidation). This phase's request-file paths (`~/fleet/spawn-requests/`) live under the tree Shape 3 established.
- Shape 4 prose commits `ae3ca224` (id skill SKILL.md), `c84ed41f` (coordinator-instructions.md), `57182a28` (agent-relay SKILL.md) — the coordinator-side prose describing the request-file flow that this phase implements the server side of.

### External code dependencies (READ before implementing — no changes here)
- `src/backend/database/routes/identity-birth-orchestrator.ts` — Tina's Phase 77 birth machinery. This phase adds a new caller (`runIdentityBirthOrchestrator({role, task, userId, hostId, ...})`) but does not modify the orchestrator itself. `BirthOptions` interface (~line 131) is the contract this phase's worker fills in.
- `src/backend/database/routes/identity-birth.ts` — the HTTP route handler that normally calls the orchestrator (from the frontend new-agent modal). Reference for how the frontend fills in `BirthOptions` — the spawn-request worker mirrors the pattern with pool-picked name defaults and role-inherited cosmetic fields.
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — the per-host sweep. This phase extends it. READ before touching to understand the per-host tick loop, the long-lived SSH channel management, and the batched exec pattern (`processPid` function, exec-parsing helpers).

### Files this phase modifies
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — extends per-host tick with the atomic read-and-delete exec for `~/fleet/spawn-requests/` and the enqueue call to the spawn-request queue.

### Files this phase creates
- New backend module(s) for the spawn-request queue + birth-worker + response-file drops (planner names the concrete files). Conceptually a small self-contained subsystem: queue holds pending requests, worker pulls from queue and invokes the birth orchestrator, response-file writer drops success/failure files on completion.
- New unit + integration tests covering all of the above.

### Files this phase READS (contract references, no changes)
- `~/.claude/roles/box-maintainer/box-map.md` — role reference for fleet-status orchestrator patterns, if relevant during implementation.
- `~/.claude/roles/box-maintainer/id-skill-handoff.md` — full context transfer for the id skill body + 3 coordinator companions. Shape 4 prose is what defines the coordinator-side of the protocol this phase implements the server side of.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Fleet-status per-host sweep (`ssh-poll-orchestrator.ts`)** — already reaches every managed host on a 2-second tick with one long-lived SSH channel each. This phase's observation-and-claim step is one additional exec inside the existing per-host processPid loop.
- **Identity-birth orchestrator (`identity-birth-orchestrator.ts`)** — Tina's Phase 77 machinery, exported as `runIdentityBirthOrchestrator`. This phase's worker is just a new caller of the existing entry point; no orchestrator changes needed. Signature accepts `role`, `task`, `userId`, `hostId`, `name`, `poolPicked`, cosmetic fields, etc.
- **Host-record scope lookup** — Skynet already resolves `hostId` to a host record with owner-userId scoping (the frontend uses this on every host-related request). Spawn-request worker reuses this to derive the correct owner-userId per D-14.
- **SSH exec helpers** — the per-host channel already exposes `execCommand(conn, command)` for arbitrary remote commands, used throughout the sweep. The atomic read-and-delete exec (D-02) is one additional `execCommand` call per tick.
- **Existing per-tick error handling** — the sweep already handles individual exec failures without killing the whole tick. Adding one more exec doesn't require new error-handling machinery.

### Established Patterns
- **Fleet-substrate distribution** — no substrate script changes in this phase; all changes are backend TS. Skynet redeploy carries the new watcher subsystem via a normal container rebuild + `--force-recreate` at campaign ship time.
- **In-memory backend state that dies on restart** — matches the existing pattern for Skynet's live subsystems (fleet-status state, session tracker, etc.). Restart clears in-flight; upstream callers (fleet-status sweep, coord) tolerate the loss cleanly.
- **Coordinator-side sentinel file patterns** — the `.pinned`, `.no-dormancy`, `.recycle-requested` presence-based sentinels already establish the "one side writes, other side observes" convention. The request/response file pair extends this to a bidirectional exchange keyed on shared request-id.

### Integration Points
- **Fleet-status sweep** — one additional exec per tick per host. Same channel, same auth, same error surface.
- **Host-record lookup** — one additional call per pending request (to derive owner-userId for the birth-orchestrator invocation).
- **Identity-birth orchestrator** — one additional caller. Not changed.
- **Response-file drop** — SFTP or SSH exec write to the target host via the existing per-host channel. Small file (< 200 bytes). Not on the critical path.

### Test Considerations
- Fleet-status sweep tests already exist (`ssh-poll-orchestrator.test.ts`); this phase adds tests for the spawn-request-scan behavior with mocked SSH exec responses.
- Identity-birth orchestrator tests already exist; this phase does NOT modify the orchestrator so its existing tests continue to cover it.
- New tests: request-file parser (unit), queue (unit), worker (unit — mocks the orchestrator), end-to-end wire (integration — mocks orchestrator + SSH channel).

### Anti-patterns to avoid
- **Do NOT introduce a persistent queue backing** (D-06). The complexity cost (schema, replay, partial-state tracking) buys nothing the coord-timeout-escalate path doesn't already cover.
- **Do NOT retry failed births inside the worker** (D-15). All retries are human decisions.
- **Do NOT verify the response file dropped correctly by re-reading it** (D-13 principle). Trust the file write; if it silently failed, coord's timeout catches it.
- **Do NOT split observation and deletion into two exec calls** (D-02). The atomicity is load-bearing for the "zero double-observation window" claim.
- **Do NOT create the spawn-requests folder from Skynet's side** (D-03). Coordinator creates it on first request drop; missing folder = empty batched contents, not an error.
- **Do NOT modify the identity-birth-orchestrator itself** (D-20). It's Phase 77 territory; this phase is a new caller only.
- **Do NOT hand-patch fleet-substrate-managed content on any host** (fleet-wide standing directive). All changes here are Skynet backend; substrate distribution is untouched.
- **Do NOT push, docker build, or docker compose up as part of executor's remit** (fleet rule: deploy-window boundary sits at push; executor's remit stops at code + commit + tests green). Orchestrator handles the ship motion at eventual campaign push moment.
- **Do NOT introduce message streaming** (fleet-wide standing directive: "Skynet has NO message streaming — ever, anywhere"). Response files are atomic writes; no partial-file streaming affordances.

</code_context>

<specifics>
## Specific Ideas

- **Piggyback on fleet-status per-host sweep** — Alice 2026-09-10, after investigating Skynet's existing per-host reach pattern (one long-lived SSH channel per host, batched execs on 2s tick). Cleanest home for the spawn-request scan; no new SSH plumbing.
- **Atomic read-and-delete at claim time** — Alice 2026-09-10 verbatim: *"the deletion should happen on the fleet status tick so that it goes away right away and can't accidentally be picked up by the next one."* Single-exec atomicity is load-bearing.
- **Success + failure file pair (deletion-only-on-success was rejected)** — Alice 2026-09-10 verbatim: *"skynet's back end deletes it and then as soon as it realizes that it's malformed it drops like a failure file that the coordinator can see so at least it doesn't leave it ambiguous as to what happened."* Pair-file protocol gives coord unambiguous signal (success vs failure vs neither-yet).
- **Coord doesn't verify birth output** — Alice 2026-09-10 verbatim: *"I don't think we really have the coordinator check only because like what's it going to do if it figures out that it was wrong? ... just stop so that you don't set things up incorrectly."* Coord trusts the success signal; if underlying birth was actually broken, the dispatched actor fails on first wake and surfaces separately.
- **Descriptive failure only for malformed class** — Alice 2026-09-10 verbatim: *"think about things that coordinators can actually iterate on, then it's probably only saying something like, hey, the file you dropped was malformed in some way, but otherwise, I don't think the coordinator can do very much about whatever failed."* Iteration only makes sense when coord can fix the request; opaque failures escalate.
- **Host-owner userId for birth-orchestrator scope** — Alice 2026-09-10 accepted after tanya clarified that identities themselves have no DB record (Phase 69 killed that table) — the userId argument is purely about which slice of Skynet-side state (SSH creds, avatar candidates) the birth call operates against. Host-owner userId is the natural multi-user boundary matching the rest of Skynet's model.
- **In-memory queue, serialized worker** — Alice 2026-09-10 accepted both. Persistent queue adds complexity for a case coord-timeout-escalate already covers. Serialized keeps error diagnostics simple; coord births are rare in steady state; birth is I/O-bound so parallelism doesn't buy latency.

</specifics>

<deferred>
## Deferred Ideas

- **Response-file aging / auto-reaper on Skynet side.** If coordinators consistently forget to delete their response files, the spawn-requests folder accumulates cruft. Not addressed here — happy-path coord cleanup is the contract for now. If it becomes a real problem, worth its own small bounty at that time.
- **Bounded-N or unbounded birth-worker parallelism.** Serialized-1 is the current pick. If we ever observe queue backup as a real problem, bumping to bounded parallelism is a small change.
- **Persistent queue with replay-on-restart.** Deferred per the "in-memory + coord-timeout" tradeoff. If coord's escalation surface becomes noisier than we want (Alice getting escalated for Skynet-restart-caused stranded requests), revisit.
- **Cross-host birth.** Coordinator's request always lands on its own box. Cross-host birth would require target-host field in the request schema and cross-host SFTP from birth-worker; explicitly out of scope.
- **Rich failure diagnostics.** Deferred: only `malformed` currently gets a descriptive message. If specific non-malformed failure classes surface actionable info that coord could genuinely iterate on, add descriptive messages for those classes at that time.
- **UI surface for pending spawn-requests.** A view in Skynet showing "here are the pending births" could aid operator visibility during debugging. Deferred — Skynet's console-forward logs cover the observability need for now.
- **Shared frontend/backend types for the wire schema (D-19).** Internal-to-backend for now. If any future phase surfaces spawn-request state to the frontend, promote the types then.
- **CI grep test that fails the build if the response-file schema drifts from what coord expects.** Discussed as a possibility for D-21 tests but rejected as over-engineering; the shared type definitions inside the backend + integration test cover it well enough.

</deferred>

---

*Phase: 99-spawn-request-watcher-skynet-side-noticing-of-coord-dropped-*
*Context gathered: 2026-09-10*
