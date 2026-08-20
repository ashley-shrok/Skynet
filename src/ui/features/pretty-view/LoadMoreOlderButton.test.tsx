// Phase 47 Plan 02 — LoadMoreOlderButton component test suite.
//
// Component contract (from 47-02-PLAN.md § objective):
//   Pure presentational component. Three visible states — idle, in-flight,
//   error — driven entirely by props. Returns null when hasOlder=false
//   (the no-lie invariant from 47-CONTEXT.md § "What would make it wrong":
//   "the button's presence is a promise that clicking it will produce
//   something"). Disabled during in-flight — the single-request-in-flight
//   guard per 47-CONTEXT.md § "What would make it wrong": "clicking
//   rapidly kicked off multiple concurrent requests ... The
//   single-request-in-flight rule with the disabled state during flight
//   is what prevents this." Error state remains clickable — retry contract
//   per 47-CONTEXT.md § "Fail visibly".
//
// Analog: AttachmentChipStrip.test.tsx (structural shape — describe/it,
// render/screen/fireEvent, factory helper, presence + click + variant
// tests). Twin-arc SVG discriminator (Test 5) from ComposeBox.tsx L2551-2564
// per patch #467 / commit df4d7543 (Ashley banned the lucide spinner for the
// wobbling-centroid issue).

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoadMoreOlderButton } from "./LoadMoreOlderButton";
import type { LoadMoreOlderButtonProps } from "./LoadMoreOlderButton";

function makeProps(
  overrides: Partial<LoadMoreOlderButtonProps> = {},
): LoadMoreOlderButtonProps {
  return {
    hasOlder: overrides.hasOlder ?? true,
    status: overrides.status ?? "idle",
    error: overrides.error ?? null,
    onClick: overrides.onClick ?? vi.fn(),
  };
}

describe("LoadMoreOlderButton", () => {
  it("Test 1: returns null (no wrapper) when hasOlder=false — no-lie invariant", () => {
    const { container } = render(
      <LoadMoreOlderButton {...makeProps({ hasOlder: false })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("Test 2: idle + hasOlder=true renders a Button with 'Load older messages' aria-label", () => {
    render(<LoadMoreOlderButton {...makeProps()} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toMatch(/Load older messages/i);
  });

  it("Test 3: clicking the button when status=idle invokes onClick exactly once", () => {
    const onClick = vi.fn();
    render(<LoadMoreOlderButton {...makeProps({ onClick })} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("Test 4: clicking the button when status='in-flight' does NOT invoke onClick (single-request-in-flight guard)", () => {
    const onClick = vi.fn();
    render(
      <LoadMoreOlderButton
        {...makeProps({ status: "in-flight", onClick })}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(0);
  });

  it("Test 5: status='in-flight' renders the twin-arc spinner SVG (animate-spin + exactly 2 <path> children)", () => {
    const { container } = render(
      <LoadMoreOlderButton {...makeProps({ status: "in-flight" })} />,
    );
    const svg = container.querySelector("svg.animate-spin");
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll("path").length).toBe(2);
  });

  it("Test 6: status='error' with error='TIMEOUT' surfaces error in aria-label AND button remains clickable", () => {
    render(
      <LoadMoreOlderButton
        {...makeProps({ status: "error", error: "TIMEOUT" })}
      />,
    );
    const btn = screen.getByRole("button");
    const label = btn.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/couldn't load|failed|error/i);
    expect(label).toContain("TIMEOUT");
    // Error state must remain clickable per 47-CONTEXT.md § Fail visibly:
    // the retry contract requires the disabled attribute is NOT set.
    const disabled = btn.getAttribute("disabled");
    // Native <button disabled> serializes as either "disabled" or "" attr;
    // absent (null) or literal "false" both mean clickable.
    expect(disabled === null || disabled === "false").toBe(true);
  });

  it("Test 7: status='error' click invokes onClick (retry contract — error does NOT block re-click)", () => {
    const onClick = vi.fn();
    render(
      <LoadMoreOlderButton
        {...makeProps({ status: "error", error: "TIMEOUT", onClick })}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
