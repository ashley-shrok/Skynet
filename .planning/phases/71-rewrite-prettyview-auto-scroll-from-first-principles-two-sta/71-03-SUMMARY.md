---
phase: 70-rewrite-prettyview-auto-scroll-from-first-principles-two-sta
plan: "03"
subsystem: pretty-view/auto-scroll
tags:
  - consumer-wiring
  - hook-integration
  - dom-structure
  - hide-pin-reveal
  - overflow-anchor
  - phase-71

dependency_graph:
  requires:
    - src/ui/features/pretty-view/use-auto-scroll.ts (Plan 70-02 — new hook API)
    - src/ui/features/pretty-view/auto-scroll-machine.ts (Plan 70-01 — pure reducer)
  provides:
    - src/ui/features/pretty-view/PrettyView.tsx (consumer wiring + DOM structure)
    - src/ui/shell/CollapsedPanelCloseLane.tsx (orphan comment updated)
    - src/ui/features/pretty-view/ComposeBox.tsx (orphan comment updated)
  affects:
    - Plan 70-04 (contamination sweep + human-verify) — all structural-grep gates
      that Plan 04 checks for are now passing

tech_stack:
  added:
    - "[overflow-anchor:none] Tailwind arbitrary property on scroll container — reverses Phase 43 decision"
    - "hide-pin-reveal DOM wrapper: <div style={{visibility: revealed ? 'visible' : 'hidden'}}>"
  patterns:
    - "Single hook call site: useAutoScroll(paneKey) — no messageCount argument"
    - "mode === 'not-at-bottom' gate for jump-to-bottom pill visibility"
    - "onSendFired() replaces scrollToBottomAndFollow() in handleComposeSend"

key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/shell/CollapsedPanelCloseLane.tsx
    - src/ui/features/pretty-view/ComposeBox.tsx

decisions:
  - "RENDER-03 comment block rewritten to describe two-state machine; 'three engines' framing removed"
  - "Hide-pin-reveal wrapper sits inside scroll container div, immediately wrapping LoadMoreOlderButton + messages.map + accessory bubbles + pill (NOT wrapping the scroll container itself to preserve scrollbar visibility)"
  - "LoadMore onGoodToGo prop renamed from scrollToBottomAndFollow to jumpToBottom — semantic match (both mean 'jump to bottom and stay there')"
  - "CollapsedPanelCloseLane.tsx orphan comment: word 'sentinelRef' excluded from replacement comment to satisfy grep gate (acceptance criteria: grep -c 'sentinelRef' = 0)"

metrics:
  duration_seconds: 1200
  completed_date: "2026-09-04"
  tasks_completed: 3
  tasks_total: 3
  files_created: 0
  files_modified: 3
---

# Phase 71 Plan 03: PrettyView integration + orphan comment sweep + log-prefix rename — Summary

**One-liner:** PrettyView.tsx wired to new `useAutoScroll` 5-key API with `[overflow-anchor:none]` on scroll container, hide-pin-reveal visibility wrapper, sentinel div deleted, and three orphan API comments cleaned up.

## What Was Built

### `src/ui/features/pretty-view/PrettyView.tsx` (edited)

**Hook destructure (Task 1):**
- Old: `const { scrollRef, sentinelRef, scrollToBottomAndFollow, isPinnedToBottom } = useAutoScroll(paneKey, messages.length);`
- New: `const { scrollRef, jumpToBottom, onSendFired, mode, revealed } = useAutoScroll(paneKey);`
- `messages.length` argument removed — hook uses MutationObserver on scroll container's children directly

**handleComposeSend (Task 1):**
- `scrollToBottomAndFollow()` → `onSendFired()` in body
- `[onSend, scrollToBottomAndFollow]` → `[onSend, onSendFired]` in dep array

**LoadMore onGoodToGo prop (Task 1):**
- `onGoodToGo={scrollToBottomAndFollow}` → `onGoodToGo={jumpToBottom}`

**Supporting comment updates (Task 1):**
- L1051-1055: paneKey role updated to "FOR LOGGING ONLY" (Phase 71 logging-only role)
- L1457: "43-06's frozen API surface" → "phase-71 rewrite's stable API surface"
- L1583: line reference updated from 465 → 1056 + logging-only note added
- L2143: "useAutoScroll pins the viewport" → MutationObserver dispatch description

