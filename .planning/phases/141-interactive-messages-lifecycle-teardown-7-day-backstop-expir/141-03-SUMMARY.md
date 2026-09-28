---
phase: 140-interactive-messages-lifecycle-teardown-7-day-backstop-expir
plan: "03"
subsystem: interactive-messages/backstop
tags: [interactive-messages, backstop, systemd-timer, distributor, substrate, gc]

dependency_graph:
  requires:
    - substrate/skills/interactive-messages/teardown-widget.sh  # Plan 01
  provides:
    - substrate/scripts/interactive-messages-gc.py
    - substrate/scripts/tests/interactive-messages-gc.test.sh
    - substrate/user-onboarding/interactive-messages-gc.service
    - substrate/user-onboarding/interactive-messages-gc.timer
  affects:
    - src/backend/distributor/catalog.ts
    - src/backend/distributor/catalog.test.ts
    - src/backend/distributor/run-bootstrap.ts
    - src/backend/distributor/run-bootstrap.test.ts

tech_stack:
  added: []
  patterns:
    - Python stdlib-only GC sweep (mirrors fleet-status-sweep.py constraint)
    - systemd oneshot service + daily timer (OnCalendar=daily, Persistent=true)
    - TEARDOWN_CMD env-var override for test harness isolation
    - Idempotent is-enabled-then-enable-once pattern (mirrors agent-supervisor bootstrap)
    - Per-widget skip-on-error (one bad widget never halts the sweep)

key_files:
  created:
    - substrate/scripts/interactive-messages-gc.py
    - substrate/scripts/tests/interactive-messages-gc.test.sh
    - substrate/user-onboarding/interactive-messages-gc.service
    - substrate/user-onboarding/interactive-messages-gc.timer
  modified:
    - src/backend/distributor/catalog.ts
    - src/backend/distributor/catalog.test.ts
    - src/backend/distributor/run-bootstrap.ts
    - src/backend/distributor/run-bootstrap.test.ts

decisions:
  - dry-run mode sets tore_down=0 in summary (only actual teardowns count); DRY-RUN would-teardown log lines are the dry-run signal
  - Step 1b in run-bootstrap uses separate try/catch block for NEVER-THROW compliance
  - Test mock channel seeded with gc.timer=enabled/EXIT:0 so all 51 pre-existing tests pass unmodified
  - gc-3/gc-5/gc-6 tests use custom exec functions (not makeChannel) to distinguish is-enabled probe from enable-now command (both contain "interactive-messages-gc.timer" substring)

metrics:
  duration: "534s"
  completed: "2026-09-27T23:07:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 4
---

# Phase 141 Plan 03: interactive-messages-gc.py + backstop timer Summary

One-line: Python stdlib-only GC sweep (--dry-run, per-widget skip-on-error, TEARDOWN_CMD env-var) wired through a systemd daily timer distributed via 3 new catalog rows and idempotently enabled by run-bootstrap.ts Step 1b.

## What Was Built

### Task 1: GC sweep script + systemd units

`substrate/scripts/interactive-messages-gc.py` — mode 0755, Python stdlib-only. Enumerates `~/fleet/interactive-messages/*/`, reads each widget's `metadata.json.created_at`, and shells out to `teardown-widget.sh --force <slug>` for any widget with `age_days >= AGE_DAYS` (default 7). Key behaviors:

- `--dry-run` flag: logs `DRY-RUN would-teardown slug=<slug>` without shelling out; `tore_down` stays 0 in summary
- `--age-days N` override for testing lower thresholds
- `--root PATH` override for test harness isolation
- `TEARDOWN_CMD` env-var override (default: `~/.claude/skills/interactive-messages/teardown-widget.sh`)
- LOUD log lines: `[interactive-messages-gc] TEARDOWN slug=<slug> age_days=<n> created_at=<ts>` — grep-able via `journalctl --user -u interactive-messages-gc`
- Per-widget skip-on-error: malformed/missing metadata, teardown non-zero exit → `skipped += 1`, continue
- Summary line: `[interactive-messages-gc] done. checked=N tore_down=M skipped=S`
- Forgiving ISO8601 parser: handles `Z` suffix and `+HH:MM` offsets

`substrate/user-onboarding/interactive-messages-gc.service` — mode 0644, Type=oneshot, ExecStart=%h/.local/bin/interactive-messages-gc, WantedBy=default.target.

`substrate/user-onboarding/interactive-messages-gc.timer` — mode 0644, OnCalendar=daily, Persistent=true, Unit=interactive-messages-gc.service, WantedBy=timers.target. `Persistent=true` is load-bearing for fleet boxes suspended overnight.

### Task 2: Test harness + catalog wiring

`substrate/scripts/tests/interactive-messages-gc.test.sh` — 7 test cases, all PASS:

| # | Test | Result |
|---|------|--------|
| 1 | Fresh box, no widgets root | PASS |
| 2 | All widgets fresh (< 7 days), dry-run | PASS |
| 3 | One old widget, dry-run | PASS |
| 4 | One old widget, real teardown via mock | PASS |
| 5 | Malformed metadata.json → skip | PASS |
| 6 | Missing created_at field → skip | PASS |
| 7 | --age-days 2 override triggers 3-day-old widget | PASS |

