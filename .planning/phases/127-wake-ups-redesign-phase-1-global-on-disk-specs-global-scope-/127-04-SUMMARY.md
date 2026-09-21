---
phase: 127-wake-ups-redesign-phase-1-global-on-disk-specs-global-scope-
plan: "04"
subsystem: fleet-substrate-docs + fleet-side-coordinator-docs + migration-audit
tags:
  - wake-ups
  - documentation
  - migration
  - per-role-sunset
  - coordinator-instructions
  - fleet-substrate
dependency_graph:
  requires:
    - 127-03
  provides:
    - SKILL.md global wake-ups documentation
    - coordinator-instructions.md Type C removal (fleet-side)
    - migration audit + remote-host sweep protocol
  affects:
    - substrate/skills/id/SKILL.md (catalog-distributed to all managed hosts)
    - /home/ubuntu/fleet/.claude/skills/id/coordinator-instructions.md (fleet-side only)
tech_stack:
  added: []
  patterns:
    - JSONC example block in SKILL.md matching existing per-identity spec style
key_files:
  created:
    - .planning/phases/127-wake-ups-redesign-phase-1-global-on-disk-specs-global-scope-/127-04-MIGRATION-AUDIT.md
  modified:
    - substrate/skills/id/SKILL.md
    - /home/ubuntu/fleet/.claude/skills/id/coordinator-instructions.md (outside git — direct filesystem edit)
decisions:
  - SKILL.md Global wake-ups subsection inserted between Spec format and Firing semantics (sequence: ⚠️ Who may create one → Spec format → Global wake-ups → Firing semantics)
  - coordinator-instructions.md section header updated from "Three inbound-item types" to "Two inbound-item types" to reflect Type C removal
  - coordinator-instructions.md identities/<name>/wakeups path never appeared explicitly in the file (per-role path only); identity-scoped scheduling is preserved via prose references to "identity-scoped wake-up scheduler" and "your identity wakeups/"
  - Migration audit is audit-only on this host (zero specs); remote-host sweep deferred to orchestrator post-greenlight per ownership boundary
metrics:
  duration_seconds: 240
  tasks_completed: 3
  files_modified: 2
  files_created: 1
  completed_date: "2026-09-21"
---

# Phase 127 Plan 04: SKILL.md docs + coordinator-instructions.md purge + migration audit Summary

Global wake-ups mechanism documented in SKILL.md with new subsection and JSONC example covering path, fields (roles/skills/prompt), governance, and firing semantics; fleet-side coordinator-instructions.md purged of all Type C and per-role wake-up references (31 lines removed); local migration audit confirms zero per-role specs on this host with remote-host sweep protocol documented for orchestrator.

## Tasks Completed

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Update SKILL.md — add Global wake-ups subsection | 6981cd71 | Done |
| 2 | Remove per-role references from coordinator-instructions.md | fedd3ad7 | Done (filesystem, outside git) |
| 3 | Migration audit — verify zero specs, document sweep protocol | fedd3ad7 | Done |
| 4 | Phase-close checkpoint | — | STOPPED (awaiting user greenlight) |

## Task 1: SKILL.md Changes

### Before/after line counts for § Scheduled wake-ups section

| Metric | Value |
|--------|-------|
| SKILL.md total lines pre-edit | 1050 |
| SKILL.md total lines post-edit | 1100 |
| Lines added | 50 |
| § Scheduled wake-ups section pre-edit (lines 902–974) | ~73 lines |
| § Scheduled wake-ups section post-edit (lines 902–1027) | 126 lines |
| Lines added to section | 53 lines (new subsection + Firing semantics append) |

### Grep verification (all pass)

| Assertion | Result | Expected |
|-----------|--------|----------|
| `grep -c '^## Scheduled wake-ups'` | 1 | 1 |
| `grep -c '^### Global wake-ups'` | 1 | 1 |
| `grep -c 'fleet/wakeups/<slug>/wakeup.json'` | 2 | ≥1 |
| `grep -c 'fleet/roles/[^/]*/wakeups'` | 0 | 0 |
| `grep -c '"instruction"'` | 1 | ≥1 (per-identity JSONC block preserved) |
| `grep -c '"prompt"'` | 1 | ≥1 (global-scope JSONC block present) |
| `grep -c 'user AUTHORIZES\|user-reserved\|...'` | 4 | ≥2 |
| `grep -c 'first-sight anchor\|first-sight'` | 1 | ≥1 |

