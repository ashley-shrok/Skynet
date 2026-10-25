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
import { useVoiceCatalog, voiceLabel } from "./pickers/useVoiceCatalog";
import {
  KitButton,
  KitInput,
  KitOption,
  KitRadio,
  KitSettingsGroup,
  KitSettingsRow,
  KitSlider,
} from "@/components/kit";
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

  // 1.0 is stored as null so the user tracks the default.
  const mounted = useRef(true);
  const saveSpeed = useCallback((next: number) => {
    const wire = next === TTS_PLAYBACK_RATE_DEFAULT ? null : next;
    saveUserPreferences({ ttsPlaybackRate: wire })
      .then(() => {
        lastSavedSpeed.current = next;
        onPrefsChangedRef.current?.({ ttsPlaybackRate: wire });
      })
      .catch(() => {
        if (!mounted.current) return;
        setSpeed(lastSavedSpeed.current);
        setSpeedError("Couldn't save your speed preference — please try again.");
      });
  }, []);
  const pendingSpeed = useRef<number | null>(null);

  // Leaving the section (or closing) inside the settle time still saves.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (speedSaveTimer.current) clearTimeout(speedSaveTimer.current);
      speedSaveTimer.current = null;
      if (pendingSpeed.current !== null) saveSpeed(pendingSpeed.current);
      pendingSpeed.current = null;
    };
  }, [saveSpeed]);

  // Update the readout immediately; persist after the slider settles.
  const handleSpeedChange = useCallback(
    (next: number) => {
      setSpeed(next);
      setSpeedError(null);
      pendingSpeed.current = next;
      if (speedSaveTimer.current) clearTimeout(speedSaveTimer.current);
      speedSaveTimer.current = setTimeout(() => {
        speedSaveTimer.current = null;
        pendingSpeed.current = null;
        saveSpeed(next);
      }, SPEED_SAVE_DEBOUNCE_MS);
    },
    [saveSpeed],
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

  // A saved voice the current voice service doesn't offer: say what plays
  // instead, in the row itself.
  const catalog = useVoiceCatalog();
  const voiceUnavailable =
    catalog.status === "ready" &&
    fallbackVoice !== "" &&
    !catalog.catalog.voices.some((v) => v.id === fallbackVoice);
  const voiceDescription = voiceUnavailable
    ? `${voiceLabel(catalog, fallbackVoice)} isn't one of the current voice service's voices, so replies use ${voiceLabel(catalog, catalog.catalog.defaultVoice)}.`
    : undefined;

  return (
    <div data-testid="preferences-voice-pane">
      <KitSettingsGroup
        footer={
          error !== null ? (
            <span className="k-err" role="alert" data-testid="preferences-voice-error">
              {error}
            </span>
          ) : (
            "Each agent can have its own voice; this is the one they use when they don't."
          )
        }
      >
        <KitSettingsRow
          label={<label htmlFor="preferences-voice-select">Voice</label>}
          description={
            voiceDescription ? (
              <span data-testid="preferences-voice-unavailable">{voiceDescription}</span>
            ) : undefined
          }
          control={
            <div className="w-[200px] max-sm:w-[160px] shrink-0">
              <VoicePicker
                id="preferences-voice-select"
                value={fallbackVoice}
                onChange={(next) => {
                  void handleVoiceChange(next);
                }}
                disabled={saving}
                ariaLabel="Voice"
                hideUnavailableNote
              />
            </div>
          }
        />
      </KitSettingsGroup>

      <KitSettingsGroup
        title="Speed"
        footer={
          speedError !== null ? (
            <span className="k-err block" role="alert" data-testid="preferences-voice-speed-error">
              {speedError}
            </span>
          ) : undefined
        }
      >
        <KitSettingsRow
          stacked
          label={
            <span className="flex items-center gap-2">
              <label htmlFor="preferences-voice-speed" className="flex-1">
                How fast replies are read
              </label>
              <span
                className="tabular-nums font-semibold"
                data-testid="preferences-voice-speed-value"
              >
                {formatRate(speed)}
              </span>
              <KitButton
                size="sm"
                variant="plain"
                onClick={() => handleSpeedChange(TTS_PLAYBACK_RATE_DEFAULT)}
                disabled={speed === TTS_PLAYBACK_RATE_DEFAULT}
                data-testid="preferences-voice-speed-reset"
              >
                Reset
              </KitButton>
            </span>
          }
          control={
            <span className="flex items-center gap-3 text-[12px] text-[var(--k-t3)] tabular-nums">
              <span>{formatRate(TTS_PLAYBACK_RATE_MIN)}</span>
              <KitSlider
                id="preferences-voice-speed"
                min={TTS_PLAYBACK_RATE_MIN}
                max={TTS_PLAYBACK_RATE_MAX}
                step={TTS_PLAYBACK_RATE_STEP}
                value={speed}
                onValueChange={handleSpeedChange}
                aria-valuetext={formatRate(speed)}
                className="flex-1 min-w-0"
                data-testid="preferences-voice-speed"
              />
              <span>{formatRate(TTS_PLAYBACK_RATE_MAX)}</span>
            </span>
          }
        />
      </KitSettingsGroup>

      <section
        className="k-group-wrap"
        role="radiogroup"
        aria-labelledby="preferences-voice-mode-turn-title"
        data-testid="preferences-voice-mode-turn"
      >
        <h3 id="preferences-voice-mode-turn-title" className="k-group-title">
          Voice mode sends what you said
        </h3>
        <div className="k-group">
          <KitSettingsRow
            label={
              <KitOption
                control={
                  <KitRadio
                    name="preferences-voice-mode-turn"
                    value="timed"
                    checked={endOfTurn === "timed"}
                    onChange={() => void handleEndOfTurnChange("timed")}
                    data-testid="preferences-voice-mode-turn-timed"
                  />
                }
                label="After a pause"
                description="Three seconds of silence sends it."
              />
            }
          />
          <KitSettingsRow
            label={
              <KitOption
                control={
                  <KitRadio
                    name="preferences-voice-mode-turn"
                    value="phrase"
                    checked={endOfTurn === "phrase"}
                    onChange={() => void handleEndOfTurnChange("phrase")}
                    data-testid="preferences-voice-mode-turn-phrase"
                  />
                }
                label="When I say a phrase"
                description="Pause as long as you like; end with the phrase to send."
              />
            }
          />
          {endOfTurn === "phrase" && (
            <KitSettingsRow
              label={<label htmlFor="preferences-voice-mode-phrase">Phrase</label>}
              control={
                <KitInput
                  id="preferences-voice-mode-phrase"
                  type="text"
                  size="sm"
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
                  className="max-w-[60%] text-right"
                  data-testid="preferences-voice-mode-phrase"
                />
              }
            />
          )}
        </div>
        {turnError !== null ? (
          <p className="k-group-foot">
            <span className="k-err" role="alert" data-testid="preferences-voice-mode-turn-error">
              {turnError}
            </span>
          </p>
        ) : endOfTurn === "phrase" ? (
          <p className="k-group-foot">The phrase is left out of what&apos;s sent.</p>
        ) : null}
      </section>

    </div>
  );
}
