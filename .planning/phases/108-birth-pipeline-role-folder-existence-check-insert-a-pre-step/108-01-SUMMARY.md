---
phase: 108-birth-pipeline-role-folder-existence-check
plan: 01
subsystem: backend/spawn-requests
tags: [birth-pipeline, role-folder, step-1-probe, fail-fast, phase-108]
dependency_graph:
  requires:
    - Phase 22 SRIC-01 (getLocalRolesRoot export at identity-artifact-reader.ts:238)
    - Phase 22 Step 2.5 role-name validation (ROLE_NAME_PATTERN upstream gate)
    - Phase 68 SHAPE B (Step 1 runStep, on-disk collision probe primitive)
    - Phase 99 (worker.ts mapEndedEventToReason + FailureReason enum)
  provides:
    - Fail-fast role-folder probe inside runStep(1, ...) — remote + local branches
    - Test coverage (5 orchestrator + 1 worker processBirth) for the role-miss failure surface
    - Correct forensic trail from worker.ts:94 to the orchestrator Step 1 landing site
  affects:
    - src/backend/database/routes/identity-birth-orchestrator.ts (probe insertion + docstring)
    - src/backend/database/routes/identity-birth-orchestrator.test.ts (fs.access mock, exec mock defaults, 5 new tests)
    - src/backend/spawn-requests/worker.ts (stale comment fix at line 94)
    - src/backend/spawn-requests/worker.test.ts (Test 108-W1 processBirth integration)
tech-stack:
  added: []
  patterns:
    - "validate-then-interpolate for opts.role in remote probe shell string"
    - "reuse of runStep(N, ...) catch → step:N:failed + ended{ok:false, failedStep:N} emit machinery"
    - "LOCAL branch fs.access on getLocalRolesRoot() to avoid $HOME expansion mismatch"
key-files:
  created:
    - .planning/phases/108-birth-pipeline-role-folder-existence-check-insert-a-pre-step/108-01-SUMMARY.md
  modified:
    - src/backend/database/routes/identity-birth-orchestrator.ts
    - src/backend/database/routes/identity-birth-orchestrator.test.ts
    - src/backend/spawn-requests/worker.ts
    - src/backend/spawn-requests/worker.test.ts
decisions:
  - "Reused getLocalRolesRoot at identity-artifact-reader.ts:238 (D-04 planner-check clause) instead of path.join(getLocalIdentitiesRoot(), '..', 'roles') fallback"
  - "Named test suite 'Phase 108: role-folder existence probe (D-13 A-E)' with beforeEach fs.access reset for isolation from prior tests' mockImplementations"
  - "Updated all 21 existing mockExecCommand.mockImplementation blocks in orchestrator tests to default fleet/roles/ probe cmd to 'exists' (baseline happy path) — least-invasive alternative to updating each test individually"
  - "Reached through node:fs/promises default export in tests (mockFsDefault.access) because orchestrator uses default import — named export is a separate vi.fn()"
metrics:
  duration: ~15 minutes
  completed: 2026-09-12
  tests_added: 6 (5 orchestrator + 1 worker)
  d15_scoped_result: "3 files, 104/104 tests pass"
---

# Phase 108 Plan 01: birth-pipeline role-folder existence check Summary

Inserted a target-host role-folder existence probe as the FIRST substantive check inside identity-birth-orchestrator.ts's `runStep(1, ...)` body, before any durable side effect. On a role folder miss, the orchestrator now throws "role not found on target host: <role>" which propagates through the existing runStep machinery to step:1:failed + ended{ok:false, failedStep:1} → worker's mapEndedEventToReason → FailureResponse{reason:"role_unknown"} in the .failure.json body. Closes the gap ivory's spawn-scan e2e surfaced on 2026-09-12 (bogus role birthing odin with permanently-baked bogus-role MXID localpart).

## Task-by-task changes

### Task 1: Role-folder probe insertion (commit 5e98a921)

**File:** `src/backend/database/routes/identity-birth-orchestrator.ts`

