---
phase: quick-260723-agy
plan: 01
subsystem: pretty-conversations
tags: [patch-136, pretty-view, visual-restyle, wip-render-slot, fork]
requires: []
provides:
  - PATCH-136-BUBBLE-EVERY-ROW
  - PATCH-136-AVATAR-BADGE
  - PATCH-136-WIP-DOT-SLOT
  - PATCH-136-PANEL-PROP-THREAD
  - PATCH-136-KEYFRAMES-REDUCED-MOTION
affects:
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
  - src/ui/index.css
tech-stack:
  added: []
  patterns:
    - "IdentityBadge-lg-derived avatar disc (linear-gradient + hue border + multi-stop shadow) replaces prior radial-gradient"
    - "Full pretty-view assistant-bubble treatment (0.55/0.60 gradient, 0.32 hue border, 0 8px 24px + inset + 0.5px hairline + 32px hue glow) applied to EVERY hue-carrying row (not selected-only)"
    - "Hover/selected overlays layered on top of base bubble (translateY(-1px) + stronger alphas + expanded glow)"
    - "Same-file WIP render slot via optional `isWip?: boolean` prop; animated via CSS keyframes with `[data-pv-conv-wip-dot]` attribute selector for reduced-motion targeting (no global class coupling)"
key-files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
    - src/ui/index.css
decisions:
  - "Attribute selector `[data-pv-conv-wip-dot='true']` instead of a class name for the reduced-motion fallback — avoids coupling to a class Ashley hasn't sanctioned, keeps the render slot self-contained."
  - "Base+overlay composition (`baseBodyStyle` → `hoverOverlay` → `selectedOverlay` → `bodyTransformStyle` merged via spread) rather than a single IIFE per state — makes hover/selected precedence explicit at the merge point."
  - "Local `hovered` useState + `onMouseEnter`/`onMouseLeave` handlers (desktop-only, unselected-only) rather than Tailwind arbitrary group-hover variants — Tailwind's arbitrary-value pseudo-classes can't cleanly express the multi-stop shadow tuples patch #136 uses."
  - "Desktop-only body `transition` (transform + box-shadow + border-color + background, 160ms ease) — mobile's `bodyTransformStyle` spreads last so its own swipe transition (transform 180ms ease) wins on mobile without collision."
  - "Panel threads `isWip={false}` as a hardcoded literal at all 3 render sites — no store subscription, no conditional — so patch #137 is provably a one-line data-wiring diff (per plan objective + threat model T-quick136-02 acceptance)."
metrics:
  duration_seconds: 402
  duration_human: "6m 42s"
  completed: 2026-07-23
---

# quick-260723-agy Patch #136: Conversation-list Full Pretty-view Bubble + Badge Restyle

## One-liner

Patch #136 restyles every `PrettyConversationRow` (not only the selected one) to Ashley's locked v2 pretty-view assistant-bubble intensity, rebases the avatar disc onto IdentityBadge.tsx's lg linear-gradient badge (radial-gradient retired), and lands a bare-glyph WIP pulse-dot render slot (`isWip` prop + `pv-conv-wip-pulse` keyframes with prefers-reduced-motion fallback) that patch #137 will wire to the store as a one-line data diff.

## What Changed

### `src/ui/index.css` (+29 / -0)

