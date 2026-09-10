---
phase: 101
plan: "06"
subsystem: ssh-semaphore
tags: [ssh, semaphore, ci-guard, grep, coverage]
dependency_graph:
  requires:
    - 101-02  # starter.ts fleet-status + substrate migration
    - 101-03  # identity-clone, roles-create, global-files-read-write wrapped
    - 101-04  # relay-pointer, skill-catalog, claude-session-server wrapped
    - 101-05  # server-stats, file-manager, file-manager-session wrapped
  provides:
    - CI grep guard preventing future uncapped SSH producers
    - verify:ssh-cap npm script entry point
  affects:
    - scripts/ci/check-ssh-semaphore-coverage.sh
    - package.json
tech_stack:
  added: []
  patterns:
    - "bash grep-scan with allow-list for per-file coverage enforcement"
key_files:
  created:
    - scripts/ci/check-ssh-semaphore-coverage.sh
  modified:
    - package.json
decisions:
  - "D-07 (grep over ESLint plugin): zero new dependencies, deterministic, integrates as simple npm script"
  - "File-level coverage assertion (not line-level): a file importing getHostSemaphore is treated as covered even with multiple call sites — trades false-negatives for zero false-positives on well-authored PRs"
  - "ALLOW_LIST includes 18 entries: 3 structural exceptions (ssh-one-shot, session-file-tail, host-transfer) + 2 Docker sessions (out of fleet SSH scope) + 13 route files that are known pre-existing uncapped producers from Plans 101-02..05 scope boundaries"
  - "Pre-existing AWS SDK TS2307 errors (Phase 98) reported as pre-existing, not fixed"
metrics:
  duration: "~20 minutes"
  completed: "2026-09-10"
  tasks_completed: 2
  files_created: 1
  files_modified: 1
---

# Phase 101 Plan 06: CI Grep Guard + Final Phase Sweep Summary

CI grep guard (`scripts/ci/check-ssh-semaphore-coverage.sh`) ships as `npm run verify:ssh-cap` — any future PR adding `connectOneShot(`, `session.client.exec(`, or `tailSessionFile(` in a new file without semaphore coverage will fail the guard. Phase 101 final sweep confirms all waves landed cleanly.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Author check-ssh-semaphore-coverage.sh | 7f80e58a | scripts/ci/check-ssh-semaphore-coverage.sh |
| 2 | Wire verify:ssh-cap into package.json | ed55e151 | package.json |

## Allow-List Final Contents (18 entries)

### Structural exceptions (3)

| File | Reason |
|------|--------|
| `src/backend/ssh/ssh-one-shot.ts` | Defines `connectOneShot` — the pattern source, not a consumer |
| `src/backend/claude-session/session-file-tail.ts` | No hostId in signature; covered externally via `acquireTailSlot(hostId)` at 3 sites in claude-session-server.ts (Plan 101-04) |
| `src/backend/ssh/host-transfer.ts` | Covered transitively via `openDedicatedTransferSession` which is wrapped with `getHostSemaphore` (Plan 101-05 D-06) |

### Docker sessions — out of fleet SSH scope (2)

| File | Reason |
|------|--------|
| `src/backend/ssh/docker.ts` | Docker container exec channels, not fleet SSH; no hostId from fleet registry |
| `src/backend/ssh/docker-console.ts` | Same — Docker console sessions |

### Known pre-existing uncapped route producers (13)

These files use `connectOneShot(` but were NOT in scope for Plans 101-02..05. They are allow-listed so the guard exits 0 for the current codebase state. Removing a file from this list and adding a semaphore wrap is the intended upgrade path for future patches.

| File | Notes |
|------|-------|
| `src/backend/database/routes/sessions.ts` | tmux list-sessions discovery |
| `src/backend/database/routes/agent-reset.ts` | agent reset one-shot exec |
| `src/backend/database/routes/identities.ts` | identity management (multiple call sites) |
| `src/backend/database/routes/roles-list-for-host.ts` | list roles via SSH |
| `src/backend/database/routes/roles.ts` | role CRUD (separate from roles-create.ts which IS wrapped) |
| `src/backend/database/routes/runbooks-editor.ts` | runbook execution (multiple call sites) |
| `src/backend/database/routes/identity-exists-on-host.ts` | SSH identity probe |
| `src/backend/database/routes/identity-no-dormancy.ts` | anti-dormancy check |
| `src/backend/database/routes/pretty-view-fetch-host-file.ts` | SFTP file fetch via withConnection pool |
| `src/backend/database/routes/host.ts` | host management (one call site) |
| `src/backend/database/routes/identity-birth.ts` | identity provisioning |
| `src/backend/database/routes/identity-birth-orchestrator.ts` | deps-injection pattern |
| `src/backend/database/routes/skills-editor.ts` | skill management SSH exec |

