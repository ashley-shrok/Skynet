---
phase: 94-supervisor-archive-extension
plan: "01"
subsystem: substrate/scripts/agent-supervisor.sh
tags: [bash, archive-scan, coordinator-detection, freshness-signal, phase-94, wave-1]
dependency_graph:
  requires: [92-04]  # .pinned sentinel (Phase 92) must be at HEAD — D-03 guard reads it
  provides: [is_coordinator, get_freshness_epoch, ARCHIVE_THRESHOLD_SECONDS, ARCHIVE_SCAN_MARKER, ARCHIVE_SCAN_INTERVAL]
  affects: [94-03, 94-04]  # Wave 3 wires these; Wave 4 tests them
tech_stack:
  added: []
  patterns: [awk-frontmatter-parse, stat-mtime-read, bash-module-scope-constants]
key_files:
  created: []
  modified:
    - substrate/scripts/agent-supervisor.sh
decisions:
  - "Co-locate all four archive-scan constants (ARCHIVE_THRESHOLD_DAYS, ARCHIVE_THRESHOLD_SECONDS, ARCHIVE_SCAN_MARKER, ARCHIVE_SCAN_INTERVAL) in a single block after MEM_SAMPLES_LOG at L66 — visually adjacent to DORMANCY_STATE_DIR (L64) which is the state-dir they reference"
  - "Place is_coordinator + get_freshness_epoch between slug (L229) and match_session (L267) in the helpers block — follows identity-inspection helper grouping, no insertion into reconcile() until Wave 3"
  - "Use per-line shellcheck disable=SC2034 comments for the three Wave-3-only constants (ARCHIVE_THRESHOLD_SECONDS, ARCHIVE_SCAN_MARKER, ARCHIVE_SCAN_INTERVAL) — Wave 1 intentionally introduces no callsites; Wave 3 wires them"
metrics:
  duration: "~10 minutes"
  completed: "2026-09-09"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 1
---

# Phase 94 Plan 01: guard building blocks — ARCHIVE_THRESHOLD constants + is_coordinator + get_freshness_epoch

One-liner: awk-based strict coordinator detector + stat-mtime freshness reader + four archive-scan constants landed in agent-supervisor.sh as dormant Wave-1 building blocks (zero callsites until Wave 3).

## What Shipped

Single edit to `substrate/scripts/agent-supervisor.sh` — three insertion points, 43 lines added, nothing removed.

### Insertion Point 1: Module-scope constants (L68-76)

After `MEM_SAMPLES_LOG=` at L66, before the `CLAUDE` binary resolution block:

```
ARCHIVE_THRESHOLD_DAYS=180
ARCHIVE_THRESHOLD_SECONDS=$((ARCHIVE_THRESHOLD_DAYS * 24 * 60 * 60))
ARCHIVE_SCAN_MARKER="${DORMANCY_STATE_DIR}/archive-scan-last-ran"
ARCHIVE_SCAN_INTERVAL=$((24 * 60 * 60))    # 86400s — D-01 daily cadence
```

All four constants are co-located so Wave 3 can reference them without adding new module-scope declarations. D-08 lock respected: none appear in `agent-supervisor.conf`.

### Insertion Point 2: is_coordinator() (L231-241)

After `slug()` at L229, before `match_session()` at L267:

```bash
is_coordinator() {
  local identity_file="$1"
  [ -f "$identity_file" ] || return 1
  awk '/^---$/{f++} f==1 && /^coordinator: true$/{found=1; exit} END{exit !found}' "$identity_file"
}
```

The awk body is byte-identical to the strict-detection rule in `substrate/skills/id/SKILL.md` L379-387. The frontmatter-boundary counter (`f`) and exact-anchor match (`/^coordinator: true$/`) prevent all four negative cases: commented, body-prose, quoted-string, no-frontmatter.

### Insertion Point 3: get_freshness_epoch() (L243-262)

Immediately after `is_coordinator()`:

