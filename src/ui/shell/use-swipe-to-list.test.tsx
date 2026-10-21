import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";

import { useSwipeToList, SWIPE_SLIDE_MS } from "./use-swipe-to-list";

const WIDTH = 400;
let onCommit: ReturnType<typeof vi.fn<() => void>>;

function Harness({ enabled = true }: { enabled?: boolean }) {
  const layerRef = useRef<HTMLDivElement>(null);
  useSwipeToList({ enabled, layerRef, onCommit });
  return (
    <>
      <div ref={layerRef} data-testid="layer" />
      <div data-testid="content">
        <input data-testid="field" />
        <div data-testid="optout" data-no-swipe-to-list="" />
        <pre data-testid="wide" style={{ overflowX: "auto" }} />
        <div data-testid="owndrag" style={{ touchAction: "none" }}>
          <span data-testid="owndrag-child" />
        </div>
      </div>
    </>
  );
}

let now = 0;
function touch(type: string, target: Element, points: Array<[number, number]>) {
  now += 16;
  const evt = new Event(type, { bubbles: true, cancelable: true });
  const list = points.map(([clientX, clientY]) => ({ clientX, clientY }));
  Object.defineProperty(evt, "touches", { value: list });
  Object.defineProperty(evt, "timeStamp", { value: now });
  act(() => {
    target.dispatchEvent(evt);
  });
  return evt;
}

/** A slow drag from x=10 to `toX`, then release. */
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

const layer = () => document.querySelector<HTMLElement>('[data-testid="layer"]')!;
const el = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

