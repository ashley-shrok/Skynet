import { useEffect, useRef } from "react";
import { Volume2 } from "lucide-react";
import { postSpeak, SAMPLE_PHRASE } from "@/api/voice-api";

export { SAMPLE_PHRASE };

// Phase 98 Plan 03: fixed catalog inlined — no runtime fetch.
// Mirror of src/backend/voice/polly-voice-catalog.ts POLLY_VOICES (which
// is authored in Plan 02). Two sources of truth acceptable here (7 static
// strings, low drift risk — see PATTERNS pitfall for polly-voice-catalog.ts).
const POLLY_VOICES: readonly { voiceId: string; displayName: string }[] = [
  { voiceId: "Danielle", displayName: "Danielle" },
  { voiceId: "Joanna",   displayName: "Joanna"   },
  { voiceId: "Ruth",     displayName: "Ruth"     },
  { voiceId: "Salli",    displayName: "Salli"    },
  { voiceId: "Tiffany",  displayName: "Tiffany"  },
  { voiceId: "Matthew",  displayName: "Matthew"  },
  { voiceId: "Stephen",  displayName: "Stephen"  },
];

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
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);
  const sampleUrlRef = useRef<string | null>(null);

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
      const blob = await postSpeak(SAMPLE_PHRASE, value || undefined);
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
    } catch {
      // swallow — handleApiError already logs
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <select
        id={id ?? "voice-picker"}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
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
        <option value="" style={{ background: "#1a1c26", color: "#f0ebe0" }}>(default)</option>
        {POLLY_VOICES.map((v) => (
          <option key={v.voiceId} value={v.voiceId} style={{ background: "#1a1c26", color: "#f0ebe0" }}>
            {v.displayName}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Sample voice"
        onClick={() => { void onSampleClick(); }}
        disabled={disabled}
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
    </div>
  );
}
