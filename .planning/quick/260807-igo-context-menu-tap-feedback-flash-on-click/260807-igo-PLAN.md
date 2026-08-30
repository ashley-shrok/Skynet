---
phase: quick-260807-igo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx
  - src/ui/features/pretty-conversations/pretty-conversations.css
  - src/ui/features/pretty-conversations/PrettyConversationContextMenu.test.tsx
autonomous: true
requirements:
  - IGO-CTX-TAP-FLASH

must_haves:
  truths:
    - "Tapping a PrettyConversationContextMenu item on mobile (touch) produces a perceivable background flash on the tapped item before the menu closes."
    - "Clicking a PrettyConversationContextMenu item on desktop (mouse) produces the same perceivable background flash before the menu closes."
    - "The menu's per-identity hue border (via --pv-id-hue) still renders correctly."
    - "Danger-variant items still render with color #ff9a8a."
    - "Unmounting the menu mid-flash-delay does NOT call onClose after unmount (no zombie parent call)."
    - "The existing vitest suite for PrettyConversationContextMenu still passes (all 10+ test cases)."
    - "Full suite `npx vitest run` exits 0."
  artifacts:
    - path: "src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx"
      provides: "Context menu component with touch+mouse tap-flash + delayed onClose"
      contains: "flash-item"
    - path: "src/ui/features/pretty-conversations/pretty-conversations.css"
      provides: ".pv-context-menu-item selector with :hover AND :active backgrounds"
      contains: ".pv-context-menu-item"
    - path: "src/ui/features/pretty-conversations/PrettyConversationContextMenu.test.tsx"
      provides: "Updated tests that tolerate the delayed onClose (fake timers) + new unmount-during-delay safety test"
      contains: "vi.useFakeTimers"
  key_links:
    - from: "PrettyConversationContextMenu.tsx button.onClick"
      to: "onClose (parent)"
      via: "setTimeout(120ms) guarded by a mounted-ref"
      pattern: "setTimeout\\(.*onClose"
    - from: "PrettyConversationContextMenu.tsx button className"
      to: "pretty-conversations.css .pv-context-menu-item"
      via: "className attribute"
      pattern: "pv-context-menu-item"
---

<objective>
Give the conversation-row context menu a perceivable tap-down flash on mobile touch AND desktop mouse, and let that flash actually be seen by delaying menu teardown ~120ms after the item's onClick fires.

Purpose: Right now the menu vanishes with zero feedback on mobile (mouse-only hover handlers never fire on touch) and effectively no feedback on desktop either (the portal tears down synchronously). This makes the menu feel broken/unresponsive to Ashley on the PWA.

Output: A CSS-class-driven `:hover`/`:active` background on menu items, and a mount-guarded `setTimeout` between `item.onClick()` and `onClose()` so the `:active` state is visible before unmount. No mobile-only branching, no user-agent sniffing.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md

**Branch policy:** Executor MUST run in the main tree on the current branch (`feat/tab-title-from-tmux`). NO worktrees — `workflow.use_worktrees=false`, fleet rule (Ashley).

**Ship policy:** DO NOT push, build, or deploy after committing. The plan's final step is the atomic commit + SUMMARY. Ashley greenlights ship separately.
</execution_context>

