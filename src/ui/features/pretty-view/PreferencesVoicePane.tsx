/**
 * PreferencesVoicePane — Phase 137 Plan 03 Task 1
 *
 * Voice fallback picker with autosave-on-change wired to saveUserPreferences.
 * Reuses the existing VoicePicker component (the same dropdown used in
 * IdentityModal for per-identity voice binding).
 *
 * Design decisions (CONTEXT.md):
 *   D-06: One-line blurb above the picker. No <h3> title (nav item IS the title).
 *   D-07: No Save button — autosaves on each picker change.
 *   D-13: Inline error on failure (inline div below the picker per D-13 pattern).
 *   D-15: Reuses VoicePicker verbatim.
 *   D-17: Single PUT per onChange, fires immediately (RESEARCH Pitfall 5).
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { UserPreferences } from "@/api/open-tabs-api";
import { saveUserPreferences } from "@/api/open-tabs-api";
import { VoicePicker } from "./pickers/VoicePicker";
import {
  TTS_PLAYBACK_RATE_DEFAULT,
  TTS_PLAYBACK_RATE_MIN,
  TTS_PLAYBACK_RATE_MAX,
} from "./webAudioStreamPlayer";
import {
  VOICE_MODE_SEND_PHRASE_DEFAULT,
  VOICE_MODE_SEND_PHRASE_MAX_LEN,
  type VoiceModeEndOfTurn,
} from "./voice-mode-settings";

// Speed slider: 0.05 steps across the full allowed range. Saves are debounced
// so a drag across the track lands as one PUT, not one per tick.
const TTS_PLAYBACK_RATE_STEP = 0.05;
export const SPEED_SAVE_DEBOUNCE_MS = 400;

function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

export interface PreferencesVoicePaneProps {
  userId: string;
  userPrefs: UserPreferences;
  onUserPrefsChanged?: (prefs: Partial<UserPreferences>) => void;
}

export function PreferencesVoicePane({
  userPrefs,
  onUserPrefsChanged,
}: PreferencesVoicePaneProps): JSX.Element {
  // Local state — empty string = "(default)" option in VoicePicker
  const [fallbackVoice, setFallbackVoice] = useState<string>(
    userPrefs.fallbackVoice ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [speed, setSpeed] = useState<number>(
    userPrefs.ttsPlaybackRate ?? TTS_PLAYBACK_RATE_DEFAULT,
  );
  const [speedError, setSpeedError] = useState<string | null>(null);
  const speedSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSpeed = useRef<number>(
    userPrefs.ttsPlaybackRate ?? TTS_PLAYBACK_RATE_DEFAULT,
  );

  useEffect(() => {
    const next = userPrefs.ttsPlaybackRate ?? TTS_PLAYBACK_RATE_DEFAULT;
    lastSavedSpeed.current = next;
    setSpeed(next);
  }, [userPrefs.ttsPlaybackRate]);

  useEffect(
    () => () => {
      if (speedSaveTimer.current) clearTimeout(speedSaveTimer.current);
    },
    [],
  );

  // Update the readout immediately; persist after the slider settles.
  // 1.0 is stored as null so the user tracks the default.
  const handleSpeedChange = useCallback(
    (next: number) => {
      setSpeed(next);
      setSpeedError(null);
      if (speedSaveTimer.current) clearTimeout(speedSaveTimer.current);
      speedSaveTimer.current = setTimeout(() => {
        speedSaveTimer.current = null;
        const wire = next === TTS_PLAYBACK_RATE_DEFAULT ? null : next;
        saveUserPreferences({ ttsPlaybackRate: wire })
          .then(() => {
            lastSavedSpeed.current = next;
            onUserPrefsChanged?.({ ttsPlaybackRate: wire });
          })
          .catch(() => {
            setSpeed(lastSavedSpeed.current);
            setSpeedError("Couldn't save your speed preference — please try again.");
          });
      }, SPEED_SAVE_DEBOUNCE_MS);
    },
    [onUserPrefsChanged],
  );

  // ---- Voice mode: when to send ------------------------------------------
  const [endOfTurn, setEndOfTurn] = useState<VoiceModeEndOfTurn>(
    userPrefs.voiceModeEndOfTurn === "phrase" ? "phrase" : "timed",
  );
  const [phrase, setPhrase] = useState<string>(
    userPrefs.voiceModeSendPhrase ?? VOICE_MODE_SEND_PHRASE_DEFAULT,
  );
  const lastSavedPhrase = useRef<string>(
    userPrefs.voiceModeSendPhrase ?? VOICE_MODE_SEND_PHRASE_DEFAULT,
  );
  const [turnError, setTurnError] = useState<string | null>(null);

  useEffect(() => {
    setEndOfTurn(userPrefs.voiceModeEndOfTurn === "phrase" ? "phrase" : "timed");
  }, [userPrefs.voiceModeEndOfTurn]);
  useEffect(() => {
    const next = userPrefs.voiceModeSendPhrase ?? VOICE_MODE_SEND_PHRASE_DEFAULT;
    lastSavedPhrase.current = next;
    setPhrase(next);
  }, [userPrefs.voiceModeSendPhrase]);

  // "timed" is the default, so it is stored as null.
  const handleEndOfTurnChange = useCallback(
    async (next: VoiceModeEndOfTurn) => {
      const prev = endOfTurn;
      setEndOfTurn(next);
      setTurnError(null);
      const wire = next === "timed" ? null : next;
      try {
        await saveUserPreferences({ voiceModeEndOfTurn: wire });
        onUserPrefsChanged?.({ voiceModeEndOfTurn: wire });
      } catch {
        setEndOfTurn(prev);
        setTurnError("Couldn't save when voice mode sends — please try again.");
      }
    },
    [endOfTurn, onUserPrefsChanged],
  );

  // Saved on blur / Enter. Blank or default text goes back to the default.
  const commitPhrase = useCallback(async () => {
    const trimmed = phrase.trim();
    const effective = trimmed || VOICE_MODE_SEND_PHRASE_DEFAULT;
    if (!/[\p{L}\p{N}]/u.test(effective)) {
      setPhrase(lastSavedPhrase.current);
      setTurnError("The send phrase needs at least one letter.");
      return;
    }
    setPhrase(effective);
    if (effective === lastSavedPhrase.current) return;
    setTurnError(null);
    const wire = effective.toLowerCase() === VOICE_MODE_SEND_PHRASE_DEFAULT ? null : effective;
    try {
      await saveUserPreferences({ voiceModeSendPhrase: wire });
      lastSavedPhrase.current = effective;
      onUserPrefsChanged?.({ voiceModeSendPhrase: wire });
    } catch {
      setPhrase(lastSavedPhrase.current);
      setTurnError("Couldn't save your send phrase — please try again.");
    }
  }, [phrase, onUserPrefsChanged]);

  // Closing Preferences while the phrase box still has focus may never blur
  // it — save a changed, valid phrase on the way out.
  const phraseRef = useRef(phrase);
  phraseRef.current = phrase;
  const onPrefsChangedRef = useRef(onUserPrefsChanged);
  onPrefsChangedRef.current = onUserPrefsChanged;
  useEffect(
    () => () => {
      const effective = phraseRef.current.trim() || VOICE_MODE_SEND_PHRASE_DEFAULT;
      if (effective === lastSavedPhrase.current || !/[\p{L}\p{N}]/u.test(effective)) return;
      const wire = effective.toLowerCase() === VOICE_MODE_SEND_PHRASE_DEFAULT ? null : effective;
      saveUserPreferences({ voiceModeSendPhrase: wire })
        .then(() => onPrefsChangedRef.current?.({ voiceModeSendPhrase: wire }))
        .catch(() => {});
    },
    [],
  );

  // Sync effect: if an upstream change (e.g. from another tab or optimistic
  // update) modifies userPrefs.fallbackVoice, reflect it locally.
  useEffect(() => {
    setFallbackVoice(userPrefs.fallbackVoice ?? "");
  }, [userPrefs.fallbackVoice]);

  // handleVoiceChange — single PUT per change, fires immediately.
  // Empty string ("(default)" option) maps to null on the wire.
  const handleVoiceChange = useCallback(
    async (next: string) => {
      const prev = fallbackVoice;
      setFallbackVoice(next);
      setSaving(true);
      setError(null);

      try {
        await saveUserPreferences({ fallbackVoice: next || null });
        onUserPrefsChanged?.({ fallbackVoice: next || null });
      } catch {
        // D-13: inline error (below picker). Revert to previous value.
        setFallbackVoice(prev);
        setError("Couldn't save your voice preference — please try again.");
      } finally {
        setSaving(false);
      }
    },
    [fallbackVoice, onUserPrefsChanged],
  );

  return (
    <div className="flex-1 p-6 flex flex-col gap-4 text-[13px] text-[#c8c4b8]" data-testid="preferences-voice-pane">
      {/* D-06: one-line blurb — verbatim wording from CONTEXT.md § Specifics */}
      <p className="text-[13px] text-[#c8c4b8]">
        The voice your agents use to speak.
      </p>

      <VoicePicker
        id="preferences-voice-select"
        value={fallbackVoice}
        onChange={(next) => {
          void handleVoiceChange(next);
        }}
        disabled={saving}
        ariaLabel="The voice your agents use to speak"
      />

      {/* D-13: inline error display (per-CONTEXT.md error pattern) */}
      {error !== null && (
        <div
          className="text-sm text-red-400"
          data-testid="preferences-voice-error"
        >
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2 mt-2">
        <div className="flex items-center justify-between">
          <label htmlFor="preferences-voice-speed">How fast your agents speak.</label>
          <div className="flex items-center gap-3">
            <span
              className="tabular-nums text-[#e8e4d8]"
              data-testid="preferences-voice-speed-value"
            >
              {formatRate(speed)}
            </span>
            <button
              type="button"
              className="text-[12px] underline text-[#8a8678] disabled:opacity-40 disabled:no-underline"
              onClick={() => handleSpeedChange(TTS_PLAYBACK_RATE_DEFAULT)}
              disabled={speed === TTS_PLAYBACK_RATE_DEFAULT}
              data-testid="preferences-voice-speed-reset"
            >
              Reset
            </button>
          </div>
        </div>
        <input
          id="preferences-voice-speed"
          type="range"
          min={TTS_PLAYBACK_RATE_MIN}
          max={TTS_PLAYBACK_RATE_MAX}
          step={TTS_PLAYBACK_RATE_STEP}
          value={speed}
          onChange={(e) => handleSpeedChange(Number(e.target.value))}
          aria-valuetext={formatRate(speed)}
          className="w-full accent-[var(--accent-brand)]"
          data-testid="preferences-voice-speed"
        />
        <div className="flex justify-between text-[11px] text-[#8a8678]">
          <span>{formatRate(TTS_PLAYBACK_RATE_MIN)}</span>
          <span>Pitch rises with speed.</span>
          <span>{formatRate(TTS_PLAYBACK_RATE_MAX)}</span>
        </div>
        {speedError !== null && (
          <div
            className="text-sm text-red-400"
            data-testid="preferences-voice-speed-error"
          >
            {speedError}
          </div>
        )}
      </div>

      <fieldset className="flex flex-col gap-2 mt-2" data-testid="preferences-voice-mode-turn">
        <legend className="mb-2">When voice mode sends what you said.</legend>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name="preferences-voice-mode-turn"
            value="timed"
            checked={endOfTurn === "timed"}
            onChange={() => void handleEndOfTurnChange("timed")}
            className="mt-[3px] accent-[var(--accent-brand)]"
            data-testid="preferences-voice-mode-turn-timed"
          />
          <span>
            After a pause
            <span className="block text-[11px] text-[#8a8678]">
              Three seconds of silence sends it.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name="preferences-voice-mode-turn"
            value="phrase"
            checked={endOfTurn === "phrase"}
            onChange={() => void handleEndOfTurnChange("phrase")}
            className="mt-[3px] accent-[var(--accent-brand)]"
            data-testid="preferences-voice-mode-turn-phrase"
          />
          <span>
            When I say a phrase
            <span className="block text-[11px] text-[#8a8678]">
              Pause as long as you like; end with the phrase to send.
            </span>
          </span>
        </label>
        {endOfTurn === "phrase" && (
          <div className="flex items-center gap-2 ml-6">
            <label htmlFor="preferences-voice-mode-phrase" className="text-[12px] text-[#8a8678]">
              Phrase
            </label>
            <input
              id="preferences-voice-mode-phrase"
              type="text"
              value={phrase}
              maxLength={VOICE_MODE_SEND_PHRASE_MAX_LEN}
              onChange={(e) => setPhrase(e.target.value)}
              onBlur={() => void commitPhrase()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="flex-1 rounded border border-[#3a3832] bg-transparent px-2 py-1 text-[13px] text-[#e8e4d8]"
              data-testid="preferences-voice-mode-phrase"
            />
          </div>
        )}
        {turnError !== null && (
          <div className="text-sm text-red-400" data-testid="preferences-voice-mode-turn-error">
            {turnError}
          </div>
        )}
      </fieldset>
    </div>
  );
}
