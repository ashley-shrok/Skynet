/**
 * ComposeBox — Enter never sends on touch devices.
 *
 * On a touchscreen (isTouchDevice=true) plain Enter falls through to the
 * browser default (newline) in both the primary textarea and queued-message
 * slots; the Send buttons are the only send path. The keyboard hint switches
 * from "send" to "enter" to match. Desktop keeps Enter-to-send.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

import { getComposeDraft } from "@/api/compose-drafts-api";
import { ComposeBox, type ComposeBoxProps } from "./ComposeBox";

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    canSend: true,
    ...overrides,
  };
}

describe("ComposeBox — Enter on touch devices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("touch: plain Enter in the primary textarea does not send and is not prevented", () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend, isTouchDevice: true })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "line one" } });
    // fireEvent returns false when the handler called preventDefault.
    const notPrevented = fireEvent.keyDown(textarea, { key: "Enter" });
    expect(notPrevented).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.getAttribute("enterkeyhint")).toBe("enter");
  });

  it("desktop: plain Enter in the primary textarea still sends", () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend, isTouchDevice: false })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledOnce();
    expect(textarea.getAttribute("enterkeyhint")).toBe("send");
  });

  it("touch: plain Enter in a queued-message slot does not send", async () => {
    vi.mocked(getComposeDraft).mockResolvedValueOnce({
      body: "",
      queueSlots: [{ id: "q1", text: "slot payload" }],
    });
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend, isTouchDevice: true })} />);
    const slot = (await waitFor(() => screen.getByTestId("queue-slot-textarea-q1"))) as HTMLTextAreaElement;
    const notPrevented = fireEvent.keyDown(slot, { key: "Enter" });
    expect(notPrevented).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    expect(slot.getAttribute("enterkeyhint")).toBe("enter");
  });
});
