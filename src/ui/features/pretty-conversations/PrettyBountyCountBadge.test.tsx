// ─── PrettyBountyCountBadge — Vitest coverage (V12 notification-badge style) ──
//
// Rewritten 2026-08-18 (tiffany) alongside the V12 shape swap. Semantics:
//   - pinnedCount    > 0 → render Pin-icon wrap with corner count
//   - needsDeskCount > 0 → render Monitor-icon wrap with corner count
//   - both 0 / both undefined → null (no badge)
//   - one undefined, other 0 → null (unfetched pair)
//
// data-testid semantics: `pv-bounty-badge-pinned` and `pv-bounty-badge-needs-desk`
// now identify a whole icon+count wrap — they exist ONLY when their axis is
// non-zero. The wrap's textContent is the count (icons are aria-hidden and
// have no text content of their own).

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PrettyBountyCountBadge } from "./PrettyBountyCountBadge";

describe("PrettyBountyCountBadge", () => {
  it("renders null when BOTH counts are undefined (pre-fetch)", () => {
    const { container } = render(
      <PrettyBountyCountBadge pinnedCount={undefined} needsDeskCount={undefined} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("pv-bounty-badge")).toBeNull();
  });

  it("renders null when BOTH counts are 0 (absence is the correct signal)", () => {
    const { container } = render(
      <PrettyBountyCountBadge pinnedCount={0} needsDeskCount={0} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("pv-bounty-badge")).toBeNull();
  });

  it("renders null when one side is undefined and the other is 0 (unfetched pair)", () => {
    const { container } = render(
      <PrettyBountyCountBadge pinnedCount={undefined} needsDeskCount={0} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("pv-bounty-badge")).toBeNull();
  });

  it("both nonzero — renders BOTH wraps with their counts", () => {
    render(<PrettyBountyCountBadge pinnedCount={3} needsDeskCount={1} />);
    const badge = screen.getByTestId("pv-bounty-badge");
    // Both axis wraps present
    const pinWrap = screen.getByTestId("pv-bounty-badge-pinned");
    const deskWrap = screen.getByTestId("pv-bounty-badge-needs-desk");
    expect(pinWrap.textContent).toBe("3");
    expect(deskWrap.textContent).toBe("1");
    // aria-label carries both counts for screen readers
    expect(badge.getAttribute("aria-label")).toBe("3 pinned, 1 needs desk");
    // Icons live inside each wrap and are aria-hidden
    expect(pinWrap.querySelector(".pv-bounty-badge-icon")).not.toBeNull();
    expect(deskWrap.querySelector(".pv-bounty-badge-icon")).not.toBeNull();
  });

  it("pinned-only — renders only the pin wrap; needs-desk wrap is absent", () => {
    render(<PrettyBountyCountBadge pinnedCount={3} needsDeskCount={0} />);
    expect(screen.getByTestId("pv-bounty-badge-pinned").textContent).toBe("3");
    expect(screen.queryByTestId("pv-bounty-badge-needs-desk")).toBeNull();
  });

  it("needs-desk-only — renders only the desk wrap; pin wrap is absent", () => {
    render(<PrettyBountyCountBadge pinnedCount={0} needsDeskCount={1} />);
    expect(screen.queryByTestId("pv-bounty-badge-pinned")).toBeNull();
    expect(screen.getByTestId("pv-bounty-badge-needs-desk").textContent).toBe("1");
  });

  it("large numbers do not truncate", () => {
    render(<PrettyBountyCountBadge pinnedCount={99} needsDeskCount={12} />);
    expect(screen.getByTestId("pv-bounty-badge-pinned").textContent).toBe("99");
    expect(screen.getByTestId("pv-bounty-badge-needs-desk").textContent).toBe("12");
  });

  it("pinnedCount real + needsDeskCount undefined — renders only the pin wrap", () => {
    // Store publishes both halves together; this covers callers that pass
    // undefined for one axis. undefined coerces to 0 → that axis is not rendered.
    render(<PrettyBountyCountBadge pinnedCount={3} needsDeskCount={undefined} />);
    expect(screen.getByTestId("pv-bounty-badge-pinned").textContent).toBe("3");
    expect(screen.queryByTestId("pv-bounty-badge-needs-desk")).toBeNull();
  });
});
