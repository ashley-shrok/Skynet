import { useMemo, useRef } from "react";
import { Loader2, Pause, Play, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeakPlayback } from "../useSpeakPlayback";
import {
  fileSpeakVoices,
  fileSpeechText,
  isSpeakableFile,
  splitForSpeech,
} from "./file-speak";

/**
 * Speak button for an open prose file (.md / .txt): reads the file aloud in
 * the user's fallback voice. Same state machine as the bubble speak button
 * (play → pause ⇄ resume) and the same one-thing-speaks-at-a-time singleton,
 * so starting a file stops a bubble and vice versa.
 *
 * `text` is the file as currently shown — the draft, so unsaved edits are
 * what gets spoken. Renders nothing for non-prose files or when there's no
 * text yet (still loading, binary, empty).
 */
export function FileSpeakButton({
  filename,
  text,
  className,
}: {
  filename: string;
  text: string | null | undefined;
  className?: string;
}): JSX.Element | null {
  // What would actually be spoken — a markdown file holding only code blocks
  // or images has nothing to say, so no button.
  const speech = useMemo(
    () =>
      isSpeakableFile(filename) && text ? fileSpeechText(filename, text) : "",
    [filename, text],
  );
  if (speech.length === 0) return null;
  // Keyed by filename: switching files in a host that reuses the viewer
  // (skills/role skill editor tabs) remounts, and the unmount stops playback.
  return <SpeakButton key={filename} speech={speech} className={className} />;
}

function SpeakButton({
  speech,
  className,
}: {
  speech: string;
  className?: string;
}): JSX.Element {
  const control = useSpeechControl(speech);
  return <FileSpeakControlButton control={control} className={className} />;
}

export interface FileSpeakControl {
  /** Nothing to speak (not prose, loading, empty) — show no control. */
  available: boolean;
  speakState: ReturnType<typeof useSpeakPlayback>["speakState"];
  onSpeakClick: (e?: React.MouseEvent) => void;
}

function useSpeechControl(speech: string): FileSpeakControl {
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const { speakState, onSpeakClick } = useSpeakPlayback({
    ownerName: "file-speak",
    logPrefix: "file:",
    voices: fileSpeakVoices,
    getText: () => splitForSpeech(speechRef.current),
  });
  return { available: speech.length > 0, speakState, onSpeakClick };
}

/**
 * One read-aloud player for a host that shows it in more than one place
 * (the file window: a header button on desktop, a ⋯ item on a phone) —
 * so both drive the same playback.
 */
export function useFileSpeakControl(filename: string, text: string | null | undefined): FileSpeakControl {
  const speech = useMemo(
    () => (isSpeakableFile(filename) && text ? fileSpeechText(filename, text) : ""),
    [filename, text],
  );
  return useSpeechControl(speech);
}

/** The control's state as a menu item label. */
export function fileSpeakMenuLabel(control: FileSpeakControl): string {
  return control.speakState === "playing"
    ? "Pause reading aloud"
    : control.speakState === "paused"
      ? "Resume reading aloud"
      : control.speakState === "loading"
        ? "Starting to read…"
        : "Read aloud";
}

export function FileSpeakControlButton({
  control,
  className,
}: {
  control: FileSpeakControl;
  className?: string;
}): JSX.Element {
  const { speakState, onSpeakClick } = control;
  const label =
    speakState === "playing"
      ? "Pause speaking"
      : speakState === "paused"
        ? "Resume speaking"
        : "Speak file";
  return (
    <button
      type="button"
      onClick={onSpeakClick}
      aria-label={label}
      title={label}
      data-testid="file-speak-button"
      className={cn(
        "size-7 shrink-0 rounded-md flex items-center justify-center cursor-pointer",
        "bg-transparent border border-[color:var(--k-hair)] hover:bg-[var(--k-s2)]",
        "text-[color:var(--k-t2)] hover:text-[color:var(--k-t1)] active:scale-[0.92] transition-transform",
        className,
      )}
    >
      {speakState === "loading" ? (
        <Loader2 size={15} className="animate-spin" />
      ) : speakState === "playing" ? (
        <Pause size={15} />
      ) : speakState === "paused" ? (
        <Play size={15} />
      ) : (
        <Volume2 size={15} />
      )}
    </button>
  );
}
