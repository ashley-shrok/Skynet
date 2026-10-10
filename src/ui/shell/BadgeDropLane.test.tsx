// ─── BadgeDropLane.test.tsx ────────────────────────────────────────────────
// The close / archive lane shown during an identity-badge drag.
//
// The lane attaches NATIVE drag listeners (patch #514 lesson), so events are
// dispatched as real DOM events with `dataTransfer` / `clientY` patched on
// via Object.defineProperty (jsdom's DragEvent init ignores both).
// getBoundingClientRect is pinned to a 115×900 rect: y < 600 is the close
// zone, y ≥ 600 the archive zone.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

import BadgeDropLane, { shouldMountBadgeDropLane, zoneAt } from "./BadgeDropLane";
import type { DraggedBadge } from "./badge-drag";

const BADGE_MIME = "application/x-skynet-badge";

function makeDataTransferStub(entries: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(entries));
  return {
    getData: (type: string) => store.get(type) ?? "",
    get types() {
      return Array.from(store.keys());
    },
  };
}
type Dt = ReturnType<typeof makeDataTransferStub>;

function dispatchNative(
  el: Element,
  type: "dragover" | "drop" | "dragleave",
  dt: Dt,
  at: { x?: number; y: number },
): Event {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dt, configurable: true });
  Object.defineProperty(evt, "clientX", { value: at.x ?? 50, configurable: true });
  Object.defineProperty(evt, "clientY", { value: at.y, configurable: true });
  act(() => {
    el.dispatchEvent(evt);
  });
  return evt;
}

const RECT: DOMRect = {
  left: 0,
  top: 0,
  right: 115,
  bottom: 900,
  x: 0,
  y: 0,
  width: 115,
  height: 900,
  toJSON() {
    return this;
  },
};
const CLOSE_Y = 300;
const ARCHIVE_Y = 750;

const badge = (over: Partial<DraggedBadge> = {}): DraggedBadge => ({
  tabId: "tab-1",
  hostId: 6,
  identityKey: "crane",
  sessionKind: "harness",
  targetTmuxSession: "crane",
  relayRoomId: null,
  ...over,
});
const badgeDt = (tabId = "tab-1") =>
  makeDataTransferStub({ "text/plain": tabId, [BADGE_MIME]: JSON.stringify({ tabId }) });

let originalRect: () => DOMRect;
beforeEach(() => {
  cleanup();
  originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = () => RECT;
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  vi.restoreAllMocks();
});

function renderLane(props: Partial<Parameters<typeof BadgeDropLane>[0]> = {}) {
  const onCloseTab = vi.fn();
  const onArchiveTab = vi.fn();
  const utils = render(
    <BadgeDropLane
      draggedBadge={badge()}
      openTabIds={["tab-1"]}
      onCloseTab={onCloseTab}
      onArchiveTab={onArchiveTab}
      canArchive={true}
      {...props}
    />,
  );
  return { ...utils, onCloseTab, onArchiveTab, lane: () => utils.getByTestId("badge-drop-lane") };
}