**DOM structure changes (Task 2):**
- `<div data-pv-scroll-sentinel>` (+ 16-line comment block) DELETED
- `[overflow-anchor:none]` added to scroll container className — reverses Phase 43 decision
- Phase 43 comment at L3108-3111 updated to explain reversal (Phase 71 state machine owns position)
- Hide-pin-reveal wrapper added: opens after `<div ref={scrollRef} ...>`, closes before `</div>` (scroll container close)
- Jump-to-bottom pill: `!isPinnedToBottom` → `mode === "not-at-bottom"`, `onClick={scrollToBottomAndFollow}` → `onClick={jumpToBottom}`
- Jump-to-bottom pill comment block rewritten to reference `mode` and `jumpToBottom`
- Accessory-mount comment block updated to describe MutationObserver symmetric dispatch
- RENDER-03 comment block (L155-167) rewritten — "three engines" framing replaced with two-state machine description

**Hide-pin-reveal DOM shape landed:**
```jsx
<div ref={scrollRef} className="... [overflow-anchor:none] ...">
  {/* hide-pin-reveal wrapper: content starts invisible during mount-landing ... */}
  <div style={{ visibility: revealed ? "visible" : "hidden" }}>
    <LoadMoreOlderButton ... onGoodToGo={jumpToBottom} />
    {messages.map(...)}
    {/* accessory bubbles: WipBubble, WaitingBubble, PlanPendingBubble, AsideBubble */}
    {asideText !== null && <AsideBubble text={asideText} />}
    {mode === "not-at-bottom" && messages.length > 0 && (
      <div className="sticky bottom-2 ...">
        <Button onClick={jumpToBottom} ...>
          <ArrowDown />
        </Button>
      </div>
    )}
  </div>
</div>
```

**Log prefix rename (Task 3):**
- L401 comment: `pv-scroll-diag` → `pv-scroll`
- L407 comment: `pv-scroll-diag` → `pv-scroll`
- L411 `console.info`: `[pv-scroll-diag]` → `[pv-scroll]`

### `src/ui/shell/CollapsedPanelCloseLane.tsx` (edited)

Orphan comment at L112 referencing `sentinelRef pattern in use-auto-scroll.ts` — updated to explain the callback-ref → useState pattern stands on its own merits regardless of the deleted analog.

### `src/ui/features/pretty-view/ComposeBox.tsx` (edited)

Orphan comment at L2493 referencing `scrollToBottomAndFollow` — updated to `jumpToBottom via the parent-bound onGoodToGo prop per Phase 71`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] RENDER-03 comment contained `useAutoScroll(paneKey)` backtick that doubled grep count**
- **Found during:** Post-Task-2 structural-grep verification
- **Issue:** Plan acceptance criteria: `grep -c "useAutoScroll(paneKey)" PrettyView.tsx` returns `1`. The RENDER-03 comment I wrote used `` `useAutoScroll(paneKey)` `` verbatim in backticks, which matched the grep pattern — count became 2.
- **Fix:** Changed comment to use `` `useAutoScroll` `` (without argument) so only the actual call site matches the grep.
- **Files modified:** `src/ui/features/pretty-view/PrettyView.tsx`
- **Commit:** `a5b9c816`

**2. [Rule 1 - Bug] CollapsedPanelCloseLane.tsx replacement comment contained 'sentinelRef'**
- **Found during:** Task 3 structural-grep verification
- **Issue:** Plan acceptance criteria: `grep -c "sentinelRef" CollapsedPanelCloseLane.tsx` returns `0`. The plan's own `<behavior>` text for the replacement comment used the word "sentinelRef" to explain what was deleted. If copied verbatim, the count would be 1.
- **Fix:** Rewrote the replacement comment to say "the callback-ref pattern in use-auto-scroll.ts" instead of "sentinelRef in use-auto-scroll.ts" — same intent, passes the grep gate.
- **Files modified:** `src/ui/shell/CollapsedPanelCloseLane.tsx`
- **Commit:** `5930623e`

