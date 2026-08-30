---
phase: quick-260727-lbr-aside-dismiss-clears-btw-history
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/claude-session-server.ts
  - src/backend/claude-session/claude-session-server.aside.test.ts
  - src/backend/claude-session/claude-session-server.aside.integration.test.ts
autonomous: true
requirements:
  - QUICK-ADCH-01
tags:
  - backend
  - claude-session
  - aside
  - tmux

must_haves:
  truths:
    - "On aside dismiss, the backend sends an `x` keystroke into the pane's tmux BEFORE the Escape keystroke, so Claude Code's /btw overlay clears its in-overlay history before closing."
    - "The two keystrokes are separate tmux send-keys invocations with a >=100ms gap, mirroring injectBtw's paste-mode workaround (patch #152)."
    - "The WS frame shape for aside_dismissed and the frontend dismiss handler are UNCHANGED — only the backend tmux keystroke sequence changes."
    - "The clear-history key is a single exported compile-time constant (BTW_CLEAR_HISTORY_KEY) — a wrong-key UAT is a one-line fix."
  artifacts:
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "BTW_CLEAR_HISTORY_KEY constant + dismissBtw function + caller update"
      contains: "export const BTW_CLEAR_HISTORY_KEY"
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "dismissBtw replaces sendEscapeToBtw"
      contains: "async function dismissBtw"
    - path: "src/backend/claude-session/claude-session-server.aside.test.ts"
      provides: "Unit tests locking the two-keystroke dismiss shape"
      contains: "dismissBtw"
    - path: "src/backend/claude-session/claude-session-server.aside.integration.test.ts"
      provides: "Integration test updated to assert both keystrokes in order"
      contains: "dismissBtw"
  key_links:
    - from: "src/backend/claude-session/claude-session-server.ts:1705 (aside_dismissed WS handler)"
      to: "dismissBtw"
      via: "await dismissBtw(sshConn, currentTmuxSession)"
      pattern: "await dismissBtw\\("
    - from: "dismissBtw"
      to: "BTW_CLEAR_HISTORY_KEY"
      via: "shellQuote(BTW_CLEAR_HISTORY_KEY) inside first tmux send-keys call"
      pattern: "send-keys.*BTW_CLEAR_HISTORY_KEY|send-keys.*'x'"
    - from: "dismissBtw"
      to: "Escape send-keys call"
      via: "second tmux send-keys after setTimeout(100)"
      pattern: "send-keys.*Escape"
---

<objective>
Aside dismiss must clear Claude Code's `/btw` overlay history BEFORE closing the overlay,
so subsequent asides in the same session get a clean slate (the model was self-referencing
prior "please explain" turns from earlier asides and poisoning new aside answers).

Purpose: A single change to the backend tmux keystroke sequence — replace the single-Escape
dismiss with a two-keystroke sequence (`x` to clear in-overlay history, 100ms gap, then
`Escape` to close). The WS frame shape and frontend dismiss handler are untouched. The
clear-history key is a compile-time constant so a wrong-key UAT is a one-line fix.

Output:
- `BTW_CLEAR_HISTORY_KEY = "x"` exported constant next to BTW_PROMPT / ASIDE_END_MARKER.
- `dismissBtw(conn, tmuxSession)` function replacing `sendEscapeToBtw` — two send-keys
  calls (first the clear-history key, then Escape) separated by a 100ms setTimeout,
  matching injectBtw's patch-#152 two-call shape.
- Aside_dismissed WS handler updated to call `dismissBtw` instead of `sendEscapeToBtw`.
- Aside unit test file gets a new describe block locking the two-keystroke dismiss shape
  (call count, ordering, delay, log-and-swallow) — same pattern as the existing injectBtw
  tests at aside.test.ts:337-417.
- Aside integration test updated to assert BOTH keystrokes in order (first `x`, then
  `Escape`), preserving the existing broadcastAsideDismissed coverage.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md

# Backend module under change (constants at 107-129, dismiss helper at 187-210, WS handler at 1703-1711)
@src/backend/claude-session/claude-session-server.ts

# Unit test file — the injectBtw two-call describe at 337-417 is the exact pattern to mirror for dismissBtw
@src/backend/claude-session/claude-session-server.aside.test.ts

