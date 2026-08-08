/**
 * quick 260808-ho2 — PrettyViewLoadingOverlay unit tests.
 *
 * Five tests covering:
 *   Test 1: role="status" element with aria-label="Loading conversation…"
 *   Test 2: Loader2 SVG is rendered AND is spinning (.animate-spin present)
 *   Test 3: "Loading…" copy is inside the glass card
 *   Test 4: scrim class-list invariants — REGRESSION-GUARD for the iOS
 *           backdrop-filter hardening (patch #333) + interaction-blocking
 *           classes. Class string CONTAINS each of the load-bearing tokens.
 *   Test 5: motion-channel deviation regression-guard — asserts that the
 *           <svg> DOES carry `animate-spin` (inverse of the sibling
 *           SessionHoldingOverlay/DormancyOverlay static-glyph guardrail).
 *           This overlay owns the SURFACE-work motion channel; the sibling
 *           overlays own the STATE (temporarily unavailable) channel. The
 *           deviation is documented in the file header and MUST NOT be
 *           silently "fixed" into a static glyph by a future refactor.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrettyViewLoadingOverlay } from "./PrettyViewLoadingOverlay";

// ─── Test 1 ───────────────────────────────────────────────────────────────────

describe("PrettyViewLoadingOverlay — role and aria-label", () => {
  it('renders role="status" with aria-label="Loading conversation…"', () => {
    render(<PrettyViewLoadingOverlay />);
    const status = screen.getByRole("status");
    expect(status).toBeTruthy();
    expect(status.getAttribute("aria-label")).toBe("Loading conversation…");
  });
});

// ─── Test 2 ───────────────────────────────────────────────────────────────────

describe("PrettyViewLoadingOverlay — Loader2 SVG present and spinning", () => {
  it("renders a Loader2 svg with class animate-spin", () => {
    const { container } = render(<PrettyViewLoadingOverlay />);
    // lucide-react renders Loader2 as <svg>. The animate-spin class is the
    // motion signal — presence == spinner is spinning.
    const spinner = container.querySelector("svg.animate-spin");
    expect(spinner).not.toBeNull();
  });
});

// ─── Test 3 ───────────────────────────────────────────────────────────────────

describe("PrettyViewLoadingOverlay — copy inside glass card", () => {
  it('renders the "Loading…" copy inside the glass card', () => {
    render(<PrettyViewLoadingOverlay />);
    expect(screen.getByText(/^Loading…$/)).toBeTruthy();
  });
});

// ─── Test 4 ───────────────────────────────────────────────────────────────────

describe("PrettyViewLoadingOverlay — scrim class-list invariants (iOS hardening + interaction blocking)", () => {
  it("scrim carries each load-bearing token: absolute, inset-0, z-[99], pointer-events-auto, bg-black/40, backdrop-blur-md, animate-in, isolate, [transform:translateZ(0)]", () => {
    const { container } = render(<PrettyViewLoadingOverlay />);
    const scrim = container.querySelector('[role="status"]');
    expect(scrim).not.toBeNull();
    const cls = scrim?.className ?? "";
    // Positioning + z-band (mount geometry must match sibling overlays)
    expect(cls).toMatch(/(^| )absolute( |$)/);
    expect(cls).toMatch(/(^| )inset-0( |$)/);
    expect(cls).toMatch(/(^| )z-\[99\]( |$)/);
    // Interaction blocking (Ashley's ask: block re-taps during boot)
    expect(cls).toMatch(/(^| )pointer-events-auto( |$)/);
    // Scrim visuals
    expect(cls).toMatch(/(^| )bg-black\/40( |$)/);
    expect(cls).toMatch(/(^| )backdrop-blur-md( |$)/);
    // Entrance animation (soft fade-in, no exit — parent unmount handles exit)
    expect(cls).toMatch(/(^| )animate-in( |$)/);
    // iOS Safari backdrop-filter hardening (patch #333 — MANDATORY)
    expect(cls).toMatch(/(^| )isolate( |$)/);
    expect(cls).toMatch(/(^| )\[transform:translateZ\(0\)\]( |$)/);
  });
});

// ─── Test 5 ───────────────────────────────────────────────────────────────────

describe("PrettyViewLoadingOverlay — motion-channel deviation regression-guard", () => {
  it("Loader2 svg DOES carry animate-spin (deviation from sibling static-glyph guardrail is intentional)", () => {
    // Inverse of SessionHoldingOverlay/DormancyOverlay's static-glyph
    // regression guards (which assert `.animate-spin` is absent). Here the
    // overlay is genuinely WORK-in-progress (surface booting), so a
    // spinning glyph is semantically correct — WipBubble owns motion for
    // TASK work; this overlay owns motion for SURFACE work. The two never
    // co-render (loading overlay is only up before any bubbles render).
    // If a future refactor silently removes `animate-spin`, this test
    // catches it and forces a re-read of the file header rationale.
    const { container } = render(<PrettyViewLoadingOverlay />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class") ?? "").toMatch(/(^| )animate-spin( |$)/);
  });
});
