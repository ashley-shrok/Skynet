import { useState } from "react";
import { cn } from "@/lib/utils";
import type { RelayOutboundEvent } from "@/api/claude-session-api";

// Phase 17 Plan 03 — RelayOutboundBubble
//
// Presentational component for a relay_outbound WS frame: renders a
// right-aligned blue glass bubble in PrettyView when the backend detects
// that a Bash tool-use turn is a real Matrix relay send (curl + -X PUT +
// rooms/.../send/m.room.message/... conjunction — plan 17-01 detection).
//
// Design source: ~/.claude/identities/tina/bounties/pretty-view-relay-bubble-prototype/prototype.html
// Final visual values locked in 17-UI-SPEC.md:
//   background: rgba(64, 96, 160, 0.28)   cool blue glass
//   border:     rgba(96, 128, 200, 0.42)  glass rim
//   text:       #e8e4d8                   warm off-white
//
// RELAYBUB-01: outbound bubble right-aligned (flex justify-end wrapper).
// RELAYBUB-06: does NOT import IdentityBadge, ChatMessage, ComposeBox (locked).
//
// Security (T-17-03-01): body + rawCommand rendered via React children
// ({body} in JSX), NOT dangerouslySetInnerHTML. React auto-escapes all
// HTML/JS so relay body content is treated as literal text.

export type RelayOutboundBubbleProps = Pick<
  RelayOutboundEvent,
  "room" | "body" | "extractError" | "rawCommand"
>;

export function RelayOutboundBubble({
  room,
  body,
  extractError,
  rawCommand,
}: RelayOutboundBubbleProps) {
  const [showSource, setShowSource] = useState(false);

  return (
    <div className="flex justify-end">
      <div
        className={cn(
          // Bubble sizing + shape — mirrors ChatMessage outer div pattern.
          "max-w-[85%] [overflow-wrap:anywhere] text-sm leading-relaxed",
          "rounded-[var(--radius-pv-bubble)] px-[18px] py-[14px]",
          // Glass depth treatment (matching ChatMessage baseline).
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          // Cool blue glass background — SPACED rgba per UI-SPEC byte-shape lock.
          // Tailwind arbitrary-value syntax: underscores inside [...] render as
          // spaces in the emitted CSS → output is rgba(64, 96, 160, 0.28).
          "bg-[rgba(64,_96,_160,_0.28)]",
          // Rim border (glass highlight).
          "border border-[rgba(96,_128,_200,_0.42)]",
          // Text colour — warm off-white matching prototype.
          "text-[#e8e4d8]",
        )}
      >
        {/* Header: relay send direction + room */}
        <div
          className={cn(
            "text-xs mb-1",
            "text-[rgba(220,_225,_245,_0.6)]",
            "font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
          )}
        >
          ▸ relay send → {room ?? "unknown room"}
        </div>

        {/* Body or extraction-failure ⚠ path */}
        {/* Security: rendered as React children (never dangerouslySetInnerHTML) — T-17-03-01 */}
        {extractError !== null ? (
          <>
            <div className="text-[color:var(--color-pv-code-fg)] text-xs">
              ⚠ extraction failed — {extractError}
            </div>
            <button
              type="button"
              onClick={() => setShowSource((v) => !v)}
              className={cn(
                "mt-1 text-[10px] text-[rgba(220,_225,_245,_0.45)]",
                "hover:text-[rgba(220,_225,_245,_0.75)]",
                "cursor-pointer bg-transparent border-none p-0",
                "font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
              )}
            >
              {showSource ? "hide source" : "show source"}
            </button>
            {showSource && (
              <div
                className={cn(
                  "mt-1 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]",
                  "font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
                  "bg-black/40 rounded p-2",
                )}
              >
                {rawCommand}
              </div>
            )}
          </>
        ) : body !== null ? (
          <div className="whitespace-pre-wrap">{body}</div>
        ) : null}

        {/* Footer — "via curl" attribution matching prototype byte-shape */}
        <div
          className={cn(
            "text-[10px] text-right mt-1",
            "text-[rgba(220,_225,_245,_0.35)]",
          )}
        >
          via curl
        </div>
      </div>
    </div>
  );
}
