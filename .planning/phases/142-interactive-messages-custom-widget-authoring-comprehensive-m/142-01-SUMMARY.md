---
phase: 141-interactive-messages-custom-widget-authoring-comprehensive-m
plan: "01"
subsystem: interactive-messages/templates
tags:
  - interactive-messages
  - mobile
  - accessibility
dependency_graph:
  requires: []
  provides:
    - "touch-target-44px-all-8-non-compliant-widgets"
  affects:
    - "substrate/skills/interactive-messages/templates/*/widget.html"
tech_stack:
  added: []
  patterns:
    - "min-height: 44px on outermost interactive row/button per Apple HIG"
key_files:
  created: []
  modified:
    - substrate/skills/interactive-messages/templates/poll-terminal-on-click/widget.html
    - substrate/skills/interactive-messages/templates/poll-non-terminal/widget.html
    - substrate/skills/interactive-messages/templates/checklist-terminal-on-submit/widget.html
    - substrate/skills/interactive-messages/templates/checklist-non-terminal/widget.html
    - substrate/skills/interactive-messages/templates/list-actions-terminal-on-submit/widget.html
    - substrate/skills/interactive-messages/templates/list-actions-non-terminal/widget.html
    - substrate/skills/interactive-messages/templates/ranking-terminal-on-submit/widget.html
    - substrate/skills/interactive-messages/templates/ranking-non-terminal/widget.html
decisions:
  - "Apply min-height to the outermost interactive element (row/button) not the raw input, so the entire label area is the tap target"
  - "Add explicit min-height: 44px on .done-btn and .submit-btn even where computed height already exceeds 44px, for grep-auditability by Plan 02"
metrics:
  duration: "128s (~2m)"
  completed: "2026-09-27"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 8
---

# Phase 142 Plan 01: Touch Target 44px Bump — Poll, Checklist, List-Actions, Ranking Summary

Bumped all 8 non-compliant interactive-message template widget.html files from sub-44px touch targets to Apple HIG minimum (min-height: 44px) on their outermost interactive rows and buttons.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Bump poll + checklist row/button touch targets to 44px | `484bf54a` | poll-terminal-on-click, poll-non-terminal, checklist-terminal-on-submit, checklist-non-terminal |
| 2 | Bump list-actions + ranking touch targets to 44px | `fe085618` | list-actions-terminal-on-submit, list-actions-non-terminal, ranking-terminal-on-submit, ranking-non-terminal |

## CSS Delta Per File

| File | Selector | Before | After |
|------|----------|--------|-------|
| poll-terminal-on-click/widget.html | `.btn` | no min-height, `padding: 8px 14px` | `min-height: 44px`, `padding: 10px 14px` |
| poll-non-terminal/widget.html | `.poll-row` | `min-height: 28px` | `min-height: 44px` |
| checklist-terminal-on-submit/widget.html | `.checklist-row` | `min-height: 28px` | `min-height: 44px` |
| checklist-non-terminal/widget.html | `.checklist-row` | `min-height: 28px` | `min-height: 44px` |
| list-actions-terminal-on-submit/widget.html | `.action-btn` | `min-height: 40px` | `min-height: 44px` |
| list-actions-terminal-on-submit/widget.html | `.done-btn` | no min-height | `min-height: 44px` (explicit, for audit) |
| list-actions-non-terminal/widget.html | `.action-btn` | `min-height: 40px` | `min-height: 44px` |
| ranking-terminal-on-submit/widget.html | `.rank-row` | no min-height, `padding: 8px 10px` | `min-height: 44px` |
| ranking-terminal-on-submit/widget.html | `.submit-btn` | no min-height | `min-height: 44px` (explicit, for audit) |
| ranking-non-terminal/widget.html | `.rank-row` | no min-height, `padding: 8px 10px` | `min-height: 44px` |

## All-12-Template Grep Verification

Post-execution scan confirms all 12 template widget.html files match `min-height:\s*44px`:

```
for f in substrate/skills/interactive-messages/templates/*/widget.html; do
  grep -qE 'min-height:\s*44px' "$f" || echo "MISSING: $f"
done
# Output: "Scan complete" (zero MISSING lines)
```

No occurrence of `min-height: 28px` or `min-height: 40px` remains in any template widget.html.

## Test Results

- `all-templates-scaffold.test.sh`: PASS 55/55
- `all-templates-non-terminal-scaffold.test.sh`: PASS 60/60
- `run-all.sh` (full suite): 14/14 test files passed

Substitution markers (`__PROMPT_JSON__`, `__OPTIONS_JSON__`, `__WIDGET_ID__`, `__PANE_BASE__`, `__ITEMS_JSON__`, `__ACTIONS_JSON__`, `__DONE_LABEL_JSON__`, `__SUBMIT_LABEL_JSON__`) preserved exactly in all files.

## Templates NOT Touched

- `color-picker-terminal-on-click/widget.html` — swatches already 44×44px (unchanged)
- `color-picker-non-terminal/widget.html` — swatches already 44×44px (unchanged)
- `form-terminal-on-submit/widget.html` — inputs/select already min-height: 44px (unchanged)
- `form-non-terminal/widget.html` — inputs/select already min-height: 44px (unchanged)

All four confirm `min-height: 44px` still present in post-edit grep.

## Mobile Caveats for SKILL.md (Plan 04)

- **list-actions rows use `flex-wrap: wrap`** — at narrow viewports (~<280px), action buttons stack vertically below the item label. This is intentional mobile-correct behavior (wrapping keeps the row usable without horizontal scroll). Each wrapped button row still meets 44px.
- **ranking rows** — the `.rank-row` now has `min-height: 44px`. The up/down arrow buttons are already 44×44px fixed size. On very narrow viewports the drag-handle + label + two arrow buttons may be tight; the `flex: 1` on `.rank-label` ensures the label compresses before the buttons overflow.
- **poll-terminal-on-click** — `.btn` is `display: block; width: 100%` so it naturally fills available width. The 10px top/bottom padding plus `min-height: 44px` ensures comfortable tap targets at any width.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- 8 modified files exist and all contain `min-height: 44px` on their primary interactive element
- Task 1 commit `484bf54a` exists: `git log --oneline | grep 484bf54a` → confirmed
- Task 2 commit `fe085618` exists: `git log --oneline | grep fe085618` → confirmed
- 14/14 test files passed in run-all.sh
- No legacy `min-height: 28px` or `min-height: 40px` in any widget.html
