import { describe, it, expect, afterEach } from "vitest";
import { getVoiceModeSettings, setVoiceModeSettings } from "./voice-mode-settings";

afterEach(() => setVoiceModeSettings({}));

describe("voice-mode-settings", () => {
  it("defaults to timed with 'send it', always listening", () => {
    setVoiceModeSettings({ endOfTurn: null, sendPhrase: null, listen: null });
    expect(getVoiceModeSettings()).toEqual({ endOfTurn: "timed", sendPhrase: "send it", listen: "always" });
  });
  it("takes the phrase mode and a trimmed custom phrase", () => {
    setVoiceModeSettings({ endOfTurn: "phrase", sendPhrase: "  over and out " });
    expect(getVoiceModeSettings()).toEqual({ endOfTurn: "phrase", sendPhrase: "over and out", listen: "always" });
  });
  it("takes press-to-talk listening", () => {
    setVoiceModeSettings({ listen: "press" });
    expect(getVoiceModeSettings().listen).toBe("press");
  });
  it("treats unknown modes and blank phrases as the defaults", () => {
    setVoiceModeSettings({ endOfTurn: "auto", sendPhrase: "   ", listen: "sometimes" });
    expect(getVoiceModeSettings()).toEqual({ endOfTurn: "timed", sendPhrase: "send it", listen: "always" });
  });
});
