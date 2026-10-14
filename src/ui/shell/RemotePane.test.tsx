/**
 * RemotePane — the pane bar on RDP / VNC / telnet leaves.
 *
 * Covers: host-name title, whole-bar drag writing the shared badge payload
 * with a protocol descriptor (cross-window drops reopen the session), a
 * press on Reconnect never dragging, Reconnect firing the event GuacamoleApp
 * listens for, bar click selecting the pane, and the menu (desktop: Move to
 * new tab + Close; phone: no ⋮ at all).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mobileState = { isMobile: false };
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileState.isMobile,
}));
const touchState = { isTouchDevice: false };
vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => touchState.isTouchDevice,
}));
vi.mock("@/features/guacamole/GuacamoleApp", () => ({
  default: () => <div data-testid="guacamole-stub" />,
}));

import { RemotePane } from "./RemotePane";

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

function renderPane(props: Partial<React.ComponentProps<typeof RemotePane>> = {}) {
  return render(
    <RemotePane
      hostId="7"
      hostName="ZoeyBattlestation"
      tabId="rdp-tab-1"
      protocol="rdp"
      isVisible
      {...props}
    />,
  );
}

async function openKebab(container: HTMLElement): Promise<HTMLElement> {
  const trigger = container.querySelector(
    '[data-testid="remote-pane-kebab-trigger"]',
  ) as HTMLElement | null;
  if (!trigger) throw new Error("remote bar kebab trigger not found");
  await userEvent.setup().click(trigger);
  return screen.getByRole("menu");
}

function itemLabels(menu: HTMLElement): string[] {
  return Array.from(menu.querySelectorAll('[role="menuitem"]')).map(
    (el) => el.textContent?.trim() ?? "",
  );
}

function clickItem(menu: HTMLElement, label: string) {
  const item = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(
    (el) => el.textContent?.trim() === label,
  ) as HTMLElement | undefined;
  if (!item) throw new Error(`menu item ${label} not found`);
  fireEvent.click(item);
}

beforeEach(() => {
  mobileState.isMobile = false;
  touchState.isTouchDevice = false;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RemotePane bar", () => {
  it("shows the host name and mounts the remote display below the bar", async () => {
    const { getByTestId, findByTestId } = renderPane();
    expect(getByTestId("remote-pane-title").textContent).toContain("ZoeyBattlestation");
    expect(await findByTestId("guacamole-stub")).toBeTruthy();
  });

  it("whole bar drags with the shared badge payload + a protocol descriptor", () => {
    const { getByTestId } = renderPane();
    const bar = getByTestId("remote-pane-bar");
    expect(bar.getAttribute("draggable")).toBe("true");
    const dt = makeDataTransfer();
    fireEvent.dragStart(bar, { dataTransfer: dt });
    expect(dt.getData("text/plain")).toBe("rdp-tab-1");
    const payload = JSON.parse(dt.getData("application/x-skynet-badge"));
    expect(payload.tabId).toBe("rdp-tab-1");
    expect(typeof payload.dragId).toBe("string");
    expect(payload.identityKey).toBeNull();
    expect(payload.hostId).toBe(7);
    expect(payload.descriptor).toEqual({ tabType: "rdp", label: "ZoeyBattlestation" });
  });

  it("a press that starts on Reconnect never drags the pane", () => {
    const { getByTestId } = renderPane();
    const bar = getByTestId("remote-pane-bar");
    fireEvent.pointerDown(getByTestId("remote-pane-reconnect"));
    const dt = makeDataTransfer();
    fireEvent.dragStart(bar, { dataTransfer: dt });
    expect(dt.getData("application/x-skynet-badge")).toBe("");
  });

  it("not draggable on mobile", () => {
    mobileState.isMobile = true;
    const { getByTestId } = renderPane();
    expect(getByTestId("remote-pane-bar").getAttribute("draggable")).toBe("false");
  });

  it("Reconnect fires skynet:refresh-guacamole for this tab", () => {
    const seen: unknown[] = [];
    const handler = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("skynet:refresh-guacamole", handler);
    try {
      const { getByTestId } = renderPane();
      fireEvent.click(getByTestId("remote-pane-reconnect"));
    } finally {
      window.removeEventListener("skynet:refresh-guacamole", handler);
    }
    expect(seen).toEqual([{ tabId: "rdp-tab-1" }]);
  });

  it("clicking the bar selects the pane", () => {
    const onSelectPane = vi.fn();
    const { getByTestId } = renderPane({ onSelectPane });
    fireEvent.click(getByTestId("remote-pane-bar"));
    expect(onSelectPane).toHaveBeenCalledWith("rdp-tab-1");
  });

  it("touch: leads with the back-to-conversations button", () => {
    touchState.isTouchDevice = true;
    const { getByTestId } = renderPane();
    expect(getByTestId("remote-pane-back-to-list")).toBeTruthy();
  });

  it("telnet uses the same bar", () => {
    const { getByTestId } = renderPane({ protocol: "telnet", tabId: "tn-1" });
    const dt = makeDataTransfer();
    fireEvent.dragStart(getByTestId("remote-pane-bar"), { dataTransfer: dt });
    expect(JSON.parse(dt.getData("application/x-skynet-badge")).descriptor.tabType).toBe(
      "telnet",
    );
  });
});

describe("RemotePane bar menu", () => {
  it("desktop: kebab lists Move to new tab, Close", async () => {
    const { container } = renderPane({ onCloseTab: vi.fn() });
    expect(itemLabels(await openKebab(container))).toEqual(["Move to new tab", "Close"]);
  });

  it("mobile: no kebab at all (nothing to put in it)", () => {
    mobileState.isMobile = true;
    const { container } = renderPane({ onCloseTab: vi.fn() });
    expect(container.querySelector('[data-testid="remote-pane-kebab-trigger"]')).toBeNull();
  });

  it("Close closes this pane", async () => {
    const onCloseTab = vi.fn();
    const { container } = renderPane({ onCloseTab });
    clickItem(await openKebab(container), "Close");
    expect(onCloseTab).toHaveBeenCalledWith("rdp-tab-1");
  });

  it("Move to new tab opens an rdp workspace window and closes this pane", async () => {
    const onCloseTab = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const { container } = renderPane({ onCloseTab });
    clickItem(await openKebab(container), "Move to new tab");
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0]).startsWith("#")).toBe(true);
    expect(open.mock.calls[0][1]).toBe("_blank");
    expect(onCloseTab).toHaveBeenCalledWith("rdp-tab-1");
  });

  it("Move to new tab keeps the pane when the popup is blocked", async () => {
    const onCloseTab = vi.fn();
    vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = renderPane({ onCloseTab });
    clickItem(await openKebab(container), "Move to new tab");
    expect(onCloseTab).not.toHaveBeenCalled();
  });
});