<context>
@.planning/STATE.md
@src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx
@src/ui/features/pretty-conversations/pretty-conversations.css
@src/ui/features/pretty-conversations/PrettyConversationContextMenu.test.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Wire CSS-class tap-flash + delayed onClose, extend tests to cover it</name>
  <files>
    src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx,
    src/ui/features/pretty-conversations/pretty-conversations.css,
    src/ui/features/pretty-conversations/PrettyConversationContextMenu.test.tsx
  </files>
  <behavior>
    - Existing Test 8 ("Item click invokes item.onClick AND onClose") must still assert both are called after the flash delay elapses. Use `vi.useFakeTimers()` in that describe block; after `fireEvent.click`, assert `item.onClick` was called synchronously, then advance timers by 120ms and assert `onClose` was called exactly once.
    - New Test 11: "unmount during flash-delay does NOT call onClose after unmount". Render, click an item, immediately call the RTL `unmount()`, advance timers 120ms, assert `onClose` was NOT called (0 times).
    - Existing danger-color test (Test 9) still asserts `rgb(255, 154, 138)` — style is inline, so nothing to change there.
    - Existing hue-custom-property tests (Test 10) still pass — `--pv-id-hue` remains an inline style on the menu root.
    - All other tests (portal mount, positioning, viewport clamp, Escape, outside-click, inside-click preserve, danger item click) continue to pass unchanged. Only test 8's describe block needs fake-timer treatment.
  </behavior>
  <action>
    **1) CSS (`pretty-conversations.css`)** — Add a new block near the end of the file (after the existing hide-action rules is fine — it's a new component-scoped class, no ordering dependency). Class name: `.pv-context-menu-item`. Rules:
      - Base: `background: transparent; transition: background 90ms ease;` (transition kept short so the flash appears and clears quickly enough to not feel laggy).
      - `:hover`: `background: rgba(255, 240, 215, 0.08);` (same rgba the current inline mouseEnter uses — preserves desktop hover feel).
      - `:active`: `background: rgba(255, 240, 215, 0.18);` (roughly 2x the hover alpha so the tap-down flash is DISTINCTLY louder than idle hover; this is what mobile touch will trigger).
      - `-webkit-tap-highlight-color: transparent;` (kill the default iOS blue tap flash — our `:active` rule replaces it, matching the pattern already used on `.pv-pencil`, `.pv-filter`, `.pv-pin-action`, `.pv-deactivate-action`, `.pv-hide-action`).
      - Do NOT set color here — the inline `color: item.danger ? "#ff9a8a" : "#e8e4d8"` on the button remains authoritative. Do NOT touch the hue-driven border rules on the menu root.

    **2) Component (`PrettyConversationContextMenu.tsx`)**:
      - Add `useRef` for a mounted flag (already imported — extend the existing import). Set `mounted.current = true` on mount and `false` in the cleanup of a `useEffect` that runs once.
      - Add a ref for the pending flash-timeout id so the same cleanup effect can `clearTimeout` on unmount.
      - Remove the inline `onMouseEnter` / `onMouseLeave` handlers (lines 149-156) entirely.
      - Add `className="pv-context-menu-item"` to each menu-item button. The existing `className="py-[8px] px-[12px] max-md:py-[18px] max-md:px-[14px]"` MUST be preserved — concatenate: `className="pv-context-menu-item py-[8px] px-[12px] max-md:py-[18px] max-md:px-[14px]"`.
      - Rewrite the button `onClick` (lines 131-135) as:
        - `e.stopPropagation();`
        - `item.onClick();` (fire the action synchronously — parent state updates happen right away)
        - Schedule `const t = setTimeout(() => { if (mounted.current) onClose(); }, 120);` and stash `t` in the pending-timeout ref (so unmount cleanup can clear it).
      - Constant for the delay: define `const FLASH_DISMISS_MS = 120;` at module scope near `MENU_MIN_WIDTH` / `VIEWPORT_MARGIN` for grep-ability and to match the file's constant style.
      - Do NOT change any other behavior: portal mount, positioning, viewport clamp, Escape/outside-click dismiss, hue inline style, danger inline color, `role="menu"` / `role="menuitem"`, and the existing padding/utility classNames all stay verbatim.

    **3) Tests (`PrettyConversationContextMenu.test.tsx`)**:
      - In the "item click" describe block (Test 8), switch to fake timers: add `vi.useFakeTimers()` in a `beforeEach` inside that describe (and `vi.useRealTimers()` in an `afterEach` — restore is scoped to this describe so the other 9 describe blocks keep real timers). Modify each of the two `it` cases: after `fireEvent.click(...)`, assert the item's `onClick` was called immediately (`toHaveBeenCalledTimes(1)`), then `vi.advanceTimersByTime(120)`, THEN assert `onClose` was called (`toHaveBeenCalledTimes(1)`). Keep the sibling-onClick assertions intact.
      - Add a NEW describe block "PrettyConversationContextMenu: unmount during flash-delay" with one test:
        - Use fake timers.
        - Render, capture the `unmount` fn from RTL.
        - `fireEvent.click` on a menuitem, immediately call `unmount()`, advance timers 120ms, assert `onClose` was NOT called.
        - This proves the mounted-ref guard + timer cleanup on unmount.
      - Do NOT touch tests 1–7, 9, 10 — they remain unchanged (they don't observe onClose or use timers).

    **4) Verification** — After edits, run the file-scoped suite AND the full suite. The full suite MUST exit 0 before this task is done (per the plan's constraint block).

    Rationale for approach:
      - CSS class over inline handlers: `:active` is the ONLY reliable cross-input tap-down signal (fires on both mouse and touch). Inline mouse-* handlers can't observe touch.
      - 120ms delay: long enough for `:active` to render at least one paint frame on 60Hz mobile (~16.7ms) with margin for slower devices, short enough that the menu still feels responsive.
      - Mounted-ref guard + timer cleanup: portal parents can unmount for reasons unrelated to menu selection (route change, row unmount, etc). Firing onClose on a torn-down parent would be a use-after-unmount React warning at best, a crash at worst.
      - Preserving the existing utility className (`py-[8px] px-[12px] max-md:py-[18px] max-md:px-[14px]`): those Tailwind arbitrary values set the mobile hit-target padding — must not lose them by replacing className outright.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx vitest run src/ui/features/pretty-conversations/PrettyConversationContextMenu.test.tsx --reporter=basic &amp;&amp; npx vitest run --reporter=basic</automated>
  </verify>
  <done>
    - `PrettyConversationContextMenu.tsx`: inline `onMouseEnter`/`onMouseLeave` handlers removed; button has `className="pv-context-menu-item ..."`; `onClick` schedules `onClose` via `setTimeout(FLASH_DISMISS_MS)` guarded by a mounted-ref; useEffect cleanup clears any pending timeout and flips `mounted.current = false`.
    - `pretty-conversations.css`: `.pv-context-menu-item` block exists with base + `:hover` + `:active` backgrounds and `-webkit-tap-highlight-color: transparent`.
    - `PrettyConversationContextMenu.test.tsx`: Test 8's describe block uses fake timers and asserts `onClose` fires after `vi.advanceTimersByTime(120)`; new "unmount during flash-delay" describe block exists and passes.
    - `npx vitest run src/ui/features/pretty-conversations/PrettyConversationContextMenu.test.tsx` exits 0.
    - `npx vitest run` (full suite) exits 0.
    - No worktree created; work committed on branch `feat/tab-title-from-tmux`.
  </done>
</task>

<task type="auto">
  <name>Task 2: Atomic commit + SUMMARY</name>
  <files>
    .planning/quick/260807-igo-context-menu-tap-feedback-flash-on-click/260807-igo-SUMMARY.md
  </files>
  <action>
    Write `260807-igo-SUMMARY.md` in the quick plan directory using the standard summary template. Sections to cover:
      - **What shipped**: CSS-class-driven `:hover`/`:active` tap-flash on context-menu items + 120ms mount-guarded delay between item.onClick and onClose so the flash is perceivable on both touch and mouse.
      - **Files changed**: PrettyConversationContextMenu.tsx (removed inline mouse handlers, added className + delayed onClose), pretty-conversations.css (added .pv-context-menu-item block), PrettyConversationContextMenu.test.tsx (fake-timers for the item-click describe, new unmount-during-delay test).
      - **Why this shape**: `:active` is the only cross-input tap-down affordance; a class-based approach means no user-agent sniffing and no mobile-only branch. The delay is the shortest value that reliably survives a 60Hz paint cycle with margin.
      - **Safety**: mounted-ref + timer cleanup prevents onClose-after-unmount when the portal parent tears down mid-flash-delay for unrelated reasons.
      - **Verification**: `npx vitest run` exits 0 (both file-scoped and full suite).
      - **NOT shipped / next**: No visual QA on device in this plan — Ashley greenlights ship + on-device check separately. No push, no deploy.

    After writing SUMMARY.md, create ONE atomic git commit on the current branch (`feat/tab-title-from-tmux`) containing:
      - src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx
      - src/ui/features/pretty-conversations/pretty-conversations.css
      - src/ui/features/pretty-conversations/PrettyConversationContextMenu.test.tsx
      - .planning/quick/260807-igo-context-menu-tap-feedback-flash-on-click/260807-igo-PLAN.md
      - .planning/quick/260807-igo-context-menu-tap-feedback-flash-on-click/260807-igo-SUMMARY.md

    Commit message (title first line ≤72 chars, body wraps at ~72):
      `fix(pretty-conversations): tap-flash + delayed close on context menu`

      Body:
      ```
      Mobile PWA context-menu items had zero visual feedback on tap — the
      inline onMouseEnter/onMouseLeave handlers never fire on touch, and
      the portal tore down synchronously so :active could not be perceived
      even where it did fire.

      Replace inline mouse handlers with .pv-context-menu-item CSS class
      that uses :hover AND :active for cross-input tap-down feedback, and
      delay onClose by 120ms (mount-guarded) so the flash is perceivable
      before the menu unmounts. Same fix improves desktop click feedback
      for free — no mobile-only branching.

      Extends existing Vitest coverage: item-click describe uses fake
      timers to assert the delayed onClose; new unmount-during-delay test
      proves the mounted-ref guard prevents onClose-after-unmount.
      ```

      Trailer:
      `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

    **DO NOT push. DO NOT build. DO NOT deploy.** Ashley greenlights ship separately.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; git log -1 --format="%s" | grep -q "^fix(pretty-conversations): tap-flash" &amp;&amp; git status --short | grep -v '^$' | wc -l | grep -q '^0$' &amp;&amp; test -f .planning/quick/260807-igo-context-menu-tap-feedback-flash-on-click/260807-igo-SUMMARY.md</automated>
  </verify>
  <done>
    - `260807-igo-SUMMARY.md` exists in the quick plan directory with the sections above.
    - Exactly one new commit exists on branch `feat/tab-title-from-tmux` with the specified title and body.
    - `git status` is clean (all edited files committed).
    - The commit includes both source changes AND the plan + summary docs.
    - No `git push`, no `docker compose`, no build/deploy invocation happened.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser user input → React portal | Touch/click events cross into the app's event handling; no untrusted-data flow here (pure UI feedback). |
| Portal parent → menu (unmount) | Parent (row component) can unmount the menu at any time; the menu's setTimeout callback must not fire onClose against a torn-down parent. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-quick-01 | Denial of Service | PrettyConversationContextMenu setTimeout | mitigate | Timer is stored in a ref and cleared on component unmount; mounted-ref guard prevents onClose call after unmount. No unbounded timer creation (one per item click). |
| T-quick-02 | Tampering | pretty-conversations.css new selector | accept | New selector `.pv-context-menu-item` is scoped to this component; no ancestor selectors, no `!important`, no global rules — cannot affect other components. Existing hue/danger rules unchanged. |
| T-quick-03 | Information Disclosure | Test suite | accept | Tests use `vi.fn()` and DOM assertions only — no real credentials or fleet data touched. |
</threat_model>

<verification>
- File-scoped tests pass: `npx vitest run src/ui/features/pretty-conversations/PrettyConversationContextMenu.test.tsx` exits 0.
- Full suite green: `npx vitest run` exits 0.
- Grep sanity: `grep -n 'pv-context-menu-item' src/ui/features/pretty-conversations/pretty-conversations.css src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx | grep -v '^\s*#' | grep -c pv-context-menu-item` returns ≥ 2 (one in CSS, one in TSX).
- Grep sanity: `grep -c 'onMouseEnter\|onMouseLeave' src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx` returns 0 (inline handlers removed).
- Grep sanity: `grep -c 'setTimeout' src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx` returns ≥ 1 (delay wired in).
- `git status` clean after the commit.
- `git log -1 --format=%s` starts with `fix(pretty-conversations): tap-flash`.
</verification>

<success_criteria>
- On mobile PWA (real device or DevTools touch emulation), tapping any menu item shows a perceivable brightening of that item's background BEFORE the menu closes.
- On desktop with a mouse, clicking any menu item shows the same brightening flash before close.
- Per-identity hue border on the menu still renders correctly (unchanged behavior).
- Danger-variant menu items still render in `#ff9a8a` (unchanged behavior).
- No React "state update on unmounted component" warnings when the menu is unmounted mid-flash-delay.
- Full vitest suite passes.
- Single atomic commit on `feat/tab-title-from-tmux` — no push, no deploy.
</success_criteria>

<output>
Create `.planning/quick/260807-igo-context-menu-tap-feedback-flash-on-click/260807-igo-SUMMARY.md` when done (Task 2 handles this).
</output>
