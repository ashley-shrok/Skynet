---
phase: quick-260803-1xw
plan: 01
subsystem: terminal / pretty-view
tags: [terminal, pretty-view, ssh, tmux, watchdog, retry, ws-events, bounty-pv-paste]
requires:
  - patch #118 (isPrettyViewSubmit + tmux send-keys branch in terminal.ts)
  - sonner (already in use)
  - i18next (already wired)
provides:
  - TerminalSession.pvSubmitWatchdogs Set<Timeout>
  - armPvSubmitWatchdog() helper (sibling module)
  - paste_send_failed WS event (backend emit, frontend consume)
  - terminal.pasteSendFailed i18n key (en.json)
affects:
  - src/backend/ssh/terminal-session-manager.ts (field + cleanup in destroy/detach)
  - src/backend/ssh/terminal.ts (arm call at end of 250ms setTimeout in isPrettyViewSubmit branch)
  - src/ui/features/terminal/Terminal.tsx (WS handler + toast + log)
tech-stack:
  added: []
  patterns:
    - "outcome-layer detection: per-submit setTimeout pair + snapshot-based staleness check"
    - "mechanical helper extraction to keep large WS-dispatcher testable"
    - "WS-event to toast pattern (matches tmux_unavailable / tmux_detached)"
key-files:
  created:
    - src/backend/ssh/terminal-pv-watchdog.ts
    - src/backend/ssh/terminal-pv-watchdog.test.ts
  modified:
    - src/backend/ssh/terminal-session-manager.ts
    - src/backend/ssh/terminal.ts
    - src/ui/features/terminal/Terminal.tsx
    - src/ui/features/terminal/Terminal.wiring.test.ts
    - src/ui/locales/en.json
decisions:
  - "Extract arming logic into sibling module `terminal-pv-watchdog.ts` (planner discretion): keeps helper unit-testable under vi.useFakeTimers without mounting the 3000-line WS dispatcher. Call-site stays one line."
  - "Retry Enter re-reads session.sshConn at fire time rather than reusing the captured submitConn: guards against sshConn being torn down between arm and fire."
  - "Second watchdog snapshots lastActivityAt AGAIN at retry-fire time (not the original arm-time snapshot): gives the retry Enter its own fair 2.5s window."
  - "Clear pvSubmitWatchdogs in BOTH destroySession AND detachWs: a detached WS can't receive paste_send_failed, and a delayed retry against a nav-away pane is worse than doing nothing."
  - "Non-tmux fallback path arms NO watchdog (early return on !submitConn || !tmuxTarget): explicit scope guard per plan."
metrics:
  duration: ~35 minutes
  completed: 2026-08-03
  tasks_completed: 2 / 2
  files_created: 2
  files_modified: 5
  tests_added: 10 (7 backend under vi.useFakeTimers + 3 frontend structural)
  full_suite: 1113 passed / 6 skipped / 0 failed / 90 files (baseline 1103/6/89 + 10 new)
commits:
  - 2c7367f  feat(terminal): PV submit post-send idle-watchdog with auto-retry Enter (pinned bounty)
  - 319499f  feat(pretty-view): surface paste_send_failed WS event as user-visible error toast (pinned bounty)
---

# Quick 260803-1xw: PV paste post-send idle-watchdog with retry Enter Summary

Ashley's design shift: fix the pinned bounty
`pv-paste-to-terminal-lands-as-unsent-bracket-paste` at the outcome layer
(detect stuck submit → retry → escalate) rather than continuing to fight Ink's
paste-detection state machine at the byte layer (patches #100/#111/#118 kept
losing at the next scale of paste body).

## What Landed

### Backend (`2c7367f`)

**`TerminalSession.pvSubmitWatchdogs: Set<NodeJS.Timeout>`** (`terminal-session-manager.ts`)
Initialized to `new Set()` in `createSession`. Cleared + deleted in both
`destroySession` (before `sshStream.end()`) and `detachWs` (so a detached WS
doesn't sink a delayed retry-Enter into a pane the user has already navigated
away from, and the second-watchdog's `attachedWs.send(...)` is never called
against a null WS reference).

**`armPvSubmitWatchdog(...)` helper** (new `terminal-pv-watchdog.ts`)
Mechanical extraction of the arming block. Signature:
```ts
armPvSubmitWatchdog({ session, submitConn, tmuxTarget, mqid, userId, sessionId }): boolean
```
Returns `true` if the pair was armed, `false` if the call was skipped
(missing `submitConn` or `tmuxTarget` — non-tmux fallback path).

Behavior:
1. Snapshot `session.lastActivityAt` at arm time.
2. **T+2.5s (first watchdog):** If `session.lastActivityAt > snapshot`, log
   `pv_submit_watchdog_ok` and return (happy path). Otherwise log
   `pv_submit_watchdog_retry`, re-read `session.sshConn` (race-guard), and
   fire a retry `tmux send-keys -t '<target>' Enter`. Snapshot `lastActivityAt`
   again and arm the second watchdog.
3. **T+5.0s (second watchdog, 2.5s after retry):** If `s.lastActivityAt >
   retrySnapshot`, log `pv_submit_watchdog_retry_ok` and return. Otherwise
   log `pv_submit_watchdog_escalate` and emit
   `{type:"paste_send_failed", mqid, reason:"no_activity_after_2_retries"}`
   on the attached WS (guarded on `attachedWs?.readyState === WebSocket.OPEN`).

