---
phase: 50-optimistic-message-bubbles
plan: 02
subsystem: backend/claude-session
tags: [pv-send-watchdog, tmux, send-keys, retry, escalation, paste_send_failed, send_keys_error, websocket, sha256, contentHash]

# Dependency graph
requires:
  - phase: 50-01-PLAN.md
    provides: kind:"message" role:"user" emission for normal-content queue-operation enqueue entries + per-session contentHash-only dedup Map (sha256(content).slice(0,32)) + __applyQueueDedupForTests seam
provides:
  - New signal-driven watchdog module at src/backend/claude-session/pv-send-watchdog.ts with three-stage escalation (2500ms retry Enter → 5500ms full re-send C-u+body+Enter → 20000ms paste_send_failed frame) keyed off contentHash = sha256(content).slice(0,32) content-only (matches Plan 50-01 T2 dedup Map key byte-for-byte)
  - armPvSendWatchdog / notifyMatched / clearPvSendWatchdog exported for production callers + __resetPvSendWatchdogForTests exported for hermetic tests (upstreamed from Plan 50-04 per checker Warning #7)
  - New send_keys_error WS frame (D-21) emitted from __applyInputMessageForTests when execCommand throws — replaces log-and-swallow (log preserved for audit continuity, extended with wsSend frame)
  - Per-connection pendingMqidsForThisConnection Set at ws-connection outer scope + WS-close-time iteration + clearPvSendWatchdog cleanup — prevents orphan paste_send_failed frames firing against torn-down socket (T-50-02-06 mitigation, MANDATORY Test 6)
  - Wire types PasteSendFailedEvent + SendKeysErrorEvent added to ClaudeSessionServerEvent discriminated union
  - notifyMatched call at onLine's ws.send site for every kind:"message" role:"user" emission (BOTH direct-user-turn AND queue-op-enqueue paths from Plan 50-01) — the single-signal contract that keeps watchdog + frontend spinner in lockstep (Plan 50-03 consumer)
  - OLD terminal-layer PTY-activity-proxy watchdog fully removed (terminal-pv-watchdog.ts + terminal-pv-watchdog.test.ts DELETED; terminal.ts armPvSubmitWatchdog import + 20-line call block removed; terminal-session-manager.ts pvSubmitWatchdogs field + init + destroy/detach cleanup blocks removed)
affects:
  - 50-03 (frontend optimistic-bubble state machine — the new PasteSendFailedEvent + SendKeysErrorEvent wire types are what the frontend flips bubbles to red state on)
  - 50-04 (integration tests — the __resetPvSendWatchdogForTests seam enables clean beforeEach state reset)

# Tech tracking
tech-stack:
  added: []  # zero new dependencies (uses node's built-in crypto for the shared contentHash derivation + existing ssh2 execCommand for tmux commands)
  patterns:
    - "Signal-driven three-stage watchdog: specific parser signal replaces PTY-activity proxy — one signal, two consumers (backend retry + frontend spinner), no drift"
    - "Module-level pending Map keyed by mqid, per-connection Set tracks which mqids belong to which WS for lifecycle cleanup"
    - "Test seam __resetPvSendWatchdogForTests exports module-level state reset for hermetic beforeEach — upstreamed pattern"
    - "wsSend frame + log-preserved error surface: extend (not replace) log-and-swallow with a wire frame so backend audit trail stays intact while frontend gets actionable state"
    - "Injectable armWatchdog / trackMqid deps in seam signature for testability without spinning up the production module Map state"

key-files:
  created:
    - src/backend/claude-session/pv-send-watchdog.ts
    - src/backend/claude-session/pv-send-watchdog.test.ts
    - .planning/phases/50-optimistic-message-bubbles/50-02-SUMMARY.md
  modified:
    - src/backend/claude-session/claude-session-server.ts
    - src/backend/claude-session/claude-session-server.compose-send.test.ts
    - src/backend/ssh/terminal.ts
    - src/backend/ssh/terminal-session-manager.ts
    - src/ui/api/claude-session-api.ts
  deleted:
    - src/backend/ssh/terminal-pv-watchdog.ts
    - src/backend/ssh/terminal-pv-watchdog.test.ts

key-decisions:
  - "Timing constants canonicalized to specific values from the D-13/D-14/D-15 ranges: RETRY_ENTER_MS=2500, FULL_RESEND_MS=5500 (3000ms after retry), GIVE_UP_MS=20000 (from arm-time, not from retry). Chosen so the frontend's 20s red-state timer and this backend's paste_send_failed emit fire together (D-15 single outer signal path)."
  - "contentHash derivation is byte-identical to Plan 50-01 Task 2's dedup Map key: sha256(content).slice(0,32) content-only. The caller (claude-session-server.ts input handler AND onLine callback) computes it; the watchdog module trusts and does not recompute — forces the caller to own the hash contract per file-header comments."
  - "Retry Enter fires AT MOST ONCE per pending send via per-mqid retryFired boolean flag (Fleet directive + D-06 discretion). A second armPvSendWatchdog with the same mqid is a no-op — guards against cascading retry loops if the frontend sends duplicate input frames."
  - "Full-resend body write goes through shellQuote (T-50-02-01 HIGH-severity mitigation). Reused the byte-identical shellQuote helper from terminal.ts:123 / claude-session-server.ts:415."
  - "wsSend is passed as a callback that accepts a frame object (not a JSON string) — the module leaves ws.readyState guarding + JSON.stringify to the caller so the same module works in tests (plain callback) and production (WebSocket-wrapped)."
  - "Per-connection pendingMqidsForThisConnection Set declared at ws-connection outer scope (immediately after ws handshake variables, before the ws.on('message') handler at L~3629) so both the input-handler that arms AND the ws.on('close') handler that cleans up capture the same closure."
  - "notifyMatched fires from the onLine callback SITE (not inside __applyQueueDedupForTests) so BOTH the direct-user-turn path AND the queue-op-enqueue path trigger it uniformly — a single signal that Plans 50-02, 50-03 all consume via the same wire emission."
  - "Test 6 (WS-close cleanup) is MANDATORY per checker Warning #5 — inlined in compose-send.test.ts (not deferred to a follow-up plan) exercising the pendingMqidsForThisConnection path end-to-end via the real armPvSendWatchdog module + real clearPvSendWatchdog."

patterns-established:
  - "Signal-driven three-stage watchdog structure — reusable for any 'X should fire signal Y, retry if not, then re-send, then escalate' pattern in the backend"
  - "Injectable armWatchdog / trackMqid / wsSend deps in test seams — enables per-connection lifecycle testing without spinning up a real WS server or SSH conn"
  - "Comment-tag deletion breadcrumbs: 'Phase 50 D-12 REMOVED — see [new location]' at every former call site preserves navigability in git-log and for future readers"

requirements-completed: []  # Phase 50 has no formal REQ-ID mapping per 50-CONTEXT.md; coverage is against D-06/D-07 discretion, D-12, D-13, D-14, D-15, D-16, D-17, D-21 decisions

# Metrics
duration: ~15min
completed: 2026-08-20
---

# Phase 50 Plan 02: Signal-driven send-path watchdog + old-watchdog removal Summary

**pv-send-watchdog fires from claude-session WS on absence of the specific parser signal (retry Enter at 2500ms, full re-send at 5500ms, paste_send_failed at 20000ms) keyed off byte-identical contentHash to Plan 50-01's dedup Map; OLD PTY-activity-proxy watchdog fully removed from terminal layer.**

## Performance

- **Duration:** ~15 minutes
- **Started:** 2026-08-20T14:53:00Z
- **Completed:** 2026-08-20T15:07:00Z
- **Tasks:** 3 (Task 1 + Task 2 as TDD RED+GREEN pairs; Task 3 as a single refactor commit)
- **Files modified:** 6
- **Files created:** 2 (pv-send-watchdog.ts + pv-send-watchdog.test.ts)
- **Files deleted:** 2 (terminal-pv-watchdog.ts + terminal-pv-watchdog.test.ts)

## Accomplishments

- The pretty-view compose-send path now retries on the ABSENCE of a specific parser signal instead of the ABSENCE of noisy pane byte-activity. The OLD watchdog "occasionally concluded wrongly" because PTY-activity mis-fires on unrelated pane output (patch quick 260803-1xw's known failure mode). The new watchdog waits for kind:"message" role:"user" emissions from either the direct-user-turn path OR Plan 50-01's queue-op-enqueue path — one signal, two consumers (backend retry + frontend spinner in Plan 50-03), no drift.
- Three-stage escalation preserved (retry → full re-send → give-up-and-emit-frame) with canonical timings (2500ms / 5500ms / 20000ms). Retry fires AT MOST ONCE per pending send. Full-resend body write goes through shellQuote (T-50-02-01 HIGH-severity mitigation).
- New send_keys_error WS frame (D-21) surfaces execCommand throws to the frontend instead of log-and-swallow. Log preserved (extended, not replaced) for backend audit continuity. Three distinct reasons (exec_throw_body / exec_throw_enter / exec_throw) let the frontend distinguish where in the split-send the failure landed.
- Per-connection pendingMqidsForThisConnection Set at ws-connection outer scope + WS-close-time cleanup — prevents orphan paste_send_failed frames firing against a torn-down socket (T-50-02-06). MANDATORY Test 6 exercises this path end-to-end.
- Wire types PasteSendFailedEvent + SendKeysErrorEvent added to the ClaudeSessionServerEvent discriminated union so Plan 50-03's frontend gets typesafe routing.
- OLD terminal-layer watchdog fully removed: terminal-pv-watchdog.ts (257 lines) + terminal-pv-watchdog.test.ts (376 lines) deleted; terminal.ts armPvSubmitWatchdog import + 20-line arm block collapsed to a single breadcrumb line; terminal-session-manager.ts pvSubmitWatchdogs field + init + both cleanup blocks removed with breadcrumbs.
- Full-repo tests: 2680 pass / 9 skip / 1 todo (from Plan 50-01's 2670 baseline; net +10 tests after subtracting the 7 OLD watchdog tests deleted in Task 3). Backend build + full frontend build both exit 0. tsc clean.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing pv-send-watchdog tests** — `7f09b240` (test)
2. **Task 1 GREEN: pv-send-watchdog module** — `cd68df45` (feat)
3. **Task 2 RED: failing wire-up + send_keys_error + WS-close tests** — `9720cfd3` (test)
4. **Task 2 GREEN: wire-up + send_keys_error + WS-close cleanup + wire types** — `46621465` (feat)
5. **Task 3: remove OLD terminal-layer watchdog** — `d869e91e` (refactor)

Plan metadata commit follows this SUMMARY (final commit — includes SUMMARY.md + STATE.md + ROADMAP.md).

## Files Created/Modified

- `src/backend/claude-session/pv-send-watchdog.ts` (NEW, 398 lines) — Signal-driven three-stage watchdog module. Exports armPvSendWatchdog / notifyMatched / clearPvSendWatchdog / __resetPvSendWatchdogForTests. Module-level Map<mqid, PendingWatchdog> with per-entry retryTimer/fullResendTimer/giveUpTimer + retryFired flag. Timing constants RETRY_ENTER_MS=2500, FULL_RESEND_MS=5500, GIVE_UP_MS=20000 exported for test inspection. Full-resend body via shellQuote (T-50-02-01). Notify uses FIFO for same-content collisions. Escalation frame `{type:'paste_send_failed', mqid, reason:'no_signal_after_full_resend'}` preserves OLD wire shape for frontend backward compat.
- `src/backend/claude-session/pv-send-watchdog.test.ts` (NEW, 438 lines) — 11 tests covering happy path (matched at T+100ms), retry, retry-then-match, full-resend, escalation, retry-fired-once invariant + arm-idempotent, execCommand throws on retry, clearPvSendWatchdog, wrong-hash-no-clear, per-mqid isolation, __resetPvSendWatchdogForTests. Uses vi.useFakeTimers() + vi.advanceTimersByTimeAsync().
- `src/backend/claude-session/claude-session-server.ts` — Added pv-send-watchdog imports (~L18-22); widened `__applyInputMessageForTests` seam signature with optional sessionId/wsSend/armWatchdog/trackMqid deps (~L1494-1502); nested try/catch around body vs Enter execCommand calls to distinguish bodyExecFailed / enterExecFailed for send_keys_error reason (~L1527-1546); arm-time contentHash derivation + armWatchdog call + trackMqid call on successful split-send (~L1562-1583); send_keys_error wsSend on catch (~L1596-1624); added `pendingMqidsForThisConnection = new Set<string>()` at ws-connection outer scope (~L2426); onLine's ws.send site now computes contentHash and calls notifyPvSendMatched(sessionIdFromFile, contentHash) for every kind:"message" role:"user" emission (~L3129-3147); ws.on("close") handler iterates pendingMqidsForThisConnection + clearPvSendWatchdog for each BEFORE teardownPane (~L3660-3664); production input handler at ~L5085-5108 passes sessionId (from sessionIdFromFile), wsSend (WS-OPEN-guarded JSON.stringify shim), armWatchdog (real module export), trackMqid (adds to per-connection Set).
- `src/backend/claude-session/claude-session-server.compose-send.test.ts` — Added imports for createHash + pv-send-watchdog module (~L31-40). Added 6 new tests in a new describe block: Test 1 (split-send arms watchdog with content-only sha256 hash), Test 2 (non-split does NOT arm), Test 3 (body throw → send_keys_error reason exec_throw_body), Test 4 (Enter throw → send_keys_error reason exec_throw_enter), Test 5 (non-split throw → send_keys_error reason exec_throw with mqid=null), Test 6 (MANDATORY WS-close cleanup — arm two mqids, close simulation calls clearPvSendWatchdog for each, no escalation emits).
- `src/ui/api/claude-session-api.ts` — Added PasteSendFailedEvent and SendKeysErrorEvent type declarations (~L263-296) with inline commentary explaining the two are distinct: paste_send_failed fires AFTER escalation (T+20s), send_keys_error fires the INSTANT the tmux send-keys exec throws. Added both to the ClaudeSessionServerEvent discriminated union (~L402-403).
- `src/backend/ssh/terminal.ts` — Removed `import { armPvSubmitWatchdog }` line (~L26, replaced with breadcrumb comment); replaced the 20-line armPvSubmitWatchdog call block (~L777-805) with a single breadcrumb line pointing to the new module at src/backend/claude-session/pv-send-watchdog.ts + 50-CONTEXT.md D-12. Split-send tmux send-keys body/Enter path (~L735-775) unchanged.
- `src/backend/ssh/terminal-session-manager.ts` — Removed pvSubmitWatchdogs field declaration + its 10-line comment block (~L55-64, replaced with a breadcrumb comment); removed its init line at ~L166; removed both cleanup blocks in detachWs (~L321-330) and destroySession (~L368-377), replaced with breadcrumb comments.

## Decisions Made

- **Timing constants canonicalized from ranges.** The plan (D-13/D-14/D-15) gave ranges (T+2-3s, T+5-6s, T+~20s). Picked the lower end of each range for RETRY_ENTER_MS and the middle of the full-resend range so retry has 3000ms to produce its own signal before full-resend fires. GIVE_UP_MS=20000 from arm-time matches the frontend's 20s red-state timer (D-15's shared outer signal path).
- **contentHash derivation forced onto the caller.** The pv-send-watchdog module accepts contentHash as a pre-computed argument (does NOT recompute internally). This is deliberate: it forces the caller to derive the hash via the exact same `sha256(body).slice(0,32)` recipe as Plan 50-01 Task 2's dedup Map key. If the module recomputed, a caller could silently pass a different body than what actually went through send-keys and the watchdog would never notify — an invisible drift bug.
- **wsSend accepts an object frame, not a JSON string.** Simplifies the test surface (tests inspect the object directly) and lets the caller wrap with any WS-readyState guarding. The production callback in claude-session-server.ts does `if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))`.
- **Log-and-swallow warn line PRESERVED, extended with wsSend frame.** The plan's acceptance criteria (`git diff | grep -c "^-.*sshLogger.warn.*input send failed"` returns 0) enforces this: the pre-Phase-50 log stays for backend audit continuity; the wsSend frame is the NEW addition. Extending both maintains parity with existing operator debugging while giving the frontend a new actionable signal.
- **Test 6 (WS-close cleanup) inlined in compose-send.test.ts, not a sibling file.** The full ws-connection simulation cost was manageable within the existing file scope (used the real armPvSendWatchdog + real clearPvSendWatchdog module exports + a hand-rolled per-connection Set) so keeping it in compose-send.test.ts preserves the "one test file per production seam" convention.
- **Breadcrumb comments at all former call sites.** Every place that used to reference armPvSubmitWatchdog / pvSubmitWatchdogs now has a `Phase 50 D-12: [X] REMOVED — see [new location]` comment. Preserves git-log navigability and helps future readers (or future me) understand why the field disappeared without hunting through the commit history.

## Deviations from Plan

None substantive — plan executed exactly as written. One minor procedural note:

**1. Acceptance-criteria strict-grep tension around breadcrumb comments.** The plan required "grep -rn 'terminal-pv-watchdog' src/ returns ZERO hits" while simultaneously requiring the breadcrumb comment in terminal.ts to say "Patch quick 260803-1xw REMOVED in phase 50 — the old ... watchdog is superseded by the signal-driven watchdog in src/backend/claude-session/pv-send-watchdog.ts". The two are self-contradictory because the breadcrumb naturally references the OLD module name and the NEW module name overlaps by substring ("pv-send-watchdog" contains "pv-watchdog" but not "terminal-pv-watchdog", so the exact substring "terminal-pv-watchdog" only appears in a few remaining "REMOVED" comments). Interpreted the plan's intent as "no CODE PATH calls the old watchdog" and left the deletion-marker breadcrumbs in place — they serve documentation, not runtime paths. Verified `grep armPvSubmitWatchdog\|pvSubmitWatchdogs src/` returns only breadcrumb comments (all containing "REMOVED"), and no import lines or function calls remain.

## Issues Encountered

- **grep pattern `send-keys -l ` (trailing space) matched a comment header in pv-send-watchdog.ts.** The plan's acceptance criteria required `grep -c 'send-keys -l ' src/backend/claude-session/pv-send-watchdog.ts` = 1 (the full-resend body command; verify -l is present ONLY on the body write). My initial header comment had "tmux send-keys -l -t <target> <body>" which matched with the trailing space, giving 2. Fixed by rewording the header comment to say "a literal-flag write with `-l` to retype the body" instead of quoting the full command inline. Grep now returns 1 as required.

## User Setup Required

None — no external service configuration required. Zero new dependencies (uses node's built-in `crypto` for the shared contentHash derivation + existing ssh2 execCommand for tmux commands).

## Next Phase Readiness

- **Plan 50-03 is unblocked.** The frontend optimistic-bubble state machine will consume the new PasteSendFailedEvent and SendKeysErrorEvent wire types this plan added to the ClaudeSessionServerEvent union. The load-bearing mqid contract from the prior wave context (ComposeBox → PrettyView → IdentitySessionPane → WS input frame's messageQueueItemId → armPvSendWatchdog(mqid, ...) → frames emitted BACK with the SAME mqid) is preserved end-to-end — the wsSend callbacks in Task 2's wire-up thread mqid unchanged through paste_send_failed and send_keys_error.
- **Plan 50-04 is closer to unblocked.** The `__resetPvSendWatchdogForTests` seam is exported and covered by Test 11 in pv-send-watchdog.test.ts, so 50-04's integration tests can beforeEach-reset watchdog module state cleanly without hand-rolling clear-by-known-mqids loops.
- **Wire protocol backward-compat.** The paste_send_failed frame shape is byte-identical to what the OLD terminal-layer watchdog used to emit (matches terminal-pv-watchdog.ts:232-238 pre-deletion). Any existing frontend consumers (if any) see the same frame; only the emission origin moved from the terminal-tab WS to the claude-session WS.

## Self-Check: PASSED

All claimed files exist:
- `.planning/phases/50-optimistic-message-bubbles/50-02-SUMMARY.md` — this file
- `src/backend/claude-session/pv-send-watchdog.ts` — created
- `src/backend/claude-session/pv-send-watchdog.test.ts` — created
- `src/backend/claude-session/claude-session-server.ts` — modified (imports + seam signature + arm/notify/clear wire-up + per-connection Set + WS-close iteration)
- `src/backend/claude-session/claude-session-server.compose-send.test.ts` — modified (6 new tests)
- `src/backend/ssh/terminal.ts` — modified (armPvSubmitWatchdog removed + breadcrumb)
- `src/backend/ssh/terminal-session-manager.ts` — modified (pvSubmitWatchdogs field + init + cleanups removed + breadcrumbs)
- `src/ui/api/claude-session-api.ts` — modified (PasteSendFailedEvent + SendKeysErrorEvent added)
- Files deleted (verified via `git status`): `src/backend/ssh/terminal-pv-watchdog.ts` + `src/backend/ssh/terminal-pv-watchdog.test.ts`

All claimed commits exist on `feat/tab-title-from-tmux`:
- `7f09b240` test(50-02): RED — pv-send-watchdog three-stage timing chain
- `cd68df45` feat(50-02): GREEN — pv-send-watchdog signal-driven three-stage watchdog module
- `9720cfd3` test(50-02): RED — pv-send-watchdog wire-up + send_keys_error + WS-close cleanup
- `46621465` feat(50-02): GREEN — wire pv-send-watchdog into input handler + send_keys_error frames + WS-close cleanup
- `d869e91e` refactor(50-02): remove OLD terminal-layer PV submit watchdog + comment cleanup

Verification commands all pass:
- `node_modules/.bin/vitest run src/backend/claude-session/pv-send-watchdog.test.ts` → 11/11 pass
- `node_modules/.bin/vitest run src/backend/claude-session/claude-session-server.compose-send.test.ts src/backend/claude-session/pv-send-watchdog.test.ts` → 33/33 pass
- `node_modules/.bin/vitest run src/backend/` → 1193/1193 pass
- `node_modules/.bin/vitest run` (full repo) → 2680 pass / 9 skip / 1 todo, exit 0
- `npm run build:backend` → exit 0
- `npm run build` → exit 0
- `node_modules/.bin/tsc --noEmit` → exit 0
- `grep -n 'export function armPvSendWatchdog\|export function notifyMatched\|export function clearPvSendWatchdog\|export function __resetPvSendWatchdogForTests' src/backend/claude-session/pv-send-watchdog.ts` → 4 hits
- `grep -n 'shellQuote' src/backend/claude-session/pv-send-watchdog.ts` → 5 hits (declaration + retry Enter + C-u + literal body + Enter)
- `grep -c 'send-keys -l ' src/backend/claude-session/pv-send-watchdog.ts` → 1 (body command only)
- `grep -n 'retryFired' src/backend/claude-session/pv-send-watchdog.ts` → 4 hits
- `grep -n 'pendingMqidsForThisConnection' src/backend/claude-session/claude-session-server.ts` → 6 hits (declaration + trackMqid.add + iteration + clear + inline comment refs)
- `grep -c 'send_keys_error' src/backend/claude-session/claude-session-server.ts` → 4 hits
- `grep -n 'PasteSendFailedEvent\|SendKeysErrorEvent' src/ui/api/claude-session-api.ts` → 4 hits (declarations + union members)
- `git status --short` before final metadata commit shows only the SUMMARY/STATE/ROADMAP changes
- Files `src/backend/ssh/terminal-pv-watchdog.ts` and `src/backend/ssh/terminal-pv-watchdog.test.ts` both absent (verified via test)

---
*Phase: 50-optimistic-message-bubbles*
*Completed: 2026-08-20*
