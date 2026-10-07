import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";

// ─── Right-click → same kebab menu ──────────────────────────────────────────
//
// useRowKebabContextMenu / RowKebabContextMenuSurface: right-clicking a
// surface opens the SAME kebab menu items at the cursor. Touch long-press,
// editable targets and empty item lists fall through to the native menu.

import {
  RowKebabMenu,
  RowKebabContextMenuSurface,
  useRowKebabContextMenu,
  type RowKebabMenuItem,
} from "@/features/pretty-conversations/RowKebabMenu";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function Row({
  items,
  onRowClick = () => {},
}: {
  items: RowKebabMenuItem[];
  onRowClick?: () => void;
}): React.JSX.Element {
  const ctx = useRowKebabContextMenu(items);
  return (
    <div data-testid="row" onClick={onRowClick} onContextMenu={ctx.onContextMenu}>
      <span data-testid="row-label">Row</span>
      <input data-testid="row-input" />
      <RowKebabMenu items={items} />
      {ctx.menu}
    </div>
  );
}

function rightClick(el: Element, init: MouseEventInit = {}): boolean {
  // fireEvent returns false when the event was preventDefault()ed.
  return fireEvent.contextMenu(el, { clientX: 120, clientY: 80, ...init });
}

describe("RowKebabMenu — right-click opens the same menu", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("right-click opens the kebab items at the cursor and suppresses the native menu", async () => {
    render(<Row items={[{ label: "Archive", onClick: () => {} }]} />);

    const notPrevented = rightClick(screen.getByTestId("row-label"));
    expect(notPrevented).toBe(false);

    expect(await screen.findByRole("menuitem", { name: "Archive" })).toBeTruthy();
    const anchor = screen.getByTestId("row-kebab-context-anchor");
    expect(anchor.style.position).toBe("fixed");
    expect(anchor.style.left).toBe("120px");
    expect(anchor.style.top).toBe("80px");
  });

  it("selecting an item calls its onClick, does not reach the row, and closes the menu", async () => {
    const onArchive = vi.fn();
    const onRowClick = vi.fn();
    render(
      <Row items={[{ label: "Archive", onClick: onArchive }]} onRowClick={onRowClick} />,
    );

    rightClick(screen.getByTestId("row-label"));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
    expect(screen.queryByTestId("row-kebab-context-anchor")).toBeNull();
  });

  it("Escape closes the menu", async () => {
    render(<Row items={[{ label: "Archive", onClick: () => {} }]} />);
    rightClick(screen.getByTestId("row-label"));
    const item = await screen.findByRole("menuitem", { name: "Archive" });

    await act(async () => {
      fireEvent.keyDown(item, { key: "Escape" });
    });
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
  });

  it("renders submenus like the kebab does", async () => {
    render(
      <Row
        items={[
          {
            label: "Move to project",
            submenu: [{ label: "Alpha", onClick: () => {}, checked: true }],
          },
        ]}
      />,
    );
    rightClick(screen.getByTestId("row-label"));
    expect(await screen.findByRole("menuitem", { name: "Move to project" })).toBeTruthy();
  });

  it("leaves the native menu alone for editable targets", () => {
    render(<Row items={[{ label: "Archive", onClick: () => {} }]} />);
    expect(rightClick(screen.getByTestId("row-input"))).toBe(true);
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("leaves the native menu alone when there are no items", () => {
    render(<Row items={[]} />);
    expect(rightClick(screen.getByTestId("row-label"))).toBe(true);
    expect(screen.queryByTestId("row-kebab-context-anchor")).toBeNull();
  });

  it("ignores contextmenu synthesized from a touch long-press", () => {
    render(<Row items={[{ label: "Archive", onClick: () => {} }]} />);
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "pointerType", { value: "touch" });
    act(() => {
      screen.getByTestId("row-label").dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("innermost surface wins when surfaces nest", async () => {
    const outerItems = [{ label: "Outer action", onClick: () => {} }];
    const innerItems = [{ label: "Inner action", onClick: () => {} }];
    render(
      <RowKebabContextMenuSurface items={outerItems}>
        <div>
          <RowKebabContextMenuSurface items={innerItems}>
            <span data-testid="inner">inner</span>
          </RowKebabContextMenuSurface>
        </div>
      </RowKebabContextMenuSurface>,
    );
    rightClick(screen.getByTestId("inner"));
    expect(await screen.findByRole("menuitem", { name: "Inner action" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Outer action" })).toBeNull();
  });

  it("RowKebabContextMenuSurface preserves the child's own onContextMenu-free props", async () => {
    const onClick = vi.fn();
    render(
      <RowKebabContextMenuSurface items={[{ label: "Un-archive", onClick: () => {} }]}>
        <div data-testid="surface" onClick={onClick}>
          row
        </div>
      </RowKebabContextMenuSurface>,
    );
    fireEvent.click(screen.getByTestId("surface"));
    expect(onClick).toHaveBeenCalledTimes(1);
    rightClick(screen.getByTestId("surface"));
    expect(await screen.findByRole("menuitem", { name: "Un-archive" })).toBeTruthy();
  });
});
