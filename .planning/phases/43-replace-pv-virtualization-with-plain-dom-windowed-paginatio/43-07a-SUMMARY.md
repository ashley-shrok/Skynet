---
phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio
plan: 07a
subsystem: ui
tags: [react, pretty-view, plain-dom, virtualizer-removal, overflow-anchor, aside-arm]

# Dependency graph
requires: ['43-04', '43-05', '43-06']
provides:
  - "PrettyView.tsx converted to plain-DOM message scroller — every messages[] entry renders as an in-flow [data-pv-bubble] child of the outer scroll container (no useVirtualizer, no absolute positioning, no measurement observer)"
  - "[overflow-anchor:none] Tailwind arbitrary-value class removed from the outer scroll container — browser default overflow-anchor:auto is now the sole scroll-position authority through measurement changes"
  - "estimatePvBubbleSize, getMessageText, observeElementRect, getItemKey, initialRect, scrollMargin, useVirtualizer/VirtualItem — ALL removed from PrettyView.tsx (dead code post-virtualizer)"
  - "Aside-arm backwards-walk at PrettyView.tsx:2056 byte-preserved via new PHASE-43 ASIDE-ARM WALK START/END anchor comments plus content-based grep signature"
  - "New test file src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx (~650 lines, 6 tests) locking plain-DOM render + overflow-anchor default + accessory sibling layout + all-five-bubble-types render + data-event-id preservation + aside-arm behavioral proxy"
affects: [43-07b, 43-08]

# Tech tracking
tech-stack:
  added: []  # Zero new dependencies — this is a deletion plan
  patterns:
    - "Plain-DOM message list rendering: `messages.map(m => <div data-pv-bubble data-event-id={m.eventId}>...</div>)` — browser handles all scroll-position preservation via overflow-anchor:auto (no userland observer/callback machinery)"
    - "Load-bearing byte-preserve via delimiter anchor comments + snapshot diff: the awk-extract range (`PHASE-43 ASIDE-ARM WALK START ... END`) is snapshotted pre-edit to `/tmp/43-07a-aside-before.txt`, verified post-edit via `diff` (exit 0 = byte-identical). Content-based grep signature (`grep -B1 -A6 <walk-pattern>`) is a secondary content witness that survives line-number shifts."
    - "Frozen-hook-API consumption: 43-06 froze useAutoScroll's return to {scrollRef, scrollToBottomAndFollow, isPinnedToBottom}. This plan consumes scrollRef DIRECTLY (no composed callback ref, no scrollElRef, no shared-scroll-container helper) — the plain-DOM path needs only one reader of the scroll element, so composition is unnecessary. Plan 43-07b will compose locally if it needs a second reader."

key-files:
  created:
    - "src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx (658 lines) — 6-test spec locking post-virtualizer behavior: Test 1 plain-DOM render (no absolute positioning / no translateY on any bubble), Test 2 outer scroll container className has no [overflow-anchor:none], Test 3 aside-arm walk behavioral proxy (isIdle:false→true on identity-attached session with trailing /id turn does not send aside_arm), Test 4 accessory bubble WipBubble mounts as a sibling of message-list inside outer scroll, Test 5 all five wire-frame bubble types render inside their own [data-pv-bubble] wrappers, Test 6 data-event-id preserved on every bubble. Every test also verifies absence of the virtualizer's `style='height: Npx; position: relative; width: 100%'` sized-container wrapper AND absence of per-item `position: absolute` + `translateY(...)` inline styles."
  modified:
    - "src/ui/features/pretty-view/PrettyView.tsx — 93 insertions / 268 deletions. Region A removes `useVirtualizer` import (whole `@tanstack/react-virtual` import line dropped). Region B removes `estimatePvBubbleSize` (exported) and `getMessageText` helpers (34 lines). Region C removes the entire ~110-line virtualizer setup cluster (scrollElRef useRef, useVirtualizer call, observeElementRect callback, getItemKey callback, estimateSize, scrollMargin, initialRect, composeScrollRefs composed callback). Region D swaps the outer scroll container className from `flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3 [overflow-anchor:none]` to the same string minus `[overflow-anchor:none]`, and rewrites the surrounding comment from the 'quick 260810-ia4 Fix 3' framing to a Phase 43 explanation. Region E replaces the sized virtualizer container + virtualRow.getVirtualItems().map with a plain `messages.map(m => <div key={m.eventId} data-pv-bubble data-event-id={m.eventId}>...</div>)` — bubble branch expression copied verbatim (ImageBubble / RelayOutboundBubble / RelayInboundBubble / MalformedBubble / ChatMessage) so per-bubble render output is byte-equivalent. Ref changed from `composeScrollRefs` to `scrollRef` (43-06's frozen API surface — direct consumption, no composition). Aside-arm backwards-walk at L2056 wrapped in PHASE-43 ASIDE-ARM WALK START/END anchor comments — walk body untouched, verified via delimiter-anchored diff AND content-based grep signature."

