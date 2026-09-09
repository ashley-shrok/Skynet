# Phase 92: Fleet-status poller batch sweep — one exec per host, not one per identity-sentinel — Context

**Gathered:** 2026-09-09
**Status:** Ready for planning
**Source:** Bounty premise (`~/.claude/roles/box-maintainer/bounties/fleet-status-poller-batch-sweep-single-exec-per-host/bounty.json`) + issue-log.md sibling. Full diagnosis + design agreed with Ashley 2026-09-09 in-conversation before this phase was opened.

<domain>
## Phase Boundary

Replace the fleet-status poller's O(hosts × identities × sentinels) exec-per-file model with an O(hosts) batch-script model. One server-side sweep script per managed host per poll cycle emits all per-identity sentinel/state as one JSONL blob. The fleet-status caller (in `src/backend/fleet-status/`) invokes that one script and parses JSONL, instead of dispatching per-identity SSH exec channels.

Trigger: 2026-09-09 Tabitha attempted to share a file via the Skynet passthrough URL scheme and hit `host_unreachable` (5/5 consistent). Container log analysis showed SFTP openSftp() losing the race against a flood of parallel fleet-status tmux-helper exec channels on the shared `Skynet` host SSH connection, all failing with `SSH Channel open failure: open failed (reason: 2)`. Root cause = sshd default `MaxSessions=10` per-connection exhaustion, driven by fleet-status polling each of ~15 identities × ~5-6 sentinel/state files individually.

The 2026-09-02 semaphore fix (bounty `fleet-status-poller-self-limit-concurrent-exec-channels`, HEAD `e50d53f2`, cap at 8 per-connection) is in the running build and caps concurrency, but NOT total work — the ~75-90 exec channels per poll cycle just serialise into ~10 waves through the semaphore. Adding one more identity adds another wave. Semaphore is treating symptoms; the batch-coalesce is treating the disease.

Ashley 2026-09-09 verbatim: *"if you're saying that the number of identities on the box is a dependency on if this problem is going to be caused or not, then that sounds like to me or I should say smells like to me that we could be doing the fleet status better to begin with to keep the eight that the semaphore allows as enough for everything."* Correct diagnosis. This phase implements it.

Analogy: same transformation you use in SQL to fix N+1 point queries — replace with one join. Same idea here: replace N+1 exec-per-file with one exec-per-host that emits the batch.

</domain>

<decisions>
## Implementation Decisions

