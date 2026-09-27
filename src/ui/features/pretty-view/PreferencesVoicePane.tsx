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

import { useState, useCallback, useEffect } from "react";
import type { UserPreferences } from "@/api/open-tabs-api";
import { saveUserPreferences } from "@/api/open-tabs-api";
import { VoicePicker } from "./pickers/VoicePicker";

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
    </div>
  );
}
