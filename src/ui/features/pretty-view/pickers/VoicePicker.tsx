import { useEffect, useRef, useState } from "react";
import { Volume2, Check } from "lucide-react";
import { postSpeak, SAMPLE_PHRASE } from "@/api/voice-api";
import { useVoiceCatalog, voiceLabel } from "./useVoiceCatalog";
import { notifySpeakFailed } from "../speak-errors";

export { SAMPLE_PHRASE };

// The voice list comes from the server (the active TTS provider's voices) —
// the app keeps no list of its own. A saved voice the active provider doesn't
// offer is still shown, greyed out with a note, never replaced or blanked:
// saved voices survive provider switches untouched.
export const UNAVAILABLE_NOTE = "Not available on the current voice service";
export const LIST_ERROR_NOTE = "Couldn't load the voice list";

const OPTION_STYLE = { background: "#1a1c26", color: "#f0ebe0" } as const;
const UNAVAILABLE_OPTION_STYLE = { background: "#1a1c26", color: "rgba(240,235,224,0.42)" } as const;

export function VoicePicker({
  value,
  onChange,
  disabled,
  id,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
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
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <select
        id={id ?? "voice-picker"}
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={selectDisabled}
        style={{
          flex: 1,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(220,225,245,0.15)",
          borderRadius: 6,
          padding: "6px 10px",
          color: "#f0ebe0",
          fontSize: "0.875rem",
          outline: "none",
        }}
      >
        <option value="" style={OPTION_STYLE}>(default)</option>
        {valueUnavailable && (
          <option value={value} disabled style={UNAVAILABLE_OPTION_STYLE} data-testid="voice-picker-unavailable-option">
            {voiceLabel(catalogState, value)}
          </option>
        )}
        {!ready && value !== "" && (
          // Loading or list failed: still show what's saved (by name, never a raw code).
          <option value={value} style={OPTION_STYLE}>
            {voiceLabel(catalogState, value)}
          </option>
        )}
        {voices.map((v) => (
          <option key={v.id} value={v.id} title={v.description} style={OPTION_STYLE}>
            {v.description ? `${v.name} — ${v.description}` : v.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Sample voice"
        onClick={() => { void onSampleClick(); }}
        disabled={disabled || draftUnavailable}
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
          background: "rgba(0,0,0,0.28)",
          border: "1px solid rgba(255,255,255,0.10)",
          color: "rgba(255,220,170,0.72)",
          opacity: 0.62,
          cursor: "pointer",
        }}
        className="hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]"
      >
        <Volume2 size={16} />
      </button>
      {dirty && (
        <button
          type="button"
          aria-label="Apply voice"
          data-testid="voice-picker-apply"
          onClick={() => onChange(draft)}
          disabled={disabled}
          style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
            background: "rgba(90,160,110,0.32)",
            border: "1px solid rgba(140,210,160,0.42)",
            color: "rgba(220,255,220,0.92)",
            cursor: "pointer",
          }}
          className="hover:!bg-[rgba(90,160,110,0.52)] focus-visible:!bg-[rgba(90,160,110,0.52)] active:scale-[0.92]"
        >
          <Check size={16} />
        </button>
      )}
    </div>
      {draftUnavailable && (
        <div data-testid="voice-picker-unavailable-note" style={{ fontSize: "0.75rem", color: "rgba(240,235,224,0.55)" }}>
          {UNAVAILABLE_NOTE}
        </div>
      )}
      {listFailed && (
        <div data-testid="voice-picker-list-error" style={{ fontSize: "0.75rem", color: "rgba(248,150,150,0.85)" }}>
          {LIST_ERROR_NOTE}
        </div>
      )}
    </div>
  );
}
