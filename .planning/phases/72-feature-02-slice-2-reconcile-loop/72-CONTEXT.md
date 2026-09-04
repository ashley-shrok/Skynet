# Phase 72 CONTEXT.md — feature 02 slice 2 (Skynet-side reconcile loop for the fleet-substrate distributor)

**Seeded from:** `.planning/shapes/shape-feature-02-slice-2-reconcile-loop.md` (opened + locked 2026-09-04 in `/build` → `/open` this session; every shape-level gray area — trigger, cadence, audit-log surface, per-host flag, catalog shape, iteration model, restart hooks, mode preservation, error containment, log-line detail level — was worked through with Ashley and greenlit `thumbs up`). The shape file IS the design source of truth; this CONTEXT.md preserves its full text verbatim so downstream agents (`gsd-phase-researcher`, `gsd-planner`) read the same agreement.

**No further discuss-phase gray areas.** All remaining questions are implementation-level (exact insertion point in `ssh-poll-orchestrator.ts` for the sweep-piggyback hook, migration authoring pattern inside `db/index.ts`, catalog file layout inside the new `src/backend/distributor/` module, exact log-tag naming discipline, test file layout) — these belong to `gsd-phase-researcher` (codebase discovery) and `gsd-planner` (decomposition), not to further Ashley discussion. `AskUserQuestion` was skipped this pass because presenting decided items back for re-selection is friction, not value.

## Canonical refs (MANDATORY — downstream agents MUST read)