`catalog.ts` — 3 new rows: `interactive-messages-gc` (script, `~/.local/bin/`), `interactive-messages-gc-service-unit` (service, `~/.config/systemd/user/`), `interactive-messages-gc-timer-unit` (timer, same). All `restartHook: null`.

`catalog.test.ts` — total 55→58, scriptRows 15→16, userOnboardingRows 1→3, bundled 54→57. Test 9 (slug-trio presence) added. Vitest: 10/10 pass.

### Task 3: run-bootstrap.ts Step 1b + 6 new tests

`run-bootstrap.ts` — Step 1b added after daemon-reload: probes `systemctl --user is-enabled interactive-messages-gc.timer`; if exit 0 → `gcTimerAlreadyEnabled=true` (cheap no-op); if non-zero → `systemctl --user enable --now interactive-messages-gc.timer && echo "__GC_TIMER_OK__"`. `BootstrapResult` gains two new boolean fields: `gcTimerAlreadyEnabled`, `gcTimerBootstrapped`.

`run-bootstrap.test.ts` — 6 new tests in `describe("step 1b")`: gc-1 (fields exist), gc-2 (already-enabled → no enable-now), gc-3 (not-enabled → enable-now), gc-4 (null on probe), gc-5 (null on enable-now), gc-6 (enable-now missing sentinel). All 52 tests pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] dry-run tore_down counter — plan spec requires tore_down=0 in dry-run summary**
- **Found during:** Task 2 test run (test_one_old_widget_dry_run FAIL)
- **Issue:** Original implementation incremented `tore_down` on dry-run widgets alongside real teardowns. Test case 3 expects `tore_down=0` in dry-run mode.
- **Fix:** Moved `tore_down += 1` inside the `else` (non-dry-run) branch. Dry-run widgets log `would-teardown` but never touch `tore_down`.
- **Files modified:** `substrate/scripts/interactive-messages-gc.py`
- **Commit:** ddea63a5

**2. [Rule 1 - Bug] Test mock dispatch ambiguity for Step 1b tests**
- **Found during:** Task 3 test run (gc-3 FAIL)
- **Issue:** Both the is-enabled probe and the enable-now command contain the substring "interactive-messages-gc.timer". The `makeChannel` seeded-default handler matched the enable-now command with the is-enabled response, causing `gcTimerBootstrapped=false`.
- **Fix:** Tests gc-3, gc-5, gc-6 use custom `exec` functions with explicit ordering (enable-now checked before is-enabled) rather than `makeChannel`. Tests gc-1, gc-2, gc-4 continue using `makeChannel` (they don't need the enable-now path).
- **Files modified:** `src/backend/distributor/run-bootstrap.test.ts`
- **Commit:** 13c9d720

## Threat Mitigations Applied

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-141-03-SlugInj | Slug is `entry.name` from `pathlib.Path.iterdir()`, passed as a single element in `subprocess.run([..., slug])` list (not shell=True). No shell interpretation of slug. |
| T-141-03-TeardownFailCascade | `check=False` + log-and-continue on non-zero teardown exit. One bad widget never stops the sweep. |
| T-141-03-MetadataParse | `json.loads` wrapped in try/except; malformed JSON → skip-with-warn. No eval, no shell exec from metadata contents. |
| T-141-03-TimerDrift | `Persistent=true` in .timer unit. Bootstrap step re-enables on every sweep if somehow disabled. |
| T-141-03-CatalogDrift | catalog.test.ts row-count and partitioning tests re-run on every commit; a mis-added row fails the vitest run. |

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or cross-machine RPC introduced. The GC sweep operates entirely on local filesystem paths derived from validated slug names.

## Self-Check: PASSED

- `substrate/scripts/interactive-messages-gc.py` exists and is executable: CONFIRMED
- `substrate/scripts/tests/interactive-messages-gc.test.sh` exists and is executable: CONFIRMED
- `substrate/user-onboarding/interactive-messages-gc.service` exists: CONFIRMED
- `substrate/user-onboarding/interactive-messages-gc.timer` exists: CONFIRMED
- Commit 8bae1982 (Task 1 — 3 substrate files): CONFIRMED
- Commit ddea63a5 (Task 2 — test harness + catalog): CONFIRMED
- Commit 13c9d720 (Task 3 — run-bootstrap + tests): CONFIRMED
- `bash interactive-messages-gc.test.sh` exits 0, 7/7 PASS: CONFIRMED
- `npx vitest run catalog.test.ts` exits 0, 10/10 pass: CONFIRMED
- `npx vitest run run-bootstrap.test.ts` exits 0, 52/52 pass: CONFIRMED
- `grep -c 'interactive-messages-gc' catalog.ts` = 12 (>= 6): CONFIRMED
- `grep -q 'systemctl --user enable --now interactive-messages-gc.timer' run-bootstrap.ts`: CONFIRMED
