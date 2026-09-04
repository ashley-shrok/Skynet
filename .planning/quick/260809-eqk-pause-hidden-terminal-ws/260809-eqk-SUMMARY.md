---
phase: quick-260809-eqk-pause-hidden-terminal-ws
plan: 01
subsystem: ui
tags: [react, useEffect, websocket, xterm, ssh, terminal, pretty-view, hidden-pane-cost, ios-pwa, diag-registry]

# Dependency graph
requires:
  - phase: quick-260808-b74-pause-hidden-pretty-view-ws
    provides: "iteration-1 WS-pause pattern (isVisibleRef + close-on-hidden + reopen-on-visible + guards on retry scheduler and iOS PWA foreground handler); the diff shape being mirrored here"
  - phase: patch-148-analog-auto-reconnect
    provides: "existing Terminal.tsx attemptReconnection() entrypoint with full guard logic (isReconnectingRef, isConnectingRef, wasDisconnectedBySSH, maxReconnectAttempts) that this iteration reuses as its reopen path"
  - phase: quick-260808-cd6-dormancy-overlay-and-wake-button
    provides: "diag-registry snapshot contract (registerPane / PaneSnapshot) whose stale-closure bug is fixed here"
provides:
  - "Terminal-SSH WS-pause layer on isVisible: hidden Terminal panes close their SSH WS + xterm write stream + halt reconnect chatter"
  - "Two isVisibleRef.current guards preventing patch-#148-analog auto-reconnect and iOS PWA foreground events from fighting the pause"
  - "Honest post-iter-1 diag emit for PrettyView panes (isVisible now reads through isVisibleRef.current instead of stale-closured render-scope value)"
  - "Seven structural-grep assertions in Terminal.wiring.test.ts locking the new pause layer + guards + diag fix + preservation of the [attach]-keyed WS-setup effect"
