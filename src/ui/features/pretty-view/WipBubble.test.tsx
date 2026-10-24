// WipBubble — the working indicator (shape-conversation-view): an orb in the
// agent's colour beside "Working" by default; an installation that set its
// own working image in branding (wipIndicatorCustom) keeps its image.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
});
