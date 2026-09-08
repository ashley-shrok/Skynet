---
phase: quick-260908-bqx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/pv-send-watchdog.ts
  - src/backend/claude-session/pv-send-watchdog.test.ts
  - src/backend/claude-session/claude-session-server.ts
  - src/backend/claude-session/claude-session-server.compose-send.test.ts
autonomous: true
requirements:
  - BQX-01

must_haves:
  truths:
    - "pv-send-watchdog.ts has no public API surface that mentions contentHash (ArmPvSendWatchdogArgs field removed; notifyMatched signature is notifyMatched(sessionId) only)."
    - "Both arm callsites in claude-session-server.ts (split-send at ~L2820 and non-split retry-Enter-only at ~L2879) no longer compute createHash('sha256').update(body).digest('hex').slice(0,32) and no longer pass a contentHash arg."
    - "__applyOnLineNotifyForTests in claude-session-server.ts calls notifyMatched EXACTLY ONCE per qualifying user-message frame with just (sessionIdFromFile) — no wrapper-hash computation, no slash-command reconstruction, no dual-notify."
    - "Arming two pv-send watchdogs on the same sessionId in sequence then calling notifyMatched(sessionId) once clears the OLDEST arm only; the second arm remains pending until a second notifyMatched(sessionId) clears it (FIFO head-pop semantics matching PrettyView.tsx:1967-1979)."
    - "All three-stage escalation timing constants (RETRY_ENTER_MS=2500, FULL_RESEND_MS=5500, GIVE_UP_MS=20_000, RETRY_ENTER_MS_DORMANT=92_500, FULL_RESEND_MS_DORMANT=95_500, GIVE_UP_MS_DORMANT=120_000, MARKER_FALLBACK_MS_MIRROR=90_000) are unchanged. dormantSend flag behavior unchanged. retryEnterOnly flag behavior unchanged."
    - "The full-resend body write at Stage 2 still uses the body string passed to armPvSendWatchdog (body is retained in ArmPvSendWatchdogArgs even though contentHash is not)."
    - "clearPvSendWatchdog(mqid) and clearPvSendWatchdogsForSession(sessionId) still work — arms can be cancelled by mqid or by sessionId."
    - "npm run build:backend exits 0 (no unused-import warnings for createHash at the arm-callsite scope; type errors resolved)."
    - "npx vitest run src/backend/claude-session/pv-send-watchdog.test.ts src/backend/claude-session/claude-session-server.compose-send.test.ts exits 0 (all tests updated/passing; new FIFO head-pop test present)."
  artifacts:
    - path: "src/backend/claude-session/pv-send-watchdog.ts"
      provides: "FIFO-queued pending watchdog store (per-session ordered list, not hash-keyed Map); notifyMatched(sessionId) pops head"
      contains: "notifyMatched"
    - path: "src/backend/claude-session/pv-send-watchdog.test.ts"
      provides: "Updated unit tests with contentHash removed from arm args and notifyMatched calls; new FIFO head-pop test proving arm-arm-notify clears oldest only"
      contains: "FIFO"
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "Arm callsites without contentHash computation; __applyOnLineNotifyForTests collapsed to a single notifyMatched(sessionId) call"
      contains: "notifyPvSendMatched"
    - path: "src/backend/claude-session/claude-session-server.compose-send.test.ts"
      provides: "Dual-hash slash-command describe block replaced with order-based single-notify assertions; any contentHash arg-shape assertions removed"
      contains: "__applyOnLineNotifyForTests"
  key_links:
    - from: "src/backend/claude-session/claude-session-server.ts:~L2824 (split-send arm) and ~L2879 (non-split retry-only arm)"
      to: "src/backend/claude-session/pv-send-watchdog.ts armPvSendWatchdog"
      via: "deps.armWatchdog({ sessionId, mqid, body, execCommand, tmuxTarget, wsSend, dormantSend, retryEnterOnly? }) — NO contentHash field"
      pattern: "deps\\.armWatchdog\\("
    - from: "src/backend/claude-session/claude-session-server.ts:~L4606 (onLine tail callback)"
      to: "src/backend/claude-session/pv-send-watchdog.ts notifyMatched"
      via: "__applyOnLineNotifyForTests({ frame, sessionIdFromFile, notifyMatched: notifyPvSendMatched }) — single call, no hash"
      pattern: "notifyMatched\\(sessionIdFromFile\\)"