describe("useSwipeToList", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onCommit = vi.fn();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: WIDTH } as DOMRect);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("follows the finger, then commits past the threshold", () => {
    render(<Harness />);
    touch("touchstart", el("content"), [[10, 100]]);
    touch("touchmove", el("content"), [[20, 101]]);
    const move = touch("touchmove", el("content"), [[110, 102]]);
    expect(move.defaultPrevented).toBe(true);
    expect(layer().style.transform).toBe(`translateX(${100 - WIDTH}px)`);
    expect(layer().style.visibility).toBe("visible");
    touch("touchmove", el("content"), [[210, 102]]);
    touch("touchend", el("content"), []);
    expect(layer().style.transform).toBe("translateX(0px)");
    expect(onCommit).not.toHaveBeenCalled();
    advance(SWIPE_SLIDE_MS);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("slides back and clears the layer on a short release", () => {
    render(<Harness />);
    swipe(el("content"), 60);
    expect(layer().style.transform).toBe(`translateX(${-WIDTH}px)`);
    advance(SWIPE_SLIDE_MS);
    expect(onCommit).not.toHaveBeenCalled();
    expect(layer().style.transform).toBe("");
    expect(layer().style.visibility).toBe("");
  });

  it("commits a short fast flick", () => {
    render(<Harness />);
    touch("touchstart", el("content"), [[10, 100]]);
    touch("touchmove", el("content"), [[30, 100]]);
    touch("touchmove", el("content"), [[70, 100]]);
    touch("touchend", el("content"), []);
    advance(SWIPE_SLIDE_MS);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("leaves vertical scrolls and leftward swipes alone", () => {
    render(<Harness />);
    touch("touchstart", el("content"), [[100, 100]]);
    const down = touch("touchmove", el("content"), [[103, 140]]);
    expect(down.defaultPrevented).toBe(false);
    touch("touchmove", el("content"), [[300, 140]]);
    touch("touchend", el("content"), []);
    touch("touchstart", el("content"), [[200, 100]]);
    touch("touchmove", el("content"), [[150, 100]]);
    touch("touchend", el("content"), []);
    advance(SWIPE_SLIDE_MS);
    expect(layer().style.transform).toBe("");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("doesn't start on a text field, an opted-out element, or content scrolled sideways", () => {
    render(<Harness />);
    swipe(el("field"), 300);
    swipe(el("optout"), 300);
    const wide = el("wide");
    Object.defineProperty(wide, "scrollWidth", { value: 1000 });
    Object.defineProperty(wide, "clientWidth", { value: 300 });
    Object.defineProperty(wide, "scrollLeft", { value: 50 });
    swipe(wide, 300);
    advance(SWIPE_SLIDE_MS);
    expect(onCommit).not.toHaveBeenCalled();
    expect(layer().style.transform).toBe("");
  });

  it("swipes over sideways content that's already at its left edge", () => {
    render(<Harness />);
    const wide = el("wide");
    Object.defineProperty(wide, "scrollWidth", { value: 1000 });
    Object.defineProperty(wide, "clientWidth", { value: 300 });
    swipe(wide, 300);
    advance(SWIPE_SLIDE_MS);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("doesn't start while a dialog is open", () => {
    render(<Harness />);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.appendChild(dialog);
    swipe(el("content"), 300);
    advance(SWIPE_SLIDE_MS);
    expect(onCommit).not.toHaveBeenCalled();
    dialog.remove();
  });

  it("cancels on a second finger or touchcancel", () => {
    render(<Harness />);
    touch("touchstart", el("content"), [[10, 100]]);
    touch("touchmove", el("content"), [[300, 100]]);
    touch("touchmove", el("content"), [[300, 100], [50, 50]]);
    advance(SWIPE_SLIDE_MS);
    touch("touchstart", el("content"), [[10, 100]]);
    touch("touchmove", el("content"), [[300, 100]]);
    touch("touchcancel", el("content"), []);
    advance(SWIPE_SLIDE_MS);
    expect(onCommit).not.toHaveBeenCalled();
    expect(layer().style.transform).toBe("");
  });

  it("clears the layer when turned off (the screen switched) and after a stuck commit", () => {
    const { rerender } = render(<Harness />);
    swipe(el("content"), 300);
    advance(SWIPE_SLIDE_MS);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(layer().style.transform).toBe("translateX(0px)");
    rerender(<Harness enabled={false} />);
    expect(layer().style.transform).toBe("");

    rerender(<Harness enabled />);
    swipe(el("content"), 300);
    advance(SWIPE_SLIDE_MS);
    expect(onCommit).toHaveBeenCalledTimes(2);
    advance(1500);
    expect(layer().style.transform).toBe("");
  });

  it("never cancels an undecided move, so a scroll that starts out leaning right still scrolls", () => {
    render(<Harness />);
    touch("touchstart", el("content"), [[100, 100]]);
    const first = touch("touchmove", el("content"), [[102, 99]]);
    expect(first.defaultPrevented).toBe(false);
    touch("touchmove", el("content"), [[103, 70]]);
    touch("touchend", el("content"), []);
    expect(layer().style.transform).toBe("");
  });

  it("doesn't start on a control that takes its own drags (touch-action: none)", () => {
    render(<Harness />);
    swipe(el("owndrag-child"), 300);
    advance(SWIPE_SLIDE_MS);
    expect(onCommit).not.toHaveBeenCalled();
    expect(layer().style.transform).toBe("");
  });

  it("slides back when a second finger lands mid-swipe", () => {
    render(<Harness />);
    touch("touchstart", el("content"), [[10, 100]]);
    touch("touchmove", el("content"), [[160, 100]]);
    expect(layer().style.transform).toBe(`translateX(${150 - WIDTH}px)`);
    touch("touchstart", el("content"), [[160, 100], [300, 300]]);
    advance(SWIPE_SLIDE_MS);
    expect(layer().style.transform).toBe("");
    touch("touchend", el("content"), []);
    advance(SWIPE_SLIDE_MS);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("doesn't count a flick when the finger rested before lifting", () => {
    render(<Harness />);
    touch("touchstart", el("content"), [[10, 100]]);
    touch("touchmove", el("content"), [[30, 100]]);
    touch("touchmove", el("content"), [[70, 100]]);
    now += 300;
    touch("touchend", el("content"), []);
    advance(SWIPE_SLIDE_MS);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels on a flick back to the left, even past the threshold", () => {
    render(<Harness />);
    touch("touchstart", el("content"), [[10, 100]]);
    touch("touchmove", el("content"), [[30, 100]]);
    touch("touchmove", el("content"), [[250, 100]]);
    touch("touchmove", el("content"), [[200, 100]]);
    touch("touchend", el("content"), []);
    advance(SWIPE_SLIDE_MS);
    expect(onCommit).not.toHaveBeenCalled();
    expect(layer().style.transform).toBe("");
  });

  it("does nothing while disabled", () => {
    render(<Harness enabled={false} />);
    swipe(el("content"), 300);
    advance(SWIPE_SLIDE_MS);
    expect(onCommit).not.toHaveBeenCalled();
    expect(layer().style.transform).toBe("");
  });
});
