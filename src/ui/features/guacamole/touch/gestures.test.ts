import { describe, it, expect, beforeEach } from "vitest";
import {
  DRAG_DELAY_MS,
  GestureRecognizer,
  HOLD_MS,
  SCROLL_STEP_PX,
  type GestureAction,
  type GestureMode,
  type GestureTimers,
} from "./gestures";

// Fake clock: timers fire only when advanced.
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: GestureTimers = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => {
      pending.delete(h as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...pending]) {
      if (t.at <= now) {
        pending.delete(id);
        t.fn();
      }
    }
  };
  return { timers, advance };
}

let actions: GestureAction[];
let zoomed: boolean;
let clock: ReturnType<typeof fakeTimers>;

function make(mode: GestureMode) {
  return new GestureRecognizer({
    mode,
    emit: (a) => actions.push(a),
    isZoomed: () => zoomed,
    timers: clock.timers,
  });
}

const kinds = () => actions.map((a) => (a.type === "button" ? `${a.button}-${a.down ? "down" : "up"}` : a.type));

beforeEach(() => {
  actions = [];
  zoomed = false;
  clock = fakeTimers();
});

describe("trackpad", () => {
  it("tap is a left click", () => {
    const g = make("trackpad");
    g.down([{ id: 1, x: 100, y: 100 }]);
    clock.advance(80);
    g.up([1]);
    expect(kinds()).toEqual(["left-down", "left-up"]);
  });

  it("a slow press without moving does nothing", () => {
    const g = make("trackpad");
    g.down([{ id: 1, x: 100, y: 100 }]);
    clock.advance(700);
    g.up([1]);
    expect(actions).toEqual([]);
  });

  it("sliding one finger moves the cursor by the finger's travel, no click", () => {
    const g = make("trackpad");
    g.down([{ id: 1, x: 100, y: 100 }]);
    g.move([{ id: 1, x: 130, y: 100 }]);
    g.move([{ id: 1, x: 140, y: 110 }]);
    g.up([1]);
    expect(actions).toEqual([
      { type: "cursor-by", dx: 30, dy: 0 },
      { type: "cursor-by", dx: 10, dy: 10 },
    ]);
  });

  it("small jitter under the slop still counts as a tap", () => {
    const g = make("trackpad");
    g.down([{ id: 1, x: 100, y: 100 }]);
    g.move([{ id: 1, x: 104, y: 103 }]);
    g.up([1]);
    expect(kinds()).toEqual(["left-down", "left-up"]);
  });

  it("two-finger tap is a right click", () => {
    const g = make("trackpad");
    g.down([{ id: 1, x: 100, y: 100 }]);
    g.down([{ id: 2, x: 160, y: 100 }]);
    clock.advance(100);
    g.up([1, 2]);
    expect(kinds()).toEqual(["right-down", "right-up"]);
  });

  it("tap, then touch again and drag, holds the left button through the drag", () => {
    const g = make("trackpad");
    g.down([{ id: 1, x: 100, y: 100 }]);
    clock.advance(60);
    g.up([1]);
    clock.advance(120);
    g.down([{ id: 2, x: 104, y: 102 }]);
    clock.advance(DRAG_DELAY_MS);
    g.move([{ id: 2, x: 150, y: 102 }]);
    g.move([{ id: 2, x: 170, y: 102 }]);
    g.up([2]);
    expect(kinds()).toEqual([
      "left-down",
      "left-up",
      "left-down",
      "cursor-by",
      "cursor-by",
      "left-up",
    ]);
  });

  it("two quick taps are a double click", () => {
    const g = make("trackpad");
    g.down([{ id: 1, x: 100, y: 100 }]);
    g.up([1]);
    clock.advance(100);
    g.down([{ id: 2, x: 100, y: 100 }]);
    g.up([2]);
    expect(kinds()).toEqual(["left-down", "left-up", "left-down", "left-up"]);
  });

  it("a touch long after a tap moves the cursor, it doesn't drag", () => {
    const g = make("trackpad");
    g.down([{ id: 1, x: 100, y: 100 }]);
    g.up([1]);
    clock.advance(800);
    g.down([{ id: 2, x: 100, y: 100 }]);
    g.move([{ id: 2, x: 160, y: 100 }]);
    g.up([2]);
    expect(kinds()).toEqual(["left-down", "left-up", "cursor-by"]);
  });

  it("two fingers sliding scroll — fingers up scroll down, one tick per step", () => {
    const g = make("trackpad");
    g.down([{ id: 1, x: 100, y: 300 }]);
    g.down([{ id: 2, x: 160, y: 300 }]);
    g.move([
      { id: 1, x: 100, y: 300 - SCROLL_STEP_PX * 2 - 5 },
      { id: 2, x: 160, y: 300 - SCROLL_STEP_PX * 2 - 5 },
    ]);
    g.up([1, 2]);
    expect(actions).toEqual([
      { type: "wheel", direction: "down" },
      { type: "wheel", direction: "down" },
    ]);
  });

  it("a pinch zooms and never clicks, even when the fingers lift quickly", () => {
    const g = make("trackpad");
    g.down([{ id: 1, x: 100, y: 100 }]);
    g.down([{ id: 2, x: 200, y: 100 }]);
    g.move([
      { id: 1, x: 70, y: 100 },
      { id: 2, x: 230, y: 100 },
    ]);
    g.up([1, 2]);
    expect(kinds()).toEqual(["zoom"]);
    const z = actions[0] as Extract<GestureAction, { type: "zoom" }>;
    expect(z.factor).toBeCloseTo(160 / 100);
    expect(z.cx).toBe(150);
  });

  it("once pinching, sliding both fingers moves the view rather than scrolling", () => {
    const g = make("trackpad");
    g.down([{ id: 1, x: 100, y: 100 }]);
    g.down([{ id: 2, x: 200, y: 100 }]);
    g.move([
      { id: 1, x: 70, y: 100 },
      { id: 2, x: 230, y: 100 },
    ]);
    actions = [];
    g.move([
      { id: 1, x: 70, y: 160 },
      { id: 2, x: 230, y: 160 },
    ]);
    expect(kinds()).toEqual(["pan", "zoom"]);
    expect(actions[0]).toEqual({ type: "pan", dx: 0, dy: 60 });
  });

  it("two fingers landing in the same instant still make a two-finger tap", () => {
    const g = make("trackpad");
    g.down([
      { id: 1, x: 100, y: 100 },
      { id: 2, x: 160, y: 100 },
    ]);
    g.up([1, 2]);
    expect(kinds()).toEqual(["right-down", "right-up"]);
  });

  it("a third finger abandons a two-finger gesture without clicking", () => {
    const g = make("trackpad");
    g.down([{ id: 1, x: 100, y: 100 }]);
    g.down([{ id: 2, x: 160, y: 100 }]);
    g.down([{ id: 3, x: 220, y: 100 }]);
    g.up([1, 2, 3]);
    expect(actions).toEqual([]);
  });

  it("a second finger during a drag is ignored and the drag still releases", () => {
    const g = make("trackpad");
    g.down([{ id: 1, x: 100, y: 100 }]);
    g.up([1]);
    g.down([{ id: 2, x: 100, y: 100 }]);
    clock.advance(DRAG_DELAY_MS);
    g.move([{ id: 2, x: 150, y: 100 }]);
    g.down([{ id: 3, x: 300, y: 300 }]);
    g.up([2]);
    g.up([3]);
    expect(kinds()).toEqual(["left-down", "left-up", "left-down", "cursor-by", "left-up"]);
  });

  it("cancel releases a held button", () => {
    const g = make("trackpad");
    g.down([{ id: 1, x: 100, y: 100 }]);
    g.up([1]);
    g.down([{ id: 2, x: 100, y: 100 }]);
    clock.advance(DRAG_DELAY_MS);
    g.move([{ id: 2, x: 150, y: 100 }]);
    g.cancel();
    expect(kinds().at(-1)).toBe("left-up");
    expect(g.stateKind).toBe("idle");
  });
});

