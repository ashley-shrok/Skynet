# TanStack Virtual scrollTop-write verification report

**Author:** Plan 32-01 executor
**Date:** 2026-08-12
**Purpose:** Determine — before Plan 32-02 rewrites `use-auto-scroll.ts` — whether TanStack
Virtual's `@tanstack/virtual-core` writes to the scroll container's `scrollTop` (or an
equivalent programmatic scroll API) as part of its measurement-adjustment flow. Under the
CONTEXT.md-locked hook design, any un-gated programmatic write emits a `scroll` event that
the new hook's single listener would misread as a user scroll — potentially flipping
`stickyRef.current = false` or toggling `isPinnedToBottom` on its own.

## Package versions

Determined via:

```bash
node -e "console.log('virtual-core@' + require('@tanstack/virtual-core/package.json').version)"
node -e "console.log('react-virtual@' + require('@tanstack/react-virtual/package.json').version)"
```

Output:

- `@tanstack/virtual-core@3.17.7`
- `@tanstack/react-virtual@3.14.9`

Package layout:

- `node_modules/@tanstack/virtual-core/dist/{esm,cjs}` — built JS the app actually runs.
- `node_modules/@tanstack/virtual-core/src/` — original TS source (`index.ts`,
  `lazy-measurements.ts`, `utils.ts`).
- `node_modules/@tanstack/react-virtual/dist/{esm,cjs}` — built JS wrapper.
- `node_modules/@tanstack/react-virtual/src/index.tsx` — original TS source of the wrapper.

## Grep commands run

Four passes as specified in Plan 32-01, plus four bonus passes to close the gap the plan's
original patterns leave open (patterns of the shape `element.scrollTo({top: ...})` don't match
`scrollTop\s*=` or `\.scrollBy\(`, and the plan's original patterns are correct only for the
`el.scrollTop = N` form).

Pass 1 (broad — direct writes over all dist artifacts):

```bash
grep -rnE 'scrollTop\s*=|\.scrollBy\(|scrollLeft\s*=' node_modules/@tanstack/virtual-core/dist/ 2>/dev/null
```

Pass 2 (narrow — js/mjs/cjs only, excluding `.d.ts` and `.map`):

```bash
grep -rnE 'scrollTop\s*=|\.scrollBy\(' node_modules/@tanstack/virtual-core/dist/ \
  --include='*.js' --include='*.mjs' --include='*.cjs' 2>/dev/null
```

Pass 3 (context — 1 line before, 2 lines after, to distinguish reads from writes):

```bash
grep -rnB1 -A2 -E 'scrollTop\s*=|\.scrollBy\(' node_modules/@tanstack/virtual-core/dist/ \
  --include='*.js' --include='*.mjs' --include='*.cjs' 2>/dev/null
```

Pass 4 (react-virtual wrapper — same narrow pattern):

```bash
grep -rnE 'scrollTop\s*=|\.scrollBy\(' node_modules/@tanstack/react-virtual/dist/ \
  --include='*.js' --include='*.mjs' --include='*.cjs' 2>/dev/null
```

Bonus 5 (TypeScript source of virtual-core):

```bash
grep -rnE 'scrollTop\s*=|\.scrollBy\(|scrollLeft\s*=' node_modules/@tanstack/virtual-core/src/ 2>/dev/null
```

Bonus 6 (TypeScript source of react-virtual):

```bash
grep -rnE 'scrollTop\s*=|\.scrollBy\(' node_modules/@tanstack/react-virtual/src/ 2>/dev/null
```

Bonus 7 (computed / bracket access, `scrollTo(`, `element.scroll(` writes):

```bash
grep -rnE "\[['\"]scrollTop['\"]\]\s*=|\.scrollTo\(|element\.scroll\(" \
  node_modules/@tanstack/virtual-core/dist/ node_modules/@tanstack/react-virtual/dist/ \
  node_modules/@tanstack/virtual-core/src/ node_modules/@tanstack/react-virtual/src/ 2>/dev/null
```

Bonus 8 (sanity — any occurrence of the string `scrollTop` in dist, to confirm reads DO exist):

```bash
grep -rnE 'scrollTop' node_modules/@tanstack/virtual-core/dist/ \
  --include='*.js' --include='*.mjs' --include='*.cjs' 2>/dev/null
```

Bonus 9 (chase — every occurrence of `scrollTo` anywhere in the built modules):

```bash
grep -n 'scrollTo' node_modules/@tanstack/virtual-core/dist/esm/index.js
grep -n 'scrollTo' node_modules/@tanstack/virtual-core/dist/cjs/index.cjs
grep -nE 'scrollWithAdjustments' node_modules/@tanstack/virtual-core/dist/{esm/index.js,cjs/index.cjs}
grep -nE 'scrollToFn|elementScroll|windowScroll' node_modules/@tanstack/react-virtual/dist/esm/index.js
```

