/**
 * PreferencesVoicePane tests — Phase 137 Plan 03 Task 1
 *
 * Covers all 6 acceptance cases:
 *   1. Renders with initial fallbackVoice preselected
 *   2. Rendering with fallbackVoice=null preselects the "(default)" option
 *   3. onChange fires saveUserPreferences with the new voice
 *   4. Empty selection (back to "(default)") saves null, not empty string
 *   5. Failed save reverts local state and surfaces inline error
 *   6. No debounce — PUT fires within the same click's task-tick
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreferencesVoicePane } from "./PreferencesVoicePane";
import type { UserPreferences } from "@/api/open-tabs-api";

// Mock saveUserPreferences from open-tabs-api
vi.mock("@/api/open-tabs-api", () => ({
  saveUserPreferences: vi.fn(),
}));

import { saveUserPreferences } from "@/api/open-tabs-api";

const mockSave = saveUserPreferences as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
});

function makePrefs(partial: Partial<UserPreferences> = {}): UserPreferences {
  return { fallbackVoice: null, ...partial };
}

describe("PreferencesVoicePane", () => {
  it("case 1: renders with initial fallbackVoice preselected", () => {
    render(
      <PreferencesVoicePane
        userId="user1"
        userPrefs={makePrefs({ fallbackVoice: "Ruth" })}
      />,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("Ruth");
  });

  it("case 2: rendering with fallbackVoice=null preselects the (default) option", () => {
    render(
      <PreferencesVoicePane
        userId="user1"
        userPrefs={makePrefs({ fallbackVoice: null })}
      />,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("case 3: apply fires saveUserPreferences with the new voice", async () => {
    const user = userEvent.setup();

    render(
      <PreferencesVoicePane
        userId="user1"
        userPrefs={makePrefs({ fallbackVoice: null })}
      />,
    );

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "Joanna");
    // Nothing saves until apply.
    expect(mockSave).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("voice-picker-apply"));

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(mockSave).toHaveBeenCalledWith({ fallbackVoice: "Joanna" });
    });
  });

  it("case 4: empty selection (back to default) saves null not empty string", async () => {
    const user = userEvent.setup();

    render(
      <PreferencesVoicePane
        userId="user1"
        userPrefs={makePrefs({ fallbackVoice: "Ruth" })}
      />,
    );

    const select = screen.getByRole("combobox");
    // Select the (default) empty-value option, then apply.
    await user.selectOptions(select, "");
    await user.click(screen.getByTestId("voice-picker-apply"));

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(mockSave).toHaveBeenCalledWith({ fallbackVoice: null });
    });
  });

  it("case 5: failed save reverts local state and surfaces inline error", async () => {
    const user = userEvent.setup();
    mockSave.mockRejectedValueOnce(new Error("Network error"));

    render(
      <PreferencesVoicePane
        userId="user1"
        userPrefs={makePrefs({ fallbackVoice: "Ruth" })}
      />,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    await user.selectOptions(select, "Joanna");
    await user.click(screen.getByTestId("voice-picker-apply"));

    await waitFor(() => {
      // Should revert to previous value
      expect(select.value).toBe("Ruth");
      // Should show inline error
      const errorEl = screen.getByTestId("preferences-voice-error");
      expect(errorEl.textContent).toBeTruthy();
    });
  });

  it("case 6: no debounce — PUT fires within the same apply-click task-tick", async () => {
    const user = userEvent.setup();

    render(
      <PreferencesVoicePane
        userId="user1"
        userPrefs={makePrefs({ fallbackVoice: null })}
      />,
    );

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "Matthew");
    await user.click(screen.getByTestId("voice-picker-apply"));

    // Mock was called immediately (no debounce after apply).
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith({ fallbackVoice: "Matthew" });
  });
});
