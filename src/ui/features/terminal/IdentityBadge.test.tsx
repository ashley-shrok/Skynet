/**
 * Quick 260806-lzd — IdentityBadge: single-variant refactor + onLongPress primitive
 *
 * Tests A-G defend the plan's must_haves.truths:
 *   A. onLongPress fires after 500ms of held pointerdown
 *   B. pointermove before 500ms cancels the long-press timer
 *   C. pointerup before 500ms cancels the long-press AND fires onClick (tap semantics)
 *   D. pointercancel clears the timer
 *   E. completed long-press suppresses the subsequent onClick (no double-fire)
 *   F. hover-fade class (patch #38 `hover:opacity-0`) is GONE — anti-regression gate
 *   G. when onClick is omitted, root renders as a non-interactive <div aria-hidden>
 *
 * Fake timers so 500ms is deterministic, not wall-clock.
 * Mock @/state/identities-store so the badge finds a matching identity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// ── Fixture identity (must satisfy full Identity shape) ─────────────────────
const FIXTURE: Identity = {
  id: "id-1",
  identityKey: "tina",
  displayName: "Tina",
  title: "Session coordinator",
  colorHue: 200,
  voice: null,
  role: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/id-1/avatar",
  avatarEtag: "etag-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// Mock identities-store: byKey.get("tina") returns FIXTURE so the badge renders.
vi.mock("@/state/identities-store", () => ({
  useIdentities: vi.fn(() => ({
    identities: [FIXTURE],
    byKey: new Map([["tina", FIXTURE]]),
    loaded: true,
    refresh: vi.fn(),
  })),
}));

// Late import — after the mock is registered.
import { IdentityBadge } from "./IdentityBadge";

describe("IdentityBadge — single-variant + onLongPress (quick 260806-lzd)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("A: onLongPress fires after 500ms of held pointerdown", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("B: pointermove before 500ms cancels the long-press timer", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(200);
    fireEvent.pointerMove(root);
    vi.advanceTimersByTime(400);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("C: pointerup before 500ms cancels long-press AND allows onClick (tap)", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(200);
    fireEvent.pointerUp(root);
    // JSDOM doesn't synthesize click from pointerdown+pointerup on <button>;
    // dispatch it explicitly to model the browser's tap-completion behavior.
    fireEvent.click(root);
    vi.advanceTimersByTime(400);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("D: pointercancel clears the long-press timer", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(200);
    fireEvent.pointerCancel(root);
    vi.advanceTimersByTime(400);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("E: a completed long-press suppresses the trailing onClick (no double-fire)", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    // Browser fires a click at the end of the press. It must be swallowed.
    fireEvent.click(root);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("F: hover-fade class (patch #38 `hover:opacity-0`) is GONE from the rendered root", () => {
    const onClick = vi.fn();
    render(<IdentityBadge identityKey="tina" onClick={onClick} />);
    const root = screen.getByTestId("identity-badge-root");
    expect(root.className).not.toContain("hover:opacity-0");
  });

  it("G: when onClick is omitted, root is a non-interactive <div aria-hidden='true'>", () => {
    render(<IdentityBadge identityKey="tina" />);
    const root = screen.getByTestId("identity-badge-root");
    expect(root.tagName.toLowerCase()).toBe("div");
    expect(root.getAttribute("aria-hidden")).toBe("true");
    // Sanity: also no button role available in the DOM.
    expect(screen.queryByRole("button")).toBeNull();
  });
});