## Raw hits (verbatim grep output)

Pass 1: **zero hits** (empty output).

Pass 2: **zero hits** (empty output).

Pass 3: **zero hits** (empty output).

Pass 4: **zero hits** (empty output).

Bonus 5 (TS source of virtual-core): **zero hits** (empty output).

Bonus 6 (TS source of react-virtual): **zero hits** (empty output — only `index.tsx` present).

Bonus 7 (computed / `.scrollTo(` / `element.scroll(` writes): **zero hits** (empty output).
Note this is a false negative — the transpiled dist encodes the call as
`_b.call(_a, {...})` after an optional-chaining safety null-check on `.scrollTo`, so a naive
`.scrollTo(` grep does not match; see Bonus 9.

Bonus 8 (sanity — reads confirmed):

```
node_modules/@tanstack/virtual-core/dist/esm/index.js:120:  return horizontal ? el.scrollLeft * (isRtl && -1 || 1) : el.scrollTop;
node_modules/@tanstack/virtual-core/dist/esm/index.js:864:          // changes size *below* the anchor point, so shifting scrollTop by the
node_modules/@tanstack/virtual-core/dist/esm/index.js:1120:  // Returns `true` when it performed a synchronous `scrollTop` write this
node_modules/@tanstack/virtual-core/dist/cjs/index.cjs:122:  return horizontal ? el.scrollLeft * (isRtl && -1 || 1) : el.scrollTop;
node_modules/@tanstack/virtual-core/dist/cjs/index.cjs:866:          // changes size *below* the anchor point, so shifting scrollTop by the
node_modules/@tanstack/virtual-core/dist/cjs/index.cjs:1122:  // Returns `true` when it performed a synchronous `scrollTop` write this
```

**The comments at L1120 (esm) / L1122 (cjs) explicitly say "synchronous `scrollTop` write"**
even though no `scrollTop =` write appears — the write goes through a different API. This
forced Bonus 9.

Bonus 9 (chase — key excerpts, `scrollTo` occurrences, esm build):

```
120:  return horizontal ? el.scrollLeft * (isRtl && -1 || 1) : el.scrollTop;    ← READ
152:const scrollWithAdjustments = (offset, {
153:  adjustments = 0,
154:  behavior
155:}, instance) => {
156:  var _a, _b;
157:  (_b = (_a = instance.scrollElement) == null ? void 0 : _a.scrollTo) == null ? void 0 : _b.call(_a, {
158:    [instance.options.horizontal ? "left" : "top"]: offset + adjustments,
159:    behavior
160:  });
161:};
162:const windowScroll = scrollWithAdjustments;
163:const elementScroll = scrollWithAdjustments;
...
1104:    this._scrollToOffset = (offset, { adjustments, behavior }) => {
1108:      this._intendedScrollOffset = offset + (adjustments ?? 0);
1109:      this.options.scrollToFn(offset, { behavior, adjustments }, this);
1110:    };
...
1120:  // Returns `true` when it performed a synchronous `scrollTop` write this
1121:  // tick, `false` when the delta was zero or the write was deferred (iOS).
1122:  // `resizeItem` uses that to decide whether the follow-up `notify` must be
1123:  // synchronous so the grown transforms commit in the same paint (#1227).
1124:  applyScrollAdjustment(delta, behavior) {
1125:    if (delta === 0) return false;
...
1132:    } else {
1133:      this._scrollToOffset(this.getScrollOffset(), {
1134:        adjustments: this.scrollAdjustments += delta,
1135:        behavior
1136:      });
```

React wrapper (`@tanstack/react-virtual/dist/esm/index.js`) wires `scrollToFn: elementScroll`
(L120) and `scrollToFn: windowScroll` (L129) — i.e. it reuses `scrollWithAdjustments` from
virtual-core unchanged. Wrapper adds no additional `scrollTop`-mutating surface of its own.

## Classification (read vs write vs comment/string/property-key)

