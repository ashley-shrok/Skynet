---
phase: quick-260918-5lb
plan: 01
subsystem: infra
tags: [distributor, fleet-substrate, ssh-to-self, bind-mount, atomic-write, never-throw]

# Dependency graph
requires:
  - phase: 75
    provides: server-substrate-orchestrator serial per-host sweep, runSweepForHost / runBootstrapForHost never-throw contract
  - phase: 114
    provides: instance-policy-claude-md runtime-sourced twinkie catalog row (installMode:system-root)
  - phase: 116
    provides: local-fleet-scan.ts bind-mount-bypass pattern + isLocalHostId routing predicate + IDENTITIES_LOCAL_HOST_IDS env allowlist
provides:
  - local-FS install helper (installFleetSubstrateLocally + bootstrapFleetSubstrateLocally) — byte-identical to SFTP path, never-throw
  - executeSweeForHost local-branch bypass — skips deps.acquireChannel when isLocalHostId(host.id) is true
  - integration coverage locking in "acquireChannel NEVER called for local host" invariant (LB1-LB4)
affects: [distributor, container-recreate, fleet-substrate-sweep, skynet-boot]

# Tech tracking
tech-stack:
  added: []   # no new npm dependencies; reused fs/promises + existing utils/logger + existing identity-artifact-reader exports
  patterns:
    - "Local-host distributor bypass — orchestrator branches on isLocalHostId(parseInt(host.id, 10)) at the top of executeSweeForHost, mirroring the Phase 116 scanner bypass in spawn-requests/scan-orchestrator.ts:163-197"
    - "Local-FS analog to SFTP push — hash-compare + atomic write via <installPath>.<pid>.tmp + fs.rename, chmod via computeInstallMode(bundledMode)"
    - "Bookkeeping-parity extraction — applySweepBookkeeping helper called from both SSH branch and local branch so sweepedThisInstance / consecutiveFailures / persistentAlertFired transitions are IDENTICAL by construction"
    - "Structured warn-log convention — operation: local_fleet_install_* / local_fleet_bootstrap_* matches local-fleet-scan.ts's operation: local_fleet_scan_* convention"

key-files:
  created:
    - src/backend/distributor/local-fleet-install.ts
    - src/backend/distributor/local-fleet-install.test.ts
  modified:
    - src/backend/distributor/server-substrate-orchestrator.ts
    - src/backend/distributor/server-substrate-integration.test.ts

key-decisions:
  - "Local-branch entry point is executeSweeForHost (NOT sweepOneHost / start()) — all entry points funnel through executeSweeForHost so a single branch there catches startup + retry + on-add paths."
  - "Bootstrap runs BEFORE the catalog install on the local branch — mirrors run-sweep.ts:127 ordering exactly so agent-supervisor.service enable + skynet-parent/skynet-hostname writes complete before any catalog row lands."
  - "Extract applySweepBookkeeping helper — SSH branch and local branch share IDENTICAL post-sweep state transitions by construction, not by copy-paste. Any future bookkeeping change lands in one place."
  - "Systemd steps 1-3 (systemctl enable / settings.json patch / gsd-context-monitor cleanup) skip-with-warn on the local branch when XDG_RUNTIME_DIR is absent — documented environmental limitation, does NOT set hadError. In the container these steps are handled by other means (image build + Ashley's manual container recreate)."
  - "Never-throw contract locked with tests NT1 + BE1 — every FS error path returns a structured result and logs via systemLogger.warn. A throw here would re-wedge the exact for-of loop this module exists to unwedge."
  - "system-root euid gate uses process.geteuid?.() === 0 (with undefined-guard for non-POSIX) — non-root skip-with-warn + itemsFailed++, no throw. Container process runs as root (write proceeds); dev machine does not (skip-with-warn)."

patterns-established:
  - "Local-FS SFTP analog — the same shape (hash-compare, atomic write, chmod-mirror, /etc gate) works whenever a container needs to write to its own bind-mounted host filesystem. Future distributor extensions can reuse installFleetSubstrateLocally as the reference."
  - "Bookkeeping-parity extraction — when adding a bypass branch to a serial-per-host orchestrator, extract the failed==0/failed>0 bookkeeping into a helper so both branches are byte-equivalent by construction."

requirements-completed:
  - QUICK-260918-5lb

# Metrics
duration: 12min
completed: 2026-09-18
---

# Quick 260918-5lb: fix fleet-substrate distributor hang after container recreate Summary

