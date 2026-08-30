---
phase: quick-260810-ia4
plan: 01
subsystem: pretty-view/virtualization
tags: [jitter, virtualizer, tanstack-virtual, scroll-anchoring, image-bubble]
requires: []
provides: [estimatePvBubbleSize, aspect-ratio-reservation, overflow-anchor-none]
affects: [src/ui/features/pretty-view/PrettyView.tsx, src/ui/features/pretty-view/ImageBubble.tsx]
tech-stack:
  added: []
  patterns: [type-discriminated-height-estimate, css-aspect-ratio-reservation, overflow-anchor-none]
key-files:
  created:
    - src/ui/features/pretty-view/PrettyView.estimateSize.test.tsx
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/ImageBubble.tsx
decisions:
  - "Used Tailwind arbitrary variant [overflow-anchor:none] (no inline style needed — compiled cleanly)"
  - "ImageBlock has no natural-dimension metadata confirmed; 4/3 fallback is the only path"
  - "Bounded-DOM Test 1 upper bound unchanged at 30 — type-aware estimates with 120-msg text fixture did not shift slice size past the cap"
  - "estimatePvBubbleSize exported at module scope in PrettyView.tsx (not a separate file) per plan action"
metrics:
  duration: ~25 minutes
  completed: 2026-08-10
  tasks: 3
  files: 3
---

# Quick Task 260810-ia4: PrettyView Virtualizer Jitter Cheap Fixes — Summary

**One-liner:** Three coordinated fixes — type-aware height estimates, aspect-ratio image reservation, and overflow-anchor suppression — reduce TanStack Virtual re-measure displacement under Ashley's scroll gesture.

## What Shipped

### Fix 1: Type-aware estimatePvBubbleSize helper (Task 1)

Extracted and exported `estimatePvBubbleSize(m: StreamEvent): number` from `PrettyView.tsx`. Rules:

- `m.type === "image"` → 400 (overshoots slightly; corrects downward = less visible displacement)
- Text with fenced code block → `Math.max(120, lineCount * 22 + 40)`
- Plain text → `Math.max(80, Math.min(400, textLength * 0.4))`
- Fallback (MalformedLineEvent, no-text paths) → 80

Wired into `useVirtualizer` via `estimateSize: (i) => estimatePvBubbleSize(messages[i])` (was the constant `() => 80`). Phase 27/28 invariants (`overscan: 5`, `scrollMargin: 12`, `getItemKey`, `initialRect`, `observeElementRect`) untouched.

Nine unit tests in `PrettyView.estimateSize.test.tsx` cover: image=400, short-text floor, long-text scaling, code-block formula, very-long-text cap, distinct-values sanity, RelayOutbound, RelayInbound, MalformedLine.

**Commit:** `90b3dea` (pre-rebase: `f146a6f`)

### Fix 2: Aspect-ratio reservation on ImageBubble (Task 2)

Wrapped each `<img>` in `<div style={{ aspectRatio: "4 / 3" }} className="max-w-full max-h-[480px]">` with the image becoming `w-full h-full object-contain rounded` inside. Reserves the final layout box before decode so TanStack's `measureElement` does not observe a 0 → N grow after mount (which previously re-fired mid-scroll and displaced content below the fold).

`ImageBlock` confirmed to carry only `{ data, mediaType, toolUseId? }` — no natural-dimension metadata. The 4/3 fallback is the only path.

**Commit:** `9eec4ba` (pre-rebase: `2adf758`)

### Fix 3: overflow-anchor:none on outer scroll container (Task 3)

Added Tailwind arbitrary variant `[overflow-anchor:none]` to the `composeScrollRefs` div (`PrettyView.tsx` ~line 2006). Browser native scroll-anchoring was competing with TanStack Virtual's re-measure adjustments for scroll-position authority; the virtualizer is now the sole authority through measurement changes.

**Bounded-DOM test retune:** Test 1 upper bound (`<= 30`) was NOT retuned. The type-aware estimates with the 120-message `type: "message"` fixture did not shift the JSDOM visible-slice size past the cap. The assertion remains `expect(bubbles.length).toBeLessThanOrEqual(30)`.

**Commit:** `fcf6485` (pre-rebase: `8cfafc2`)

## Verification Results

- `npm run build:backend` — exit 0
- `npm run build` — exit 0 (built in 6.38s)
- `npx vitest run` — 143 test files passed, 1822 tests passed (7 skipped, 1 todo), exit 0

The two `EnvironmentTeardownError` entries in vitest output are a pre-existing timing artifact in `IdentityModal.test.tsx`; vitest exits 0 and they do not represent test failures.

## Deviations from Plan

None. Plan executed exactly as written.

- Fix 1: helper and tests match all six specified assertions.
- Fix 2: fallback path (no natural-dimension metadata on ImageBlock) confirmed before implementing.
- Fix 3: Tailwind arbitrary variant compiled cleanly; no inline `style` fallback needed.

## Partial Down-payment on pv-auto-scroll-redesign

This quick task is a **partial down-payment** on the `pv-auto-scroll-redesign` bounty. The jitter-focused slice only.

**Explicitly parked (not in scope):**
- H1: scroll-position authority handoff between useAutoScroll and virtualizer
- H2: stickToBottom state machine redesign
- M5: scrollToIndex usage audit
- M7: paneKey-change scroll-to-bottom race
- Full auto-scroll redesign (bounty pv-auto-scroll-redesign)
- No library swap — `@tanstack/react-virtual` stays

## Commits

| Hash (post-rebase over #384) | Pre-rebase | Message |
|------|---------|---------|
| `90b3dea` | `f146a6f` | feat(quick-260810-ia4-01): type-aware estimatePvBubbleSize helper + wire to useVirtualizer |
| `9eec4ba` | `2adf758` | feat(quick-260810-ia4-02): aspect-ratio reservation on ImageBubble to kill 0->N decode pop |
| `fcf6485` | `8cfafc2` | feat(quick-260810-ia4-03): overflow-anchor:none on outer scroll container |

## Self-Check

- [x] `src/ui/features/pretty-view/PrettyView.tsx` exists and modified
- [x] `src/ui/features/pretty-view/ImageBubble.tsx` exists and modified
- [x] `src/ui/features/pretty-view/PrettyView.estimateSize.test.tsx` created
- [x] All 3 commits present in git log
- [x] `grep -n "estimatePvBubbleSize" PrettyView.tsx` shows both definition (line 209) and call site (line 756)
- [x] `grep -n "aspectRatio" ImageBubble.tsx` shows reservation (line 90)
- [x] `grep -n "overflow-anchor" PrettyView.tsx` shows outer scroll container fix (line 2006)
