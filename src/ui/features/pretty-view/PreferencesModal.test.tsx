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

// VoicePicker (used by PreferencesVoicePane) imports postSpeak from voice-api.
// Mock the API so tests don't make real network calls.
vi.mock("@/api/voice-api", () => ({
  postSpeak: vi.fn(async () => new Blob([], { type: "audio/wav" })),
  postSpeakStream: vi.fn(async () => new Response(null, { status: 200 })),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));

// saveUserPreferences is called by PreferencesVoicePane on picker change.
vi.mock("@/api/open-tabs-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/open-tabs-api")>();
  return {
    ...actual,
    saveUserPreferences: vi.fn().mockResolvedValue(undefined),
  };
});

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
    expect(screen.getByTestId("preferences-voice-pane")).toBeTruthy();
  });

  it("(c) clicking Notifications nav button shows notifications pane content", async () => {
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    const notifBtn = screen.getByTestId("preferences-nav-notifications");
    await user.click(notifBtn);
    // In test environments pushNotificationsSupported() returns false, so the
    // unsupported message renders. In supporting browsers, the enable-button
    // renders. Either confirms the pane is mounted.
    const notifUnsupported = screen.queryByTestId("preferences-notifications-unsupported");
    const notifEnableBtn = screen.queryByTestId("enable-notifications-button");
    expect(notifUnsupported ?? notifEnableBtn).toBeTruthy();
  });

  it("(c) clicking About you nav button shows about-you pane content", async () => {
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    const aboutBtn = screen.getByTestId("preferences-nav-about-you");
    await user.click(aboutBtn);
    // About-you pane renders the D-22 blurb when hostTree is null (no host picker).
    // Confirm the pane content area is present.
    expect(screen.getByTestId("preferences-modal-pane")).toBeTruthy();
    // Verify the D-22 blurb text is visible in the about-you pane
    expect(
      screen.getByText(/Tell your agents anything you want them to know about you/),
    ).toBeTruthy();
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
    expect(screen.getByTestId("preferences-voice-pane")).toBeTruthy();

    // Close the modal
    rerender(<PreferencesModal {...defaultProps} open={false} />);

    // Reopen — should default back to General
    rerender(<PreferencesModal {...defaultProps} open={true} />);
    // General pane should be visible (no voice pane stub)
    expect(screen.queryByTestId("preferences-voice-pane")).toBeNull();
    expect(screen.getByTestId("preferences-modal-pane")).toBeTruthy();
  });
});
