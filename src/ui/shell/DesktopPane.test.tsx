/**
 * DesktopPane — an agent's virtual desktop as a split-view leaf.
 *
 * Covers: agent-name title + view-only subtitle, the live view-only display,
 * whole-bar drag writing the badge payload with a desktop descriptor (cross-
 * window drops reopen it), Take control / Hand back from the bar, control
 * handed back when the pane closes, the stopped notice staying in the pane,
 * and the menu (Move to new tab + Close — no Open in modal; phone: no ⋮).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mobileState = { isMobile: false };
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobileState.isMobile }));
const touchState = { isTouchDevice: false };
vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => touchState.isTouchDevice,
  isTouchDeviceNow: () => touchState.isTouchDevice,
}));
vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({
    byKey: new Map(),
    byHostKey: new Map([["7::sahara", { identityKey: "sahara", displayName: "Sahara", hostId: 7 }]]),
  }),
}));

const connectDesktop = vi.fn();
const takeDesktopControl = vi.fn();
const releaseDesktopControl = vi.fn();
vi.mock("@/api/workspace-desktop-api", () => ({
  connectDesktop: (...a: unknown[]) => connectDesktop(...a),
  startDesktop: vi.fn(),
  getDesktopStatus: vi.fn(),
  takeDesktopControl: (...a: unknown[]) => takeDesktopControl(...a),
  renewDesktopControl: vi.fn().mockResolvedValue({ ok: true }),
  releaseDesktopControl: (...a: unknown[]) => releaseDesktopControl(...a),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
const displayProps: Array<{ viewOnly: boolean; connectionConfig: { token: string } }> = [];
vi.mock("@/features/guacamole/GuacamoleDisplay", () => ({
  GuacamoleDisplay: (props: { viewOnly: boolean; connectionConfig: { token: string } }) => {
    displayProps.push(props);
    return <div data-testid="guac-display" />;
  },
}));

import { DesktopPane } from "./DesktopPane";
import { DESKTOP_BACK_EVENT } from "./desktop-drag";

const view = { token: "view", geometry: "1280x800", userHasControl: false };
const drive = { token: "drive", geometry: "1280x800", userHasControl: true };

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

function renderPane(props: Partial<React.ComponentProps<typeof DesktopPane>> = {}) {
  return render(
    <DesktopPane hostId={7} identityKey="sahara" tabId="desk-1" isVisible {...props} />,
  );
}

async function menuLabels(container: HTMLElement): Promise<string[]> {
  const trigger = container.querySelector('[data-testid="desktop-pane-kebab-trigger"]') as HTMLElement;
  await userEvent.setup().click(trigger);
  return Array.from(screen.getByRole("menu").querySelectorAll('[role="menuitem"]')).map(
    (el) => el.textContent?.trim() ?? "",
  );
}

beforeEach(() => {
  mobileState.isMobile = false;
  touchState.isTouchDevice = false;
  connectDesktop.mockReset().mockResolvedValue(view);
  takeDesktopControl.mockReset().mockResolvedValue(drive);
  releaseDesktopControl.mockReset().mockResolvedValue({ ok: true });
  displayProps.length = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DesktopPane", () => {
  it("shows the agent's name, says view only, and streams view-only", async () => {
    const { getByTestId } = renderPane();
    await screen.findByTestId("guac-display");
    expect(connectDesktop).toHaveBeenCalledWith("sahara", 7);
    expect(getByTestId("desktop-pane-title").textContent).toContain("Sahara");
    expect(getByTestId("desktop-pane-subtitle").textContent).toBe("Desktop · View only");
    expect(displayProps[displayProps.length - 1].viewOnly).toBe(true);
  });

  it("whole bar drags with the badge payload + a desktop descriptor", () => {
    const { getByTestId } = renderPane();
    const dt = makeDataTransfer();
    fireEvent.dragStart(getByTestId("desktop-pane-bar"), { dataTransfer: dt });
    expect(dt.getData("text/plain")).toBe("desk-1");
    const payload = JSON.parse(dt.getData("application/x-skynet-badge"));
    expect(payload.identityKey).toBeNull();
    expect(payload.descriptor).toEqual({
      tabType: "desktop",
      desktop: { hostId: 7, identityKey: "sahara" },
      label: "Sahara",
    });
  });

  it("takes control from the bar, then hands back", async () => {
    const { getByTestId } = renderPane();
    await screen.findByTestId("guac-display");
    fireEvent.click(getByTestId("desktop-pane-take-control"));
    await screen.findByTestId("desktop-pane-hand-back");
    expect(takeDesktopControl).toHaveBeenCalledWith("sahara", 7);
    expect(getByTestId("desktop-pane-subtitle").textContent).toContain("You have control");
    expect(displayProps[displayProps.length - 1].viewOnly).toBe(false);

    fireEvent.click(getByTestId("desktop-pane-hand-back"));
    await screen.findByTestId("desktop-pane-take-control");
    expect(releaseDesktopControl).toHaveBeenCalledWith("sahara", 7);
    await waitFor(() => expect(displayProps[displayProps.length - 1].viewOnly).toBe(true));
  });

  it("closing the pane while in control hands back", async () => {
    const { getByTestId, unmount } = renderPane();
    await screen.findByTestId("guac-display");
    fireEvent.click(getByTestId("desktop-pane-take-control"));
    await screen.findByTestId("desktop-pane-hand-back");
    unmount();
    expect(releaseDesktopControl).toHaveBeenCalledWith("sahara", 7);
  });

  it("a stopped desktop keeps the pane with its Start button", async () => {
    connectDesktop.mockRejectedValue(new Error("not_running"));
    renderPane();
    expect(await screen.findByTestId("desktop-start")).toBeTruthy();
    expect(screen.getByTestId("desktop-pane-take-control")).toHaveProperty("disabled", true);
  });

  it("menu is Move to new tab + Close", async () => {
    const onCloseTab = vi.fn();
    const { container } = renderPane({ onCloseTab });
    expect(await menuLabels(container)).toEqual(["Move to new tab", "Close"]);
    fireEvent.click(screen.getByText("Close"));
    expect(onCloseTab).toHaveBeenCalledWith("desk-1");
  });

  it("Move to new tab opens the desktop alone in a new tab and closes this pane", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const onCloseTab = vi.fn();
    const { container } = renderPane({ onCloseTab });
    await menuLabels(container);
    fireEvent.click(screen.getByText("Move to new tab"));
    expect(open.mock.calls[0][0]).toContain("tab=desktop%3A7%3Asahara");
    expect(open.mock.calls[0][0]).toContain("only=1");
    expect(onCloseTab).toHaveBeenCalledWith("desk-1");
  });

  it("no ⋮ on a phone", () => {
    mobileState.isMobile = true;
    const { container } = renderPane({ onCloseTab: vi.fn() });
    expect(container.querySelector('[data-testid="desktop-pane-kebab-trigger"]')).toBeNull();
  });

  it("touch screen, in control: mode switch, keyboard button and the key strip", async () => {
    touchState.isTouchDevice = true;
    const { getByTestId, queryByTestId } = renderPane();
    await screen.findByTestId("guac-display");
    // Watching: none of it.
    expect(queryByTestId("desktop-pane-touch-mode")).toBeNull();
    expect(queryByTestId("desktop-pane-keyboard")).toBeNull();
    expect(queryByTestId("key-strip")).toBeNull();
    fireEvent.click(getByTestId("desktop-pane-take-control"));
    await screen.findByTestId("desktop-pane-hand-back");
    expect(getByTestId("desktop-pane-touch-mode")).toBeTruthy();
    expect(getByTestId("desktop-pane-keyboard")).toBeTruthy();
    expect(getByTestId("key-strip")).toBeTruthy();
  });

  it("on a phone, back returns to the agent's conversation, not the list", async () => {
    touchState.isTouchDevice = true;
    vi.stubGlobal("screen", { width: 390, height: 844 });
    const backs: unknown[] = [];
    const onBack = (e: Event) => backs.push((e as CustomEvent).detail);
    window.addEventListener(DESKTOP_BACK_EVENT, onBack);
    try {
      const { getByTestId } = renderPane();
      const btn = getByTestId("desktop-pane-back-to-list");
      expect(btn.getAttribute("aria-label")).toBe("Back to conversation");
      fireEvent.click(btn);
      expect(backs).toEqual([{ tabId: "desk-1" }]);
    } finally {
      window.removeEventListener(DESKTOP_BACK_EVENT, onBack);
      vi.unstubAllGlobals();
    }
  });

  it("on a tablet, back goes to the conversation list as before", () => {
    touchState.isTouchDevice = true;
    vi.stubGlobal("screen", { width: 820, height: 1180 });
    try {
      const { getByTestId } = renderPane();
      expect(getByTestId("desktop-pane-back-to-list").getAttribute("aria-label")).toBe(
        "Back to conversations",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("on a phone the bar menu offers no new tab or close, even held sideways", () => {
    touchState.isTouchDevice = true;
    vi.stubGlobal("screen", { width: 844, height: 390 });
    try {
      const { container } = renderPane({ onCloseTab: vi.fn() });
      expect(container.querySelector('[data-testid="desktop-pane-kebab-trigger"]')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("no touch screen: in control shows no touch controls or key strip", async () => {
    const { getByTestId, queryByTestId } = renderPane();
    await screen.findByTestId("guac-display");
    fireEvent.click(getByTestId("desktop-pane-take-control"));
    await screen.findByTestId("desktop-pane-hand-back");
    expect(queryByTestId("desktop-pane-touch-mode")).toBeNull();
    expect(queryByTestId("desktop-pane-keyboard")).toBeNull();
    expect(queryByTestId("key-strip")).toBeNull();
  });
});
