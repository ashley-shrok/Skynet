import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act, cleanup } from "@testing-library/react";

// Fake guacamole client: records size requests and display scaling.
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
  const Mouse = Object.assign(Noop, { State: class {} });
  return {
    default: {
      Client,
      WebSocketTunnel: class {},
      Mouse,
      Keyboard: Noop,
    },
  };
});
vi.mock("@/main-axios.ts", () => ({ getGuacamoleToken: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/SimpleLoader.tsx", () => ({ SimpleLoader: () => null }));

// Capture ResizeObserver callbacks so tests can fire a container resize.
const resizeCallbacks: (() => void)[] = [];
class FakeResizeObserver {
  constructor(cb: () => void) {
    resizeCallbacks.push(cb);
  }
  observe() {}
  disconnect() {}
}

import { GuacamoleDisplay } from "./GuacamoleDisplay";

// Container box: 1120×700 visible.
let boxW = 1120;
let boxH = 700;

beforeEach(() => {
  clients.length = 0;
  resizeCallbacks.length = 0;
  boxW = 1120;
  boxH = 700;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  // Big enough viewport that the visible-size clamp never bites.
  vi.stubGlobal("innerWidth", 4000);
  vi.stubGlobal("innerHeight", 3000);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => boxW,
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    () => boxH,
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({ left: 0, top: 0, right: boxW, bottom: boxH, width: boxW, height: boxH }) as DOMRect,
  );
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(props: { fixedRemoteSize?: boolean; viewOnly?: boolean }) {
  render(
    <GuacamoleDisplay
      isVisible
      connectionConfig={{ token: "tok", protocol: "vnc", width: 1280, height: 800 }}
      {...props}
    />,
  );
  await waitFor(() => expect(clients).toHaveLength(1));
  return clients[0];
}

describe("GuacamoleDisplay — remote screen size", () => {
  it("by default asks the remote to match the container on connect and on resize", async () => {
    const c = await mount({});
    act(() => c.onstatechange?.(3));
    expect(c.sendSize).toHaveBeenCalledWith(1120, 700);
    c.sendSize.mockClear();
    boxW = 900;
    boxH = 600;
    act(() => resizeCallbacks.forEach((cb) => cb()));
    await waitFor(() => expect(c.sendSize).toHaveBeenCalledWith(900, 600));
  });

  it("with fixedRemoteSize never asks the remote to resize — not on connect, not on resize, not in control", async () => {
    const c = await mount({ fixedRemoteSize: true, viewOnly: false });
    act(() => c.onstatechange?.(3));
    boxW = 600;
    boxH = 300;
    act(() => resizeCallbacks.forEach((cb) => cb()));
    await new Promise((r) => setTimeout(r, 300));
    expect(c.sendSize).not.toHaveBeenCalled();
  });

  it("with fixedRemoteSize rescales the picture to fit when the container resizes", async () => {
    const c = await mount({ fixedRemoteSize: true });
    const display = c.getDisplay();
    act(() => display.onresize?.());
    // 1280×800 into 1120×700 → 0.875 both ways.
    expect(display.scale).toHaveBeenLastCalledWith(0.875);

    // Modal grows: picture scales up to fill, remote untouched.
    boxW = 1600;
    boxH = 1200;
    act(() => resizeCallbacks.forEach((cb) => cb()));
    await waitFor(() => expect(display.scale).toHaveBeenLastCalledWith(1.25));
    expect(c.sendSize).not.toHaveBeenCalled();
  });
});
