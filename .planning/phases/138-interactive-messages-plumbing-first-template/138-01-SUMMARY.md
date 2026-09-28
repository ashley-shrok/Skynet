---
phase: 137-interactive-messages-plumbing-first-template
plan: "01"
subsystem: fleet-status-sweep + sweep-schema
tags: [sweep, interactive-messages, widget-discovery, additive-schema]
dependency_graph:
  requires: []
  provides:
    - sweep emits line_kind:"interactive-message" JSONL lines (source-D)
    - SweepInteractiveMessageLine TS interface
    - parseSweepJsonl.interactiveMessageLines bucket
  affects:
    - src/backend/fleet-status/sweep-schema.ts
    - substrate/scripts/fleet-status-sweep.py
tech_stack:
  added: []
  patterns:
    - additive-line-kind (Phase 118 precedent — no SWEEP_SCHEMA_VERSION bump)
    - fail-open enumeration with count + wallclock DoS caps
    - TDD RED/GREEN on TS schema tests
key_files:
  created: []
  modified:
    - substrate/scripts/fleet-status-sweep.py
    - src/backend/fleet-status/sweep-schema.ts
    - src/backend/fleet-status/sweep-schema.test.ts
decisions:
  - WIDGET_ENUM_CAP=50 and WIDGET_ENUM_WALLCLOCK_BUDGET_SEC=3.0 match APP_ENUM_* constants (parity, no separate tuning needed at Phase 138)
  - _build_widget_line does not carry health_message (widgets are not sidebar tiles; D-20)
  - Port probe reuses APP_UNIT_ENV_PORT_RE and _probe_app_port unchanged
metrics:
  duration: ~25 minutes
  completed: "2026-09-27"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 138 Plan 01: Sweep Source-D + Schema Widening Summary

