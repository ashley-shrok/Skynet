// ─── PrettyConversationContextMenu — Vitest coverage ─────────────────────────
// Fork-new component from patch #203 shipped without tests because the
// desktop right-click context-menu variant was URL-param-gated and jsdom's
// window.location.search is empty by default — so every existing
// PrettyConversationRow test hit the pre-strip code path. As a result,
// PrettyConversationContextMenu.tsx shipped with zero coverage.
//
// quick-260730-o2m promotes the context-menu behavior to the sole,
// unconditional default (see PrettyConversationRow.tsx strip); this suite
// covers the component in isolation. Coverage:
//
//   1) Portal mount into document.body (not the render container).
//   2) No-clamp positioning at (x, y) when viewport has room.
//   3) Viewport clamp on the RIGHT edge (BCR-stubbed).
//   4) Viewport clamp on the BOTTOM edge (BCR-stubbed).
//   5) Escape key dismisses menu (window-level capture-phase listener).
//   6) Outside-click (mousedown on document.body) dismisses.
//   7) Inside-click (mousedown on the menu itself) does NOT dismiss.
//   8) Item click invokes item.onClick AND onClose.
//   9) `danger: true` items get the warm-red text color (#ff9a8a).
//  10) `hue` prop drives the `--pv-id-hue` inline custom property.
//
// jsdom quirk noted in Tests 2/3/4: getBoundingClientRect returns zeros for
// width/height by default, so the useLayoutEffect clamp is a no-op unless we
// explicitly stub BCR. Tests 3/4 stub it to exercise the clamp math.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import {
  PrettyConversationContextMenu,
  type PrettyContextMenuItem,
} from "./PrettyConversationContextMenu";

// jsdom defaults window.innerWidth/innerHeight to 1024×768, but we set them
// explicitly here so viewport-clamp tests are deterministic even if a future
// vitest config change flips the default.
beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1024,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: 768,
  });
});