**Call-site in `terminal.ts`** (inside the existing 250ms `setTimeout` block
of the `isPrettyViewSubmit && ... endsWith("\r")` branch, after the initial
`submitConn.exec` try/catch): a single conditional block that resolves the
session and calls `armPvSubmitWatchdog(...)` only when `submitConn &&
tmuxTarget && currentSessionId`. The non-tmux fallback branch (which uses
`inputStream.write("\r")`) arms NO watchdog.

**Backend tests** (`terminal-pv-watchdog.test.ts`, 7 tests under
`vi.useFakeTimers`):
- **T-1 happy path** — activity within 2.5s → no retry, no WS emit.
- **T-2 retry-fires** — no activity → retry `tmux send-keys` dispatched with
  correctly shell-quoted target.
- **T-3 retry-succeeds** — activity after retry → no `paste_send_failed`.
- **T-4 retry-fails-escalate** — no activity in either window → WS emit with
  correct payload.
- **T-5 cancel-on-destroy** — clearing `pvSubmitWatchdogs` cancels the
  timers; simulated `getSession` returning null (post-destroy race).
- **T-6 non-tmux-no-watchdog** — missing `submitConn` OR `tmuxTarget` →
  early return, no timers scheduled.
- **T-7 concurrent-submits** — two mqids on same session; only the stagnant
  snapshot's watchdog fires the retry and escalates; per-submit snapshot
  isolation verified.

### Frontend (`319499f`)

**WS handler branch** (`Terminal.tsx`, right after `tmux_detached`):
```ts
} else if (msg.type === "paste_send_failed") {
  toast.error(t("terminal.pasteSendFailed"), { duration: 8000 });
  addLog({ type: "error", stage: "connection", message: t("terminal.pasteSendFailed") });
}
```
No new imports (`toast`, `addLog`, `t` already in scope). No changes to
PrettyView props — the toast fires directly at the WS-handler layer, matching
`tmux_unavailable` / `tmux_detached`.

**i18n** (`locales/en.json`): new `terminal.pasteSendFailed` key next to
`tmuxUnavailable`:
> "Send didn't take effect after retry — try a shorter message or paste in chunks."
Other locales fall back to English via i18next default (no forced translation
churn on this iteration).

**Frontend tests** (`Terminal.wiring.test.ts`, 3 new structural tests
in a new `describe("Terminal.tsx quick 260803-1xw — paste_send_failed WS
handler")` block):
- **PV-Watchdog 1** — the branch string exists exactly once (no duplication).
- **PV-Watchdog 2** — proximity regex: `msg.type === "paste_send_failed"`
  ... `toast.error(t("terminal.pasteSendFailed")` within a 900-char window
  (accommodates the docblock comment above the toast call).
- **PV-Watchdog 3** — i18n key is registered in `en.json`.

## Verification

- `npx tsc --noEmit` — clean.
- `npm run build:backend` — clean (patch #154 lesson: catches TS errors that
  `tsc --noEmit` misses on the backend project).
- `npm run build` — clean.
- `npx vitest run` — **1113 passed / 6 skipped / 0 failed / 90 files**
  (baseline pre-patch: 1103/6/89; delta: +10 tests in +1 file, matches
  exactly with 7 backend + 3 frontend added).
- Scope guard grep on `terminal.ts` diff: no hits on
  `IDLE_THRESHOLD_MS|bracketed.paste|BPM`.
- Log-shape grep: 9 hits on `pv_submit_watchdog` in the sibling module
  (above the "at least 5" bar in the plan verification).

## Deviations from Plan

**None** — plan executed exactly as written, with two small mechanical
choices that were flagged as planner discretion:

1. **Helper module placement.** Plan explicitly said "sibling `terminal-pv-
   watchdog.ts` if preferred — planner discretion". Chose the sibling module
   to avoid inflating the already-3000-line `terminal.ts`. Call-site remains
   the intended one-line delegation.
2. **PV-Watchdog 2 regex window.** Plan suggested 400-char window; measured
   actual gap in the source (689 chars — driven by the docblock comment
   above the `toast.error` call) and widened to 900 for a comfortable
   margin. Still tight enough to avoid false-positives on unrelated
   `toast.error` calls elsewhere in the file.

## Known Follow-Ups (Not This Patch)

- **Locale translations.** `terminal.pasteSendFailed` is only in `en.json`;
  translated locales fall back to English via i18next. Add to translation
  refresh cycle if/when Ashley wants the copy in her other locales.
- **Deploy queue.** This joins the held queue with patches #267-#286. STOP
  point respected — no push, no `docker build`, no `docker compose up`.

## Self-Check

- `src/backend/ssh/terminal-pv-watchdog.ts` — FOUND.
- `src/backend/ssh/terminal-pv-watchdog.test.ts` — FOUND.
- `src/backend/ssh/terminal-session-manager.ts` — FOUND (modified).
- `src/backend/ssh/terminal.ts` — FOUND (modified).
- `src/ui/features/terminal/Terminal.tsx` — FOUND (modified).
- `src/ui/features/terminal/Terminal.wiring.test.ts` — FOUND (modified).
- `src/ui/locales/en.json` — FOUND (modified).
- Commit `2c7367f` — FOUND in `git log`.
- Commit `319499f` — FOUND in `git log`.

## Self-Check: PASSED
