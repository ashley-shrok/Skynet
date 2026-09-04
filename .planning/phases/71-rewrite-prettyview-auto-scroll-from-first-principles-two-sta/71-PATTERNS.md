# Phase 71: Rewrite PrettyView auto-scroll from first principles — Pattern Map

**Mapped:** 2026-09-04
**Files analyzed:** 3 to modify (2 rewritten, 1 edited)
**Analogs found:** 3 / 3 (all in-tree, all recent)

## Guiding philosophy (from shape file + CONTEXT.md, LOCKED)

The rewrite deliberately picks a **single-invariant deterministic state machine** and rejects the reactive-observer-stack shape of the file it replaces. Therefore the analogs chosen below are **NOT other observer-heavy hooks in this codebase** — the observer-stack shape is what phase-71 is repudiating. The analogs picked are:

1. A **pure reducer + trivial React wrapper** pair already living beside `use-auto-scroll.ts` — `resolve-phase.ts` + `usePaneResolvingMachine.ts`. This is Phase 30's rewrite of a comparable "stack of racing gates" hook (Phase 29 `usePaneResolvingMachine` was ~380 LOC of `useEffect` triggers + rearm-snapshot refs + delay-arm timers; Phase 30 collapsed to a ~30-LOC hook + ~200-LOC pure reducer with a locked truth table).
2. A **gesture / event-driven hook with refs-vs-state discipline** and explicit event handlers (`onPointerDown` / `onPointerUp` / `onPointerCancel` / `onPointerLeave`) — `useHoldToRecord.ts`. This is the analog for how the new state machine consumes DOM/user events (a small set of named event handlers, each with a documented branch, no observer stacks).
3. A **queue-and-replay hook with reducer-shaped internals** — `useInjectedTurnRelay.ts`. Analog for how a hook can hold a small ref-based state slot without turning into observer soup.

The rewritten `use-auto-scroll.ts` should read like `usePaneResolvingMachine.ts` — a thin hook wrapping a pure reducer — with event handlers modeled after `useHoldToRecord.ts`'s pointer callbacks.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ui/features/pretty-view/use-auto-scroll.ts` (rewrite, 367→~200 LOC) | React hook (state-machine wrapper) | event-driven, request-response | `src/ui/features/pretty-view/usePaneResolvingMachine.ts` + `src/ui/features/pretty-view/useHoldToRecord.ts` | exact (structural) |
| `src/ui/features/pretty-view/auto-scroll-machine.ts` (NEW — pure reducer, extracted per Phase-30 pattern) | Pure reducer module | pure function | `src/ui/features/pretty-view/resolve-phase.ts` | exact (structural) |
| `src/ui/features/pretty-view/use-auto-scroll.test.ts` (rewrite, 587→locks new SM semantics) | Vitest test (renderHook + mock DOM) | request-response | `src/ui/features/pretty-view/useHoldToRecord.test.tsx` + `src/ui/features/pretty-view/usePaneResolvingMachine.test.tsx` | exact |
| `src/ui/features/pretty-view/auto-scroll-machine.test.ts` (NEW — pure-reducer truth-table tests) | Vitest test (import + call, no renderHook) | pure function | `src/ui/features/pretty-view/resolve-phase.test.ts` + `src/backend/claude-session/layer1-detect.test.ts` | exact |
| `src/ui/features/pretty-view/PrettyView.tsx` (edits — accessory-mount stays as siblings, sentinel div may go away, jump-to-bottom pill wiring stays, hide-pin-reveal wrapper added, `overflow-anchor:none` added to scroll container) | Component (consumer) | request-response | *(consumer edit — no structural analog needed; edit the existing site)* | in-place edit |

## Pattern Assignments

### `src/ui/features/pretty-view/auto-scroll-machine.ts` (NEW — pure reducer, no I/O imports)

**Analog:** `src/ui/features/pretty-view/resolve-phase.ts` (verbatim structural pattern — this exact "pure reducer + zero imports" shape is already established one directory over).

