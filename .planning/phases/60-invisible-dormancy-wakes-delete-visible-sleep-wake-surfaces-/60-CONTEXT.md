# Phase 60: invisible dormancy/wakes — Context

**Gathered:** 2026-08-23
**Status:** Ready for planning
**Source:** Direct-seeded from `.planning/shapes/shape-invisible-dormancy.md` (produced by `/build` feature-mode `/open` beat). Discuss-phase skipped per `/build` convention when the shape file already captures scope + philosophy + failure modes.

## What this is

Today, when a claude session gets killed by agent-supervisor after 30 minutes idle, PrettyView surfaces that fact prominently — an in-flow bubble at the bottom of the message list says "This session is asleep" with a Wake button. Clicking Wake starts a progress bar filling over ~90 seconds, then dismisses when the freshly-launched claude finishes its `/id <name>` load. The compose box is disabled the entire time — sending a message while dormant is impossible.

This phase deletes all of that visible surface. Whether a pane is currently dormant or in the middle of waking becomes invisible to the user. The compose box is always enabled. If the user sends into a pane that happens to be dormant, the send itself triggers the wake — the message threads into the freshly-woken claude as its first prompt. The only observable difference from a normal send is that reconciliation takes ~90 seconds longer. The failure backstop rides on the existing optimistic-bubble-goes-red mechanism (pv-send-watchdog), with its window widened when the send was dispatched during dormancy so healthy waking never trips the red-bubble.

## Shape (from `shape-invisible-dormancy.md`)

Three intertwined pieces plus one deletion:

1. **Send-while-dormant path.** In the compose-send handler (`__applyInputMessageForTests` at `src/backend/claude-session/claude-session-server.ts:2023-2080`), if the connection's `dormantLastEmitted` closure var is `true` when the input handler fires, drop the `.dormant` sentinel (the same `rm -f ~/.claude/identities/'${name}'/.dormant` exec that today's wake handler at L2472-2492 does), wait for the `.resume-complete` marker with timestamp fresher than send-time (reusing the exact freshness contract from `__applyDormantPollWithRediscoveryForTests` at L2515-2648, MARKER_FALLBACK_MS = 90_000 defined at L770-773), then do the normal tmux `send-keys` delivery. Multiple sends during the wake window naturally serialize on the single sentinel drop.

2. **Widen `pv-send-watchdog` for dormant-triggered sends.** Current constants in `src/backend/claude-session/pv-send-watchdog.ts`: `RETRY_ENTER_MS = 2500`, `FULL_RESEND_MS = 5500`, `GIVE_UP_MS = 20_000` — sized for "normal send, session is up." For a send that started during dormancy, delivery can legitimately take up to `MARKER_FALLBACK_MS + normal_send_window` ≈ 90s + 5.5s = ~100s. The watchdog needs a branch that widens `GIVE_UP_MS` (and possibly delays RETRY_ENTER / FULL_RESEND arm times) when the send was dispatched during dormancy. Widening approach TBD by planner — could be a single `dormantSend: true` opt-in on `armPvSendWatchdog` that swaps to a widened constant set, or a per-arm parameterized window.

3. **Stop leaking "waking" to the frontend.** `claude-session-server.ts:2577` currently emits `{type: "dormant", dormant: true, wakingSince: state.wakeTriggerTs()}` — the `wakingSince` field is what drives the frontend's `waking` state + progress bar. Either stop populating `wakingSince` on this frame, or drop the frame entirely for the send-triggered wake case. Backend still tracks `wakeTriggerTs` internally (needed for the marker freshness gate).

4. **Deletion.** Fully remove:
   - `src/ui/features/pretty-view/DormancyOverlay.tsx` (198 lines — the visible bubble + Wake button + progress bar + error variant)
   - `src/ui/features/pretty-view/ComposeBox.dormant-disable.test.tsx` (207 lines)
   - `PrettyView.tsx:38` import of DormancyOverlay
   - `PrettyView.tsx:631-633` local state (`waking`, `wakingStartTs`, `elapsedSeconds`)
   - `PrettyView.tsx:1995-2007` server-driven `parsed.wakingSince` restore path
   - The `msg.type === "wake"` handler at `claude-session-server.ts:5806-5850` (wake WS message is no longer sent from the frontend since the Wake button is gone; keep or delete — planner call)
   - The `dormantActive` compose-box gate wiring (search `dormantActive` in ComposeBox.tsx + PrettyView.tsx callsite)
   - Any test files exercising the DormancyOverlay component or the wake WS message

