---
phase: quick-260808-fkg
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
autonomous: true
requirements:
  - FKG-ROW-SWIPE-PIN-ACTIVATE

must_haves:
  truths:
    - "On mobile non-RDP pretty-conversation rows, a horizontal RIGHT swipe past threshold fires the composite pin+activate action: onTogglePin (only if !pinned) and onSelect (only if !inActiveSet), in that order, via the panel-level handleTogglePin + handleRowSelect handlers already wired to the row's onTogglePin + onSelect props."
    - "On mobile non-RDP pretty-conversation rows, a horizontal LEFT swipe past threshold fires the composite unpin+deactivate action: onTogglePin (only if pinned) and onDeactivate (only if inActiveSet), in that order, via the panel-level handleTogglePin + handleRowDeactivate handlers already wired to the row's onTogglePin + onDeactivate props."
    - "The row translates horizontally by (dx * 0.6) during an armed swipe, capped at ±(row width), and snaps back to translateX(0) with a 180ms cubic-bezier(.2,.9,.3,1) transition on release OR after the composite action fires."
    - "Past-threshold, the row body carries a `swipe-past-threshold-right` OR `swipe-past-threshold-left` className that paints a hue-tinted glow (right: hsla(var(--pv-hue),65%,55%,0.35) inset ring) OR a muted-cream glow (left: hsla(35,20%,60%,0.30) inset ring) — inside the row body only. NOTHING is painted behind the row. No persistent revealed strip. No new palette colors introduced beyond --pv-hue + the muted-cream tone which sits inside the existing --color-pv-fg-dim adjacency."
    - "A release BELOW threshold snaps back to translateX(0) with the same 180ms transition and fires NO composite action."
    - "A vertical drag (|dy| > |dx| OR |dx| < 8 at first touchmove) NEVER arms the swipe: no translate, no glow, no action fires, and vertical scroll proceeds uninterrupted."
    - "A short tap with total |dx| < 8 AND |dy| < 8 (swipe never armed AND long-press never fired) still fires onSelect exactly once via the existing tap-to-activate path."
    - "A swipe-right past threshold on an already-pinned-AND-inActiveSet row is a no-op: the row snaps back, NO onTogglePin call, NO onSelect call, NO haptic. Same for a swipe-left past threshold on a NOT-pinned-AND-NOT-inActiveSet row."
    - "RDP rows (isRdp === true) NEVER arm the swipe machinery: the swipe handlers early-return before any state mutation, matching the existing panel-side pin/deactivate exemption policy (rdpNoopTogglePin at PrettyConversationsPanel.tsx:1050)."
    - "The retired swipe-to-REVEAL machinery is NOT reintroduced. No `swipe-actions-visible-through-translucent-rows` class of bleed-through bug: nothing is painted behind the row, no persistent action strip is rendered, no PinAction/DeactivateAction imports are re-added to the row component."
    - "The context menu Pin/Unpin + Deactivate items remain 100% untouched — split-cases (pin-without-activate, activate-without-pin) still work through the menu at their existing one-tap cost."
    - "Tap-to-activate (short tap → onSelect via onBodyClick) is untouched."
    - "The mobile long-press → context menu path (500ms hold with <10px total movement) is untouched: the swipe machine and the long-press timer coexist by BOTH cancelling on their own movement threshold (long-press cancels on hypot>10, swipe arms on |dx|>=8 AND |dx|>|dy|). When the swipe arms, the long-press timer is also cleared so the two paths do not double-fire."
    - "Full suite `npx vitest run` exits 0 with zero failures."
  artifacts:
    - path: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx"
      provides: "Swipe-to-ACT state machine (mobile-only, non-RDP-only) wired to onSelect/onTogglePin/onDeactivate composites"
      contains: "swipe-past-threshold"
    - path: "src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx"
      provides: "TS1-TS7 swipe test coverage in a new describe block at the bottom of the file, following the TL1-TL5 fixture pattern (fake timers, touch event dispatch)"
      contains: "swipe past threshold"
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx"
      provides: "One integration test proving panel-level handleTogglePin + handleRowSelect + handleRowDeactivate compose correctly when triggered via row-level swipe callback wiring (no store-level bypass)"
      contains: "swipe composite"
  key_links:
    - from: "PrettyConversationRow.tsx swipe state machine"
      to: "props.onSelect + props.onTogglePin + props.onDeactivate"
      via: "composite guarded by !pinned / !inActiveSet / pinned / inActiveSet"
      pattern: "onTogglePin\\(\\)|onSelect\\(\\)|onDeactivate\\?"
    - from: "PrettyConversationsPanel.tsx row wiring (lines 941-999)"
      to: "handleTogglePin(row) + handleRowSelect(row) + handleRowDeactivate(row)"
      via: "existing prop wiring — no new props added"
      pattern: "handleTogglePin|handleRowSelect|handleRowDeactivate"
    - from: "PrettyConversationRow.tsx swipe machine touchmove handler"
      to: "clearLongPressTimer()"
      via: "shared movement-cancellation callback"
      pattern: "clearLongPressTimer"
