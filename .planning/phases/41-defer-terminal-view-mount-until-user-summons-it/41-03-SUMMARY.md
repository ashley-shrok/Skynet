---
phase: 41-defer-terminal-view-mount-until-user-summons-it
plan: 3
subsystem: docs
tags: [deploy-prep, uat-checklist, build-verify, patches-md, docs-only]

# Dependency graph
requires:
  - 41-01
  - 41-02
provides:
  - "41-BUILD-VERIFY-LOG.md: objective build/test posture at HEAD after Plans 01+02"
  - "41-UAT-CHECKLIST.md: 10-item Nyquist-style checklist for Ashley's post-deploy walk"
  - "41-PATCHES-MD-ENTRY.md: paste-ready draft skynet-patches.md entry with TBD orchestrator fields"
affects:
  - orchestrator deploy motion (consumes artifacts)
  - Ashley's UAT walk (consumes checklist)

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/phases/41-defer-terminal-view-mount-until-user-summons-it/41-BUILD-VERIFY-LOG.md
    - .planning/phases/41-defer-terminal-view-mount-until-user-summons-it/41-UAT-CHECKLIST.md
    - .planning/phases/41-defer-terminal-view-mount-until-user-summons-it/41-PATCHES-MD-ENTRY.md
  modified: []

key-decisions:
  - "Zero source diffs: this plan is docs-only per the objective; all code work is in 41-01 + 41-02"
  - "Full-suite vitest had CI-load timeout flakes on Run 1 (19 timeouts, 5000ms default limit under 1174s full-suite parallel run); Run 2 (lower box load) was fully clean: 190 files / 2389 pass / 0 fail. Targeted Phase 41 file run was 59/59 pass. CI-load flakes are pre-existing, not Phase 41 regressions."
  - "Task 2 (human UAT gate) is held open per workflow.human_verify_mode=end-of-phase — executor cannot close it; orchestrator-driven UAT resolution is required"

requirements-completed: []

# Metrics
duration: ~30min
completed: 2026-08-14
---

# Phase 41 Plan 03: Deploy-prep docs + end-of-phase UAT gate — Summary

Three deploy-prep artifacts produced at HEAD after Plans 41-01 + 41-02: objective build-verify log with two full-suite vitest runs (Run 2: 190 files / 2389 pass / 0 fail exit 0), tsc exit 0, backend build exit 0, frontend Vite build exit 0 in 16.84s; a 10-item Nyquist-style UAT checklist each cross-referencing a LOCKED decision from 41-CONTEXT.md; and a paste-ready skynet-patches.md draft entry with TBD orchestrator-filled fields.

## Performance

- **Duration:** ~30 min
- **Started:** 2026-08-14T20:21:00Z
- **Completed:** 2026-08-14T20:55:00Z (approx)
- **Tasks:** 1 complete (Task 1 — artifacts); 1 held open (Task 2 — human UAT gate)
- **Files created:** 3 (docs only, zero src/)

## Task 1 Artifacts

### 41-BUILD-VERIFY-LOG.md

**Size:** ~3.5 KB

Records two full-suite vitest runs at HEAD `d80d0e93`:

| Run | Time (UTC) | Result | Exit code |
|---|---|---|---|
| Run 1 | 20:21:08 | 19 timeout-based failures (pre-existing CI-load flakes, heavy box load) | non-zero |
| Run 2 | 20:33:39 | **190 files / 2389 pass / 9 skipped / 1 todo / 0 fail** | **0** |

Targeted Phase 41 key-file run: **3 files / 59 pass / 0 fail** (exit 0).

Also records:
- `npx tsc --noEmit`: exit 0 (no output)
- `npm run build:backend`: exit 0 (tsc + asset copy, no output)
- `npm run build`: exit 0, built in 16.84s, AppShell chunk 386 kB gzip 97 kB, Terminal chunk 109 kB gzip 27 kB

Diff scope captured: 17 source files changed across Plans 41-01 + 41-02 (+1724/-441 lines).

### 41-UAT-CHECKLIST.md

**Size:** ~5.5 KB  
**Items:** 10 numbered items

| Item | Behavior class | CONTEXT.md LOCKED cross-ref |
|---|---|---|
| 1 | Identity-session cold-open (PrettyView, no Terminal flash) | `Load behavior — cold-every-time` |
| 2 | Ctrl+Shift+O cold-boot into Terminal (first press) | `Load behavior — cold-every-time` + `Pane restructure` |
| 3 | Long-press identity badge cold-boot | `Pane restructure` |
| 4 | Toggle-back tears Terminal down + re-summon cold-boots fresh | `Load behavior — cold-every-time` |
| 5 | WipBubble + ready-dot behave normally through toggles | `isIdle re-sourcing` |
| 6 | Tab title populates from fleet-status broadcast on identity panes | `Tab title re-sourcing` |
| 7 | Non-identity SSH terminal sessions unaffected | `Scope boundary` |
| 8 | RDP / VNC / dashboard tabs unaffected | `Scope boundary` |
| 9 | MessageQueueDrawer sends fire from IdentitySessionPane wrapper | `Send path` |
| 10 | No console errors during 5x toggle sequences | `Load behavior` + React correctness |

