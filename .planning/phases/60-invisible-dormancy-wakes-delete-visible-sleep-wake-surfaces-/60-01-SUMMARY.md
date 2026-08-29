---
phase: 60-invisible-dormancy-wakes
plan: 01
subsystem: backend/claude-session
tags: [dormancy, wake, send-path, sentinel, resume-complete, marker-freshness, invisible-ui]

# Dependency graph
requires:
  - phase: 55-tap-to-load-discovery-reuse
    provides: "Claude-session attach reuses fleet-status backend's cached sessionFile answer instead of re-running its own ~4s serial SSH discovery loop — establishes the connection-scoped state hygiene this plan relies on."
provides:
  - "Send-while-dormant branch inside `__applyInputMessageForTests` — on entry, if `dormantLastEmitted() === true`, drops the `.dormant` sentinel, records `wakeTriggerTs`, polls `.resume-complete` until fresh (or MARKER_FALLBACK_MS elapses), then falls through to the normal split-send delivery unchanged."
  - "`wakingSince` emission SUPPRESSED at all three dormant-emit sites (`__applyDormantPollTickForTests` L1934, `__applyDormantPollWithRediscoveryForTests` L2577, connection-scope initial-discovery-dormant path L6899). Frontend can no longer reconstruct waking UI."
  - "`wakeTriggerTs?` getter DELETED from `__DormantStateForTests` type + its sole production caller (`const dormantState: __DormantStateForTests = {...}` at L6369). The connection-closure `let wakeTriggerTs` var itself PRESERVED — still written by the wake handler, by the new send-while-dormant path, and read by the rediscovery-seam marker-freshness gate."
  - "Four new SWD test cases + two flipped guard-tests in `dormant-poll.test.ts` covering marker-fresh success, MARKER_FALLBACK_MS fallback, two-send ordering, awake-pane no-op."
  - "New forensic log operations: `pv_input_dormant_send_start`, `pv_input_dormant_sentinel_drop_failed`, `pv_input_dormant_wait_marker`, `pv_input_dormant_marker_fresh`, `pv_input_dormant_marker_fallback` — each with `hostId`, `tmuxSession`, `mqid`, and `elapsedMs` (where applicable) for post-hoc forensic diagnosis."
affects: [60-02 pv-send-watchdog widening (consumes `dormantSend: wasDormant` derived from the closure var this plan introduced at the top of __applyInputMessageForTests), 60-03 frontend deletion (consumes the `{type:"dormant"}` frames no longer carrying `wakingSince` — DormancyOverlay + wake handler removal becomes safe)]

# Tech tracking
tech-stack:
  added: []
  patterns: [Reuse of existing marker-freshness contract (MARKER_FALLBACK_MS = 90_000ms) as invisible-wake gate; symmetric sentinel-drop shape across wake handler and send-path (same `rm -f ~/.claude/identities/'<name>'/.dormant` command); connection-scoped `wakeTriggerTs` as shared clock across three writers (wake handler, send-path, rediscovery seam) and one reader (marker-freshness gate); logger mock at test-file top mirroring `claude-session-server.optimistic-bubbles.integration.test.ts`]

key-files:
  created: []
  modified:
    - "src/backend/claude-session/claude-session-server.ts (send-while-dormant branch + wakingSince suppression at 3 sites + L6369 caller deletion + 4 new deps on __applyInputMessageForTests signature + wire-up at L5758)"
    - "src/backend/claude-session/dormant-poll.test.ts (4 SWD tests added + 2 legacy assertions flipped + 4-it old Test P block deleted + 2-it Phase 60 guard-block added + full sshLogger mock added at file top)"

