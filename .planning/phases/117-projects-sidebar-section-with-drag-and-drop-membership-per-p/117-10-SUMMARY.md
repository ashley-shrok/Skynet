---
phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
plan: 10
subsystem: fleet-substrate / id-skill
tags: [id-skill, substrate, projects, distributor, backward-compat]
requires:
  - substrate/skills/id/SKILL.md (existing, § 2 "Loading an existing identity")
  - src/backend/distributor/catalog.ts (existing, 4-row id-skill entry at :216-244)
provides:
  - id-skill body carries a project-awareness clause on `/id` load — reads `~/fleet/projects/<slug>/project.md` and enumerates the project dir when the identity's frontmatter has a `project:` key
affects:
  - Every managed host on next fleet-substrate distributor sweep — the edited SKILL.md body ships via byte-compare, no code change required
tech_stack_added: []
tech_stack_patterns:
  - "Silent-directory-enumeration pattern (mirrors runbooks enumeration)"
  - "Graceful-no-op on missing/dangling/archived reference (mirrors D-07's sidebar behavior on the id-skill side)"
key_files_created: []
key_files_modified:
  - substrate/skills/id/SKILL.md
decisions_enacted: [D-32, D-33, D-34, D-35]
metrics:
  duration: "~15 minutes"
  completed_date: "2026-09-18"
  tasks_completed: 1
  files_modified: 1
---

# Phase 117 Plan 10: id-skill Amendment — Project-Awareness Clause Summary

**One-liner:** Body-edit to `substrate/skills/id/SKILL.md` inserting a project-awareness clause into § 2 "Loading an existing identity" — new numbered step 4 that reads `~/fleet/projects/<slug>/project.md` and enumerates the project directory silently when the identity's frontmatter has a `project:` key, with graceful no-op on missing/dangling/archived; ships automatically via the fleet-substrate distributor's next sweep.

## What Landed

- **Single body-edit** to `substrate/skills/id/SKILL.md`.
- **Insertion location:** § 2 "Loading an existing identity", between existing numbered step 3 ("Read any per-identity specialization from the slim identity file") and existing step 4 ("Read the deeper reference file(s)…").
- **Line range in file (post-edit):** new step 4 spans lines 207–217 (11 lines including the empty-line separator); existing "deeper reference files" step is renumbered from 4 → 5 and now lives at line 219.
- **Number of subsequent steps renumbered:** 1 — the "deeper reference files" step, from step 4 → step 5. No other numbered steps in § 2 exist below the insertion point (the runbook-enumeration text further down is prose, not a numbered list item, so it did not require renumbering).
- **Numbering coherence check** (§ 2 post-edit, top-to-bottom): `1, 2, 3, 4, 5` — sequential, no gaps.

## Exact Text Inserted

```
4. **Read the project file, if any.** Check the identity file's frontmatter for a
   `project: <slug>` key. If present:
   - Read `~/fleet/projects/<slug>/project.md` into context — it names what this
     project is for, plus any shared conventions or references the project needs.
   - Silently enumerate the top-level contents of `~/fleet/projects/<slug>/`. Hold
     the names in context. Each file's contents load on demand via a normal Read
     tool call — same shape as the runbooks enumeration below.
   - If the frontmatter has no `project:` field, OR the slug points to a directory
     that doesn't exist on disk, OR points to an archived project at
     `~/fleet/projects/archive/<slug>/`, this step is a graceful no-op — continue
     without it.
```

Verbatim reproduction of the draft in `117-RESEARCH.md § id-skill Amendment Draft` (near line 685). No text changes; no wording drift.

## Byte-Identity Confirmations

- **Companion files unchanged (byte-identical):**
  - `substrate/skills/id/actor-status-prompt.md` — `git diff` shows no output.
  - `substrate/skills/id/clone-picker-prompt.md` — `git diff` shows no output.
  - `substrate/skills/id/coordinator-instructions.md` — `git diff` shows no output.
- **Distributor catalog unchanged (byte-identical):**
  - `src/backend/distributor/catalog.ts` — `git diff` shows no output. The 4-row id-skill entry at :216-244 covers SKILL.md verbatim; the byte-compare sweep will pick up the body change automatically on next tick (D-34).
- **§ "Coordinator mode" block unchanged:** the block starting at line 237 (`## Coordinator mode`) is byte-identical to the pre-edit state. Coordinators still skip § 2's numbered load steps via the alternate load path — semantic behavior preserved. The literal "steps 1–4" phrasing inside that block was left in place per the acceptance criterion; coordinators skip ALL of § 2's numbered steps regardless of exact count, so the descriptive shorthand remains semantically stable.
- **§ 2's coordinator-check callout line (line 198, INSIDE § 2)** was likewise left as "skip steps 1–4 below" — same rationale. Both references remain descriptive of "skip the numbered load steps below" and neither drives coordinator behavior; the coordinator's alternate load path in § Coordinator mode is what actually replaces § 2 for them.

