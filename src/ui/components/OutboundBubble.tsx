import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AttachmentChipStrip } from "@/features/pretty-view/AttachmentChipStrip";

// Phase 90 Plan 02 Task 1 — OutboundBubble primitive.
//
// COPY-extracted (D-03) from ChatMessage.tsx's user-branch (L420-594).
// This is a STANDALONE COPY — NOT a shared import that pretty view has been
// migrated onto. Pretty view's ChatMessage continues to render its own inline
// user-branch verbatim; this primitive exists so Plans 05 + 06 can render
// the viewing user's own right-aligned bubble in the new relay-room pane
// without touching pretty view.
//
// Rationale (D-02 + D-03): the strongest guarantee pretty view does not
// regress is not editing it. A future convergence slice may migrate
// ChatMessage's user-branch onto this primitive if visual drift becomes
// real, but that is not this slice's scope.
//
// Security discipline (T-17-03-01 preserved from RelayInboundBubble):
// `content` is rendered as a React text child, NEVER interpreted as HTML.
// This primitive is used for the viewing user's own composed text
// (trusted-source, but same discipline applies uniformly so the pane's
// bubble-rendering posture stays consistent).
//
// What is INCLUDED (copied verbatim from ChatMessage.tsx L420-594):
//   - Right-aligned outer wrapper (`justify-end`).
//   - User-branch gradient (`bg-[linear-gradient(160deg,rgba(45,55,80,0.55),rgba(28,35,55,0.6))]`),
//     text color `#dfe3ee`, border `rgba(120,140,180,0.2)`, multi-layer shadow.
//   - `rounded-[var(--radius-pv-bubble)]`, `px-[12px] py-[7px]`, backdrop-blur.
//   - Phase 50 D-06 failed-bubble treatment: whole-bubble red via inline
//     `background`/`borderColor` + `data-pv-bubble-failed="true"` attribute.
//   - Phase 50 D-01 sending spinner: twin-arc `Loader2` at the trailing edge
//     with `data-pv-bubble-spinner`, `aria-hidden`, `animate-spin opacity-70`.
//   - Phase 80 D-15 attachments-with-caption branch: caption text above an
//     `AttachmentChipStrip` in `readOnly` mode.
//
// What is EXCLUDED (assistant-only machinery stripped for the user-only
// primitive, per D-02 "share truly-primitive pieces only"):
//   - The role discriminator branch (this primitive is user-only).
//   - `onLongPressSpeak` / `onOpenEditor` / `autoplayArmed` / speak-button /
//     TTS singleton wiring at ChatMessage L595+ (assistant-only).
//   - The `injected` (parseInjectedUserTurn) branch (settled-attachment
//     shape not needed — the `attachments` prop covers pending-with-attachments).
//   - The assistant-branch `prose-invert` variant.
//   - `ReactMarkdown` rendering (this primitive renders plain text; the
//     relay-room pane's outbound bubble is composed text, not markdown-rich
//     assistant output).

export interface OutboundBubbleProps {
  /**
   * Message body. Rendered as a React text child. NEVER interpreted as HTML.
   */
  content: string;
  /**
   * Optional ms-epoch timestamp. When present, rendered as a hover `title`
   * on the bubble so desktop users can see when the send happened.
   */
  ts?: number;
  /**
   * Optimistic-send lifecycle state (D-13 + Phase 50 D-01/D-06/D-19).
   *   - "sending": renders a small trailing-edge twin-arc spinner inside the
   *     bubble to indicate the send is in flight.
   *   - "failed": whole-bubble saturated-red treatment via inline
   *     `background` + `borderColor`, plus `data-pv-bubble-failed="true"`
   *     attribute (Phase 76 D-06 — a failed bubble is a rare, truly-failed
   *     event and deserves loud visual weight).
   *   - null / undefined: no spinner, no failed marker (settled or non-
   *     optimistic bubble).
   *
   * Failed supersedes sending (Test 6 semantic — mutually exclusive at
   * declaration site to guard against a same-tick sending→failed transition).
   */
  pendingState?: "sending" | "failed" | null;
  /**
   * Optional pending-with-attachments render branch (Phase 80 D-15). When
   * present + non-empty, renders the `content` caption above an inline
   * `AttachmentChipStrip` in `readOnly` mode. Absent for text-only pending
   * bubbles and for settled bubbles.
   */
  attachments?: Array<{
    filename: string;
    size: number;
    mimetype: string;
  }>;
}

