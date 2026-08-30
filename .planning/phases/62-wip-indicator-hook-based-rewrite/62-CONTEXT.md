# Phase 62: WIP-indicator hook-based rewrite — Context

**Gathered:** 2026-08-30
**Status:** Ready for planning
**Source:** Direct-seeded from `.planning/shapes/shape-wip-indicator-hook-based-rewrite.md`. Discuss-phase skipped per `/build` convention when the shape file already captures scope + philosophy + failure modes (precedent: Phase 53, Phase 56, Phase 57, Phase 58). Shape was authored across ~15 turns of design conversation between Ashley + Tina 2026-08-30 and reset before pick-up; that conversation is not carried into planning — the shape file is the sole agreement.

## What this is

The conversation-list affordance that tells Ashley "this agent is currently working, don't interrupt" (equivalently: the absence of that affordance means "ready for your next instruction, safe to click") is unreliable today. On agents that are heavily active — long turns, lots of tool use, always-on — it stays lit even when the agent is idle. The affordance's whole job is to steer where Ashley clicks next; while it lies, it can't do that job. This phase retires the guessing-based mechanism entirely and rebuilds it on a direct signal from the harness itself.

## Motivating symptom (RCA locked mid-session 2026-08-30)

Live console-forward log 13:33–13:37 UTC showed Nelly session `8c514421` oscillating `status:busy → status:shell` across every turn while Nelly was in the harness, actively responding, always-on (`.no-dormancy` present), running four ambient monitors.

**Current predicate** (`shellCountsAsWork` = `status==="shell" && lastStatusChangeAt > lastStopAt`) false-positives because return-to-shell after each Stop bumps `lastStatusChangeAt` to poll-tick time — always AFTER the just-mtime'd `lastStopAt`. Result: `shellCountsAsWork` stays true forever regardless of whether real work is in flight. This is NOT the `bg_tasks-leak` hypothesis from bounty `nelly-phase-61-axes-stayed-null-on-thenasty` (that bounty's Bug 1b self-resolved); the WIP false-positive persists via this different mechanism.

**True fix requires retiring the whole shell-idle-gate heuristic** — smoothing on top of the same signals will produce the same class of bug.

## Shape (verbatim from shape file, §Shape)

The current mechanism infers whether an agent is working by combining two indirect signals: a state label the harness writes to its own status file, and a per-tick observation of what command owns the terminal pane. Both of those oscillate multiple times inside a single normal turn, so a heuristic gate was layered on top to smooth them. The gate false-positives on any agent whose lifecycle naturally cycles through those states — which is every real agent in production use. That is the bug.

The replacement stops inferring and instead asks the harness to tell us directly. The harness already fires named lifecycle notifications at every meaningful moment — turn beginning, tool call beginning, turn ending, error ending a turn, permission decision needed, and many others. We install a very small subset of those as hooks on each managed box. Each installed hook does one thing: touch a well-known marker file. There are two such marker files per running agent session — an **activity** marker and a **stopped** marker.

- **Activity marker touched by:** `UserPromptSubmit` (Ashley submitted a prompt), `PreToolUse` (agent began invoking a tool).
- **Stopped marker touched by:** `Stop` (turn finished cleanly), `StopFailure` (turn ended in error), `PermissionRequest` (agent blocked waiting on Ashley for a permission decision).

That last one is a deliberate design choice — from the affordance's perspective, "agent is waiting on you" is the same as "agent is done": both mean the row deserves Ashley's attention right now.

The backend predicate collapses to a single comparison:

> **`activity_marker_mtime > stopped_marker_mtime` → working (affordance lit); else → not working (affordance off).**

No state machine, no smoothing, no oscillation to fight.

The old guessing-based machinery — the status-label enum, the pane-command polling for this purpose, the heuristic gate, the derived transition timestamp that fed it — comes out entirely.

## Philosophy (verbatim from shape file, §Philosophy)

The mechanism should NOT try to be clever about lifecycle. Don't paper over noisy signals with heuristics; instead, subscribe to authoritative signals and read them directly. Where the harness has already done the work of knowing when something is happening, we consume that; we don't re-derive it from side-channels.

The affordance's only job is to answer one question: **"should Ashley look at this row?"** Every design choice serves that question. That's why waiting-on-permission is treated the same as done — from the answering-the-question perspective they are the same. That's why long-running tool execution counts as working — the row isn't calling for Ashley's attention during it. That's why we're willing to accept a small cosmetic wart in the rare permission-approval window — the wart doesn't lie about the question the affordance is answering, it just briefly under-reports on an already-rare code path.

