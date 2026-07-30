import { cn } from "@/lib/utils";
import type { RelayOutboundEvent } from "@/api/claude-session-api";

// Phase 17 Plan 03 — RelayOutboundBubble (patch #200: alignment + color parity with ChatMessage)
//
// Presentational component for a relay_outbound WS frame: renders a
// left-aligned identity-hue gradient bubble in PrettyView when the backend
// detects that a Bash tool-use turn is a real Matrix relay send (curl +
// -X PUT + rooms/.../send/m.room.message/... conjunction — plan 17-01).
//
// Colors mirror ChatMessage.tsx's assistant styling so relay-outbound reads
// as "the agent speaking through Matrix" — same identity-hue as its regular
// pretty-view reply bubbles, keeping the ▸/via-curl header+footer to
// preserve the "this went through the Matrix relay" semantic.
//
// RELAYBUB-01: outbound bubble left-aligned (flex justify-start wrapper) —
// matches assistant-side of pretty-view chat convention (patch #200).
// RELAYBUB-06: does NOT import IdentityBadge, ChatMessage, ComposeBox (locked).
//
// Option D (Ashley 2026-07-28): rawCommand IS the body. The bubble always
// renders rawCommand as a scrollable mono block — no extraction failure path,
// no ⚠ fallback, no showSource toggle. Faithful record of what happened.
//
// Security (T-17-03-01): rawCommand rendered via React children
// ({rawCommand} in JSX), NOT dangerouslySetInnerHTML. React auto-escapes all
// HTML/JS so command content is treated as literal text.

export type RelayOutboundBubbleProps = Pick<
  RelayOutboundEvent,
  "room" | "rawCommand"
>;

export function RelayOutboundBubble({
  room,
  rawCommand,
}: RelayOutboundBubbleProps) {
  return (
    <div className="flex justify-start">
      <div
        className={cn(
          // Bubble sizing + shape — mirrors ChatMessage outer div pattern.
          "max-w-[85%] [overflow-wrap:anywhere] text-sm leading-relaxed",
          "rounded-[var(--radius-pv-bubble)] px-[18px] py-[14px]",
          // Glass depth treatment (kept from phase 17 — reads distinct from
          // ChatMessage's shadow-based bubble while colour-matching it).
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          // Identity-hue gradient background — mirrors ChatMessage assistant
          // styling so the relay-outbound reads as "this agent speaking",
          // tinted by whichever pretty-view identity is currently rendered
          // (--pv-id-hue is set per-pane by useSessionIdentity).
          "bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]",
          // Rim border — identity-hue at ChatMessage assistant strength.
          "border border-[hsla(var(--pv-id-hue),65%,55%,0.32)]",
          // Text colour — warm cream matching ChatMessage assistant.
          "text-[#fbf5e8]",
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

        {/* rawCommand as always-visible scrollable mono block */}
        {/* Security: rendered as React children (never dangerouslySetInnerHTML) — T-17-03-01 */}
        <pre
          className={cn(
            "whitespace-pre overflow-x-auto max-h-[24rem] overflow-y-auto",
            "font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
            "bg-black/40 rounded p-2 text-xs",
          )}
        >
          {rawCommand}
        </pre>

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
