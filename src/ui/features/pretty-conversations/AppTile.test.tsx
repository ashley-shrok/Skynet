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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { AppTile } from "./AppTile";
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
  it("H: right-click opens PrettyConversationContextMenu with exactly one 'Open in new tab' item", () => {
    render(<AppTile app={makeApp()} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });

    // No menu yet.
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(tile);

    const menu = screen.getByRole("menu");
    expect(menu).not.toBeNull();
    // Exactly one menuitem, labelled "Open in new tab".
    const items = menu.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe("Open in new tab");
  });

  it("I: clicking 'Open in new tab' calls window.open with (url, '_blank', 'noopener,noreferrer')", () => {
    render(<AppTile app={makeApp({ hostId: "1", slug: "scratch" })} />);
    const tile = screen.getByRole("button", { name: /App tile: Scratch/ });

    fireEvent.contextMenu(tile);
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
