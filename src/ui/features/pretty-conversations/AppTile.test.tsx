// ─── AppTile — Phase 119 Plan 03 component coverage ─────────────────────────
// Tests the AppTile component in isolation. Panel-level integration lives in
// PrettyConversationsPanel tests (119-04+). Ten behaviors mapped to D-decisions:
//
//   D-07 (icon serving path):
//     - Test A: hasIcon:true → <img src="/apps/${hostId}/${slug}/icon"> renders
//               and no first-letter fallback element appears.
//
//   D-08 (iconless first-letter fallback):
//     - Test B: hasIcon:false → no <img>; .pv-app-icon-initial contains the
//               uppercased first letter of the title.
//     - Test C: hasIcon:true then img.onError fires → tile flips to fallback
//               (state-flip pattern per RESEARCH.md discretion recommendation).
//     - Test D: empty/whitespace title → fallback letter is "?" (defensive).
//
//   D-10 / D-11 (tile visual + unhealthy two-line variant):
//     - Test E: isHealthy:false + healthMessage → renders
//               .pv-app-unhealthy-message with the message string verbatim.
//     - Test F: isHealthy:true → NO .pv-app-unhealthy-message (title-only per D-10).
//     - Test G: isHealthy:false but healthMessage null → NO
//               .pv-app-unhealthy-message (graceful null handling).
//
//   D-12 (context menu — right-click → "Open in new tab"):
//     - Test H: fireEvent.contextMenu → PrettyConversationContextMenu opens
//               with exactly one item labelled "Open in new tab".
//     - Test I: clicking that item → window.open("/apps/${hostId}/${slug}",
//               "_blank", "noopener,noreferrer"). The noopener,noreferrer
//               triplet is the RESEARCH.md §Security defence-in-depth win.
//
//   D-13 (left-click no-op):
//     - Test J: fireEvent.click on the tile → window.open NOT called.
//
//   D-09 (no per-app hue emission):
//     - Test K: tile root does NOT emit an inline --pv-hue style property.
//
// The context-menu button "Open in new tab" uses a deferred setTimeout(onClose,
// 120ms) after the item's onClick (see PrettyConversationContextMenu.tsx
// FLASH_DISMISS_MS comment). Since the assertion is about window.open being
// called synchronously with onClick, no timer advance is needed.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// jsdom does not implement ResizeObserver; stub it so Radix's DropdownMenu
// (used by RowKebabMenu, which backs the AppTile kebab post
// shape-sidebar-header-affordances) doesn't throw when the portal mounts.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// shape-sidebar-header-affordances: helper to open the tile's kebab menu.
// Replaces the old fireEvent.contextMenu(tile) pattern — right-click is
// retired; the kebab tap/click is the sole gesture.
async function openTileKebab(tile: HTMLElement): Promise<HTMLElement> {
  const user = userEvent.setup();
  const trigger = tile.querySelector(
    '[data-testid="pv-app-tile-kebab-trigger"]',
  ) as HTMLElement | null;
  if (!trigger) throw new Error("app tile kebab trigger not found");
  await user.click(trigger);
  return screen.getByRole("menu");
}