---

<objective>
Align backend pv-send-watchdog with the frontend order-based match semantic
(PrettyView.tsx:1961-1979, quick-260823-fzy) to fix the PV double-submit bug:
when Claude Code transforms user input content (slash-command XML wrap, JSON
paste normalization, whitespace collapse), the backend's sha256(body) hash
drifts from sha256(observed-content) → notifyMatched never fires → the
T+5500ms full-resend stage retypes + submits the body a second time.

Replace the current hash-keyed pending Map in pv-send-watchdog.ts with a
per-session FIFO queue of pending arms. notifyMatched(sessionId) pops the
head of that session's queue. Same reasoning the frontend already codifies:
CC processes input serially, JSONL is written in order, WS preserves order —
SEND ORDER is the match signal.

Purpose: eliminate PV double-submit for every content-transforming input
shape (slash commands, JSON pastes, and any future CC input wrap) without
changing any of the three-stage escalation timing, the dormant-widened
cadence, or the retryEnterOnly non-split safety net. Only the MATCHING
primitive changes — everything downstream of "we got the signal, cancel
timers" is byte-identical.

Output:
  - pv-send-watchdog.ts: internal pending store swapped from
    Map<mqid, entry> (looked up by (sessionId, contentHash) tuple) to a
    per-session ordered list; contentHash field dropped from ArmPvSendWatchdogArgs
    + PendingWatchdog; notifyMatched signature narrowed to (sessionId).
  - pv-send-watchdog.test.ts: contentHash removed from every arm-args
    literal + every notifyMatched call; T-9 "wrong hash does NOT clear"
    replaced with a FIFO head-pop test proving arm-arm-notify clears oldest
    only; T-10 per-mqid isolation reworked as per-session isolation.
  - claude-session-server.ts: the two `const contentHash = createHash(...)`
    lines and their arg-object fields dropped at ~L2820 + ~L2874;
    __applyOnLineNotifyForTests (L511-564) collapsed to guard + single
    notifyMatched(sessionIdFromFile) call — no wrapper-hash, no
    reconstructRawSlashCommand call, no dual-notify.
  - claude-session-server.compose-send.test.ts: the dual-hash slash-command
    describe block (L967-1102) replaced with tests asserting single notify
    per qualifying frame regardless of content shape (slash, plain, multi-
    line, malformed all → notifyMatched called exactly once with sessionId
    only).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@src/backend/claude-session/pv-send-watchdog.ts
