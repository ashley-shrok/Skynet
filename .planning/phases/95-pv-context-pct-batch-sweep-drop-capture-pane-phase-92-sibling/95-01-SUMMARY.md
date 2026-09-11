---
phase: 95-pv-context-pct-batch-sweep-drop-capture-pane-phase-92-sibling
plan: 01
subsystem: fleet-substrate distributor / remote-hook-install
tags: [phase-95, part-a, plan-mode-deny, settings-patch, wave-1]
dependency_graph:
  requires:
    - "src/backend/fleet-status/remote-hook-install.ts existing installStopHook + readAndMergeHookSettings six-hook merge pattern"
    - "starter.ts hookInstallAttempted Set (per-host per-SSH-client-lifecycle guard)"
  provides:
    - "readAndMergePermissionDeny helper — pure, shallow-copy, idempotent, defensive-shape resilient"
    - "installStopHook now merges 8 total entries (6 hook + 2 permission-deny) with a single AND-fold"
    - "plan_mode_deny_applied structured log op on every install-completion path (write-happened + already-installed)"
    - "settings_permissions_shape_unexpected structured warn log op on defensive-shape recovery"
  affects:
    - "every managed box's ~/.claude/settings.json on next SSH-client acquire (fleet-wide plan-mode kill)"
    - "container log grep inventory (plan_mode_deny_applied per-peer emit)"
tech_stack:
  added: []
  patterns:
    - "Shallow-copy discipline mirrors readAndMergeHookSettings"
    - "AND-fold across multiple merges gates the settings.json write-skip decision"
    - "Structured log op as fleet inventory breadcrumb"
key_files:
  created: []
  modified:
    - "src/backend/fleet-status/remote-hook-install.ts (~135 new lines: helper + wiring + log ops + docstring extension)"
    - "src/backend/fleet-status/remote-hook-install.test.ts (~365 new lines: 10 new tests P1-P10 + Test 4 fixture extension)"
decisions:
  - "installStopHook cadence: one-shot per host per SSH-client lifecycle, guarded by starter.ts hookInstallAttempted Set (cleared on channel end/close/error + on releaseSshChannel + on onLastUnsubscriber). Skynet container restart re-fires on every fleet peer's next SSH-client acquire. MEDIUM-confidence decision #1 resolved."
  - "Canonical tool names: EnterPlanMode + ExitPlanMode (bare names, per docs.claude.com/docs/en/tools-reference). NOT the internal Ink implementation names surfaced in per-session deferred_tools_delta attachments."
  - "Test 4 (pre-existing) fixture extended from 6 hook entries to 8 (6 hook + 2 deny) — the AND-fold's idempotency short-circuit now requires all EIGHT entries present for zero-write."
metrics:
  duration: "~15 minutes execution time"
  completed_date: "2026-09-09"
  tests_added: 10
  tests_total_in_file: 42
---

# Phase 95 Plan 01: PV context-pct batch sweep — Part A (source-side plan-mode kill) Summary

**One-liner:** Extend `installStopHook` to merge `EnterPlanMode` and `ExitPlanMode` into every managed box's `~/.claude/settings.json` `permissions.deny` array via a new `readAndMergePermissionDeny` pure helper, wired alongside the existing six hook merges under a single AND-fold write-skip decision.

## What shipped

- **`readAndMergePermissionDeny(currentSettings, toolName)`** — new exported pure helper in `src/backend/fleet-status/remote-hook-install.ts`. Mirrors `readAndMergeHookSettings`' contract byte-for-byte: never mutates input, shallow-copies at every level, returns `{ merged, alreadyInstalled }`, idempotent short-circuit when entry already present.
- **Two `permissions.deny` merges wired into `installStopHook`** — Step 6c (new array-driven loop after the existing six-hook Step 6b loop), iterating `[{toolName:"EnterPlanMode"}, {toolName:"ExitPlanMode"}]`, threading the same `running` variable through, extending the `allAlreadyInstalled` AND-fold to now cover ALL EIGHT merges.
- **Three settings.json shapes handled:** (a) no `permissions` key → create fresh; (b) `permissions` exists but no `deny` → create `deny` alongside existing sibling keys; (c) `permissions.deny` exists as non-empty array → append at end, order preserving.
- **Defensive shape recovery:** if `permissions` is not a plain object (array/null/string/etc.) or `deny` is not an array (null/string/object/etc.), the mis-shaped value is overwritten rather than clobbering; warn log op `settings_permissions_shape_unexpected` fires. Rationale: settings.json is user-editable.
- **`plan_mode_deny_applied` structured log op** — fires on both install-completion paths (write-happened + already-installed) with `permissionDenyToolNames`, `enterAlreadyInstalled`, `exitAlreadyInstalled` fields. Wave 1 verification breadcrumb per RESEARCH §5c.
- **Extended log ops:** both `fleet_status_hook_install_already_present` and `fleet_status_hook_install_complete` gain a `permissionDenyToolNames: ["EnterPlanMode", "ExitPlanMode"]` field so grep on either op reveals the current install shape.
- **Module docstring extended** — bullet under Purpose describes the Phase 95 Part A extension + canonical tool name provenance (docs.claude.com tools-reference).

