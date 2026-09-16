---
phase: 111-conversation-list-arrives-complete-and-stays-live
plan: "01"
subsystem: substrate/fleet-status-sweep
tags: [python, sweep, frontmatter, appearance, cosmetics, sentinels]
dependency_graph:
  requires: []
  provides:
    - sweep emits role, identity_cosmetics, role_cosmetics, pinned, hidden on every identity line
    - capped stdlib frontmatter parser with BOM handling and path-traversal guard
    - per-tick role-cosmetics memo (at most one read per distinct role per tick)
    - hermetic bash driver covering the Python emitter end-to-end
  affects:
    - src/backend/fleet-status/sweep-schema.ts (Plan 111-02 will widen SweepIdentityLine)
    - src/backend/fleet-status/ssh-poll-orchestrator.ts (Plan 111-02 will thread appearance)
tech_stack:
  added: []
  patterns:
    - capped head-read (FRONTMATTER_HEAD_BYTES=4096) for large role files
    - role name validated against ROLE_NAME_OK before any os.path.join (T-111-01)
    - per-tick dict memo for role cosmetics (synchronous Python analog of Phase 85 roleReadCache)
    - fail-closed: unreadable file yields null cosmetics, identity line always emitted
    - outer try/except belt in _build_identity_line guarantees membership is independent of appearance
key_files:
  created:
    - substrate/scripts/tests/fleet-status-sweep-appearance.sh
  modified:
    - substrate/scripts/fleet-status-sweep.py
decisions:
  - SCHEMA_VERSION held at 1 per D-04; new keys are additive optional on existing identity line
  - Text-mode with utf-8-sig chosen over binary+decode to get BOM-stripping AND a character cap
  - task field deliberately asymmetric: no trailing comment strip (# in prose is legitimate)
  - _enumerate_identities kept as pure sentinel walk; frontmatter reads only in _build_identity_line
metrics:
  duration: "~45 minutes"
  completed: "2026-09-16"
  tasks_completed: 3
  tasks_total: 3
  files_created: 1
  files_modified: 1
---

# Phase 111 Plan 01: Widen host-side sweep to emit appearance fields Summary

Host-side sweep (`fleet-status-sweep.py`) widened to emit stdlib-parsed identity frontmatter cosmetics, resolved role frontmatter cosmetics, and `.pinned`/`.hidden` sentinel booleans on the existing `line_kind: "identity"` JSONL line at SCHEMA_VERSION 1, with a hermetic bash driver that exercises the new Python parser end-to-end.

## Tasks Completed

| # | Task | Commit | Key changes |
|---|------|--------|-------------|
| 1 | Add capped stdlib frontmatter parser and per-tick role memo | d5cee12c | `ROLE_NAME_OK`, `FRONTMATTER_HEAD_BYTES`, `_read_frontmatter_cosmetics`, `_read_role_cosmetics` |
| 2 | Emit five new keys on identity line | f4280bea | `_enumerate_identities` + `_build_identity_line` + `main` wiring |
| 3 | Hermetic bash test driver | f66a00da | `substrate/scripts/tests/fleet-status-sweep-appearance.sh` (11 pass) |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check Results

### 1. SCHEMA_VERSION unchanged

```
grep -n "SCHEMA_VERSION" substrate/scripts/fleet-status-sweep.py
```

`SCHEMA_VERSION = 1` at line 102. No change from pre-edit value. Confirmed: the constant is unchanged.

### 2. No new non-stdlib imports

```
grep -cE "^import |^from " substrate/scripts/fleet-status-sweep.py
```

Returns `8`. The 8 imports are: `glob`, `json`, `os`, `re`, `subprocess`, `sys`, `traceback`, `from datetime import datetime` — all Python 3.6+ stdlib. Zero new non-stdlib imports added.

### 3. No `st_mtime` in appearance functions

Extracted `_read_frontmatter_cosmetics`, `_read_role_cosmetics`, and the new `_build_identity_line` appearance block and searched for `st_mtime` — count is 0. The 3 existing occurrences are all in pre-existing `_discover_jsonl_path` and `_mtime_ms` functions.

### 4. Role memo genuinely prevents second read

Proved via unit test: created a fixture with two identities (`alpha`, `beta`) both declaring `role: sharedrole`. Called `_build_identity_line` twice with the same `memo = {}` dict. After both calls, `len(memo) == 1` (exactly one key: `sharedrole`). The `in role_memo` membership test in `_read_role_cosmetics` causes the second call to be a cache HIT for the already-memoized result — no second file read occurs. This holds even when the role file is missing (the `None` result is also memoized).

### 5. Live sweep against real local tree

```
python3 substrate/scripts/fleet-status-sweep.py
```

- Exit code: 0
- All 77 emitted lines parse as valid JSON
- `pixel` identity line:

```json
{
  "line_kind": "identity",
  "schema_version": 1,
  "identity": "pixel",
  "dormant": false,
  "recycled_at": false,
  "recycle_requested": false,
  "jsonl_path": "/home/ubuntu/.claude/projects/...7a54faf8...jsonl",
  "layer1_recycling": null,
  "role": "box-maintainer",
  "identity_cosmetics": {
    "displayName": "Pixel",
    "task": "Taking the right pass at the conversation list..."
  },
  "role_cosmetics": {
    "title": "Skynet",
    "colorHue": 324,
    "avatar": "box-maintainer.webp"
  },
  "pinned": false,
  "hidden": false
}
```

`pixel.md` declares neither `title` nor `colorHue` — they come purely from `role_cosmetics` (INHERITED from box-maintainer). This is the zero-fixture inheritance test surface. `box-maintainer.md` is also the 44KB read-cap case; the 4096-char cap reads its frontmatter without loading the full file.

## Known Stubs

None. All new fields are live-wired to real file reads.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what the plan's `<threat_model>` already covers.

All T-111 mitigations are implemented:
- **T-111-01** (path traversal): `ROLE_NAME_OK.match(raw_role)` applied before any `os.path.join` involving role — verified by `bash substrate/scripts/tests/fleet-status-sweep-appearance.sh` case 05.
- **T-111-02** (stdout pollution): all new diagnostics go through `_log` (stderr only) — verified by test case 10 (stdout purity) and global stderr/stdout separation check.
- **T-111-03** (DoS via large files): `FRONTMATTER_HEAD_BYTES = 4096` cap + per-tick role memo — verified by case 09 (bounded read) and case 02 (read-once-per-role).
- **T-111-04** (unreadable file aborts sweep): per-identity `try/except OSError` + outer belt in `_build_identity_line` — verified by cases 03 and 04.
- **T-111-05** (import yaml): zero `import yaml` in the file.

## Self-Check: PASSED

All created/modified files confirmed present:
- `substrate/scripts/fleet-status-sweep.py` — modified (SCHEMA_VERSION=1, no new imports)
- `substrate/scripts/tests/fleet-status-sweep-appearance.sh` — created (executable, 11/11 pass)

All commits confirmed:
- `d5cee12c` — Task 1 (parser + memo)
- `f4280bea` — Task 2 (identity line emission)
- `f66a00da` — Task 3 (bash driver)
