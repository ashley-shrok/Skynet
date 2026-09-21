# Phase 127: wake-ups redesign phase 1 — global on-disk specs + global-scope scheduler + per-role sunset + migration — Context

**Gathered:** 2026-09-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 of a three-phase wake-ups redesign. This phase delivers the **backend and fleet-substrate** for the new mechanism:

- The new on-disk global wake-up spec convention on each host.
- Agent-supervisor changes so the existing wake-up scheduler script also runs at a **new session-independent global scope**, alongside the per-identity spawns it already handles.
- Scheduler changes so a fire in global-scope drops a **create-identity request file** for Skynet's existing identity-birth pipeline to consume (instead of printing a wake-line to a harness like it does at per-identity scope today).
- **Sunset of per-role wake-ups**: hand-migration of any existing per-role specs into the new global convention, and removal of the per-role scheduler-spawn + coordinator dispatch plumbing.

**Explicitly deferred to later phases:**
- Skynet backend CRUD API for global wake-up specs → phase 2.
- Skynet UI modal (list view + create/edit form + header button) → phase 3.

Both later phases can only be started once phase 1 lays down the on-disk convention they will read/write.

**The whole-arc shape lives at `.planning/shapes/shape-wake-ups-redesign.md` — required reading for every downstream agent working phase 1.**

</domain>

<decisions>
## Implementation Decisions

### On-disk spec layout

- **D-01:** Global wake-up specs live at **`~/fleet/wakeups/<slug>/wakeup.json`** on each host — slug-folder with a fixed sentinel filename, mirroring the newer fleet convention (bounties use `<slug>/bounty.json`, runbooks use `<slug>/runbook.md`, skills use `<slug>/SKILL.md`). The older flat `~/fleet/identities/<name>/wakeups/*.json` and `~/fleet/roles/<role>/wakeups/*.json` conventions predate this pattern; the new global scope adopts the newer pattern rather than propagating the older flat one.
- **D-02:** The folder-per-slug shape lets companions drop naturally in the same folder — **migration provenance** for specs converted from per-role wake-ups, ad-hoc scratch files a prompt author names for continuity across recurring fires (the prompt-author-owns-continuity philosophy per shape's Philosophy section), or a small last-fired log the newborn agent writes before dying. Companions are not part of this build's scope but the folder shape enables them.
- **D-03:** Slug is kebab-case, same rules as bounty/runbook/skill slugs. Reader tooling can display the spec's `name` field for humans and use the slug as the durable key.

### Spec field shape

- **D-04:** Extend the existing scheduler-script's spec shape with three fields: **`name`** (short label — the "how does this wake-up show at a glance in the UI" field, distinct from the prompt per the tasting); **`roles: [...]`** (one or more role names the newborn identity takes on); **`skills: [...]`** (optional list of skill names the newborn has ready).
- **D-05:** All fields today's per-identity/per-role scheduler already supports stay verbatim: `enabled`, `schedule` (with `interval`/`daily`/`weekly`/`one_shot` kinds, `timezone` optional, `days` optional), `instruction` (renamed to `prompt` in the new shape for clarity, since the newborn's whole first turn IS the prompt — not a "check on X" instruction the way per-identity wake-ups read to a running harness).
- **D-06:** `prompt` is a plain string. It becomes the first user message to the newborn agent. Long prompts follow the existing scheduler pattern (write full text to `<state_dir>/<slug>.wake` if it would exceed the harness stdout truncation cap; for global-scope where there's no harness to truncate, the pattern's still useful as an idempotent staging file for the request-drop step).

### Scheduler at global scope

