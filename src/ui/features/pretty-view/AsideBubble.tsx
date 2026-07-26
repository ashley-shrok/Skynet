// Phase 14 (plain-language-translation-asides) Wave 3 Task 1 —
// AsideBubble: plain-language translation aside rendered as a new
// pretty-view bubble type at the bottom of the message stream.
//
// Mounted by PrettyView.tsx as a sibling of ChatMessage / ImageBubble /
// PlanPendingBubble / WipBubble when the backend delivers a
// `{type:"aside_ready", text: "..."}` WS frame. The extraction pipeline
// runs upstream: the frontend arms via `{type:"aside_arm"}` on the
// isIdle:false→true transition (Wave 3 emitter — PrettyView.tsx), the
// backend injects `/btw <prompt>` into the identity's tmux, polls
// capture-pane at 300ms cadence, and emits `aside_ready` with the
// extracted answer after two-consecutive-stable poll reads carry the
// ASIDE_END_MARKER (see 14-02-SUMMARY.md for the full backend contract).
// This component is purely presentational.
//
// The aesthetic is LOCKED per CONTEXT.md § Rendering (2026-07-26 —
// verbatim from the aside-visual-snippet.js DevTools prototype Ashley
// signed off on):
//   - Identity-hue gradient background copied VERBATIM from ChatMessage
//     assistant branch (ChatMessage.tsx L124-127) — semantically the
//     aside IS a bubble from the same identity, so the background is
//     identical to a normal assistant reply. Class strings are copied
//     inline (not imported from ChatMessage) so AsideBubble stands
//     alone with no cross-component coupling.
//   - 10px solid opaque hue border on top of the base treatment
//     (`hsla(var(--pv-id-hue), 90%, 65%, 1)`).
//   - Three stacked neon-glow outer shadows in the hue at descending
//     alphas (0.7 / 0.5 / 0.3) — 12px inner, 32px mid, 64px outer.
//     These are ADDITIVE to the base depth shadow + inner rim so the
//     bubble keeps its Glass depth character while gaining the neon
//     visual language that marks it as "this is a translation aside,
//     not a real assistant reply."
//
// Prop-driven tunables (per CONTEXT.md § Rendering final sentence):
//   - `glow` (default 1.0) multiplies each of the three neon-glow layer
//     alphas so future dial-back is one prop change without a rewrite.
//   - `borderWidthPx` (default 10) makes the border thickness a single
//     prop change too. Not user-tunable at v1 but the seam exists.
//
// Purity: this is a pure function of props — no state, no effects, no
// refs, no event handlers. Dismiss lives on the ComposeBox morph (Wave 4)
// via the X (Resume) button. The bubble itself is passive display.
//
// Text rendering: plain-text via `<div className="whitespace-pre-wrap">`
// so newlines from the extracted /btw answer survive. NO markdown
// pipeline — the aside is agent voice re-explaining in plain language,
// not structured markdown, and running react-markdown here would
// re-open XSS surface that ChatMessage explicitly closes (T-14-03-01).
// React's default text-child escaping ensures `<script>` in the answer
// text renders as literal text, not executed HTML.

import { cn } from "@/lib/utils";

export interface AsideBubbleProps {
  /**
   * The aside text extracted by the backend from the tmux BTW overlay.
   * May contain \n for multi-line answers; rendered verbatim inside a
   * whitespace-pre-wrap wrapper so line breaks survive.
   */
  text: string;
  /**
   * Multiplier applied to each of the three neon-glow layer alpha
   * values. Default 1.0 = LOCKED CONTEXT.md values (0.7 / 0.5 / 0.3).
   * Reduce (e.g. 0.5) to soften glow; increase (e.g. 1.5) to brighten.
   */
  glow?: number;
  /**
   * Border width in pixels. Default 10 per CONTEXT.md § Rendering
   * ("Border: 10px solid ..."). Kept as a prop so future iteration can
   * tune without rewriting the component.
   */
  borderWidthPx?: number;
}

export function AsideBubble({
  text,
  glow = 1.0,
  borderWidthPx = 10,
}: AsideBubbleProps) {
  return (
    <div className={cn("flex", "justify-start")}>
      <div
        role="note"
        aria-label="Plain-language aside from the identity"
        className={cn(
          // Base identity-hue Glass treatment — copied VERBATIM from
          // ChatMessage.tsx L124-127 (assistant branch). Do NOT import
          // from ChatMessage; the intentional duplication keeps
          // AsideBubble self-contained per PATTERNS.md L28-32.
          "leading-relaxed",
          "rounded-[var(--radius-pv-bubble)] px-[18px] py-[14px]",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]",
          "text-[#fbf5e8]",
          // Prose pipeline matching ChatMessage assistant branch — Inter
          // font + prose-invert for readable typography on the dark
          // identity-hue background. First/last-child margin reset keeps
          // the tight bubble aesthetic (typography plugin defaults would
          // leave whitespace stripes top and bottom).
          "prose prose-sm max-w-none prose-invert",
          "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
          "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        )}
        style={{
          // Aside-specific overrides layered on top of the base
          // treatment. Border + glow are prop-driven so JIT cannot
          // pre-compile them as arbitrary-value Tailwind classes —
          // inline style is the correct mechanism (matches the
          // aside-visual-snippet.js prototype Ashley signed off on).
          borderStyle: "solid",
          borderColor: "hsla(var(--pv-id-hue), 90%, 65%, 1)",
          borderWidth: `${borderWidthPx}px`,
          // Five-layer boxShadow: three neon-glow layers with
          // glow-multiplier alpha + additive depth shadow + additive
          // inner rim (preserving the Glass depth character).
          boxShadow: [
            `0 0 12px hsla(var(--pv-id-hue), 100%, 60%, ${0.7 * glow})`,
            `0 0 32px hsla(var(--pv-id-hue), 100%, 55%, ${0.5 * glow})`,
            `0 0 64px hsla(var(--pv-id-hue), 100%, 50%, ${0.3 * glow})`,
            "0 8px 24px rgba(0,0,0,0.5)",
            "0 1px 0 rgba(255,220,170,0.18) inset",
          ].join(", "),
        }}
      >
        <div className="whitespace-pre-wrap">{text}</div>
      </div>
    </div>
  );
}