## Philosophy (from shape file)

- **Dormancy is a hardware detail, not a user concept.** Whether a claude session is currently in memory is the OS's business, not the user's mental model.
- **Same affordance for dormant sessions as awake ones.** Compose box, optimistic bubble, reconciliation, failure surfacing — identical regardless of state.
- **Send is the only new invisible wake trigger.** Existing invisible triggers (Matrix DM via matrix_peek, scheduled fire) unchanged. No wake-on-focus, no wake-on-scroll.
- **Delete, don't hide.** DormancyOverlay is not preserved behind a debug flag. Fully removed. Backend still knows dormancy; UI does not.

## What would make it wrong

- **Any visible surface that names dormancy or waking to the user** — banner, badge, tooltip, subtle color shift, ambient anything. If the user can tell this pane is dormant by looking, we missed the point.
- **A dormant pane feeling broken when sent to** — the widened pv-send-watchdog window must be wide enough that a healthy ~90s wake never trips the red-bubble backstop.
- **A message getting lost during the wake window** — if send-keys fires before the freshly-launched claude REPL is actually at a prompt (during shell → claude bootstrap → `/id <name>` load), keys go to the shell or /id output routing and vanish. The `.resume-complete` marker check exists specifically to prevent this. The 90s fallback path (attempt delivery anyway when marker never appeared) is a last resort, not the primary strategy.
- **Multiple sends landing out of order** — natural sentinel-drop-then-wait serializes, but implementation must not spawn parallel per-send handlers that race.
- **Backend "waking" state leaking to the frontend** — internal tracking is fine and required; any emission the UI could latch onto must stop or be explicitly ignored.
- **Any wake trigger other than send.** Wake-on-focus / wake-on-scroll / wake-on-hover — all violate the shape.

## Prior context

