import { cn } from "@/lib/utils";
import type { ImageBlock } from "@/api/claude-session-api";

// Patch #86: pretty-view image bubble.
//
// Renders one image WebSocket event (`{type:"image", ...}`) as a chat
// bubble carrying one or more `<img>` elements with inline base64 data-URI
// srcs. Alignment + palette follow role, mirroring ChatMessage: user turns
// (composebox / iOS photo picker) render RIGHT + blue-gray user gradient;
// assistant / tool_result turns render LEFT + identity-hue. Padding stays
// 12px on both sides (tighter than ChatMessage's 18/14) so image edges get
// less breathing room than prose. (user 2026-08-19 clarified after
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
// Claude Code prepends `[Image #N]` markers (one per inline image) to a
// user turn whose pasted text carried image paths, then a blank line. Strip
// the markers and that one separator only — an attachment turn with an
// empty caption starts with "\n\n--- attached files ---", and its leading
// newlines are what the injected-turn parser anchors on.
export function stripImagePasteMarkers(text: string): string {
  return text.replace(/^(?:[ \t]*\[Image #\d+\])+[ \t]*(?:\r?\n){0,2}/, "");
}

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
  const isUser = role === "user";
  const shownText = isUser ? stripImagePasteMarkers(text) : text;
  const hasText = shownText.trim() !== "";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        title={new Date(ts).toLocaleString()}
        className={cn(
          // Same bubbles as a text turn (conversation.css): yours neutral on
          // the right, the agent's in its colour.
          isUser ? "pv-bubble-user" : "pv-bubble-agent pv-hue-surface",
          "flex flex-col gap-2",
        )}
      >
        {!isUser && (
          <div className="text-xs font-mono opacity-70">{caption}</div>
        )}
        {hasText && (
          <div className="text-sm break-words whitespace-pre-wrap">{shownText}</div>
        )}
        {images.map((img, i) => (
          // quick 260810-ia4 Fix 2: reserve layout before decode; kills the
          // 0->N height pop that fires TanStack measureElement mid-scroll and
          // displaces visible content under user's scroll gesture.
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
        {!isUser && (
          <div className="text-xs font-mono opacity-70">
            {shortEventId} · {timeLabel}
          </div>
        )}
      </div>
    </div>
  );
}