| Hit                                                       | Kind                                                                                                                                                                                                                                                                       | Matters?                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `virtual-core/dist/esm/index.js:120` `el.scrollTop` (RHS) | READ (used to compute the current scroll offset for the observer).                                                                                                                                                                                                         | No.                                                                   |
| `virtual-core/dist/esm/index.js:864` `scrollTop` (in a comment) | Documentation comment inside `resizeItem` explaining why measurement adjustments below the anchor point are skipped.                                                                                                                                                       | No.                                                                   |
| `virtual-core/dist/esm/index.js:1120` `scrollTop` (in a comment) | Documentation on `applyScrollAdjustment` describing its side-effect ("synchronous `scrollTop` write").                                                                                                                                                                     | Signals that a write DOES occur — via a different API. See below.     |
| `virtual-core/dist/esm/index.js:157` `_b.call(_a, {top: offset + adjustments, behavior})` | **WRITE** via `Element.prototype.scrollTo({ top })`. This is the mechanism the `applyScrollAdjustment` comment refers to. Called from `_scrollToOffset` (L1109) which is called from `applyScrollAdjustment` (L1133) whenever `resizeItem` detects a `defaultShouldAdjust` above-fold delta. | **YES — load-bearing programmatic scroll write.**                     |
| `react-virtual/dist/esm/index.js:120,129` `scrollToFn: elementScroll` / `windowScroll` | Wires the write path above as the default `scrollToFn` in the React wrapper — no override.                                                                                                                                                                                 | Confirms the write path is active in the real codebase.               |