export function OutboundBubble({
  content,
  ts,
  pendingState = null,
  attachments,
}: OutboundBubbleProps) {
  // Phase 50 Plan 03 Task 1: pending-state gate (failed supersedes sending —
  // mutually exclusive at declaration site per Test 6 in ChatMessage.tsx).
  const showSendingSpinner = pendingState === "sending";
  const showFailedBubble = pendingState === "failed";

  // Phase 76 Plan 02 D-06 semantic upgrade (Ashley 2026-09-06 verbatim:
  // "hopefully after we do this work a failed bubble will be a truly failed
  // bubble and that is worth being that loud about"). Whole-bubble red fill
  // (background shorthand overrides the gradient background-image set by the
  // Tailwind class below). Inline-style specificity beats any className
  // utility, so the saturated-red `background` replaces the base gradient
  // entirely.
  const bubbleInlineStyle: React.CSSProperties = showFailedBubble
    ? {
        position: "relative",
        background: "hsla(0, 60%, 35%, 0.90)",
        borderColor: "hsla(0, 70%, 50%, 0.85)",
      }
    : { position: "relative" };

  return (
    <div className={cn("flex", "justify-end")}>
      <div
        title={ts !== undefined ? new Date(ts).toLocaleString() : undefined}
        style={bubbleInlineStyle}
        {...(showFailedBubble ? { "data-pv-bubble-failed": "true" } : {})}
        // pv-bubble: hover-target class inherited from pretty view. Preserved
        // verbatim so any global `.pv-bubble:hover_&` selectors continue to
        // work if the relay-room pane's outbound bubble is styled by them
        // in the future.
        className={cn(
          "pv-bubble",
          // Phase 4 Glass: raised-object bubble treatment.
          "max-w-[90%] [overflow-wrap:anywhere] text-sm leading-relaxed",
          "rounded-[var(--radius-pv-bubble)]",
          "px-[12px] py-[7px]",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "border border-white/[0.08]",
          "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.12)_inset,_0_0_0_0.5px_rgba(255,255,255,0.05)]",
          // Prose scaffolding preserved for parity with ChatMessage's
          // user-branch rendering — the OutboundBubble renders plain text but the
          // typography classes ensure any future switch to markdown flow
          // gets ChatMessage-parity treatment for free.
          "prose prose-sm max-w-[90%]",
          "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
          "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          // User-branch gradient (VERBATIM copy from ChatMessage.tsx L466-476
          // per D-13 — Ashley is always Ashley, no per-pane variation).
          "bg-[linear-gradient(160deg,rgba(45,55,80,0.55),rgba(28,35,55,0.6))]",
          "text-[#dfe3ee]",
          "border-[rgba(120,140,180,0.2)]",
          "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.1)_inset,_0_0_0_0.5px_rgba(120,140,180,0.15)]",
          "dark:prose-invert",
        )}
      >
        {attachments && attachments.length > 0 ? (
          // Phase 80 D-15: pending-with-attachments render — caption text
          // above an AttachmentChipStrip in readOnly mode. Mirrors the
          // ChatMessage.tsx L525-572 branch VERBATIM in shape (caption + strip),
          // with the synthetic `tempId` per-index pattern (code-review M1
          // 2026-09-07: two identically-named identically-sized files in the
          // same batch keep unique React keys).
          <>
            {content.length > 0 && (
              <div className="pv-injected-caption whitespace-pre-wrap mb-2">
                {content}
              </div>
            )}
            <AttachmentChipStrip
              attachments={attachments.map((f, idx) => ({
                tempId: `pending-${idx}`,
                file: { name: f.filename, size: f.size, type: f.mimetype },
                status: "complete",
                bytesUploaded: f.size,
                error: null,
              }))}
              onRemove={() => {
                /* readOnly — never fires */
              }}
              readOnly={true}
            />
          </>
        ) : (
          // Plain text-child render. Security (T-17-03-01): `content` is a
          // React text child, never interpreted as HTML. `whitespace-pre-wrap`
          // preserves newlines the user typed.
          <div className="whitespace-pre-wrap">{content}</div>
        )}
        {showSendingSpinner && (
          // Phase 50 D-01/D-06: small trailing-edge Loader2 spinner. Sits
          // INSIDE the bubble root at the trailing edge so it visually reads
          // as "attached to the message". Mutually exclusive with failed
          // (gated at declaration above).
          <Loader2
            aria-hidden
            data-pv-bubble-spinner
            className="ml-1 inline-block h-3 w-3 animate-spin opacity-70"
          />
        )}
      </div>
    </div>
  );
}
