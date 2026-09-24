# Shape: wake-ups backend — global on-disk specs + scheduler + fire-path + per-role sunset

**Opened:** 2026-09-20
**Vehicle:** GSD phase (Phase 127)
**Status:** closed 2026-09-21
**Part of campaign:** `campaign-wake-ups-redesign.md`

## What this is

Shape 1 of the wake-ups-redesign campaign. Delivers the load-bearing plumbing so scheduled wake-ups actually work under the new tissue-model: on-disk global specs per host, a session-independent global-scope scheduler that drops create-identity request files at fire time, extension of the Skynet birth pipeline's request schema to carry roles + skills + prompt, and full retirement of the per-role-wake-up mechanism it replaces. This shape doesn't add any user-facing surface — the modal + CRUD API for user management land in shapes 2 and 3. What ships here makes agents-authoring-wake-ups-by-touching-disk fully functional, and any wake-up spec present on disk (whether hand-written by an agent or migrated from the old per-role convention) births a fresh identity per fire.

## Shape

**The spec.** A wake-up is a small on-disk file per host at `~/fleet/wakeups/<slug>/wakeup.json` — slug-folder + fixed-sentinel-file convention mirroring bounties/runbooks/skills. Carries: a short `name` for scanning, a `prompt` the newborn agent receives, `roles: [...]` one-or-more role names the newborn takes on, optional `skills: [...]`, a `schedule` (interval / daily / weekly / one-shot with timezone), and `enabled`.

**Global scheduler at supervisor scope.** Reuses `substrate/scripts/wakeup-scheduler.py` — dir-agnostic already, extended with a `--mode global` flag that reads the new nested spec layout and drops `~/fleet/spawn-requests/<uuid>.json` at fire time instead of printing a wake-line to a running harness. `substrate/scripts/agent-supervisor.sh` spawns the global-scope scheduler once per host at supervisor startup, session-independent, alongside the existing per-identity ambient watchers.

**Fire path → identity birth via existing coordinator-birthing pipeline.** The dropped spawn-request is consumed by Skynet's existing birth pipeline (used to be coord-only; wake-ups now use the same path). Request schema extended: single `role: string` → `roles: string[]`, new `skills?: string[]` + `prompt: string`. `worker.ts` bridges via `roles[0]` with a D-13 TODO for future multi-role support. Naming falls out of the existing clone-picker.

**Continuity is the prompt author's job.** Recurring wake-ups fire fresh identities every time with no baggage. If a job needs continuity, the prompt names the file where continuity lives (bounty scratch, role file, arbitrary log). The wake-up system provides none.

**Per-role wake-ups sunset.** Migration of any existing per-role specs into the new global convention, plus removal of the per-role scheduler-spawn in `substrate/scripts/ambient-monitor.py` and the coordinator's Type C dispatch. Slug collision protected by role-prefix: `metis-incident-check.json` under 12 different roles becomes 12 distinct `~/fleet/wakeups/<role>-metis-incident-check/` folders.

**Per-session self-scheduling stays untouched.** The existing per-identity mechanism (a running session schedules a wake-up for itself an hour later) stays exactly as it is — different pattern, wakes the running session, not a fresh one.

## Philosophy

**Tissue model, taken seriously.** An identity exists to do one thing and then dies. A wake-up that reaches into an existing identity to give it another thing to do violates that. The correct action for "at this time, this work needs to happen" is "at that time, a fresh identity is born to do this work."

**Everything on disk.** Agents on the same host CRUD the same files the campaign's downstream UI will CRUD. Two paths in, one truth out — but shape 1 only ships the disk-side; the UI is shape 3.

**Reuse over invent.** The scheduler script, the coordinator's birthing pipeline, the clone-picker — all existed. Shape 1 combines them at a new scope. Nothing about birthing, picking, or scheduler firing-semantics is reinvented.

