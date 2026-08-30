---
phase: 28-prettyview-virtualization-correctness-cluster-post-phase-27
plan: 01
subsystem: ui/features/pretty-view (frontend — TanStack Virtual integration)
tags: [pretty-view, virtualization, tanstack-virtual, correctness, review-followup, H3, H4, M1, M2, M4]
requires:
  - Phase 27 (virtualization in place)
  - patch #373 (auto-scroll TEMP-disabled — collapses fix cluster to virtualizer-side items)
provides:
  - "observeElementRect that honors TanStack Virtual's () => void cleanup contract on every branch (H3)"
  - "observeElementRect read() closure that re-derives instance.scrollElement on every fire so a stale RO reports current dimensions (H4)"
  - "useVirtualizer.scrollMargin=12 matching outer scroll container's py-3 top padding (M1)"
  - "useVirtualizer.initialRect.height reduced 4096→600 so first paint mounts ~5-10 bubbles instead of ~60 (M2)"
  - "getItemKey non-colliding __oob_${i} string fallback + diagnostic console.warn (M4)"
  - "Test 6 (H3 no-throw across mount→streaming→unmount)"
  - "Test 7 (H4 defensive re-read survives stale-looking RO fire)"
  - "Test 8 (M2 first-paint bounded DOM ≤20 bubbles without RO firing)"
  - "Test 9 (M4 no __oob_ under normal render + no [pv-virtual] warn)"
affects:
  - src/ui/features/pretty-view/PrettyView.tsx (observeElementRect + useVirtualizer options)
  - src/ui/features/pretty-view/PrettyView.virtualization.test.tsx (Tests 6, 7, 8, 9 added)
tech-stack:
  added: []
  patterns:
    - "observeElementRect cleanup: return () => {} on every early-return branch (never bare undefined)"
    - "observeElementRect read() closure: re-derive instance.scrollElement on every fire (not captured-at-bind)"
    - "getItemKey fallback: non-colliding string prefix (__oob_${i}) + console.warn — never bare integer that could collide with real integer eventIds"
    - "initialRect.height <= visible viewport budget so the transient pre-RO window preserves bounded DOM"
    - "observeElementRect offsetHeight fallback aligned with initialRect.height (both 600) so JSDOM's zero-offset synchronous install-time read does not silently balloon past initialRect budget"
key-files:
  created: []
  modified:
    - path: src/ui/features/pretty-view/PrettyView.tsx
      why: "Applied H3, H4, M1, M2, M4 fixes; ~50-line region at observeElementRect + useVirtualizer options"
    - path: src/ui/features/pretty-view/PrettyView.virtualization.test.tsx
      why: "Added Tests 6, 7, 8, 9 locking in each correctness fix; existing Tests 1-5b + skipped Test 2 unchanged"
decisions:
  - "Combined M2 initialRect.height=600 with observeElementRect offsetHeight fallback=600 (was 4096) as a single M2 concept — both fallbacks represent the same physical thing (transient viewport size before real layout is available) and MUST agree, or observeElementRect's synchronous install-time read() would override initialRect with 4096 in JSDOM's zero-offset path, defeating M2 entirely (this was empirically observed when Test 8 asserted ≤20 bubbles but rendered 57)"
  - "M4 fallback returns a JS-template-literal string (__oob_${i}) with underscore prefix so it can never collide with any real eventId string — and specifically cannot collide with a real integer eventId '5' cast against fallback 5 (the old '?? i' hazard)"
  - "H4 preserves the bind-time element as the RO observation target (bindEl) so the OLD scroll container is still watched for its own resizes; the CALLBACK, via read(), reports whichever element is CURRENT at fire-time via instance.scrollElement re-read — this matches the review's suggested direction at /tmp/pv-virtualization-review.md :103-110"
metrics:
  duration: "~15min (3 tasks; Task 3 delayed by /tmp/root ENOSPC recovery)"
  completed: "2026-08-10"
  tasks_completed: 3
  commits: 2
  files_touched: 2
  tests_added: 4
---

# Phase 28 Plan 28-01: PrettyView virtualization correctness (H3, H4, M1, M2, M4) Summary

**One-liner:** Fixed the five correctness issues (H3, H4, M1, M2, M4) surfaced by the independent code review of Phase 27's TanStack Virtual integration — all cluster into ~50 lines around `observeElementRect` + `useVirtualizer` options in `PrettyView.tsx`; two atomic commits, four new locking tests, full suite green, tsc clean, `use-auto-scroll.ts` byte-identical.

## Commits

| Task | Commit    | Summary                                                                                                              |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| 1    | `28f4c69` | fix(pv-virt): observeElementRect returns () => {} on null branches + re-reads scrollElement in read closure (H3, H4) |
| 2    | `4269c8f` | fix(pv-virt): add scrollMargin=12 (M1) + shrink initialRect.height 4096→600 (M2) + non-colliding getItemKey fallback with diagnostic warn (M4) |

## H3 + H4 — observeElementRect before/after

### Before (pre-Phase-28)

