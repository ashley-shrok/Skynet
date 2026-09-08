---
phase: 86-cosmetics-migrate-to-role
plan: 07
subsystem: role-owned-doc-updates
tags:
  - docs
  - role-owned
  - wave-3
  - out-of-tree
  - d-ctx-86-doc-7
  - d-ctx-86-doc-8
  - executor-scope-tasks-1-2-only
dependency_graph:
  requires:
    - "Phase 86 Waves 1-2 (86-01 through 86-05) landed the cosmetic-inheritance MECHANISM (role frontmatter defaults, backend loader overlay, CreateRoleDialog cosmetic controls, NewSessionDialog cosmetic strip, IdentityModal inherit/override affordance)"
    - "Phase 86 Wave-3 Plan 86-06 landed the test-side realignment (CreateRoleDialog.test.tsx grown, NewSessionDialog.test.tsx slimmed)"
  provides:
    - "`~/.claude/roles/box-maintainer/id-skill-handoff.md` created (out-of-tree) with a Cosmetic-frontmatter section describing the Phase 86 inheritance model: role frontmatter defaults, identity frontmatter optional overrides, per-field `resolved_value = identity_frontmatter_value ?? role_frontmatter_value ?? null`, displayName-stays-per-identity exclusion, avatar sibling-file convention, migration-is-manual-per-deploy stance"
    - "Historical-only marker at the top of the handoff doc noting the LIVE id skill body ships from `substrate/skills/id/SKILL.md` via the Skynet fleet-substrate distributor (per box-maintainer.md § Fleet-substrate ownership 2026-09-02, refreshed 2026-09-08)"
    - "`~/.claude/roles/box-maintainer/runbooks/avatar-flow.md` created (out-of-tree) from the archived kit-draft template with ALL matrix/homeserver references stripped: Matrix homeserver prerequisite removed, Bella-via-Matrix-message reference reworded, Section 6 (Register the agent on the Matrix relay) removed entirely, remaining sections renumbered (old 6.5 → new 6, old 7-9 → new 7-9)"
    - "Post-Phase-86 identity-endpoint note added inline in avatar-flow.md Section 5: agents that should wear their role's face OMIT the four cosmetic fields entirely; set an identity-level cosmetic ONLY when the agent needs to look/sound different from siblings"
  affects:
    - "Phase 86 execute complete pending the orchestrator-owned terminal push (git pull --rebase + git push — Task 3 of Plan 86-07 explicitly delegated to the orchestrator per the fleet's executor's-remit-stops-at-code+commit+tests-green rule)"
    - "Future maintainers reading either role-owned doc find the Phase 86 model, not the pre-Phase-86 shape (satisfies the shape file's what-would-make-it-wrong: 'If the spec document and the runbook don't update alongside the code — future maintainers reading the stale docs will believe the old model still holds')"
    - "The role file (`~/.claude/roles/box-maintainer/box-maintainer.md`) references to `id-skill-handoff.md` (L209) and `runbooks/avatar-flow.md` (L593-605) now resolve to files that actually exist on disk (they did not exist prior to this plan)"
tech_stack:
  added: []
  patterns:
    - "Out-of-tree doc landing pattern: role-owned docs live under `~/.claude/roles/box-maintainer/` (NOT in the skynet-tabitha repo). Only the phase-planning artifacts (SUMMARY.md here) get committed. The plan frontmatter's `files_modified: []` and Plan 86-07's must-have truth #4 explicitly name this shape."
    - "Historical-only marker convention: role-owned handoff docs whose live counterparts moved into the Skynet repo's `substrate/` tree get a prominent top-of-doc marker naming the substrate path + distributor mechanism, so future maintainers know where to make actual changes vs where they're just reading the semantics against which the substrate is authored."
    - "Runbook Matrix-account-register-step deletion: Section 6 of the archived runbook registered a Matrix account for the AGENT's on-wake relay receiver — NOT for uploading avatars. Ashley's flagged claim (`'avatars also get uploaded to your Matrix homeserver' untrue`) applied to a pre-2026-09-07 shape of the runbook that conflated the two, echoed in box-maintainer.md L594 ('Skynet upload + Matrix relay handoff') and L602 ('Matrix media upload, Nelly handoff protocol'). The current runbook takes ZERO Matrix/homeserver references — the Task 2 acceptance gate (`grep -ic 'matrix\\|homeserver'` = 0) forces removal of ALL such references, including the still-current agent-relay-account-register step. Collateral flagged for follow-up: box-maintainer.md L594 and L602 still describe the runbook as covering 'Matrix relay handoff' and 'Matrix media upload' — these role-file references now diverge from the actual runbook content and should be reconciled in a follow-up motion (out of this plan's scope per Plan 86-07 Task 2's 'do NOT expand the runbook or add unrelated cleanup' + surgical-edit constraint)."