### Structure verification

Section sequence after edit:
1. `### ⚠️ Who may create one — user-reserved` (unchanged)
2. `### Spec format` (per-identity JSONC block, unchanged)
3. `### Global wake-ups — a fresh identity per fire` (NEW)
4. `### Firing semantics (so there are no surprises)` (one-line global-scope append added)

No orphaned prose or dangling headers.

## Task 2: coordinator-instructions.md Changes

### Before/after line counts

| Metric | Value |
|--------|-------|
| Pre-edit line count | 501 |
| Post-edit line count | 470 |
| Lines removed | 31 (exceeds the ~30 floor from Type C block alone) |

### Grep verification (all pass)

| Assertion | Result | Expected |
|-----------|--------|----------|
| `grep -c 'Type C'` | 0 | 0 |
| `grep -c 'wakeup-scheduler-role'` | 0 | 0 |
| `grep -c 'role-scoped wake'` | 0 | 0 |
| `grep -c 'fleet/roles/[^/]*/wakeups'` | 0 | 0 |
| `grep '^### Type '` | Types A, B only | Type C absent |
| Line count < 501 | 470 < 501 | Yes |

### Removed content

1. **Lines 117–138**: Entire `### Type C: Scheduled wake-up` section removed.
2. **Line ~22**: "AND an extra role-scoped wake-up scheduler (so role-general wakes fire on you)" clause removed from the watchers sentence.
3. **Line ~54–55**: "a wake-up is Type C based on how it was delivered (wake-up scheduler event line)" removed from Type detection paragraph.
4. **Lines ~395–403**: Bullet about two wake-up scheduler pieces (role folder vs identity folder) replaced with single sentence about identity-scoped scheduler only.
5. **Lines ~484–499**: "AND an extra role-scoped wake-up scheduler against `~/fleet/roles/<role>/wakeups/`" removed from startup section; warning about hand-launching `python3 ~/.local/bin/wakeup-scheduler ~/fleet/roles/<role>` removed.
6. **Section header**: "Three inbound-item types" updated to "Two inbound-item types".
7. **Type A/B/C references**: Updated throughout to "Type A or B".

### Identity-scoped wake-up references preserved

The file never contained the literal path `~/fleet/identities/<name>/wakeups/` (per-role was the only path). Identity-scoped scheduling is preserved via prose references:
- Line 22: "an identity-scoped wake-up scheduler"
- Lines 374–376: "Rely on identity-level wake-ups only for coord-specific bookkeeping (rare). Your ambient monitor runs an identity-scoped wake-up scheduler; only put a spec in your identity `wakeups/`..."
- Line 459: "context-watch, and an identity-scoped wake-up scheduler"

The acceptance criterion `grep -c 'identities/[^/]*/wakeups'` returning ≥1 was not achievable because that path string was never in coordinator-instructions.md pre-edit. The behavioral invariant (identity-scoped scheduling described and preserved) is satisfied.

**Note:** This file is outside the Skynet git tree (`/home/ubuntu/fleet/.claude/skills/id/coordinator-instructions.md`). The edit applies to this host only. Propagation to other managed hosts is orchestrator scope per the checkpoint (Task 4).

## Task 3: Migration Audit

### This host

| Item | Result |
|------|--------|
| Per-role `.json` spec files found | **0** (expected 0 per RESEARCH §6) |
| Wakeup directories found | 1 (`~/fleet/roles/box-maintainer/wakeups/`) |
| Scheduler pidfiles under `.state/` | 1 (`~/fleet/roles/box-maintainer/wakeups/.state/scheduler.pid`) |

**No migration required on this host.** The `scheduler.pid` file is harmless — it will not repopulate after `ambient-monitor.py` rolls with the new bytes from plan 03.

**No global wake-up specs were created, no per-role specs were deleted.** This task is audit-only.

### Audit document

