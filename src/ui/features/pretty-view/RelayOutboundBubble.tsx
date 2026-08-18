import { useState } from "react";
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
// Update (2026-08-18, bounty pretty-view-outgoing-relay-render):
// Body extraction reinstated per PATTERNS.md survey (96.4% coverage of real
// fleet sends across 7 named shell/heredoc/inline-json shapes). When body is
// non-null, we render it as a pretty text block above a COLLAPSED-by-default
// expand-to-see-raw toggle wrapping the mono rawCommand block. When body is
// null (3.6% tail: cross-turn refs, python heredocs), we fall back to the
// July behavior: rawCommand always-visible mono block, no toggle.
//
// Security (T-17-03-01) UNCHANGED: both {body} and {rawCommand} are React
// text children — never dangerouslySetInnerHTML.

export type RelayOutboundBubbleProps = Pick<
  RelayOutboundEvent,
  "room" | "rawCommand" | "body"
> & {
  /** ms-epoch timestamp of the outbound event; when present, rendered as a
   * hover `title` on the bubble so desktop users can see when the send
   * happened. Optional at the type level so existing tests that don't care
   * about the timestamp keep compiling; PrettyView always passes it. */
  ts?: number;
};

export function RelayOutboundBubble({
  room,
  rawCommand,
  body,
  ts,
}: RelayOutboundBubbleProps) {
  // Toggle state for expand-to-see-raw — default collapsed when body is present.
  // Ignored (raw always shown) in the body === null fallback branch.
  const [rawExpanded, setRawExpanded] = useState(false);

  return (
    <div className="flex justify-start">
      <div
        title={ts !== undefined ? new Date(ts).toLocaleString() : undefined}
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

        {body !== null ? (
          <>
            {/* Pretty body preview — mirrors RelayInboundBubble.tsx:180 inline body render */}
            {/* Security (T-17-03-01): {body} is a React text child, NEVER dangerouslySetInnerHTML */}
            <div className="whitespace-pre-wrap">{body}</div>

            {/* Expand-to-see-raw toggle — default collapsed */}
            <button
              type="button"
              onClick={() => setRawExpanded((v) => !v)}
              className={cn(
                "mt-2 text-[10px]",
                "text-[rgba(220,_225,_245,_0.5)] hover:text-[rgba(220,_225,_245,_0.8)]",
                "font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
                "cursor-pointer bg-transparent border-0 p-0",
              )}
            >
              {rawExpanded ? "▾ raw command" : "▸ raw command"}
            </button>

            {rawExpanded && (
              <pre
                className={cn(
                  "mt-1 whitespace-pre overflow-x-auto max-h-[24rem] overflow-y-auto",
                  "font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
                  "bg-black/40 rounded p-2 text-xs",
                )}
              >
                {rawCommand}
              </pre>
            )}
          </>
        ) : (
          /* Fallback: body extraction returned null — render rawCommand always-visible as today.
             Security (T-17-03-01): {rawCommand} is a React text child, NEVER dangerouslySetInnerHTML */
          <pre
            className={cn(
              "whitespace-pre overflow-x-auto max-h-[24rem] overflow-y-auto",
              "font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
              "bg-black/40 rounded p-2 text-xs",
            )}
          >
            {rawCommand}
          </pre>
        )}

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