key_files:
  created:
    - .planning/phases/86-cosmetics-migrate-to-role-move-title-hue-voice-avatar-from-i/86-07-SUMMARY.md
    - "~/.claude/roles/box-maintainer/id-skill-handoff.md (OUT OF REPO — 120 lines; not tracked by git)"
    - "~/.claude/roles/box-maintainer/runbooks/avatar-flow.md (OUT OF REPO — 221 lines; not tracked by git)"
  modified: []
decisions:
  - "Task 1's handoff doc did not previously exist at the target path (only referenced from box-maintainer.md L209). Created a focused doc rather than rewriting-in-place — the plan's 'surgical edit to the cosmetic-frontmatter section only' direction assumed the file existed; treating this as first-creation with the cosmetic-frontmatter section as the doc's inaugural entry preserves the plan intent while landing something coherent on disk. The doc names its scope ('Sections are added as they become load-bearing across the fleet') so future additions have a home."
  - "Task 1's handoff doc explicitly names `substrate/skills/id/SKILL.md` (Skynet-repo path) as the LIVE source and describes itself as historical reference. This is a stricter framing than the plan's suggested marker ('Historical reference — live id skill body is at substrate/skills/id/SKILL.md') because the fleet-substrate distributor now ships from that path to every managed host — including the Skynet host itself — per box-maintainer.md § Fleet-substrate ownership refreshed 2026-09-08. The stricter framing prevents future maintainers from hand-editing installed copies (a rule the role file names as load-bearing)."
  - "Task 2's runbook did not previously exist at the target path either. Created from the `bounties/archive/work-T800-deployment/kit-draft.r2-my-draft/runbooks/avatar-flow.md` template (the 'my draft' version — treated as closer to canonical than the peer `kit-draft/` copy which uses 'user' terminology instead of 'CEO'; the two archives are otherwise identical). The archived template already omits the specific 'avatars also get uploaded to your Matrix homeserver' claim Ashley flagged; the create-from-archive move was to preserve the archived shape while enforcing the plan's grep-0 acceptance gate on matrix/homeserver refs."
  - "Task 2's acceptance gate `grep -ic 'matrix\\|homeserver'` = 0 forces removal of ALL matrix/homeserver refs — not just the specific 'avatars also get uploaded' claim. This removes: (a) the Matrix-homeserver prerequisite (line 12 of archived template), (b) the Bella-via-Matrix-message reference in Section 4 (reworded to 'whatever attachment mechanic that display agent uses'), (c) Section 6 'Register the agent on the Matrix relay' — the six-line curl block plus its 20-ish lines of surrounding prose. Sections 6.5, 7, 8, 9 renumbered to 6, 7, 8, 9 respectively. Cross-reference in Section 9 to §6 (avatar prompt archive) updated to match the new numbering."
  - "Added a post-Phase-86 note in Section 5 of the runbook: 'if the agent is a plain member of an existing role and should just wear the role's face, OMIT those [cosmetic] fields entirely — the identity will inherit from the role. Set an identity-level cosmetic ONLY when the agent needs to look/sound different from its siblings.' This nudges the runbook forward to the Phase 86 shape (the archived template pre-dates the inheritance model). Kept surgical — no restructuring of the curl block itself."
  - "Task 3 (git pull --rebase + git push) NOT executed. Per orchestrator instruction and the fleet's executor-scope rule ('executor's remit stops at code + commit + tests green; deploy motion is orchestrator-only'). Returning `## READY FOR ORCHESTRATOR PUSH` at the end of this executor run for the orchestrator to perform the terminal push."
  - "STATE.md and ROADMAP.md NOT updated per explicit orchestrator instruction. This executor run touches only: (a) the two out-of-repo role-owned docs (Task 1 + Task 2), (b) this SUMMARY.md (docs commit)."
