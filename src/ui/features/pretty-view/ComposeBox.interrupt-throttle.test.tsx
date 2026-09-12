// Tests for the interrupt-button double-tap throttle.
//
// Motivation: the interrupt button sends a WS `interrupt` message that the
// backend translates to a single `Escape` keystroke into the tmux pane.
// Pretty-view users don't see the Claude Code TUI directly, so if a fast
// double-tap sends Escape twice, the second Escape at an empty prompt opens
// Claude Code's rewind menu — which pretty-view users have no way to dismiss.
// The button throttles onClick to at most one fire per INTERRUPT_THROTTLE_MS
// (1000ms) while keeping the button visually clickable.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

import { ComposeBox, type ComposeBoxProps } from "./ComposeBox";

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    ...overrides,
  };
}

describe("ComposeBox — interrupt button double-tap throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rapid double-click within 1s fires onInterrupt exactly once", () => {
    const onInterrupt = vi.fn();
    render(<ComposeBox {...baseProps({ onInterrupt })} />);
    const btn = screen.getByRole("button", { name: "Interrupt" });

    fireEvent.click(btn);
    // 50ms later — inside the 1000ms window
    act(() => {
      vi.advanceTimersByTime(50);
    });
    fireEvent.click(btn);

    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it("button stays clickable across the throttle window (no disabled attribute)", () => {
    const onInterrupt = vi.fn();
    render(<ComposeBox {...baseProps({ onInterrupt })} />);
    const btn = screen.getByRole("button", { name: "Interrupt" });

    fireEvent.click(btn);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Button must not be disabled during the window — the point of the
    // throttle is to silently drop, not to visually deaden the affordance.
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(btn.getAttribute("disabled")).toBeNull();
  });

  it("second click AFTER the 1s window fires onInterrupt a second time", () => {
    const onInterrupt = vi.fn();
    render(<ComposeBox {...baseProps({ onInterrupt })} />);
    const btn = screen.getByRole("button", { name: "Interrupt" });

    fireEvent.click(btn);
    // 1100ms later — outside the 1000ms window
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    fireEvent.click(btn);

    expect(onInterrupt).toHaveBeenCalledTimes(2);
  });

  it("triple-click within 1s still fires onInterrupt exactly once", () => {
    const onInterrupt = vi.fn();
    render(<ComposeBox {...baseProps({ onInterrupt })} />);
    const btn = screen.getByRole("button", { name: "Interrupt" });

    fireEvent.click(btn);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.click(btn);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.click(btn);

    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });
});
