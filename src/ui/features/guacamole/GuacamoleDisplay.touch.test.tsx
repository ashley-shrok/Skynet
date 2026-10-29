// In-process: a remote desktop on a touch screen, driven by synthetic
// touches through the real display, gesture recognizer, view and phone
// keyboard, down to the mouse and key messages the (fake) client sends.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act, cleanup, screen } from "@testing-library/react";
import { createRef } from "react";

type FakeDisplay = {
  getElement: () => HTMLElement;
  getWidth: () => number;
  getHeight: () => number;
  scale: ReturnType<typeof vi.fn>;
  onresize: (() => void) | null;
};
type FakeClient = {
  getDisplay: () => FakeDisplay;
  sendSize: ReturnType<typeof vi.fn>;
  sendMouseState: ReturnType<typeof vi.fn>;
  sendKeyEvent: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onstatechange: ((s: number) => void) | null;
  onerror: unknown;
  onclipboard: unknown;
  onaudio: unknown;
  onfile: unknown;
};
const clients: FakeClient[] = [];

vi.mock("guacamole-common-js", () => {
  class Client {
    constructor() {
      const el = document.createElement("div");
      const display: FakeDisplay = {
        getElement: () => el,
        getWidth: () => 1280,
        getHeight: () => 800,
        scale: vi.fn(),
        onresize: null,
      };
      const c: FakeClient = {
        getDisplay: () => display,
        sendSize: vi.fn(),
        sendMouseState: vi.fn(),
        sendKeyEvent: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        onstatechange: null,
        onerror: null,
        onclipboard: null,
        onaudio: null,
        onfile: null,
      };
      clients.push(c);
      return c;
    }
  }
  class Noop {
    onmousedown = null;
    onmouseup = null;
    onmousemove = null;
    onkeydown = null;
    onkeyup = null;
    reset() {}
  }
  class State {
    constructor(...args: unknown[]) {
      Object.assign(this, { args });
    }
  }
  return {
    default: {
      Client,
      WebSocketTunnel: class {},
      Mouse: Object.assign(class extends Noop {}, { State }),
      Keyboard: Noop,
    },
  };
});
vi.mock("@/main-axios.ts", () => ({ getGuacamoleToken: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/SimpleLoader.tsx", () => ({ SimpleLoader: () => null }));
let touchDevice = true;
vi.mock("@/hooks/use-is-touch-device", () => ({ useIsTouchDevice: () => touchDevice }));

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

import { GuacamoleDisplay, type GuacamoleDisplayHandle } from "./GuacamoleDisplay";
import { TOUCH_MODE_STORAGE_KEY } from "./touch/touch-mode";
import { SENTINEL } from "./touch/phone-keyboard";
import type { ViewState } from "./touch/viewport";

// 1280×800 desktop in a 1120×700 box: fitted scale 0.875, picture fills the box.
beforeEach(() => {
  clients.length = 0;
  touchDevice = true;
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("innerWidth", 4000);
  vi.stubGlobal("innerHeight", 3000);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => 1120);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => 700);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ left: 0, top: 0, right: 1120, bottom: 700, width: 1120, height: 700 }) as DOMRect,
  );
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(
  props: Partial<React.ComponentProps<typeof GuacamoleDisplay>> & { protocol?: "vnc" | "rdp" | "telnet" } = {},
) {
  const { protocol = "vnc", ...rest } = props;
  const ref = createRef<GuacamoleDisplayHandle>();
  render(
    <GuacamoleDisplay
      ref={ref}
      isVisible
      fixedRemoteSize
      connectionConfig={{ token: "tok", protocol, width: 1280, height: 800 }}
      {...rest}
    />,
  );
  await waitFor(() => expect(clients).toHaveLength(1));
  const c = clients[0];
  act(() => c.getDisplay().onresize?.());
  return { c, ref, box: screen.getByTestId("guacamole-display") };
}

function touch(
  el: HTMLElement,
  type: string,
  pts: Array<[number, number, number]>,
  stillDown?: Array<[number, number, number]>,
) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const list = (p: Array<[number, number, number]>) =>
    p.map(([identifier, clientX, clientY]) => ({ identifier, clientX, clientY }));
  Object.defineProperty(e, "changedTouches", { value: list(pts) });
  if (stillDown) Object.defineProperty(e, "touches", { value: list(stillDown) });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

