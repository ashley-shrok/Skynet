/**
 * PreferencesNotificationsPane — the Telegram section always; the
 * this-computer section beside it only where browser notifications work
 * (each section has its own tests).
 */

vi.mock("./PreferencesTelegramSection", () => ({
  PreferencesTelegramSection: () => <div data-testid="telegram-section-stub" />,
}));
vi.mock("./PreferencesBrowserNotificationsSection", () => ({
  PreferencesBrowserNotificationsSection: () => <div data-testid="browser-section-stub" />,
}));
let supported = true;
vi.mock("@/features/notifications/browser-notifications", () => ({
  isBrowserNotificationsSupported: () => supported,
}));

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreferencesNotificationsPane } from "./PreferencesNotificationsPane";

describe("PreferencesNotificationsPane", () => {
  it("renders both sections on a desktop browser", () => {
    supported = true;
    render(<PreferencesNotificationsPane />);
    expect(screen.getByTestId("browser-section-stub")).toBeTruthy();
    expect(screen.getByTestId("telegram-section-stub")).toBeTruthy();
  });

  it("renders only Telegram where browser notifications don't work (phones)", () => {
    supported = false;
    render(<PreferencesNotificationsPane />);
    expect(screen.queryByTestId("browser-section-stub")).toBeNull();
    expect(screen.queryByTestId("preferences-notifications-telegram-heading")).toBeNull();
    expect(screen.getByTestId("telegram-section-stub")).toBeTruthy();
  });
});
