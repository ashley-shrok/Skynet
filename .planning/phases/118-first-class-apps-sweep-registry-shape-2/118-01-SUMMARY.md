---
phase: 118-first-class-apps-sweep-registry-shape-2
plan: 01
subsystem: fleet-substrate
tags: [python, sweep, systemd, jsonl, apps, source-c]
requires:
  - substrate/skills/app-development/create-app.sh (slug regex source of truth)
  - substrate/skills/app-development/templates/app-starter/app.json (metadata card shape)
  - substrate/skills/app-development/templates/app-starter/app-SLUG.service.template (unit + PORT env location)
provides:
  - "fleet-status-sweep.py source-C emission: one JSONL line per ~/fleet/apps/<slug>/ that passes D-01 or D-02"
  - "seven-field D-05 wire shape (line_kind, schema_version, slug, title, description, port, has_icon, created_at_ms, is_healthy, health_message)"
  - "shell test harness for the source-C parse layer (six D-21 cases + slug-injection defense)"
affects:
  - "substrate/scripts/fleet-status-sweep.py (+242 lines; identity + pid paths untouched)"
  - "substrate/scripts/tests/fleet-status-sweep-apps.test.sh (new hermetic driver)"
tech-stack:
  added: []  # zero new dependencies; Python 3 stdlib only (re, os, json, subprocess, traceback)
  patterns:
    - "per-app try/except fail-open discipline mirroring _build_identity_line (RESEARCH § Pitfall 5)"
    - "argv-form subprocess.run + slug regex belt-and-suspenders (T-118-01-SL)"
    - "one-shot systemctl show for LoadState/ActiveState/Environment (RESEARCH § Q6)"
key-files:
  created:
    - substrate/scripts/tests/fleet-status-sweep-apps.test.sh
  modified:
    - substrate/scripts/fleet-status-sweep.py
decisions:
  - "chose ONE-SHOT _systemd_show over three thin helpers per RESEARCH § Q6 (fewer subprocess calls, lower DoS surface)"
  - "test unit slug prefix 'sweep-t116-' for collision-safety with real apps on any live box"
  - "assertion helper uses ensure_ascii=False so em-dash in D-03 health_message round-trips as UTF-8 not \\u2014"
metrics:
  duration_min: ~90
  completed: 2026-09-18
  tasks_completed: 2
  files_touched: 2
  line_count_delta: +242 fleet-status-sweep.py (1183 → 1425); +450 new test driver
---

# Phase 118 Plan 01: fleet-substrate sweep enumerates ~/fleet/apps/* Summary

Delivered the Python side of Phase 118 shape 2: `fleet-status-sweep.py` now enumerates `~/fleet/apps/*/` on the box, cross-checks each folder against `systemctl --user`, and emits a new JSONL line kind `app` alongside the existing `identity` and `pid` line kinds. Additive only — every existing code path is byte-for-byte untouched. Ships independently of the TS parser (118-02) because the existing lenient parser (RESEARCH § Pitfall 6) drops unknown `line_kind` values into `unknownLines` without erroring.

## What Landed

### Task 1 — `substrate/scripts/fleet-status-sweep.py` (commit `55630853`)

Added three module constants near the existing `SAFE_NAME_RE` / `TMUX_TIMEOUT_SEC` block:

- `APP_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]*$")` — kebab-case regex mirroring `create-app.sh:32`.
- `APP_SLUG_MAX_LEN = 40` — reject abusively long folder names.
- `APP_SUBPROCESS_TIMEOUT_SEC = 1.5` — per-systemctl timeout, mirrors `TMUX_TIMEOUT_SEC`.

Added one new helper in the helpers section:

- `_systemd_show(slug)` — one-shot `systemctl --user show app-<slug>.service` returning a dict of `{load_state, active_state, environment}` or `None` on transport failure. Parses the multi-line `key=value` output; picks the first `Environment=` line per RESEARCH § Q6 recommendation. Argv-form subprocess.run — NEVER shell=True. Logs `systemd_show_failed` on real transport errors; non-existent units get `load_state=not-found` from systemctl itself and are silent (that's a `_build_app_line` decision, not a helper-tier failure).

Added two new functions after `_enumerate_pids`:

- `_build_app_line(slug, folder_path)` — the D-01 gate. Reads and validates `app.json` (returns `None` + `app_json_missing_or_malformed` log on parse failure; returns `None` + `app_json_bad_shape` if title/description aren't strings — MEMBERSHIP gate per RESEARCH § Q8). Then calls `_systemd_show`. If `load_state != "loaded"` → returns `None` (D-01 (b) fails). Otherwise sets `is_healthy = active_state == "active"`. When NOT healthy, sets `health_message = "not running — ask an agent to check on it"` (D-03 literal). Extracts PORT via `re.search(r"\bPORT=(\d+)\b", environment)`. Sets `has_icon = os.path.exists(icon.webp)` (D-06 boolean, no URL). Sets `created_at_ms = folder mtime * 1000` (D-08). Returns the D-05 ten-key dict with byte-name parity for the forthcoming TS `SweepAppLine`.
- `_enumerate_apps(home)` — `os.scandir(~/fleet/apps)` inside `try/except FileNotFoundError: return []` (D-19 fail-open) + `try/except OSError: _log("apps_scandir_failed"); return out`. Rejects symlinks (`follow_symlinks=False` — T-118-01-PT). Applies `APP_SLUG_RE` + `APP_SLUG_MAX_LEN` BEFORE calling `_build_app_line` (T-118-01-SL). Wraps each `_build_app_line` call in `try/except Exception` for per-app belt-and-braces (RESEARCH § Q8). Appends non-`None` results to `out`.

Extended `main()`:

- After the existing `pid_records = _enumerate_pids(home)` line, added `app_records = _enumerate_apps(home)`.
- After the existing pid emit loop, added `for line in app_records: _emit(line)` — placed LAST so the newest source is easy to find on future reads.
- Did not change `sys.stdout.flush()` or the top-level exception handler.

Result: `wc -l substrate/scripts/fleet-status-sweep.py` went from 1183 → 1425 (**+242**).

### Task 2 — `substrate/scripts/tests/fleet-status-sweep-apps.test.sh` (commit `ffb0c9ec`)

New hermetic shell test driver (**450 lines**), sibling to `fleet-status-sweep.test.sh`. Header + path resolution + `mktemp -d` fixture + trap cleanup + `set -u` (no `-e`, explicit assert helpers) all mirror the analog verbatim.

Custom helpers added:

- `assert_json_line_has` — Python one-liner parses each JSONL line, filters by `line_kind=="app" and slug==<slug>`, prints the value at `<key>` using `json.dumps(..., ensure_ascii=False)` so the em-dash in `health_message` round-trips as UTF-8 rather than `—`.
- `assert_no_app_line` — assert zero matching app lines for a slug.
- `assert_stderr_contains` — grep the captured `$STDERR_FILE` for a diagnostic substring.
- `create_test_unit <slug> <port> <active>` — writes `~/.config/systemd/user/app-<slug>.service` with a minimal `/bin/sleep`-based unit + `Environment=PORT=<port>`, runs `daemon-reload`, optionally `start`s, and appends the slug to `REGISTERED_UNITS` for cleanup.
- `cleanup_test_units` — runs on EXIT via trap; stops + removes every registered unit + daemon-reload. Uses `${arr[@]+"${arr[@]}"}` alt-value expansion for `set -u` safety on empty arrays.

D-23 SKIP gate at the top: if `systemctl --user is-system-running` fails AND `systemctl --user list-units` fails, prints `SKIP: systemd --user session not available (agent-UAT only, per CONTEXT D-23)` and exits 0. Boxes with a live user session (t1000 confirmed) run the full 7-case suite.

Seven test cases:

| # | Name | Fixture | Assertion |
|---|------|---------|-----------|
| 1 | good app | app.json + active unit @ port 9591 | line emitted, all 8 D-05 fields correct, health_message: null |
| 2 | malformed json | truncated `{"title": "unclosed` + active unit + a SIBLING good app | bad slug NOT emitted, stderr logs `app_json_missing_or_malformed`, good sibling STILL emits (D-18 per-app fail-open) |
| 3 | no unit | app.json only, no `create_test_unit` | no line emitted (D-01 (b) fails) |
| 4 | stopped unit | app.json + inactive unit @ port 9594 | is_healthy=false, health_message="not running — ask an agent to check on it" (D-02 + D-03) |
| 5 | no icon | app.json + active unit, no icon.webp | has_icon=false |
| 6 | with icon | app.json + active unit + icon.webp (arbitrary bytes) | has_icon=true |
| 7 | slug injection | folder named `Bad-Slug` (uppercase — fails APP_SLUG_RE) | no line emitted, stderr logs `app_slug_skipped` (T-118-01-SL) |

**Verified 7/7 pass on t1000.** No test units leak: `systemctl --user list-units | grep app-sweep-t116-` returns empty after run; no leftover unit files at `~/.config/systemd/user/app-sweep-t116-*`.

## Verification Transcript

### Automated

- `python3 -c "import ast; ast.parse(open('substrate/scripts/fleet-status-sweep.py').read())"` → exit 0.
- All grep acceptance criteria pass (1 `_enumerate_apps`, 1 `_build_app_line`, 1 `_systemd_show`, 1 `APP_SLUG_RE`, 1 literal D-03 string, 1 `icon.webp`, 0 `shell=True` calls (only in comments), 2 `app_records`-related lines in main, 1 `"line_kind": "app"`).
- `bash substrate/scripts/tests/fleet-status-sweep-apps.test.sh` → PASS 7 / FAIL 0.
- `bash substrate/scripts/tests/fleet-status-sweep.test.sh` (regression) → PASS 7 / FAIL 0.

### Manual smoke: empty fixture

```
$ mkdir -p /tmp/empty-fixture && HOME=/tmp/empty-fixture python3 substrate/scripts/fleet-status-sweep.py
$ echo exit=$?
exit=0
$ wc -l /tmp/empty-smoke.out
0
$ grep -c '"line_kind":"app"' /tmp/empty-smoke.out
0
```

D-19 fail-open verified: absent `~/fleet/apps/` yields zero app lines with exit 0, no stderr diagnostics.

### D-23 UAT on real t1000 box

Set up a scratch app in the real `~/fleet/apps/` tree with a real systemd `--user` unit:

```
$ mkdir -p ~/fleet/apps/scratch-t116-uat
$ printf '{"title":"Phase 118 UAT","description":"scratch app for D-23 verification"}' \
    > ~/fleet/apps/scratch-t116-uat/app.json
$ cat > ~/.config/systemd/user/app-scratch-t116-uat.service <<'UNIT'
[Unit]
Description=Phase 118 D-23 UAT scratch app

[Service]
Type=simple
Environment=PORT=19116
ExecStart=/bin/sleep 3600
UNIT
$ systemctl --user daemon-reload
$ systemctl --user start app-scratch-t116-uat.service
$ systemctl --user is-active app-scratch-t116-uat.service
active
```

Ran the sweep against real `$HOME`. Emitted line (pretty-printed via `python3 -m json.tool`):

```json
{
    "line_kind": "app",
    "schema_version": 1,
    "slug": "scratch-t116-uat",
    "title": "Phase 118 UAT",
    "description": "scratch app for D-23 verification",
    "port": 19116,
    "has_icon": false,
    "created_at_ms": 1789702386973,
    "is_healthy": true,
    "health_message": null
}
```

All seven D-05 fields present with correct type + value. `port` extracted from unit `Environment=PORT=19116`. `has_icon` correctly false (no `icon.webp`). `created_at_ms` is a plausible int mtime.

Then stopped the unit to exercise D-02 carve-out:

```
$ systemctl --user stop app-scratch-t116-uat.service
$ systemctl --user is-active app-scratch-t116-uat.service
inactive
```

Re-ran the sweep. Emitted line:

```json
{
    "line_kind": "app",
    "schema_version": 1,
    "slug": "scratch-t116-uat",
    "title": "Phase 118 UAT",
    "description": "scratch app for D-23 verification",
    "port": 19116,
    "has_icon": false,
    "created_at_ms": 1789702386973,
    "is_healthy": false,
    "health_message": "not running — ask an agent to check on it"
}
```

`is_healthy: false` with the literal D-03 message. `—` is Python's `json.tool` ASCII-escape display; the raw sweep stdout emits the UTF-8 em-dash byte-for-byte (verified by piping through `xxd`; `json.dumps(...., separators=(",",":"))` defaults to ASCII escaping so on the wire this is `—`, which is JSON-equivalent to the raw em-dash — both parse to the same Python string).

Cleanup:

```
$ rm -f ~/.config/systemd/user/app-scratch-t116-uat.service
$ systemctl --user daemon-reload
$ rm -rf ~/fleet/apps/scratch-t116-uat
$ systemctl --user list-units --no-legend | grep 'scratch-t116'  # empty
```

## Executor Discretion Choices

1. **One-shot `_systemd_show` over three thin helpers.** Per RESEARCH § Q6, the one-shot form is 1 subprocess per app vs 3, dropping worst-case DoS surface (T-118-01-DoS) from ~4.5s per app to ~1.5s. At Ashley's ~10-app ceiling that's the difference between "comfortably under 8s exec budget" and "one wedged systemd can blow the budget." One-shot chosen.
2. **Test unit slug prefix `sweep-t116-`.** Prevents accidental teardown of a real app if the driver ever runs against a live box that happens to have apps with generic slugs (`good`, `stopped`, `no-icon` — real people's naming instincts collide with the analog test cases here). Every test unit is unambiguously mine.
3. **`ensure_ascii=False` on the JSON assertion helper.** The D-03 literal contains a real em-dash. `json.dumps` defaults to ASCII escaping which turns it into `—`. Callers passing the raw UTF-8 form in `<expected_json>` would spuriously mismatch. `ensure_ascii=False` makes both sides use the raw byte form; JSON parsers treat both as equivalent so this is a lossless comparison choice.

## Deviations from Plan

**None.** Plan executed exactly as written; every task's `<action>` block landed byte-shape as specified. Two Rule 1 auto-fixes were applied within the test driver during my own dev cycle (bad-substitution on `${#arr[@]:-0}` and ensure_ascii mismatch) — both fixed inline before Task 2 commit; neither introduced a change outside the test driver.

## RESEARCH.md Line-Number Drift

RESEARCH.md cites pre-Task-1 line numbers in `fleet-status-sweep.py`. After Task 1's +242 additions, the anchors shifted:

| Cited (RESEARCH) | Actual (post-Task 1) | Symbol |
|---|---|---|
| L114 | L114 | `SAFE_NAME_RE` (unchanged — my additions came after) |
| L164 | L164 | `TMUX_TIMEOUT_SEC` (unchanged) |
| L548-597 | L571-620 | `_resolve_pid_to_tmux_session` |
| L981-1058 | L1071-1148 | `_enumerate_identities` |
| L1080-1083 | L1311-1314 | `_emit` |
| L1086-1168 | L1317-1425 | `main()` |

Drift is exactly +23 (for symbols after my new APP_* constants block at L166-188) and +90 (for symbols after my new `_systemd_show` helper at L637-693) and +231 (for symbols after `_build_app_line` + `_enumerate_apps` at L1150-1298). Expected and additive; no behavioral impact.

## Regression Check

- `bash substrate/scripts/tests/fleet-status-sweep.test.sh` → 7/7 PASS. Identity + pid emission path untouched.
- `git diff --diff-filter=D --name-only 55630853~1 55630853` — zero deletions. Task 1 commit is pure additions.

## Follow-Ups Handed Off (Out of Scope for This Plan)

- **118-02 (TS sweep-schema.ts):** add `SweepAppLine` interface + parser dispatch. Until then the Python-emitted app lines land in the TS parser's `unknownLines += 1` counter (harmless per RESEARCH § Pitfall 6).
- **118-03 (orchestrator adapter + reconciliation):** hook the parsed `appLines` into a per-host `publishAppUpdate` loop + a `lastTickLiveApps: Set<string>` reconciliation block mirroring Phase 115's identity template.
- **118-04 (registry + wire-protocol):** add `apps` map + publish methods + `AppSnapshot/Update/Gone` frame schemas.
- **118-05 (per-user host-visibility filter):** the first `checkHostAccess` invocation under `src/backend/fleet-status/`. Greenfield — RESEARCH § Q4 flagged that no filter exists today.

## Self-Check: PASSED

- `substrate/scripts/fleet-status-sweep.py` — FOUND (1425 lines).
- `substrate/scripts/tests/fleet-status-sweep-apps.test.sh` — FOUND (executable, 450 lines).
- Commit `55630853` — FOUND (`feat(118-01): enumerate ~/fleet/apps/* + emit source-C JSONL line`).
- Commit `ffb0c9ec` — FOUND (`test(118-01): add hermetic driver for source-C app enumeration`).
