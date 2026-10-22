/**
 * voice-mode-settings — the user's hands-free voice mode preferences (turn end, listening),
 * pushed in by AppShell whenever user preferences load or the Voice pane
 * changes them (same pattern as setTtsPlaybackRate in webAudioStreamPlayer).
 * useVoiceMode reads it at decision time, so a change applies mid-session.
 *
 * Mirrors VOICE_MODE_END_OF_TURN_VALUES / VOICE_MODE_SEND_PHRASE_MAX_LEN / VOICE_MODE_LISTEN_VALUES in
 * src/backend/database/routes/user-preferences.ts — keep the two in step.
 */

export type VoiceModeEndOfTurn = "timed" | "phrase";
/**
 * always — the mic is open the whole session (hands-free).
 * press  — the mic is off between turns; a headphone press (or a tap on the
 *          chip) opens it for one turn, and it closes again once the turn ends.
 */
export type VoiceModeListen = "always" | "press";

export const VOICE_MODE_END_OF_TURN_DEFAULT: VoiceModeEndOfTurn = "timed";
export const VOICE_MODE_SEND_PHRASE_DEFAULT = "send it";
export const VOICE_MODE_SEND_PHRASE_MAX_LEN = 40;
export const VOICE_MODE_LISTEN_DEFAULT: VoiceModeListen = "always";

export interface VoiceModeSettings {
  endOfTurn: VoiceModeEndOfTurn;
  sendPhrase: string;
  listen: VoiceModeListen;
}

let current: VoiceModeSettings = {
  endOfTurn: VOICE_MODE_END_OF_TURN_DEFAULT,
  sendPhrase: VOICE_MODE_SEND_PHRASE_DEFAULT,
  listen: VOICE_MODE_LISTEN_DEFAULT,
};

export function setVoiceModeSettings(prefs: {
  endOfTurn?: string | null;
  sendPhrase?: string | null;
  listen?: string | null;
}): void {
  const phrase = prefs.sendPhrase?.trim();
  current = {
    endOfTurn: prefs.endOfTurn === "phrase" ? "phrase" : VOICE_MODE_END_OF_TURN_DEFAULT,
    sendPhrase: phrase ? phrase : VOICE_MODE_SEND_PHRASE_DEFAULT,
    listen: prefs.listen === "press" ? "press" : VOICE_MODE_LISTEN_DEFAULT,
  };
}

export function getVoiceModeSettings(): VoiceModeSettings {
  return current;
}
