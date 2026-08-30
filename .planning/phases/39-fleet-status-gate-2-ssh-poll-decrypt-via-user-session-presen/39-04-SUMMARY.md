---
phase: 39
plan: 04
subsystem: backend/fleet-status + backend/starter
tags: [stop-hook-install, blind-install, presence-lifecycle, path-c, phase-39-gate2, fire-and-forget, tdd]
requirements: [GATE2-05]
requires:
  - 39-02 (presence-driven orchestrator lifecycle + hostClients Map + currentSubscriberUserId + onLastUnsubscriber cleanup block inside starter.ts fleet-status IIFE — commit fcc254fc)
  - 39-03 (logger.formatMessage generic context passthrough — commit b15b5c44 — so err.message on this plan's install-failure warns actually surfaces in console-forward.log)
  - 34-04 (installStopHook helper: heredoc-quoted script drop + atomic .tmp+mv settings.json merge + readAndMergeStopHookSettings alreadyInstalled short-circuit — remote-hook-install.ts:161)
provides:
  - Per-host Stop-hook install (~/.claude/hooks/skynet-fleet-status-stop.sh + settings.json Stop-hook entry) invoked exactly once per host per fleet-status active window
  - Module-scope `maybeInstallStopHook` helper (exported from starter.ts) that isolates the install-once + fire-and-forget + structured-logging semantics from the IIFE surface — testable in vitest without booting the backend
  - IIFE guard `if (process.env.VITEST !== "true")` on the fleet-status boot block so test imports of starter.js do NOT trigger real dotenv/DB/SSL/WS initialization
  - Structured log ops fleet_status_hook_install_started / _success / _failed with fleetHostId payload for post-deploy grep-based runtime signature verification
affects:
  - src/backend/starter.ts (module-level helper + IIFE integration + boot guard)
  - src/backend/starter.test.ts (5-test coverage suite — NEW file)
tech_stack:
  added: []
  patterns:
    - "Blind-install-then-detect (RESEARCH §Q5 Option C, LOCKED 2026-08-13 by researcher) — no probe-first path; installStopHook's own readAndMergeStopHookSettings alreadyInstalled check makes the second run cheap (5 read-only exec calls, zero writes)"
    - "Module-scope helper extraction for pure-function testability (plan-check WARNING 2) — all deps (installStopHook, systemLogger) injected via deps parameter so vitest can drive the helper in isolation without vi.mock hoists"
    - "IIFE-entrypoint boot-guard via process.env.VITEST (auto-set by vitest workers) — enables exported helpers to be imported for testing without triggering real backend init"
    - "Fire-and-forget promise with mandatory .catch handler — install failures do not crash the process (unhandledRejection would), do not block acquireSshChannel return, and do not invalidate the SshChannel returned to the orchestrator"
    - "Per-lifecycle install-attempted Set (cleared in onLastUnsubscriber alongside hostClients.clear()) — subsequent lifecycles re-attempt install; installStopHook's idempotency (RESEARCH §Q5) makes re-attempts safe"
key_files:
  created:
    - src/backend/starter.test.ts (5-test coverage for the maybeInstallStopHook helper — install-once, lifecycle-reset re-arm, fire-and-forget failure with err.message logging, SshChannel adapter shape, per-lifecycle Set is the only tracking state)
  modified:
    - src/backend/starter.ts (export maybeInstallStopHook at module scope + IIFE-boot guard via VITEST env + hookInstallAttempted Set inside fleet-status IIFE + integration into acquireSshChannel first-successful-new-client branch + install dynamic import + hookInstallAttempted.clear() in onLastUnsubscriber)
decisions:
  - "Guarded the fleet-status boot IIFE with `if (process.env.VITEST !== 'true')` (Rule 3 auto-fix — blocking issue). Rationale: Task 2's tests import `maybeInstallStopHook` from `./starter.js`, and top-level IIFEs execute on module load — without the guard, importing starter.ts in vitest would attempt to run real dotenv/DB init/SSL setup/WS server startup, which would either fail hard on missing env or actually initialize services during the test run. Vitest auto-sets `process.env.VITEST === 'true'` in worker processes, so the guard is zero-config and touches nothing at production boot. Documented in the file's guard-line comment."
  - "Extracted maybeInstallStopHook to MODULE scope (not IIFE-inner) per plan-check WARNING 2 mandate. Rationale: keeps the helper trivially importable + testable with mocked deps, and the export contract is load-bearing for Task 2 (which tests the helper directly rather than driving the full IIFE). The IIFE's call-site passes the real `installStopHook` (from dynamic import) + real `systemLogger` (module-level import at the top of starter.ts) via the `deps` object, so production behavior is unchanged."
  - "Structured install-attempted Set as `Set<string>` keyed by host.id (not by name/host record). Rationale: host.id is the immutable primary key from hostsTable — safe key for a Map/Set that outlives host renames or IP changes. Same key used by hostClients Map (Plan 02) — the two collections cleanup in the same onLastUnsubscriber block in the same order."
  - "hookInstallAttempted.add(hostId) is called BEFORE deps.installStopHook(channelAdapter) fires. Rationale: prevents a re-entrant call while the install-hook promise is in-flight from double-firing (defense-in-depth — acquireSshChannel is not currently called re-entrantly for the same host per poll cycle, but the pattern is future-proof). Idempotency of installStopHook makes even a hypothetical double-fire safe, but the Set-add-first ordering removes even the possibility."
  - "Did NOT introduce a probe-first branch (Option B rejected in RESEARCH §Q5 recommendation → Option C chosen; LOCKED in CONTEXT §Design-question preferences 2026-08-13). Blind-install is cheap on the second run (5 read-only SSH exec calls per RESEARCH §Q5) and adds zero new failure modes vs probe-then-conditional-install. Option C keeps the diff minimal and matches the researcher's recommendation."
metrics:
  duration: "~62 minutes (including two full-suite vitest runs of ~1000s each — one of which surfaced a transient IdentityModal.test.tsx teardown flake that cleared on retry, and one clean confirmation)"
  completed_date: 2026-08-14
  tasks_completed: 2
  files_modified: 1 (starter.ts)
  files_created: 1 (starter.test.ts)
  tests_added: 5 (starter.test.ts — all Phase 39-04)
  tests_passing_targeted: "5/5 starter.test.ts"
  tests_passing_full_suite: "2264 pass / 6 skipped / 1 todo / 0 fail across 180 files (was 2259/179 at 39-03; +5 tests +1 file matches this plan)"
---

# Phase 39 Plan 04: Stop-Hook Install Wiring into Presence-Driven Orchestrator Lifecycle — Summary

**Wires Phase 34's `installStopHook` helper into starter.ts's acquireSshChannel first-successful-new-client branch as a fire-and-forget blind-install-per-host, install-once-per-lifecycle, with a module-scope exported helper (`maybeInstallStopHook`) that isolates the semantics for direct vitest coverage.**

## Performance

- **Duration:** ~62 min (dominated by two full-suite vitest runs; helper edit + test file authoring was ~5 min)
- **Started:** 2026-08-14T01:45:18Z
- **Completed:** 2026-08-14T02:48:04Z
- **Tasks:** 2
- **Files modified:** 1 (`src/backend/starter.ts`)
- **Files created:** 1 (`src/backend/starter.test.ts`)

## Accomplishments

- **D-05 / GATE2-05 achieved:** on the FIRST successful new-client `acquireSshChannel` per host per fleet-status active window, `installStopHook` is invoked fire-and-forget with the same `SshChannel` adapter the orchestrator will use for its poll `exec` calls. Result: any enrolled host missing the `stop-hook.sh` script or the settings.json Stop-hook entry gets it during the first active window, closing the "unverified whether install ever ran against any host" concern from CONTEXT §Third strand.
- **Module-scope exported helper** `maybeInstallStopHook(hostId, channelAdapter, hookInstallAttempted, deps)` with all deps (`installStopHook`, `systemLogger`) injected — testable in isolation without vi.mock hoists, without driving the whole IIFE. Per plan-check WARNING 2 mandate. The IIFE's call-site passes the real dependencies via the `deps` object.
- **IIFE-boot guard** `if (process.env.VITEST !== "true")` on the fleet-status boot block so `starter.test.ts` can safely `import { maybeInstallStopHook } from "./starter.js"` without triggering real dotenv / DB init / SSL setup / WS-server startup. Vitest auto-sets `process.env.VITEST` in worker processes, so the guard is invisible at production boot.
- **Install-once-per-lifecycle** enforced via a `hookInstallAttempted = new Set<string>()` declared inside the fleet-status IIFE alongside `hostClients` + `currentSubscriberUserId` (Plan 02's structures). The Set is cleared in `onLastUnsubscriber` alongside `hostClients.clear()` so subsequent lifecycles re-arm — safe because `installStopHook` is idempotent (RESEARCH §Q5).
- **Structured logging** — `fleet_status_hook_install_started` (info) before fire, `fleet_status_hook_install_success` (info) on resolve with `{ hookInstalled, settingsUpdated }`, `fleet_status_hook_install_failed` (warn) on reject with `error: err.message`. Uses the Plan 03-fixed `logger.formatMessage` so `err.message` actually surfaces in `console-forward.log` (would have been silently dropped pre-Plan-03).
- **5-test vitest coverage** in `starter.test.ts` proving install-once, lifecycle-reset re-arm, fire-and-forget non-blocking on failure with `err.message` logged, SshChannel adapter shape correctness, and Set-as-only-tracking-state across multiple lifecycles.

## Task Commits

Each task was committed atomically. TDD RED gate + GREEN gate for Task 1:

1. **Task 1 RED:** `f4cd8489` — `test(39-04): add failing test for maybeInstallStopHook install-once invariant`
   - Created `starter.test.ts` with Test 1 (install fires exactly once per host).
   - Added `export function maybeInstallStopHook(...)` at module scope as a **no-op stub** (returns void, does not fire installStopHook) so the test observes 0 calls and fails as expected.
   - Wired `hookInstallAttempted` Set + `installStopHook` dynamic import + IIFE integration into acquireSshChannel + `hookInstallAttempted.clear()` in onLastUnsubscriber.
   - Guarded the boot IIFE with `if (process.env.VITEST !== "true")`.
   - Test failed with `expected "vi.fn()" to be called 1 times, but got 0 times` — RED confirmed.
2. **Task 1 GREEN:** `0e3847d1` — `feat(39-04): implement maybeInstallStopHook — fire-and-forget blind install per host`
   - Replaced the stub body with the full implementation (Set.has short-circuit → Set.add → info log → installStopHook.then(info log) / .catch(warn log with err.message)).
   - Test 1 GREEN; both builds exit 0; full suite 180 files / 2260 pass / 0 fail (after transient IdentityModal.test.tsx flake cleared on retry).
3. **Task 2:** `002111db` — `test(39-04): expand starter.test.ts coverage — lifecycle-reset, fire-and-forget failure, adapter shape`
   - Added Tests 2-5: lifecycle-reset re-arm, fire-and-forget failure with structured warn assertion (operation + error + fleetHostId), SshChannel adapter shape assertion (function-typed exec + same reference identity), multi-lifecycle Set-is-only-state proof.
   - All 5 pass; both builds exit 0; full suite 180 files / 2264 pass / 0 fail.

**Plan metadata commit:** to be created next (per gsd-executor final_commit step).

## Files Created/Modified

- **`src/backend/starter.ts`** (modified) — Three changes:
  1. Added `import type { SshChannel }` from `./fleet-status/ssh-poll-orchestrator.js` at the top of the file.
  2. Added module-scope exported function `maybeInstallStopHook(hostId, channelAdapter, hookInstallAttempted, deps)` with the full install-once + fire-and-forget + structured-logging body.
  3. Wrapped the pre-existing `(async () => { ... })();` boot IIFE in `if (process.env.VITEST !== "true") { ... }` guard (open on line 87, closing brace with comment at file end).
  4. Inside the fleet-status IIFE block (post-Plan-02 shape at lines 165-441): added `const { installStopHook } = await import("./fleet-status/remote-hook-install.js");` alongside the other dynamic imports, added `const hookInstallAttempted = new Set<string>();` immediately after `currentSubscriberUserId`, restructured the acquireSshChannel new-client return path to construct a `const channelAdapter: SshChannel = { exec: ... }` and pass it through `maybeInstallStopHook(host.id, channelAdapter, hookInstallAttempted, { installStopHook, systemLogger })` before returning, and added `hookInstallAttempted.clear();` inside `onLastUnsubscriber` immediately before `currentSubscriberUserId = null;`.
- **`src/backend/starter.test.ts`** (created) — 5 tests covering the exported `maybeInstallStopHook` helper directly via injected mock deps. Uses `beforeEach` to reset the mock `installStopHook`, mock `systemLogger` (with `info`/`warn`/`error`/`debug`/`success` as `vi.fn()`), the `Set<string>`, and the `channelAdapter`. No `vi.mock` hoists needed — all dependencies flow through the `deps` parameter.

## Decisions Made

See frontmatter `decisions` list. Highlights:

1. **VITEST env guard on the boot IIFE** (Rule 3 auto-fix — blocking issue). Without it, `import { maybeInstallStopHook } from "./starter.js"` in the test file would execute the full boot sequence at import time (dotenv, DB init, SSL setup, WS servers). Vitest auto-sets `process.env.VITEST` in worker processes so the guard is zero-config. This is the ONLY way to keep the helper importable + testable in isolation given the file's IIFE-at-top-level structure — the alternative (extracting the helper to a separate file) would fragment the fleet-status wiring across files and lose the co-location of the helper with its sole caller.
2. **Set-add-BEFORE-fire ordering** for defense-in-depth against hypothetical re-entrant callers. Also makes the invariant "if hostId is in the Set, we've already committed to firing once" cleaner to reason about.
3. **No probe-first branch (Option C from RESEARCH §Q5)** — LOCKED by researcher / CONTEXT §Design-question preferences 2026-08-13. Blind install with idempotency delegation to `readAndMergeStopHookSettings.alreadyInstalled` is cheaper and simpler than a preflight probe.

## Deviations from Plan

**One Rule 3 auto-fix:** Added the `if (process.env.VITEST !== "true") { ... }` guard around the top-level boot IIFE in `starter.ts`.

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Guard boot IIFE with VITEST env check**

- **Found during:** Task 1 (writing the RED test — before staging).
- **Issue:** The test file needs to `import { maybeInstallStopHook } from "./starter.js"`, but `starter.ts`'s top-level `(async () => { ... })();` IIFE executes on module load — which would attempt real backend init (dotenv, DB, SSL, WS servers) during vitest runs. That would either hang, crash, or corrupt state. Without a guard, Task 2's tests literally cannot import the helper.
- **Fix:** Wrapped the existing IIFE in `if (process.env.VITEST !== "true") { ... }`. Vitest sets `process.env.VITEST === "true"` automatically in worker processes (documented behavior since vitest v1). Production boot (where this env var is absent) executes the IIFE unchanged; test runs skip it while still allowing exported helpers to be imported.
- **Files modified:** `src/backend/starter.ts` (added `if (...) {` on line 87 and closing `} // end if (process.env.VITEST !== "true")` at file end).
- **Verification:** `npx vitest run src/backend/starter.test.ts` returns 5/5 pass with no side-effects (no DB connections attempted, no port bindings, no dotenv reads visible in log). `npm run build:backend` + `npm run build` both exit 0 — the guard is TypeScript-valid.
- **Committed in:** `f4cd8489` (Task 1 RED — the guard lands together with the stub because both are prerequisites for the test to even run).

---

**Total deviations:** 1 auto-fixed (1 blocking / Rule 3).
**Impact on plan:** Zero scope creep. The guard is a one-liner + closing brace that touches no runtime behavior in production (VITEST env is only set by vitest workers). Necessary for the plan's own Task 2 to be executable, so it's mandated by the plan itself even though not spelled out in the plan text. Documented in the file comment above the guard.

## Issues Encountered

**Transient IdentityModal.test.tsx flake in full-suite run** (Task 1 GREEN verify)

- **Symptom:** First full-suite `npx vitest run` after Task 1 GREEN reported `1 failed | 179 passed | 2259 passed` with `EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending` originating from `src/ui/features/pretty-view/IdentityModal.test.tsx`.
- **Investigation:** Ran the failing file in isolation (`npx vitest run src/ui/features/pretty-view/IdentityModal.test.tsx`) — 6/6 pass, no errors. The failure only manifests under the concurrent worker load of the full suite. This is a known vitest-worker teardown race, unrelated to my changes (no code path in Phase 39-04 touches UI, jsdom, or rpc-forwarded console output).
- **Resolution:** Per SCOPE BOUNDARY rule ("Only auto-fix issues DIRECTLY caused by the current task's changes. Pre-existing warnings, linting errors, or failures in unrelated files are out of scope"), re-ran the full suite once — it passed cleanly (`180 passed / 2260 passed` after Task 1 GREEN, `180 passed / 2264 passed` after Task 2). Verified the transient nature by running twice with different result.
- **Follow-up:** Left as a deferred item — the vitest teardown race is worth investigating separately (a phase for a future flake-hunt plan) but is outside GATE2-05 scope.

## User Setup Required

None — no external service configuration required. The `stop-hook.sh` script + `~/.claude/settings.json` entry are installed automatically over SSH by `installStopHook` on the target host's first successful `acquireSshChannel` call. No env vars, no manual dashboard steps.

## Threat Model Compliance

The plan's threat register (T-39-11 through T-39-13 plus T-39-SC) is upheld:

- **T-39-11 (Elevation of Privilege — remote script execution via installStopHook):** mitigated — this plan does NOT re-implement any part of the install. It calls the canonical `installStopHook(channel, opts?)` helper from Phase 34 Plan 04 verbatim (heredoc-quoted writes, fixed compile-time DEFAULT_REMOTE_HOOK_PATH const, `.tmp`/mv atomic swap, invalid-JSON safeguard). No user input crosses the SSH exec boundary.
- **T-39-12 (Denial of Service — repeated install attempts spam SSH):** mitigated — `hookInstallAttempted` Set enforces install-once-per-lifecycle. Even across lifecycles, the second run is cheap: `readAndMergeStopHookSettings.alreadyInstalled` short-circuits the write path so it's 5 read-only SSH exec calls (RESEARCH §Q5 lines 251-260 of remote-hook-install.ts).
- **T-39-13 (Tampering — settings.json race):** mitigated — Set prevents concurrent installs against the same host from the same starter process. Cross-process concurrency is not a concern on this single-container box; even if it were, `readAndMergeStopHookSettings` is idempotent and `.tmp`+mv is atomic on POSIX.
- **T-39-SC (Supply-Chain):** mitigated — no new npm packages. Pure in-tree refactor.

## Deferred Behaviors (out of scope for this plan)

- **Runtime signature verification (post-deploy).** Structured logs `fleet_status_hook_install_started` / `_success` / `_failed` are emitted — but observing them fire in production is the orchestrator's post-deploy verification job, not this executor's. Executor scope stops at test-green per fleet directive #2.
- **Vitest teardown-race investigation for IdentityModal.test.tsx.** See "Issues Encountered" above. Pre-existing intermittent flake; unrelated to Phase 39-04.
- **Multi-user concurrent poller install semantics.** Same "single-tenant box" caveat that Plan 39-02 deferred (§Deferred Behaviors → Multi-user concurrent subscribers). Not this plan's problem.

## Coordination Notes

- Worked entirely on `feat/tab-title-from-tmux` in the main tree at `/home/ubuntu/skynet-tanya`. NO git worktrees per fleet directive #1.
- Zero file overlap with 39-01 (subscription-registry.*), 39-02 (fleet-status-server.*), 39-03 (utils/logger.*). Only starter.ts is shared with 39-02, and this plan's edits layer ONTO Plan 02's structures (hookInstallAttempted Set alongside hostClients + currentSubscriberUserId; hookInstallAttempted.clear() ADDED to the existing onLastUnsubscriber body, not replacing).
- No parallel executor was running during this plan — verified via `git status` (clean tree at start).
- All commits carry no `--no-verify` flag per fleet directive #3. No pre-commit hooks configured in this repo — `git commit` succeeded first try each time.

## What Downstream Consumes

- **Phase 39 completion criteria** (all six gates GATE2-01..06) are now MATERIALLY complete. GATE2-05 was the last outstanding requirement per this phase's frontmatter. Post-deploy runtime signature verification (log-observation of `fleet_status_hook_install_*` ops per host during a real browser session) is the orchestrator/tanya-scope validation step.
- **Post-Phase-39 orchestrator work.** The runtime signature to look for: on first browser subscribe, per-enrolled-host, expect ONE `fleet_status_hook_install_started` + ONE of `fleet_status_hook_install_success` (or `_failed` with error message) in `console-forward.log`. If `_failed` appears with `error: "..."`, that's a diagnostic pointing at the exact host that needs manual investigation — the poll cycle continues regardless (fail-open per Phase 34 Ashley LOCK).
- **Future testability of starter.ts.** The `if (process.env.VITEST !== "true")` guard + module-scope helper extraction pattern established here is reusable — future plans that want to add starter.ts-level exports can drop them at module scope and test them directly via the same pattern.

## Known Stubs

None. The `maybeInstallStopHook` helper is fully implemented (RED stub was replaced in the GREEN commit `0e3847d1`). No placeholder logic, no empty-return-shortcuts, no TODO/FIXME markers in either `starter.ts` or `starter.test.ts`.

## Threat Flags

No new security-relevant surface introduced beyond what the threat register already covers. The install call goes through the pre-existing SSH channel (already authenticated per host via `resolveHostById` decrypt from Plan 02), invokes the canonical `installStopHook` helper from Phase 34 (already threat-modeled), and passes no user-controlled input across the trust boundary. The only new module-level exported symbol is `maybeInstallStopHook` — a pure orchestration helper with no I/O of its own; all I/O flows through injected `deps.installStopHook`.

## Self-Check: PASSED

Files (verified via `ls`):
- FOUND: `/home/ubuntu/skynet-tanya/src/backend/starter.ts`
- FOUND: `/home/ubuntu/skynet-tanya/src/backend/starter.test.ts`

Commits (verified via `git log --oneline`):
- FOUND: `f4cd8489` — `test(39-04): add failing test for maybeInstallStopHook install-once invariant` (RED)
- FOUND: `0e3847d1` — `feat(39-04): implement maybeInstallStopHook — fire-and-forget blind install per host` (GREEN)
- FOUND: `002111db` — `test(39-04): expand starter.test.ts coverage — lifecycle-reset, fire-and-forget failure, adapter shape` (Task 2)

Acceptance criteria (verified via grep + vitest + npm run):
- `grep -c "export function maybeInstallStopHook" src/backend/starter.ts` = 1 (required = 1) ✓
- `grep -c "maybeInstallStopHook(" src/backend/starter.ts` = 2 (required ≥ 2) ✓ (declaration + IIFE call-site)
- `grep -c "installStopHook" src/backend/starter.ts` = 12 (required ≥ 3) ✓
- `grep -c "hookInstallAttempted" src/backend/starter.ts` = 7 (required ≥ 4) ✓
- `grep -cE "fleet_status_hook_install_started|fleet_status_hook_install_success|fleet_status_hook_install_failed" src/backend/starter.ts` = 3 (required ≥ 3) ✓
- `grep -cE "await (deps\.)?installStopHook" src/backend/starter.ts` = 0 (required = 0 — fire-and-forget) ✓
- `grep -c "hookInstallAttempted.clear" src/backend/starter.ts` = 1 (required ≥ 1) ✓
- `grep -c "it(" src/backend/starter.test.ts` = 5 (required ≥ 5) ✓
- `grep -c "maybeInstallStopHook" src/backend/starter.test.ts` = 12 (required ≥ 1) ✓
- `grep -cE "installStopHookMock|installStopHook: vi.fn" src/backend/starter.test.ts` = 11 (required ≥ 1) ✓
- `grep -c "fleet_status_hook_install_failed" src/backend/starter.test.ts` = 1 (required ≥ 1) ✓
- `npm run build:backend` — exit 0 ✓
- `npm run build` — exit 0 ✓
- `npx vitest run src/backend/starter.test.ts` — 5 pass / 0 fail ✓
- `npx vitest run` (full suite) — 180 files / 2264 pass / 6 skipped / 1 todo / 0 fail ✓

TDD gate compliance:
- RED gate: `f4cd8489` (`test:` prefix) — failing test committed first with a no-op stub for the helper
- GREEN gate: `0e3847d1` (`feat:` prefix) — implementation replaced the stub; test passed
- Task 2 gate: `002111db` (`test:` prefix) — additional test coverage-only commit (no source changes; helper already stable)

---
*Phase: 39-fleet-status-gate-2-ssh-poll-decrypt-via-user-session-presen*
*Plan: 04*
*Completed: 2026-08-14*
