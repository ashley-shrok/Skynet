# Phase 95: PV context-pct batch sweep — drop tmux capture-pane, one exec per host per tick — Context

**Gathered:** 2026-09-09
**Status:** Ready for planning
**Source:** Bounty premise (`~/.claude/roles/box-maintainer/bounties/pv-context-pct-batch-sweep-drop-capture-pane/bounty.json`). Design agreed with Ashley 2026-09-09 in-conversation, immediately after Phase 92 UAT revealed the SFTP file-fetch bug wasn't fully resolved by the fleet-status batch collapse alone.

<domain>
## Phase Boundary

Sibling to Phase 92 for the SECOND wasteful-exec pattern hitting the shared Skynet-host SSH connection. Three-part scope (re-scoped 2026-09-09 late — Ashley chose to kill plan mode at the source rather than migrate the plan-pending detector to an FS marker):

**Part A — disable Claude Code plan mode fleet-wide via distributor.** Extend the distributor to patch each managed box's `~/.claude/settings.json` (or equivalent Claude Code settings file — researcher confirms the exact path) to add `ExitPlanModeV2Tool` + `EnterPlanModeV2Tool` (or whatever the exact tool names are — researcher confirms) to `disallowedTools`. Ships alongside the existing per-user hook install pattern in `src/backend/fleet-status/remote-hook-install.ts` or the equivalent settings-patch site. Verified 2026-09-09 fleet-side grep across 5 identities × ~150 total sessions on t1000: **zero actual plan-mode `tool_use` invocations** — plan mode is effectively unused on the fleet. Killing it does not break any existing workflow. Post-Part-A: Claude Code never enters plan mode, `ExitPlanModeV2Tool` never fires, no "plan pending" state ever, capture-pane's plan-pending detection is dead code.

**Part B — drop `tmux capture-pane` from the per-tick context-pct loop, plus the entire plan-pending code path.** The code at `src/backend/claude-session/claude-session-server.ts:7569` fires every 3 seconds per open PrettyView WebSocket:
1. `readContextPctFromJsonl` — up to 4 `tail -c 10000/50000/200000/512000` execs on the identity session JSONL (expansion loop until enough data).
2. `tmux capture-pane -p -t <session>` — 1 exec per tick, feeding two downstream consumers:
   - `parseContextPct` scrape → drop; JSONL is authoritative.
   - `isPlanPending` / `parsePlanFilePath` → drop; plan mode never happens post-Part-A.

Delete alongside: the `{ type: "plan_pending", pending }` WS frame emit path, the plan-content cache, the `fetchPlanFile` SFTP side-channel (`src/backend/ssh/plan-file-fetch.ts`), and the frontend `plan_pending` frame handlers. Ashley 2026-09-09 verbatim on the direction: *"tmux capture-pane shouldn't be in there. get rid of it."* — with the follow-up *"remove the plan capture and adjust whatever gets distributed by the substrate distributor to disallow use of plan mode in the first place."*

**Part C — batch-coalesce the per-identity tail execs into one exec per host per tick.** Same shape as Phase 92: distributor-shipped Python sweep script that walks all open-PV-subscribed identities on the host and emits ONE JSONL blob per identity with `context_pct` (only — no plan-pending after Parts A+B). Caller in `claude-session-server.ts` invokes ONE sweep exec per host per 3s and dispatches parsed results back to per-WebSocket downstream.

Rollout mirrors Phase 92 exactly: distributor-shipped so peers get it on next Skynet-container-restart; backward-compat fallback to legacy per-tail execs when the script is absent (mid-rollout); presence probe cache per-SSH-channel-lifetime with null-exec re-probe recovery and schema-mismatch latch.

Trigger: 2026-09-09 Phase 92 UAT showed the fleet-status batch collapse was 100% delivered (all 8 substrate hosts on batch, zero fleet-status-source Channel open failures) but SFTP file-fetch still 0/30 pass because a SECOND consumer (this one) was firing ~5 execs/second on the same connection. Measured 355 exec commands in 20s during the failing SFTP loop, dominated by `tail -c 10000/50000` and `tmux capture-pane` calls.

