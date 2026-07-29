/**
 * Quick 260729-j8l — SessionHoldingOverlay tests.
 *
 * Pin down three invariants after the mount-point relocation (from
 * data-pv-root into PrettyView's chat-region wrapper):
 *
 *   A1: scrim geometry contract — the root <div> renders `absolute inset-0`
 *       classes so its box inherits whichever parent PrettyView mounts it
 *       into. Class-string assertion, NOT pixel layout: jsdom can't compute
 *       layout, but the geometric constraint IS the class contract. The
 *       actual "does the parent constrain to chat-region only" gate lives
 *       in PrettyView's JSX (the overlay is a sibling of the chat-region
 *       children, not a sibling of ComposeBox) and is covered by
 *       ComposeBox.recycle-disable.test.tsx + a visual UAT check on deploy.
 *
 *   A2: warm-red error variant (patch #122) still renders with the
 *       "Session recycle failed — refresh to check" copy and warm-red
 *       glyph tint. The mount-point relocation MUST NOT regress the
 *       error variant — it lives on the same component and inherits the
 *       new mount geometry unchanged.
 *
 *   A3: motion-channel guardrail — STATIC RefreshCcw (patch #74 header
 *       block: "Static glyph = STATE, not WORK"). No animate-spin class
 *       on either variant.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SessionHoldingOverlay } from "./SessionHoldingOverlay";

describe("SessionHoldingOverlay — quick 260729-j8l geometry + variant + motion", () => {
  it("A1: renders scrim geometry as `absolute inset-0` — parent controls the covered area", () => {
    const { container } = render(
      <div style={{ position: "relative", width: 400, height: 600 }}>
        <div style={{ height: 500 }}>chat</div>
        <SessionHoldingOverlay />
      </div>,
    );
    // The overlay root is the <div role="status">.
    const overlayRoot = container.querySelector('[role="status"]');
    expect(overlayRoot).not.toBeNull();
    const cls = overlayRoot?.className ?? "";
    // The `absolute inset-0` contract is what lets the mount-point in
    // PrettyView (chat-region wrapper vs. data-pv-root) determine the
    // scrim's geometry. Any change to these classes MUST be intentional
    // — they carry the load-bearing geometric constraint.
    expect(cls).toMatch(/\babsolute\b/);
    expect(cls).toMatch(/\binset-0\b/);
  });

  it("A2: error variant preserved (patch #122 warm-red still renders)", () => {
    const { container, getByText } = render(<SessionHoldingOverlay error={true} />);
    // Copy: warm-red-labeled recycle-failure state.
    expect(getByText("Session recycle failed — refresh to check")).toBeTruthy();
    // Glyph tint: warm-red hsl(0,72%,60%) applied to the RefreshCcw
    // via the parent's className cn(). lucide-react renders <svg>; we
    // match the class in the svg's classList.
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class") ?? "").toMatch(/text-\[hsl\(0,72%,60%\)\]/);
  });

  it("A3: static glyph — no animate-spin (motion-channel guardrail on both variants)", () => {
    const { container: neutral } = render(<SessionHoldingOverlay />);
    expect(neutral.querySelector(".animate-spin")).toBeNull();
    const { container: err } = render(<SessionHoldingOverlay error={true} />);
    expect(err.querySelector(".animate-spin")).toBeNull();
  });
});
