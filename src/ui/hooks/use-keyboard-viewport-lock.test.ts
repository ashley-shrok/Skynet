import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardViewportLock } from "./use-keyboard-viewport-lock";

class FakeVisualViewport extends EventTarget {
  height = 900;
  offsetTop = 0;
}

describe("useKeyboardViewportLock", () => {
  let vv: FakeVisualViewport;
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vv = new FakeVisualViewport();
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      // Run synchronously; return 0 so the hook's pending-frame guard
      // (set from this return value AFTER the callback ran) stays clear.
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--app-height");
    document.documentElement.classList.remove("kb-open");
  });

  const root = () => document.documentElement;

  it("sizes the app to the visual viewport and pins scroll while the keyboard is up", () => {
    renderHook(() => useKeyboardViewportLock(true));
    expect(root().style.getPropertyValue("--app-height")).toBe("");

    vv.height = 487;
    vv.offsetTop = 413;
    vv.dispatchEvent(new Event("resize"));

    expect(root().style.getPropertyValue("--app-height")).toBe("487px");
    expect(root().classList.contains("kb-open")).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("restores 100dvh fallback when the keyboard closes", () => {
    renderHook(() => useKeyboardViewportLock(true));
    vv.height = 487;
    vv.dispatchEvent(new Event("resize"));
    vv.height = 900;
    vv.dispatchEvent(new Event("resize"));

    expect(root().style.getPropertyValue("--app-height")).toBe("");
    expect(root().classList.contains("kb-open")).toBe(false);
  });

  it("ignores small viewport changes (URL bar, not keyboard)", () => {
    renderHook(() => useKeyboardViewportLock(true));
    vv.height = 840;
    vv.dispatchEvent(new Event("resize"));
    expect(root().classList.contains("kb-open")).toBe(false);
  });

  it("does nothing when disabled (desktop)", () => {
    renderHook(() => useKeyboardViewportLock(false));
    vv.height = 400;
    vv.dispatchEvent(new Event("resize"));
    expect(root().classList.contains("kb-open")).toBe(false);
  });

  it("cleans up on unmount", () => {
    const { unmount } = renderHook(() => useKeyboardViewportLock(true));
    vv.height = 487;
    vv.dispatchEvent(new Event("resize"));
    unmount();
    expect(root().style.getPropertyValue("--app-height")).toBe("");
    expect(root().classList.contains("kb-open")).toBe(false);
  });
});
