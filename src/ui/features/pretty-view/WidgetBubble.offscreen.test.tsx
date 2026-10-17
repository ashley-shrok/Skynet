/**
 * Liveness poll pauses while the widget is off screen (iPhone jank work):
 * every widget in the history used to probe its URL twice a second forever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { WidgetBubble } from "./WidgetBubble";

let ioCallback: ((entries: { isIntersecting: boolean }[]) => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  ioCallback = null;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        ioCallback = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
});

afterEach(() => {
  cleanup(); // unmount first: the poll interval never ends on its own
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("WidgetBubble liveness poll — off-screen pause", () => {
  it("probes while on screen, stops while off screen, probes immediately on return", async () => {
    render(<WidgetBubble src="/interactive/3/poll-abc/pane/" />);
    fireEvent.load(screen.getByTitle("Interactive widget"));
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(ioCallback).not.toBeNull();
    act(() => ioCallback!([{ isIntersecting: false }]));
    fetchMock.mockClear();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => { ioCallback!([{ isIntersecting: true }]); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
