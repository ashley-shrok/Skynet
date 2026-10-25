import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// ─── openAt (shape-sidebar): press-and-hold opens the same menu at a point ──

function OpenAtRow({
  items,
  x = 42,
  y = 77,
}: {
  items: RowKebabMenuItem[];
  x?: number;
  y?: number;
}): React.JSX.Element {
  const ctx = useRowKebabContextMenu(items);
  return (
    <div data-testid="row">
      <button type="button" data-testid="open-at" onClick={() => ctx.openAt(x, y)}>
        hold
      </button>
      {ctx.menu}
    </div>
  );
}

describe("useRowKebabContextMenu — openAt", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("openAt(x, y) opens the same items at that point", async () => {
    const onArchive = vi.fn();
    render(
      <OpenAtRow
        items={[
          { label: "Rename…", onClick: () => {} },
          { label: "Archive", onClick: onArchive },
        ]}
      />,
    );
    expect(screen.queryByTestId("row-kebab-context-anchor")).toBeNull();
    act(() => {
      fireEvent.click(screen.getByTestId("open-at"));
    });
    const anchor = screen.getByTestId("row-kebab-context-anchor");
    expect(anchor.style.position).toBe("fixed");
    expect(anchor.style.left).toBe("42px");
    expect(anchor.style.top).toBe("77px");
    const items = (await screen.findAllByRole("menuitem")).map((el) => el.textContent);
    expect(items).toEqual(["Rename…", "Archive"]);

    // The lift right after a press-and-hold opened it is ignored…
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(onArchive).not.toHaveBeenCalled();
    expect(screen.getByTestId("row-kebab-context-anchor")).toBeTruthy();
    // …a real pick a moment later goes through.
    const now = performance.now();
    const clock = vi.spyOn(performance, "now").mockReturnValue(now + 1000);
    const user = userEvent.setup();
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    clock.mockRestore();
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("row-kebab-context-anchor")).toBeNull();
  });

  it("openAt is a no-op when there are no items", () => {
    render(<OpenAtRow items={[]} />);
    act(() => {
      fireEvent.click(screen.getByTestId("open-at"));
    });
    expect(screen.queryByTestId("row-kebab-context-anchor")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

function HoldRow({
  items,
  onRowClick = () => {},
}: {
  items: RowKebabMenuItem[];
  onRowClick?: () => void;
}): React.JSX.Element {
  const ctx = useRowKebabContextMenu(items);
  return (
    <div data-testid="row" onClick={onRowClick} onContextMenu={ctx.onContextMenu} {...ctx.holdProps}>
      <span data-testid="row-label">Row</span>
      {ctx.menu}
    </div>
  );
}

function hold(el: Element, x = 30, y = 40): void {
  const t = [{ identifier: 0, clientX: x, clientY: y, target: el }];
  fireEvent.touchStart(el, { touches: t, changedTouches: t });
  act(() => {
    vi.advanceTimersByTime(500);
  });
  fireEvent.touchEnd(el, { touches: [], changedTouches: t });
}

describe("useRowKebabContextMenu — press-and-hold (holdProps)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a hold opens the same items at the finger, and the follow-up tap doesn't reach the row", () => {
    const onRowClick = vi.fn();
    render(<HoldRow items={[{ label: "Archive", onClick: () => {} }]} onRowClick={onRowClick} />);
    const label = screen.getByTestId("row-label");
    hold(label, 30, 40);
    const anchor = screen.getByTestId("row-kebab-context-anchor");
    expect(anchor.style.left).toBe("30px");
    expect(anchor.style.top).toBe("40px");
    fireEvent.click(label);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.getByTestId("row").hasAttribute("data-hold-menu")).toBe(true);
  });

  it("a hold does nothing when there are no items", () => {
    render(<HoldRow items={[]} />);
    hold(screen.getByTestId("row-label"));
    expect(screen.queryByTestId("row-kebab-context-anchor")).toBeNull();
    expect(screen.getByTestId("row").hasAttribute("data-hold-menu")).toBe(false);
  });

  it("RowKebabContextMenuSurface opens on a hold too", () => {
    render(
      <RowKebabContextMenuSurface items={[{ label: "Delete", onClick: () => {} }]}>
        <div data-testid="surface-row">File</div>
      </RowKebabContextMenuSurface>,
    );
    hold(screen.getByTestId("surface-row"));
    expect(screen.getByTestId("row-kebab-context-anchor")).toBeTruthy();
  });

  it("the innermost hold surface wins when surfaces nest", () => {
    function Nested(): React.JSX.Element {
      const outer = useRowKebabContextMenu([{ label: "Outer", onClick: () => {} }]);
      const inner = useRowKebabContextMenu([{ label: "Inner", onClick: () => {} }]);
      return (
        <div data-testid="outer" {...outer.holdProps}>
          <div data-testid="inner" {...inner.holdProps}>
            inner
          </div>
          {outer.menu}
          {inner.menu}
        </div>
      );
    }
    render(<Nested />);
    hold(screen.getByTestId("inner"));
    expect(screen.getAllByTestId("row-kebab-context-anchor")).toHaveLength(1);
  });
});
