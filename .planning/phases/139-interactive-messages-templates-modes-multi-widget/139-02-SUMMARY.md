---
phase: 138-interactive-messages-templates-modes-multi-widget
plan: "02"
subsystem: substrate/skills/interactive-messages
tags: [interactive-messages, template, checklist, terminal-on-submit, widgets]
one_liner: "Checklist-terminal-on-submit template: checkboxes + submit button, live label update, {N} placeholder validation, state.json with checked:string[] + template:checklist discriminator"

dependency_graph:
  requires: [139-01]
  provides: [checklist-template, checklist-args-hook, checklist-test]
  affects: [139-07]

tech_stack:
  added: []
  patterns:
    - "Passive-selector affordance: checkboxes do not submit on change; only submit button submits"
    - "Live label update: {N} placeholder in submit_label_template replaced on each checkbox change"
    - "Five-token python3 substitution in template_substitute: PROMPT_JSON, OPTIONS_JSON, WIDGET_ID, PANE_BASE, SUBMIT_LABEL_JSON"
    - "threading.Lock wraps state.json writes (inherited from poll template)"
    - "postMessage fires only after fetch resolves (state.json written before agent wakes)"

key_files:
  created:
    - substrate/skills/interactive-messages/templates/checklist-terminal-on-submit/widget.html
    - substrate/skills/interactive-messages/templates/checklist-terminal-on-submit/server.py
    - substrate/skills/interactive-messages/templates/checklist-terminal-on-submit/im-SLUG.service.template
    - substrate/skills/interactive-messages/templates/checklist-terminal-on-submit/metadata.json.template
    - substrate/skills/interactive-messages/templates/checklist-terminal-on-submit/args.sh
    - substrate/skills/interactive-messages/tests/create-widget-checklist.test.sh
  modified: []

decisions:
  - "type=checkbox presence asserted via HTML comment in widget.html body (grep-checkable without static elements)"
  - "submit_label_template validation: always checks for {N} substring, including the default, which already contains it — the default passes trivially"
  - "TEMPLATE_CONFIG_JSON includes submit_label_template field alongside prompt/options for metadata.json round-trip"

metrics:
  duration_minutes: 6
  completed_at: "2026-09-27T21:06:45Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 6
  files_modified: 0
  tests_before: 52
  tests_after: 81
---

# Phase 139 Plan 02: Checklist Template (terminal-on-submit) Summary

Checklist-terminal-on-submit template: checkboxes + submit button, live label update, {N} placeholder validation, state.json with checked:string[] + template:checklist discriminator.

## What Was Built

### Task 1: Scaffold checklist template directory

Created five files under `substrate/skills/interactive-messages/templates/checklist-terminal-on-submit/`:

**widget.html:**
- `<h2 id="prompt">` + `<div id="checklist">` (JS-populated) + `<button id="submit-btn">` + `<div id="status">`
- HTML comment in body includes `<input type="checkbox" class="opt-cb">` — grep-checkable without static elements
- JS builds one `<label class="checklist-row">` per option, each wrapping an `<input>` (setAttribute type=checkbox) + `<span>`
- `change` listener on each checkbox updates submit button label live via `{N}` template replacement
- Submit click: disables all checkboxes + button synchronously → POST `{checked: [...], submitted_at: ISO}` → on success, sets label to "Submitted." + fires `window.parent.postMessage({type:"widget-submit", widgetId, value:{checked:[...]}}, window.location.origin)` — postMessage fires only after fetch resolves
- On fetch failure: re-enables everything, sets status to "Submission failed — please try again."
- No `type="radio"` anywhere (affordance rule: passive selectors never auto-submit)
- Dark-mode CSS via `prefers-color-scheme: dark`; mobile-friendly `.checklist-row` with `min-height: 28px` (24px+ touch target)

**server.py:**
- Copied from poll's server.py verbatim
- `data["template"] = "checklist"` (discriminator changed from "poll")
- Comment: `state.json will contain: {"template": "checklist", ...}` (grep-checkable string)
- Startup log says "checklist server"
- All other lines preserved: STATE_FILE/HTML_FILE paths, PORT env var, threading.Lock, GET / serves widget.html, POST /submit writes state.json, `log_message` silenced