key-decisions:
  - "Preserve `msg.type === 'wake'` handler + `__applyWakeMessageForTests` seam byte-for-byte (Plan 03 deletes them after frontend cleanup). Rationale: any in-flight frontend can still call it during the deploy window if needed."
  - "Preserve `let wakeTriggerTs` closure var (~L3161 in current file — plan comments read '~L1264' from an earlier revision). Still written by 3 sites (wake handler L5828, new send-path, rediscovery-seam) and read by 1 (marker-freshness gate). Deleting it would break the natural-user-wake path today AND Plan 01's own send-path can't set the freshness gate without it."
  - "The BLOCKER fix from plan-checker pass 1: deleted `wakeTriggerTs: () => wakeTriggerTs,` line at L6369 in the production `const dormantState: __DormantStateForTests = {...}` construction alongside the type-field removal at L1881. Without this deletion `npm run build:backend` fails with a TS excess-property error on the object literal."
  - "SWD-2 asserts on `sshLogger.info` fallback-log operation via full logger-module mock at the test file top (added in this plan, mirrors optimistic-bubbles.integration.test.ts pattern). Alternative — spy-on-existing — was rejected because the existing test file had no logger import at all."
  - "Send-while-dormant branch reads `dormantLastEmitted` BEFORE the MAX_INPUT_BYTES cap. Rationale documented inline: even a rejected oversize send is a user action on this pane; sentinel drop should still fire (send won't deliver, but wake will complete). Cost: one no-op sentinel drop for oversize sends into dormant panes; forensic log at the send-start operation captures it."

patterns-established:
  - "Send-path wake trigger: user-action-driven side-effect wake with no visible UI. Same shape as Matrix DM and scheduled fire (invisible triggers already in production). Send joins them as the third invisible trigger."
  - "Marker-freshness gate as the load-bearing contract for 'harness is up and ready to accept a prompt'. Shared by the pre-existing dormant-poll rediscovery path AND the new send-while-dormant path. Do NOT bypass — the 500ms polling loop with fresh-timestamp check is what prevents send-keys from firing into shell / /id output routing."
  - "Symmetric sentinel-drop across handlers: `rm -f ~/.claude/identities/'<name>'/.dormant` is now called from THREE sites in claude-session-server.ts (wake handler at L5828 flow, wake-message seam at L2487, new send-path). All three use the connection-scoped currentTmuxSession (T-cd6-01 trust posture); none accept client-supplied hostId/tmuxSession."

requirements-completed: []

# Metrics
duration: 19min
completed: 2026-08-23
---

# Phase 60 Plan 01: Backend send-while-dormant path + wakingSince suppression Summary

**Backend send-path now invisibly wakes dormant panes on `input` WS frame (drops `.dormant` sentinel + polls `.resume-complete` marker with 90s fallback + falls through to normal split-send) AND stops leaking `wakingSince` timestamps to the frontend, closing the backend half of Phase 60.**

## Performance

- **Duration:** ~19 min (planner start 19:00 UTC → test commit 19:19 UTC)
- **Started:** 2026-08-23T19:00:00Z
- **Completed:** 2026-08-23T19:19:00Z
- **Tasks:** 2 of 2 complete
- **Files modified:** 2

## Accomplishments

- Send-while-dormant branch lands: on `input` frame with `dormantLastEmitted() === true`, backend records `wakeTriggerTs`, drops the sentinel, polls `.resume-complete` at 500ms cadence until marker_ts > triggerTs OR MARKER_FALLBACK_MS elapses, then falls through to normal split-send. Byte-identical send delivery to today's awake-pane path after the marker gate passes.
- `wakingSince` field suppressed at all three dormant-emit sites (L1934, L2577, L6899). Frontend can no longer reconstruct waking UI from `{type:"dormant"}` frames — DormancyOverlay deletion in Plan 03 becomes safe.
- The plan-checker BLOCKER fix landed cleanly: `wakeTriggerTs?` type field deleted from `__DormantStateForTests` AND the L6369 production caller `wakeTriggerTs: () => wakeTriggerTs,` deleted in the same commit. Backend TS build passes with exactly ONE remaining `wakeTriggerTs: () => wakeTriggerTs` line (the L7013 rediscovery-seam wire-up which targets the different `state.wakeTriggerTs` getter on `__applyDormantPollWithRediscoveryForTests`).
- Four new SWD test cases (SWD-1 marker-fresh success, SWD-2 MARKER_FALLBACK_MS fallback + fallback-log assertion, SWD-3 two-send ordering + idempotent-drop, SWD-4 awake-pane no-op) prove the new path. Two legacy `wakingSince`-carrying tests flipped to `.not.toHaveProperty('wakingSince')` guards. Old Test P block (four `it` cases whose sole purpose was the wakingSince round-trip) deleted and replaced with a 2-it Phase 60 guard-block.
- All 26 tests in `dormant-poll.test.ts` pass. Backend + full app TS build both exit 0.

## Task Commits