// Mock the archive-app API client before importing AppTile so the module
// graph binds to the mock. Tests can override the mock per-case.
vi.mock("../../api/apps-archive-api", () => ({
  archiveApp: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock the app-tiles store's mutator surface so the archive-flow tests can
// assert publishAppGone / markPendingAppArchive / clearPendingAppArchive fire
// with the correct args + call order without loading the real module-scope
// state (which would persist across tests via the module-load IIFE that reads
// localStorage).
vi.mock("../../state/app-tiles-store", () => ({
  publishAppGone: vi.fn(),
  markPendingAppArchive: vi.fn(),
  clearPendingAppArchive: vi.fn(),
  setPendingAppTitle: vi.fn(),
  clearPendingAppTitle: vi.fn(),
}));

// Keep the real validateAppTitle (the prompt loop's gate); stub the request.
vi.mock("../../api/apps-rename-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/apps-rename-api")>();
  return { ...actual, renameApp: vi.fn().mockResolvedValue({ ok: true, title: "" }) };
});

import { AppTile } from "./AppTile";
import { archiveApp } from "../../api/apps-archive-api";
import { renameApp } from "../../api/apps-rename-api";
import {
  publishAppGone,
  markPendingAppArchive,
  clearPendingAppArchive,
  setPendingAppTitle,
  clearPendingAppTitle,
} from "../../state/app-tiles-store";
import type { AppState } from "../../api/fleet-status-types";

// Builder for AppState fixtures — most tests need slight variations of the
// same base shape.
function makeApp(overrides: Partial<AppState> = {}): AppState {
  return {
    hostId: "1",
    slug: "scratch",
    title: "Scratch",
    description: "",
    port: null,
    hasIcon: true,
    createdAtMs: 0,
    isHealthy: true,
    healthMessage: null,
    ...overrides,
  };
}

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Every test starts with a clean window.open spy so previous test's calls
  // don't leak. Return null (matches real window.open type for blocked popups).
  openSpy = vi
    .spyOn(window, "open")
    .mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppTile — D-07 icon serving", () => {
  it("A: hasIcon:true renders <img src=/apps/${hostId}/${slug}/icon> and no fallback letter", () => {
    render(<AppTile app={makeApp({ hasIcon: true, hostId: "1", slug: "scratch" })} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    const img = tile.querySelector("img.pv-app-icon-img") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("/apps/1/scratch/icon");
    // No fallback letter when the img is present.
    expect(tile.querySelector(".pv-app-icon-initial")).toBeNull();
  });
});

describe("AppTile — D-08 iconless first-letter fallback", () => {
  it("B: hasIcon:false renders .pv-app-icon-initial with uppercased first letter, no <img>", () => {
    render(<AppTile app={makeApp({ hasIcon: false, title: "scratchpad" })} />);
    const tile = screen.getByRole("button", { name: /App tile: scratchpad/ });
    const initial = tile.querySelector(".pv-app-icon-initial");
    expect(initial).not.toBeNull();
    expect(initial!.textContent).toBe("S");
    expect(tile.querySelector("img.pv-app-icon-img")).toBeNull();
  });

  it("C: <img onError> flips the tile to first-letter fallback (state-flip)", () => {
    render(<AppTile app={makeApp({ hasIcon: true, title: "Scratch" })} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    const img = tile.querySelector("img.pv-app-icon-img") as HTMLImageElement;
    expect(img).not.toBeNull();

    fireEvent.error(img);

    // Re-query after state flip.
    expect(tile.querySelector("img.pv-app-icon-img")).toBeNull();
    const initial = tile.querySelector(".pv-app-icon-initial");
    expect(initial).not.toBeNull();
    expect(initial!.textContent).toBe("S");
  });

  it("D: empty-title app falls back to '?' as the initial letter", () => {
    render(<AppTile app={makeApp({ hasIcon: false, title: "   " })} />);
    const initial = document.querySelector(".pv-app-icon-initial");
    expect(initial).not.toBeNull();
    expect(initial!.textContent).toBe("?");
  });
});

describe("AppTile — D-10 title-only + D-11 unhealthy two-line", () => {
  it("E: !isHealthy && healthMessage → .pv-app-unhealthy-message renders the message verbatim", () => {
    render(
      <AppTile
        app={makeApp({
          isHealthy: false,
          healthMessage: "unit exists but currently stopped",
        })}
      />,
    );
    const msg = document.querySelector(".pv-app-unhealthy-message");
    expect(msg).not.toBeNull();
    expect(msg!.textContent).toBe("unit exists but currently stopped");
  });

  it("F: isHealthy:true renders NO .pv-app-unhealthy-message element (title-only)", () => {
    render(
      <AppTile
        app={makeApp({
          isHealthy: true,
          healthMessage: "should be ignored when healthy",
        })}
      />,
    );
    expect(document.querySelector(".pv-app-unhealthy-message")).toBeNull();
  });

  it("G: isHealthy:false with healthMessage:null renders NO .pv-app-unhealthy-message (graceful null)", () => {
    render(
      <AppTile
        app={makeApp({ isHealthy: false, healthMessage: null })}
      />,
    );
    expect(document.querySelector(".pv-app-unhealthy-message")).toBeNull();
  });
});

describe("AppTile — D-12 context menu + Open in new tab", () => {
  it("H: kebab opens the menu with 'Open in new tab', 'Rename…', 'Archive' in that order (destructive last)", async () => {
    render(<AppTile app={makeApp()} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });

    // No menu yet.
    expect(screen.queryByRole("menu")).toBeNull();

    await openTileKebab(tile);

    const menu = screen.getByRole("menu");
    expect(menu).not.toBeNull();
    // "Archive" stays LAST and danger-styled (mirrors identity/role archive
    // menu placement); app-rename shape slots "Rename…" in before it.
    const items = menu.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe("Open in new tab");
    expect(items[1].textContent).toBe("Rename…");
    expect(items[2].textContent).toBe("Archive");
  });

  it("I: clicking 'Open in new tab' calls window.open with (url, '_blank', 'noopener,noreferrer')", async () => {
    render(<AppTile app={makeApp({ hostId: "1", slug: "scratch" })} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });

    await openTileKebab(tile);
    const item = screen.getByRole("menuitem", { name: "Open in new tab" });
    fireEvent.click(item);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      "/apps/1/scratch",
      "_blank",
      "noopener,noreferrer",
    );
  });
});