Same disease as pre-Phase-92 fleet-status. Same shape of fix for Part C. Reuses the Phase 92 distributor pattern + presence probe pattern + backward-compat fallback pattern verbatim.

**Related sibling phase (deferred):** Phase 96 (or next available slot) — unify all remaining un-semaphored SSH connections under a fleet-wide semaphore. Phase 95 addresses the specific measured pain (PV context-pct exec pressure); Phase 96 is the concept-level architectural safety net Ashley asked for during Phase 95 discussion. Kept separate: batch REDUCES work (Phase 95), semaphore SERIALIZES work (Phase 96) — different problems, different solutions.

</domain>

<decisions>
## Implementation Decisions

### Part A: disable plan mode fleet-wide via distributor

- **Extend the distributor to patch `~/.claude/settings.json` per managed box** (or per-user; the fleet-status hook install path in `remote-hook-install.ts` already writes to per-user settings — same mechanism). Add `EnterPlanModeV2` + `ExitPlanModeV2` (researcher confirms exact tool names) to `disallowedTools` array. Idempotent: if the entries already exist, no-op.
- **Roll out via existing distributor sweep cycle** — same 30s retry pattern that already patches `.claude/settings.json` for fleet-status hooks. No new mechanism.
- **Fleet-side use verified 2026-09-09: zero real `tool_use` invocations of ExitPlanModeV2 across 5 identities × ~150 sessions on t1000.** Only `deferred_tools_delta` schema registration (harmless per-session boot noise). Killing plan mode does not break any observed workflow.
- **Peer-box confirmation deferred:** grep couldn't reach fleet peers by short hostname (DNS resolution) during verification. Reasonable assumption: peer boxes running the same identity/agent workflows have similar (near-zero) usage. If Part A ships and any peer hits an unexpected UX regression from disabled plan mode, revert via `disallowedTools` array removal — no code changes needed.

### Part B: capture-pane + plan-pending code removal

- **`tmux capture-pane -p -t <session>`** in the contextPctTimer callback → delete.
- **`parseContextPct` scrape fallback → drop.** JSONL is authoritative for context-pct. If `readContextPctFromJsonl` returns null (fresh session with no user turns yet, exec fail, etc.), emit null pct and let the frontend show the loading state.
- **`isPlanPending` + `parsePlanFilePath` in `plan-pending-parser.ts` → delete the file.** No consumers post-Part-A.
- **The `{type:"plan_pending", pending}` WS frame emit path in claude-session-server.ts → delete.** Includes the plan-content cache, the `planPendingLastSerialized` change-only guard, and the plan-content-delivery seam.
- **`src/backend/ssh/plan-file-fetch.ts` → delete.** Phase 24's plan-file SFTP side-channel is unused post-Part-A.
- **Frontend `plan_pending` frame handlers → delete.** Any UI affordance for pending plans becomes dead code.
- **The Symmetric-behavior comment on line 7587** ("keep behavior symmetric while validating the swap") → obsolete; delete alongside the capture-pane exec.

### Part C: batch sweep script

- **One sweep script per host per 3s tick.** Runs server-side, walks all open-PV-subscribed identities (identity list passed as arg or read from a well-known state file — researcher decides), emits one JSONL line per identity with `context_pct`, `plan_pending`, `schema_version=1`, and whatever else the researcher determines is needed for parity with today's per-tail-exec output.
- **Language: Python 3 stdlib-only.** Mirrors Phase 92 sweep script (`substrate/scripts/fleet-status-sweep.py`) and other distributor-shipped helpers. Ports the tail-expansion loop from `context-pct-from-jsonl.ts` server-side.
- **Distributor-shipped.** New catalog entry in `src/backend/distributor/catalog.ts` mirroring Phase 92-03 exactly. `bundledPath: /app/fleet-substrate/scripts/pv-context-pct-sweep.py` (or similar), `installPath: ~/.local/bin/pv-context-pct-sweep`, `restartHook: null`. Bump `catalog.test.ts` row-count assertions (Test 1: 22→23, Test 6: scriptRows 8→9).
- **Backward-compat fallback preserved verbatim.** The legacy per-tail-exec path stays intact for boxes mid-rollout. When the sweep script is absent (`test -x` probe returns false), or emits null-exec / schema-mismatch, the caller falls back to legacy per-WebSocket per-identity tails. Byte-identical behavior.
- **Presence probe cache per-SSH-channel-lifetime.** Same pattern Phase 92 uses (see `pollOneHost` in ssh-poll-orchestrator.ts). New PerConnection state field on whatever tracks the claude-session-server's SSH connections.