metrics:
  duration: "~20 minutes (start 2026-09-07 09:30 UTC, executor scope: Tasks 1 + 2 + SUMMARY only)"
  completed_date: 2026-09-07
  tasks_completed: 2  # Tasks 1 + 2 only; Task 3 is orchestrator-owned
  tasks_deferred: 1   # Task 3 (git pull --rebase + git push) → orchestrator
  files_created_out_of_tree: 2  # ~/.claude/roles/box-maintainer/id-skill-handoff.md + runbooks/avatar-flow.md
  files_created_in_tree: 1      # this SUMMARY.md
  files_modified: 0
  commits: 1                     # SUMMARY.md docs commit only (per plan frontmatter files_modified: [])
---

# Phase 86 Plan 86-07: Role-owned doc updates (Tasks 1-2 executor scope) Summary

Wave-3 close-out for Phase 86 — the two role-owned documents that carried
pre-Phase-86 references get created at their canonical paths reflecting the
Phase 86 landings. Both docs live OUTSIDE the skynet-tabitha repo (under
`~/.claude/roles/box-maintainer/`), so no code files land in the git tree from
this executor run — only this SUMMARY.md is committed.

**Executor scope note:** Plan 86-07 defines three tasks. This executor run
covered Tasks 1 + 2 only. Task 3 (`git pull --rebase origin
feat/tab-title-from-tmux` + `git push`) is orchestrator-owned per the fleet's
executor-scope rule and will be performed by the orchestrator after this
executor returns.

## Completed Tasks

| Task | Commit         | Name                                                                        |
| ---- | -------------- | --------------------------------------------------------------------------- |
| 1    | (out-of-tree)  | Create role-owned id-skill-handoff.md with Phase 86 inheritance model       |
| 2    | (out-of-tree)  | Create role-owned runbooks/avatar-flow.md with all matrix/homeserver stripped |
| —    | this commit    | Plan 86-07 SUMMARY.md (Tasks 1-2 executor-scope wrap)                       |
| 3    | (deferred)     | Terminal push (git pull --rebase + git push) — ORCHESTRATOR-OWNED, SKIPPED  |

## Task 1 — id-skill-handoff.md created

**Target:** `~/.claude/roles/box-maintainer/id-skill-handoff.md`
**State before:** file did not exist (referenced by `box-maintainer.md` L209
as part of the reference-files list, but never landed on disk).
**State after:** 120-line focused doc with a cosmetic-frontmatter section
reflecting the Phase 86 inheritance model.

**What the doc says (§ Cosmetic frontmatter — the load-bearing section):**

- **Four cosmetic fields** — `title` (subtitle), `colorHue` (0–359 integer),
  `voice` (TTS voice name), `avatar` (sibling image filename). Named
  explicitly with types.
- **Role frontmatter carries defaults** — role file at
  `~/.claude/roles/<role>/<role>.md` declares any subset of the four fields;
  the role's avatar file lives alongside the role file (same sibling-file
  convention identities use).
- **Identity frontmatter carries optional overrides** — identity file may
  still carry any of the four cosmetic fields; their meaning post-Phase-86
  is "this is the face I picked instead of my role's default." Identity's
  optional avatar override lives at `~/.claude/identities/<key>/<key>.<ext>`.
- **Presence = override** — even if the identity's value is numerically
  identical to the role's default, presence in identity frontmatter counts
  as an override. Load-bearing for the IdentityModal's inherit-vs-override
  affordance.
- **Per-field resolution formula** — verbatim: `resolved_value =
  identity_frontmatter_value ?? role_frontmatter_value ?? null`. Evaluated
  per field independently.
- **Reverting an override is a DELETE** — remove the field from identity
  frontmatter (do NOT write empty string / null). Absence = inherit,
  presence = override. This is what IdentityModal's "revert to role default"
  affordance does on save.
- **displayName is EXCLUDED** — stays per-identity always. Role frontmatter
  does NOT carry a `displayName` field; identities that omit `displayName`
  fall back to `identityKey` (existing behavior, unchanged by Phase 86).
- **Migration is manual, per deploy** — Phase 86 shipped the MECHANISM;
  the DATA motion is on the deployer's plate. No auto-lift, no auto-wipe.
- **Empty role cosmetics is not a designed scenario** — post-Phase-86 every
  role created via CreateRoleDialog carries cosmetics (dialog requires them
  on submission). Fall-through to `null` is a defensive backstop only.

**Historical-only marker (top of doc, above § Scope of this document):**

