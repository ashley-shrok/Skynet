---
phase: 260724-bwi
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/PrettyView.test.tsx
autonomous: true
requirements:
  - PATCH-148
tags:
  - websocket
  - pretty-view
  - reconnect
  - ios-pwa

must_haves:
  truths:
    - "When PrettyView's WS closes with status != 'inactive' AND reconnectAttemptsRef < MAX_RECONNECT_ATTEMPTS, a fresh WS is opened after backoff"
    - "errorMessage clears on the NEXT successful ws.onopen (never before scheduling a retry — no transient empty state)"
    - "After MAX_RECONNECT_ATTEMPTS (5) consecutive closes, no further retry is scheduled and errorMessage remains 'Connection closed'"
    - "visibilitychange:visible resets reconnectAttemptsRef to 0 and opens a fresh WS when the current WS is not OPEN and status is not 'inactive' (the direct Ashley iOS PWA repro fix)"
    - "status === 'inactive' short-circuits ALL retry paths (onclose, visibilitychange) — no reconnect, no errorMessage clear, terminal state preserved"
    - "reconnectAttemptsRef resets to 0 when hostId/tmuxSession changes (fresh pane = fresh budget) but NOT when retryKey bumps (would defeat the cap)"
    - "Cleanup fn clears any pending reconnectTimeoutRef so unmount does not fire a retry against a stale wsRef"
  artifacts:
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "auto-reconnect wiring mirroring Terminal.tsx's proven pattern"
      contains: "MAX_RECONNECT_ATTEMPTS"
    - path: "src/ui/features/pretty-view/PrettyView.test.tsx"
      provides: "test coverage for retry-on-close, max-attempt cap, visibilitychange reset, inactive-guard"
      contains: "reconnect"
  key_links:
    - from: "src/ui/features/pretty-view/PrettyView.tsx"
      to: "src/ui/api/claude-session-api.ts (openClaudeSessionSocket)"
      via: "useEffect re-run triggered by retryKey state bump"
      pattern: "openClaudeSessionSocket\\(\\)"
    - from: "src/ui/features/pretty-view/PrettyView.tsx"
      to: "document.visibilitychange event"
      via: "addEventListener in a dedicated useEffect"
      pattern: "visibilitychange"
---

<objective>
Patch #148 — mirror Terminal.tsx's proven WebSocket auto-reconnect pattern into
PrettyView's claude-session bridge WebSocket to fix Ashley's iOS PWA repro:
persistent "connection closed" text after backgrounding (or after deploy
container recreate) that requires manual pretty-view toggle to clear.

Purpose: patch #147 SkynetLog telemetry proved Terminal.tsx's ssh WS reconnects
cleanly (3 end-to-end cycles, 0 failures). The "connection closed" text Ashley
sees is PrettyView's OWN errorMessage state from its OWN separate WebSocket to
/claude-session/websocket/. PrettyView.tsx:447-457 explicitly has "Do NOT
auto-reopen" and only flips status to "error" + sets errorMessage. This patch
replaces that dead-end with the same retry-on-close + visibilitychange-triggered
reopen mechanism that Terminal.tsx already runs successfully.

Output:
- src/ui/features/pretty-view/PrettyView.tsx: retry-on-close with fixed backoff
  (2s, 4s, 6s, 8s, 8s = 5 attempts, ~28s window), retryKey + useEffect re-run
  mechanic, visibilitychange handler, statusRef mirror to avoid setState-inside-
  callback double-render, MAX_RECONNECT_ATTEMPTS module-scope const.
- src/ui/features/pretty-view/PrettyView.test.tsx: 4 new tests covering
  retry-on-close, max-attempt cap, visibilitychange reset, and inactive-guard.
- Single atomic commit on `feat/tab-title-from-tmux` — NO Co-Authored-By trailer.
- NO deploy, NO push. skynet-patches.md write-up deferred to deploy-recommendation.