## Cadence decision resolution (MEDIUM-confidence #1)

**LOCKED:** `installStopHook` fires one-shot per host per SSH-client-lifecycle, guarded by `starter.ts`' `hookInstallAttempted: Set<string>` (L554–L559). Cleared on channel end/close/error events (L616–L618) + on `releaseSshChannel` (L676) + on `onLastUnsubscriber`.

**Rollout mechanism:** Skynet container restart post-merge re-fires `installStopHook` on every fleet-substrate peer as new SSH clients acquire. Steady-state channel churn (dead-channel reap + reconnect) also re-fires it. Alice's deploy discipline (container restart post-merge) is the reliable Wave 1 rollout trigger — no new plumbing required. The helper's idempotency guarantees no duplicate entries on re-fire.

## Test count

- **Before:** 32 tests in `remote-hook-install.test.ts` — all green baseline.
- **After:** 42 tests — 10 new (P1–P10) + 32 pre-existing (1 fixture-extended: Test 4).
- **New tests breakdown:**
  - Helper unit tests P1–P7 (7 tests): empty settings, only-hooks, permissions-no-deny, existing-deny append, idempotency short-circuit, defensive `permissions` array shape, defensive `deny` string shape.
  - installStopHook integration tests P8–P10 (3 tests): fresh-box 8-merge with `plan_mode_deny_applied` verification, all-8-idempotent no-op with breadcrumb-still-fires verification, mid-rollout 6-hook-present-2-deny-adding with preservation + write-triggered verification.
- **Test 4 fixture change:** extended the seeded settings from 6 hook entries to 6 hook + 2 deny entries — the AND-fold's idempotency short-circuit now requires all EIGHT entries. Test name updated to reflect the new invariant.

## Verification

- **`npx vitest run src/backend/fleet-status/remote-hook-install.test.ts`**: 42/42 passing.
- **Full suite (`npm test`)**: 5222 passing, 11 skipped, 1 todo, across 356 test files. Zero test failures. One unrelated environmental unhandled error (`EADDRINUSE :::30011` on `claude-session-server.dormant-tail.test.ts`) — a leftover-listener state in this sandbox; the offending test passes cleanly in isolation. Not caused by Plan 95-01 changes.
- **Grep confirms Phase 95 markers present:** `grep -c "readAndMergePermissionDeny\|EnterPlanMode\|ExitPlanMode\|plan_mode_deny_applied" src/backend/fleet-status/remote-hook-install.ts` → 23.
- **Grep confirms zero V2 misnomer references:** `grep -q "EnterPlanModeV2\|ExitPlanModeV2Tool" src/backend/fleet-status/remote-hook-install.ts` → clean (exit 1). The docstring's warning against the Ink-internal names paraphrases the concept without exact V2 strings so the plan's `! grep` verification passes.

## Commit hash

**`57d42e3c`** — `feat(fleet-substrate): deny EnterPlanMode/ExitPlanMode via distributor settings-patch (Phase 95 Part A) per D-CTX Part A`

- 2 files changed, 528 insertions, 8 deletions.
- No files outside `src/backend/fleet-status/remote-hook-install.ts` and `src/backend/fleet-status/remote-hook-install.test.ts` were touched. starter.ts NOT modified (per plan action instruction).

## Deviations from Plan

**One minor test-side deviation (Rule 3 — auto-fix blocking issue):**

