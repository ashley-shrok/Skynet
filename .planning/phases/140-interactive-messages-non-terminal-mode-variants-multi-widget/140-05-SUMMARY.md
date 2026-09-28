---
phase: 139-interactive-messages-non-terminal-mode-variants-multi-widget
plan: "05"
subsystem: interactive-messages
tags: [interactive-messages, template, ranking, non-terminal, widgets, drag-and-drop, mobile-first]
dependency_graph:
  requires: [140-01]
  provides: [ranking-non-terminal-template]
  affects:
    - substrate/skills/interactive-messages/templates/ranking-non-terminal/
    - substrate/skills/interactive-messages/tests/create-widget-ranking-non-terminal.test.sh
tech_stack:
  added: []
  patterns:
    - non-terminal reorder persistence via POST /update on every drag or arrow click
    - data-label attribute on li elements for DOM-order read in persistOrder()
    - threading.Lock for concurrent state.json writes
    - --submit-label rejection guard in args.sh
key_files:
  created:
    - substrate/skills/interactive-messages/templates/ranking-non-terminal/widget.html
    - substrate/skills/interactive-messages/templates/ranking-non-terminal/server.py
    - substrate/skills/interactive-messages/templates/ranking-non-terminal/args.sh
    - substrate/skills/interactive-messages/templates/ranking-non-terminal/im-SLUG.service.template
    - substrate/skills/interactive-messages/templates/ranking-non-terminal/metadata.json.template
    - substrate/skills/interactive-messages/tests/create-widget-ranking-non-terminal.test.sh
  modified: []
decisions:
  - data-label attribute on each li (not rank-label class) is the source of truth for persistOrder() DOM-order reads — avoids coupling order-read to visual label element
  - assert_file_not_contains uses grep -q rather than grep -c to avoid double-output bug when grep exits 1 (no matches) and || echo "0" both fire
  - args.sh uses --options (not --items from terminal sibling) per plan spec — keeps non-terminal arg contract consistent with other non-terminal templates
metrics:
  duration: ~20 minutes
  completed: 2026-09-27T22:30:00Z
  tasks_completed: 2
  tasks_total: 2
  files_modified: 6
---

# Phase 140 Plan 05: ranking-non-terminal Template Summary

**One-liner:** `ranking-non-terminal` template ships drag-handle + up/down arrow dual affordance with `persistOrder()` POSTing to `/update` on every reorder — no submit button, no postMessage, widget stays interactive indefinitely.

## What Was Built

Added `templates/ranking-non-terminal/` with five files and a companion test harness.

**widget.html** preserves the full drag-and-drop machinery (dragstart, dragover, drop, dragend events with `.dragging`/`.drop-target` class toggling) and the up/down arrow buttons from the terminal sibling. Both paths call `persistOrder()` on completion instead of the terminal `handleSubmit()`. `persistOrder()` reads the current DOM order by iterating `#rank-list li[data-label]` (each `li` carries a `data-label` attribute set at row-build time), builds `{order: [...], updated_at: ISO8601}`, POSTs to `/update`, and sets status to "Saved." — never disabling rows, never firing any wake signal. The submit button, `.submit-btn` CSS, and all `handleSubmit`/`/submit` references are removed entirely.

**server.py** is the terminal sibling with `/submit` replaced by `/update`. The template discriminator (`data["template"] = "ranking"`), `threading.Lock`, and `try/except` bad-JSON guard are all preserved.

**args.sh** accepts `--prompt` (required) + `--options` (required, >=2 non-empty comma-separated values) and rejects `--submit-label` with a clear error. `TEMPLATE_CONFIG_JSON` includes `"mode": "non-terminal"`. Four tokens substituted: `__PROMPT_JSON__`, `__OPTIONS_JSON__`, `__WIDGET_ID__`, `__PANE_BASE__`.

**Test file** covers 5 cases: happy path (27 assertions including drag affordance, arrow buttons, /update, metadata options count, no postMessage/submit-btn/submitted_at/window.parent), --submit-label rejection, missing --prompt, missing --options, fewer-than-2 options. 35/35 assertions pass; `run-all.sh` 13/13 files pass.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Scaffold ranking-non-terminal template directory | 59fe7504 | widget.html, server.py, args.sh, im-SLUG.service.template, metadata.json.template |
| 2 | End-to-end scaffold test for ranking-non-terminal template | 9a233105 | tests/create-widget-ranking-non-terminal.test.sh |