- Added `getLocalRolesRoot` to the existing named import from `../../claude-session/identity-artifact-reader.js` (line 52) — reused the existing export at identity-artifact-reader.ts:238 per D-04's planner-check clause; did NOT use the `path.join(getLocalIdentitiesRoot(), "..", "roles")` fallback.
- Updated the file-level docstring at line 12 from "Step 1: On-disk collision probe + avatar candidate check (Phase 68 rewire)" to "Step 1: Role-folder existence probe (Phase 108) + avatar candidate check + on-disk collision probe (Phase 68 rewire)".
- Expanded the Step 1 comment block (lines 1221-1240) to document the role-folder probe's placement, path, and failure semantics.
- Inserted the probe as the FIRST substantive block inside `runStep(1, ...)` (lines 1241-1281):
  - **LOCAL branch** (line 1254-1268): `fs.access(path.join(getLocalRolesRoot(), opts.role, opts.role + ".md"))` in a try/catch; ANY rejection throws `new Error("role not found on target host: " + opts.role)`.
  - **REMOTE branch** (line 1269-1280): `exec('if [ -f "$HOME/fleet/roles/${opts.role}/${opts.role}.md" ]; then echo exists; else echo missing; fi')` via the shared `exec()` closure at line 1181-1187 (no new SSH connection). If `roleProbeOut.trim() !== "exists"`, throws the same Error.
- Ordering verified via awk: **role probe line 1275 < avatar-candidate line 1287 < identity-collision line 1328** — probe runs before both, satisfying D-11.

### Task 2: 5 orchestrator tests (commit 305e149e + docs 76a5f93e)

**File:** `src/backend/database/routes/identity-birth-orchestrator.test.ts`

- Added `getLocalRolesRoot: vi.fn().mockReturnValue("/tmp/test-fleet/roles")` to the mocked identity-artifact-reader export.
- Replaced the default `fs.access` mock with a discriminating impl (`defaultAccessImpl`): resolves for paths containing `/roles/` (baseline: role file present), rejects with ENOENT otherwise (baseline: identity folder missing). Wired for BOTH the named export and the `default.access` sub-object because the orchestrator uses `import fs from "node:fs/promises"` (default import).
- Updated all 21 `mockExecCommand.mockImplementation` blocks to default `fleet/roles/` probe cmd → "exists" (baseline happy path). Existing test failures branches remain untouched — tests wanting to exercise the role-miss failure branch explicitly override.
- Appended the `describe("Phase 108: role-folder existence probe (D-13 A-E)", ...)` block with 5 tests:
  - **Test 108-A** (remote miss): asserts step:1:failed with `/role not found on target host/` reason, ended{ok:false, failedStep:1}, ZERO calls on `deps.writeMarkdownFileAtomic`, `deps.writeAvatarSiblingFile`, `deps.matrixCreateOrUpdateUser`, `deps.matrixLoginAsUser`, `deps.buildRelayJsonBody`.
  - **Test 108-B** (remote hit): asserts step:1:completed + Step 2 mkdir invoked (differentiated `fleet/roles/` vs `fleet/identities/` in the exec impl).
  - **Test 108-C** (local miss): asserts step:1:failed with the role-not-found reason; zero Step 2+ side effects.
  - **Test 108-D** (local hit): fs.access resolves for `/roles/` path, rejects for identity collision → step:1:completed.
  - **Test 108-E** (ordering): `opts.avatarCandidateId` non-empty + role probe returns missing → `deps.getCandidateForBirth` called ZERO times (proves role probe runs before avatar-candidate lookup, D-11).
- Result: 51/51 tests pass in this file (46 baseline + 5 Phase 108).

### Task 3: worker.ts comment + Test 108-W1 (commit 89bae1aa)

**Files:** `src/backend/spawn-requests/worker.ts`, `src/backend/spawn-requests/worker.test.ts`

- worker.ts:94 comment changed from `// Role folder not found on target host (Step 2.5 check in orchestrator)` to `// Role folder not found on target host (Step 1 check in orchestrator — Phase 108)`. No behavior change (per D-10).
- Test 108-W1 inserted into the `describe("processBirth", ...)` block (right after Test 12): mocks birthIdentity to emit `{type:"step", n:1, phase:"failed", reason:"role not found on target host: bogus"}` FIRST, then `{type:"ended", ok:false, failedStep:1}`. Then asserts writeMarkdownFileAtomic was called with a path ending `.failure.json` AND `parsed.reason === "role_unknown"` in the body. Distinct from Test 10b (unit-level regex on mapEndedEventToReason) — W1 exercises the full processBirth → writeMarkdownFileAtomic pipeline end-to-end at worker scope.
- types.ts NOT modified (FailureReason enum already includes `"role_unknown"` per D-09).

