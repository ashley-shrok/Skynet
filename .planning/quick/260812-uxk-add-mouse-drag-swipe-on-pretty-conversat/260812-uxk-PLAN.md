---
quick_id: 260812-uxk
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
  - src/ui/features/pretty-conversations/pretty-conversations.css
autonomous: true
---

<objective>
Add mouse-drag swipe on `.pv-row--desktop` rows as the desktop-native equivalent
of the shipped mobile touch swipe-to-act gesture (patches #350/#354, described
verbatim in the header comment block at
`src/ui/features/pretty-conversations/PrettyConversationRow.tsx:315-397`).

The mouse machine mirrors the touch machine's LOCKED design decisions:
  - threshold `Math.max(90, rowWidth * 0.35)`
  - 8px tap-vs-drag floor + vertical-vs-horizontal disambiguation
  - `dx * 0.6` viscous rubber-band translate, capped at ±rowWidth
  - 200ms snap-back with `transition: transform 180ms cubic-bezier(.2,.9,.3,1)`
  - shared `swipe-past-threshold-right | swipe-past-threshold-left` glow classes
  - idempotency: swipe-right needs `!pinned || !inActiveSet`; swipe-left needs
    `pinned || inActiveSet`; silent no-op otherwise
  - RDP exemption (early-return on `isRdp`)
  - suppresses the trailing `click` via the SHARED `suppressNextClickRef` so a
    successful mouse-swipe composite does NOT also fire onSelect via the row
    body's `onClick`
  - onMouseLeave mid-drag = touchcancel-equivalent (snap back without firing)

APPROACH — parallel `onMouseDown/onMouseMove/onMouseUp/onMouseLeave` handlers
on the row body that share the SAME internal refs the touch handlers already
use (`swipeStartRef`, `armedRef`, `disarmedRef`, `isSnappingRef`,
`snapTimerRef`, `dxLive`, `resetSwipeGesture`, `beginSnapBack`,
`clearSnapTimer`, `suppressNextClickRef`). DO NOT convert touch handlers to
PointerEvents. DO NOT modify any existing touch code paths. The mouse handlers
are DESKTOP-ONLY (`variant === "desktop" && !isRdp`); on mobile the four
onMouse* props remain `undefined` so the mobile row keeps touch-only behavior
and adds zero new listeners. NO long-press-on-mouse path — desktop right-click
already uses the existing `onContextMenu` handler.

Purpose: parity between mobile and desktop swipe UX. Desktop Ashley currently
has no fast pin+activate / unpin+deactivate composite — she must right-click
and pick from the menu. Mouse-drag swipe restores the same one-gesture
composite the mobile row already ships.

