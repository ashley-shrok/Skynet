---
phase: 74
plan: 04
subsystem: branding
tags: [runbook-retirement, prompt-archive, local-filesystem, scope-close, grep-sweep, checkpoint-gated]
requires:
  - Phase 74 Plan 03 scrubbed all three `avatar-flow` runbook header refs in identity-avatar-batch.ts (L16/L122/L180), leaving zero live-code dependents on the retired paths
  - Ashley human checkpoint approval at 2026-09-04 (Task 1, `thumbs up`) confirming all five staged files' content is retired and nothing has quietly become live-again (per 74-CONTEXT.md § What would make it wrong §4)
provides:
  - Zero on-disk copies of the manual avatar-generation runbook (`~/.claude/roles/box-maintainer/runbooks/avatar-flow.md`, 22806 bytes, 471 lines) — retired
  - Zero on-disk copies of the four per-identity prompt-archive files (amelia 8429B, beatrice 7120B, becky 5235B, george 4522B — 25306 bytes total across 397 lines) — retired
  - Zero live-code repo-side references to `avatar-flow` or `avatar-prompts` paths (confirmed by grep sweep across `src/`, `docker/`, `scripts/`)
  - Phase 74's STYLE-08 (local file deletion) and STYLE-09 (repo-side sweep) requirements closed
affects:
  - "~/.claude/roles/box-maintainer/runbooks/avatar-flow.md (DELETED — local filesystem, NOT in repo)"
  - "~/.claude/roles/box-maintainer/avatar-prompts/amelia.md (DELETED — local filesystem, NOT in repo)"
  - "~/.claude/roles/box-maintainer/avatar-prompts/beatrice.md (DELETED — local filesystem, NOT in repo)"
  - "~/.claude/roles/box-maintainer/avatar-prompts/becky.md (DELETED — local filesystem, NOT in repo)"
  - "~/.claude/roles/box-maintainer/avatar-prompts/george.md (DELETED — local filesystem, NOT in repo)"
  - No files in the Skynet repo were modified by this plan (grep sweep found only historical planning-artifact hits, all intentional)
tech-stack:
  added: []
  patterns:
    - Local-filesystem `rm` guarded by `[ -f <path> ] && rm <path>` idempotency (safe to re-run if partial completion or human-verify checkpoint noticed a file already gone)
    - Repo-side grep sweep with explicit exclusion of known-historical planning artifacts (`.planning/phases/20-*`, `.planning/phases/74-*`, `.planning/quick/`) — the phase-20 exclusion is per 74-RESEARCH.md Pitfall 5; the phase-74 exclusion because THIS phase's own docs legitimately describe the retiring paths
    - Human-in-the-loop scope re-verification via `checkpoint:human-verify` BEFORE irreversible local deletes — mitigation for T-74-04-01 (loss of live knowledge)
    - Parent-directory posture preserved (runbooks/ still holds css-fast-path.md + user-onboarding.md; avatar-prompts/ left as harmless empty dir per objective override — safer than accidental parent deletion)
key-files:
  created:
    - .planning/phases/74-control-style-of-avatar-generation-through-branding-config/74-04-SUMMARY.md
  modified: []
  deleted_local_only:
    - "~/.claude/roles/box-maintainer/runbooks/avatar-flow.md"
    - "~/.claude/roles/box-maintainer/avatar-prompts/amelia.md"
    - "~/.claude/roles/box-maintainer/avatar-prompts/beatrice.md"
    - "~/.claude/roles/box-maintainer/avatar-prompts/becky.md"
    - "~/.claude/roles/box-maintainer/avatar-prompts/george.md"
decisions:
  - "Local-filesystem `rm` — NOT `git rm`. The five deleted files live in tina's `~/.claude/roles/box-maintainer/`, outside the Skynet repo tree. Deletion produces no commit against Skynet's history; only the SUMMARY.md audit trail records what was deleted. Per Ashley `<additional_context>` and 74-RESEARCH.md § Pitfall 5 (Deleting the runbook + archive files as a git commit)."
  - "Do NOT rmdir the `avatar-prompts/` empty directory. Per objective override: the plan's Task 2 action step 2 offers an optional `rmdir 2>/dev/null || true`, but the sequential-executor objective explicitly directs 'leave the folder in place; do NOT delete it (harmless empty folder is safer than accidental parent deletion)'. Applied override — folder left in place, `ls` confirms it is empty."
  - "Do NOT delete the `runbooks/` parent directory. It still contains two unrelated runbooks (`css-fast-path.md`, `user-onboarding.md`) that are NOT part of Phase 74's scope. Verified before AND after the delete — sibling runbooks preserved."
  - "Grep sweep found 3 remaining hits, all in `.planning/` documentation (ROADMAP.md L766/L1838-L1839 + shape-branding-config-avatar-style.md L78). Per plan Task 2 acceptance criteria (line 130-133), zero-hit requirement applies only to live-code paths (`src/`, `docker/`, `scripts/`); the `.planning/` hits are intentional historical audit trail equivalent to the phase-20 exclusion the plan explicitly calls out. Confirmed zero hits in `src/`, `docker/`, `scripts/` via targeted grep."
