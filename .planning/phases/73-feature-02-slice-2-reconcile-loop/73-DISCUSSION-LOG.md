# Phase 73 Discussion Log — feature 02 slice 2

**Date:** 2026-09-04
**Session:** tiffany (box-maintainer role, `~/skynet-tiffany`)

## Where the discussion happened

Every substantive shape-level decision was worked through in this session's `/build` → `/open` beat, not in `/gsd:discuss-phase`. The `/open` conversation is the authoritative record; the shape file at `.planning/shapes/shape-feature-02-slice-2-reconcile-loop.md` is the artifact that captures it. This log summarizes what was decided, WHY, and what the alternatives were — for audit/retrospective use.

## Decisions captured (with alternatives considered)

### 1. Reconcile trigger — piggyback on the existing per-host SSH poll orchestrator's channel-acquisition moment

**Decided:** First successful channel acquisition per host per Skynet instance lifetime fires the sweep. In-memory sweeped-this-instance map; container restart wipes it. No timer, no cron, no scheduling primitive of its own.

**Alternatives considered:**
- Container-boot fan-out sweep (all hosts at once at container start) — rejected; doesn't handle newly-added hosts naturally, and misses the "host was unreachable at boot" case.
- Hybrid: on-container-boot sweep + hourly floor timer — rejected because the bundled bytes only change on `--force-recreate` (container restart), which itself triggers a new instance; a floor timer between recreates has nothing to catch. Ashley's observation: "if you can't get new stuff in there without building and recreating, then there's nothing to push on an interval."
- User-driven only (fire when Ashley opens a terminal to a host) — rejected because idle hosts would never be swept.

**Why this shape won:** Skynet already opens a persistent per-host SSH channel every 2 seconds for `fleet-status` polling (in `ssh-poll-orchestrator.ts`). Every identity-hosting host already has active reachability; piggybacking on the natural channel-acquisition event covers every case (boot, new host added, host was down and came back) without introducing new machinery. Kills the scheduling-primitive question entirely — there is no primitive.

### 2. Audit trail surface — structured lines in the console-forward log, not a new DB table

**Decided:** Two levels of log lines tagged `fleet_substrate_*`. One summary line per (host, sweep) always emitted (`fleet_substrate_sweep_result`); per-item detail lines only when the outcome is anything other than "already matched" (`fleet_substrate_item_changed`, `fleet_substrate_item_failed`).

**Alternatives considered:**
- New DB table (`substrate_sweep_events`) — rejected. Ashley's guidance: "I'm not sure that we're even going to have an admin UI. And mostly, if not all, of the investigating into things that go wrong with this will be by you guys. And so whatever shape is easiest for you to read and diagnose things is probably best." A table adds schema churn for a consumer that may not exist.
- Log every item on every sweep (no non-current filter) — rejected. 15 items × N hosts × every container restart = 15N noise lines per restart with nothing interesting. Non-current-only detail keeps the grep story tight.

**Downstream consequence noted:** Slice 3's admin UI is no longer assumed. Design slice 2 to not depend on it. If a slice-3 UI is ever built, it grep-parses (or promotes to a table then).

### 3. Restart hooks — rich catalog with per-item declaration; only supervisor has one in this slice

**Decided:** Each substrate item declares its own restart hook (mostly `none`, agent-supervisor is `restart agent-supervisor.service`). Receiver / scheduler / context-watch do NOT get restarted during sweep; they pick up new bytes naturally on next identity reload.

**Alternatives considered:**
- Minimum catalog with hard-coded "restart supervisor if supervisor changed" special-case — rejected; the catalog is 15 lines either way, and per-item declaration reads cleaner for future items that might need weird handling.
- Restart every daemon-like item (receiver, scheduler, context-watch, supervisor) — rejected; adds complexity for scripts that already refresh on next identity reload.

### 4. Mode preservation — mirror the bundled file's own mode, do NOT declare mode per catalog entry

**Decided:** Sweep reads the bundled file's mode from disk and applies to the installed side after write. What git thinks the mode is IS the source of truth.

