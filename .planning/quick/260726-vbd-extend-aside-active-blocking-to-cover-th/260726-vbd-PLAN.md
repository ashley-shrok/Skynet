---
phase: quick-260726-vbd
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/backend/claude-session/claude-session-server.ts
  - src/backend/claude-session/claude-session-server.aside.test.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "Submitting a message that starts with /btw immediately disables the ComposeBox aux buttons and morphs the send button into the X/Resume affordance (same visual state as when an aside is already displayed)."
    - "The X/Resume button in the compose-box aside-active state, when clicked during the GENERATION window (after /btw submit, before aside_ready), sends Escape via the existing dismiss path and returns the compose box to normal (send-mode)."
    - "When aside_ready arrives after a /btw submit, the aside-active state persists (ComposeBox stays in dismiss-mode); the transition from pending -> displayed is invisible to the user."
    - "When the user submits a non-/btw message, the ComposeBox behaves exactly as before (no aside-pending flip, no button morph)."
    - "The /btw prompt text injected into tmux contains the word `concisely` so Claude's aside answer stays short."
    - "If /btw is submitted but aside_ready never arrives, the aside-pending flag clears itself after a 60s safety timeout so the ComposeBox is not permanently stuck."
  artifacts:
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "asidePending state + widened isAsideActive predicate + onSend wrapper that detects /btw + 60s safety timeout"
      contains: "asidePending"
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "BTW_PROMPT literal with the word `concisely` inserted into the instruction"
      contains: "concisely"
    - path: "src/backend/claude-session/claude-session-server.aside.test.ts"
      provides: "byte-for-byte BTW_PROMPT assertion updated to match the new literal"
      contains: "concisely"
  key_links:
    - from: "src/ui/features/pretty-view/PrettyView.tsx (ComposeBox mount)"
      to: "ComposeBox asideActive prop"
      via: "asideText !== null || asidePending"
      pattern: "asideActive=\\{"
    - from: "src/ui/features/pretty-view/PrettyView.tsx (onSend wrapper)"
      to: "asidePending setter"
      via: "if trimmed starts with /btw -> setAsidePending(true) + start 60s timer"
      pattern: "startsWith\\(['\"]\\/btw"
    - from: "src/ui/features/pretty-view/PrettyView.tsx (handleAsideDismiss)"
      to: "asidePending setter"
      via: "clears both asideText and asidePending; also cancels the 60s timer"
      pattern: "setAsidePending\\(false\\)"
    - from: "src/ui/features/pretty-view/PrettyView.tsx (aside_ready case)"
      to: "asidePending setter"
      via: "aside_ready arrival transitions pending -> displayed; clears pending flag and 60s timer"
      pattern: "setAsidePending\\(false\\)"
---

<objective>
Widen the aside-active blocking window in the pretty-view compose box to
cover the GENERATION phase (from `/btw` submit through `aside_ready`
arrival) in addition to the currently-blocked DISPLAY phase (post-
`aside_ready`, pre-dismiss). Same UI mechanism (ComposeBox aux-buttons
disabled + send button morphs to X/Resume + click sends Escape via the
existing dismiss path) — just extend the predicate that decides "is the
aside active right now?".

Also: insert the word `concisely` into the `/btw` prompt literal injected
into tmux so Claude's aside answers stay short.

Purpose: Prevents Ashley from sending unrelated input into the terminal
during the ~seconds-to-minute window between `/btw` submit and answer
arrival. That input would collide with Claude Code's in-flight aside
handling. Same underlying `sendKeys(Escape)` primitive works to cancel
in-flight generation or clear a displayed aside, so a single button +
handler suffices — only the "when is aside active?" predicate needs to
widen.

Output:
- src/ui/features/pretty-view/PrettyView.tsx (additive: asidePending
  state + 60s timer ref + onSend wrapper + widened `asideActive` prop
  + unified clear-both in handleAsideDismiss and aside_ready handler)