**Continuity is not the wake-up system's job.** Recurring wake-ups give fresh eyes every time. If continuity matters, the prompt names its own file.

**Trim, don't accrete.** No new UI surface in this shape; that's shape 3.

## Prior context

**Current wake-up implementations at shape-open time (2026-09-20):**
- **Per-identity**, at `~/fleet/identities/<name>/wakeups/*.json`. Fires on the running session — untouched by this shape.
- **Per-role**, at `~/fleet/roles/<role>/wakeups/*.json`. Fires on the role's coordinator — this shape subsumes and removes.

**The agent-supervisor's ambient watchers.** Already spawns per-identity watchers (relay receiver, wake-up scheduler, context-watch, role-file-watch). The new global scheduler joins that pattern at session-independent scope.

**Fire semantics that must survive the port.** The existing scheduler's (1) first-sight-anchor-and-don't-fire, (2) one-catch-up-on-missed-slot, (3) one-shot `.fired` sentinel + spec self-delete all must carry over verbatim. Confirmed post-ship via smoke test.

**Identity-birthing already exists.** Coordinators dropped request files consumed by the existing pipeline. This shape reuses that mechanism.

**Multi-role identities are on another track.** A separate line of work is bringing identities that carry more than one role. This shape assumed those primitives would exist by ship time — shipped with `roles[0]` bridge as D-13 designed. Not blocking for shape 1 close.

## What would make it wrong

- A fired wake-up ever wakes an existing identity instead of birthing a fresh one.
- Per-role wake-ups continue to work in parallel after migration (coexistence defeats the cleanup).
- Fire semantics silently break (missed fires without catch-up, double-fired one-shots, spec doesn't self-delete post-fire).
- Continuity accidentally leaks between fires — a hidden state channel that competes with the prompt-author-owns-continuity philosophy.
- Newborn identity begins its work before roles/skills are fully applied.
- Any deploy-path surprise — schedulers fire before Skynet backend accepts the extended request schema, causing rejected malformed requests.

## Scope edges

**In (shipped):**
- On-disk global wake-up spec convention at `~/fleet/wakeups/<slug>/wakeup.json`.
- Agent-supervisor changes: session-independent global-scope wakeup-scheduler spawn.
- Scheduler `--mode global` flag: nested spec discovery + spawn-request drop on fire + orphan-monitor bypass.
- Extended spawn-request schema: `roles[]` + `skills?[]` + `prompt` (with `roles[0]` bridge in worker.ts per D-13).
- Extended identity-birth pipeline: `BirthOptions.bodyContent` field + `buildIdentityFileBody` emits `## Do this first` block, so wake-up prompts land as pre-authorized next actions in the newborn's identity file body (per id-skill's load-time body-read contract).
- Wake-up spec's `name` carries into newborn's `task:` frontmatter via the existing Phase 80 plumbing (`_drop_spawn_request` writes `task: <name>` rather than the initial `task: null`).
- One-time per-host hand-migration of existing per-role wake-up specs into global convention (via `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/migrate-per-role-wakeups.py`; escalated from hand-migration per D-15 since fleet-wide count was 28).
- Removal of per-role plumbing: ambient-monitor per-role scheduler spawn, coordinator Type C dispatch, coordinator-instructions.md + companion prompt files fleet-wide.

**Out (deferred to later shapes in this campaign):**
- Skynet backend CRUD API for global wake-up specs → **shape 2** (`shape-wake-ups-crud-api.md`).
- Skynet UI modal (header button + list view + create/edit form) → **shape 3** (`shape-wake-ups-modal.md`, tasting-settled).

**Not touched:**
- Per-identity self-scheduled wake-ups — the "wake me later" pattern stays.
- The clone-picker.
- Non-wake-up coordinator dispatch flows (only per-role wake-up dispatch was removed).

## Vehicle notes