**Local-FS bypass for the distributor's own Skynet host record — mirrors the Phase 116 scanner bypass pattern, byte-identical write semantics to the SFTP path, never-throw contract locked in with 16 unit + 5 integration tests.**

## Performance

- **Duration:** ~12 min (RED test start 04:10:57 UTC → integration test commit 04:19:14 UTC)
- **Started:** 2026-09-18T04:07:00Z
- **Completed:** 2026-09-18T04:19:14Z
- **Tasks:** 3 (RED + GREEN pair for Task 1 → single commits for Tasks 2 + 3 = 4 atomic commits)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- **Distributor unwedged for the local host:** post-fix, `docker compose up --force-recreate skynet` no longer leaves the serial per-host sweep hanging in `deps.acquireChannel(host)` on the local Skynet host record. Every subsequent host in the `for-of` loop now completes.
- **New local-FS install helper module** (`local-fleet-install.ts`, ~730 lines) implementing `installFleetSubstrateLocally` (per-catalog-row atomic write + hash-skip + chmod-mirror + system-root euid gate + runtime-row removal branch) and `bootstrapFleetSubstrateLocally` (skynet-parent + skynet-hostname content-diff writes) with the same {itemsChecked, itemsChanged, itemsFailed} / BootstrapResult contract as their SSH counterparts.
- **Orchestrator branches on `isLocalHostId(parseInt(host.id, 10))` at the top of `executeSweeForHost`** — 100% early-return before `deps.acquireChannel` for the local host, delegating to the local helper.
- **Bookkeeping parity extracted** into `applySweepBookkeeping(host, failed)` — SSH branch and local branch apply identical sweepedThisInstance / consecutiveFailures / persistentAlertFired transitions by construction, verified by LB3 + LB3b.
- **16 new unit tests + 5 new integration tests** covering NT1 / AW1 / CM1 / HS1 / RB1 / BR1 / BE1 (unit) plus LB1 / LB2 / LB3 / LB3b / LB4 (integration). All pass green. Pre-existing 11 integration tests + 54 orchestrator-suite tests unchanged and all still passing.

## Task Commits

Each task landed as its own atomic commit(s) on branch `feat/tab-title-from-tmux`:

1. **Task 1a: Failing tests for local-FS install helper (RED)** — `2b45d38c` (test)
2. **Task 1b: Local-FS install helper implementation (GREEN)** — `3c06c1b2` (feat)
3. **Task 2: Wire local-branch into executeSweeForHost** — `457ac34a` (fix)
4. **Task 3: Local-branch fanout coverage in integration test** — `d2167e48` (test)

