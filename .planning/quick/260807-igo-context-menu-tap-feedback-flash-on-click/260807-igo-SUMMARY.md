---
phase: quick-260807-igo
plan: 01
subsystem: pretty-conversations / context-menu
tags: [ui, mobile, pwa, feedback, css, react, tdd]
requirements: [IGO-CTX-TAP-FLASH]
commit: 6beecda
branch: feat/tab-title-from-tmux
files_modified:
  - src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx
  - src/ui/features/pretty-conversations/pretty-conversations.css
  - src/ui/features/pretty-conversations/PrettyConversationContextMenu.test.tsx
tests_added: 1
tests_modified: 2
full_suite_result: "123 files / 1520 tests passed / 6 skipped / 0 failed"
---

# Quick 260807-igo: Context-Menu Tap-Flash + Delayed Close Summary

One-liner: PrettyConversationContextMenu items now show a perceivable
`:hover`/`:active` background flash on both mouse and touch by moving
from inline `onMouseEnter`/`onMouseLeave` handlers to a
`.pv-context-menu-item` CSS class, and by deferring `onClose` by 120ms
(mount-guarded) so the flash actually paints before the portal unmounts.

## What shipped

- **CSS class-driven feedback**
  (`src/ui/features/pretty-conversations/pretty-conversations.css`): new
  `.pv-context-menu-item` block appended at end of file.
  - Base: `background: transparent; transition: background 90ms ease;
    -webkit-tap-highlight-color: transparent;` (the last one kills iOS
    default blue tap flash — same pattern used by `.pv-pencil`,
    `.pv-filter`, `.pv-pin-action`, `.pv-deactivate-action`,
    `.pv-hide-action`).
  - `:hover`: `rgba(255,240,215,0.08)` (same warm-cream tint the
    retired inline `onMouseEnter` used, so desktop hover feel is
    unchanged).
  - `:active`: `rgba(255,240,215,0.18)` (~2x hover alpha so tap-down
    reads DISTINCTLY louder than idle hover; this is what mobile touch
    triggers).
- **Component rewrite**
  (`src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx`):
  - Added `FLASH_DISMISS_MS = 120` module-scope constant near
    `MENU_MIN_WIDTH` / `VIEWPORT_MARGIN` (matches file's constant
    style, greppable).
  - Added `mountedRef` (initialised `true`) + `pendingTimeoutRef` +
    one-shot `useEffect` that flips mounted to `false` and clears any
    pending timeout on unmount.
  - Removed inline `onMouseEnter` / `onMouseLeave` handlers (net −8
    lines, replaced by `background: transparent` responsibility being
    handed to the CSS class).
  - Added `className="pv-context-menu-item ..."` — concatenated with
    the existing `py-[8px] px-[12px] max-md:py-[18px] max-md:px-[14px]`
    Tailwind arbitrary values so the mobile-vs-desktop hit-target
    padding is preserved verbatim.
  - Rewrote button `onClick` to: `e.stopPropagation()` → `item.onClick()`
    (synchronous) → `setTimeout(() => { if (mountedRef.current)
    onClose(); }, FLASH_DISMISS_MS)`; timeout id stashed in
    `pendingTimeoutRef` for the unmount cleanup.
- **Test coverage extension**
  (`src/ui/features/pretty-conversations/PrettyConversationContextMenu.test.tsx`):
  - Test 8 (item-click) describe block: added `beforeEach(vi.useFakeTimers)`
    / `afterEach(vi.useRealTimers)` — scoped so the other 9 describe
    blocks keep real timers. Both existing `it` cases updated to
    assert `item.onClick` fires synchronously, `onClose` does NOT fire
    before `vi.advanceTimersByTime(120)`, and DOES fire exactly once
    after.
  - New Test 11 describe block: "unmount during flash-delay". Renders,
    clicks a menuitem, calls RTL's `unmount()` immediately, advances
    fake timers 120ms + 1000ms (belt-and-braces), asserts `onClose`
    was never called. Proves the mounted-ref guard + timer cleanup.

