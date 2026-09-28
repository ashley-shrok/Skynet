---
phase: 138-interactive-messages-templates-modes-multi-widget
plan: "03"
subsystem: substrate/skills/interactive-messages
tags: [interactive-messages, template, form, terminal-on-submit, widgets]
one_liner: "form-terminal-on-submit template with repeatable --field name:type[:opts] arg parsing (text/number/select) and 33-test coverage"

dependency_graph:
  requires: [139-01]
  provides: [form-template, form-args-hook]
  affects: [139-07]

tech_stack:
  added: []
  patterns:
    - "Repeatable --field spec parsing with bash parameter expansion (no regex splitting)"
    - "python3 inline JSON encoding for field descriptor array assembly"
    - "TEMPLATE_FIELDS_LIST indexed array preserving field declaration order"

key_files:
  created:
    - substrate/skills/interactive-messages/templates/form-terminal-on-submit/widget.html
    - substrate/skills/interactive-messages/templates/form-terminal-on-submit/server.py
    - substrate/skills/interactive-messages/templates/form-terminal-on-submit/im-SLUG.service.template
    - substrate/skills/interactive-messages/templates/form-terminal-on-submit/metadata.json.template
    - substrate/skills/interactive-messages/templates/form-terminal-on-submit/args.sh
    - substrate/skills/interactive-messages/tests/create-widget-form.test.sh
  modified: []

decisions:
  - "bash parameter expansion (%%:* / #*:) used for colon-split instead of IFS or read -a — avoids subshell issues with global array population"
  - "TEMPLATE_FIELDS_LIST entries are pre-encoded as JSON strings per --field, then reassembled into a JSON array in template_substitute — keeps per-field validation co-located with parsing"
  - "opt_count via tr+grep -c rather than IFS read -ra to avoid subshell environment loss"

metrics:
  duration_minutes: 3
  completed_at: "2026-09-27T21:04:12Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 6
  files_modified: 0
  tests_before: 52
  tests_after: 85
---

# Phase 139 Plan 03: Form Terminal-on-Submit Template Summary

`form-terminal-on-submit` template with repeatable `--field name:type[:opts]` arg parsing (text/number/select) and 33-test coverage.

## What Was Built

### Task 1: Scaffold form template directory (5 files)

Created all five template files under `substrate/skills/interactive-messages/templates/form-terminal-on-submit/`:

**widget.html:** Full-page form with labeled input fields. `__FIELDS_JSON__` substitution point holds a JSON array of field descriptors. JS at DOMContentLoaded iterates FIELDS to build DOM — `text` → `<input type="text">`, `number` → `<input type="number" inputmode="numeric">`, `select` → `<select>` with `<option>` per entry. Submit button disabled + all inputs disabled synchronously on click before fetch. POST fires to `${PANE_BASE}/submit` with `{fields: {name: value}, submitted_at: ISO8601}`. postMessage fires to `window.location.origin` after fetch resolves 2xx. On failure, re-enables inputs + button and sets status text. Dark-mode CSS via `prefers-color-scheme`. No radio inputs.

**server.py:** Verbatim copy of poll's server.py with `data["template"] = "form"` and updated log string. Handles POST /submit with try/except for bad JSON (T-139-03-BadJSON mitigation).

**im-SLUG.service.template:** Verbatim copy of poll's service template. No changes needed.

**metadata.json.template:** Shape reference documenting the form config shape including `fields` array with per-field `name`/`type`/`options?` structure.

**args.sh:** `template_parse_args` parses `--prompt` (required), `--field name:type[:opts]` (repeatable, at least one required), `--submit-label` (optional, default "Submit"). Field name validated against `^[a-z_][a-z0-9_]*$` with length cap 40. Type whitelist: `text|number|select`. Select requires >=2 comma-separated options; text/number must have no options. Each field encoded as JSON via python3 inline and accumulated in `TEMPLATE_FIELDS_LIST`. `template_substitute` assembles FIELDS array and applies 5 token substitutions in widget.html; sets `TEMPLATE_CONFIG_JSON`.

Commit: `fc5bf069`

### Task 2: End-to-end scaffold tests for form template

Created `tests/create-widget-form.test.sh` with 7 test cases and 33 assertions:

1. **Happy path (text + number + select):** Full scaffold with three field types; asserts widget.html has all field names/options/prompt/slug/pane-base, all three type descriptors, zero radios, metadata.json has `"template": "form"` and `"fields"`, unit file port in 9601-9699, stdout has SLUG= and URL=.
2. **Missing --field:** Asserts non-zero exit + error mentions `--field`.
3. **Invalid type (blob):** Asserts non-zero exit + error mentions `text|number|select`.
4. **Uppercase field name:** Asserts non-zero exit + error mentions `snake_case`/`lowercase`.
5. **Select without options:** Asserts non-zero exit + error mentions `select requires`/`options`.
6. **Select with one option:** Asserts non-zero exit + error mentions `>=2`/`2`.
7. **Text with spurious options:** Asserts non-zero exit + error mentions `does not accept options`.

33/33 tests pass. `run-all.sh` picks up the new file automatically via glob; total 85/85 tests pass (up from 52).

Commit: `97bf0a7a`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — no placeholder text or hardcoded empty values introduced.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes beyond what the plan's threat model covers.

## Threat Model Compliance

All five threats from the plan's STRIDE register are mitigated:

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-139-03-HTMLInject | All substitutions via `json.dumps` in python3 inline; field name regex `^[a-z_][a-z0-9_]*$` enforced before substitution |
| T-139-03-postMsgWildcard | `window.location.origin` target — grep-verified in acceptance criteria |
| T-139-03-FieldSpecInj | Type whitelist enforced immediately after split; option strings flow only through `json.dumps` |
| T-139-03-DoubleSubmit | Submit button + all inputs disabled synchronously before fetch call |
| T-139-03-BadJSON | `try/except (json.JSONDecodeError, ValueError)` in server.py POST handler |

## Self-Check: PASSED

- `substrate/skills/interactive-messages/templates/form-terminal-on-submit/widget.html`: FOUND
- `substrate/skills/interactive-messages/templates/form-terminal-on-submit/server.py`: FOUND
- `substrate/skills/interactive-messages/templates/form-terminal-on-submit/im-SLUG.service.template`: FOUND
- `substrate/skills/interactive-messages/templates/form-terminal-on-submit/metadata.json.template`: FOUND
- `substrate/skills/interactive-messages/templates/form-terminal-on-submit/args.sh`: FOUND
- `substrate/skills/interactive-messages/tests/create-widget-form.test.sh`: FOUND
- Commit `fc5bf069`: FOUND
- Commit `97bf0a7a`: FOUND
- `bash tests/create-widget-form.test.sh`: 33/33 pass
- `bash tests/run-all.sh`: 85/85 pass (2/2 test files)
