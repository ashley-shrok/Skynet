---
phase: 96-on-disk-tree-consolidation-consolidate-identity-metadata-and
plan: "04"
subsystem: substrate-scripts
tags: [path-rewrite, fleet-tree, archive-sibling, D-02, D-04, D-05]
dependency_graph:
  requires: []
  provides: [agent-supervisor-fleet-paths, archive-sibling-variable, workspace-workdir-convention, monitor-scripts-fleet-paths]
  affects: [substrate/scripts/agent-supervisor.sh, substrate/scripts/tests/agent-supervisor-archive-scan.sh, substrate/scripts/role-file-watch.py, substrate/scripts/wakeup-scheduler.py, substrate/skills/agent-relay/recv.sh]
tech_stack:
  added: []
  patterns: [env-override-test-seam, sibling-archive-dir]
key_files:
  created: []
  modified:
    - substrate/scripts/agent-supervisor.sh
    - substrate/scripts/tests/agent-supervisor-archive-scan.sh
    - substrate/scripts/role-file-watch.py
    - substrate/scripts/wakeup-scheduler.py
    - substrate/skills/agent-relay/recv.sh
decisions:
  - "IDENTITIES_ARCHIVE_DIR declared as explicit sibling variable (not derived from IDENTITIES_DIR + /archive) to prevent accidental path composition (Trap 1 from RESEARCH.md)"
  - "Test driver uses ${scratch}-archive as sibling scratch dir matching the sibling layout; _source_supervisor exports AGENT_IDENTITIES_ARCHIVE_DIR derived from scratch parameter"
  - "Dead archive skip filter in resolve_identities and run_archive_scan removed; protection now comes from .md file guard (an archive folder named 'archive' has no archive/archive.md)"
metrics:
  duration_minutes: 12
  completed: "2026-09-10T01:23:39Z"
  tasks_completed: 2
  files_modified: 5
---

# Phase 96 Plan 04: Substrate Script Path Rewrite Summary

One-liner: Migrate agent-supervisor.sh to fleet tree with IDENTITIES_ARCHIVE_DIR as a sibling variable, update Phase 94 archive-scan test driver to use a separate archive scratch dir, and update Python/shell monitor prose.

## Task 1: agent-supervisor.sh

### Variable Declarations (lines ~32–36)

| Before | After |
|--------|-------|
| `IDENTITIES_DIR="${AGENT_IDENTITIES_DIR:-$HOME/.claude/identities}"` | `IDENTITIES_DIR="${AGENT_IDENTITIES_DIR:-$HOME/fleet/identities}"` |
| (absent) | `IDENTITIES_ARCHIVE_DIR="${AGENT_IDENTITIES_ARCHIVE_DIR:-$HOME/fleet/identities-archive}"` |

New `IDENTITIES_ARCHIVE_DIR` declaration includes comment documenting that it is a SIBLING of IDENTITIES_DIR per D-02 — cannot be derived from `$IDENTITIES_DIR + /archive` which would resolve to the wrong tree.

### Dead Code Removal (resolve_identities, formerly ~line 220)

Removed: `[ "$name" = archive ] && continue  # defensive; identity-archive is a SIBLING dir, not here`

Removed from `run_archive_scan` (~line 423): `[ "$name" = archive ] && continue  # Pitfall 2 lock — mirrors L210`

Both filters were defensive guards against a nested archive. With archive as a true sibling at `~/fleet/identities-archive/`, the folder named "archive" can never appear inside `~/fleet/identities/`, so the filter is unreachable. Protection is now provided by the `.md` file guard (`[ -f "$d/$name.md" ] || continue`).

### retire_identity Function

| Location | Before | After |
|----------|--------|-------|
| archdir declaration (~284) | `local archdir="$IDENTITIES_DIR/archive/$name"` | `local archdir="$IDENTITIES_ARCHIVE_DIR/$name"` |
| mkdir pre-create (~290) | `mkdir -p "$IDENTITIES_DIR/archive" 2>/dev/null` | `mkdir -p "$IDENTITIES_ARCHIVE_DIR" 2>/dev/null` |
| Comment above mkdir | "Create archive/ parent on demand" | "Create the archive sibling location on demand per D-02" |

Step 1–4 idempotency case analysis (D-13 retry-from-top) preserved unchanged — only the path variables changed.

### run_archive_scan Function

| Location | Before | After |
|----------|--------|-------|
| mkdir pre-create | `mkdir -p "$IDENTITIES_DIR/archive" 2>/dev/null` | `mkdir -p "$IDENTITIES_ARCHIVE_DIR" 2>/dev/null` |
| retire-stuck sentinel touch | `touch "$IDENTITIES_DIR/archive/$name/retire-stuck"` | `touch "$IDENTITIES_ARCHIVE_DIR/$name/retire-stuck"` |
| Comment on sentinel | "Written to $IDENTITIES_DIR/archive/$name/retire-stuck" | "Written to $IDENTITIES_ARCHIVE_DIR/$name/retire-stuck" |

### Convention Workdir Fallback (~lines 1030–1048)

| Before | After |
|--------|-------|
| Comment: "use $HOME/<name> by convention" | Comment: "use the identity's workspace/ sub-folder by convention" |
| `elif [ -d "$HOME/$name" ]` | `elif [ -d "$IDENTITIES_DIR/$name/workspace" ]` |
| `cwd="$HOME/$name"` | `cwd="$IDENTITIES_DIR/$name/workspace"` |
| Else log: `\$HOME/$name absent` | Else log: `$IDENTITIES_DIR/$name/workspace absent` |

