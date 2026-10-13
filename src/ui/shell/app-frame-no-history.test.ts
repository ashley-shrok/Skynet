import { describe, it, expect, vi } from "vitest";

import { keepFrameOutOfSessionHistory } from "./app-frame-no-history";

const ctx = { tabId: "t1", hostId: 1, slug: "todo" };

// Stand-in frame window: real EventTargets for the window and its navigation
// object, a history whose push/replace are spies, and a location.replace spy.
function makeWin(withNavigationApi = true) {
  const pushState = vi.fn();
  const replaceState = vi.fn();
  const winTarget = new EventTarget();
  const navTarget = new EventTarget();
  const win = {
    history: { pushState, replaceState } as unknown as History,
    location: { replace: vi.fn() } as unknown as Location,
    document,
    navigation: withNavigationApi
      ? {
          addEventListener: (t: string, cb: (e: Event) => void) => navTarget.addEventListener(t, cb),
          removeEventListener: (t: string, cb: (e: Event) => void) =>
            navTarget.removeEventListener(t, cb),
        }
      : undefined,
    addEventListener: (t: string, cb: (e: Event) => void) => winTarget.addEventListener(t, cb),
    removeEventListener: (t: string, cb: (e: Event) => void) =>
      winTarget.removeEventListener(t, cb),
  };
  return { win, pushState, replaceState, navTarget, winTarget };
}

function navigateEvent(fields: Record<string, unknown>) {
  const e = new Event("navigate", { cancelable: true });
  Object.assign(e, fields);
  return e;
}

describe("keepFrameOutOfSessionHistory: pushState", () => {
  it("app pushState becomes replaceState and is reported as a push", () => {
    const { win, pushState, replaceState } = makeWin();
    const onPush = vi.fn();
    keepFrameOutOfSessionHistory(win, onPush, ctx);
    win.history.pushState({ a: 1 }, "", "/apps/1/todo/pane/item/2");
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith({ a: 1 }, "", "/apps/1/todo/pane/item/2");
    expect(onPush).toHaveBeenCalledTimes(1);
  });

  it("cleanup restores the original pushState", () => {
    const { win, pushState } = makeWin();
    const release = keepFrameOutOfSessionHistory(win, vi.fn(), ctx);
    release();
    expect(win.history.pushState).toBe(pushState);
  });
});

describe("keepFrameOutOfSessionHistory: Navigation API", () => {
  it("a pushed page load is cancelled and re-issued as a replace", () => {
    const { win, navTarget } = makeWin();
    const onPush = vi.fn();
    keepFrameOutOfSessionHistory(win, onPush, ctx);
    const e = navigateEvent({
      navigationType: "push",
      hashChange: false,
      destination: { url: "https://x/apps/1/todo/pane/b", sameDocument: false },
    });
    navTarget.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(win.location.replace).toHaveBeenCalledWith("https://x/apps/1/todo/pane/b");
    expect(onPush).toHaveBeenCalledTimes(1);
  });

  it("a pushed fragment jump is re-issued as a replace", () => {
    const { win, navTarget } = makeWin();
    keepFrameOutOfSessionHistory(win, vi.fn(), ctx);
    const e = navigateEvent({
      navigationType: "push",
      hashChange: true,
      destination: { url: "https://x/apps/1/todo/pane/#s2", sameDocument: true },
    });
    navTarget.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(win.location.replace).toHaveBeenCalledWith("https://x/apps/1/todo/pane/#s2");
  });

  it.each([
    ["a replace", { navigationType: "replace" }],
    ["a reload", { navigationType: "reload" }],
    ["a traverse", { navigationType: "traverse" }],
    ["a form post", { navigationType: "push", formData: new FormData() }],
    ["a download", { navigationType: "push", downloadRequest: "f.csv" }],
    ["an unpatched same-document pushState", { navigationType: "push", hashChange: false }],
  ])("%s is left alone", (_label, fields) => {
    const { win, navTarget } = makeWin();
    const onPush = vi.fn();
    keepFrameOutOfSessionHistory(win, onPush, ctx);
    const e = navigateEvent({
      hashChange: false,
      destination: {
        url: "https://x/apps/1/todo/pane/b",
        sameDocument: _label.includes("same-document"),
      },
      ...fields,
    });
    navTarget.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(win.location.replace).not.toHaveBeenCalled();
    expect(onPush).not.toHaveBeenCalled();
  });

  it("cleanup stops converting", () => {
    const { win, navTarget } = makeWin();
    keepFrameOutOfSessionHistory(win, vi.fn(), ctx)();
    const e = navigateEvent({
      navigationType: "push",
      destination: { url: "https://x/b", sameDocument: false },
    });
    navTarget.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe("keepFrameOutOfSessionHistory: link-click fallback (no Navigation API)", () => {
  function clickOn(winTarget: EventTarget, anchor: HTMLAnchorElement, init: MouseEventInit = {}) {
    document.body.appendChild(anchor);
    const e = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
    Object.defineProperty(e, "target", { value: anchor });
    winTarget.dispatchEvent(e);
    anchor.remove();
    return e;
  }
  function link(href: string, attrs: Record<string, string> = {}) {
    const a = document.createElement("a");
    a.href = href;
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
    return a;
  }

  it("a plain same-frame link loads with replace", () => {
    const { win, winTarget } = makeWin(false);
    const onPush = vi.fn();
    keepFrameOutOfSessionHistory(win, onPush, ctx);
    const e = clickOn(winTarget, link("https://x/apps/1/todo/pane/b"));
    expect(e.defaultPrevented).toBe(true);
    expect(win.location.replace).toHaveBeenCalledWith("https://x/apps/1/todo/pane/b");
    expect(onPush).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["new-tab target", link("https://x/b", { target: "_blank" }), {}],
    ["download link", link("https://x/f.csv", { download: "" }), {}],
    ["mailto link", link("mailto:a@b.c"), {}],
    ["modifier click", link("https://x/b"), { metaKey: true }],
  ])("%s is left alone", (_label, anchor, init) => {
    const { win, winTarget } = makeWin(false);
    keepFrameOutOfSessionHistory(win, vi.fn(), ctx);
    const e = clickOn(winTarget, anchor, init);
    expect(e.defaultPrevented).toBe(false);
    expect(win.location.replace).not.toHaveBeenCalled();
  });

  it("a click the app already handled is left alone", () => {
    const { win, winTarget } = makeWin(false);
    keepFrameOutOfSessionHistory(win, vi.fn(), ctx);
    const a = link("https://x/b");
    document.body.appendChild(a);
    const e = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(e, "target", { value: a });
    e.preventDefault();
    winTarget.dispatchEvent(e);
    a.remove();
    expect(win.location.replace).not.toHaveBeenCalled();
  });
});
