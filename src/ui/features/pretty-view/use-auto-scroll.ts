// phase-70: thin React wrapper around the pure auto-scroll-machine reducer (Phase 70 rewrite)
/**
 * Thin React wrapper around the pure `auto-scroll-machine` reducer.
 *
 * Phase 70 rewrote this file to a thin hook wrapping the pure reducer in
 * ./auto-scroll-machine.ts. The hook exists as a named seam so callers
 * have a stable named point — the contract is testable in isolation via
 * renderHook AND via the pure reducer's own tests in auto-scroll-machine.test.ts.
 *
 * ZERO TRANSITION LOGIC IN THIS FILE — every mode change is a `reduce()`
 * return. The hook owns the DOM refs, the RAF coalescer, the observer
 * wiring, the [pv-scroll] logging, and the hide-pin-reveal mount-landing.
 * Nothing else.
 *
 * INPUT-ORIGIN BIT (2026-09-06 fix):
 *
 *   The shape file (shape-pv-autoscroll-rewrite.md § Shape para 2) names the
 *   input-origin bit for OUT transitions concretely: "a real user input event
 *   (wheel, touch drag, scrollbar drag, keyboard)". This hook listens for
 *   those events DIRECTLY and dispatches user-input from them. It does NOT
 *   listen for `scroll` events, because scroll events fire for both user
 *   gestures AND programmatic writes (isTrusted=true in both cases) AND for
 *   browser-driven reflows during layout changes (drag reorder, portal
 *   switch). Using scroll as the origin signal — even gated by isTrusted or
 *   pending-write flags — is the "guessing user intent from ambiguous signals"
 *   the shape file § Philosophy explicitly rejected.
 *
 *   The listener set:
 *     - wheel        → mouse wheel / trackpad two-finger scroll
 *     - touchmove    → touch drag
 *     - keydown      → arrow keys, PageUp/Down, Home/End, Space
 *     - pointerdown  → scrollbar drag start (also covers other pointer
 *                      interactions with the scroll surface)
 *     - scrollend    → post-momentum landing on touch devices (fires when
 *                      iOS momentum concludes, so a fling-back-to-bottom
 *                      correctly transitions IN even without a final
 *                      touchmove)
 *
 *   Each fires → schedule a RAF-coalesced measure of distanceFromBottom →
 *   dispatch {kind:"user-input", ...} to the reducer. RAF timing ensures we
 *   measure AFTER the browser has processed the input and updated scrollTop.
 *
 * INVARIANTS (from shape-pv-autoscroll-rewrite.md § What would make it wrong):
 *
 *   (1) No special-casing per event kind — every bottom-moving event is treated
 *       uniformly via the reducer. No `if (event.kind === "content-changed") {...}`
 *       branching in this file; the reducer handles all of it.
 *
 *   (2) Programmatic scroll writes NEVER transition mode — enforced STRUCTURALLY
 *       by not listening for scroll events at all. Chase writes fire scroll
 *       events but nothing observes them.
 *
 *   (3) Mount-time landing has no visible flash at the top — the hide-pin-reveal
 *       pattern: surface is invisible (`revealed = false`) while content mounts,
 *       reducer fires `effect: "reveal"` on the first measured event with
 *       non-zero contentHeight, THEN `revealed` flips true.
 *
 *   (4) iOS momentum-scroll rubber-band never produces a silent out-of-at-bottom
 *       flip during a chase — chase-writes don't feed back as user-input
 *       (structural, per invariant 2), and `scrollend` catches post-momentum
 *       landing so momentum-back-to-bottom transitions IN correctly.
 *
 *   (5) Browser scroll-anchoring is disabled on the container — the consumer
 *       (PrettyView.tsx) adds `overflow-anchor: none` to the scroll container.
 *       This hook takes explicit ownership of scroll position via chase-writes.
 *
 *   (6) Observer count is exactly ≤ 2 — one MutationObserver watching the scroll
 *       container's childList + subtree, one ResizeObserver watching the scroll
 *       container itself. No IO (intersection observer). No sentinel-div consumer.
 *       No per-child ResizeObserver.
 *
 * GREP-GATE SUMMARY (acceptance criteria):
 *   Observer count gate: 1 MutationObserver + 1 ResizeObserver, no IO, no sentinel-div.
 *   No smooth-scroll gate: only instant scrollTop assignment writes; no
 *     smooth-behavior scrollTo, no scroll-into-view, no CSS scroll-behavior. Instant writes only.
 *   No scroll-listener gate: this file does NOT attach a listener for the
 *     "scroll" event. Grep: `addEventListener\("scroll"` → 0 hits in this file.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  reduce,
  createInitialState,
  type AutoScrollState,
  type AutoScrollEvent,
  type Mode,
} from "./auto-scroll-machine";
import { useIsTouchDevice } from "../../hooks/use-is-touch-device";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return shape. Exactly five keys — no more, no fewer.
 *
 * scrollRef             — callback ref for the scroll container
 * jumpToBottom          — dispatches {kind:"jump-clicked"} to the reducer;
 *                         wired by PrettyView.tsx to the jump-to-bottom pill
 *                         onClick AND the LoadMore onGoodToGo prop
 * onSendFired           — dispatches {kind:"send-fired"}; wired by
 *                         PrettyView.tsx handleComposeSend
 * mode                  — current state.mode from the reducer; drives jump-pill
 *                         visibility (mode === "not-at-bottom")
 * revealed              — false during mount-landing hide window, true forever
 *                         after the first effect:"reveal" from the reducer
 */
