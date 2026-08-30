# Phase 27: Virtualize PrettyView message list (iter 3) — Pattern Map

**Mapped:** 2026-08-09
**Files analyzed:** 5 to modify, 1 to create, plus tests
**Analogs found:** 4 / 6 (2 files have no in-repo virtualization analog — expected; TanStack Virtual is the first virtualizer this codebase adopts)

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `package.json` (MOD, root add of `@tanstack/react-virtual`) | config / dep | one-shot install | `package.json` § dependencies additions in prior phases (all previous phases were "no new dep"; no in-repo prior art of adding a runtime frontend dep) | no-analog |
| `src/ui/features/pretty-view/PrettyView.tsx` (MOD, replace `messages.map` block) | presentation component | request-response (WS-driven list render) | own current message-map block at `PrettyView.tsx:1725-1781` | exact (self-analog — refactor in place) |
| `src/ui/features/pretty-view/use-auto-scroll.ts` (MOD, adapt to virtualizer's scroll container) | hook | event-driven (scroll + resize observers) | own current impl `use-auto-scroll.ts:43-225` | exact (self-analog — the anchor logic MUST be preserved; virtualizer plugs into the same `scrollRef` / `contentRef` seams) |
| `src/ui/features/pretty-view/use-pv-virtualizer.ts` (NEW, extract virtualizer wrapper if planner splits it) | hook | event-driven (ResizeObserver-driven measurement) | `use-auto-scroll.ts:97-159` (ResizeObserver + inline-style-mutation-on-scrollEl pattern); `ComposeBox.tsx:1131-1145` (ResizeObserver + JSDOM guard pattern) | role-match |
| `src/ui/features/pretty-view/use-auto-scroll.test.ts` (MOD, extend for virtualized container) | test | in-process | own current test `use-auto-scroll.test.ts:1-80` (CapturingResizeObserver polyfill) | exact |
| `src/ui/features/pretty-view/PrettyView.test.tsx` / `PrettyView.aside.test.tsx` (MOD, extend for virtualized render) | test | in-process | `PrettyView.aside.test.tsx:122-127` (no-op ResizeObserver stub inside test `beforeEach`); `PrettyView.test.tsx:39-56` (WS stub factory) | exact |

**Notes on classification:**
- `PrettyView.tsx` is the only file where the virtualizer hook actually mounts. If the planner chooses to extract a wrapper hook (Wave 2 hint), that's `use-pv-virtualizer.ts` — same directory as `use-auto-scroll.ts`, same colocation convention. If the planner keeps it inline, the analog is still the current `messages.map` block.
- Bubble components (`ChatMessage.tsx`, `ImageBubble.tsx`, `RelayOutboundBubble.tsx`, `RelayInboundBubble.tsx`) are **NOT modified** — they are opaque children of the virtualizer. Their exports are plain `export function Foo(...)` — no `forwardRef`, no `useImperativeHandle`, no ref plumbing. Safe to wrap in a virtualizer measurement `<div ref={virtualRow.measureElement}>` sibling.

---

## Pattern Assignments

### `src/ui/features/pretty-view/PrettyView.tsx` — replace `messages.map` with virtualizer

**Analog:** self, current implementation at `PrettyView.tsx:1715-1781`.

**Current scroll container + map block (lines 1715-1781):**

```tsx
{(status === "streaming" ||
  ((status === "connecting" || status === "error") && messages.length > 0)) && (
  <div
    ref={scrollRef}
    className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3"
  >
    {/* Inner content wrapper: the ResizeObserver in useAutoScroll
        watches THIS element for content-size changes (new messages,
        markdown re-layout, Inter font swap). The outer scrollRef div
        is watched separately for viewport-size changes. */}
    <div ref={contentRef} className="flex flex-col gap-[18px]">
      {/* Phase-01 scroll contract (patch #185): plain message map — no anchor ref.
          useAutoScroll follows bottom when pinned; holds position when scrolled up. */}
      {messages.map((m) => (
        <div key={m.eventId}>
          {m.type === "image" ? (
            <ImageBubble role={m.role} images={m.images} text={m.text} eventId={m.eventId} ts={m.ts} />
          ) : m.type === "relay_outbound" ? (
            <RelayOutboundBubble room={m.room} rawCommand={m.rawCommand} ts={m.ts} />
          ) : m.type === "relay_inbound" ? (
            <RelayInboundBubble room={m.room} sender={m.sender} body={m.body} ts={m.ts} hostId={hostId} />
          ) : (
            <ChatMessage role={m.role} content={m.content} identityVoice={pvIdentity?.voice ?? null} ts={m.ts} />
          )}
        </div>
      ))}
      {isWorking && <WipBubble />}
      {planPending && (
        <PlanPendingBubble
          planFilePath={planPending.planFilePath}
          planContent={planPending.planContent}
          contentError={planPending.contentError}
          onApprove={handlePlanApprove}
          onFeedback={handlePlanFeedback}
        />
      )}
      {/* Phase 14 Wave 3: aside bubble mounts as the last child of
          the contentRef flex column so useAutoScroll's ResizeObserver
          pins the viewport to it on mount (in-flow, per ASIDE-05 —
          NOT an overlay, popup, or fixed-position element). */}
      {asideText !== null && <AsideBubble text={asideText} />}
    </div>
    {/* Jump-to-bottom pill — sibling of the content wrapper, still
        inside the scroll container so `sticky bottom-2` anchors it
        to the bottom-right of the visible viewport. */}
    {!isPinnedToBottom && messages.length > 0 && (
      <div className="sticky bottom-2 pointer-events-none flex justify-end">
        <Button ... onClick={scrollToBottomAndFollow} .../>
      </div>
    )}
  </div>
)}
```

**Target pattern (virtualized):**

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";

// inside the component body, AFTER useAutoScroll(paneKey):
const scrollElRef = useRef<HTMLDivElement | null>(null);
const rowVirtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => scrollElRef.current,
  estimateSize: () => 80,          // rough default; measureElement corrects
  overscan: 5,                     // matches TanStack Virtual default
  getItemKey: (i) => messages[i].eventId,
});

