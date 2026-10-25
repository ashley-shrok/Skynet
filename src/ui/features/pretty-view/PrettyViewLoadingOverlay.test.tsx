import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrettyViewLoadingOverlay } from "./PrettyViewLoadingOverlay";

describe("PrettyViewLoadingOverlay", () => {
  it("is a status with the loading label and copy", () => {
    render(<PrettyViewLoadingOverlay />);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Loading conversation…");
    expect(screen.getByText(/^Loading…$/)).toBeTruthy();
  });

  it("renders in the shared status overlay with the working orb (loading is work)", () => {
    const { container } = render(<PrettyViewLoadingOverlay />);
    expect(container.querySelector('[role="status"]')!.classList.contains("pv-status")).toBe(true);
    expect(container.querySelector(".pv-wip-orb")).not.toBeNull();
  });
});