---

<objective>
Add a row-swipe combined-action gesture to `PrettyConversationRow` on mobile (non-RDP) so a horizontal RIGHT swipe past threshold fires the composite pin+activate action and a horizontal LEFT swipe past threshold fires the composite unpin+deactivate action. Gesture is swipe-to-ACT (not swipe-to-reveal): threshold crossed → action fires immediately → row snaps back with a short spring transition. Nothing is painted behind the row.

Purpose: Ashley pins+activates together to keep a session at the top of the chat list while she works with it, and unpins+deactivates together when done. Currently both are separate context-menu actions (two taps on each end for the common case). This lands the two-tap → one-swipe collapse Ashley asked for in the bounty, while preserving the individual context-menu items for the split cases (pin-without-activate, activate-without-pin) at their existing one-tap cost.

Output: A swipe-to-act state machine added to `PrettyConversationRow.tsx`, wired to the existing `onTogglePin` + `onSelect` + `onDeactivate` props (which the panel already routes to `handleTogglePin` + `handleRowSelect` + `handleRowDeactivate` — no panel-side wiring changes). Seven new tests appended to `PrettyConversationRow.test.tsx` (TS1-TS7 describe block) covering threshold-cross behaviour, cancellation, idempotency, vertical-disambiguation, tap-vs-swipe disambiguation, and RDP exemption. One integration test appended to `PrettyConversationsPanel.test.tsx` proving the composite fires through the panel-level handlers (not through any store-level bypass). Full vitest suite green.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/ui/features/pretty-conversations/PrettyConversationRow.tsx
@src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
@src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx
@src/ui/features/pretty-conversations/tokens.ts
@src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
@src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
@src/ui/features/pretty-conversations/pretty-conversations.css
@src/ui/index.css