Output: mouse-drag swipe wired on desktop rows with matching test coverage.
Full vitest suite green (mobile TS1-TS7 + panel TS-P1 unaffected).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@src/ui/features/pretty-conversations/PrettyConversationRow.tsx
@src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
@src/ui/features/pretty-conversations/pretty-conversations.css
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add parallel mouse handlers + user-select CSS; extend past-threshold glow to desktop variant</name>
  <files>
    src/ui/features/pretty-conversations/PrettyConversationRow.tsx,
    src/ui/features/pretty-conversations/pretty-conversations.css
  </files>
  <behavior>
    Behavior contract this task ships (verified by Task 2 tests):

    Desktop non-RDP row, `variant === "desktop"`:
      - onMouseDown captures {clientX, clientY, rowWidth via
        currentTarget.getBoundingClientRect().width}; writes to
        `swipeStartRef`; resets `armedRef` and `disarmedRef` to false; NO-OPs
        if `isSnappingRef.current === true` (mid-snap-back guard, same as
        touchStart).
      - onMouseMove computes `dx = clientX - start.x`, `dy = clientY - start.y`.
        If `disarmedRef.current` → return. If NOT armed:
          * `|dx| < 8 && |dy| < 8` → return (below tap floor)
          * `|dx| >= 8 && |dx| > |dy|` → arm (`armedRef.current = true`)
          * else → disarm (`disarmedRef.current = true`) and return
        If armed → `setDxLive(clamp(dx * 0.6, ±rowWidth))`. NO `preventDefault`
        (text-selection suppression is CSS-side, per the user-select rule
        below).
      - onMouseUp mirrors touchEnd branch-for-branch:
          * unarmed → `resetSwipeGesture()`, tap path unchanged (click fires
            normally via `onBodyClick`)
          * armed + `|rawDx| < threshold` (where `threshold =
            Math.max(90, rowWidth * 0.35)` and `rawDx = (dxLive ?? 0) / 0.6`)
            → clear start/armed/disarmed refs, `beginSnapBack()`, no callbacks
          * armed + past threshold + `!wouldChange` (idempotency:
            swipe-right needs `!pinned || !inActiveSet`;
            swipe-left needs `pinned || inActiveSet`)
            → clear refs, `beginSnapBack()`, no callbacks, no vibrate
          * armed + past threshold + wouldChange → fire the composite in the
            SAME order as touchEnd:
              swipe-right (rawDx > 0): if (!pinned) onTogglePin();
                                       if (!inActiveSet) onSelect();
              swipe-left  (rawDx < 0): if (pinned) onTogglePin();
                                       if (inActiveSet) onDeactivate?.();
            Then `navigator.vibrate?.(10)` (feature-checked, same shape as
            touch path — no-op in jsdom / desktop-without-haptics), set
            `suppressNextClickRef.current = true` so the trailing browser click
            does NOT double-fire onSelect via `onBodyClick`, and call
            `beginSnapBack()`.
      - onMouseLeave while `swipeStartRef !== null` = touchcancel-equivalent:
        if armed → `beginSnapBack()`, do NOT fire the composite regardless of
        current dx (leaving the row mid-drag is a cancel signal). If not
        armed, just `resetSwipeGesture()`. Clear start/armed/disarmed refs
        either way. suppressNextClickRef is NOT set here — leave = no click
        follows anyway.

    Prop-wiring gate (mirror of the existing `isMobile ? onTouchStart :
    undefined` pattern at PrettyConversationRow.tsx:761):
      - When `variant === "desktop" && !isRdp`: bind `onMouseDown`,
        `onMouseMove`, `onMouseUp`, `onMouseLeave` on the same `role="button"`
        row body (line ~754-767).
      - Otherwise (mobile OR desktop-RDP): all four props are `undefined` so
        no listeners attach. Mobile row keeps its current touch-only path
        unchanged. Desktop RDP keeps its right-click-only path unchanged
        (desktop RDP CAN open the context menu per quick-260804-uo4, but has
        no swipe — matches touch-side RDP exemption at TS7).

    RDP-desktop guard: even though the outer prop-wiring gate blocks
    handler-attachment for RDP, add an in-handler `if (isRdp) return` at the
    top of onMouseDown/Move/Up/Leave as defense-in-depth (mirror of the
    identical guards in onTouchStart/Move/End). Same shape as `!isMobile`
    early-returns in the touch handlers except inverted: mouse handlers
    check `variant !== "desktop"` and early-return, plus `if (isRdp) return`.

    Class-composition changes to the swipe-past-threshold flags at
    PrettyConversationRow.tsx:685-694: the `swipePastRight` / `swipePastLeft`
    booleans are already variant-agnostic — they read `armedRef.current` +
    `dxLive` + `swipeThreshold` with no variant gate. That means when a
    desktop mouse drag arms + crosses threshold, `swipePastRight` /
    `swipePastLeft` will flip true and the corresponding class will be added
    to the row body. The CSS glow rule is currently gated to
    `.pv-row.pv-row--mobile.swipe-past-threshold-*` (pretty-conversations.css:
    1275, 1281). Extend the selector to apply to BOTH variants — either:
      (a) change `.pv-row.pv-row--mobile.swipe-past-...` to
          `.pv-row.swipe-past-...` (drop variant gate — cleanest), or
      (b) add a second selector `.pv-row.pv-row--desktop.swipe-past-...`
          duplicating the box-shadow rule.
    Prefer (a) — the class is only ever ADDED by the row component when a
    swipe is armed (mobile touch OR desktop mouse), so scoping it to `.pv-row`
    alone is safe and DRY. Update the CSS header comment block above the
    rule (lines 1258-1273) to note "mobile touch AND desktop mouse".

    Inline transform/transition style at PrettyConversationRow.tsx:720-726 is
    ALSO variant-agnostic (reads `dxLive` + `isSnappingRef.current` with no
    variant gate) — it will Just Work for desktop mouse drag because the same
    `setDxLive` / `beginSnapBack` refs drive it. No changes needed there.

    CSS user-select suppression: add `user-select: none` (plus
    `-webkit-user-select: none` for parity with the existing rule at
    pretty-conversations.css:376-377) to `.pv-row.pv-row--desktop` ONLY
    (mobile rows already avoid text-selection since touch doesn't create
    selections). Placement: add it inside the existing `.pv-row--desktop {}`
    block at pretty-conversations.css:711 (first line after `min-height: ...`
    or wherever the block cleanly accepts a new declaration). Rationale
    comment in-line: "quick-260812-uxk: prevent text-selection during
    mouse-drag swipe — cleaner than preventDefault on every mousedown, and
    desktop rows have no legitimate text-select interaction (label + host
    line are single-tap targets, not selectable content)."
  </behavior>
  <action>
    Read the full header comment block at
    `src/ui/features/pretty-conversations/PrettyConversationRow.tsx:315-397`
    before editing. Understand the six locked design decisions verbatim — the
    mouse handlers implement the identical machine, reusing the same refs.

    In `src/ui/features/pretty-conversations/PrettyConversationRow.tsx`:

    (1) Add a new header comment section BELOW the existing
        "Mobile swipe-to-act state machine (quick-260808-fkg)" block
        (currently ends around line ~397) titled "Desktop mouse-drag swipe
        (quick-260812-uxk)". Document verbatim: (a) that it reuses ALL touch-
        machine refs listed in this plan's Objective; (b) the desktop-only +
        !isRdp gate; (c) NO long-press-on-mouse (right-click already covered
        by existing onContextMenu); (d) text-selection suppression is
        CSS-side via `user-select: none` on `.pv-row--desktop`; (e) the
        onMouseLeave = touchcancel-equivalent semantic (snap back, no fire);
        (f) that the mouse handlers do NOT preventDefault. This comment
        block should be as thorough as the touch-machine one — future
        readers should not need to reconstruct these decisions from git
        history.

    (2) Import `MouseEvent as ReactMouseEvent` if the existing `MouseEvent`
        type import from React is already in use (line ~70 currently imports
        `type MouseEvent`). It is — reuse as-is for handler signatures.

    (3) Add `onMouseDown`, `onMouseMove`, `onMouseUp`, `onMouseLeave` as
        `useCallback` handlers, placed AFTER the existing touch handlers
        (after `onTouchEnd`, before the `useEffect` cleanup at line ~631).
        Implement per the <behavior> block above. Each handler MUST early-
        return if `variant !== "desktop"` AND early-return if `isRdp`. All
        four handlers share the SAME refs as the touch handlers — do NOT
        introduce parallel refs (that would break the "shared refs" APPROACH
        constraint).

    (4) Extend the JSX prop-wiring at the row body (currently line 754-767):
        add four new props to the `<div role="button">`:
          onMouseDown={variant === "desktop" && !isRdp ? onMouseDown : undefined}
          onMouseMove={variant === "desktop" && !isRdp ? onMouseMove : undefined}
          onMouseUp={variant === "desktop" && !isRdp ? onMouseUp : undefined}
          onMouseLeave={variant === "desktop" && !isRdp ? onMouseLeave : undefined}
        Note: the existing `onContextMenu={!isMobile ? onRowContextMenu :
        undefined}` at line 760 stays UNCHANGED. Right-click continues to
        open the context menu on ALL desktop rows (RDP included per
        quick-260804-uo4). Mouse-drag swipe is desktop-non-RDP only.

    (5) The `useEffect` cleanup at line 631-643 already drains
        `longPressTimerRef` + `snapTimerRef` + `notifyMenuClosed`. It does
        NOT need any changes — the mouse handlers reuse `snapTimerRef` which
        is already in the cleanup. NO new refs introduced means NO new
        cleanup work.

    In `src/ui/features/pretty-conversations/pretty-conversations.css`:

    (6) Update the CSS header comment block at lines 1258-1273: change the
        phrasing "Both classes are mobile-only (gated on `.pv-row--mobile`)
        — desktop rows never receive them (variant gate in the row
        component)." to "Both classes apply to mobile touch-swipe AND desktop
        mouse-drag swipe (quick-260812-uxk). The class is added by the row
        component only while a swipe is armed and past threshold, so scoping
        to `.pv-row` (no variant gate) is safe."

    (7) Update selectors at pretty-conversations.css:1275 and 1281: change
        `.pv-row.pv-row--mobile.swipe-past-threshold-right` → `.pv-row.swipe-
        past-threshold-right`; change `.pv-row.pv-row--mobile.swipe-past-
        threshold-left` → `.pv-row.swipe-past-threshold-left`. Body of each
        rule is unchanged.

    (8) In the `.pv-row--desktop { ... }` block at pretty-conversations.css:
        711-716 (or wherever the block ends — do not conflict with adjacent
        child selectors), add:
          user-select: none;
          -webkit-user-select: none;
        Prefix with a `/* quick-260812-uxk: ... */` inline comment matching
        the phrasing in the <behavior> block above. Do NOT touch the mobile
        variant block at line 691.

    DO NOT:
      - Convert `onTouchStart/Move/End/Cancel` to PointerEvents.
      - Modify the touch machine's refs, callbacks, or handlers.
      - Add a long-press-on-mouse timer.
      - Add `preventDefault()` calls in the mouse handlers.
      - Introduce new refs (must reuse the existing shared refs).
      - Modify `onContextMenu` wiring or `onRowContextMenu`.
      - Modify `onBodyClick` beyond what's already there — the existing
        `suppressNextClickRef` gate at line 651 already handles suppression
        for the trailing click after a mouse-swipe composite (same ref path
        the long-press already uses).
      - Touch files outside the three listed in `files_modified`.
      - Touch `skynet-patches.md`.
      - Add any ship/deploy task. STOP AT code + commit + tests green.
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>
    Row component compiles with new mouse handlers + prop wiring. CSS compiles
    with widened selectors + desktop user-select rule. No TypeScript errors.
    No touch-side handler modifications visible in `git diff`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add desktop mouse-swipe test coverage (TSD1-TSD8, mirroring TS1-TS7 + onMouseLeave case)</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx</files>
  <behavior>
    Add a new describe block titled
    "PrettyConversationRow: desktop mouse-drag swipe (quick-260812-uxk)"
    placed AFTER the existing TS1-TS7 describe block
    (`PrettyConversationRow: mobile swipe-to-act (quick-260808-fkg)`,
    currently ends around line 2087). Follow the same
    `beforeEach(vi.useFakeTimers)` / `afterEach(vi.useRealTimers)` fixture as
    the mobile block. All rows render with `variant="desktop"` (mobile block
    uses `variant="mobile"`).

    Reuse `makeIdentity` / `makeRow` fixture helpers already defined in this
    test file (used by TL1-TL5 and TS1-TS7). Reuse `currentIdentity =
    makeIdentity(hue, name)` at the top of each `it()` per the existing
    pattern.

    Eight test cases (mirror TS1-TS7 shape + one new onMouseLeave case):

    TSD1 — Swipe-right past threshold on unpinned + inActiveSet=false
      Assertions:
        - onTogglePin called once
        - onSelect called once
        - onDeactivate NOT called
        - `suppressNextClickRef` engaged: a follow-up `fireEvent.click(body)`
          MUST NOT increment onSelect beyond 1 (verifies trailing-click
          suppression). This is a MOUSE-specific check the touch TS1 does
          NOT need (touch has no synthesized click in jsdom).
      Event sequence: mouseDown@(100,100), mouseMove@(150,102),
      mouseMove@(210,105), mouseUp, advanceTimersByTime(200), click(body).

    TSD2 — Swipe-right past threshold on already pinned+inActiveSet is
      SILENT no-op (idempotency)
      Assertions: onTogglePin NOT called, onSelect NOT called, onDeactivate
      NOT called.
      Same event sequence as TSD1, but rendered with pinned=true +
      inActiveSet=true.

    TSD3 — Swipe-left past threshold on pinned + inActiveSet=true
      Assertions:
        - onTogglePin called once
        - onDeactivate called once
        - onSelect NOT called
        - Follow-up `fireEvent.click(body)` MUST NOT increment onSelect (still 0).
      Event sequence: mouseDown@(200,100), mouseMove@(150,102),
      mouseMove@(90,105), mouseUp, advanceTimersByTime(200), click(body).

    TSD4 — Swipe-left past threshold on unpinned + inActiveSet=false is
      SILENT no-op (idempotency for the left direction)
      Assertions: onTogglePin NOT called, onSelect NOT called, onDeactivate
      NOT called.
      Same event sequence as TSD3 but rendered with pinned=false +
      inActiveSet=false.

    TSD5 — Release BELOW threshold: NO composite, snap back, tap path intact
      Assertions:
        - onTogglePin NOT called
        - onSelect NOT called
        - onDeactivate NOT called
        - Follow-up `fireEvent.click(body)` DOES increment onSelect to 1
          (below-threshold release means swipe never armed the trailing-click
          suppression, so tap-to-activate is preserved — mirrors mobile TS4
          behavior contract for the click side).
      Event sequence: mouseDown@(100,100), mouseMove@(135,102) [dx=35, arms
      but below 90 threshold], mouseUp, advanceTimersByTime(200), click(body).

    TSD6 — Vertical mouse-move exceeding tap floor without horizontal:
      does NOT arm the swipe, no callback fires
      Assertions: onSelect NOT called, onTogglePin NOT called, onDeactivate
      NOT called.
      Event sequence: mouseDown@(100,100), mouseMove@(105,150) [dx=5, dy=50 →
      vertical wins, disarmed], mouseMove@(200,150) [dx=100 but disarmed
      sticks], mouseUp, advanceTimersByTime(200).

    TSD7 — RDP row: mouse handlers do NOT attach (variant gate + isRdp both
      block wiring), no composite fires
      Assertions: onTogglePin NOT called, onSelect NOT called.
      Render row with `makeRow({ rdpHostRow: true, targetTmuxSession: null })`
      and `variant="desktop"`. Fire the same past-threshold mouse sequence as
      TSD1 (mouseDown, two mouseMoves, mouseUp, advanceTimersByTime).
      The handlers are unbound at the DOM level, so no state ever changes.

    TSD8 — onMouseLeave mid-drag: snap back WITHOUT firing composite
      (touchcancel-equivalent — the NEW case with no touch mirror)
      Assertions:
        - onTogglePin NOT called
        - onSelect NOT called
        - onDeactivate NOT called
        - After a follow-up `fireEvent.click(body)`, onSelect is still 0
          (leave = cancel, not a click-through — the cursor has left the row,
          so the trailing click won't naturally fire against the row body,
          but even if the test does fire one, the row is no longer "in a
          gesture" and the click-through should NOT fire onSelect because
          mouseLeave cleared the gesture without setting
          `suppressNextClickRef`; the click path is a normal onBodyClick
          which DOES fire onSelect. Correction: after mouseLeave, the
          gesture is cleared but suppressNextClickRef is NOT set — so a
          subsequent click WOULD fire onSelect via the tap path. Test should
          therefore skip the trailing click OR assert onSelect === 1 after
          the click, matching the "cancel restores tap path" semantic. Pick
          "skip the trailing click" for clarity — the assertion set is just
          the three not-called checks, matching TSD5's first three).
      Event sequence: mouseDown@(100,100), mouseMove@(150,102),
      mouseMove@(210,105) [past threshold, armed], mouseLeave@(300,105),
      advanceTimersByTime(200).

    All eight tests query the row body via:
      const wrapper = container.querySelector('[data-conversation-id="conv-1"]');
      const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    (identical to the TS1-TS7 pattern).

    Fixture note for the executor to include as an in-file comment above
    the describe block: "rowWidth defaults to 0 in jsdom (no layout engine),
    so the swipe threshold `Math.max(90, rowWidth * 0.35)` collapses to 90
    in tests. dx values are chosen with the 90 constant in mind (past = 110,
    below = 35). vi.useFakeTimers() is required because the snap-back path
    uses setTimeout(200) to clear isSnappingRef. Same fixture shape as the
    TS1-TS7 mobile block above."
  </behavior>
  <action>
    Open `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx`
    and locate the end of the TS1-TS7 describe block (currently ends at line
    ~2087 with a closing `});` for the outer `describe(...)`).

    Insert the new describe block IMMEDIATELY AFTER TS1-TS7 and BEFORE the
    S1-S2 context-menu-singleton describe block at line ~2098. The header
    comment banner should follow the same style as TS1-TS7's banner (lines
    1773-1801):

      // ─────────────────────────────────────────────────────────────────────
      // TSD1-TSD8 — Desktop mouse-drag swipe-to-act (quick-260812-uxk)
      // ─────────────────────────────────────────────────────────────────────
      // Desktop-native equivalent of the mobile touch swipe machine (TS1-TS7
      // above). Parallel onMouseDown/onMouseMove/onMouseUp/onMouseLeave
      // handlers on the row body share the SAME internal refs the touch
      // handlers use. Wiring is gated on `variant === "desktop" && !isRdp`;
      // mobile keeps touch-only, desktop-RDP keeps right-click-only. All six
      // locked design decisions from the touch machine header comment block
      // apply verbatim (threshold, 8px floor, 0.6 rubber-band, 200ms snap-
      // back, past-threshold glow class, idempotency). onMouseLeave mid-drag
      // is the mouse-only cancel path (touchcancel-equivalent), covered by
      // TSD8. Coverage:
      //   TSD1 — swipe-right past threshold on unpinned+inActive=false fires
      //          composite (onTogglePin + onSelect); trailing click
      //          suppressed via suppressNextClickRef.
      //   TSD2 — swipe-right past threshold on pinned+inActive silent no-op.
      //   TSD3 — swipe-left past threshold on pinned+inActive fires composite
      //          (onTogglePin + onDeactivate); trailing click suppressed.
      //   TSD4 — swipe-left past threshold on unpinned+inActive=false silent
      //          no-op.
      //   TSD5 — release below threshold: no composite, snap back, trailing
      //          click DOES fire onSelect (tap path intact).
      //   TSD6 — vertical drag beyond tap floor never arms; no composite.
      //   TSD7 — RDP row: mouse handlers unbound (variant+isRdp gate); no
      //          composite regardless of dx.
      //   TSD8 — onMouseLeave mid-drag: snap back WITHOUT firing composite.
      //
      // Fixture note: rowWidth is 0 in jsdom → threshold collapses to 90.
      // vi.useFakeTimers() required for the 200ms snap-back drain.

    Then write the `describe("PrettyConversationRow: desktop mouse-drag
    swipe (quick-260812-uxk)", () => { ... })` block containing the eight
    `it(...)` cases per the <behavior> spec above. Use `fireEvent.mouseDown`,
    `fireEvent.mouseMove`, `fireEvent.mouseUp`, `fireEvent.mouseLeave` from
    the already-imported `@testing-library/react` bindings (grep the file —
    `fireEvent` is imported at the top). Use `act(() => { vi.advanceTimersBy
    Time(200); })` for the snap-back drain, matching the mobile block's
    pattern (line 1842-1844).

    Mouse events do NOT take a `touches` array — the payload is
    `{ clientX, clientY }` at the top level:
      fireEvent.mouseDown(body, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(body, { clientX: 210, clientY: 105 });
      fireEvent.mouseUp(body, { clientX: 210, clientY: 105 });
      fireEvent.mouseLeave(body, { clientX: 300, clientY: 105 });

    After writing all eight tests, run the FULL vitest suite (not a filter):
      npx vitest run

    Exit code MUST be 0. Confirm in the output that both the new TSD1-TSD8
    block AND the existing TS1-TS7 block AND the panel-level TS-P1 test
    (at PrettyConversationsPanel.test.tsx:2618) all pass. If any existing
    mobile test regresses, the fix goes in the row component (Task 1's mouse
    handlers or CSS changes leaked into the touch path — DO NOT modify the
    mobile test to accommodate).

    Commit ALL three files together with the vitest-green run in the commit
    body. Suggested commit message:
      feat(pretty-conversations): mouse-drag swipe on desktop rows (quick-260812-uxk)

      Adds parallel onMouseDown/Move/Up/Leave handlers on .pv-row--desktop
      that share the mobile touch swipe machine's refs (swipeStartRef,
      armedRef, disarmedRef, isSnappingRef, snapTimerRef, dxLive,
      resetSwipeGesture, beginSnapBack, clearSnapTimer,
      suppressNextClickRef). All six locked design decisions from the touch
      machine (threshold, 8px floor, 0.6 rubber-band, 200ms snap-back,
      past-threshold glow, idempotency) apply verbatim. onMouseLeave mid-
      drag = touchcancel-equivalent (snap back without firing).

      - Wiring gated on `variant === "desktop" && !isRdp`.
      - Mobile keeps touch-only (no onMouse* props bind).
      - Desktop RDP keeps right-click-only (no swipe).
      - Text-selection suppression via `user-select: none` on .pv-row--desktop
        in CSS (cleaner than preventDefault on every mousedown).
      - Past-threshold glow selectors widened from .pv-row--mobile to .pv-row.

      Tests: TSD1-TSD8 mirror TS1-TS7 (mobile) + add TSD8 for onMouseLeave.
      Full vitest suite green (mobile TS1-TS7 + panel TS-P1 unaffected).

    DO NOT push. DO NOT docker build. DO NOT deploy. DO NOT touch
    skynet-patches.md. STOP AT commit + green tests.
  </action>
  <verify>
    <automated>npx vitest run</automated>
  </verify>
  <done>
    - `npx vitest run` exits 0.
    - All eight TSD1-TSD8 tests pass.
    - All existing TS1-TS7 mobile tests still pass unchanged.
    - Panel-level TS-P1 test at PrettyConversationsPanel.test.tsx:2618 still
      passes unchanged.
    - No other test file in the repo regresses.
    - Three files modified (row component + row test + CSS), committed
      together with the vitest-green output in the commit body.
    - No push, no build, no deploy motion executed.
  </done>
