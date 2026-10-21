import { useEffect, useRef, useState } from "react";
import { Volume2, Check } from "lucide-react";
import { postSpeak, SAMPLE_PHRASE } from "@/api/voice-api";
import { useVoiceCatalog, voiceLabel } from "./useVoiceCatalog";
import { notifySpeakFailed } from "../speak-errors";
import { KitButton, KitIconButton, KitSelect } from "@/components/kit";

export { SAMPLE_PHRASE };

// The voice list comes from the server (the active TTS provider's voices) —
// the app keeps no list of its own. A saved voice the active provider doesn't
// offer is still shown, greyed out with a note, never replaced or blanked:
// saved voices survive provider switches untouched.
export const UNAVAILABLE_NOTE = "Not available on the current voice service";
export const LIST_ERROR_NOTE = "Couldn't load the voice list";

export function VoicePicker({
  value,
  onChange,
  disabled,
  id,
  ariaLabel,
  hideUnavailableNote,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  /** The caller says it in its own words (e.g. a settings row's description). */
  hideUnavailableNote?: boolean;
}) {
  const catalogState = useVoiceCatalog();
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);
  const sampleUrlRef = useRef<string | null>(null);

  // Draft decouples dropdown selection from commit — user can audition
  // via the sample button before clicking apply. Resyncs when the parent
  // pushes a new value (modal reopened on a different subject, or save
  // round-trip landing).
  const [draft, setDraft] = useState<string>(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Unmount cleanup for sample audio
  useEffect(() => {
    return () => {
      if (sampleAudioRef.current) {
        sampleAudioRef.current.pause();
        if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
        sampleAudioRef.current = null;
        sampleUrlRef.current = null;
      }
    };
  }, []);

  // Patch #223: sample playback for voice picker
  async function onSampleClick(): Promise<void> {
    try {
      if (sampleAudioRef.current) {
        sampleAudioRef.current.pause();
        if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
        sampleAudioRef.current = null;
        sampleUrlRef.current = null;
      }
      const blob = await postSpeak(SAMPLE_PHRASE, draft ? [draft] : []);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      sampleAudioRef.current = audio;
      sampleUrlRef.current = url;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (sampleAudioRef.current === audio) {
          sampleAudioRef.current = null;
          sampleUrlRef.current = null;
        }
      };
      // patch #211 lesson: NEVER bare audio.play().catch(...)
      Promise.resolve(audio.play()).catch(() => {});
    } catch (err) {
      // handleApiError already logged; never fail silently (provider down,
      // key revoked, out of credits).
      const status = (err as { status?: unknown })?.status;
      notifySpeakFailed(typeof status === "number" ? status : 502);
    }
  }

  const dirty = draft !== value;

  const ready = catalogState.status === "ready";
  const voices = ready ? catalogState.catalog.voices : [];
  const offered = (id: string) => voices.some((v) => v.id === id);
  // The saved value isn't in the active provider's list → keep it on screen,
  // greyed out, rather than pretending the default was chosen.
  const valueUnavailable = ready && value !== "" && !offered(value);
  const draftUnavailable = ready && draft !== "" && !offered(draft);
  const listFailed = catalogState.status === "error";
  // Picking needs the list; on failure the saved voice still shows by id.
  const selectDisabled = disabled || !ready;

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <KitSelect
          id={id ?? "voice-picker"}
          aria-label={ariaLabel}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={selectDisabled}
          className="flex-1 min-w-0"
        >
          <option value="">(default)</option>
          {valueUnavailable && (
            <option value={value} disabled data-testid="voice-picker-unavailable-option">
              {voiceLabel(catalogState, value)}
            </option>
          )}
          {!ready && value !== "" && (
            // Loading or list failed: still show what's saved (by name, never a raw code).
            <option value={value}>{voiceLabel(catalogState, value)}</option>
          )}
          {voices.map((v) => (
            <option key={v.id} value={v.id} title={v.description}>
              {v.description ? `${v.name} — ${v.description}` : v.name}
            </option>
          ))}
        </KitSelect>
        <KitIconButton
          label="Sample voice"
          filled
          onClick={() => { void onSampleClick(); }}
          disabled={disabled || draftUnavailable}
        >
          <Volume2 />
        </KitIconButton>
        {dirty && (
          <KitButton
            variant="primary"
            size="sm"
            aria-label="Apply voice"
            title="Apply voice"
            data-testid="voice-picker-apply"
            onClick={() => onChange(draft)}
            disabled={disabled}
          >
            <Check />
          </KitButton>
        )}
      </div>
      {draftUnavailable && !hideUnavailableNote && (
        <span data-testid="voice-picker-unavailable-note" className="k-help">
          {UNAVAILABLE_NOTE}
        </span>
      )}
      {listFailed && (
        <span data-testid="voice-picker-list-error" className="k-err">
          {LIST_ERROR_NOTE}
        </span>
      )}
    </div>
  );
}
