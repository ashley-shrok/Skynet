// ─── PrettyBountyCountBadge — Vitest coverage (quick 260727-tb1 Task 3) ─────
//
// The badge is a stateless pill inside .pv-meta. Falsy count (undefined OR 0)
// renders null; a positive integer renders <span class="pv-bounty-badge"
// data-testid="pv-bounty-badge">N</span>. All CSS tinting comes from the
// `.pv-row` parent's `--pv-hue` inheritance (per palette-authority rule);
// nothing hue-related is in the JSX.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PrettyBountyCountBadge } from "./PrettyBountyCountBadge";

describe("PrettyBountyCountBadge", () => {
  it("renders null when count is undefined (no fetch has landed)", () => {
    const { container } = render(<PrettyBountyCountBadge count={undefined} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("pv-bounty-badge")).toBeNull();
  });

  it("renders null when count is 0 (absence is the correct signal — no empty pill)", () => {
    const { container } = render(<PrettyBountyCountBadge count={0} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("pv-bounty-badge")).toBeNull();
  });

  it("renders <span.pv-bounty-badge>1</span> for count=1", () => {
    render(<PrettyBountyCountBadge count={1} />);
    const badge = screen.getByTestId("pv-bounty-badge");
    expect(badge.tagName).toBe("SPAN");
    expect(badge.classList.contains("pv-bounty-badge")).toBe(true);
    expect(badge.textContent).toBe("1");
  });

  it("renders <span.pv-bounty-badge>99</span> for count=99 without truncation", () => {
    render(<PrettyBountyCountBadge count={99} />);
    const badge = screen.getByTestId("pv-bounty-badge");
    expect(badge.classList.contains("pv-bounty-badge")).toBe(true);
    expect(badge.textContent).toBe("99");
  });
});