</task>

</tasks>

<verification>
Reviewer checklist:
- [ ] `git diff` shows changes ONLY in the three files listed in
      `files_modified`. No other file touched. `skynet-patches.md` NOT
      touched.
- [ ] Touch handlers (`onTouchStart`, `onTouchMove`, `onTouchEnd`) in
      `PrettyConversationRow.tsx` are BYTE-IDENTICAL to their pre-change
      form (no PointerEvents unification, no ref renames, no timer changes).
- [ ] The four mouse handlers share `swipeStartRef`, `armedRef`,
      `disarmedRef`, `isSnappingRef`, `snapTimerRef`, `dxLive`,
      `resetSwipeGesture`, `beginSnapBack`, `clearSnapTimer`, and
      `suppressNextClickRef` with the touch handlers. No new refs
      introduced.
- [ ] Prop-wiring on the row body includes `onMouseDown={variant ===
      "desktop" && !isRdp ? onMouseDown : undefined}` and the three sibling
      lines. Mobile rows receive `undefined` for all four. Desktop RDP
      rows receive `undefined` for all four.
- [ ] Past-threshold glow CSS selector is now `.pv-row.swipe-past-
      threshold-*` (not `.pv-row.pv-row--mobile.swipe-past-threshold-*`).
- [ ] `.pv-row--desktop` block in CSS has `user-select: none` +
      `-webkit-user-select: none`. `.pv-row--mobile` block is unchanged.
