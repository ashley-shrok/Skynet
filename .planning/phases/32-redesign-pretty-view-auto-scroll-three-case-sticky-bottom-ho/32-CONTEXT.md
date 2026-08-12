# Phase 32: Redesign pretty-view auto-scroll — Context

**Gathered:** 2026-08-12
**Status:** Ready for planning
**Source:** Direct capture of Ashley ↔ Tina design conversation (2026-08-12); no discuss-phase needed — design was settled interactively before phase was opened.

<domain>
## Phase Boundary

Rip out the temp-disabled `use-auto-scroll.ts` (225 lines, unused since 2026-08-10 quick 260810-299) and replace it with a fresh ~80-line hook that handles exactly three user-facing cases:

1. **Session first load** — when a PrettyView session loads, land at the bottom (otherwise you're stranded at the top of long conversations and have to hit the jump-to-bottom pill multiple times).
2. **New messages while already at bottom** — follow (pin-to-bottom).
3. **User sends** — force scroll to bottom regardless of current scroll position. Applies to ALL send paths: Enter/click, queued messages firing after idle (Hourglass), voice-send, aside-morph resume.

**Implicit inverse (Ashley confirmed):** if the user is scrolled UP reading history, new incoming messages do NOT yank them down. The existing jump-to-bottom pill stays the manual affordance.

Nothing else. Ashley verbatim 2026-08-12: *"one of the goals I have here is to keep it simple, because the old auto-scroll behavior got pretty complicated when I asked for a bunch of different cases to be handled."* And: *"I want this to be done right so if you have to rip out the old stuff and start fresh or adjust things like you know that's my priority."*

Supersedes bounty `pv-disable-auto-scroll-temp` — this phase closes that hole by replacing the disable with a working design.

</domain>

<decisions>
## Implementation Decisions (LOCKED — do not re-litigate)

### Hook shape — one axis, one action, one flag

- **`stickyRef: MutableRefObject<boolean>`** — default `true`. The single state axis. When true, content growth or send events trigger `scrollTop = scrollHeight`. When false, the user is reading history and nothing auto-scrolls.
- **`programmaticRef: MutableRefObject<boolean>`** — set `true` immediately before every `scrollTop` write, cleared in the next `requestAnimationFrame` (after the browser has fired its scroll event). The scroll-event listener uses this flag to distinguish "we jumped" from "user scrolled."
- **`isPinnedToBottom: boolean` state** — used ONLY for pill visibility. Kept in sync with the geometric predicate `scrollHeight - scrollTop - clientHeight <= BOTTOM_THRESHOLD`.
- **One exported action, `scrollToBottomAndFollow()`** — used by both the jump-to-bottom pill AND every send-path caller. No separate `forceStickAndJump` variant. Same primitive: enter sticky + jump + brief rAF re-arm to absorb async content settle (~150ms).

### Event handling — one listener, not three

- **Single `scroll` event listener** on the outer scroll container. Replaces the old `wheel` + `keydown` + `touchmove` trifecta.
- Distinguish source via `programmaticRef`:
  - If `programmaticRef` is true → ignore this scroll event entirely (it's ours; don't flip sticky, don't touch pill state).
  - Otherwise → real user scroll. If `scrollTop` decreased vs last known → `stickyRef.current = false`. If distance-from-bottom crossed into threshold → `stickyRef.current = true`. Update `isPinnedToBottom` in both cases.
- **Rationale:** every real input source (mouse wheel, keyboard PageUp/ArrowUp, touch drag, scrollbar drag, iOS momentum) fires `scroll`. There's no need to intercept the source events individually.

### ResizeObserver — outer scroll container, not the sized virtualizer container

- Observe the **outer scroll container** (the div with `overflow-y: auto`), NOT the inner sized virtualizer container.
- **Rationale (closes H1 accessory-mount blind spot):** post-Phase-27 Step-B, accessories (`WipBubble`, `PlanPendingBubble`, `AsideBubble`) live as in-flow SIBLINGS of the sized virtualizer container, inside the outer scroll container. An RO on the sized virtualizer container never sees accessory mounts and thus never triggers the pin-to-bottom follow when Wip/Plan/Aside pop in. An RO on the outer scroll container sees `scrollHeight` change regardless of what child caused it.

### No load-lock that blocks user gestures

- The old hook had `loadLockUntilRef` that IGNORED user gestures for 300ms after a paneKey change or send. That's what stole scroll intent during the lock window.
- **Replacement:** the sticky rAF chain runs while `stickyRef.current` is true. If the user scrolls up during the chain, the scroll listener flips `stickyRef.current = false`, and the chain's next tick sees `if (!stickyRef.current) return` and halts naturally. No time-gated blocking of user input.

### paneKey change → stickAndJump

- The hook takes a `paneKey: string` argument. On paneKey change (including initial mount, since the initial value counts as a change from the effect's perspective), call the internal `stickAndJump` primitive:
  1. `stickyRef.current = true`
  2. `setIsPinnedToBottom(true)`
  3. Start a brief rAF chain that writes `scrollTop = scrollHeight` for ~150ms (absorbs image decode / async backfill).
  4. Chain checks `if (!stickyRef.current) return` at the top of each tick so the user can un-stick it by scrolling up mid-chain.

### `overflow-anchor: none` on the outer scroll container

- Prevents browser scroll-anchoring from fighting our `scrollTop` writes when content grows above the viewport.
- **Already present** as a static Tailwind arbitrary variant `[overflow-anchor:none]` on `composeScrollRefs` div (shipped in patch #385 `quick 260810-ia4`). Keep it — do not re-add via the hook (patch #385's static class is authoritative and covers the case where the hook is disabled).

### Wire into PrettyView

- Call `useAutoScroll(paneKey)` in PrettyView.tsx. Destructure `{ scrollRef, scrollToBottomAndFollow, isPinnedToBottom }`.
- Compose `scrollRef` with the virtualizer's outer scroll container ref via the existing `composeScrollRefs` callback pattern (PrettyView.tsx already has this pattern from when the old hook was active).
- Contentref: the OLD hook took a separate `contentRef` to observe the inner content container. The new hook does NOT need this — it observes the outer scroll container. **Simplification: drop the `contentRef` API entirely.**
- Wire `scrollToBottomAndFollow` to:
  - The jump-to-bottom pill's `onClick` (currently uses the stub's version at PrettyView.tsx L2265).
  - `handleComposeSend` (currently calls `forceStickAndJumpRef.current()` — swap to `scrollToBottomAndFollow()` directly).
  - `onGoodToGo` (PrettyView.tsx L2394).
  - Any OTHER send-path caller: queued-slot send in `handleQueueSlotSend`, voice `handleVoiceSend`, `handleVoiceAppend` (if it emits), aside-morph `onAsideDismiss` if it triggers a send.
- Delete: `forceStickAndJumpRef` and `forceStickAndJump` — no longer needed (single action).
- Delete: `isPinnedToBottom` local state + scroll listener stub in PrettyView.tsx L751-914 (hook owns this now).

### Test coverage — four scenarios

The plan must ship tests for exactly these four scenarios (mirrors the design cases + inverse):

1. **Session first load lands at bottom** — mount a fresh pane with N messages of varying heights; assert `scrollTop === scrollHeight` after the rAF chain settles.
2. **Incoming message while at bottom → follow** — pane at bottom, dispatch a new message via the WS pane, assert `scrollTop === scrollHeight` after the RO fires.
3. **Incoming message while scrolled up → NO follow** — pane scrolled up 500px, dispatch a new message, assert `scrollTop` unchanged (does not yank to bottom).
4. **User send from any state → force bottom** — pane scrolled up 500px, call `handleComposeSend`, assert `scrollTop === scrollHeight`.

### Ripping out the old stuff

- **Delete `use-auto-scroll.ts` entirely.** Do NOT keep it in-tree as reference; git history is the reference. New hook lives in a new file at `src/ui/features/pretty-view/use-auto-scroll.ts` (same path, replaces the byte-untouched previous file).
- **Delete the stub in PrettyView.tsx** L751-914 (the manual `isPinnedToBottom` scroll listener + no-op `forceStickAndJump` + pure-imperative `scrollToBottomAndFollow`).
- **Un-skip** the currently-`it.skip`ped test `PrettyView.virtualization.test.tsx` Test 2 (`auto-scroll-to-bottom-when-pinned`) that was skipped by quick 260810-299. Adapt to the new hook shape.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Hook + wiring
- `src/ui/features/pretty-view/use-auto-scroll.ts` — the CURRENT (disabled, 225-line) hook. Reference for what it TRIED to do; not necessarily what the new hook should look like. Delete during implementation.
- `src/ui/features/pretty-view/PrettyView.tsx` L751-914 — the current stub replacing the hook (`isPinnedToBottom` scroll listener + `scrollToBottomAndFollow` pure jump + `forceStickAndJump` no-op). Delete during implementation.
- `src/ui/features/pretty-view/PrettyView.tsx` L2260-2270 — jump-to-bottom pill (consumes `scrollToBottomAndFollow` + `isPinnedToBottom`).
- `src/ui/features/pretty-view/PrettyView.tsx` L602-627 — `handleComposeSend` (calls `forceStickAndJumpRef.current()` — swap target).
- `src/ui/features/pretty-view/PrettyView.tsx` L2114-2145 — outer `composeScrollRefs` div + inner sized virtualizer container (the two elements the new hook cares about — new hook observes ONLY the outer via RO).

### Send-path call sites (must call scrollToBottomAndFollow after fresh dispatch)
- `handleComposeSend` — primary Send / Enter path.
- `handleQueueSlotSend` — queued-message idle-fire path (grep in PrettyView.tsx + ComposeBox.tsx).
- Voice send paths — `handleVoiceSend`, `handleVoiceAppend` (grep).
- Aside-morph resume — `onAsideDismiss` if it triggers a re-send (grep).
- `onGoodToGo` at PrettyView.tsx ~L2394 — the "let's go" quick-send button.

### Post-Phase-27 layout (the reason H1 exists)
- `src/ui/features/pretty-view/PrettyView.tsx` L2219-2249 — accessories (WipBubble/PlanPendingBubble/AsideBubble) render as in-flow siblings of the sized virtualizer container. This is why the new hook must RO the OUTER scroll container.

### Test surfaces
- `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` — Test 2 (`auto-scroll-to-bottom-when-pinned`) currently `.skip`ped by quick 260810-299. Un-skip and adapt.
- Existing test infrastructure for WS event dispatch + JSDOM message rendering in the same file.

### Prior art / superseded bounties
- Bounty `pv-auto-scroll-redesign` timeline entry `2026-08-12T18:05:00Z` — full design detail from the Ashley ↔ Tina conversation (this CONTEXT.md is the phase-scoped extraction).
- Bounty `pv-disable-auto-scroll-temp` — the temp disable this phase supersedes.
- Patch #385 (quick 260810-ia4) — jitter down-payment: type-aware estimateSize + image aspect-ratio 4/3 + overflow-anchor:none on outer scroll container. Keep all three.
- `~/.claude/roles/box-maintainer/skynet-patches.md` — patch catalog.

</canonical_refs>

<specifics>
## Specific Ideas

### Signature the executor should ship

```typescript
export interface UseAutoScrollResult {
  scrollRef: (el: HTMLElement | null) => void;   // Callback ref for OUTER scroll container
  scrollToBottomAndFollow: () => void;           // Used by pill + all send paths
  isPinnedToBottom: boolean;                     // Pill visibility only
}

export function useAutoScroll(paneKey: string): UseAutoScrollResult;
```

Note: no `contentRef` export (dropped from old API), no `forceStickAndJump` export (folded into the single action).

### Constants

```typescript
const BOTTOM_THRESHOLD = 100;   // px — matches old hook
const STICK_ARM_MS = 150;       // rAF chain duration for load/send re-arm
```

Old hook used `LOAD_LOCK_MS = 300` — this shrinks to 150 because the new hook halts the chain when user un-sticks, so the risk of "chain still fighting user gesture at 200ms" is gone.

### TanStack Virtual scrollTop-write behavior — verify at implementation

Open question the planner should surface as an implementation-time verification: **does TanStack Virtual's `useVirtualizer` write to `scrollEl.scrollTop` directly as part of its measurement-adjustment flow?** If yes, those writes would look like un-flagged programmatic scrolls under the new hook and could accidentally trigger un-stick / pill-flip logic.

- **How to verify:** search `node_modules/@tanstack/virtual-core/**/*.js` for `scrollTop =` or `scrollBy` writes.
- **If no writes found:** design is complete as-drawn.
- **If writes found:** mitigation is straightforward — wrap the write points via TanStack's known measurement events, OR use a scroll-event debounce that ignores single scroll events with `scrollTop` deltas smaller than a threshold (measurement adjustments are typically <20px; user scrolls are usually larger). Not a blocker, just a verification checkpoint.

Executor should not skip this verification.

</specifics>

<deferred>
## Deferred Ideas

- Library swap to `react-virtuoso`'s `<VirtuosoMessageList>` — parked from bounty `pv-auto-scroll-redesign`. If this phase's simple design still shows jitter under Ashley UAT, library swap is the fallback (bigger refactor, purpose-built for chat). But we're not doing it this phase.
- Subscribe to TanStack Virtual's measurement events to preserve `scrollTop` across measurement adjustments — parked. Only pursue if the "TanStack Virtual scroll writes" verification above surfaces something the programmaticRef flag can't cover.
- Additional scroll behaviors Ashley might want later (scroll-into-view for specific messages, scroll-to-mention, etc.). Not in scope.
- Any changes to WipBubble / PlanPendingBubble / AsideBubble themselves. Not in scope — the RO-on-outer-container design absorbs their mounts without changing them.
- Any changes to patch #385's three jitter-class fixes (type-aware estimateSize, aspect-ratio 4/3, static overflow-anchor:none). Those stay.

</deferred>

---

*Phase: 32-redesign-pretty-view-auto-scroll-three-case-sticky-bottom-ho*
*Context captured: 2026-08-12 directly from Ashley ↔ Tina design conversation. No discuss-phase run — design was settled interactively before phase-open.*
