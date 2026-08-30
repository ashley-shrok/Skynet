---
phase: 09-compose-box-redesign-2-tall-shell
plan: "02"
subsystem: ComposeBox / pretty-view
tags: [layout, meter, horizontal-rotation, css-vars, compose-box, ui]
dependency_graph:
  requires:
    - 09-01 (2-row shell JSX restructure — meter well moved into Row 1)
  provides:
    - Horizontally-rotated segmented context meter with CSS-var-tunable width and segment count
  affects:
    - src/ui/features/pretty-view/ComposeBox.tsx
tech_stack:
  added: []
  patterns:
    - "CSS custom properties --seg-count / --meter-width on inline style for DevTools-live tuning"
    - "as React.CSSProperties cast for CSS custom properties (matches pattern in PrettyView.tsx --pv-id-hue)"
    - "w-[var(--meter-width)] arbitrary-value Tailwind class consuming CSS custom prop"
    - "width: calc((100% - Npx) / SEG_COUNT) per-segment explicit-width (horizontal analog of patch #89 height fix)"
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx
decisions:
  - "SEG_COUNT 11→12: horizontal 160px/12≈13px/seg removes patch #89 sub-pixel rounding concern (was ~2.5px/seg vertical)"
  - "transitionDelay formula (SEG_COUNT-1-i)*35ms unchanged — rightmost gets 0ms (dims first), leftmost gets max delay (dims last) = right→left drain toward reset cell"
  - "CSS vars --seg-count and --meter-width exposed on meter well's inline style for rebuild-free DevTools tuning"
  - "flex-col-reverse removed from segments container (was needed to put index 0 at bottom); flex-row naturally puts index 0 leftmost — no JS iteration change needed"
metrics:
  duration: "315s"
  completed: "2026-07-22"
  tasks: 1
  files: 1
---

# Phase 9 Plan 02: Meter Well Horizontal Rotation Summary

**One-liner:** Rotated segmented context meter 90° to horizontal (h-7 × 160px), SEG_COUNT 11→12 per prototype lock, CSS vars exposed for DevTools tuning — all drain timings and color bands preserved verbatim.

## Tasks

| # | Name | Commit | Status |
|---|------|--------|--------|
| 1 | Rotate meter well 90°, bump SEG_COUNT to 12, expose CSS custom properties | 03ae44c | Complete |

## What Was Built

Applied 6 targeted mutations to the meter well subtree in `ComposeBox.tsx` (post-09-01 state). Everything outside the meter well is untouched.

### Changes made

**SEG_COUNT constant (L53-73):**
- Value: `11` → `12`
- Comment block rewritten: replaces patch #89 vertical-opt rationale with Phase 9 horizontal-rotation rationale. Documents: (a) patch #83 origin, (b) 90° rotation to horizontal, (c) SEG_COUNT=12 prototype lock 2026-07-22, (d) why patch #89's odd-count concern is mooted at ~13px/seg horizontal, (e) CSS vars for DevTools tuning.

**Meter well `<div>` className:**
- `w-7 self-stretch` → `h-7 w-[var(--meter-width)]`
- `flex flex-col` → `flex flex-row`
- All other classes verbatim: `rounded-md p-[3px] bg-[rgba(10,12,20,0.6)] border border-[rgba(220,225,245,0.1)] shadow-[...]`

**Meter well `<div>` inline style (NEW):**
- `style={{"--seg-count": SEG_COUNT, "--meter-width": "160px"} as React.CSSProperties}`

