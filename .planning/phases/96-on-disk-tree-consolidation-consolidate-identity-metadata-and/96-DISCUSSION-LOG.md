# Phase 96 Discussion Log — On-disk tree consolidation

**Session:** 2026-09-10 (single session, tanya identity)
**Prior source:** shape file at `.planning/shapes/shape-on-disk-tree-consolidation.md` (opened + grilled + locked 2026-09-09; five grill exchanges captured in that file's history)

---

## Prior shape-file grill exchanges (source of D-01 through D-08, D-11 through D-14, D-16 through D-18)

Documented in the shape file. Summary of resolutions:

### Shape grill 1: Tree name
- **Options presented:** `~/skynet/` (brand-locked to the current fleet manager app), `~/SN/` (brand-initialized), `~/fleet/` (brand-neutral, operator's own vocabulary).
- **Ashley chose:** `~/fleet/` after considering and rejecting `~/SN/` because compressed brand-initials still read as the other brand on differently-branded deployments (T800/AI+).
- **Ashley verbatim:** *"Fine. We'll go with your option."* (after considering `~/SN/`).

### Shape grill 2: Grandfathering existing working directories
- **Options presented:** Grandfather existing top-level `~/skynet-<name>/` dirs OR migrate them into the new tree as `~/fleet/identities/<name>/workspace/`.
- **Ashley chose:** No grandfathering.
- **Ashley verbatim:** *"we are not doing grandfathering. And so the manual migration happens when this code deploys on each instance."*

### Shape grill 3: Workspace framing
- **Options presented:** implicit — the shape had drifted toward "workspace = repo home."
- **Ashley reframed:** workspace is generic — the directory where the identity does whatever work it does; no repo-oriented leaning.
- **Ashley verbatim:** *"while a lot of the identities on the current instance are maintainers of repos, it has to be said that the workspace folder is a working directory for anything that any identity ever does and has no leaning towards repos in any way. It just so happens that you guys put repos in there because you maintain Skynet."*

### Shape grill 4: Migration sequence
- **Options presented:** save-then-mv-then-restart (my initial pitch, worried about drift window) vs. copy-then-shutdown-deploy-restart-delete (Ashley's simplification).
- **Ashley chose:** copy-then-shutdown-deploy-restart-delete.
- **Ashley verbatim:** *"You're overthinking it. The sequence is that you copy everything, and then you shut down the host, and then you deploy the new Skynet instance, and then you bring the host back up, and then you delete the old stuff. And you would do this while no sessions are busy with things, but that won't be much of a problem. it's not hard to coordinate."*

### Shape grill 5: Archive folder location
- **Options presented:** top-level sibling `~/fleet/archive/` vs. nested `~/fleet/identities/archive/`.
- **Ashley reshaped:** keep archive at fleet root but name it with a scope prefix (`identities-archive/`) so the pattern generalizes to future archive categories AND enumeration of live identities is clean (no folder-name filter needed).
- **Ashley verbatim:** *"I'm kind of a fan of like, keeping the archive folder at the fleet route, but naming it identities archive in sort of a sluggified way. And then if there was ever a roles archive, it could follow suit."*

### Shape grill 6: Scope of code changes
- **Options presented:** single phase covering id-skill + coordinator companions + agent-supervisor + four ambient monitor scripts + Skynet backend identity-birth SFTP target update, OR split the Skynet backend piece into a separate phase.
- **Ashley chose:** single phase covers all — her shutdown-then-deploy sequence naturally coordinates the substrate + Skynet edits into one atomic ship per box.
- **Ashley verbatim:** *"if you're just asking how to split the work up, then choose whatever's best."* (I recommended single phase; she greenlit with thumbs up.)

---

## This session's discuss-phase resolutions

### Gray area 1: Migration runbook location
- **Options presented:**
  - (a) role-scope runbook at `runbooks/on-disk-tree-migration/` under `box-maintainer` role.
  - (b) inline in the campaign bounty (`id-skill-revamp/`) as `migration-runbook.md`.
  - (c) README.md inside the phase directory.
  - (d) no dedicated artifact — bake steps into the campaign ship coord message.
- **My proposed:** (a) role-scope runbook.
- **Ashley reshaped:** not a role-scope runbook because it's one-shot per box, not repeatable operational procedure; also Stacy can't see box-maintainer's role-scope runbooks on t1000. Put it IN THE REPO so Stacy gets it when she pulls the campaign ship's code.
- **Ashley verbatim:** *"I agree with making a runbook, but it's not repeatable, because you guys are only going to ever use it once, and then Stacey can't see your runbook, so you're just going to have to pass it to her at some point. So, honestly, if there's any miscellaneous place that you could stick it in the repo itself, so that Stacey can easily get it when she does the update to these commits, then I think that would be good."*
- **Follow-up options presented for repo location:**
  - `.planning/phases/96-.../MIGRATION.md` (co-located with phase artifacts)
  - `substrate/migrations/on-disk-tree-consolidation.md` (new subtree in substrate)
  - Top-level `MIGRATION-notes/on-disk-tree.md`
- **My proposed:** `.planning/phases/96-.../MIGRATION.md` — co-located with the code changes, no new subtree to explain.
- **Ashley greenlit:** thumbs up.
- **Locked as D-10.**

### Gray area 2: Currently-archived identities
- **Options presented:**
  - Migrate them to `~/fleet/identities-archive/` as a default.
  - Leave them at `~/.claude/identities/archive/` as legacy state.
  - Delete them.
  - Prompt the maintainer at migration-time.
- **My proposed:** migrate them to `~/fleet/identities-archive/`.
- **Ashley reshaped:** runbook prompts the maintainer at migration-time; if archived identities exist, ask what to do; if none, skip the question entirely.
- **Ashley verbatim:** *"i think that the run book should just bring up that as a question when the agent is running it and if there are no archived identities then we don't need to ask the question and if there are then the user can decide what to do at the time."*
- **Locked as D-09.**

### Gray area 3: Path-audit scope
- **Options presented:**
  - Grep-clean of `~/.claude/identities/` and `~/.claude/roles/` in the touched files only.
  - Repo-wide grep sweep across all files (code, docs, tests, planning artifacts).
- **My proposed:** repo-wide grep sweep.
- **Ashley verbatim:** *"i agree with number three"* (referring to my proposed answer).
- **Locked as D-15.**

---

## Deferred ideas surfaced during discussion

- Migration script that automates the sequence — captured as deferred; each maintainer, each maintainer's window.
- CI-level grep gate to permanently prevent legacy path drift — captured as Claude's discretion for the planner.
- Non-code workspace conventions — captured as deferred; the first non-maintainer identity whose workspace matters will define its own convention.
- Shared path helper library across scripts — captured as deferred; a later refactor once the new paths are stable.
- Environment-variable override for the tree root — captured as deferred; single canonical path is the whole point.

---

## Claude's discretion (planner decides)

- Exact plan/wave breakdown — likely single-wave-multi-file, may split by file class.
- Whether to add a CI grep gate.
- Precise MIGRATION.md wording (content is fixed by D-07 + D-09 + D-10; the writing itself is planner + executor's).
- Test surface: mostly grep-based audit; some scripts have path-dependent unit tests that update.

---

*Phase: 96-on-disk-tree-consolidation-consolidate-identity-metadata-and*
*Discussion logged: 2026-09-10*