Prior context — READ these comment blocks in-file before touching the state machine:
- `PrettyConversationRow.tsx` header comment (lines 1-62): explains post-Phase-13 class-toggle model + retired `quick-260802-pq2` swipe machinery + the `swipe-actions-visible-through-translucent-rows` class of bug the retirement fixed.
- `PrettyConversationRow.tsx` long-press block (lines 244-339): the touch-handler contract you MUST coexist with — do NOT tear it out, do NOT double-fire it.
- `tokens.ts` (18 lines total): explains why `PC_SWIPE_*` tokens are gone and why the naming rule ("no token for a value used at one or two call sites") forbids reintroducing them for the swipe threshold constants — inline them at the call site.
- `PrettyConversationsPanel.tsx` around lines 664 + 684 + 619: the panel-level composite handlers (`handleRowDeactivate`, `handleTogglePin`, `handleRowSelect`) — DO NOT bypass these to hit the store directly.
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user touch → row DOM | untrusted gesture input crosses here; must not corrupt cross-row state |
| row → panel composite handler | trusted internal boundary; panel handlers own store mutations |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-fkg-01 | Tampering | swipe state refs (dxRef, armedRef) | mitigate | refs are per-row-instance (React `useRef`), disposed on unmount; touchend clears them unconditionally so a stale gesture cannot leak into the next touch sequence on the same row |
| T-fkg-02 | Denial of Service | rapid swipe spam firing repeated composite actions | mitigate | composite guards (`!pinned` / `!inActiveSet` / `pinned` / `inActiveSet`) render repeated same-direction swipes idempotent; the panel-level `handleTogglePin` already handles both id shapes and is safe to double-invoke; `handleRowSelect` is safe to double-invoke (addToActiveSet is a Set add) |
| T-fkg-03 | Information Disclosure | visual glow bleeding through translucent row backgrounds | mitigate | glow is painted INSIDE the row body via box-shadow inset (NOT behind the row), so it inherits the row's own alpha and cannot bleed through as the retired reveal-strip did; explicit acceptance-test asserts absence of any element sibling to `.pv-row` painting inside the wrapper |
| T-fkg-04 | Elevation of Privilege | swipe on RDP row triggering pin/deactivate (which RDP rows are exempt from) | mitigate | `isRdp` early-return in every swipe touch handler, mirroring `rdpNoopTogglePin` at PrettyConversationsPanel.tsx:1050 |
| T-fkg-SC | Tampering | npm installs | accept | no new packages installed by this plan (verify at commit time: `git diff package.json` empty for dependencies) |
</threat_model>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add swipe-to-act state machine to PrettyConversationRow (mobile non-RDP only), wired to existing onSelect/onTogglePin/onDeactivate composites</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationRow.tsx</files>
  <behavior>
    Add a swipe-to-ACT gesture layer alongside the existing long-press → context-menu layer. Both layers share the same onTouchStart/Move/End/Cancel handlers on the row body (they must coexist without double-firing).

    Locked design decisions (justify each briefly in a header comment block right above the swipe refs — following the doc discipline of the existing `quick-260802-pq2` long-press block at lines 244-266):

      1. THRESHOLD: `Math.max(90, rowWidth * 0.35)`. 35% of the row width for typical mobile column widths (~360-420px → ~126-147px), floored at 90px so an unusually narrow row still requires a real deliberate drag. Read `rowWidth` from a `useRef` on the row body element via `body.getBoundingClientRect().width` inside the touchStart handler (measure once per gesture — width does not change mid-drag). Inline the 90 + 0.35 constants at the call site per the tokens.ts naming rule (single call site → no token).

      2. VERTICAL-vs-HORIZONTAL DISAMBIGUATION: on the FIRST touchmove after touchStart, evaluate `Math.abs(dx) >= 8 && Math.abs(dx) > Math.abs(dy)`. If both true → arm the swipe machine for this touch sequence (armedRef = true), clear the long-press timer via clearLongPressTimer() so the two paths don't both fire. If NOT both true → set disarmedRef = true and NEVER arm the swipe for the remainder of this touch sequence (vertical scroll wins forever for this touch). If already armed OR already disarmed on subsequent touchmoves, skip the gate.

      3. VISUAL FEEDBACK DURING DRAG: while armed, translate the row body via `style={{ transform: `translateX(${dx * 0.6}px)` }}`, capped at ±rowWidth via Math.max/Math.min so the row cannot slide off. The 0.6 factor makes the drag feel viscous / resistive (matches iOS native swipe-to-delete feel). At-or-past threshold, add a `swipe-past-threshold-right` OR `swipe-past-threshold-left` className to the row body's className composition (via `cn(...)`). CSS rule painted INSIDE the row body via box-shadow inset — right: `hsla(var(--pv-hue),65%,55%,0.35)` (reuses existing --pv-hue), left: `hsla(35,20%,60%,0.30)` (muted-cream, inside the --color-pv-fg-dim adjacency at pretty-view palette line 158). NO element painted behind the row. NO persistent revealed strip. Add the CSS rules to `pretty-conversations.css` in a new "Swipe-to-act visual feedback (quick-260808-fkg)" block at the bottom of the file, keyed on `.pv-row.pv-row--mobile.swipe-past-threshold-right` / `.left`.

      4. CANCELLATION UX: on touchEnd (or touchCancel), if `|dx| < threshold` OR the swipe was never armed, snap the row back with `transition: transform 180ms cubic-bezier(.2,.9,.3,1)` applied inline (only during snap-back — not during drag, which would fight the raw translate). Implementation pattern: on touchEnd, if snapping back, set an `isSnappingRef = true`, apply the inline transition + `transform: translateX(0)`, and clear the flag after 200ms via setTimeout. During the snap-back window, no new touchStart can arm a swipe (guard on isSnappingRef at touchStart entry). Same 180ms transition applies AFTER a threshold-cross fires — snap-back + composite fire in the same touchEnd branch.

      5. IDEMPOTENCY: after threshold-cross detection, check `wouldChangeState`:
         - swipe-right (dx > 0): would-change iff `!pinned || !inActiveSet`
         - swipe-left  (dx < 0): would-change iff `pinned  ||  inActiveSet`
         If wouldChangeState is FALSE → snap back with the 180ms transition, fire NO callbacks, NO navigator.vibrate. Silent no-op keeps the affordance quiet when there is nothing to do — bounce would falsely imply action fired. If wouldChangeState is TRUE → fire the composite (see semantics below) AND navigator.vibrate?.(10) (feature-checked, same pattern as long-press at line 292) AND snap back.

      6. TAP-vs-SWIPE DISAMBIGUATION: a touchEnd where the swipe was NEVER armed (armedRef stayed false because the vertical-vs-horizontal gate never passed OR |dx| stayed < 8 throughout) leaves the existing tap path 100% intact: the row body's onClick handler continues to fire onSelect via onBodyClick as it does today. The swipe machine adds NO onClick suppression when it never armed. When the swipe DID arm and fire a composite, the trailing synthesized click (real browsers only — jsdom does not synthesize) is suppressed via `suppressNextClickRef.current = true` (reuses the same ref the long-press already uses at line 268 + read/reset at line 348).

    Composite action semantics (verbatim from the task description — implement exactly):

      - Swipe-RIGHT composite = "make it pinned AND active":
          if (!pinned)      props.onTogglePin();
          if (!inActiveSet) props.onSelect();
        Both idempotent guards individually. Order: onTogglePin FIRST so pinned state lands before onSelect triggers any re-render that would depend on it. Do NOT call the store directly — use the props, which the panel routes to handleTogglePin(row) + handleRowSelect(row) at PrettyConversationsPanel.tsx:942/997/1098.

      - Swipe-LEFT composite = "remove pin AND deactivate":
          if (pinned)      props.onTogglePin();
          if (inActiveSet) props.onDeactivate?.();
        Both idempotent guards individually. Order: onTogglePin FIRST (same rationale). Use `props.onDeactivate?.()` with optional-chaining because the prop is optional per the row's interface (line 132) — the panel only threads it when the row can be in the active-set. When onDeactivate is undefined AND inActiveSet is true, the composite still fires onTogglePin for the pinned half; the deactivate half becomes a no-op (matches the existing menu-side pattern at line 661 where the Deactivate menuitem is filtered out unless both inActiveSet AND onDeactivate are truthy).

    RDP EXEMPTION: at the very top of every swipe touch handler (start/move/end/cancel), early-return if `isRdp === true`. Matches the existing pin/deactivate exemption policy (`rdpNoopTogglePin` at PrettyConversationsPanel.tsx:1050 + onDeactivate omission at the RDP render site at line 1051-onward). RDP rows still get the long-press → context menu path (per quick-260804-uo4).

    NON-RDP MOBILE-ONLY GATE: the swipe handlers must NOT wire on desktop variant (same gate the long-press already uses — `if (!isMobile) return;` at the top of each handler). Desktop keeps its right-click context menu path untouched.

    CO-EXISTENCE WITH LONG-PRESS: both machines share the same onTouchStart/Move/End/Cancel handlers on the row body. On touchStart: BOTH arm (long-press timer + swipe start refs). On touchMove: whichever movement gate trips first wins — long-press hypot > 10 cancels its timer AND leaves the swipe gate open; swipe |dx| >= 8 && |dx| > |dy| arms the swipe AND clears the long-press timer via clearLongPressTimer(). On touchEnd: both drain (long-press clears any pending timer; swipe evaluates threshold-cross and snaps back). Neither machine calls onSelect when it triggered — long-press sets suppressNextClickRef.current = true; swipe sets the same ref when it fired a composite.

    STATE MACHINE REFS (all `useRef`, none of them setState — no re-renders during drag except the inline style update which is a direct DOM write via a state variable so it DOES re-render; use `useState<number | null>(null)` for `dxLive` so React re-renders on each touchmove — this matches the retired pq2 machinery's dxLive state and is acceptable performance-wise per the pq2 retrospective which cited BLEED-THROUGH not performance as the retirement reason):
      - swipeStartRef: { x: number; y: number; rowWidth: number } | null
      - armedRef: boolean         — true iff vertical-vs-horizontal gate passed
      - disarmedRef: boolean      — true iff gate failed (fixed for this touch)
      - isSnappingRef: boolean    — true during the 180ms snap-back window
      - dxLive: number | null (useState)  — current horizontal offset for the inline transform

    RENDER-TREE WIRING: pass swipe touch handlers via onTouchStart/Move/End/Cancel — reuse the SAME handler names the long-press wired at PrettyConversationRow.tsx lines 424-427. Merge the two machines into a single onTouchStart/Move/End callback each (i.e. compose long-press + swipe logic inside one handler function, not add second event listeners). Order inside the merged handler: long-press first (arm/cancel timer), swipe second (arm/measure/translate). This keeps the render tree identical to today (same four onTouch* props on the row body).

    INLINE STYLE: extend `bodyStyle` at line 388 to also merge in `transform: translateX(${dxLive}px)` (only when dxLive is non-null; when null, no transform key at all so the default CSS applies). When isSnappingRef is true, also include `transition: 'transform 180ms cubic-bezier(.2,.9,.3,1)'`; when false, omit the transition key so the raw translate follows the finger without a fight.

    CN COMPOSITION: extend the `rowClassName` at line 369 to conditionally include `swipe-past-threshold-right` (when armed AND dxLive !== null AND dxLive >= threshold) OR `swipe-past-threshold-left` (when armed AND dxLive !== null AND dxLive <= -threshold). These classes drive the hue-tinted / muted-cream inset ring in `pretty-conversations.css`.

    Do NOT reintroduce PC_SWIPE_* tokens in `tokens.ts` — the naming rule at tokens.ts:12-16 forbids tokens for single-call-site values, and the swipe threshold is a single call site now.

    Do NOT reintroduce PinAction / DeactivateAction imports (they were retired in quick-260802-pq2 — the header comment at line 55-57 lists them explicitly as "only rendered inside the retired strip"). The composites use props, not action components.

    Do NOT paint anything behind the row. The action-strip painted-behind-the-row bleed-through class of bug (`swipe-actions-visible-through-translucent-rows`) is the SINGLE hardest constraint on this quick — every visual affordance must live INSIDE the `.pv-row` element via box-shadow inset / border / color, never as an absolutely-positioned sibling under it.

    Header comment discipline: prepend a "quick-260808-fkg" block above the swipe refs following the shape of the existing `quick-260802-pq2` long-press block (lines 244-266). Include: retirement history (why the pq2 strip died, why this doesn't repeat it), the six locked design decisions with their justifications, and the co-existence contract with long-press.
  </behavior>
  <action>Add the swipe-to-act state machine to PrettyConversationRow.tsx per the behavior block above. Merge into the existing onTouch* handlers; add dxLive state; extend rowClassName and bodyStyle; add CSS rules to pretty-conversations.css for the two `swipe-past-threshold-*` classes (hue-tinted right, muted-cream left, both box-shadow inset, no elements painted behind the row). Preserve tokens.ts (do NOT reintroduce PC_SWIPE_* constants — inline the 90 / 0.35 / 8 / 180 numbers at the call site per the tokens.ts naming rule at lines 12-16). Preserve every existing behavior: tap-to-activate, long-press → context menu, RDP long-press → context menu, desktop right-click → context menu. NO panel-side changes (PrettyConversationsPanel.tsx untouched — the row uses the props the panel already wires at lines 942/997/1051/1098/1157).</action>
  <verify>
    <automated>npx vitest run src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx</automated>
  </verify>
  <done>PrettyConversationRow.tsx compiles under `npx tsc --noEmit` (indirectly via vitest transform), the existing 18+ tests in PrettyConversationRow.test.tsx still pass unchanged, the row body carries the two conditional swipe-past-threshold-* classes correctly during simulated touch sequences, and the composite action fires through the existing onTogglePin/onSelect/onDeactivate props (verified by Task 2's tests).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add TS1-TS7 swipe-behavior tests to PrettyConversationRow.test.tsx + one panel-composite integration test to PrettyConversationsPanel.test.tsx</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx, src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx</files>
  <behavior>
    Append a new describe block to `PrettyConversationRow.test.tsx` at the bottom of the file, AFTER the TL1-TL5 long-press block and AFTER the UO1-UO6 open-in-new-window block. Block title: `PrettyConversationRow: mobile swipe-to-act (quick-260808-fkg)`. Follow the TL1-TL5 fixture pattern verbatim: `vi.useFakeTimers()` in beforeEach, `vi.useRealTimers()` in afterEach, `fireEvent.touchStart/touchMove/touchEnd` with explicit `touches: [{ clientX, clientY } as Touch]` arrays, `act(() => vi.advanceTimersByTime(...))` for the snap-back window, `screen.getByRole('menu')` / `screen.queryByRole('menu')` for menu assertions.

    Fixture note: `container.querySelector('[data-conversation-id="conv-1"]')` → wrapper, `wrapper.querySelector('[role="button"]')` → row body. rowWidth defaults to 0 in jsdom (no layout engine), so the swipe threshold `Math.max(90, rowWidth * 0.35)` collapses to 90 in tests — tests use `clientX` deltas of 100+ for past-threshold and 40 for below-threshold, which lands consistently on either side of 90.

    TS1 — Swipe-right past threshold on ambient-unpinned row fires BOTH composites:
      Setup: pinned=false, inActiveSet=false, variant="mobile", onSelect=vi.fn(), onTogglePin=vi.fn(), onDeactivate=vi.fn().
      Sequence: touchStart at (100, 100) → touchMove at (150, 102) [arms the swipe: dx=50, dy=2, |dx|>|dy| && |dx|>=8] → touchMove at (210, 105) [dx=110 > 90 threshold] → touchEnd.
      act(vi.advanceTimersByTime(200)) to flush the snap-back timer.
      Assert: onTogglePin called exactly once, onSelect called exactly once, onDeactivate NOT called.

    TS2 — Swipe-right past threshold on already-pinned-AND-inActiveSet row is a no-op:
      Setup: pinned=true, inActiveSet=true, onSelect=vi.fn(), onTogglePin=vi.fn(), onDeactivate=vi.fn().
      Sequence: same touchStart→touchMove→touchMove→touchEnd as TS1.
      Assert: onTogglePin NOT called, onSelect NOT called, onDeactivate NOT called.

    TS3 — Swipe-left past threshold on active-pinned row fires BOTH composites:
      Setup: pinned=true, inActiveSet=true, onSelect=vi.fn(), onTogglePin=vi.fn(), onDeactivate=vi.fn().
      Sequence: touchStart at (200, 100) → touchMove at (150, 102) [arms: dx=-50, dy=2] → touchMove at (90, 105) [dx=-110, |dx|=110 > 90 threshold, past-left] → touchEnd.
      act(vi.advanceTimersByTime(200)) to flush snap-back.
      Assert: onTogglePin called exactly once, onDeactivate called exactly once, onSelect NOT called.

    TS4 — Release BELOW threshold fires NEITHER action, row snaps back:
      Setup: pinned=false, inActiveSet=false, onSelect=vi.fn(), onTogglePin=vi.fn(), onDeactivate=vi.fn().
      Sequence: touchStart at (100, 100) → touchMove at (135, 102) [dx=35 arms swipe, |dx|=35 < 90 threshold] → touchEnd.
      act(vi.advanceTimersByTime(200)).
      Assert: onSelect NOT called, onTogglePin NOT called, onDeactivate NOT called.

    TS5 — Vertical drag never arms the swipe, no action fires:
      Setup: pinned=false, inActiveSet=false, onSelect=vi.fn(), onTogglePin=vi.fn(), onDeactivate=vi.fn().
      Sequence: touchStart at (100, 100) → touchMove at (105, 150) [dx=5, dy=50, |dy|>|dx| → swipe disarmed for remainder] → touchMove at (200, 150) [dx=100 but disarmed sticks → no arm] → touchEnd.
      act(vi.advanceTimersByTime(200)).
      Assert: onSelect NOT called, onTogglePin NOT called, onDeactivate NOT called, no menu opened.

    TS6 — Small horizontal jitter during a tap still fires onSelect (swipe never armed):
      Setup: pinned=false, inActiveSet=false, onSelect=vi.fn(), onTogglePin=vi.fn(), onDeactivate=vi.fn().
      Sequence: touchStart at (100, 100) → touchMove at (104, 101) [dx=4, dy=1, |dx| < 8 → gate fails, swipe NOT armed] → touchEnd.
      fireEvent.click on the body (matching TL3 pattern — jsdom does not synthesize).
      Assert: onSelect called exactly once, onTogglePin NOT called, onDeactivate NOT called.

    TS7 — RDP row swipe handlers early-return (no action fires):
      Setup: row = makeRow({ rdpHostRow: true, targetTmuxSession: null }), pinned=false, inActiveSet=false, onSelect=vi.fn(), onTogglePin=vi.fn(). No onDeactivate (RDP rows do not receive it at the panel level, but even if we pass one it must not fire).
      Sequence: touchStart at (100, 100) → touchMove at (210, 100) [dx=110 past threshold on non-RDP row] → touchEnd.
      act(vi.advanceTimersByTime(200)).
      Assert: onTogglePin NOT called, onSelect NOT called.

    Then in `PrettyConversationsPanel.test.tsx`, append ONE integration test to the existing swipe/gesture / row-composite neighborhood (find the last describe block that renders `<PrettyConversationsPanel>` directly and append after it, OR add a new describe block at the bottom titled `PrettyConversationsPanel: mobile row-swipe composite wiring (quick-260808-fkg)`):

    TS-P1 — Swipe-right past threshold on a mobile pretty-conversations panel row wires through the panel-level composite handlers (handleTogglePin + handleRowSelect), NOT through the store directly:
      Setup: render a full `<PrettyConversationsPanel variant="mobile" ... />` with a fixture row that is initially NOT pinned AND NOT in active-set. Use existing mocks in the file for the conversation-store + identities-store + working-store shape.
      Sequence: find the row via `data-conversation-id`, then the role="button" body, dispatch the same touchStart→touchMove→touchMove→touchEnd sequence as TS1 with clientX deltas past 90.
      act(vi.advanceTimersByTime(200)) for snap-back flush.
      Assert: `pinConversation` (or equivalent store action) was called once with the row's canonical pin id (matching the shadowFleetId-or-openTabId shape emitted by handleTogglePin at PrettyConversationsPanel.tsx:696), AND `addToActiveSet` was called once with row.id (matching handleRowSelect at line 622), AND `selectConversation` was called once with row.id. This proves the swipe-right composite composes through the panel-level handlers, not through any store bypass in the row.

    Test discipline notes:
    - Add module-level comment above the new describe block explaining what TS1-TS7 cover, mirroring the TL1-TL5 header comment at line 1086-1099 of PrettyConversationRow.test.tsx.
    - The row's threshold `Math.max(90, rowWidth * 0.35)` collapses to 90 in jsdom because getBoundingClientRect returns 0 widths. All test dx values are chosen with the 90 constant in mind (past = 100+, below = 40 or less).
    - `vi.useFakeTimers()` is required because the snap-back path uses setTimeout(200) to clear isSnappingRef. Without fake timers, the tests would either race the timer or hang waiting for it.
    - Do NOT mock `navigator.vibrate` in TS1-TS7 unless a test explicitly asserts on it. The vibrate call is optional-chained in the row and inert when absent (same pattern as TL5b). If a follow-up test needs vibrate assertion, mirror TL5a's spy pattern.
  </behavior>
  <action>Append the TS1-TS7 describe block to `PrettyConversationRow.test.tsx` at the bottom of the file with the exact test bodies specified in the behavior block. Then append TS-P1 to `PrettyConversationsPanel.test.tsx` in the appropriate describe neighborhood. Use the existing fixture helpers (`makeRow`, `makeIdentity`, `makeHost`) and the existing mock patterns (`currentIdentity`, `vi.mock('@/state/identities-store', ...)`) verbatim. Do NOT modify any existing test — the new block is strictly additive.</action>
  <verify>
    <automated>grep -v '^\s*//' src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx | grep -c "swipe-past-threshold\|TS1\|TS2\|TS3\|TS4\|TS5\|TS6\|TS7" | awk '$1 >= 7 {exit 0} {exit 1}' && grep -v '^\s*//' src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx | grep -c "swipe composite\|TS-P1\|quick-260808-fkg" | awk '$1 >= 1 {exit 0} {exit 1}' && npx vitest run src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx</automated>
  </verify>
  <done>Seven new TS* tests present in PrettyConversationRow.test.tsx (grep-verified, comment-filtered so header prose does not falsely satisfy the gate), one new TS-P1 test present in PrettyConversationsPanel.test.tsx, both test files pass under `npx vitest run` with zero failures, and the tests demonstrably lock the six design decisions from Task 1 (threshold, vertical/horizontal disambiguation, visual feedback via class assertion, cancellation snap-back, idempotency, tap-vs-swipe disambiguation).</done>
</task>

<task type="auto">
  <name>Task 3: Full suite green + on-branch commit</name>
  <files>(no code files — verification + commit only)</files>
  <action>Run the full vitest suite via `npx vitest run` from the project root. If any tests fail (including pre-existing failures unrelated to this quick), fix them in this quick — box-maintainer standing directive is never leave tests failing. Once the suite exits 0 with zero failures, stage the touched files (`PrettyConversationRow.tsx`, `pretty-conversations.css`, `PrettyConversationRow.test.tsx`, `PrettyConversationsPanel.test.tsx`) alongside the PLAN.md + SUMMARY.md (commit_docs=true), and create a single commit on the current branch (`feat/tab-title-from-tmux`) with a message following the repo's conventional prefix style (e.g. `feat(pretty-conversations): add row-swipe combined pin+activate / unpin+deactivate on mobile (quick-260808-fkg)`). Include a co-author trailer if the repo convention has one; otherwise omit. DO NOT push, DO NOT rebase, DO NOT build docker images, DO NOT run docker compose up — this is a multi-identity branch and orchestrator handles cross-identity coordination after commit. Do NOT touch `~/.claude/roles/box-maintainer/skynet-patches.md` or the bounty file in `~/.claude/roles/box-maintainer/bounties/` — the orchestrator updates those after the quick completes.</action>
  <verify>
    <automated>npx vitest run 2>&1 | tail -5 | grep -q "Test Files.*passed" && git log -1 --pretty=%s | grep -q "quick-260808-fkg\|row-swipe\|swipe.*pin"</automated>
  </verify>
  <done>Full vitest suite exits 0 with zero failures, all four touched files + PLAN.md + SUMMARY.md are committed as a single commit on `feat/tab-title-from-tmux`, no push / build / deploy side-effects occurred, and `~/.claude/roles/box-maintainer/` was left untouched.</done>
</task>

</tasks>

<verification>
Overall phase checks after all three tasks land:
  1. `npx vitest run` exits 0 with zero failures.
  2. `grep -rn "swipe-actions-visible-through-translucent-rows" src/ui/features/pretty-conversations/` still matches ONLY in comment blocks that document the RETIRED prior machinery — never as an active class name or CSS selector.
  3. `grep -n "PC_SWIPE_" src/ui/features/pretty-conversations/tokens.ts` returns nothing (tokens.ts remains header-only per its naming rule at lines 12-16).
  4. `grep -n "swipe-past-threshold" src/ui/features/pretty-conversations/PrettyConversationRow.tsx src/ui/features/pretty-conversations/pretty-conversations.css` returns matches in BOTH files (row emits the class; CSS defines the visual response).
  5. `grep -c "swipe-past-threshold\|TS1\|TS2\|TS3\|TS4\|TS5\|TS6\|TS7" src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` returns >= 7 (test names + assertion strings; comment-filtered before counting per the grep-gate hygiene rule).
  6. `git log -1 --pretty=%s` shows a single commit tagged with the `quick-260808-fkg` marker on `feat/tab-title-from-tmux`.
  7. `git status` is clean (nothing left uncommitted).
</verification>

<success_criteria>
  - Swipe-right past threshold on an ambient-unpinned mobile pretty-conversation row triggers pin+activate through the panel's `handleTogglePin` + `handleRowSelect` handlers (proven by TS1 + TS-P1).
  - Swipe-left past threshold on an active-pinned mobile row triggers unpin+deactivate through the panel's `handleTogglePin` + `handleRowDeactivate` handlers (proven by TS3).
  - Swipe on an already-both-set row (right on pinned+active, left on unpinned+inactive) is a silent no-op (proven by TS2 + symmetric coverage in TS3-adjacent behavior).
  - Release below threshold snaps the row back with the 180ms cubic-bezier transition and fires no callback (proven by TS4).
  - Vertical drags never arm the swipe machine (proven by TS5) — vertical scroll works uninterrupted on a real device.
  - Small horizontal jitter during a tap still fires onSelect via the existing tap-to-activate path (proven by TS6).
  - RDP rows are exempt from the swipe machine (proven by TS7) — matches the existing pin/deactivate exemption policy.
  - The context menu Pin/Unpin + Deactivate items remain functionally untouched (proven by the untouched Test 8 in PrettyConversationRow.test.tsx and the untouched context-menu tests in PrettyConversationContextMenu.test.tsx passing green).
  - The retired swipe-to-reveal action-strip machinery is NOT reintroduced — no elements painted behind the row, no persistent revealed strip, no PinAction/DeactivateAction imports in the row component (verified by inspection + verification check #2).
  - Full `npx vitest run` exits 0 with zero failures on `feat/tab-title-from-tmux`.
  - Single on-branch commit produced; no push / docker build / docker compose up executed.
</success_criteria>

<output>
Create `.planning/quick/260808-fkg-add-row-swipe-combined-actions-on-pretty/260808-fkg-SUMMARY.md` when done. Follow the standard summary template: what changed, why, files touched, tests added, design decisions locked with brief justification, and any residual known-limitations for the follow-up quick(s) — noting explicitly that desktop hover-swipe / pointer-drag desktop support is a deliberate deferred non-goal per the bounty ("Mobile PWA only initially; desktop can be a follow-up if wanted").
</output>
