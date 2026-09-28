---
phase: 139-interactive-messages-non-terminal-mode-variants-multi-widget
plan: "06"
subsystem: interactive-messages
tags: [interactive-messages, template, list-actions, non-terminal, widgets]
dependency_graph:
  requires: [140-01]
  provides: [list-actions-non-terminal-template]
  affects: [create-widget.sh dispatch, tests/run-all.sh]
tech_stack:
  added: []
  patterns:
    - per-row action-btn click directly POSTs full rows snapshot to /update (no Done button)
    - persistRows() collects DOM state and writes {rows, updated_at} — widget stays interactive
    - threading.Lock in server.py guards concurrent /update writes
    - json.dumps substitution in args.sh (T-140-06-HTMLInject mitigation)
key_files:
  created:
    - substrate/skills/interactive-messages/templates/list-actions-non-terminal/widget.html
    - substrate/skills/interactive-messages/templates/list-actions-non-terminal/server.py
    - substrate/skills/interactive-messages/templates/list-actions-non-terminal/im-SLUG.service.template
    - substrate/skills/interactive-messages/templates/list-actions-non-terminal/metadata.json.template
    - substrate/skills/interactive-messages/templates/list-actions-non-terminal/args.sh
    - substrate/skills/interactive-messages/tests/create-widget-list-actions-non-terminal.test.sh
