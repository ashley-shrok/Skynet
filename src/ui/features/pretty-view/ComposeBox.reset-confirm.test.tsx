/**
 * ComposeBox — reset button confirm-gate.
 *
 * The reset button now calls window.confirm() before dispatching. Guards
 * against accidental context-window resets from stray clicks/taps.
 *
 * Uses stampIdentitySendLog as the dispatch proxy (fires only when the
 * reset actually goes through), matching the pattern in
 * ComposeBox.send-log-hook.test.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

vi.mock("@/api/identity-send-log-api", () => ({
  stampIdentitySendLog: vi.fn(),
}));

vi.mock("@/state/session-working-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    seedSessionLastMessageAt: vi.fn(),
  };
});

import { ComposeBox, type ComposeBoxProps } from "./ComposeBox";
import { stampIdentitySendLog } from "@/api/identity-send-log-api";

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 42,
    tmuxSession: "ivy",
    identityName: "ivy",
    ...overrides,
  };
}

describe("ComposeBox — reset button confirm gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dismissed confirm: click is a no-op (no dispatch, no side-effects)", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ComposeBox {...baseProps()} />);

    const resetBtn = screen.getByRole("button", {
      name: /reset context window/i,
    });

    act(() => {
      fireEvent.click(resetBtn);
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // Dispatch proxy: stampIdentitySendLog fires only when reset actually
    // goes through. Cancelled confirm → zero calls.
    expect(stampIdentitySendLog).not.toHaveBeenCalled();
  });

  it("accepted confirm: click dispatches as before", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ComposeBox {...baseProps()} />);

    const resetBtn = screen.getByRole("button", {
      name: /reset context window/i,
    });

    act(() => {
      fireEvent.click(resetBtn);
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(stampIdentitySendLog).toHaveBeenCalledTimes(1);
  });
});
