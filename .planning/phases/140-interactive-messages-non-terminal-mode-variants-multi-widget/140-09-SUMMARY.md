---
phase: 139-interactive-messages-non-terminal-mode-variants-multi-widget
plan: "09"
subsystem: interactive-messages
tags: [interactive-messages, skill-doc, integration-test, multi-mode, non-terminal, phase-140]
dependency_graph:
  requires: [140-01, 140-02, 140-03, 140-04, 140-05, 140-06, 140-07]
  provides:
    - SKILL.md three-mode taxonomy + non-terminal section + multi-widget section
    - all-templates-non-terminal-scaffold integrated test
  affects:
    - substrate/skills/interactive-messages/SKILL.md
    - substrate/skills/interactive-messages/tests/run-all.sh
tech_stack:
  added: []
  patterns:
    - SKILL.md as agent-facing doc: surgical section additions without rewriting per-template reference blocks
    - Integrated test pattern: shared temp HOME, SKIP_SYSTEMCTL=1, trap EXIT cleanup (from Phase 138 precedent)
    - Cross-cutting invariant tests: arc-wide property checks across all 6 templates in one run
key_files:
  created:
    - substrate/skills/interactive-messages/tests/all-templates-non-terminal-scaffold.test.sh
  modified:
    - substrate/skills/interactive-messages/SKILL.md
    - substrate/skills/interactive-messages/tests/run-all.sh
decisions:
  - "SKILL.md surgical edits only — per-template reference blocks (CLI shape, state.json shape, do-not-use-when) preserved verbatim from Phase 138-07; only four sections modified/added"
  - "list-actions --items invocation uses JSON array format ('['i1','i2']') — the args.sh validator requires valid JSON, not a bare string as the plan spec showed; fixed as Rule 1 deviation"
  - "run-all.sh: explicit run_file calls for both integrated tests (not glob) per Phase 138 precedent — naming convention differs from per-template tests"
metrics:
  duration: "~8 minutes"
  completed: "2026-09-27T22:23:00Z"
  tasks_completed: 2
  files_modified: 3
  files_created: 1
---

# Phase 140 Plan 09: Skill Documentation + Integrated Non-Terminal Test Summary

SKILL.md rewritten with three-mode taxonomy across all 6 templates (12 template+mode combos documented), non-terminal mode semantics section, multi-widget-per-message guidance with PR-triage worked example, and Phase 140-appropriate limits. Integrated test proves all 6 non-terminal templates coexist in one HOME with arc-wide non-terminal invariants (zero postMessage, /update present, /submit absent, updated_at present, submitted_at absent, no submit-btn markers, all mode=non-terminal in metadata).

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update SKILL.md — template menu mode variants + non-terminal section + multi-widget section + Phase 140 limits | c8f2bd04 | substrate/skills/interactive-messages/SKILL.md |
| 2 | Integrated all-templates non-terminal scaffold test + run-all.sh update | 6a955356 | tests/all-templates-non-terminal-scaffold.test.sh, tests/run-all.sh |

---

## What Was Built

### Task 1: SKILL.md updates (surgical)

Seven surgical edits to SKILL.md — per-template reference blocks left untouched:

1. **Frontmatter description**: dropped "Phase 138 ships..." wording; replaced with three-mode + multi-widget capability description.
2. **Template menu table**: added Modes column showing all supported modes per template with *(default)* markers; 12 total combos visible.
3. **CLI dispatch header**: renamed from "Phase 138 shape"; added `--mode` to global flags table.
4. **"Choosing a mode" sub-section**: added after global flags — explains all three modes, when to reach for each, error behavior for unsupported combos.
5. **New "Non-terminal mode" section** (inserted before "Shared reading pattern"): state.json shapes per template, /update endpoint, updated_at, agent-decides-when-to-read rule, caveats.
6. **New "Multi-widget per message" section** (inserted after "Non-terminal mode"): prefer-non-terminal rule, worked example (PR triage with list-actions + form), what-you-must-not-do.
7. **"Phase 138 limits" → "Phase 140 limits"**: removed "No non-terminal modes" and "No multi-widget"; added "No expired-placeholder UI"; updated "No custom widget authoring"; added note that all modes draw from same port pool.
8. **Invariant #5**: updated from Phase 138 single-mode wording to affordance-matches-mode description.

Final SKILL.md: 663 lines (within 500-1200 acceptance range).

### Task 2: Integrated non-terminal scaffold test

`all-templates-non-terminal-scaffold.test.sh` scaffolds one instance of each non-terminal template in a shared temp HOME (`SKIP_SYSTEMCTL=1`) and runs 60 assertions:

- Per-template (8 assertions × 6 templates = 48): exit 0, widget.html/server.py/metadata.json exist, discriminator correct, mode=non-terminal in metadata, systemd unit exists, port in 9601-9699.
- Cross-cutting (12 assertions): 6 unit files, 6 distinct ports in range, 6 widget folders, zero postMessage, zero window.parent, /update present in all 6 server.py, /submit absent from all 6 server.py, updated_at in all 6 widget.html, submitted_at absent from all 6 widget.html, zero submit-btn/done-btn, all 6 metadata.json mode=non-terminal.

Result: 60/60 PASS.

`run-all.sh` updated: added `run_file` call for new test after Phase 138 all-templates test; updated header comment to name both integrated tests as tier 3.

Full suite: **14/14 test files pass**.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] list-actions --items must be a JSON array, not a bare string**
- **Found during:** Task 2, first test run
- **Issue:** Plan spec showed `--items "i1"` but the list-actions-non-terminal args.sh validates --items as a JSON array. A bare string `"i1"` is not valid JSON and exits 1 with `--items must be a valid JSON array`.
- **Fix:** Changed invocation to `--items '["i1","i2"]'` (valid JSON array with two items — matches format shown in the plan's CLI dispatch section for list-actions terminal template).
- **Files modified:** tests/all-templates-non-terminal-scaffold.test.sh
- **Impact:** No other changes needed; all other assertions pass as-is.

---

## Known Stubs

None. SKILL.md is a doc file. Tests scaffold real templates from substrate and verify actual file content.

---

## Threat Flags

None. This plan adds documentation and tests only — no new network endpoints, auth paths, file access patterns, or schema changes.

---

## Self-Check: PASSED

- SKILL.md exists and contains required sections:
  - `grep -q '## Non-terminal mode' SKILL.md` ✓
  - `grep -q '## Multi-widget per message' SKILL.md` ✓
  - `grep -q '## Phase 140 limits' SKILL.md` ✓
  - `grep -c '## Phase 138 limits' SKILL.md` == 0 ✓
  - `grep -c 'No non-terminal modes' SKILL.md` == 0 ✓
  - Line count: 663 (within 500-1200) ✓
- all-templates-non-terminal-scaffold.test.sh exists and exits 0 (60/60 PASS) ✓
- run-all.sh contains `all-templates-non-terminal-scaffold` ✓
- `run-all.sh` exits 0 (14/14 test files pass) ✓
- Commits exist: c8f2bd04 (Task 1), 6a955356 (Task 2) ✓
