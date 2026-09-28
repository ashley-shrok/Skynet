---
phase: 138-interactive-messages-templates-modes-multi-widget
plan: "01"
subsystem: substrate/skills/interactive-messages
tags: [interactive-messages, cli-dispatch, template-hook, widgets, back-compat]
one_liner: "Template-agnostic create-widget.sh dispatcher with per-template args.sh hook; poll extracted; Phase 137 positional form preserved"

dependency_graph:
  requires: [137-06]
  provides: [dispatcher-contract, poll-args-hook, run-all-runner]
  affects: [139-02, 139-03, 139-04, 139-05, 139-06, 139-07]

tech_stack:
  added: []
  patterns:
    - "Per-template args.sh hook: template_parse_args + template_substitute functions sourced by dispatcher"
    - "Two-pass arg parsing: positional (Form A) vs flag-based (Form B) invocation detection"
    - "compgen -G glob for template directory resolution from whitelisted name"

key_files:
  created:
    - substrate/skills/interactive-messages/templates/poll-terminal-on-click/args.sh
    - substrate/skills/interactive-messages/tests/run-all.sh
  modified:
    - substrate/skills/interactive-messages/create-widget.sh
    - substrate/skills/interactive-messages/tests/create-widget.test.sh

decisions:
  - "claim_port() extracted into a function wrapping the flock subshell — cleaner than inline and ready for reuse"
  - "args.sh removal from widget folder added (alongside im-SLUG.service.template and metadata.json.template) — args.sh is substrate-only, not runtime"
  - "compgen -G + head -1 used for TEMPLATE_DIR resolution (simpler and portable vs null-delimited read loop)"
  - "TEMPLATE_CONFIG_JSON passed to metadata.json writer as a JSON string arg parsed by python3 — avoids bash quoting issues with nested JSON"

metrics:
  duration_minutes: 15
  completed_at: "2026-09-27T20:58:38Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 2
  tests_before: 41
  tests_after: 52
---

# Phase 139 Plan 01: Dispatcher + Poll Args Hook Summary

Template-agnostic `create-widget.sh` dispatcher with per-template `args.sh` hook; poll's arg parsing and substitution extracted to its own hook file; Phase 137 positional invocation form preserved; `tests/run-all.sh` runner discovers Wave 2 test files automatically.

## What Was Built

### Task 1: Refactored create-widget.sh into a template-agnostic dispatcher

Rewrote `create-widget.sh` from a poll-only script into a dispatcher that:

- Accepts **Form A** (positional: `<slug> <template> [flags...]`) — Phase 137 back-compat
- Accepts **Form B** (flag-based: `--slug <s> --template <name> [flags...]`) — Phase 139 new
- Validates template against an allowlist of six names via `case` statement
- Resolves `TEMPLATE_DIR` by globbing `templates/<name>-*` (first match)
- Sources `$TEMPLATE_DIR/args.sh` and verifies both hook functions are defined
- Calls `template_parse_args` with remaining template-specific argv
- Calls `template_substitute` after copying template files (writes widget.html; gets `TEMPLATE_CONFIG_JSON`)
- Passes `TEMPLATE_CONFIG_JSON` to the metadata.json writer
- Extracts port claim logic into `claim_port()` function
- Removes `args.sh` from the widget folder (substrate-only file, not runtime)

Commit: `5f0290ec`

### Task 2: Created poll template's args.sh hook

Created `templates/poll-terminal-on-click/args.sh` implementing the hook contract:

- `template_parse_args`: parses `--prompt` and `--options`; validates both present; validates options >= 2 non-empty comma-separated items; exact Phase 137 error messages preserved
- `template_substitute`: applies 4-token widget.html substitution (`__PROMPT_JSON__`, `__OPTIONS_JSON__`, `__WIDGET_ID__`, `__PANE_BASE__`) via python3; sets `TEMPLATE_CONFIG_JSON` to `{"prompt": "...", "options": [...]}` via python3

Commit: `5f0290ec` (same commit as Task 1)

### Task 3: Updated test harness + created run-all.sh

- Test 5: changed from `checklist` (now a real supported template) to `bogus`; assertions updated to check for `unknown template` text and listed template names
- Test 8 added: flag-form invocation (`--slug poll-flag --template poll ...`); asserts exit 0, widget.html created, metadata.json has `template: poll`, stdout has `SLUG=poll-flag` and correct URL
- Test 9 added: positional back-compat (`poll-positional poll ...`); same assertions — proves Phase 137 form works byte-identically
- 52/52 tests pass (up from 41 before refactor)
- Created `tests/run-all.sh`: discovers `create-widget-*.test.sh` via nullglob; handles empty glob cleanly (Wave 1 end state); exits 1 on any failure; Wave 2 template plans drop their test files and this runner picks them up automatically

Commit: `994a2fc7`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — no placeholder text or hardcoded empty values introduced.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes beyond what the plan's threat model covers.

## Self-Check: PASSED

- `substrate/skills/interactive-messages/create-widget.sh`: FOUND
- `substrate/skills/interactive-messages/templates/poll-terminal-on-click/args.sh`: FOUND
- `substrate/skills/interactive-messages/tests/create-widget.test.sh`: FOUND
- `substrate/skills/interactive-messages/tests/run-all.sh`: FOUND
- Commit `5f0290ec`: FOUND
- Commit `994a2fc7`: FOUND
- `bash tests/run-all.sh`: 52/52 tests pass
