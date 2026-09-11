# Phase 99 Discussion Log

**Session:** 2026-09-10
**Discussed with:** Alice (via tanya)

## Areas Discussed

All four gray areas presented; all four discussed; Alice requested recommendations up-front and accepted all four with one clarification on #3.

### Area 1: Request file schema

**Options considered:**
- Minimal: `{role, task}` (uuid in filename only)
- Add `requested_at` (ISO-Z timestamp) for stuck-request debugging
- Add `coord_mxid` (attribution in Skynet logs)
- All three

**Claude's recommendation:** `{role, task, requested_at}`. Rationale: role + task are functionally required for the birth-orchestrator; requested_at is nearly free to add and pays off for stuck-request debugging; coord_mxid is over-attribution since the request lives on coord's own box.

**Alice's decision:** Accepted (implicitly, via batch "Agreed" response).

**Captured as D-04 + D-05 in CONTEXT.md.**

### Area 2: Response file schemas

**Options considered:**
Success:
- `{name}` only
- `{name, mxid}` — saves coord one directory-search lookup
- `{name, mxid, birthed_at}` — audit trail

Failure:
- `{reason: "malformed" | "other", message?}` — descriptive on malformed, terse otherwise
- `{code, message}` — always both, message may be terse for non-malformed
- `{reason}` — always terse regardless

**Claude's recommendation:**
- Success: `{name, mxid, birthed_at}`
- Failure: `{reason, message?}` with reason as small enum (`malformed`, `role_unknown`, `birth_failed`, `homeserver_unreachable`, etc.); message present + descriptive when reason == "malformed", absent or short-terse otherwise

**Alice's decision:** Accepted (implicitly, via batch "Agreed" response).

**Captured as D-09 + D-10 in CONTEXT.md.**

### Area 3: Ownership attribution

**Initial framing (Claude):** Which userId in Skynet's schema would own the identity — coord's own, dedicated system userId, user who owns the host, etc.

**Alice's pushback:** *"I'm not quite sure what you mean by which user ID in Skynet's schema would own an identity, because identities are just on disk only, so I'm trying to understand what that would be referring to."*

**Claude's clarification:** Right — identities themselves have no DB row (Phase 69 killed that table). But the birth-orchestrator's signature still takes a `userId` parameter — used for host-record lookup, avatar-candidate scope, and other user-scoped state. The question is which userId argument the spawn-request worker passes to the orchestrator when calling it on behalf of a coord-dropped request.

**Claude's revised recommendation:** Look up the owner-userId of the host the request came from — every request file lives on a specific box, that box has a Skynet host record with an owning userId. On single-user boxes (t1000) everything routes to Alice. On multi-user boxes (T800), Stacy's coord births under Stacy's userId. Natural multi-user isolation boundary.

**Alice's decision:** *"Sure that works"* — accepted.

**Captured as D-14 in CONTEXT.md.**

### Area 4: Birth-worker concurrency

**Options considered:**
- 1 (serialized) — safe, one thing at a time
- Bounded (e.g., 3 parallel) — some parallelism
- Unbounded — each queued request spawns its own worker task

**Claude's recommendation:** 1 (serialized). Rationale: coord-triggered births are rare in steady state (only on picker no_fit); birth is I/O-bound so parallelism doesn't buy latency; serialized keeps error diagnostics simple; a burst of 3-5 pending drains in ~15-25 seconds well inside coord-side minute-scale timeout; upgrade path to bounded-N is a small change if we ever need it.

**Alice's decision:** Accepted (implicitly, via batch "Agreed" response).

**Captured as D-07 in CONTEXT.md.**

## Not Discussed (Locked from prior phases / shape)

The shape file (`.planning/shapes/shape-spawn-request-watcher.md`) and the Shape 4 /open discussion locked most decisions before this session:
- Piggyback on fleet-status per-host sweep (not new subsystem) — locked
- Atomic read-and-delete at observation (not deferred to worker claim) — Alice 2026-09-10 verbatim
- Success + failure file pair (not deletion-only-on-success) — Alice 2026-09-10 verbatim
- No coord verification of birth output — Alice 2026-09-10 verbatim
- Descriptive failure only for malformed class — Alice 2026-09-10 verbatim
- In-memory queue (not persistent) — locked during Shape 5 /open
- Coord-side safety timeout for Skynet-crash edge case — locked during Shape 5 /open
- Response file in same folder as request (not separate folder) — locked during Shape 5 /open
- Coord-side response-file cleanup (not Skynet reaper) — locked during Shape 5 /open
- No automatic retry anywhere — locked during Shape 4 /open

## Deferred Ideas

Captured in CONTEXT.md's `<deferred>` section. Nothing acted on this session.

## Rescue-rebase Note

Phase 99 slot was reached after two consecutive `gsd-sdk phase.add` cross-tree collisions in the same minute (~37th known incident): initial phase.add gave Phase 97, collided with taylor mid-ship on `phase-93-uat-polish-arc`; announced retry to Phase 98 collided with tabitha mid-ship on `more-versatile-stt-tts-support`. Both peers keep their slots per tiebreak (1); tanya takes Phase 99. Two coord posts (initial announce + correction). Soft-reset + local-rename pattern used rather than full pull-rebase — tanya branch is 70 commits ahead of origin with substantial Phase 96 substrate divergence; full rebase would burn hours for zero benefit since Phases 92 + 94 + 96 + Shape 4 + this all ship together at eventual campaign push (one coordinated rebase then). Backup branch `tanya-phase97-pre-rescue-backup` preserved at `c73e290e`.

---

*Session recorded: 2026-09-10*
