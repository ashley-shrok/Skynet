# Phase 62: Invisible-dormancy client-side follow-up — Context

**Gathered:** 2026-08-30
**Status:** Ready for planning
**Source:** Direct-seeded from live diagnosis with Ashley 2026-08-30 (log trace + code walk of hilda@workstation dormant-send repro at 13:45:54Z, plus JSONL forensics on `e59b2000-*.jsonl`). Discuss-phase skipped — the two waves are already fully scoped by the diagnosis + parent bounties (`pv-client-pending-send-timer-dormancy-blind`, `pv-queue-op-dedup-doesnt-survive-wake-recycle`).

## What this is

Phase 60 (patch #519, shipped 2026-08-29 by tina) delivered "invisible dormancy" server-side: `__applyInputMessageForTests` notices the pane is dormant at send-time, drops the `.dormant` sentinel, waits for the `.resume-complete` marker (or `MARKER_FALLBACK_MS = 90_000` fallback), then dispatches the normal split-send to the freshly-woken claude. The backend `pv-send-watchdog` was extended with a `dormantSend: true` flag that swaps its timing constants to `RETRY_ENTER_MS_DORMANT = 92_500ms`, `FULL_RESEND_MS_DORMANT = 95_500ms`, `GIVE_UP_MS_DORMANT = 100_000ms` — comfortably above a healthy ~90s wake so the backend red-bubble backstop doesn't false-fire.

**Phase 60 missed a symmetric client-side surface.** PrettyView.tsx has its own 20-second per-pending-send timer (Phase 50 Plan 03, `handleOptimisticSend` at PrettyView.tsx:1082-1134, arm at :1119-1121) that is UNAWARE the send is inside an invisible-wake window. At T+20s from the client's `[compose] submit-entry` it fires `flipToFailed(mqid, "client_timeout_20s")` unconditionally → bubble border goes red, text goes back into compose — exactly the "dormant pane feeling broken when sent to" failure mode the Phase 60 shape file (line 119-124) explicitly said would not happen. Confirmed live 2026-08-30 with Ashley:

- 13:45:54.772Z: server `pv_input_dormant_send_start` (send received, dormant, sentinel drop initiated)
- 13:46:14.775Z: client `[pv-optim] flip-to-failed mqid=pv-optim-1788097554772-cmez7e7w reason=client_timeout_20s` — **exactly T+20.003s from the client's send**
- 13:46:26.153Z: server `[pv-input] .resume-complete marker fresh; dispatching send-keys` (elapsedMs=31379)
- Total: bubble went red **~11 seconds BEFORE** the server actually delivered the message.

**Root process cause of the Phase 60 miss:** the shape file used singular "widen THE watchdog" language, and the reference-files list named only `pv-send-watchdog.ts` (the backend one). Both /close and the verifier read "watchdog widened" as a static check for the presence of the backend constants + wire-up, marked the row present, and moved on. Neither ran a live-repro of the shape's "what would make it wrong" bullets. Tracked separately as low-priority process bounty `build-process-close-missed-symmetric-client-side-phase-60`; NOT in scope for Phase 62.

**Second observation — duplicate bubbles.** Ashley reported that after the red bubble, her "testing 1 2 3" message appeared as TWO real bubbles above the failed one. Static analysis of the dedup Map + the actual JSONL forensics could not identify a mechanism that produces two emissions:
- `e59b2000-*.jsonl` shows ONE user-role emission for "testing 1 2 3" — a `type:"queue-operation" operation:"enqueue"` entry at 13:46:27.188 (Phase 50 Plan 01 Task 1 emits this as a `kind:"message"` `role:"user"` frame).
- The message was then REMOVED from the queue at 13:46:34.577 (no user-turn dequeue) — hilda folded it into her response to the resume-nudge.
- The session file did NOT change across the wake (same UUID e59b2000-... before + after) — so `transitionToActiveNew` didn't fire, `session_changed` frame wasn't emitted, `queueEnqueueDedup.clear()` didn't fire.

Given the mechanism can't be identified from static analysis, Wave 2 of Phase 62 adds diagnostic instrumentation instead of a speculative fix. Ashley 2026-08-30 verbatim on this scope pivot: *"Yeah, I mean two bubbles is the least of all the problems. So if we don't hit that this time, that's fine."* Actual dedup fix (if the next repro confirms the leak) becomes a separate Phase 63.

## Shape

Two waves, independent, land in a single ship:

### Wave 1 — Widen the client PrettyView pending-send timer for dormant sends

**Change:** In `src/ui/features/pretty-view/PrettyView.tsx` `handleOptimisticSend` callback (line 1082-1134), read `dormantRef.current` at arm-time and branch the timer duration:
- Non-dormant send: keep existing `20_000ms` timer (unchanged for the common path).
- Dormant send (`dormantRef.current === true` at arm time): use widened timer duration matching the backend's dormant-send window ceiling. Sizing rationale — the backend's full ceiling from user-send is `MARKER_FALLBACK_MS + GIVE_UP_MS_DORMANT` where the ACTUAL constants (verified in `pv-send-watchdog.ts:83-100`) are `MARKER_FALLBACK_MS_MIRROR = 90_000ms` and `GIVE_UP_MS_DORMANT = MARKER_FALLBACK_MS_MIRROR + GIVE_UP_MS + 10_000 = 120_000ms` (NOT the 100_000 I first estimated). Total backend ceiling from user-send = **210_000ms**. Client timer must fire NO EARLIER than the backend's give-up, otherwise the client races the backend and the same failure loop reappears. Value: `PENDING_SEND_TIMEOUT_MS_DORMANT = 220_000ms` (220s — 10s margin over backend's 210s ceiling). Named constant colocated with the existing 20000 literal.