- **D-07:** Reuse `substrate/scripts/wakeup-scheduler.py` — it's already dir-agnostic (takes a folder path as argument and reads specs from `<folder>/wakeups/*.json`). Add a **mode flag** to the script distinguishing per-identity mode (existing behavior — print `⏰ [scheduled: ...]` to stdout for the running harness) from global mode (new behavior — drop a create-identity request file at fire time).
- **D-08:** In global mode, the scheduler reads specs from `~/fleet/wakeups/<slug>/wakeup.json` (folder-per-slug, per D-01), NOT the older flat `<folder>/wakeups/*.json` shape. The script accommodates both spec-layouts based on mode.
- **D-09:** Agent-supervisor (`substrate/scripts/agent-supervisor.sh`) spawns the global-scope scheduler **once per host at supervisor startup**, session-independent — no harness attached, runs as its own long-lived process alongside the ambient-monitor and other host-wide watchers. Per-identity scheduler spawns (already existing, ambient-monitor-managed) stay untouched and continue to fire per-identity wake-ups the existing way.
- **D-10:** State dir for the global scheduler mirrors the existing per-scope convention — `~/fleet/wakeups/.state/` for the global instance (holds `<slug>.fired` sentinels for one-shot semantics, catch-up bookkeeping, and pid tracking). Sentinel semantics from today's scheduler carry over verbatim (first-sight anchor, one-catch-up-on-missed-slot, `.fired` before delete for one-shot double-fire prevention).

### Fire path → identity birth

- **D-11:** On fire, the global-scope scheduler drops a **create-identity request file** at whatever path Skynet's existing coordinator-birthing pipeline already consumes. Researcher/planner: read `src/backend/database/routes/identity-birth-orchestrator.ts` to find the exact drop location and existing request-file schema — this build EXTENDS that schema; it doesn't invent a new one.
- **D-12:** Extension of the request file's shape: existing single-role `role:` field becomes an array `roles: [...]`; new `skills: [...]` field; `prompt` field (may already exist as the newborn's first-turn instruction — reader confirms). Naming (what identity the newborn gets) is delegated to whatever the request file's existing "pick a name" mechanism does (the clone-picker path referenced in coordinator instructions). The wake-up spec does NOT specify the newborn's name.
- **D-13:** Coordination boundary with the multi-role identity work (which owns the birthing code that reads the request file's roles/skills fields): phase 1 defines the request-file extension from wake-up needs; researcher reads what state the multi-role track is in at plan time and either locks the extension for multi-role to adopt, or aligns to what multi-role has already locked. Ownership of who-implements-which-side is up to Claude — the point is the extension gets defined and both sides consume it. Phase 1 does NOT wait on multi-role: spec-in-hand is enough.

### Per-role sunset

- **D-14:** Migration of any existing per-role wake-up specs is **hand-executed during phase 1**, not automated. Fleet-wide count is likely 0–5 based on a spot-check of this host (zero specs — just a scheduler pidfile in `.state/`). Sweep every managed host's `~/fleet/roles/*/wakeups/*.json`; for each spec found, write a new global spec at `~/fleet/wakeups/<slug>/wakeup.json` with the same `schedule`+`prompt` and `roles: [<role>]`. Migration provenance drops in the folder as `migrated-from.md` noting original path + timestamp.
- **D-15:** If the fleet-wide count turns out substantially larger than expected (>~10), the plan escalates mid-execution and swaps hand-migration for a small automation script; that call is deferred to plan-execution time.
- **D-16:** After migration, the per-role plumbing is REMOVED in the same deploy: (a) the per-role scheduler-spawn in agent-supervisor (or wherever it lives — researcher confirms); (b) the coordinator's per-role wake-up dispatch code (the "Type C" wake-up routing referenced in coordinator-instructions.md, if that's still the current name); (c) any config or documentation referencing the per-role wake-up path.

### Rollout & backwards-compat

