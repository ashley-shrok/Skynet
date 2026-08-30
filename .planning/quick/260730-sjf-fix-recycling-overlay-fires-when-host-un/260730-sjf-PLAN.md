---
phase: quick-260730-sjf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/ssh/tmux-helper.ts
  - src/backend/claude-session/session-file-discovery.ts
  - src/backend/claude-session/claude-session-server.ts
  - src/ui/api/claude-session-api.ts
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/backend/claude-session/session-file-discovery.test.ts
  - src/backend/claude-session/claude-session-server.repoll.test.ts
  - src/ui/features/pretty-view/PrettyView.test.tsx
autonomous: true
requirements:
  - QUICK-260730-SJF-A  # Narrow the Layer-2 discovery repoll arm (exec_error vs real-inactive)
  - QUICK-260730-SJF-B  # Self-clear session-holding overlay on same-file recovery

must_haves:
  truths:
    - "A transient SSH round-trip failure at queryPanePid does NOT arm the session-holding overlay"
    - "A real inactive reason (not_claude, no_pid_session_file, no_open_session_file, no_tmux_session) still arms holding as before"
    - "If holding is armed and the very next tick reports active with the SAME sessionFile, holding self-clears in under 3s (one repoll interval) instead of waiting up to 5 min"
    - "Message stream, contextPct, harnessTasks, backgroundedAgents, plan_pending, asideText all survive verbatim across a false-alarm self-clear (contrast with session_changed which heavy-resets)"
    - "Real SIGTERM-fallback recycles (different sessionFile) still fire session_changed as before — self-clear only triggers on same-file"
    - "npm run build:backend, npm run build, and full npm test all pass green"
  artifacts:
    - path: "src/backend/ssh/tmux-helper.ts"
      provides: "queryPanePid that rethrows on SSH failure and returns null only on unparseable output"
      contains: "queryPanePid"
    - path: "src/backend/claude-session/session-file-discovery.ts"
      provides: "discoverClaudeSession with exec_error branch for queryPanePid throws"
      contains: "exec_error"
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "reason-switched repoll branch + transitionFromHoldingToActiveSameFile helper + session_holding_cleared emitter"
      contains: "transitionFromHoldingToActiveSameFile"
    - path: "src/ui/api/claude-session-api.ts"
      provides: "SessionHoldingClearedEvent variant on ClaudeSessionServerEvent union"
      contains: "session_holding_cleared"
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "ws.onmessage handler for session_holding_cleared (surgical setIsHolding(false) + setHoldingTimeoutError(false))"
      contains: 'case "session_holding_cleared"'
    - path: "src/backend/claude-session/claude-session-server.repoll.test.ts"
      provides: "Discovery-repoll branch coverage for the four reason-switch cases + self-clear"
      min_lines: 80
  key_links:
    - from: "src/backend/ssh/tmux-helper.ts::queryPanePid"
      to: "src/backend/claude-session/session-file-discovery.ts::discoverClaudeSession"
      via: "throw → try/catch → { status:'inactive', reason:'exec_error' }"
      pattern: "exec_error"
    - from: "src/backend/claude-session/session-file-discovery.ts"
      to: "src/backend/claude-session/claude-session-server.ts (repoll branch)"
      via: "result.reason switch — exec_error is silent, others still call transitionToHolding"
      pattern: "result\\.reason"
    - from: "src/backend/claude-session/claude-session-server.ts::transitionFromHoldingToActiveSameFile"
      to: "src/ui/features/pretty-view/PrettyView.tsx::onmessage"
      via: "WS frame { type: 'session_holding_cleared' } → setIsHolding(false)"
      pattern: "session_holding_cleared"
---

<objective>
Fix the recycling-overlay-fires-when-host-unreachable bug by making TWO
categorically-linked changes ship together:

FIX A — Narrow the Layer-2 discovery repoll arm in claude-session-server.ts
so a transient SSH failure at the queryPanePid boundary no longer flips
changeoverState to "holding". Split queryPanePid's single catch into a
rethrow path (SSH-side failure) vs a null return (unparseable output),
add an exec_error try/catch wrapper in session-file-discovery, and switch
on result.reason at the repoll's inactive branch so only real-inactive
reasons arm holding. Also skip holdingTicks++ on exec_error ticks so the
5-min holding budget isn't burned by no-signal ticks.

FIX B — Self-clear the overlay on same-file recovery. Add a new
session_holding_cleared WS event + transitionFromHoldingToActiveSameFile
helper called from the repoll's active-branch when the sessionFile matches
currentSessionFile and changeoverState === "holding". Frontend handler
surgically clears isHolding + holdingTimeoutError without touching the
message stream — this is a false-alarm recovery, NOT a real recycle.

