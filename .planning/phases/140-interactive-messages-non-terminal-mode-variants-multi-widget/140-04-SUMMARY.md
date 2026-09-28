---
phase: 139-interactive-messages-non-terminal-mode-variants-multi-widget
plan: "04"
subsystem: interactive-messages
tags: [interactive-messages, template, form, non-terminal, widgets, debounce]
dependency_graph:
  requires: [140-01]
  provides: [form-non-terminal-template]
  affects: [create-widget.sh dispatch (via template dir), tests/run-all.sh]
tech_stack:
  added: []
  patterns:
    - 400ms debounce via saveTimer + scheduleSave() for text/number input events
    - discrete saveNow() on select change (no debounce — inherently atomic)
    - POST /update replaces POST /submit; state.json overwritten on every update
    - threading.Lock in server.py for concurrent /update write safety
    - args.sh explicit --submit-label rejection with clear error message
key_files:
  created:
    - substrate/skills/interactive-messages/templates/form-non-terminal/widget.html
    - substrate/skills/interactive-messages/templates/form-non-terminal/server.py
    - substrate/skills/interactive-messages/templates/form-non-terminal/im-SLUG.service.template
    - substrate/skills/interactive-messages/templates/form-non-terminal/metadata.json.template
    - substrate/skills/interactive-messages/templates/form-non-terminal/args.sh
    - substrate/skills/interactive-messages/tests/create-widget-form-non-terminal.test.sh
  modified: []
decisions:
  - args.sh --field parser preserved byte-identically from form-terminal-on-submit sibling; only diff is --submit-label rejection and TEMPLATE_CONFIG_JSON mode field
  - Debounce threshold set to 400ms (plan spec said 400ms; this matches T-140-04-InputFlood mitigation)
  - data-field attributes set via JS setAttribute at runtime; test greps FIELDS JSON array in substituted widget.html instead of static HTML element attributes
  - Select fields use discrete change events (not debounced); text/number use debounced input events
metrics:
  duration: ~4 minutes
  completed: 2026-09-27T22:10:47Z
  tasks_completed: 2
  tasks_total: 2
  files_modified: 6
---

# Phase 140 Plan 04: form-non-terminal Template Summary

**One-liner:** `form-non-terminal` template with 400ms-debounced live-save on text/number inputs and discrete save on select change — POST /update, no submit button, no postMessage, `updated_at` shape.

## What Was Built

Scaffolded the full `templates/form-non-terminal/` directory (5 files) and its end-to-end test harness (1 file, 6 test cases, 36 assertions).

**widget.html** inverts the terminal sibling: the submit button, `#submit-btn` CSS rules, `handleSubmit` function, and all `window.parent.postMessage` calls are removed. Text and number inputs fire `input` events that call `scheduleSave()` — a 400ms debounced timer that coalesces keystrokes before POSTing. Select elements fire `change` events that call `saveNow()` directly (selection changes are inherently discrete). On success the status shows "Saved." and inputs remain interactive; on failure the status shows "Save failed — edit again to retry." and inputs also remain interactive. The widget never disables inputs and never fires postMessage.

**server.py** replaces `POST /submit` with `POST /update`. The `data["template"] = "form"` discriminator is preserved. The `try/except` around JSON parsing returns 400 on bad JSON. `threading.Lock` guards concurrent writes to state.json. The startup log identifies the server as "form non-terminal server".

**args.sh** preserves the `--field name:type[:options]` parser byte-identically from the terminal sibling (the complex spec validation is unchanged). The only diffs: `--submit-label` is explicitly rejected with `[create-widget] ERROR: --submit-label is not accepted for form non-terminal mode (there is no submit button)`, and `TEMPLATE_CONFIG_JSON` includes `"mode": "non-terminal"` instead of `"submit_label"`.

**im-SLUG.service.template** is a verbatim copy of the terminal sibling with an updated Phase/Source comment.

**metadata.json.template** shape reference has `"mode": "non-terminal"` in config; no `submit_label`.