Shipped as GSD Phase 127 (renumbered from 126 after rescue-rebase past rain's Phase 126). Four plans:
1. `127-01`: TS spawn-requests schema extension (roles[]/skills?/prompt) + parseRequestBody + worker.ts bridge.
2. `127-02`: Python wakeup-scheduler.py `--mode global` + hermetic bash test.
3. `127-03`: agent-supervisor.sh global-scheduler spawn + ambient-monitor.py per-role removal.
4. `127-04`: SKILL.md subsection + coord-instructions purge + migration audit + human-verify checkpoint.

Plus a small follow-up commit `feat(127-followup): plumb wake-up name→task + prompt→identity-file-body` (BirthOptions.bodyContent + buildIdentityFileBody extension + scheduler task-field population) landed after the campaign-conversion-time smoke test surfaced that the prompt wasn't reaching the newborn.

---

## Close-Out (2026-09-21)

**Verdict:** closed-hit — all "In" items shipped; philosophy realized end-to-end; two smoke tests verified the fire → birth chain.

**What landed:**
- Phase 127 (`fb6c5240` rescue-rebase + `d6126b96` banned-strings fix + wave commits).
- Follow-up (`bea5b544` → pushed as `76a24c2c`): plumbing so `name → task frontmatter` and `prompt → ## Do this first block` land on the newborn per the id-skill's load-time body-read contract.

**Fleet-wide state at close:**
- 5/5 supervisor hosts running the new global scheduler as a session-independent process.
- 28 per-role specs migrated cleanly (24 on workstation + 4 on thenasty); zero per-role specs remaining.
- Zero per-role scheduler processes remaining.
- Coord companion files (coordinator-instructions.md, clone-picker-prompt.md, actor-status-prompt.md) deleted on every supervisor host + t1000 stale-dup + thenasty legacy scheduler.py.

**End-to-end verification (smoke test #2 post-follow-up):**
- Spec dropped at `03:41:51Z`, scheduled fire at `03:42:36Z`.
- Scheduler fired at `03:42:42Z`, dropped spawn-request `9e25d783-26e9-4c5f-a068-db42605cdbda`.
- Skynet birth pipeline consumed request; birth completed through steps 1/2/6/7/8.
- Newborn `mars-box-maintainer-2` (displayName Mars) landed with:
  ```
  ---
  role: box-maintainer
  displayName: Mars
  task: vector-smoke-test-2          ← wake-up spec's name
  ---
  # mars
  ## Do this first
  <wake-up prompt text verbatim>     ← id-skill load-time body-read contract
  ```

**Additions endorsed as drift (post-shape refinements landed during ship):**
- `BirthOptions.bodyContent` field + `buildIdentityFileBody` extension for the `## Do this first` block — WAS implied by the shape's philosophy ("prompt reaches the newborn") but not explicitly enumerated in Scope Edges; the follow-up commit added it as the load-bearing mechanism. Retroactively considered a shape-scope In-item.

**Side-bounties spun up during shipment (for future work, not blockers):**
- Spawn block in `agent-supervisor.sh` logs "started" even when `setsid` redirect silently failed (laptop-host root-owned-fleet-dir issue would have been louder with exit-code checking).
- Nested `~/fleet/wakeups/wakeups/.state/scheduler.pid` cosmetic artifact on thenasty + zoeybattlestation (probable state-dir path glitch in global mode).
- Deeper coord-code retirement remains: `ambient-monitor.py`'s IS_COORDINATOR branch, `agent-supervisor.sh`'s `is_coordinator()`, backend `coordinator: boolean` fields — all inert but stale carry-over. Not shape scope.

**Ownership boundary preserved throughout ship:** executor scope stopped at code + commit + scoped tests green; deploy motion + per-host migration + coord-cleanup were orchestrator-managed per fleet rule.

**Deploys:** Two container mutations (Phase 127 ship + follow-up ship) both authorized by the user, coordinated with peer identities via the container-mutation-serialization rule. Distributor swept all 5 supervisor hosts on each cycle.
