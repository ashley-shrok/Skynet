import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";

import { useModalSwipeBack } from "./use-modal-swipe-back";
import { SWIPE_SLIDE_MS } from "@/shell/use-swipe-to-list";

const WIDTH = 400;
let onClose: ReturnType<typeof vi.fn<() => void>>;
let onBack: ReturnType<typeof vi.fn<() => void>>;
let onInnerBack: ReturnType<typeof vi.fn<() => void>>;

function Harness({
  backs = "none",
  closable = true,
}: {
  backs?: "none" | "head" | "both" | "disabled" | "hidden";
  closable?: boolean;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useModalSwipeBack({ enabled: true, element: el, onClose: closable ? onClose : undefined });
  return (
    <div ref={setEl} data-slot="modal-content" data-testid="window">
      {backs !== "none" ? (
        <button
          type="button"
          data-modal-back=""
          data-testid="head-back"
          disabled={backs === "disabled"}
          data-hidden={backs === "hidden" ? "" : undefined}
          onClick={onBack}
        />
      ) : null}
      <div data-testid="body">
        <input data-testid="field" />
        {backs === "both" ? (
          <button type="button" data-modal-back="" data-testid="inner-back" onClick={onInnerBack} />
        ) : null}
      </div>
      {/* A window stacked inside (portalled elsewhere in the real app). */}
      <div data-slot="modal-content">
        <button type="button" data-modal-back="" data-testid="stacked-back" />
      </div>
    </div>
  );
}

let now = 0;
function touch(type: string, target: Element, points: Array<[number, number]>) {
  now += 16;
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "touches", { value: points.map(([clientX, clientY]) => ({ clientX, clientY })) });
  Object.defineProperty(evt, "timeStamp", { value: now });
  act(() => {
    target.dispatchEvent(evt);
  });
  return evt;
}

function swipe(target: Element, toX: number, dy = 0) {
  touch("touchstart", target, [[10, 100]]);
  for (let x = 10; x <= toX; x += 4) touch("touchmove", target, [[x, 100 + (dy * (x - 10)) / Math.max(1, toX - 10)]]);
  touch("touchend", target, []);
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const el = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

describe("useModalSwipeBack", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onClose = vi.fn();
    onBack = vi.fn();
    onInnerBack = vi.fn();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: WIDTH } as DOMRect);
    // jsdom lays nothing out; treat everything as on screen unless marked.
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
      return (this.hasAttribute("data-hidden") ? [] : [{}]) as unknown as DOMRectList;
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("follows the finger, then presses the window's back control", () => {
    render(<Harness backs="head" />);
    touch("touchstart", el("body"), [[10, 100]]);
    touch("touchmove", el("body"), [[20, 101]]);
    const move = touch("touchmove", el("body"), [[110, 102]]);
    expect(move.defaultPrevented).toBe(true);
    expect(el("window").style.transform).toBe("translateX(100px)");
    touch("touchmove", el("body"), [[210, 102]]);
    touch("touchend", el("body"), []);
    expect(el("window").style.transform).toBe(`translateX(${WIDTH}px)`);
    expect(onBack).not.toHaveBeenCalled();
    advance(SWIPE_SLIDE_MS);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(el("window").style.transform).toBe("");
  });

  it("prefers the innermost back over the window's head back", () => {
    render(<Harness backs="both" />);
    swipe(el("body"), 250);
    advance(SWIPE_SLIDE_MS);
    expect(onInnerBack).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it.each(["none", "disabled", "hidden"] as const)("closes the window when there's no usable back (%s)", (backs) => {
    render(<Harness backs={backs} />);
    swipe(el("body"), 250);
    advance(SWIPE_SLIDE_MS);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
    expect(el("window").style.getPropertyValue("--tw-exit-translate-x")).toBe(`${WIDTH}px`);
  });

  it("slides back in when the window stays open after the close", () => {
    render(<Harness />);
    swipe(el("body"), 250);
    advance(SWIPE_SLIDE_MS);
    expect(onClose).toHaveBeenCalledTimes(1);
    advance(100);
    expect(el("window").style.transform).toBe("");
    advance(SWIPE_SLIDE_MS);
    expect(el("window").style.getPropertyValue("--tw-exit-translate-x")).toBe("");
  });

  it("springs back on a short release", () => {
    render(<Harness backs="head" />);
    swipe(el("body"), 60);
    advance(SWIPE_SLIDE_MS);
    expect(onBack).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(el("window").style.transform).toBe("");
  });

  it("doesn't start on a text field, a mostly-vertical move, or a left move", () => {
    render(<Harness backs="head" />);
    swipe(el("field"), 250);
    swipe(el("body"), 250, 400);
    touch("touchstart", el("body"), [[300, 100]]);
    touch("touchmove", el("body"), [[200, 100]]);
    touch("touchend", el("body"), []);
    advance(SWIPE_SLIDE_MS * 2);
    expect(onBack).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing on a first level that can't be closed", () => {
    render(<Harness closable={false} />);
    const evts: Event[] = [];
    touch("touchstart", el("body"), [[10, 100]]);
    for (let x = 14; x <= 250; x += 4) evts.push(touch("touchmove", el("body"), [[x, 100]]));
    touch("touchend", el("body"), []);
    advance(SWIPE_SLIDE_MS * 2);
    expect(evts.some((e) => e.defaultPrevented)).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});
