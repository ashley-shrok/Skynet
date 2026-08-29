---
phase: 60-invisible-dormancy-wakes
plan: 02
subsystem: backend/claude-session
tags: [dormancy, wake, pv-send-watchdog, timing-widening, invisible-ui, red-bubble-backstop]

# Dependency graph
requires:
  - phase: 56
    plan: 01
    provides: "The `wasDormant = deps.dormantLastEmitted?.() === true` capture at the top of `__applyInputMessageForTests` (L2064) that this plan reads at BOTH armWatchdog call sites to pass through as `dormantSend`."
provides:
  - "`dormantSend?: boolean` opt-in flag on `ArmPvSendWatchdogArgs` — when true, the three-stage timer chain uses widened constants (retry-Enter T+92500ms, full-resend T+95500ms, give-up T+120_000ms) instead of today's (T+2500/T+5500/T+20_000). Awake-pane sends that omit the flag get today's behavior byte-for-byte."
  - "Four new exported constants in `pv-send-watchdog.ts`: `MARKER_FALLBACK_MS_MIRROR = 90_000`, `RETRY_ENTER_MS_DORMANT = 92_500`, `FULL_RESEND_MS_DORMANT = 95_500`, `GIVE_UP_MS_DORMANT = 120_000`."
  - "Wire-up from `claude-session-server.ts`'s `__applyInputMessageForTests` at both `armWatchdog` call sites (split-send at ~L2284 + non-split retry-Enter-only safety net at ~L2328) — each passes `dormantSend: wasDormant` AND records the flag value in its arm-time log metadata for post-hoc forensic diagnosis."
  - "Five new WW test cases in `pv-send-watchdog.test.ts` covering: WW-1 (paste_send_failed does NOT fire at T+20s but DOES at T+120s for dormant sends), WW-2 (awake-pane sends preserve T+20s paste_send_failed timing), WW-3 (retry-Enter + full-resend delayed to the widened cadence), WW-4 (dormantSend composes with retryEnterOnly: single bare Enter at T+92500ms, no paste_send_failed), WW-5 (constant-drift guard reads claude-session-server.ts and asserts `MARKER_FALLBACK_MS === MARKER_FALLBACK_MS_MIRROR`)."