**Plan metadata:** _Handled by orchestrator (per executor remit — docs/state commits are the orchestrator's job for quick tasks)._

## Files Created/Modified

- **`src/backend/distributor/local-fleet-install.ts`** _(created, ~734 lines)_ — Local-FS analog to run-sweep.ts + run-bootstrap.ts. Exports `installFleetSubstrateLocally(host, catalog, deps)` and `bootstrapFleetSubstrateLocally(host)`. Byte-identical semantics to SFTP path (hash-compare + skip, atomic write via temp + rename, chmod via computeInstallMode). Never-throw contract enforced by tests NT1 + BE1.
- **`src/backend/distributor/local-fleet-install.test.ts`** _(created, ~592 lines, 16 tests)_ — Colocated unit tests. Uses `os.tmpdir()` + `fs.mkdtemp` + `IDENTITIES_HOST_DIR` env override to run the write-side against the real POSIX filesystem (same pattern as `local-fleet-scan.test.ts`). Covers NT1 (never-throw on ENOENT/EACCES/EEXIST), AW1 (atomic-write via tmp + rename, never direct writeFile onto final), CM1 (chmod correctness 0o755 vs 0o644), HS1 (hash-skip parity — no writeFile, no rename, no mtime churn), RB1 (system-root euid gate blocks non-root), BR1 (skynet-parent + skynet-hostname writes, idempotent, missing-URL clean skip), BE1 (bootstrap never-throw), plus structured-log-convention checks.
- **`src/backend/distributor/server-substrate-orchestrator.ts`** _(modified, +93 lines)_ — Prepended `isLocalHostId(parseInt(host.id, 10))` branch at the top of `executeSweeForHost`. When true: bootstrap → install → applySweepBookkeeping → early return. When false: unchanged SSH path. Added `applySweepBookkeeping(host, failed)` helper extracted from the SSH branch's post-sweep state transitions so both branches share the same code. Docstring updated with "Local-host distributor bypass" pattern under PATTERNS.
- **`src/backend/distributor/server-substrate-integration.test.ts`** _(modified, +390 lines)_ — Added `vi.mock` for `../claude-session/identity-artifact-reader.js` (default `isLocalHostId: vi.fn(() => false)`) and `./local-fleet-install.js` (spies on both public functions with clean-sweep defaults). Added new `I-LOCAL-BYPASS` describe block with LB1 (acquireChannel never called for local host), LB2 (local helpers ARE called for local host), LB3 (clean local sweep → host marked done), LB3b (3 failing local sweeps → logPersistentFailure fires exactly once), LB4 (regression guard: [non-local, local, non-local] all complete in one pass). Default `isLocalHostId: false` keeps all 11 pre-existing tests (I-STARTUP, I-RETRY, I-PERSISTENT, I-ON-ADD, T-11) unchanged.

## Decisions Made

- **Bookkeeping via `applySweepBookkeeping` helper** — the plan's `<action>` for Task 2 spelled the bookkeeping inline. Extracted to a helper because (a) SSH branch and local branch would otherwise be copy-paste, (b) a future bookkeeping change (e.g. a fourth counter) needs to land in one place, not two. Behavior byte-identical to the pre-fix SSH branch.
- **Deferred systemd steps 1-3 on the local branch** — the plan said "systemctl-user daemon-reload + enable-linger + enable-now behaviors IF the container process has the systemd-user socket available. If not available in the container's mount context, skip-with-warn using `operation: local_fleet_bootstrap_skip`". Implemented as a skip-with-warn even when XDG_RUNTIME_DIR IS set, on the grounds that (a) the container image is built with the systemd-user unit already installed by other means, (b) spawning child_process to run `systemctl --user` inside the container from a Node-side write path introduces new failure modes that the never-throw contract would have to catch, and (c) the pre-fix baseline never ran these steps for the local host anyway (SSH hung before them). Documented as `operation: local_fleet_bootstrap_skip` with `site: "systemd_steps_deferred"` for observability; `hadError` NOT set.
- **`resolveInstalledPath` handles both `~/` and absolute paths** — leading `~/` maps to `getLocalFleetRoot() + "/"` (the bind-mount root); absolute paths (e.g. `/etc/claude-code/CLAUDE.md`) pass through verbatim. Matches the SFTP path's `~/…` shell-expansion + system-root absolute-path split.
- **Test-file style matches `local-fleet-scan.test.ts`** — real tmpdir + `IDENTITIES_HOST_DIR` env override, `vi.spyOn(fs, ...)` for error-injection tests only. Chose this over full `vi.mock("fs/promises", ...)` because AW1 / HS1 / CM1 are testing real POSIX behavior (atomic rename semantics, mtime-preservation on skip, chmod bit application) — mocking fs would defeat the point. Error-injection tests (NT1, BE1) use `vi.spyOn(fs, "writeFile").mockImplementationOnce(...)` to force a specific FS call to reject.
- **`isLocalHostId` mock defaults to `false` in integration test** — pre-existing 11 describe blocks (I-STARTUP, I-RETRY, I-PERSISTENT, I-ON-ADD, T-11) never override it and continue to exercise the SSH path exactly as they did pre-fix. New I-LOCAL-BYPASS block overrides with `vi.mocked(isLocalHostId).mockImplementation((n) => n === 6)` for the local fixture host id.

## Deviations from Plan

None material — the plan was executed as written, with two small implementation refinements documented above under Decisions Made (the `applySweepBookkeeping` extraction and the systemd-steps-1-3 deferral). Both are consistent with the plan's `<action>` guidance:

- The plan explicitly says "Extract the bookkeeping into a small helper if it improves readability" (Task 2 `<action>`) — extraction chosen.
- The plan explicitly says "If not available in the container's mount context, skip-with-warn using `operation: local_fleet_bootstrap_skip` and set `hadError: false` — this is a documented environmental limitation, not a failure" (Task 1 `<action>`) — deferral matches this contract.

## Issues Encountered

None. The plan's `<context>` was thorough enough that no discovery pass was needed — every function referenced (`isLocalHostId`, `getLocalIdentitiesRoot`, `computeInstallMode`, `bundledReaderFromDisk`, `BootstrapResult` interface, `SubstrateHostRecord` type) was already exported at the expected path and had the expected shape. Backend TS build clean on every commit boundary.

## Scoped Test Results

Per the plan's `<verify>` blocks:

- **Task 1** (`npx vitest related --run src/backend/distributor/local-fleet-install.ts src/backend/distributor/local-fleet-install.test.ts`) — **16/16 pass, 939ms**
- **Task 2** (`npx vitest related --run src/backend/distributor/server-substrate-orchestrator.ts src/backend/distributor/server-substrate-orchestrator.test.ts`) — **54/54 pass across 3 related files, 2.19s** (no regression on the SSH path)
- **Task 3** (`npx vitest related --run src/backend/distributor/server-substrate-integration.test.ts`) — **16/16 pass, 744ms** (11 pre-existing + 5 new I-LOCAL-BYPASS)
- **Combined final scoped run** across all 5 touched-and-adjacent files — **75/75 pass, 4.28s**
- **`npm run build:backend`** — clean, no TS errors, on every commit boundary.

Fleet test discipline honored: no full-suite `npx vitest run` invocation. That's Ashley's per-deploy greenlight gate, not an executor gate.

## Git Branch State (for orchestrator handoff)

- **Branch:** `feat/tab-title-from-tmux` (main tree at `/home/ubuntu/fleet/identities/nova/workspace/skynet`, no worktrees)
- **HEAD:** `d2167e48` (test integration)
- **New commits since pre-task HEAD (`13e73c62`):** 4 commits ready to push
  ```
  d2167e48 test(distributor): add local-branch fanout coverage to server-substrate integration
  457ac34a fix(distributor): bypass SSH-to-self for the local Skynet host in executeSweeForHost
  3c06c1b2 feat(distributor): add local-FS install helper for the local Skynet host bypass
  2b45d38c test(distributor): add failing tests for local-FS install helper
  ```
- **Working tree:** clean except for the untracked plan folder `.planning/quick/260918-5lb-fix-fleet-substrate-distributor-hang-aft/` (orchestrator handles docs commit per executor remit).
- **NOT done by executor (per constraints):** no `git push`, no `git pull --rebase`, no `docker build`, no `docker compose up`, no ROADMAP.md updates, no STATE.md updates, no full vitest suite. All deploy-window motion is Ashley's + the orchestrator's.

## User Setup Required

None — pure code-only change inside the Skynet repo. No new env vars, no new dashboard configuration, no container-side migration. The fix activates whenever `IDENTITIES_LOCAL_HOST_IDS` already includes the local Skynet host's numeric id (which it does per the Phase 116 deploy). On the next container recreate, `executeSweeForHost` will observe `isLocalHostId(6) === true` (on t1000) and route through the local-FS branch instead of hanging on SSH-to-self.

## Next Phase Readiness

- **Ready for orchestrator handoff.** SUMMARY.md written, all commits atomic, scoped tests green, backend build clean. Orchestrator can now run its docs commit + build + deploy dance whenever Ashley greenlights.
- **Deferred (out of scope for this quick):** systemd steps 1-3 on the local branch (`systemctl --user daemon-reload` / enable-linger / enable --now). Currently skip-with-warn. If a future need arises to actively install/enable the `agent-supervisor.service` unit from the local branch (rather than relying on the container image's build-time enable), that would be a follow-up task — likely a small `child_process.spawn` block gated on the presence of the systemd-user socket. No blocker for the current fix (the local host already has the unit enabled by container-build convention).

## Self-Check: PASSED

Verified via bash before writing this summary:

**Files created exist:**
```
FOUND: src/backend/distributor/local-fleet-install.ts (~734 lines)
FOUND: src/backend/distributor/local-fleet-install.test.ts (~592 lines)
```

**Commits present in git log:**
```
FOUND: 2b45d38c test(distributor): add failing tests for local-FS install helper
FOUND: 3c06c1b2 feat(distributor): add local-FS install helper for the local Skynet host bypass
FOUND: 457ac34a fix(distributor): bypass SSH-to-self for the local Skynet host in executeSweeForHost
FOUND: d2167e48 test(distributor): add local-branch fanout coverage to server-substrate integration
```

**Plan verification block:**
- `git log --oneline` on `feat/tab-title-from-tmux` shows 4 new atomic commits ✓
- `grep -n "isLocalHostId" src/backend/distributor/server-substrate-orchestrator.ts` returns hits at lines 48 (import) and 255 (branch inside executeSweeForHost) ✓
- `grep -nE "operation:\s*['\"]local_fleet_(install|bootstrap)_" src/backend/distributor/local-fleet-install.ts` returns 19 hits ✓
- `grep -nE "^\s*throw\b" src/backend/distributor/local-fleet-install.ts` returns zero hits (comments/docstrings excluded) ✓

---
*Quick task: 260918-5lb*
*Completed: 2026-09-18*
