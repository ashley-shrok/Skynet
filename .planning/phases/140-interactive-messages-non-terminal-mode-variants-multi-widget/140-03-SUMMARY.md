---
phase: 139-interactive-messages-non-terminal-mode-variants-multi-widget
plan: "03"
subsystem: interactive-messages
tags: [interactive-messages, template, checklist, non-terminal, widgets, bash]
dependency_graph:
  requires: [140-01]
  provides: [checklist-non-terminal-template]
  affects: [create-widget.sh dispatch, tests/run-all.sh]
tech_stack:
  added: []
  patterns:
    - non-terminal POST /update pattern (state persists on every checkbox toggle, no submit)
    - --submit-label explicit rejection with clear error (T-140-03-SubmitLabelStale mitigation)
    - updated_at replaces submitted_at in state.json shape
key_files:
  created:
    - substrate/skills/interactive-messages/templates/checklist-non-terminal/widget.html
    - substrate/skills/interactive-messages/templates/checklist-non-terminal/server.py
    - substrate/skills/interactive-messages/templates/checklist-non-terminal/args.sh
    - substrate/skills/interactive-messages/templates/checklist-non-terminal/im-SLUG.service.template
    - substrate/skills/interactive-messages/templates/checklist-non-terminal/metadata.json.template
    - substrate/skills/interactive-messages/tests/create-widget-checklist-non-terminal.test.sh
  modified: []
decisions:
  - postMessage/window.parent in developer comments removed to satisfy zero-grep acceptance criteria — behavioral constraint documented via code structure alone
  - im-SLUG.service.template copied verbatim from terminal sibling (no changes needed — systemd unit shape is mode-agnostic)
metrics:
  duration: ~6 minutes
  completed: 2026-09-27T22:12:05Z
  tasks_completed: 2
  tasks_total: 2
  files_modified: 6
---

# Phase 140 Plan 03: Checklist Non-Terminal Template Summary

**One-liner:** `checklist-non-terminal` template scaffolds passive checkboxes with live persistence to POST `/update` on every toggle — no submit button, no postMessage, `updated_at` in state.json, `--submit-label` explicitly rejected.

## What Was Built

Added the `checklist-non-terminal` template directory with five files, inverting the `checklist-terminal-on-submit` sibling by removing the submit button entirely and rewiring every checkbox `change` event to POST to `/update` instead.

Key behavioral differences from the terminal sibling:
- **No submit button** — `<button id="submit-btn">` and all `.submit-btn` CSS removed
- **Live persistence** — each checkbox `change` fires `persistChecked()` which POSTs `{checked: [...], updated_at: ISO8601}` to `/update`
- **Widget stays interactive indefinitely** — checkboxes are never disabled on success or failure
- **No terminal wake signal** — `window.parent.postMessage` is absent; the agent reads `state.json` alongside the user's next text reply
- **`updated_at` not `submitted_at`** — state.json shape: `{template: "checklist", checked: [...], updated_at: "..."}`
- **`--submit-label` explicitly rejected** — args.sh dies with `--submit-label is not accepted for checklist non-terminal mode (there is no submit button)` if passed

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Scaffold checklist-non-terminal template directory | 81007110 | 5 template files |
| 2 | End-to-end scaffold test for checklist-non-terminal | fbc4c9e2 | tests/create-widget-checklist-non-terminal.test.sh |

## Decisions Made

1. **Developer comment wording**: The acceptance criteria requires zero grep hits on `postMessage` in widget.html. A comment `// Do NOT postMessage` would have tripped the grep. Rewrote the comment to convey the same constraint without the flagged string: `// No parent frame signal needed.` The behavioral constraint is enforced by the code structure (no `window.parent.*` call anywhere), not by a comment.

2. **im-SLUG.service.template verbatim copy**: The systemd unit template is mode-agnostic — it only cares about `__SLUG__`, `__WIDGET_DIR__`, and `__PORT__`. No changes from the terminal sibling were needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] postMessage string in developer comment tripped zero-grep acceptance criterion**
- **Found during:** Task 1 verification
- **Issue:** Comment `// Non-terminal: do NOT disable checkboxes. Do NOT postMessage.` contained the string `postMessage`, causing the acceptance check `grep -c 'postMessage' widget.html == 0` to fail.
- **Fix:** Rewrote comment to `// No parent frame signal needed.` which conveys the same constraint without triggering the grep.
- **Files modified:** widget.html
- **Commit:** 81007110 (same task commit — fixed before committing)

## Threat Model Coverage

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-140-03-HTMLInject | `json.dumps` in args.sh `template_substitute` for all inline JS substitutions |
| T-140-03-BadJSON | `try/except (json.JSONDecodeError, ValueError)` in server.py POST /update handler |
| T-140-03-AffordanceViolation | Zero `postMessage` + zero `window.parent` + zero `submit-btn` grep-verified in acceptance checks and test suite |
| T-140-03-SubmitLabelStale | args.sh explicitly rejects `--submit-label` with clear error naming the flag and explaining why (no submit button) |
| T-140-03-LockContention | `threading.Lock` wraps `STATE_FILE.write_text` in server.py |

## Test Results

- `bash -n args.sh` → 0 (syntax clean)
- `python3 -m py_compile server.py` → 0 (syntax clean)
- `bash tests/create-widget-checklist-non-terminal.test.sh` → 36/36 PASS
- `bash tests/run-all.sh` → 13/13 test files pass

## Known Stubs

None — template is fully wired. widget.html substitutes all four tokens (`__PROMPT_JSON__`, `__OPTIONS_JSON__`, `__WIDGET_ID__`, `__PANE_BASE__`) via args.sh. state.json is written on every POST /update. metadata.json includes `mode: "non-terminal"`.

## Threat Flags

None — no new network endpoints beyond what the plan specifies. POST /update is same-origin only (bound to 127.0.0.1). No new auth paths or schema changes at trust boundaries.

## Self-Check: PASSED

- `substrate/skills/interactive-messages/templates/checklist-non-terminal/widget.html` — exists
- `substrate/skills/interactive-messages/templates/checklist-non-terminal/server.py` — exists
- `substrate/skills/interactive-messages/templates/checklist-non-terminal/args.sh` — exists
- `substrate/skills/interactive-messages/templates/checklist-non-terminal/im-SLUG.service.template` — exists
- `substrate/skills/interactive-messages/templates/checklist-non-terminal/metadata.json.template` — exists
- `substrate/skills/interactive-messages/tests/create-widget-checklist-non-terminal.test.sh` — exists
- Commit `81007110` — exists
- Commit `fbc4c9e2` — exists
- `run-all.sh` exits 0 — confirmed (13/13)