affects: [hidden-pane-cost-mitigation, terminal-lifecycle, ios-pwa-terminal, diag-registry-consumers, tanya-diag-analyzer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "isVisibleRef.current single-knob gate on all WS auto-open / auto-reconnect paths (iter 2 extends iter 1 to Terminal.tsx)"
    - "Structural-grep test assertions anchored on planted comment tags for reformatting-safe matching on the un-mount-testable Terminal.tsx"
    - "Diag-registry snapshotFn reads through mirrored refs, NOT closured render-scope values — stable effect keys + fresh reads"

key-files:
  created: []
  modified:
    - "src/ui/features/terminal/Terminal.tsx (+97 lines): new WS-pause useEffect on [isVisible] at line ~590, isVisibleRef guard at attemptReconnection line ~1037, isVisibleRef guard at iOS PWA visibilitychange visible branch line ~395"
    - "src/ui/features/pretty-view/PrettyView.tsx (+9 -1): snapshotFn at line ~1276 now returns `isVisible: isVisibleRef.current` (fresh) instead of `isVisible` (stale closure)"
    - "src/ui/features/terminal/Terminal.wiring.test.ts (+175 lines): new describe block `quick-260809-eqk — hidden-pane WS-pause + diag fix` with 7 structural-grep assertions"

key-decisions:
  - "Reuse Terminal's existing attemptReconnection() as the reopen entrypoint (not a new setRetryKey-style state) — Terminal already has that dedicated function with full guard logic and no equivalent to PrettyView's setRetryKey exists"
  - "Anchor structural-grep tests on planted `quick-260809-eqk` comment tags rather than line numbers so tests survive reformatting"
  - "Do NOT touch the main WS-setup effect at line 2903 — stays [attach]-keyed to preserve the URL-restore contract; accepted tradeoff (offscreen URL-restored members briefly open a WS on mount which the pause effect then closes; tmux persists across WS disconnects) documented inline"
  - "Ship the PrettyView diag snapshotFn stale-closure fix in the SAME commit — required for honest post-iter-2 measurement (a lying diag would obscure the win)"

patterns-established:
  - "Pattern: iter-N WS-pause layer on any long-lived WebSocket that a pane owns — close-on-hidden + reopen-on-visible + isVisibleRef guards on every auto-reconnect / foreground-event / retry-scheduler path so nothing fights the pause"
  - "Pattern: diag-registry snapshotFn reads MUST come from refs mirrored by a useEffect keyed on the source-of-truth prop, NOT from the closured render-scope value at first registration (the effect key stays stable for slot identity)"

requirements-completed: [quick-260809-eqk]

# Metrics
duration: ~13 min
completed: 2026-08-09
---

# Quick Task quick-260809-eqk: Pause Hidden Terminal SSH WS + Fix PrettyView Diag Stale-Closure Summary

**Iter 2 of hidden-pane-cost-mitigation-empirical-rotation — mirrors iter-1 PrettyView WS-pause pattern (commit `4a3c21c`) onto Terminal.tsx's SSH WebSocket + two `isVisibleRef` guards; also fixes PrettyView diag snapshotFn stale-closure so post-ship measurement is honest.**

## Performance

- **Duration:** ~13 minutes (execution wall-clock)
- **Started:** 2026-08-09T10:41Z
- **Completed:** 2026-08-09T10:54Z
- **Tasks:** 1 (single atomic task)
- **Files modified:** 3

## Accomplishments
- Terminal panes now stop paying for a live SSH WS + xterm write stream + reconnect chatter when hidden — iter-1's ~10-13 → ~5 WS frames/30s win extends to Terminal-side traffic.
- Patch-#148-analog auto-reconnect and iOS PWA foreground event handlers both early-return on `!isVisibleRef.current`, so nothing fights the pause.
- PrettyView's diag `registerPane` snapshotFn now reports LIVE visibility (`isVisibleRef.current`) instead of the value closured at first registration — critical for honest measurement of iter 2's cost win.
- Terminal.wiring.test.ts extended with 7 structural-grep assertions locking the new pause layer, the guards, and the preservation of the `[attach]`-keyed WS-setup effect (defends the URL-restore contract).

## Task Commits

Single atomic commit (per plan constraints):

1. **Task 1: Add [isVisible] WS-pause layer to Terminal.tsx + fix PrettyView diag stale closure + structural-grep tests** — `3629562` (feat)

**Plan metadata:** _(orchestrator handles the `.planning/` docs commit — not part of this executor's scope)_

## Files Created/Modified

- `src/ui/features/terminal/Terminal.tsx` — +97 lines. Three tagged edits:
  - `~line 590`: new `useEffect(..., [isVisible])` WS-pause layer. On false-flip clears `reconnectTimeoutRef.current` then calls `webSocketRef.current.close()` when `readyState ∈ {OPEN, CONNECTING}`; on true-flip resets `reconnectAttempts.current = 0` and calls `attemptReconnection()` when the WS is `null/CLOSING/CLOSED` AND `attach` is truthy. Reuses the existing patch #148 reconnect machinery — no new connect path invented.
  - `~line 1037`: `attemptReconnection()` now opens with `if (!isVisibleRef.current) return;` as its very first statement, BEFORE the pre-existing guard block on `isUnmountingRef` / `shouldNotReconnectRef` / `isReconnectingRef` / `isConnectingRef` / `wasDisconnectedBySSH` / `reconnectTimeoutRef`.
  - `~line 395`: iOS PWA `visibilitychange` handler visible branch now has `if (!isVisibleRef.current) return;` right after the `isUnmountingRef` early return but before the `shouldNotReconnectRef=false` state-reset block.
- `src/ui/features/pretty-view/PrettyView.tsx` — +9 -1 lines. Diag `registerPane` snapshotFn at line ~1276 now returns `isVisible: isVisibleRef.current` (fresh via the iter-1 mirror useEffect at lines ~1150-1156) instead of the closured bare `isVisible`. Effect deps stay `[hostId, tmuxSession]` — the pane-registration slot must remain stable across visibility flips (adding `isVisible` to deps would re-register on every flip and defeat the stable-key design).
- `src/ui/features/terminal/Terminal.wiring.test.ts` — +175 lines. New describe block "quick-260809-eqk — hidden-pane WS-pause + diag fix" with 7 assertions:
  1. Exactly one `isVisibleRef.current = isVisible` mirror in Terminal.tsx (no duplication).
  2. New `[isVisible]`-keyed useEffect exists, anchored on the planted `quick-260809-eqk — Terminal-SSH WS-pause lifecycle effect` comment tag; body references `webSocketRef.current`, `ws.close()`, `attemptReconnection()`, `clearTimeout(reconnectTimeoutRef`, `reconnectAttempts.current = 0`, and eslint-disable-line for exhaustive-deps.
  3. `attemptReconnection()` opens with `if (!isVisibleRef.current) return;` anchored on the planted "hidden panes must not fight the WS-pause effect" comment; positional check confirms the new guard sits BEFORE the pre-existing guard block.
  4. iOS PWA visibilitychange handler visible branch has `if (!isVisibleRef.current) return;` anchored on the planted "pane hidden → do not open WS from foreground event" tag; positional checks confirm it lives inside the `if (!isIosPwa()) return;` effect and after the `if (document.hidden)` branch.
  5. Main WS-setup effect at line ~2903 still gates on `attach` and its deps array does NOT contain `isVisible` (regression guard for the URL-restore contract).
  6. PrettyView.tsx snapshotFn returns `isVisible: isVisibleRef.current` (positive) and does NOT contain the buggy shorthand `isVisible,` form (negative).
  7. PrettyView.tsx `registerPane` useEffect deps stay `[hostId, tmuxSession]` — no accidental `isVisible` extension.

## Diff Shape Reference (pause effect + guards)

**Pause effect (Terminal.tsx ~line 590), abbreviated:**
```tsx
useEffect(() => {
  if (!isVisible) {
    const ws = webSocketRef.current;
    if (ws !== null && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      ws.close();
    }
  } else {
    const ws = webSocketRef.current;
    if (attach && (ws === null || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED)) {
      reconnectAttempts.current = 0;
      attemptReconnection();
    }
  }
}, [isVisible]); // eslint-disable-line react-hooks/exhaustive-deps
```

**Guard on `attemptReconnection()` (line ~1037):**
```tsx
function attemptReconnection() {
  // quick-260809-eqk: hidden panes must not fight the WS-pause effect.
  if (!isVisibleRef.current) return;
  if (isUnmountingRef.current || /* … existing guards … */) return;
```

**Guard on iOS PWA visibility handler (line ~395):**
```tsx
// visible branch
if (isUnmountingRef.current) return;
// quick-260809-eqk: pane hidden → do not open WS from foreground event.
if (!isVisibleRef.current) return;
shouldNotReconnectRef.current = false;
```

**PV diag fix (PrettyView.tsx line ~1276):**
```tsx
return {
  kind: "pretty-view",
  paneId: key,
  hostId,
  tmuxSession,
  // quick-260809-eqk: read isVisibleRef.current so the diag emit reflects LIVE pane visibility …
  isVisible: isVisibleRef.current,
  messageCount: messagesLenRef.current,
  …
};
```

## Test-Suite Delta (before vs. after)

- **Baseline (pre-edit):** 133 test files pass, 1666 pass / 6 skipped / 0 failed. (Plan referenced iter-1 baseline of 1556/6 — the real number has grown to 1666/6 through the quick-tasks shipped since iter 1.)
- **Post-edit:** 133 test files pass, 1673 pass / 6 skipped / 0 failed. **+7 net-new** — matches the 7 new `it()` blocks added in Edit D. Zero regressions.
- `npx tsc --noEmit` exit 0 (silent).
- Full-suite run also observed 2 transient "EnvironmentTeardownError: Closing rpc while onUserConsoleLog was pending" attributed to `IdentityModal.test.tsx` on the FIRST run only; ran a second full suite to confirm — second run produced 0 errors, 1673 pass / 6 skipped. STATE.md's prior activity documents this exact class as a known full-suite worker-teardown race triggered by the quick-260808-ho2 `PrettyViewLoadingOverlay.test.tsx` Test D 10s-timeout log; `IdentityModal` in isolation passes 6/6 cleanly. Not a regression from this patch.

## Decisions Made

- **Reused `attemptReconnection()` as the reopen path (not `setRetryKey`):** Terminal already has a dedicated reconnect entrypoint with the full guard set. PrettyView's iter-1 shape uses `setRetryKey(k => k + 1)` to force the WS-setup effect to re-fire, but Terminal doesn't have a state-key-based WS-setup effect (its setup effect keys on `[terminal, hostConfig.id, attach, isConnected, isConnecting]`). Directly invoking `attemptReconnection()` is the safer, structurally-closer reuse.
- **Anchor tests on planted comment tags, not line numbers:** Terminal.tsx is 3434+ lines; line numbers shift constantly. The `quick-260809-eqk` tag is unique and deliberate, making the test assertions survive reformatting.
- **Ship PV diag fix in the same commit:** dishonest diag emit would obscure the iter-2 win — Ashley + tanya need reliable numbers post-ship to declare the empirical rotation done.
- **Main WS-setup effect untouched:** iter 1 shipped a similar tradeoff (PV's setup effect stayed `[hostId, tmuxSession, retryKey]`-keyed so URL-restored offscreen panes still mount their WS); Terminal's `[attach]`-keyed setup effect gets the same treatment. Tmux persists across WS disconnects — no session state lost during the brief open→close cycle.

## Deviations from Plan

None substantive — plan executed exactly as written.

### Minor test-window adjustments (Rule 3 — blocking, discovered on first `npx vitest run` of the wiring test suite)

**1. [Rule 3 - Blocking] Adjusted 4 structural-grep test slice windows to accommodate the verbose rationale-comment blocks planted alongside the code changes**
- **Found during:** Task 1, first isolated run of `Terminal.wiring.test.ts` after the code edits landed.
- **Issue:** My initial test-slice widths (300–800 char windows) were sized for a spartan diff; the verbose ~40-line rationale comment above the new pause effect + the multi-line comment inside the PV snapshotFn pushed the target strings past the slice boundaries. Failures: eqk-2 (block too small to reach `}, [isVisible]);`), eqk-4 (window too small to reach the guard line after the anchor comment), eqk-6 (snapBlock too small to reach `isVisible: isVisibleRef.current`), eqk-7 (afterSnap too small to reach the deps array).
- **Fix:** Widened windows to 8000 / 800 / 1500 / 2000 chars respectively (with rationale comments in each test explaining WHY the width was chosen). All 7 assertions then passed on the re-run.
- **Files modified:** `src/ui/features/terminal/Terminal.wiring.test.ts` only (test-side adjustment; no code semantics changed).
- **Verification:** `npx vitest run src/ui/features/terminal/Terminal.wiring.test.ts` — 26 tests pass in the file after the fix (19 pre-existing + 7 new).
- **Committed in:** `3629562` (same atomic commit — this is the only commit for the plan).

**Total deviations:** 1 minor test-window adjustment (Rule 3 — blocking).
**Impact on plan:** Zero semantic impact; test-side tuning only. The rationale-comment verbosity was a deliberate choice for reviewer discoverability, but the initial test-window sizes were too tight for it — trivial iterative fix.

## Issues Encountered

- Two transient `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` attributed to `IdentityModal.test.tsx` appeared on the FIRST full-suite `npx vitest run` post-edit. Re-ran the full suite (second run: `bb5e7rje8` background task) — errors did NOT recur; second run reported 133 files pass / 1673 pass / 6 skipped / 0 errors. STATE.md prior activity for quick-260808-ho2 documents this exact class as a known worker-teardown race triggered by `PrettyViewLoadingOverlay.test.tsx` Test D's deliberate 10s-timeout log under full-suite parallel-worker pressure. `IdentityModal.test.tsx` in isolation passes 6/6 cleanly. Confirmed not a regression from this patch (my changes touch no console output, no async timeouts, no RPC-forwarded logs).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Code + tests green (1673 pass / 6 skipped / 0 failed on the definitive second run).
- Committed to `feat/tab-title-from-tmux` as `3629562`.
- **NOT pushed, NOT built, NOT deployed** per plan constraints — orchestrator (tiffany) motions post-return:
  - Push to origin (coord-room announce first, per fleet rule "container-mutation serializes").
  - `docker build -f docker/Dockerfile -t skynet-patched:local .` under 15-min deadman.
  - `docker compose up -d --force-recreate skynet`.
  - Byte-verify the shipped bundle contains the new pause effect + guards.
  - Append patch entry (next id) to `~/.claude/roles/box-maintainer/skynet-patches.md`.
  - Retire bounty `pause-hidden-terminal-ws-iter-2` (or whatever the exact bounty JSON name is) once Ashley UATs the diag delta on iPhone 16 Pro Max.
- Post-ship UAT hypothesis: hidden Terminal panes' `wsBytesSinceLast` and diag-emitted reconnect log lines should drop toward zero, mirroring iter 1's PrettyView `wsFramesSinceLast` ~10-13 → ~5 drop.

## Self-Check: PASSED

Verified before returning:

- **File existence checks:**
  - `src/ui/features/terminal/Terminal.tsx` — FOUND (grep confirms 3 `quick-260809-eqk` tags at lines 389, 590, 1037).
  - `src/ui/features/pretty-view/PrettyView.tsx` — FOUND (grep confirms 1 `quick-260809-eqk` tag at line 1276).
  - `src/ui/features/terminal/Terminal.wiring.test.ts` — FOUND (grep confirms the new describe block at line 544 with 7 `it()` blocks).
- **Commit existence:** `git log --oneline` shows `3629562 feat(terminal): pause hidden terminal SSH WS on !isVisible + fix PV diag stale closure (quick-260809-eqk)` — FOUND.
- **Test counts:** baseline 1666/6 → post-edit 1673/6, delta +7 matches the 7 new assertions exactly.
- **tsc:** `npx tsc --noEmit` exit 0.
- **Constraints honored:** no push, no docker, no `~/.claude/roles/box-maintainer/*` edits, no bounty JSON edits, no `.planning/` files in the code commit.

---
*Phase: quick-260809-eqk-pause-hidden-terminal-ws*
*Completed: 2026-08-09*