**Header comment / rationale pattern** (from resolve-phase.ts lines 41-48 — copy the "no I/O imports" invariant declaration verbatim, adapted to auto-scroll):

```typescript
// (paraphrased target for auto-scroll-machine.ts header):
//
// NO I/O IMPORTS — pure function only. No React imports, no DOM imports,
// no logger imports, no timer scheduling, no wall-clock reads.
// Enforced by the acceptance structural-grep gate:
//   grep -c "^import " src/ui/features/pretty-view/auto-scroll-machine.ts → 0
// This is what makes the state-transition unit tests in
// auto-scroll-machine.test.ts cheap to set up (import + call — no mocks,
// no timers, no DOM harness, no renderHook). Pattern copied verbatim from
// src/ui/features/pretty-view/resolve-phase.ts and (upstream)
// src/backend/claude-session/layer1-detect.ts.
```

**String-literal union pattern for state + event types** (resolve-phase.ts lines 80-122):

```typescript
export type WsTransportState =
  | "not-connected"
  | "opening"
  | "open"
  | "failed-permanently";

export type PaneState =
  | "active"
  | "holding"
  | "dormant"
  | "inactive"
  | "error";

export type RenderedState =
  | "resolving"
  | "active"
  | "holding"
  // ...
```

For auto-scroll, apply the same pattern: `type Mode = "at-bottom" | "not-at-bottom"`, plus a discriminated-union `AutoScrollEvent` (or `SmEvent`) with variants like `{ kind: "content-changed" }`, `{ kind: "container-resized" }`, `{ kind: "user-input"; delta: number }`, `{ kind: "jump-clicked" }`, `{ kind: "send-fired" }`, `{ kind: "measured"; distanceFromBottom: number }`.

**Pure reducer with locked truth table + branch-order comment** (resolve-phase.ts lines 124-200):

```typescript
export function resolveRenderedState(
  wsTransportState: WsTransportState,
  paneState: PaneState | null,
): RenderedState {
  // (a) failed-permanently short-circuit.
  if (wsTransportState === "failed-permanently") return "error";

  // (b) Happy path: transport open + backend verdict received. Compile-time
  // exhaustiveness sentinel narrows the PaneState union — if a new PaneState
  // value is added upstream without a matching switch branch here,
  // `_exhaust: never` fails `npx tsc --noEmit` at build time.
  if (wsTransportState === "open" && paneState !== null) {
    switch (paneState) {
      case "active":
      case "holding":
      case "dormant":
      case "inactive":
      case "error":
        return paneState;
      default: {
        const _exhaust: never = paneState;
        return _exhaust;
      }
    }
  }
  // ...
}
```

For auto-scroll, the reducer signature target is roughly:

```typescript
export function reduce(
  state: AutoScrollState,   // { mode: Mode, lastMeasuredDistance: number, hasLandedOnce: boolean, ... }
  event: AutoScrollEvent,
): { next: AutoScrollState; effect: AutoScrollEffect };  // effect = "chase" | "reveal" | "none"
```

The reducer decides mode transitions per the LOCKED shape rules:
- OUT-of-at-bottom happens ONLY on `{kind:"user-input"}` events landing outside tolerance.
- INTO-at-bottom happens on `{kind:"jump-clicked"}`, `{kind:"send-fired"}`, or `{kind:"user-input"}` landing inside tolerance.
- All other events (`content-changed`, `container-resized`, `accessory-mount`, `accessory-unmount`, `measured`) are conceptually a single "something may have moved the bottom" event class — treated symmetrically.
- Programmatic writes (`chase` effect) NEVER trigger a mode transition. This is the invariant the shape file names in `## What would make it wrong` bullet 2.

**Exhaustiveness sentinel pattern for `AutoScrollEvent.kind` switch** (verbatim from resolve-phase.ts lines 163-186) — MUST be included so future event additions fail `tsc --noEmit` if not handled.

---

### `src/ui/features/pretty-view/use-auto-scroll.ts` (REWRITE — thin React wrapper around the pure reducer)