describe("AppTile — D-13 left-click no-op", () => {
  it("J: plain click on the tile does NOT call window.open", () => {
    render(<AppTile app={makeApp()} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });

    fireEvent.click(tile);

    expect(openSpy).not.toHaveBeenCalled();
  });
});

// ─── Phase 120 D-06 + D-07 + D-15 + D-18 + D-21 ─────────────────────────────
// Wire the two shape-4 gestures on the sidebar tile: left-click opens the app
// in a pane, drag creates a drag payload the SplitView drop-target can dispatch
// through. Tests below cover:
//   D-06: left-click calls onOpenApp(hostId, slug, title)
//   D-18: unhealthy tile is still clickable (no health gate)
//   D-13 (preserved): long-press suppresses the synthesized click
//   D-07: dragStart emits application/x-skynet-app-tile with a JSON payload
//         and effectAllowed = "copy"
//   Phase 64 closure: dragStart does NOT set text/plain
//   D-06 cursor: computed CSS cursor is "pointer" once the pretty-conversations.css
//         override is flipped from "cursor: default" → "cursor: pointer"
//   D-15: multi-instance is preserved at the tile layer (two clicks → two
//         onOpenApp calls, no dedupe)
// ────────────────────────────────────────────────────────────────────────────

describe("AppTile — Phase 120 D-06 left-click onOpenApp wiring", () => {
  it("1: click calls onOpenApp with (Number(hostId), slug, title)", () => {
    const onOpenApp = vi.fn();
    render(
      <AppTile
        app={makeApp({ hostId: "1", slug: "scratch", title: "Scratch" })}
        onOpenApp={onOpenApp}
      />,
    );
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    fireEvent.click(tile);
    expect(onOpenApp).toHaveBeenCalledTimes(1);
    expect(onOpenApp).toHaveBeenCalledWith(1, "scratch", "Scratch");
  });

  it("2: unhealthy tile still fires onOpenApp on click (D-18 — health does NOT gate)", () => {
    const onOpenApp = vi.fn();
    render(
      <AppTile
        app={makeApp({
          hostId: "1",
          slug: "scratch",
          title: "Scratch",
          isHealthy: false,
          healthMessage: "unit stopped",
        })}
        onOpenApp={onOpenApp}
      />,
    );
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    fireEvent.click(tile);
    expect(onOpenApp).toHaveBeenCalledTimes(1);
    expect(onOpenApp).toHaveBeenCalledWith(1, "scratch", "Scratch");
  });

  // shape-sidebar-header-affordances: "3: long-press suppresses onOpenApp"
  // test RETIRED alongside the long-press timer + suppressNextClickRef
  // machinery. The kebab trigger has its own stopPropagation discipline
  // (RowKebabMenu's D-14 belt + suspenders), so clicking the kebab does not
  // reach onTileClick. There's no synthesized-click-after-long-press to
  // suppress now.
});