export interface UseAutoScrollResult {
  scrollRef: (el: HTMLElement | null) => void;
  jumpToBottom: () => void;
  onSendFired: () => void;
  mode: Mode;
  revealed: boolean;
}

// ── Scroll-key set — keyboard input-origin bit ────────────────────────────────

// Keys the browser treats as scroll input on a focused scrollable element.
// Space is included (Page Down when scroll container is focused; also
// Shift+Space for Page Up, both share the same key.code "Space").
const SCROLL_KEYS = new Set<string>([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAutoScroll(paneKey: string): UseAutoScrollResult {
  // ---- State ----------------------------------------------------------------
  // mode is state (not a ref) because it drives the jump-pill visibility in the
  // consumer's render — a re-render must fire on every mode transition so the
  // pill appears/disappears immediately.
  const [mode, setMode] = useState<Mode>("at-bottom");

  // revealed is state (not a ref) because it drives the `visibility: hidden`
  // wrapper in PrettyView.tsx — a re-render must fire when the surface becomes
  // visible for the first time so mount-landing completes correctly.
  const [revealed, setRevealed] = useState<boolean>(false);

  // ---- Refs -----------------------------------------------------------------
  // scrollEl via useState so callback-ref fires trigger useEffect re-runs on
  // mount. The raw element is stored here for use in event handlers.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);

  // stateRef — mirror of the reducer's authoritative state; read synchronously
  // inside event handlers so we always dispatch against the freshest state
  // without waiting for React to flush the setMode call. State lives HERE, not
  // in React state (which would require an extra render cycle to update).
  const stateRef = useRef<AutoScrollState>(createInitialState());

  // chaseRafRef — pending requestAnimationFrame handle for chase-write
  // coalescing. Separate from userInputRafRef so a pending chase and a pending
  // user-input measure can coexist (they do different things).
  const chaseRafRef = useRef<number | null>(null);

  // userInputRafRef — pending requestAnimationFrame handle for user-input
  // measurement coalescing. Set when a user input event fires; cleared when
  // the RAF callback dispatches the user-input event. Coalesces bursts of
  // wheel/touchmove/keydown into one measure per frame.
  const userInputRafRef = useRef<number | null>(null);

  // userInputIsTouchRef — the isTouch value to attach to the next pending
  // user-input dispatch. Written by the input listeners (touchmove sets true,
  // wheel/keydown/pointerdown/scrollend fall back to isTouchDeviceRef). Read
  // by the RAF callback.
  const userInputIsTouchRef = useRef<boolean>(false);

  // mutationObserverRef — the MutationObserver watching scroll-container
  // children (childList + subtree). Stored in a ref so cleanup can disconnect
  // it without needing it in a useEffect dependency array.
  const mutationObserverRef = useRef<MutationObserver | null>(null);

  // resizeObserverRef — the ResizeObserver watching the scroll container itself.
  // Stored in a ref for the same cleanup reason as mutationObserverRef.
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // mountLandingActiveRef — true from mount until the reducer returns
  // effect:"reveal" (which flips hasLandedOnce true). Read inside the
  // ResizeObserver callback to decide whether to ALSO dispatch a {kind:"measured"}
  // event alongside the always-dispatched {kind:"container-resized"}. Cleared
  // in the dispatch wrapper the moment effect === "reveal" is observed.
  const mountLandingActiveRef = useRef<boolean>(true);

  // isTouchDeviceRef — snapshot of the touch-device boolean from
  // useIsTouchDevice(); stored in a ref so the value is available inside event
  // handlers without creating a dependency that re-runs effects on every render.
  const isTouchDevice = useIsTouchDevice();
  const isTouchDeviceRef = useRef<boolean>(isTouchDevice);
  isTouchDeviceRef.current = isTouchDevice;

  // scrollElRef — always-current mirror of scrollEl state so RAF callbacks,
  // jumpToBottom, and onSendFired can access the live element without stale
  // closures. Refs are synchronously updated on every render, so event handlers
  // that close over scrollElRef.current always get the latest element.
  const scrollElRef = useRef<HTMLElement | null>(null);
  scrollElRef.current = scrollEl;

  // ---- Scroll callback ref --------------------------------------------------
  const scrollRef = useCallback((el: HTMLElement | null) => {
    setScrollEl(el);
  }, []);

  // ---- Helpers --------------------------------------------------------------

  /** computeDistance — live geometry: how far from the bottom is the container? */
  function computeDistance(el: HTMLElement): number {
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }

  /** scheduleRafChase — idempotent RAF scheduler for chase-writes. Guards by
   *  chaseRafRef so at most one frame is scheduled per RAF cycle. The write
   *  inside the callback is instant (scrollTop = scrollHeight — no smooth API).
   *  Uses scrollElRef.current (not scrollEl from closure) so the RAF callback
   *  always writes to the latest bound element even if jumpToBottom/onSendFired
   *  were memoized at a time when scrollEl was null.
   */
  function scheduleRafChase(): void {
    if (chaseRafRef.current !== null) return; // already scheduled for this frame
    chaseRafRef.current = requestAnimationFrame(() => {
      const el = scrollElRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
      chaseRafRef.current = null;
    });
  }

  /** scheduleUserInputMeasure — RAF-coalesced user-input dispatch. Called from
   *  the direct input listeners (wheel/touchmove/keydown/pointerdown/scrollend).
   *  Measures distanceFromBottom AFTER the browser has processed the input and
   *  updated scrollTop (RAF fires post-paint-schedule but pre-paint, so
   *  scrollTop reflects the input's effect by then), then dispatches user-input
   *  to the reducer. If a measure is already scheduled, latches the isTouch
   *  value and no-ops (last-writer-wins for isTouch within a single frame is
   *  fine — touchmove and wheel don't co-occur in normal use).
   */
  function scheduleUserInputMeasure(isTouch: boolean): void {
    userInputIsTouchRef.current = isTouch;
    if (userInputRafRef.current !== null) return;
    userInputRafRef.current = requestAnimationFrame(() => {
      userInputRafRef.current = null;
      const el = scrollElRef.current;
      if (!el) return;
      dispatch({
        kind: "user-input",
        distanceFromBottom: computeDistance(el),
        isTouch: userInputIsTouchRef.current,
      });
    });
  }

  /** dispatch — the single seam. Every event goes through here.
   *
   *  Order:
   *   (i)   reduce + update stateRef
   *   (ii)  log mode-in/mode-out on transition + call setMode
   *   (iii) on effect:"reveal" → setRevealed(true), clear mountLandingActiveRef, log mount-land
   *   (iv)  on effect:"chase" → schedule RAF chase-write, log chase-write
   *   (v)   on effect:"none" + bottom-moving event + mode=not-at-bottom → log chase-skip
   */
  function dispatch(event: AutoScrollEvent): void {
    const prevState = stateRef.current;
    const { next, effect } = reduce(prevState, event);
    stateRef.current = next;

    // (i)+(ii) mode transition logging + state flush
    if (next.mode !== prevState.mode) {
      console.info(
        `[pv-scroll] mode-out mode=${prevState.mode} next=${next.mode} event=${event.kind} paneKey=${paneKey}`,
      );
      setMode(next.mode);
      console.info(
        `[pv-scroll] mode-in mode=${next.mode} event=${event.kind} dist=${next.lastMeasuredDistance} paneKey=${paneKey}`,
      );
    }

    // (iii) reveal effect → mount-landing complete
    if (effect === "reveal") {
      setRevealed(true);
      mountLandingActiveRef.current = false;
      console.info(
        `[pv-scroll] mount-land event=${event.kind} paneKey=${paneKey}`,
      );
    } else if (effect === "chase") {
      // (iv) chase effect → schedule RAF write
      scheduleRafChase();
      console.info(
        `[pv-scroll] chase-write event=${event.kind} mode=${next.mode} dist=${next.lastMeasuredDistance} paneKey=${paneKey}`,
      );
    } else if (
      effect === "none" &&
      next.mode === "not-at-bottom" &&
      (event.kind === "content-changed" ||
        event.kind === "container-resized" ||
        event.kind === "measured")
    ) {
      // (v) bottom-moving event while user is scrolled up → log chase-skip
      // so the "content grew but we deliberately did not chase" case is visible
      // in the runtime log stream.
      console.info(
        `[pv-scroll] chase-skip event=${event.kind} mode=${next.mode} paneKey=${paneKey}`,
      );
    }
  }

  // ---- Observer + user-input listener setup ────────────────────────────────
  useEffect(() => {
    if (!scrollEl) return;

    // Reset mount-landing state when a new scroll element is bound so that a
    // remounted scroll container goes through hide-pin-reveal correctly.
    mountLandingActiveRef.current = true;

    // ── Direct user-input listeners (per shape file § Shape para 2) ────────
    // These are the ONLY signal used for the OUT transition. Scroll events
    // are NOT listened to — they fire for both user gestures and programmatic
    // writes and are therefore not a sound origin signal (shape file
    // § Philosophy: "Nothing is inferred from position drift, layout timing,
    // or watcher race outcomes").
    const onWheel = (): void => scheduleUserInputMeasure(false);
    const onTouchMove = (): void => scheduleUserInputMeasure(true);
    const onKeyDown = (e: KeyboardEvent): void => {
      if (SCROLL_KEYS.has(e.key)) scheduleUserInputMeasure(false);
    };
    const onPointerDown = (): void =>
      scheduleUserInputMeasure(isTouchDeviceRef.current);
    const onScrollEnd = (): void =>
      scheduleUserInputMeasure(isTouchDeviceRef.current);

    scrollEl.addEventListener("wheel", onWheel, { passive: true });
    scrollEl.addEventListener("touchmove", onTouchMove, { passive: true });
    scrollEl.addEventListener("keydown", onKeyDown);
    scrollEl.addEventListener("pointerdown", onPointerDown);
    scrollEl.addEventListener("scrollend", onScrollEnd);

    // ── MutationObserver — one instance on scroll container children ───────
    // Observes childList+subtree so new messages, WipBubble, WaitingBubble,
    // AsideBubble mounts/unmounts all fire content-changed.
    // One MO per scroll container (observer count gate enforced).
    const mo = new MutationObserver(() => {
      dispatch({ kind: "content-changed" });
    });
    mo.observe(scrollEl, { childList: true, subtree: true });
    mutationObserverRef.current = mo;

    // ── ResizeObserver — one instance on scroll container itself ───────────
    // Fires on window resize, pane-count/split-layout change, browser zoom,
    // and — critically — on portal reparent during split-view drag reorder
    // (the reparent changes the container's ancestor chain which changes
    // clientHeight/scrollHeight and RO fires). Always dispatches
    // container-resized. During mount-landing also dispatches a measured
    // event (via mountLandingActiveRef check).
    // One RO per scroll container (observer count gate enforced).
    const ro = new ResizeObserver(() => {
      // Always dispatch the container-resized event.
      dispatch({ kind: "container-resized" });
      // During mount-landing, ALSO dispatch a measured event so the reducer
      // has geometry data to decide when to fire effect:"reveal".
      if (mountLandingActiveRef.current) {
        dispatch({
          kind: "measured",
          distanceFromBottom: computeDistance(scrollEl),
          contentHeight: scrollEl.scrollHeight,
        });
      }
    });
    ro.observe(scrollEl);
    resizeObserverRef.current = ro;

    return () => {
      scrollEl.removeEventListener("wheel", onWheel);
      scrollEl.removeEventListener("touchmove", onTouchMove);
      scrollEl.removeEventListener("keydown", onKeyDown);
      scrollEl.removeEventListener("pointerdown", onPointerDown);
      scrollEl.removeEventListener("scrollend", onScrollEnd);
      mo.disconnect();
      mutationObserverRef.current = null;
      ro.disconnect();
      resizeObserverRef.current = null;
      // Cancel any pending RAFs on cleanup to avoid writing into a detached
      // element.
      if (chaseRafRef.current !== null) {
        cancelAnimationFrame(chaseRafRef.current);
        chaseRafRef.current = null;
      }
      if (userInputRafRef.current !== null) {
        cancelAnimationFrame(userInputRafRef.current);
        userInputRafRef.current = null;
      }
    };
  }, [scrollEl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Mount-landing initial measured kick ─────────────────────────────────
  // Fire an initial synchronous measured event with the live geometry of the
  // scroll container. distanceFromBottom is computed from actual DOM geometry
  // (not hardcoded 0) so an already-at-bottom first paint transitions correctly
  // and a pre-scrolled first paint is respected.
  useEffect(() => {
    if (!scrollEl) return;
    // Reset reducer + revealed state for the new element.
    stateRef.current = createInitialState();
    setMode("at-bottom");
    setRevealed(false);
    mountLandingActiveRef.current = true;

    dispatch({
      kind: "measured",
      distanceFromBottom: computeDistance(scrollEl),
      contentHeight: scrollEl.scrollHeight,
    });
  }, [scrollEl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Named actions ───────────────────────────────────────────────────────
  const jumpToBottom = useCallback(() => {
    dispatch({ kind: "jump-clicked" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSendFired = useCallback(() => {
    dispatch({ kind: "send-fired" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { scrollRef, jumpToBottom, onSendFired, mode, revealed };
}