## Deviations from Plan

None mechanical to the tasks themselves. Two supporting changes were required to keep pre-Phase-108 tests passing, and both are auto-fixes under Rule 3 (blocking issue prevents completing task):

1. **[Rule 3 — Blocking]** Adding `getLocalRolesRoot` to the mocked `identity-artifact-reader` export in orchestrator tests. Without this, the new local-branch probe called `undefined()` → TypeError → all LOCAL tests broke. Fix: added `getLocalRolesRoot: vi.fn().mockReturnValue("/tmp/test-fleet/roles")`.
2. **[Rule 3 — Blocking]** Updating the default `fs.access` mock and all 21 `mockExecCommand.mockImplementation` blocks to treat `/roles/` (fs) and `fleet/roles/` (exec) as the baseline happy-path "exists". Without this, every pre-Phase-108 LOCAL test broke (default fs.access rejected → probe threw) and every REMOTE test broke (default exec returned "" → probe treated as missing). This is the least-invasive alternative to updating each test individually.

Both changes are test-infrastructure adaptations — production behavior is untouched.

## Phase-level rollup verification

| # | Check | Requirement | Result |
|---|---|---|---|
| 1 | `grep -c "role not found on target host" identity-birth-orchestrator.ts` | ≥ 2 | **3** ✓ |
| 2 | `grep -c "getLocalRolesRoot" identity-birth-orchestrator.ts` | ≥ 2 | **3** ✓ |
| 3 | `grep -c "Test 108-" identity-birth-orchestrator.test.ts` | == 5 | **5** ✓ |
| 4 | `grep -c "Test 108-W1" worker.test.ts` | == 1 | **1** ✓ |
| 5a | `grep -c "Step 2.5 check in orchestrator" worker.ts` | == 0 | **0** ✓ |
| 5b | `grep -c "Step 1 check in orchestrator — Phase 108" worker.ts` | == 1 | **1** ✓ |
| 6 | D-15 scoped vitest (3 files) | green | **104/104 pass** ✓ |
| 7 | `npx tsc --noEmit` | green | **clean** ✓ |
| 8 | `git diff --stat` on types.ts | empty | **empty** ✓ |
| 9 | awk ordering (role probe first) | role < avatar < collision | **1275 < 1287 < 1328** ✓ |

## D-15 scoped test gate

```
$ npx vitest run \
    src/backend/database/routes/identity-birth-orchestrator.test.ts \
    src/backend/database/routes/identity-birth.test.ts \
    src/backend/spawn-requests/worker.test.ts

Test Files  3 passed (3)
     Tests  104 passed (104)
  Duration  961ms
```

## Boundary confirmation (D-16 + fleet ship-gate rule)

Executor's remit stopped at scoped green. **Explicitly NOT invoked:**
- `npx vitest run` (full suite) — orchestrator-only.
- `docker build` / `docker compose up --force-recreate` — orchestrator-only ship-gate.
- `git push` — held for Alice's greenlight per deploy-boundary rule; orchestrator (odin in-session) handles push after coord-room BEFORE post + rebase.

Any of those commands appearing in the commit log or CI trace for these 4 commits would indicate a boundary violation; none appear.

## Commits

| # | Task | Hash | Message |
|---|---|---|---|
| 1 | Task 1 | `5e98a921` | feat(108-01): insert role-folder existence probe as first check in runStep(1) |
| 2 | Task 2 | `305e149e` | test(108-01): add 5 orchestrator tests (D-13 A-E) for role-folder probe |
| 3 | Task 3 | `89bae1aa` | feat(108-01): fix stale worker.ts comment + add processBirth W1 test |
| 4 | Task 2 doc | `76a5f93e` | docs(108-01): drop 'Test 108-A/C' references from comment prose |

## Self-Check: PASSED

- File `src/backend/database/routes/identity-birth-orchestrator.ts` exists (modified): FOUND
- File `src/backend/database/routes/identity-birth-orchestrator.test.ts` exists (modified): FOUND
- File `src/backend/spawn-requests/worker.ts` exists (modified): FOUND
- File `src/backend/spawn-requests/worker.test.ts` exists (modified): FOUND
- Commit `5e98a921` in git log: FOUND
- Commit `305e149e` in git log: FOUND
- Commit `89bae1aa` in git log: FOUND
- Commit `76a5f93e` in git log: FOUND