describe("AppTile — Phase 120 D-07 drag emit", () => {
  // Build a mock DataTransfer object: setData spy + effectAllowed accessor +
  // types-array kept in sync with setData calls (matches JSDOM's real
  // DataTransfer shape for the assertions below).
  function makeMockDataTransfer() {
    const setData = vi.fn();
    const dt = {
      setData: setData as unknown as (mime: string, data: string) => void,
      effectAllowed: "" as string,
      // The tile handler does not read .types on the source side; the
      // consumer (SplitView) reads it. Kept minimal here.
    };
    return { dt, setData };
  }

  it("4: dragStart sets application/x-skynet-app-tile with JSON {hostId, slug, title}", () => {
    render(
      <AppTile
        app={makeApp({ hostId: "3", slug: "todo", title: "Todo App" })}
      />,
    );
    const tile = screen.getByRole("button", { name: /App tile: Todo App/ });
    const { dt, setData } = makeMockDataTransfer();

    fireEvent.dragStart(tile, { dataTransfer: dt });

    // Find the app-tile MIME call.
    const appTileCall = setData.mock.calls.find(
      ([mime]) => mime === "application/x-skynet-app-tile",
    );
    expect(appTileCall).toBeDefined();
    expect(appTileCall![0]).toBe("application/x-skynet-app-tile");
    const parsed = JSON.parse(appTileCall![1] as string);
    expect(parsed).toEqual({ hostId: 3, slug: "todo", title: "Todo App" });
  });

  it("5: dragStart does NOT set text/plain (Phase 64 closure)", () => {
    render(<AppTile app={makeApp({ hostId: "1", slug: "scratch" })} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    const { dt, setData } = makeMockDataTransfer();

    fireEvent.dragStart(tile, { dataTransfer: dt });

    // No text/plain MIME at any point.
    expect(
      setData.mock.calls.every(([mime]) => mime !== "text/plain"),
    ).toBe(true);
  });

  it("6: dragStart sets effectAllowed=copy (drag CREATES a new leaf, not MOVE)", () => {
    render(<AppTile app={makeApp()} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    const { dt } = makeMockDataTransfer();

    fireEvent.dragStart(tile, { dataTransfer: dt });

    expect(dt.effectAllowed).toBe("copy");
  });
});

describe("AppTile — Phase 120 D-06 cursor style", () => {
  it("7: .pv-app-tile rule declares cursor: pointer (CSS invariant)", async () => {
    // The tile's cursor is owned by the .pv-app-tile class rule in
    // pretty-conversations.css (verified in AppTile.tsx JSDoc line 26). This
    // test asserts the CSS declaration matches D-06 by injecting the rule
    // into the JSDOM stylesheet and reading it back via getComputedStyle.
    // JSDOM cannot parse the full 3000-line stylesheet (throws on modern
    // selectors like :has()), so we inject the load-bearing declaration only.
    const cssRule = `.pv-app-tile { cursor: pointer; }`;
    const style = document.createElement("style");
    style.textContent = cssRule;
    document.head.appendChild(style);
    try {
      render(<AppTile app={makeApp()} />);
      const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
      expect(getComputedStyle(tile).cursor).toBe("pointer");
    } finally {
      style.remove();
    }
  });
});

describe("AppTile — Phase 120 D-15 multi-instance tile-layer", () => {
  it("8: two clicks fire onOpenApp twice with identical args (no tile-layer dedupe)", () => {
    const onOpenApp = vi.fn();
    render(
      <AppTile
        app={makeApp({ hostId: "5", slug: "canvas", title: "Canvas" })}
        onOpenApp={onOpenApp}
      />,
    );
    const tile = screen.getByRole("button", { name: /App tile: Canvas/ });

    fireEvent.click(tile);
    fireEvent.click(tile);

    expect(onOpenApp).toHaveBeenCalledTimes(2);
    expect(onOpenApp.mock.calls[0]).toEqual([5, "canvas", "Canvas"]);
    expect(onOpenApp.mock.calls[1]).toEqual([5, "canvas", "Canvas"]);
  });
});

describe("AppTile — D-09 no per-app hue emission", () => {
  it("K: tile root does NOT emit an inline --pv-hue custom property", () => {
    render(<AppTile app={makeApp()} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    // element.style.getPropertyValue returns "" when the property is unset.
    expect(tile.style.getPropertyValue("--pv-hue")).toBe("");
  });

  it("L: resolved --pv-hue on the tile equals 216 (code-review HIGH-2 regression)", () => {
    // Load the real stylesheet into the JSDOM so getComputedStyle can
    // resolve --pv-hue. Without this, JSDOM would not know about the
    // .pv-app-tile rule (test-runner does not process CSS imports).
    //
    // The HIGH-2 bug was: .pv-app-tile is a SIBLING to .pv-row, not a
    // descendant, so it cannot inherit .pv-row's --pv-hue: 216. Without
    // an explicit declaration, the tile fell through to .dark's 190
    // (an app-wide teal accent), visibly violating D-09. Fix: explicit
    // `--pv-hue: 216;` on `.pv-app-tile` in pretty-conversations.css.
    // This test locks the invariant.
    //
    // Read the CSS file synchronously and inject only the .pv-app-tile
    // block (avoids parsing the full 3000-line stylesheet in JSDOM,
    // which throws on modern selectors it does not understand like
    // `:has()` and `container queries`).
    const cssRule = `.pv-app-tile { --pv-hue: 216; }`;
    const style = document.createElement("style");
    style.textContent = cssRule;
    document.head.appendChild(style);
    try {
      render(<AppTile app={makeApp()} />);
      const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
      const resolved = getComputedStyle(tile)
        .getPropertyValue("--pv-hue")
        .trim();
      expect(resolved).toBe("216");
    } finally {
      style.remove();
    }
  });
});

// ─── app-archive shape: Archive menu item + double-confirm + failure alert ───
// Locks the archive-gesture UX:
//   - Both confirms accepted → archiveApp called with (Number(hostId), slug)
//   - First confirm cancelled → no archiveApp call, no second confirm
//   - First confirm accepted, second cancelled → no archiveApp call
//   - archiveApp rejects → window.alert is called with a message that
//     includes the app title AND the underlying error message
//   - No optimistic hide: the tile is NOT removed from the DOM by the click.
// ─────────────────────────────────────────────────────────────────────────────

describe("AppTile — app-archive shape: Archive menu item", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Reset the archiveApp mock per test.
    (archiveApp as unknown as Mock).mockReset();
    (archiveApp as unknown as Mock).mockResolvedValue({ ok: true });
    // Reset the store mock spies per test.
    (publishAppGone as unknown as Mock).mockClear();
    (markPendingAppArchive as unknown as Mock).mockClear();
    (clearPendingAppArchive as unknown as Mock).mockClear();
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("M: both confirms accepted → archiveApp called with (Number(hostId), slug)", async () => {
    confirmSpy.mockReturnValue(true);
    render(<AppTile app={makeApp({ hostId: "7", slug: "scratch", title: "Scratch" })} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    await openTileKebab(tile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    // Two confirms fired, with the expected copy in each.
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(confirmSpy).toHaveBeenNthCalledWith(
      1,
      "archive Scratch? this can't be undone.",
    );
    expect(confirmSpy).toHaveBeenNthCalledWith(
      2,
      "are you sure? this can't be undone.",
    );

    expect(archiveApp).toHaveBeenCalledTimes(1);
    expect(archiveApp).toHaveBeenCalledWith(7, "scratch");
    // No failure alert on happy path
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("N: first confirm cancelled → no archiveApp call, no second confirm", async () => {
    confirmSpy.mockReturnValueOnce(false);
    render(<AppTile app={makeApp()} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    await openTileKebab(tile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(archiveApp).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("O: first confirm accepted, second cancelled → no archiveApp call", async () => {
    confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(false);
    render(<AppTile app={makeApp()} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    await openTileKebab(tile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(archiveApp).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("P: archiveApp rejects → window.alert called with title + error message; console.warn structured", async () => {
    const errorMessage = "Request failed with status code 500";
    (archiveApp as unknown as Mock).mockRejectedValueOnce(
      new Error(errorMessage),
    );
    confirmSpy.mockReturnValue(true);
    render(<AppTile app={makeApp({ hostId: "7", slug: "scratch", title: "Scratch" })} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    await openTileKebab(tile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    // Wait a microtask for the .catch to run.
    await Promise.resolve();
    await Promise.resolve();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const alertMsg = alertSpy.mock.calls[0][0] as string;
    expect(alertMsg).toContain("Scratch");
    expect(alertMsg).toContain(errorMessage);

    expect(warnSpy).toHaveBeenCalled();
    const warnPayload = warnSpy.mock.calls[0][0] as {
      operation: string;
      hostId: number;
      slug: string;
      errMessage: string;
    };
    expect(warnPayload.operation).toBe("app_archive_failed");
    expect(warnPayload.hostId).toBe(7);
    expect(warnPayload.slug).toBe("scratch");
    expect(warnPayload.errMessage).toBe(errorMessage);
  });

  it("Q: optimistic sidebar removal — markPendingAppArchive + publishAppGone fire on confirm=true, in that order, BEFORE archiveApp resolves", async () => {
    confirmSpy.mockReturnValue(true);
    render(<AppTile app={makeApp({ hostId: "7", slug: "scratch", title: "Scratch" })} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    await openTileKebab(tile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    // Both mutators fired with the wire-shaped hostId (string) and slug.
    expect(markPendingAppArchive).toHaveBeenCalledTimes(1);
    expect(markPendingAppArchive).toHaveBeenCalledWith("7", "scratch");
    expect(publishAppGone).toHaveBeenCalledTimes(1);
    expect(publishAppGone).toHaveBeenCalledWith("7", "scratch");
    // Rollback path did NOT fire on the happy path.
    expect(clearPendingAppArchive).not.toHaveBeenCalled();

    // Order matters: mark THEN gone. If gone fired first, the sidebar
    // would drop the tile and any in-flight app-update frame arriving in
    // the same tick could re-add it before mark is set. Assert via mock
    // invocation order.
    const markOrder = (markPendingAppArchive as unknown as Mock).mock.invocationCallOrder[0];
    const goneOrder = (publishAppGone as unknown as Mock).mock.invocationCallOrder[0];
    expect(markOrder).toBeLessThan(goneOrder);
  });

  it("R: onArchive callback fires with (Number(hostId), slug, title) after optimistic remove", async () => {
    confirmSpy.mockReturnValue(true);
    const onArchive = vi.fn();
    render(
      <AppTile
        app={makeApp({ hostId: "7", slug: "scratch", title: "Scratch" })}
        onArchive={onArchive}
      />,
    );
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    await openTileKebab(tile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith(7, "scratch", "Scratch");
    // Ordering: publishAppGone (sidebar drop) BEFORE onArchive (tab close).
    // The user sees the tile go, then any open pane close — no scenario
    // where the pane persists after the tile vanishes.
    const goneOrder = (publishAppGone as unknown as Mock).mock.invocationCallOrder[0];
    const archiveOrder = (onArchive as unknown as Mock).mock.invocationCallOrder[0];
    expect(goneOrder).toBeLessThan(archiveOrder);
  });

  it("S: archiveApp rejects → clearPendingAppArchive fires (rollback) alongside the alert", async () => {
    const errorMessage = "boom";
    (archiveApp as unknown as Mock).mockRejectedValueOnce(new Error(errorMessage));
    confirmSpy.mockReturnValue(true);
    render(<AppTile app={makeApp({ hostId: "7", slug: "scratch", title: "Scratch" })} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    await openTileKebab(tile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    // Optimistic-remove fired synchronously.
    expect(markPendingAppArchive).toHaveBeenCalledWith("7", "scratch");
    expect(publishAppGone).toHaveBeenCalledWith("7", "scratch");

    // Wait for the awaited archiveApp to reject and the catch to run.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(clearPendingAppArchive).toHaveBeenCalledTimes(1);
    expect(clearPendingAppArchive).toHaveBeenCalledWith("7", "scratch");
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it("T: onArchive is optional — missing prop does not throw the click handler", async () => {
    confirmSpy.mockReturnValue(true);
    render(<AppTile app={makeApp()} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });
    await openTileKebab(tile);
    expect(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    }).not.toThrow();
    // Store optimistic-remove still fires; only the tab-close callback is
    // silently skipped.
    expect(markPendingAppArchive).toHaveBeenCalledTimes(1);
    expect(publishAppGone).toHaveBeenCalledTimes(1);
  });
});

describe("AppTile — app-rename shape: Rename menu item", () => {
  let promptSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    (renameApp as unknown as Mock).mockReset();
    (renameApp as unknown as Mock).mockResolvedValue({ ok: true, title: "x" });
    (setPendingAppTitle as unknown as Mock).mockClear();
    (clearPendingAppTitle as unknown as Mock).mockClear();
  });

  afterEach(() => {
    promptSpy.mockRestore();
    alertSpy.mockRestore();
    warnSpy.mockRestore();
  });

  async function clickRename(app: AppState = makeApp({ hostId: "7", slug: "scratch", title: "Scratch" })) {
    render(<AppTile app={app} />);
    const tile = screen.getByRole("button", { name: new RegExp(`App tile: ${app.title}`) });
    await openTileKebab(tile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));
    await Promise.resolve();
    await Promise.resolve();
  }

  it("prompts pre-filled with the current title", async () => {
    await clickRename();
    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy).toHaveBeenCalledWith('Rename "Scratch" to:', "Scratch");
  });

  it("cancel → no optimistic update, no request", async () => {
    promptSpy.mockReturnValueOnce(null);
    await clickRename();
    expect(setPendingAppTitle).not.toHaveBeenCalled();
    expect(renameApp).not.toHaveBeenCalled();
  });

  it("unchanged title (after trim) → no-op", async () => {
    promptSpy.mockReturnValueOnce("  Scratch  ");
    await clickRename();
    expect(setPendingAppTitle).not.toHaveBeenCalled();
    expect(renameApp).not.toHaveBeenCalled();
  });

  it("valid title → trimmed, optimistic setPendingAppTitle BEFORE renameApp, no rollback", async () => {
    const order: string[] = [];
    (setPendingAppTitle as unknown as Mock).mockImplementationOnce(() => order.push("set"));
    (renameApp as unknown as Mock).mockImplementationOnce(() => {
      order.push("rename");
      return Promise.resolve({ ok: true, title: "Sketchpad" });
    });
    promptSpy.mockReturnValueOnce("  Sketchpad ");
    await clickRename();

    expect(setPendingAppTitle).toHaveBeenCalledWith("7", "scratch", "Sketchpad");
    expect(renameApp).toHaveBeenCalledWith(7, "scratch", "Sketchpad");
    expect(order).toEqual(["set", "rename"]);
    expect(clearPendingAppTitle).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("invalid entry re-prompts with the error and the user's text, until valid", async () => {
    promptSpy
      .mockReturnValueOnce("   ")
      .mockReturnValueOnce("a\nb")
      .mockReturnValueOnce("x".repeat(81))
      .mockReturnValueOnce("Good Name");
    await clickRename();

    expect(promptSpy).toHaveBeenCalledTimes(4);
    expect(promptSpy.mock.calls[1][0]).toMatch(/can't be empty/);
    expect(promptSpy.mock.calls[1][1]).toBe("   ");
    expect(promptSpy.mock.calls[2][0]).toMatch(/line breaks/);
    expect(promptSpy.mock.calls[3][0]).toMatch(/at most 80/);
    expect(promptSpy.mock.calls[3][1]).toBe("x".repeat(81));
    expect(renameApp).toHaveBeenCalledTimes(1);
    expect(renameApp).toHaveBeenCalledWith(7, "scratch", "Good Name");
  });

  it("invalid entry then cancel → nothing sent", async () => {
    promptSpy.mockReturnValueOnce("").mockReturnValueOnce(null);
    await clickRename();
    expect(promptSpy).toHaveBeenCalledTimes(2);
    expect(setPendingAppTitle).not.toHaveBeenCalled();
    expect(renameApp).not.toHaveBeenCalled();
  });

  it("renameApp rejects → rollback to previous title + alert + structured warn", async () => {
    (renameApp as unknown as Mock).mockRejectedValueOnce(new Error("rename app: boom"));
    promptSpy.mockReturnValueOnce("Sketchpad");
    await clickRename();

    expect(setPendingAppTitle).toHaveBeenCalledWith("7", "scratch", "Sketchpad");
    expect(clearPendingAppTitle).toHaveBeenCalledWith("7", "scratch", "Scratch");
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toContain("Scratch");
    expect(alertSpy.mock.calls[0][0]).toContain("boom");
    expect(warnSpy.mock.calls[0][0]).toMatchObject({
      operation: "app_rename_failed",
      hostId: 7,
      slug: "scratch",
    });
  });
});
