---
phase: 139-interactive-messages-non-terminal-mode-variants-multi-widget
plan: "01"
subsystem: interactive-messages
tags: [interactive-messages, cli-dispatch, mode-selection, back-compat, widgets, bash]
dependency_graph:
  requires: [138-07]
  provides: [mode-aware-dispatch, non-terminal-dispatch-path]
  affects: [create-widget.sh, base-test-harness]
tech_stack:
  added: []
  patterns:
    - case-statement allowlist validation for --mode arg before path composition
    - default_mode_for_template() + is_supported_combo() helper functions
    - explicit template-mode path resolution (no glob)
key_files:
  modified:
    - substrate/skills/interactive-messages/create-widget.sh
    - substrate/skills/interactive-messages/tests/create-widget.test.sh
decisions:
  - Glob-based TEMPLATE_DIR resolution replaced with explicit `<template>-<mode>` path composition — defense-in-depth against the future two-dir-per-template ambiguity
  - --mode validated against a literal allowlist BEFORE composing any filesystem path (T-140-01-PathInject mitigation)
  - default_mode_for_template() uses a case statement with an explicit `*)` catch-all returning 1 — loud failure on unrecognized template (T-140-01-SilentFallback mitigation)
  - is_supported_combo() checked BEFORE any filesystem mutation — unsupported combos never claim a port or create a widget folder (T-140-01-CombiExploit mitigation)
metrics:
  duration: ~18 minutes
  completed: 2026-09-27T22:03:37Z
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 140 Plan 01: Mode-Aware Dispatch Summary

**One-liner:** `--mode` arg + `default_mode_for_template()` + `is_supported_combo()` added to `create-widget.sh`, replacing glob resolution with explicit `<template>-<mode>` path dispatch; base test harness extended with 6 new mode test groups.

## What Was Built

Extended `create-widget.sh` to accept `--mode <terminal-on-click|terminal-on-submit|non-terminal>` and dispatch to the exact `templates/<template>-<mode>/` directory. When `--mode` is omitted, a per-template canonical default is used (poll/color-picker → terminal-on-click; checklist/form/ranking/list-actions → terminal-on-submit), preserving Phase 138 back-compat byte-identically.

Unsupported combinations (e.g., `form + terminal-on-click`) are rejected before any filesystem mutation with a clear error message naming the template, the requested mode, and the modes the template actually supports. Unknown mode strings (e.g., `not-a-real-mode`) are rejected with a message listing all three canonical modes.

The glob-based `TEMPLATE_DIR` resolution (`compgen -G templates/$TEMPLATE-*`) has been replaced with explicit path composition (`templates/$TEMPLATE-$MODE`). This is the load-bearing change for Wave 2: each Wave 2 plan simply creates its `<template>-non-terminal/` directory and it becomes reachable via `--mode non-terminal`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend create-widget.sh with --mode + default-mode map + combo enforcement | f8251cb0 | create-widget.sh |
| 2 | Extend base test harness with --mode explicit, default-fallback, and rejection cases | 6ddf3c78 | tests/create-widget.test.sh |

## Decisions Made

1. **Glob → explicit path**: Replaced `compgen -G "$SCRIPT_DIR/templates/$TEMPLATE-*" | head -1` with `"$SCRIPT_DIR/templates/$TEMPLATE-$MODE"`. With two directories per template post-Phase-139, the glob would be ambiguous. Explicit path resolution makes the relationship between `--mode` and the template directory deterministic.

2. **Two-layer combo enforcement**: `is_supported_combo()` catches semantic errors (e.g., `form + terminal-on-click` is not in the curated set). The subsequent `[ -d "$TEMPLATE_DIR" ]` check catches missing-substrate errors (Phase 140 Wave 2 dirs not yet created). Both layers fire before any port claim or scaffold.

3. **`MODE_ARG` vs `MODE`**: `MODE_ARG` holds the raw `--mode` flag value (empty = not supplied). `MODE` holds the resolved mode (after default-mode fallback or explicit validation). The two-step resolution makes the distinction between "user didn't specify" and "user specified the canonical default" explicit.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Coverage

All four STRIDE threats from the plan's threat register were mitigated in implementation:

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-140-01-PathInject | `--mode` validated against 3-string allowlist before path composition |
| T-140-01-SilentFallback | `default_mode_for_template()` `*)` branch returns 1 on unknown template |
| T-140-01-CombiExploit | `is_supported_combo()` checked before port claim or widget folder creation |
| T-140-01-BackCompatBreak | All existing tests pass byte-identically (run-all.sh 7/7) |

## Test Results

- `bash -n create-widget.sh` → 0 (syntax clean)
- `bash tests/create-widget.test.sh` → 77 tests, 0 failures
- `bash tests/run-all.sh` → 7/7 test files pass (base + 6 per-template + integrated scaffold)

New test cases:
- Test 10: `--mode terminal-on-click` explicit dispatch (poll)
- Test 11: `--mode` omitted → poll defaults to terminal-on-click
- Test 12: `--mode` omitted → checklist defaults to terminal-on-submit
- Test 13: Unsupported combo `form + terminal-on-click` rejected with clear error
- Test 14: Unsupported combo `color-picker + terminal-on-submit` rejected with clear error
- Test 15: Unknown mode string `not-a-real-mode` rejected, all three canonical modes listed

## Known Stubs

None — this plan ships purely dispatcher plumbing. Non-terminal template directories (`<template>-non-terminal/`) do not exist yet; they are created in Wave 2 (Plans 02-07). The dispatcher is ready to reach them via `--mode non-terminal` once they land.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- `substrate/skills/interactive-messages/create-widget.sh` — modified, syntax clean
- `substrate/skills/interactive-messages/tests/create-widget.test.sh` — modified, syntax clean
- Commit `f8251cb0` — exists
- Commit `6ddf3c78` — exists
- `run-all.sh` exits 0 — confirmed
