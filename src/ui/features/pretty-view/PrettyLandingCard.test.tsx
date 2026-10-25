import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PrettyLandingCard } from "./PrettyLandingCard";

describe("PrettyLandingCard", () => {
  it("Test 1: renders a container with data-pv-landing-card=\"true\" attribute", () => {
    const { container } = render(<PrettyLandingCard />);
    const el = container.querySelector('[data-pv-landing-card="true"]');
    expect(el).toBeTruthy();
  });

  it("Test 2: outer container is centered (flex column, items+content centered)", () => {
    const { container } = render(<PrettyLandingCard />);
    const outer = container.querySelector(
      '[data-pv-landing-card="true"]',
    ) as HTMLElement;
    expect(outer).toBeTruthy();
    const cls = outer.className ?? "";
    // Centering classes present per Phase 10 empty-state precedent
    expect(cls).toMatch(/flex/);
    expect(cls).toMatch(/flex-col/);
    expect(cls).toMatch(/items-center/);
    expect(cls).toMatch(/justify-center/);
  });

  it("Test 3: the inner card uses the floating-control look", () => {
    const { container } = render(<PrettyLandingCard />);
    const inner = container.querySelector('[role="status"]') as HTMLElement;
    expect(inner.classList.contains("pv-float")).toBe(true);
    expect(inner.getAttribute("style") ?? "").not.toMatch(/blur/);
  });

  it("Test 4: renders idle static content — no animation, no spinner, no aria-busy", () => {
    const { container } = render(<PrettyLandingCard />);
    // user's motion guardrail (patch #72 precedent) — no motion channel.
    // Grep the entire rendered subtree for animate- / aria-busy.
    const html = container.innerHTML;
    expect(html).not.toMatch(/animate-/);
    expect(html).not.toMatch(/aria-busy/);
    // No SVG element carrying an "animate" class in its className.
    const animatedSvgs = container.querySelectorAll('svg[class*="animate"]');
    expect(animatedSvgs.length).toBe(0);
  });
});