key-decisions:
  - "Consumed useAutoScroll's `scrollRef` DIRECTLY (no composed callback ref) at the outer scroll container. Rationale: 43-06 explicitly froze the hook's API at `{scrollRef, scrollToBottomAndFollow, isPinnedToBottom}`, and the plain-DOM path (this plan) has only one reader of the scroll element (useAutoScroll itself). Composition was needed under the virtualizer because BOTH useAutoScroll AND useVirtualizer's `getScrollElement` needed access to the same DOM node — with useVirtualizer gone, there's only one reader left. Plan 43-07b will compose locally if it needs a second reader for the fetch-older near-top-scroll trigger."
  - "Anchor-comment approach for aside-arm walk byte-preservation. Deleted content upstream (Regions B and C) shifts the walk's line number by ~140 lines, so a pure line-number-based verify would falsely trigger. The `// ── PHASE-43 ASIDE-ARM WALK START ──` / `// ── PHASE-43 ASIDE-ARM WALK END ──` anchor comments plus `awk '/START/,/END/'` extraction survive line-number shifts and give a delimiter-anchored byte-preservation test. Secondary content-based grep signature (`grep -B1 -A6` of the loop opener + checking for all four walk-body keywords) is a redundant witness — if the delimiter-anchored diff passes AND all four keywords are present in the walk's ±6-line window, the walk is confirmed byte-preserved."
  - "Kept the failing `PrettyView.virtualization.test.tsx` (5 tests) + `PrettyView.estimateSize.test.tsx` (9 tests) alive rather than deleting them or marking `.skip`. Plan 43-08 owns the deletion of both files per 43-CONTEXT.md § Deletion scope. Adding skip markers here would duplicate work 43-08 undoes (file-level deletion), and 5-9 test failures across two files-slated-for-deletion is well within the plan's tolerance (`only failures are PrettyView.virtualization.test.tsx and PrettyView.estimateSize.test.tsx`)."
  - "estimatePvBubbleSize was `export`ed for PrettyView.estimateSize.test.tsx's direct-call unit tests. Deleting it breaks all 9 of that file's tests at import time (module has no export named 'estimatePvBubbleSize') — the tests still 'run' but every `expect` throws. This is the expected 43-08 cleanup target — noted in the death-notice comment left where the helpers used to live so a future maintainer doesn't grep '43-07a' looking for the missing symbols."
  - "Regions D and E annotated with `// Phase 43 (plan 43-07a): ...` comments explaining what changed and why (browser overflow-anchor:auto is load-bearing, plain-DOM message rendering replaces virtualized rendering) so future maintainers understand the deliberate deletion and won't reintroduce virtualization on suspicion of 'better performance'. Also documents the same layout invariant Phase 27 Plan 27-02 Step B established (accessories as in-flow siblings below the .map output)."

patterns-established:
  - "Byte-preserve via delimiter-anchored diff surviving line-number shifts: wrap code you MUST NOT touch in PHASE-{N} anchor comments BEFORE any upstream edits, snapshot via `awk '/START/,/END/' file > /tmp/before.txt`, then verify post-edits via `diff /tmp/before.txt <(awk '/START/,/END/' file)`. Anchors survive line shifts; the diff catches any accidental byte-change inside the delimited range."
  - "Frozen-hook-API consumption without composition: when a downstream hook rewrite (43-06) freezes its return surface at N fields and only ONE consumer needs the underlying DOM element, consume the returned ref directly at the JSX callsite (`ref={scrollRef}`) rather than composing a callback ref that also captures a local useRef. Composition is only needed when TWO+ readers of the same DOM element exist."
  - "Death-notice comments where removed code used to live: when deleting exported helpers that had external consumers (estimatePvBubbleSize was used by PrettyView.estimateSize.test.tsx), leave a short comment in the source explaining what was removed, when (`Phase 43 (plan 43-07a):`), and why the downstream (`PrettyView.estimateSize.test.tsx breaks as a result and is scheduled for deletion in plan 43-08`). Avoids future 'why does this test file import a non-existent symbol' confusion for maintainers not carrying the phase context."