- src/backend/claude-session/claude-session-server.ts (BTW_PROMPT
  literal: insert `concisely` into the instruction, preserving the
  U+2014 em-dash and the `/btw ` slash-command prefix)
- src/backend/claude-session/claude-session-server.aside.test.ts
  (byte-for-byte assertion updated to match the new literal — the test
  intentionally asserts on the exact string, so it MUST move with the
  string)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/ui/features/pretty-view/PrettyView.tsx
@src/ui/features/pretty-view/ComposeBox.tsx
@src/backend/claude-session/claude-session-server.ts
@src/backend/claude-session/claude-session-server.aside.test.ts
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Widen aside-active predicate in PrettyView to cover the /btw generation window</name>
  <files>src/ui/features/pretty-view/PrettyView.tsx</files>
  <behavior>
    - When the user submits a message whose trimmed body starts with `/btw`
      (case-sensitive, matching the backend BTW_PROMPT prefix — the
      slash-command is `/btw` verbatim), the pretty-view flips an
      `asidePending` flag to true synchronously in the onSend path,
      BEFORE the outer parent onSend call returns.
    - Widen the value passed to ComposeBox as `asideActive`: instead of
      `asideText !== null`, pass `asideText !== null || asidePending`.
      Use a memoized/named local (e.g. `isAsideActive`) if it clarifies
      the site.
    - `asidePending` clears on any of these three legitimate paths:
      (a) `aside_ready` WS message arrives — the display state takes
          over, so `setAsidePending(false)` runs in the same case-block
          that runs `setAsideText(parsed.text)`.
      (b) `handleAsideDismiss` runs (X/Resume click) — clear
          `asidePending` alongside the existing `setAsideText(null)`
          optimistic clear. This makes the button work identically
          whether the aside is pending or displayed.
      (c) 60s safety timeout fires without any legitimate clear — a
          simple `setTimeout` stored in a `useRef<ReturnType<typeof
          setTimeout> | null>` armed when `/btw` is detected and cleared
          on any of the three legitimate paths above (a/b/c themselves).
    - The 60s safety timeout is belt-and-suspenders for the failure mode
      where injectBtw succeeded but the poller never extracted an
      answer (e.g. Claude Code died mid-answer). Keep it simple: one
      ref, one setTimeout, one clearTimeout, no exponential-backoff or
      retry. When it fires it just calls `setAsidePending(false)`; it
      does NOT try to broadcast anything to the backend.
    - Cleanup: the timeout ref MUST be cleared in the component-unmount
      cleanup of a suitable existing useEffect (or a dedicated cleanup
      effect) so unmounting during the pending window does not leak.
  </behavior>
  <action>
    Edit src/ui/features/pretty-view/PrettyView.tsx. Changes are all
    ADDITIVE except the single `asideActive={...}` prop line which
    swaps its expression. Approach:

    (1) Add near the existing `asideText` useState (around line 209):
        - `const [asidePending, setAsidePending] = useState(false);`
        - `const asidePendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);`
        Add a comment block explaining WHY (per this plan's
        <objective>): generation-window blocking parity with display-
        window blocking, single Escape-based dismiss primitive works
        for both phases, 60s safety timeout for the "aside_ready never
        arrives" failure mode.

    (2) Add a helper `clearAsidePending` (useCallback) that does BOTH:
        - `setAsidePending(false)`
        - if `asidePendingTimerRef.current` is non-null, `clearTimeout`
          it and null the ref.
        This is the single clear-primitive used by paths (a) and (b);
        the timeout callback (c) also calls it so the ref is nulled
        after self-fire.

    (3) In `handleAsideDismiss` (around line 277), add a call to
        `clearAsidePending()` alongside the existing
        `setAsideText(null)`. The dismiss button now works from either
        the pending OR the displayed phase — same Escape-into-tmux
        payload closes an in-flight /btw or a displayed one.

    (4) In the WS message handler `aside_ready` case (around line 511),
        add `clearAsidePending()` alongside `setAsideText(parsed.text)`
        so the pending->displayed transition is atomic. In the
        `aside_dismissed` case (around line 524), also call
        `clearAsidePending()` — the backend can broadcast dismissed
        without this client having sent it (peer-tab dismiss OR
        marker-disappearance), and the pending flag should clear in
        that path too. In `session_changed` (around line 545, after
        setPlanPending(null)), also call clearAsidePending() — a fresh
        pane starts with no in-flight aside.

    (5) Wrap the `onSend` prop before passing to ComposeBox. Create a
        `useCallback` (e.g. `handleComposeSend`) that:
        - Reads the incoming `text` payload.
        - Checks `text.trim().startsWith('/btw ') || text.trim() === '/btw'`
          (space or exact match — `/btwXYZ` is NOT the aside slash-
          command, but `/btw` alone or `/btw foo` are).
        - If the check passes: call `setAsidePending(true)`, clear any
          existing `asidePendingTimerRef.current` first, then start a
          new `setTimeout(() => { asidePendingTimerRef.current = null;
          setAsidePending(false); }, 60000)` and store the handle in
          the ref.
        - Then always call `onSend(text)` and return its boolean result
          unchanged. Do NOT gate the outer onSend on the check — the
          send itself still needs to fire (that IS what triggers the
          aside).
        - Note: this deliberately arms the pending flag EVEN IF onSend
          returns false. Rationale: if the WS is not open, ComposeBox
          shows an inline error and no /btw actually got sent; the 60s
          timeout will clear the false alarm. This is simpler than
          conditionally arming based on the dispatched boolean and the
          user experience is: the button briefly morphs, error message
          renders, user sees the false-alarm state clear after 60s (or
          they click X/Resume to clear immediately, since the same
          button works there too — sending Escape into a pane that
          received no /btw is a no-op).

    (6) Update the `<ComposeBox ...>` mount site (around line 1101):
        - Replace `asideActive={asideText !== null}` with
          `asideActive={asideText !== null || asidePending}`
          (or extract to a `const isAsideActive = asideText !== null
          || asidePending;` and use that — either is fine, prefer
          extraction if it reads cleaner given the surrounding JSX).
        - Replace `onSend={onSend}` with `onSend={handleComposeSend}`.
        - Leave `onAsideDismiss={handleAsideDismiss}` unchanged; the
          dismiss handler now clears both flags via step (3).

    (7) Add unmount cleanup: extend an existing effect's cleanup OR add
        a small effect `useEffect(() => () => { if
        (asidePendingTimerRef.current) clearTimeout(
        asidePendingTimerRef.current); }, []);` so pending timers do
        not leak on component unmount.

    Do NOT touch: ComposeBox.tsx (its aside-active consumption is
    already correct — it just needs a wider `asideActive` value from
    the parent), any other file, or any of the aside test files
    besides the BTW_PROMPT-literal test updated in Task 2.

    Do NOT change the 8s `dismissCooldownUntilRef` value or logic —
    that is orthogonal (dismiss->settle->isIdle bounce loop guard) and
    stays exactly as landed in commit 34cfeec.

    Do NOT strip or touch the `aside poll diag:` logs in
    claude-session-server.ts — separate followup pending Ashley's
    cooldown UAT.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npm run -s test -- --run src/ui/features/pretty-view/PrettyView.aside.test.tsx src/ui/features/pretty-view/ComposeBox.aside-morph.test.tsx src/ui/features/pretty-view/ComposeBox.aside-props.test.tsx src/ui/features/pretty-view/ComposeBox.test.tsx src/ui/features/pretty-view/PrettyView.test.tsx</automated>
  </verify>
  <done>
    - PrettyView.tsx: `asidePending` state + `asidePendingTimerRef`
      declared alongside `asideText` with an explanatory comment.
    - `clearAsidePending` (or equivalent inline pattern) called from
      handleAsideDismiss, aside_ready case, aside_dismissed case, and
      session_changed case.
    - `handleComposeSend` wraps onSend, detects `/btw` prefix, arms
      asidePending + the 60s safety timer, then delegates to onSend
      and returns its boolean result unchanged.
    - ComposeBox mount uses widened `asideActive` prop AND the wrapped
      onSend callback.
    - Existing test suites listed in <verify> pass (PrettyView.aside,
      ComposeBox.aside-morph, ComposeBox.aside-props, ComposeBox base,
      PrettyView base).
    - Unmount cleanup clears the timer ref.
    - `grep -c 'asidePending' src/ui/features/pretty-view/PrettyView.tsx`
      returns at least 5 (declaration + setter uses in each of the
      four clear/set sites at minimum).
    - `grep -c 'aside poll diag:' src/backend/claude-session/claude-session-server.ts`
      is UNCHANGED from pre-plan value (diag logs untouched).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Insert `concisely` into the BTW_PROMPT literal and update its byte-for-byte test assertion</name>
  <files>src/backend/claude-session/claude-session-server.ts, src/backend/claude-session/claude-session-server.aside.test.ts</files>
  <behavior>
    - The BTW_PROMPT string exported from claude-session-server.ts still
      starts with the exact `/btw ` slash-command prefix and still
      contains a real U+2014 em-dash (both invariants are asserted in
      the aside.test.ts unit tests and MUST continue to pass).
    - The word `concisely` appears once in the prompt, positioned so
      Claude interprets it as a modifier on the answer-length
      instruction — natural insertion into the existing sentence, not
      a bolted-on suffix.
    - The byte-for-byte test in claude-session-server.aside.test.ts
      (the `.toBe(...)` assertion on BTW_PROMPT) updates to match the
      new literal EXACTLY — same string in test file as in source file.
    - The em-dash and prefix invariant tests still pass unmodified.
    - The integration test's `tmux send-keys ... '${BTW_PROMPT}' Enter`
      call sites need no update (they interpolate the exported const,
      so they automatically use the new value).
  </behavior>
  <action>
    Edit src/backend/claude-session/claude-session-server.ts line 123.

    Current literal (line 122-123):
      export const BTW_PROMPT =
        "/btw Re-explain whatever's currently going on to me without using code symbols, in a conceptual model style. Not a metaphor — explain the actual thing, don't recast it as an extended analogy.";

    Change to insert `concisely` naturally. Preferred insertion point:
    after "Re-explain" so the instruction reads "Re-explain concisely
    whatever's currently going on..." — adverb modifies the verb
    directly, minimally disruptive to the existing sentence rhythm,
    preserves all other tokens byte-for-byte including the U+2014
    em-dash and the trailing period.

    New literal:
      export const BTW_PROMPT =
        "/btw Re-explain concisely whatever's currently going on to me without using code symbols, in a conceptual model style. Not a metaphor — explain the actual thing, don't recast it as an extended analogy.";

    Then edit src/backend/claude-session/claude-session-server.aside.test.ts
    line ~46-52. Find the test:
      it("BTW_PROMPT is the EXACT literal from CONTEXT.md § Injection (character-for-character)", () => {
        expect(BTW_PROMPT).toBe(
          "/btw Re-explain whatever's currently going on to me without using code symbols, in a conceptual model style. Not a metaphor — explain the actual thing, don't recast it as an extended analogy.",
        );

    Update the expected string inside `.toBe(...)` to match the new
    literal EXACTLY (same insertion of `concisely` after `Re-explain`).
    The test's descriptive name mentions "CONTEXT.md § Injection" —
    that is fine to leave as-is for this quick task; CONTEXT.md is the
    aside subsystem's authoring spec and the divergence between it and
    the new literal is a known-and-accepted quick-task drift (this
    plan is a quick task, not a phase revision). If a followup wants
    to update the test's descriptive name to reflect that CONTEXT.md
    is no longer the byte-for-byte source, that is out of scope here.

    Do NOT touch:
    - The em-dash test (`it("BTW_PROMPT contains a real U+2014 em-dash
      ...")`) — still passes because the em-dash is preserved.
    - The `/btw ` prefix test (`it("BTW_PROMPT starts with the exact
      \`/btw \` slash-command prefix ...")`) — still passes because
      the prefix is preserved.
    - The integration test's BTW_PROMPT interpolations — they read the
      exported const, so they pick up the new value automatically.
    - injectBtw or any other function — behavior is unchanged.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npm run -s test -- --run src/backend/claude-session/claude-session-server.aside.test.ts src/backend/claude-session/claude-session-server.aside.integration.test.ts</automated>
  </verify>
  <done>
    - BTW_PROMPT literal in claude-session-server.ts contains
      `concisely` positioned after `Re-explain`.
    - Byte-for-byte test in aside.test.ts asserts on the new literal
      and passes.
    - Em-dash test still passes (U+2014 preserved).
    - `/btw ` prefix test still passes (prefix preserved).
    - Integration test suite still passes (no code change, just picks
      up the new const value via existing imports).
    - `grep -c 'concisely' src/backend/claude-session/claude-session-server.ts`
      returns 1.
    - `grep -c 'concisely' src/backend/claude-session/claude-session-server.aside.test.ts`
      returns 1.
  </done>
</task>

</tasks>

<verification>
Run the full pretty-view + aside test surface after both tasks:

  cd /home/ubuntu/skynet && npm run -s test -- --run \
    src/ui/features/pretty-view/ \
    src/backend/claude-session/claude-session-server.aside.test.ts \
    src/backend/claude-session/claude-session-server.aside.integration.test.ts

All previously-passing suites should still pass (Task 1 is purely
additive to PrettyView aside-active predicate; Task 2 flips one string
constant and its matching test expectation).

Manual UAT (Ashley, post-deploy):
1. Open a pretty-view session with an identity attached (identity
   required — arm-emitter is identity-gated per ASIDE-02).
2. Type `/btw what is happening` in ComposeBox and click send.
3. Immediately observe the ComposeBox: aux buttons disabled, send
   button morphed to X/Resume — BEFORE the aside answer arrives.
4. Wait for the aside answer to appear. ComposeBox stays in the same
   morphed state (transition from pending -> displayed is invisible).
5. Verify the aside answer text is noticeably shorter than pre-patch
   (the `concisely` insert biases Claude toward brevity — this is a
   soft-verify, no strict assertion possible).
6. Click X/Resume. Aside dismisses, ComposeBox returns to normal.
7. Repeat but click X/Resume DURING the pending phase (before the
   answer arrives) — dismiss should also work (Escape into tmux
   cancels the in-flight /btw generation), ComposeBox returns to
   normal.
8. Type a regular non-/btw message and send — no morph, normal flow.
9. Optional pathological case: submit `/btw` when Claude is not
   actually going to answer (rare — hard to reproduce). Verify the
   ComposeBox self-recovers after ~60s.
</verification>

<success_criteria>
- Both task <verify> commands pass (full pretty-view + aside test
  suite green).
- `grep -c 'asidePending' src/ui/features/pretty-view/PrettyView.tsx`
  >= 5.
- `grep -c 'concisely'
  src/backend/claude-session/claude-session-server.ts` == 1.
- `grep -c 'concisely'
  src/backend/claude-session/claude-session-server.aside.test.ts` == 1.
- `grep -c 'aside poll diag:'
  src/backend/claude-session/claude-session-server.ts` is UNCHANGED
  from pre-plan value.
- Files modified list is exactly: PrettyView.tsx,
  claude-session-server.ts, claude-session-server.aside.test.ts. No
  other file touched.
- No new dependencies added (no package.json / lockfile change).
</success_criteria>

<output>
Write summary to:
  .planning/quick/260726-vbd-extend-aside-active-blocking-to-cover-th/260726-vbd-SUMMARY.md
</output>
