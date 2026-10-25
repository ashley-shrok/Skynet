// WipBubble — the working indicator (shape-conversation-view): an orb in the
// agent's colour beside "Working" by default; an installation that set its
// own working image in branding (wipIndicatorCustom) keeps its image.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const brandingMock = vi.fn(() => ({
  wipIndicatorPath: "/branding/wip-cube.webp",
  wipIndicatorCustom: false as boolean | undefined,
}));
vi.mock("@/branding/branding-store", () => ({
  useBrandingConfig: () => brandingMock(),
}));

import { WipBubble } from "./WipBubble";

describe("WipBubble", () => {
  beforeEach(() => {
    brandingMock.mockReset();
  });

  it("default: the orb with the word 'Working', no image", () => {
    brandingMock.mockReturnValue({ wipIndicatorPath: "/branding/wip-cube.webp", wipIndicatorCustom: false });
    const { container } = render(<WipBubble />);
    const wip = screen.getByTestId("pv-wip");
    expect(wip.getAttribute("role")).toBe("status");
    expect(wip.getAttribute("aria-label")).toBe("Claude is working");
    expect(wip.querySelector(".pv-wip-orb")).not.toBeNull();
    expect(wip.textContent).toContain("Working");
    expect(container.querySelector("img")).toBeNull();
  });

  it("an installation's own working image still wins", () => {
    brandingMock.mockReturnValue({ wipIndicatorPath: "/branding/custom.webp", wipIndicatorCustom: true });
    const { container } = render(<WipBubble />);
    expect(screen.queryByTestId("pv-wip")).toBeNull();
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/branding/custom.webp");
    expect(img.getAttribute("role")).toBe("status");
    expect(img.getAttribute("aria-label")).toBe("Claude is working");
  });

  describe("work narration", () => {
    // jsdom has no layout: drive the fit check by stubbing the two widths it reads.
    function stubWidths(slotWidth: number, longWidth: number) {
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(slotWidth);
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(longWidth);
    }
    const line = { short: "Fixing it, then tests", long: "Found the cause, fixing it now, then running the tests" };
    const text = (c: HTMLElement) => c.querySelector('[data-testid="wip-narration"]')?.textContent ?? null;

    beforeEach(() => {
      brandingMock.mockReturnValue({ wipIndicatorPath: "/branding/wip-cube.webp", wipIndicatorCustom: false });
    });
    afterEach(() => vi.restoreAllMocks());

    it("shows 'Working' until the turn's first line arrives", () => {
      const { container } = render(<WipBubble />);
      expect(text(container)).toBeNull();
      expect(screen.getByTestId("pv-wip").textContent).toContain("Working");
    });

    it("the line takes the place of 'Working', long version when it fits", () => {
      stubWidths(400, 300);
      const { container } = render(<WipBubble narration={line} />);
      expect(text(container)).toBe(line.long);
      expect(screen.getByTestId("pv-wip").textContent).not.toContain("Working");
    });

    it("falls back to the short version when the long one would not fit", () => {
      stubWidths(200, 300);
      const { container } = render(<WipBubble narration={line} />);
      expect(text(container)).toBe(line.short);
    });

    it("replaces the line with a fade when a new one arrives", async () => {
      stubWidths(400, 300);
      const { container, rerender } = render(<WipBubble narration={line} />);
      rerender(<WipBubble narration={{ short: "Running tests", long: "Fix is in, running the tests now" }} />);
      const el = container.querySelector('[data-testid="wip-narration"]') as HTMLElement;
      expect(el.style.opacity).toBe("0");
      await waitFor(() => expect(text(container)).toBe("Fix is in, running the tests now"));
      expect(el.style.opacity).toBe("1");
    });

    it("sits beside an installation's own working image", () => {
      brandingMock.mockReturnValue({ wipIndicatorPath: "/branding/custom.webp", wipIndicatorCustom: true });
      stubWidths(400, 300);
      const { container } = render(<WipBubble narration={line} />);
      expect(container.querySelector("img")).not.toBeNull();
      expect(text(container)).toBe(line.long);
    });
  });
});