decisions:
  - per-row action-btn click both toggles .selected visual state AND calls persistRows() atomically in the same handler
  - persistRows() reads DOM state (not in-memory map) for robustness — collects data-item + .action-btn.selected from each .la-row
  - --actions minimum raised to 2 (from terminal sibling's 1) — list-actions with only one action is semantically meaningless
  - --done-label AND --submit-label both rejected (belt-and-suspenders against Phase 138 agent memory)
metrics:
  duration: ~5 minutes
  completed: 2026-09-27T22:11:30Z
  tasks_completed: 2
  tasks_total: 2
  files_modified: 6
---

# Phase 140 Plan 06: list-actions-non-terminal Template Summary

**One-liner:** `list-actions-non-terminal` template with per-row action-btn live-persistence via POST `/update` — no Done button, no `postMessage`, no `submitted_at`; each action click directly overwrites state.json.

## What Was Built

Added the `list-actions-non-terminal` template under `substrate/skills/interactive-messages/templates/list-actions-non-terminal/`. This is the non-terminal inversion of `list-actions-terminal-on-submit`: instead of accumulating per-row selections behind a widget-level Done button and then firing `window.parent.postMessage`, each per-row action-btn click BOTH updates the visual `.selected` state AND immediately calls `persistRows()`, which POSTs the full `{rows: [{item, action}, ...], updated_at: ISO8601}` snapshot to `/update`. The widget stays interactive indefinitely; the agent reads `state.json` on demand alongside the user's next text reply.

Scaffolded via `create-widget.sh --template list-actions --mode non-terminal --prompt <p> --items <json-array> --actions <comma-separated>`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Scaffold list-actions-non-terminal template directory | cb901f23 | templates/list-actions-non-terminal/ (5 files) |
| 2 | End-to-end scaffold test for list-actions-non-terminal template | 7267eb91 | tests/create-widget-list-actions-non-terminal.test.sh |

## Decisions Made

1. **persistRows() reads from DOM, not in-memory selectionMap**: The DOM `.action-btn.selected` state is the authoritative snapshot source for `persistRows()`. This makes the persistence path independent of the in-memory `selectionMap`, adding robustness if state ever diverges (e.g., if the DOM is mutated externally).

2. **--actions minimum raised to 2**: The terminal sibling allowed a single action. For non-terminal list-actions, a widget with only one action option has no meaningful interactivity — the user would just be confirming every row with the same single action. Requiring at least 2 actions preserves the design principle that widgets must earn their interactivity.

3. **Both --done-label and --submit-label rejected**: The terminal sibling uses `--done-label`. Both flags are rejected in the non-terminal args.sh as belt-and-suspenders against agent memory from Phase 138 passing either variant.

## Deviations from Plan

**1. [Rule 1 - Bug] Removed postMessage/submitted_at from comment text in widget.html**
- **Found during:** Task 1 acceptance criteria check
- **Issue:** Two comments in widget.html referenced `postMessage` and `submitted_at` by name (to say they're absent), which caused `grep -c 'postMessage'` and `grep -c 'submitted_at'` to return non-zero — failing the acceptance criteria.
- **Fix:** Rewrote the two comment lines to not contain the prohibited strings while preserving their intent.
- **Files modified:** widget.html
- **Commit:** cb901f23 (inline fix before commit)

**2. [Rule 1 - Bug] Fixed whitespace mismatch in mode string output in args.sh**
- **Found during:** Task 1 acceptance criteria check
- **Issue:** The Python heredoc in `template_substitute` used aligned spacing (`"mode":    "non-terminal"`) causing `grep -q '"mode": "non-terminal"'` to fail (single space vs multiple spaces).
- **Fix:** Normalized to single-space style matching the acceptance criteria pattern.
- **Files modified:** args.sh
- **Commit:** cb901f23 (inline fix before commit)

## Threat Model Coverage

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-140-06-HTMLInject | `json.dumps` substitution in args.sh template_substitute (inherited pattern) |
| T-140-06-BadJSON | `try/except (json.JSONDecodeError, ValueError)` in server.py do_POST |
| T-140-06-AffordanceRegression | Grep-checked: `action-btn` present, `done-btn` absent |
| T-140-06-DoneLabelStale | args.sh rejects both `--done-label` and `--submit-label` with clear error |
| T-140-06-LockContention | `threading.Lock()` guards STATE_FILE.write_text in server.py |

## Test Results

- `python3 -m py_compile server.py` → 0 (syntax clean)
- `bash -n args.sh` → 0 (syntax clean)
- `bash -n create-widget-list-actions-non-terminal.test.sh` → 0 (syntax clean)
- `bash tests/create-widget-list-actions-non-terminal.test.sh` → 41/41 PASS
- `bash tests/run-all.sh` → 12/12 test files pass

New test cases in create-widget-list-actions-non-terminal.test.sh:
- Test 1: Happy path — 31 assertions covering files, content presence/absence, metadata shape, port range
- Test 2: `--done-label "Done"` rejected, error mentions `done-label`
- Test 3: Missing `--prompt` rejected, error mentions `--prompt`
- Test 4: Missing `--items` rejected, error mentions `--items`
- Test 5: `--actions "only"` (single action) rejected, error mentions `at least 2`

## Known Stubs

None — template is fully wired. Per-row action-btn click → DOM update → `persistRows()` → POST `/update` → state.json overwrite. No placeholder data, no TODO paths.

## Threat Flags

None — no new network endpoints beyond the scoped `/update` POST already in the plan's threat model, no new auth paths, no schema changes outside the plan's stated state.json shape.

## Self-Check: PASSED

- `substrate/skills/interactive-messages/templates/list-actions-non-terminal/widget.html` — exists, syntax valid
- `substrate/skills/interactive-messages/templates/list-actions-non-terminal/server.py` — exists, `python3 -m py_compile` exits 0
- `substrate/skills/interactive-messages/templates/list-actions-non-terminal/args.sh` — exists, `bash -n` exits 0
- `substrate/skills/interactive-messages/templates/list-actions-non-terminal/im-SLUG.service.template` — exists
- `substrate/skills/interactive-messages/templates/list-actions-non-terminal/metadata.json.template` — exists
- `substrate/skills/interactive-messages/tests/create-widget-list-actions-non-terminal.test.sh` — exists, 41/41 PASS
- Commit `cb901f23` — exists (Task 1)
- Commit `7267eb91` — exists (Task 2)
- `run-all.sh` exits 0 — confirmed (12/12)