requirements-completed: []  # This plan's frontmatter has requirements: []

# Metrics
duration: ~62 min
completed: 2026-08-18
---

# Phase 43 Plan 07a: PrettyView Plain-DOM Conversion — Summary

**Retired the TanStack Virtual message-list cluster from PrettyView.tsx (~110 lines of virtualizer setup + ~90 lines of virtualized render + 34 lines of estimate helpers + 1 dep import + 1 Tailwind class) in favor of a plain-DOM `messages.map()` scroller; every message renders as an in-flow `[data-pv-bubble]` child of the outer scroll container. Browser default `overflow-anchor: auto` becomes the sole scroll-position authority. Aside-arm backwards walk at L2056 byte-preserved via new PHASE-43 anchor comments + content-based grep signature.**

## Performance

- **Duration:** ~62 min
- **Started:** 2026-08-18T17:34:13Z
- **Completed:** 2026-08-18T18:36:33Z (includes ~15-20 min of pretty-view test suite runtime across two full runs — 62 files / 662 tests takes ~7 min each pass)
- **Tasks:** 2 (RED test + GREEN surgery — plan flagged both `tdd="true"`)
- **Files modified:** 2 (1 new test file + 1 PrettyView.tsx surgery)

## Accomplishments

- **TanStack Virtual removed from PrettyView.tsx** — `useVirtualizer`, `VirtualItem`, `observeElementRect`, `estimatePvBubbleSize`, `getMessageText`, `getItemKey`, `initialRect`, `scrollMargin` all deleted. `grep -c 'useVirtualizer' PrettyView.tsx` returns 0. `grep -c '@tanstack/react-virtual' PrettyView.tsx` returns 0. Symbol-removal grep against non-`//` code returns 0 for all seven target symbols. The virtualizer dependency itself is still in package.json — plan 43-08 owns the `npm uninstall`.
- **Plain-DOM message rendering** — `messages.map(m => <div key={m.eventId} data-pv-bubble data-event-id={m.eventId}>...</div>)` produces in-flow children. No absolute positioning, no `translateY(...)` inline transforms, no sized virtualizer wrapper. Per-bubble render output is byte-equivalent to pre-plan — the bubble branch expression (ImageBubble / RelayOutboundBubble / RelayInboundBubble / MalformedBubble / ChatMessage) was copied verbatim.
- **`[overflow-anchor:none]` Tailwind class removed** — browser default `overflow-anchor: auto` is now the load-bearing scroll-position authority. This is what makes the phase's "prepend + image-decode + tall-bubble remeasure preserves visible content" story work natively without any userland observer/callback path. `grep -c '\[overflow-anchor:none\]' PrettyView.tsx` returns 0.
- **Aside-arm walk byte-preserved (proven via TWO independent witnesses)** — wrapped in new `// ── PHASE-43 ASIDE-ARM WALK START ──` / `// ── PHASE-43 ASIDE-ARM WALK END ──` anchor comments BEFORE the Region B/C/D deletions (which shift the walk's line number by ~140 lines). Snapshotted to `/tmp/43-07a-aside-before.txt` via `awk '/START/,/END/'`. Post-edit diff against snapshot exits 0 (byte-identical). Content-based grep signature — `grep -B1 -A6 'for (let i = messages.length - 1' PrettyView.tsx | grep -cE 'const m = messages\[i\]|role === "user"|isIdCommand|break;'` — returns 4 (all four walk-body identifiers present). Walk exists EXACTLY once (`grep -c` of the loop opener returns 1).
- **Frozen useAutoScroll API consumed directly at the outer scroll container** — `ref={scrollRef}` (no `composeScrollRefs`, no `scrollElRef`). Composition was needed under the virtualizer because both useAutoScroll AND useVirtualizer's `getScrollElement` read the same DOM element; with useVirtualizer gone there's exactly one reader, so composition is dead weight. Plan 43-07b will compose locally when it needs a second reader for the fetch-older near-top-scroll trigger.
- **Landed 6-test regression spec** in the new `PrettyView.plain-dom.test.tsx` (~658 lines). Tests: (1) plain-DOM render with no absolute positioning / no translateY on any of 20 bubbles, (2) outer scroll container className has no `[overflow-anchor:none]` and no inline `overflow-anchor: none`, (3) aside-arm behavioral proxy on isIdle:false→true with trailing `/id` user turn does not send aside_arm, (4) accessory WipBubble mounts as a sibling of message-list inside outer scroll container (not nested inside a `[data-pv-bubble]`), (5) all five wire-frame bubble types render inside their own `[data-pv-bubble]` wrappers with characteristic content present, (6) data-event-id preserved on every rendered bubble matching the frame's eventId. Every test also asserts absence of the sized virtualizer wrapper (`div[style*='position: relative']` with `height` + `width: 100%`) and absence of per-item `position: absolute` + `translateY(...)`. All 6 tests FAILED against the pre-edit virtualizer implementation (RED) and PASS against the post-edit plain-DOM implementation (GREEN).
- **Full pretty-view suite: 634/662 pass, only expected failures** — 14 failing tests distributed across exactly two files: `PrettyView.virtualization.test.tsx` (5 tests — Test 1 bounded-DOM, Test 4 getItemKey identity, Test 5a AsideBubble sibling, Test 5b PlanPendingBubble sibling, Test 8 M2 initialRect first-paint) and `PrettyView.estimateSize.test.tsx` (all 9 tests — module no longer exports estimatePvBubbleSize). Both files are on 43-08's deletion list per 43-CONTEXT.md § Deletion scope. No other regressions across the 60 other pretty-view test files. Meets the plan's acceptance criterion exactly: `only failures are PrettyView.virtualization.test.tsx and PrettyView.estimateSize.test.tsx`.
- **`npm run build` exits 0** in 7.90s — TypeScript API contract preserved end-to-end. `npm run build:backend` exits 0 — no backend surface touched.

## Task Commits

Each task was committed atomically on `feat/tab-title-from-tmux`:

1. **Task 1: RED — write failing PrettyView plain-DOM render spec** — `4391cb4c` (test)
2. **Task 2: GREEN — remove virtualizer + plain-DOM PrettyView scroller** — `e4076595` (refactor)

**Plan metadata commit:** (this SUMMARY.md + STATE.md + ROADMAP.md updates)

## Files Created/Modified

- **CREATED** `src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx` (658 lines) — 6-test regression spec locking post-virtualizer behavior. Test infrastructure (WS-stub factory, `flipToStreaming`, `fireWsMessage`, `fireMessageBatch`, ResizeObserver polyfill, `HTMLElement.prototype.offsetHeight` override) lifted from `PrettyView.virtualization.test.tsx` per 43-PATTERNS.md § 10 (that file gets deleted in 43-08). Aside-related mock scaffolding (`useSessionIdentityMock`, `resetWorkingStore`, `publishFleetStatusSessionState` calls) lifted from `PrettyView.aside.test.tsx`. Attribution comment at the top of the file records the copy sources.
- **MODIFIED** `src/ui/features/pretty-view/PrettyView.tsx` — +93 / -268 lines. Five surgical regions (A imports / B dead helpers / C virtualizer setup cluster / D outer scroll container className / E virtualized render → plain-DOM `messages.map`). Aside-arm walk at L2056 wrapped in PHASE-43 anchor comments (added BEFORE other edits, verified via delimiter-anchored `awk` + `diff` post-edit). `ref` on outer scroll container changed from `composeScrollRefs` to `scrollRef` (43-06's frozen API surface, direct consumption).

## Decisions Made

- **Direct `scrollRef` consumption over composition.** With useVirtualizer gone, only useAutoScroll reads the outer scroll DOM element — composition (via `composeScrollRefs` + local `scrollElRef`) was needed only because the virtualizer's `getScrollElement` also needed the reference. Deleted the composition machinery; the outer scroll container binds `ref={scrollRef}` directly. If 43-07b needs a second reader (fetch-older near-top-scroll trigger), it will compose locally per the frozen hook API per 43-06 SUMMARY.md § Decisions.
- **Anchor-comment byte-preserve strategy for the aside-arm walk.** The plan required byte-preservation of the L2056 walk, but Region B/C/D deletions upstream shift the walk's line number by ~140 lines, so a pure line-number verify would falsely trigger. Two-witness approach: (a) `PHASE-43 ASIDE-ARM WALK START/END` anchor comments plus `awk`-extract + `diff` snapshot; (b) content-based grep signature (`grep -B1 -A6` of the loop opener + presence check for all four walk-body identifiers). Both witnesses PASS post-edit.
- **estimatePvBubbleSize + getMessageText deleted (not marked deprecated).** They were used only by `PrettyView.estimateSize.test.tsx`, which is on 43-08's deletion list. Preserving them as dead code with a `@deprecated` tag would satisfy the tests but violate the plan's explicit deletion of the seven virtualizer symbols. Death-notice comment left where the helpers used to live so future maintainers understand the intentional removal.
- **PrettyView.virtualization.test.tsx + PrettyView.estimateSize.test.tsx left failing (not skipped).** 43-08 owns their deletion. Skipping them here would create phantom deletion churn that 43-08 would undo at file-level. 14 failures across two files-slated-for-deletion is within the plan's tolerance (`only failures are ...`).
- **Test 3 (aside-arm behavioral proxy) documented as a weak upper-bound assertion.** `AUTO_ASIDE_ARM_ENABLED = false` at PrettyView.tsx:79 (per Ashley 2026-07-27 — same reason `PrettyView.aside.test.tsx` Tests 3/4/7/8/9 are `.skip`), so `ws.send('aside_arm')` never fires regardless of what the walk does while the flag is off. The walk itself still runs on every isIdleDerived transition upstream of the flag gate; if it was accidentally deleted, the effect would throw or misbehave. The STRONG byte-preserve invariants are the two `Task 2` verify witnesses (anchor diff + content grep); Test 3 is a supplementary structural smoke check.

## Deviations from Plan

### Auto-fixed Issues

None. The plan's Task 1 + Task 2 spec was followed exactly. No Rule 1/2/3/4 triggers surfaced during execution.

### Notes (not deviations, but worth recording)

- **First full-suite pretty-view run showed a transient failure in `ComposeBox.test.tsx > Test 1: no chip strip when stagedAttachments is empty` (JSDOM race under parallel test load).** Re-running the same suite command 3 minutes later showed 634/662 passing with only the expected `PrettyView.virtualization.test.tsx` + `PrettyView.estimateSize.test.tsx` failures. Filter-run of just that ComposeBox test passed 1/1 in 4.54s. Conclusion: unrelated flaky test — not a regression from this plan.
- **The plan's Task 2 action step called out `AsideBubble` in the "CRITICAL preserves" block. AsideBubble render behavior is transitively preserved by copying the accessory JSX verbatim (WipBubble → WaitingBubble → PlanPendingBubble → DormancyOverlay → AsideBubble → jump-to-bottom pill).** Same order, same conditional gates (`isWorking && <WipBubble />`, `waitingFor !== null && <WaitingBubble />`, `planPending && <PlanPendingBubble />`, `renderedState === "dormant" && <DormancyOverlay />`, `asideText !== null && <AsideBubble />`). Verified by inspection during Region E surgery.

## Known Stubs

None. No stub components, no placeholder data, no TODO markers introduced. Every rendered bubble component gets its real data (via the same JSX branch expression the virtualizer used, copied verbatim).

## Files In Scope

- `src/ui/features/pretty-view/PrettyView.tsx` (modified, +93 / -268)
- `src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx` (created, 658 lines)

## Files NOT Touched (deliberately)

- `src/ui/features/pretty-view/use-auto-scroll.ts` — 43-06 owns this file; frozen API. Consumed via existing call site at PrettyView.tsx:747 (no change).
- `package.json` / `package-lock.json` — 43-08 owns the `@tanstack/react-virtual` uninstall.
- `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` — 43-08 owns deletion of this file.
- `src/ui/features/pretty-view/PrettyView.estimateSize.test.tsx` — 43-08 owns deletion of this file.
- `src/ui/api/claude-session-api.ts` — 43-07b owns `sendFetchOlder` / `isFetchOlderBatchEvent` wire-up.
- All bubble component files (ChatMessage.tsx / ImageBubble.tsx / RelayOutboundBubble.tsx / RelayInboundBubble.tsx / MalformedBubble.tsx / WipBubble.tsx / WaitingBubble.tsx / PlanPendingBubble.tsx / DormancyOverlay.tsx / AsideBubble.tsx) — bubble interiors unchanged.
- All backend files, WS API, nginx.conf, docker files.

## Verification Evidence

```
$ grep -c "useVirtualizer" src/ui/features/pretty-view/PrettyView.tsx
0
$ grep -c "@tanstack/react-virtual" src/ui/features/pretty-view/PrettyView.tsx
0
$ grep -v '^\s*//' src/ui/features/pretty-view/PrettyView.tsx | grep -c 'useVirtualizer\|VirtualItem\|observeElementRect\|estimatePvBubbleSize\|getItemKey\|initialRect\|scrollMargin\|getMessageText'
0
$ grep -v '^\s*//' src/ui/features/pretty-view/PrettyView.tsx | grep -c '\[overflow-anchor:none\]'
0
$ grep -c "data-pv-bubble" src/ui/features/pretty-view/PrettyView.tsx
3
$ grep -c "for (let i = messages.length - 1; i >= 0; i--)" src/ui/features/pretty-view/PrettyView.tsx
1
$ grep -B1 -A6 "for (let i = messages.length - 1; i >= 0; i--)" src/ui/features/pretty-view/PrettyView.tsx | grep -cE 'const m = messages\[i\]|role === "user"|isIdCommand|break;'
4
$ grep -c "PHASE-43 ASIDE-ARM WALK START" src/ui/features/pretty-view/PrettyView.tsx
1
$ grep -c "PHASE-43 ASIDE-ARM WALK END" src/ui/features/pretty-view/PrettyView.tsx
1
$ awk '/PHASE-43 ASIDE-ARM WALK START/,/PHASE-43 ASIDE-ARM WALK END/' src/ui/features/pretty-view/PrettyView.tsx | diff /tmp/43-07a-aside-before.txt -
(exit 0 — no output, byte-identical)

$ npx vitest run src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx
Tests  6 passed (6)

$ npx vitest run src/ui/features/pretty-view/
Test Files  2 failed | 60 passed (62)
Tests  14 failed | 634 passed | 13 skipped | 1 todo (662)
(All 14 failures in PrettyView.virtualization.test.tsx (5) + PrettyView.estimateSize.test.tsx (9)
 — both files slated for deletion in plan 43-08.)

$ npm run build
✓ built in 7.90s

$ npm run build:backend
(exit 0, no output)
```

## What Plan 43-07b Consumes From This Plan

- Plain-DOM message list rendering at PrettyView.tsx (the `messages.map(m => <div data-pv-bubble ...>...</div>)` block). 43-07b wraps this map with drop-oldest cap enforcement on live-append and prepend-dedup on the new `case "fetch_older_batch":` in the WS onmessage switch.
- `[overflow-anchor:none]` removed — 43-07b's fetch-older prepend path relies on the browser's `overflow-anchor: auto` to preserve visible content across the prepend.
- Outer scroll container binds `ref={scrollRef}` directly. 43-07b will compose a local ref via a small `composeRefs` inline utility if it needs a second reader for the fetch-older near-top-scroll trigger.
- Aside-arm walk byte-preserved with anchor comments in place. 43-07b's drop-oldest cap MUST NOT drop the last user turn — but drop-from-oldest-end (per 43-CONTEXT.md § Drop policy) guarantees this by construction. The anchor comments remain as a canary if a future maintainer mis-implements drop-from-newest.

## What Plan 43-08 Consumes From This Plan

- Zero remaining `useVirtualizer` / `VirtualItem` / `estimatePvBubbleSize` / `getMessageText` / `observeElementRect` / `getItemKey` / `initialRect` / `scrollMargin` references in PrettyView.tsx — 43-08's `grep -r @tanstack/react-virtual src/` will be clean once `package.json` is updated.
- `PrettyView.virtualization.test.tsx` (5 test failures) + `PrettyView.estimateSize.test.tsx` (9 test failures) — 43-08 deletes both files, dropping the test count by 22 and returning full-suite green.
- `@tanstack/react-virtual@3.14.9` still in `package.json` — 43-08 runs `npm uninstall @tanstack/react-virtual` and verifies `package-lock.json` no longer references it.

## Self-Check: PASSED

- FOUND: src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx (created 658 lines)
- FOUND: src/ui/features/pretty-view/PrettyView.tsx (modified +93/-268)
- FOUND commit: 4391cb4c (test: PrettyView plain-DOM render spec)
- FOUND commit: e4076595 (refactor: remove TanStack Virtual + plain-DOM PrettyView scroller)
- FOUND anchor: PHASE-43 ASIDE-ARM WALK START (grep -c returns 1)
- FOUND anchor: PHASE-43 ASIDE-ARM WALK END (grep -c returns 1)
- FOUND byte-preserve: diff /tmp/43-07a-aside-before.txt <(awk '/PHASE-43 ASIDE-ARM WALK START/,/PHASE-43 ASIDE-ARM WALK END/' src/ui/features/pretty-view/PrettyView.tsx) exits 0
- FOUND build: npm run build exits 0
- FOUND build: npm run build:backend exits 0
- FOUND tests: PrettyView.plain-dom.test.tsx — 6/6 pass
- FOUND expected regressions: only PrettyView.virtualization.test.tsx (5) + PrettyView.estimateSize.test.tsx (9) — both slated for deletion in 43-08
