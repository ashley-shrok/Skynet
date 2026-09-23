# Phase 132 — Discussion Log

**Session:** 2026-09-21 (rio)
**Vehicle:** `/build` → `/open` → GSD phase → `/gsd:discuss-phase`

## Note

The discussion for this phase happened in the `/open` session that preceded phase creation, not in a standalone `/gsd:discuss-phase` run. The `/open` grill covered every gray area a discuss-phase would have surfaced. The `/build` skill's directive is explicit: "seed discuss-phase from the shape file — don't re-do the discovery work `/open` already did."

**The canonical record of the discussion is the shape file:**

- `.planning/shapes/shape-frontend-stale-prevention.md` — full pitch → discuss → grill arc from `/open`, LOCKED via user greenlight 2026-09-21.

This log exists only to satisfy the discuss-phase artifact convention. Everything below is a compressed summary of what the shape file records in full.

## Areas discussed (all via `/open`)

### 1. Detection mechanism

**Options presented:** (a) accept — first user interaction after return fires the lock; (b) piggyback on the live channel — server stamps messages it sends anyway; (c) update-worker path (spec-standard PWA answer).

**Selected:** (a) + (b) combined. (c) rejected — subtle lifecycle bugs, offline-first benefit not needed.

**User's word:** *"thumbs up"* on the combined a+b, skipping the update-worker.

### 2. Enforceability of "every request carries the version"

**User's framing:** *"if there was a way to make sure that always happened then both ends of this become fairly trivial i would think but let me know what you think."*

**Answer given:** Yes, enforceable. Three levers: (1) intercept every outbound request at boot via global fetch wrapper, (2) server refuses mismatch, (3) optional strict-absence refusal.

**Selected:** (1) + (2). (3) rejected — mismatch-only enforcement matches vms, keeps non-browser callers working.

**User's word:** *"yeah i think this sounds fine."*

### 3. Modal firmness

**Options presented:** (A) pure firm — everything freezes, click Reload, unsaved is gone; (B) drain-before-lock — snapshot compose text to browser storage; (C) warn-first — modal shows "you'll lose X."

**Selected:** A.

**User's word:** *"optino A"* (option A).

### 4. Multi-tab behavior

**Options presented:** (a) independent tabs — each fires its own modal; (b) cross-tab coordination via `BroadcastChannel`; (c) passive spread — locks propagate but reloads don't.

**Selected:** A (independent tabs). No cross-tab coordination.

**User's word:** *"1 yes, 2 A"* (drift-vs-down confirmed, multi-tab option A).

### 5. Drift-vs-down distinction

**Question:** Should the lock only fire on a successful response with a mismatched tag, never on failed requests?

**Selected:** Yes. Server-down uses existing reconnecting-affordance.

**User's word:** *"1 yes, 2 A."*

### 6. Failure modes (grill)

**Question:** *"What would make you look at this six months from now and say 'it works, but it's missing the point'?"*

**User's word (verbatim):** *"really the only answer to that is if what we've designed doesn't work reliably. because we came up with a pretty airtight plan i think."*

Reliability IS the spirit — no hidden philosophical failure modes.

### 7. Scope edges (grill)

**Question:** What's tempting to include but should be pushed out?

**User's word (verbatim):** *"not sure if i can think of anything."*

Deliberately-not-doing list ended up as the shape file's ruling-out block; no deferrals.

### 8. CSS fast-path pattern (grill)

**Question:** Does hot-swap (`docker cp` into running container) count as a "new version"?

**Answer:** User confirmed the pattern was supposed to have been retired from the role file. Line 91's residual reference was scrubbed this session (fast-path clause removed; container-mutations-serialize directive preserved). Design does not accommodate hot-swap.

## Deferred Ideas

None. The shape file's `## Scope edges → Tempting but no` documents the enumerated rulings-out (update-worker, cross-tab, drain-restore, per-user opt-out) as decisions, not deferrals.

## Claude's Discretion (surfaced to planner)

- Version tag source (asset-manifest hash / commit identifier / build-time nonce) — planner researches.
- Cache-header specifics for the shell page (`no-store` vs `no-cache, must-revalidate`) — planner picks based on Caddy + nginx behavior.
- WS-handshake stamp placement (URL param vs first-message) — planner picks per each WS server's convention.
- Modal DOM/CSS shape — planner picks per Skynet's palette-authority rule and existing patterns.

## Vehicle notes

Vehicle chosen: GSD phase. Auto-proceed to `/gsd:plan-phase 111` per `/build`'s auto-proceed rule (shape greenlight + vehicle pick already covered the "yes, start" decision).

Closing artifact: `/close frontend-stale-prevention` at the end of the arc.