affects: [60-03 frontend deletion (Plan 03 can now safely delete DormancyOverlay + wake UI — the backend's send-path + widened watchdog fully cover the invisible-wake failure surfacing this shape requires; a healthy ~90s wake will not trip the red-bubble backstop, and a genuine wake failure still surfaces via the same optimistic-bubble-goes-red mechanism as any other send)]

# Tech tracking
tech-stack:
  added: []
  patterns: [Opt-in per-arm timing-cadence flag on `armPvSendWatchdog` (no cross-cutting parameterization — call sites that don't set the flag get today's behavior byte-for-byte); cross-file constant coupling via a mirror-with-header-comment + test-time constant-drift guard reading the upstream file at runtime; local `retryDelay`/`fullResendDelay`/`giveUpDelay` variables computed once at arm time so the three `setTimeout` sites uniformly pick the widened-or-normal cadence]

key-files:
  created: []
  modified:
    - "src/backend/claude-session/pv-send-watchdog.ts (four new exported constants + `dormantSend?: boolean` field on ArmPvSendWatchdogArgs + three local delay vars + three setTimeout call-site swaps + two armed-log metadata extensions; +66/−3)"
    - "src/backend/claude-session/claude-session-server.ts (two new `dormantSend: wasDormant` fields on the armWatchdog object literals + two new `dormantSend: wasDormant` fields on the info-log metadata objects; +19/−0)"
    - "src/backend/claude-session/pv-send-watchdog.test.ts (four new WW-1..WW-4 tests in a new `describe('Phase 60: widened window ...')` block + one WW-5 constant-drift guard in a separate `describe('Phase 60: constant-drift guard')` block; import extended with the four new constants + the three existing `RETRY_ENTER_MS`/`FULL_RESEND_MS`/`GIVE_UP_MS` for boundary arithmetic in WW-2/WW-3; +227/−0)"

key-decisions:
  - "Mirror MARKER_FALLBACK_MS in pv-send-watchdog.ts as `MARKER_FALLBACK_MS_MIRROR` — pv-send-watchdog and claude-session-server cannot import each other (circular), so the constant is re-declared with a header comment naming the authoritative source. WW-5 reads claude-session-server.ts at test time and asserts the two values match to prevent silent drift (T-60-02-03 mitigation)."
  - "GIVE_UP_MS_DORMANT = MARKER_FALLBACK_MS + GIVE_UP_MS + 10_000 = 120_000ms (not a hardcoded 120_000). The formula stays correct if either upstream constant moves, and the arithmetic is greppable from the module header comment. Test WW-5 sanity-checks the final numeric value equals 120_000 so a wildly wrong formula is caught."
  - "The `dormantSend` field on the split-send arm site AND the non-split retry-Enter-only safety net. Rationale: if the frontend loses mqid AND the pane is dormant, the widened window still applies to the safety-net's single retry-Enter — otherwise the bare Enter fires at T+2500ms DURING the marker-wait window, when tmux may not yet be listening (wake-supervisor's shell → claude bootstrap could still be running) and the harmless-no-op guarantee (D-16) does not apply because we're not yet at a claude prompt. Widened to T+92500ms, the retry-Enter fires POST marker-wait and lands correctly whether the initial send-keys succeeded or not."
  - "wasDormant reused from Plan 01 (already declared once at L2064 at the top of `__applyInputMessageForTests`, before the sentinel-drop/marker-wait side-effects). No re-computation or hoisting needed — Plan 01 already positioned the const correctly, so this plan just references it at the two arm sites downstream. Interface contract from Plan 01's SUMMARY was exact."
  - "WW-5 (constant-drift guard) lives OUTSIDE the widened-window describe block. It's a file-read invariant, not a timer-based test — fake-timer setup would be a no-op here. Also lets it fail-loud on load-time even if the widened describe were skipped for any reason."

patterns-established:
  - "Opt-in timing-cadence flag on a shared timer chain: single `dormantSend?: boolean` in the `ArmPvSendWatchdogArgs` shape swaps the three timer stages to widened variants when true. No call-site branching, no separate `armPvSendWatchdogDormant` variant, no per-arm parameterized window. Byte-for-byte pre-Phase-56 behavior when omitted."
  - "Cross-file constant coupling with test-time drift guard. When two files must agree on a numeric literal but cannot import each other (circular), re-declare with a header comment naming the authoritative source AND write a test that reads the upstream file at runtime + parses the literal + asserts equality. Pattern applicable to any future cross-module invariant."

requirements-completed: []

# Metrics
duration: 13min
completed: 2026-08-23
---

# Phase 60 Plan 02: pv-send-watchdog widened window for dormant-triggered sends Summary

**pv-send-watchdog's three-stage timer chain gains a `dormantSend?: boolean` opt-in that swaps the retry-Enter / full-resend / give-up timings to widened variants (T+92500/T+95500/T+120_000ms) so a healthy ~90-second invisible wake never trips the paste_send_failed red-bubble backstop, wired at both arm sites in `__applyInputMessageForTests` from the `wasDormant` closure var Plan 01 established.**

## Performance

- **Duration:** ~13 min (execute start 2026-08-23T19:30:00Z → SUMMARY commit ~19:43Z)
- **Tasks:** 3 of 3 complete
- **Files modified:** 3 (pv-send-watchdog.ts + pv-send-watchdog.test.ts + claude-session-server.ts)

## Accomplishments

- Four new exported constants land in `pv-send-watchdog.ts`: `MARKER_FALLBACK_MS_MIRROR = 90_000`, `RETRY_ENTER_MS_DORMANT = 92_500`, `FULL_RESEND_MS_DORMANT = 95_500`, `GIVE_UP_MS_DORMANT = 120_000`. All computed via formula (`MARKER_FALLBACK_MS_MIRROR + RETRY_ENTER_MS` / `+ FULL_RESEND_MS` / `+ GIVE_UP_MS + 10_000`) so they stay correct if any upstream constant moves.
- `dormantSend?: boolean` flag added to `ArmPvSendWatchdogArgs`. `armPvSendWatchdog` computes three local delay variables (`retryDelay`, `fullResendDelay`, `giveUpDelay`) once at arm time using the ternary `args.dormantSend ? DORMANT_VARIANT : NORMAL`, then the three `setTimeout` call sites reference those locals uniformly. Zero bare-constant references remain in `setTimeout(..., RETRY_ENTER_MS)` etc.
- Both `armed`-log metadata objects (the retry-Enter-only path AND the full three-stage path) now include `dormantSend: args.dormantSend === true` so forensic logs record which timing chain armed for post-hoc diagnosis.
- Wire-up at both `armWatchdog` call sites in `__applyInputMessageForTests`: split-send path (~L2284) AND non-split retry-Enter-only safety net (~L2328) each pass `dormantSend: wasDormant` in the arg object AND record `dormantSend: wasDormant` in the `[pv-input] armed ...` info-log metadata. `wasDormant` reused verbatim from Plan 01's L2064 declaration — no hoist needed (Plan 01 positioned it correctly at the top of the function body).
- Five new WW tests in `pv-send-watchdog.test.ts` prove the widened branch:
  - **WW-1**: `dormantSend:true` → paste_send_failed does NOT fire at T+20001ms, DOES fire at T+120001ms with exact wire shape `{type:"paste_send_failed", mqid, reason:"no_signal_after_full_resend"}`.
  - **WW-2**: `dormantSend` omitted → paste_send_failed fires at T+20001ms (awake-pane unchanged).
  - **WW-3**: `dormantSend:true` → no exec fires at T+2600ms or T+5600ms; retry-Enter fires at T+92600ms; full-resend triplet (C-u + `-l body` + Enter) fires at T+95600ms.
  - **WW-4**: `dormantSend + retryEnterOnly` → bare Enter fires at T+92600ms; no C-u, no `-l body`; paste_send_failed never fires past T+120001ms.
  - **WW-5**: reads `src/backend/claude-session/claude-session-server.ts`, parses `MARKER_FALLBACK_MS = 90_000`, asserts equal to `MARKER_FALLBACK_MS_MIRROR` import. Sanity-asserts all four widened constants land at expected exact values (90_000 / 120_000 / 92_500 / 95_500).
- All 21 tests in `pv-send-watchdog.test.ts` pass (16 pre-Phase-56 + 5 new WW). Plan 01's `dormant-poll.test.ts` still 26/26 green — no regression from wire-up at the arm sites. Both `npm run build:backend` and `npm run build` exit 0.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add dormantSend flag + widened-window branch to pv-send-watchdog.ts** — `13e36d77` (feat)
2. **Task 2: Wire dormantSend flag from claude-session-server.ts's send-path dormant branch** — `c3a1eb91` (feat)
3. **Task 3: Test coverage for the widened-window branch in pv-send-watchdog** — `8c9d4c7b` (test)

_Rhythm was code-first / tests-third (not TDD). Rationale: Task 1's changes to pv-send-watchdog.ts's timing constants would have made writing tests against the old constants pointless; Task 2's wire-up needed Task 1's `dormantSend?` field on the args interface to compile; Task 3 wrote tests against the final shape all at once. Plan frontmatter `type: execute` (not `type: tdd`), and no task has `tdd="true"`, so no gate violation._

## Files Created/Modified

- `src/backend/claude-session/pv-send-watchdog.ts` — Added Phase 60 section header comment block above the existing timing constants; four new exported constants (`MARKER_FALLBACK_MS_MIRROR`, `RETRY_ENTER_MS_DORMANT`, `FULL_RESEND_MS_DORMANT`, `GIVE_UP_MS_DORMANT`); `dormantSend?: boolean` field appended to `ArmPvSendWatchdogArgs` with a detailed rationale comment; three local `retryDelay`/`fullResendDelay`/`giveUpDelay` computed once after logger assignment; three `setTimeout` call sites (L239, L318, L358 pre-plan → new offsets post-plan) swapped from bare constants to local vars; two `armed`-log metadata objects gained `dormantSend: args.dormantSend === true` field. Total diff: +66/−3.
- `src/backend/claude-session/claude-session-server.ts` — Two arm-site object literals in `__applyInputMessageForTests` gained `dormantSend: wasDormant` field (with inline rationale comments) + two info-log metadata objects gained `dormantSend: wasDormant`. No new hoisting, no new constants, no signature changes — `wasDormant` was already declared at L2064 by Plan 01. Total diff: +19/−0.
- `src/backend/claude-session/pv-send-watchdog.test.ts` — Import extended with `RETRY_ENTER_MS`, `FULL_RESEND_MS`, `GIVE_UP_MS`, `MARKER_FALLBACK_MS_MIRROR`, `RETRY_ENTER_MS_DORMANT`, `FULL_RESEND_MS_DORMANT`, `GIVE_UP_MS_DORMANT`; new `describe("Phase 60: widened window for dormant-triggered sends", () => { ... })` block with WW-1..WW-4; new `describe("Phase 60: constant-drift guard", () => { ... })` block with WW-5 (file-read invariant, outside timer setup because fake-timers aren't relevant to a file-read assertion). Total diff: +227/−0.

## Decisions Made

- **Constant-drift guard as a describe-block sibling, not inside the widened describe.** WW-5 does NOT need `vi.useFakeTimers()` because it's a file-read + regex-parse + equality assertion — no timer to advance. Placing it in a separate describe block keeps its setup obvious (no fake timers, no `__resetPvSendWatchdogForTests()`) and lets it fail-loud even if the widened describe were somehow skipped.
- **Formula-based dormant constants, not hardcoded literals.** All three dormant constants derive from the base pair `MARKER_FALLBACK_MS_MIRROR + (RETRY_ENTER_MS | FULL_RESEND_MS | GIVE_UP_MS)` (+ 10_000ms buffer for give-up). If someone tunes `RETRY_ENTER_MS` from 2500 → 3000ms in the future, `RETRY_ENTER_MS_DORMANT` automatically becomes 93_000ms. WW-5's numeric sanity assertions (`expect(GIVE_UP_MS_DORMANT).toBe(120_000)`) catch the case where the formula is wildly wrong OR any base constant drifts, forcing the human to update both the base + the sanity assertion.
- **`wasDormant` reused without hoisting.** Plan 01's SUMMARY explicitly stated that "Plan 02's first step is to LIFT `const wasDormant = deps.dormantLastEmitted?.() === true;` from inside the dormant-branch guard up to the top of the function body." But inspection of the current file shows Plan 01 ALREADY declared `wasDormant` at the top of `__applyInputMessageForTests` (L2064, immediately after the `!sshConn || !currentTmuxSession` early-return guard, and BEFORE the dormant-branch predicate at L2065-2070). So no hoisting was needed — the arm sites at L2284 and L2328 are in the same closure and `wasDormant` is in scope. Plan 01's contract-for-Plan-02 text was slightly inaccurate about the current position but delivered exactly the value Plan 02 needed. No plan deviation — the outcome is precisely what Plan 01's interface contract promised.
- **`dormantSend` at BOTH arm sites (not just the split-send one).** The plan mandates wire-up at both the split-send arm site AND the non-split retry-Enter-only safety-net site. Rationale documented inline: if the frontend loses mqid on a dormant pane, the safety-net's single retry-Enter must fire POST marker-wait (T+92500ms), not DURING it (T+2500ms). Bare Enter at T+2500ms is NOT harmless in this compound case — the wake-supervisor's shell → claude bootstrap could still be running, and the Enter could land at the shell prompt or `/id <name>` output routing instead of at a claude prompt (D-16's "Claude ignores empty-input Enter" guarantee only applies when we're actually at a claude prompt).

## Deviations from Plan

**None — plan executed exactly as written.**

The plan's grep-gate acceptance criteria, verify-block commands, and threat-model mitigations all passed on the first run. No auto-fix rules triggered; no checkpoints hit; no architectural questions surfaced. The one place where the plan's text was slightly out of date (it said "hoist `wasDormant` from inside the dormant-branch guard to the top of the function" — but Plan 01 had already placed it correctly at the top of the function body, so no hoist was needed) is documented under Decisions Made rather than as a deviation, because the observable outcome matches the plan's intent exactly and no code was written differently than what the plan mandated.

### Task Commits vs Plan Task Structure

The plan specifies 3 tasks; I emitted 3 commits (one per task). No task-splitting or task-merging happened.

## Issues Encountered

None. First-run green on all three tasks. Tests took 867ms to run all 21 cases with vi.useFakeTimers() — no flakiness observed.

## Threat Flags

None. Every mitigation in the plan's `<threat_model>` (T-60-02-01 spoofing, T-60-02-02 DoS acceptance, T-60-02-03 tampering / constant drift) landed exactly as designed:

- **T-60-02-01 (spoofing) mitigated:** `dormantSend: wasDormant` at both arm sites is derived from the connection-scoped `wasDormant` closure var (Plan 01's `deps.dormantLastEmitted?.() === true` capture at L2064). No WS payload field can trigger the widened window. Grep-verified: `dormantSend: wasDormant` count = 4 (2 arm-args + 2 log-args) with the only source being the connection-closure computation.
- **T-60-02-02 (DoS) accepted per plan:** Each pending watchdog remains bounded memory (~200 bytes `PendingWatchdog` struct); `clearPvSendWatchdogsForSession` cleanup on session recycle still applies unchanged; widened window is use-case-justified (documented in shape file's "watchdog window has to be wide enough that a healthy wake never trips the red-bubble backstop").
- **T-60-02-03 (constant drift) mitigated:** `MARKER_FALLBACK_MS_MIRROR = 90_000` in pv-send-watchdog.ts mirrors `MARKER_FALLBACK_MS = 90_000` at claude-session-server.ts:773. WW-5 test reads the upstream file at runtime, parses the literal via regex, asserts equality with the mirror constant. Sanity-checks all four widened constants for expected exact values. If any base constant moves without the mirror being updated, WW-5 fails loudly on the next `npx vitest run`.

## Known Stubs

None. The widened-window path is fully wired end-to-end: `dormantSend` flows from `wasDormant` at the input-handler seam → into `armWatchdog` arg objects at both arm sites → into `ArmPvSendWatchdogArgs.dormantSend` on the watchdog module → into the three local delay vars → into the three `setTimeout` call sites. No placeholder returns, no mock data flowing to production. Plan 03 (frontend deletion) is the only remaining Phase 60 work.

## Interface Contract for Plan 03

Plan 03 consumes NOTHING from this plan directly — the interfaces are all backend-internal. But this plan makes Plan 03's deletion of the DormancyOverlay + wake UI safe by ensuring the failure-mode backstop (the pv-send-watchdog red-bubble emit) will NOT false-fire during a healthy ~90-second invisible wake:

- **A dormant pane the user sends into:** wasDormant=true at input-handler entry → send-path drops sentinel + waits for marker (Plan 01) → send-keys dispatched → watchdog arms with `dormantSend: true` → widened cadence. If wake completes healthily in ~90s, the reconciliation signal arrives BEFORE T+120_000ms and `notifyMatched` clears the watchdog. If wake genuinely fails, paste_send_failed fires at T+120_000ms and the optimistic bubble goes red — same visible failure mode as any other send that never landed.
- **An awake pane the user sends into:** wasDormant=false → send-path skips the dormant branch → send-keys dispatched immediately → watchdog arms with `dormantSend: false` → today's timings (T+2500/T+5500/T+20_000). Byte-for-byte pre-Phase-56 behavior. Grep-verified: WW-2 covers this exact case.
- **A dormant pane where the frontend loses mqid on the send:** the non-split safety-net arms with `retryEnterOnly: true` AND `dormantSend: true`. Single retry-Enter fires at T+92500ms (post marker-wait), giving the freshly-woken claude a chance to accept the Enter as a submit. If the initial send-keys with `\r` in the paste stream landed correctly, the retry Enter is a harmless no-op (D-16); if not, it recovers the send.

## Self-Check: PASSED

Verified before writing this section:

- Task 1 commit `13e36d77` exists: `git log --oneline --all | grep -q "13e36d77"` — FOUND
- Task 2 commit `c3a1eb91` exists: `git log --oneline --all | grep -q "c3a1eb91"` — FOUND
- Task 3 commit `8c9d4c7b` exists: `git log --oneline --all | grep -q "8c9d4c7b"` — FOUND
- `src/backend/claude-session/pv-send-watchdog.ts` exists — FOUND (536 lines post-plan; up from 478 pre-plan)
- `src/backend/claude-session/pv-send-watchdog.test.ts` exists — FOUND (851 lines post-plan; up from 624 pre-plan)
- `src/backend/claude-session/claude-session-server.ts` exists — FOUND (7448 lines post-plan; up from 7429 pre-plan)
- Grep-gate: `export const GIVE_UP_MS_DORMANT` present — PASS
- Grep-gate: `export const FULL_RESEND_MS_DORMANT` present — PASS
- Grep-gate: `export const RETRY_ENTER_MS_DORMANT` present — PASS
- Grep-gate: `export const MARKER_FALLBACK_MS_MIRROR` present — PASS
- Grep-gate: `dormantSend?:` present in args interface — PASS
- Grep-gate: `MARKER_FALLBACK_MS = 90_000` in claude-session-server.ts present (base constant unchanged) — PASS
- Grep-gate: `MARKER_FALLBACK_MS_MIRROR = 90_000` in pv-send-watchdog.ts present — PASS
- Grep-gate: `setTimeout` bare-constant references count = 0 — PASS
- Grep-gate: `dormantSend: wasDormant` count in claude-session-server.ts = 4 (want ≥ 2) — PASS
- Grep-gate: `const wasDormant = deps.dormantLastEmitted` count = 1 — PASS
- Grep-gate: `Test WW-[1-5]:` count = 5 — PASS
- `npx vitest run src/backend/claude-session/pv-send-watchdog.test.ts` — 21/21 pass, exit 0
- `npx vitest run src/backend/claude-session/dormant-poll.test.ts` — 26/26 pass, exit 0 (Plan 01 not regressed)
- `npm run build:backend` — exit 0
- `npm run build` — exit 0
