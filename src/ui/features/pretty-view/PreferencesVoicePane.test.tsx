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
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreferencesVoicePane, SPEED_SAVE_DEBOUNCE_MS } from "./PreferencesVoicePane";
import type { UserPreferences } from "@/api/open-tabs-api";

// Mock saveUserPreferences from open-tabs-api
vi.mock("@/api/open-tabs-api", () => ({
  saveUserPreferences: vi.fn(),
}));

// VoicePicker loads the active TTS provider's voice list from the server.
vi.mock("@/api/voice-api", () => ({
  SAMPLE_PHRASE: "Hi, this is your voice.",
  postSpeak: vi.fn(async () => new Blob([], { type: "audio/wav" })),
  fetchVoiceCatalog: vi.fn(async () => ({
    voices: ["Danielle", "Joanna", "Ruth", "Salli", "Tiffany", "Matthew", "Stephen"].map((id) => ({ id, name: id })),
    defaultVoice: "Joanna",
    listError: false,
  })),
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

describe("PreferencesVoicePane — speed slider", () => {
  it("speed 1: renders the saved speed, or 1× when unset", () => {
    const { unmount } = render(
      <PreferencesVoicePane userId="user1" userPrefs={makePrefs({ ttsPlaybackRate: 1.25 })} />,
    );
    expect((screen.getByTestId("preferences-voice-speed") as HTMLInputElement).value).toBe("1.25");
    expect(screen.getByTestId("preferences-voice-speed-value").textContent).toBe("1.25×");
    unmount();

    render(<PreferencesVoicePane userId="user1" userPrefs={makePrefs()} />);
    expect(screen.getByTestId("preferences-voice-speed-value").textContent).toBe("1×");
  });

  it("speed 2: spans 0.25×–4× in 0.05 steps", () => {
    render(<PreferencesVoicePane userId="user1" userPrefs={makePrefs()} />);
    const slider = screen.getByTestId("preferences-voice-speed") as HTMLInputElement;
    expect(slider.min).toBe("0.25");
    expect(slider.max).toBe("4");
    expect(slider.step).toBe("0.05");
  });

  it("speed 3: a burst of changes saves once, after the debounce, with the final value", async () => {
    vi.useFakeTimers();
    try {
      const onChanged = vi.fn();
      render(
        <PreferencesVoicePane userId="user1" userPrefs={makePrefs()} onUserPrefsChanged={onChanged} />,
      );
      const slider = screen.getByTestId("preferences-voice-speed");
      fireEvent.change(slider, { target: { value: "1.5" } });
      fireEvent.change(slider, { target: { value: "2.75" } });
      expect(screen.getByTestId("preferences-voice-speed-value").textContent).toBe("2.75×");
      expect(mockSave).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SPEED_SAVE_DEBOUNCE_MS);
      });
      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(mockSave).toHaveBeenCalledWith({ ttsPlaybackRate: 2.75 });
      expect(onChanged).toHaveBeenCalledWith({ ttsPlaybackRate: 2.75 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("speed 4: Reset saves null so the user tracks the 1× default", async () => {
    vi.useFakeTimers();
    try {
      render(<PreferencesVoicePane userId="user1" userPrefs={makePrefs({ ttsPlaybackRate: 1.25 })} />);
      fireEvent.click(screen.getByTestId("preferences-voice-speed-reset"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SPEED_SAVE_DEBOUNCE_MS);
      });
      expect(mockSave).toHaveBeenCalledWith({ ttsPlaybackRate: null });
      expect(screen.getByTestId("preferences-voice-speed-value").textContent).toBe("1×");
    } finally {
      vi.useRealTimers();
    }
  });

  it("speed 5: failed save reverts to the last saved speed and shows an inline error", async () => {
    vi.useFakeTimers();
    try {
      mockSave.mockRejectedValueOnce(new Error("boom"));
      render(<PreferencesVoicePane userId="user1" userPrefs={makePrefs({ ttsPlaybackRate: 1.25 })} />);
      fireEvent.change(screen.getByTestId("preferences-voice-speed"), { target: { value: "3" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SPEED_SAVE_DEBOUNCE_MS);
      });
      expect(screen.getByTestId("preferences-voice-speed-value").textContent).toBe("1.25×");
      expect(screen.getByTestId("preferences-voice-speed-error")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PreferencesVoicePane — voice mode: when to send", () => {
  it("defaults to 'after a pause' with no phrase box", () => {
    render(<PreferencesVoicePane userId="user1" userPrefs={makePrefs()} />);
    expect((screen.getByTestId("preferences-voice-mode-turn-timed") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId("preferences-voice-mode-phrase")).toBeNull();
  });

  it("choosing 'when I say a phrase' saves it and shows the phrase prefilled with 'send it'", async () => {
    const onUserPrefsChanged = vi.fn();
    render(<PreferencesVoicePane userId="user1" userPrefs={makePrefs()} onUserPrefsChanged={onUserPrefsChanged} />);
    fireEvent.click(screen.getByTestId("preferences-voice-mode-turn-phrase"));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ voiceModeEndOfTurn: "phrase" }));
    expect(onUserPrefsChanged).toHaveBeenCalledWith({ voiceModeEndOfTurn: "phrase" });
    expect((screen.getByTestId("preferences-voice-mode-phrase") as HTMLInputElement).value).toBe("send it");
  });

  it("switching back to 'after a pause' stores null (the default)", async () => {
    render(<PreferencesVoicePane userId="user1" userPrefs={makePrefs({ voiceModeEndOfTurn: "phrase" })} />);
    fireEvent.click(screen.getByTestId("preferences-voice-mode-turn-timed"));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ voiceModeEndOfTurn: null }));
  });

  it("saves a custom phrase on blur, trimmed", async () => {
    const onUserPrefsChanged = vi.fn();
    render(
      <PreferencesVoicePane
        userId="user1"
        userPrefs={makePrefs({ voiceModeEndOfTurn: "phrase" })}
        onUserPrefsChanged={onUserPrefsChanged}
      />,
    );
    const input = screen.getByTestId("preferences-voice-mode-phrase") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  over and out " } });
    fireEvent.blur(input);
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ voiceModeSendPhrase: "over and out" }));
    expect(onUserPrefsChanged).toHaveBeenCalledWith({ voiceModeSendPhrase: "over and out" });
  });

  it("a blank phrase falls back to the default without an extra save", async () => {
    render(<PreferencesVoicePane userId="user1" userPrefs={makePrefs({ voiceModeEndOfTurn: "phrase" })} />);
    const input = screen.getByTestId("preferences-voice-mode-phrase") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe("send it"));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("rejects a phrase with no letters and keeps the saved one", async () => {
    render(
      <PreferencesVoicePane
        userId="user1"
        userPrefs={makePrefs({ voiceModeEndOfTurn: "phrase", voiceModeSendPhrase: "over and out" })}
      />,
    );
    const input = screen.getByTestId("preferences-voice-mode-phrase") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "!!!" } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByTestId("preferences-voice-mode-turn-error")).toBeTruthy());
    expect(input.value).toBe("over and out");
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("reverts the choice and shows an error when the save fails", async () => {
    mockSave.mockRejectedValueOnce(new Error("nope"));
    render(<PreferencesVoicePane userId="user1" userPrefs={makePrefs()} />);
    fireEvent.click(screen.getByTestId("preferences-voice-mode-turn-phrase"));
    await waitFor(() => expect(screen.getByTestId("preferences-voice-mode-turn-error")).toBeTruthy());
    expect((screen.getByTestId("preferences-voice-mode-turn-timed") as HTMLInputElement).checked).toBe(true);
  });
});
