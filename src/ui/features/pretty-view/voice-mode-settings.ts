/**
 * voice-mode-settings — the user's hands-free voice mode turn-end preference,
 * pushed in by AppShell whenever user preferences load or the Voice pane
 * changes them (same pattern as setTtsPlaybackRate in webAudioStreamPlayer).
 * useVoiceMode reads it at decision time, so a change applies mid-session.
 *
 * Mirrors VOICE_MODE_END_OF_TURN_VALUES / VOICE_MODE_SEND_PHRASE_MAX_LEN /
 * VOICE_MODE_PAUSE_SECONDS_MIN / VOICE_MODE_PAUSE_SECONDS_MAX in
 * src/backend/database/routes/user-preferences.ts — keep the two in step.
 */

export type VoiceModeEndOfTurn = "timed" | "phrase";

export const VOICE_MODE_END_OF_TURN_DEFAULT: VoiceModeEndOfTurn = "timed";
export const VOICE_MODE_SEND_PHRASE_DEFAULT = "over";
export const VOICE_MODE_SEND_PHRASE_MAX_LEN = 40;
/** Timed mode: seconds of silence after real speech that end the turn. */
export const VOICE_MODE_PAUSE_SECONDS_DEFAULT = 3;
/** Shorter than this can't be honoured: a piece only closes after 1.5s of quiet. */
export const VOICE_MODE_PAUSE_SECONDS_MIN = 2;
export const VOICE_MODE_PAUSE_SECONDS_MAX = 3600;

/** A whole number of seconds inside the bounds, or null when `n` isn't a number. */
export function clampPauseSeconds(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  return Math.min(VOICE_MODE_PAUSE_SECONDS_MAX, Math.max(VOICE_MODE_PAUSE_SECONDS_MIN, Math.round(n)));
}

export interface VoiceModeSettings {
  endOfTurn: VoiceModeEndOfTurn;
  sendPhrase: string;
  pauseSeconds: number;
}

let current: VoiceModeSettings = {
  endOfTurn: VOICE_MODE_END_OF_TURN_DEFAULT,
  sendPhrase: VOICE_MODE_SEND_PHRASE_DEFAULT,
  pauseSeconds: VOICE_MODE_PAUSE_SECONDS_DEFAULT,
};

export function setVoiceModeSettings(prefs: {
  endOfTurn?: string | null;
  sendPhrase?: string | null;
  pauseSeconds?: number | null;
}): void {
  const phrase = prefs.sendPhrase?.trim();
  current = {
    endOfTurn: prefs.endOfTurn === "phrase" ? "phrase" : VOICE_MODE_END_OF_TURN_DEFAULT,
    sendPhrase: phrase ? phrase : VOICE_MODE_SEND_PHRASE_DEFAULT,
    pauseSeconds:
      typeof prefs.pauseSeconds === "number"
        ? (clampPauseSeconds(prefs.pauseSeconds) ?? VOICE_MODE_PAUSE_SECONDS_DEFAULT)
        : VOICE_MODE_PAUSE_SECONDS_DEFAULT,
  };
}

export function getVoiceModeSettings(): VoiceModeSettings {
  return current;
}
