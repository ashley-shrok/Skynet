/**
 * Phase 14 (plain-language-translation-asides) Wave 3 Task 1 — AsideBubble
 * component render tests.
 *
 * AsideBubble is a new pretty-view sibling of ChatMessage / ImageBubble /
 * PlanPendingBubble / WipBubble. Rendered by PrettyView at the bottom of
 * the message stream when the backend delivers a `{type:"aside_ready",
 * text: "..."}` WS frame (Wave 2's server-authoritative extraction).
 *
 * The aesthetic is LOCKED per CONTEXT.md § Rendering (2026-07-26):
 *   - Identity-hue gradient background (verbatim from ChatMessage L124).
 *   - 10px solid opaque hue border.
 *   - Three-layer neon glow: 12/32/64px, alphas 0.7 / 0.5 / 0.3.
 *   - Prop-driven `glow` multiplier (default 1.0) and `borderWidthPx`
 *     (default 10) so future dial-back is one prop change (per PATTERNS.md
 *     L62-77 and the aside-visual-snippet.js DevTools prototype Ashley
 *     signed off on).
 *
 * These tests are the RED gate for Task 1 — they MUST fail before
 * AsideBubble.tsx exists, then pass GREEN after the component lands.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AsideBubble } from "./AsideBubble";

describe("AsideBubble — Phase 14 Wave 3 rendering", () => {
  it("Test 1: renders the aside text with role='note'", () => {
    render(<AsideBubble text="the agent is describing what it just did" />);
    // role="note" is the semantic wrapper — the aside is an aside from the
    // identity, not a status/alert. Assertion targets the semantic role.
    const note = screen.getByRole("note");
    expect(note).toBeTruthy();
    expect(
      screen.getByText(/the agent is describing what it just did/),
    ).toBeTruthy();
  });

  it("Test 2: default props — 10px border AND three neon-glow layers at 0.7 / 0.5 / 0.3 alpha", () => {
    render(<AsideBubble text="hi" />);
    const note = screen.getByRole("note");
    const style = note.getAttribute("style") ?? "";
    // Border width comes from the borderWidthPx prop, default 10.
    expect(style).toMatch(/border-width:\s*10px/);
    // Three-layer glow at LOCKED alpha multipliers × default glow=1.
    expect(style).toContain("hsla(var(--pv-id-hue), 100%, 60%, 0.7)");
    expect(style).toContain("hsla(var(--pv-id-hue), 100%, 55%, 0.5)");
    expect(style).toContain(
      "hsla(var(--pv-id-hue), 100%, 50%, 0.3)",
    );
    // Border color is opaque full-saturation hue per CONTEXT.md § Rendering.
    expect(style).toContain("hsla(var(--pv-id-hue), 90%, 65%, 1)");
  });

  it("Test 3: custom glow=0.5 halves each layer's alpha to 0.35 / 0.25 / 0.15", () => {
    render(<AsideBubble text="hi" glow={0.5} />);
    const note = screen.getByRole("note");
    const style = note.getAttribute("style") ?? "";
    // 0.7 * 0.5 = 0.35, 0.5 * 0.5 = 0.25, 0.3 * 0.5 = 0.15.
    expect(style).toContain("hsla(var(--pv-id-hue), 100%, 60%, 0.35)");
    expect(style).toContain("hsla(var(--pv-id-hue), 100%, 55%, 0.25)");
    expect(style).toContain("hsla(var(--pv-id-hue), 100%, 50%, 0.15)");
  });

  it("Test 4: custom borderWidthPx=6 renders as 6px border-width", () => {
    render(<AsideBubble text="hi" borderWidthPx={6} />);
    const note = screen.getByRole("note");
    const style = note.getAttribute("style") ?? "";
    expect(style).toMatch(/border-width:\s*6px/);
  });

  it("Test 5: preserves newlines in text prop via whitespace-pre-wrap class", () => {
    const multi = "line one\nline two\nline three";
    render(<AsideBubble text={multi} />);
    // The inner text container carries whitespace-pre-wrap so \n renders
    // as visible line breaks (not collapsed by browser whitespace rules).
    const inner = screen.getByText((_content, node) => {
      if (!node) return false;
      return (
        node.textContent === multi &&
        (node.className ?? "").includes("whitespace-pre-wrap")
      );
    });
    expect(inner).toBeTruthy();
  });
});
