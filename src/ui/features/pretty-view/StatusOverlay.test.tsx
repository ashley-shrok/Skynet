import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StatusOverlay } from "./StatusOverlay";

describe("StatusOverlay", () => {
  it("renders title, optional subline and children in one card", () => {
    render(
      <StatusOverlay icon={<span />} title="Title" subline="Sub">
        <button type="button">Act</button>
      </StatusOverlay>,
    );
    const card = screen.getByText("Title").closest(".pv-status-card");
    expect(card).not.toBeNull();
    expect(card!.classList.contains("pv-float")).toBe(true);
    expect(card!.textContent).toContain("Sub");
    expect(screen.getByRole("button", { name: "Act" })).toBeTruthy();
  });

  it("omits the subline when not given; passive marks the root", () => {
    const { container } = render(<StatusOverlay passive icon={<span />} title="T" />);
    expect(container.querySelector(".pv-status-sub")).toBeNull();
    expect(container.querySelector(".pv-status")!.getAttribute("data-passive")).toBe("true");
  });

  it("the overlay styles use no blur or transparency effects", () => {
    const css = readFileSync(resolve(__dirname, "conversation.css"), "utf8");
    const block = css.slice(css.indexOf("── Status overlays"));
    expect(block).not.toMatch(/backdrop-filter|blur\(/);
  });
});