@src/backend/claude-session/pv-send-watchdog.test.ts
@src/backend/claude-session/claude-session-server.compose-send.test.ts
@src/ui/features/pretty-view/PrettyView.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Rewrite pv-send-watchdog.ts internals as per-session FIFO queue; update its unit tests</name>
  <files>src/backend/claude-session/pv-send-watchdog.ts, src/backend/claude-session/pv-send-watchdog.test.ts</files>
  <behavior>
    - Arming two watchdogs on sess-A in sequence (mqid=m1 then mqid=m2), then calling notifyMatched("sess-A") once: m1 timers are cancelled and m1 is removed from pending; m2 remains armed. A second notifyMatched("sess-A") clears m2.
    - notifyMatched on a sessionId with an empty queue is a silent no-op.
    - notifyMatched on sess-A does NOT touch pending arms on sess-B.
    - clearPvSendWatchdog(mqid) still cancels + removes exactly that arm regardless of position in its session's FIFO queue.
    - clearPvSendWatchdogsForSession(sessionId) still returns the array of cleared mqids and empties that session's queue while leaving other sessions intact.
    - Second armPvSendWatchdog with a duplicate mqid while one is pending is still a no-op (cascading-loop guard preserved — dedup by mqid, NOT by content).
    - Dormant timing constants + retryEnterOnly branch behavior are byte-for-byte unchanged (existing Phase 56 WW-1..WW-5 tests still pass without modification to their timing assertions).
    - __resetPvSendWatchdogForTests still clears ALL pending state (across all sessions).
  </behavior>
  <action>
    ## A. pv-send-watchdog.ts changes

    1. **Drop contentHash from ArmPvSendWatchdogArgs.** Remove the `contentHash: string;` field (currently L121). All other fields (sessionId, mqid, body, execCommand, tmuxTarget, wsSend, logger?, retryEnterOnly?, dormantSend?) preserved verbatim.

    2. **Drop contentHash from PendingWatchdog.** Remove the `contentHash: string;` field (currently L174). All other fields preserved.

    3. **Update the module-level pending store shape.** Replace the current `const pending = new Map<string, PendingWatchdog>();` (L191, keyed by mqid) with TWO structures that together model per-session FIFO with mqid-addressable cancel:
       - Keep a `Map<mqid, PendingWatchdog>` for O(1) cancel-by-mqid (armPvSendWatchdog dup-guard, clearPvSendWatchdog, and the internal `pending.has(mqid)` timer-guard reads).
       - Add a `Map<sessionId, mqid[]>` (per-session ordered list of live mqids) for FIFO head-pop in notifyMatched. Push mqid onto the end at arm time; shift the head off in notifyMatched. Delete-by-mqid is O(n) over that session's list (fine — queue depth is bounded by concurrent in-flight sends per pane, single-digit in practice).
       - Encapsulate both maps as module-level `const pendingByMqid` and `const fifoBySession`. Do not export either.

    4. **Update armPvSendWatchdog.** After creating the `entry` and passing the `pending.has(mqid)` dup-guard, insert into BOTH maps: `pendingByMqid.set(mqid, entry)` AND `const list = fifoBySession.get(sessionId) ?? []; list.push(mqid); fifoBySession.set(sessionId, list);`. Drop the destructured `contentHash` from the args pull (L226). Drop `contentHash,` from the entry-object literal (L255). Drop `contentHash` from both `logger.debug("pv-send-watchdog: armed", ...)` metadata sites (L311 and L434) and both `logger.info("[diag-dormant-send] watchdog-arm-complete", ...)` sites (L315 and L439) — replace `contentHash: contentHash.slice(0, 8)` with a static field like `matched_by: "fifo"` so log-shape diffs stay small; drop the bare `contentHash` field entirely.

    5. **Rewrite notifyMatched.** Change signature from `notifyMatched(sessionId: string, contentHash: string): void` to `notifyMatched(sessionId: string): void`. New body: look up `fifoBySession.get(sessionId)`; if the list is undefined or empty, return. Shift the head mqid off the list; if the list is now empty, `fifoBySession.delete(sessionId)`. Look up `pendingByMqid.get(headMqid)`; if absent (defensive — should not happen), return. Log a matched-signal debug + info line (mirror the current message text but replace `matched_by: "contentHash"` with `matched_by: "fifo_head"`). Call `cancelTimers(entry); pendingByMqid.delete(headMqid);`. Return.

    6. **Update clearPvSendWatchdog(mqid).** Same overall shape, but after `pendingByMqid.delete(mqid)`, ALSO remove the mqid from its session's FIFO list: `const list = fifoBySession.get(entry.sessionId); if (list) { const idx = list.indexOf(mqid); if (idx !== -1) list.splice(idx, 1); if (list.length === 0) fifoBySession.delete(entry.sessionId); }`. Preserves the "cancel by mqid works from any queue position" invariant.

    7. **Update clearPvSendWatchdogsForSession(sessionId).** After building `clearedMqids` and deleting from pendingByMqid, also `fifoBySession.delete(sessionId)`.

    8. **Update __resetPvSendWatchdogForTests.** After `pendingByMqid.clear()`, also `fifoBySession.clear()`.

    9. **Update the giveUp timer body.** At the top of the Stage 3 setTimeout callback, the current code does `pending.delete(mqid)` after `cancelTimers(entry)`. Replace with the same two-map cleanup used by clearPvSendWatchdog(mqid) (inline; do not extract a helper — keep the seam minimal). This ensures a timed-out arm doesn't leak into the FIFO list.

    10. **Update file header contract block (L39-49, L215-219, L442-450).** Delete the "Hash-derivation contract (load-bearing)" paragraph and its two-file cross-reference. Delete the `contentHash` paragraph inside the armPvSendWatchdog docstring. Rewrite the notifyMatched docstring: "Clears the OLDEST pending watchdog on the given sessionId — FIFO head-pop. Matches the frontend order-based semantic at PrettyView.tsx:1961-1979 (quick-260823-fzy). Same reasoning: CC processes input serially, JSONL is written in order, WS preserves order — SEND ORDER is the match signal."

    ## B. pv-send-watchdog.test.ts changes

    1. **Remove the createHash import and contentHashOf helper (L34, L76-78).** They will have no callers left.

    2. **Strip contentHash from every arm literal.** Every `armPvSendWatchdog({ ... contentHash: contentHashOf(body), ... })` becomes the same object minus the contentHash line. That covers T-1, T-2, T-3, T-4, T-5, T-6, T-7, T-8, T-9, T-10, T-11, T-12, T-13, T-14, T-15, T-16, WW-1, WW-2, WW-3, WW-4.

    3. **Strip contentHash from every notifyMatched call.** `notifyMatched(SESSION_ID, contentHashOf("hello"))` becomes `notifyMatched(SESSION_ID)`. That covers T-1, T-3, and T-9.

    4. **Rewrite T-9.** The old test asserted "notifyMatched with wrong hash does NOT clear → retry still fires". Hash no longer exists. Repurpose the test as: "notifyMatched on a sessionId with no pending arms is a silent no-op — the pending arm on a DIFFERENT session still fires its retry Enter at T+2500ms". Arm one watchdog on sess-A, call notifyMatched("sess-B") at T+100ms, then advance to T+2500ms and assert exec was called exactly once with `tmux send-keys -t 'ashley-tmux' Enter`.

    5. **Rewrite T-10.** The old test asserted per-mqid isolation via hash match. Rewrite as per-session isolation: two watchdogs armed at t=0 on sess-A (m1) and sess-B (m2). At t=100ms call notifyMatched("sess-A") — m1 cleared, m2 still armed. Advance to t=2600ms — only m2's retry Enter has fired (exec called 1 time). Advance to t=5600ms — m2's full-resend fires (3 more execs, total 4). notifyMatched("sess-A") at t=100 must NOT have touched m2's queue.

    6. **Add T-17: FIFO head-pop within a single session.** Arm m1 on sess-A at t=0. Arm m2 on sess-A at t=50ms. Call notifyMatched("sess-A") at t=100ms — assert m1 is cleared (its retry does NOT fire at t=2500ms) but m2's retry DOES fire at t=2550ms (armed at t=50, +2500). Call notifyMatched("sess-A") again at t=2600ms — assert m2's full-resend does NOT fire at t=5550ms (m2's Stage 2 was cancelled). Total exec calls at t=6000ms should be exactly 1 (only m2's retry Enter).

    7. **Add T-18: notifyMatched on empty session queue is a silent no-op.** Call notifyMatched("sess-DOESNT-EXIST") on a fresh module — assert no throw, no exec, no wsSend, subsequent arm on that session works normally.

    8. **Update T-6 comment.** The retry-fired-once invariant is unchanged — dup-guard still works by mqid. Just delete the contentHash line.

    9. **WW-5 constant-drift guard is unaffected.** The file-read regex still matches MARKER_FALLBACK_MS in claude-session-server.ts. Keep as-is.

    Do NOT change any timing constants, any dormantSend behavior, or any retryEnterOnly behavior. Do NOT touch the WW-1..WW-4 tests beyond stripping contentHash from their arm literals.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tina && npx vitest run src/backend/claude-session/pv-send-watchdog.test.ts</automated>
  </verify>
  <done>Every test in pv-send-watchdog.test.ts passes with the new FIFO semantics. New T-17 (FIFO head-pop) and T-18 (empty-session no-op) tests present. No test file references `contentHash`, `contentHashOf`, or `createHash` for pv-send-watchdog behavior. The pv-send-watchdog.ts module exports (armPvSendWatchdog, notifyMatched, clearPvSendWatchdog, clearPvSendWatchdogsForSession, __resetPvSendWatchdogForTests, and all timing constants) still surface; notifyMatched arity is now 1.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Update claude-session-server.ts arm callsites + collapse __applyOnLineNotifyForTests to single-notify; update compose-send tests</name>
  <files>src/backend/claude-session/claude-session-server.ts, src/backend/claude-session/claude-session-server.compose-send.test.ts</files>
  <behavior>
    - Split-send arm at ~L2820 no longer computes contentHash and passes an arg object without a contentHash field. Split-send arms still trackMqid and log the diag line (with contentHash= replaced by matched_by=fifo).
    - Non-split retry-Enter-only arm at ~L2874 no longer computes contentHash and passes an arg object without a contentHash field. The retryEnterOnly=true and dormantSend flags still flow through.
    - __applyOnLineNotifyForTests: when called with a valid user-role message frame + non-null sessionIdFromFile, invokes deps.notifyMatched EXACTLY ONCE with just deps.sessionIdFromFile. Never calls it with a second argument. Never invokes reconstructRawSlashCommand. Never logs the pv_send_watchdog_dual_hash_notify INFO line.
    - Guard behavior preserved: frame with type !== "message", role !== "user", non-string content, empty-string content, or null sessionIdFromFile returns without any notify call.
    - onLine tail callback at ~L4606 still passes { frame, sessionIdFromFile, notifyMatched: notifyPvSendMatched } — the injection shape doesn't change, but the callback's internal contract does (notifyMatched now takes 1 arg).
  </behavior>
  <action>
    ## A. claude-session-server.ts changes

    1. **Split-send arm at ~L2812-2852.** Delete the four lines that compute `contentHash` (L2820-2823: `const contentHash = createHash("sha256").update(body).digest("hex").slice(0, 32);`). Delete the `contentHash,` field from the `deps.armWatchdog({ ... })` object literal (L2828). At L2852, the diag log currently ends with `contentHash=${contentHash.slice(0, 8)}` — replace with `matched_by=fifo` (no template-var reference) to keep the log-line shape stable and one grep-token away from prior lines.

    2. **Non-split retry-Enter-only arm at ~L2865-2909.** Delete the four lines that compute `contentHash` (L2874-2877: `const contentHash = createHash("sha256").update(nonSplitBody).digest("hex").slice(0, 32);`). Delete the `contentHash,` field from the `deps.armWatchdog({ ... })` object literal (L2883). The trailing warn `[diag-dormant-send] backend watchdog-arm-retryonly ...` at L2909 does NOT reference contentHash — leave as-is.

    3. **Collapse __applyOnLineNotifyForTests (L511-564).** New body after the existing guard (L523-532, keep verbatim):
       ```
       notifyMatched(sessionIdFromFile);
       ```
       Delete lines 534-563 in their entirety (the wrapper-hash computation, the reconstructRawSlashCommand call, the rawHash computation, the name/argsLen extraction, the INFO log, and the second notifyMatched call). The `content` local (L534) becomes dead — remove it too. The function body shrinks to guard + one call.

    4. **Update __applyOnLineNotifyForTests deps type (L511-518).** Narrow the `notifyMatched` field type from `(sessionId: string, contentHash: string) => void` to `(sessionId: string) => void`. The `logger?` field is still on the interface but the seam no longer routes any log through it — you may either delete the logger field entirely or leave it accepted-but-unused. Delete it (dead surface after collapse) unless it forces a downstream test-file compile error not addressed in Task 2B below.

    5. **Update the docstring for __applyOnLineNotifyForTests (L493-510).** Rewrite the "The seam owns:" list to a single item: "1. The guard (frame is message/user + non-empty string content + non-empty sessionIdFromFile). 2. The single order-based notifyMatched(sessionId) call — clears the OLDEST pending pv-send arm on that session (FIFO head-pop, matching frontend order-based semantic at PrettyView.tsx:1961-1979)." Delete the "Dual-hash notify for slash-command wrappers" paragraph. Update `notifyMatched` bullet to "bound to `notifyPvSendMatched` in production; tests inject a spy to assert the exact call count and sessionId argument."

    6. **Update the onLine tail-callback comment at ~L4585-4612.** Delete the "quick-260821-shn — dual-hash notify for slash-command wrappers" paragraph (roughly L4597-4605). Replace with one short paragraph pointing at PrettyView.tsx:1961-1979 and quick-260908-bqx as the canonical order-based match reference. The `__applyOnLineNotifyForTests({ ... })` call itself (L4606-4610) is unchanged in shape — the inner arg types are handled by Task 2A step 4.

    7. **Leave reconstructRawSlashCommand (L451-491) alone.** It's exported and no longer called from __applyOnLineNotifyForTests, but the test file still imports it (Task 2B decides its fate). Leaving the function in place minimizes blast radius — this task is scope-limited to the pv-send-watchdog match primitive. If build fails on unused-export lint, remove the export in a follow-up.

    8. **Do NOT touch anything else.** Do NOT touch the queue-dedup contentHash computation at ~L3080 (separate mechanism per constraints). Do NOT touch the sha1 hash at L224. Do NOT touch the D-11-related comment at L3803. Do NOT touch the dedup log at L4542 that mentions `contentHash=<no-hash>` (separate log surface).

    ## B. claude-session-server.compose-send.test.ts changes

    1. **Strip contentHash from split-send + non-split arm-call literals.** Any test that invokes __applyInputMessageForTests and injects an `armWatchdog` mock currently receives arg objects containing `contentHash`. If any test asserts on the arg-object shape (e.g. `expect(armWatchdog).toHaveBeenCalledWith(expect.objectContaining({ contentHash: expect.any(String) }))`), remove that assertion / drop that key from the expected shape. Search the file for `contentHash` and update every occurrence.

    2. **Replace the "dual-hash notify" describe block (L960-1102).** Delete Tests 1-6 in that block. Replace with a new describe block titled `"__applyOnLineNotifyForTests — single-notify order-based (quick-260908-bqx)"` containing:
       - **Test 1 (slash-command wrapper, WITH args):** Frame with content = the `<command-message>id</command-message><command-name>/id</command-name><command-args>tabitha</command-args>` string. Expect `spy` called EXACTLY ONCE with just `("sess-A")`. No hash arg. No second call.
       - **Test 2 (plain user turn):** Frame with content = `"hello"`. Expect spy called EXACTLY ONCE with `("sess-A")`.
       - **Test 3 (multi-line user turn):** Frame with content = `"line one\nline two"`. Expect spy called EXACTLY ONCE with `("sess-A")`.
       - **Test 4 (guard — wrong type):** Frame with `type: "assistant"`. Expect spy NOT called.
       - **Test 5 (guard — empty content):** Frame with `type: "message", role: "user", content: ""`. Expect spy NOT called.
       - **Test 6 (guard — null sessionIdFromFile):** Valid frame but `sessionIdFromFile: null`. Expect spy NOT called.
       Use plain `vi.fn()` for the spy. Do NOT import `reconstructRawSlashCommand` in the new block. If the module-level `import` for `reconstructRawSlashCommand` at L70 has no other callers after the rewrite, remove that import.

    3. **Update the `import { createHash } from "node:crypto"` at L32.** If no test in the file still uses `createHash`, remove the import to prevent unused-import lint failures. (The current uses are: L32 top-level, and L972 `hash32` helper inside the dual-hash describe block — the helper goes away when we rewrite Tests 1-6.) Search for `createHash` in the file after the rewrite; if zero references remain, delete the import.

    4. **Preserve every other test in the file verbatim.** All INPUT tests (describe block 1), all INTERRUPT tests (describe block 2), Test 2b Fix #1 (bare-Enter split-send), Test 2c (2026-08-21 non-split retry-Enter-only), and every other test outside the dual-hash block are unchanged in intent. They may need contentHash removed from arg-object assertions per step 1.

    ## C. Verify the full backend build after both A and B

    Run `npm run build:backend` — no `createHash is declared but its value is never read` warnings, no type errors from the narrowed notifyMatched signature, no references to a removed reconstructRawSlashCommand import in the test file if you took that route.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tina && npm run build:backend && npx vitest run src/backend/claude-session/pv-send-watchdog.test.ts src/backend/claude-session/claude-session-server.compose-send.test.ts src/backend/claude-session/claude-session-server.queue-dedup.test.ts</automated>
  </verify>
  <done>build:backend exits 0. All three test files pass. The compose-send test file's new order-based describe block covers slash-command, plain, multi-line, and all three guard paths with EXACTLY ONE spy call each (or zero for guards). No `contentHash` string appears in any assertion in compose-send.test.ts or pv-send-watchdog.test.ts. queue-dedup.test.ts is untouched and still green (it uses contentHash for a separate legitimate mechanism per constraints).</done>
