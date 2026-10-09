/**
 * Phase 120 Plan 06 Task 1 — AppPane iframe wrapper tests.
 *
 * The AppPane is a single-purpose iframe wrapper that mounts inside the
 * pane's leaf renderer for tab.type === "app" (see D-05). It renders the
 * live authenticated web view of an app running on its home box, served
 * under Skynet's own primary origin via the /apps/:hostId/:slug/pane/*
 * reverse-proxy path (Plan 05).
 *
 * Attribute discipline (D-05 + D-20):
 *   - `src` uses encodeURIComponent on BOTH hostId and slug (defensive,
 *     mirrors AppTile.tsx MEDIUM-1 fix pattern).
 *   - NO `sandbox` attribute — the app is fully trusted at the pane level
 *     (same origin, same auth); sandboxing would break the app's own
 *     JavaScript, forms, and cookies.
 *   - `referrerPolicy="no-referrer"` — D-20 discipline: the pane sends NO
 *     signal to the app about which Skynet page opened it.
 *   - `loading="eager"` — the pane is visible immediately on tab open;
 *     lazy would defer first paint unnecessarily.
 *   - `className="h-full w-full border-0 bg-white scheme-light"` — fills the leaf; the iframe IS
 *     the entire in-pane view; Skynet draws no chrome around it.
 *   - `title={`App ${slug}`}` — accessibility affordance; iframes need a
 *     title. Reflects the slug (NOT the app's live document.title per D-19).
 *   - `data-*` attributes for downstream test/debug identification.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { AppPane, injectDarkViewerStylesheetIfApplicable } from "./AppPane";
import { DRAG_PREVIEW_WATCHDOG_MS } from "./drag-preview-session";

// Map-backed DataTransfer stub. Mirrors the shape used in
// SplitView.text-selection-drag.test.tsx so the type-gate check
// (hasSkynetDragPayload) sees the correct `types` array.
function makeDataTransferStub(entries: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(entries));
  return {
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string): string => store.get(type) ?? "",
    effectAllowed: "none" as string,
    get types(): string[] {
      return Array.from(store.keys());
    },
  };
}

function fireWindowDragEvent(
  type: "dragstart" | "dragend" | "drop" | "dragover",
  dataTransfer: ReturnType<typeof makeDataTransferStub> | null,
) {
  // jsdom does not implement DragEvent; a plain Event with a monkey-patched
  // dataTransfer property is what the listener actually reads.
  const evt = new Event(type, { bubbles: true }) as Event & {
    dataTransfer?: unknown;
  };
  evt.dataTransfer = dataTransfer;
  window.dispatchEvent(evt);
}

describe("AppPane iframe wrapper (Phase 120 D-05)", () => {
  it("Test 1: renders exactly one <iframe> element", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframes = container.querySelectorAll("iframe");
    expect(iframes.length).toBe(1);
  });

  it("Test 2: iframe src is /apps/1/todo/pane/ (safe inputs)", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe("/apps/1/todo/pane/");
  });

  it("Test 3: slug with space is URL-encoded (T-120-32 mitigation)", () => {
    const { container } = render(
      <AppPane hostId={5} slug="my app" tabId="t2" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe("/apps/5/my%20app/pane/");
  });

  it("Test 4: slug with forward-slash is URL-encoded (T-120-32 mitigation)", () => {
    const { container } = render(
      <AppPane hostId={5} slug="a/b" tabId="t2" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    // "a/b" → "a%2Fb" — cannot break out of the URL path segment.
    expect(iframe?.getAttribute("src")).toBe("/apps/5/a%2Fb/pane/");
  });

  it("Test 5: iframe has NO sandbox attribute (D-05 anti-pattern)", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    // Sandbox intentionally unset — app is same-origin + trusted at pane level.
    expect(iframe?.getAttribute("sandbox")).toBeNull();
  });

  it("Test 6: iframe has referrerPolicy='no-referrer' (D-20)", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    // D-20 — pane sends NO signal to the app.
    expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("Test 7: iframe has loading='eager'", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("loading")).toBe("eager");
  });

  it("Test 8: iframe title reflects the slug", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("title")).toBe("App todo");
  });

  it("Test 9: iframe has data-* identification attributes", () => {
    const { container } = render(
      <AppPane hostId={7} slug="notes" tabId="tab-xyz" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("data-app-hostid")).toBe("7");
    expect(iframe?.getAttribute("data-app-slug")).toBe("notes");
    expect(iframe?.getAttribute("data-tab-id")).toBe("tab-xyz");
  });

  it("Test 10: iframe has className 'h-full w-full border-0 bg-white scheme-light'", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("class")).toBe("h-full w-full border-0 bg-white scheme-light");
  });
});

// ─── Iframe drag-passthrough (2026-09-21) ──────────────────────────────────
// Drag events fire inside the iframe's own document, so Pane-level dragover
// listeners at SplitView.tsx:355 never see them. AppPane sets the iframe's
// pointer-events to "none" while a Skynet drag is in flight; dragend/drop
// restore. Non-Skynet drags (browser text selection, OS file drags) leave
// the iframe interactive.
describe("AppPane drag-passthrough", () => {
  afterEach(() => cleanup());

  const skynetMimes = [
    "application/x-skynet-badge",
    "application/x-skynet-row",
    "application/x-skynet-app-tile",
  ] as const;

  for (const mime of skynetMimes) {
    it(`dragstart carrying ${mime} sets iframe pointer-events to 'none'`, () => {
      const { container } = render(
        <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
      );
      const iframe = container.querySelector("iframe") as HTMLIFrameElement;
      expect(iframe.style.pointerEvents).toBe("");
      fireWindowDragEvent("dragstart", makeDataTransferStub({ [mime]: "x" }));
      expect(iframe.style.pointerEvents).toBe("none");
    });
  }

  it("dragend restores iframe pointer-events after a Skynet drag", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    fireWindowDragEvent(
      "dragstart",
      makeDataTransferStub({ "application/x-skynet-badge": "x" }),
    );
    expect(iframe.style.pointerEvents).toBe("none");
    fireWindowDragEvent("dragend", null);
    expect(iframe.style.pointerEvents).toBe("");
  });

  it("drop restores iframe pointer-events (dragend safety net)", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
      );
      const iframe = container.querySelector("iframe") as HTMLIFrameElement;
      fireWindowDragEvent(
        "dragstart",
        makeDataTransferStub({ "application/x-skynet-row": "x" }),
      );
      expect(iframe.style.pointerEvents).toBe("none");
      fireWindowDragEvent("drop", null);
      // Session end is deferred one tick so the target's drop handler runs first.
      vi.advanceTimersByTime(0);
      expect(iframe.style.pointerEvents).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("drop onto a target that stops propagation (split Pane) still restores", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
      );
      const iframe = container.querySelector("iframe") as HTMLIFrameElement;
      fireWindowDragEvent(
        "dragstart",
        makeDataTransferStub({ "application/x-skynet-badge": "x" }),
      );
      const pane = document.createElement("div");
      document.body.appendChild(pane);
      pane.addEventListener("drop", (e) => e.stopPropagation());
      pane.dispatchEvent(new Event("drop", { bubbles: true }));
      vi.advanceTimersByTime(0);
      expect(iframe.style.pointerEvents).toBe("");
      pane.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it("non-Skynet drag (text/plain only) does NOT mute the iframe", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    // Browser text-selection drag carries only text/plain.
    fireWindowDragEvent(
      "dragstart",
      makeDataTransferStub({ "text/plain": "some selected text" }),
    );
    expect(iframe.style.pointerEvents).toBe("");
  });

  it("dragstart with null dataTransfer is a no-op", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    fireWindowDragEvent("dragstart", null);
    expect(iframe.style.pointerEvents).toBe("");
  });

  // Watchdog: covers the drag-source-unmounted-then-ESC-cancelled path where
  // neither dragend nor drop ever fires. Prior to the watchdog the iframe
  // stayed muted for the rest of the session.
  it("watchdog restores pointer-events if dragover falls silent (no dragend/drop)", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
      );
      const iframe = container.querySelector("iframe") as HTMLIFrameElement;
      fireWindowDragEvent(
        "dragstart",
        makeDataTransferStub({ "application/x-skynet-badge": "x" }),
      );
      expect(iframe.style.pointerEvents).toBe("none");
      // Live drag: dragover heartbeat keeps the watchdog alive.
      vi.advanceTimersByTime(DRAG_PREVIEW_WATCHDOG_MS - 100);
      fireWindowDragEvent("dragover", null);
      vi.advanceTimersByTime(DRAG_PREVIEW_WATCHDOG_MS - 100);
      expect(iframe.style.pointerEvents).toBe("none");
      // Drag dies silently — no more dragover, no dragend, no drop.
      vi.advanceTimersByTime(DRAG_PREVIEW_WATCHDOG_MS);
      expect(iframe.style.pointerEvents).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a Skynet dragover after a mid-drag watchdog restore re-mutes the iframe", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
      );
      const iframe = container.querySelector("iframe") as HTMLIFrameElement;
      const dt = makeDataTransferStub({ "application/x-skynet-badge": "x" });
      fireWindowDragEvent("dragstart", dt);
      // Cursor leaves the window — dragover goes silent, watchdog restores.
      vi.advanceTimersByTime(DRAG_PREVIEW_WATCHDOG_MS);
      expect(iframe.style.pointerEvents).toBe("");
      // Cursor comes back with the drag still live.
      fireWindowDragEvent("dragover", dt);
      expect(iframe.style.pointerEvents).toBe("none");
    } finally {
      vi.useRealTimers();
    }
  });

  it("watchdog is NOT armed for non-Skynet drags (dragover on text drag does nothing)", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
      );
      const iframe = container.querySelector("iframe") as HTMLIFrameElement;
      fireWindowDragEvent(
        "dragstart",
        makeDataTransferStub({ "text/plain": "selected" }),
      );
      fireWindowDragEvent("dragover", null);
      vi.advanceTimersByTime(5000);
      expect(iframe.style.pointerEvents).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Chrome auto-rendered-viewer dark-mode injection ──────────────────────
// The helper injects a dark stylesheet into iframe.contentDocument when the
// iframe's document is Chrome's built-in JSON viewer (Content-Type:
// application/json) or its text/plain viewer. Real app HTML routes pass
// through untouched — D-20 pane-transparency to the app.
describe("AppPane auto-rendered-viewer dark-mode injection", () => {
  function makeFakeDoc(contentType: string): {
    doc: Document;
    appended: HTMLStyleElement[];
  } {
    const appended: HTMLStyleElement[] = [];
    const head = {
      appendChild: (el: HTMLStyleElement) => {
        appended.push(el);
        return el;
      },
    } as unknown as HTMLHeadElement;
    const doc = {
      contentType,
      head,
      createElement: (tag: string) => {
        // Real jsdom document.createElement so the returned node behaves like
        // a real HTMLStyleElement (textContent, tagName, etc).
        return document.createElement(tag);
      },
    } as unknown as Document;
    return { doc, appended };
  }

  it("injects a <style> for Content-Type: application/json", () => {
    const { doc, appended } = makeFakeDoc("application/json");
    injectDarkViewerStylesheetIfApplicable(doc);
    expect(appended.length).toBe(1);
    expect(appended[0]?.tagName).toBe("STYLE");
    expect(appended[0]?.textContent).toContain("color-scheme: dark");
    expect(appended[0]?.textContent).toContain("#141520");
  });

  it("injects a <style> for Content-Type: application/json; charset=utf-8", () => {
    const { doc, appended } = makeFakeDoc("application/json; charset=utf-8");
    injectDarkViewerStylesheetIfApplicable(doc);
    expect(appended.length).toBe(1);
  });

  it("injects a <style> for Content-Type: text/plain", () => {
    const { doc, appended } = makeFakeDoc("text/plain");
    injectDarkViewerStylesheetIfApplicable(doc);
    expect(appended.length).toBe(1);
  });

  it("does NOT inject for Content-Type: text/html (D-20 pane transparency)", () => {
    const { doc, appended } = makeFakeDoc("text/html");
    injectDarkViewerStylesheetIfApplicable(doc);
    expect(appended.length).toBe(0);
  });

  it("does NOT inject for Content-Type: image/png", () => {
    const { doc, appended } = makeFakeDoc("image/png");
    injectDarkViewerStylesheetIfApplicable(doc);
    expect(appended.length).toBe(0);
  });

  it("does not throw when contentDocument is null (cross-origin)", () => {
    expect(() => {
      injectDarkViewerStylesheetIfApplicable(null);
    }).not.toThrow();
  });
});
