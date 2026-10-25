// Inline pill component for a detected slash-command invocation
// (e.g. /id tina, /help, /exit) surfaced by commandTags.preprocessCommandTriplets
// + splitMarkers. Pure presentational — no state, no hover behavior, no onClick.
//
// It belongs with the user's side (the user ran the command); the ▸ glyph
// marks it as invoked.

interface CommandChipProps {
  cmd: string;
}

export function CommandChip({ cmd }: CommandChipProps) {
  return (
    <span
      className={
        "inline-flex items-baseline gap-1 " +
        "rounded-md px-2 py-[2px] mx-[1px] " +
        "font-[JetBrains_Mono_Variable,ui-monospace,monospace] " +
        "text-[0.85em] " +
        "bg-[linear-gradient(160deg,rgba(65,80,110,0.7),rgba(45,60,90,0.75))] " +
        "text-[#dfe3ee] " +
        "border border-[rgba(140,160,200,0.35)] " +
        "shadow-[0_1px_2px_rgba(0,0,0,0.35),_0_0_0_0.5px_rgba(140,160,200,0.15)_inset]"
      }
    >
      <span aria-hidden className="opacity-60 text-[0.85em]">
        ▸
      </span>
      <span>{cmd}</span>
    </span>
  );
}
