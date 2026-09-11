# Phase 96: On-disk tree consolidation — consolidate identity metadata and each identity's working directory under one canonical `~/fleet/` tree (Shape 3 of id-skill-revamp campaign) — Context

**Gathered:** 2026-09-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Consolidate every piece of on-disk state that describes an identity or a role, along with the working directory each identity actually works in, into one canonical tree in the home directory. Today the pieces are scattered: identity and role metadata live under a Claude-internal hidden folder (`~/.claude/identities/`, `~/.claude/roles/`), and each maintainer identity's working directory sits as its own separate top-level folder in `$HOME` (`~/skynet-tanya`, `~/skynet-tina`, etc.). After this phase lands, one visible folder — `~/fleet/` — is the sole home for all identity metadata, all role knowledge homes, and all working directories, with each identity's metadata and workspace sitting together under that identity's own folder.

Shape 3 of 4 in the id-skill-revamp multi-shape campaign. Depends on Phase 94 (supervisor-archive-extension), which sits atop Phase 92 (pin-sentinel-migration). Shape 4 (substrate prose polish) is the last remaining downstream phase.

The phase is fundamentally a coordinated path rewrite across every place in code that hardcodes identity or role paths, plus one manual per-box migration procedure (a runbook, not code) that each box's maintainer executes during a maintenance window when the coordinated ship lands. No dual-path fallback in code — the migration ends with a single canonical path in every reference.

</domain>

<decisions>
## Implementation Decisions

