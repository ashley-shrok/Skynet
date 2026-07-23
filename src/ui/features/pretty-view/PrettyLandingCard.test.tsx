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

  it("Test 3: inline style attribute on the inner card carries warm-neutral palette values (per --color-pv-* authority)", () => {
    const { container } = render(<PrettyLandingCard />);
    const outer = container.querySelector(
      '[data-pv-landing-card="true"]',
    ) as HTMLElement;
    expect(outer).toBeTruthy();
    // The inner card is where the palette-authority values live (per plan action).
    const inner = outer.querySelector('[role="status"]') as HTMLElement;
    expect(inner).toBeTruthy();
    // Query the raw inline-style attribute directly. JSDOM does not
    // resolve computed CSS variables or Tailwind classes; only inline
    // styles are queryable here (per plan Test 3 mandate).
    const styleAttr = inner.getAttribute("style") ?? "";
    // Test 3 assertion: inline style contains at least one warm-neutral
    // palette marker (Phase 10 patch #133 precedent).
    const hasWarmCream = /rgba\(240,\s*235,\s*224/.test(styleAttr);
    const hasWarmGlow = /rgba\(255,\s*220,\s*170/.test(styleAttr);
    const hasHsla = /hsla\(/.test(styleAttr);
    expect(hasWarmCream || hasWarmGlow || hasHsla).toBe(true);
  });

  it("Test 4: renders idle static content — no animation, no spinner, no aria-busy", () => {
    const { container } = render(<PrettyLandingCard />);
    // Ashley's motion guardrail (patch #72 precedent) — no motion channel.
    // Grep the entire rendered subtree for animate- / aria-busy.
    const html = container.innerHTML;
    expect(html).not.toMatch(/animate-/);
    expect(html).not.toMatch(/aria-busy/);
    // No SVG element carrying an "animate" class in its className.
    const animatedSvgs = container.querySelectorAll('svg[class*="animate"]');
    expect(animatedSvgs.length).toBe(0);
  });
});