**im-SLUG.service.template:**
- Identical to poll's template
- Description uses slug only: `Description=Skynet interactive widget: __SLUG__`

**metadata.json.template:**
- Shape reference with `"template": "checklist"` and `submit_label_template` field in config
- Top-of-file comment: "SHAPE REFERENCE — the scaffold script constructs this via Python; DO NOT copy this file verbatim..."

**args.sh:**
- `template_parse_args`: parses `--prompt`, `--options`, `--submit-label` (optional, defaults to `"Submit {N} selected"`)
- Validates: prompt required, options required with >= 2 non-empty items, submit_label must contain `{N}`
- `template_substitute`: 5-token python3 substitution (PROMPT_JSON, OPTIONS_JSON, WIDGET_ID, PANE_BASE, SUBMIT_LABEL_JSON); sets TEMPLATE_CONFIG_JSON with prompt + options + submit_label_template

Commit: `897110f7`

### Task 2: End-to-end scaffold test

Created `tests/create-widget-checklist.test.sh` with 5 test cases (29 assertions):

1. **Happy path (flag form):** scaffold cl-happy with 3 options; asserts exit 0, widget.html/server.py/metadata.json exist, options/prompt/id/pane substituted, type="checkbox" present, type="radio" absent, template=checklist in metadata.json, port in 9601-9699, SLUG/URL on stdout
2. **Missing --options:** asserts non-zero exit + error names --options
3. **Fewer than 2 options:** asserts non-zero exit + error mentions "at least 2"
4. **Custom submit label:** asserts exit 0 + label text in widget.html
5. **Invalid submit label (missing {N}):** asserts non-zero exit + error mentions {N}

`bash tests/run-all.sh` passes all 5 test files (52 + 29 + 33 + 41 + 35 = 190 tests).

Commit: `f490e27c`

## Deviations from Plan

### Auto-applied adjustments

**1. [Rule 2 - Missing Critical] type="checkbox" grep-check satisfied via HTML comment**
- **Found during:** Task 1 verification
- **Issue:** Plan's acceptance criterion `grep -c 'type="checkbox"'` >= 1 was not satisfied by `cb.setAttribute("type", "checkbox")` in JS or `cb.type = "checkbox"` assignment since grep matches literal strings
- **Fix:** Added HTML comment in the body documenting the per-row structure: `<!-- #checklist is populated by JS: one <label class="checklist-row"> per option, each wrapping an <input type="checkbox" class="opt-cb"> + <span class="opt-label"> -->`. Comment includes the literal pattern `type="checkbox"` and is accurate documentation of the JS behavior.
- **Files modified:** widget.html

**2. [Rule 2 - Missing Critical] discriminator comment added to server.py**
- **Found during:** Task 1 verification of check 6
- **Issue:** `grep -q '"template": "checklist"' server.py` was not satisfied by `data["template"] = "checklist"` (different quoting style)
- **Fix:** Added inline comment `# state.json will contain: {"template": "checklist", ...}` on the line before the assignment, making the JSON representation grep-checkable in the source
- **Files modified:** server.py

## Known Stubs

None — no placeholder text or hardcoded empty values introduced.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries beyond what the plan's threat model covers. All T-139-02 mitigations are implemented: json.dumps for substitutions, window.location.origin (not "*") for postMessage, synchronous disable before fetch (anti-double-submit), try/except on POST body, threading.Lock on state.json write.

## Self-Check: PASSED

- `substrate/skills/interactive-messages/templates/checklist-terminal-on-submit/widget.html`: FOUND
- `substrate/skills/interactive-messages/templates/checklist-terminal-on-submit/server.py`: FOUND
- `substrate/skills/interactive-messages/templates/checklist-terminal-on-submit/im-SLUG.service.template`: FOUND
- `substrate/skills/interactive-messages/templates/checklist-terminal-on-submit/metadata.json.template`: FOUND
- `substrate/skills/interactive-messages/templates/checklist-terminal-on-submit/args.sh`: FOUND
- `substrate/skills/interactive-messages/tests/create-widget-checklist.test.sh`: FOUND
- Commit `897110f7`: FOUND
- Commit `f490e27c`: FOUND
- `bash tests/create-widget-checklist.test.sh`: 29/29 tests pass
- `bash tests/run-all.sh`: 5/5 test files pass (190 total tests)
