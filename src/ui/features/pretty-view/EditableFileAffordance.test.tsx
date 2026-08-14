/**
 * Phase 40 Plan 40-03 Task 1 — EditableFileAffordance tests.
 *
 * Covers the per-viewport render branches + interaction contract from
 * UI-SPEC L124 + L136 (LOCKED D-03: affordance is a SIBLING to the anchor,
 * never a wrapper). Tests are TDD-first — the component file did not exist
 * when these were written.
 *
 * Tests:
 *   1. renders as a <button> element (getByRole("button") returns it)
 *   2. aria-label AND title === "Edit {filename}"
 *   3. onClick fires the passed handler (called once, no args)
 *   4. icon-only on mobile (useIsTouchDevice=true stub) with 44x44 touch target
 *   5. icon + label on desktop (useIsTouchDevice=false stub) w/ opacity-0 rest
 *   6. sibling-not-wrapper: rendered root is <button>, not span/div/a wrapper
 *   7. hover drop-shadow applied on mouseEnter, cleared on mouseLeave
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// hoisted mock — must appear before importing the component under test
vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

import { EditableFileAffordance } from "./EditableFileAffordance";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";

describe("EditableFileAffordance — Phase 40 Plan 40-03 Task 1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useIsTouchDevice as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("test 1: renders as a <button> element", () => {
    render(<EditableFileAffordance onOpen={vi.fn()} filename="test.md" />);
    const btn = screen.getByRole("button");
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe("BUTTON");
  });

  it("test 2: aria-label and title both === 'Edit {filename}'", () => {
    render(<EditableFileAffordance onOpen={vi.fn()} filename="test.md" />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("Edit test.md");
    expect(btn.getAttribute("title")).toBe("Edit test.md");
  });

  it("test 3: onClick fires the passed callback with no args", () => {
    const onOpen = vi.fn();
    render(<EditableFileAffordance onOpen={onOpen} filename="test.md" />);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith();
  });

  it("test 4: mobile (useIsTouchDevice=true) → icon-only + 44x44 touch target", () => {
    (useIsTouchDevice as ReturnType<typeof vi.fn>).mockReturnValue(true);
    render(<EditableFileAffordance onOpen={vi.fn()} filename="test.md" />);
    const btn = screen.getByRole("button");
    // Icon-only — no "Edit" label text visible
    expect(btn.textContent).not.toContain("Edit");
    // 44x44 minimum touch target (Apple HIG per UI-SPEC L215)
    const cls = btn.className;
    expect(cls).toContain("min-w-[44px]");
    expect(cls).toContain("min-h-[44px]");
  });

  it("test 5: desktop (useIsTouchDevice=false) → icon + 'Edit' label + opacity-0 rest", () => {
    (useIsTouchDevice as ReturnType<typeof vi.fn>).mockReturnValue(false);
    render(<EditableFileAffordance onOpen={vi.fn()} filename="test.md" />);
    const btn = screen.getByRole("button");
    // Label text visible in DOM (though hover-reveal via opacity in the CSS)
    expect(btn.textContent).toContain("Edit");
    // Starts hidden via opacity-0 — hover on ancestor .pv-bubble reveals it.
    // JSDOM can't test the ancestor-hover CSS variant; the initial class-list
    // check is sufficient to lock the resting-invisible contract.
    expect(btn.className).toContain("opacity-0");
  });

  it("test 6: sibling-not-wrapper anti-pattern lockdown — root is <button>", () => {
    // UI-SPEC L136: affordance MUST be a sibling to the anchor, never a
    // wrapping element. Locking the rendered root's tag name catches any
    // future regression that would nest an anchor inside a div/span/a shell.
    const { container } = render(
      <EditableFileAffordance onOpen={vi.fn()} filename="test.md" />,
    );
    const root = container.firstChild as HTMLElement | null;
    expect(root).toBeTruthy();
    expect(root!.tagName).toBe("BUTTON");
    // Belt-and-suspenders: no nested <a> inside the affordance
    expect(root!.querySelector("a")).toBeNull();
  });

  it("test 7: hover drop-shadow applied on mouseEnter, cleared on mouseLeave (desktop)", () => {
    (useIsTouchDevice as ReturnType<typeof vi.fn>).mockReturnValue(false);
    render(<EditableFileAffordance onOpen={vi.fn()} filename="test.md" />);
    const btn = screen.getByRole("button") as HTMLButtonElement;
    // Rest: no filter set
    expect(btn.style.filter).toBe("");
    // Hover: drop-shadow with identity-hue CSS custom property
    fireEvent.mouseEnter(btn);
    expect(btn.style.filter).toContain("drop-shadow");
    expect(btn.style.filter).toContain("hsla(var(--pv-id-hue)");
    // Leave: filter cleared
    fireEvent.mouseLeave(btn);
    expect(btn.style.filter).toBe("");
  });
});
