import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { HoldFeedbackPill } from "./HoldFeedbackPill";

afterEach(() => {
  vi.useRealTimers();
});

describe("HoldFeedbackPill", () => {
  it("renders nothing when idle", () => {
    const { container } = render(<HoldFeedbackPill committed={false} outside={false} outcome={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("committed inside: Recording, elapsed timer, send/cancel hint", () => {
    vi.useFakeTimers();
    render(<HoldFeedbackPill committed outside={false} outcome={null} />);
    const pill = screen.getByTestId("hold-feedback-pill");
    expect(pill.textContent).toContain("Recording");
    expect(pill.textContent).toContain("0:00");
    expect(pill.textContent).toContain("release to send · slide off to cancel");
    act(() => { vi.advanceTimersByTime(3100); });
    expect(pill.textContent).toContain("0:03");
  });

  it("committed outside: Release to cancel, no timer", () => {
    render(<HoldFeedbackPill committed outside outcome={null} />);
    const pill = screen.getByTestId("hold-feedback-pill");
    expect(pill.textContent).toContain("Release to cancel");
    expect(pill.textContent).toContain("slide back to keep");
    expect(pill.textContent).not.toContain("0:00");
  });

  it("outcomes: Sending… / Cancelled", () => {
    const { rerender } = render(<HoldFeedbackPill committed={false} outside={false} outcome="send" />);
    expect(screen.getByTestId("hold-feedback-pill").textContent).toBe("Sending…");
    rerender(<HoldFeedbackPill committed={false} outside={false} outcome="cancel" />);
    expect(screen.getByTestId("hold-feedback-pill").textContent).toBe("Cancelled");
  });

  it("is an inline chip for the composer's control row, not a floating pill", () => {
    render(<HoldFeedbackPill committed outside={false} outcome={null} />);
    const pill = screen.getByTestId("hold-feedback-pill");
    expect(pill.className).toContain("pv-rec-chip");
    expect(pill.className).not.toMatch(/\babsolute\b/);
  });

  it("tap recording: Recording + timer, no hold hints", () => {
    render(<HoldFeedbackPill committed outside={false} outcome={null} tap />);
    const pill = screen.getByTestId("hold-feedback-pill");
    expect(pill.textContent).toContain("Recording");
    expect(pill.textContent).toContain("0:00");
    expect(pill.textContent).not.toContain("release to send");
  });

  it("shows the live waveform only while recording and only when readLevel is given", () => {
    const { rerender } = render(<HoldFeedbackPill committed outside={false} outcome={null} />);
    expect(screen.queryByTestId("mic-waveform")).toBeNull();
    rerender(<HoldFeedbackPill committed outside={false} outcome={null} readLevel={() => 0.05} />);
    expect(screen.getByTestId("mic-waveform")).toBeTruthy();
    rerender(<HoldFeedbackPill committed={false} outside={false} outcome="send" readLevel={() => 0.05} />);
    expect(screen.queryByTestId("mic-waveform")).toBeNull();
  });
});