- **D-17:** **Hard cutover — no backwards-compat window.** After phase 1's deploy, per-role wake-ups no longer fire on any host; new global wake-ups fire instead. Distribution timing (peer A getting the new code before peer B) is normal fleet-substrate rollout behavior — each host is self-contained (per-role wake-ups are per-role-per-host), and each host's migration + code-removal happens together, so no special-casing needed.
- **D-18:** Deploy of phase 1 goes through the standard fleet-substrate distributor: scheduler-script + agent-supervisor changes land in `substrate/scripts/`, the distributor pushes them to every managed host on its next sweep. The one-time per-host migration (D-14) happens as part of orchestrator's ship motion, coordinated with the code push per the standard "container mutations serialize" fleet rule.

### Claude's Discretion

- Which side of the multi-role/wake-up boundary implements the request-file extension (see D-13). Judgment call at plan time.
- Exact JSON field ordering, key naming conventions, and any minor spec-shape polish beyond the extensions named above.
- Migration escalation threshold (see D-15). Judgment call at execution time.
- Any tests / logging conventions the fleet-substrate scripts already use — mirror them, don't invent new ones.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Whole-arc shape (foundation for all three phases)

- `.planning/shapes/shape-wake-ups-redesign.md` — the shape agreed at /open with the user (2026-09-20). Carries philosophy, prior context, what would make it wrong, scope edges, and the three-phase split. **Every phase 1 decision above traces to this file.**

### Existing wake-up mechanism (must be understood before extending)

- `substrate/scripts/wakeup-scheduler.py` — the scheduler script this phase extends. Header docstring documents current spec shape, schedule kinds, firing semantics (first-sight anchor, one-catch-up-on-missed-slot, `.fired` sentinel for one-shot), and stdout-line-truncation caveat.
- `substrate/scripts/agent-supervisor.sh` — the supervisor this phase adds a new global-scope spawn to. Understand how it currently spawns per-identity schedulers before adding the global spawn.
- `substrate/skills/id/SKILL.md` §"Scheduled wake-ups" — user-facing documentation of the per-identity and per-role wake-up conventions; describes the "USER-RESERVED — agent NEVER creates one" governance, first-sight-anchor firing semantics, and the id-skill's contract with the scheduler.

### Identity-birth pipeline (fire path drops into this)

