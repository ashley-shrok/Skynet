---
task: 260719-tjk
type: quick
status: complete
completed: 2026-07-19
commits:
  - a4d38eb
files_modified:
  - src/ui/features/pretty-view/ComposeBox.tsx
requirements_delivered:
  - patch-83-cohesive-instrument-compose-meter
key-decisions:
  - "Reset cell uses native `<button>` instead of shadcn Button — sidesteps the outline variant's `dark:bg-input/30` specificity fight documented in patch #81-fix, and gives us the w-full h-6 rounded-[2px] cell shape that fits inside the w-7 meter well (shadcn icon-sm forces size-7 rounded-none)."
  - "Two-timer drain animation: setIsDraining(true) + setIsPulsing(false) at t=0, setIsPulsing(true) at t=420ms, setIsPulsing(false) at t=770ms, setIsDraining(false) at t=800ms. Three refs (drainEndTimerRef, pulseOnTimerRef, pulseOffTimerRef) so back-to-back clicks can clear all pending timers cleanly, plus a unmount cleanup effect."
  - "Segment styling computed in the `.map` render (module-scoped color strings inside the loop, not lifted to module constants) — keeps the color vocabulary co-located with the segment element so future palette shifts (like the patch #82 warm→cool transition) can be found by grepping the segment JSX. Trade-off is a tiny per-render re-alloc of the 9 color strings, negligible against a 12-item loop."
  - "Drain fires REGARDLESS of dispatch success. Visual feedback on click reads better than post-hoc gating, and the `/id reset` payload is dispatched synchronously in the same function anyway — the drain matches reality within the 800ms window."
  - "Meter well ALWAYS mounts (removed the `typeof contextPct === 'number' && (...)` gate). When contextPct is null, aria-valuenow is set to `undefined` so assistive tech reports 'unknown' rather than a false '0%', and all 12 segments render dim. Row geometry stays stable across the null→number transition on first attach."
tags:
  - ui
  - pretty-view
  - compose
  - visual
  - animation
---

# 260719-tjk — Patch #83: Cohesive-Instrument Compose Meter Summary

**One-liner:** Restructured the pretty-view ComposeBox compose row so the context-window meter and the reset button read as ONE segmented-well instrument (12 stacked position-colored cells + integrated reset cell), with a top-to-bottom drain-sweep animation firing on reset click.

## What changed

Single-file mutation to `src/ui/features/pretty-view/ComposeBox.tsx` (+223 / −70). No other files touched, no prop or backend changes.

### Structural changes

1. **Compose shelf padding** — `px-3 py-3` → `px-2 py-2` so the outer padding matches the inner `gap-2` column gaps.
2. **Meter well replaces the thin fill bar** — the old conditional `{typeof contextPct === "number" && <div w-1.5>...</div>}` block is gone. In its place, an UNCONDITIONAL `<div w-7 self-stretch rounded-md flex flex-col p-[3px] ...>` well that carries three children: segments container, divider, reset cell.
3. **12-segment meter** — `Array.from({length: SEG_COUNT}, ...)` renders 12 flex-1 segment divs inside a `flex flex-col-reverse gap-[2px]` container. Position-color bands: bottom green (posPct < 45), middle amber (45 ≤ posPct < 78), top red (posPct ≥ 78). Lit segments carry a linear-gradient bg + outer glow + inset highlight; dim segments carry a low-alpha position color and no shadow.
4. **Drain animation** — each segment carries `transitionDelay: (SEG_COUNT - 1 - i) * 35ms`, so the topmost segment transitions first. During drain (`isDraining === true`), all segments render dim → visual top-to-bottom sweep over ~605ms (385ms bottom-segment delay + 220ms transition duration).
5. **Reset cell** — native `<button>` (NOT shadcn Button), w-full h-6 rounded-[2px], resting unlit-green, hovering lit-green (only when NOT draining), pulsing lit-green while `isPulsing` (~420-770ms after click).
6. **Icon column trimmed** — the RotateCcw `<Button>` is deleted from the right-side icon column. Only ThumbsUp + Send remain; their className strings, disabled logic, aria-labels, and handlers are byte-identical to pre-patch.
7. **JSX comments updated** — comment above the meter well now describes the segmented-well design (12 segments, position bands, integrated reset, drain sweep); comment above the icon column now describes the two-button (ThumbsUp + Send) layout with a note pointing at the meter well for the reset.