- New `@keyframes pv-conv-wip-pulse`: 0.85→1.15 scale + 0.4→1.0→0.4 opacity across `0%, 100%` and `50%`. Duration and easing set at the call site (`1.35s ease-in-out infinite` in the row's inline style).
- New `@media (prefers-reduced-motion: reduce)` block targeting `[data-pv-conv-wip-dot="true"]` with `animation: none !important; opacity: 1; transform: scale(1);` — dot stays visible as a static bright dot for users with the OS reduced-motion flag.
- Co-located with the existing pretty-view palette tokens (`@theme inline` block ends line 152). Existing tokens byte-identical.

### `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` (+230 / -49)

- **Prop signature:** added optional `isWip?: boolean` (default `false`) after `forceClosed`.
- **Avatar style (was radial-gradient):** rebuilt as `linear-gradient(160deg, hsla(H,45%,25%,0.72), hsla(H,40%,15%,0.82))` with `1px solid hsla(H,65%,55%,0.40)` border and the three-stop shadow `0 4px 12px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,235,190,0.35), 0 0 24px hsla(H,65%,55%,0.40)` — adapted from `IdentityBadge.tsx:58-62 & :76`. RDP branch: `rgba(60,65,80,0.72) → rgba(30,33,44,0.82)`, cool-cream border/shadow. Fallback (hue==null): `rgba(45,55,80,0.72) → rgba(28,35,55,0.82)` cool-slate.
- **Body-bubble style (was selected-only 0.30/0.35):** every hue-carrying non-RDP row now renders `linear-gradient(160deg, hsla(H,50%,38%,0.55), hsla(H,45%,24%,0.60))` background + `1px solid hsla(H,65%,55%,0.32)` border + `0 8px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,220,170,0.18), 0 0 0 0.5px hsla(H,70%,55%,0.20), 0 0 32px hsla(H,70%,52%,0.18)` shadow. RDP branch: cool-cream neutral. Fallback: cool-slate (45,55,80/28,35,55) at the same 0.55/0.60 alphas (bumped from prior 0.30/0.35). All rows get `borderRadius: 14`, `color: "#fbf5e8"`, `backdropFilter: blur(20px) saturate(1.5)`.
- **Hover overlay (desktop, unselected):** local `useState` `hovered` toggled by `onMouseEnter`/`onMouseLeave`. When true, overlays `translateY(-1px)` + 0.42 border alpha + 0.28 hairline + 0.26 glow + `0 12px 28px` outer / 40px glow.
- **Selected overlay:** `translateY(-1px)` + 0.55 border alpha + `1px` hue ring (was `0.5px`) + `0 14px 32px` outer / 56px glow. Layers on top of `baseBodyStyle` + `hoverOverlay` via spread; wins because it's spread last (before the mobile transform).
- **Body transition:** desktop-only `transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease` — smooths hover/select lift. Mobile's `bodyTransformStyle` spreads last so its own swipe `transition: transform 180ms ease` wins on mobile without collision.
- **Label + host secondary line:** label switched to `font-semibold` + `text-[#fbf5e8]` (dropped the ternary that flipped between `text-[#fbf5e8]` / `text-foreground`) + inline `textShadow: "0 1px 2px rgba(0,0,0,0.4)"`. Host icon + name colored `rgba(255,235,190,0.65)` inline (warmer than prior `text-muted-foreground/60`).
- **bodyBaseClass:** dropped `border border-transparent` (border now set in inline `bodyStyle`) and dropped `hover:bg-white/[0.03]` / `active:bg-white/[0.03]` fragments (hover treatment now lives on the bubble shadow/lift, not a translucent overlay). Now: ``${rowMinH} ${rowPadding} flex items-center ${rowGap} cursor-pointer select-none relative z-10``.
- **WIP dot render slot:** when `isWip === true`, renders `<span aria-label="working" data-pv-conv-wip-dot="true" class="inline-block w-2 h-2 rounded-full">` as the LAST child in the right-meta column (after pin glyph and after desktop PinAction slot). Background `hsla(H,85%,65%,0.95)` (or `rgba(220,225,245,0.95)` neutral). Two-stop glow shadow `0 0 10px 1px hsla(H,85%,55%,0.85), 0 0 20px 2px hsla(H,85%,55%,0.35)` (neutral analog). Inline `animation: "pv-conv-wip-pulse 1.35s ease-in-out infinite"`.
- **Preserved verbatim:** swipe state machine, `forceClosed`, `effectiveOpen`, `onSwipeOpenChange`, keyboard `Enter`/`Space` handling, `aria-pressed`, `data-conversation-id` / `data-selected` / `data-pinned` / `data-variant` / `data-rdp-host-row` / `data-swiped-open` attributes, PinAction slots (mobile swipe strip + desktop hover-reveal), RDP row exclusion (T-Test-34), no-identity tabIcon fallback path.

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (+7 / -0)

- Added `isWip={false}` as a hardcoded literal at all 3 `<PrettyConversationRow>` render sites: pinned list (line 286), regular-host grouped rows (line 355), RDP-sentinel grouped rows (line 330).
- Anchor comment above the first render site marks it as the patch-#136 render slot and patch-#137 wiring point.
- No store subscription, no import changes, no conditional — patch #137 will one-line-change each `false` to `isRowWip(row.id)` (or equivalent).

### `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` (+108 / -3)

- Header count updated `11 tests → 14 tests` with 3 new bullet lines describing coverage.
- **Test 12** — Unselected non-RDP row with hue renders full hue-bubble body style. Reads raw `style` attribute; asserts (a) `background` contains `linear-gradient(160deg, ` with `0.55` outer + `0.6` inner alpha stops (regex-based to survive jsdom's hsla→rgba normalization inside gradient functions), (b) `box-shadow` contains `hsla(210,` (jsdom preserves hsla in the shadow context — proves the hue was interpolated, not defaulted to the neutral branch). Locks the "every-row-gets-the-bubble" invariant.
- **Test 13** — `isWip={true}` renders pulse dot with `aria-label="working"` and `data-pv-conv-wip-dot="true"` attribute; asserts `dot.style.animation` contains `pv-conv-wip-pulse`. Locks a11y + reduced-motion selector wiring.
- **Test 14** — `isWip={true}` on a hue-null RDP row (`rdpHostRow: true, targetTmuxSession: null`, `currentIdentity: null`) uses `rgba(220,225,245,…)` background; asserts NO `hsla(` substring anywhere in the dot's style. Defensive lock on the neutral branch.
- All 15 file-level tests pass (12 pre-existing including Test 7b nested + 3 new).

## Verification

Ran per plan:

```
$ npm run test -- PrettyConversationRow --run
 Test Files  1 passed (1)
      Tests  15 passed (15)

$ npm run test -- pretty-conversations --run
 Test Files  2 passed (2)
      Tests  30 passed (30)

$ npx tsc --noEmit
(exit=0, no output)
```

All plan verify gates pass:

- Task 1: `grep -q "pv-conv-wip-pulse" src/ui/index.css && grep -q "prefers-reduced-motion" src/ui/index.css && grep -q "data-pv-conv-wip-dot" src/ui/index.css` → PASS
- Task 2: `isWip` prop threaded (row + panel); `linear-gradient(160deg, hsla(` present in row; panel matches `isWip=\{false\}` → PASS (3 render sites + 1 anchor comment mention)
- Task 3: `npm run test -- PrettyConversationRow --run` all green (15 tests) → PASS

## Deviations from Plan

None — plan executed as written with two implementation clarifications documented as decisions above:

1. Test 12 hue-interpolation assertion switched from `linear-gradient(160deg, hsla(210,` to a two-part check `linear-gradient(160deg, ` regex-with-alphas + `hsla(210,` in raw style — jsdom's CSSOM normalizes `hsla(...)` → `rgba(...)` INSIDE gradient functions but preserves it in `box-shadow` context. The two-part probe locks the same invariant (hue was interpolated end-to-end) while surviving jsdom's normalization semantics.
2. File tallies 15 test cases not 14 — Test 7 has an `it("Test 7b: ...")` sibling nested in the same `describe` block. Plan's "14 tests" count referenced the semantic test list; actual `it()` count is 15 with Test 7b preserved verbatim.

## Threat Flags

None — patch #136 adds no new trust boundaries beyond the two already documented in the plan's `<threat_model>`:

- Runtime `hue` interpolation into inline CSS strings via `${hue}` (T-quick136-01): mitigated verbatim (identity.colorHue is `number | null`, TypeScript-enforced; existing pattern in `IdentityBadge.tsx:58-62` + `ChatMessage.tsx:124-127`).
- `pv-conv-wip-pulse` animation on rows (T-quick136-02): accepted (all 3 render sites pass `isWip={false}` this patch; animation never fires; patch #137 will enforce at-most-one-WIP-row invariant at the store).

No new network endpoints, no new auth paths, no new file access patterns, no new schema/trust boundaries introduced.

## Known Stubs

None. The `isWip={false}` hardcoded literal at all 3 panel render sites is the documented, plan-sanctioned render slot for patch #137's data wiring — NOT a stub. The rendered UI never shows a WIP dot in patch #136 because `isWip` is always false; that is the correct end state until #137 lands.

## Batched-Deploy Compliance

- ✅ No `npm run build` executed
- ✅ No `docker compose up` or container recreate
- ✅ No touch to `~/.claude/identities/tina/skynet-patches.md`
- ✅ Single commit on `feat/tab-title-from-tmux` (SHA `1b057ad`)
- ✅ No `Co-Authored-By` trailer (fork convention)
- ✅ Only the 4 files in the plan's file list modified

## Self-Check: PASSED

- `src/ui/index.css` present with `pv-conv-wip-pulse` + `prefers-reduced-motion` + `data-pv-conv-wip-dot` (grep gates)
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` present with `isWip` prop + `pv-conv-wip-pulse` animation string + hue linear-gradient body
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` present with `isWip={false}` at all 3 render sites (lines 286, 330, 355)
- `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` present with Tests 12/13/14; all 15 tests pass
- Commit `1b057ad` found in `git log` on `feat/tab-title-from-tmux`
