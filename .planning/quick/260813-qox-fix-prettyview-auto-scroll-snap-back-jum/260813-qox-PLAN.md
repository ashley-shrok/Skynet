---
phase: quick-260813-qox
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/use-auto-scroll.ts
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/PrettyView.virtualization.test.tsx
  - .planning/phases/32-redesign-pretty-view-auto-scroll-three-case-sticky-bottom-ho/32-CONTEXT.md
autonomous: true
requirements:
  - QOX-01  # Split Case 2 useEffect into new-message-signal effect + RO-pill-only effect
  - QOX-02  # Add messageCount parameter to useAutoScroll; update call site
  - QOX-03  # Update tests to trigger via message-append not RO fire; add negative-RO test
  - QOX-04  # Append "Post-ship correction (2026-08-13)" section to 32-CONTEXT.md

must_haves:
  truths:
    - "Sticky user at bottom + tall-bubble re-measure (RO fires with no new message) → scrollTop does NOT change"
    - "Sticky user at bottom + new message arrives → scrollTop jumps to bottom (follow-on-new behavior preserved)"
    - "User scrolled up + tall-bubble re-measure (RO fires) → scrollTop does NOT change; pill visibility updates only"
    - "User scrolled up + new message arrives → scrollTop does NOT change (implicit inverse preserved)"
    - "Session first load Case 1 rAF chain (paneKey-change useEffect) unchanged — still lands at bottom"
    - "User send Case 3 scrollToBottomAndFollow unchanged — still forces stick + jump + rAF re-arm"
    - "Full frontend suite green: npx vitest run exit 0, zero failures"
    - "Type check clean: npx tsc --noEmit exit 0"
  artifacts:
    - path: "src/ui/features/pretty-view/use-auto-scroll.ts"
      provides: "Split Case 2 into two effects; messageCount parameter added"
      contains: "messageCount"
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "Call site updated to useAutoScroll(paneKey, messages.length)"
      contains: "useAutoScroll(paneKey, messages.length)"
    - path: "src/ui/features/pretty-view/PrettyView.virtualization.test.tsx"
      provides: "Tests updated per Phase-32 → post-correction semantics; negative-RO test added"
    - path: ".planning/phases/32-redesign-pretty-view-auto-scroll-three-case-sticky-bottom-ho/32-CONTEXT.md"
      provides: "Post-ship correction (2026-08-13) section appended"
      contains: "Post-ship correction (2026-08-13)"
  key_links:
    - from: "src/ui/features/pretty-view/PrettyView.tsx"
      to: "src/ui/features/pretty-view/use-auto-scroll.ts"
      via: "useAutoScroll(paneKey, messages.length)"
      pattern: "useAutoScroll\\(paneKey,\\s*messages\\.length\\)"
    - from: "use-auto-scroll.ts new-message effect"
      to: "jumpToBottom(scrollEl)"
      via: "messageCount dependency array; runs on mount + every messageCount change if stickyRef.current"
      pattern: "messageCount"
    - from: "use-auto-scroll.ts retained RO effect"
      to: "setIsPinnedToBottom(dist <= BOTTOM_THRESHOLD)"
      via: "ONLY pill-visibility update; NO jumpToBottom call in RO callback"
      pattern: "setIsPinnedToBottom"
---

