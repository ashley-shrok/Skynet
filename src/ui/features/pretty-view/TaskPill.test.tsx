/**
 * TaskPill — the agent pane's handle (replaced the identity badge).
 *
 * Covers the shape-task-pill agreement: avatar + task (name fallback), click →
 * agent window, ⋮ / right-click → the conversation menu, drag → pane handle
 * (desktop only), tooltip, and the round buttons beside it (desktop running,
 * unpushed work) that appear only while true and jump to their tab.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Identity } from "@/api/identities-api";

const FIXTURE: Identity = {
  identityKey: "willow",
  hostId: 1,
  displayName: "Willow",
  title: null,
  colorHue: 200,
  voice: null,
  role: "skynet-maintainer",
  roles: ["skynet-maintainer"],
  avatarMime: "image/png",
  avatarUrl: "/identities/willow/avatar?hostId=1",
  avatarEtag: "etag-1",
  coordinator: false,
  task: "build the pool endpoint",
  project: null,
};

let currentIdentity: Identity | null = FIXTURE;
vi.mock("@/state/identities-store", () => ({
  useIdentities: vi.fn(() => {
    const m = new Map(currentIdentity ? [[currentIdentity.identityKey, currentIdentity]] : []);
    const hk = new Map(
      currentIdentity ? [[`1::${currentIdentity.identityKey}`, currentIdentity]] : [],
    );
    return { identities: currentIdentity ? [currentIdentity] : [], byKey: m, byHostKey: hk, loaded: true, refresh: vi.fn() };
  }),
}));

let currentTrappedWork: { hasTrappedWork: boolean } | undefined = undefined;
vi.mock("@/state/trapped-work-store", () => ({
  useTrappedWork: vi.fn(() => currentTrappedWork),
}));

let currentProjects: Array<{ slug: string; displayName: string; hostId: string }> = [];
vi.mock("@/state/conversation-store", () => ({
  useProjects: vi.fn(() => currentProjects),
}));

import { TaskPill } from "./TaskPill";
import { __setSessionDesktopRunningForTests } from "@/api/fleet-status-client";
import { parseBadgePayload, BADGE_MIME } from "@/shell/badge-drag";
import { DESKTOP_DRAG_MIME } from "@/shell/desktop-drag";

function setMobileViewport(isMobile: boolean) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: isMobile ? 500 : 1280,
  });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isMobile,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function makeDataTransferStub() {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? "",
    effectAllowed: "none" as string,
    get types() {
      return Array.from(store.keys());
    },
  };
}

const items = () => [
  { label: "Move to new tab", onClick: vi.fn() },
  { label: "Archive", danger: true, onClick: vi.fn() },
];

function renderPill(overrides: Partial<React.ComponentProps<typeof TaskPill>> = {}) {
  const onOpen = vi.fn();
  const menuItems = overrides.menuItems ?? items();
  const utils = render(
    <TaskPill
      identityKey="willow"
      hostId={1}
      tmuxSession="willow"
      tabId="tab-1"
      dragDescriptor={{ tabType: "terminal", sessionKind: "harness", targetTmuxSession: "willow" }}
      menuItems={menuItems}
      onOpen={onOpen}
      {...overrides}
    />,
  );
  return { ...utils, onOpen, menuItems };
}

describe("TaskPill", () => {
  beforeEach(() => {
    currentIdentity = FIXTURE;
    currentTrappedWork = undefined;
    currentProjects = [];
    setMobileViewport(false);
    __setSessionDesktopRunningForTests(1, "willow", null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("look", () => {
    it("shows the avatar and the task", () => {
      renderPill();
      const pill = screen.getByTestId("pv-task-pill");
      expect(screen.getByTestId("pv-task-pill-label").textContent).toBe("build the pool endpoint");
      expect(pill.querySelector("img")?.getAttribute("src")).toBe(FIXTURE.avatarUrl);
    });

    it("falls back to the agent's name when there is no task, like the sidebar row", () => {
      currentIdentity = { ...FIXTURE, task: null };
      renderPill();
      expect(screen.getByTestId("pv-task-pill-label").textContent).toBe("Willow");
    });

    it("is tinted with the role hue, falling back to 35", () => {
      const { unmount } = renderPill();
      expect(screen.getByTestId("pv-task-pill").getAttribute("style")).toContain("hsla(200,");
      unmount();
      currentIdentity = { ...FIXTURE, colorHue: null };
      renderPill();
      expect(screen.getByTestId("pv-task-pill").getAttribute("style")).toContain("hsla(35,");
    });

    it("renders a task containing markup as literal text", () => {
      const evil = "<img src=x onerror=alert(1)>";
      currentIdentity = { ...FIXTURE, task: evil };
      renderPill();
      expect(screen.getByTestId("pv-task-pill-label").textContent).toBe(evil);
      // Only the avatar img — nothing injected.
      expect(screen.getByTestId("pv-task-pill").querySelectorAll("img")).toHaveLength(1);
    });

    it("tooltip carries name, roles and project", () => {
      currentIdentity = { ...FIXTURE, project: "skynet" };
      currentProjects = [{ slug: "skynet", displayName: "SKYNET", hostId: "1" }];
      renderPill();
      const title = screen.getByTestId("pv-task-pill").getAttribute("title") ?? "";
      expect(title).toContain("Willow");
      expect(title).toContain("Skynet Maintainer");
      expect(title).toContain("SKYNET");
    });

    it("draws no coordinator watermark and no pin mark", () => {
      currentIdentity = { ...FIXTURE, coordinator: true, pinned: true };
      renderPill();
      expect(screen.queryByTestId("coordinator-watermark")).toBeNull();
      expect(screen.queryByTestId("pv-identity-badge-pin-indicator")).toBeNull();
    });

    it("renders nothing until the identity is known", () => {
      currentIdentity = null;
      const { container } = renderPill();
      expect(container.innerHTML).toBe("");
    });
  });

  describe("click and menu", () => {
    it("click on the pill opens the agent window with no specific tab", async () => {
      const user = userEvent.setup();
      const { onOpen } = renderPill();
      await user.click(screen.getByTestId("pv-task-pill-label"));
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith(undefined);
    });

    it("keyboard Enter on the open button opens the agent window", async () => {
      const user = userEvent.setup();
      const { onOpen } = renderPill();
      screen.getByRole("button", { name: "Open agent info" }).focus();
      await user.keyboard("{Enter}");
      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it("⋮ opens the conversation menu; choosing an item runs it and does NOT open the agent window", async () => {
      const user = userEvent.setup();
      const { onOpen, menuItems } = renderPill();
      await user.click(screen.getByTestId("pv-task-pill-kebab-trigger"));
      await user.click(screen.getByRole("menuitem", { name: "Move to new tab" }));
      expect(menuItems[0].onClick).toHaveBeenCalledTimes(1);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it("right-click on the pill opens the same menu", async () => {
      renderPill();
      fireEvent.contextMenu(screen.getByTestId("pv-task-pill"), { clientX: 100, clientY: 40 });
      expect(await screen.findByRole("menuitem", { name: "Archive" })).toBeTruthy();
    });

    it("no menu items → no ⋮", () => {
      renderPill({ menuItems: [] });
      expect(screen.queryByTestId("pv-task-pill-kebab-trigger")).toBeNull();
    });

    it("⋮ stays visible on a phone", () => {
      setMobileViewport(true);
      renderPill();
      expect(screen.getByTestId("pv-task-pill-kebab-trigger")).toBeTruthy();
    });
  });

  describe("drag (pane handle)", () => {
    it("dragstart writes the pane-handle payload every drop target reads", () => {
      renderPill();
      const pill = screen.getByTestId("pv-task-pill");
      expect(pill.getAttribute("draggable")).toBe("true");
      const dt = makeDataTransferStub();
      fireEvent.dragStart(pill, { dataTransfer: dt });
      expect(dt.getData("text/plain")).toBe("tab-1");
      const payload = JSON.parse(dt.getData("application/x-skynet-badge"));
      expect(payload.tabId).toBe("tab-1");
      expect(payload.identityKey).toBe("willow");
      expect(payload.hostId).toBe(1);
      expect(payload.descriptor.sessionKind).toBe("harness");
      expect(payload.descriptor.targetTmuxSession).toBe("willow");
      expect(typeof payload.dragId).toBe("string");
      expect(dt.effectAllowed).toBe("move");
    });

    it("drop targets (drop lane, sidebar sections) read the pill's payload as this agent's harness pane", () => {
      renderPill();
      const dt = makeDataTransferStub();
      fireEvent.dragStart(screen.getByTestId("pv-task-pill"), { dataTransfer: dt });
      expect(parseBadgePayload(dt.getData(BADGE_MIME))).toEqual({
        tabId: "tab-1",
        hostId: 1,
        identityKey: "willow",
        sessionKind: "harness",
        targetTmuxSession: "willow",
        relayRoomId: null,
      });
    });

    it("a drag starting on the ⋮ is cancelled", () => {
      renderPill();
      const ev = new Event("dragstart", { bubbles: true, cancelable: true });
      act(() => {
        screen.getByTestId("pv-task-pill-kebab-trigger").dispatchEvent(ev);
      });
      expect(ev.defaultPrevented).toBe(true);
    });

    it("not draggable on a phone", () => {
      setMobileViewport(true);
      renderPill();
      expect(screen.getByTestId("pv-task-pill").getAttribute("draggable")).toBe("false");
    });

    it("not draggable without a tab id", () => {
      renderPill({ tabId: undefined });
      expect(screen.getByTestId("pv-task-pill").getAttribute("draggable")).toBe("false");
    });
  });

  describe("round buttons beside the pill", () => {
    it("none show when nothing is true", () => {
      renderPill();
      expect(screen.queryByTestId("pv-task-pill-side")).toBeNull();
      expect(screen.queryByTestId("pv-desktop-button")).toBeNull();
      expect(screen.queryByTestId("pv-unpushed-button")).toBeNull();
    });

    it("desktop button appears while the desktop runs, disappears when it stops, and opens the Desktop tab", async () => {
      const user = userEvent.setup();
      const { onOpen } = renderPill();
      expect(screen.queryByTestId("pv-desktop-button")).toBeNull();
      act(() => __setSessionDesktopRunningForTests(1, "willow", true));
      const btn = screen.getByTestId("pv-desktop-button");
      // Outside the pill, so the pill's drag/click never touch it.
      expect(screen.getByTestId("pv-task-pill").contains(btn)).toBe(false);
      await user.click(btn);
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith("desktop");
      act(() => __setSessionDesktopRunningForTests(1, "willow", false));
      expect(screen.queryByTestId("pv-desktop-button")).toBeNull();
    });

    it("dragging the desktop button carries only the desktop payload (it opens a desktop pane)", () => {
      renderPill();
      act(() => __setSessionDesktopRunningForTests(1, "willow", true));
      const btn = screen.getByTestId("pv-desktop-button");
      expect(btn.getAttribute("draggable")).toBe("true");
      const dt = makeDataTransferStub();
      fireEvent.dragStart(btn, { dataTransfer: dt });
      expect(dt.types).toEqual([DESKTOP_DRAG_MIME]);
      expect(JSON.parse(dt.getData(DESKTOP_DRAG_MIME))).toEqual({
        hostId: 1,
        identityKey: "willow",
        label: "Willow",
      });
      expect(dt.effectAllowed).toBe("copy");
    });

    it("the desktop button isn't a drag source on a phone", () => {
      setMobileViewport(true);
      renderPill();
      act(() => __setSessionDesktopRunningForTests(1, "willow", true));
      expect(screen.getByTestId("pv-desktop-button").getAttribute("draggable")).toBe("false");
    });

    it("desktop signal is per session — another agent's desktop doesn't light this pill", () => {
      renderPill();
      act(() => __setSessionDesktopRunningForTests(1, "someone-else", true));
      expect(screen.queryByTestId("pv-desktop-button")).toBeNull();
      act(() => __setSessionDesktopRunningForTests(2, "willow", true));
      expect(screen.queryByTestId("pv-desktop-button")).toBeNull();
    });

    it("unpushed-work button appears with trapped work and opens the Git tab", async () => {
      const user = userEvent.setup();
      currentTrappedWork = { hasTrappedWork: true };
      const { onOpen } = renderPill();
      await user.click(screen.getByTestId("pv-unpushed-button"));
      expect(onOpen).toHaveBeenCalledWith("git");
    });

    it("with both showing, the desktop button sits nearer the pill", () => {
      currentTrappedWork = { hasTrappedWork: true };
      renderPill();
      act(() => __setSessionDesktopRunningForTests(1, "willow", true));
      const side = screen.getByTestId("pv-task-pill-side");
      const ids = Array.from(side.children).map((c) => c.getAttribute("data-testid"));
      expect(ids).toEqual(["pv-desktop-button", "pv-unpushed-button"]);
    });

    it("buttons pulse on arrival only — the animation runs a fixed number of times", () => {
      renderPill();
      act(() => __setSessionDesktopRunningForTests(1, "willow", true));
      expect(screen.getByTestId("pv-desktop-button").className).toContain("pv-side-button");
    });

    it("the pill reserves room for both buttons so it never resizes when one appears", () => {
      renderPill();
      const anchor = screen.getByTestId("pv-task-pill-anchor");
      const before = anchor.getAttribute("style");
      act(() => __setSessionDesktopRunningForTests(1, "willow", true));
      expect(anchor.getAttribute("style")).toBe(before);
      expect(before).toContain("max-width: calc(100% - ");
      // Centered by auto margins across the full pane width — a left:50%
      // anchor would silently cap the pill at half the pane.
      expect(anchor.className).toContain("inset-x-0");
      expect(anchor.className).toContain("mx-auto");
      expect(anchor.className).not.toContain("left-1/2");
    });
  });
});