**Analog:** `src/ui/features/pretty-view/usePaneResolvingMachine.ts` (thin wrapper pattern) + `src/ui/features/pretty-view/useHoldToRecord.ts` (event-handler shape + refs-vs-state discipline).

**Thin-wrapper hook shape** (from usePaneResolvingMachine.ts lines 44-51 — verbatim structural pattern):

```typescript
export function usePaneResolvingMachine(
  deps: UsePaneResolvingMachineDeps,
): UsePaneResolvingMachineResult {
  const renderedState = resolveRenderedState(deps.wsTransportState, deps.paneState);
  return { renderedState, paneState: deps.paneState };
}
```

For auto-scroll, apply the same "thin wrapper" mindset. The hook holds the DOM refs, the tolerance constant, and the RAF-coalesce queue, but the mode-transition logic is delegated to `reduce()` from `auto-scroll-machine.ts`. Every event the hook observes (scroll listener → user-input, ResizeObserver → container-resized, MutationObserver-on-messages-container → content-changed OR accessory-mount/unmount, jump-pill onClick → jump-clicked, send handler prop → send-fired) is converted to a discriminated-union `AutoScrollEvent` and passed through `reduce()`. The hook applies the returned `effect` (`chase` → single-write-per-rAF; `reveal` → flip visibility; `none` → no-op).

**Header-comment pattern** (from usePaneResolvingMachine.ts lines 1-14 — adopt the "wrapper is a stable named seam; testability contract lives in the reducer" framing):

```typescript
/**
 * Trivial derivation hook wrapping the pure `resolveRenderedState` reducer.
 *
 * Phase 30's rewrite reduces this file to a thin wrapper around the pure
 * reducer in ./resolve-phase.ts. The hook exists as a named seam so callers
 * have a stable named point for the derivation and the contract stays
 * testable in isolation with renderHook.
 *
 * ZERO INTERNAL STATE. Every call reduces to a single pure function
 * evaluation. [...]
 */
```

For auto-scroll the target is: hook wraps `auto-scroll-machine.ts`'s `reduce()`; hook owns the DOM refs + RAF coalescer + tolerance constant; contract lives in the reducer + its test file.

**Ref-vs-state discipline pattern** (from useHoldToRecord.ts lines 201-232):

```typescript
// ---- Refs -------------------------------------------------------------

/** e.timeStamp of the pointerdown that started the current gesture. */
const pointerDownAtRef = useRef<number>(0);
/**
 * True only if voice.start was actually called in this gesture (i.e., the
 * guard chain passed). pointerup consults this to decide whether to run its
 * branch or no-op.
 */
const startedRecordingRef = useRef<boolean>(false);
/** Handle for the 250ms setTimeout that flips holdCommitted → true. */
const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
// ...

// ---- State ------------------------------------------------------------

const [holdActive, setHoldActive] = useState<boolean>(false);
const [holdCommitted, setHoldCommitted] = useState<boolean>(false);
```

The convention documented in the ref-block comments — "This is a ref (not state) because reads happen during render and setting it must not trigger a re-render" — applies verbatim to the auto-scroll rewrite. The `mode` value MUST be state (drives the jump-pill visibility). The RAF-handle, the coalesced-event queue, the DOM element pointers, and the `hasLandedOnce` mount-landing flag MUST be refs (they must not cause re-renders when they change).

**Event-handler surface pattern** (from useHoldToRecord.ts lines 515-524 — the return-object style with named handlers callers wire up):

```typescript
return {
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  holdActive,
  holdCommitted,
  holdInitiatedRef,
};
```

