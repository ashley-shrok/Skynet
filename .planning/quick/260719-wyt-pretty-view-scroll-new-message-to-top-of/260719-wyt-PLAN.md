---
quick_id: 260719-wyt
patch_number: 88
type: execute
autonomous: false
files_modified:
  - src/ui/features/pretty-view/use-auto-scroll.ts
must_haves:
  truths:
    - "When Ashley is at bottom AND a new message TALLER than the scroll viewport is appended, the scroll container lands with the new message's top edge ~16px below the viewport top (so she reads from the start)."
    - "When Ashley is at bottom AND a new message that FITS in the viewport is appended, existing bottom-pin behavior is preserved (scrollTop = scrollHeight)."
    - "When Ashley has scrolled up (not pinned), NEITHER branch fires — no yank, in either the tall-message or short-message case."
    - "Streaming token deltas that grow the last message AFTER it was first appended do NOT re-fire the top-align — the top-align anchors exactly once at message-add."
    - "Non-message resize events (viewport shrink, Inter font swap, sidebar/drawer toggle) continue to re-pin to bottom when pinned — the existing RO behavior for viewport changes is untouched."
  artifacts:
    - path: "src/ui/features/pretty-view/use-auto-scroll.ts"
      provides: "useAutoScroll hook with new taller-than-viewport top-align branch on message-add"
      contains: "messageCount"
  key_links:
    - from: "src/ui/features/pretty-view/PrettyView.tsx"
      to: "useAutoScroll"
      via: "hook call — passes messages.length as the new message-count argument"
      pattern: "useAutoScroll\\("
---

<objective>
Fix pretty-view auto-follow so new messages taller than the scroll viewport land with their TOP edge just below the viewport top (16px offset), instead of the current bottom-pin behavior that dumps Ashley at the end of a long message. Messages that fit in the viewport keep the existing bottom-pin. Streaming deltas after message-add must NOT re-anchor.

Purpose: Ships as patch #88. Removes a repeated friction point (long assistant messages currently require scroll-up-to-read every time). Behavior-only, single file diff (~40-60 lines).

Output: Modified `src/ui/features/pretty-view/use-auto-scroll.ts` with a new message-add trigger + tall-message top-align branch; `PrettyView.tsx` call-site updated to pass `messages.length`. No other files touched.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/PROJECT.md

# Existing implementation being modified (Phase 1 Plan 3 / RENDER-03):
@src/ui/features/pretty-view/use-auto-scroll.ts

# Consumer of the hook — call site needs one argument added:
@src/ui/features/pretty-view/PrettyView.tsx

# Phase 1 Plan 3 SUMMARY — original auto-scroll design rationale + wasPinnedRef pattern:
@.planning/phases/01-live-session-stream-to-browser-read-only-pretty-view/01-03-SUMMARY.md