One-liner: Added source-D widget discovery (~/fleet/interactive-messages/*) to fleet-status-sweep.py and widened the TS sweep-schema parser to route `line_kind:"interactive-message"` lines into a typed `interactiveMessageLines` bucket without bumping SWEEP_SCHEMA_VERSION.

## What Shipped

**Task 1 — Python sweep extension (substrate/scripts/fleet-status-sweep.py)**

Added +193 lines implementing the Phase 138 source-D widget enumeration:

- **Constants block** (after Phase 118 app constants at line 212): `WIDGET_SLUG_RE`, `WIDGET_SLUG_MAX_LEN=40`, `WIDGET_ENUM_CAP=50`, `WIDGET_ENUM_WALLCLOCK_BUDGET_SEC=3.0`. Reuses `APP_UNIT_ENV_PORT_RE` and `APP_PORT_PROBE_TIMEOUT_SEC` without duplication.

- **`_read_widget_unit_file(slug, home)`** — mirrors `_read_app_unit_file` but reads `~/.config/systemd/user/im-<slug>.service`.

- **`_build_widget_line(slug, folder_path, home)`** — simpler than `_build_app_line` (no app.json check, no title/description/has_icon/health_message/users). Returns exactly the 6-key shape: `{line_kind, schema_version, slug, port, is_healthy, created_at_ms}`. Port extracted via `APP_UNIT_ENV_PORT_RE`; health via `_probe_app_port` with the same container carve-out (HOME_HOST_DIR env); created_at_ms from folder mtime.

- **`_enumerate_widgets(home)`** — mirrors `_enumerate_apps` with both DoS caps (count + wallclock), `follow_symlinks=False` symlink rejection, per-entry try/except containment, and `FileNotFoundError` fail-open branch. Log ops use `_widgets_` prefix for grep-ability.

- **`main()` wiring** — `widget_records = _enumerate_widgets(home)` after `_enumerate_apps`; emit loop after app emit loop (D-14 additive-newest-last).

- `SCHEMA_VERSION` unchanged (still 1).

**Task 2 — TypeScript schema widening (sweep-schema.ts + sweep-schema.test.ts)**

Added +83 lines to sweep-schema.ts (now 681 total):

- **`SweepInteractiveMessageLine` interface** exported after `SweepAppLine` with full rolling-deploy docblock and field-by-field documentation. 6 fields only: `line_kind: "interactive-message"`, `schema_version`, `slug`, `port: number | null`, `is_healthy`, `created_at_ms`. No title/description/has_icon/health_message/users.

- **`SweepLine` union** widened to include `SweepInteractiveMessageLine`.

- **`isSweepLineOfCurrentSchema`** widened with fourth disjunct `rec.line_kind === "interactive-message"`.

- **`SweepParseResult.interactiveMessageLines`** field added with Phase 138 docblock.

- **`parseSweepJsonl`** widened: new local array, added to fast-path return, new `else if` dispatch branch, added to final return.

Added +140 lines of tests to sweep-schema.test.ts (now 1013 total):

- `makeInteractiveMessageLine` fixture helper
- Test: SWEEP_SCHEMA_VERSION === 1 (NOT bumped invariant lock)
- Test: routes interactive-message lines into interactiveMessageLines; unknownLines === 0
- Test: empty input returns interactiveMessageLines: []
- Test: mixed identity+pid+app+interactive-message all bucketize correctly; unknownLines === 0
- Test: schema_version mismatch gate applies; line dropped; schemaMismatch=true
- Test: null port + is_healthy=false parses correctly
- Test: isSweepLineOfCurrentSchema accepts at schema_version 1; rejects at wrong version; rejects missing version
- Updated existing empty-input `toEqual` tests to include `interactiveMessageLines: []`

## Files Changed

| File | Change | Lines (total) |
|------|--------|---------------|
| `substrate/scripts/fleet-status-sweep.py` | +193 lines (constants, 3 functions, main wiring) | 1977 |
| `src/backend/fleet-status/sweep-schema.ts` | +83 lines (interface, union, guard, parse result, parser) | 681 |
| `src/backend/fleet-status/sweep-schema.test.ts` | +140 lines (10 new tests, 2 updated) | 1013 |

## New Exports

- `SweepInteractiveMessageLine` interface (sweep-schema.ts)
- `SweepParseResult.interactiveMessageLines: SweepInteractiveMessageLine[]` field

## Tests Passing

```
Test Files  4 passed (4)
Tests  259 passed (259)
```

10 new tests added. Backend typecheck (`npm run build:backend`) clean.

## SWEEP_SCHEMA_VERSION Unchanged

```
$ grep -c "SWEEP_SCHEMA_VERSION = 2" src/backend/fleet-status/sweep-schema.ts
0
$ grep "^SCHEMA_VERSION = " substrate/scripts/fleet-status-sweep.py
SCHEMA_VERSION = 1
```

## Deviations from Plan

None — plan executed exactly as written.

The only minor note: two existing `toEqual` tests in the Phase 118 "empty input" describe block needed updating to include `interactiveMessageLines: []` in their expected objects. These tests were pinning the exact SweepParseResult shape, which now includes the new field. This is expected plan-execution behavior (not a deviation), analogous to how the Phase 118 tests updated the empty-input expected object to include `appLines: []`.

## TDD Gate Compliance

- RED commit (`58e996ef`): failing tests for SweepInteractiveMessageLine import + all new behavior
- GREEN commit (`b99487d7`): implementation passing all 259 tests

Both TDD gate commits present.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries introduced. The sweep extension reads only `~/fleet/interactive-messages/*/` and `~/.config/systemd/user/im-*.service` — same filesystem access pattern as the Phase 118 app enumeration. All mitigations in the threat register (T-138-01-SL, T-138-01-PT, T-138-01-DoS, T-138-01-SV) are implemented:
- T-138-01-SL: WIDGET_SLUG_RE + WIDGET_SLUG_MAX_LEN gate before unit file read
- T-138-01-PT: follow_symlinks=False in scandir
- T-138-01-DoS: WIDGET_ENUM_CAP=50 + WIDGET_ENUM_WALLCLOCK_BUDGET_SEC=3.0
- T-138-01-SV: SWEEP_SCHEMA_VERSION unchanged

## Self-Check: PASSED

- [x] `substrate/scripts/fleet-status-sweep.py` — verify command passed: "OK: widget line emitted correctly"
- [x] `src/backend/fleet-status/sweep-schema.ts` — exists, 681 lines, contains `SweepInteractiveMessageLine`
- [x] `src/backend/fleet-status/sweep-schema.test.ts` — exists, 1013 lines, contains `interactive-message`
- [x] Commits: `5d703e92` (Task 1), `58e996ef` (RED tests), `b99487d7` (Task 2 GREEN)
- [x] All 259 tests pass
- [x] Backend typecheck clean
- [x] SWEEP_SCHEMA_VERSION === 1 (not bumped)
