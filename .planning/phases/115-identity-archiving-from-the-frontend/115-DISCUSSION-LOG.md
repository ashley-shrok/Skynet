# Phase 115: identity archiving from the frontend - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-17
**Phase:** 115-identity-archiving-from-the-frontend
**Areas discussed:** shape (via /open — captured in shape file), then three implementation gray areas: sentinel filename, frontend→backend transport shape, user-initiated retire failure retry behavior.

**Note:** most of the discussion for this phase happened during `/open` (see `.planning/shapes/shape-identity-archiving.md`). The three items below are the incremental gray areas that surfaced during discuss-phase after the shape was greenlit.

---

## Sentinel filename

| Option | Description | Selected |
|--------|-------------|----------|
| `.archive-requested` | Mirrors `.recycle-requested` — intent signal, one-shot, supervisor consumes and deletes | ✓ |
| `.archive` | Shorter but reads as state ("this thing is archived") rather than intent | |
| `.retiring` | Uses the supervisor's internal vocabulary; less discoverable to frontend engineers | |
| `.archiving` | Present-tense verb; slightly awkward | |

**User's choice:** `.archive-requested` (thumbs up on recommendation).
**Notes:** The sentinel is semantically an INTENT signal (consumed and deleted), not a STATE marker (persistent). Existing `.recycle-requested` is the direct precedent to mirror.

---

## Frontend → backend transport shape (how the click reaches the sentinel drop)

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse `PUT /user-preferences` fanout | Frontend maintains a client-side "archive-requested" ID array, PUTs it like `hiddenConversationIds`; backend fans out sentinels | |
| New dedicated `POST /identity/:hostId/:name/archive` | Single-command endpoint; fans out one `.archive-requested` sentinel to the target host | ✓ |
| Direct SSH from frontend (rejected without discussion) | Would bypass Skynet's backend entirely | |

**User's choice:** New dedicated endpoint (thumbs up on recommendation).
**Notes:** Archive is a one-way command, not a state to keep in sync — the `PUT array-of-IDs` shape fits state, not commands. The new endpoint uses the same `writeIdentityFile` primitive under the hood, so mechanical cost is small.

---

## User-initiated retire failure retry behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Match Phase 94's 24-hour retry cadence | Aborts on any failure, retries next daily pass; retire-stuck after 3 daily fails | |
| Sentinel stays in place, retry every reconcile tick (~15s); retire-stuck after 3 consecutive tick fails | Same failure counting mechanism (Phase 94's `retire-fail-count-<name>`) but faster tick cadence for user-initiated | ✓ |
| Exponential backoff on the tick cadence | Adds complexity for a problem (broken homeserver) that shouldn't happen; tick cadence itself provides implicit spacing | |

**User's choice:** Retry every reconcile tick, retire-stuck after 3 fails (thumbs up on recommendation).
**Notes:** 24-hour retry is too slow for user-initiated action (user expects click to take effect within seconds); tick cadence provides implicit spacing so exponential backoff isn't needed. Both trigger paths (user-initiated per-tick, 180-day sweep daily) share the `retire-stuck` sentinel and the same 3-fails threshold.

---

## Claude's Discretion (from CONTEXT.md § Claude's Discretion)

- Exact route shape / naming for the archive endpoint (fits existing route conventions in `identities.ts`).
- Where the guard-bypass logic lives (caller vs `force:bool` on `retire_identity()`).
- Graceful-exit timeout for step 2 (reuse recycle's window vs tune specifically for retire).
- Inline vs background-task execution of the retire itself in the sentinel-scan branch.
- Retire-fail-count sharing between user-initiated and 180-day paths.
- Sweep code layout for the archive-tree enumeration (parallel walk vs unified walk with archived flag).
- Confirmation dialog implementation mechanism (new component / existing modal / `window.confirm`).

## Deferred Ideas (from CONTEXT.md § Deferred)

Un-archive, permanent-delete on archived rows, context menu on archived rows, automated `.hidden` migration, configurable graceful-exit timeout, cross-host archive announcement wire, user-facing archive toast, archive-tree pruning, multi-user re-scoping of the archive gesture.