**Today's dormancy overlay** (`src/ui/features/pretty-view/DormancyOverlay.tsx`, 198 lines) is a rich in-flow bubble mounted when `renderedState === "dormant"`. Three variants: asleep (Moon glyph + Wake button), waking (Moon + progress bar filling to 95% over `WAKE_ETA_SECONDS = 90`, no button, no spinner per motion-channel guardrail), error (warm-red retry). Progress bar is expectation-setting only — dismissal happens via PrettyView's live-frame auto-dismiss when the pane goes live. History: originally a full-surface scrim (patch #74), redesigned in mid-August (quick 260812-ma8) to an in-flow bubble so message history stays readable.

**Today's wake handler** (`claude-session-server.ts:5806-5850` + `__applyWakeMessageForTests` at L2472-2492): guard on `currentTmuxSession + sshConn + isIdentityShapedCached === true` (T-cd6-01 trust boundary — client-supplied hostId/tmuxSession ignored). Execs `rm -f ~/.claude/identities/'${escapedName}'/.dormant`. Sends `wake_result: ok` (or ok:false + error). Does NOT fast-poke the supervisor — next CHECK_INTERVAL tick picks up the sentinel-gone signal.

**Today's `.resume-complete` freshness contract** (`claude-session-server.ts:770-773`, `L2515-2648`, L6991-6996). Agent-supervisor writes `~/.claude/identities/<name>/.resume-complete` at the end of the `/id <name>` load sequence. Backend's dormant-poll (`__applyDormantPollWithRediscoveryForTests`) reads it via `cat ~/.claude/identities/'${name}'/.resume-complete 2>/dev/null || echo`. When `wakeTriggerTs` is non-null (user-initiated wake), dismiss requires either `marker_ts > triggerTs` OR the 90s `MARKER_FALLBACK_MS` window to have elapsed. Natural resumes (matrix_peek, scheduled) skip the freshness check entirely.

**Today's compose gate** — `dormantActive = renderedState === "dormant" || waking` on the compose-box mount. Reduces ComposeBox to its dormant treatment (send button disabled, textarea disabled). File: `PrettyView.tsx` (search `dormantActive`) + ComposeBox.tsx dormant-treatment branch.

**Today's send handler** — `msg.type === "input"` at `claude-session-server.ts:5750-5790`, delegates to `__applyInputMessageForTests` at L2023+. Compose-send shape (per patch #110): `mqid.length > 0 && data.endsWith("\r")` → split-send (body first, 1000ms delay, Enter). The watchdog is armed after the send via `armWatchdog` callback (Phase 50 Plan 02 Task 2 wiring at L5771-5778).

**Today's watchdog** (`src/backend/claude-session/pv-send-watchdog.ts`): after a compose-send arms, watches for the sent message to appear in the session file. At `RETRY_ENTER_MS = 2500` retries just the Enter keystroke. At `FULL_RESEND_MS = 5500` re-sends the whole body. At `GIVE_UP_MS = 20_000` emits `paste_send_failed` → frontend flips optimistic bubble to red.

**Recycle is a different mechanism** — full-surface scrim + centered card (`SessionHoldingOverlay.tsx`) that appears during a user-initiated recycle (identity dropped `.recycle-requested`). Recycle explicitly out of scope; SessionHoldingOverlay stays exactly as-is. See shape file § Prior context.

**Identity birth is a different mechanism** — `identity-harness-start.ts` uses a timing-based Enter train (2s sleep + 7 blind Enters at 3s spacing, ~20s total) since first-launch has no prior `.resume-complete` marker to gate on. Birth path unchanged by this phase.

**Agent-supervisor is out-of-repo** — the sentinel/marker contract (`.dormant`, `.resume-complete`, `.recycle-requested`, `.no-dormancy`) is owned by `~/vms-apps/apps/home/agent-supervisor.sh` on the fleet. This phase makes no changes to that contract; it rides on the existing one.

## Scope

**In:**
- Delete `DormancyOverlay.tsx` and its full frontend wire-up (import, local state, mount site, `wakingSince` restore path, wake WS message emission).
- Delete or gut `msg.type === "wake"` handler if no consumer remains after frontend cleanup.
- Delete `ComposeBox.dormant-disable.test.tsx` and un-gate the compose box (drop `dormantActive` prop plumbing).
- Teach `__applyInputMessageForTests`: on-entry check `dormantLastEmitted`; if dormant, drop the `.dormant` sentinel + wait for `.resume-complete` marker fresher than send-time (or `MARKER_FALLBACK_MS` fallback), then proceed with normal tmux delivery.
- Widen `pv-send-watchdog` window (`GIVE_UP_MS` at minimum, possibly RETRY_ENTER / FULL_RESEND too) when the arm was for a dormant-triggered send. Threading approach TBD (option on `armPvSendWatchdog`, or a separate `armPvSendWatchdogDormant` variant, or per-arm parameterized window — planner call).
- Suppress or drop the `wakingSince` field on the `{type:"dormant"}` frame (L2577) so the frontend doesn't reconstruct waking state.
- Suppress dormant frame emission entirely if the frontend has no consumer left (planner call — the frame drives DormancyOverlay mount today, but the frontend also uses `paneState === "dormant"` for the compose gate we're deleting; audit any remaining consumers).
- Test coverage: send-while-dormant lands the message after marker (or fallback); send-while-dormant with two-message burst preserves order; deleted UI's tests removed; widened watchdog window doesn't false-fire during a healthy ~90s wake; existing invisible wake triggers (Matrix DM path, scheduled fire path) still work — nothing regresses on `natural resume` (wakeTriggerTs null) path.

**Out (deferred to separate work):**
- Any change to `SessionHoldingOverlay` or recycle mechanics.
- Any change to identity birth flow (`identity-harness-start.ts`).
- Any change to agent-supervisor scripts or the sentinel/marker contract.
- Wake-on-focus, wake-on-scroll, or any other implicit wake trigger.
- The existing invisible wake triggers (Matrix DM, scheduled) — no changes; they already work as intended.
- Any escape-hatch UI in PrettyView for "session is stuck" (Ashley confirmed she doesn't use the current Wake button as escape).
- New user-facing observability of the dormancy/wake subsystem. Backend logs (`sshLogger.info`) stay as-is.

**Tempting-but-no:**
- Rewriting pv-send-watchdog beyond adding a widened-window branch.
- Any "wake happening" indicator that partially violates invisibility (paperclip glyph, pending badge, tiny status pill, etc.).
- Migrating the `.resume-complete` marker contract to something more general. Works fine for this.

## Success criterion

**User-visible:**
- Opening PrettyView on a dormant pane looks identical to opening it on an awake-idle pane. No bubble, no badge, no ambient marker.
- Sending into a dormant pane succeeds. Optimistic bubble appears with spinner (normal), remains ~90s longer than usual, then reconciles when message lands (normal). No visible wake ceremony.
- Sending two messages into a dormant pane in a short burst: both land in send order after wake.
- Sending into a dormant pane where the wake genuinely fails (supervisor dead, box off, etc.): optimistic bubble goes red after the widened watchdog window — same visible failure mode as any other send that never landed.

**Non-regression:**
- Matrix DM arriving on a dormant pane still wakes it invisibly (no UI change).
- Scheduled fire on a dormant pane still wakes it invisibly.
- Recycle (`.recycle-requested`) still shows SessionHoldingOverlay full-surface scrim.
- Identity birth (`identity-harness-start.ts`) unchanged.
- Fleet-status ready-dot behavior unchanged (still "in active set AND idle").
- Sends into an awake pane behave identically to today — watchdog window unchanged for non-dormant sends.

**Ship-gate:** full `npx vitest run` green; scoped tests pass throughout dev; docker build + force-recreate; HTTPS 200; Ashley UAT — invisible wake works, red-bubble fires on real failure.

## Canonical refs

- `.planning/shapes/shape-invisible-dormancy.md` — the authoritative shape agreement; `/close` walks this to verify conformance.
- `src/backend/claude-session/claude-session-server.ts` — send handler, wake handler, dormant-poll seam, `.resume-complete` freshness contract, `wakingSince` frame emission. Line refs in Prior context above.
- `src/backend/claude-session/pv-send-watchdog.ts` — reconciliation watchdog + timing constants (`RETRY_ENTER_MS`, `FULL_RESEND_MS`, `GIVE_UP_MS`).
- `src/backend/claude-session/sentinel-detect.ts` — sentinel presence detection.
- `src/backend/claude-session/pane-state-emitter.ts` — pane-state event flow; audit for any `waking` emission needing suppression.
- `src/ui/features/pretty-view/DormancyOverlay.tsx` — DELETE.
- `src/ui/features/pretty-view/ComposeBox.dormant-disable.test.tsx` — DELETE.
- `src/ui/features/pretty-view/PrettyView.tsx` — mount site + local waking state + wakingSince restore path.
- `src/ui/features/pretty-view/ComposeBox.tsx` — `dormantActive` prop plumbing to remove.
- `src/ui/features/pretty-view/SessionHoldingOverlay.tsx` — reference only; NOT touched (recycle overlay, out of scope).
- `src/backend/database/routes/identity-harness-start.ts` — reference only; NOT touched (birth path, out of scope).

## Fleet-directive reminders for the planner

- **Frontend `tsc --noEmit` does NOT catch backend TS errors.** This phase touches both backend and frontend — pre-push typecheck for any backend edit is `npm run build:backend && npm run build`, NOT just `npx tsc --noEmit`.
- **Executor's remit stops at code + commit + tests green.** Any "ship" motion (git push, docker build, docker compose up --force-recreate) is orchestrator-only. Plans MUST NOT include a ship task at executor scope.
- **Scoped tests during dev, full suite at ship-gate.** Executor prompts should say "run scoped tests for the touched files" as the green-gate — not `npx vitest run` full suite. Full suite runs at orchestrator ship-gate before `docker build`.
- **Log at interaction/lifecycle/effect boundaries.** New send-while-dormant path is exactly the kind of code that needs `sshLogger.info` at path-taken transitions: "send received while pane dormant, dropping sentinel", "sentinel dropped, waiting for .resume-complete marker", "marker appeared (or fallback fired), delivering send-keys", "send-keys complete". Include `hostId`, `tmuxSession`, `mqid`, and elapsed-ms values. As a maintainer diagnosing from forensic logs, these transitions ARE the diagnostic tool.
- **NEVER use git worktrees.** All work on the main working tree, current branch `feat/tab-title-from-tmux`.
- **CSS fast-path is not applicable** — this phase touches backend TS + frontend TS + tests, not CSS. Deploy via full `docker build` + `docker compose up --force-recreate`.
- **Multi-identity coord** — box-maintainer runs under multiple identities on this branch. `git pull --rebase origin feat/tab-title-from-tmux` before every push. Container mutations (build + recreate) require BEFORE + AFTER posts to the box-maintainer coord room (Matrix `!FHdIfqtmSWcGYUfyVp:thenasty.taild9b663.ts.net`), except when all peer identities have `.dormant` sentinel present.
