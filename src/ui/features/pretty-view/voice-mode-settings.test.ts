import { describe, it, expect, afterEach } from "vitest";
import { clampPauseSeconds, getVoiceModeSettings, setVoiceModeSettings } from "./voice-mode-settings";

afterEach(() => setVoiceModeSettings({}));

describe("voice-mode-settings", () => {
  it("defaults to timed with a 3-second pause and 'over'", () => {
    setVoiceModeSettings({ endOfTurn: null, sendPhrase: null, pauseSeconds: null });
    expect(getVoiceModeSettings()).toEqual({ endOfTurn: "timed", sendPhrase: "over", pauseSeconds: 3 });
  });
  it("takes the phrase mode and a trimmed custom phrase", () => {
    setVoiceModeSettings({ endOfTurn: "phrase", sendPhrase: "  over and out " });
    expect(getVoiceModeSettings()).toEqual({ endOfTurn: "phrase", sendPhrase: "over and out", pauseSeconds: 3 });
  });
  it("treats unknown modes and blank phrases as the defaults", () => {
    setVoiceModeSettings({ endOfTurn: "auto", sendPhrase: "   " });
    expect(getVoiceModeSettings()).toEqual({ endOfTurn: "timed", sendPhrase: "over", pauseSeconds: 3 });
  });
  it("takes the user's pause, kept inside 2 seconds to an hour", () => {
    setVoiceModeSettings({ pauseSeconds: 30 });
    expect(getVoiceModeSettings().pauseSeconds).toBe(30);
    setVoiceModeSettings({ pauseSeconds: 1 });
    expect(getVoiceModeSettings().pauseSeconds).toBe(2);
    setVoiceModeSettings({ pauseSeconds: 1e9 });
    expect(getVoiceModeSettings().pauseSeconds).toBe(3600);
    setVoiceModeSettings({ pauseSeconds: Number.NaN });
    expect(getVoiceModeSettings().pauseSeconds).toBe(3);
  });
  it("clampPauseSeconds rounds to whole seconds and rejects non-numbers", () => {
    expect(clampPauseSeconds(4.4)).toBe(4);
    expect(clampPauseSeconds(-5)).toBe(2);
    expect(clampPauseSeconds(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
