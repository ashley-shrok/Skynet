/**
 * SplitView — chat file-chip drops (FILE_CHIP_MIME).
 *
 * Covers: the drag gate accepts the file-chip MIME (dragover claims the drop
 * and paints the preview), an edge drop dispatches onDropFileChipInTree with
 * the parsed payload, a center drop dispatches onCenterDropFileChip, and a
 * malformed payload never reaches either handler.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, createEvent, cleanup } from "@testing-library/react";
import { SplitView, hasSkynetDragPayload } from "./SplitView";
import type { SplitNode, SplitPath, DropEdge } from "@/lib/split-tree";
import type { Tab } from "@/types/ui-types";
import { FILE_CHIP_MIME, type FileChipDragPayload } from "@/features/pretty-view/file-url";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/shell/tabUtils", () => ({
  tabIcon: (_type: string) => "ICON",
}));

const tabTarget = {
  id: "target",
  instanceId: "target",
  type: "terminal",
  label: "TargetTab",
  openedAt: 0,
  targetTmuxSession: null,
} as unknown as Tab;
const leaf = (tabId: string): SplitNode => ({ kind: "session", tabId });

const payload: FileChipDragPayload = {
  host: "Skynet",
  path: "/home/ubuntu/notes/plan.md",
  filename: "plan.md",
  origin: "tmux:Skynet:sahara",
};

function dt(json: string) {
  return {
    types: [FILE_CHIP_MIME] as readonly string[],
    getData: (k: string) => (k === FILE_CHIP_MIME ? json : ""),
  };
}

function dispatchAt(kind: "drop" | "dragOver", el: Element, x: number, y: number, dataTransfer: object) {
  const evt = createEvent[kind](el, { dataTransfer });
  Object.defineProperty(evt, "clientX", { value: x, configurable: true });
  Object.defineProperty(evt, "clientY", { value: y, configurable: true });
  fireEvent(el, evt);
}

function paneOuter(container: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = (container.querySelector("[data-tab-id]") as HTMLElement).parentElement;
  while (cur && !cur.className.includes("relative isolate flex flex-col")) cur = cur.parentElement;
  if (!cur) throw new Error("Pane outer div not found");
  cur.getBoundingClientRect = () =>
    ({ left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return cur;
}

function renderView() {
  const edgeSpy = vi.fn<(p: FileChipDragPayload, path: SplitPath, edge: DropEdge) => void>();
  const centerSpy = vi.fn<(p: FileChipDragPayload, target: string) => void>();
  const appTileSpy = vi.fn();
  const utils = render(
    <SplitView
      splitTree={leaf("target")}
      tabs={[tabTarget]}
      onDropFileChipInTree={edgeSpy}
      onCenterDropFileChip={centerSpy}
      onDropAppTileInTree={appTileSpy}
      onCenterDropAppTile={appTileSpy}
    />,
  );
  return { ...utils, edgeSpy, centerSpy, appTileSpy };
}

beforeEach(() => {
  cleanup();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("SplitView — file-chip drops", () => {
  it("the drag gate accepts the file-chip MIME", () => {
    expect(hasSkynetDragPayload({ types: [FILE_CHIP_MIME] } as unknown as DataTransfer)).toBe(true);
    expect(hasSkynetDragPayload({ types: ["text/plain"] } as unknown as DataTransfer)).toBe(false);
  });

  it("dragover with a file chip paints the drop preview", () => {
    const { container, getByTestId } = renderView();
    dispatchAt("dragOver", paneOuter(container), 95, 50, dt(JSON.stringify(payload)));
    expect(getByTestId("pane-drop-preview-overlay")).toBeTruthy();
  });

  it("edge drop opens the file at that edge", () => {
    const { container, edgeSpy, centerSpy } = renderView();
    dispatchAt("drop", paneOuter(container), 95, 50, dt(JSON.stringify(payload)));
    expect(edgeSpy).toHaveBeenCalledTimes(1);
    expect(edgeSpy).toHaveBeenCalledWith(payload, [], "right");
    expect(centerSpy).not.toHaveBeenCalled();
  });

  it("center drop replaces the target pane with the file", () => {
    const { container, edgeSpy, centerSpy } = renderView();
    dispatchAt("drop", paneOuter(container), 50, 50, dt(JSON.stringify(payload)));
    expect(centerSpy).toHaveBeenCalledWith(payload, "target");
    expect(edgeSpy).not.toHaveBeenCalled();
  });

  it("a malformed payload reaches neither handler", () => {
    const { container, edgeSpy, centerSpy, appTileSpy } = renderView();
    const bad = JSON.stringify({ host: "Skynet", path: "relative.md" });
    dispatchAt("drop", paneOuter(container), 95, 50, dt(bad));
    dispatchAt("drop", paneOuter(container), 50, 50, dt(bad));
    expect(edgeSpy).not.toHaveBeenCalled();
    expect(centerSpy).not.toHaveBeenCalled();
    expect(appTileSpy).not.toHaveBeenCalled();
  });
});