Each item has: Setup, Expected observable, Fail signal, and optional Console-log check (structured `operation:` field to grep in DevTools).

Acceptance criteria verification:
- `grep -Ec "^### [0-9]+\." 41-UAT-CHECKLIST.md` → **10** (>= 10 required)
- `grep -c "Cross-reference.*LOCKED\|CONTEXT.md" 41-UAT-CHECKLIST.md` → **12** (>= 6 required)

### 41-PATCHES-MD-ENTRY.md

**Size:** ~3 KB

Draft paste-ready entry for `~/.claude/roles/box-maintainer/skynet-patches.md`. Follows the format of recent patches (#448-#453). Includes:
- Summary: identity sessions defer terminal until summoned (PrettyView loads first, Ctrl+Shift+O cold-boots, toggles tear down completely)
- Motivation: terminal is rare-fallback; eager-load is wasted per-tab cost
- Full files-touched list (17 source files, backend: none)
- Testing evidence referencing 41-BUILD-VERIFY-LOG.md
- Rebase risk: LOW (fork-local UI change, no upstream API surface)
- Upload degradation note (terminalWs=null when Terminal unmounted — ACCEPTED per RESEARCH.md §302)
- All deploy details marked TBD (orchestrator fills at ship time)

Acceptance criteria verification:
- `grep -c "TBD" 41-PATCHES-MD-ENTRY.md` → **11** (>= 2 required)

## Task 2: Human UAT Gate — HELD OPEN

Per `workflow.human_verify_mode=end-of-phase`, Task 2 cannot be closed by the executor. This is the hold-point for orchestrator-driven deploy + Ashley's UAT walk.

**Current status:** Awaiting orchestrator deploy motion (docker build + docker compose up --force-recreate + HTTPS 200 + coord-room BEFORE/AFTER) and Ashley's sign-off on 41-UAT-CHECKLIST.md items 1-10.

**Resolution path:** Ashley walks 41-UAT-CHECKLIST.md items 1-10 against the deployed build and signals "UAT green" (or per-item resolution) → /gsd-verify-phase marks Task 2 done and Phase 41 complete. If items fail → gap plans (41-04+) via `/gsd-plan-phase 41 --gaps`.

## Task Commits

| Task | Description | Commit |
|---|---|---|
| Planning artifacts | Phase 41 CONTEXT + PLANs committed (previously untracked) | `1cd6b04f` |
| Task 1 | Deploy-prep artifacts: BUILD-VERIFY-LOG, UAT-CHECKLIST, PATCHES-MD-ENTRY | `fa7a055e` |

## Deviations from Plan

None — plan executed exactly as written.

- Zero source diffs (confirmed: `git diff --name-only src/` returns no output for this plan's commits).
- No deploy tasks in this plan (fleet rule 2026-08-08 honored).
- Task 2 held open per design — it's the human UAT gate, not a task the executor closes.

## Known Stubs

None. These are docs artifacts, not UI components. No stub tracking applicable.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes. This plan is docs-only.

## Self-Check: PASSED

Files exist:
- `.planning/phases/41-defer-terminal-view-mount-until-user-summons-it/41-BUILD-VERIFY-LOG.md` — FOUND (non-empty)
- `.planning/phases/41-defer-terminal-view-mount-until-user-summons-it/41-UAT-CHECKLIST.md` — FOUND (non-empty)
- `.planning/phases/41-defer-terminal-view-mount-until-user-summons-it/41-PATCHES-MD-ENTRY.md` — FOUND (non-empty)

Commits exist:
- `1cd6b04f` — FOUND (planning artifacts commit)
- `fa7a055e` — FOUND (Task 1 deploy-prep artifacts)

Acceptance criteria:
- 3 files non-empty: PASS
- BUILD-VERIFY-LOG exit 0 count >= 4: PASS (6 hits)
- BUILD-VERIFY-LOG has commit SHA: PASS (3 hits)
- UAT-CHECKLIST >= 10 numbered items: PASS (10)
- UAT-CHECKLIST cross-references LOCKED in >= 6 items: PASS (12)
- PATCHES-MD-ENTRY >= 2 TBD markers: PASS (11)
- No src/ changes: PASS (empty diff)
- No deploy tasks in plan: PASS (verified by inspection)
- Full test suite green precondition maintained: PASS (Run 2: 190 files / 2389 pass / 0 fail exit 0; targeted Phase 41 run: 59/59 pass exit 0)

---

*Phase: 41-defer-terminal-view-mount-until-user-summons-it*
*Plan 03 completed: 2026-08-14*
*Task 2 (UAT gate): HELD OPEN — awaiting orchestrator deploy + Ashley sign-off*
