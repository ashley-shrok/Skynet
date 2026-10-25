import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SessionHoldingOverlay } from "./SessionHoldingOverlay";

describe("SessionHoldingOverlay", () => {
  it("renders the recycling card in the shared status overlay", () => {
    const { container, getByText } = render(<SessionHoldingOverlay />);
    const root = container.querySelector('[role="status"]');
    expect(root!.classList.contains("pv-status")).toBe(true);
    expect(root!.getAttribute("data-tone")).toBe("neutral");
    expect(getByText("Session recycling…")).toBeTruthy();
  });

  it("error variant: danger tone and its own copy", () => {
    const { container, getByText } = render(<SessionHoldingOverlay error={true} />);
    expect(getByText("Session recycle failed — refresh to check")).toBeTruthy();
    expect(container.querySelector('[role="status"]')!.getAttribute("data-tone")).toBe("danger");
  });

  it("the glyph stays still on both variants (a state, not work)", () => {
    const { container: neutral } = render(<SessionHoldingOverlay />);
    expect(neutral.querySelector(".animate-spin, .pv-wip-orb")).toBeNull();
    const { container: err } = render(<SessionHoldingOverlay error={true} />);
    expect(err.querySelector(".animate-spin, .pv-wip-orb")).toBeNull();
  });
});
