/**
 * shape-app-pane-strip — the app bar on every open app pane.
 *
 * Covers: static title (tiles store → tab label → slug), back/forward driven
 * by the pane's own page list and loaded in place (never via shared browser
 * history), reload, whole-bar drag writing the shared badge payload (with an
 * app descriptor for cross-window drops), a press that starts on a button
 * never dragging, bar click selecting the pane, no drag on mobile, and
 * clearing the floating sidebar toggle. The page-list state machine itself is
 * covered in app-frame-history.test.ts.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

const mobileState = { isMobile: false };
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileState.isMobile,
}));

import { AppPane, sidebarToggleClearance } from "./AppPane";
import { publishAppSnapshot } from "@/state/app-tiles-store";

// Stand-in frame window: a location whose href the test drives, with
// replace/reload spies, and optionally a Navigation API stub that reports how
// the frame arrived and fires currententrychange for in-document changes.
function makeFakeFrame(initialHref: string, withNavigationApi = true) {
  const listeners = new Set<(e: Event) => void>();
  const frame = {
    location: {
      href: initialHref,
      replace: vi.fn((url: string) => {
        frame.location.href = url;
      }),
      reload: vi.fn(),
    },
    navigation: withNavigationApi
      ? {
          activation: { navigationType: "push" as string },
          addEventListener: (_t: string, cb: (e: Event) => void) => listeners.add(cb),
          removeEventListener: (_t: string, cb: (e: Event) => void) => listeners.delete(cb),
        }
      : undefined,
    fireEntryChange(type: string) {
      const e = new Event("currententrychange") as Event & { navigationType?: string };
      e.navigationType = type;
      listeners.forEach((l) => l(e));
    },
  };
  return frame;
}

function mountFrame(iframe: HTMLIFrameElement, frame: ReturnType<typeof makeFakeFrame>) {
  Object.defineProperty(iframe, "contentWindow", { value: frame, configurable: true });
  Object.defineProperty(iframe, "contentDocument", { value: null, configurable: true });
}

// A full-document load of `href` in the frame, arriving via `type`.
function loadFrame(
  iframe: HTMLIFrameElement,
  frame: ReturnType<typeof makeFakeFrame>,
  href: string,
  type = "push",
) {
  frame.location.href = href;
  if (frame.navigation) frame.navigation.activation = { navigationType: type };
  act(() => {
    iframe.dispatchEvent(new Event("load"));
  });
}

function makeDataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (t: string, v: string) => store.set(t, v),
    getData: (t: string) => store.get(t) ?? "",
    effectAllowed: "none",
    get types() {
      return Array.from(store.keys());
    },
  };
}

beforeEach(() => {
  mobileState.isMobile = false;
  publishAppSnapshot([]);
});
afterEach(() => {
  cleanup();
});

describe("sidebarToggleClearance", () => {
  const bar = { left: 266, top: 0, bottom: 40 };
  it("no toggle → 0", () => {
    expect(sidebarToggleClearance(bar, null)).toBe(0);
  });
  it("toggle over the bar's left end → shift past it", () => {
    const toggle = { left: 266, right: 298, top: 8, bottom: 40, width: 32 };
    expect(sidebarToggleClearance(bar, toggle)).toBe(38);
  });
  it("toggle elsewhere (bar is a right-hand split pane) → 0", () => {
    const toggle = { left: 266, right: 298, top: 8, bottom: 40, width: 32 };
    expect(sidebarToggleClearance({ left: 700, top: 0, bottom: 40 }, toggle)).toBe(0);
  });
  it("touch back button sits lower, over the app rather than the bar → 0", () => {
    const toggle = { left: 266, right: 330, top: 36, bottom: 100, width: 64 };
    expect(sidebarToggleClearance(bar, toggle)).toBe(0);
  });
  it("hidden toggle (zero width) → 0", () => {
    const toggle = { left: 0, right: 0, top: 0, bottom: 0, width: 0 };
    expect(sidebarToggleClearance(bar, toggle)).toBe(0);
  });
});

describe("AppPane bar", () => {
  it("renders the bar above the iframe", () => {
    const { getByTestId, container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const bar = getByTestId("app-pane-bar");
    const iframe = container.querySelector("iframe")!;
    expect(bar.compareDocumentPosition(iframe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("title comes from the tiles store's static title", () => {
    publishAppSnapshot([
      {
        hostId: "1",
        slug: "todo",
        title: "Todo List",
        description: "",
        port: 1,
        hasIcon: false,
        createdAtMs: 0,
        isHealthy: true,
        healthMessage: null,
      },
    ]);
    const { getByTestId } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} label="ignored" />,
    );
    expect(getByTestId("app-pane-title").textContent).toContain("Todo List");
  });

  it("title falls back to the tab label, then the slug", () => {
    const a = render(<AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} label="My Todo" />);
    expect(a.getByTestId("app-pane-title").textContent).toContain("My Todo");
    cleanup();
    const b = render(<AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />);
    expect(b.getByTestId("app-pane-title").textContent).toContain("todo");
  });

  it("back/forward greyed before any navigation; reload always enabled", () => {
    const { getByTestId } = render(<AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />);
    expect((getByTestId("app-pane-back") as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId("app-pane-forward") as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId("app-pane-reload") as HTMLButtonElement).disabled).toBe(false);
  });

  it("navigating inside the app enables back; back loads the previous page in place", () => {
    const { getByTestId, container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe")!;
    const frame = makeFakeFrame("https://x/apps/1/todo/pane/");
    mountFrame(iframe, frame);
    loadFrame(iframe, frame, "https://x/apps/1/todo/pane/");
    const back = getByTestId("app-pane-back") as HTMLButtonElement;
    const forward = getByTestId("app-pane-forward") as HTMLButtonElement;
    expect(back.disabled).toBe(true);

    loadFrame(iframe, frame, "https://x/apps/1/todo/pane/list");
    expect(back.disabled).toBe(false);

    fireEvent.click(back);
    // Loaded in place — never a shared-history traversal.
    expect(frame.location.replace).toHaveBeenCalledWith("https://x/apps/1/todo/pane/");
    loadFrame(iframe, frame, "https://x/apps/1/todo/pane/", "replace");
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(false);

    fireEvent.click(forward);
    expect(frame.location.replace).toHaveBeenLastCalledWith("https://x/apps/1/todo/pane/list");
    loadFrame(iframe, frame, "https://x/apps/1/todo/pane/list", "replace");
    expect(back.disabled).toBe(false);
    expect(forward.disabled).toBe(true);
  });

  it("in-document page changes (pushState) reach the page list", () => {
    const { getByTestId, container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe")!;
    const frame = makeFakeFrame("https://x/a");
    mountFrame(iframe, frame);
    loadFrame(iframe, frame, "https://x/a");
    frame.location.href = "https://x/a#settings";
    act(() => frame.fireEntryChange("push"));
    expect((getByTestId("app-pane-back") as HTMLButtonElement).disabled).toBe(false);
  });

  it("without the Navigation API, full page loads still build the list", () => {
    const { getByTestId, container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe")!;
    const frame = makeFakeFrame("https://x/a", false);
    mountFrame(iframe, frame);
    loadFrame(iframe, frame, "https://x/a");
    loadFrame(iframe, frame, "https://x/b");
    expect((getByTestId("app-pane-back") as HTMLButtonElement).disabled).toBe(false);
  });

  it("back is refused at the first page the pane showed, even if forced", () => {
    const { getByTestId, container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe")!;
    const frame = makeFakeFrame("https://x/a");
    mountFrame(iframe, frame);
    loadFrame(iframe, frame, "https://x/a");
    const back = getByTestId("app-pane-back") as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    back.disabled = false;
    fireEvent.click(back);
    expect(frame.location.replace).not.toHaveBeenCalled();
  });

  it("reload reloads the frame's current page", () => {
    const { getByTestId, container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe")!;
    const frame = makeFakeFrame("https://x/a");
    mountFrame(iframe, frame);
    fireEvent.click(getByTestId("app-pane-reload"));
    expect(frame.location.reload).toHaveBeenCalledTimes(1);
  });

  it("whole bar drags with the shared badge payload + an app descriptor", () => {
    publishAppSnapshot([
      {
        hostId: "3",
        slug: "todo",
        title: "Todo",
        description: "",
        port: 1,
        hasIcon: false,
        createdAtMs: 0,
        isHealthy: true,
        healthMessage: null,
      },
    ]);
    const { getByTestId } = render(<AppPane hostId={3} slug="todo" tabId="tab-9" isVisible={true} />);
    const bar = getByTestId("app-pane-bar");
    expect(bar.getAttribute("draggable")).toBe("true");
    const dt = makeDataTransfer();
    fireEvent.dragStart(bar, { dataTransfer: dt });
    expect(dt.getData("text/plain")).toBe("tab-9");
    const payload = JSON.parse(dt.getData("application/x-skynet-badge"));
    expect(payload.tabId).toBe("tab-9");
    expect(typeof payload.dragId).toBe("string");
    expect(payload.hostId).toBe(3);
    expect(payload.descriptor).toEqual({
      tabType: "app",
      app: { hostId: 3, slug: "todo" },
      label: "Todo",
    });
    expect(dt.effectAllowed).toBe("move");
  });

  it("a press that starts on a button never drags the pane (dragstart fires on the bar)", () => {
    const { getByTestId } = render(<AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />);
    const bar = getByTestId("app-pane-bar");
    const reload = getByTestId("app-pane-reload");
    expect(reload.getAttribute("draggable")).toBe("false");
    // Real browsers dispatch dragstart at the draggable ancestor, not the
    // button the press began on.
    fireEvent.pointerDown(reload);
    const dt = makeDataTransfer();
    const notCancelled = fireEvent.dragStart(bar, { dataTransfer: dt });
    expect(notCancelled).toBe(false);
    expect(dt.types).toEqual([]);
  });

  it("a press on the bar's empty area drags normally after a button press", () => {
    const { getByTestId } = render(<AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />);
    const bar = getByTestId("app-pane-bar");
    fireEvent.pointerDown(getByTestId("app-pane-reload"));
    fireEvent.pointerDown(bar);
    const dt = makeDataTransfer();
    fireEvent.dragStart(bar, { dataTransfer: dt });
    expect(dt.getData("text/plain")).toBe("t1");
  });

  it("clicking the bar selects the pane", () => {
    const onSelectPane = vi.fn();
    const { getByTestId } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} onSelectPane={onSelectPane} />,
    );
    fireEvent.click(getByTestId("app-pane-bar"));
    expect(onSelectPane).toHaveBeenCalledWith("t1");
  });

  it("not draggable on mobile, but the buttons still show", () => {
    mobileState.isMobile = true;
    const { getByTestId } = render(<AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />);
    expect(getByTestId("app-pane-bar").getAttribute("draggable")).toBe("false");
    expect(getByTestId("app-pane-back")).toBeTruthy();
    expect(getByTestId("app-pane-reload")).toBeTruthy();
  });
});