// Compose the two refs (useAutoScroll's scrollRef + our own scrollElRef)
// onto the SAME div so both readers see the same element.
const composeScrollRefs = useCallback((el: HTMLDivElement | null) => {
  scrollElRef.current = el;
  scrollRef(el);
}, [scrollRef]);

// … JSX …
<div
  ref={composeScrollRefs}
  className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3"
>
  <div
    ref={contentRef}
    style={{
      height: `${rowVirtualizer.getTotalSize()}px`,
      position: "relative",
    }}
  >
    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
      const m = messages[virtualRow.index];
      return (
        <div
          key={virtualRow.key}
          data-index={virtualRow.index}
          ref={rowVirtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${virtualRow.start}px)`,
            paddingBottom: 18, // was flex gap-[18px] — bake into item box now
          }}
        >
          {/* SAME switch as before — bubbles unchanged */}
          {m.type === "image" ? <ImageBubble … /> :
           m.type === "relay_outbound" ? <RelayOutboundBubble … /> :
           m.type === "relay_inbound" ? <RelayInboundBubble … /> :
           <ChatMessage … />}
        </div>
      );
    })}
  </div>
  {/* Accessories that MUST stay unvirtualized — SEE SURPRISE #1 below.
      Move them out of the virtualized parent into a sibling block below
      the scroller, OR keep them as absolute-positioned siblings inside
      the scroll container but OUTSIDE the virtualizer's sized container. */}
  {isWorking && <WipBubble />}
  {planPending && <PlanPendingBubble … />}
  {asideText !== null && <AsideBubble text={asideText} />}
  {/* Jump-to-bottom pill unchanged */}
  {!isPinnedToBottom && messages.length > 0 && <div className="sticky bottom-2 …"> … </div>}
</div>
```

**Initial-slice-from-bottom hydration** — currently handled by `useAutoScroll`'s paneKey-change rAF-chain jump (`use-auto-scroll.ts:108-127`). With virtualization, that same effect will now be jumping to a container whose `scrollHeight` is `rowVirtualizer.getTotalSize()`. The initial jump MUST happen AFTER TanStack Virtual has finished measuring its first frame, OR use `rowVirtualizer.scrollToIndex(messages.length - 1, { align: "end" })` inside a `useLayoutEffect` gated on paneKey change. Planner picks; **prefer keeping useAutoScroll's rAF-chain** and just verifying that `scrollHeight` reads correctly against the virtualizer's total-size container (it should — the container is a real DOM node with an explicit `height: {totalSize}px` inline style).

---

### `src/ui/features/pretty-view/use-auto-scroll.ts` — verify anchor logic still works over virtualized DOM

**Analog:** self.

**No refactor required — but the planner MUST verify the following invariants hold with the virtualized layout:**

1. `scrollEl.scrollHeight` (`use-auto-scroll.ts:68, 141, 151, 196`) now reads `rowVirtualizer.getTotalSize() + accessory-slot heights`. As long as the sized-container-child has `height: {totalSize}px` inline, the browser's `scrollHeight` on the outer scroll container will correctly reflect virtual + accessory total. ✓ Verified in TanStack Virtual's own docs.
2. `scrollEl.scrollTop = scrollEl.scrollHeight` (`use-auto-scroll.ts:68`) — the "jump to bottom" primitive — works uniformly on any tall scrollable container. ✓ No virtualizer-specific path needed.
3. `ResizeObserver` on `contentEl` (`use-auto-scroll.ts:140-159`) — `contentEl` is the sized virtualizer container. When TanStack Virtual re-measures an item (image load, markdown re-layout) and its total-size changes, ResizeObserver fires ✓. The existing "shrunk vs. grew" heuristic still applies unchanged.
4. `overflow-anchor: none` inline mutation (`use-auto-scroll.ts:97-104`) — must stay. Virtualizer moves items via `transform: translateY(...)`, which browsers can misinterpret as scroll-anchor candidates; suppressing anchoring globally on the scroll container is the safe posture.

**Critical: the `LOAD_LOCK_MS` rAF-chain (lines 108-127) fires on `paneKey` change.** Inside this window, the virtualizer is still doing its first measurement pass. The current code writes `scrollTop = scrollHeight` every rAF for 300ms — that will race the virtualizer's initial layout for the first ~2-3 frames. Two safe options:
- **Option A (preferred)**: let the rAF-chain run; the last few ticks (frames 3-15 of the 300ms window) will land after the virtualizer has settled and produce the correct bottom-anchor.
- **Option B (belt+suspenders)**: also call `rowVirtualizer.scrollToIndex(messages.length - 1, { align: "end" })` inside the paneKey-change branch of the WS-setup effect (`PrettyView.tsx:651-684`), right after `setMessages([])`. But mind: at this point `messages.length === 0`; the scrollToIndex has to be deferred until the first WS-frame-driven message batch arrives. Simpler to trust Option A.

Planner picks — Option A is a valid "do nothing" outcome for `use-auto-scroll.ts`.

---

### `src/ui/features/pretty-view/use-pv-virtualizer.ts` — NEW hook (if planner extracts wrapper)

**Analog:** `use-auto-scroll.ts` (colocation, ref-based public API), `ComposeBox.tsx:1131-1145` (ResizeObserver + JSDOM guard).

**JSDOM guard pattern from `ComposeBox.tsx:1131-1145`:**

```tsx
// paddingTop; ResizeObserver will only fire on subsequent size
// changes, so first render needs an explicit read.
// JSDOM does not implement ResizeObserver — guard so tests don't crash.
if (typeof ResizeObserver === "undefined") return;
const observer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const height = entry.contentRect.height;
    // … measurement action …
  }
});
```

TanStack Virtual itself uses ResizeObserver internally via `measureElement`. When the planner writes an extraction hook, apply the same JSDOM-safety posture (`typeof ResizeObserver === "undefined"` early-return) around any auxiliary observers the wrapper adds.

**Ref-forward + effect-scoped-to-element pattern from `use-auto-scroll.ts:60-65, 97-104`:**

```tsx
const scrollRef = useCallback((el: HTMLElement | null) => {
  setScrollEl(el);
}, []);
// …
useEffect(() => {
  if (!scrollEl) return;
  const prev = scrollEl.style.overflowAnchor;
  scrollEl.style.overflowAnchor = "none";
  return () => {
    scrollEl.style.overflowAnchor = prev;
  };
}, [scrollEl]);
```

If the new hook mutates any inline style on the scroll container, use the same **prev-value-capture-in-effect / restore-on-cleanup** pattern.

---

### Tests: `use-auto-scroll.test.ts` and `PrettyView*.test.tsx`

**Analog for ResizeObserver polyfill:** `use-auto-scroll.test.ts:1-16` (capturing polyfill — lets tests fire the RO callback manually).

**Analog for inline no-op stub inside a `beforeEach`:** `PrettyView.aside.test.tsx:122-127`:

```tsx
// jsdom lacks ResizeObserver; useAutoScroll's effect calls
// `new ResizeObserver(...)` at mount, so provide a no-op stub.
resizeObserverStub = vi.fn(function () {
  return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
});
vi.stubGlobal("ResizeObserver", resizeObserverStub);
```

**TanStack Virtual JSDOM caveat:** the virtualizer reads `scrollElement.clientHeight` / `scrollElement.scrollTop` / `scrollElement.getBoundingClientRect()` to compute its virtual window. JSDOM returns zeros for these unless mocked. `use-auto-scroll.test.ts:23-60` already defines a `makeScrollEl(...)` helper that mocks exactly these three properties via `Object.defineProperty` — the planner should reuse this helper (or copy it into `PrettyView.test.tsx`) for any test that asserts virtualizer output.

**Analog for WS stub factory:** `PrettyView.test.tsx:12-56` (the `wsStubs[]` array + `getCurrentWs()` helper + the `vi.mock("@/api/claude-session-api", () => ...)` factory that pushes a fresh stub on each call). Reuse verbatim — no virtualizer-specific WS changes needed.

**New test angles to add:**
- Long-conversation render: mount PrettyView, fire 200 message frames, assert `container.querySelectorAll('[data-index]').length` is ≤ 30 (the visible-slice-plus-overscan bound). This is the empirical `must_have #2/#3` from CONTEXT.md.
- Auto-scroll-to-bottom-when-pinned: fire 20 messages, assert `scrollTop === scrollHeight - clientHeight`. Reuses the mutable-scroll-el helper at `use-auto-scroll.test.ts:64-...`.
- Don't-yank-when-scrolled-up: fire messages, set `scrollTop` to a value well above bottom (simulate user scroll-up), fire the CapturingResizeObserver callback, assert `scrollTop` did NOT change.

---

### `package.json` — add `@tanstack/react-virtual` to `dependencies`

**No in-repo analog for "add a new runtime frontend dep."** Prior phases have consistently declined new deps (e.g. `22-01/-02/-03/-04/-05/-06-PLAN.md` all state "Zero new dependencies"; `26-CONTEXT.md` explicitly avoided adding a new popover dep in favor of the already-vendored shadcn Popover).

**Guidance for the planner:** `@tanstack/react-virtual` is a runtime dep (imported and executed in the browser bundle), not a devDep. It goes under `"dependencies"` in `package.json`, NOT under `"devDependencies"`. Explicit check from CONTEXT.md § Success criteria: *"`@tanstack/react-virtual` present in `package.json` dependencies (not devDependencies)."*

Insert alphabetically among existing runtime deps (after `@fontsource-variable/inter`, before `@tailwindcss/typography`). Verify with `npm ls @tanstack/react-virtual` after install.

**Confirmed:** no `@tanstack/*` package is currently installed. `node_modules/@tanstack/` does not exist. `grep "@tanstack" package.json` returns zero. So the dep addition is genuinely net-new for this repo. Do NOT assume `@tanstack/react-query` is present — it is NOT.

---

## Shared Patterns

### Colocation convention

**Source:** all pretty-view hooks live directly under `src/ui/features/pretty-view/` alongside components — see `use-auto-scroll.ts` (line 43 export), `use-pretty-view-uploads.ts`, `use-pretty-view-uploads.test.ts`.

**Apply to:** any new virtualizer wrapper hook. Do NOT lift it to `src/ui/hooks/` or `src/ui/lib/` — those directories hold cross-feature utilities; feature-scoped hooks stay under their feature dir.

### JSDOM ResizeObserver stub

**Source:** `PrettyView.aside.test.tsx:122-127` (no-op stub) and `use-auto-scroll.test.ts:1-16` (capturing polyfill).

**Apply to:** every new/modified test file that renders PrettyView or the virtualizer hook. Choose the no-op form for integration tests that only need "don't crash," and the capturing form for unit tests that need to drive resize callbacks.

### Ref composition for two-hook-shared-element

**Source:** `PrettyView.tsx:500-518` (`forceStickAndJumpRef` pattern — a ref that gets assigned mid-render body to bridge two hook call-sites).

**Apply to:** the virtualizer needs its own ref on the scroll element, and `useAutoScroll` already returns a `scrollRef` callback. Compose them with a `useCallback` that assigns both:

```tsx
const composeScrollRefs = useCallback((el: HTMLDivElement | null) => {
  scrollElRef.current = el;
  scrollRef(el);
}, [scrollRef]);
```

### `paneKey` fresh-mount reset

**Source:** `PrettyView.tsx:644-684` — the pattern of `if (paneKey !== paneKeyRef.current) { setMessages([]); …; paneKeyRef.current = paneKey; }`.

**Apply to:** if the virtualizer needs an imperative "jump-to-bottom-on-fresh-pane," add the call inside this same branch (right after `setMessages([])`). `useAutoScroll`'s own paneKey-tracked effect (`use-auto-scroll.ts:108-127`) already handles the same signal on the scroll-container side; the two branches will fire in the same render tick.

### Diag registry snapshot (for post-ship verification)

**Source:** `PrettyView.tsx:1290-1317` — `registerPane` + `snapshotFn` returning `{ …, messageCount, wsFramesSinceLast, domNodeCount }`.

**Apply to:** NO code change needed. The `domNodeCount` field (line 1311-1313: `pvRootRef.current.querySelectorAll("*").length`) IS the post-ship measurement dimension. The pre-iter-3 baseline JSONL captured this. After the virtualization ships, the same snapshot will emit a much smaller `domNodeCount` on the same conversation → that's the empirical proof for `must_have #10`. Planner should note this in the acceptance instructions but changes zero code.

---

## Surprises (things that will trip up the executor)

### SURPRISE #1 — The "below-list accessories" are NOT actually below the list today

**CONTEXT.md § Below-list accessories stay unvirtualized** describes WipBubble / PlanPendingBubble / AsideBubble as living "in a slot BELOW the message list." **This is wrong at the code level.** Read `PrettyView.tsx:1725-1781`:

```tsx
<div ref={contentRef} className="flex flex-col gap-[18px]">
  {messages.map((m) => ( … bubble … ))}
  {isWorking && <WipBubble />}
  {planPending && <PlanPendingBubble … />}
  {asideText !== null && <AsideBubble text={asideText} />}
</div>
```

They are siblings of the mapped messages INSIDE the same `contentRef` flex column. The AsideBubble comment (line 1776-1779) is even explicit: *"the aside bubble mounts as the last child of the contentRef flex column so useAutoScroll's ResizeObserver pins the viewport to it on mount (in-flow, per ASIDE-05 — NOT an overlay, popup, or fixed-position element)."*

**Implication for the executor:** the "unvirtualized accessories" scope guard from CONTEXT.md still applies — the three accessory bubbles must NOT be pushed into the virtualized `getVirtualItems()` set. But when the message-map block is replaced with the virtualizer's absolute-positioned children, the three accessories need to move OUT of the sized-height virtualizer container. Two options:

- **Option A** — render them as siblings of the virtualizer container, immediately below it, both inside the scroll container. The scroll container's `scrollHeight` then includes both the virtualizer's `totalSize` AND the accessory heights. This preserves the "pin to bottom" ResizeObserver behavior for the aside (it's still in-flow at the visual bottom).
- **Option B** — render them as siblings but sticky-positioned (`position: sticky; bottom: 0`). Adds visual complexity, changes the ASIDE-05 in-flow-not-overlay contract, likely NOT what Ashley wants.

**Prefer Option A.** Update the AsideBubble comment to reflect the new structure (still in-flow, still last child of the scroll container, just no longer inside the flex column).

### SURPRISE #2 — Message key is `eventId`, not index

`PrettyView.tsx:1729` uses `key={m.eventId}` and the dedup fn at line 158-164 dedupes on `eventId`. Good news — that's a perfect virtualizer key.

`useVirtualizer` accepts `getItemKey: (index) => messages[index].eventId`. This gives TanStack Virtual stable identity across reorders / dedups. Without it, the virtualizer defaults to indices and loses measurement cache when items shift — leading to jitter on the exact image-load re-measure path we're trying to protect.

**Executor MUST set `getItemKey`.** Not optional.

### SURPRISE #3 — Existing `contentRef` ResizeObserver in `useAutoScroll` will double up with virtualizer's own RO

`use-auto-scroll.ts:140-159` sets up a ResizeObserver on `contentEl` (the flex column). After refactor, `contentEl` becomes the virtualizer's sized container. TanStack Virtual's `measureElement` also installs a ResizeObserver on each item element (not on the container). No conflict — the two ROs observe different DOM levels. But the executor should verify by running `use-auto-scroll.test.ts` after refactor that the CapturingResizeObserver callback is still captured correctly (the polyfill captures only the MOST RECENT constructor call — if TanStack Virtual constructs its own RO first and useAutoScroll second, the polyfill captures the useAutoScroll one, tests pass; if the order flips, the polyfill starts capturing TanStack Virtual's per-item RO and the useAutoScroll tests break in a very confusing way).

**Mitigation:** the capturing polyfill can be widened to store an array of callbacks and expose "fire the useAutoScroll one specifically" — see `use-auto-scroll.test.ts:6-16` for the current single-slot form. Or simply construct the virtualizer AFTER `useAutoScroll` in the render body (which is already the natural order per current `PrettyView.tsx:608-609`).

### SURPRISE #4 — `messages` prop-drilling is trivial; state IS local

Messages live in `useState<StreamEvent[]>` inside `PrettyView.tsx:192`. No store selector, no context, no query hook — it's a plain `useState` fed by the WS onmessage handler (`PrettyView.tsx:771, 778, 783, 788`). This is good for virtualization: the virtualizer can consume `messages` directly with no selector overhead / no reconciliation between store and virtualizer.

But it also means: **there is no message-store selectors file for the planner to reference.** CONTEXT.md § Canonical References line 95 says *"Message-store selectors that feed the list — planner identifies exact paths via pattern-mapper."* → **there are none.** `messages` is component-local `useState`. Update the plan / summary accordingly.

### SURPRISE #5 — `PrettyView.tsx` is 1,983 lines long; the affected block is small (~60 lines)

Total file: 1,983 lines. The message-map block being refactored: **lines 1715-1817 (~103 lines)**. The paneKey-change reset block: **lines 644-684 (~40 lines)**. `useAutoScroll` call site: **lines 604-614 (~11 lines)**. The rest of the file is WS setup, plan-pending handling, aside handling, dormancy, holding overlay — all untouched.

**Executor should keep the diff surgical** — no drive-by refactoring of the surrounding 1,900 lines. The virtualization change fits in ~150 lines of net churn.

### SURPRISE #6 — iOS PWA visualViewport concerns are already handled OUT of the scroll container

`PrettyView.tsx:1113-1141` — the iOS PWA visibilitychange handler — is about WS reconnect on foreground, NOT about scroll-container geometry. `isIosPwa()` is only used there. No `visualViewport` API usage in PrettyView. No safe-area-inset consumers in the message-list slot. The virtualization refactor does NOT need to add any iOS-specific scroll handling.

`use-auto-scroll.ts:180-190` DOES handle iOS's `touchmove`-driven scroll-up detection specifically to avoid a mobile-tap misfire. That code path is preserved as-is — the virtualizer doesn't touch touchmove handling.

### SURPRISE #7 — Bubble `key` uniqueness across `type`s

The current map uses `key={m.eventId}` at the wrapper `<div>` level (line 1729), and dedupe (line 162) is by `eventId` regardless of type. `eventId` is generated per-frame server-side and is unique across message / image / relay_outbound / relay_inbound. Safe as a virtualizer key.

### SURPRISE #8 — `flex flex-col gap-[18px]` becomes irrelevant post-refactor

TanStack Virtual absolute-positions each item via `transform: translateY(...)`. Flexbox gap does nothing on absolutely-positioned children. The 18px vertical rhythm must be re-implemented as `paddingBottom: 18` or `marginBottom: 18` on each virtualized item wrapper, OR baked into the `estimateSize` return value (but that would still not create real visible gap — must be baked into padding).

Recommended: `paddingBottom: 18` on each `<div ref={virtualRow.measureElement}>`. `measureElement` will measure the full item box including padding, so total-size math stays correct.

---

## Metadata

**Analog search scope:**
- `src/ui/features/pretty-view/**/*.{ts,tsx}` (feature dir, all files)
- `src/ui/hooks/**` (shared hooks — no virtualization hooks present)
- `src/ui/lib/**` (shared utilities — `diag-registry.ts`, `is-ios-pwa.ts`, etc.; no virtualization prior art)
- `.planning/phases/**/*-PLAN.md` (prior-phase dep-add patterns — all previous phases were "no new dep")
- `node_modules/@tanstack/` (confirming zero @tanstack packages installed)
- `package.json` (confirming zero @tanstack lines)

**Files scanned:** ~30 source files + ~50 planning files + 1 package.json + 1 node_modules dir.

**No-analog files (planner should use RESEARCH.md + TanStack Virtual docs directly):**

| File | Role | Reason |
|---|---|---|
| `package.json` (new-dep addition) | config | Every prior phase declined new deps; no repo pattern for adding a runtime frontend package. Planner falls back to standard `npm install @tanstack/react-virtual` + verify + commit. |
| `use-pv-virtualizer.ts` (if extracted) | hook | No prior virtualization hook exists in this repo — TanStack Virtual is net-new. Planner uses TanStack Virtual's own docs + the ResizeObserver-effect-scoping pattern from `use-auto-scroll.ts` as a shape reference. |

**Pattern extraction date:** 2026-08-09.