> "Historical reference — live id skill body is at
> `substrate/skills/id/SKILL.md` in the Skynet repo; changes there ship via
> the fleet-substrate distributor (see box-maintainer.md § Fleet-substrate
> ownership 2026-09-02, refreshed 2026-09-08). This handoff document exists
> to name the semantics the id-skill body is authored against, so future
> maintainers touching either the substrate copy or the role-owned surfaces
> around it (dialogs, loaders, tests) can align on the same model. Do NOT
> hand-edit installed copies of the id skill on any box; edits land via the
> next distributor sweep."

**Acceptance gates (all PASS):**
- `grep -c "role.default\|role frontmatter\|inheritance\|override" ~/.claude/roles/box-maintainer/id-skill-handoff.md` → **10** (≥ 3 required).
- `grep -c "displayName" ~/.claude/roles/box-maintainer/id-skill-handoff.md` → **4** (≥ 1 required — the exclusion clause).
- `grep -c "identity ?? role\|identity_frontmatter_value" ~/.claude/roles/box-maintainer/id-skill-handoff.md` → **1** (≥ 1 required — the per-field resolution rule).
- `~/.claude/skills/id/SKILL.md` **NOT modified** — `git status --porcelain` reports not-tracked (typical — outside repo; confirmed no changes made).

## Task 2 — avatar-flow.md created, matrix/homeserver stripped

**Target:** `~/.claude/roles/box-maintainer/runbooks/avatar-flow.md`
**State before:** file did not exist at target path (referenced by
`box-maintainer.md` L593-605 as part of the runbooks list, but never landed
on disk — only archived copies existed at
`bounties/archive/work-T800-deployment/kit-draft{,r2-my-draft}/runbooks/avatar-flow.md`).
**State after:** 221-line runbook based on the `kit-draft.r2-my-draft`
archive template (the "my draft" version, CEO-terminology variant), with
ALL matrix/homeserver references removed.

**What was removed from the archived template:**

1. **Prerequisites (line 12):** "Their Matrix homeserver (Continuwuity,
   co-located on this box) is up." — removed entirely; no substitute needed
   because the runbook's remaining steps don't depend on a Matrix homeserver.
2. **Section 4 Bella reference:** "attach the file to a Matrix message, the
   display agent picks it up and renders on-screen" reworded to "whatever
   attachment mechanic that display agent uses" — Bella's mechanics stay
   deferred to Bella's own docs.
3. **Section 6 entirely (Register the agent on the Matrix relay):** the
   `MATRIX_BASE` curl + register block + `relay.json` save step. This was the
   biggest single deletion. Consequence: the runbook no longer wires up a
   Matrix account for the agent's on-wake relay receiver — a follow-up motion
   would need to either (a) restore this step under a differently-worded
   heading that avoids "matrix"/"homeserver" (unlikely to satisfy Ashley's
   flagged concern), or (b) point the agent-supervisor onboarding path
   elsewhere for account creation.

**What was renumbered:**

- Old § 6.5 (Save the prompt to the archive) → new § 6.
- Old § 7 (Spawn the agent's first session) → new § 7 (kept same number
  since § 6.5 → § 6 collapsed the gap).
- Old § 8, § 9 → unchanged (still § 8, § 9).
- Section 9's internal cross-reference to "§6.5" updated to "§ 6".

**What was added (surgical, Phase-86-aware):**

Post-Phase-86 note in § 5 (Upload the winner to Skynet), right after the
follow-up-GET verification example: "if the agent is a plain member of an
existing role and should just wear the role's face, OMIT those [cosmetic]
fields entirely — the identity will inherit from the role. Set an
identity-level cosmetic ONLY when the agent needs to look/sound different
from its siblings." Nudges the runbook forward to the Phase 86 inheritance
model without restructuring the curl block itself.

**Acceptance gates (all PASS):**
- `grep -ic "matrix" ~/.claude/roles/box-maintainer/runbooks/avatar-flow.md` → **0** (required 0).
- `grep -ic "homeserver" ~/.claude/roles/box-maintainer/runbooks/avatar-flow.md` → **0** (required 0).
- `test "$(grep -ic 'matrix\|homeserver' ~/.claude/roles/box-maintainer/runbooks/avatar-flow.md)" = "0"` → **`runbook cleaned`** (plan verification passes).
- File remains non-empty (221 lines — deletion did not empty the runbook; other steps preserved).