### Non-negotiables (borrowed from Phase 92)

- **Schema versioned** (`schema_version: 1` on every JSONL line).
- **Parity with today's collected state.** No expansion of what the sweep collects vs today's per-tail-exec — same fields, delivered differently.
- **Change contained** to `src/backend/claude-session/`, `substrate/scripts/`, and one distributor catalog row. No changes to `src/backend/ssh/` pool, semaphore, or connection management.
- **Legacy path preserved verbatim** as fallback — extract to a helper function; don't delete.
- **No `--no-verify`, no destructive git, no push during phase execution** (deploy is orchestrator-owned per fleet rule).

### Verification

- Every managed box's `~/.claude/settings.json` contains `EnterPlanMode` + `ExitPlanMode` in `permissions.deny` after distributor next sweep cycle (30s post-deploy).
- Container log free of `tail -c 10000/50000/200000/512000` executions from the context-pct pipeline under normal PV load (10s window with 5 open tabs).
- Container log free of `tmux capture-pane -p -t <session>` from the context-pct pipeline (the aside-subsystem capture-pane calls at L7982/L8013 are OUT of scope and stay).
- Zero `tool_use` invocations of `EnterPlanMode` / `ExitPlanMode` in freshly-produced session JSONLs (existing `deferred_tools_delta` schema noise in `addedNames` is harmless and not a verification target).
- Regression tests: exec-collapse assertion (1 sweep per host per tick vs N tails per identity), batch-vs-legacy parity on emitted `context_pct`, no `plan_pending` frame ever emitted.

**Out of scope for this phase's verification:** any downstream `Channel open failure` or SFTP file-fetch reliability question. Phase 95 delivers a batch-collapse + a feature-kill + a code-hygiene deletion; whether an unrelated pool consumer's reliability improves is not what this phase is verifying. SFTP-pool topology is Phase 96 territory (fleet-wide semaphore) and gets its own verification bar there.

### Claude's Discretion

- Exact sweep-script filename (`pv-context-pct-sweep`, `pv-sweep`, etc.).
- Exact JSONL field names — match the caller-side variable names where reasonable.
- How the sweep script learns which identities are subscribed (arg, state file, etc.).
- Exact settings.json patch shape — mirror the existing hook-install pattern.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The code being modified

**Part A (distributor settings-patch):**
- `src/backend/fleet-status/remote-hook-install.ts` — existing pattern for patching per-user `~/.claude/settings.json`; extend or mirror.
- Fleet-substrate bootstrap sequence (per Phase 75) — where the settings-patch fires per host.

**Part B (deletions):**
- `src/backend/claude-session/claude-session-server.ts` L7569–L7700 (approx) — the `contextPctTimer` `setInterval` callback. Delete the capture-pane exec + all plan-pending downstream code.
- `src/backend/claude-session/plan-pending-parser.ts` — DELETE the file entirely (`isPlanPending`, `parsePlanFilePath`).
- `src/backend/ssh/plan-file-fetch.ts` — DELETE (Phase 24 plan-file SFTP side-channel; unused post-Part-A).
- `src/backend/claude-session/context-pct-parser.ts` — `parseContextPct` (the pane-scrape fallback being dropped). Confirm no other callers before deletion.
- Frontend `plan_pending` frame handlers — grep + delete.
- Any tests exercising plan-pending — delete/prune (no functional replacement; feature is gone).

**Part C (batch sweep):**
- `src/backend/claude-session/context-pct-from-jsonl.ts` — `readContextPctFromJsonl` + `TAIL_EXPANSION_STEPS = [10_000, 50_000, 200_000, 512_000]`. The tail-expansion logic to port server-side.
- `src/backend/claude-session/claude-session-server.ts` — rewire the contextPctTimer callback to dispatch batch sweep + parse.

