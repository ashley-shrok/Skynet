---
phase: 127-wake-ups-redesign-phase-1-global-on-disk-specs-global-scope-
plan: 03
subsystem: fleet-substrate
tags: [wake-ups, scheduler, agent-supervisor, ambient-monitor, per-role-sunset]
dependency_graph:
  requires: [127-01, 127-02]
  provides: [global-scheduler-spawn, per-role-sunset]
  affects: [substrate/scripts/agent-supervisor.sh, substrate/scripts/ambient-monitor.py]
tech_stack:
  added: []
  patterns: [setsid+nohup+disown, unconditional-child-spawn]
key_files:
  created: []
  modified:
    - substrate/scripts/agent-supervisor.sh
    - substrate/scripts/ambient-monitor.py
decisions:
  - D-09: Global scheduler spawned once at supervisor startup, session-independent, setsid+nohup+disown pattern
  - D-16(a): Per-role wakeup-scheduler-role spawn removed from ambient-monitor.py; role-file-watch now unconditional for all identities
metrics:
  duration: ~8 minutes
  completed: 2026-09-21
  tasks_completed: 2
  files_modified: 2
---

# Phase 127 Plan 03: Agent-Supervisor Global-Scheduler Spawn + Ambient-Monitor Per-Role Removal Summary

**One-liner:** Wired the global wake-up scheduler into every managed host's boot sequence (D-09) and removed the IS_COORDINATOR-gated per-role scheduler-spawn from ambient-monitor.py (D-16(a)).

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Insert global-scheduler spawn block in agent-supervisor.sh | 992f0595 | substrate/scripts/agent-supervisor.sh |
| 2 | Remove per-role wakeup-scheduler spawn from ambient-monitor.py | 8b138439 | substrate/scripts/ambient-monitor.py |

---

## Exact Changes

### substrate/scripts/agent-supervisor.sh

**Lines added:** 13 lines inserted after `resolve_memory_wrapper`, before the `case` block at line ~2377.

Insertion:
```bash
# Phase 127: global wake-up scheduler — session-independent, one per host, spawned once at supervisor startup (D-09). Reads specs from $HOME/fleet/wakeups/<slug>/wakeup.json (D-01, D-08); self-guards via _single_instance in the scheduler.
GLOBAL_WAKEUPS_DIR="$HOME/fleet/wakeups"
GLOBAL_WAKEUPS_LOG="$GLOBAL_WAKEUPS_DIR/global-scheduler.log"
mkdir -p "$GLOBAL_WAKEUPS_DIR/.state"
if [ -x "$HOME/.local/bin/wakeup-scheduler" ]; then
  setsid nohup python3 "$HOME/.local/bin/wakeup-scheduler" "$GLOBAL_WAKEUPS_DIR" --mode global \
    > "$GLOBAL_WAKEUPS_LOG" 2>&1 < /dev/null & disown
  log "global wake-up scheduler started (dir=$GLOBAL_WAKEUPS_DIR, log=$GLOBAL_WAKEUPS_LOG)"
else
  log "WARNING: global wake-up scheduler NOT started — $HOME/.local/bin/wakeup-scheduler missing"
fi
```

### substrate/scripts/ambient-monitor.py

**Lines removed:** 37 lines (the entire IS_COORDINATOR block at lines 326-362, including the coordinator comment header, role_folder resolution, wakeup-scheduler-role append, and else/role-file-watch branch).

**Lines added:** 8 lines (Phase 127 traceability comment + single unconditional role-file-watch CHILDREN.append).

Replacement:
```python
# Phase 127: per-role wakeup-scheduler spawn removed — global scheduler in agent-supervisor.sh handles role-general wake-ups at host scope (D-16(a)). role-file-watch runs for BOTH coordinators and actors now.
CHILDREN.append({
    "name": "role-file-watch",
    "cmd": ["python3", str(HOME / ".local/bin/role-file-watch"), str(IDENTITY_DIR)],
    "env_extra": {},
    "critical": False,
})
```