### Direct-Literal Rewrites

| Line | Before | After |
|------|--------|-------|
| ~1224 (_matrix_peek_one) | `"$HOME/.claude/identities/$name"` | `"$IDENTITIES_DIR/$name"` |
| ~1279 (matrix_peek) | `local idroot="$HOME/.claude/identities/$name"` | `local idroot="$IDENTITIES_DIR/$name"` |
| ~1304 (schedule_peek) | `local wd="$HOME/.claude/identities/$name/wakeups"` | `local wd="$IDENTITIES_DIR/$name/wakeups"` |

Also updated comment at ~1108: `$HOME/.claude/identities/<name>/wakeups/*.json` → `$IDENTITIES_DIR/<name>/wakeups/*.json`

### Shellcheck Result

No new warnings introduced. Pre-existing warnings (SC2034, SC1090, SC2009, SC2012, SC2046, SC2015) are unrelated to this plan's edits.

## Task 2: Phase 94 Archive-Scan Test Driver

### Header Comment (lines 20–27)

Updated isolation variable list to document `AGENT_IDENTITIES_ARCHIVE_DIR=<scratch>` as a companion env override, explaining it must point at a SEPARATE scratch dir (sibling of AGENT_IDENTITIES_DIR, not a subdir).

### _source_supervisor() Update

Added: `export AGENT_IDENTITIES_ARCHIVE_DIR="${scratch}-archive"`

This exports the archive scratch dir as a sibling path (`<scratch>-archive`) alongside `AGENT_IDENTITIES_DIR="$scratch"`, matching the D-02 sibling layout in production.

### setup_scratch() / teardown_scratch() Update

```
setup_scratch():
  added: mkdir -p "${s}-archive"

teardown_scratch():
  added: [ -n "$s" ] && [ -d "${s}-archive" ] && rm -rf "${s}-archive"
```

### Test Fixture Path Updates

All 8 occurrences of `$scratch/archive/tina` (and `$scratch/archive`) updated to `${scratch}-archive/tina`:

| Test | Change |
|------|--------|
| test_retire_happy_path_200 | assert_file target |
| test_retire_5xx_aborts_with_1 | assert_file target |
| test_retire_retry_from_partial | mkdir + fixture_relay_json + sed target |
| test_retire_collision_aborts | mkdir |
| test_retire_stuck_fires_at_3_not_before | mkdir + assert_file + assert_nofile (×2) |
| test_retire_stuck_counter_resets_on_success | mkdir + rm -rf |

### MODE-Agnostic Scan Test Comment Update

`test_scan_walks_all_identity_folders`: Updated comment explaining why a folder named "archive" inside identities is skipped. Was "Pitfall 2 → must be skipped" (meaning the old explicit name filter). Now "no archive/archive.md → .md guard" (the post-96 protection mechanism).

### Test Suite Result

```
PASS: 31  FAIL: 0
```

## Task 2: role-file-watch.py

Line 236 (functional): `~/.claude/roles/%s/%s.md` → `~/fleet/roles/%s/%s.md`

This is the only hardcoded path inside the script (all other identity-dir references are relative to sys.argv[1]).

Python AST parse: PASS.

## Task 2: wakeup-scheduler.py

Line 11 (docstring): `~/.claude/identities/<name>/wakeups/<slug>.json` → `~/fleet/identities/<name>/wakeups/<slug>.json`

Prose only — the script takes identity dir as sys.argv[1] and is path-relative after that.

## Task 2: recv.sh

Line 43 (error message): `STATE_DIR must point at ~/.claude/identities/<name>/relay-state` → `STATE_DIR must point at ~/fleet/identities/<name>/relay-state`

Line 123 (comment): `~/.claude/identities/<name>/relay-state/since` → `~/fleet/identities/<name>/relay-state/since`

The cred-path derivation (`$(dirname "$STATE_DIR")`) is path-relative and requires no code change — it naturally resolves to the correct tree once STATE_DIR points at the new location (set by the caller: SKILL.md, which is Plan 96-05's scope).

## Deviations from Plan

**Auto-fixed (Rule 1):** run_archive_scan also had `mkdir -p "$IDENTITIES_DIR/archive"` and `[ "$name" = archive ] && continue` and `touch "$IDENTITIES_DIR/archive/$name/retire-stuck"` — these were not explicitly enumerated in the plan's task description (which focused on retire_identity) but were necessary to fix to avoid broken behavior. Fixed inline in Task 1.

None of the planned acceptance criteria required changes beyond what was explicitly planned.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 50c98efb | feat(96-04) | Rewrite agent-supervisor.sh — fleet paths + IDENTITIES_ARCHIVE_DIR sibling |
| bbc3b5a0 | feat(96-04) | Update archive-scan test driver + role-file-watch + wakeup-scheduler + recv.sh |

## Verification

- shellcheck substrate/scripts/agent-supervisor.sh: clean (no new warnings)
- bash substrate/scripts/tests/agent-supervisor-archive-scan.sh: 31/31 PASS
- grep -cE "\.claude/(identities|roles)" all 5 touched files: all 0
- python3 -c "ast.parse(...)": role-file-watch.py syntax OK
- context-watch.py: NOT modified (confirmed no hardcoded paths inside)

## Self-Check: PASSED

All 5 files exist and are modified. Both commits exist in git log. 31/31 test cases pass.