### Phase 92 reference (mirror this pattern)

- `~/skynet-tina/.planning/phases/92-fleet-status-poller-batch-sweep-one-exec-per-host-not-one-pe/` — the entire phase directory. Especially:
  - `92-CONTEXT.md` — locked decisions
  - `92-RESEARCH.md` — HIGH-confidence enumeration
  - `92-01-PLAN.md` — schema module pattern
  - `92-02-PLAN.md` — Python sweep script pattern (isAshleyRealUserTurn port, safe-char guard, always exit 0)
  - `92-03-PLAN.md` — distributor catalog + test assertion changes
  - `92-04-PLAN.md` — caller rewire (batch-first / legacy-fallback, presence probe cache, null-exec re-probe, schema-mismatch latch)
  - `92-05-PLAN.md` — regression tests + human-verify UAT checkpoint
- `substrate/scripts/fleet-status-sweep.py` (HEAD `c1a84038`) — the Phase 92 sweep script. Copy its structure for the new PV context-pct sweep.
- `src/backend/fleet-status/sweep-schema.ts` (HEAD `e954c047`) — schema module pattern. Design a sibling for pv-context-pct.

### Distributor mechanics

- `src/backend/distributor/catalog.ts` — where to register the new sweep script (add row, mirror Phase 92-03 shape).
- `src/backend/distributor/catalog.test.ts` — bump Test 1 (22→23) and Test 6 (scriptRows.length 8→9) + comment enumerations.
- `src/backend/distributor/run-sweep.test.ts` — Test 1 count assertion (per Phase 92-03 Rule 3 auto-fix).
- `src/backend/distributor/sweep-logic.ts` / `ssh-push.ts` — mechanism only, no changes needed (composer auto-picks-up new catalog row).

### Related bounty

- `~/.claude/roles/box-maintainer/bounties/pv-context-pct-batch-sweep-drop-capture-pane/bounty.json` — the bounty premise + 7 todos.

</canonical_refs>

<specifics>
## Specific Ideas

- **Enumerate first, code second** (Phase 92 lesson): Task 1 of the plan enumerates the current exec sites in the context-pct pipeline + all plan-pending code paths + all callers.
- **Part A ships FIRST** before Part B deletions — the settings-patch has to be live on managed boxes so Claude Code stops emitting plan-mode signals BEFORE the backend stops reading them. Otherwise there's a window where plan mode can be entered but Skynet can't detect it (users would get stuck waiting for approval that never renders). Consider a wave-ordering hard-dependency: Part A wave completes + verified in prod before Part B deletion wave starts.
- **Reuse Phase 92 test patterns.** `ssh-poll-orchestrator.test.ts` has `MockSshChannel`, `MockRegistry`, `buildDeps`, `makeSessionJson`, etc. that the new tests can mirror.
- **Plan-pending deletion is safer than migration.** With plan mode disallowed at the source (Part A), there is no downstream state to preserve — every plan-pending code path is dead post-Part-A.
- **Test discipline** (fleet rule): never leave tests failing. Existing tests must remain green. New regressions must pass before commit.
- **Deploy is orchestrator-owned** — phase's "done" state is: PR-ready, tests green, UAT checkpoint prepared for Ashley. She owns the ship motion.

</specifics>

<deferred>
## Deferred Ideas

- **Wider batch beyond context-pct.** Widget collectors, tunnel state polls, etc. are separate patterns and get their own follow-up phases.
- **Removing the legacy per-tail path entirely.** After N months of stable batch, a later phase can drop legacy. Keep it in this phase as safety net.
- **Loosening or removing the fleet-status semaphore** (deferred from Phase 92 too).

</deferred>

---

*Phase: 95-pv-context-pct-batch-sweep-drop-capture-pane-phase-92-sibling*
*Context gathered: 2026-09-09 — seeded from bounty premise (design agreed in-conversation with Ashley same day, immediately after Phase 92 UAT revealed the second consumer)*
