import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

import {
  BADGE_MIME,
  archivableIdentity,
  parseBadgePayload,
  useDraggedBadge,
  getDraggedBadge,
  __resetDraggedBadgeForTests,
} from "./badge-drag";
import { DRAG_PREVIEW_WATCHDOG_MS } from "./drag-preview-session";

function dragStart(entries: Record<string, string>): void {
  const store = new Map(Object.entries(entries));
  const evt = new Event("dragstart", { bubbles: true });
  Object.defineProperty(evt, "dataTransfer", {
    value: { getData: (t: string) => store.get(t) ?? "", types: [...store.keys()] },
    configurable: true,
  });
  act(() => {
    window.dispatchEvent(evt);
  });
}

function Probe() {
  const b = useDraggedBadge();
  return <div data-testid="probe">{b?.tabId ?? ""}</div>;
}

beforeEach(() => {
  cleanup();
  __resetDraggedBadgeForTests();
});

describe("parseBadgePayload", () => {
  it("reads tabId, hostId, identityKey and the descriptor's session fields", () => {
    expect(
      parseBadgePayload(
        JSON.stringify({
          tabId: "t",
          hostId: 6,
          identityKey: "crane",
          descriptor: { tabType: "terminal", sessionKind: "harness", targetTmuxSession: "Crane" },
        }),
      ),
    ).toEqual({
      tabId: "t",
      hostId: 6,
      identityKey: "crane",
      sessionKind: "harness",
      targetTmuxSession: "Crane",
      relayRoomId: null,
    });
  });

  it("rejects malformed payloads", () => {
    expect(parseBadgePayload("")).toBeNull();
    expect(parseBadgePayload("{nope")).toBeNull();
    expect(parseBadgePayload("null")).toBeNull();
    expect(parseBadgePayload(JSON.stringify({ tabId: "" }))).toBeNull();
    expect(parseBadgePayload(JSON.stringify({ tabId: 3 }))).toBeNull();
  });
});

describe("archivableIdentity", () => {
  const base = {
    tabId: "t",
    hostId: 6 as number | null,
    identityKey: "crane",
    sessionKind: "harness" as const,
    targetTmuxSession: "Crane-Box",
    relayRoomId: null,
  };
  it("a harness badge archives its own (lowercased) session identity", () => {
    expect(archivableIdentity(base)).toEqual({ hostId: 6, identityKey: "crane-box" });
  });
  it("relay rooms, app bars and host-less badges aren't archivable", () => {
    expect(archivableIdentity({ ...base, sessionKind: "relay-room", relayRoomId: "!r:x" })).toBeNull();
    expect(archivableIdentity({ ...base, hostId: null })).toBeNull();
    // An app pane's bar writes the badge MIME with no session kind.
    expect(
      archivableIdentity(
        parseBadgePayload(
          JSON.stringify({ tabId: "app:6:todo", identityKey: null, hostId: 6, descriptor: { tabType: "app" } }),
        )!,
      ),
    ).toBeNull();
  });
});

describe("useDraggedBadge", () => {
  it("a badge dragstart sets it; a row dragstart replaces it with null", () => {
    const { getByTestId } = render(<Probe />);
    dragStart({ [BADGE_MIME]: JSON.stringify({ tabId: "tab-1" }) });
    expect(getByTestId("probe").textContent).toBe("tab-1");
    expect(getDraggedBadge()?.tabId).toBe("tab-1");
    dragStart({ "application/x-skynet-row": "{}" });
    expect(getByTestId("probe").textContent).toBe("");
  });

  it("dragend clears it", () => {
    const { getByTestId } = render(<Probe />);
    dragStart({ [BADGE_MIME]: JSON.stringify({ tabId: "tab-1" }) });
    act(() => {
      window.dispatchEvent(new Event("dragend"));
    });
    expect(getByTestId("probe").textContent).toBe("");
  });

  it("a dragover gap (watchdog) does NOT clear it — the drag may still be live", () => {
    vi.useFakeTimers();
    try {
      const { getByTestId } = render(<Probe />);
      dragStart({ [BADGE_MIME]: JSON.stringify({ tabId: "tab-1" }) });
      act(() => {
        window.dispatchEvent(new Event("dragover"));
        vi.advanceTimersByTime(DRAG_PREVIEW_WATCHDOG_MS * 3);
      });
      expect(getByTestId("probe").textContent).toBe("tab-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a drop clears it even when dragend never reaches window (badge reparented)", () => {
    vi.useFakeTimers();
    try {
      const { getByTestId } = render(<Probe />);
      dragStart({ [BADGE_MIME]: JSON.stringify({ tabId: "tab-1" }) });
      act(() => {
        document.body.dispatchEvent(new Event("drop", { bubbles: true }));
        vi.advanceTimersByTime(0);
      });
      expect(getByTestId("probe").textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});