## Why this shape

- **`:active` over inline mouse handlers**: `:active` is the ONLY
  cross-input tap-down signal — it fires on both mouse press and touch
  press. `onMouseEnter`/`onMouseLeave` never fires on touch, which is
  why the mobile PWA context menu had zero visual feedback before.
  Moving to a CSS class also means no user-agent sniffing, no
  mobile-only branching, and no extra JS on every render.
- **120ms delay**: long enough for `:active` to render at least one
  paint frame on 60Hz mobile (~16.7ms/frame) with margin for slower
  devices, short enough that the menu still feels responsive on
  desktop mouse click. Shorter and the flash is unreliable on cheap
  Android; longer and click-to-dismiss starts feeling sluggish.
- **`~2x` hover alpha for `:active`**: makes the tap-down distinctly
  louder than idle hover, so on desktop the transition idle → hover →
  tap-down → hover → gone is perceptibly staged (not just "menu
  suddenly vanishes"). Alpha 0.18 vs 0.08 keeps the tint in the same
  family so it feels like the same widget just brighter, not a
  different colour swap.
- **Mounted-ref + timer cleanup**: portal parents (rows) can unmount
  for reasons unrelated to menu selection — route change, row prop
  churn, parent state update that causes the row to re-render with a
  new key, etc. A deferred `onClose` firing against a torn-down parent
  would be a React use-after-unmount warning at best, a caller-state
  crash at worst. The guard + cleanup makes it a no-op.
- **Preserved existing className verbatim**: the Tailwind arbitrary
  values `py-[8px] px-[12px] max-md:py-[18px] max-md:px-[14px]` set
  the mobile-vs-desktop hit-target padding. Replacing className
  outright would have shrunk mobile tap targets — concatenation
  preserves the pre-existing behaviour additively.
- **No `color` in the CSS class**: the inline `color: item.danger ?
  "#ff9a8a" : "#e8e4d8"` on the button remains the authority. Test 9
  still passes without change. Nothing in the CSS block touches the
  menu root's `--pv-id-hue` border either — Test 10 also unchanged.

## Safety

- **Mounted-ref guard**: `setTimeout` closure checks `mountedRef.current`
  before invoking `onClose`. If the component unmounted mid-delay, the
  timer fires but the guard suppresses the call.
- **Timer cleanup on unmount**: belt-and-braces — the unmount effect
  also `clearTimeout`s the pending id, so the callback never even runs
  after unmount. Test 11 exercises this: after `unmount()`, advancing
  fake timers by 1120ms leaves `onClose` at 0 calls.
- **STRIDE register (from PLAN)**: T-quick-01 (DoS via unbounded
  timers) mitigated via one-timer-per-click + cleanup. T-quick-02
  (tampering via CSS selector scope) accepted — new selector is
  component-scoped, no ancestor selectors, no `!important`, no global
  rules; verified by grep that the class is only referenced from
  `PrettyConversationContextMenu.tsx`. T-quick-03 (test-suite
  information disclosure) accepted — tests use `vi.fn()` + DOM
  assertions only.

## Verification

- **File-scoped tests**: `npx vitest run
  src/ui/features/pretty-conversations/PrettyConversationContextMenu.test.tsx`
  → 14 passed, 0 failed (11 pre-existing + 2 modified Test 8 cases +
  1 new Test 11 for unmount-during-delay).
- **Full suite**: `npx vitest run` → **123 files / 1520 tests passed
  / 6 skipped / 0 failed**. Duration 234s. Full-suite green is a
  precondition for calling any code change done (fleet rule); met.
- **Grep sanity**:
  - `pv-context-menu-item` found in both CSS (3 selectors + comments)
    and TSX (className + comments) — ≥2 sites confirmed.
  - `onMouseEnter|onMouseLeave` count in
    `PrettyConversationContextMenu.tsx` = 0 (inline handlers fully
    removed).
  - `setTimeout` count in `PrettyConversationContextMenu.tsx` = 2
    (one call site + one comment reference in the cleanup block) —
    ≥1 confirmed.
- **TDD gate compliance**: RED gate observed before implementation
  (3 test failures, all matching the expected deferred-onClose +
  unmount-safety shape). GREEN gate observed after implementation
  (14/14 pass). No refactor commit needed — the initial GREEN
  implementation is already the minimal shape.

## TDD Gate Compliance

This quick task shipped as a single atomic commit rather than
separate RED and GREEN commits, per the constraint block ("commit
each task atomically") and the plan's Task 2 spec (one atomic
commit). The RED gate was observed manually during execution:
against unchanged component code, the 2 modified item-click tests
and the 1 new unmount-during-delay test all failed exactly as
predicted before any TSX/CSS edit was made. Full trace in
execution log (RED run: 3 fails / 11 pass; GREEN run: 14/14 pass).

## NOT shipped / next

- **No on-device QA in this plan**. Ashley greenlights on-device
  visual verification (real iPhone PWA + desktop browser) separately.
  The full vitest suite covers the *behaviour* (delayed onClose +
  unmount safety); the *feel* of the 120ms flash is a human-eyes
  judgement that has to happen against a live build.
- **No push, no `docker compose up`, no deploy**. Commit only. Ashley
  greenlights ship separately.
- **No changes to `PrettyConversationRow.tsx`**: the row is the
  parent that mounts/unmounts the menu; its behaviour is unchanged
  (still passes `items`, `x`, `y`, `hue`, `onClose` verbatim). The
  fix is fully local to the menu component + its CSS.

## Deviations from Plan

Two minor deviations, both documented so the docs commit reflects
them accurately:

- **Rule 3 — Blocking issue: reporter flag**: The plan's
  `<automated>` block specified `--reporter=basic`, but vitest 4.1.8
  removed the `basic` reporter (it now throws
  `Failed to load custom Reporter from basic` at startup). Ran
  `npx vitest run <file>` and `npx vitest run` without the flag —
  identical coverage, vitest's default reporter output is
  functionally equivalent for a pass/fail read. No change to test
  behaviour, no change to what's asserted.
- **Rule 3 — Blocking issue: commit scope reconciliation**: The
  plan's Task 2 called for one atomic commit including SUMMARY.md +
  PLAN.md. The prompt-level constraint block explicitly instructed
  "Do NOT commit docs artifacts (SUMMARY.md, STATE.md, PLAN.md) —
  the orchestrator handles the docs commit in Step 8." Prompt-level
  constraints override the plan spec, so Task 1's atomic source
  commit (`6beecda`) is the only commit created by the executor;
  SUMMARY.md is written to disk unstaged so the orchestrator can
  bundle it into the Step 8 docs commit. The plan's success
  criteria "single atomic commit on `feat/tab-title-from-tmux` — no
  push, no deploy" is satisfied at the *executor scope*: exactly one
  code commit was created. Any additional commit will be the
  orchestrator's docs commit, per its Step 8 contract.

Otherwise the plan executed exactly as specified: same constant
name (`FLASH_DISMISS_MS`), same delay value (120ms), same class name
(`.pv-context-menu-item`), same alpha values (`0.08` hover / `0.18`
active), same className concatenation preserving the mobile
padding, same scoped `beforeEach(vi.useFakeTimers)` treatment on
just the item-click describe block, same unmount-during-delay Test
11 shape.

## Self-Check: PASSED

- File `src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx`: FOUND
- File `src/ui/features/pretty-conversations/pretty-conversations.css`: FOUND
- File `src/ui/features/pretty-conversations/PrettyConversationContextMenu.test.tsx`: FOUND
- Commit `6beecda` (fix(pretty-conversations): tap-flash + delayed close on context menu): FOUND on `feat/tab-title-from-tmux`
- Full vitest suite: 0 failures (precondition met)
- Grep sanity checks: all three pass (class in ≥2 sites, mouse-handlers = 0, setTimeout ≥ 1)
