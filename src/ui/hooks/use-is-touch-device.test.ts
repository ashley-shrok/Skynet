// ─── useIsTouchDevice — Vitest coverage ─────────────────────────────────────
// quick-260821-suv: backfill unit tests for the pre-existing useIsTouchDevice
// hook. The hook wraps `matchMedia("(pointer: coarse) and (hover: none)")` and
// re-renders on the MediaQueryList `change` event.
//
// Shape mirrors src/ui/hooks/use-mobile.test.ts (setViewport helper style,
// afterEach vi.restoreAllMocks, no beforeEach — each `it` seeds its own mock).
//
// Scope cut (deliberate): the hook's SSR-safe `typeof window === "undefined"`
// early return branch is NOT tested here. jsdom's vitest env always has
// `window`, so exercising that branch requires a separate `@vitest-environment
// node` file. Left out of scope for this quick — the branch is a defensive
// belt-and-suspenders shim carried from useIsMobile and is not the target of
// the iPad long-press / swipe-to-act fix. Future maintainer: if you want the
// SSR branch covered, add a sibling `.node.test.ts` file with a node
// vitest env override.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsTouchDevice } from "./use-is-touch-device.js";

const TOUCH_QUERY = "(pointer: coarse) and (hover: none)";

// The hook calls `window.matchMedia(TOUCH_QUERY)` TWICE — once in the
// useState lazy initializer, once inside the useEffect. Both calls must
// return the SAME MediaQueryList instance so that `addEventListener` is
// spied on and `removeEventListener` receives the same object reference at
// unmount time. Memoize per query string.
function setMatchMedia(matches: boolean) {
  const perQueryCache = new Map<
    string,
    {
      matches: boolean;
      media: string;
      onchange: null;
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
      dispatchEvent: ReturnType<typeof vi.fn>;
    }
  >();
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const cached = perQueryCache.get(query);
    if (cached) return cached;
    const mql = {
      matches: query === TOUCH_QUERY ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    perQueryCache.set(query, mql);
    return mql;
  });
  return perQueryCache;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useIsTouchDevice", () => {
  it("returns true when matchMedia reports the touch query matches", () => {
    setMatchMedia(true);
    const { result } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(true);
  });

  it("returns false when matchMedia reports the touch query does not match", () => {
    setMatchMedia(false);
    const { result } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(false);
  });

  it("re-renders when the MediaQueryList `change` event fires with a new matches value", () => {
    const cache = setMatchMedia(false);
    const { result } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(false);

    // The hook registers its change listener on the mounted-effect MQL — pull
    // it out of the addEventListener spy and invoke it with a synthetic event.
    const mql = cache.get(TOUCH_QUERY)!;
    expect(mql.addEventListener).toHaveBeenCalledTimes(1);
    const [eventName, listener] = mql.addEventListener.mock.calls[0] as [
      string,
      (ev: { matches: boolean }) => void,
    ];
    expect(eventName).toBe("change");

    // Flip the MQL's matches value so `mql.matches` (what the listener
    // reads) reflects the new state, then invoke the captured listener.
    mql.matches = true;
    act(() => {
      listener({ matches: true });
    });

    expect(result.current).toBe(true);
  });

  it("removes the same listener on unmount that was registered on mount", () => {
    const cache = setMatchMedia(false);
    const { unmount } = renderHook(() => useIsTouchDevice());

    const mql = cache.get(TOUCH_QUERY)!;
    expect(mql.addEventListener).toHaveBeenCalledTimes(1);
    const registeredListener = mql.addEventListener.mock.calls[0][1];

    unmount();

    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
    expect(mql.removeEventListener).toHaveBeenCalledWith(
      "change",
      registeredListener,
    );
  });
});