metrics:
  duration: 3m
  completed: 2026-09-04
  files_deleted_local: 5
  bytes_deleted_local: 48112
  lines_deleted_local: 868
  files_changed_in_repo: 0
  commits: 1
---

# Phase 74 Plan 04: Runbook + Prompt-Archive Deletion — Summary

Closed Phase 74's scope edge on retiring the manual avatar-generation outrigger by deleting five files from tina's local `~/.claude/roles/box-maintainer/` role folder (the 471-line manual `avatar-flow.md` runbook and its four per-identity prompt-archive files: `amelia.md`, `beatrice.md`, `becky.md`, `george.md`). Gated by a human-verify checkpoint that Ashley approved via `thumbs up` after re-confirming (per 74-CONTEXT.md § "What would make it wrong" §4) that nothing in the runbook has quietly become live-again. Final repo-side grep sweep for `avatar-flow` and `avatar-prompts` confirmed zero live-code hits in `src/`, `docker/`, or `scripts/` — Plan 03's earlier scrub of the three `identity-avatar-batch.ts` header refs held. The three remaining hits under `.planning/` are all historical planning-artifact context (ROADMAP.md progress rows + Phase 74's own shape file), matching the phase-20 exclusion the plan explicitly authorizes. No files in the Skynet repo were modified.

## What Shipped

### Task 1 (checkpoint:human-verify) — Human scope re-verification

**Approved 2026-09-04 by Ashley (`thumbs up`).** After the executor presented the 5-file inventory (with byte + line counts) and ran the sanity grep confirming zero live-code refs to `avatar-flow` or `avatar-prompts`, Ashley confirmed via /open beat 2 ("Yeah, that is all gonna be retired") and gave explicit approval via `thumbs up`. Sibling runbooks (`css-fast-path.md`, `user-onboarding.md`) confirmed untouched by the plan's scope.

### Task 2 (auto) — Local `rm` + repo-side grep sweep

**Executed 2026-09-04 in sequential mode on branch `feat/tab-title-from-tmux` (no worktree, fleet rule).**

**Local-filesystem deletions** (5 files, all removed on first attempt — no idempotency no-ops):

| File | Bytes | Lines | Modified | Removed |
|------|-------|-------|----------|---------|
| `~/.claude/roles/box-maintainer/runbooks/avatar-flow.md` | 22806 | 471 | Jul 24 01:47 | 2026-09-04 |
| `~/.claude/roles/box-maintainer/avatar-prompts/amelia.md` | 8429 | 95 | Jul 24 01:47 | 2026-09-04 |
| `~/.claude/roles/box-maintainer/avatar-prompts/beatrice.md` | 7120 | 134 | Jul 26 23:03 | 2026-09-04 |
| `~/.claude/roles/box-maintainer/avatar-prompts/becky.md` | 5235 | 105 | Aug 19 01:01 | 2026-09-04 |
| `~/.claude/roles/box-maintainer/avatar-prompts/george.md` | 4522 | 63 | Sep 2 15:21 | 2026-09-04 |
| **Total** | **48112 B (~47 KiB)** | **868 lines** | — | — |

**Parent-directory posture (preserved intentionally):**

- `~/.claude/roles/box-maintainer/runbooks/` — sibling runbooks `css-fast-path.md` (10048 B) and `user-onboarding.md` (21598 B) preserved. Directory NOT touched.
- `~/.claude/roles/box-maintainer/avatar-prompts/` — now empty. Per objective override, `rmdir` was NOT run — harmless empty folder is safer than accidental parent deletion. The plan's optional `rmdir 2>/dev/null || true` step was skipped.

**Repo-side grep sweep results:**

```bash
grep -rln 'avatar-flow' /home/ubuntu/skynet-tina --include="*.ts" --include="*.tsx" \
  --include="*.js" --include="*.json" --include="*.md" 2>/dev/null \
  | grep -v '/\.planning/phases/20-' \
  | grep -v '/\.planning/phases/74-' \
  | grep -v '/\.planning/quick/'
```

