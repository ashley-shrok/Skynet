import { cn } from "@/lib/utils";
import type { MalformedLineEvent } from "@/api/claude-session-api";

// pv-malformed-jsonl-placeholder-bubble (2026-08-10)
//
// Compact placeholder rendered when the backend parser hits a JSONL line
// it can't parse. The observed cause is a Claude Code writer race where an
// assistant record and a file-history-snapshot land on the same line with
// the first cut mid-string; content is genuinely unrecoverable from disk.
// This bubble exists so Ashley sees SOMETHING is missing rather than
// silently losing the turn — she can then check the terminal view for
// the actual reply.
//
// Deliberately narrow and centered (max-w-md, mx-auto) so it reads as a
// system notice, not a real message on either side of the chat. Muted
// colors so it doesn't compete for attention.

export type MalformedBubbleProps = Pick<MalformedLineEvent, "bytes"> & {
  ts?: number;
};

export function MalformedBubble({ bytes, ts }: MalformedBubbleProps) {
  return (
    <div className="flex justify-center">
      <div
        title={ts !== undefined ? new Date(ts).toLocaleString() : undefined}
        className={cn(
          "max-w-md text-xs leading-relaxed",
          "rounded-[var(--radius-pv-bubble)] px-4 py-2",
          "border border-dashed border-white/10",
          "bg-black/20",
          "text-[rgba(220,_225,_245,_0.55)]",
          "font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
          "text-center",
        )}
      >
        [malformed JSONL line — {bytes} bytes, content lost; check terminal]
      </div>
    </div>
  );
}
