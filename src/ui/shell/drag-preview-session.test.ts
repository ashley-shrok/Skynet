import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DRAG_PREVIEW_WATCHDOG_MS,
  __resetDragPreviewSessionForTests,
  claimDragPreview,
  releaseDragPreview,
  subscribeDragSessionEnd,
} from "./drag-preview-session";

describe("drag-preview-session", () => {
  beforeEach(() => {
    __resetDragPreviewSessionForTests();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers();
  });
  afterEach(() => {
    __resetDragPreviewSessionForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("claiming clears the previous owner, not the claimant", () => {
    const a = {};
    const b = {};
    const clearA = vi.fn();
    const clearB = vi.fn();
    claimDragPreview(a, "a", clearA);
    claimDragPreview(a, "a", clearA); // re-claim per dragover is a no-op
    expect(clearA).not.toHaveBeenCalled();
    claimDragPreview(b, "b", clearB);
    expect(clearA).toHaveBeenCalledTimes(1);
    expect(clearB).not.toHaveBeenCalled();
  });

  it("a released owner is not cleared by the next claim", () => {
    const a = {};
    const clearA = vi.fn();
    claimDragPreview(a, "a", clearA);
    releaseDragPreview(a);
    claimDragPreview({}, "b", vi.fn());
    expect(clearA).not.toHaveBeenCalled();
  });

  it.each([
    ["dragend", () => window.dispatchEvent(new Event("dragend"))],
    [
      "drop",
      () => {
        document.body.dispatchEvent(new Event("drop", { bubbles: true }));
        vi.advanceTimersByTime(0);
      },
    ],
    [
      "watchdog",
      () => {
        window.dispatchEvent(new Event("dragover"));
        vi.advanceTimersByTime(DRAG_PREVIEW_WATCHDOG_MS);
      },
    ],
  ])("session end via %s clears the owner and notifies subscribers", (_name, end) => {
    const onEnd = vi.fn();
    const unsubscribe = subscribeDragSessionEnd(onEnd);
    const clearA = vi.fn();
    claimDragPreview({}, "a", clearA);
    end();
    expect(clearA).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("drop is seen in capture phase even when the target stops propagation", () => {
    const onEnd = vi.fn();
    const unsubscribe = subscribeDragSessionEnd(onEnd);
    const target = document.createElement("div");
    document.body.appendChild(target);
    target.addEventListener("drop", (e) => e.stopPropagation());
    target.dispatchEvent(new Event("drop", { bubbles: true }));
    vi.advanceTimersByTime(0);
    expect(onEnd).toHaveBeenCalledTimes(1);
    target.remove();
    unsubscribe();
  });

  it("continuous dragover keeps the session alive", () => {
    const onEnd = vi.fn();
    const unsubscribe = subscribeDragSessionEnd(onEnd);
    for (let i = 0; i < 10; i++) {
      window.dispatchEvent(new Event("dragover"));
      vi.advanceTimersByTime(DRAG_PREVIEW_WATCHDOG_MS - 1);
    }
    expect(onEnd).not.toHaveBeenCalled();
    unsubscribe();
  });
});