**Test file** (6 cases, 36 assertions):
1. Happy path: mixed text/number/select scaffolds cleanly; widget.html has FIELDS JSON with all 3 field names and types, /update, debouncing marker, no /submit, no postMessage, no window.parent, no submit-btn; metadata.json has mode=non-terminal and 3-entry fields array.
2. `--submit-label` rejected with error naming the flag.
3. Missing `--prompt` exits non-zero + names --prompt.
4. No `--field` exits non-zero + names "at least one --field".
5. Invalid field type (`bogus`) exits non-zero + names text/number/select.
6. Select with <2 options exits non-zero + mentions >=2 / at least 2 / options.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Scaffold form-non-terminal template directory | 3440c859 | templates/form-non-terminal/{widget.html,server.py,im-SLUG.service.template,metadata.json.template,args.sh} |
| 2 | End-to-end scaffold test for form-non-terminal | 571b4379 | tests/create-widget-form-non-terminal.test.sh |

## Decisions Made

1. **Test assertions use FIELDS JSON variable, not DOM element attributes.** The widget generates inputs dynamically via JS at runtime (`input.setAttribute("data-field", ...)`); the installed widget.html source does not contain static `data-field="name"` HTML. Tests grep the substituted FIELDS array (`"name": "name"`) in the JS variable assignment instead.

2. **Debounce at 400ms (plan spec).** The plan's threat model T-140-04-InputFlood specifies 400ms; the implementation uses exactly 400ms.

3. **Select change event — no debounce.** Unlike text/number inputs that fire on every keystroke, `select` change events fire once per value change, making them naturally atomic. No debounce needed; `saveNow()` is called directly.

4. **--field parser: byte-identical copy.** The plan's objective calls out that the `name:type[:options]` parser is complex and must be preserved. The args.sh was copied from the terminal sibling verbatim, with only the `--submit-label` handler replaced by a rejection and the TEMPLATE_CONFIG_JSON adjusted.

## Deviations from Plan

None — plan executed exactly as written. One minor test-assertion adaptation: the plan specified testing for `data-field="name"` in widget.html, but since these attributes are set at runtime via JS (not static HTML), the test was written to grep the FIELDS JSON array instead. This tests the same invariant (field name correctly wired into the widget) more accurately.

## Threat Model Coverage

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-140-04-HTMLInject | `json.dumps` encoding in args.sh template_substitute (inherited from form-terminal-on-submit byte-identically) |
| T-140-04-InputFlood | 400ms debounce via scheduleSave() on text/number input events; select uses discrete change |
| T-140-04-BadJSON | `try/except (json.JSONDecodeError, ValueError)` in server.py do_POST returns 400 |
| T-140-04-SubmitLabelStale | args.sh explicit `--submit-label` rejection with clear error |
| T-140-04-LockContention | `threading.Lock` in server.py wraps STATE_FILE.write_text |
| T-140-04-PartialStateWindow | accept — agent decides when to read; updated_at timestamp signals recency |

## Test Results

- `bash -n args.sh` → 0
- `python3 -m py_compile server.py` → 0
- `bash tests/create-widget-form-non-terminal.test.sh` → 36/36 pass
- `bash tests/run-all.sh` → 9/9 test files pass (77+29+34+36+33+41+39+35+55 = 379 total assertions)

## Known Stubs

None.

## Threat Flags

None — no new network endpoints beyond the template's own /update (which was the plan intent), no auth paths, no schema changes at trust boundaries.

## Self-Check: PASSED

- `substrate/skills/interactive-messages/templates/form-non-terminal/widget.html` — FOUND
- `substrate/skills/interactive-messages/templates/form-non-terminal/server.py` — FOUND
- `substrate/skills/interactive-messages/templates/form-non-terminal/im-SLUG.service.template` — FOUND
- `substrate/skills/interactive-messages/templates/form-non-terminal/metadata.json.template` — FOUND
- `substrate/skills/interactive-messages/templates/form-non-terminal/args.sh` — FOUND
- `substrate/skills/interactive-messages/tests/create-widget-form-non-terminal.test.sh` — FOUND
- Commit `3440c859` — FOUND
- Commit `571b4379` — FOUND
- `run-all.sh` 9/9 — CONFIRMED
