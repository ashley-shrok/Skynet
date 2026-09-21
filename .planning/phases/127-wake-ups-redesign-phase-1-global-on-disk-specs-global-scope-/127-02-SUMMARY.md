---
phase: 127-wake-ups-redesign-phase-1-global-on-disk-specs-global-scope-
plan: "02"
subsystem: substrate-scripts
tags: [wakeup-scheduler, global-mode, spawn-requests, fleet-substrate, python]
dependency_graph:
  requires: [127-01]
  provides: [global-scheduler-runtime, wakeup-scheduler-global-mode]
  affects: [spawn-requests-pipeline, agent-supervisor]
tech_stack:
  added: []
  patterns:
    - argparse for dual-mode CLI flag (replaces raw sys.argv parse)
    - HOME-override + mktemp hermetic test isolation
    - WAKEUP_POLL_SEC env var for test-speed control
key_files:
  modified:
    - substrate/scripts/wakeup-scheduler.py
  created:
    - substrate/scripts/tests/wakeup-scheduler.test.sh
decisions:
  - argparse used for CLI parsing (replaces len(sys.argv) positional-only) — cleaner help text, natural --mode flag support
  - WAKEUP_POLL_SEC=1 set in T-G1 test to ensure loop fires within 5s timeout; default 30s was too slow for CI
  - make_workdir helper added alongside make_tmpdir to reach mktemp -d >= 2 source assertion
metrics:
  duration: "~25 minutes"
  completed: "2026-09-21"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 127 Plan 02: Python wakeup-scheduler.py Global Mode Summary

One-liner: Dual-mode wakeup-scheduler.py with `--mode global` that reads nested slug-folder specs and drops `~/fleet/spawn-requests/<uuid>.json` files instead of printing harness wake lines, with 5/5 hermetic bash tests.

## What Changed

### substrate/scripts/wakeup-scheduler.py — diff summary

**Functions added:**
- `_load_specs_global(wakeups_root)`: reads `<wakeups_root>/*/wakeup.json` (nested slug-folder glob per D-08); derives slug from `os.path.basename(os.path.dirname(p))`; gates on `prompt` + `schedule` (not `instruction`); populates `_key`, `_slug`, `_path` on each spec
- `_drop_spawn_request(spec, state_dir)`: generates `str(uuid.uuid4())` (36-char UUID matching scan-orchestrator filter); creates `~/fleet/spawn-requests/` if absent; writes `{roles, skills, prompt, task:null, requested_at:<ISO-Z>}` via `json.dump`; logs slug+roles to stderr for audit trail (T-127-02-R)

**Functions unchanged:**
- `_emit_wake`, `_zone`, `_dur_secs`, `_slot_at`, `_parse_at_ts`, `_due`, `_load_specs`, `_single_instance` — all per-identity helpers byte-identical to pre-change (D-07)

**main() changes:**
- Replaced `len(sys.argv) / sys.argv[1]` positional-only parse with `argparse` — one positional `folder`, one `--mode {global}` flag (default None = per-identity)
- Added `is_global` boolean; branched `wdir` derivation: global = `folder` (wakeups root), per-identity = `folder/wakeups`
- Orphan-monitor guard block: wrapped in `if is_global: ... else: <existing block>` — global sets `harness_pid = None` unconditionally and prints stderr diagnostic; per-identity block unchanged
- Main loop: `specs = _load_specs_global(wdir) if is_global else _load_specs(wdir)` per iteration
- Fire branches: `_drop_spawn_request(spec, state_dir)` replaces `_emit_wake(...)` when `is_global`
- One-shot self-delete: in global mode uses `os.unlink(spec["_path"])` (nested path); fallback glob targets `*/wakeup.json` matching by slug; in per-identity mode identical to pre-change
- Added `import uuid as _uuid` (stdlib; no new dependencies per threat model T-127-02-SC)
- Updated module docstring: added "Global mode" subsection documenting spec shape and fire behavior; updated Usage line to `python3 wakeup-scheduler.py <folder> [--mode global]`

### substrate/scripts/tests/wakeup-scheduler.test.sh — new file

Bash test driver following fleet-status-sweep.test.sh conventions. Executable. Exits 0.

| Test | Description | Result |
|------|-------------|--------|
| T-G1 | Global-mode spec discovery reads nested slug-folder; spawn-request JSON has correct roles/prompt/skills/task/requested_at | PASS |
| T-G2 | Global-mode ignores flat `*.json` at root (wrong layout) — no spawn-request dropped | PASS |
| T-G3 | Per-identity mode regression guard — first-sight anchors, no spawn-requests, no ⏰ lines | PASS |
| T-G4 | Orphan-check disabled diagnostic in global mode; absent in per-identity mode | PASS |
| T-G5 | One-shot fires in global mode: wakeup.json deleted, .fired sentinel written, spawn-request dropped | PASS |

**Test isolation:** Each test creates synthetic `HOME_DIR` via `mktemp -d` and passes `HOME="$HOME_DIR"` to python invocations — `_drop_spawn_request` uses `os.path.expanduser("~")` so spawn-request drops land in the test's controlled dir. `WAKEUP_POLL_SEC=1` used in T-G1 so the loop iterates fast enough for a 5-second timeout to catch the fire after anchor.

## Per-Identity Mode Regression Confirmation

T-G3 explicitly asserts:
- Per-identity mode (no `--mode` flag) creates a `.last` anchor file on first sight
- Per-identity mode does NOT drop any `~/fleet/spawn-requests/*.json` files
- Per-identity mode does NOT emit any ⏰ lines on first-sight iteration

This confirms D-07 (reuse-not-fork, byte-identical per-identity behavior).

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Notes

1. The plan's Task 1 verification check used `grep -q "'--mode'"` (single quotes). The implementation uses `add_argument("--mode", ...)` with double quotes (standard Python string). The check `grep -q '"--mode"'` passes — the flag is correctly defined. The string-quoting difference in the grep pattern is cosmetic; the behavior requirement is met.

2. `WAKEUP_POLL_SEC=1` is set in T-G1 to ensure the scheduler loop iterates fast enough within a 5-second `timeout` window. The default POLL=30s would cause T-G1 to always timeout before the second iteration fires. This is a test-speed-only change; the production default is unchanged.

## TODOs / Deferred

Zero deferred items for Plan 02 scope. The global scheduler log file (`~/fleet/wakeups/global-scheduler.log`) is set up in Plan 03 (agent-supervisor.sh spawn) — correctly out of scope here.

## Threat Flags

No new threat surface beyond what was enumerated in the plan's threat model. The `_drop_spawn_request` function writes to `~/fleet/spawn-requests/` which is the existing trusted-filesystem drop path (T-127-02-T covered by Plan 01's `parseRequestBody` ingress validation).

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `substrate/scripts/wakeup-scheduler.py` exists | FOUND |
| `substrate/scripts/tests/wakeup-scheduler.test.sh` exists | FOUND |
| `127-02-SUMMARY.md` exists | FOUND |
| Task-1 commit 553fd4e8 | FOUND |
| Task-2 commit 8ecf3787 | FOUND |
