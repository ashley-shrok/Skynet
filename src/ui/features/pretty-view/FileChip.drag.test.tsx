/**
 * FileChip — drag source for file panes.
 *
 * Covers: dragging a chip (plain and image-preview variants) writes only the
 * file-chip payload — the browser's own link data is cleared so the drag
 * never reads as text or as a file upload — and carries the chip's
 * conversation origin; phones don't drag; non-Skynet URLs don't drag.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

const mobileState = { isMobile: false };
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobileState.isMobile }));

import { FileChip } from "./FileChip";
import { FILE_CHIP_MIME } from "./file-url";

const origin = window.location.origin;

function makeDataTransfer() {
  const store = new Map<string, string>([
    ["text/plain", "browser-added link text"],
    ["text/uri-list", "browser-added uri"],
  ]);
  return {
    store,
    setData: (t: string, v: string) => void store.set(t, v),
    getData: (t: string) => store.get(t) ?? "",
    clearData: () => store.clear(),
    effectAllowed: "none",
    get types() {
      return Array.from(store.keys());
    },
  };
}

beforeEach(() => {
  mobileState.isMobile = false;
});
afterEach(() => cleanup());

describe("FileChip — drag", () => {
  it("a plain chip drags the file payload with its origin, and nothing else", () => {
    const { container } = render(
      <FileChip
        url={`${origin}/file/Skynet/home/ubuntu/notes/plan%20v2.md`}
        filename="plan v2.md"
        onOpen={vi.fn()}
        dragOrigin="tmux:Skynet:sahara"
      />,
    );
    const anchor = container.querySelector("a")!;
    expect(anchor.getAttribute("draggable")).toBe("true");
    const dt = makeDataTransfer();
    fireEvent.dragStart(anchor, { dataTransfer: dt });
    expect(dt.types).toEqual([FILE_CHIP_MIME]);
    expect(JSON.parse(dt.getData(FILE_CHIP_MIME))).toEqual({
      host: "Skynet",
      path: "/home/ubuntu/notes/plan v2.md",
      filename: "plan v2.md",
      origin: "tmux:Skynet:sahara",
    });
    expect(dt.effectAllowed).toBe("copy");
  });

  it("an image-preview chip drags as a whole, and its picture isn't a drag source of its own", () => {
    const { container } = render(
      <FileChip url={`${origin}/file/Skynet/home/ubuntu/shot.png`} filename="shot.png" onOpen={vi.fn()} />,
    );
    const anchor = container.querySelector('a[data-file-chip-kind="image"]') as HTMLElement;
    expect(anchor.getAttribute("draggable")).toBe("true");
    expect(anchor.className).toContain("[&_img]:[-webkit-user-drag:none]");
    const dt = makeDataTransfer();
    fireEvent.dragStart(anchor.querySelector("img") ?? anchor, { dataTransfer: dt });
    expect(JSON.parse(dt.getData(FILE_CHIP_MIME))).toMatchObject({
      host: "Skynet",
      path: "/home/ubuntu/shot.png",
      origin: null,
    });
  });

  it("doesn't drag on a phone", () => {
    mobileState.isMobile = true;
    const { container } = render(
      <FileChip url={`${origin}/file/Skynet/home/ubuntu/a.txt`} filename="a.txt" onOpen={vi.fn()} />,
    );
    expect(container.querySelector("a")!.hasAttribute("draggable")).toBe(false);
  });

  it("doesn't drag a URL that isn't a Skynet file URL on this origin", () => {
    const { container } = render(
      <FileChip url="https://elsewhere.example/file/Skynet/a.txt" filename="a.txt" onOpen={vi.fn()} />,
    );
    expect(container.querySelector("a")!.hasAttribute("draggable")).toBe(false);
  });
});