- `~/skynet-tiffany/.planning/shapes/shape-feature-02-slice-2-reconcile-loop.md` — the shape agreement locked with Ashley this session. IDENTICAL to the "Shape" block below in this CONTEXT.md; kept as an external ref because `/close feature-02-slice-2-reconcile-loop` at end-of-phase will verify built code against THAT file.
- `~/.claude/roles/box-maintainer/bounties/ai-plus-mvp-project/feature-02-skynet-distributor.md` — the feature-level design doc, LOCKED 2026-09-03. Governs slice sequencing (this is slice 2 of ~4), the 15-item catalog contents, the KillMode=process invariant, and what belongs in later slices (admin UI = slice 3, per-identity CLAUDE.md manifest = slice 4, self-update-block retirement = last slice). Read the "Design (locked)" section top-to-bottom.
- `~/.claude/roles/box-maintainer/bounties/ai-plus-mvp-project/PROJECT.md` — the AI+ MVP project overview, LOCKED with recent 2026-09-04 multi-VM-isolation pivot. Governs the implementation-order slot for this phase and the "each per-exec VM has one ubuntu user" invariant that collapses per-linux-user iteration to single-user.
- `~/skynet-tiffany/.planning/shapes/shape-feature-02-slice-1-vendor.closed.md` — slice 1's just-closed shape doc. Governs the canonical bundled-bytes location `/app/fleet-substrate/` inside the container image + the mirrored install-layout convention (`skills/` vs. `scripts/` split) that slice 2's byte-compare relies on.
- `~/skynet-tiffany/src/backend/fleet-status/ssh-poll-orchestrator.ts` — 2183 lines, LOAD-BEARING. Slice 2's sweep piggybacks on this file's per-host channel-acquisition moment. Planner + researcher MUST read this file end-to-end and hold its per-host state model (`perHostState: Map<string, PerHostState>`), 2s poll cadence, 30s host-list refresh, per-host in-flight guard (`inFlight: Set<string>` — the wilma-260820 incident guard), and evict-branch behavior in their head before writing the hook. **The entire slice's philosophical guardrail is: do not degrade this system.**
- `~/skynet-tiffany/src/backend/fleet-status/liveness-check.ts` — 107 lines, pure. Shows the pattern for a "pure library + injected transport" split that the sweep runner should follow: the sweep-decision + byte-compare + catalog logic should be pure functions taking already-fetched bundled bytes + already-fetched installed bytes as inputs, so tests don't need SSH.
- `~/skynet-tiffany/src/backend/ssh/ssh-connection-pool.ts` (225 lines) + `~/skynet-tiffany/src/backend/ssh/ssh-one-shot.ts` (95 lines) — Skynet's existing SSH primitives. The sweep must NOT open its own new SSH; it uses the orchestrator's already-held `SshChannel.exec()`.
- `~/skynet-tiffany/.planning/ROADMAP.md` — Phase 72 entry (goal + requirements + depends-on).
- `~/skynet-tiffany/.planning/STATE.md` — Phase 72 Roadmap Evolution entry (adds slot-collision context vs. tina's incoming Phase 71).
- `~/.claude/roles/box-maintainer/box-maintainer.md` — box-maintainer role file. Directive-level constraints that apply to executor + orchestrator: full-suite green as ship-gate (§ Test discipline), executor-scope-stops-at-commits-and-scoped-tests (§ Container mutations serialize; § Subagents don't do deploys), push-boundary at `git push` not at `--force-recreate` (§ ⚠️ The deploy-window boundary), Skynet in-memory SQLite direct-writes need `DatabaseSaveTrigger.forceSave` (§ Load-bearing invariants — governs the migration authoring). NO WORKTREES.

## Code context

- **Hook insertion site (identified during /open investigation, planner to confirm exact line):** `ssh-poll-orchestrator.ts` lines 1899–1992 hold `pollAllHosts()`. The 30s-cadence refresh branch calls `tryAcquireHostChannel(host)` for hosts newly in the identity-hosting list. Successful acquisition = new entry landing in `perHostState`. The sweep-piggyback subscribes to that success — either via a callback injected into `deps.acquireSshChannel` or via a post-add step in the loop. Planner: which shape fits the existing `OrchestratorDeps` interface cleanly?
- **Migration site:** `src/backend/database/index.ts` (per role file "Load-bearing invariants" — in-memory SQLite, `new Database(decryptedBuffer)` load, `DatabaseSaveTrigger.forceSave` required after any `db.insert/update/delete().run()`). The `runs_fleet_substrate BOOLEAN` column migration follows the same pattern Phase 69's `runIdentitiesTableDrop` boot-migration used (per Roadmap Evolution). Look for `migrateSchema()` and its recent additions.
- **Console-forward log surface (audit trail lands here):** `/opt/skynet/console-forward-logs/console-forward.log` (per role file "Standing directive: Logging is cheap and batched to the console-forward server"). Existing `systemLogger.info/warn` pattern with `operation: <tag>` metadata field. New tags to use: `fleet_substrate_sweep_result` (per-sweep-per-host summary, always emitted); `fleet_substrate_item_changed` + `fleet_substrate_item_failed` (per-item, non-current only). Follow the tag-naming convention already established in `ssh-poll-orchestrator.ts` (`fleet_status_poll_start`, `fleet_status_poll_end`, `fleet_status_host_ssh_unreachable`, etc.).
- **Bundled-bytes location inside container:** `/app/fleet-substrate/` (established by slice 1's Dockerfile `COPY --chown=node:node substrate /app/fleet-substrate` line). Substructure mirrors install layout: `/app/fleet-substrate/skills/<skill>/SKILL.md` (and companions) + `/app/fleet-substrate/scripts/<script>`. Sweep's bundled-side reads happen against this path with mode read from the on-disk file.
- **Catalog target locations (must match managed-host install layout):** skills land at `~/.claude/skills/<skill>/<file>` and standalone scripts land at their canonical spot per script (supervisor at `~/.local/bin/agent-supervisor` per feature-02 doc; usage-reporter/context-watch/wakeup-scheduler pathways per role file substrate/ contents for the exact 15). Planner: enumerate the 15 items and their target paths from `~/.claude/roles/box-maintainer/substrate/` and cross-check against feature-02 doc.
- **KillMode=process invariant reference:** `~/.claude/roles/box-maintainer/agent-supervisor-handoff.md` § core invariants covers why `systemctl --user restart agent-supervisor` is safe (does NOT kill supervised tmux sessions). Planner reads this before writing the restart-hook code.

---

# Shape: The quiet machinery inside Skynet that keeps the fleet's bundled agent equipment reaching every managed host that should be running it

**Opened:** 2026-09-04
**Vehicle:** GSD phase

## What this is

Slice 2 of feature 02. Slice 1 landed a canonical copy of the 15 shared-equipment items inside Skynet's own code tree and made the container image carry them at a stable location. Slice 2 makes those bundled bytes start actually reaching the managed hosts that run agent substrate — quietly, without any user-visible surface, without any admin knobs. It's the plumbing layer that later slices sit on top of.

## Shape

Four conceptual parts:

- **A per-host sweep.** For each managed host that is flagged as running the shared equipment, walk the bundled item catalog, byte-compare bundled vs. installed on the target, push over anything stale, and if the item needs re-execution to take effect (the supervisor daemon is the concrete case) fire the small restart hook the catalog names for it. Every substrate item declares its own restart hook (mostly "none"; the supervisor is the one that isn't).

- **A trigger that fires at most once per host per Skynet instance lifetime.** The sweep piggybacks on the existing per-host connection machinery that Skynet already runs to keep tabs on every managed host — the same machinery that already opens a persistent channel to each identity-hosting host shortly after Skynet starts and refreshes the host list on its own cadence. First time that machinery successfully opens the channel for a host this instance, the sweep runs on that channel. An in-memory map remembers which hosts have been swept this instance; a container restart wipes the map, and the next successful channel acquisition per host runs the sweep again. There is no interval timer, no cron, no scheduling primitive of its own — the trigger IS the natural moment the connection first comes up.

- **A per-host opt-in flag on the host record.** New yes/no column, default no. RDP-only hosts stay no. Identity-hosting hosts default no as well and get flipped yes by an operator (or by the provisioning path for freshly-created exec VMs, which sets yes from the get-go). This is the narrower filter that lets a Skynet operator opt an identity-hosting host OUT of distributor push (for example, a research host where the operator wants to run experimental substrate versions without them being reconciled back to bundle). Adds a small migration that adds the column.

- **A grep-friendly trail of what happened, in the log stream Skynet already writes.** Two levels: one summary line per sweep per host — always emitted, tagged so grep on the host name pulls the sweep-per-restart story — and per-item detail lines only when the outcome is anything other than "everything already matched bundle." No new database concept for the trail. The primary reader is a box-maintainer identity diagnosing why something didn't propagate; grep on host name or item slug gives them the story without any new UI.

The bytes carried over reflect the bundled file's own mode as committed in git — the sweep mirrors the bundled mode to the installed side rather than declaring mode per catalog entry. What git thinks the mode is IS the source of truth.

Iteration on each host is against a single Linux user (the one that runs agent substrate on that host — ubuntu, in every case the fleet actually uses today). The pre-pivot "iterate every Linux user with an agent config directory" model in the feature doc collapses to a single-user check under the multi-VM isolation model, since each exec VM has one Linux user.

## Philosophy

- **Quiet slice.** Nothing user-visible, no admin knobs, no new endpoints, no runtime behavior surface a Skynet user would notice. Bundled bytes reach hosts; that's the change.
- **Piggyback, don't build parallel infrastructure.** The existing per-host connection machinery already opens SSH to every identity-hosting host every 2 seconds. Slice 2 subscribes to a natural moment inside that machinery rather than introducing its own timer, its own SSH connection pool, its own scheduling primitive.
- **Zero coupling between the sweep and the existing poll.** The sweep runs on the same channel the poll uses, but its errors are contained inside itself — the sweep never throws upward, never leaves the channel in a weird state that would degrade the 2-second poll. Fire-and-forget from the poll's perspective. If the sweep hangs, the sweep hangs; the poll keeps ticking.
- **Trail lives where diagnostics already live.** The console-forward log is what a box-maintainer identity reaches for first when something breaks. New tags land there rather than in a new database concept nobody's going to look at.
- **The catalog is small and hand-maintained.** 15 items today, growing slowly. Each item declares its bundled location, its install location, and its restart hook (if any). Reviewable, not auto-generated.

## Prior context

- Slice 1 shipped 2026-09-04 as a "quiet slice" — vendored the 15 items into Skynet's tree at a canonical top-level location, one line added to the image recipe. No behavior change. Slice 2 is the first slice where behavior actually starts happening: bundled bytes reach hosts.
- The full feature-02 design (per-host flag, per-item catalog, byte-compare, restart hook for supervisor, push mechanism, failure surface) is design-LOCKED in the feature doc under `~/.claude/roles/box-maintainer/bounties/ai-plus-mvp-project/feature-02-skynet-distributor.md`. Slice 2 is the first vertical cut of that.
- Skynet already opens a dedicated persistent SSH channel per identity-hosting host and executes shell commands on it every 2 seconds as part of its fleet-status polling. The host list is refreshed from the DB on the polling machinery's own cadence, and channels for newly-added hosts are acquired then. This is what makes the piggyback trigger work with essentially zero new SSH infrastructure.
- The invariant that keeps the supervisor restart-during-upgrade safe (the supervisor's `KillMode=process` unit setting) has been in place across many prior supervisor upgrades and has held reliably. Slice 2 leans on that invariant; it does not have to re-establish it.
- Slice 3's admin UI is no longer assumed. If it turns out we never need one — because operator diagnostics via log grep is sufficient — that's fine, and slice 2 must not be designed around a downstream reader that may never exist.

## What would make it wrong

- **The sweep is not actually quiet.** If a Skynet user notices anything about how the app behaves — latency spikes on the fleet-status view, weird UI states, extra logs in surfaces they read — the slice has missed the point. The user-facing surface is unchanged.
- **The sweep hangs or misbehaves in a way that degrades the 2-second poll.** The whole reason to piggyback rather than build a parallel channel pool is that the existing poll is battle-tested and load-bearing. If the sweep breaks that, we've regressed a system we were supposed to just borrow from.
- **The sweep runs when the flag is off.** A host without the opt-in must not be touched, ever. If any bundled byte ever lands on a host whose flag was no, the operator's opt-in choice was silently violated.
- **A container restart re-pushes bytes that already match.** The byte-compare must actually gate the write. If the sweep pushes on every acquisition regardless of whether bundled equals installed, we've defeated the whole point of the compare and we're generating noise for no reason.
- **Modes don't come across.** A script lands on a host but silently doesn't run because its exec bit was dropped somewhere in the push. The trail says "pushed successfully" and the host is broken. Every push must preserve the bundled file's mode as committed in git.
- **The trail is unreadable.** If grep on a host name doesn't pull the sweep-per-restart story, or if the per-item detail lines don't say what changed, the trail exists on paper but not in practice. The primary reader (a diagnosing operator) has to be able to read the story without loading the codebase into their head.
- **A downstream reader gets designed in.** Slice 3's admin UI is soft. If slice 2 introduces a schema, a table, or an internal endpoint whose only purpose is to serve a UI that may never exist, we've paid cost for a speculative consumer.
- **The runtime code that lands starts calling into anything under the bundled substrate location for its own logic.** The bundled bytes are for pushing to hosts, not for Skynet to execute against itself. If Skynet starts wiring the shared equipment into its own runtime flow, we've conflated two purposes.

## Scope edges

- **IN:** the sweep runner; the per-host opt-in flag + its migration; catalog of 15 items with bundled path, install path, and restart hook per item; byte-compare and mode-mirroring push over the existing per-host channel; restart hook fired for the one item that needs it; sweep triggered from the natural channel-acquisition moment; summary + per-item log lines with sweep-friendly tags; error containment so the sweep never degrades the existing poll; tests exercising the sweep against a mock channel including happy path, mismatch-push, ssh-failed, write-failed, restart-failed.
- **OUT:** any admin surface for reconciling from the UI. That is slice 3 if it happens at all.
- **OUT:** the per-identity manifest file at each identity's working-dir root. Slice 4.
- **OUT:** deleting the self-update block from any shipped skill. Last slice.
- **OUT:** any interval timer / cron / scheduled sweep. Trigger is first-successful-channel-acquisition only.
- **OUT:** any admin-triggered "sweep now" endpoint. Deferred; add if we find ourselves wanting it.
- **OUT:** SSH connection-reuse config (ControlMaster / ControlPersist). The existing per-host channel already IS the connection reuse.
- **OUT:** per-linux-user iteration on a host. Single ubuntu user per host under the multi-VM model.
- **OUT:** healing drift from below (someone hand-modifies an installed file on a host without changing bundle). Bundle-side is the source of truth; drift-from-below is not swept back automatically. If it becomes a real problem, add a floor timer in a follow-up.
- **OUT:** any actual ship of slice 2. Code motion is authorized on the pre-authorization from start-of-session; the ship is not. Slice 2 ends when commits are on the branch, targeted-scope tests pass, full suite passes at the orchestrator ship-gate — and then STOPS for greenlight.
- **DEFERRED:** the operator-peek internal endpoint ("what's the current state of the fleet right now, without ssh'ing everywhere"). Log grep is fine for now; add the endpoint later if the grep story bites.
- **DEFERRED:** restarting the receiver / scheduler / context-watch after their bytes are updated. They naturally pick up new bytes on next identity reload; not worth kicking during sweep.

## Vehicle notes

**Vehicle:** GSD phase. Slice 2 is code-writing (new backend module, migration, new hook site in the existing polling machinery, log-tag additions, tests), which is exactly what the phase pipeline is for. Fleet directive is explicit: phase-sized code work gets a phase, don't route around the ceremony.

Phase slot: pick as I open (auto-resolve if collision with another identity's already-planned slot, per the box-maintainer fleet rule that the later mover renumbers without asking).

Phase working directory: `~/skynet-tiffany/.planning/phases/NN-feature-02-slice-2-reconcile-loop/`, where NN is the picked slot.

Working tree: `~/skynet-tiffany`, branch `feat/tab-title-from-tmux` (standard box-maintainer working tree).

Related bounty: `ai-plus-mvp-project` (feature 02 lives inside it; slice 1 also referenced this bounty).

Push is NOT authorized as part of slice 2's execution. Executor motion stops at commits + scoped-tests green. Full-suite green happens at the orchestrator ship-gate before push. The push itself waits for Ashley's explicit greenlight per the standing push-boundary rule. Deploy (docker build + force-recreate + verify) is orchestrator-owned and happens after greenlight, per the standing rule that executors don't do deploys.

Slice 2 execution must not touch anything under the bundled substrate location — the substrate is for pushing to hosts, not for Skynet to execute against itself. Any runtime code inside Skynet that reaches into the bundled path is a red flag against the philosophy.

The existing per-host polling machinery is `src/backend/fleet-status/ssh-poll-orchestrator.ts` (2183 lines, load-bearing). The hook site is inside `tryAcquireHostChannel` (or wherever channel acquisition is confirmed successful, once discovery in planning nails the exact insertion point). Whoever plans this phase must read that file end-to-end and hold its per-host state model, in-flight guard, refresh-tick logic, and evict-branch behavior in their head before writing the hook — the entire slice's philosophical guardrail is "don't degrade this system."