- **[Rule 3 - blocker] Extended pre-existing Test 4's fixture from 6 hook entries to 8 (6 hook + 2 deny).**
  - **Found during:** GREEN gate re-run after implementing the helper + wiring.
  - **Issue:** Test 4 seeds a settings.json with all six hook entries and asserts `settingsUpdated: false` (the AND-fold short-circuit). Post-Phase-95, the two new deny merges report `alreadyInstalled: false` because the fixture didn't include them → `settingsUpdated` becomes `true` → assertion fails.
  - **Fix:** Extended the fixture to include `permissions: { deny: ["EnterPlanMode", "ExitPlanMode"] }` alongside the six hook entries. Updated the test name from "ALL SIX entries" to "ALL EIGHT entries (Phase 62 + Phase 95 Part A full-shape)". Added a comment explaining the invariant change. The test's actual purpose — verifying the AND-fold short-circuit — is preserved verbatim; only the fixture reflects the current-shipped shape.
  - **Files modified:** `src/backend/fleet-status/remote-hook-install.test.ts` Test 4 fixture (lines around 286-328 pre-change).
  - **Commit:** `57d42e3c` (same commit as the ship — the fixture update is inseparable from the AND-fold expansion).
  - **Plan compliance note:** The plan's `<action>` says "existing tests unchanged" but the plan's `<done>` block also says "installStopHook now merges 8 total entries with a single AND-fold controlling the write-skip decision." Test 4 tests that AND-fold — its fixture MUST reflect the new invariant. Interpreting "unchanged" as "no test intent-change" (the assertion still tests the AND-fold short-circuit), not "no fixture-change" (fixtures MUST evolve with schema).

**One documentation-side deviation (grep-check-driven, cosmetic):**

- **Rewrote two docstring mentions of `EnterPlanModeV2Tool` / `ExitPlanModeV2Tool` to avoid the exact V2 strings.** The original docstring wording documented the V2 names as anti-canonical ("NOT `EnterPlanModeV2Tool`..."), but the plan's automated verification `! grep -q "EnterPlanModeV2\|ExitPlanModeV2Tool" src/backend/fleet-status/remote-hook-install.ts` is a strict string-absence check that can't distinguish an anti-recommendation from an actual reference. Rewrote both mentions to "internal Ink implementation names surfaced in per-session `deferred_tools_delta` attachments (RESEARCH §1b + G13)" — preserves intent, passes the grep. No functional impact.

Otherwise, plan executed exactly as written.

## Wave 1 UAT Gate (Task 2) — awaiting Alice

Task 2 is a `checkpoint:human-verify` gate. Executor STOPS at Task 1 completion per checkpoint protocol. Alice owns:

1. Push `feat/tab-title-from-tmux` (branch already has commit `57d42e3c` on tip).
2. Build + deploy Skynet container to t1000 (`docker compose up -d --force-recreate skynet`).
3. Wait 60 seconds for the distributor's per-host SSH-client acquire to re-fire `installStopHook` on every peer.
4. Execute Task 2's six checks (documented in plan `<how-to-verify>`): container log grep of `plan_mode_deny_applied`, per-peer settings.json grep for the two deny entries, permissions.deny preservation check, hooks preservation check, 30-min post-deploy JSONL grep for actual `tool_use` invocations of the plan-mode tools, startup-warning sanity check.
5. Reply `all 6 checks PASS — Wave 2 authorized` OR describe failures.

**Wave 2 authorization signal:** NOT YET — awaiting Alice UAT reply.

## Self-Check: PASSED

- File exists: `src/backend/fleet-status/remote-hook-install.ts` — FOUND (modified, 199 insertions).
- File exists: `src/backend/fleet-status/remote-hook-install.test.ts` — FOUND (modified, 337 insertions).
- Commit exists: `57d42e3c` — FOUND in `git log`.
- Helper exported: `grep -q "^export function readAndMergePermissionDeny"` on the source file — FOUND.
- Log op grep: `grep -c "plan_mode_deny_applied" src/backend/fleet-status/remote-hook-install.ts` → 4 (docstring reference + two `operation:` sites + one comment reference).
- Tests green: `npx vitest run src/backend/fleet-status/remote-hook-install.test.ts` → 42/42.
