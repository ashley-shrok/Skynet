// Tests for the interrupt-button client-side fast-path throttle.
//
// Motivation: the interrupt button sends a WS `interrupt` message that the
// backend fires as a single `tmux send-keys ... C-c` into the tmux pane.
// Ctrl-C is used because it is the only keystroke that both interrupts work
// and clears the entire multi-line draft in ONE press (measured 2026-09-16).
// The hazard it reintroduces — two presses inside Claude Code's ~0.8s
// exit-confirm window terminate the harness — is handled by the server-side
// per-pane throttle in claude-session-server.ts, not by this client ref.
// These tests cover only the client fast-path (2500ms window). They do NOT
// and cannot prove the real guarantee against harness death; the backend
// tests in claude-session-server.compose-send.test.ts do that.
//
// Historical note: the former comment claimed a double-Escape would open
// Claude Code's rewind menu that pretty-view users could not dismiss.
// Measured: the menu renders `Esc to cancel` and a single Escape dismisses
// it cleanly — the rationale was false. Post-change it is moot regardless.

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

  it("rapid double-click within 2500ms fires onInterrupt exactly once", () => {
    const onInterrupt = vi.fn();
    render(<ComposeBox {...baseProps({ onInterrupt })} />);
    const btn = screen.getByRole("button", { name: "Interrupt" });

    fireEvent.click(btn);
    // 50ms later — inside the 2500ms window
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

  it("second click AFTER the 2500ms window fires onInterrupt a second time", () => {
    const onInterrupt = vi.fn();
    render(<ComposeBox {...baseProps({ onInterrupt })} />);
    const btn = screen.getByRole("button", { name: "Interrupt" });

    fireEvent.click(btn);
    // 2600ms later — outside the 2500ms window
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    fireEvent.click(btn);

    expect(onInterrupt).toHaveBeenCalledTimes(2);
  });

  it("triple-click within 2500ms still fires onInterrupt exactly once", () => {
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