describe("direct", () => {
  it("tap clicks where the finger is", () => {
    const g = make("direct");
    g.down([{ id: 1, x: 300, y: 200 }]);
    g.up([1]);
    expect(actions).toEqual([
      { type: "cursor-to", x: 300, y: 200 },
      { type: "button", button: "left", down: true },
      { type: "button", button: "left", down: false },
    ]);
  });

  it("press and hold is a right click, and lifting afterwards adds nothing", () => {
    const g = make("direct");
    g.down([{ id: 1, x: 300, y: 200 }]);
    clock.advance(HOLD_MS);
    g.up([1]);
    expect(actions).toEqual([
      { type: "cursor-to", x: 300, y: 200 },
      { type: "button", button: "right", down: true },
      { type: "button", button: "right", down: false },
    ]);
  });

  it("one-finger drag presses at the start point and releases at the end", () => {
    const g = make("direct");
    g.down([{ id: 1, x: 300, y: 200 }]);
    clock.advance(DRAG_DELAY_MS);
    g.move([{ id: 1, x: 340, y: 200 }]);
    clock.advance(HOLD_MS * 2); // no right click once moving
    g.move([{ id: 1, x: 360, y: 220 }]);
    g.up([1]);
    expect(actions).toEqual([
      { type: "cursor-to", x: 300, y: 200 },
      { type: "button", button: "left", down: true },
      { type: "cursor-to", x: 340, y: 200 },
      { type: "cursor-to", x: 360, y: 220 },
      { type: "button", button: "left", down: false },
    ]);
  });

  it("two-finger tap does nothing", () => {
    const g = make("direct");
    g.down([{ id: 1, x: 100, y: 100 }]);
    g.down([{ id: 2, x: 160, y: 100 }]);
    g.up([1, 2]);
    expect(actions).toEqual([]);
  });

  it("two fingers scroll when not zoomed", () => {
    const g = make("direct");
    g.down([{ id: 1, x: 100, y: 100 }]);
    g.down([{ id: 2, x: 160, y: 100 }]);
    g.move([
      { id: 1, x: 100, y: 100 + SCROLL_STEP_PX + 1 },
      { id: 2, x: 160, y: 100 + SCROLL_STEP_PX + 1 },
    ]);
    // The cursor goes under the fingers first, so what's there scrolls.
    expect(actions).toEqual([
      { type: "cursor-to", x: 130, y: 100 + SCROLL_STEP_PX + 1 },
      { type: "wheel", direction: "up" },
    ]);
  });

  it("a finger moving before the second lands is a pinch, not a drag", () => {
    const g = make("direct");
    g.down([{ id: 1, x: 300, y: 200 }]);
    clock.advance(30);
    g.move([{ id: 1, x: 320, y: 200 }]);
    g.down([{ id: 2, x: 400, y: 200 }]);
    g.move([
      { id: 1, x: 280, y: 200 },
      { id: 2, x: 440, y: 200 },
    ]);
    g.up([1, 2]);
    expect(kinds()).toContain("zoom");
    expect(kinds()).not.toContain("left-down");
  });

  it("touches starting off the picture never click, hold or drag", () => {
    const g = new GestureRecognizer({
      mode: "direct",
      emit: (a) => actions.push(a),
      isZoomed: () => false,
      isOnPicture: (_x, y) => y < 500,
      timers: clock.timers,
    });
    g.down([{ id: 1, x: 100, y: 600 }]);
    g.up([1]);
    g.down([{ id: 2, x: 100, y: 600 }]);
    clock.advance(HOLD_MS * 2);
    g.up([2]);
    g.down([{ id: 3, x: 100, y: 600 }]);
    clock.advance(DRAG_DELAY_MS);
    g.move([{ id: 3, x: 100, y: 400 }]);
    g.up([3]);
    expect(actions).toEqual([]);
  });

  it("two fingers move the view when zoomed in", () => {
    zoomed = true;
    const g = make("direct");
    g.down([{ id: 1, x: 100, y: 100 }]);
    g.down([{ id: 2, x: 160, y: 100 }]);
    g.move([
      { id: 1, x: 140, y: 100 },
      { id: 2, x: 200, y: 100 },
    ]);
    expect(actions).toEqual([{ type: "pan", dx: 40, dy: 0 }]);
  });

  it("a second finger before the hold cancels the right click", () => {
    const g = make("direct");
    g.down([{ id: 1, x: 100, y: 100 }]);
    g.down([{ id: 2, x: 160, y: 100 }]);
    clock.advance(HOLD_MS * 2);
    g.up([1, 2]);
    expect(actions).toEqual([]);
  });
});

describe("scroll-only (telnet)", () => {
  it("one finger sliding scrolls; taps and pinches do nothing", () => {
    const g = make("scroll-only");
    g.down([{ id: 1, x: 100, y: 300 }]);
    g.move([{ id: 1, x: 100, y: 300 - SCROLL_STEP_PX - 15 }]);
    g.up([1]);
    g.down([{ id: 2, x: 100, y: 100 }]);
    g.up([2]);
    g.down([{ id: 3, x: 100, y: 100 }]);
    g.down([{ id: 4, x: 200, y: 100 }]);
    g.move([
      { id: 3, x: 50, y: 100 },
      { id: 4, x: 250, y: 100 },
    ]);
    g.up([3, 4]);
    expect(actions).toEqual([{ type: "wheel", direction: "down" }]);
  });
});