Purpose: Narrowing the arm alone still leaves any already-stuck holding
overlay hanging for up to 5 minutes on the timeout. Shipping both together
means Ashley never sees the phantom overlay in the first place, AND any
that slip through (e.g. from a legitimate transient race) self-clear on
the next successful repoll tick.

Output: Two atomic commits on feat/tab-title-from-tmux; frontend build +
backend build + full vitest suite all green.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

@src/backend/ssh/tmux-helper.ts
@src/backend/claude-session/session-file-discovery.ts
@src/backend/claude-session/claude-session-server.ts
@src/ui/api/claude-session-api.ts
@src/ui/features/pretty-view/PrettyView.tsx
@src/backend/claude-session/session-file-discovery.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fix A — narrow the Layer-2 discovery repoll arm (rethrow contract + reason-switched inactive branch + skip holdingTicks++ on exec_error)</name>
  <files>
    src/backend/ssh/tmux-helper.ts,
    src/backend/claude-session/session-file-discovery.ts,
    src/backend/claude-session/claude-session-server.ts,
    src/backend/claude-session/session-file-discovery.test.ts
  </files>
  <behavior>
    - queryPanePid rethrows when execCommand throws (SSH-side failure); returns null only when execCommand returned but parseInt yielded NaN/≤0 (unparseable pane_pid). JSDoc updated to state this two-case contract.
    - queryNewestTmuxSession catch is left untouched (its callers depend on null-on-error posture).
    - discoverClaudeSession wraps queryPanePid in try/catch: on throw returns `{ status: "inactive", reason: "exec_error" }`; on null keeps returning `{ status: "inactive", reason: "no_tmux_session" }`.
    - The ClaudeSessionDiscoveryResult JSDoc header block (near lines 6-17 of session-file-discovery.ts) is updated to describe exec_error as the categorical "we couldn't reliably ask" signal covering all four SSH-throw sites (queryPanePid, descendant walk, PID-file read, JSONL test).
    - In claude-session-server.ts's discoveryRepollTimer .then() callback (near lines 3011-3022, in the `else` branch after `result.status === "active"`), switch on result.reason instead of blindly calling transitionToHolding("discovery_diff"):
        * `exec_error` → silent tick: do NOT transitionToHolding, do NOT flip changeoverState. Return early from this branch so the holdingTicks++ block below is ALSO short-circuited for this tick.
        * All other reasons (not_claude, no_pid_session_file, no_open_session_file, no_tmux_session, pid_unavailable) → keep existing `if (changeoverState === "active") transitionToHolding("discovery_diff")` behavior.
        * Include a code comment above the switch citing the categorical rationale (exec_error = "couldn't ask" vs others = "asked and got no") so a future maintainer doesn't re-collapse.
    - holdingTicks++ block (near lines 3033-3038) is guarded so it does NOT increment when the current tick's discovery was exec_error. Implementation shape per spec: hoist `const isExecErrorTick = result.status === "inactive" && result.reason === "exec_error"` at the top of the .then callback body; guard `if (changeoverState === "holding" && !isExecErrorTick) { holdingTicks++; ... }`. Or use the earlier-return path from the branch above — either shape is fine as long as ALL exec_error ticks skip both the arm AND the increment.
    - Test 1 (session-file-discovery.test.ts, new): mock queryPanePid to throw → assert discoverClaudeSession returns `{ status: "inactive", reason: "exec_error" }`. Mirror the existing fakeConn helper shape in the file.
    - Test 2 (session-file-discovery.test.ts, new): queryPanePid returns null via unparseable pane_pid (execCommand returns empty string or garbage) → assert result is `{ status: "inactive", reason: "no_tmux_session" }`. Preserves existing behavior contract.
  </behavior>
  <action>
    Implement four coordinated edits then add two tests.

    Edit 1 — src/backend/ssh/tmux-helper.ts (queryPanePid ~line 207-222): split the try/catch. Keep the try block for execCommand+parseInt. On execCommand throw, RETHROW (do not swallow). On parseInt NaN/≤0 return null. Update JSDoc (~lines 199-206) to state: "Returns null on unparseable/empty pane_pid output. Throws on SSH-side failure (execCommand error) so the discovery layer can classify as exec_error rather than misreading transient SSH failure as no_tmux_session." Leave queryNewestTmuxSession's catch block byte-identical.

    Edit 2 — src/backend/claude-session/session-file-discovery.ts: wrap the queryPanePid call in try/catch. On catch return `{ status: "inactive", reason: "exec_error" }`. On genuine null (existing behavior) keep returning `{ status: "inactive", reason: "no_tmux_session" }`. Update the ClaudeSessionDiscoveryResult JSDoc header block (~lines 6-17) to note exec_error is the categorical "we couldn't reliably ask" signal funneling all four SSH-throw sites — a maintainer reading the union must understand this signal is diagnostic-null, not a real-inactive reason.

    Edit 3 — src/backend/claude-session/claude-session-server.ts (discoveryRepollTimer body, ~lines 2989-3048): at the top of the .then callback, right after the stopped/dead guards, hoist `const isExecErrorTick = result.status === "inactive" && result.reason === "exec_error";`. Rewrite the inactive branch (currently ~lines 3011-3022) to switch on result.reason: if reason is exec_error, do NOT call transitionToHolding, do NOT flip changeoverState, and DO NOT fall through to holdingTicks++ below (return early from the branch body OR guard the holdingTicks++ block with !isExecErrorTick). For all other reasons keep the existing `if (changeoverState === "active") transitionToHolding("discovery_diff")` call. Add a code comment above the switch explaining the categorical rationale. Add a matching guard `!isExecErrorTick` on the holdingTicks++ block (~lines 3033-3038) — the block-level guard is the cleanest shape and covers both paths (active-branch same-file fall-through AND inactive-branch fall-through).

    Edit 4 — src/backend/claude-session/session-file-discovery.test.ts: add two new tests using the file's existing fakeConn/mockExecCommand shape. Test names in the spirit of the existing suite ("returns exec_error when queryPanePid throws" and "returns no_tmux_session when pane_pid is unparseable"). Use vi.spyOn or mocking that mirrors the file's existing patterns — check the top of the file for the mock setup shape and reuse it verbatim.

    Do not touch queryNewestTmuxSession, do not touch the "different file" branch at line 2994, do not touch transitionToHolding itself, do not touch transitionToActiveNew. Scope is surgical: 4 files, ~40 net lines including tests.

    Suggested atomic commit message: `Distinguish "couldn't ask" from "asked and got no" in Layer-2 discovery repoll — transient SSH failures no longer arm the session-holding overlay`

    Ship this commit BEFORE starting Task 2 so a bisect can distinguish the two fix motions.
  </action>
  <verify>
    <automated>npx tsc --noEmit &amp;&amp; npx vitest run src/backend/claude-session/session-file-discovery.test.ts</automated>
  </verify>
  <done>
    tsc EXIT 0. Vitest for session-file-discovery.test.ts passes with the two new tests included (green count grew by exactly 2). queryPanePid JSDoc mentions the rethrow contract. Grep confirms `exec_error` appears in both session-file-discovery.ts (as a reason emitter) and claude-session-server.ts (as an isExecErrorTick guard).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Fix B — session_holding_cleared WS event + transitionFromHoldingToActiveSameFile helper + PrettyView handler + repoll branch tests</name>
  <files>
    src/ui/api/claude-session-api.ts,
    src/backend/claude-session/claude-session-server.ts,
    src/ui/features/pretty-view/PrettyView.tsx,
    src/backend/claude-session/claude-session-server.repoll.test.ts,
    src/ui/features/pretty-view/PrettyView.test.tsx
  </files>
  <behavior>
    - New wire type `SessionHoldingClearedEvent = { type: "session_holding_cleared" }` added to the ClaudeSessionServerEvent discriminated union in src/ui/api/claude-session-api.ts (verified location — grep for `SessionHoldingEvent` at line 113 confirms this is the file).
    - New helper transitionFromHoldingToActiveSameFile() in claude-session-server.ts modeled on transitionToHolding (~lines 1425-1447): idempotency guard `if (changeoverState !== "holding") return;`, sets changeoverState = "active", resets holdingTicks = 0, emits `{ type: "session_holding_cleared" }` on the WS with the same try/catch shape as transitionToHolding, logs with operation name `claude_session_holding_cleared` (info level, same fields shape as the holding log).
    - Call site: in the active-branch same-file fall-through (the else path around lines 3003-3010 where the comment says "same file, still active — no state change here"), add a new condition: if `changeoverState === "holding" && result.sessionFile === currentSessionFile`, call transitionFromHoldingToActiveSameFile(). The "different file" branch at line 2994 still fires first for real SIGTERM-fallback recycles — those are unaffected.
    - PrettyView.tsx ws.onmessage switch (~line 574): new `case "session_holding_cleared":` that calls setIsHolding(false) and setHoldingTimeoutError(false) and breaks. Do NOT touch messages / contextPct / harnessTasks / backgroundedAgents / plan_pending / asideText / status. Add a contrast comment noting the distinction from case "session_changed" which is heavy-reset for a real recycle.
    - New file src/backend/claude-session/claude-session-server.repoll.test.ts covering five branch cases (a-e per spec) with WS + discoverClaudeSession mocked.
    - New PrettyView test asserting: (i) session_holding_cleared while isHolding=true → overlay unmounts (isHolding false, no red variant); (ii) messages/contextPct/harnessTasks arrays populated before the frame are preserved verbatim; (iii) setStatus was NOT called.
  </behavior>
  <action>
    Do NOT start Task 2 until Task 1 is committed. This is Fix B, atomically separate.

    Edit 1 — src/ui/api/claude-session-api.ts (after the SessionHoldingEvent block at line 113-115): add `export type SessionHoldingClearedEvent = { type: "session_holding_cleared" };`. Then include it in the ClaudeSessionServerEvent union (find the union definition in the same file — grep for `ClaudeSessionServerEvent` if not obvious). No additional payload fields on the variant.

    Edit 2 — src/backend/claude-session/claude-session-server.ts: add helper transitionFromHoldingToActiveSameFile after the transitionToHolding helper (~line 1447), before transitionToActiveNew (~line 1456). Exact shape (mirror transitionToHolding contract):

    - Guard `if (changeoverState !== "holding") return;` — idempotency.
    - `changeoverState = "active"; holdingTicks = 0;`
    - `if (!stopped && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ type: "session_holding_cleared" })); } catch { /* ws may be mid-close */ } }`
    - `sshLogger.info("Claude session self-cleared from holding on same-file recovery", { operation: "claude_session_holding_cleared", userId, sessionId, hostId: currentHostId, tmuxSession: currentTmuxSession, sessionFile: currentSessionFile });`

    Call site: in the discoveryRepollTimer .then callback active-branch (~line 2993), after the `if (result.sessionFile !== currentSessionFile)` block closes, add: `else if (changeoverState === "holding") { transitionFromHoldingToActiveSameFile(); }`. Guard is safe because the outer branch already asserts result.status === "active" and the inner else means sessionFile === currentSessionFile. Update the surrounding comment block (lines 3003-3010) to note that same-file + holding now self-clears (was previously a no-op that let holding stuck for 5 min).

    Edit 3 — src/ui/features/pretty-view/PrettyView.tsx: add `case "session_holding_cleared": { setIsHolding(false); setHoldingTimeoutError(false); break; }` in the switch statement — place it directly after the `case "session_holding"` block at line 684-692 for locality. Add a comment above: "Fix B (2026-07-30): backend self-cleared holding because the same sessionFile came back active on the next repoll tick (not a real recycle — a false-alarm arm from a prior transient). Surgically clear the two holding flags only. Do NOT touch messages / contextPct / harnessTasks / backgroundedAgents / plan_pending / asideText — this contrasts with case 'session_changed' which heavy-resets for a real recycle. Do NOT setStatus — status was already 'streaming' (holding only fires from active/streaming)."

    Edit 4 — NEW file src/backend/claude-session/claude-session-server.repoll.test.ts. Mirror the shape of the existing claude-session-server.aside.test.ts (or count-bounties.test.ts) for its WS + connection mocking setup — check the imports and beforeEach shape at the top of one of those and reuse. Cover five cases per spec:
    - (a) active + same sessionFile + changeoverState=active → no WS send, changeoverState stays active.
    - (b) active + same sessionFile + changeoverState=holding → transitionFromHoldingToActiveSameFile fires: WS receives `{ type: "session_holding_cleared" }`, changeoverState flips back to active, holdingTicks reset to 0.
    - (c) inactive + reason=exec_error + changeoverState=active → NO transitionToHolding, no WS send for session_holding, silent tick.
    - (d) inactive + reason=exec_error + changeoverState=holding → NO holdingTicks++ (assert holdingTicks unchanged after the tick).
    - (e) inactive + reason=not_claude + changeoverState=active → transitionToHolding fires as before (regression guard).

    If the test file's mocking scaffolding for the interval timer / WS behavior is heavy (this test is the first repoll-branch coverage), that's expected — this is fresh coverage for a hot code path.

    Edit 5 — src/ui/features/pretty-view/PrettyView.test.tsx (or a sibling like PrettyView.aside.test.tsx if the shape fits better; pick whichever has the WS-onmessage test shape already established — check both): add one new test. Setup: render PrettyView, drive the WS to a state where isHolding=true (send a `session_holding` frame first, or set the state directly if the test file uses that shape). Then send `session_holding_cleared`. Assert:
    - isHolding flag is false (overlay unmounts — query for SessionHoldingOverlay by role/testid; assert absent).
    - Red-variant flag (holdingTimeoutError) is false.
    - messages array populated BEFORE the frame is still present verbatim after (populate via one or two `message` frames before the holding frame).
    - contextPct set BEFORE the frame is still the same value after.
    - harnessTasks set BEFORE the frame is still the same value after.
    - setStatus was NOT called between the session_holding and session_holding_cleared frames (spy on setStatus or assert status prop unchanged — mirror however the file already asserts status).

    Verification: run backend + frontend build + FULL vitest suite (not just scoped) and log to a file, then grep for `FAIL|failed|✗` per spec (learned from #209 → #211 that trusting "0 failed" without a spot-check misses failures).

    Suggested atomic commit message: `Add session_holding_cleared WS event and self-clear on same-file recovery during holding — false-alarm holding no longer waits 5 minutes to escape`
  </action>
  <verify>
    <automated>npm run build:backend &amp;&amp; npm run build &amp;&amp; npx vitest run 2>&amp;1 | tee /tmp/vitest-260730-sjf.log &amp;&amp; ! grep -E 'FAIL|failed|✗' /tmp/vitest-260730-sjf.log | grep -v '0 failed' | grep -v '\\.js:'</automated>
  </verify>
  <done>
    Both builds green (EXIT 0). Full vitest suite green with the new repoll-branch tests (5 cases) and new PrettyView test included; the grep gate returns nothing (no FAIL / failed / ✗ lines other than test-count summary strings). Two atomic commits on feat/tab-title-from-tmux — Task 1's commit and Task 2's commit, in that order. Grep confirms `session_holding_cleared` appears in all four expected places: claude-session-api.ts (wire type), claude-session-server.ts (helper + WS emit + log op name), and PrettyView.tsx (case handler). No push, no docker build, no deploy — stopped at commit boundary per fleet rule.
  </done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` EXIT 0 (frontend TS check).
- `npm run build:backend` EXIT 0 (backend TS build — learned that frontend `tsc --noEmit` doesn't catch backend TS errors).
- `npm run build` EXIT 0 (frontend build).
- `npx vitest run 2>&1 | tee /tmp/vitest-260730-sjf.log` runs to completion; grep for `FAIL|failed|✗` in the log returns nothing (spot-check the last 100 lines by eye too, per patch-#209 learning).
- Two atomic commits on `feat/tab-title-from-tmux` (or one consolidated commit if that ships cleaner):
  - Commit 1 (Fix A): tmux-helper.ts + session-file-discovery.ts + session-server branch switch + skip holdingTicks++ + session-file-discovery.test.ts.
  - Commit 2 (Fix B): claude-session-api.ts + session-server helper + call site + PrettyView.tsx handler + claude-session-server.repoll.test.ts + PrettyView.test.tsx.
- No push, no `docker build`, no `docker compose up`, no touch of `/opt/skynet/`, no edits under `~/.claude/identities/`, no update to ROADMAP.md.
</verification>

<success_criteria>
- Simulated / real transient SSH failure at queryPanePid does NOT arm the session-holding overlay (verified by test 1c: inactive+exec_error+active → no transitionToHolding).
- Real inactive reasons still arm holding (verified by test 1e: inactive+not_claude+active → transitionToHolding fires — regression guard).
- If holding is somehow armed and the next tick sees active + same file, holding self-clears within one repoll interval (verified by test 1b: session_holding_cleared emitted, changeoverState back to active, holdingTicks=0).
- Frontend handler for session_holding_cleared preserves the message stream verbatim (verified by PrettyView test).
- Real SIGTERM-fallback recycles (different sessionFile) still fire session_changed as before (the "different file" branch at line 2994 is untouched).
- Full test suite passes green with the grep-gate check (no FAIL/failed/✗ lines).
- Two atomic commits land on feat/tab-title-from-tmux; nothing pushed, nothing deployed.
</success_criteria>

<output>
Create `.planning/quick/260730-sjf-fix-recycling-overlay-fires-when-host-un/260730-sjf-SUMMARY.md` when done, following the SUMMARY template shape used by prior quick tasks (see `.planning/quick/260730-qbl-*/260730-qbl-SUMMARY.md` for reference shape).
</output>
