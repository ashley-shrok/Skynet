/**
 * App bar menu — the ⋮ kebab + right-click on an open app pane's bar, the
 * app-pane counterpart of the IdentityBadge menu. Covers item set + order on
 * desktop and mobile, Close, Move to new window (incl. popup blocked), the
 * shared Archive flow closing panes via onArchiveApp, right-click opening the
 * same menu, and a kebab click never selecting the pane.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const mobileState = { isMobile: false };
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileState.isMobile,
}));

vi.mock("@/api/apps-archive-api", () => ({
  archiveApp: vi.fn().mockResolvedValue({ ok: true }),
}));

import { AppPane } from "./AppPane";
import { archiveApp } from "@/api/apps-archive-api";

async function openKebab(container: HTMLElement): Promise<HTMLElement> {
  const trigger = container.querySelector(
    '[data-testid="app-pane-kebab-trigger"]',
  ) as HTMLElement | null;
  if (!trigger) throw new Error("app bar kebab trigger not found");
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(archiveApp).mockClear();
});

describe("AppPane bar menu", () => {
  it("desktop: kebab lists Move to new window, Open standalone, Rename…, Close, Archive", async () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible onCloseTab={vi.fn()} />,
    );
    const menu = await openKebab(container);
    expect(itemLabels(menu)).toEqual([
      "Move to new window",
      "Open standalone",
      "Rename…",
      "Close",
      "Archive",
    ]);
  });

  it("mobile: no Move to new window or Close", async () => {
    mobileState.isMobile = true;
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible onCloseTab={vi.fn()} />,
    );
    const menu = await openKebab(container);
    expect(itemLabels(menu)).toEqual(["Open standalone", "Rename…", "Archive"]);
  });

  it("Close closes this pane", async () => {
    const onCloseTab = vi.fn();
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible onCloseTab={onCloseTab} />,
    );
    clickItem(await openKebab(container), "Close");
    expect(onCloseTab).toHaveBeenCalledWith("t1");
  });

  it("Move to new window opens an app workspace window and closes this pane", async () => {
    const onCloseTab = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible onCloseTab={onCloseTab} />,
    );
    clickItem(await openKebab(container), "Move to new window");
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0]).startsWith("#")).toBe(true);
    expect(open.mock.calls[0][1]).toBe("_blank");
    expect(onCloseTab).toHaveBeenCalledWith("t1");
  });

  it("Move to new window keeps the pane when the popup is blocked", async () => {
    const onCloseTab = vi.fn();
    vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible onCloseTab={onCloseTab} />,
    );
    clickItem(await openKebab(container), "Move to new window");
    expect(onCloseTab).not.toHaveBeenCalled();
  });

  it("Open standalone opens the app's own URL with the tabnabbing guard", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(<AppPane hostId={1} slug="todo" tabId="t1" isVisible />);
    clickItem(await openKebab(container), "Open standalone");
    expect(open).toHaveBeenCalledWith("/apps/1/todo", "_blank", "noopener,noreferrer");
  });

  it("Archive (both confirms accepted) closes the app's panes and archives it", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onArchiveApp = vi.fn();
    const { container } = render(
      <AppPane
        hostId={1}
        slug="todo"
        tabId="t1"
        isVisible
        label="Todo"
        onArchiveApp={onArchiveApp}
      />,
    );
    clickItem(await openKebab(container), "Archive");
    await vi.waitFor(() => expect(archiveApp).toHaveBeenCalledWith(1, "todo"));
    expect(onArchiveApp).toHaveBeenCalledWith(1, "todo", "Todo");
  });

  it("Archive declined does nothing", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onArchiveApp = vi.fn();
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible onArchiveApp={onArchiveApp} />,
    );
    clickItem(await openKebab(container), "Archive");
    expect(onArchiveApp).not.toHaveBeenCalled();
    expect(archiveApp).not.toHaveBeenCalled();
  });

  it("right-click on the bar opens the same menu", () => {
    const { getByTestId } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible onCloseTab={vi.fn()} />,
    );
    fireEvent.contextMenu(getByTestId("app-pane-bar"), { clientX: 50, clientY: 10 });
    expect(itemLabels(screen.getByRole("menu"))).toEqual([
      "Move to new window",
      "Open standalone",
      "Rename…",
      "Close",
      "Archive",
    ]);
  });

  it("clicking the kebab does not select the pane", async () => {
    const onSelectPane = vi.fn();
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible onSelectPane={onSelectPane} />,
    );
    await openKebab(container);
    expect(onSelectPane).not.toHaveBeenCalled();
  });
});
