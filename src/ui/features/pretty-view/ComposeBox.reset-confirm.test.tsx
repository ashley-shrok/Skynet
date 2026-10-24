/**
 * ComposeBox — reset button confirm-gate.
 *
 * The reset button now asks via kitConfirm() before dispatching. Guards
 * against accidental context-window resets from stray clicks/taps.
 *
 * Uses stampIdentitySendLog as the dispatch proxy (fires only when the
 * reset actually goes through), matching the pattern in
 * ComposeBox.send-log-hook.test.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import {
  autoAnswerKitDialogs,
  __resetKitDialogsForTests,
  type KitConfirmOptions,
} from "@/components/kit";

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
    __resetKitDialogsForTests();
    vi.restoreAllMocks();
  });

  it("dismissed confirm: click is a no-op (no dispatch, no side-effects)", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    render(<ComposeBox {...baseProps()} />);

    // shape-conversation-view: the reset is Start fresh in the memory
    // gauge's pop-over.
    fireEvent.click(screen.getByTestId("memory-gauge"));
    const resetBtn = await screen.findByRole("button", { name: "Start fresh" });

    act(() => {
      fireEvent.click(resetBtn);
    });

    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].kind).toBe("confirm");
    expect(String((dialogs.calls[0].opts as KitConfirmOptions).title)).toMatch(
      /reset the agent's context window/i,
    );
    await new Promise((r) => setTimeout(r, 0));
    // Dispatch proxy: stampIdentitySendLog fires only when reset actually
    // goes through. Cancelled confirm → zero calls.
    expect(stampIdentitySendLog).not.toHaveBeenCalled();
  });

  it("accepted confirm: click dispatches as before", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    render(<ComposeBox {...baseProps()} />);

    // shape-conversation-view: the reset is Start fresh in the memory
    // gauge's pop-over.
    fireEvent.click(screen.getByTestId("memory-gauge"));
    const resetBtn = await screen.findByRole("button", { name: "Start fresh" });

    act(() => {
      fireEvent.click(resetBtn);
    });

    await waitFor(() => expect(stampIdentitySendLog).toHaveBeenCalledTimes(1));
    expect(dialogs.calls.filter((c) => c.kind === "confirm")).toHaveLength(1);
  });
});