</task>

</tasks>

<verification>
Grep gates on the finished tree (all must be true):

  # No contentHash in the watchdog module public API or internals
  grep -v '^\s*//\|^\s*\*' src/backend/claude-session/pv-send-watchdog.ts | grep -c 'contentHash'
    → must be 0

  # No contentHash computation at either arm callsite in the server
  grep -c 'createHash("sha256").update(body)' src/backend/claude-session/claude-session-server.ts
    → must be 0
  grep -c 'createHash("sha256").update(nonSplitBody)' src/backend/claude-session/claude-session-server.ts
    → must be 0

  # notifyMatched is called with ONE argument only in __applyOnLineNotifyForTests
  grep -c 'notifyMatched(sessionIdFromFile,' src/backend/claude-session/claude-session-server.ts
    → must be 0
  grep -c 'notifyMatched(sessionIdFromFile)' src/backend/claude-session/claude-session-server.ts
    → must be >= 1

  # Test files do not reference contentHash for the pv-send-watchdog
  grep -c 'contentHash' src/backend/claude-session/pv-send-watchdog.test.ts
    → must be 0

  # queue-dedup test still legitimately mentions contentHash (untouched)
  grep -c 'contentHash' src/backend/claude-session/claude-session-server.queue-dedup.test.ts
    → must be >= 1