# Integration test — the aside_dismissed cross-tab test at 275-326 already exercises the Escape send-keys mock
@src/backend/claude-session/claude-session-server.aside.integration.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add BTW_CLEAR_HISTORY_KEY + dismissBtw two-keystroke helper + wire caller</name>
  <files>src/backend/claude-session/claude-session-server.ts, src/backend/claude-session/claude-session-server.aside.test.ts</files>
  <behavior>
    Add a new describe block to `claude-session-server.aside.test.ts` titled:
      "Phase 14 quick 260727-lbr — dismissBtw two-keystroke shape (clear-history + Escape)"
    Mirror the existing patch #152 injectBtw describe block at aside.test.ts:337-417
    byte-for-byte in structure. Tests to add (all use the already-configured
    `vi.mock("../ssh/tmux-helper.js", ...)` from aside.test.ts:26-31 and reset via
    afterEach — no new mock plumbing needed):

    - Test 1: `execCommand` called exactly twice.
      - call #1 command string: contains `send-keys`, contains `-t 'test-session'`, contains
        the shellQuote-wrapped BTW_CLEAR_HISTORY_KEY (i.e. `'x'`), and does NOT match
        `/\sEscape\s*$/`. Assert via `__asideShellQuoteForTests(BTW_CLEAR_HISTORY_KEY)`.
      - call #2 command string: contains `send-keys`, contains `-t 'test-session'`, ends
        with `Escape` (matches `/\sEscape\s*$/`), and does NOT contain the shellQuote-wrapped
        BTW_CLEAR_HISTORY_KEY.
    - Test 2: 100ms delay enforced BETWEEN call #1 and call #2 via `vi.useFakeTimers()` +
      `vi.advanceTimersByTimeAsync`. After call #1 resolves and 99ms elapsed → still 1 call.
      After 1 more ms (total 100) → 2 calls. Await final promise to clean up. Same
      microtask-flush pattern as aside.test.ts:373-400.
    - Test 3A: log-and-swallow when call #1 rejects — `execCommand` rejects on first call,
      `__dismissBtwForTests(fakeConn, "test-session")` resolves undefined without rethrow.
    - Test 3B: log-and-swallow when call #2 rejects — first call resolves, second rejects,
      still resolves undefined.
    - Test 4: BTW_CLEAR_HISTORY_KEY === "x" (locks the compile-time constant so a rename to
      `c` or `Ctrl+L` fails loud and forces a deliberate re-decision).

    Add imports at the top of aside.test.ts alongside the existing __injectBtwForTests
    import (line 19):
      `BTW_CLEAR_HISTORY_KEY,`
      `__dismissBtwForTests,`

    Then run the tests — they MUST fail (RED) because the new symbols don't exist yet.
  </behavior>
  <action>
    STEP A (RED — write the failing tests first per behavior block above):
    1. Edit `src/backend/claude-session/claude-session-server.aside.test.ts`:
       - Add `BTW_CLEAR_HISTORY_KEY,` and `__dismissBtwForTests,` to the named import list
         from `./claude-session-server.js` at lines 2-20.
       - Append a new `describe("Phase 14 quick 260727-lbr — dismissBtw two-keystroke shape (clear-history + Escape)", ...)` block AFTER the existing injectBtw describe (after line 417).
         Follow the structure of aside.test.ts:337-417 exactly — same `fakeConn`, same
         `afterEach` with `vi.mocked(execCommand).mockReset(); vi.useRealTimers();`.
       - Add all five tests specified in <behavior> (Test 1, Test 2, Test 3A, Test 3B, Test 4).
    2. Run `npx vitest run src/backend/claude-session/claude-session-server.aside.test.ts`
       — the new describe block MUST fail (imports missing). This is the RED gate.

    STEP B (GREEN — implement the production code):
    3. Edit `src/backend/claude-session/claude-session-server.ts`:
       (a) IMMEDIATELY AFTER the `ASIDE_END_MARKER` export at line 129, add:

           ```
           // BTW_CLEAR_HISTORY_KEY — key sent into the tmux pane before Escape to
           // clear Claude Code's in-overlay /btw history before dismissing the
           // overlay. Rationale: /btw history within a Claude Code session poisons
           // subsequent aside answers (the model self-references prior "please
           // explain" turns from earlier asides). Sending this key first gives every
           // new aside a clean slate. Lowercase `x` per the overlay's clear-history
           // keybinding (Ashley 2026-07-27). If UAT reveals a different key (e.g.
           // `c`, `Ctrl+L`), change this constant only — the two-keystroke shape
           // stays the same.
           export const BTW_CLEAR_HISTORY_KEY = "x";
           ```

       (b) REPLACE the entire `sendEscapeToBtw` function at lines 187-210 (docstring
           through closing brace) with `dismissBtw`. New shape:

           - Same signature: `async function dismissBtw(conn: SSHClientType, tmuxSession: string): Promise<void>`
           - Body inside a single try/catch (log-and-swallow, sshLogger.info parity):
             1. `await execCommand(conn, \`tmux send-keys -t ${shellQuote(tmuxSession)} ${shellQuote(BTW_CLEAR_HISTORY_KEY)}\`);`
             2. `await new Promise((resolve) => setTimeout(resolve, 100));`
             3. `await execCommand(conn, \`tmux send-keys -t ${shellQuote(tmuxSession)} Escape\`);`
           - Catch block: `sshLogger.info("aside dismissBtw failed", { operation: "aside_dismiss", tmuxSession, err });`
           - Docstring above the function: explain the two-keystroke rationale, cite
             the `x`-then-Escape sequence, cite the 100ms gap mirroring injectBtw's
             patch #152 paste-mode workaround, and note the WS frame shape is unchanged.

       (c) IMMEDIATELY AFTER the new `dismissBtw` function, add the test-only re-export
           (mirroring `__injectBtwForTests` at line 185):

           ```
           // Test-only re-export of dismissBtw. Same underscore-prefix convention as
           // __injectBtwForTests — internal seam so the vitest suite can assert the
           // two-call shape locked by the quick 260727-lbr change. NOT for production
           // callers.
           export const __dismissBtwForTests = dismissBtw;
           ```

       (d) Update the single caller at line 1705 (inside the `if (msg.type === "aside_dismissed")` block):
             `await sendEscapeToBtw(sshConn, currentTmuxSession);`
           → `await dismissBtw(sshConn, currentTmuxSession);`

    4. Re-run `npx vitest run src/backend/claude-session/claude-session-server.aside.test.ts`
       — the new describe MUST now pass (GREEN). All PRE-EXISTING tests in the file MUST
       still pass (no regressions).

    Non-negotiables:
    - Do NOT change BTW_PROMPT, ASIDE_END_MARKER, injectBtw, or its patch #152 two-call
      shape. Preserve them byte-for-byte.
    - Do NOT introduce a version-based capability check for BTW_CLEAR_HISTORY_KEY —
      compile-time constant per orchestrator spec.
    - Do NOT alter the WS frame shape (`{type:'aside_dismissed', hostId, tmuxSession}`),
      the T-14-02-01 trust posture (connection-scoped currentHostId / currentTmuxSession
      is authoritative), or `broadcastAsideDismissed` semantics.
    - The 100ms setTimeout is intentionally shorter than injectBtw's 200ms — dismiss is a
      pair of single-key presses, not a ~300-char paste. Reference the injectBtw docstring
      pattern but do NOT copy the 200ms number.
    - PrettyView.tsx doc-comment mentions of `sendEscapeToBtw` (lines 231, 305, 633) are
      DOC-ONLY. Leave them out of this task — see Task 2 for the doc-comment sweep decision.
  </action>
  <verify>
    <automated>npx vitest run src/backend/claude-session/claude-session-server.aside.test.ts --reporter=basic</automated>
  </verify>
  <done>
    - `BTW_CLEAR_HISTORY_KEY = "x"` exported from claude-session-server.ts near line 130.
    - `dismissBtw` function exists (replaces sendEscapeToBtw); no reference to the old
      name `sendEscapeToBtw` remains in claude-session-server.ts.
    - `__dismissBtwForTests` exported alongside `__injectBtwForTests`.
    - Caller at (former) line 1705 uses `dismissBtw`.
    - `grep -c "sendEscapeToBtw" src/backend/claude-session/claude-session-server.ts` returns 0.
    - New describe block in aside.test.ts (all 5 tests) passes; all pre-existing tests in
      the same file still pass; no snapshot updates.
  </done>