# ChatMessage — reference for what "one message" is in the DOM:
# each ChatMessage renders one flex-row wrapper div; each ImageBubble likewise. They are
# direct children of the `contentEl` flex column (gap-[18px]), so
# `contentEl.lastElementChild` is always the most recently appended message wrapper.
@src/ui/features/pretty-view/ChatMessage.tsx
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add tall-message top-align branch to useAutoScroll on message-add</name>

  <read_first>
    - src/ui/features/pretty-view/use-auto-scroll.ts (the file being modified — read the entire file including the doc comment block that explains the ratchet + wasPinnedRef design; the new branch must compose with, not replace, that logic)
    - src/ui/features/pretty-view/PrettyView.tsx (the sole caller — see line 172 for the destructuring pattern and lines 511-529 for the contentEl layout; note that messages are direct children of contentEl with `flex flex-col gap-[18px]`)
    - src/ui/features/pretty-view/ChatMessage.tsx (each message renders as a `<div className="flex ...">` wrapper — that wrapper IS `contentEl.lastElementChild` after append)
    - .planning/phases/01-live-session-stream-to-browser-read-only-pretty-view/01-03-SUMMARY.md (RENDER-03 provenance; note the "capture-before-setState" pattern and the 16px bottom-tolerance that is REUSED as the top-align offset for visual consistency)
  </read_first>

  <files>
    src/ui/features/pretty-view/use-auto-scroll.ts
    src/ui/features/pretty-view/PrettyView.tsx
  </files>

  <action>
    Modify `useAutoScroll` in `src/ui/features/pretty-view/use-auto-scroll.ts` to accept a `messageCount: number` argument and add a message-add trigger that top-aligns tall new messages. Concrete changes:

    1. **Hook signature change** — change `export function useAutoScroll()` to `export function useAutoScroll(messageCount: number)`. Update the JSDoc block above the export to document the new argument: "Pass the current messages array length; the hook uses the transition (prev < current) as the 'new message appended' trigger for the tall-message top-align branch. Growth of an existing message (streaming token deltas) does NOT change this number, so it does NOT re-anchor."

    2. **Add a `prevMessageCountRef`** initialized to `useRef<number>(0)` alongside the existing `lastScrollTopRef` and `isPinnedRef`.

    3. **Add a new `useEffect` keyed on `[scrollEl, contentEl, messageCount]`** that implements the message-add anchor. Structure:

       ```
       - Early return if scrollEl == null || contentEl == null.
       - Read prev = prevMessageCountRef.current; ALWAYS update the ref to messageCount before the next early-return, so the ref stays in sync even when we do not anchor.
       - If messageCount <= prev: return (no new message; this covers streaming grows, initial mount with 0, and the reset path in PrettyView that sets messages back to []).
       - If !isPinnedRef.current: return (user has scrolled up — leave them alone, matching the existing gate).
       - Read newEl = contentEl.lastElementChild as HTMLElement | null. If newEl == null: return (defensive; contentEl may be momentarily empty during a StrictMode double-invoke).
       - Compute const messageHeight = newEl.offsetHeight; const viewportHeight = scrollEl.clientHeight.
       - If messageHeight > viewportHeight: perform TOP-ALIGN — `scrollEl.scrollTop = newEl.offsetTop - 16`. Do NOT touch isPinnedRef/isPinnedToBottom here; the natural scroll-event handler will detect the upward jump (currentScrollTop < lastScrollTopRef.current) and flip the pin OFF via its existing ratchet, which is exactly what we want — subsequent streaming deltas into this same message must NOT re-anchor.
       - Else: return WITHOUT scrolling. The existing ResizeObserver-driven bottom-pin will fire on the append's content growth and land at scrollHeight, preserving current short-message behavior.
       ```

       The `newEl.offsetTop - 16` value uses the existing `BOTTOM_TOLERANCE_PX = 16` constant for the offset — rename mental model to "SCROLL_MARGIN_PX" but reuse the SAME `BOTTOM_TOLERANCE_PX` symbol (do not introduce a second 16-constant; the value semantically matches).

    4. **Do NOT modify** the existing `scroll` event handler ratchet, the existing `ResizeObserver` effect, the `scrollToBottom` callback, or the return shape. All existing behavior for viewport-shrink / font-swap / bottom-pin on short messages remains.

    5. **Update the sole caller** in `src/ui/features/pretty-view/PrettyView.tsx` (line 172-173) — change `useAutoScroll()` to `useAutoScroll(messages.length)`. This is the only call site (grep confirms).

    6. **Comment discipline** — add an inline block comment above the new effect explaining:
       - Why this belongs in the hook (not in PrettyView): the messageCount transition is the SIGNAL that distinguishes "new message appended" from "existing message grew" (streaming), and the RO alone cannot distinguish these.
       - Why the ratchet in the scroll handler correctly flips pin OFF after top-align (no explicit `isPinnedRef.current = false` needed here).
       - Why we DO NOT `newEl.scrollIntoView({block: "start"})`: scrollIntoView scrolls the nearest scrollable ANCESTOR — in nested-scroll layouts (parent tab pane can also scroll on very narrow viewports) this can jump the wrong container. Direct `scrollEl.scrollTop = ...` is unambiguous.
       - Why we use `offsetTop` (not `getBoundingClientRect`): `offsetTop` is relative to the offsetParent, and the scroll container IS the offsetParent for direct children of `contentEl` when `contentEl` has no positioning of its own. If the check fails in practice (e.g. if a future patch adds `relative` to contentEl), fall back to `newEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop`. Do NOT add the fallback preemptively — verify the `offsetTop` path first.

    Do NOT: introduce smooth-scroll animation, add a user-facing toggle, change the at-bottom detection heuristic, alter `BOTTOM_TOLERANCE_PX`, split the effect across multiple hooks, use `requestAnimationFrame` (the effect runs after paint, layout is settled), or add a "MutationObserver" (messageCount + effect is sufficient and cheaper).

    Compile and typecheck: `npx tsc --noEmit -p tsconfig.app.json` — total error line count must not increase. Existing pre-plan baseline errors in unrelated files are pre-existing and unchanged.
  </action>

  <verify>
    <automated>cd /home/ubuntu/termix &amp;&amp; npx tsc --noEmit -p tsconfig.app.json 2>&amp;1 | grep -E 'pretty-view|use-auto-scroll' | wc -l</automated>
  </verify>

  <acceptance_criteria>
    **Source assertions (grep-verifiable):**
    1. `grep -c "messageCount" src/ui/features/pretty-view/use-auto-scroll.ts` returns >= 3 (parameter + ref-read + ref-write inside the new effect).
    2. `grep -c "prevMessageCountRef" src/ui/features/pretty-view/use-auto-scroll.ts` returns >= 3 (declaration + read + write).
    3. `grep "useAutoScroll(messages.length)" src/ui/features/pretty-view/PrettyView.tsx` matches exactly one line.
    4. `grep -c "useAutoScroll()" src/ui/features/pretty-view/PrettyView.tsx` returns 0 (old no-arg call must be gone).
    5. `grep "offsetTop" src/ui/features/pretty-view/use-auto-scroll.ts` matches at least one line and appears in an expression subtracting 16 (or `BOTTOM_TOLERANCE_PX`).
    6. `grep -E "scrollTop = .*offsetTop.*- (16|BOTTOM_TOLERANCE_PX)" src/ui/features/pretty-view/use-auto-scroll.ts` matches exactly one line — the top-align assignment.
    7. `grep -c "scrollIntoView" src/ui/features/pretty-view/use-auto-scroll.ts` returns 0 (per action: direct scrollTop only).
    8. `grep -c "behavior:" src/ui/features/pretty-view/use-auto-scroll.ts` returns 0 (per action: no smooth-scroll — this also prevents `behavior: "smooth"` slipping in).
    9. `grep -c "MutationObserver" src/ui/features/pretty-view/use-auto-scroll.ts` returns 0 (per action: not needed).
    10. `grep -c "clientHeight" src/ui/features/pretty-view/use-auto-scroll.ts` returns >= 2 (the existing near-bottom check + the new viewport-height compare).
    11. The `BOTTOM_TOLERANCE_PX` constant remains defined exactly once and still has the value `16`: `grep -c "const BOTTOM_TOLERANCE_PX = 16" src/ui/features/pretty-view/use-auto-scroll.ts` returns 1.
    12. Existing return-shape symbols still exported: `grep -c "scrollRef" src/ui/features/pretty-view/use-auto-scroll.ts` >= 3, `grep -c "contentRef" ...` >= 3, `grep -c "scrollToBottom" ...` >= 2, `grep -c "isPinnedToBottom" ...` >= 2.

    **Typecheck assertion:**
    13. `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E 'pretty-view|use-auto-scroll'` returns 0 lines (no new type errors introduced by this file or its caller).

    **Structural assertions (read the file to confirm):**
    14. The new effect's dependency array is exactly `[scrollEl, contentEl, messageCount]` (no missing deps, no extraneous deps).
    15. Inside the new effect, `prevMessageCountRef.current = messageCount` executes BEFORE any early-return that follows the initial null-check + prev-read (otherwise a stream-of-messages arriving while unpinned would forever lag the ref by one).
    16. The tall-message branch does NOT assign to `isPinnedRef.current` or call `setIsPinnedToBottom` — the ratchet in the existing scroll handler handles the flip naturally when the browser fires the scroll event from our `scrollTop` write.

    **Behavior assertions (manual verification, checkpoint task):**
    17. When Ashley is pinned to bottom and an assistant message with rendered height > viewport height appears, `container.scrollTop` equals `messageEl.offsetTop - 16` within one paint frame; her viewport shows the TOP of the new message.
    18. When Ashley is pinned to bottom and a short user message ("go ahead") appears, `container.scrollTop` equals `container.scrollHeight` (current behavior, unchanged).
    19. Streaming token deltas into the already-anchored tall message do NOT re-fire the top-align (scroll position stays wherever Ashley last put it — either the initial top-align landing or wherever she has manually scrolled since).
    20. When Ashley has scrolled up before a tall message arrives, the tall message does NOT top-align — no scroll change occurs (she keeps reading whatever she was on).
  </acceptance_criteria>

  <done>
    - `use-auto-scroll.ts` accepts `messageCount: number`, tracks it via `prevMessageCountRef`, and top-aligns the last child (with 16px margin) when a NEW message is appended AND the user was pinned AND the message's `offsetHeight` exceeds the container's `clientHeight`.
    - Short new messages still bottom-pin (existing RO handles it — new branch returns without scrolling).
    - Streaming grows of an existing message do NOT re-anchor (messageCount unchanged → effect early-returns).
    - Unpinned users are never yanked (isPinnedRef gate).
    - `PrettyView.tsx` calls `useAutoScroll(messages.length)` — the only wiring change in that file.
    - `npx tsc --noEmit -p tsconfig.app.json` produces zero errors in pretty-view files.
    - All grep-based acceptance criteria pass.
    - Diff is limited to `src/ui/features/pretty-view/use-auto-scroll.ts` and `src/ui/features/pretty-view/PrettyView.tsx` — no other files touched. `git diff --name-only` after commit shows exactly these two files.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Ashley live-verifies the tall-message top-align in a running dev build</name>

  <what-built>
    A new branch inside `useAutoScroll` that, on message-add (and only on message-add — not on streaming grow), checks whether the newly appended message is taller than the scroll viewport. If yes AND the user was pinned to bottom, it sets `scrollTop = messageEl.offsetTop - 16` so the top of the new message sits 16px below the viewport top. If no (short message) OR user was scrolled up, existing behavior applies unchanged.
  </what-built>

  <how-to-verify>
    Since this fork's deploy discipline requires the 15-min deadman rollback per Ashley's rule (see PROJECT.md), do NOT build or deploy for this checkpoint — Ashley verifies in her own dev environment when ready. She may choose to defer verification until the next natural pin/deploy window.

    Verification steps (Ashley runs when she chooses):

    1. **Baseline capture** — before applying the patch, in a pretty-view pane with an active Claude session: scroll to bottom, prompt Claude with a request that produces a LONG response (e.g. "explain how React reconciliation works in detail with examples"). Confirm the current broken behavior: viewport lands at the END of the message.

    2. **After patch (dev build or built docker)** — same prompt, same starting position (scrolled to bottom). Expected: viewport lands with the TOP of Claude's response visible, offset ~16px from the viewport top. Ashley can read from the beginning without scrolling up.

    3. **Streaming discipline test** — while the long response is still streaming (tokens actively arriving), Ashley should NOT see the viewport re-jump each token. Whatever position she is at (initial top-align, or manually scrolled) is preserved through the streaming deltas.

    4. **Short-message regression test** — scroll to bottom, send a short message like "go ahead" (thumbs-up quick-send). Expected: viewport bottom-pins to the new message as before — no top-align kicks in for the short message.

    5. **Scrolled-up gate test** — scroll UP into history (so `isPinnedToBottom` = false, jump-to-latest pill visible). Have Claude produce another long response. Expected: NO scroll change — Ashley stays where she was reading. This tests the isPinnedRef gate is honored by the new branch.

    6. **Viewport-shrink regression test** — while pinned to bottom, open the message-queue drawer (or otherwise shrink the pretty-view height). Expected: bottom-pin is preserved (existing ResizeObserver behavior untouched).

    All six checks should pass. If check 3 fails (viewport jumps on streaming deltas), the messageCount discrimination is wrong. If check 4 fails (short messages top-align instead of bottom-pin), the `messageHeight > viewportHeight` gate is inverted. If check 5 fails (scrolled-up user gets yanked), the isPinnedRef gate is missing from the new branch.
  </how-to-verify>

  <resume-signal>Type "approved" once behavior matches expectations across all six checks, or describe the specific failing check for a follow-up fix.</resume-signal>