- [ ] TSD1-TSD8 describe block present in `PrettyConversationRow.test.tsx`,
      placed between TS1-TS7 and S1-S2 blocks.
- [ ] `npx vitest run` exits 0.
- [ ] No push / no build / no deploy executed.
</verification>

<success_criteria>
- Desktop mouse-drag on a `.pv-row--desktop` row past the
  `Math.max(90, rowWidth * 0.35)` threshold fires the same composite the
  mobile touch swipe fires (right = pin+activate, left = unpin+deactivate),
  gated by the same idempotency check.
- The trailing browser click after a fired composite does NOT double-fire
  onSelect (verified by TSD1 + TSD3).
- Below-threshold release snaps back and preserves the tap-to-activate path
  (verified by TSD5).
- Vertical mouse drag never arms the swipe (verified by TSD6).
- RDP desktop rows have no swipe wiring at all (verified by TSD7).
- onMouseLeave mid-drag cancels the gesture without firing (verified by
  TSD8).
- Mobile touch swipe (TS1-TS7) and panel-level composite wiring (TS-P1)
  are unaffected — full vitest suite green.
- No files outside the three-file scope are modified. skynet-patches.md is
  untouched. No push / build / deploy motion.
</success_criteria>

<output>
Create `.planning/quick/260812-uxk-add-mouse-drag-swipe-on-pretty-conversat/260812-uxk-SUMMARY.md`
when done.
</output>