<objective>
Fix the PrettyView auto-scroll snap-back / jump on tall-bubble re-measure (Ashley report
2026-08-13: "if I try to scroll up, I get a little ways up before it either snaps back to
the bottom or jumps to a completely different area … and it seems to coincide with very
tall bubbles that are taller than the screen").

Purpose: The Phase 32 Case 2 ResizeObserver useEffect (use-auto-scroll.ts:136-166) conflates
two semantically-different events — "new message arrived" (jump-to-bottom desired) and
"existing bubble re-measured by TanStack Virtual" (jump-to-bottom NOT desired). Under
tall-bubble re-measure, sticky sessions snap back to bottom; even non-sticky iOS touch-scroll
sessions get filtered as measurement-adjustments (<20px deltas), leaving stickyRef=true so
the RO yanks scroll on the next re-measure. Structural fix (Ashley greenlit over a threshold
bump): split the effect into two — a new-message signal keyed on messageCount, and a
retained RO for pill-visibility only.

Output: use-auto-scroll.ts split into two effects; PrettyView.tsx call-site takes new
messageCount parameter; tests updated to trigger via message-append rather than RO fire;
new negative test proving no auto-jump on RO-only fire; 32-CONTEXT.md gets an append-only
"Post-ship correction (2026-08-13)" section explaining the fix while preserving all LOCKED
earlier invariants.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/ui/features/pretty-view/use-auto-scroll.ts
@src/ui/features/pretty-view/PrettyView.virtualization.test.tsx
@.planning/phases/32-redesign-pretty-view-auto-scroll-three-case-sticky-bottom-ho/32-CONTEXT.md
@.planning/phases/32-redesign-pretty-view-auto-scroll-three-case-sticky-bottom-ho/32-01-VERIFICATION-REPORT.md

# PrettyView.tsx is 693KB — do NOT read the whole file. Grep for `useAutoScroll(`
# to find the single call site around L685. `estimatePvBubbleSize` at ~L229 clarifies
# why re-measure fires (image bubbles estimate 400px but real height on wide viewports
# can exceed that). `messages` state at L270. Call-site edit is a single line.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Split Case 2 useEffect + add messageCount param + update PrettyView call site</name>
  <files>src/ui/features/pretty-view/use-auto-scroll.ts, src/ui/features/pretty-view/PrettyView.tsx</files>
  <behavior>
    - Hook signature: `useAutoScroll(paneKey: string, messageCount: number): UseAutoScrollResult`
    - New effect (jump-on-new-message): keyed on `[scrollEl, messageCount, jumpToBottom]`. On mount and every messageCount change, if `stickyRef.current` is true call `jumpToBottom(scrollEl)`. This is the ONLY jumpToBottom-from-arrival code path.
    - Retained RO effect: outer-container RO + per-child RO observation + MutationObserver for accessory mounts are ALL preserved. Callback body reduces to `setIsPinnedToBottom(dist <= BOTTOM_THRESHOLD)` unconditionally — no `stickyRef.current ? jumpToBottom : setPill()` branch, no `shrunk`/`prevScrollHeightRef` guard (both existed only to gate the jumpToBottom call, which moves out).
    - Delete `prevScrollHeightRef` (unused after RO callback simplification).
    - Case 1 paneKey-change rAF chain (L96-114 in current file): byte-preserved.
    - Case 3 `scrollToBottomAndFollow` (L208-221): byte-preserved.
    - Single scroll listener (L172-203): byte-preserved. `programmaticRef` gate + `MEASUREMENT_DELTA_IGNORE_PX < 20` guard both stay.
    - No wheel/keydown/touchmove listeners added. No `loadLockUntilRef`. No `contentRef` export. No `forceStickAndJump` export. No inline `overflow-anchor` write. `BOTTOM_THRESHOLD = 100`, `STICK_ARM_MS = 150`: unchanged.
    - PrettyView.tsx call site at ~L685: change `useAutoScroll(paneKey)` → `useAutoScroll(paneKey, messages.length)`. `messages` state is defined at L270; call site is inside the same component after paneKey (L682) — no scope issues.
    - Module-level comment block (L3-49) updated: "Case 2" now describes "new messages via messageCount prop"; add a one-line note explaining why the RO stays (pill visibility on any content growth or user-driven scrollHeight change while non-sticky). Keep the Phase 32 CONTEXT.md reference AND the "Deliberately NOT here" section intact.
  </behavior>
  <action>
    Edit `src/ui/features/pretty-view/use-auto-scroll.ts`:
    (a) Update `useAutoScroll` signature at L68 to `export function useAutoScroll(paneKey: string, messageCount: number): UseAutoScrollResult`.
    (b) Remove `const prevScrollHeightRef = useRef&lt;number&gt;(0);` at L79.
    (c) Replace the single Case 2 useEffect (L136-166) with TWO effects placed in the same slot (comment prose updated):
        - Effect A (new-message jump): deps `[scrollEl, messageCount, jumpToBottom]`. Body: `if (!scrollEl) return; if (stickyRef.current) jumpToBottom(scrollEl);` — no cleanup. This intentionally fires on mount (initial messageCount value) even when messageCount is 0; the Case 1 paneKey effect already handles session-first-load stickying so this is a harmless second nudge in that case.
        - Effect B (RO pill-visibility): deps `[scrollEl]` (no jumpToBottom dep — callback no longer calls it). Preserve outer `ro.observe(scrollEl)` + child-loop `for (const child of Array.from(scrollEl.children)) ro.observe(child);` + MutationObserver for `childList` on scrollEl adding new-child observation. Callback body: `const dist = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight; setIsPinnedToBottom(dist &lt;= BOTTOM_THRESHOLD);` (drop the branch, drop `shrunk`, drop `prevScrollHeightRef` read/write).
    (d) Rewrite the module-level comment block (L3-49) to reflect the new semantics. Update the Case 2 bullet (currently L15-20) to: "New messages while at bottom → new-message useEffect keyed on `messageCount`; if sticky, jump to bottom. Semantic separation from re-measure — the RO no longer writes scrollTop." Add a paragraph explaining the retained RO: "Case 2b — pill-visibility RO. The outer-container + per-child RO + MutationObserver-for-new-children machinery is retained because pill visibility must reflect ANY scrollHeight change while non-sticky (tall-bubble re-measure grows scrollHeight → pill should still show 'jump to bottom' correctly). But the RO callback ONLY writes `setIsPinnedToBottom(...)` — it NEVER calls jumpToBottom. That decoupling is the fix for 2026-08-13 (Ashley: 'snaps back to the bottom or jumps to a completely different area … coincides with very tall bubbles')." Keep the Phase 32 CONTEXT.md reference AND the "Deliberately NOT here" bullet list intact.

    Edit `src/ui/features/pretty-view/PrettyView.tsx` at L685: change `useAutoScroll(paneKey)` to `useAutoScroll(paneKey, messages.length)`. Grep-verify exactly ONE call site (confirmed pre-plan: L685 is the only match). No other PrettyView.tsx changes needed.

    Do NOT introduce any new refs, state, exports, or hook return-value fields. Do NOT touch backend files (grep-confirm none needed).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tiffany && npx tsc --noEmit 2>&amp;1 | tail -20 &amp;&amp; grep -c 'useAutoScroll(paneKey, messages.length)' src/ui/features/pretty-view/PrettyView.tsx &amp;&amp; grep -c 'prevScrollHeightRef' src/ui/features/pretty-view/use-auto-scroll.ts</automated>
  </verify>
  <done>
    - `npx tsc --noEmit` exits 0 with no errors.
    - `grep -c 'useAutoScroll(paneKey, messages.length)' src/ui/features/pretty-view/PrettyView.tsx` returns exactly 1.
    - `grep -c 'prevScrollHeightRef' src/ui/features/pretty-view/use-auto-scroll.ts` returns 0 (fully removed).
    - Hook body contains two distinct effects for Case 2 semantics: one keyed on `[scrollEl, messageCount, jumpToBottom]`, one keyed on `[scrollEl]` whose callback ONLY calls `setIsPinnedToBottom`.
    - `grep -v '^\s*//' src/ui/features/pretty-view/use-auto-scroll.ts | grep -c 'jumpToBottom(scrollEl)'` counts jumpToBottom call sites as EXACTLY 4: Case 1 tick body (1), Case 3 initial jump (1), Case 3 rAF re-arm tick body (1), NEW Case 2 new-message effect body (1). Zero jumpToBottom calls inside any RO callback.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Update virtualization tests + add negative-RO test + append CONTEXT.md correction + run full suite</name>
  <files>src/ui/features/pretty-view/PrettyView.virtualization.test.tsx, .planning/phases/32-redesign-pretty-view-auto-scroll-three-case-sticky-bottom-ho/32-CONTEXT.md</files>
  <behavior>
    - Test 2b ("incoming message while at bottom — follows"): currently drives the follow via `fireWsMessage(ws, {...})` THEN manually invoking `capturedROCallbacks`. Under the new semantics the RO callback no longer writes scrollTop — the follow is driven by the new-message useEffect firing when `messages.length` grows. Since `fireWsMessage` already appends a message (grows messages.length in the component's `setMessages` handler), the useEffect fires naturally on React commit. Remove the manual `capturedROCallbacks` loop — it's a no-op under the new semantics (setIsPinnedToBottom only). Add `act(() => { vi.advanceTimersByTime(50); });` after the fireWsMessage to let the useEffect's rAF-clear inside `jumpToBottom` settle. Final `expect(geom.getScrollTop()).toBe(5200)` assertion stays.
    - Test 3 ("incoming message while scrolled up — does NOT yank"): stays byte-mostly-unchanged. The critical assertion `expect(geom.getScrollTop()).toBe(1000)` holds under the new semantics because: user scrolls up flips `stickyRef=false` via scroll listener; new message arrives → new-message useEffect checks `stickyRef.current` (now false) → NO jump; RO fires → only sets pill visibility → NO jump. Remove the "Manually fire captured RO callbacks — proves the RO branch takes the !stickyRef path (no scrollTop write)" comment and the `capturedROCallbacks` loop since RO no longer has a scrollTop-writing branch to prove — but the loop firing is still harmless (setIsPinnedToBottom-only) so KEEP it if easier, just retitle the comment to "Fire RO — confirms pill-only path, no scrollTop write". Preferred: keep the loop, retitle the comment.
    - Test 2 ("session first load lands at bottom"): byte-preserved. Case 1 rAF chain is untouched.
    - Test 2d ("user send from scrolled-up state"): byte-preserved. Case 3 scrollToBottomAndFollow is untouched.
    - NEW Test 2c ("tall-bubble re-measure while sticky — does NOT jump; RO-only fire produces no scrollTop write"): mount + populate 20 msgs + let Case 1 chain settle (baseline sticky at 5000) + bump `geom.setScrollHeight(5800)` to simulate a tall-bubble re-measure (image decoded, real height > 400px estimate) WITHOUT firing a WS message frame + manually fire `capturedROCallbacks` (the RO would fire in a real browser on the scrollHeight growth) → assert `geom.getScrollTop() === 5000` (NO auto-jump). This test would have FAILED under the pre-fix Case 2 useEffect (it would have yanked to 5800); it PASSES under the split effects because no new message = no new-message useEffect fire, and RO callback is now setIsPinnedToBottom-only. The test also asserts `isPinnedToBottom` end-state via a data-testid or by checking the jump-to-bottom pill visibility — but PrettyView renders the pill conditionally via `!isPinnedToBottom && messages.length > 0` at L2365; presence of `[role="button"]` with pill copy is a proxy. Simplest: at scrollTop=5000 with scrollHeight=5800 and clientHeight=600, dist=5800-5000-600=200 > BOTTOM_THRESHOLD=100 → pill SHOULD appear. But asserting no-jump alone is sufficient for the invariant — omit the pill assertion to keep the test focused.
    - Append-only edit to `.planning/phases/32-redesign-pretty-view-auto-scroll-three-case-sticky-bottom-ho/32-CONTEXT.md`: add a new section at end of file titled `## Post-ship correction (2026-08-13)` with subsections for Symptom (Ashley quote), Root cause (RO conflated new-message vs re-measure; Case 2 useEffect wrote scrollTop on ANY scrollHeight growth), Structural fix (split into two effects; new-message signal is `messageCount` param), and a closing line "Everything else in this CONTEXT.md remains LOCKED — this is an additive correction, not a re-litigation." Do NOT modify any earlier sections (LOCKED per file header).
    - Full frontend suite green: `npx vitest run` exits 0 with zero failures. Backend NOT touched — no `npm run build:backend` needed.
  </behavior>
  <action>
    Edit `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx`:
    (a) Test 2b (L442-514): after `fireWsMessage(ws, {...eventId: "evt-new"...})` at L484-490, REMOVE the block at L495-499 that loops through `capturedROCallbacks` — under new semantics the follow is driven by the new-message useEffect on React commit, not the RO. Keep the `act(() => vi.advanceTimersByTime(50));` block at L502-504. Update the inline comment at L492-494 from "Manually invoke every captured RO callback — JSDOM's RO stub never fires on its own; we drive the outer-container RO to simulate the browser having noticed the scrollHeight growth." to "Under the post-2026-08-13 correction the follow is driven by the new-message useEffect (keyed on messageCount, which grows when fireWsMessage appends via setMessages). RO no longer writes scrollTop — no manual RO fire needed here." Update the assertion comment at L505-509 to note the new-message effect (not RO) is what drives the follow.
    (b) Test 3 (L516-610): keep the `capturedROCallbacks` loop at L595-599 (harmless under new semantics — RO callback is now setIsPinnedToBottom-only). Retitle the comment at L593-594 from "Manually fire captured RO callbacks — proves the RO branch takes the !stickyRef path (no scrollTop write) rather than yanking." to "Fire RO callbacks — under the post-2026-08-13 correction the RO ONLY updates pill visibility (setIsPinnedToBottom); this fires that path and confirms no scrollTop write. New-message useEffect also does nothing because stickyRef.current is false (user scrolled up)."
    (c) INSERT NEW Test 2c BETWEEN existing Test 2b (ends L514) and Test 3 (starts L516). Test body follows the exact shape of Test 2b (vi.useFakeTimers + rAF stub + render + flipToStreaming + fireMessageBatch 20 msgs + shrinkScrollContainer 600/5000 + advance 200ms so paneKey rAF chain lands scrollTop at 5000 + assert baseline), then DIVERGES: `geom.setScrollHeight(5800);` (simulate tall-bubble re-measure), do NOT fire any WS frame, `act(() => { for (const cb of capturedROCallbacks) cb([], {} as ResizeObserver); });` (fire RO manually), `act(() => vi.advanceTimersByTime(50));`, `expect(geom.getScrollTop()).toBe(5000);` (critical: no yank). Add a it() description: `"Test 2c: tall-bubble re-measure while sticky — RO-only fire (no new message) does NOT trigger jumpToBottom (post-2026-08-13 correction; pre-fix would have yanked to 5800)"`. Full setup pattern must mirror Test 2b's fake-timer + rAF stub scaffold to keep the file's testing patterns consistent.

    Append to `.planning/phases/32-redesign-pretty-view-auto-scroll-three-case-sticky-bottom-ho/32-CONTEXT.md` at end of file (current length 181 lines — append starting at L182 with a blank separator line first):

    ```
    ## Post-ship correction (2026-08-13)

    ### Symptom
    Ashley 2026-08-13: "if I try to scroll up, I get a little ways up before it either
    snaps back to the bottom or jumps to a completely different area in the overall
    height. And it seems to coincide with very tall bubbles that are taller than the
    screen."

    ### Root cause
    The Case 2 ResizeObserver useEffect in `use-auto-scroll.ts` (pre-correction
    lines 136-166) observed the outer scroll container AND every direct child to
    catch scrollHeight growth from both new messages and virtualizer re-measure.
    Its callback fired on ANY scrollHeight growth and called `jumpToBottom(scrollEl)`
    when `stickyRef.current` was true — conflating two semantically-different events:

    - **New message arrived** (messages array grew) → jump-to-bottom IS desired
    - **Existing bubble re-measured by TanStack Virtual** (tall image or long code
      block whose real DOM height exceeds `estimatePvBubbleSize` 400px ceiling) →
      jump-to-bottom is NOT desired; user may be scrolled up reading history

    Two failure modes flowed from the conflation:
    1. **Snap back to bottom.** Slow touch scroll on iOS produces a chain of <20px
       scroll deltas that get filtered as measurement adjustments by the scroll
       listener's `MEASUREMENT_DELTA_IGNORE_PX=20` guard; `stickyRef` never flipped
       false. A subsequent tall-bubble re-measure fired the RO → jumpToBottom → snap.
    2. **Jump to different area.** TanStack Virtual's own `scrollWithAdjustments`
       writes 500-1500px scrollTop deltas on tall-bubble re-measure, not
       `programmaticRef`-flagged, blowing through the 20px filter. Visible directly
       as content shifting.

    ### Structural fix
    Ashley greenlit the structural fix over a narrow threshold-bump. Split the
    Case 2 useEffect into two effects:

    - **New effect (jump-on-new-message)**: keyed on
      `[scrollEl, messageCount, jumpToBottom]`. On mount and every `messageCount`
      change: if `stickyRef.current` is true, call `jumpToBottom(scrollEl)`. This
      is the ONLY code path that calls `jumpToBottom` from message-arrival —
      semantically clean, no false fires on re-measure.
    - **Retained RO effect (pill-visibility-only)**: keeps the outer-container +
      children RO wiring, keeps the MutationObserver for accessory mounts, but
      its callback ONLY updates `setIsPinnedToBottom(dist <= BOTTOM_THRESHOLD)`.
      No more `stickyRef.current ? jumpToBottom : setPill()` branch — always just
      pill visibility. Dropped the `prevScrollHeightRef` / `shrunk` guard (existed
      only to gate the jumpToBottom call, which is gone).

    Hook signature changes from `useAutoScroll(paneKey)` to
    `useAutoScroll(paneKey, messageCount: number)`. Caller passes `messages.length`.

    ### What is NOT re-litigated
    Everything else in this CONTEXT.md remains LOCKED — this is an additive
    correction, not a re-litigation. Preserved verbatim: Case 1 paneKey-change
    rAF chain, Case 3 `scrollToBottomAndFollow`, single scroll listener, both
    programmaticRef gate and MEASUREMENT_DELTA_IGNORE_PX guard, no
    wheel/keydown/touchmove listeners, no `loadLockUntilRef`, no `contentRef`
    export, no `forceStickAndJump` export, no inline `overflow-anchor` write,
    `BOTTOM_THRESHOLD = 100`, `STICK_ARM_MS = 150`.

    Verification anchor: Test 2c in `PrettyView.virtualization.test.tsx` asserts
    the post-correction invariant — tall-bubble re-measure while sticky (RO fires
    with no new message) does NOT produce a scrollTop write.
    ```

    Do NOT touch any of the earlier LOCKED sections. Append only.

    Then run full frontend suite: `npx vitest run` — must exit 0 with zero failures.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tiffany &amp;&amp; npx vitest run 2>&amp;1 | tail -30 &amp;&amp; grep -c 'Post-ship correction (2026-08-13)' .planning/phases/32-redesign-pretty-view-auto-scroll-three-case-sticky-bottom-ho/32-CONTEXT.md &amp;&amp; grep -c 'Test 2c' src/ui/features/pretty-view/PrettyView.virtualization.test.tsx</automated>
  </verify>
  <done>
    - `npx vitest run` exits 0 with zero failures across the full frontend suite.
    - `grep -c 'Post-ship correction (2026-08-13)' .planning/phases/32-.../32-CONTEXT.md` returns exactly 1.
    - `grep -c 'Test 2c' src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` returns at least 1 (the new test's it() description).
    - Test 2b passes with the RO manual-fire loop removed (follow driven by new-message useEffect).
    - Test 3 passes unchanged (RO-only pill path is a no-op under new semantics).
    - New Test 2c passes — confirms tall-bubble re-measure while sticky does NOT jump.
    - Existing Tests 1, 2, 2d, 4, 5a, 5b, 6, 7, 8, 9 all still pass.
    - `.planning/phases/32-.../32-CONTEXT.md` earlier sections byte-unchanged (append-only edit) — verify with `git diff .planning/phases/32-.../32-CONTEXT.md` showing only additions at end.
  </done>
</task>

</tasks>

<verification>
Overall phase checks:
- `npx tsc --noEmit` exits 0.
- `npx vitest run` exits 0 (full frontend suite green — baseline ~1843 pass or higher after the new Test 2c).
- No backend files touched: `git diff --stat src/backend/` should show zero lines.
- Grep proofs:
  - `grep -c 'useAutoScroll(paneKey, messages.length)' src/ui/features/pretty-view/PrettyView.tsx` = 1
  - `grep -c 'prevScrollHeightRef' src/ui/features/pretty-view/use-auto-scroll.ts` = 0
  - `grep -v '^\s*//' src/ui/features/pretty-view/use-auto-scroll.ts | grep -c 'jumpToBottom(scrollEl)'` = 4
  - `grep -c 'Post-ship correction (2026-08-13)' .planning/phases/32-.../32-CONTEXT.md` = 1
- Semantic proof by test: new Test 2c fails against pre-fix hook (scrollTop yanks to 5800), passes against post-fix hook (scrollTop stays at 5000).
- Commits on `feat/tab-title-from-tmux`: two atomic commits (Task 1 = hook + call-site + comments; Task 2 = tests + CONTEXT.md append). Do NOT push, do NOT docker build, do NOT deploy — orchestrator (tiffany) handles deploy per fleet rule.
</verification>

<success_criteria>
1. Hook split: use-auto-scroll.ts contains exactly one new-message useEffect (deps include messageCount, body calls jumpToBottom iff sticky) AND exactly one RO useEffect (callback body is setIsPinnedToBottom only, no jumpToBottom).
2. Call site: PrettyView.tsx L685 reads `useAutoScroll(paneKey, messages.length)`.
3. All four Phase-32 test scenarios still verified: Test 2 (Case 1 first-load rAF chain), Test 2b (Case 2 follow-on-new-when-at-bottom via new-message useEffect), Test 2d (Case 3 send force-jump), Test 3 (scrolled-up no-yank).
4. New Test 2c passes — proves the fix: tall-bubble re-measure while sticky produces no scrollTop write.
5. Phase 32 CONTEXT.md preserved intact with a single append-only "Post-ship correction (2026-08-13)" section at the end explaining symptom + root cause + structural fix, no earlier sections modified.
6. Type check clean; full frontend vitest suite green; no backend touched.
7. Two atomic commits on `feat/tab-title-from-tmux`. NOT pushed, NOT built, NOT deployed.
</success_criteria>

<output>
Create `.planning/quick/260813-qox-fix-prettyview-auto-scroll-snap-back-jum/260813-qox-SUMMARY.md` when done.
</output>
