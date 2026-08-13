/**
 * Phase 34 Plan 03 — WaitingBubble unit tests.
 *
 * Seven tests covering:
 *   Test 1: Renders the reason string passed via props exactly.
 *   Test 2: Has role="status" and aria-label including "waiting" + reason.
 *   Test 3: Outer container has justify-start (assistant-aligned).
 *   Test 4: Bubble div includes Phase 4 Glass className tokens:
 *           rounded-[var(--radius-pv-bubble)], backdrop-blur-xl,
 *           hsla(var(--pv-id-hue) (substring checks).
 *   Test 5: Renders Hand icon SVG with aria-hidden="true".
 *   Test 6: Renders NO buttons anywhere in the tree (no interactive controls).
 *   Test 7: reason=null or "" → fallback "Waiting on you" + role/aria-label.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WaitingBubble } from "./WaitingBubble";

// ─── Test 1 ───────────────────────────────────────────────────────────────────

describe("WaitingBubble — reason string rendering", () => {
  it("renders the reason string passed via props exactly in the DOM", () => {
    render(<WaitingBubble reason="approve Bash" />);
    expect(screen.getByText("approve Bash")).toBeTruthy();
  });
});

// ─── Test 2 ───────────────────────────────────────────────────────────────────

describe("WaitingBubble — accessibility attributes", () => {
  it('has role="status" and aria-label containing "waiting" and the reason string', () => {
    render(<WaitingBubble reason="sandbox request" />);
    const statusEl = screen.getByRole("status");
    expect(statusEl).toBeTruthy();
    const label = statusEl.getAttribute("aria-label") ?? "";
    expect(label.toLowerCase()).toContain("waiting");
    expect(label).toContain("sandbox request");
  });
});

// ─── Test 3 ───────────────────────────────────────────────────────────────────

describe("WaitingBubble — assistant-aligned outer container", () => {
  it("outer container div has justify-start class (matches PlanPendingBubble alignment)", () => {
    const { container } = render(<WaitingBubble reason="worker request" />);
    // The outer wrapper is the first child of the container.
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toBeTruthy();
    expect(outer.className).toContain("justify-start");
  });
});

// ─── Test 4 ───────────────────────────────────────────────────────────────────

describe("WaitingBubble — Phase 4 Glass className tokens", () => {
  it("bubble div includes the Phase 4 Glass tokens: rounded-[var(--radius-pv-bubble)], backdrop-blur-xl, hsla(var(--pv-id-hue)", () => {
    const { container } = render(<WaitingBubble reason="dialog open" />);
    // The bubble is the inner div (role="status") — grab it by role.
    const bubble = screen.getByRole("status");
    const cls = bubble.className;
    expect(cls).toContain("rounded-[var(--radius-pv-bubble)]");
    expect(cls).toContain("backdrop-blur-xl");
    // gradient uses hsla(var(--pv-id-hue) — check as substring.
    expect(cls).toContain("hsla(var(--pv-id-hue)");
  });
});

// ─── Test 5 ───────────────────────────────────────────────────────────────────

describe("WaitingBubble — Hand icon glyph", () => {
  it("renders an SVG with aria-hidden=true (the Hand lucide icon)", () => {
    const { container } = render(<WaitingBubble reason="input needed" />);
    // lucide-react renders icons as <svg> with aria-hidden="true".
    const svgs = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Test 6 ───────────────────────────────────────────────────────────────────

describe("WaitingBubble — no interactive controls", () => {
  it("renders NO buttons anywhere in the tree (presence-only, per D-CTX lock)", () => {
    const { container } = render(<WaitingBubble reason="approve Bash" />);
    const buttons = container.querySelectorAll("button");
    // Enforces the "no interactive controls" rule from D-CTX § Waiting bubble.
    expect(buttons.length).toBe(0);
  });
});

// ─── Test 7 ───────────────────────────────────────────────────────────────────

describe("WaitingBubble — null/empty reason fallback", () => {
  it('renders "Waiting on you" fallback when reason is null', () => {
    render(<WaitingBubble reason={null} />);
    expect(screen.getByText("Waiting on you")).toBeTruthy();
    const statusEl = screen.getByRole("status");
    expect(statusEl).toBeTruthy();
    const label = statusEl.getAttribute("aria-label") ?? "";
    expect(label.toLowerCase()).toContain("waiting");
  });

  it('renders "Waiting on you" fallback when reason is empty string', () => {
    render(<WaitingBubble reason="" />);
    expect(screen.getByText("Waiting on you")).toBeTruthy();
    const statusEl = screen.getByRole("status");
    expect(statusEl).toBeTruthy();
    const label = statusEl.getAttribute("aria-label") ?? "";
    expect(label.toLowerCase()).toContain("waiting");
  });
});