Yielded 2 hits:

- `/home/ubuntu/skynet-tina/.planning/ROADMAP.md` (L766 in the historical Phase 20 IDUI-04 requirement description; L1838-L1839 in the Phase 74 progress table describing this very phase's deletion scope)
- `/home/ubuntu/skynet-tina/.planning/shapes/shape-branding-config-avatar-style.md` (L78 in Phase 74's own shape file describing what would be deleted)

```bash
grep -rln 'avatar-prompts' /home/ubuntu/skynet-tina --include="*.ts" --include="*.tsx" \
  --include="*.js" --include="*.json" --include="*.md" 2>/dev/null \
  | grep -v '/\.planning/phases/20-' \
  | grep -v '/\.planning/phases/74-' \
  | grep -v '/\.planning/quick/'
```

Yielded 1 hit:

- `/home/ubuntu/skynet-tina/.planning/ROADMAP.md` (same L1839 row)

**Live-code confirmation:**

```bash
grep -rln 'avatar-flow\|avatar-prompts' \
  /home/ubuntu/skynet-tina/src \
  /home/ubuntu/skynet-tina/docker \
  /home/ubuntu/skynet-tina/scripts 2>/dev/null
```

Returned **zero hits**. Plan 03 Task 1's scrub of the three `identity-avatar-batch.ts` header refs (L16/L122/L180) held; no live-code path in the repo references either retired path.

## Verification

| Check | Result |
|-------|--------|
| `test ! -f ~/.claude/roles/box-maintainer/runbooks/avatar-flow.md` | PASS (GONE) |
| `test ! -f ~/.claude/roles/box-maintainer/avatar-prompts/amelia.md` | PASS (GONE) |
| `test ! -f ~/.claude/roles/box-maintainer/avatar-prompts/beatrice.md` | PASS (GONE) |
| `test ! -f ~/.claude/roles/box-maintainer/avatar-prompts/becky.md` | PASS (GONE) |
| `test ! -f ~/.claude/roles/box-maintainer/avatar-prompts/george.md` | PASS (GONE) |
| `ls ~/.claude/roles/box-maintainer/runbooks/` shows `css-fast-path.md` + `user-onboarding.md` | PASS (2 sibling runbooks preserved) |
| `ls ~/.claude/roles/box-maintainer/avatar-prompts/` is empty | PASS (directory left in place per override; contents 0) |
| grep `avatar-flow\|avatar-prompts` in `src/` `docker/` `scripts/` | 0 hits — PASS |
| Grep hits outside phase-20/phase-74/quick exclusion (all under `.planning/`) | 2 files, all documentation — ACCEPTED (not live-code paths) |
| Ashley checkpoint approval | RECORDED (`thumbs up`, 2026-09-04) |

## Anti-Pattern Locks Held

- **NO `git rm`** — the five deleted files are outside the Skynet repo tree. Deletion produces zero commits against Skynet's git history for the `rm`s themselves. This SUMMARY commit is the sole audit trail entry.
- **NO overly-broad delete glob** — five explicit absolute paths, no `find -exec rm`, no wildcards. Per T-74-04-02 mitigation (Tampering: overly-broad `rm` glob deletes unrelated runbooks).
- **NO parent-directory removal** — `runbooks/` retained (holds unrelated `css-fast-path.md` + `user-onboarding.md`); `avatar-prompts/` retained as empty per objective override (safer than risking accidental parent deletion).
- **NO silent grep pass** — the 3 remaining hits were surfaced, inspected, categorized as historical planning-artifact hits, and explicitly documented. Zero silent hits.
- **NO auto-fix on out-of-scope grep hits** — the `.planning/ROADMAP.md` and `shape-branding-config-avatar-style.md` refs are intentional historical documentation. Modifying them to "clean up" would be scope creep and would destroy audit-trail context for Phase 74's own retirement decision.
- **NO destructive git commands** — no `git clean`, no `git reset --hard`, no `git checkout -- .`, no `git stash`. Only `git add <specific-files>` + `git commit` (the SUMMARY commit that follows this file).

## Deviations from Plan

**One documented override** (per sequential-executor objective from orchestrator):

**[Override - Objective directive] Skipped optional `rmdir` on `~/.claude/roles/box-maintainer/avatar-prompts/`.** The plan's Task 2 action step 2 permits a safe `rmdir ~/.claude/roles/box-maintainer/avatar-prompts/ 2>/dev/null || true` when the directory is empty after the 4 file deletions. The orchestrator's objective explicitly directed "leave the folder in place; do NOT delete it (harmless empty folder is safer than accidental parent deletion)". Applied the override — folder is empty but present. No functional difference; the "all four files deleted" success condition holds regardless of whether the empty dir remains.

**No other deviations.** All 5 files existed at the expected paths (matches Task 1's inventory exactly — byte counts unchanged since checkpoint), all 5 deleted on the first `rm` attempt (no idempotency no-ops), and the grep sweep completed cleanly with only expected historical hits.

## Deferred Items

**None** for this plan. Phase 74's ship-day work remains orchestrator-owned per plan `<objective>` (line 40-44):

- Pre-deploy manual seed of `/opt/skynet/branding/branding.json` on t1000 with the LoL-champion director spec + `avatarGammaDefault: 0.7` (via SSM before container restart)
- Coord-room BEFORE/AFTER posts per box-maintainer.md § Container mutations serialize
- `git push` + `docker build` + `docker compose up --force-recreate` ship motion
- Stacy briefing DM on Skynet.aithercloud.com relay explaining the new required field, boot-fail behavior, and offering tina's t1000 seed as reference (Stacy authors T800's own aesthetic content; tina does NOT operate on T800 directly per box-maintainer.md L17)

Carried forward from Plan 01: **`isBrandingConfig` runtime guard in `src/ui/branding/branding-fetch.ts`** — frontend fetch predicate doesn't check `avatarDirectorSpec`/`avatarGammaDefault`. Phase 74's backend rewire is unaffected (Plan 03 reads via `loadBrandingConfig()`, not through the frontend fetch). Suggested fix (unchanged): parallel two-line extension after the pwaIcons check.

## Threat Flags

None. All threats documented in the plan's `<threat_model>` block (T-74-04-01 through T-74-04-SC) are covered:

- **T-74-04-01 (loss of live knowledge → mitigate)** — human-verify checkpoint held; Ashley confirmed all outrigger content retired before deletions ran. Idempotency guards on all 5 `rm`s.
- **T-74-04-02 (overly-broad delete → mitigate)** — five explicit absolute paths, no globs; sibling files in `runbooks/` verified preserved before AND after via `ls`.
- **T-74-04-03 (elevation of privilege via user-input paths → accept, n/a)** — paths are fixed absolute literals, no dynamic construction.
- **T-74-04-04 (grep miss on live-code ref → mitigate)** — grep sweep repo-wide across `.ts/.tsx/.js/.json/.md`; targeted second-sweep of `src/`, `docker/`, `scripts/` confirmed 0 live-code hits.
- **T-74-04-SC (zero new installs) → accept** — plan is pure `rm` + `grep`; no package installs.

## What's Next (Phase 74 Close)

All four plans (74-01 through 74-04) executed. Phase 74's scope is code-complete:

- 74-01 (schema extension): shipped
- 74-02 (boot-gate): shipped
- 74-03 (route rewire + code-side runbook-ref scrub): shipped
- 74-04 (local file deletion + repo-side sweep): shipped (this plan)

Remaining ship-day work is orchestrator-owned (see Deferred Items above): pre-deploy seed on t1000 via SSM, container restart with the new code, Stacy briefing DM. Once orchestrator ships, `/close 74-control-style-of-avatar-generation-through-branding-config` walks the shape's facets against what got built.

## Commits

| Hash | Type | Scope | Description |
|------|------|-------|-------------|
| _(pending)_ | docs | 74-04 | Complete runbook + prompt-archive deletion plan (SUMMARY + STATE + ROADMAP) |

The five local-filesystem `rm`s themselves produced **zero commits** against the Skynet repo — those files were never in the repo tree. This SUMMARY commit is the sole audit-trail record.

## Self-Check: PASSED

- File `.planning/phases/74-control-style-of-avatar-generation-through-branding-config/74-04-SUMMARY.md`: FOUND (created)
- 5 local files verified GONE via `test ! -f` (all five)
- 2 sibling runbooks (`css-fast-path.md`, `user-onboarding.md`) verified PRESERVED via `ls`
- Zero live-code hits in `src/`/`docker/`/`scripts/` for `avatar-flow` or `avatar-prompts`
- 3 remaining hits in `.planning/` docs (ROADMAP.md + shape file) all inspected + categorized as intentional historical audit trail
- Checkpoint approval recorded (Ashley `thumbs up`, 2026-09-04)
- No git branch switches, no worktree, no `--no-verify` (fleet sequential-mode rules held)