**What would violate the spirit:** reintroducing heuristics to "smooth" the two markers, or adding a second inference layer alongside the direct signal to "catch cases the hooks miss." If a case is missed, that means we picked the wrong set of hooks; the fix is to change which hooks we subscribe to, not to layer a second guessing mechanism.

## Existing surfaces the planner will touch (discovery already done)

Ready-to-plan; no further pre-planning discovery needed. Files identified for the planner's research pass:

- **Hook installer** — `src/backend/fleet-status/remote-hook-install.ts` (+ `remote-hook-install.test.ts`). Already inline-drops `stop-hook.sh` at `~/.claude/hooks/skynet-fleet-status-stop.sh` and merges an entry into `~/.claude/settings.json` at `hooks.Stop[0].hooks[]`. **Extended** — add drops for the four new hook scripts (activity-hook.sh writing to activity marker; stopped-hook.sh already exists but three new events also fire it), plus merge entries at `hooks.UserPromptSubmit`, `hooks.PreToolUse`, `hooks.StopFailure`, `hooks.PermissionRequest` alongside the existing `hooks.Stop`. Reuses same install infrastructure + settings-merge shape.
- **Hook scripts** — sibling `src/backend/fleet-status/stop-hook.sh` (inlined into installer at module load). New sibling `activity-hook.sh` for the two activity events. Both scripts: read stdin JSON (harness payload), `touch` the appropriate marker file at a well-known path per session, exit clean.
- **Backend WIP predicate** — `src/backend/fleet-status/ssh-poll-orchestrator.ts` currently derives the status enum + pane-command signals and computes the shell-idle gate. **Retired** — replaced with `activity_mtime > stopped_mtime` comparison against the two marker files on the remote box (SSH-read of `stat -c %Y <marker>` per session, or equivalent).
- **Wire protocol** — `src/backend/fleet-status/wire-protocol.ts` currently carries the `status` enum, `lastStatusChangeAt`, `lastStopAt`, etc. **Trimmed** — retire the fields that only feed the WIP gate. Keep anything used by orthogonal consumers (background_tasks[], recycling axis — see §Out of scope below).
- **Frontend consumer** — `src/ui/state/session-working-store.ts` + `src/ui/api/fleet-status-types.ts` currently consume the enum + timestamps to compute `isWorking`. **Simplified** — consumes the boolean the backend now emits directly (or the two mtimes, if we keep it client-computed).
- **Tests** — `remote-hook-install.test.ts`, `ssh-poll-orchestrator.test.ts`, `wire-protocol.test.ts`, `session-working-store.test.ts` all need updates. New tests for the two new hook scripts + the new predicate.
- **Ambient filter** — `src/backend/fleet-status/ambient-filter.ts` filters `[ambient]`-prefixed `background_tasks[]` entries out of the `isWorking` count on the OLD path. **Verify it's still relevant** on the new path — the new predicate reads marker mtimes, not background_tasks[]. If the new predicate genuinely ignores background_tasks[] entirely, the ambient filter may still matter for orthogonal display purposes (see § Out of scope) but is out of THIS phase's mutation scope.

## What would make it wrong (from shape file — hard failure modes)

- The affordance lies in the OTHER direction — **false-idle instead of false-working**. An agent is actively mid-turn and the affordance says "ready for your instruction." Ashley clicks into it and interrupts real work. Worse failure than today's bug, and the whole approach would have missed the point.
- The lifecycle signals we chose miss an important trigger of real work — e.g. **async wakes from monitor events don't produce any of our activity hooks**, so an agent woken by another agent's DM looks idle even while responding. If this happens, the fix is to expand the hook set, not to layer inference back in.
- The predicate re-introduces state or smoothing across the two marker files. The point is one comparison; anything more is the shape of the old bug creeping back.
- The migration breaks agents whose managed box hasn't been updated yet — those show permanently-idle (or permanently-working) because the backend expects markers that aren't being touched. Rollout has to consider "what does the affordance show on an unupgraded box" as a real design question, not a footnote.
- The rare-permission-flow wart is worse than described. If real permission approvals routinely last long enough for Ashley to notice the affordance is missing during the approve → tool-completes window, the accepted-wart assumption breaks and we need to revisit.

## Scope