### Design pattern
- **One sweep script per managed host per poll cycle.** Script walks `~/.claude/identities/*` and emits one JSONL line per identity capturing all state (sentinels + tmux-helper checks + task-dir snapshot).
- **Server-side script, not client-side batching.** The Skynet backend invokes ONE exec channel per host per poll; the script does all per-identity iteration on the managed box itself. Never fall back to client-side per-identity dispatch as an "easier first slice" — that defeats the whole point.
- **Distributor-shipped, not committed on managed boxes.** Same delivery pattern as `recv.sh`, `wakeup-scheduler`, `context-watch`, `role-file-watch` — bundled into the Skynet container at `/app/fleet-substrate/scripts/`, distributed to `~/.local/bin/` on each managed box at container-restart sweep.
- **Backward compat during rollout.** If the sweep script is missing on a peer box (mid-rollout, before that box's container restart), the fleet-status caller must fall back to the legacy per-identity exec plumbing gracefully. Do NOT hard-fail if the sweep script is absent.

### Output schema
- **JSONL, one line per identity.** Each line is a JSON object with at minimum `name` (identity name) plus the state fields the current poller reads.
- **Schema is versioned.** Include a `schema_version` field on each line so the caller can detect a version mismatch and fall back to legacy plumbing rather than misparse.
- **Enumerate current fields explicitly during Task 1.** The plan's first task is to enumerate exactly what the current poller reads per identity (`.recycle-requested`, `.dormant`, `.recycled-at`, `~/.claude/tasks/<uuid>/*.json`, tmux-helper state, etc.) and lock that as the v1 schema. No expansion of what's collected in this phase — parity with today, delivered via a different mechanism.

### Semaphore disposition
- **Do not remove the semaphore in this phase.** Leave it in as safety net. After prod verification of the batch pattern, loosen its cap (from 8 to something like 4) so it stays as belt-and-suspenders without over-serialising.
- **Removing the semaphore is a separate future phase** (or just deferred indefinitely — a loose safety net is fine).

### Caller side
- **Change is contained to `src/backend/fleet-status/`.** No changes to `src/backend/ssh/` (connection pool, semaphore adapter) beyond what's needed for the caller to invoke one exec instead of many.
- **Preserve current polling interval + trigger logic.** Only the how-we-collect-state changes; when-we-collect-state and how-we-decide-what-to-refresh are unchanged.

### Verification
- **Container log free of `Channel open failure` spam** under normal poll load (defined as: no more than N failures per hour, where N is <ambient failure rate from other pool consumers>; concrete threshold TBD in the plan).
- **SFTP file-fetch (Skynet passthrough URL) reliably succeeds** — reproduce Tabitha's failing case; must succeed 20/20 after the fix.
- **Regression test** — a vitest test that mocks/asserts the fleet-status caller invokes one exec per host per poll, not N exec per host per identity per sentinel.

### Claude's Discretion
- Exact script implementation language (bash vs python) — decide during planning. Bash is default per existing distributor pattern; python is acceptable if the sweep logic genuinely needs it. Prefer bash unless there's a concrete reason to escalate.
- Exact JSONL field names — the plan's Task 1 (enumerate current poller reads) fixes these. Match caller-side variable names where reasonable.
- Whether to run the sweep script via `bash -s` heredoc (script-body inline in the exec channel) vs invoking a distributor-installed file (`~/.local/bin/fleet-status-sweep`). Prefer the installed-file path — matches existing pattern, avoids per-poll body-transmission overhead, and lets the script evolve independently.
- Distributor catalog entry shape — mirror existing entries in `substrate/scripts/` + `src/backend/distributor/catalog.ts` (or equivalent).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing fleet-status implementation
- `src/backend/fleet-status/` — the whole directory is the caller side; scan for per-identity exec sites.
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — main poll dispatch.
- `src/backend/fleet-status/ambient-filter.ts` — Phase 34 filter for `[ambient]` background_tasks (unrelated to this phase but adjacent).

### Existing distributor pattern (mimic this)
- `substrate/scripts/` — location for the new sweep script.
- `~/.local/bin/wakeup-scheduler`, `~/.local/bin/context-watch`, `~/.local/bin/role-file-watch` — installed helpers to mimic.
- `substrate/skills/agent-relay/recv.sh` — sibling helper (skill, not script, but same distributor mechanism).
- `src/backend/distributor/catalog.ts` (or equivalent) — where to register the new sweep script for distribution.
- `src/backend/distributor/sweep-logic.ts` — distributor sweep logic.
- `src/backend/distributor/ssh-push.ts` — how installed files get pushed to each managed box.

### Semaphore fix that this supersedes
- Bounty: `~/.claude/roles/box-maintainer/bounties/fleet-status-poller-self-limit-concurrent-exec-channels/bounty.json`
- Shipped 2026-09-02, HEAD `e50d53f2`. Contains the per-connection semaphore capped at 8 in the channel adapter.

### Diagnosis evidence
- Bounty: `~/.claude/roles/box-maintainer/bounties/fleet-status-poller-batch-sweep-single-exec-per-host/bounty.json`
- Sibling: `~/.claude/roles/box-maintainer/bounties/fleet-status-poller-batch-sweep-single-exec-per-host/issue-log.md` — container log excerpt at moment of failure, confirms MaxSessions=10 saturation.

### File-fetch caller (the disruption trigger)
- `src/backend/database/routes/pretty-view-fetch-host-file.ts` — SFTP file-fetch endpoint. Not modified by this phase; the fix here unblocks it as a side effect.

</canonical_refs>

<specifics>
## Specific Ideas

- **Enumerate first, code second.** Task 1 of the plan MUST be enumeration of current per-identity exec sites and what they read. Locking that as the v1 schema before writing the script avoids scope creep and makes parity verification straightforward.
- **Rollout order matters.** Ship the sweep script + caller change together on Skynet's own container; verify the batch pattern in prod on t1000 first; then let the distributor propagate to peer boxes on their next restarts. The backward-compat fallback covers the rollout gap.
- **Bonus wins from the redesign** (nice-to-have, do NOT gold-plate): atomic-ish snapshot of a poll cycle, lower full-cycle latency, free identity-count scaling, file-fetch no longer competes with fleet-status.
- **`Skynet` host (id=6) is the primary test surface.** It's what Ashley (userId `JqbJ5OmBQhQ-TGQRkHF3o`) has registered pointing at `100.99.149.8:22` (t1000's own tailnet IP), and it's the connection getting saturated. Verify against it specifically.

</specifics>

<deferred>
## Deferred Ideas

- **Removing the semaphore entirely.** Leave it in as safety net. Future phase (or just leave it alone).
- **Push-based state changes** (identity harness pushes to Skynet on transitions instead of Skynet polling). Elegant but adds moving parts + coordination — deferred; polling with a batch script is enough.
- **SFTP directory listing as an alternative to exec.** Also viable, but harder to make composable with the JSONL emit; batch exec is simpler.
- **Expanding what's collected per identity.** This phase delivers parity with today via a different mechanism. Any new state fields land in a later phase.

</deferred>

---

*Phase: 92-fleet-status-poller-batch-sweep-one-exec-per-host-not-one-pe*
*Context gathered: 2026-09-09 — seeded from bounty premise (design agreed in-conversation with Ashley same day)*
