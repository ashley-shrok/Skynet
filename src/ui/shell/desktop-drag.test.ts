/**
 * desktop-drag — the green desktop button's drag payload, the pop-out event,
 * and the cross-window desktop descriptor.
 */

import { describe, it, expect, vi } from "vitest";
import {
  DESKTOP_DRAG_MIME,
  OPEN_DESKTOP_PANE_EVENT,
  hasDesktopDragMime,
  parseDesktopDragPayload,
  requestDesktopPane,
  writeDesktopDragData,
} from "./desktop-drag";
import { desktopLeafFromDescriptor } from "./cross-window-drag";

describe("desktop drag payload", () => {
  it("writes only the desktop MIME, as a copy, and parses back", () => {
    const data = new Map<string, string>();
    const dt = {
      setData: (k: string, v: string) => data.set(k, v),
      effectAllowed: "all",
      get types() {
        return [...data.keys()];
      },
    } as unknown as DataTransfer;
    writeDesktopDragData(dt, { hostId: 7, identityKey: "sahara", label: "Sahara" });
    expect([...data.keys()]).toEqual([DESKTOP_DRAG_MIME]);
    expect(dt.effectAllowed).toBe("copy");
    expect(hasDesktopDragMime(dt)).toBe(true);
    expect(parseDesktopDragPayload(data.get(DESKTOP_DRAG_MIME)!)).toEqual({
      hostId: 7,
      identityKey: "sahara",
      label: "Sahara",
    });
  });

  it("falls back to the identity name when the label is blank", () => {
    expect(
      parseDesktopDragPayload(JSON.stringify({ hostId: 7, identityKey: "sahara", label: " " })),
    ).toEqual({ hostId: 7, identityKey: "sahara", label: "sahara" });
  });

  it.each([
    "",
    "not json",
    "null",
    JSON.stringify({ hostId: "7", identityKey: "sahara" }),
    JSON.stringify({ hostId: 0, identityKey: "sahara" }),
    JSON.stringify({ hostId: 7.5, identityKey: "sahara" }),
    JSON.stringify({ hostId: 7, identityKey: "../etc" }),
    JSON.stringify({ hostId: 7 }),
  ])("rejects %s", (raw) => {
    expect(parseDesktopDragPayload(raw)).toBeNull();
  });

  it("requestDesktopPane fires the pop-out window event with the payload", () => {
    const seen = vi.fn();
    const handler = (e: Event) => seen((e as CustomEvent).detail);
    window.addEventListener(OPEN_DESKTOP_PANE_EVENT, handler);
    requestDesktopPane({ hostId: 7, identityKey: "sahara", label: "Sahara" });
    window.removeEventListener(OPEN_DESKTOP_PANE_EVENT, handler);
    expect(seen).toHaveBeenCalledWith({ hostId: 7, identityKey: "sahara", label: "Sahara" });
  });
});

describe("desktopLeafFromDescriptor", () => {
  it("accepts a desktop pane bar's descriptor", () => {
    expect(
      desktopLeafFromDescriptor({
        tabType: "desktop",
        desktop: { hostId: 7, identityKey: "sahara" },
        label: "Sahara",
      }),
    ).toEqual({ hostId: 7, identityKey: "sahara", label: "Sahara" });
  });

  it("rejects other tab types and malformed addresses", () => {
    expect(desktopLeafFromDescriptor({ tabType: "file", desktop: { hostId: 7, identityKey: "s" } })).toBeNull();
    expect(desktopLeafFromDescriptor({ tabType: "desktop", desktop: { hostId: "7", identityKey: "s" } })).toBeNull();
    expect(desktopLeafFromDescriptor({ tabType: "desktop", desktop: { hostId: 7, identityKey: "S S" } })).toBeNull();
    expect(desktopLeafFromDescriptor({ tabType: "desktop", desktop: null })).toBeNull();
    expect(desktopLeafFromDescriptor(null)).toBeNull();
  });
});