/** Mouse messages sent: [x, y, left, middle, right, up, down]. */
function mouse(c: FakeClient): unknown[][] {
  return c.sendMouseState.mock.calls.map(([s]) => (s as { args: unknown[] }).args);
}

describe("GuacamoleDisplay on a touch screen", () => {
  it("takes every touch: no page scroll or zoom, no swipe back to the list", async () => {
    const { box } = await mount();
    expect(box.style.touchAction).toBe("none");
    expect(box.hasAttribute("data-no-swipe-to-list")).toBe(true);
    const e = touch(box, "touchstart", [[1, 100, 100]]);
    expect(e.defaultPrevented).toBe(true);
  });

  it("trackpad: sliding moves the cursor from the middle, a tap clicks there", async () => {
    localStorage.setItem(TOUCH_MODE_STORAGE_KEY, "trackpad");
    const { c, box } = await mount();
    touch(box, "touchstart", [[1, 500, 500]]);
    // 87.5 screen px of finger travel = 100 remote px at scale 0.875.
    touch(box, "touchmove", [[1, 587.5, 500]]);
    touch(box, "touchend", [[1, 587.5, 500]]);
    touch(box, "touchstart", [[2, 300, 300]]);
    touch(box, "touchend", [[2, 300, 300]]);
    expect(mouse(c)).toEqual([
      [740, 400, false, false, false, false, false],
      [740, 400, true, false, false, false, false],
      [740, 400, false, false, false, false, false],
    ]);
  });

  it("trackpad: two-finger tap right-clicks; two fingers sliding scroll", async () => {
    localStorage.setItem(TOUCH_MODE_STORAGE_KEY, "trackpad");
    const { c, box } = await mount();
    touch(box, "touchstart", [[1, 400, 300], [2, 460, 300]]);
    touch(box, "touchend", [[1, 400, 300], [2, 460, 300]]);
    expect(mouse(c).map((m) => m[4])).toEqual([true, false]);
    c.sendMouseState.mockClear();
    touch(box, "touchstart", [[3, 400, 300], [4, 460, 300]]);
    touch(box, "touchmove", [[3, 400, 270], [4, 460, 270]]);
    touch(box, "touchend", [[3, 400, 270], [4, 460, 270]]);
    // One wheel-down tick: down pressed, then released.
    expect(mouse(c).map((m) => m[6])).toEqual([true, false]);
  });

  it("direct: a tap clicks the desktop spot under the finger", async () => {
    localStorage.setItem(TOUCH_MODE_STORAGE_KEY, "direct");
    const { c, box } = await mount();
    touch(box, "touchstart", [[1, 112, 70]]);
    touch(box, "touchend", [[1, 112, 70]]);
    expect(mouse(c)).toEqual([
      [128, 80, false, false, false, false, false],
      [128, 80, true, false, false, false, false],
      [128, 80, false, false, false, false, false],
    ]);
  });

  it("switching modes takes effect at once on an open desktop", async () => {
    localStorage.setItem(TOUCH_MODE_STORAGE_KEY, "trackpad");
    const { c, box } = await mount();
    const { setTouchMode } = await import("./touch/touch-mode");
    act(() => setTouchMode("direct"));
    touch(box, "touchstart", [[1, 112, 70]]);
    touch(box, "touchend", [[1, 112, 70]]);
    expect(mouse(c)[0].slice(0, 2)).toEqual([128, 80]);
  });

  it("pinch zooms the picture without clicking, and the zoom outlives a remount", async () => {
    const touchView = { current: { zoom: 1, tx: 0, ty: 0 } as ViewState };
    const { c, box } = await mount({ touchView });
    touch(box, "touchstart", [[1, 460, 350], [2, 660, 350]]);
    touch(box, "touchmove", [[1, 360, 350], [2, 760, 350]]);
    touch(box, "touchend", [[1, 360, 350], [2, 760, 350]]);
    expect(c.sendMouseState).not.toHaveBeenCalled();
    expect(touchView.current.zoom).toBeCloseTo(2);
    expect(c.getDisplay().scale).toHaveBeenLastCalledWith(1.75);

    cleanup();
    clients.length = 0;
    const again = await mount({ touchView });
    expect(again.c.getDisplay().scale).toHaveBeenLastCalledWith(1.75);
  });

  it("the keyboard button raises the phone keyboard; typing reaches the remote", async () => {
    const onPhoneTyped = vi.fn();
    const { c, ref } = await mount({ onPhoneTyped });
    act(() => ref.current!.toggleKeyboard());
    const field = screen.getByTestId("phone-keyboard-field") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    field.value = SENTINEL + "a";
    act(() => {
      field.dispatchEvent(new Event("input"));
    });
    expect(c.sendKeyEvent.mock.calls).toEqual([
      [1, 0x61],
      [0, 0x61],
    ]);
    expect(onPhoneTyped).toHaveBeenCalledTimes(1);
    act(() => ref.current!.toggleKeyboard());
    expect(document.activeElement).not.toBe(field);
  });

  it("telnet: a finger slide scrolls, taps don't click", async () => {
    localStorage.setItem(TOUCH_MODE_STORAGE_KEY, "trackpad");
    const { c, box } = await mount({ protocol: "telnet" });
    touch(box, "touchstart", [[1, 300, 300]]);
    touch(box, "touchend", [[1, 300, 300]]);
    expect(c.sendMouseState).not.toHaveBeenCalled();
    touch(box, "touchstart", [[2, 300, 300]]);
    touch(box, "touchmove", [[2, 300, 340]]);
    touch(box, "touchend", [[2, 300, 340]]);
    // Fingers down → scroll up (wheel-up pressed then released).
    expect(mouse(c).map((m) => m[5])).toEqual([true, false]);
  });

  it("a view-only desktop ignores touches and leaves the page its gestures", async () => {
    const { c, box } = await mount({ viewOnly: true });
    expect(box.style.touchAction).toBe("");
    expect(box.hasAttribute("data-no-swipe-to-list")).toBe(false);
    const e = touch(box, "touchstart", [[1, 100, 100]]);
    touch(box, "touchend", [[1, 100, 100]]);
    expect(e.defaultPrevented).toBe(false);
    expect(c.sendMouseState).not.toHaveBeenCalled();
    expect(screen.queryByTestId("phone-keyboard-field")).toBeNull();
  });

  it("with no touch screen nothing changes", async () => {
    touchDevice = false;
    const { box } = await mount();
    expect(box.style.touchAction).toBe("");
    expect(screen.queryByTestId("phone-keyboard-field")).toBeNull();
    expect(clients[0].getDisplay().scale).toHaveBeenLastCalledWith(0.875);
  });

  it("a finger whose lift never arrived doesn't turn the next tap into a right click", async () => {
    localStorage.setItem(TOUCH_MODE_STORAGE_KEY, "trackpad");
    const { c, box } = await mount();
    // Finger 1 lands; its end is lost.
    touch(box, "touchstart", [[1, 300, 300]], [[1, 300, 300]]);
    // Later, a fresh tap: the browser lists only finger 2.
    touch(box, "touchstart", [[2, 300, 300]], [[2, 300, 300]]);
    touch(box, "touchend", [[2, 300, 300]], []);
    expect(mouse(c).map((m) => [m[2], m[4]])).toEqual([
      [true, false],
      [false, false],
    ]);
  });

  it("direct: a tap on the bars around the picture clicks nothing", async () => {
    localStorage.setItem(TOUCH_MODE_STORAGE_KEY, "direct");
    // A 1280×800 desktop in a 1120×1400 box: fitted to the width, bars above and below.
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(
      () => ({ left: 0, top: 0, right: 1120, bottom: 1400, width: 1120, height: 1400 }) as DOMRect,
    );
    const { c, box } = await mount();
    touch(box, "touchstart", [[1, 560, 1300]]);
    touch(box, "touchend", [[1, 560, 1300]]);
    expect(c.sendMouseState).not.toHaveBeenCalled();
    touch(box, "touchstart", [[2, 560, 700]]);
    touch(box, "touchend", [[2, 560, 700]]);
    expect(mouse(c)[0].slice(0, 2)).toEqual([640, 400]);
  });

  it("keys held through the handle are let go before disconnecting", async () => {
    const { c, ref } = await mount();
    act(() => ref.current!.sendKey(0xffe3, true));
    cleanup();
    expect(c.sendKeyEvent.mock.calls.at(-1)).toEqual([0, 0xffe3]);
    expect(c.disconnect).toHaveBeenCalled();
  });
});
