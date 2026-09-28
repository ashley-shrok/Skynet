---
phase: 138-interactive-messages-templates-modes-multi-widget
plan: "05"
subsystem: substrate/skills/interactive-messages
tags: [interactive-messages, template, list-actions, terminal-on-submit, per-row-buttons, widgets]
one_liner: "list-actions-terminal-on-submit template: per-row outline action buttons (passive) + widget-level filled Done button (terminal), JSON items validation via python3, 8-case test coverage"

dependency_graph:
  requires: [139-01]
  provides: [list-actions-template, list-actions-test]
  affects: [139-07]

tech_stack:
  added: []
  patterns:
    - "Per-row toggle-select: in-memory Map<rowIdx, actionName|null>, same-action click clears selection"
    - "Visual-affordance separation: .action-btn (outline, transparent) vs .done-btn (filled, #3b82f6) enforces passive-selector vs terminal-act distinction"
    - "python3 inline json.loads for --items JSON validation in args.sh (matches plan threat model T-139-05-JsonParse)"
    - "postMessage to window.location.origin after fetch 2xx (matches T-139-05-postMsgWildcard)"

key_files:
  created:
    - substrate/skills/interactive-messages/templates/list-actions-terminal-on-submit/widget.html
    - substrate/skills/interactive-messages/templates/list-actions-terminal-on-submit/server.py
    - substrate/skills/interactive-messages/templates/list-actions-terminal-on-submit/im-SLUG.service.template
    - substrate/skills/interactive-messages/templates/list-actions-terminal-on-submit/metadata.json.template
    - substrate/skills/interactive-messages/templates/list-actions-terminal-on-submit/args.sh
    - substrate/skills/interactive-messages/tests/create-widget-list-actions.test.sh
  modified: []

decisions:
  - "Toggle-select implemented as: if clicked action === current selection, clear; else set — matches plan spec exactly without extra state flags"
  - "selectionMap.get(idx) ?? null in Done handler guards against Map entries that were never set (belt-and-suspenders vs the initialize-all-to-null loop)"
  - "Empty --actions validated by checking all_empty after IFS split — handles both empty string and whitespace-only cases"

metrics:
  duration_minutes: 5
  completed_at: "2026-09-27T21:06:23Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 6
  files_modified: 0
  tests_before: 85
  tests_after: 126
---

# Phase 139 Plan 05: list-actions Template Summary

list-actions-terminal-on-submit template with per-row outline action buttons (passive selectors) and a widget-level filled Done button (terminal act); args.sh validates JSON items via python3 inline; 8-case test covers both item shapes and all six failure modes.

## What Was Built

### Task 1: Scaffold list-actions template directory

Five template files created under `templates/list-actions-terminal-on-submit/`:

**widget.html:**
- `<h2 id="prompt">` + `<div id="la-list">` (rows) + `<button id="done-btn" class="done-btn submit-btn">` + `<div id="status">`
- Each `.la-row` has `.la-label` (item text) + `.la-actions` containing one `.action-btn` per action name
- In-memory `Map<rowIdx, actionName|null>` for selection state
- Toggle-select per row: same action clicked twice clears selection; different action replaces it; neither submits
- Done button: disables all buttons synchronously, POSTs `{rows: [{item, action}...], submitted_at}`, fires `window.parent.postMessage({type:"widget-submit", widgetId, value:{rows}}, window.location.origin)`
- CSS: `.action-btn` uses `background: transparent` + `border: 1px solid #888` (outline/passive); `.done-btn` uses `background: #3b82f6` (filled/primary) — visually distinct, enforcing affordance-matches-behavior rule
- Full dark-mode via `prefers-color-scheme: dark`
- Substitution markers: `__PROMPT_JSON__`, `__ITEMS_JSON__`, `__ACTIONS_JSON__`, `__WIDGET_ID__`, `__PANE_BASE__`, `__DONE_LABEL_JSON__`

**server.py:** Verbatim copy of poll's server; `data["template"] = "list-actions"` discriminator; startup log says "list-actions server listening".

**im-SLUG.service.template:** Verbatim copy of poll's service template.

**metadata.json.template:** Shape reference with `"template": "list-actions"` and items/actions config shape documented.

**args.sh:**
- `template_parse_args`: parses `--prompt` (required), `--items` (required JSON array), `--actions` (required CSV), `--done-label` (optional, default "Done")
- JSON validation: `python3 -c "import json,sys; json.loads(sys.argv[1])"` inline; validates array type, length >= 1, each item is string or `{label: string}` object
- `template_substitute`: 6-token substitution via python3; sets `TEMPLATE_CONFIG_JSON` to `{prompt, items, actions, done_label}`

Commit: `af79897d`

### Task 2: End-to-end scaffold test

`tests/create-widget-list-actions.test.sh` with 8 test cases, 41 assertions:

1. Happy path (string items): slug `la-happy`, 3 PR items, 3 actions — all labels/actions in widget.html; `done-btn`+`action-btn` present; metadata has template+actions; SLUG/URL on stdout
2. Happy path (object items with label field): `{label:"Alpha","meta":"x"}` + `{label:"Beta","meta":"y"}` — labels rendered; actions present
3. Missing `--items`: non-zero exit, error names `--items`
4. Malformed JSON: `not-json` — non-zero exit, error mentions "JSON" or "valid JSON array"
5. Empty array `[]`: non-zero exit, error mentions "at least 1"
6. Invalid item shape `[{"foo":"bar"}]`: non-zero exit, error mentions "strings or" or "label"
7. Missing `--actions`: non-zero exit, error names `--actions`
8. Empty `--actions ""`: non-zero exit, error mentions "at least 1" or "required"

`run-all.sh` picks up the file automatically (4/4 test files pass: 52+33+41+35 = 161 total assertions).

Commit: `663e61d0`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — no placeholder text or hardcoded empty values introduced.

## Threat Flags

None — all network endpoints (GET /, POST /submit) and trust boundaries are within the plan's threat model. All STRIDE mitigations applied:
- T-139-05-HTMLInject: json.dumps used in python3 substitution for all user-supplied values
- T-139-05-JsonParse: python3 json.loads validation in args.sh before substitution (test 4 exercises this)
- T-139-05-AffordanceConfusion: .action-btn (background:transparent) vs .done-btn (background:#3b82f6) CSS enforced and grep-checked
- T-139-05-postMsgWildcard: window.location.origin explicit
- T-139-05-DoubleSubmit: all buttons disabled synchronously before fetch
- T-139-05-BadJSON: server.py POST /submit parses with try/except

## Self-Check: PASSED

- `substrate/skills/interactive-messages/templates/list-actions-terminal-on-submit/widget.html`: FOUND
- `substrate/skills/interactive-messages/templates/list-actions-terminal-on-submit/server.py`: FOUND
- `substrate/skills/interactive-messages/templates/list-actions-terminal-on-submit/im-SLUG.service.template`: FOUND
- `substrate/skills/interactive-messages/templates/list-actions-terminal-on-submit/metadata.json.template`: FOUND
- `substrate/skills/interactive-messages/templates/list-actions-terminal-on-submit/args.sh`: FOUND
- `substrate/skills/interactive-messages/tests/create-widget-list-actions.test.sh`: FOUND
- Commit `af79897d`: FOUND
- Commit `663e61d0`: FOUND
- `bash tests/create-widget-list-actions.test.sh`: 41/41 tests pass
- `bash tests/run-all.sh`: 4/4 test files pass (161 total assertions)