Each task was committed atomically:

1. **Task 1: Teach __applyInputMessageForTests to drop sentinel + wait for marker on send-while-dormant, then dispatch normally** — `f61b317b` (feat)
2. **Task 2: Add send-while-dormant test coverage in dormant-poll.test.ts** — `69502eff` (test)

_This plan intentionally used a code-first / tests-second commit rhythm (not TDD RED/GREEN). Task 1's code changes broke existing `wakingSince`-carrying tests; Task 2 both fixed those AND added the four new SWD cases in a single commit. Commit-message body of Task 1 explicitly calls out the expected test regressions._

## Files Created/Modified

- `src/backend/claude-session/claude-session-server.ts` — Send-while-dormant branch added to `__applyInputMessageForTests` (before MAX_INPUT_BYTES cap); four new optional deps (`dormantLastEmitted`, `setWakeTriggerTs`, `markerCommand`, `now`) added to the seam signature; production input-handler at L5758 wires all four; `wakingSince` deleted from all three emit sites; `wakeTriggerTs?` deleted from `__DormantStateForTests` type + L6369 caller. Total diff: +200/−29.
- `src/backend/claude-session/dormant-poll.test.ts` — Four new SWD tests appended in a `describe("Phase 60: send-while-dormant path...")` block; full sshLogger vi.mock added at file top; `__applyInputMessageForTests` + `sshLogger` imports added; two legacy tests flipped from positive-`wakingSince` assertions to `.not.toHaveProperty('wakingSince')` guards; old Test P block (four it-cases) deleted and replaced with a 2-it Phase 60 guard-block. Total diff: +331/−72.

## Decisions Made

- **Code-first commit rhythm (not TDD).** Plan explicitly separated Task 1 (code + wakingSince suppression) from Task 2 (test extensions + assertion flips). This isn't a TDD gate violation because the plan frontmatter has `type: execute` (not `type: tdd`) and no `tdd="true"` task attributes. Rationale: the legacy tests were internally correct for the OLD behavior; changing them BEFORE the code change would have required a two-step invalidation dance for zero forensic benefit. Task 1's commit body warns that existing tests will fail post-commit; Task 2's commit is the fix + extension.
- **Full logger mock added to test file (not lightweight spy).** SWD-2 asserts on `sshLogger.info` fallback-log operation. Options considered: (a) `vi.spyOn(sshLogger, 'info')` — required importing sshLogger, and once you import it you might as well mock the module for silence; (b) skip the log-assertion and infer fallback from timing alone — rejected because forensic-log emission at the fallback boundary is load-bearing per the fleet directive on logs at interaction/lifecycle/effect boundaries; (c) full `vi.mock('../utils/logger.js', ...)` at file top mirroring `optimistic-bubbles.integration.test.ts` — chosen. Small perf cost (mock replaces logger for the whole file including the earlier Tests A-T) but zero observable behavior change (loggers are side-effect-only).
- **500ms poll interval for `.resume-complete` marker (matches nothing else, chosen fresh).** Rationale: the pre-existing dormant-poll uses a 3s tick because it's a background lifecycle poll. The send-while-dormant path is actively blocking a user's send — 500ms keeps latency low without spamming SSH. Documented inline. If Ashley wants tuning later, it's a one-line change.
- **Line-refs in some inline comments are illustrative not compile-time.** Comments reference `~L3026` and `~L1264` for the `let wakeTriggerTs` closure var; actual location in current file is L3161. These are markers written from the plan spec and preserved verbatim in the new comments for continuity with plan documentation. Not load-bearing.

## Deviations from Plan

**None — plan executed exactly as written.**

The plan's grep-gate acceptance criteria, verify-block commands, and shape-invisible-dormancy invariants all passed on the first run. No auto-fix rules triggered; no checkpoints hit; no architectural questions surfaced.

### Task Commits vs Plan Task Structure

The plan specifies 2 tasks; I emitted 2 commits (one per task). No task-splitting or task-merging happened.

## Issues Encountered

**Only one implementation hiccup, self-resolved in-band.** SWD-3's first version used `mockResolvedValueOnce` chain (4 sequential returns) which was exhausted mid-test because the second send needed more polls than pre-allocated. Fixed by switching to `mockImplementation` returning a far-future timestamp on every call — the freshness check breaks the loop on the first poll regardless. No commit revision needed (fix landed in the same Task 2 commit that included the buggy first version).