**Why the plan's original three patterns missed this:** the library shifted from `el.scrollTop = X`
to `el.scrollTo({top: X})` at some point (issue #1218 in the comments references this). The
resulting `scroll` event on the container is identical regardless of which API produced the
write — but the source-text pattern is different, so `scrollTop\s*=` grep returns zero. The
comments at L1120 tipped us off; without them the raw grep would produce a false clean bill.

## Verdict

VERDICT: direct scrollTop writes found at `node_modules/@tanstack/virtual-core/dist/esm/index.js:157` (and cjs L159) via `Element.prototype.scrollTo({top})` — Plan 02 MUST add mitigation.

Rationale:

1. `scrollWithAdjustments` (L152-161) calls `instance.scrollElement.scrollTo({ top: offset + adjustments, behavior })`.
2. This is the default `scrollToFn` for element-scrolled virtualizers (L163: `elementScroll = scrollWithAdjustments`; react wrapper L120: `scrollToFn: elementScroll`).
3. It is invoked by `_scrollToOffset` (L1109) which is invoked by `applyScrollAdjustment` (L1133) any time `resizeItem` detects a size delta that requires an above-fold correction (`defaultShouldAdjust` true).
4. Every such call fires a `scroll` event on the outer scroll container.
5. The CONTEXT.md-locked hook design gates programmatic writes with `programmaticRef` set in the hook's own `jumpToBottom` wrapper. **TanStack's `scrollTo` calls do NOT go through that wrapper**, so `programmaticRef.current` will be `false` when the resulting `scroll` event reaches the listener. The listener will therefore classify the event as a user scroll.
6. The specific failure mode: `applyScrollAdjustment(delta)` shifts `scrollTop` by `delta` (via `scrollAdjustments += delta`) to keep the viewport locked to the anchor item when items above the fold change size. When `delta > 0` (item above the fold grew bigger — the streaming-message-anchor case) the `scrollTop` INCREASES; the listener sees `now > lastScrollTop` and does not flip `stickyRef` off — safe. When `delta < 0` (item above the fold shrunk — image decode landed at a smaller-than-estimated size, or a WipBubble/PlanPendingBubble unmounted above the fold) the `scrollTop` DECREASES; the listener sees `now < lastScrollTop` and flips `stickyRef.current = false` — **un-stick from a purely internal library correction with no user gesture**. This exactly matches the concern CONTEXT.md § "TanStack Virtual scrollTop-write behavior" flagged.
7. Post-Phase-27 accessory mount/unmount (WipBubble/PlanPendingBubble/AsideBubble as in-flow siblings of the sized virtualizer container) does NOT trigger this path directly (they're outside the virtualizer's measurement flow), BUT any assistant-message re-measurement (image decode, code-block layout, streaming markdown height change) that reduces an above-fold item's size WILL. Under load these will be common.

## Recommendation for Plan 02

**Plan 02 must add a scroll-event debounce that ignores single scroll events with
`|scrollTop - lastScrollTop| < 20` px.**

Rationale: TanStack's `applyScrollAdjustment` correction deltas are single-item size deltas
(estimate→actual mismatch, image decode, markdown reflow) — typically single-digit to low-double-digit
pixels. Real user scroll events per tick (mouse wheel, touch drag, keyboard PageUp) are almost
always ≥40 px per event (mouse wheel default is 100 px; touch drag emits many small events but
never a single ≤20 px event mid-drag; keyboard PageUp is one full viewport, ≥600 px). A 20 px
threshold cleanly separates the two populations. Cite CONTEXT.md § Specific Ideas L158-161 as
the sanctioned mitigation source.

**Implementation seam** (inside the `handleScroll` closure defined in 32-PATTERNS.md § 1
"REPLACE — event listener block" L106-127):

```typescript
useEffect(() => {
  if (!scrollEl) return;
  let lastScrollTop = scrollEl.scrollTop;
  const handleScroll = () => {
    if (programmaticRef.current) return;                    // gate 1: our own writes
    const now = scrollEl.scrollTop;
    const dist = scrollEl.scrollHeight - now - scrollEl.clientHeight;
    const atBottom = dist <= BOTTOM_THRESHOLD;

    // NEW — gate 2: TanStack Virtual measurement-adjustment writes.
    // Adjustments are typically small (a few px); user scrolls are typically
    // ≥40 px per event. If this event is a sub-threshold delta, keep the
    // pill state fresh but do NOT touch stickyRef.
    if (Math.abs(now - lastScrollTop) < 20) {
      setIsPinnedToBottom(atBottom);
      lastScrollTop = now;
      return;
    }

    if (now < lastScrollTop) {
      stickyRef.current = false;
    } else if (atBottom) {
      stickyRef.current = true;
    }
    setIsPinnedToBottom(atBottom);
    lastScrollTop = now;
  };
  scrollEl.addEventListener("scroll", handleScroll, { passive: true });
  return () => scrollEl.removeEventListener("scroll", handleScroll);
}, [scrollEl]);
```

Key properties of this mitigation:

- **Still updates `lastScrollTop`.** Otherwise a series of sub-threshold corrections in
  the same direction would silently accumulate a supra-threshold delta but never flip
  `stickyRef`, and the NEXT real user scroll would be measured against a stale baseline.
- **Still updates `isPinnedToBottom`.** The pill's visual state must track the actual
  bottom-distance regardless of what caused the scroll.
- **Does NOT touch `stickyRef`.** This is the whole point — measurement adjustments should
  not change the user's read/follow intent.
- **Constant is inline, not exported.** If a future TanStack version changes correction
  magnitudes, or Ashley finds a real 15 px trackpad-microwheel event, we tune here without
  API churn. Consider naming it `MEASUREMENT_DELTA_IGNORE_PX = 20` at the module scope for clarity.

**Alternatives considered and rejected:**

- **Subscribe to TanStack's measurement events instead of debouncing.** Rejected: TanStack
  Virtual does not expose a public "before/after measurement" event that would let us wrap
  `programmaticRef` around the internal `scrollTo`. The `notify(adjustedSync)` callback (L897)
  is internal; the public `onChange` fires AFTER the write. Wrapping `options.scrollToFn`
  with a custom wrapper would work but requires threading through PrettyView.tsx's virtualizer
  construction, adding a coupling point the hook currently doesn't have. The 20 px debounce
  is strictly local to the hook and doesn't require touching PrettyView.tsx's virtualizer setup.
- **Widen `programmaticRef` to fire around the virtualizer's mount lifecycle instead.**
  Rejected: measurement adjustments fire at arbitrary times (image decode, markdown reflow,
  streaming height changes), not just at mount. There is no bounded window to gate.
- **Ignore all downward scrolls unless the user is dragging the scrollbar.** Rejected: this
  reintroduces the old hook's source-event trifecta (`wheel` + `keydown` + `touchmove`) that
  CONTEXT.md § "Event handling — one listener, not three" explicitly rejects.

**Test coverage impact (informational — Plan 03/04 scope, not Plan 02):**

- Scenario 3 in `PrettyView.virtualization.test.tsx` currently simulates a user scroll-up by
  setting `scrollTop = 1000` and firing a scroll event. Under the 20 px debounce this still
  works (delta is 4000 px, well over threshold), but if the test's `shrinkScrollContainer`
  values were ever tightened, the test would need to keep the delta ≥ 20 px.
- A new scenario worth adding: a sub-threshold TanStack-style adjustment should NOT flip
  `stickyRef`. Simulate by setting `scrollTop = 5000 - 10` and firing a scroll event, then
  fire another scroll event with `scrollTop = 5000` (re-adjustment); assert `stickyRef` stayed
  true across both. This directly regression-tests the mitigation. Recommend Plan 03 adds it
  as "Test 2c: measurement-adjustment tolerance".

## Summary for Plan 02 executor

- **Read this file's "Verdict" and "Recommendation for Plan 02" sections.**
- **Add the sub-20 px scroll-delta guard to `handleScroll` inside the hook.**
- Everything else in CONTEXT.md and 32-PATTERNS.md stays as drawn.
- Do not thread the debounce constant through the exported API — keep it module-local.
- Consider a `MEASUREMENT_DELTA_IGNORE_PX = 20` module constant next to `BOTTOM_THRESHOLD`
  and `STICK_ARM_MS` for readability.