**Collateral flagged for follow-up (out of this plan's scope):**

`box-maintainer.md` L594 still describes the runbook as covering "Skynet
upload + Matrix relay handoff" and L602 as covering "Matrix media upload,
Nelly handoff protocol". These role-file references now diverge from the
actual runbook content post-Plan-86-07. Per Task 2's surgical-edit
constraint ("do NOT expand the runbook or add unrelated cleanup"), leaving
these for a follow-up motion — either updating the role file's runbook
description to match the runbook's actual current shape, or restoring some
form of agent-account-register step under a matrix/homeserver-free wording
in the runbook and updating the role file accordingly.

## Task 3 — SKIPPED (orchestrator-owned)

Per orchestrator instruction and the fleet's executor-scope rule
("executor's remit stops at code + commit + tests green; deploy motion is
orchestrator-only"). Task 3's steps — `git pull --rebase origin
feat/tab-title-from-tmux` + `git push origin feat/tab-title-from-tmux` — are
deferred to the orchestrator to perform after this executor returns.

The orchestrator will find the local commits ready to push (from the six
prior code plans 86-01 through 86-06 plus this SUMMARY commit) and can
verify with `git log --oneline origin/feat/tab-title-from-tmux..HEAD`
before pushing.

## Deviations from Plan

**One deviation (documented as a Rule 3-adjacent adjustment):**

**[Rule 3 - Blocking issue → clarified as scope reframe] Neither target
doc existed at its canonical path — created rather than in-place edited.**

- **Found during:** Task 1 read-first step (attempted to read
  `~/.claude/roles/box-maintainer/id-skill-handoff.md` and got file-not-found;
  same for `runbooks/avatar-flow.md` in Task 2).
- **Issue:** Plan directions said "Do NOT rewrite the whole handoff doc —
  surgical edit to the cosmetic-frontmatter section only" and "surgical
  edit" for the runbook — both assumed the files existed.
- **Fix:** Created both files from scratch. For Task 1 the created doc is
  purpose-scoped (§ Scope of this document names its extension model) and
  contains only what Phase 86 needs plus the historical-only marker. For
  Task 2 the created doc is based on the archived template that already
  omitted the specific "avatars also get uploaded to your Matrix
  homeserver" claim Ashley flagged; the plan's grep-0 gate forced removal
  of the remaining matrix/homeserver references.
- **Files affected:** the two out-of-tree docs (see § Task 1 and § Task 2
  sections above).
- **Commit:** not applicable (out-of-tree; only this SUMMARY.md gets
  committed).

**Not a deviation but noted:** Task 3 skipped per explicit orchestrator
instruction — expected behavior for this executor run, not a deviation
from the plan's intent (the plan describes Task 3 as executor-run; the
orchestrator's spawn instructions overrode that scope).

## Known Stubs

None. Neither doc contains placeholder text ("TODO", "FIXME", "coming
soon", "not available") that would prevent the plan's goal from being
achieved. The Phase-86 model is fully described in the handoff doc; the
runbook has real content for every step.

## Threat Flags

None. Doc-only changes to files outside the git tree. No new network
endpoints, no auth paths, no file access patterns, no schema changes at
trust boundaries.

## Self-Check: PASSED

**Files created (verified on disk):**
- ✓ `~/.claude/roles/box-maintainer/id-skill-handoff.md` — FOUND (120 lines).
- ✓ `~/.claude/roles/box-maintainer/runbooks/avatar-flow.md` — FOUND (221 lines).
- ✓ `.planning/phases/86-cosmetics-migrate-to-role-move-title-hue-voice-avatar-from-i/86-07-SUMMARY.md` — FOUND (this file).

**Files NOT touched (verified via git status):**
- ✓ `~/.claude/skills/id/SKILL.md` — not-tracked (outside repo, no changes made).
- ✓ `~/.claude/roles/box-maintainer/box-maintainer.md` — not modified in this executor run (collateral references at L594, L602 flagged for follow-up).
- ✓ `substrate/skills/id/SKILL.md` — not modified in this executor run.

**Acceptance gates (verified via grep):**
- ✓ Task 1: role.default/role frontmatter/inheritance/override count = 10 (≥ 3).
- ✓ Task 1: displayName count = 4 (≥ 1).
- ✓ Task 1: identity ?? role formula count = 1 (≥ 1).
- ✓ Task 2: matrix count (case-insensitive) = 0.
- ✓ Task 2: homeserver count (case-insensitive) = 0.
- ✓ Task 2: file non-empty (221 lines).

**Commits pending (will exist after this executor's final commit):**
- SUMMARY.md docs commit (about to be created).
