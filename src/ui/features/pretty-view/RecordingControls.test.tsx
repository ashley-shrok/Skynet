// Tests for RecordingControls — the three-button recording controls component.
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

  it("Test 3: cancel button has a red-ish class (hsla hue-0 red signature)", () => {
    const { container } = render(
      <RecordingControls
        onCancel={vi.fn()}
        onAppend={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const cancelBtn = screen.getByLabelText("Cancel recording");
    // The cancel button uses hsla(0, ...) which is the hue-0 red signature.
    expect(cancelBtn.className).toMatch(/hsla\(0/);
  });

  it("Test 4: send button has a coral class referencing pv-code-fg or ffb896", () => {
    render(
      <RecordingControls
        onCancel={vi.fn()}
        onAppend={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const sendBtn = screen.getByLabelText("Send transcript");
    // The send button uses --color-pv-code-fg (the coral #ffb896 token).
    expect(sendBtn.className).toMatch(/color-pv-code-fg|ffb896/);
  });

  it("Test 5: all three buttons have type='button' to prevent form submission", () => {
    const { container } = render(
      <RecordingControls
        onCancel={vi.fn()}
        onAppend={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(3);
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
      />,
    );

    // Each button should contain an SVG (the lucide icon).
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(3);
    buttons.forEach((btn) => {
      const svg = btn.querySelector("svg");
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
    });
  });
});