### Tree layout
- **D-01:** Tree root at `~/fleet/`. Fleet-neutral name — same on every deployment regardless of branding (Skynet on t1000, AI+ on T800, any future). Chosen over `~/skynet/` (brand-locked, awkward on differently-branded deployments) and `~/SN/` (compressed brand initials — still brand-referencing, still awkward on the other brand, opaque to fresh readers). Reflects operator's own vocabulary for the collection of agents across boxes.
- **D-02:** Three siblings under the tree root — `~/fleet/roles/`, `~/fleet/identities/`, `~/fleet/identities-archive/`. Archive at the fleet root (not nested under `identities/`) with scope-in-name convention. Consequence: enumeration of live identities is a clean listing of `~/fleet/identities/` with no folder-name filter (contrast: today's `~/.claude/identities/` requires filtering `archive/` out). Pattern generalizes for future archive categories (`roles-archive/` if it ever exists) without ad-hoc nesting decisions.
- **D-03:** Identity folder internal layout is **preserved exactly as today** — no reshape. Everything that sits at the root of `~/.claude/identities/<name>/` today (identity file `<name>.md`, `handoff.md`, `relay.json`, plus sub-folders `wakeups/`, `ctxwatch/`, `role-file-watch/`, `relay-state/`, plus any per-identity avatar file or sentinel like `.no-dormancy` / `.pinned` / `.recycle-requested`) sits at the same spot in the identity folder root under the new tree. No `meta/` bundling, no rearrangement.
- **D-04:** Add `workspace/` as a new sub-part inside every identity's folder alongside the existing metadata. The workspace is **generic** — the directory where the identity does whatever work it does. No repo-oriented leaning in naming, documentation, or tooling. For a maintainer identity it ends up containing the repo they maintain; for another kind of identity it might contain anything or nothing. Tooling that assumes the workspace holds code is off-spec.

### Migration model
- **D-05:** **No grandfathering.** Every existing top-level maintainer working directory in `$HOME` (currently: `~/skynet-tanya`, `~/skynet-tina`, `~/skynet-tiffany`, `~/skynet-tabitha`, `~/skynet-taylor` on t1000; equivalents on T800 and any other box) moves into `~/fleet/identities/<name>/workspace/` as part of the per-box migration. Every identity metadata folder under `~/.claude/identities/` moves into `~/fleet/identities/`. Every role knowledge home under `~/.claude/roles/` moves into `~/fleet/roles/`.
- **D-06:** **No dual-path fallback in code.** After this phase ships and each box completes its migration, every hardcoded path reference resolves to exactly one canonical location. No "try old location, fall back to new" branch, no environment variable override, no compatibility shim. Single path — everywhere.
- **D-07:** **Per-box migration is a coordinated maintenance window**, not a live migration. Sequence per box:
  1. Save every active identity on the box (each identity runs `/id save` — flushes handoff, updates bounties, appends history).
  2. Copy metadata folders + working directories to their new locations under `~/fleet/`.
  3. Shut down the Skynet host container + all agent-supervisor sessions on the box.
  4. Deploy new Skynet code (which brings new substrate assets — new id-skill body, new agent-supervisor, new ambient monitor scripts, new Skynet backend — along via the fleet-substrate distributor sweep that runs as part of container startup).
  5. Bring the host back up — new code reads new paths, sessions come back on new code with new paths naturally.
  6. Verify the new tree is live (identities loadable, bounties visible, monitors running, distributor sweep clean).
  7. Delete the old locations (`~/.claude/identities/`, `~/.claude/roles/`, `~/skynet-<name>/` per maintainer identity).
- **D-08:** Migration timing is coordinated per-box by that box's maintainer, at a moment when no identity is actively mid-flow. Ashley 2026-09-09 verbatim: *"you would do this while no sessions are busy with things, but that won't be much of a problem. it's not hard to coordinate."* Not a scripted synchronized moment across boxes; each box independent.

### Currently-archived identities
- **D-09:** Handling of currently-archived identities (whatever sits at `~/.claude/identities/archive/*/` on a box today) is **decided at migration-time by the maintainer running the runbook**, not pre-decided in this phase. The runbook prompts the maintainer: if any currently-archived identities exist, ask what to do — migrate them into `~/fleet/identities-archive/`, delete them, leave them in place as legacy state, whatever the maintainer chooses at the time. If no currently-archived identities exist on the box, the prompt is skipped entirely.

### Migration runbook artifact
- **D-10:** Migration runbook lives at `.planning/phases/96-on-disk-tree-consolidation-consolidate-identity-metadata-and/MIGRATION.md`. Rationale: it's a one-shot procedure (each box runs it exactly once at campaign ship), not repeatable operational work — so a role-scope runbook is the wrong lane. Placing it inside the phase's planning directory means Stacy pulls it when she pulls the campaign ship's code changes to deploy on T800, and any future box's maintainer gets it the same way. Co-located with the phase's other planning artifacts. Content covers Steps 1–7 from D-07, plus the currently-archived-identities prompt from D-09, plus the maintainer-provided decisions at each step.

### Code change surface
- **D-11:** Path rewrites land in the following files (canonical list — the plan phase resolves precise line-by-line scope):
  - **id-skill body** at `substrate/skills/id/SKILL.md` — every hardcoded `~/.claude/identities/` and `~/.claude/roles/` reference in the skill body and in the on-disk file layout section.
  - **Coordinator companion files** at `substrate/skills/id/coordinator-instructions.md`, `substrate/skills/id/clone-picker-prompt.md`, `substrate/skills/id/actor-status-prompt.md` — any path references in the routing / dispatch / actor-enumeration prompts.
  - **agent-supervisor** at `substrate/scripts/agent-supervisor.sh` — all identity + role path references, including the archive-scan action from Phase 94 that moves identity folders to `identities-archive/`.
  - **Four ambient monitor scripts** — `substrate/scripts/recv.sh` (STATE_DIR + cred-path derivation), `substrate/scripts/wakeup-scheduler.py`, `substrate/scripts/context-watch.py`, `substrate/scripts/role-file-watch.py` — each of these takes the identity folder as an argument today, so most of their paths are relative; the change is in the CALLERS (agent-supervisor + id-skill body) that launch them pointing at the identity folder location.
  - **Skynet backend identity-birth-orchestrator** — the SFTP write target for a new identity's `relay.json` updates from `~/.claude/identities/<name>/relay.json` to `~/fleet/identities/<name>/relay.json`. This is the ONLY Skynet-side backend change in this phase.

### Grandfathered-in-place paths (explicitly NOT moving)
- **D-12:** `~/.claude/CLAUDE.md` **stays at its current location**. It's the user-wide Claude runtime configuration file (loaded by every Claude session before any identity is even considered), not identity or role metadata. Out of scope for this phase.
- **D-13:** `~/.claude/skills/` **stays at its current location**. The skill files themselves (id, agent-relay, others) are Claude runtime plumbing that the fleet-substrate distributor installs to `~/.claude/skills/` on every managed box. Their INTERNAL path references change to point at `~/fleet/` for identity and role data, but the skills' own install location doesn't move.
- **D-14:** `~/.local/bin/` **stays at its current location**. The installed script binaries (`agent-supervisor`, `wakeup-scheduler`, `context-watch`, `role-file-watch`) live where the distributor puts them; only their internal references change.

### Path-audit acceptance criterion
- **D-15:** **Repo-wide grep sweep** as the audit floor. Not just the explicitly-touched files from D-11 — every reference to `~/.claude/identities/`, `~/.claude/roles/`, and their variations across the entire repository (code, docs, tests, planning artifacts, examples in skill bodies, everything). Any legacy reference outside the touched files must be either updated or explicitly documented as intentionally retained (D-12/D-13/D-14 — CLAUDE.md, skills/, local/bin/). Rationale: a partial audit leaves landmines in files nobody thought to touch (test fixtures, plan artifacts, docs examples). Repo-wide grep catches them.

### Ship coordination
- **D-16:** All changes in this phase ship as **one coordinated release**. Fleet-substrate distributor propagates the substrate script + skill changes to every managed box on its post-deploy sweep; Skynet redeploy carries the backend identity-birth-orchestrator change; both must be live simultaneously (they are — the distributor sweeps as part of the container's fleet-substrate orchestrator boot, and the backend edit is inside the same container that runs the distributor).
- **D-17:** Per-box migration timing is up to that box's maintainer. On t1000 = tanya (or whichever box-maintainer identity is available). On T800 = Stacy. Each box's maintenance window is independent; no fleet-wide synchronized moment. Boxes may sit in a mixed state (some migrated, some not) during the campaign ship window — that's fine because each box is self-contained (identities on t1000 don't cross-reference paths on T800).
- **D-18:** Shape 3 code sits **held-from-ship** along with Shape 1 (Phase 92, pin-sentinel-migration) and Shape 2 (Phase 94, supervisor-archive-extension) until the whole 4-shape campaign lands at one ship moment. Shape 4 (substrate prose polish) is the last shape; when it's code-complete + reviewed, the whole campaign ships together.

### Claude's Discretion (implementation-level, planner decides)
- Exact wave/plan breakdown. Given every file touched is a path-rewrite with no cross-file dependencies (each file's internal path references are independent), single-wave-multi-file is likely fine; the planner may split by file class (substrate scripts, id-skill body, coordinator companions, Skynet backend) if it aids review.
- Whether to add a CI-level grep test that fails the build if a legacy path reference reappears. Would catch future drift; may not be worth the maintenance overhead for a one-shot migration. Planner picks.
- Precise wording of MIGRATION.md — the runbook. Content per D-10 + D-07 + D-09; the planner drafts and the executor writes.
- Test surface: mostly a grep-based audit (D-15). Some scripts have small hardcoded-path unit tests (e.g. recv.sh's cred-path derivation was caught 2026-07-29 when Nelly invented ephemeral STATE_DIR); those tests get their expected paths bumped. Planner enumerates.
- The Skynet backend identity-birth-orchestrator's existing tests probably reference the SFTP write target as a string constant somewhere — planner catches during the audit.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (authoritative for this phase)
- `.planning/shapes/shape-on-disk-tree-consolidation.md` — Ashley's locked shape from the /open pass 2026-09-09 + this session's follow-up 2026-09-10. All D-01..D-18 above are derived from it plus this session's discuss-phase resolutions on the runbook location, the currently-archived treatment, and the path-audit scope. Read this first.

### Campaign context
- `~/.claude/roles/box-maintainer/bounties/id-skill-revamp/shape-id-skill-revamp.md` — original whole-campaign shape (multi-phase). This phase is Shape 3 of 4. The "Working directories consolidate under one canonical tree" section provides the framing that this phase implements.
- `~/.claude/roles/box-maintainer/bounties/id-skill-revamp/bounty.json` — campaign hub bounty with cross-shape todos.

### Upstream dependencies in same campaign (code-complete at HEAD, held from ship)
- `.planning/phases/92-pin-sentinel-migration-move-identity-pin-state-from-skynet-d/92-CONTEXT.md` + plans — Shape 1's context and implementation. Shape 3's path rewrites include the `.pinned` sentinel reference at `~/.claude/identities/<name>/.pinned` → `~/fleet/identities/<name>/.pinned` inherited from Shape 1.
- `.planning/phases/94-supervisor-archive-extension-daily-archive-scan-for-180-day-/94-CONTEXT.md` + plans — Shape 2's context and implementation. Shape 3's path rewrites include Shape 2's archive-scan action, which currently moves identity folders to `~/.claude/identities/archive/<name>/` and must update to `~/fleet/identities-archive/<name>/`. Also Shape 2's freshness signal reads `~/.claude/identities/<name>/relay-state/since` — updates to `~/fleet/identities/<name>/relay-state/since`.

### Files this phase modifies (path rewrites)
- `substrate/skills/id/SKILL.md` — id-skill body. Load-bearing prose reference throughout.
- `substrate/skills/id/coordinator-instructions.md` — coordinator dispatch companion.
- `substrate/skills/id/clone-picker-prompt.md` — clone-picker sub-agent prompt.
- `substrate/skills/id/actor-status-prompt.md` — actor-status sub-agent prompt.
- `substrate/scripts/agent-supervisor.sh` — the per-host supervisor. Every identity-path and role-path reference, including Shape 2's archive-scan destination path.
- `substrate/scripts/recv.sh` — relay receiver. Cred-path derivation from STATE_DIR.
- `substrate/scripts/wakeup-scheduler.py` — wake-up scheduler.
- `substrate/scripts/context-watch.py` — context-usage watch.
- `substrate/scripts/role-file-watch.py` — role-file + identity-file watch.
- `src/backend/.../identity-birth-orchestrator.ts` (planner locates precise file) — Skynet backend identity-birth flow's SFTP-write target for the new identity's `relay.json`.

### Files this phase creates
- `.planning/phases/96-on-disk-tree-consolidation-consolidate-identity-metadata-and/MIGRATION.md` — the maintainer-facing runbook (D-10). Content is the per-box migration procedure Ashley described (D-07), with the currently-archived-identities decision prompt (D-09) called out as a step.

### Files this phase READS (contract references, no changes)
- `~/.claude/roles/box-maintainer/agent-supervisor-handoff.md` — full context transfer for the supervisor. READ before any supervisor-touching change.
- `~/.claude/roles/box-maintainer/id-skill-handoff.md` — full context transfer for the id skill body + 3 coordinator companions. READ before any id-skill-touching change.
- `src/backend/distributor/catalog.ts` — canonical catalog of what the fleet-substrate distributor sweeps. Confirms that agent-supervisor, recv.sh, wakeup-scheduler, context-watch, role-file-watch are all distributor-managed; edits to these files ship via the distributor. Also confirms `~/.local/bin/` and `~/.claude/skills/agent-relay/` are the install targets (D-14).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Prior campaign phases' rewrites** — Shape 1 and Shape 2 already touched `substrate/scripts/agent-supervisor.sh` and adjacent files. The rewrite patterns established there (path-string edits, test fixture updates for path-dependent tests) are the pattern for this phase.
- **Grep tooling** — repo already uses `grep -r` and language-specific searches in CI; the path-audit test (D-15) reuses standard shell tooling, no new infrastructure needed.

### Established Patterns
- **Fleet substrate distribution** (`src/backend/distributor/catalog.ts`): edits to `substrate/scripts/*` and `substrate/skills/*` land on all managed boxes via the next distributor sweep after the Skynet container starts on new code. Every path in the code as installed matches the source. No hand-editing of installed copies on any box (fleet rule).
- **Presence-only sentinels + on-disk state**: identity metadata is all file-based, no in-memory-only caching (except recv.sh's cursor which persists to disk anyway). This is what makes the copy-then-deploy-then-delete migration model work — the old and new locations coexist during copy, and the new one is authoritative once new code is live.
- **Coordinator vs actor identity handling**: Shape 2 established that coordinator identities carry `coordinator: true` frontmatter and are exempt from archive-scan. Shape 3 doesn't change this; coordinators still live at `~/fleet/identities/<coord-name>/` alongside actor identities.

### Integration Points
- **Fleet-substrate distributor** (existing, no code changes): sweeps substrate assets to every managed box. The distributor's install paths (`~/.local/bin/`, `~/.claude/skills/agent-relay/`) do NOT change — only the CONTENT of the distributed files changes to reference `~/fleet/`.
- **Skynet host-level SSH access to managed boxes** (existing, one code change): the identity-birth-orchestrator SFTPs a new identity's `relay.json` to the managed box during identity creation. Path target updates from `~/.claude/identities/<name>/relay.json` to `~/fleet/identities/<name>/relay.json`. Skynet's SSH machinery is untouched — same connection, same credentials, different destination path.
- **agent-supervisor's existing tmux + identity loop**: nothing structural changes — supervisor keeps cd'ing into each identity's working directory before launching Claude. The path it cd's INTO changes from `~/skynet-<name>` (grandfathered old layout) to `~/fleet/identities/<name>/workspace/` (new layout). Single-path lookup per D-06.

### Test Considerations
- **Grep sweep test** — repo-wide search for legacy `~/.claude/identities/` and `~/.claude/roles/` references (with the D-12/D-13/D-14 explicit exclusions for CLAUDE.md, skills/, local/bin/). Fails if any unaudited reference remains. May live in CI or as a one-shot verification step; planner picks.
- **Path-dependent tests in touched files** — some substrate scripts have unit tests referencing STATE_DIR / cred paths (recv.sh explicitly, per the id-skill body's incident-learning note about Nelly's ephemeral STATE_DIR trap 2026-07-29). Those test fixtures update.
- **Skynet backend identity-birth-orchestrator tests** — planner catches during the audit; string constants for the SFTP write target update alongside the source.
- **Runbook (MIGRATION.md) validation** — not testable in code. Verification is that Ashley can read it and follow it without ambiguity on t1000; Stacy can do the same on T800 without cross-referencing anything not in the repo. Reviewer verifies during phase close.

### Anti-patterns to avoid
- **Do NOT hand-patch fleet-substrate content on any host** (Ashley 2026-09-10 verbatim: *"you are potentially covering issues up where we might not catch that the distributor is not distributing to certain hosts because you're manually updating it"*). If a host is missing something the distributor should have pushed, fix the distributor OR the creds — do not SSH in and edit. This applies to the migration runbook execution too: if the distributor doesn't reach a box, the maintainer fixes the distribution path, they don't hand-patch the substrate on the box.
- **Do NOT introduce a compatibility branch** (D-06). Any "try old path, fall back to new" is off-shape. The whole point of the coordinated per-box migration is a clean cutover with single-path code afterwards.
- **Do NOT rename the workspace to imply repo-content** (D-04). It's the identity's working directory. Any doc, comment, or symbol name that says "repo" or "code home" is off-shape.

</code_context>

<specifics>
## Specific Ideas

- **Tree name `~/fleet/`** — Ashley 2026-09-10 accepted after considering and rejecting `~/skynet/` (brand-locked) and `~/SN/` (compressed brand still brand-referencing). Reasoning: `fleet` is her existing vocabulary for the collection of agents across boxes; brand-neutral; works identically on t1000 (Skynet) and T800 (AI+).
- **Archive location** — Ashley 2026-09-10 verbatim: *"I'm kind of a fan of like, keeping the archive folder at the fleet route, but naming it identities archive in sort of a sluggified way. And then if there was ever a roles archive, it could follow suit."* Locked as `~/fleet/identities-archive/`, sibling of `~/fleet/identities/`, scope-in-name pattern for future generalization.
- **No grandfathering** — Ashley 2026-09-10 verbatim: *"we are not doing grandfathering. And so the manual migration happens when this code deploys on each instance."* Every existing top-level working directory moves. No dual-path in code.
- **Workspace is generic** — Ashley 2026-09-10 verbatim: *"while a lot of the identities on the current instance are maintainers of repos, it has to be said that the workspace folder is a working directory for anything that any identity ever does and has no leaning towards repos in any way. It just so happens that you guys put repos in there because you maintain Skynet."*
- **Copy-shutdown-deploy-restart-delete sequence** — Ashley 2026-09-10 verbatim: *"the simplest way to do it might be to just copy everything to the new locations, and then deploy the new code, and then once it's running on the new code, you just get rid of the old stuff. ... The sequence is that you copy everything, and then you shut down the host, and then you deploy the new Skynet instance, and then you bring the host back up, and then you delete the old stuff. And you would do this while no sessions are busy with things, but that won't be much of a problem. it's not hard to coordinate."*
- **Migration runbook in the repo** — Ashley 2026-09-10 verbatim: *"if there's any miscellaneous place that you could stick it in the repo itself, so that Stacey can easily get it when she does the update to these commits, then I think that would be good."* Locked at `.planning/phases/96-.../MIGRATION.md` — co-located with phase artifacts; reachable to Stacy via the campaign ship's pull; not a role-scope runbook (one-shot per box, not repeatable).
- **Currently-archived identities decided at migration-time** — Ashley 2026-09-10 verbatim: *"for currently archived identities i think that the run book should just bring up that as a question when the agent is running it and if there are no archived identities then we don't need to ask the question and if there are then the user can decide what to do at the time."*
- **Path-audit scope repo-wide** — Ashley 2026-09-10 agreed to repo-wide grep sweep as the audit floor. Any legacy path reference outside the touched files must be updated or documented as intentionally retained (D-12/D-13/D-14).

</specifics>

<deferred>
## Deferred Ideas

- **Migration script that automates the copy-shutdown-deploy-restart-delete sequence.** Tempting because it would reduce the maintainer's manual steps to one command. Explicitly out per shape ("each maintainer's box, each maintainer's window") — the coordination of "no sessions are busy right now" is human judgment, not something a script should race against.
- **In-app UI in Skynet to view or manage the fleet tree.** Explicitly deferred in the campaign shape's "Out" list; may become a first-class fleet-status surface later.
- **Non-code workspace conventions / templates.** The workspace is generic (D-04) but this phase doesn't ship any runbook or convention for what a non-code workspace looks like. When the first non-maintainer identity's workspace matters, its owner will define its convention then.
- **Shared path helper library across scripts.** Every substrate script currently hardcodes its own path prefixes. A shared helper (a single source of truth for `IDENTITY_ROOT`, `ROLE_ROOT`, `ARCHIVE_ROOT` as variables) would prevent future drift. Out of this phase; a later refactor once the paths are stable.
- **Environment-variable override for the tree root.** Would let a maintainer relocate `~/fleet/` per-box if they need to. Out — single canonical path everywhere, no configuration surface.
- **Cross-role identity linking or promotion mechanisms.** Explicitly deferred in the campaign shape's "Out" list.
- **Auto-generated per-worker avatars via a runbook per identity.** Avatar generation stays per-role (campaign shape's "Out" list).
- **Grep-audit as a permanent CI gate** — could add a `grep -r "~/.claude/identities"` test to CI that fails the build if a legacy path reappears. Value depends on how often future code touches the identity/role subject — for a one-shot migration, maintenance overhead may outweigh benefit. Planner picks; not required by this phase.

</deferred>

---

*Phase: 96-on-disk-tree-consolidation-consolidate-identity-metadata-and*
*Context gathered: 2026-09-10*
