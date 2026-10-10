import { describe, it, expect, afterEach } from "vitest";
import { getVoiceModeSettings, setVoiceModeSettings } from "./voice-mode-settings";

afterEach(() => setVoiceModeSettings({}));

describe("voice-mode-settings", () => {
  it("defaults to timed with 'send it'", () => {
    setVoiceModeSettings({ endOfTurn: null, sendPhrase: null });
    expect(getVoiceModeSettings()).toEqual({ endOfTurn: "timed", sendPhrase: "send it" });
  });
  it("takes the phrase mode and a trimmed custom phrase", () => {
    setVoiceModeSettings({ endOfTurn: "phrase", sendPhrase: "  over and out " });
    expect(getVoiceModeSettings()).toEqual({ endOfTurn: "phrase", sendPhrase: "over and out" });
  });
  it("treats unknown modes and blank phrases as the defaults", () => {
    setVoiceModeSettings({ endOfTurn: "auto", sendPhrase: "   " });
    expect(getVoiceModeSettings()).toEqual({ endOfTurn: "timed", sendPhrase: "send it" });
  });
});