The new `useAutoScroll` return surface should be similarly explicit. Target shape (planner's discretion on final naming):

```typescript
return {
  scrollRef,          // callback ref for the scroll container
  jumpToBottom,       // action for the jump-to-bottom pill click + send-fired callers
  onSendFired,        // called by handleComposeSend — flips to at-bottom regardless
  mode,               // "at-bottom" | "not-at-bottom" — drives jump-pill visibility
  revealed,           // false during hide-pin-reveal window, true after mount landing
};
```

Note: the CURRENT frozen surface is `{ scrollRef, sentinelRef, scrollToBottomAndFollow, isPinnedToBottom }` (PrettyView.tsx:1059). The rewrite MAY change this surface — planner should either preserve backwards compatibility or edit PrettyView.tsx in the same plan (the rewrite is scope-in per the shape file). Sentinel and IntersectionObserver go away (new machine measures `scrollTop`/`scrollHeight`/`clientHeight` on demand, not via IO).

**Constants block pattern** (from useHoldToRecord.ts lines 82-104):

```typescript
/**
 * Hold threshold — pointer must remain down for at least this many milliseconds
 * for the release to be treated as a long-press-send. Below this: short tap.
 * LOCKED at 250ms per Phase 32 CONTEXT.md § "Threshold — LOCKED" (L44-45).
 */
export const HOLD_THRESHOLD_MS = 250;

/**
 * Bounds tolerance for the release-inside check [...] 40px is wide enough
 * to swallow finger wobble but narrow enough that an intentional slide-off
 * (30-50px+ of motion) still reads as cancel.
 */
export const BOUNDS_TOLERANCE_PX = 40;
```

For auto-scroll, the equivalent constants (from shape file § Shape para 1):
- `BOTTOM_TOLERANCE_PX = 28` (roughly one line of body text — shape says "~24-32px", pick center)
- `BOTTOM_TOLERANCE_TOUCH_EXTRA_PX = 32` (or similar — extra slack on touch devices for iOS momentum overshoot; shape file explicitly names iOS rubber-band as a hazard)

Each constant MUST carry a comment naming the shape-file line that locks it, per the useHoldToRecord.ts convention. Touch detection reuses `useIsTouchDevice()` from `src/ui/hooks/use-is-touch-device.ts`.

**Diagnostic-logging reshape** (per CONTEXT.md § Code context "instrumentation strategy will need to be reshaped for the new state machine"):

Current `[pv-scroll-diag]` log convention exists throughout use-auto-scroll.ts (10 sites). The rewrite should reshape these to per-transition/per-effect log lines, one per reducer decision — e.g. `[pv-scroll-diag] mode-in reason=jump-click`, `[pv-scroll-diag] mode-out reason=user-wheel dist=142`, `[pv-scroll-diag] chase-write raf-batch=3 dist-before=48`, `[pv-scroll-diag] chase-skip reason=not-at-bottom`, `[pv-scroll-diag] mount-land waited-ms=32`. Log EACH reducer output; do NOT log inside the reducer itself (keep reducer pure).

---

### `src/ui/features/pretty-view/auto-scroll-machine.test.ts` (NEW — pure-reducer truth-table tests)

**Analog:** `src/ui/features/pretty-view/resolve-phase.test.ts` + `src/backend/claude-session/layer1-detect.test.ts` (both are pure-function truth-table tests with zero mocks / zero DOM / zero timers).

**Import block pattern** (from resolve-phase.test.ts lines 30-36):

```typescript
import { describe, it, expect } from "vitest";
import {
  resolveRenderedState,
  type WsTransportState,
  type PaneState,
  type RenderedState,
} from "./resolve-phase";
```

Match verbatim shape for auto-scroll-machine: `import { reduce, type AutoScrollState, type AutoScrollEvent, type Mode } from "./auto-scroll-machine";`. **No mocks. No `renderHook`. No timers. No `document.createElement`.**

**Type-membership self-check pattern** (from resolve-phase.test.ts lines 47-69):

```typescript
const ALL_WS_TRANSPORT_STATES: readonly WsTransportState[] = [
  "not-connected",
  "opening",
  "open",
  "failed-permanently",
] as const satisfies readonly WsTransportState[];

const ALL_PANE_STATES: readonly PaneState[] = [
  "active",
  "holding",
  "dormant",
  "inactive",
  "error",
] as const satisfies readonly PaneState[];

if (ALL_WS_TRANSPORT_STATES.length !== 4 || ALL_PANE_STATES.length !== 5) {
  throw new Error(
    "resolve-phase.test.ts: union self-check arrays out of sync with resolve-phase.ts",
  );
}
```

Adopt verbatim for auto-scroll: pin the `Mode` and `AutoScrollEvent.kind` unions with a `satisfies` self-check so the acceptance grep for exact union shape is doubly enforced (grep + tsc).

**Per-transition test structure** (from resolve-phase.test.ts lines 71-100):

```typescript
describe("resolveRenderedState — failed-permanently short-circuit → always error", () => {
  it("Test 1: failed-permanently + null paneState → error", () => {
    expect(resolveRenderedState("failed-permanently", null)).toBe("error");
  });
  // ...
});
```

For auto-scroll, group tests by transition class:
- "at-bottom → at-bottom" (all symmetric events: content-changed, container-resized, accessory-mount, accessory-unmount, measured-inside-tolerance) — each event class one `it`, all return `{ next.mode: "at-bottom", effect: "chase" }`.
- "at-bottom → not-at-bottom" (ONLY `user-input` landing outside tolerance — every other event MUST NOT transition).
- "not-at-bottom → not-at-bottom" (all symmetric events, `effect: "none"` — the load-bearing "no yank when scrolled up" property).
- "not-at-bottom → at-bottom" (three specific triggers: `jump-clicked`, `send-fired`, `user-input` landing inside tolerance).
- "programmatic-write never transitions" (this is what `chase` effect returning without a mode change enforces — the "if any programmatic scroll write can transition mode" failure mode from `## What would make it wrong` bullet 2).
- "mount-landing" (initial state `hasLandedOnce: false` → first `measured` with non-zero content height → `effect: "reveal"` after `chase`).

**Optional table-driven full-matrix test** (from resolve-phase.test.ts line-count ~15 tests, ending in a `describe.each` full 4×6 matrix — analog for auto-scroll: `describe.each` full `Mode × EventKind` matrix asserting every cell's `next.mode` + `effect`).

---

### `src/ui/features/pretty-view/use-auto-scroll.test.ts` (REWRITE — locks new hook-level SM semantics)

**Analog:** `src/ui/features/pretty-view/useHoldToRecord.test.tsx` (test-consumer-component pattern for a hook with event handlers + real DOM) + `src/ui/features/pretty-view/usePaneResolvingMachine.test.tsx` (renderHook + rerender for a thin-wrapper hook + API-surface Test 8-style).

**Existing test-file preamble to REPLACE** (use-auto-scroll.test.ts lines 1-33 describe the old three-observer model; wholesale rewrite per CONTEXT.md § Code context "will need to be rewritten alongside the module to lock the new state-machine semantics").

**Preserve two load-bearing patterns from the CURRENT test file:**

1. **`makeScrollEl` mock scroll container** (use-auto-scroll.test.ts lines 53-118) — this JSDOM harness for overriding `scrollHeight` / `clientHeight` / `scrollTop` via `Object.defineProperty` is the standard scroll-harness in this codebase (the current file references `PrettyView.virtualization.test.tsx` L187-216 as the canonical source). Keep it verbatim. The rewrite still needs this harness — the DOM math (`scrollTop`, `scrollHeight`, `clientHeight`) is unchanged.

2. **`fireScroll(el)` synthetic-event helper** (use-auto-scroll.test.ts lines 120-128) — wraps `el.dispatchEvent(new Event("scroll"))` in `act()` so React state updates flush. Keep verbatim.

**API-surface-lock test pattern** (from usePaneResolvingMachine.test.tsx lines 188-206):

```typescript
it("Test 8: hook result has exactly {renderedState, paneState} — no legacy props", () => {
  const { result } = renderHook(() =>
    usePaneResolvingMachine({ wsTransportState: "open", paneState: "active" }),
  );
  const keys = Object.keys(result.current).sort();
  expect(keys).toEqual(["paneState", "renderedState"]);
  // Explicit no-legacy assertions. Cast via `unknown` first because the
  // static type of result.current does not sufficiently overlap with
  // Record<string, unknown> for a direct cast (TS2352).
  const asRecord = result.current as unknown as Record<string, unknown>;
  expect(asRecord.requestRetry).toBeUndefined();
  expect(asRecord.showSpinner).toBeUndefined();
  // ...
});
```

For the auto-scroll rewrite, adopt the same explicit no-legacy-props assertion — assert the new hook's return keys are exactly the new shape AND `sentinelRef` is undefined (the old surface's sentinel is deleted by the rewrite because the new machine no longer uses IntersectionObserver).

**Test-consumer-component pattern for event-driven hooks** (from useHoldToRecord.test.tsx lines 100-116):

```typescript
function TestConsumer({ args }: { args: UseHoldToRecordArgs }): JSX.Element {
  const handlers = useHoldToRecord(args);
  return (
    <button
      data-testid="hold-btn"
      onPointerDown={handlers.onPointerDown}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
      onPointerLeave={handlers.onPointerLeave}
      data-hold-active={handlers.holdActive ? "true" : "false"}
      data-hold-committed={handlers.holdCommitted ? "true" : "false"}
      data-hold-initiated={handlers.holdInitiatedRef.current ? "true" : "false"}
    >
      Send
    </button>
  );
}
```

If the new hook exposes callbacks the compose box or jump pill wire to (e.g. `onSendFired`, `jumpToBottom`), model those tests around a similar `TestConsumer` that binds the hook to a container div + a pill button and reads `mode` into a `data-mode` attribute — then drive events through `fireEvent` on the DOM.

**Fake-timers pattern for hide-pin-reveal / mount-landing tests** (from useHoldToRecord.test.tsx lines 122-132):

```typescript
beforeEach(() => {
  // Fake timers so the 250ms threshold can be walked deterministically. Use
  // { shouldAdvanceTime: false } so timers do not silently tick during
  // synchronous test setup — every advance is explicit via advanceTimersByTime.
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
```

Mount-landing (hide-pin-reveal) requires waiting for content-size measurement to report non-zero height before jumping. If the hook uses `requestAnimationFrame` for the coalescer, use `vi.advanceTimersByTime` + `act(() => { rerender(...) })` to walk the RAF deterministically. Model on this pattern.

**Test coverage list (per shape file "Full test coverage for the state machine and its transitions"):**

Suggested hook-level tests (planner to finalize; reducer-level tests in the pure-reducer test file cover the transition matrix exhaustively — hook tests focus on the DOM/React glue):

- T1: Cold mount → hide-pin-reveal → visible + at-bottom (`data-mode="at-bottom"`, `data-revealed="true"`).
- T2: User scrolls up via wheel → `mode` flips to `not-at-bottom` (uses `fireScroll` + geometry mutation).
- T3: User scrolls back near bottom → `mode` flips to `at-bottom`.
- T4: New message arrives while at-bottom → single scroll-write per RAF (assert scrollTop = scrollHeight after RAF flush).
- T5: **LOAD-BEARING** — user scrolled-up + new message arrives → NO scroll-write, NO mode change (the "no yank" invariant — Test 5 lives on structurally verbatim from the current file).
- T6: Accessory mount while at-bottom → chase (WipBubble equivalent — content-changed event → `effect: "chase"`).
- T7: Accessory unmount while at-bottom → chase.
- T8: Container resize while at-bottom → chase (uses ResizeObserver stub or `window.dispatchEvent(new Event("resize"))`).
- T9: Container resize while not-at-bottom → NO write, NO mode change.
- T10: `jumpToBottom()` action → flips to at-bottom, writes scrollTop = scrollHeight.
- T11: `onSendFired()` → flips to at-bottom regardless of prior mode.
- T12: Programmatic write never triggers mode transition (drive a chase, then measure `mode` did not oscillate).
- T13: Cleanup — unmount removes scroll/resize/mutation observer listeners.
- T14: API-surface lock (Object.keys) — no `sentinelRef`, no legacy props.
- T15: `paneKey` change (identity swap on live PrettyView) — session re-entry per shape file "Session re-entry preserves scroll position" MUST NOT touch scroll position. (Note: this is a subtle test — the shape file distinguishes "cold mount → land at bottom" from "session re-entry → don't touch scroll position", and the machine must resolve which is which. Planner: think through the state carrier — session-scope state per shape file para "Session-scope state" — this may be the piece that most differs from Phase 32's Test 9.)

---

### `src/ui/features/pretty-view/PrettyView.tsx` (EDITS — consumer)

**Edit sites (already located):**

1. **L155-167 comment block** — the "three engines" description is stale for the new SM model. Rewrite to describe the new state machine model (single reducer, event classes, mode-derived-from-position invariant). Follow the same numbered-invariant style already used in the surrounding RENDER-01 / RENDER-03 / FALLBACK-01 comment block.

2. **L1056-1059 hook call site** — the hook signature likely changes (new return surface). Update the destructure to match the new hook API. Update `handleComposeSend` (L1065-1083) to call the new send-fired path (`onSendFired()` or `jumpToBottom()` — whichever name the plan picks).

3. **L3095-3113 scroll container div** — LOCKED requirement from shape file: browser's built-in scroll-anchoring MUST be disabled on this container. Add `overflow-anchor:none` to the className. This directly contradicts the current comment at L3108-3111 that says "browser default overflow-anchor:auto is load-bearing" — the rewrite reverses that decision because the new state machine explicitly owns scroll position (shape file § Shape "Explicit ownership of scroll position"). Update the comment to explain the reversal.

4. **L3229-3269 accessory mount region** — accessory bubbles (WipBubble, WaitingBubble, PlanPendingBubble, AsideBubble) stay as in-flow siblings of the messages.map output inside the scroll container. NO structural change required to the mount sites themselves; the new state machine treats their mount/unmount as a single "content changed" event class via a MutationObserver on the scroll container's children. The stale comments referencing "MutationObserver + per-child ResizeObserver" (L3265-3266, L3277-3278) need updating to describe the new event flow.

5. **L3270-3316 jump-to-bottom pill** — visibility gate stays `!isPinnedToBottom` (renamed to `mode === "not-at-bottom"` under the new hook API). Click still calls the "jump to bottom" action (renamed). Message-count gate `messages.length > 0` stays. No structural change beyond variable names.

6. **L3319-3334 sentinel div** — DELETE. The rewrite abandons the IntersectionObserver + sentinel approach entirely in favor of deterministic geometry math (shape file § Chase behavior + § Explicit ownership implies no IO). Delete the div, delete the `sentinelRef` destructure.

7. **L3482 `onGoodToGo={scrollToBottomAndFollow}`** — check what this call site is (LoadMore or similar); rename to the new action if the API renames.

8. **Hide-pin-reveal mount pattern** — the shape file mandates a hide-pin-reveal wrapper: the surface is invisible while content mounts, the state machine waits for content-size measurement, then jumps + reveals. This may need an outer wrapper `<div style={{ visibility: revealed ? "visible" : "hidden" }}>` around the scroll container's content OR a CSS class the hook toggles. Planner decides the exact DOM shape; the hook's `revealed` return is what gates it.

## Shared Patterns

### Pure-reducer-extraction pattern (Phase 30 idiom)

**Source:** `src/ui/features/pretty-view/resolve-phase.ts` + `src/ui/features/pretty-view/usePaneResolvingMachine.ts` (paired).
**Apply to:** The new `auto-scroll-machine.ts` + rewritten `use-auto-scroll.ts` pair.

**Excerpt** — the load-bearing property of the pattern (resolve-phase.ts lines 41-48):

```
NO I/O IMPORTS — pure function only. No React imports, no WebSocket
imports, no logger imports, no timer scheduling, no wall-clock reads.
Enforced by the plan-30-03 structural-grep gate:
  grep -c "^import " src/ui/features/pretty-view/resolve-phase.ts → 0
This is what makes the truth-table unit tests in resolve-phase.test.ts
cheap to set up (import + call — no mocks, no timers, no renderHook).
```

Every new plan-70 test for the reducer must be `import + call` — the moment a reducer test needs a mock, a timer, or a `renderHook`, the pattern has been contaminated.

### Exhaustiveness sentinel for discriminated unions

**Source:** `src/ui/features/pretty-view/resolve-phase.ts` lines 163-186.
**Apply to:** Every `switch` on `Mode`, `AutoScrollEvent.kind`, or `AutoScrollEffect` in the new machine.

**Excerpt:**

```typescript
default: {
  const _exhaust: never = paneState;
  return _exhaust;
}
```

If a future event kind is added without a matching branch, `tsc --noEmit` fails at build time. This is the compile-time gate that keeps the machine's contract honest as it evolves.

### Ref-vs-state discipline

**Source:** `src/ui/features/pretty-view/useHoldToRecord.ts` lines 201-232 (ref block + state block, each commented with the "why ref not state" rationale).
**Apply to:** The rewritten `use-auto-scroll.ts`. `mode` is state (drives pill visibility → re-render required). `revealed` is state (drives hide-pin-reveal visibility). Everything else — DOM element pointers, RAF handles, pending-event queue, `hasLandedOnce` sentinel, measured-distance snapshots — is a ref.

### Structural-grep acceptance gates

**Source:** `src/ui/features/pretty-view/resolve-phase.ts` line 44 (`grep -c "^import "` = 0) + `src/backend/claude-session/layer1-detect.ts` header analog.
**Apply to:** The new `auto-scroll-machine.ts` — add an equivalent acceptance-grep declaration in the header comment, and include the grep in the plan's acceptance criteria.

Additional grep gates to consider per the shape file's "What would make it wrong" list:
- `grep -c "IntersectionObserver" src/ui/features/pretty-view/use-auto-scroll.ts` = 0 (the shape reverses the IO decision).
- `grep -c "MutationObserver\|ResizeObserver" src/ui/features/pretty-view/use-auto-scroll.ts` ≤ 2 (one MO on scroll-container children for the "content changed" event class; one RO on the scroll container itself for the "container resized" event class — planner picks; the point is that "three or more distinct kinds of watchers racing each other" per WWMIW bullet 6 is the anti-pattern).
- `grep -c "data-pv-scroll-sentinel" src/ui/features/pretty-view/PrettyView.tsx` = 0 (sentinel div deleted).

### Diagnostic logging convention

**Source:** Existing `[pv-scroll-diag]` prefix already used throughout `use-auto-scroll.ts` (10 sites) — reshape (don't invent a new prefix).
**Apply to:** The rewritten hook. Log one line per reducer decision + effect application: `mode-in`, `mode-out`, `chase-write`, `chase-skip`, `mount-land`, `restore-position`, `user-gesture`. Log OUTSIDE the reducer (which stays pure); log where the hook applies the returned effect. Each log line should carry the event kind, current mode, distance-from-bottom, and paneKey so console-forward.log timelines can be reconstructed.

## No Analog Found

None. Every file to create or modify has a strong in-tree analog.

## Metadata

**Analog search scope:** `src/ui/features/pretty-view/`, `src/ui/hooks/`, `src/ui/shell/`, `src/backend/claude-session/` (for the pure-reducer + test-seam idiom).
**Files scanned:** ~15 (hooks + hook tests + resolve-phase pair + layer1-detect pair + PrettyView.tsx targeted sections).
**Pattern extraction date:** 2026-09-04.
**Anti-analog note:** The current `use-auto-scroll.ts` itself is DELIBERATELY NOT used as a pattern reference — it is the observer-stack shape the rewrite exists to repudiate (shape file § Philosophy: "any code that special-cases one over the others is a signal that the state machine has been contaminated"; § What would make it wrong bullet 6: "if the rewrite ends up needing three or more distinct kinds of watchers racing each other, the design has slid back into the shape of the current code"). Same for `Phase 32` (`.planning/phases/32-.../`) — read the SUMMARY files as anti-lessons per CONTEXT.md § Canonical refs, not as patterns to copy.
