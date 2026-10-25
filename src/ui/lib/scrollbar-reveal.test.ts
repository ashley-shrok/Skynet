import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  REVEAL_ATTR,
  REVEAL_MS,
  flashScrollbars,
  installScrollbarReveal,
  __resetScrollbarRevealForTests,
} from "./scrollbar-reveal";

function scrollArea(overflowing: boolean): HTMLDivElement {
  const el = document.createElement("div");
  el.style.overflowY = "auto";
  Object.defineProperty(el, "clientHeight", { value: 100, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: overflowing ? 500 : 100, configurable: true });
  document.body.appendChild(el);
  return el;
}

describe("scrollbar-reveal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a scroll area's scrollbar while the user scrolls it, then hides it", () => {
    __resetScrollbarRevealForTests();
    installScrollbarReveal();
    const el = scrollArea(true);
    el.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    el.dispatchEvent(new Event("scroll"));
    expect(el.hasAttribute(REVEAL_ATTR)).toBe(true);
    vi.advanceTimersByTime(REVEAL_MS - 10);
    el.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(REVEAL_MS - 10);
    expect(el.hasAttribute(REVEAL_ATTR)).toBe(true);
    vi.advanceTimersByTime(20);
    expect(el.hasAttribute(REVEAL_ATTR)).toBe(false);
  });

  it("ignores scrolls the app makes on its own", () => {
    __resetScrollbarRevealForTests();
    installScrollbarReveal();
    vi.advanceTimersByTime(5000);
    const el = scrollArea(true);
    el.dispatchEvent(new Event("scroll"));
    expect(el.hasAttribute(REVEAL_ATTR)).toBe(false);
  });

  it("flashes only the areas that run past their edge", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const long = scrollArea(true);
    const short = scrollArea(false);
    root.append(long, short);
    flashScrollbars(root);
    expect(long.hasAttribute(REVEAL_ATTR)).toBe(true);
    expect(short.hasAttribute(REVEAL_ATTR)).toBe(false);
    expect(root.hasAttribute(REVEAL_ATTR)).toBe(false);
    vi.advanceTimersByTime(REVEAL_MS);
    expect(long.hasAttribute(REVEAL_ATTR)).toBe(false);
  });

  it("flashes just the root when asked not to look inside", () => {
    const root = scrollArea(true);
    const inner = scrollArea(true);
    root.appendChild(inner);
    flashScrollbars(root, { descendants: false });
    expect(root.hasAttribute(REVEAL_ATTR)).toBe(true);
    expect(inner.hasAttribute(REVEAL_ATTR)).toBe(false);
  });
});