## Threat Flags

None. Every mitigation in the plan's `<threat_model>` (T-60-01-01 spoofing, T-60-01-02 tampering, T-60-01-03 race, T-60-01-04 DoS, T-60-01-05 info-disclosure) landed exactly as designed:

- **T-60-01-01 (spoofing) mitigated:** sentinel-drop path derived EXCLUSIVELY from connection-scoped `currentTmuxSession` (already an explicit dep on `__applyInputMessageForTests`, not read from the WS payload). Client-supplied hostId/tmuxSession are IGNORED — mirrors T-cd6-01 for the wake handler.
- **T-60-01-02 (tampering) accepted:** `.resume-complete` marker is same-box, no network path, same trust posture as the pre-existing dormant-poll marker read at L6991-7003.
- **T-60-01-03 (race) mitigated:** sentinel `rm -f` is idempotent (`-f` swallows ENOENT); marker poll falls through fast when pre-existing marker is already newer than triggerTs. New forensic logs at ENTRY / marker-fresh / marker-fallback provide diagnostic observability.
- **T-60-01-04 (DoS) mitigated:** existing `MAX_INPUT_BYTES = 16*1024` cap unchanged; idempotent sentinel drop means N concurrent sends produce ONE `rm -f` + N marker polls, not N sentinel drops.
- **T-60-01-05 (info disclosure) accepted:** new logs add `hostId`, `tmuxSession`, `mqid`, `elapsedMs` — no PII beyond what the input handler already logs at L2072-2083.

## Known Stubs

None. The send-while-dormant path is fully wired: sentinel drop → wakeTriggerTs write → marker poll → send-keys dispatch. No placeholder returns, no mock data flowing to UI. Plan 02 (pv-send-watchdog widening) and Plan 03 (frontend deletion) consume the interface this plan establishes.

## Interface Contract for Plan 02 + Plan 03

Downstream plans consume this plan's output:

- **Plan 02 (pv-send-watchdog widening)** will read `wasDormant` (currently a scoped `const` inside the send-while-dormant branch of `__applyInputMessageForTests`) and thread it through as `deps.dormantSend: true` on `armPvSendWatchdog()`. To make this work, Plan 02's first step is to LIFT `const wasDormant = deps.dormantLastEmitted?.() === true;` from inside the dormant-branch guard up to the top of the function body (before the branch) so both the branch AND the downstream `armWatchdog` call at L2150+ can read it. This is a mechanical refactor — no behavior change; the current position was fine for Plan 01 because only the branch itself needed the value.
- **Plan 03 (frontend deletion)** relies on: (a) `{type:"dormant"}` frames no longer carrying `wakingSince` (verified — 0 non-comment occurrences), (b) `msg.type === "wake"` handler still PRESENT so any in-flight frontend can still call it during the deploy window (verified — untouched by this plan), (c) new logging operations for post-deploy forensic diagnostics if the invisible-wake path misbehaves (`pv_input_dormant_*` prefix — 5 distinct ops).

## Self-Check: PASSED

Verified before writing this section:

- Task 1 commit `f61b317b` exists: `git log --oneline --all | grep -q "f61b317b"` — FOUND
- Task 2 commit `69502eff` exists: `git log --oneline --all | grep -q "69502eff"` — FOUND
- `src/backend/claude-session/claude-session-server.ts` exists — FOUND (7429 lines post-plan; up from 7258 pre-plan)
- `src/backend/claude-session/dormant-poll.test.ts` exists — FOUND (1163 lines post-plan; up from 933 pre-plan)
- Grep-gate: `wakingSince` non-comment count = 0 in claude-session-server.ts — PASS
- Grep-gate: `wakeTriggerTs: () => wakeTriggerTs` count = 1 in claude-session-server.ts — PASS (the L7013 rediscovery-seam wire-up)
- Grep-gate: `Test SWD-[1-4]:` count = 4 in dormant-poll.test.ts — PASS
- Grep-gate: positive `wakingSince` assertions count = 0 in dormant-poll.test.ts — PASS
- `npx vitest run src/backend/claude-session/dormant-poll.test.ts` — 26/26 pass, exit 0
- `npm run build:backend && npm run build` — both exit 0
