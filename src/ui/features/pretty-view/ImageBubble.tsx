import { cn } from "@/lib/utils";
import type { ImageBlock } from "@/api/claude-session-api";

// Patch #86: pretty-view image bubble.
//
// Renders one image WebSocket event (`{type:"image", ...}`) as a Glass
// bubble carrying one or more `<img>` elements with inline base64 data-URI
// srcs. Alignment + palette follow role, mirroring ChatMessage: user turns
// (composebox / iOS photo picker) render RIGHT + blue-gray user gradient;
// assistant / tool_result turns render LEFT + identity-hue. Padding stays
// 12px on both sides (tighter than ChatMessage's 18/14) so image edges get
// less breathing room than prose. (Ashley 2026-08-19 clarified after
// spotting her own image turn rendered as assistant in Wendy's session:
// "just because i send a message with or without an image shouldn't
// change the way the bubble looks other than the fact the image is
// included." Supersedes the 2026-07-19 always-assistant contract, which
// silently latent-broke user-attached images since patch #86.)
//
// Non-obvious behaviors:
//
//   1. NO markdown parsing on the accompanying `text`. Image bubbles are
//      not prose surfaces — the text field is usually empty (tool_results
//      are typically image-only), and when non-empty it's a short caption
//      like "<system-reminder>foo</system-reminder>" (see parser test 9)
//      that we want to render as literal text, not interpret. Preserves
//      whitespace via `whitespace-pre-wrap`.
//
//   2. Index-based `key` on the image list. Image order within a single
//      event is stable within the parser's emit, and the parent
//      PrettyView already dedups on `eventId`, so index keys are safe.
//
//   3. NO click-to-zoom, NO filename caption from tool_use correlation.
//      Out of scope for this patch — the bubble is a passive viewer.
//
//   4. NO `!` important overrides. This is a plain <div> wrapper, not a
//      shadcn UI primitive, so the patch-#81 wrapper defense doesn't
//      apply.
export function ImageBubble({
  role,
  images,
  text,
  eventId,
  ts,
}: {
  role: "user" | "assistant" | "tool_result";
  images: ImageBlock[];
  text: string;
  eventId: string;
  ts: number;
}) {
  const caption = `${role === "tool_result" ? "tool_result" : role} · ${images.length} image${images.length === 1 ? "" : "s"}`;
  const shortEventId = eventId.slice(0, 8);
  const timeLabel = new Date(ts).toLocaleTimeString();
  const hasText = text.trim() !== "";
  const isUser = role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        title={new Date(ts).toLocaleString()}
        className={cn(
          // Layout — 12px padding tighter than ChatMessage per scope_detail.
          "max-w-[min(85%,640px)]",
          "rounded-[var(--radius-pv-bubble)] px-3 py-3",
          "flex flex-col gap-2",
          // Glass.
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          // Font override matches ChatMessage.
          "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
          isUser
            ? cn(
                // User branch — byte-identical to ChatMessage.tsx:422-425 user
                // gradient / text / border / shadow so an image-carrying user
                // turn reads visually the same as a plain user text turn.
                "bg-[linear-gradient(160deg,rgba(45,55,80,0.55),rgba(28,35,55,0.6))]",
                "text-[#dfe3ee]",
                "border border-[rgba(120,140,180,0.2)]",
                "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.1)_inset,_0_0_0_0.5px_rgba(120,140,180,0.15)]",
              )
            : cn(
                // Assistant / tool_result — identity-hue treatment
                // (byte-identical to ChatMessage.tsx:434-437 assistant branch).
                "bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]",
                "text-[#fbf5e8]",
                "border border-[hsla(var(--pv-id-hue),65%,55%,0.32)]",
                "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,220,170,0.18)_inset,_0_0_0_0.5px_hsla(var(--pv-id-hue),70%,55%,0.2),_0_0_32px_hsla(var(--pv-id-hue),70%,52%,0.18)]",
              ),
        )}
      >
        <div className="text-xs font-mono opacity-70">{caption}</div>
        {hasText && (
          <div className="text-sm break-words whitespace-pre-wrap">{text}</div>
        )}
        {images.map((img, i) => (
          // quick 260810-ia4 Fix 2: reserve layout before decode; kills the
          // 0->N height pop that fires TanStack measureElement mid-scroll and
          // displaces visible content under Ashley's scroll gesture.
          // ImageBlock carries only { data, mediaType, toolUseId? } — no
          // natural-dimension metadata — so the 4/3 default-aspect-ratio
          // fallback is the only path.
          <div
            key={i}
            style={{ aspectRatio: "4 / 3" }}
            className="max-w-full max-h-[480px]"
          >
            <img
              src={`data:${img.mediaType};base64,${img.data}`}
              alt={`image ${i + 1}`}
              className="w-full h-full object-contain rounded"
            />
          </div>
        ))}
        <div className="text-xs font-mono opacity-70">
          {shortEventId} · {timeLabel}
        </div>
      </div>
    </div>
  );
}