</task>

</tasks>

<verification>
  Plan-level checks (run after Task 1 commit, before Task 2 checkpoint):

  - `git diff --name-only HEAD~1` produces exactly two lines: `src/ui/features/pretty-view/use-auto-scroll.ts` and `src/ui/features/pretty-view/PrettyView.tsx`.
  - `git diff HEAD~1 --stat src/ui/features/pretty-view/use-auto-scroll.ts` shows an added-lines count in the 25-50 range (the new effect + ref + doc comment; if >70 lines the effect probably got over-engineered, if <15 lines it probably skipped required doc comments).
  - `git diff HEAD~1 --stat src/ui/features/pretty-view/PrettyView.tsx` shows exactly 1 line changed (the `useAutoScroll(messages.length)` call).
  - No changes to `Terminal.tsx`, backend files, nginx configs, docker compose, or `package.json` — this is a frontend behavior patch, no wiring surface.
  - `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -cE 'pretty-view|use-auto-scroll'` returns 0.
  - `grep -rn "useAutoScroll" src/ 2>/dev/null` still returns exactly two lines: the hook export in `use-auto-scroll.ts` and the call in `PrettyView.tsx`. No other consumer sprang up.

  Non-goal enforcement (grep-verifiable):
  - `grep -c "smooth" src/ui/features/pretty-view/use-auto-scroll.ts` returns 0.
  - `grep -c "aria-pressed\|role=\"switch\"\|toggle" src/ui/features/pretty-view/use-auto-scroll.ts src/ui/features/pretty-view/PrettyView.tsx` — no user-facing toggle added.
  - The at-bottom detection heuristic (`distance <= BOTTOM_TOLERANCE_PX`, `userScrolledUp` ratchet) is UNCHANGED — `git diff HEAD~1 src/ui/features/pretty-view/use-auto-scroll.ts` shows the `updatePinned` function body as untouched.
</verification>

<success_criteria>
- Patch #88 slot-ready: commit exists on `feat/tab-title-from-tmux`, diff limited to the two frontend files above, no build/deploy attempted (Ashley's per-deploy green-light discipline — see STATE.md line 30).
- `useAutoScroll` accepts `messageCount: number` and top-aligns tall new messages with 16px margin ONLY when: (a) messageCount increased since last effect run, (b) `isPinnedRef.current` was true, (c) `newEl.offsetHeight > scrollEl.clientHeight`.
- All other useAutoScroll behavior — scroll-event ratchet, ResizeObserver-driven bottom-pin, `scrollToBottom` imperative call, `isPinnedToBottom` state — is byte-for-byte preserved.
- Streaming discipline: token deltas into an already-anchored message do NOT re-trigger any scroll — messageCount is unchanged by within-message growth, so the effect early-returns.
- Task 2 checkpoint receives Ashley's "approved" (or explicit deferral for a later deploy window).
</success_criteria>

<output>
Create `.planning/quick/260719-wyt-pretty-view-scroll-new-message-to-top-of/260719-wyt-SUMMARY.md` when done.
</output>