**Rationale:** Symmetric to Phase 60's backend widening. The shape principle from Phase 60 line 158-159 was "Widen the optimistic-bubble reconciliation-watchdog window when the send happened during dormancy" — this closes the client-side half.

**"When dormant" gate — same as backend:** the read is at arm-time (handleOptimisticSend entry). If the client has received `{type:"dormant", dormant:true}` on the WS by then, `dormantRef.current` is true. If the dormant frame arrives AFTER the send (race case), the client's normal 20s timer applies — same race semantics as Phase 60's server-side entry-time read of `dormantLastEmitted`. Race handling is out of scope for this phase (it's a separate concern; not what Ashley reported).

**Files touched:**
- `src/ui/features/pretty-view/PrettyView.tsx` — handleOptimisticSend widening + named constant + a small log tweak so the flip-to-failed reason distinguishes `client_timeout_20s_normal` from `client_timeout_220s_dormant` (aids diagnosis).
- `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` — new locking test alongside existing Test 5 (which asserts the normal 20s fires): new Test 5b asserts that when `dormantRef.current === true` at handleOptimisticSend arm-time, the 20s timer does NOT fire but the 200s timer does.

### Wave 2 — Instrument the dedup + message-emission path

**Change:** Add diagnostic-level logging (INFO for production visibility, forwarded via existing console-forward) to the emission path around `__applyQueueDedupForTests` at `src/backend/claude-session/claude-session-server.ts:3916-3931`, so the next dormant-send repro produces log entries that identify which frame pair (if any) is bypassing dedup. Also add a per-tail-watcher instance ID (short random string, generated at tail-start-time) so any race across a tail-swap can be identified from the logs.

**What to log** (structured, one line per event):
- Every `__applyQueueDedupForTests` call: `[dedup] tail=<instance-id> sessionId=<sid> contentHash=<hash> rawType=<t> operation=<op> action=<populate|suppress|passthrough> mapSize=<n>`
- Every message-frame emission that passes the dedup gate: `[frame-emit] tail=<instance-id> eventId=<eid> role=<r> contentLen=<n> contentPreview=<first-50-chars-collapsed>`
- Tail-watcher lifecycle: `[tail-lifecycle] tail=<instance-id> action=<start|stop> sessionFile=<path> reason=<initial|transition|dormant-handoff>`

**What NOT to change:** the actual dedup logic, key derivation, TTL, or Map.clear() behavior. This wave is instrumentation only. If the logs from Ashley's next dormant-send repro confirm a leak mechanism, Phase 63 fixes it with the mechanism nailed down.

**Files touched:**
- `src/backend/claude-session/claude-session-server.ts` — instrumentation at the dedup call site + tail-lifecycle log points + per-tail-watcher instance-id assignment.
- No test file changes (logging is a diagnostic aid; the underlying behavior isn't changing so existing tests remain green).

## Reference files

- **Diagnosis conversation and log evidence** — captured in the parent bounty `pv-client-pending-send-timer-dormancy-blind/bounty.json` premise field (full log trace at second-precision).
- **Phase 60 shape** — `.planning/shapes/shape-invisible-dormancy.closed.md` — the singular-watchdog wording that led to the miss (L23-25, L50-54, L158-159).
- **Phase 60 SUMMARY files** — `.planning/phases/60-invisible-dormancy-wakes-.../60-01-SUMMARY.md`, `60-02-SUMMARY.md`, `60-03-SUMMARY.md` — for the backend send-path + backend watchdog widening + deletion patterns Wave 1 mirrors.
- **`src/ui/features/pretty-view/PrettyView.tsx:1082-1134`** — `handleOptimisticSend` (Wave 1 arm site).
- **`src/ui/features/pretty-view/PrettyView.tsx:1271`** — `dormantRef` declaration (Wave 1 reads this at arm time).
- **`src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx`** — Test 5 (existing 20s-timer coverage — new Test 5b sits alongside).
- **`src/backend/claude-session/pv-send-watchdog.ts:90-100`** — `GIVE_UP_MS_DORMANT` + `MARKER_FALLBACK_MS_MIRROR` — Wave 1's client-timeout sizing rides on top of these (client ceiling must exceed server ceiling).
- **`src/backend/claude-session/claude-session-server.ts:3269`** — `queueEnqueueDedup = new Map<>()` (Wave 2 instrumentation adds logging around every operation on this Map).
- **`src/backend/claude-session/claude-session-server.ts:3916-3931`** — `__applyQueueDedupForTests` call site (Wave 2 log point).

## Test strategy

- **Wave 1:** RED → GREEN via `PrettyView.optimistic-bubbles.test.tsx`. New Test 5b uses `vi.advanceTimersByTime` at 20000ms (should NOT fire when dormantRef=true) and at 220000ms cumulative (SHOULD fire). Piggy-backs on the existing test scaffolding.
- **Wave 2:** No new behavioral tests (logging is diagnostic aid). Existing dedup tests in `claude-session-server.compose-send.test.ts` and `optimistic-bubbles.integration.test.ts` must remain green — this is what enforces "instrumentation only, no behavior change."
- **Full-suite ship gate:** `npx vitest run` exit 0 before docker build (fleet rule 2026-08-20).

## Out of scope (deferred to Phase 63)

- **Dedup fix** — no code change to the dedup logic itself. Move to Phase 63 after the Wave 2 instrumentation captures the actual leak mechanism from Ashley's next dormant-send.
- **Race-case for dormant timer** — if the client sends with `dormantRef.current === false` but the server routes through the invisible-wake path anyway, Wave 1 doesn't widen the timer. That's a race case not what Ashley reported; handled separately if needed.
- **Backend watchdog non-arming for dormant sends** — the log shows the backend `pv_input_arm_split` fires for taylor's non-dormant send but NOT for hilda's first dormant send at 13:46:26. Suggests the backend watchdog may not be arming when `dormantSend: true` — potentially another Phase 60 gap. Investigate as follow-up bounty; NOT in Phase 62 scope. (Ashley: "not in a rush", the Wave 1 client-timer widening covers the observed UX issue regardless of whether the backend watchdog arms or not.)
- **Process improvement** (sharpen shape-writing or /close protocol so this class of miss can't repeat) — parked at low-priority as bounty `build-process-close-missed-symmetric-client-side-phase-60`.

## Locked decisions

- **D-62-01 (LOCKED — Ashley 2026-08-30):** Wave 2 is instrumentation only, no dedup logic change. Actual dedup fix moves to Phase 63.
- **D-62-02:** Client-side dormant timer ceiling MUST exceed backend `MARKER_FALLBACK_MS + GIVE_UP_MS_DORMANT`. Actual backend value = 90_000 + 120_000 = 210_000ms per `pv-send-watchdog.ts:83-100` (GIVE_UP_MS_DORMANT = MARKER_FALLBACK_MS_MIRROR + GIVE_UP_MS + 10_000, NOT 100_000). Client sized at 220_000ms (10s margin over 210s backend ceiling). Client racing backend = the very bug this phase fixes; do not size below.
- **D-62-03:** Dormant-vs-normal branch on the CLIENT is a read of `dormantRef.current` at arm-time (handleOptimisticSend entry). Symmetric to backend's `dormantLastEmitted` read at `__applyInputMessageForTests` entry. No retroactive re-arm on late-arriving dormant frames (out of scope, race case).
- **D-62-04:** Wave 2 log lines use existing `sshLogger.info` for backend + `console.info` for frontend (matches Phase 60 diagnostic instrumentation patterns already forwarded via console-forward). No new log-forwarding infrastructure.
- **D-62-05:** Both waves ship in one docker build/deploy per Ashley's "not shipping until then" directive. Full-suite green as ship gate.
