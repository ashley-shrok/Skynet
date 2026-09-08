# Phase 85: middle-list recency from Skynet-side send-log — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-07
**Phase:** 79-middle-list-recency-from-skynet-side-send-log-replace-remote
**Areas discussed:** ordering-symptom diagnosis, mechanism inversion, key
shape, universality of the compose hook, pinned/RDP scope, send-attempt vs
delivery, first-ship backfill

**Note on the discuss-phase flow:** all substantive discussion happened
in-band during the preceding `/build` → `/open` beats over 2026-09-06 and
2026-09-07. This log summarizes the alternatives Ashley considered during
that pitch → discuss → grill arc; CONTEXT.md contains the final decisions.
Per build-skill convention, CONTEXT.md was seeded from
`shape-middle-recency-from-send-log.md` rather than re-eliciting the same
gray areas here.

---

## Ordering-symptom diagnosis (2026-09-06)

Ashley's opening report: identities she worked with recently (Ivy, who
stood up a VM within the last 24 hours) sort below identities she hasn't
messaged in weeks (Lulabelle, ~2.5 weeks; Vicky, ~1 week).

Diagnosis paths considered:

| Hypothesis | Considered | Selected |
|--|--|--|
| Predicate excluding coordinator-routed / relay-received / wake-fired activity as "not Ashley's real turn" | Yes — surfaced first | Partial cause |
| Frontend working-store cache eviction on refresh | Yes | Contributing factor |
| `/id reset` starts a fresh JSONL that's empty of real user turns, so the scanner (which reads only the newest-mtime file) sees null and the row sinks to null-to-bottom | Ashley proposed | ✓ Root cause |
| Discovery / SSH poll failure for specific identities | Considered, ruled out (Ivy shows in list) | No |

**Ashley's diagnosis was correct** — architecture confirmed by reading
`discoverIdentityJsonlPathViaChannel` (`ssh-poll-orchestrator.ts:684`) and
`scanTailForNewestMessageAt` (`ssh-poll-orchestrator.ts:508`). Only the
newest-mtime JSONL is scanned; after `/id reset` the new file becomes newest
and starts empty.

## Mechanism inversion — replace transcript-scan derivation

| Option | Description | Selected |
|--|--|--|
| Scan ALL of an identity's JSONL files, not just newest, and aggregate max real-user-turn ts | Cheaper to reason about but keeps the predicate-fragility | |
| Persist working-store cache to localStorage (survives refresh) | Doesn't help fresh browser open; doesn't help multi-device | |
| Broaden predicate to include coordinator-routed / relay / wake content | Reintroduces exactly the noise the 2026-08-23 predicate lock removed | |
| Record the timestamp on the send side in Skynet's backend when the compose funnel fires | Ashley proposed 2026-09-06 | ✓ |

**Ashley's proposal (verbatim):** *"whenever messages are sent to any
session, because the only place that messages go into the sessions is from
the front end of Skynet. So, you know, anything that the compose box does
that sends a message into the session, like the reset button, or the thumbs
up, or the recap button, or any of the text areas within the compose box
submitting could easily just be logged somewhere as the last time that a
user said something to that identity."*

## Key shape

| Option | Description | Selected |
|--|--|--|
| Key on `(hostId, tmuxSession)` — matches today's working-store key format | Mechanistic; sensitive to session moves | |
| Key on identity name only | Durable across recycles, box moves, transport changes | ✓ |

**Ashley (verbatim):** *"we don't care about mechanisms like TMUX sessions,
we just care about what is the identity and what was the last time it was
talked to."*

## Universality of the compose hook

| Option | Description | Selected |
|--|--|--|
| Enumerated allowlist — specific buttons wired individually | Per-button coverage; future buttons need explicit wiring | |
| Universal architectural rule — any send from the compose surface counts | Future-proof; single hook site covers all | ✓ |

**Ashley (verbatim):** *"if anything within the compose box sends a message
into the harness, then it counts."*

**Exception check:** *"is there any kind of send that goes through the
compose surface that you would want to EXPLICITLY not count?"* — **Ashley:
"No, it can all count."**

## Pinned + RDP zone scope

| Option | Description | Selected |
|--|--|--|
| Extend the new recency signal to pinned zone (so most-recently-messaged pin floats to top of pin strip) | Reordering pins on activity | |
| Extend to RDP zone | Same for remote-desktop rows | |
| Middle zone only; pinned + RDP keep current alphabetical `compareByHostRoleLabel` | Scoped, non-invasive | ✓ |

**Ashley:** *"We are not affecting the pinned area with this."*

## Send-attempt vs. delivery

| Option | Description | Selected |
|--|--|--|
| Stamp only on successful delivery — WS write confirmed, backend acknowledges | Filters flaky sends; but "I meant to talk to Ivy but her box was flaky" bug returns | |
| Stamp on send-attempt regardless of delivery outcome | Intent IS the signal; matches Ashley's mental model of "I just talked to Ivy" | ✓ |

**Ashley (verbatim):** *"Attempts count."*

## First-ship backfill

| Option | Description | Selected |
|--|--|--|
| One-shot backfill: run the current JSONL scan once per known session on ship day to seed the new store | Prevents "everyone at null" on ship day | |
| No backfill; natural fill from send activity | Simpler; Ashley accepted the tradeoff | ✓ |

**Ashley (verbatim):** *"we don't even have to have the mechanism run on
first ship. I'm okay with it just kind of happening naturally."*

---

## Claude's Discretion

Areas where Ashley deferred to implementation:

- Exact Drizzle table + column names for the new store
- Migration mechanics (Drizzle migration file shape, invocation timing)
- The specific backend seam for the derivation source-swap (per-tick
  read in the orchestrator vs pre-computed value passed in)
- Whether the backend-side stamp write happens via a new lightweight HTTP
  endpoint or piggybacks on the existing WS send channel
- Whether the client-side optimistic stamp calls
  `advanceSessionLastMessageAt` directly or wraps it
- Fingerprint / publish-trigger integration (planner analyzes)

## Deferred Ideas

- Capturing Ashley's phone Matrix DMs that bypass Skynet's compose
  surface (different signal source; requires agent-relay hook, not
  compose-funnel hook)
- Multi-user keying (Skynet single-tenant on t1000 today)
- Non-compose Skynet interaction paths (wire through the same hook if any
  are added later)
- Manual "reset this identity's recency" affordance
- Broadening the signal to "any message either direction" (rejected in
  shape — would make noisy agents dominate)
