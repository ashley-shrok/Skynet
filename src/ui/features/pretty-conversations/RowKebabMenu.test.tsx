import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";

// ─── Phase 143 Plan 143-05 Task 3 — RowKebabMenu component ──────────────────
//
// Four cases covering D-12 (visual tokens), D-13 (popover-even-when-single-item),
// D-14 (stop-propagation on trigger click), and the item callback wiring.
//
// Radix DropdownMenu mounts its portal into document.body — use `screen` (not
// `container`) to query portal-mounted content. Radix requires pointer-events on
// the trigger for its internal open logic; fireEvent.click dispatches the
// synthetic click which Radix picks up through its own event bridge.

import {
  RowKebabMenu,
  type RowKebabMenuItem,
} from "@/features/pretty-conversations/RowKebabMenu";

// jsdom does not implement ResizeObserver; stub it so Radix's content doesn't
// throw when the portal mounts.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Radix Popper / DOMRect stub: jsdom returns zeros for getBoundingClientRect,
// which causes Radix to place the popover at position 0 — that's fine for tests.

describe("Phase 143 Plan 143-05 Task 3 — RowKebabMenu", () => {
  beforeEach(() => {
    // Clean up any portals from previous tests.
    document.body.innerHTML = "";
  });

  // Test 1 (renders the trigger with D-12 tokens):
  //   Render <RowKebabMenu items={[…]} />, assert the trigger button exists
  //   and its className contains the exact D-12 token substring.
  //   D-12 revised 2026-10-01 (UAT item 1): bumped for prominence.
  it("Test 1 (D-12 tokens): trigger button exists and carries D-12 visual token classes", () => {
    render(
      <RowKebabMenu
        items={[{ label: "Archive", onClick: () => {} }]}
      />,
    );

    const trigger = screen.getByTestId("row-kebab-trigger");
    expect(trigger).toBeTruthy();
    expect(trigger.className).toContain("size-6");
    expect(trigger.className).toContain("bg-white/10");
    expect(trigger.className).toContain("hover:bg-white/20");
    expect(trigger.className).toContain("text-white/80");
    expect(trigger.className).toContain("hover:text-white");
    expect(trigger.className).toContain("inline-flex");
    expect(trigger.className).toContain("items-center");
    expect(trigger.className).toContain("justify-center");
    expect(trigger.className).toContain("rounded-md");
    expect(trigger.className).toContain("shrink-0");
    expect(trigger.className).toContain("transition-colors");
  });

  // Test 2 (opens popover on trigger click, renders items):
  //   Click the trigger using userEvent (dispatches full pointer event sequence
  //   so Radix's internal state machine transitions open).
  //   Radix portal-renders the menu into document.body — screen traverses it.
  it("Test 2 (D-13 popover): clicking trigger opens menu and shows 'Archive' item", async () => {
    const user = userEvent.setup();
    render(
      <RowKebabMenu
        items={[{ label: "Archive", onClick: () => {} }]}
      />,
    );

    const trigger = screen.getByTestId("row-kebab-trigger");
    await user.click(trigger);

    // Radix renders into a portal on document.body — findByText traverses it.
    const item = await screen.findByText("Archive");
    expect(item).toBeTruthy();
  });

  // Test 3 (item click fires the callback exactly once):
  //   Open the menu; click the "Archive" item; assert the fn was called once.
  it("Test 3 (callback wiring): clicking an item calls its onClick once", async () => {
    const user = userEvent.setup();
    const onClickSpy = vi.fn();

    render(
      <RowKebabMenu
        items={[{ label: "Archive", onClick: onClickSpy }]}
      />,
    );

    const trigger = screen.getByTestId("row-kebab-trigger");
    await user.click(trigger);

    const item = await screen.findByText("Archive");
    await user.click(item);

    expect(onClickSpy).toHaveBeenCalledTimes(1);
  });

  // Test 4 (D-14 stop-propagation on trigger click):
  //   Wrap the kebab in a parent div with a click spy. Click the trigger.
  //   The parent spy must NOT have been called.
  it("Test 4 (D-14 stop-propagation): clicking trigger does NOT propagate to parent", () => {
    const parentSpy = vi.fn();

    render(
      <div onClick={parentSpy}>
        <RowKebabMenu
          items={[{ label: "Archive", onClick: () => {} }]}
        />
      </div>,
    );

    const trigger = screen.getByTestId("row-kebab-trigger");
    fireEvent.click(trigger);

    expect(parentSpy).not.toHaveBeenCalled();
  });

  // Test 5 (D-14 revised 2026-10-01, UAT item 2 regression):
  //   Clicking an ITEM inside the dropdown menu must NOT propagate up through
  //   the React tree to the parent's onClick handler. React synthetic events
  //   from portal-mounted content bubble through the React tree (not the DOM
  //   tree), so the parent row's onClick is reachable from a menu-item click
  //   unless the dropdown stops propagation explicitly.
  //
  //   Repro before fix: user clicked "Archive" in the kebab menu, confirmed
  //   the native confirm, and the row-behind's onClick fired (opening the
  //   RoleModal on the role being archived).
  it("Test 5 (D-14 item-click stop-propagation): clicking a menu item does NOT propagate to React-tree parent", async () => {
    const user = userEvent.setup();
    const parentSpy = vi.fn();
    const itemSpy = vi.fn();

    render(
      <div onClick={parentSpy}>
        <RowKebabMenu items={[{ label: "Archive", onClick: itemSpy }]} />
      </div>,
    );

    const trigger = screen.getByTestId("row-kebab-trigger");
    await user.click(trigger);
    // Open-trigger click is already covered by Test 4; reset so this test
    // only asserts about the item-click bubble.
    parentSpy.mockClear();

    const item = await screen.findByText("Archive");
    await user.click(item);

    expect(itemSpy).toHaveBeenCalledTimes(1);
    expect(parentSpy).not.toHaveBeenCalled();
  });
});
