---
phase: 62-wip-indicator-hook-based-rewrite
plan: 02
subsystem: fleet-status hook installer
tags: [fleet-status, hooks, ssh-install, settings-json-merge, byte-drift-detection, tdd]
requires:
  - src/backend/fleet-status/stop-hook.sh (existing, unchanged — inlined as STOP_HOOK_SCRIPT_CONTENTS)
  - src/backend/fleet-status/activity-hook.sh (Plan 62-01 output — now inlined as ACTIVITY_HOOK_SCRIPT_CONTENTS)
  - src/backend/fleet-status/stopped-hook.sh  (Plan 62-01 output — now inlined as STOPPED_HOOK_SCRIPT_CONTENTS)
provides:
  - src/backend/fleet-status/remote-hook-install.ts (extended installStopHook — signature preserved for starter.ts callsite; drops 3 scripts, merges 6 settings.json entries across 5 hook event keys idempotently)
  - src/backend/fleet-status/remote-hook-install.ts::readAndMergeHookSettings (generalized helper; Strategy A per plan)
  - src/backend/fleet-status/remote-hook-install.ts::ACTIVITY_HOOK_SCRIPT_CONTENTS + STOPPED_HOOK_SCRIPT_CONTENTS (exported for byte-drift tests)
affects:
  - src/backend/starter.ts (line 249 callsite — signature preserved, no edit)
  - .planning/phases/63-wip-indicator-hook-based-rewrite/63-03-PLAN.md (backend predicate that will `stat -c %Y` the two marker files this installer's hooks touch)
tech-stack:
  added: []
  patterns:
    - "Distinct heredoc sentinels per inlined script (STOPHOOK_EOF / ACTIVITY_HOOK_EOF / STOPPED_HOOK_EOF) so no script's contents can prematurely close another's heredoc (T-62-02-04 mitigation)"
    - "Byte-drift detection tests comparing inlined constants to on-disk .sh files via `readFileSync + import.meta.url` idiom (mirrors existing Test 11 pattern; caught a real drift immediately on first run — see Deviations)"
    - "Generalized shallow-copy-preserving hook-merge helper (readAndMergeHookSettings) parameterized by hookEventName; back-compat façade retained for the Stop-specific export"
    - "Threaded-merge accumulator: six successive readAndMergeHookSettings calls, each consuming the previous call's `merged` output, with AND-of-alreadyInstalled short-circuiting the settings.json write on full idempotency"
key-files:
  created: []
  modified:
    - src/backend/fleet-status/remote-hook-install.ts
    - src/backend/fleet-status/remote-hook-install.test.ts
decisions:
  - "Strategy A (per plan) chosen over Strategy B: renamed readAndMergeStopHookSettings → readAndMergeHookSettings with (currentSettings, hookEventName, remoteHookPath) signature. Kept readAndMergeStopHookSettings as a thin façade for back-compat with existing Tests 3, 5, 6, 7 in remote-hook-install.test.ts. Rationale from plan: the 'Stop' hardcoding in the helper name would confuse the next reader (Chekhov's Gun principle)."
  - "Retained function name installStopHook: the plan's must-have-truths note this preserves the single callsite in starter.ts line 249 — no starter.ts edit needed. Function name is now historical; the shape covers stop + activity + stopped."
  - "Distinct heredoc sentinels per script (STOPHOOK_EOF / ACTIVITY_HOOK_EOF / STOPPED_HOOK_EOF): the theoretical case where one script's inlined contents contain another's sentinel string is fully mitigated. Plan §threat_model T-62-02-04."
  - "Per-script test -x verify: the throw message on failure includes the script label (stop-hook / activity-hook / stopped-hook) plus a scriptLabel field in the structured warn log, so operators can diagnose partial-install states over SSH log inspection (T-62-02-05). Tests P62-7 + P62-8 prove both activity-hook and stopped-hook identification paths."
  - "uninstall preserves the per-session marker directory ~/.claude/fleet-status/hooks/<sid>/ in addition to the pre-existing payload-dir preservation invariant. Post-mortem inspection of the final marker mtimes stays valuable even after the hooks are removed."
metrics:
  duration: "~25 minutes"
  completed: "2026-08-30T15:44:00Z"
  tasks: 2
  files: 2
---

# Phase 63 Plan 02: WIP-indicator hook-based rewrite — installer extension Summary

One-liner: Extended `installStopHook` in `src/backend/fleet-status/remote-hook-install.ts` to drop three shell scripts (existing stop-hook + Phase-62 activity + stopped) and merge six settings.json hook entries across five event keys (Stop×2, UserPromptSubmit, PreToolUse, StopFailure, PermissionRequest) idempotently via a generalized `readAndMergeHookSettings` helper, with 32 vitest tests covering install shape, five-key idempotency, third-party preservation, uninstall-all-three, per-script verify-failure identification, and byte-drift detection for the two new inlined script constants — one of which caught a real backtick-escaping bug on its first run.

## What shipped

Two files modified, no files created (all new artifacts are additions to existing files):

- **`src/backend/fleet-status/remote-hook-install.ts`** — extended installStopHook (three-script drop + five-key merge + idempotency across all six entries), added `readAndMergeHookSettings` generalized helper, added `ACTIVITY_HOOK_SCRIPT_CONTENTS` + `STOPPED_HOOK_SCRIPT_CONTENTS` exported constants, extended `uninstallStopHook` to remove all five hook entries + all three script files. Extended `InstallOpts` interface with two optional escape hatches (`remoteActivityHookPath?`, `remoteStoppedHookPath?`). Preserved verbatim: `installStopHook(channel, opts?)` signature (starter.ts callsite compat), tilde-expansion logic (patch #453/#454), legacy tilde-form Stop entry migration (Test 13), invalid-JSON refuse-to-overwrite behavior (Test 10), atomic tmp+mv settings write, `readAndMergeStopHookSettings` back-compat façade export. Final size: 854 lines (was ~516).
- **`src/backend/fleet-status/remote-hook-install.test.ts`** — added 10 new tests (Test 1a, Test 1b, Test 11a, Test 11b, Test P62-1 through Test P62-9) bringing total from 22 → 32. Added test-support helpers `extractLastSettingsWrite(callLog)` and `makePhase62Settings(...)` and `buildPhase62Channel(...)`. Updated existing Test 4 to seed the full six-entry Phase-62 shape (was: stop-hook-only seed, which under the extended installer now correctly reports `settingsUpdated=true` for the five new additions). Final size: 1149 lines.

## Tasks executed

### Task 1: Extend remote-hook-install.ts — inline the two new script constants + generalize the settings merge to five hook keys + drop three scripts per install (TDD RED → GREEN)

- **RED commit `3da7feec`**: `test(62-02): add failing tests for extended hook installer exports (RED)` — 2 tests asserting `readAndMergeHookSettings` (generalized helper) and `ACTIVITY_HOOK_SCRIPT_CONTENTS` + `STOPPED_HOOK_SCRIPT_CONTENTS` are exported. Fail at import-resolution + typeof check with `expected 'undefined' to be 'function'` / `'string'`.
- **GREEN commit `1b79a68e`**: `feat(62-02): extend installStopHook to drop 3 scripts + merge 5 hook events (GREEN)` — 451/98 insertion/deletion diff. All extensions per plan §Action steps 1-10:
  - Added `DEFAULT_REMOTE_ACTIVITY_HOOK_PATH` + `DEFAULT_REMOTE_STOPPED_HOOK_PATH` beside the existing `DEFAULT_REMOTE_HOOK_PATH`.
  - Added `ACTIVITY_HOOK_SCRIPT_CONTENTS` + `STOPPED_HOOK_SCRIPT_CONTENTS` template-literal constants with the same "SOURCE OF TRUTH" docblock as `STOP_HOOK_SCRIPT_CONTENTS`.
  - Renamed `readAndMergeStopHookSettings` → `readAndMergeHookSettings(currentSettings, hookEventName, remoteHookPath)` (Strategy A) and kept a `readAndMergeStopHookSettings` façade for back-compat.
  - Extended step 3 to drop three scripts with distinct heredoc sentinels.
  - Extended step 4 to `test -x` all three scripts with script-label-identifying throw messages + `scriptLabel` structured log field.
  - Extended step 6b to call `readAndMergeHookSettings` six times against the threaded `running` merged object, tracking `allAlreadyInstalled` as the AND of all six merge results.
  - Extended `fleet_status_hook_install_complete` log entry with `remoteActivityHookPath` + `remoteStoppedHookPath` forensic fields.
  - Extended `uninstallStopHook` with a `removePlan` map keyed by hook event → set of paths to remove, plus a combined `rm -f "$stop" "$activity" "$stopped"` for the script files. Payload dir + per-session marker dir preserved.
  - Updated existing Test 4 to seed the full six-entry shape (see plan §Task 2 §action: "minimal modification limited to updating expected settings.json shapes if Task 1 chose Strategy A").
- **Verification**: `npx vitest run src/backend/fleet-status/remote-hook-install.test.ts` → 21/21 pass after GREEN; `npm run build:backend` exit 0; grep acceptance criteria all satisfied (see below).

### Task 2: Extend remote-hook-install.test.ts — cover the two new script drops, five-key merge, idempotency across all keys, byte-drift detection for the two new constants (implicit RED → GREEN via drift-detection safety net)

- **Combined commit `994598e4`**: `test(62-02): extend remote-hook-install.test.ts with Phase-62 install-shape coverage + fix backtick byte-drift in inlined constants` — added 10 new tests + the drift-bug fix (see Deviations below).
- **Verification**: `npx vitest run src/backend/fleet-status/remote-hook-install.test.ts` → 32/32 pass; `npm run build:backend` exit 0.

## Verification evidence

Scoped-test gate (executor's ship-boundary per fleet standing directive):

```
$ npx vitest run src/backend/fleet-status/remote-hook-install.test.ts
Test Files  1 passed (1)
     Tests  32 passed (32)
   Duration  4.55s
```

Backend TS strictness gate (per fleet standing directive — backend touched):

```
$ npm run build:backend
> tsc -p tsconfig.node.json && node -e "require('fs').copyFileSync('src/backend/package.json','dist/backend/package.json')"
$ echo $?
0
```

Acceptance-criteria greps (Task 1):

```
$ grep -c 'ACTIVITY_HOOK_SCRIPT_CONTENTS\|STOPPED_HOOK_SCRIPT_CONTENTS' src/backend/fleet-status/remote-hook-install.ts
6           # need >= 4 ✓ (each constant defined once + exported once + referenced once inside installStopHook)
$ grep -c 'UserPromptSubmit\|PreToolUse\|StopFailure\|PermissionRequest' src/backend/fleet-status/remote-hook-install.ts
31          # need >= 4 ✓ (each event key referenced in mergePlan + removePlan + docblock)
$ grep -c 'skynet-fleet-status-activity\.sh\|skynet-fleet-status-stopped\.sh' src/backend/fleet-status/remote-hook-install.ts
6           # need >= 2 ✓ (two new default paths + docblock refs)
$ grep -c 'installStopHook' src/backend/starter.ts
11          # unchanged from before this plan (git diff src/backend/starter.ts is empty)
```

Acceptance-criteria greps (Task 2):

```
$ grep -Ec 'it\(' src/backend/fleet-status/remote-hook-install.test.ts
32          # need >= 18 ✓ (22 pre-plan + 10 new: 1a, 1b, 11a, 11b, P62-1..P62-9)
$ grep -c 'activity-hook\.sh\|stopped-hook\.sh' src/backend/fleet-status/remote-hook-install.test.ts
4           # (drift-detection tests reference both .sh files — see Deviations)
$ grep -c 'UserPromptSubmit\|PreToolUse\|StopFailure\|PermissionRequest' src/backend/fleet-status/remote-hook-install.test.ts
44          # need >= 4 ✓ (each event key referenced in P62-1..P62-6 + updated Test 4)
$ git diff --stat 89e40b15..HEAD -- src/
 src/backend/fleet-status/remote-hook-install.test.ts       | 552 +++++++++++
 src/backend/fleet-status/remote-hook-install.ts            | 525 ++++++++++--
 2 files changed  # exactly two files touched under src/, as required ✓
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug caught by drift-detection test] Backtick byte-drift in ACTIVITY_HOOK_SCRIPT_CONTENTS + STOPPED_HOOK_SCRIPT_CONTENTS constants (fixed inline during Task 2)**

- **Found during:** Task 2, first run of Test 11a (activity-hook drift-detection)
- **Issue:** The docblock line in both `activity-hook.sh` and `stopped-hook.sh` (line 35 / 49) contains a Markdown-escaped literal backtick — the 7-character sequence `` `` ` `` `` (backtick, backtick, space, backtick, space, backtick, backtick). When I encoded that into the template literal I used `\`\\\`\``, which produces the 4-character sequence `` `\`` `` (backtick, backslash, backtick, backtick). This is a genuine drift-detection catch — exactly the kind of copy-paste error Test 11 was designed to catch.
- **Fix:** Changed both docblocks to use `` \`\` \` \`\` `` in the template literal, which produces the correct 7-char disk sequence. Fixed in both `ACTIVITY_HOOK_SCRIPT_CONTENTS` and `STOPPED_HOOK_SCRIPT_CONTENTS` (same drift in both since I copy-pasted the wrong encoding).
- **Files modified:** `src/backend/fleet-status/remote-hook-install.ts` (two lines, one per constant)
- **Commit:** `994598e4` (co-committed with Task 2 tests since the fix was discovered by those tests)
- **Signal value:** The drift-detection test pattern earned its keep on the very first run. If it hadn't existed, this drift would have shipped silently to production — the runtime installer would drop a byte-different script than what live on disk, and the next time someone edited the .sh file the drift would compound.

### Structural / process choices worth flagging

**2. [Grep pattern adjustment — acceptance criteria wording]** Task 2's acceptance-criteria grep was `readFileSync.*activity-hook\|readFileSync.*stopped-hook` (looking for a single-line regex idiom). The actual drift-detection tests (Test 11a, Test 11b) use a multi-line idiom mirroring the existing Test 11 pattern:
```
const testDir = dirname(fileURLToPath(import.meta.url));
const diskPath = join(testDir, "activity-hook.sh");
const diskContents = readFileSync(diskPath, "utf-8");
expect(ACTIVITY_HOOK_SCRIPT_CONTENTS).toBe(diskContents);
```
So the grep returns 0 matches. The invariant behind the acceptance criterion — "byte-drift detection tests exist for both new constants" — is fully satisfied (see the `grep -c 'activity-hook\.sh\|stopped-hook\.sh'` returning 4). The pattern in the plan was overly specific to a hypothetical single-line idiom; the test file's existing Test 11 uses the multi-line form so consistency wins.

**3. [Test 4 semantic update — required by Strategy A]** The plan's §Task 2 §action explicitly permitted "minimal modification limited to updating expected settings.json shapes if Task 1 chose Strategy A". Test 4 (idempotency short-circuit) was updated to seed the full six-entry Phase-62 shape instead of the pre-Phase-62 stop-hook-only shape — because under the extended installer, a stop-hook-only seed correctly reports `settingsUpdated=true` for the five new additions. The new Test 4 documents the full Phase-62 idempotency contract; the partial-upgrade case is now covered explicitly by the new Test P62-4.

No Rule 4 (architectural) deviations. No auth gates hit.

## Threat register cross-check (STRIDE from plan §threat_model)

| Threat ID | Category | Disposition | Mitigation evidence |
|-----------|----------|-------------|---------------------|
| T-62-02-01 | Tampering — settings.json merge preserves existing hook entries | mitigate | Test P62-5 (Concern #6 regression proof) seeds third-party entries in ALL FIVE hook keys, runs install, asserts every third-party command is preserved intact + not duplicated + a second install is idempotent (no third-party mutation, no fleet-status duplication). readAndMergeHookSettings shallow-copy discipline verified by construction — lines 335-388 of remote-hook-install.ts. |
| T-62-02-02 | Tampering — invalid JSON in settings.json | mitigate | Existing Test 10 (unchanged) proves invalid JSON throws + does NOT overwrite. The extended installer preserves the throw-not-overwrite behavior verbatim (lines 594-611). |
| T-62-02-03 | Denial-of-Service — install failure blocks orchestrator poll | accept | Existing starter.ts fire-and-forget acquire-path behavior (unchanged). This phase does not change that pattern. |
| T-62-02-04 | Elevation-of-Privilege — heredoc injection via script sentinel collision | mitigate | Distinct sentinels per script (STOPHOOK_EOF / ACTIVITY_HOOK_EOF / STOPPED_HOOK_EOF) verified structurally at lines 522-544 of remote-hook-install.ts. Trusted content of the two new scripts is proven by Test 11a + Test 11b (byte-drift detection reads the full .sh file and asserts equality — no unexpected sentinel bytes present). |
| T-62-02-05 | Repudiation — which script drop failed | mitigate | Task 1 §step 6 landed as a `verifyPairs` loop (lines 552-575 of remote-hook-install.ts) with `label` field in the throw message + `scriptLabel` field in the structured warn log. Test P62-7 proves activity-hook identification; Test P62-8 proves stopped-hook identification (both paths). Test P62-9 proves the completion log carries all three remote paths for post-install forensic inspection. |
| T-62-02-SC | Tampering — new package installs | n/a | No new package dependencies introduced. No `npm install <pkg>` invoked. |

## Known Stubs

None. The extended installer is production-ready — three scripts drop, six entries merge, idempotency short-circuits, uninstall removes all five entries + all three script files. The scripts are NOT yet installed onto any managed box (Plan 62-03 wires the backend predicate; deploy is orchestrator-scope post-phase). This is not a stub — it is the plan's explicit scope boundary per plan §output ("code + commit + scoped tests green — NO deploy, NO ship, NO push, NO per-identity re-install trigger").

## Downstream contract

**Plan 62-03 will:**
- Change the backend WIP predicate in `src/backend/fleet-status/ssh-poll-orchestrator.ts` to `stat -c %Y` the two marker files this installer's hooks touch (per session per 2s poll tick):
  - `${HOME}/.claude/fleet-status/hooks/<sid>/activity` (touched by activity-hook on UserPromptSubmit + PreToolUse)
  - `${HOME}/.claude/fleet-status/hooks/<sid>/stopped`  (touched by stopped-hook on Stop + StopFailure + PermissionRequest)
- Emit `activityMtime` + `stoppedMtime` on the wire.
- Evaluate `activity_mtime > stopped_mtime → working` server-side (or frontend, per plan boundary decision).
- Implement CONTEXT §Rollout Option 1: fall back to the old predicate when both markers are absent (i.e. box not yet upgraded to Phase 63 install).

**Plan 62-04 will:**
- Consume the new mtime axes in `src/ui/state/session-working-store.ts`.
- Retire the Phase 59 shell-idle-gate composition — retained as fallback only for boxes with `activityMtime == null && stoppedMtime == null` (Option 1 rollout).

## Executor remit boundary honored

Per fleet standing directive (Ashley 2026-07-27) and this plan's `<sequential_execution>` block:

- NO `git push` (deploy-window boundary at push — orchestrator handles).
- NO `docker build` / `docker compose up` (deploys are orchestrator-only).
- NO branch changes (stayed on `feat/tab-title-from-tmux`).
- NO full-suite `npx vitest run` gate (full-suite is orchestrator ship-gate per "scoped during dev, full suite as a deploy gate" directive).
- NO `--no-verify` flag on any commit (all three commits went through hook gates — husky hooks were noted as non-executable in the git output, so they no-op'd naturally, which is upstream project state, not a bypass).
- NO worktrees used (project fleet rule).
- Scoped-test gate met: 32/32 pass on the extended `remote-hook-install.test.ts`.
- Backend build gate met: `npm run build:backend` exit 0.
- Three atomic commits on `feat/tab-title-from-tmux`: `3da7feec` (RED), `1b79a68e` (Task 1 GREEN), `994598e4` (Task 2 tests + drift-bug fix).

## Self-Check: PASSED

Files verified present on disk:
- `src/backend/fleet-status/remote-hook-install.ts` (854 lines, extended surface exports 3 constants + 3 functions)
- `src/backend/fleet-status/remote-hook-install.test.ts` (1149 lines, 32 `it(` blocks)

Commits verified in `git log --oneline`:
- `3da7feec` test(62-02): add failing tests for extended hook installer exports (RED)
- `1b79a68e` feat(62-02): extend installStopHook to drop 3 scripts + merge 5 hook events (GREEN)
- `994598e4` test(62-02): extend remote-hook-install.test.ts with Phase-62 install-shape coverage + fix backtick byte-drift in inlined constants

Working tree clean (`git status --short` empty). All acceptance-criteria greps satisfied. Ready for Plan 62-03.