- `src/backend/database/routes/identity-birth-orchestrator.ts` — the Skynet-side identity-birth code the scheduler's create-request file will trigger. Read the current request-file schema; phase 1 extends it (roles[] + skills[]) rather than defining a new one.
- `src/backend/claude-session/identity-artifact-reader.ts` — existing wake-up-adjacent code (there's already a `identity-artifact-reader.wakeup-crud.test.ts` — check what wake-up CRUD groundwork exists here before duplicating).
- `substrate/skills/id/coordinator-instructions.md` — coordinator dispatch flows; the "Type C" wake-up routing this phase removes. Read to identify what to strip cleanly without breaking other coordinator paths.

### Fleet distribution (how phase 1's substrate changes reach every host)

- `src/backend/distributor/catalog.ts` — catalog the distributor pushes. Understand where scheduler + supervisor changes land in the sweep.
- `.planning/shapes/shape-wake-ups-redesign.md` §"Vehicle notes" — deploy-motion considerations for phase 1 (primarily fleet-substrate; may touch Skynet backend for the coordinator-birthing endpoint extension).

### Bounty / tasting artifacts

- `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/` — bounty folder holding the tasting prototype and any phase-1 scratch. Not required reading for phase 1's implementation, but the bounty is the record of this whole build's work.
- `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/prototype.html` — settled modal design (for phases 2 and 3, not phase 1).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`substrate/scripts/wakeup-scheduler.py`** — dir-agnostic scheduler already handles the schedule kinds this build needs (interval / daily / weekly / one-shot with timezone). Extending it with a mode flag for global-scope fire behavior is cheaper than a new script.
- **`substrate/scripts/agent-supervisor.sh`** — already spawns per-identity ambient watchers (scheduler, ambient-monitor, context-watch, role-file-watch). Adding a session-independent global spawn follows the same pattern.
- **Skynet identity-birth pipeline** — the create-identity-from-request-file mechanism already exists (used by coordinators). The scheduler's fire path just needs to drop a request file at whatever path the pipeline watches.
- **`humanizeWakeupSchedule()` at `src/backend/claude-session/identity-artifact-reader.ts:116`** — schedule humanization already exists; phase 3's UI will consume it, but phase 1's migration provenance may also want to reference it when writing `migrated-from.md`.

### Established Patterns

- **Slug-folder + fixed-sentinel file** for on-disk entities (bounties, runbooks, skills). D-01 adopts this pattern for global wake-ups.
- **Dir-agnostic scripts + mode flags** for behavior variance without duplication (wakeup-scheduler already takes a folder path arg; this phase adds a mode flag to it rather than forking the script).
- **Ambient watchers spawned by agent-supervisor** as long-lived per-host processes outside any harness. Global scheduler joins that pattern.
- **Distributor as the substrate deployment vehicle** — never hand-patch scripts on managed hosts. Standard fleet-substrate rule per role file.

### Integration Points

- **agent-supervisor.sh ↔ global scheduler:** new spawn at supervisor startup, session-independent, one process per host.
- **Global scheduler ↔ Skynet identity-birth pipeline:** fire path drops a request file at the path the birth pipeline already watches. Wake-up spec's fields (roles[]/skills[]/prompt) become fields in the request file.
- **Identity-birth ↔ multi-role identity work (out-of-tree):** the birth code reads the roles[]/skills[] extension. Coordination point per D-13.
- **Distributor ↔ fleet:** scheduler + supervisor changes flow through the standard substrate catalog → distributor sweep → per-host update path.
- **Per-role plumbing removal:** touches coordinator-instructions.md, agent-supervisor's per-role spawn (if any), and any distributor catalog entries for the retired path.

</code_context>

<specifics>
## Specific Ideas

- The tasting-settled modal shape (list view + create/edit form) lives at `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/prototype.html` — for phases 2 and 3, not this phase.
- User's philosophy on scheduling ownership: "an agent may SUGGEST a wake-up, but only the user authorizes creating one" (per id-skill § Scheduled wake-ups). This is preserved in the new mechanism — nothing in phase 1 should let an agent bypass the user-approval bar for global wake-up creation. (The wake-up file being on disk means agents CAN drop files there, but the id-skill governance rule still applies: don't self-create.)

</specifics>

<deferred>
## Deferred Ideas

### Deferred to phase 2 (Skynet backend CRUD API)
- Endpoints for list / create / update / delete / toggle-enabled on global wake-up specs.
- Enumeration endpoints for the role and skill pickers the UI needs.
- Migration provenance surfacing (if the UI wants to show "this wake-up was migrated from a per-role spec on 2026-09-XX").

### Deferred to phase 3 (Skynet UI modal)
- The header button in the conversation-list panel header.
- List view (rows with name / schedule+next-fire / prompt / role+skill chips / enable toggle / kebab).
- Filter bar (search, role dropdown, skill dropdown).
- Create/edit form (name / prompt / roles / skills / schedule pickers).
- Delete flow from list-view kebab.

### Deferred / considered but excluded
- **A dual-mode compat period** where per-role and global wake-ups both fire — rejected in Q4 as unnecessary given the small fleet-wide per-role population.
- **An automated migration script** — deferred in D-15 unless the count balloons.
- **A wake-up-provided continuity affordance** across recurring fires — explicitly rejected in the shape's Philosophy. Continuity is the prompt author's job via existing shared-knowledge mechanisms (role files, bounties, arbitrary scratch files).
- **Cross-host wake-ups** — rejected in shape's Scope Edges; per-host is the whole mental model.
- **Wake-up templates / duplicate-and-edit** — rejected as MVP overhead in shape's Scope Edges.
- **A history-of-past-fires view** — deferred; not shipping in this arc.

</deferred>

---

*Phase: 127-wake-ups-redesign-phase-1-global-on-disk-specs-global-scope-*
*Context gathered: 2026-09-21*