**In:**
- Extending `remote-hook-install.ts` to install the four new hook events (`UserPromptSubmit`, `PreToolUse`, `StopFailure`, `PermissionRequest`) alongside the existing `Stop`. Same install infrastructure + settings-merge shape.
- New sibling `activity-hook.sh` (touches activity marker on `UserPromptSubmit` + `PreToolUse` payloads).
- `Stop`, `StopFailure`, `PermissionRequest` events route to the stopped marker (stop-hook.sh extended or a sibling script).
- New backend predicate reading the two marker files' modification times (SSH `stat` or equivalent per session per poll tick).
- Removing the current status-enum decision logic, the derived `lastStatusChangeAt` transition timestamp, the shell-idle gate (`shellCountsAsWork`), and any pane-command polling that only exists to feed the WIP predicate.
- Per-identity rollout order — **start with the reproducer (Nelly on thenasty)** to confirm before propagating to other identities. Each managed box needs the new hooks installed; on-wake install path or explicit re-install per identity.
- Backend + frontend + wire-protocol test updates. New tests for the two hook scripts and the new predicate.

**Out:**
- The dormant-sentinel mechanism (identity folder sentinel file) — unrelated axis, stays as-is.
- The background-tasks list mechanism and its `[ambient]`-tag filtering (`ambient-filter.ts`) — separate signal, unrelated to WIP-vs-idle, stays as-is.
- Pane-command polling for OTHER purposes than WIP (if any exist) — only the WIP-purpose polling is retired.
- The recycling axis (Phase 53) — orthogonal wire-protocol channel, stays.
- The background_tasks[] cross-identity leak (bounty `nelly-phase-61-axes-stayed-null-on-thenasty` Bug 1b) — already self-resolved, no follow-up needed.

**Deferred:**
- Closing the accepted cosmetic wart in the permission-approve window. Only revisit if operational experience shows the wart matters.
- Any hook additions beyond the five agreed lifecycle events. If we find gaps (e.g. async wakes silently work with no hook firing), we add hooks then — not preemptively.

**Tempting but no:**
- Adding a "smoothing" layer over the two markers to "avoid flicker." The oscillation the current mechanism has doesn't recur here — the markers only move in the direction they're meant to. Any smoothing would be re-inventing the current gate.
- Migrating boxes automatically as a side-effect of the deploy. Install has to be an **explicit act per identity** so we control rollout.

## Rollout / migration story (real design question, not a footnote)

An upgraded backend against an unupgraded box either sees no markers (interpret as: no activity ever = permanently idle) or sees only the pre-existing `Stop` marker (interpret as: last-stop known, no activity known = permanently idle). Both fail toward false-idle, which is the direction of the "worse than today's bug" hard failure mode above.

**Planner must decide the migration approach.** Options:
1. **Backend detects marker absence and falls back to the old predicate** for boxes that haven't been installed yet. Ships old + new machinery in the same deploy; new machinery active on installed boxes, old on uninstalled. Retire the old machinery in a follow-up phase once every box is installed.
2. **Backend defaults to "working"** (safer direction) when no markers are present. Prevents Ashley from getting false-idle and clicking into busy agents. Accepts perpetually-lit affordance on uninstalled boxes as the visible signal that the install is pending.
3. **Explicit install-first flow** — deploy blocks the affordance entirely on uninstalled boxes (or the WIP dot renders as a distinct "unknown" affordance) until each identity has been re-installed. Most conservative; requires the most operational discipline.

Rollout order per Ashley + shape: **Nelly-on-thenasty is the reproducer**. Install there, confirm the false-positive is gone, then propagate. The migration approach chosen affects what "confirm" looks like for the intermediate identities.

## Vehicle notes

GSD phase is the right shape per shape file §Vehicle notes. Work spans a hook installer change, a backend predicate rewrite, deletion of a chunk of existing machinery, tests across two subsystems, and a per-identity migration story. That's not one-shot inline work and it's not `/gsd:quick`-sized.

Executor's remit stops at code + commit + tests green per standing directive (§ Subagents don't do deploys — the orchestrator does). Full-suite green (`npx vitest run`, exit 0) is the ship-gate before `docker build`, not before commit. Per-identity install/rollout is orchestrator-managed after code lands.

## Bounty tracker

`wip-indicator-hook-based-rewrite` (created 2026-08-30, `in_progress`). Parent lineage: earlier failed approach lives in bounty `nelly-phase-61-axes-stayed-null-on-thenasty` (Bug 1a — the axes-null half — self-resolved; Bug 1b — the WIP false-positive — is what THIS phase closes).

## Ready for planning

`/gsd:plan-phase 62 --skip-research` — plan-phase's planner does its own code-side research pass (existing installer shape, backend predicate wiring, wire-protocol trim surface, test coverage map). External framework/pattern research not needed — shape agreement is closed, harness hook documentation was consulted during shape authoring.
