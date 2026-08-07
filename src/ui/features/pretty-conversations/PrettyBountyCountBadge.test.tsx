// ─── PrettyBountyCountBadge — Vitest coverage (Phase 26 Plan 03 Task 1) ──────
//
// The badge is a stateless combined pin·desk pill inside .pv-meta. Accepts
// {pinnedCount, needsDeskCount} pair; renders per the 4-case rendering-rule
// table from CONTEXT.md §decisions "Row-display format — LOCKED" (D-01):
//
//   case 1: both undefined (pre-fetch)        → null (no pill)
//   case 2: both coerced to 0                 → null (no pill)
//   case 3: pinnedCount>0, needsDeskCount===0 → "3·" (right side blank)
//   case 4: pinnedCount===0, needsDeskCount>0 → "·1" (left side blank)
//   case 5: both>0                            → "3·1"
//
// Middle-dot separator: U+00B7 `·`.
// All CSS tinting comes from the `.pv-row` parent's `--pv-hue` inheritance
// (per palette-authority rule); nothing hue-related is in the JSX.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PrettyBountyCountBadge } from "./PrettyBountyCountBadge";

describe("PrettyBountyCountBadge", () => {
  it("Test 1a: renders null when BOTH counts are undefined (pre-fetch, no pair has landed)", () => {
    const { container } = render(
      <PrettyBountyCountBadge pinnedCount={undefined} needsDeskCount={undefined} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("pv-bounty-badge")).toBeNull();
  });

  it("Test 1b: renders null when BOTH counts are 0 (absence is the correct signal — no empty pill)", () => {
    const { container } = render(
      <PrettyBountyCountBadge pinnedCount={0} needsDeskCount={0} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("pv-bounty-badge")).toBeNull();
  });

  it("Test 1c: renders null when ONE side is undefined and the other is 0 (treat as pre-fetch / all-zero)", () => {
    // Per plan spec: undefined = "not yet fetched". When pinnedCount is
    // undefined and needsDeskCount is 0, the pill renders null because the
    // pair hasn't fully landed AND the only real number coerces to 0.
    const { container } = render(
      <PrettyBountyCountBadge pinnedCount={undefined} needsDeskCount={0} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("pv-bounty-badge")).toBeNull();
  });

  it("Test 2: both nonzero — pill textContent is '3·1', halves and separator present", () => {
    render(<PrettyBountyCountBadge pinnedCount={3} needsDeskCount={1} />);
    const badge = screen.getByTestId("pv-bounty-badge");
    // Full concatenated pill text: left-half + sep + right-half
    expect(badge.textContent).toBe("3·1");
    // Per-half testids
    expect(screen.getByTestId("pv-bounty-badge-pinned").textContent).toBe("3");
    expect(screen.getByTestId("pv-bounty-badge-needs-desk").textContent).toBe("1");
    // Separator span carries the middle-dot character U+00B7
    const sep = badge.querySelector(".pv-bounty-badge-sep");
    expect(sep).not.toBeNull();
    expect(sep!.textContent).toBe("·");
  });

  it("Test 3: pinned-only — pill textContent is '3·', needs-desk span present but empty", () => {
    render(<PrettyBountyCountBadge pinnedCount={3} needsDeskCount={0} />);
    const badge = screen.getByTestId("pv-bounty-badge");
    expect(badge.textContent).toBe("3·");
    expect(screen.getByTestId("pv-bounty-badge-pinned").textContent).toBe("3");
    expect(screen.getByTestId("pv-bounty-badge-needs-desk").textContent).toBe("");
  });

  it("Test 4: needs-desk-only — pill textContent is '·1', pinned span present but empty", () => {
    render(<PrettyBountyCountBadge pinnedCount={0} needsDeskCount={1} />);
    const badge = screen.getByTestId("pv-bounty-badge");
    expect(badge.textContent).toBe("·1");
    expect(screen.getByTestId("pv-bounty-badge-pinned").textContent).toBe("");
    expect(screen.getByTestId("pv-bounty-badge-needs-desk").textContent).toBe("1");
  });

  it("Test 5: large numbers do not truncate — '99·12'", () => {
    render(<PrettyBountyCountBadge pinnedCount={99} needsDeskCount={12} />);
    const badge = screen.getByTestId("pv-bounty-badge");
    expect(badge.textContent).toBe("99·12");
  });

  it("Test 6: pinnedCount real + needsDeskCount undefined — renders '3·' (undefined treated as 0 for one-half edge case)", () => {
    // The store always publishes both halves together so this is an edge case
    // for callers who manually pass undefined for one side. Per plan spec:
    // when at least one half is a real number, treat undefined-for-the-other
    // half as 0 and still render the pill.
    render(<PrettyBountyCountBadge pinnedCount={3} needsDeskCount={undefined} />);
    const badge = screen.getByTestId("pv-bounty-badge");
    expect(badge.textContent).toBe("3·");
    expect(screen.getByTestId("pv-bounty-badge-pinned").textContent).toBe("3");
    expect(screen.getByTestId("pv-bounty-badge-needs-desk").textContent).toBe("");
  });
});