Locked design decisions (do NOT re-litigate):
- Same pattern as Terminal.tsx (proven working per patch #147 telemetry)
- Preserve "inactive" special-case (server-authoritative terminal state)
- MAX_RECONNECT_ATTEMPTS = 5 module-scope const
- Backoff: Math.min(2000 * attempt, 8000) ms per retry
- retryKey state + useEffect re-run pattern (idiomatic React, minimal new state)
- Reset counter on hostId/tmuxSession change, NOT on retryKey bump
- Clear errorMessage on next ws.onopen (never on retry-schedule)
- visibilitychange handler resets counter to 0 (Ashley iOS PWA fix)
- No rate limiting, no exponential jitter, no persistence across reloads

Explicit non-scope:
- Terminal.tsx — do NOT modify (proven working)
- ConnectionLogContext.tsx (patch #147) — do NOT touch
- claude-session-api.ts (openClaudeSessionSocket signature) — do NOT modify
- IdentityModal.tsx (also opens claude-session WS) — deferred to follow-up if it exhibits the same bug
- skynet-patches.md — deferred to deploy batch write-up
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/ui/features/pretty-view/PrettyView.tsx
@src/ui/features/pretty-view/PrettyView.test.tsx
@src/ui/features/terminal/Terminal.tsx
@src/ui/api/claude-session-api.ts

**Interface contracts already established (do NOT re-derive):**

- `openClaudeSessionSocket(): WebSocket` — signature at
  `src/ui/api/claude-session-api.ts:14`. Called once per mount; the retry
  path calls it again on each retryKey bump. Returned WS has the standard
  browser WebSocket API — onopen / onmessage / onerror / onclose /
  close() / readyState (1 = OPEN).

- `Status = "connecting" | "streaming" | "inactive" | "error"` — the four
  values PrettyView's internal state uses (PrettyView.tsx:100). Only
  "inactive" is server-authoritative and short-circuits retry.

- Terminal.tsx reference points (READ-ONLY — patterns to mirror, NOT to
  modify):
  * `Terminal.tsx:344-374` — visibilitychange useEffect: hidden clears
    pending timeout + resets counter to 0; visible resets counter to 0
    AND calls connectToHost() if terminal exists. Skips work when
    unmounting or when SSH-side disconnect flag is set.
  * `Terminal.tsx:886-960` — attemptReconnection(): guards for unmount +
    already-reconnecting + max-attempts; uses Math.min(2000 * 2^(n-1), 8000)
    exponential backoff; on max cap sets a permanent overlay flag and
    logs. PrettyView will use the SIMPLER `Math.min(2000 * attempt, 8000)`
    linear-with-cap (2s, 4s, 6s, 8s, 8s) per locked D-03 — deliberately
    NOT exponential (Terminal.tsx uses exponential because the SSH
    handshake is expensive; the claude-session WS is cheap).

- Current onclose to REPLACE (PrettyView.tsx:447-457):
  ```
  ws.onclose = () => {
    if (cancelled) return;
    setStatus((prev) => prev === "inactive" ? prev : "error");
    setErrorMessage((prev) => prev ?? "Connection closed");
  };
  ```
  New onclose must still set the error state fields on close, but ALSO
  schedule a retry when the guards pass. The "Do NOT auto-reopen" comment
  block gets DELETED (obsolete) — replace with a fresh comment block that
  documents the mirror-of-Terminal pattern and the "inactive" short-circuit.

- Existing useEffect deps (PrettyView.tsx:468): `[hostId, tmuxSession]`.
  After patch: `[hostId, tmuxSession, retryKey]`. The full-reset block at
  the top of the effect (setMessages([]), setStatus("connecting"), etc.)
  must be gated so retryKey-triggered re-runs do NOT wipe messages — only
  hostId/tmuxSession changes trigger full reset. Use a `paneKeyRef` mirror
  (string = `${hostId}::${tmuxSession}`) compared inside the effect to
  detect "same pane, retry re-run" vs "new pane, fresh mount".

**Test harness patterns (from PrettyView.test.tsx:12-29):**

- `vi.mock("@/api/claude-session-api", ...)` returns a stubbed WS with
  readyState=1, jest.fn() send/close, and mutable onopen/onmessage/
  onerror/onclose slots. New tests need access to the CURRENT stub WS
  and to the SEQUENCE of stubs created across retries. Convert the
  factory to return DIFFERENT stub objects on each call (push each into
  an array) so tests can assert stub #2 was created after backoff,
  stub #3 after the next close, etc.
- New tests need `vi.useFakeTimers()` in beforeEach so setTimeout(2000)
  is advanceable via `vi.advanceTimersByTime(2000)` wrapped in act().
- To simulate visibilitychange, dispatch on `document` after setting
  `document.hidden` via Object.defineProperty (jsdom supports this).
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add auto-reconnect wiring to PrettyView.tsx (mirror Terminal.tsx pattern)</name>
  <files>src/ui/features/pretty-view/PrettyView.tsx</files>

  <behavior>
    - Behavior 1: ws.onclose with status="streaming" (or "connecting"/"error"),
      attempts < 5 → schedules retry after Math.min(2000 * (attempt+1), 8000) ms
      and increments reconnectAttemptsRef. On the timer firing, retryKey state
      bumps, the WS-setup useEffect re-runs, and a fresh WS is created via
      openClaudeSessionSocket(). errorMessage is set to "Connection closed" on
      the close (existing behavior) and CLEARED on the fresh WS's onopen.
    - Behavior 2: ws.onclose with status="inactive" → NO retry scheduled, NO
      reconnectAttemptsRef increment, errorMessage NOT overwritten if already set
      (existing setErrorMessage((prev) => prev ?? "Connection closed") pattern
      preserved). setStatus keeps "inactive" (existing guarded setState pattern).
    - Behavior 3: ws.onclose fires when reconnectAttemptsRef === 5 →
      status="error", errorMessage="Connection closed", NO further retry timer
      scheduled. The 5-attempt cap is honored across a single close-chain.
    - Behavior 4: visibilitychange to visible while WS.readyState !== OPEN AND
      status !== "inactive" → reconnectAttemptsRef resets to 0, retryKey bumps
      immediately, fresh WS opens on the effect re-run. When status ==="inactive"
      the handler no-ops. When document.hidden → clears any pending
      reconnectTimeoutRef but does NOT force a retryKey bump.
    - Behavior 5: hostId or tmuxSession change → reconnectAttemptsRef resets
      to 0, full state reset runs (setMessages([]), etc.), fresh WS opens.
      retryKey-only re-run → reconnectAttemptsRef PRESERVED (cap intact),
      full-reset block SKIPPED (messages/status/etc. preserved so retry does
      not flash blank UI).
    - Behavior 6: Component unmount with a pending reconnectTimeoutRef →
      cleanup clears the timer BEFORE the setTimeout callback would fire.
      No stray fetch, no setState-on-unmounted warnings.
  </behavior>

  <action>
    Implement in PrettyView.tsx per locked design decisions:

    (a) At module scope (above the component function), add:
        `const MAX_RECONNECT_ATTEMPTS = 5;` with a comment tying it to
        the Terminal.tsx pattern and the ~28s total retry window
        (2+4+6+8+8s). Do NOT export.

    (b) Inside the component (near wsRef declaration around L218), add
        three new refs and one new state:
        - `reconnectAttemptsRef` (useRef<number>(0)) — persists across
          retryKey re-runs, resets on hostId/tmuxSession change (via the
          paneKeyRef compare inside the effect).
        - `reconnectTimeoutRef` (useRef<ReturnType<typeof setTimeout> | null>(null))
          — pending retry timer id, cleared on cleanup / unmount / visibility hide.
        - `paneKeyRef` (useRef<string>('')) — holds `${hostId}::${tmuxSession}`.
          Inside the effect, compare `${hostId}::${tmuxSession}` vs
          paneKeyRef.current: if different, this is a fresh pane mount →
          reset reconnectAttemptsRef to 0 AND run the full-reset block;
          if same, this is a retryKey-triggered re-run → SKIP the full
          reset. Update paneKeyRef.current at the end of the branch.
        - `retryKey` state (useState<number>(0)) — bumped by the retry
          scheduler and by the visibilitychange handler. Added to the
          existing WS-setup useEffect's deps array.
        - `statusRef` (useRef<Status>('connecting')) — mirrors `status`
          via a small dedicated useEffect (`useEffect(() => { statusRef.current = status; }, [status])`).
          Read inside the WS callbacks so onclose can decide "is this
          inactive?" WITHOUT invoking setStatus's functional-update form
          twice (avoids the double-setState pattern flagged in the
          constraints).

    (c) MODIFY the existing WS-setup useEffect (currently L280-468):
        - Add `retryKey` to the deps array.
        - Wrap the full-reset block (setMessages([]), setStatus("connecting"),
          setInactiveReason(null), setErrorMessage(null), setContextPct(null),
          setHarnessTasks([]), setBackgroundedAgents([]), setBackgroundedShells([]),
          setPlanPending(null), setIsHolding(false), setShowOverlay(false)) in
          an `if (paneKey !== paneKeyRef.current)` guard so retry re-runs
          preserve conversation state. Where `paneKey = `${hostId}::${tmuxSession}``.
          Inside the guard, also reset reconnectAttemptsRef.current = 0 and
          update paneKeyRef.current = paneKey.
        - In ws.onopen (currently L298-310): after the send() try/catch,
          add `setErrorMessage(null)` UNCONDITIONALLY (a fresh WS is open,
          any lingering "Connection closed" from a prior attempt is stale).
          Do NOT reset reconnectAttemptsRef here — reset happens on
          hostId/tmuxSession change or on visibilitychange:visible only.
        - REPLACE ws.onclose (currently L447-457) with the new handler:
          * Guard: `if (cancelled) return;`
          * Read current status via `statusRef.current`.
          * If `statusRef.current === 'inactive'`: preserve status,
            preserve errorMessage nullish-coalesce ("Connection closed"),
            NO retry scheduled. Comment: this is FALLBACK-01 preservation
            + prevents client-side retry from stepping past a legitimate
            server-authoritative terminal frame.
          * Else: setStatus("error"), setErrorMessage nullish-coalesce
            ("Connection closed") (preserves existing UI-visible message).
            Then check `reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS`:
            - If under cap: schedule retry. Compute
              `delay = Math.min(2000 * (reconnectAttemptsRef.current + 1), 8000)`,
              increment reconnectAttemptsRef.current, then
              `reconnectTimeoutRef.current = setTimeout(() => {
                reconnectTimeoutRef.current = null;
                if (cancelled) return;
                setRetryKey((k) => k + 1);
              }, delay);`
            - If at cap: NO timer scheduled. status stays "error",
              errorMessage stays "Connection closed". Log via existing
              conventions if any (do NOT add console.log — patch #146
              log-forwarder captures errors naturally through the "error"
              status but do NOT add ambient debug logging).
        - MODIFY the cleanup fn (currently L459-467): clear
          reconnectTimeoutRef.current if non-null BEFORE calling ws.close().
          Set reconnectTimeoutRef.current = null after clearTimeout.
        - Update / rewrite the comment block that used to say "Do NOT
          auto-reopen" — new comment documents the mirror-of-Terminal
          pattern, the "inactive" short-circuit rationale (FALLBACK-01
          preservation + server-authoritative state), the 5-attempt cap,
          the backoff schedule, and the visibilitychange:visible reset
          path (which is where Ashley's iOS PWA case lands).

    (d) Add a NEW useEffect (separate from the WS-setup effect) for the
        visibilitychange handler. Mirror the Terminal.tsx:344-374 shape
        but simpler (no isUnmountingRef, no wasDisconnectedBySSH):
        - `const handleVisibilityChange = () => { ... }`
        - Hidden branch: if reconnectTimeoutRef.current !== null,
          clearTimeout and set to null. Do NOT bump retryKey. Do NOT
          reset reconnectAttemptsRef (a mid-retry hide should NOT
          drop the accumulated attempt count — otherwise re-showing
          while socket is still bad would just start a fresh 5-attempt
          burst against a genuinely-broken server).
        - Visible branch: if statusRef.current === "inactive" → return.
          If wsRef.current?.readyState === 1 (OPEN) → return (still
          connected, nothing to do). Else → reset
          reconnectAttemptsRef.current = 0 (fresh budget for the
          foregrounded PWA per locked D-07) and bump retryKey. The
          WS-setup useEffect re-runs, opens fresh WS, onopen clears
          errorMessage.
        - Add + remove event listener on document. Deps: [] (mount-once).
          Reads only refs, no reactive state dependencies.

    (e) Add a small mirror useEffect: `useEffect(() => { statusRef.current = status; }, [status]);`
        Place immediately after the visibilitychange useEffect for locality.

    Line budget: ~40-60 net new lines in PrettyView.tsx. If the diff
    balloons past ~80 lines, extract only what's necessary — the pattern
    is intentionally minimal.

    Watchouts:
    - Do NOT reset reconnectAttemptsRef inside the ws.onopen handler.
      A rapid open/close/open cycle (e.g., server bounced twice in a row)
      would then defeat the 5-attempt cap.
    - Do NOT put setState inside the onclose handler's `if inactive` branch
      that would OVERWRITE errorMessage. Use the nullish-coalesce pattern
      the existing code uses (`(prev) => prev ?? "Connection closed"`)
      so if a prior "tail_error" frame already set errorMessage, that
      more-specific message survives.
    - Do NOT add retryKey to the deps of the visibilitychange useEffect —
      it MUST be a mount-once effect, else it re-registers listeners on
      every retry.
    - Do NOT touch the Phase 3 session-changeover state (isHolding,
      showOverlay, holdingTimeoutError) — those are orthogonal server-
      driven signals and must not be reset by client-side reconnect.
    - Preserve existing `if (cancelled) return;` guards in all WS callbacks.

    Grep gates (must pass after implementation):
    - `grep -c 'reconnectAttemptsRef' src/ui/features/pretty-view/PrettyView.tsx` >= 3
    - `grep -c 'MAX_RECONNECT_ATTEMPTS' src/ui/features/pretty-view/PrettyView.tsx` >= 2
    - `grep -c 'visibilitychange' src/ui/features/pretty-view/PrettyView.tsx` >= 2
      (addEventListener + removeEventListener)
    - `grep -c 'reconnectTimeoutRef' src/ui/features/pretty-view/PrettyView.tsx` >= 3
    - `grep -c 'Do NOT auto-reopen' src/ui/features/pretty-view/PrettyView.tsx` == 0
      (old comment must be gone)
    - `grep -c 'retryKey' src/ui/features/pretty-view/PrettyView.tsx` >= 3

    Fork convention reminder: single atomic commit at the END (after
    Task 2). Commit subject:
    `feat: patch #148 — PrettyView WebSocket auto-reconnect (fixes stale "Connection closed" state after WS drop on iOS PWA background OR deploy container recreate)`
    NO Co-Authored-By trailer. NO push. NO deploy.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet && npm run type-check 2>&1 | tail -20 && grep -c 'reconnectAttemptsRef' src/ui/features/pretty-view/PrettyView.tsx && grep -c 'MAX_RECONNECT_ATTEMPTS' src/ui/features/pretty-view/PrettyView.tsx && (grep -v '^\s*//' src/ui/features/pretty-view/PrettyView.tsx | grep -v '^\s*\*' | grep -c 'visibilitychange') && (grep -c 'Do NOT auto-reopen' src/ui/features/pretty-view/PrettyView.tsx || echo "0 (expected)")</automated>
  </verify>

  <done>
    - `npm run type-check` exits clean (no new errors introduced).
    - All grep gates in the action section pass with the specified counts.
    - The old "Do NOT auto-reopen" comment is gone; new comment documents
      the mirror-of-Terminal pattern and the "inactive" short-circuit.
    - The WS-setup useEffect deps array is `[hostId, tmuxSession, retryKey]`.
    - Full-reset block is guarded by the paneKey comparison so retry
      re-runs preserve messages/status.
    - A new visibilitychange useEffect exists with `[]` deps.
    - MAX_RECONNECT_ATTEMPTS = 5 is a module-scope const above the
      component function.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend PrettyView.test.tsx with 4 reconnect tests + verify all pass</name>
  <files>src/ui/features/pretty-view/PrettyView.test.tsx</files>

  <behavior>
    - Test A (must — retry-on-close): After PrettyView mounts + WS.onopen +
      one `session` frame flips status to streaming, calling
      currentWs.onclose() must schedule a retry. Advancing timers by 2000ms
      inside act() must cause a fresh openClaudeSessionSocket() call (stub
      count goes from 1 to 2). The new stub's onopen firing must clear
      errorMessage from the DOM.
    - Test B (must — max-attempt cap): Simulate 5 consecutive close→retry→
      close cycles by firing close, advancing 2000ms, firing close on the
      new stub, advancing 4000ms, and so on through the backoff schedule
      (2s, 4s, 6s, 8s, 8s). After the 5th close, advancing another 8000ms
      must NOT create a 6th stub — openClaudeSessionSocket call count
      stays at 5. The DOM must show "Connection closed" (errorMessage
      persisted from the last close).
    - Test C (should — visibilitychange fresh-budget after cap): Reach
      the max-attempt state as in Test B. Set document.hidden = false and
      dispatch a visibilitychange event on document. Advancing timers by
      2000ms must create a 6th stub (counter was reset to 0 by the
      handler, then retryKey bump triggered fresh mount). NOTE: because
      the fresh WS opens SYNCHRONOUSLY via useEffect re-run (not on a
      setTimeout), the openClaudeSessionSocket call count should tick up
      immediately after the visibilitychange dispatch — NOT after
      advanceTimersByTime. Adjust the assertion accordingly.
    - Test D (should — inactive skips retry): After mount, fire an
      `inactive` message frame to flip status to "inactive". Then fire
      currentWs.onclose(). Advancing 2000ms MUST NOT create a new stub
      (openClaudeSessionSocket call count stays at 1). errorMessage must
      NOT show "Connection closed" (or the pre-existing inactive UI
      preserves its own copy — assert whichever the actual DOM state is).

    Naming: append these to the existing describe block or open a new
    `describe("PrettyView — patch #148 WebSocket auto-reconnect", ...)`
    block below the Phase 05 describe.
  </behavior>

  <action>
    (a) Convert the openClaudeSessionSocket mock factory (currently at
        L13-29) so each call returns a FRESH stub object, and the mock
        keeps an array of stubs so tests can index the current / prior WS:

        ```ts
        const wsStubs: Array<{
          readyState: number;
          bufferedAmount: number;
          send: ReturnType<typeof vi.fn>;
          close: ReturnType<typeof vi.fn>;
          onmessage: ((e: MessageEvent<string>) => void) | null;
          onopen: (() => void) | null;
          onerror: (() => void) | null;
          onclose: (() => void) | null;
          addEventListener: ReturnType<typeof vi.fn>;
          removeEventListener: ReturnType<typeof vi.fn>;
        }> = [];

        vi.mock("@/api/claude-session-api", () => ({
          openClaudeSessionSocket: vi.fn(() => {
            const ws = { readyState: 1, ... };
            wsStubs.push(ws);
            return ws;
          }),
        }));
        ```

        Do NOT put `wsStubs` inside the vi.mock factory closure — vi.mock
        hoists. Declare wsStubs at module scope in the test file, then
        reference it in the factory. In beforeEach: `wsStubs.length = 0;`
        so tests start with a clean array. Export a small helper
        `getCurrentWs()` that returns `wsStubs[wsStubs.length - 1]` for
        readability.

    (b) In beforeEach: `vi.useFakeTimers();` and `wsStubs.length = 0;`
        (in addition to the existing `vi.clearAllMocks()`).
        In afterEach: `vi.useRealTimers();` (in addition to existing
        `vi.restoreAllMocks()`). Preserve backward-compat for the Phase
        05 tests — if any of them rely on real timers, either add
        `vi.useRealTimers()` at the start of those tests OR move the
        fake-timer setup to a separate describe block.

    (c) Add a small helper `flipToStreaming(ws)` that calls
        `act(() => { ws.onopen?.(); ws.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'session', ... }) })); });`
        to reach status="streaming" deterministically.

    (d) Add a small helper `flipToInactive(ws, reason = 'user_exit')` that
        fires an `inactive` message frame.

    (e) Add a helper `fireClose(ws)` that calls `act(() => { ws.onclose?.(); });`.

    (f) Add a helper `advance(ms)` that wraps `act(() => { vi.advanceTimersByTime(ms); });`.

    (g) Add a helper `fireVisibilityChange(hidden)` that sets
        `Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });`
        and dispatches `document.dispatchEvent(new Event('visibilitychange'));`
        inside act().

    (h) Write Test A, B, C, D per the behavior spec above. Use
        `container.textContent` OR `queryByText(/Connection closed/i)`
        to assert errorMessage visibility. Use
        `vi.mocked(openClaudeSessionSocket).mock.calls.length` or
        `wsStubs.length` to assert new WS creations. Use `getCurrentWs()`
        to reach the freshest stub for the next close.

    Test C precision: the useEffect re-run triggered by retryKey bump
    executes synchronously with the React commit that follows the
    setRetryKey call. Wrap the dispatch in act() and DO NOT advance
    timers first — the assertion is `wsStubs.length === 6` right after
    the visibilitychange dispatch settles. If that doesn't match reality
    in the jsdom environment (React 18/19 batching), fall back to a
    single `advance(0)` to flush microtasks.

    Line budget: ~40-80 net new lines. The 4 tests are structurally
    similar so most of the code is helpers reused across all four.

    Do NOT modify the existing Phase 05 tests' assertions. Only touch
    the mock factory shape (compatibly — the old tests used the returned
    ws directly via `openClaudeSessionSocket.mock.results[0].value` or
    equivalent; if they don't, the shape change is invisible to them).
    If any existing test breaks from the mock shape change, restore
    behavioral parity — do NOT rewrite existing test logic.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet && npm test -- pretty-view/PrettyView --run 2>&1 | tail -40 && npm run type-check 2>&1 | tail -10</automated>
  </verify>

  <done>
    - `npm test -- pretty-view/PrettyView --run` exits 0 with ALL tests
      passing (existing Phase 05 tests + 4 new reconnect tests).
    - The 4 new tests are visible in the reporter output under the
      describe block(s) named per (b) above.
    - `npm run type-check` exits clean.
    - `npm run build` exits clean (run once at the end to verify no
      Vite-side surprises; not part of this task's automated verify but
      the phase verification below covers it).
  </done>
</task>

</tasks>

<verification>
End-of-plan verification (after both tasks complete):

1. **Type-check + subsystem tests:**
   - `cd /home/ubuntu/skynet && npm run type-check` → clean
   - `cd /home/ubuntu/skynet && npm test -- pretty-view --run` → all green
     (existing Phase 05 tests + 4 new #148 tests)

2. **Build verification:**
   - `cd /home/ubuntu/skynet && npm run build` → clean, no bundle errors

3. **Grep gates:**
   - `grep -c 'reconnectAttemptsRef' src/ui/features/pretty-view/PrettyView.tsx` >= 3
   - `grep -c 'MAX_RECONNECT_ATTEMPTS' src/ui/features/pretty-view/PrettyView.tsx` >= 2
   - `grep -v '^\s*//' src/ui/features/pretty-view/PrettyView.tsx | grep -v '^\s*\*' | grep -c 'visibilitychange'` >= 2
     (comment lines stripped; must count real add/remove listener calls)
   - `grep -c 'Do NOT auto-reopen' src/ui/features/pretty-view/PrettyView.tsx` == 0
   - `grep -c 'reconnectTimeoutRef' src/ui/features/pretty-view/PrettyView.tsx` >= 3
   - `grep -c 'retryKey' src/ui/features/pretty-view/PrettyView.tsx` >= 3

4. **Diff shape check:**
   - `git diff --stat src/ui/features/pretty-view/PrettyView.tsx src/ui/features/pretty-view/PrettyView.test.tsx`
     shows ~40-60 net additions in PrettyView.tsx and ~40-80 net
     additions in PrettyView.test.tsx. If either is 2x+ over budget,
     stop and reconsider — the pattern was supposed to be surgical.

5. **No unrelated files touched:**
   - `git diff --name-only` shows EXACTLY:
     - src/ui/features/pretty-view/PrettyView.tsx
     - src/ui/features/pretty-view/PrettyView.test.tsx
   - Terminal.tsx MUST be unchanged (proven-working code, do not touch).
   - ConnectionLogContext.tsx MUST be unchanged.
   - claude-session-api.ts MUST be unchanged.
   - IdentityModal.tsx MUST be unchanged.

6. **Commit (single atomic, fork convention):**
   - Subject: `feat: patch #148 — PrettyView WebSocket auto-reconnect (fixes stale "Connection closed" state after WS drop on iOS PWA background OR deploy container recreate)`
   - Body: brief mention of Terminal.tsx pattern being mirrored, the
     inactive short-circuit preservation, the visibilitychange:visible
     fresh-budget path (Ashley iOS PWA fix), and the 5-attempt/8s cap.
   - NO Co-Authored-By trailer (fork convention).
   - Command:
     `git add src/ui/features/pretty-view/PrettyView.tsx src/ui/features/pretty-view/PrettyView.test.tsx && git commit -m "..."`
   - NO push, NO deploy — Tina proposes deploy separately.

7. **DO NOT update `~/.claude/identities/tina/skynet-patches.md`** —
   deferred to deploy-recommendation time per Ashley's 2026-07-23
   batch-writeups-until-deploy rule.
</verification>

<success_criteria>
- [ ] PrettyView.tsx retries on ws.close (up to 5 attempts, 2/4/6/8/8s backoff)
- [ ] "inactive" state short-circuits ALL retry paths (onclose + visibilitychange)
- [ ] errorMessage clears on the NEXT successful ws.onopen (never on retry-schedule)
- [ ] visibilitychange:visible resets counter to 0 and reopens if WS not OPEN
- [ ] Cleanup fn clears pending reconnectTimeoutRef before unmount
- [ ] Full-reset block gated by paneKey comparison (retry re-runs preserve messages)
- [ ] MAX_RECONNECT_ATTEMPTS = 5 at module scope (not magic number)
- [ ] All 4 new tests pass + existing Phase 05 tests still green
- [ ] `npm run type-check` clean, `npm run build` clean
- [ ] All grep gates pass with specified counts
- [ ] Single atomic commit on `feat/tab-title-from-tmux` with correct subject
- [ ] NO Co-Authored-By trailer
- [ ] NO push, NO deploy
- [ ] NO changes to Terminal.tsx, ConnectionLogContext.tsx, claude-session-api.ts, IdentityModal.tsx
- [ ] skynet-patches.md NOT updated (deferred to deploy batch)
</success_criteria>

<output>
Create `.planning/quick/260724-bwi-patch-148-prettyview-websocket-auto-reco/260724-bwi-SUMMARY.md` when done.
</output>