## Decisions Made

1. **`data-label` attribute vs `rank-label` class for DOM-order read**: `persistOrder()` uses `querySelectorAll("#rank-list li[data-label]")` and reads `getAttribute("data-label")`. This is more explicit and resistant to future CSS-class renames than selecting `.rank-label` inner text.

2. **`assert_file_not_contains` uses `grep -q` not `grep -c`**: `grep -c` with `|| echo "0"` has a double-output bug — when grep exits 1 (no matches), both grep's "0" output AND the `|| echo "0"` run, making count "0\n0" which fails `[ "$count" = "0" ]`. Fixed by checking `grep -q` for presence/absence directly.

3. **`--options` not `--items`**: The plan spec uses `--options` for the non-terminal variant. This diverges from the terminal sibling's `--items` flag but keeps the non-terminal arg contract consistent with other non-terminal templates (poll-non-terminal uses `--options`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed assert_file_not_contains helper double-output bug**
- **Found during:** Task 2 — test run produced 6 false FAIL results
- **Issue:** `grep -c pattern file || echo "0"` — when grep exits 1 (no match), both the grep output ("0") and the echo ("0") contributed to the variable, making count "0\n0" which != "0"
- **Fix:** Rewrote to `if grep -q "$pattern" "$path"; then ... fail ... else ... pass ... fi`
- **Files modified:** `tests/create-widget-ranking-non-terminal.test.sh`
- **Commit:** 9a233105 (part of Task 2 commit)

**2. [Rule 1 - Bug] Removed postMessage/window.parent from widget.html comments**
- **Found during:** Task 1 acceptance check — `grep -c 'postMessage' widget.html` returned 2 (from comments)
- **Issue:** Comments said "no postMessage fired" and "Do NOT call window.parent.postMessage" — the acceptance criterion checks for zero occurrences including in comments
- **Fix:** Rewrote comments to not mention the forbidden strings
- **Files modified:** `templates/ranking-non-terminal/widget.html`
- **Commit:** 59fe7504

## Threat Model Coverage

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-140-05-HTMLInject | `json.dumps` in args.sh template_substitute for all four tokens |
| T-140-05-BadJSON | `try/except (json.JSONDecodeError, ValueError)` in server.py /update handler |
| T-140-05-AffordanceRegression | Grep-checked: `draggable` + `up-btn` + `down-btn` all present; enforced in test |
| T-140-05-SubmitLabelStale | `--submit-label` rejected in args.sh with clear error |
| T-140-05-LockContention | `threading.Lock` in server.py guards STATE_FILE.write_text |

## Test Results

- `bash -n server.py` equivalent: `python3 -m py_compile server.py` → 0
- `bash -n args.sh` → 0
- `bash tests/create-widget-ranking-non-terminal.test.sh` → 35/35 PASS
- `bash tests/run-all.sh` → 13/13 files pass

## Known Stubs

None — all substitution tokens are wired end-to-end through args.sh → create-widget.sh → widget.html.

## Threat Flags

None — no new network endpoints beyond `/update` (already in plan's threat model), no new auth paths, no schema changes.

## Self-Check: PASSED

- `substrate/skills/interactive-messages/templates/ranking-non-terminal/widget.html` — FOUND
- `substrate/skills/interactive-messages/templates/ranking-non-terminal/server.py` — FOUND
- `substrate/skills/interactive-messages/templates/ranking-non-terminal/args.sh` — FOUND
- `substrate/skills/interactive-messages/templates/ranking-non-terminal/im-SLUG.service.template` — FOUND
- `substrate/skills/interactive-messages/templates/ranking-non-terminal/metadata.json.template` — FOUND
- `substrate/skills/interactive-messages/tests/create-widget-ranking-non-terminal.test.sh` — FOUND
- Commit `59fe7504` — exists
- Commit `9a233105` — exists
- `run-all.sh` exits 0 (13/13) — confirmed