describe("BadgeDropLane", () => {
  it("renders nothing when no badge is being dragged", () => {
    const { queryByTestId } = render(
      <BadgeDropLane draggedBadge={null} openTabIds={[]} onCloseTab={vi.fn()} canArchive={false} />,
    );
    expect(queryByTestId("badge-drop-lane")).toBeNull();
  });

  it("is neutral at rest, with a Close zone and an Archive zone", () => {
    const { lane, getByTestId } = renderLane();
    expect(lane().getAttribute("data-hover")).toBe("none");
    expect(lane().getAttribute("style")).toContain("var(--color-pv-base)");
    expect(getByTestId("badge-drop-lane-close").textContent).toContain("Close");
    expect(getByTestId("badge-drop-lane-archive").textContent).toContain("Archive");
  });

  it("lights the close zone (coral) over the top two-thirds, archive (red) over the bottom third", () => {
    const { lane, getByTestId } = renderLane();
    const dt = badgeDt();
    const over = dispatchNative(lane(), "dragover", dt, { y: CLOSE_Y });
    expect(over.defaultPrevented).toBe(true);
    expect(lane().getAttribute("data-hover")).toBe("close");
    expect(getByTestId("badge-drop-lane-close").getAttribute("style")).toContain("rgba(255, 184, 150, 0.22)");

    dispatchNative(lane(), "dragover", dt, { y: ARCHIVE_Y });
    expect(lane().getAttribute("data-hover")).toBe("archive");
    expect(getByTestId("badge-drop-lane-archive").getAttribute("style")).toContain("rgba(239, 68, 68, 0.25)");
  });

  it("ignores row drags — no hover, no preventDefault", () => {
    const { lane } = renderLane();
    const rowDt = makeDataTransferStub({ "text/plain": "row", "application/x-skynet-row": "{}" });
    const over = dispatchNative(lane(), "dragover", rowDt, { y: CLOSE_Y });
    expect(over.defaultPrevented).toBe(false);
    expect(lane().getAttribute("data-hover")).toBe("none");
  });

  it("drop on the close zone closes the tab", () => {
    const { lane, onCloseTab, onArchiveTab } = renderLane();
    const dt = badgeDt();
    dispatchNative(lane(), "dragover", dt, { y: CLOSE_Y });
    const drop = dispatchNative(lane(), "drop", dt, { y: CLOSE_Y });
    expect(drop.defaultPrevented).toBe(true);
    expect(onCloseTab).toHaveBeenCalledExactlyOnceWith("tab-1");
    expect(onArchiveTab).not.toHaveBeenCalled();
    expect(lane().getAttribute("data-hover")).toBe("none");
  });

  it("drop on the archive zone hands the badge to onArchiveTab (which owns the confirm)", () => {
    const { lane, onCloseTab, onArchiveTab } = renderLane();
    dispatchNative(lane(), "drop", badgeDt(), { y: ARCHIVE_Y });
    expect(onArchiveTab).toHaveBeenCalledTimes(1);
    expect(onArchiveTab.mock.calls[0][0]).toMatchObject({ tabId: "tab-1" });
    expect(onCloseTab).not.toHaveBeenCalled();
  });

  it("without archive (relay room / canArchive false) there's no archive zone and the whole lane closes", () => {
    const { lane, queryByTestId, onCloseTab, onArchiveTab } = renderLane({ canArchive: false });
    expect(queryByTestId("badge-drop-lane-archive")).toBeNull();
    dispatchNative(lane(), "dragover", badgeDt(), { y: ARCHIVE_Y });
    expect(lane().getAttribute("data-hover")).toBe("close");
    dispatchNative(lane(), "drop", badgeDt(), { y: ARCHIVE_Y });
    expect(onCloseTab).toHaveBeenCalledExactlyOnceWith("tab-1");
    expect(onArchiveTab).not.toHaveBeenCalled();
  });

  it("silently drops a payload whose tabId isn't open, or that's malformed", () => {
    const { lane, onCloseTab, onArchiveTab } = renderLane();
    dispatchNative(lane(), "drop", badgeDt("not-open"), { y: CLOSE_Y });
    dispatchNative(lane(), "drop", makeDataTransferStub({ [BADGE_MIME]: "{not json" }), { y: CLOSE_Y });
    dispatchNative(lane(), "drop", makeDataTransferStub({ [BADGE_MIME]: JSON.stringify({ tabId: "" }) }), { y: ARCHIVE_Y });
    expect(onCloseTab).not.toHaveBeenCalled();
    expect(onArchiveTab).not.toHaveBeenCalled();
  });

  it("a dragleave still inside the rect (child crossing) keeps the hover", () => {
    const { lane } = renderLane();
    const dt = badgeDt();
    dispatchNative(lane(), "dragover", dt, { y: CLOSE_Y });
    dispatchNative(lane(), "dragleave", dt, { x: 50, y: CLOSE_Y });
    expect(lane().getAttribute("data-hover")).toBe("close");
    dispatchNative(lane(), "dragleave", dt, { x: 400, y: CLOSE_Y });
    expect(lane().getAttribute("data-hover")).toBe("none");
  });

  it("attaches listeners when it mounts after starting with no drag (callback-ref regression)", () => {
    const onCloseTab = vi.fn();
    const props = { openTabIds: ["tab-1"], onCloseTab, canArchive: true };
    const { rerender, getByTestId } = render(<BadgeDropLane draggedBadge={null} {...props} />);
    rerender(<BadgeDropLane draggedBadge={badge()} {...props} />);
    dispatchNative(getByTestId("badge-drop-lane"), "drop", badgeDt(), { y: CLOSE_Y });
    expect(onCloseTab).toHaveBeenCalledExactlyOnceWith("tab-1");
  });
});

describe("zoneAt", () => {
  it("bottom third is archive; everything is close without an archive zone", () => {
    const r = { top: 100, height: 900 };
    expect(zoneAt(r, 100, true)).toBe("close");
    expect(zoneAt(r, 699, true)).toBe("close");
    expect(zoneAt(r, 700, true)).toBe("archive");
    expect(zoneAt(r, 999, false)).toBe("close");
  });
});

describe("shouldMountBadgeDropLane", () => {
  it("mounts on desktop whether or not the sidebar is open; never on mobile", () => {
    expect(shouldMountBadgeDropLane({ isMobile: false, isMobileListScreen: false })).toBe(true);
    expect(shouldMountBadgeDropLane({ isMobile: true, isMobileListScreen: false })).toBe(false);
    expect(shouldMountBadgeDropLane({ isMobile: false, isMobileListScreen: true })).toBe(false);
  });
});
