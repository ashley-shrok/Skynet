---
phase: 139-interactive-messages-non-terminal-mode-variants-multi-widget
plan: "02"
subsystem: interactive-messages
tags: [interactive-messages, template, poll, non-terminal, widgets]
dependency_graph:
  requires: [140-01]
  provides: [poll-non-terminal-template]
  affects: [create-widget.sh dispatch path for poll+non-terminal]
tech_stack:
  added: []
  patterns:
    - radio-style passive selectors (no postMessage, no submit button, indefinite editability)
    - /update endpoint pattern (not /submit) with updated_at timestamp in state.json
    - threading.Lock write serialization inherited from poll-terminal-on-click
    - TEMPLATE_CONFIG_JSON includes mode:"non-terminal" field
key_files:
  created:
    - substrate/skills/interactive-messages/templates/poll-non-terminal/widget.html
    - substrate/skills/interactive-messages/templates/poll-non-terminal/server.py
    - substrate/skills/interactive-messages/templates/poll-non-terminal/im-SLUG.service.template
    - substrate/skills/interactive-messages/templates/poll-non-terminal/metadata.json.template
    - substrate/skills/interactive-messages/templates/poll-non-terminal/args.sh
    - substrate/skills/interactive-messages/tests/create-widget-poll-non-terminal.test.sh
  modified: []
decisions:
  - Zero postMessage calls in widget.html enforced by grep-checked literal (comments rephrased to avoid the word)
  - /update endpoint name chosen (vs /submit) to signal non-terminal semantics — state.json is overwritten on every POST
  - args.sh template_parse_args contract is byte-identical to poll-terminal-on-click sibling; only TEMPLATE_CONFIG_JSON adds mode field
  - im-SLUG.service.template is verbatim copy from poll-terminal-on-click (mode does not affect systemd unit shape)
metrics:
  duration: ~4 minutes
  completed: 2026-09-27T22:10:51Z
  tasks_completed: 2
  tasks_total: 2
  files_modified: 6
---

# Phase 140 Plan 02: poll-non-terminal Template Summary

**One-liner:** `poll-non-terminal` template with radio-style selectors, `/update` endpoint, `updated_at` state shape, zero `postMessage`, and indefinite editability — the first Wave 2 non-terminal template establishing the contract all siblings (Plans 03-07) will follow.

## What Was Built

Five substrate files under `templates/poll-non-terminal/` plus one test file.

**widget.html** — inverted from `poll-terminal-on-click`: buttons replaced with `<label class="poll-row">` / `<input type="radio" name="poll-choice">` pairs. Every radio change fires `persistChoice(label)` which POSTs `{choice, updated_at}` to `/update`. The widget never calls `postMessage` or disables its radios — user can change selection freely. Dark-mode CSS block mirrors the checklist pattern using `:has(.opt-radio:checked)`.

**server.py** — `POST /update` replaces `POST /submit`. Body handling is identical (threading.Lock, try/except JSON, 400 on bad JSON, 204 on success). Forces `data["template"] = "poll"` discriminator. Top-of-file comment names `updated_at` explicitly; no `submitted_at` field appears anywhere.

**args.sh** — `template_parse_args` is byte-identical to the poll-terminal-on-click sibling (same `--prompt` + `--options` contract, same ≥2 options validation). `template_substitute` adds `"mode": "non-terminal"` to `TEMPLATE_CONFIG_JSON`.

**im-SLUG.service.template** — verbatim copy from poll-terminal-on-click. Mode has no effect on systemd unit shape.

**metadata.json.template** — shape reference; `config.mode` field set to `"non-terminal"`.

**tests/create-widget-poll-non-terminal.test.sh** — 5 test cases, 39 assertions:
1. Happy path: all structural invariants verified (zero postMessage, /update, updated_at, mode marker, radio affordance)
2. Default-mode regression: omitting `--mode` produces terminal-on-click (buttons, postMessage) — proves non-terminal is only reached via explicit `--mode non-terminal`
3-5. Validation failures: missing `--prompt`, missing `--options`, fewer than 2 options

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Scaffold poll-non-terminal template directory (5 files) | b763f74f | widget.html, server.py, im-SLUG.service.template, metadata.json.template, args.sh |
| 2 | End-to-end scaffold test for poll-non-terminal template | 571b4379 | tests/create-widget-poll-non-terminal.test.sh |

## Decisions Made

1. **Zero postMessage in comments**: The acceptance criterion is `grep -c 'postMessage' widget.html == 0`. Comments that documented the invariant using the word "postMessage" were rephrased to use "wake signal" / "no wake signal fires" instead. The structural guarantee is enforced by grep, not by comment text.

2. **/submit removed from server.py comments**: The criterion `grep -c '/submit' server.py == 0` includes comments. The file header reference to the sibling's endpoint was rephrased to "terminal mode; wakes agent via postMessage after state write" rather than naming `/submit` explicitly.

3. **mode field in TEMPLATE_CONFIG_JSON**: `args.sh` adds `"mode": "non-terminal"` to the config JSON so `metadata.json` records the widget's mode. This lets the agent distinguish non-terminal poll widgets from terminal-on-click poll widgets without inspecting the template directory.

4. **Identical arg contract**: `template_parse_args` is unchanged from the sibling — same `--prompt` + `--options` validation. This means the non-terminal template is a drop-in substitution from the user's perspective; only the behavior changes.

## Deviations from Plan

None — plan executed exactly as written. The postMessage and /submit comment rephrasing is required by the grep-checked acceptance criteria (noted in the plan's "NEVER call postMessage anywhere in this file — grep must confirm zero occurrences" instruction), not a deviation.

## Threat Model Coverage

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-140-02-HTMLInject | `json.dumps` for all inline JS substitutions in args.sh (inherited from poll-terminal-on-click) |
| T-140-02-BadJSON | `try/except (json.JSONDecodeError, ValueError)` in server.py POST /update handler; 400 response on bad JSON |
| T-140-02-AffordanceViolation | widget.html has ZERO `postMessage` calls (grep-checked: 0); ZERO `window.parent` references |
| T-140-02-StaleStateRead | Accepted by design — non-terminal mode's whole point is on-demand read; `updated_at` lets agent detect staleness |
| T-140-02-LockContention | `threading.Lock` in server.py serializes writes (inherited from poll-terminal-on-click) |

## Test Results

- `bash -n server.py` → syntax OK (via python3 -m py_compile)
- `bash -n args.sh` → syntax OK
- `bash tests/create-widget-poll-non-terminal.test.sh` → 39/39 assertions pass
- `bash tests/run-all.sh` → 9/9 test files pass (base + 7 per-template + integrated scaffold)

## Known Stubs

None — all substitution tokens are wired and verified by the test suite.

## Threat Flags

None — no new network endpoints beyond the documented `/update` (which is in the plan's threat model), no new auth paths, no new file access patterns.

## Self-Check: PASSED

- `substrate/skills/interactive-messages/templates/poll-non-terminal/widget.html` — exists
- `substrate/skills/interactive-messages/templates/poll-non-terminal/server.py` — exists
- `substrate/skills/interactive-messages/templates/poll-non-terminal/im-SLUG.service.template` — exists
- `substrate/skills/interactive-messages/templates/poll-non-terminal/metadata.json.template` — exists
- `substrate/skills/interactive-messages/templates/poll-non-terminal/args.sh` — exists
- `substrate/skills/interactive-messages/tests/create-widget-poll-non-terminal.test.sh` — exists
- Commit `b763f74f` — exists
- Commit `571b4379` — exists
- `run-all.sh` exits 0 — confirmed (9/9)
