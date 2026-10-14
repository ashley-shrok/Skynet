/**
 * PreferencesNotificationsPane — renders the Telegram section and nothing
 * else (the section has its own tests).
 */

vi.mock("./PreferencesTelegramSection", () => ({
  PreferencesTelegramSection: () => <div data-testid="telegram-section-stub" />,
}));

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreferencesNotificationsPane } from "./PreferencesNotificationsPane";

describe("PreferencesNotificationsPane", () => {
  it("renders the Telegram section", () => {
    render(<PreferencesNotificationsPane />);
    expect(screen.getByTestId("telegram-section-stub")).toBeTruthy();
  });
});
