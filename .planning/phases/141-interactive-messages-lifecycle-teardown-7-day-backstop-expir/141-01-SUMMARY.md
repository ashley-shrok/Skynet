---
phase: 140-interactive-messages-lifecycle-teardown-7-day-backstop-expir
plan: "01"
subsystem: interactive-messages/lifecycle
tags: [interactive-messages, teardown, systemd, lifecycle, substrate, shell]

dependency_graph:
  requires:
    - substrate/skills/interactive-messages/create-widget.sh
  provides:
    - substrate/skills/interactive-messages/teardown-widget.sh
  affects:
    - substrate/skills/interactive-messages/tests/teardown-widget.test.sh

tech_stack:
  added: []
  patterns:
    - Idempotent systemd unit teardown (stop + disable + daemon-reload, all fail-soft)
    - SKIP_SYSTEMCTL=1 escape hatch for test environments (mirrors create-widget.sh)
    - Slug validation byte-identical to create-widget.sh (kebab-case, max 40 chars)
    - --force flag for unconditional teardown (sweep callers)
    - TORN_DOWN= machine-parseable stdout (mirrors SLUG= / URL= in create-widget.sh)

key_files:
  created:
    - substrate/skills/interactive-messages/teardown-widget.sh
    - substrate/skills/interactive-messages/tests/teardown-widget.test.sh
  modified: []

decisions:
  - Allow bare positional slug after flags in Form B parser (--force <slug> accepted) — needed for Test 6 and natural invocation by sweep callers

metrics:
  duration: "119s"
  completed: "2026-09-27T22:56:55Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 141 Plan 01: teardown-widget.sh Summary

One-line: Atomic teardown CLI (stop+disable+rm unit file+rm widget dir+daemon-reload) with --force flag, SKIP_SYSTEMCTL escape hatch, and 10-case test harness all green.

## What Was Built

`teardown-widget.sh` is the exact inverse of `create-widget.sh`: given a validated kebab-case slug it atomically removes the interactive widget's systemd unit (stop + disable), the unit file from `~/.config/systemd/user/im-<slug>.service`, the widget directory from `~/fleet/interactive-messages/<slug>/`, and runs `daemon-reload` so the freed port becomes available for the next `create-widget.sh` port-claim scan.

Key behaviors:
- **Fail-soft on systemd state**: all three `systemctl --user` calls use `2>/dev/null || true` — a widget whose unit was never enabled, already stopped, or partially created still gets its filesystem artifacts cleaned.
- **Existence check with --force escape**: without `--force`, requires at least one of widget dir or unit file to exist (typo protection for agents). With `--force`, cleans blindly (for the Plan 03 sweep timer).
- **SKIP_SYSTEMCTL=1**: bypasses all systemctl calls, logs a note to stderr. Mirrors `create-widget.sh`'s convention exactly.
- **TORN_DOWN=<slug>** on stdout: machine-parseable result parallel to `SLUG=` / `URL=` in `create-widget.sh`.
- **Slug validation byte-identical** to `create-widget.sh`: `^[a-z][a-z0-9-]*$`, max 40 chars, same error text.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Form B parser to accept bare positional slug after flags**
- **Found during:** Task 2 test execution (Test 6 failure)
- **Issue:** When invoked as `--force phantom-slug` (flag first, then bare positional), the parser correctly entered Form B (first arg starts with `--`), consumed `--force`, then hit `phantom-slug` (a bareword) in the `*)` catch-all and died with "unknown flag". The `--force <slug>` ordering is a natural invocation pattern for sweep callers.
- **Fix:** Changed Form B `*)` case from `die "unknown flag"` to accept a bare positional as the slug (with duplicate-slug guard). Unknown `--*` flags still die. This makes `--force <slug>` and `--slug <slug> --force` both work.
- **Files modified:** `substrate/skills/interactive-messages/teardown-widget.sh`
- **Commit:** aafdcc8c (bundled into the Task 1 commit since it was discovered during Task 2 verification)

## Test Results

All 10 test cases pass (23 assertions total):

| # | Test | Result |
|---|------|--------|
| 1 | Happy path (dir + unit file removed, TORN_DOWN= stdout) | PASS |
| 2 | Missing slug arg exits non-zero with usage/slug in stderr | PASS |
| 3 | Uppercase slug rejected with kebab-case error | PASS |
| 4 | Digit-start slug exits non-zero | PASS |
| 5 | Nonexistent slug without --force exits non-zero + "no widget found" | PASS |
| 6 | Nonexistent slug with --force exits 0 + TORN_DOWN= | PASS |
| 7 | Partial state (dir only, no unit file) — dir removed, exit 0 | PASS |
| 8 | Partial state (unit file only, no dir) — unit removed, exit 0 | PASS |
| 9 | --slug flag form parity (Form B, both artifacts removed) | PASS |
| 10 | SKIP_SYSTEMCTL guard branch logged to stderr | PASS |

## Threat Mitigations Applied

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-141-01-SL | Kebab-case + max-40 regex validation before any filesystem operation |
| T-141-01-RMWildcard | Path always `$HOME/fleet/interactive-messages/$SLUG` with SLUG pre-validated |
| T-141-01-SystemctlInj | Unit name `im-$SLUG.service` with SLUG pre-validated |
| T-141-01-PartialStateDoS | `rm -f` / `rm -rf` are unconditional; systemd block is fail-soft |

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary crossings introduced. The script operates entirely on local filesystem paths derived from a validated slug.

## Self-Check: PASSED

- `substrate/skills/interactive-messages/teardown-widget.sh` exists and is executable: CONFIRMED
- `substrate/skills/interactive-messages/tests/teardown-widget.test.sh` exists and is executable: CONFIRMED
- Commit 63784fed (feat: teardown-widget.sh): CONFIRMED
- Commit aafdcc8c (test: teardown-widget.test.sh): CONFIRMED
- All 10 test cases pass (exit 0): CONFIRMED
- `grep -c 'systemctl --user' teardown-widget.sh` = 4 (3 active calls + 1 comment), >= 3: CONFIRMED
- `grep -v '^#' teardown-widget.sh | grep -c 'SKIP_SYSTEMCTL'` = 3, >= 2: CONFIRMED