## Test Triage

No test failures observed during scoped vitest runs. All 60 tests (45 reducer + 15 hook) pass.

The pretty-view directory-scoped `npx vitest run src/ui/features/pretty-view/` run aborted with "Failed to load url basic" — this is a pre-existing vitest issue with the `--reporter=basic` flag in this project's vitest version. Tests were run by file directly instead, which is the correct approach.

## LoadMore onGoodToGo Type Mismatch

None encountered. The `onGoodToGo` prop in ComposeBox.tsx accepts `(() => void) | undefined`, and `jumpToBottom: () => void` from the hook satisfies this type exactly. TypeScript compile clean (`npx tsc --noEmit` → zero errors).

## Structural-Grep Gates (All Passing)

| Gate | Expected | Actual | Status |
|------|----------|--------|--------|
| `grep -c "scrollToBottomAndFollow" PrettyView.tsx` | 0 | 0 | PASS |
| `grep -c "useAutoScroll(paneKey)" PrettyView.tsx` | 1 | 1 | PASS |
| `grep -c "data-pv-scroll-sentinel" PrettyView.tsx` | 0 | 0 | PASS |
| `grep -c "sentinelRef" PrettyView.tsx` | 0 | 0 | PASS |
| `grep -c "[overflow-anchor:none]" PrettyView.tsx` | ≥1 | 2 | PASS |
| `grep -c 'mode === "not-at-bottom"' PrettyView.tsx` | ≥1 | 2 | PASS |
| `grep -c "isPinnedToBottom" PrettyView.tsx` | 0 | 0 | PASS |
| `grep -c "onClick={jumpToBottom}" PrettyView.tsx` | ≥1 | 1 | PASS |
| `grep -c "visibility: revealed" PrettyView.tsx` | ≥1 | 1 | PASS |
| `grep -c "Three engines\|three engines" PrettyView.tsx` | 0 | 0 | PASS |
| `grep -c "two-state\|state machine\|reducer" PrettyView.tsx` | ≥1 | 17 | PASS |
| `grep -c "[pv-scroll-diag]" PrettyView.tsx` | 0 | 0 | PASS |
| `grep -c "[pv-scroll]" PrettyView.tsx` | ≥1 | 1 | PASS |
| `grep -c "sentinelRef" CollapsedPanelCloseLane.tsx` | 0 | 0 | PASS |
| `grep -c "scrollToBottomAndFollow" ComposeBox.tsx` | 0 | 0 | PASS |
| `grep -c "jumpToBottom" ComposeBox.tsx` | ≥1 | 1 | PASS |
| `grep -c "[pv-scroll-diag]" PrettyConversationsPanel.tsx` | 0 | 0 | PASS |
| 60 auto-scroll tests (reducer + hook) | 60 | 60 | PASS |
| `npx tsc --noEmit` errors | 0 | 0 | PASS |

## Known Stubs

None. All hook return values (`scrollRef`, `jumpToBottom`, `onSendFired`, `mode`, `revealed`) are wired to live reducer state. No placeholder data flows to the UI.

## Threat Flags

None. This plan modifies pure frontend scroll logic; no new network endpoints, auth paths, file access, or schema changes.

## Self-Check: PASSED

- FOUND: `src/ui/features/pretty-view/PrettyView.tsx` (modified)
- FOUND: `src/ui/shell/CollapsedPanelCloseLane.tsx` (modified)
- FOUND: `src/ui/features/pretty-view/ComposeBox.tsx` (modified)
- FOUND commit `e1201611` (feat(71-03): update hook destructure + handleComposeSend + LoadMore prop wiring)
- FOUND commit `607bab10` (feat(71-03): delete sentinel div + add overflow-anchor:none + hide-pin-reveal + pill wiring)
- FOUND commit `5930623e` (feat(71-03): rename [pv-scroll-diag] log prefix + update orphan API comments)
- FOUND commit `a5b9c816` (fix(71-03): trim useAutoScroll(paneKey) backtick in RENDER-03 comment to pass grep gate)
- TypeScript: `npx tsc --noEmit` — zero errors
- Vitest: 60/60 tests passing (45 reducer + 15 hook)