---

## IS_COORDINATOR Pre-Edit Inventory

**Confirmed exactly 3 sites (matches expected):**

| Line | Usage |
|------|-------|
| 285 | `ROLE_NAME, IS_COORDINATOR = _read_frontmatter(IDENTITY_FILE)` — assignment |
| 326 | `if IS_COORDINATOR:` — the branch removed by this plan (target) |
| 776 | `% (len(CHILDREN), IDENTITY_NAME, ROLE_NAME, IS_COORDINATOR, ...` — startup log (preserved) |

No additional IS_COORDINATOR sites found. No discrepancy from plan. IS_COORDINATOR remains defined (assignment at line 285) and still used (startup log at line 746 post-change, shifted from 776 due to the 30-line removal). Safe.

---

## Dangling ROLE_NAME References

`ROLE_NAME` is still referenced at:
- Line 285: assigned by `_read_frontmatter(IDENTITY_FILE)`
- Line 746: used in the startup log `emit_diag("starting %d child(ren) for identity %s (role=%s, ...")`

The removed block also referenced `ROLE_NAME` to resolve the role folder path (lines 336-338). After removal, `ROLE_NAME` is still consumed by the startup log — it is NOT orphaned. No cleanup needed or deferred.

---

## Verification Results

| Check | Result |
|-------|--------|
| `bash -n substrate/scripts/agent-supervisor.sh` | PASS (exit 0) |
| `python3 -c "import ast; ast.parse(...ambient-monitor.py...)"` | PASS (exit 0) |
| `grep -c '"wakeup-scheduler-role"' ambient-monitor.py` | 0 (PASS) |
| `grep -c '"role-file-watch"' ambient-monitor.py` | 1 (PASS) |
| `grep -c -- '--mode global' agent-supervisor.sh` | 1 (PASS) |
| `grep -c 'GLOBAL_WAKEUPS_DIR=' agent-supervisor.sh` | 1 (PASS) |
| `grep -c 'global-scheduler.log' agent-supervisor.sh` | 1 (PASS) |
| `grep -qE 'setsid...nohup...python3.*wakeup-scheduler.*--mode global'` | PASS |
| `grep -c 'mkdir -p "\$GLOBAL_WAKEUPS_DIR/.state"' agent-supervisor.sh` | 1 (PASS) |
| `grep -c 'global wake-up scheduler started\|NOT started' agent-supervisor.sh` | 2 (PASS) |
| `grep -c 'Phase 127' agent-supervisor.sh` | 1 (PASS) |
| `grep -c 'Phase 127' ambient-monitor.py` | 1 (PASS) |
| `grep -c 'IS_COORDINATOR' ambient-monitor.py` | 2 (PASS) |
| `grep -c '"wakeup-scheduler"' ambient-monitor.py` | 1 (per-identity spawn preserved) |
| `AGENT_SUPERVISOR_LIB_ONLY=1 bash -c 'source ...; echo lib-only-ok'` | prints `lib-only-ok` only (PASS) |

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what the plan's threat model already covered. Authority profile unchanged (fleet-user context).

---

## Orchestrator Reminder

**Distributor push + `systemctl --user restart agent-supervisor.service` is required for the changes to take effect on managed hosts.**

- `agent-supervisor.sh` byte change triggers `agent-supervisor.service` restart via the existing `restartHook` in `catalog.ts`. The global scheduler comes online immediately after that restart.
- `ambient-monitor.py` byte change takes effect on the next identity harness launch for each identity (no restart hook — by design, per RESEARCH §7 to avoid orphaning live sessions).
- Both changes land in the same distributor push, achieving the hard cutover described in D-17.

This is orchestrator scope, not executor scope.

---

## Self-Check: PASSED

- `substrate/scripts/agent-supervisor.sh` modified and syntax-checked
- `substrate/scripts/ambient-monitor.py` modified and AST-parsed
- Commit 992f0595 exists (Task 1)
- Commit 8b138439 exists (Task 2)
- All source assertions confirmed by grep
