# Quick 260906-2aw Summary: Role-file watcher as fourth ambient monitor

**Completed:** 2026-09-06
**Commit:** `2ec5bdf1a6cc44cd20dc7be08fad5d2548039a9b` on `feat/tab-title-from-tmux`
**Branch:** feat/tab-title-from-tmux

## One-liner

Stdlib-only Python role-file watcher as fourth ambient monitor: inotifywait-primary + polling fallback, per-identity baseline, inline diff / spill-to-file via recv.sh:152 INLINE_MAX=460, catalog entry 21st, id-skill body updated with on-wake section + filter-contract + file-locations.

## Files changed (git-tracked)

| File | Change |
|------|--------|
| `substrate/scripts/role-file-watch.py` | NEW — stdlib-only Python helper, chmod +x, shape parity with wakeup-scheduler + context-watch |
| `substrate/skills/id/SKILL.md` | Added `## On wake: start your role-file watch` section, updated filter-contract list (3→4 monitors), added `role-file-watch/` to File locations |
| `src/backend/distributor/catalog.ts` | 21st entry `role-file-watch` in helper-scripts section; docblock updated 20→21 row, 6→7 scripts, new reconciliation line |
| `src/backend/distributor/catalog.test.ts` | Test 1 `.toBe(20)→.toBe(21)`, Test 6 `scriptRows.toBe(6)→.toBe(7)`, comments updated |

## Live-filesystem edits made (not git-tracked)

1. **`~/.claude/skills/id/SKILL.md`** — Mirrored from substrate/skills/id/SKILL.md via `cp`. Zero diff post-copy (no live drift for the touched sections). Contains all three SKILL.md edits: new on-wake section, filter-contract fourth-monitor addition, file-locations `role-file-watch/` entry. Effect: this box's `/id` loads pick up the fourth monitor on next reload immediately, without waiting for a docker build.

2. **`~/.claude/roles/box-maintainer/substrate/scripts/role-file-watch.py`** — Copied from substrate/ and chmod +x. The box-maintainer role's `substrate/scripts/` is a live staging mirror of all shipped helpers (6 pre-existing files: agent-supervisor.sh, claude-usage-collector.py, context-watch.py, install-usage-reporter.sh, usage-reporter.sh, wakeup-scheduler.py). Added as the 7th to keep the staging tree in sync.

3. **`~/.claude/roles/box-maintainer/id-skill-handoff.md`** — Added fourth ambient monitor entry under "On-load ambient Monitors" list (after context-watch item 3). Describes role-file-watch purpose (diff-first mid-session role-file sync), cold-start behavior, and cross-references the shape file at `~/skynet-tanya/.planning/shapes/shape-role-file-watch.md` for design rationale.

## Spill threshold

- **Threshold chosen:** `INLINE_MAX = 460`
- **Citation:** `recv.sh:152` — `INLINE_MAX=460` is where recv.sh defines its own inline cap
- **Rationale:** `recv.sh:137` establishes that the harness truncates events at ~500 chars; INLINE_MAX=460 keeps the full event line under that cap
- **Script comment (exact):** `# spill threshold matches recv.sh:152 — INLINE_MAX=460 keeps the whole event line comfortably under the ~500-char harness cap (recv.sh:137)`

## box-maintainer role substrate/ staging

**Status: ADDED.** `~/.claude/roles/box-maintainer/substrate/scripts/` exists and is an active live staging tree mirroring all shipped scripts one-for-one. Pre-task it had 6 files. Post-task it has 7 (role-file-watch.py added, chmod +x).

## Scoped test result

```
cd ~/skynet-tanya && npx vitest run src/backend/distributor/catalog.test.ts
```

Result: **exit 0**, 8 tests passed (was 7 before this task; Test 7 exercised the new exec-bit requirement for the 7th script row).

```
npx tsc --noEmit
```

Result: **exit 0**, no type errors.

## Deviations from TASK.md

**None.** Plan executed exactly as written:

- Script shape parity with wakeup-scheduler.py + context-watch.py maintained (same shebang, module docstring, `def main()`, orphan-monitor guard, single-instance pidfile guard, argv shape, error-exit codes, signal handlers).
- Stash/unstash was used to `git pull --rebase` cleanly (unstaged changes present at rebase time; stash + rebase + pop, then staged and committed — net result is the same single atomic commit on rebased HEAD as specified).
- recv.sh:152 citation exact as specified.
- The `git stash` approach used for rebase is a standard workaround for the "cannot pull with rebase: unstaged changes" error — no architectural deviation.