</task>

<task type="auto">
  <name>Task 2: Update integration test to assert both keystrokes + optional PrettyView doc-comment sweep</name>
  <files>src/backend/claude-session/claude-session-server.aside.integration.test.ts, src/ui/features/pretty-view/PrettyView.tsx</files>
  <action>
    STEP A — Integration test update (mandatory):
    Edit `src/backend/claude-session/claude-session-server.aside.integration.test.ts` around
    lines 289-326 (the "Test B — cross-tab broadcast" body):

    1. Update the inline comment at lines 289-294 that references `sendEscapeToBtw`:
       replace both mentions with `dismissBtw` and note the two-keystroke shape
       (`x` then Escape, 100ms gap).

    2. Replace the single `await execCommand(fakeConn, \`tmux send-keys -t 'tina@main' Escape\`);`
       at line 297 with the TWO-call sequence that a real dismissBtw would produce
       (the test drives the mock directly — same pattern as the existing code):

         `await execCommand(fakeConn, \`tmux send-keys -t 'tina@main' 'x'\`);`
         `await new Promise((resolve) => setTimeout(resolve, 100));`
         `await execCommand(fakeConn, \`tmux send-keys -t 'tina@main' Escape\`);`

       Rationale: this integration test intentionally simulates the dispatch shape
       instead of importing the private helper. We want the mock call log to look
       exactly like a real dismissBtw invocation so the assertion below is meaningful.

    3. Replace the single-Escape assertion at lines 322-325 with an ORDERED two-call
       assertion. Both calls must go through `execCommand`, in this exact order:

       - Find ALL send-keys calls: filter `vi.mocked(execCommand).mock.calls` where
         `cmd.includes("send-keys")`.
       - Assert there are exactly 2 send-keys calls.
       - Assert call[0]'s command string contains `'x'` (shell-quoted key) AND does NOT
         contain `Escape`.
       - Assert call[1]'s command string contains `Escape` AND does NOT contain `'x'`.

       Retain the existing T-14-02-01 comment explaining connection-scoped tmuxSession
       trust — that posture is unchanged.

    4. Preserve everything else in Test B — the peer registration, the pre-condition
       expects (lines 283-287), the `broadcastAsideDismissed(key)` call, and the
       step (a) + step (b) assertions (lines 304-318). Those cover the atomic BOTH-STEPS
       rule and are independent of the keystroke change.

    STEP B — PrettyView.tsx doc-comment sweep (DO IT):
    Update the three doc-only mentions of `sendEscapeToBtw` in
    `src/ui/features/pretty-view/PrettyView.tsx` (lines 231, 305, 633) to `dismissBtw`
    for consistency. These are non-executing comments; the rename is a one-token find/
    replace per line. Doing it in the same change keeps `grep -rn sendEscapeToBtw src/`
    returning zero — which is the fail-loud tripwire for any future refactor that would
    otherwise silently miss the old name.

    Do NOT change any executing code in PrettyView.tsx. Do NOT change the WS frame shape
    or `handleAsideDismiss`.

    Non-negotiables:
    - Do NOT introduce a new import of `dismissBtw` in the integration test — it continues
      to drive `execCommand` directly (matches the existing pattern at line 297).
    - The setTimeout in step A.2 mirrors the real function's timing so the mock log
      shape is truthful; it does NOT need to be a fake-timer test (that's covered by
      Task 1's aside.test.ts Test 2).
  </action>
  <verify>
    <automated>npx vitest run src/backend/claude-session/claude-session-server.aside.integration.test.ts src/backend/claude-session/claude-session-server.aside.test.ts --reporter=basic && test $(grep -rn 'sendEscapeToBtw' src/ | grep -v '^#' | wc -l) -eq 0 && echo "GATE PASS: no sendEscapeToBtw references remain"</automated>
  </verify>
  <done>
    - Test B in the integration test asserts exactly TWO send-keys calls in order
      (`'x'` first, `Escape` second).
    - Comments in the integration test reference `dismissBtw`, not `sendEscapeToBtw`.
    - PrettyView.tsx lines 231, 305, 633 reference `dismissBtw`.
    - `grep -rn "sendEscapeToBtw" src/` returns zero matches.
    - All aside unit + integration tests pass; no other test file was touched.
  </done>
</task>

</tasks>

<verification>
Backend keystroke sequence change verified by:
1. Task 1 unit tests (aside.test.ts new describe block) — locks the two-call shape,
   the 100ms gap, the log-and-swallow behavior, and the `x` constant value.
2. Task 2 integration test — locks that a real dismiss flow produces the ordered
   `x`-then-Escape send-keys pair AND still triggers the atomic broadcastAsideDismissed
   BOTH-STEPS rule for peer state coherence.
3. `grep -rn "sendEscapeToBtw" src/` returns zero — the old name is fully retired.

Manual UAT (post-merge, not gated by this plan): Ashley opens an aside in a Claude Code
pane, closes it, opens a second aside on a different topic, and confirms the second
aside answer no longer self-references the first. If the wrong key was chosen (overlay
did NOT clear), flip `BTW_CLEAR_HISTORY_KEY` from `"x"` to the correct key — single-line
fix, no other code change needed.
</verification>

<success_criteria>
- `BTW_CLEAR_HISTORY_KEY = "x"` exported from claude-session-server.ts.
- `dismissBtw` function present with the two-call + 100ms shape; `sendEscapeToBtw` removed.
- Sole production caller (WS `aside_dismissed` handler) uses `dismissBtw`.
- New aside.test.ts describe block (5 tests) passes; pre-existing tests still pass.
- Integration test Test B asserts ordered two-call send-keys shape AND preserves the
  broadcastAsideDismissed BOTH-STEPS coverage.
- `grep -rn "sendEscapeToBtw" src/` returns zero matches.
- WS frame shape and frontend dismiss handler untouched.
</success_criteria>

<output>
Create `.planning/quick/260727-lbr-aside-dismiss-clears-btw-history/260727-lbr-SUMMARY.md` when done.
Summary should note the two-keystroke rationale, the 100ms-vs-200ms gap distinction
(dismiss = single-key presses, inject = paste), and the one-line-fix property of the
BTW_CLEAR_HISTORY_KEY constant for UAT.
</output>