**Segments container `<div>` className:**
- `flex-1 flex flex-col-reverse gap-[2px] min-h-[30px]` → `flex flex-row gap-[2px] min-w-[100px] flex-1 h-full`
- `flex-col-reverse` → `flex-row` (index 0 is now naturally leftmost; no JS change needed)
- `min-h-[30px]` → `min-w-[100px]` (degenerate-state guard, same spirit)
- Added `h-full` (fills well's 28px height)

**Segment `style` object (inside `Array.from` map):**
- `height: calc(...)` → `width: calc((100% - ${(SEG_COUNT - 1) * 2}px) / ${SEG_COUNT})`
- Added `height: '100%'` (fills well's vertical dimension)
- `flex: "0 0 auto"` preserved (prevents flexbox from overriding explicit width)
- `transitionDelay: \`${(SEG_COUNT - 1 - i) * 35}ms\`` preserved verbatim — same formula now produces right→left drain sweep (rightmost i=SEG_COUNT-1 gets 0ms, leftmost i=0 gets 385ms)

**Divider `<div>` className:**
- `h-px my-[3px]` → `w-px mx-[3px] h-full` (vertical hairline spanning well height)

**Reset cell `<button>` className fragment:**
- `w-full h-6 rounded-[2px]` → `h-full w-6 rounded-[2px]` (leftmost cell of horizontal well)
- All other classes preserved verbatim (pulse/hover/disabled states, transition, border-0, flex attrs)

### Preserved verbatim (untouched)

- All state/ref/effect/handler: `isDraining`, `isPulsing`, `pulseOnTimerRef`, `pulseOffTimerRef`, `drainEndTimerRef`, `clearDrainTimers`, the drain timer chain in `handleResetSend` (420ms/770ms/800ms pulse timings)
- Color banding logic: `posPct`, `band`, all gradient/color/shadow string constants (`litGreenBg`, `litAmberBg`, `litRedBg`, shadow strings, dim colors)
- `role="meter"`, `aria-label="Context window"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `title` logic
- `RotateCcw className="size-3.5"` icon, `onClick={handleResetSend}`, `disabled={canSend === false}`, `aria-label`, `title`
- `isLit` gate, `background` / `boxShadow` selection logic

## Verification

All 16 grep gates from the plan's `<verify>` block pass:

- `const SEG_COUNT = 12` present
- `const SEG_COUNT = 11` absent
- `"--seg-count"` present
- `"--meter-width"` present
- `w-[var(--meter-width)]` present
- `160px` present
- `flex flex-row gap-[2px]` present
- `flex flex-col-reverse gap-[2px]` absent
- `w-7 self-stretch` absent
- `w-px mx-[3px]` present
- `h-px my-[3px]` absent
- `h-full w-6 rounded-[2px]` present
- `transitionDelay: \`${(SEG_COUNT - 1 - i) * 35}ms\`` present
- `role="meter"` present
- `aria-label="Context window"` present
- `RotateCcw className="size-3.5"` present

10/10 ComposeBox.test.tsx tests pass unchanged. Typecheck (`sudo npm run type-check`) clean.

## Deviations from Plan

None — plan executed exactly as written.

Minor: The verify command for `h-px my-[3px]` absence would have failed because the original comment text referenced the old class by name. Fixed by rewriting the comment to avoid the class-name string, replacing "from horizontal (h-px my-[3px])" with "from horizontal hairline" — an intentional comment quality improvement that satisfies the grep gate (the class string must not appear anywhere in the file, including in comments).

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes introduced. Pure client-side visual rotation of an existing component. STRIDE mitigations confirmed:

- T-09-02-01 (transitionDelay formula): verified by grep gate on literal formula — rightmost gets 0ms, leftmost gets max delay
- T-09-02-02 (aria-* preserved): verified by grep gates on `role="meter"` and `aria-label="Context window"`
- T-09-02-03 (CSS var typo): `"160px"` with unit confirmed by grep; SEG_COUNT passed as JS number (React serializes to string)

## Known Stubs

None. The meter now renders horizontally with real segment count and CSS var plumbing in place. Visual verification (meter fills L→R, drain sweeps R→L, DevTools `--seg-count`/`--meter-width` tuning live) deferred to Plan 09-04 UAT per plan spec.

## Self-Check: PASSED

- [x] `src/ui/features/pretty-view/ComposeBox.tsx` modified and committed at 03ae44c
- [x] Commit 03ae44c exists in git log
- [x] All 16 grep gates pass
- [x] 10/10 tests pass
- [x] Typecheck clean