```bash
get_freshness_epoch() {
  local name="$1" iddir="$2"
  local cursor_file="$iddir/relay-state/since"
  local mtime
  if [ -f "$cursor_file" ]; then
    mtime=$(stat -c %Y "$cursor_file" 2>/dev/null)
  else
    mtime=$(stat -c %Y "$iddir" 2>/dev/null)
  fi
  printf '%s' "${mtime:-0}"
}
```

D-06 (cursor mtime) + D-07 (folder mtime fallback) + safe default of 0 if both stat calls fail. Uses `stat -c %Y` (GNU coreutils, confirmed available) not `find -mtime` (per RESEARCH anti-patterns).

## Acceptance Criteria Results

| Check | Result |
|-------|--------|
| `bash -n substrate/scripts/agent-supervisor.sh` exits 0 | PASS |
| shellcheck no new warnings vs baseline | PASS (diff shows only line number shifts, zero new warning text) |
| `grep -c '^is_coordinator()'` = 1 | PASS (1) |
| `grep -c '^get_freshness_epoch()'` = 1 | PASS (1) |
| `grep -c '^ARCHIVE_THRESHOLD_DAYS=180$'` = 1 | PASS (1) |
| `grep -cE '^ARCHIVE_THRESHOLD_SECONDS='` = 1 | PASS (1) |
| `grep -c '^ARCHIVE_SCAN_MARKER='` = 1 | PASS (1) |
| `grep -c '^ARCHIVE_SCAN_INTERVAL='` = 1 | PASS (1) |
| awk body matches strict-detection rule | PASS (grep -c returns 1) |
| `relay-state/since` referenced | PASS (grep -c returns 2) |
| ARCHIVE_THRESHOLD absent from agent-supervisor.conf | PASS (file does not exist on this path) |
| No callsites in reconcile() | PASS (only definition lines + comment lines) |

## Deviations from Plan

**1. [Rule 2 - shellcheck suppression] Added per-line `# shellcheck disable=SC2034` for Wave-3-only constants**

- **Found during:** Post-edit shellcheck comparison
- **Issue:** `ARCHIVE_THRESHOLD_SECONDS`, `ARCHIVE_SCAN_MARKER`, `ARCHIVE_SCAN_INTERVAL` are declared in Wave 1 but have no callsites until Wave 3 (`run_archive_scan_if_due` / `run_archive_scan`). shellcheck SC2034 ("appears unused") fired for all three, introducing 3 new warnings vs baseline.
- **Fix:** Added `# shellcheck disable=SC2034  # used by Wave 3 ...` immediately before each of the three constants. `ARCHIVE_THRESHOLD_DAYS` is NOT suppressed — it IS used on the very next line (`$((ARCHIVE_THRESHOLD_DAYS * 24 * 60 * 60))`).
- **Files modified:** `substrate/scripts/agent-supervisor.sh` (same commit, same task)
- **Plan alignment:** Plan acceptance criteria requires "no new warnings relative to pre-edit baseline" — this deviation satisfies that requirement. The suppression comments forward-reference Plan 94-03 so future readers know which plan introduces the callsites.

## Confirmation: Zero hooks into reconcile()

`grep -n 'run_archive_scan\|is_coordinator\|get_freshness_epoch' substrate/scripts/agent-supervisor.sh` returns only:
- Comment lines (L71, L73, L75) referencing Wave 3 plan names
- Definition lines (L237 `is_coordinator()`, L252 `get_freshness_epoch()`)

No callsites exist in `reconcile()` or anywhere else. Wave 3's responsibility per 94-03-PLAN.md.

## Known Stubs

None. This plan adds pure read-only helper functions and constants. No data flows, no rendering, no placeholders.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes. `is_coordinator` is a pure read; `get_freshness_epoch` is a pure read. Both are helper functions with no side effects. No new threat surface beyond what's documented in the plan's threat model (T-94-01-01 through T-94-01-SC).

## Self-Check

- `substrate/scripts/agent-supervisor.sh` modified: confirmed (git status shows M)
- Task commit `d061b369` exists in git log: confirmed
- `bash -n` clean: confirmed
- Shellcheck no new warnings: confirmed (diff shows only line-number shifts)
- All grep acceptance checks: confirmed (all pass as documented above)

## Self-Check: PASSED