```ts
observeElementRect: (instance, cb) => {
  const el = instance.scrollElement as HTMLElement | null;
  if (!el) return;                    // ← bare undefined; TanStack calls undefined()
  const win = instance.targetWindow;
  if (!win) return;                   // ← same
  const read = () => {
    const w = el.offsetWidth || 1024;   // ← captures OLD element via closure
    const h = el.offsetHeight || 4096;
    cb({ width: w, height: h });
  };
  read();
  if (!win.ResizeObserver) return () => {};
  const ro = new win.ResizeObserver(() => read());
  ro.observe(el);
  return () => ro.disconnect();
},
```

### After (H3 + H4 fixed)

```ts
observeElementRect: (instance, cb) => {
  // H3 fix: every early-return branch MUST return a () => void cleanup ...
  const bindEl = instance.scrollElement as HTMLElement | null;
  if (!bindEl) return () => {};
  const win = instance.targetWindow;
  if (!win) return () => {};
  // H4 fix: re-derive from instance.scrollElement on every fire ...
  // Phase 28 (M2 alignment): the offsetHeight fallback is 600 —
  // matching initialRect.height (both fallbacks MUST agree ...)
  const read = () => {
    const cur = instance.scrollElement as HTMLElement | null;
    if (!cur) return;
    const w = cur.offsetWidth || 1024;
    const h = cur.offsetHeight || 600;
    cb({ width: w, height: h });
  };
  read();
  if (!win.ResizeObserver) return () => {};
  const ro = new win.ResizeObserver(() => read());
  // Observe the element captured at bind-time so the OLD element
  // continues to be watched for its own resizes; the CALLBACK still
  // reports whichever element is current at fire-time (via read()).
  ro.observe(bindEl);
  return () => ro.disconnect();
},
```

## M1 + M2 + M4 — useVirtualizer options before/after

### Before (pre-Phase-28)

```ts
const rowVirtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => scrollElRef.current,
  estimateSize: () => 80,
  overscan: 5,
  getItemKey: (i) => messages[i]?.eventId ?? i,          // ← integer fallback: collision hazard
  initialRect: { width: 1024, height: 4096 },            // ← too tall: ~61 bubbles on first paint
  observeElementRect: (instance, cb) => { ... },
  // no scrollMargin ← off-by-12 from py-3 padding
});
```

### After (M1 + M2 + M4 fixed)

```ts
const rowVirtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => scrollElRef.current,
  estimateSize: () => 80,
  overscan: 5,
  // Phase 28 (M1): matches the outer scroll container's py-3 (= 12px) top padding ...
  // Source-of-truth: composeScrollRefs div at PrettyView.tsx :1816.
  scrollMargin: 12,
  // Phase 28 (M4): diagnostic fallback ... __oob_${i} string prefix is ...
  // loud enough to spot in DOM inspection AND safe from collision.
  getItemKey: (i) => {
    const evt = messages[i]?.eventId;
    if (evt !== undefined) return evt;
    console.warn(`[pv-virtual] getItemKey out-of-range i=${i} messages.length=${messages.length}`);
    return `__oob_${i}`;
  },
  // Phase 28 (M2): height reduced 4096→600 so the first paint mounts
  // ~5-10 real bubble subtrees (600/80 + 10 overscan ≈ 17) instead of
  // ~60 (4096/80 + 10 ≈ 61) ...
  initialRect: { width: 1024, height: 600 },
  observeElementRect: (instance, cb) => { ... },  // H3 + H4 fixes (see above)
});
```

## New Tests (Phase 28)

| # | Locks     | Assertion                                                                                                                                                                                                                                    |
| - | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6 | H3        | `render → flipToStreaming → fireMessageBatch → unmount` cycle throws nothing, and `console.error` receives no `TypeError` argument. If any observeElementRect branch returned bare undefined, calling that stored cleanup on rebind would throw. |
| 7 | H4        | After mounting, mutating outer scroll container's `offsetHeight` and manually firing every `capturedROCallbacks[]` callback does NOT crash the virtualizer; sized container remains locatable; `[data-pv-bubble].length > 0`.                    |
| 8 | M2        | With `initialRect.height=600` + `observeElementRect` fallback=600 aligned, firing 120 messages WITHOUT `shrinkScrollContainer` yields `[data-pv-bubble].length <= 20` (empirically 17). Pre-M2 this would be ~61.                                |
| 9 | M4        | Firing 15 messages with real eventIds produces NO `[data-pv-bubble]` with `data-event-id="__oob_..."` and NO `[pv-virtual]` prefixed `console.warn`. The fallback path is unreachable under normal render flow.                                  |