## Post-Edit Numbering Scheme in § 2

Top-to-bottom sanity check (only the numbered load steps; prose paragraphs elided):

- Step **1**: Resolve the role folder.
- Step **2**: Read the ROLE FILE at `~/fleet/roles/<role>/<role>.md`.
- Step **3**: Read any per-identity specialization from the slim identity file.
- Step **4** *(new)*: Read the project file, if any (project-awareness clause).
- Step **5** *(was 4)*: Read the deeper reference file(s) the role names in its 10k-view section, ON DEMAND.

Sequential, no gaps, no duplicates.

## Decisions Enacted

- **D-32** — The id-skill checks the identity file's frontmatter for `project:` after reading role/handoff/per-identity specialization; on presence, reads `~/fleet/projects/<slug>/project.md` and enumerates the project directory silently. **Enacted** in the exact insertion described above.
- **D-33** — Missing / dangling-to-nonexistent-directory / archived slugs at `~/fleet/projects/archive/<slug>/` are graceful no-ops. **Enacted** via the third bullet of the new step, naming all three no-op conditions verbatim.
- **D-34** — Amendment ships via the fleet-substrate distributor; the 4-row catalog entry at `src/backend/distributor/catalog.ts:216-244` already covers SKILL.md, so no catalog change is needed and the next sweep picks up the body edit via byte-compare. **Enacted** by NOT editing the catalog.
- **D-35** — Backward-compatible with identities that lack `project:` frontmatter. **Enacted** — the no-op branch explicitly names the "no `project:` field" case, so pre-existing identities load exactly as they did before this amendment.

## Verification

- `grep -c "Read the project file, if any" substrate/skills/id/SKILL.md` → `1` ✓ (acceptance says `1`).
- `grep -c "fleet/projects/<slug>/project.md" substrate/skills/id/SKILL.md` → `1` ✓ (acceptance says ≥ 1).
- `grep -c "fleet/projects/archive/<slug>" substrate/skills/id/SKILL.md` → `1` ✓ (acceptance says ≥ 1).
- `grep -c "graceful no-op" substrate/skills/id/SKILL.md` → `1` ✓ (acceptance says ≥ 1).
- `git diff --name-only substrate/skills/id/` → `substrate/skills/id/SKILL.md` (exactly one file) ✓.
- `git diff --name-only src/backend/distributor/` → empty ✓ (catalog untouched).
- `npx tsc --noEmit -p tsconfig.json` → exit code 0, no output ✓ (regression guard clean).

## Deviations from Plan

None — the plan called out one minor plan-vs-reality wrinkle in advance (the plan described the insertion as "between per-identity-specialization and the runbooks-enumeration step", but the RESEARCH.md draft comment and the current SKILL.md structure clarify that the insertion is actually between the per-identity-specialization step and the deeper-reference-files step, because the runbook enumeration is a prose paragraph AFTER the numbered list, not a numbered step). The plan's `<action>` block accounted for this ("adjust accordingly … the executor should read the current numbering style and match it verbatim"), so no rule-driven deviation was needed. The RESEARCH.md draft's own line-position comment ("insertion point at end of § 2 step 3 (after 'Read any per-identity specialization…'), before step 4 (deeper reference files)") matched what I actually did.

## Commits

- `9a65f8a` — feat(117-10): id-skill amendment — project-awareness clause on /id load

## Post-Deploy Ripple (Orchestrator-Owned, Not in Executor Scope)

Per plan `<success_criteria>` note and RESEARCH § Pitfall 6: peer identities need a relay DM one turn after successful deploy so they know projects is a live substrate concept they can start using. This notification is orchestrator-owned; the executor did not send it.

## Self-Check: PASSED

- **Files claimed created:** none (this is a body-edit plan).
- **Files claimed modified:** `substrate/skills/id/SKILL.md` — FOUND on disk with the new step 4 present (verified by grep, verified by inspecting lines 207–219 post-edit).
- **Commits claimed:** `9a65f8a` — FOUND in `git log`.
- **Companion files claimed byte-identical:** `actor-status-prompt.md`, `clone-picker-prompt.md`, `coordinator-instructions.md` — all clean per `git diff --name-only`.
- **Distributor catalog claimed byte-identical:** `src/backend/distributor/catalog.ts` — clean per `git diff --name-only src/backend/distributor/`.
- **Regression guard:** `npx tsc --noEmit -p tsconfig.json` exits 0.

All claims verified.