### State additions

- `const [isDraining, setIsDraining] = useState(false);`
- `const [isPulsing, setIsPulsing] = useState(false);`
- `const drainEndTimerRef`, `pulseOnTimerRef`, `pulseOffTimerRef` — three timer handles.
- `const clearDrainTimers = useCallback(...)` — clears all three, called at top of each `handleResetSend` invocation AND in the unmount cleanup effect.
- `const litCount = contextPct != null ? Math.round((contextPct / 100) * SEG_COUNT) : 0;` — computed in the render body.

### `handleResetSend` changes

Immediately after `setErrorMessage(null)`:
- `clearDrainTimers()` to reset any in-flight drain
- `setIsDraining(true)` at t=0
- `setIsPulsing(false)` at t=0 (in case a stale pulse was left over)
- `setTimeout(setIsPulsing(true), 420)`
- `setTimeout(setIsPulsing(false), 770)`
- `setTimeout(setIsDraining(false), 800)`

The `/id reset` payload build, `onSend()` call, `setText("")`, `clearAfterSend()`, and error branch are UNCHANGED below the drain trigger.

### Untouched by this patch

- `handleSend`, `handleQuickSend`, `handleTextChange`, `handleBlur`, `handleKeyDown`, `clearAfterSend`, `scheduleAutosave`, `flushDirty`
- All four persistence-related effects (load-on-mount, pagehide/visibilitychange, 10s retry interval, auto-focus)
- Auto-grow `rows` math
- The `<Textarea>` JSX (all classNames byte-identical)
- `errorMessage` render
- ThumbsUp + Send buttons (all classNames, handlers, aria byte-identical)

## Verification

- `npx tsc --noEmit` → exit 0, zero errors.
- `git status` after commit → clean, no untracked files.
- Only `src/ui/features/pretty-view/ComposeBox.tsx` in the commit diff.
- No accidental file deletions (`git diff --diff-filter=D HEAD~1 HEAD` empty).
- `RotateCcw` grep confirms exactly one JSX usage (inside the meter well reset cell at size-3.5), plus the import and one comment reference — the icon-column instance was removed cleanly.

**Deferred to human-verify checkpoint (Task 2, skipped per prompt constraint):** browser eyeball for cohesive-instrument reading, drain animation, hover state, null-contextPct case. Ashley will run this after deploy.

## Deviations from Plan

None — plan executed exactly as written.

The plan's Step H notes an "alternative simpler" approach for the pulse timing (nested `setTimeout` chain) and a "simplest form" recommendation to use multiple refs. I chose the multiple-refs form because it makes the unmount cleanup unambiguous (three clearTimeout calls, no dangling chained handles) and matches the exact spec wording in Step H's bullet at line 176.

## Auth Gates

None encountered.

## Known Stubs

None. All existing data flows preserved; the meter renders `contextPct` live from props with no placeholder/mock values.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes — pure UI restructure of an existing component.

## Commits

| Commit    | Type   | Message                                                                                                    |
| --------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `a4d38eb` | `feat` | feat(pretty-view): cohesive-instrument compose meter with integrated reset cell + drain animation (patch #83) |

## Self-Check: PASSED

- `src/ui/features/pretty-view/ComposeBox.tsx` — FOUND (modified in commit a4d38eb)
- Commit `a4d38eb` — FOUND in git log
- `npx tsc --noEmit` — PASSED (exit 0)
- Only one file modified in the commit — CONFIRMED
- Task 2 (checkpoint:human-verify) — SKIPPED per prompt constraint (Ashley handles browser verification post-deploy)