**Alternatives considered:**
- Catalog-declared mode (each catalog entry says `mode: 0755`) — rejected because it's a schema in code that has to stay in sync with bundled reality. Slice 1's `chmod +x` + `git update-index --chmod=+x` cycle already established that git IS the mode source of truth.

### 5. Iteration model — single ubuntu user per host (no per-linux-user loop)

**Decided:** The sweep on a given host checks `~/ubuntu/.claude/` and iterates the catalog against that single user's install paths. No loop over multiple linux users.

**Alternatives considered:**
- Per-linux-user iteration (walk every user with `~/.claude/`) — rejected because the pre-pivot linux-user-isolation model is dissolved (per 2026-09-04 PROJECT.md multi-VM pivot). Every managed host today has a single ubuntu user running substrate; the per-user loop is a loop of 1 in every case.

### 6. Per-host opt-in flag — `runs_fleet_substrate BOOLEAN`, default false, migration adds column, operator flips manually

**Decided:** New BOOLEAN column on the host table, default false, migration adds it. Operator flips to true per host they want distributor push on. Feature 07's provisioning path will set true for new exec VMs from the get-go. On t1000 as a managed host of itself, I explicitly opt it in when I'm ready.

**Alternatives considered:**
- Auto-derive from "identity-hosting" (any host with `~/.claude/`) — rejected because it removes operator agency. I might want an identity-hosting host that does NOT get distributor push (e.g., a research VM running experimental substrate versions).
- Per-item flag (Boolean array of 15) — rejected; premature complexity. Single boolean covers slice 2; can extend later if per-item opt-out becomes a real need.

### 7. Error containment — fire-and-forget from the poll's perspective

**Decided:** The sweep runs on the poll orchestrator's channel BUT wraps every exec call in its own try/catch, logs its own outcome lines, never throws upward. If the sweep hangs, the sweep hangs — the poll's 2s ticks keep running independently.

**Alternatives considered:**
- Per-host lock serializing sweep with poll — rejected as premature coupling. If actual channel-state weirdness surfaces in practice, add serialization then.

### 8. SSH connection reuse — implicit via the orchestrator's existing per-host channel

**Decided:** No ControlMaster / ControlPersist config added. The orchestrator already holds a persistent `SshChannel` per host with `exec()`; sweep just calls `channel.exec()` on it. Connection reuse is already there.

**Alternatives considered:**
- Add ControlMaster/ControlPersist to Skynet-container SSH client config — rejected. The persistent per-host channel already IS the connection reuse. Would only matter if we opened separate SSH invocations per item (30-45 per host per sweep) — which we don't, because we're not opening new SSH at all.

## Deferred ideas (captured, not acted on this slice)

- **Operator-peek endpoint** — "what's the current state of the fleet's substrate right now?" via one HTTP call rather than log-grep. Log grep is fine for now. Add the endpoint later if the grep story bites.
- **Drift-from-below healing** (someone hand-modifies an installed file on a host without changing bundle; sweep detects and heals). Not a new guarantee we have today, and unlikely in practice. Add a floor timer in a follow-up if it becomes real.
- **Per-item opt-out flag** (per-item Boolean array). Single boolean covers slice 2.
- **Restart hooks for receiver / scheduler / context-watch** — they pick up new bytes on next identity reload. Add if a real gap surfaces.
- **Admin UI reconcile-status view** — slice 3 if it happens at all. Slice 2 must not be designed around it.
- **Admin-triggered "sweep now" endpoint** — deferred.

## Discretion left to the planner (implementation-level, not decisions the user made)

- Exact insertion point in `ssh-poll-orchestrator.ts` for the sweep-piggyback hook (planner + researcher discover the cleanest fit against the existing `OrchestratorDeps` interface).
- Migration authoring pattern inside `db/index.ts` (`migrateSchema()`; must include `DatabaseSaveTrigger.forceSave` after any direct write per role file "Load-bearing invariants").
- Catalog file location + shape inside the new `src/backend/distributor/` module.
- Exact log-tag naming discipline (must follow the `fleet_status_*` convention already established in `ssh-poll-orchestrator.ts`).
- Test file layout (unit tests for the pure sweep/compare/decide logic per the `liveness-check.ts` "pure library + injected transport" pattern; integration touch to exercise the hook site).
