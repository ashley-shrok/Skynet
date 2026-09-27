/**
 * PreferencesModal tests
 *
 * Five behavior cases:
 *   (a) rendering with open=true shows data-testid="preferences-modal"
 *   (b) rendering with open=false does not show the modal
 *   (c) clicking each nav button shows the matching pane content
 *   (d) close via Escape calls onOpenChange(false)
 *   (e) unmount+remount with open=true after previously navigating to Voice restarts on General (D-05 reset invariant)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PreferencesModal from "./PreferencesModal";
import type { UserPreferences } from "@/api/open-tabs-api";

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  userId: "user-123",
  avatarPath: null,
  onAvatarChanged: vi.fn(),
  userPrefs: {} as UserPreferences,
  hostTree: null,
  defaultHostId: null,
};

describe("PreferencesModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) renders modal when open=true", () => {
    render(<PreferencesModal {...defaultProps} open={true} />);
    expect(screen.getByTestId("preferences-modal")).toBeTruthy();
  });

  it("(b) does not render modal content when open=false", () => {
    render(<PreferencesModal {...defaultProps} open={false} />);
    expect(screen.queryByTestId("preferences-modal")).toBeNull();
  });

  it("(c) clicking Voice nav button shows voice pane content", async () => {
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    const voiceBtn = screen.getByTestId("preferences-nav-voice");
    await user.click(voiceBtn);
    expect(screen.getByTestId("preferences-voice-pane-stub")).toBeTruthy();
  });

  it("(c) clicking Notifications nav button shows notifications pane content", async () => {
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    const notifBtn = screen.getByTestId("preferences-nav-notifications");
    await user.click(notifBtn);
    expect(screen.getByTestId("preferences-notifications-pane-stub")).toBeTruthy();
  });

  it("(c) clicking About you nav button shows about-you pane content", async () => {
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    const aboutBtn = screen.getByTestId("preferences-nav-about-you");
    await user.click(aboutBtn);
    expect(screen.getByTestId("preferences-about-you-pane-stub")).toBeTruthy();
  });

  it("(d) Escape key calls onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    render(<PreferencesModal {...defaultProps} open={true} onOpenChange={onOpenChange} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("(e) reopening after navigating to Voice resets active tab to General (D-05 invariant)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PreferencesModal {...defaultProps} open={true} />);

    // Navigate to Voice
    const voiceBtn = screen.getByTestId("preferences-nav-voice");
    await user.click(voiceBtn);
    expect(screen.getByTestId("preferences-voice-pane-stub")).toBeTruthy();

    // Close the modal
    rerender(<PreferencesModal {...defaultProps} open={false} />);

    // Reopen — should default back to General
    rerender(<PreferencesModal {...defaultProps} open={true} />);
    // General pane should be visible (no voice pane stub)
    expect(screen.queryByTestId("preferences-voice-pane-stub")).toBeNull();
    expect(screen.getByTestId("preferences-modal-pane")).toBeTruthy();
  });
});
