// Tests for RecordingControls — the recording controls (mute, cancel, append, send).
//
// Coverage:
//   - Renders three accessible buttons (cancel, append, send)
//   - Each button fires its corresponding prop callback on click
//   - Cancel button uses red-tinted palette (hsla hue-0 = red)
//   - Send button uses coral-tinted palette (--color-pv-code-fg / ffb896)
//   - All buttons have type="button"
//   - Correct lucide icons rendered (X, ArrowDownToLine, Send)
//
// Pattern: vitest + @testing-library/react + render + screen + fireEvent
// (matches AttachmentChipStrip.test.tsx style)

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecordingControls } from "./RecordingControls";

describe("RecordingControls", () => {
  it("Test 1: renders three buttons with distinct accessible aria-labels (cancel, append, send)", () => {
    render(
      <RecordingControls
        onCancel={vi.fn()}
        onAppend={vi.fn()}
        onSend={vi.fn()}
        muted={false}
        onToggleMute={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Cancel recording")).toBeTruthy();
    expect(screen.getByLabelText("Append transcript")).toBeTruthy();
    expect(screen.getByLabelText("Send transcript")).toBeTruthy();
  });

  it("Test 2: clicking each button fires the correct callback prop", () => {
    const onCancel = vi.fn();
    const onAppend = vi.fn();
    const onSend = vi.fn();

    render(
      <RecordingControls
        onCancel={onCancel}
        onAppend={onAppend}
        onSend={onSend}
        muted={false}
        onToggleMute={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Cancel recording"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAppend).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Append transcript"));
    expect(onAppend).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Send transcript"));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("Test 3: cancel button is the red-toned row button (data-tone='danger')", () => {
    render(
      <RecordingControls
        onCancel={vi.fn()}
        onAppend={vi.fn()}
        onSend={vi.fn()}
        muted={false}
        onToggleMute={vi.fn()}
      />,
    );

    const cancelBtn = screen.getByLabelText("Cancel recording");
    // shape-conversation-view: Cancel (red ✕) is a control-row button; its
    // red comes from conversation.css via data-tone.
    expect(cancelBtn.className).toContain("pv-cbtn");
    expect(cancelBtn.getAttribute("data-tone")).toBe("danger");
  });

  it("Test 4: send button is the off-white main button (data-main), the others are quiet row buttons", () => {
    render(
      <RecordingControls
        onCancel={vi.fn()}
        onAppend={vi.fn()}
        onSend={vi.fn()}
        muted={false}
        onToggleMute={vi.fn()}
      />,
    );

    const sendBtn = screen.getByLabelText("Send transcript");
    expect(sendBtn.className).toContain("pv-cbtn");
    expect(sendBtn.getAttribute("data-main")).toBe("true");
    expect(screen.getByLabelText("Append transcript").getAttribute("data-main")).toBeNull();
    expect(screen.getByLabelText("Cancel recording").getAttribute("data-main")).toBeNull();
    // Row buttons, not absolutely positioned over the textarea.
    for (const label of ["Cancel recording", "Append transcript", "Send transcript"]) {
      expect(screen.getByLabelText(label).className).not.toMatch(/\babsolute\b/);
    }
  });

  it("Test 5: all three buttons have type='button' to prevent form submission", () => {
    const { container } = render(
      <RecordingControls
        onCancel={vi.fn()}
        onAppend={vi.fn()}
        onSend={vi.fn()}
        muted={false}
        onToggleMute={vi.fn()}
      />,
    );

    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(4);
    buttons.forEach((btn) => {
      expect(btn.getAttribute("type")).toBe("button");
    });
  });

  it("Test 6: buttons render with lucide icon indicators (aria-hidden SVGs inside each button)", () => {
    const { container } = render(
      <RecordingControls
        onCancel={vi.fn()}
        onAppend={vi.fn()}
        onSend={vi.fn()}
        muted={false}
        onToggleMute={vi.fn()}
      />,
    );

    // Each button should contain an SVG (the lucide icon).
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(4);
    buttons.forEach((btn) => {
      const svg = btn.querySelector("svg");
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
    });
  });
});

describe("RecordingControls — mute", () => {
  it("shows Mute mic when unmuted and fires onToggleMute", () => {
    const onToggleMute = vi.fn();
    render(<RecordingControls onCancel={vi.fn()} onAppend={vi.fn()} onSend={vi.fn()} muted={false} onToggleMute={onToggleMute} />);
    const btn = screen.getByLabelText("Mute mic");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });

  it("shows Unmute mic, pressed, when muted", () => {
    render(<RecordingControls onCancel={vi.fn()} onAppend={vi.fn()} onSend={vi.fn()} muted onToggleMute={vi.fn()} />);
    expect(screen.getByLabelText("Unmute mic").getAttribute("aria-pressed")).toBe("true");
  });
});