**Test 2 (auto-scroll rAF-chain) remains `it.skip`** — NOT re-enabled — because auto-scroll is TEMP-disabled per patch #373 (see plan constraint).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Consistency Bug] Aligned observeElementRect offsetHeight fallback (4096→600) with initialRect.height (600).**
- **Found during:** Task 2 verification (Test 8 asserted ≤20 bubbles but rendered 57 in JSDOM).
- **Issue:** The plan's M2 fix set `initialRect.height=600`, but observeElementRect's own `read()` closure fell back to `offsetHeight || 4096` when JSDOM reported offsetHeight=0. Since observeElementRect's install-time synchronous `read()` fires DURING useLayoutEffect (before the first paint), it silently overrode `initialRect` with `cb({height: 4096})`. This meant M2 was effectively unobservable — the visible slice ballooned right back to ~61 bubbles.
- **Fix:** Changed the `|| 4096` fallback to `|| 600` so both the observeElementRect fallback and initialRect represent the same physical concept (transient viewport size before real layout) with the same value. Added comment locking the two together as source-of-truth.
- **Files modified:** src/ui/features/pretty-view/PrettyView.tsx (observeElementRect read() closure, plus the earlier comment block explaining the JSDOM/first-paint rationale).
- **Commit:** `4269c8f` (bundled into Task 2 M2 fix because it IS the M2 fix — the initialRect alone was necessary but not sufficient).

### Environmental Issue (Task 3, not a code deviation)

**2. [Env] Cleared root-disk ENOSPC before running full-suite vitest.**
- **Found during:** Task 3 Step 1 (first vitest run reported `ENOSPC: no space left on device, mkdir '/tmp/.../client'` and 124 test files spuriously failed with a truncated error tail).
- **Issue:** `/dev/root` was at 100% (2.9M free). Vitest could not create per-test JSDOM tmp dirs.
- **Fix:** Cleared stale `/tmp` random-name dirs (34 dirs, ~137MB), removed local `coverage/` dir, ran `npm cache clean --force` (freed ~1G). Post-cleanup `/dev/root` at 98% with 685MB free — enough for vitest full-suite.
- **No source changes.**
- **Full suite then reported: 134 files passed, 1695 passed, 7 skipped, 0 failed.**

## Verification Output Tails

### `npx vitest run` (Task 3 Step 1)

```
Test Files  134 passed (134)
      Tests  1695 passed | 7 skipped (1702)
   Start at  02:33:32
   Duration  356.57s
```

### `npx tsc --noEmit` (Task 3 Step 2)

```
(no output)
EXIT: 0
```

### `git diff HEAD~2 HEAD -- src/ui/features/pretty-view/use-auto-scroll.ts` (Task 3 Step 3)

```
(empty — byte-preserve invariant satisfied)
```

sha256 of use-auto-scroll.ts at baseline and after both commits: `fd47f7248595b22816022a1e7373f923bec4d3dde1272e5c3623747b825797ec` (unchanged).

## Threat Register Compliance

All five threats from the plan's `<threat_model>` mitigated:

- **T-28-01** (Tampering — observeElementRect cleanup contract) — mitigated by H3 fix (both null branches return `() => {}`); Test 6 asserts no-throw + no TypeError on console.error across the mount lifecycle.
- **T-28-02** (Tampering — observeElementRect stale scrollElement closure) — mitigated by H4 fix (read() re-derives instance.scrollElement on every fire); Test 7 provides JSDOM-appropriate proxy assertion.
- **T-28-03** (Repudiation — getItemKey silent fallback masking bug) — mitigated by M4 fix (non-colliding __oob_${i} + console.warn); Test 9 asserts normal operation never trips the warn.
- **T-28-04** (DoS — initialRect.height=4096 mounts ~60 bubbles on first paint) — mitigated by M2 fix (reduced to 600 + aligned observeElementRect fallback); Test 8 asserts bounded DOM ≤20 without RO firing.
- **T-28-05** (DoS — scrollMargin=0 vs py-3 12px padding) — mitigated by M1 fix (scrollMargin: 12 with source-of-truth comment naming PrettyView.tsx :1816 as the update-together target).

Out-of-scope threats (H1, H2, M5, M7) remain untouched — they touch auto-scroll behavior, TEMP-disabled per patch #373, and come back into scope only when bounty `pv-auto-scroll-redesign` picks up auto-scroll.

## Handoff to Orchestrator

Ready for deploy motion. No source-of-truth changes to nginx, backend, or docker — pure frontend correctness fixes in `src/ui/features/pretty-view/PrettyView.tsx` (+ tests). `use-auto-scroll.ts` byte-identical. Full suite green (134 files / 1695 tests passed, 7 skipped, 0 failed). tsc clean. Two atomic commits (`28f4c69`, `4269c8f`) on `feat/tab-title-from-tmux`.

## Self-Check: PASSED

- src/ui/features/pretty-view/PrettyView.tsx modified — FOUND (verified by `git show HEAD --stat`).
- src/ui/features/pretty-view/PrettyView.virtualization.test.tsx modified — FOUND.
- Commit 28f4c69 (H3+H4) — FOUND in `git log`.
- Commit 4269c8f (M1+M2+M4) — FOUND in `git log`.
- use-auto-scroll.ts byte-identical (sha256 `fd47f724...`) — VERIFIED via diff HEAD~2 HEAD (empty).
- Full-suite vitest 0 failures — VERIFIED (134/134 files, 1695/1695 tests passing, 7 skipped incl. Test 2).
- tsc --noEmit exit 0 — VERIFIED.