Behavioral gates:
  - npx vitest run src/backend/claude-session/pv-send-watchdog.test.ts → exits 0, includes new T-17 FIFO head-pop + T-18 empty-session no-op tests
  - npx vitest run src/backend/claude-session/claude-session-server.compose-send.test.ts → exits 0, new single-notify describe block passes
  - npx vitest run src/backend/claude-session/claude-session-server.queue-dedup.test.ts → exits 0 (regression proof queue-dedup untouched)
  - npm run build:backend → exits 0 (no unused-import warnings, no type errors)
  - npm run build → exits 0 (frontend build unaffected — this change is backend-only)
</verification>

<success_criteria>
- pv-send-watchdog.ts pending state is a per-session FIFO (two-map implementation: pendingByMqid + fifoBySession); notifyMatched(sessionId) pops the head of the target session's FIFO and cancels its timers.
- Neither armPvSendWatchdog callsite in claude-session-server.ts computes contentHash; neither passes a contentHash field.
- __applyOnLineNotifyForTests calls notifyMatched exactly once with just sessionIdFromFile — no wrapper-hash, no raw-body reconstruction, no dual-notify.
- The new T-17 test proves FIFO head-clear: arm two, notify once → oldest cleared, second still pending; notify again → second cleared.
- All three-stage escalation timing constants and all dormant/retryEnterOnly branch behavior are preserved byte-for-byte.
- backend build clean; both pv-send-watchdog.test.ts and claude-session-server.compose-send.test.ts green; claude-session-server.queue-dedup.test.ts still green (proves the neighboring dedup mechanism was NOT collateral damage).
</success_criteria>

<output>
Create `.planning/quick/260908-bqx-align-backend-pv-send-watchdog-to-client/260908-bqx-SUMMARY.md` when done, capturing:
  - Before/after line counts for pv-send-watchdog.ts and __applyOnLineNotifyForTests
  - The final grep-gate output values
  - Test counts for the two updated test files
  - Any callsites discovered during implementation that the plan missed
  - Confirmation that queue-dedup.test.ts was not touched
</output>
