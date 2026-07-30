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
// Test 6 — Outside-click (mousedown on document.body) dismisses
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: outside-click dismiss", () => {
  it("mousedown on document.body (outside the menu) fires onClose exactly once", () => {
    // The component's onDown handler checks !el.contains(e.target as Node).
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
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — Inside-click (mousedown ON the menu) does NOT dismiss
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: inside-click preserves menu", () => {
  it("mousedown on the menu element itself does NOT fire onClose", () => {
    // menuRef.current.contains(menu) is true (it contains itself), so the
    // outside-click predicate fails and onClose is not called.
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
    fireEvent.mouseDown(menu);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — Item click invokes item.onClick AND onClose
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationContextMenu: item click", () => {
  it("clicking a menu item fires that item's onClick + onClose, and no sibling item's onClick", () => {
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
    expect(itemPinClick).toHaveBeenCalledTimes(1);
    expect(itemDeactivateClick).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the danger item fires its onClick + onClose", () => {
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
