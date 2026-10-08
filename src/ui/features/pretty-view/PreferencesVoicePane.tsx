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
    </div>
  );
}