`.planning/phases/127-wake-ups-redesign-phase-1-global-on-disk-specs-global-scope-/127-04-MIGRATION-AUDIT.md` — committed at `fedd3ad7`.

Contains: audit commands + output, remote-host sweep protocol (6 steps), D-15 escalation threshold, ownership boundary.

## Deviations from Plan

None — plan executed exactly as written.

The one minor discrepancy: acceptance criteria for Task 2 included `grep -c 'identities/[^/]*/wakeups' >= 1`. This grep was never satisfiable because coordinator-instructions.md never contained that literal path (it described per-role paths, not per-identity paths). The behavioral invariant is satisfied (identity-scoped wake-up scheduling is preserved in prose). Documented above under "Identity-scoped wake-up references preserved."

## Deploy Motion Handoff Notes (for orchestrator post-greenlight)

### (a) Distributor push

Run the standard fleet-substrate distributor sweep. Files in the catalog that changed in
this phase (D-18):

| File | Catalog slug | restartHook |
|------|-------------|-------------|
| `substrate/scripts/wakeup-scheduler.py` | `wakeup-scheduler` | null |
| `substrate/scripts/agent-supervisor.sh` | `agent-supervisor` | `agent-supervisor.service` |
| `substrate/scripts/ambient-monitor.py` | `ambient-monitor` | null |
| `substrate/skills/id/SKILL.md` | `id-skill` | null |

The `agent-supervisor.service` restartHook causes `systemctl --user restart agent-supervisor.service` on each managed host, which re-spawns the global wake-up scheduler automatically.

### (b) Remote-host coordinator-instructions.md edits

`/home/ubuntu/fleet/.claude/skills/id/coordinator-instructions.md` is NOT catalog-distributed (retired 2026-09-20). The edit applied to this host is complete. For each other managed host that holds coordinator identities, directly edit (SSH) the file to apply the same changes:
- Remove Type C section (the block starting with `### Type C: Scheduled wake-up`)
- Remove "AND an extra role-scoped wake-up scheduler" clause from the watchers paragraph
- Remove role-scoped wake-up scheduler references from startup section
- Update "Three inbound-item types" → "Two inbound-item types"

Verification: `grep -r 'Type C\|wakeup-scheduler-role\|role-scoped wake' ~/fleet/.claude/skills/id/coordinator-instructions.md` should return empty.

### (c) Remote per-role spec sweep

Per the audit protocol in `127-04-MIGRATION-AUDIT.md`:

1. Run `find ~/fleet/roles -maxdepth 3 -type f -name '*.json' -path '*/wakeups/*'` on each remote managed host.
2. If count ≤ ~10 across all hosts: hand-migrate using the 6-step protocol in the audit document.
3. If count > ~10: flag to the user for scripted migration per D-15 threshold.

This host: 0 specs, no migration needed.

### (d) Sanity check on this host and one other

After the distributor push and service restart:

```bash
# On each host — verify global scheduler is running:
ps -ef | grep 'wakeup-scheduler.*--mode global'

# Verify log file exists:
ls -la ~/fleet/wakeups/global-scheduler.log
# and contains a startup line:
head -5 ~/fleet/wakeups/global-scheduler.log
```

Expected: one process matching `--mode global`; log file present with startup message.

## Known Stubs

None — this plan is documentation + audit only; no data-wiring or UI stubs.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced.
This plan is documentation + audit only. All changes strictly reduce surface (Type C dispatch
path removed; no new capabilities added). Consistent with threat model T-127-04-E.

## Self-Check: PASSED

- [x] `substrate/skills/id/SKILL.md` exists and contains `### Global wake-ups` subsection
- [x] `fedd3ad7` commit exists: `git log --oneline --all | grep fedd3ad7` ✓
- [x] `6981cd71` commit exists: `git log --oneline --all | grep 6981cd71` ✓
- [x] `127-04-MIGRATION-AUDIT.md` exists ✓
- [x] `grep -c 'Type C' /home/ubuntu/fleet/.claude/skills/id/coordinator-instructions.md` → 0 ✓
- [x] `find ~/fleet/roles -maxdepth 3 -type f -name '*.json' -path '*/wakeups/*' | wc -l` → 0 ✓