afterEach(() => {
  // Belt-and-braces: restore any BCR spies set inside individual tests.
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Portal mounts into document.body, not the render container
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: portal mount", () => {
  it("mounts into document.body via createPortal (render container does NOT contain the menu)", () => {
    const items: PrettyContextMenuItem[] = [{ label: "Pin", onClick: vi.fn() }];
    const { container } = render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={items}
        onClose={vi.fn()}
      />,
    );
    const menu = screen.getByRole("menu");
    expect(menu).toBeTruthy();
    expect(document.body.contains(menu)).toBe(true);
    // The render `container` is a fresh div that RTL appends to
    // document.body — the menu is a SIBLING of that div (portal target is
    // document.body), so container.contains(menu) is false.
    expect(container.contains(menu)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — No-clamp positioning at (x, y) when viewport has room
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: positioning (no clamp)", () => {
  it("positions at (x, y) verbatim when the viewport has room (jsdom BCR zeros → no clamp)", () => {
    // useLayoutEffect runs the clamp read-then-write, but jsdom's
    // getBoundingClientRect returns zeros for width/height by default:
    //   left + rect.width + VIEWPORT_MARGIN = 100 + 0 + 8 = 108 < 1024 → no clamp
    //   top + rect.height + VIEWPORT_MARGIN = 100 + 0 + 8 = 108 < 768 → no clamp
    // So the effect calls setPos({ left: 100, top: 100 }) and the render
    // reflects it.
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[{ label: "Pin", onClick: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );
    const menu = screen.getByRole("menu") as HTMLElement;
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("100px");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Viewport clamp on RIGHT edge
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: viewport clamp — right edge", () => {
  it("clamps left when x + width + margin exceeds window.innerWidth", () => {
    // Stub BCR to return a 200×40 menu; render at x=900 (viewport width
    // 1024). 900 + 200 + 8 = 1108 > 1024 → clamp.
    // Expected clamped left: Math.max(8, 1024 - 200 - 8) = 816.
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
      {
        width: 200,
        height: 40,
        left: 0,
        top: 0,
        right: 200,
        bottom: 40,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect,
    );
    render(
      <PrettyConversationContextMenu
        x={900}
        y={100}
        items={[{ label: "Pin", onClick: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );
    const menu = screen.getByRole("menu") as HTMLElement;
    expect(menu.style.left).toBe("816px");
    // Top is NOT clamped: 100 + 40 + 8 = 148 < 768.
    expect(menu.style.top).toBe("100px");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Viewport clamp on BOTTOM edge
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: viewport clamp — bottom edge", () => {
  it("clamps top when y + height + margin exceeds window.innerHeight", () => {
    // Same BCR mock (200×40). Render at y=730 (viewport height 768).
    // 730 + 40 + 8 = 778 > 768 → clamp.
    // Expected clamped top: Math.max(8, 768 - 40 - 8) = 720.
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
      {
        width: 200,
        height: 40,
        left: 0,
        top: 0,
        right: 200,
        bottom: 40,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect,
    );
    render(
      <PrettyConversationContextMenu
        x={100}
        y={730}
        items={[{ label: "Pin", onClick: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );
    const menu = screen.getByRole("menu") as HTMLElement;
    expect(menu.style.top).toBe("720px");
    // Left is NOT clamped: 100 + 200 + 8 = 308 < 1024.
    expect(menu.style.left).toBe("100px");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Escape key dismisses menu
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: Escape dismiss", () => {
  it("Escape key on window fires onClose exactly once", () => {
    // The component adds a capture-phase keydown listener on `window`:
    //   window.addEventListener("keydown", onKey, true)
    // fireEvent.keyDown(window, …) dispatches a real KeyboardEvent on window,
    // and the capture-phase listener catches it. The handler calls
    // e.stopPropagation() but the test does not rely on propagation.
    const onClose = vi.fn();
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[{ label: "Pin", onClick: vi.fn() }]}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — Outside-click (click on document.body) dismisses
// Post-fix (2026-08-08): switched from mousedown-capture to click-bubbling
// to avoid the iOS Safari class of bug where a capture-phase mousedown
// listener on window silently drops the tap→click synthesis for taps on
// descendant tap targets. See PrettyConversationContextMenu.tsx dismiss
// effect comment for full rationale.
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: outside-click dismiss", () => {
  it("click on document.body (outside the menu) fires onClose exactly once", () => {
    // The component's onClick handler checks !el.contains(e.target as Node).
    // document.body is NOT inside menuRef.current (menu is a child of body,
    // not the other way around), so the check passes and onClose fires.
    const onClose = vi.fn();
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[{ label: "Pin", onClick: vi.fn() }]}
        onClose={onClose}
      />,
    );
    fireEvent.click(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — Inside-click (click ON the menu) does NOT dismiss
// Post-fix: dismiss is now bubbling `click` on window; the menu container's
// own onClick calls stopPropagation, so an inside-click bubbles to the menu
// handler and STOPS — never reaches the window click listener that would
// otherwise fire onClose.
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: inside-click preserves menu", () => {
  it("click on the menu element itself does NOT fire onClose (stopPropagation)", () => {
    const onClose = vi.fn();
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[{ label: "Pin", onClick: vi.fn() }]}
        onClose={onClose}
      />,
    );
    const menu = screen.getByRole("menu");
    fireEvent.click(menu);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — Item click invokes item.onClick synchronously AND onClose after the
// 120ms flash delay. Scoped fake timers so the other 9 describe blocks keep
// real timers (afterEach restores).
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: item click", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clicking a menu item fires that item's onClick synchronously; onClose fires only after 120ms; no sibling item's onClick", () => {
    const itemPinClick = vi.fn();
    const itemDeactivateClick = vi.fn();
    const onClose = vi.fn();
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[
          { label: "Pin", onClick: itemPinClick },
          { label: "Deactivate", onClick: itemDeactivateClick, danger: true },
        ]}
        onClose={onClose}
      />,
    );
    const pinItem = screen.getByRole("menuitem", { name: /pin/i });
    fireEvent.click(pinItem);
    // item.onClick is called immediately (parent state updates right away).
    expect(itemPinClick).toHaveBeenCalledTimes(1);
    expect(itemDeactivateClick).not.toHaveBeenCalled();
    // onClose is DEFERRED so :active can paint before the menu unmounts.
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the danger item fires its onClick synchronously; onClose fires only after 120ms", () => {
    const itemPinClick = vi.fn();
    const itemDeactivateClick = vi.fn();
    const onClose = vi.fn();
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[
          { label: "Pin", onClick: itemPinClick },
          { label: "Deactivate", onClick: itemDeactivateClick, danger: true },
        ]}
        onClose={onClose}
      />,
    );
    const deactivateItem = screen.getByRole("menuitem", {
      name: /deactivate/i,
    });
    fireEvent.click(deactivateItem);
    expect(itemDeactivateClick).toHaveBeenCalledTimes(1);
    expect(itemPinClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9 — `danger: true` items get the warm-red text color
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: danger styling", () => {
  it("danger=true item renders with color: #ff9a8a (jsdom normalizes to rgb)", () => {
    // The component sets color: item.danger ? "#ff9a8a" : "#e8e4d8" inline.
    // jsdom normalizes CSS colors to rgb notation in element.style.color.
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[{ label: "Deactivate", onClick: vi.fn(), danger: true }]}
        onClose={vi.fn()}
      />,
    );
    const item = screen.getByRole("menuitem", { name: /deactivate/i });
    expect((item as HTMLElement).style.color).toBe("rgb(255, 154, 138)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10 — `hue` prop drives the `--pv-id-hue` inline custom property
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: hue custom property", () => {
  it("hue={45} emits `--pv-id-hue: 45` in the raw style attribute", () => {
    // jsdom preserves CSS custom properties in the raw style attribute (same
    // pattern PrettyConversationRow.test.tsx uses at line ~202 for `--pv-hue`).
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        hue={45}
        items={[{ label: "Pin", onClick: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );
    const menu = screen.getByRole("menu");
    const rawStyle = menu.getAttribute("style") ?? "";
    expect(rawStyle).toContain("--pv-id-hue: 45");
  });

  it("hue={undefined} emits no `--pv-id-hue` in the style attribute", () => {
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[{ label: "Pin", onClick: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );
    const menu = screen.getByRole("menu");
    const rawStyle = menu.getAttribute("style") ?? "";
    expect(rawStyle).not.toContain("--pv-id-hue");
  });

  it("hue={null} emits no `--pv-id-hue` in the style attribute", () => {
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        hue={null}
        items={[{ label: "Pin", onClick: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );
    const menu = screen.getByRole("menu");
    const rawStyle = menu.getAttribute("style") ?? "";
    expect(rawStyle).not.toContain("--pv-id-hue");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11 — Unmount during the 120ms flash-delay MUST NOT call onClose after
// the component has torn down. Proves the mounted-ref guard + timer cleanup.
// Portal parents (rows) can unmount for reasons unrelated to menu selection
// (route change, row prop churn, etc.). Firing onClose on a torn-down parent
// would be a use-after-unmount React warning at best, a crash at worst.
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: unmount during flash-delay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("unmounting the menu mid-flash-delay does NOT call onClose (mounted-ref guards the deferred onClose)", () => {
    const itemPinClick = vi.fn();
    const onClose = vi.fn();
    const { unmount } = render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[{ label: "Pin", onClick: itemPinClick }]}
        onClose={onClose}
      />,
    );
    const pinItem = screen.getByRole("menuitem", { name: /pin/i });
    fireEvent.click(pinItem);
    // item.onClick was called synchronously — parent state (like closing the
    // menu itself via a state flip) may have already caused an unmount by the
    // time the deferred onClose would fire. Simulate that by unmounting NOW.
    unmount();
    // Advance PAST the 120ms flash delay; the guarded setTimeout must NOT
    // invoke onClose because the mounted ref is false + timer was cleared.
    vi.advanceTimersByTime(120);
    expect(onClose).not.toHaveBeenCalled();
    // Belt-and-braces: keep advancing to prove no delayed re-entry either.
    vi.advanceTimersByTime(1000);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 12+ — Drill-in submenu machinery (shape-move-to-project-context-menu)
// ─────────────────────────────────────────────────────────────────────────────
// A menu item may carry a `submenu` field instead of a direct `onClick`. When
// picked, it swaps the menu content in place — the outer items disappear,
// replaced by a "‹ Back" row followed by the child items. Same interaction
// model on desktop and mobile: click/tap to enter, no hover-to-open. The back
// row is the ONLY way to return to the outer view; tap-outside dismisses the
// whole menu (one-level dismiss). Submenu items may set `checked: true` to
// render a check icon on the left (used for the currently-assigned project).

describe("PrettyConversationContextMenu: drill-in submenu — swap + back", () => {
  it("clicking a submenu-parent swaps the menu content to show the child items and hides the outer items", () => {
    const items: PrettyContextMenuItem[] = [
      { label: "Pin", onClick: vi.fn() },
      {
        label: "Move to project",
        submenu: [
          { label: "Foo", onClick: vi.fn() },
          { label: "Bar", onClick: vi.fn() },
        ],
      },
      { label: "Archive", onClick: vi.fn(), danger: true },
    ];
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={items}
        onClose={vi.fn()}
      />,
    );
    // Outer state: Pin + Move to project + Archive present, no back row.
    expect(screen.getByRole("menuitem", { name: /^pin$/i })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /move to project/i }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /archive/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /back/i })).toBeNull();

    // Drill in.
    fireEvent.click(screen.getByRole("menuitem", { name: /move to project/i }));

    // Outer items gone; submenu items + back row present.
    expect(screen.queryByRole("menuitem", { name: /^pin$/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /archive/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /back/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /foo/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /bar/i })).toBeTruthy();
  });

  it("clicking the back-row returns to the outer view (does NOT fire onClose)", () => {
    const onClose = vi.fn();
    const items: PrettyContextMenuItem[] = [
      { label: "Pin", onClick: vi.fn() },
      {
        label: "Move to project",
        submenu: [{ label: "Foo", onClick: vi.fn() }],
      },
    ];
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={items}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /move to project/i }));
    // In drilled view. Click back.
    fireEvent.click(screen.getByRole("menuitem", { name: /back/i }));
    // Outer items are back; back row is gone; onClose was NOT called.
    expect(screen.getByRole("menuitem", { name: /^pin$/i })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /move to project/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /back/i })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("submenu-parent item does NOT fire its own onClick (submenu-parent has no onClick)", () => {
    // Regression guard: the discriminated union means a submenu-parent has no
    // `onClick` at all. Clicking it should only swap the content — never
    // attempt to invoke a non-existent action, and never dismiss the menu.
    const onClose = vi.fn();
    const childClick = vi.fn();
    const items: PrettyContextMenuItem[] = [
      {
        label: "Move to project",
        submenu: [{ label: "Foo", onClick: childClick }],
      },
    ];
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={items}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /move to project/i }));
    expect(childClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("PrettyConversationContextMenu: drill-in submenu — dismiss semantics", () => {
  it("outside-click while drilled dismisses the whole menu (one-level dismiss, not just back to outer)", () => {
    const onClose = vi.fn();
    const items: PrettyContextMenuItem[] = [
      {
        label: "Move to project",
        submenu: [{ label: "Foo", onClick: vi.fn() }],
      },
    ];
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={items}
        onClose={onClose}
      />,
    );
    // Drill in first.
    fireEvent.click(screen.getByRole("menuitem", { name: /move to project/i }));
    // Outside-click.
    fireEvent.click(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape while drilled dismisses the whole menu (Escape is not a back affordance)", () => {
    const onClose = vi.fn();
    const items: PrettyContextMenuItem[] = [
      {
        label: "Move to project",
        submenu: [{ label: "Foo", onClick: vi.fn() }],
      },
    ];
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={items}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /move to project/i }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("PrettyConversationContextMenu: drill-in submenu — item pick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clicking a submenu item fires its onClick synchronously and onClose after the flash delay", () => {
    const fooClick = vi.fn();
    const barClick = vi.fn();
    const onClose = vi.fn();
    const items: PrettyContextMenuItem[] = [
      {
        label: "Move to project",
        submenu: [
          { label: "Foo", onClick: fooClick },
          { label: "Bar", onClick: barClick },
        ],
      },
    ];
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={items}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /move to project/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /foo/i }));
    // onClick synchronous; sibling not called.
    expect(fooClick).toHaveBeenCalledTimes(1);
    expect(barClick).not.toHaveBeenCalled();
    // onClose deferred by 120ms flash.
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("PrettyConversationContextMenu: drill-in submenu — checked rendering", () => {
  it("a submenu item with checked=true renders as menuitemradio with aria-checked=true; unchecked items are plain menuitem", () => {
    const items: PrettyContextMenuItem[] = [
      {
        label: "Move to project",
        submenu: [
          { label: "Foo", onClick: vi.fn(), checked: false },
          { label: "Bar", onClick: vi.fn(), checked: true },
          { label: "Baz", onClick: vi.fn() }, // no checked field → plain menuitem
        ],
      },
    ];
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={items}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /move to project/i }));
    // Foo: menuitemradio with aria-checked absent-or-false (checked=false).
    const foo = screen.getByRole("menuitemradio", { name: /foo/i });
    expect(foo.getAttribute("aria-checked")).not.toBe("true");
    // Bar: menuitemradio with aria-checked=true.
    const bar = screen.getByRole("menuitemradio", { name: /bar/i, checked: true });
    expect(bar).toBeTruthy();
    // Baz: plain menuitem (checked field absent).
    const baz = screen.getByRole("menuitem", { name: /baz/i });
    expect(baz.getAttribute("aria-checked")).toBeNull();
  });
});

describe("PrettyConversationContextMenu: submenu-parent has aria-haspopup", () => {
  it("submenu-parent item carries aria-haspopup=menu (accessibility affordance for the drill-in)", () => {
    const items: PrettyContextMenuItem[] = [
      { label: "Pin", onClick: vi.fn() },
      {
        label: "Move to project",
        submenu: [{ label: "Foo", onClick: vi.fn() }],
      },
    ];
    render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={items}
        onClose={vi.fn()}
      />,
    );
    const parent = screen.getByRole("menuitem", { name: /move to project/i });
    expect(parent.getAttribute("aria-haspopup")).toBe("menu");
    // Non-submenu items should NOT carry the attribute.
    const pin = screen.getByRole("menuitem", { name: /^pin$/i });
    expect(pin.getAttribute("aria-haspopup")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Drill-in state tracks the parent's LABEL, not the array reference — so a
// parent re-render while drilled reflects the up-to-date submenu contents.
// Regression guard for the correctness pothole that would otherwise let the
// menu act on stale data (e.g. stale checkmark, stale current-project no-op
// guard) if the row's `currentProjectSlug` or `projects` mutated during the
// window between menu-open and menu-pick.
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: drill-in submenu — live-updates on re-render", () => {
  it("when the parent re-renders with a mutated submenu (a new item added), the drilled view shows the updated contents — not the snapshot from drill-in time", () => {
    const firstFoo = vi.fn();
    const firstBar = vi.fn();
    const secondFoo = vi.fn();
    const secondBar = vi.fn();
    const secondBaz = vi.fn();
    const { rerender } = render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[
          {
            label: "Move to project",
            submenu: [
              { label: "Foo", onClick: firstFoo },
              { label: "Bar", onClick: firstBar },
            ],
          },
        ]}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /move to project/i }));
    // Drilled — Foo + Bar visible, no Baz.
    expect(screen.getByRole("menuitem", { name: /^foo$/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^bar$/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^baz$/i })).toBeNull();

    // Rerender with a submenu that gained Baz.
    rerender(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[
          {
            label: "Move to project",
            submenu: [
              { label: "Foo", onClick: secondFoo },
              { label: "Bar", onClick: secondBar },
              { label: "Baz", onClick: secondBaz },
            ],
          },
        ]}
        onClose={vi.fn()}
      />,
    );
    // Baz is now visible in the drilled view — proves the drill state is
    // derived from live items, not held as a captured array.
    expect(screen.getByRole("menuitem", { name: /^baz$/i })).toBeTruthy();
  });

  it("when the parent re-renders and the drilled submenu-parent is REMOVED from items, the drilled view falls back to outer (naturally, no stale drilled render)", () => {
    const { rerender } = render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[
          { label: "Pin", onClick: vi.fn() },
          {
            label: "Move to project",
            submenu: [{ label: "Foo", onClick: vi.fn() }],
          },
        ]}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /move to project/i }));
    // Drilled.
    expect(screen.getByRole("menuitem", { name: /^foo$/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^pin$/i })).toBeNull();

    // Rerender without the submenu-parent (e.g. fleet dropped to zero projects
    // while the menu was open, and the panel now passes items without "Move
    // to project").
    rerender(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[{ label: "Pin", onClick: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );
    // Outer view is back — no stale drilled render, no "‹ Back" row.
    expect(screen.getByRole("menuitem", { name: /^pin$/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^foo$/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /back/i })).toBeNull();
  });

  it("when a submenu item's `checked` flips mid-drill (e.g. currentProjectSlug changed underneath), the checkmark reflects the current value — not the snapshot", () => {
    const { rerender } = render(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[
          {
            label: "Move to project",
            submenu: [
              { label: "Foo", onClick: vi.fn(), checked: true },
              { label: "Bar", onClick: vi.fn(), checked: false },
            ],
          },
        ]}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /move to project/i }));
    // At drill-in time, Foo is checked.
    expect(
      screen.getByRole("menuitemradio", { name: /^foo$/i }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByRole("menuitemradio", { name: /^bar$/i }).getAttribute("aria-checked"),
    ).not.toBe("true");

    // Rerender with the check moved to Bar (underlying state changed).
    rerender(
      <PrettyConversationContextMenu
        x={100}
        y={100}
        items={[
          {
            label: "Move to project",
            submenu: [
              { label: "Foo", onClick: vi.fn(), checked: false },
              { label: "Bar", onClick: vi.fn(), checked: true },
            ],
          },
        ]}
        onClose={vi.fn()}
      />,
    );
    // The check moved live — Bar is now checked, Foo is not.
    expect(
      screen.getByRole("menuitemradio", { name: /^foo$/i }).getAttribute("aria-checked"),
    ).not.toBe("true");
    expect(
      screen.getByRole("menuitemradio", { name: /^bar$/i }).getAttribute("aria-checked"),
    ).toBe("true");
  });
});