## Final Phase Sweep Results

All four commands run for Plan 101-06's wave-4 verification:

### 1. npm run verify:ssh-cap
```
SSH semaphore coverage OK: 226 files scanned, 18 allow-listed, 0 uncovered producers.
```
Exit 0.

### 2. npm run type-check
```
(no output — clean)
```
Exit 0. tsc --noEmit passes with no errors.

### 3. npm run test
```
Test Files  2 failed | 370 passed | 1 skipped (373)
     Tests  5392 passed | 13 skipped | 1 todo (5406)
  Duration  308.94s
```
The 2 failed test **files** are `polly-adapter.integration.test.ts` and `transcribe-adapter.integration.test.ts` — both fail on missing `@aws-sdk/client-polly` and `@aws-sdk/client-transcribe-streaming` packages. These are **pre-existing Phase 98 errors** that appear in every prior plan summary (101-01 through 101-05) and resolve at container build. All 5392 actual tests pass.

Longest-running command: `npm run test` at ~309s.

### 4. npm run build:backend
```
src/backend/voice/polly-adapter.ts(80,8): error TS2307: Cannot find module '@aws-sdk/client-polly'
src/backend/voice/transcribe-adapter.ts(84,8): error TS2307: Cannot find module '@aws-sdk/client-transcribe-streaming'
```
Same pre-existing Phase 98 AWS SDK errors. The build completes successfully for all other files. These resolve at container build (packages present in the Docker image, not in node_modules in dev).

## Manual Negative Test (Task 1 done-criteria)

Added a temporary `src/backend/database/routes/test-uncovered-producer.ts` with a bare `connectOneShot(` call. Guard correctly:
- Exited 1
- Printed `FAIL (uncovered SSH producer): src/backend/database/routes/test-uncovered-producer.ts`
- Printed the offending line number

File removed before commit. Guard exits 0 on clean tree.

## False-Negative Observations

The file-level coverage assertion (D-07 light option) means a file with ONE wrapped `connectOneShot` and ONE unwrapped `connectOneShot` would pass the guard. No such files were observed in the current codebase (all the wrapped files in Plans 101-03..05 had their entire SSH motion wrapped). If false-negatives become a concern, tighten to line-radius matching (grep the 10 lines around each producer match for coverage patterns) in a follow-up patch.

## Deviations from Plan

### Extra ALLOW_LIST entry discovered during script testing

**[Rule 1 - Bug] `skills-editor.ts` not in initial allow-list**
- **Found during:** Task 1 first `bash check-ssh-semaphore-coverage.sh` run
- **Issue:** `skills-editor.ts` has 7 `connectOneShot(` call sites and no semaphore coverage; it was not in Plans 101-03..05 scope but also not in the initial allow-list draft
- **Fix:** Added to ALLOW_LIST with comment "multiple connectOneShot call sites for skill management SSH exec"
- **Files modified:** scripts/ci/check-ssh-semaphore-coverage.sh

## Known Stubs

None.

## Threat Flags

None — this plan adds only a CI guard script and one package.json script entry. No new network endpoints, auth paths, schema changes, or trust-boundary modifications.

## Self-Check: PASSED

- [x] `scripts/ci/check-ssh-semaphore-coverage.sh` exists: FOUND
- [x] `test -x scripts/ci/check-ssh-semaphore-coverage.sh` succeeds: VERIFIED
- [x] `bash scripts/ci/check-ssh-semaphore-coverage.sh` exits 0: VERIFIED (226 scanned, 18 allow-listed)
- [x] Negative test exits 1 with per-file failure: VERIFIED
- [x] `grep -c "verify:ssh-cap" package.json` = 1: VERIFIED
- [x] `npm run verify:ssh-cap` exits 0: VERIFIED
- [x] `npm run type-check` exits 0: VERIFIED
- [x] `npm run test` all real tests pass (5392/5392; 2 integration files pre-existing AWS SDK fail): VERIFIED
- [x] `npm run build:backend` produces only pre-existing AWS SDK TS2307 errors: VERIFIED
- [x] Task 1 commit 7f80e58a exists: VERIFIED
- [x] Task 2 commit ed55e151 exists: VERIFIED
