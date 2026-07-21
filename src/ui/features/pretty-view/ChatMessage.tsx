import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { preprocessCommandTriplets, splitMarkers } from "./commandTags";
import { parseInjectedUserTurn } from "@/api/pretty-view-upload-protocol";
import { AttachmentChipStrip } from "./AttachmentChipStrip";

// Presentational chat bubble for one conversational message.
//
// Content is rendered as markdown (GFM) via react-markdown so **bold**,
// backticks, bullet lists, tables, etc. render as formatted output
// rather than literal characters — Claude Code's assistant output is
// mostly markdown, and Ashley writes markdown-flavored prose too. Raw
// HTML in the source is NOT interpreted (react-markdown default) so
// there is no XSS surface even for untrusted content.
//
// Prose styling comes from @tailwindcss/typography via `prose prose-sm`.
// The `max-w-none` override lets the bubble's own width cap the block;
// the first/last-child margin resets keep the tight bubble aesthetic
// (typography defaults would leave a stripe of whitespace at top/bottom
// of every message). User bubbles use `prose-invert` unconditionally
// (primary bg is dark in every theme); assistant bubbles use
// `dark:prose-invert` so headings/code/strong/em get light-mode prose
// colors on the light theme card and dark-mode prose colors (light
// grays) on the dark theme card. Without the assistant-side invert,
// Termix's dark card renders headings/inline-code in default light-mode
// prose colors — dark grays that read as "faint/unreadable" against
// the dark card background.
//
// Font: Termix sets `font-mono` (JetBrains Mono) globally for the
// terminal aesthetic. Pretty view is a prose surface, so we override
// with Inter — the modern default for chat/UI text at small sizes,
// tuned for screen legibility. Inline `code` bubbles opt back into
// mono via the prose-code override in index.css so command names and
// paths still read as code.
export function ChatMessage({
  role,
  content,
}: {
  role: "user" | "assistant";
  content: string;
}) {
  const isUser = role === "user";
  // Phase 05 Plan 03: sender-side chip render for injected user turns.
  // When a user-role message's content matches the exact format produced
  // by formatInjectedUserTurn (caption + \n\n + INJECTED_DELIMITER + \n +
  // per-file `N. name (size, mime) → path` + `   uploaded ts` pairs), the
  // bubble renders as caption text + inline chip strip in the SAME wrapper
  // instead of the normal markdown render. Non-matching content falls
  // through to the normal path — the parser returns null quickly for the
  // vast majority of messages (early indexOf bail on the delimiter
  // substring), so there is no perf concern for non-injected messages.
  // Assistant messages never trigger the parser (role gate — defense in
  // depth against an assistant reply that coincidentally quotes the
  // delimiter substring in prose).
  const injected = isUser ? parseInjectedUserTurn(content) : null;
  // Quick-reply as-a-thumbs-up: a user message whose text is exactly the
  // quick-reply payload (case-insensitive, ignoring surrounding whitespace)
  // renders as a ThumbsUp glyph inside the normal user bubble. Mirrors the
  // ComposeBox quick-send button that produces this message, so what she
  // sent visually matches what she clicked. Client-render-only — session
  // file stays faithful. Patches #93 + #107: recognize BOTH the current
  // payload ("works for me", from patch #107) AND legacy payloads ("good to
  // go", "go ahead") so past session files still render as the ThumbsUp
  // glyph after the button text swap.
  const isQuickReply =
    isUser &&
    !injected &&
    (() => {
      const t = content.trim().toLowerCase();
      return t === "works for me" || t === "good to go" || t === "go ahead";
    })();
  // Prettify slash-command triplets before markdown parsing. Runs of
  // <command-message>/<command-name>/<command-args> tags become ⟨cmd:...⟩
  // sentinel markers, then the `p` component override below splits those
  // markers out into <CommandChip> pills. Backend session-file-parser stays
  // faithful to the wire format — this transform is client-render-only.
  const processedContent = preprocessCommandTriplets(content);
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          // Phase 4 Glass: raised-object bubble treatment.
          "max-w-[85%] break-words text-sm leading-relaxed",
          "rounded-[var(--radius-pv-bubble)] px-[18px] py-[14px]",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "border border-white/[0.08]",
          "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.12)_inset,_0_0_0_0.5px_rgba(255,255,255,0.05)]",
          // Prose scaffolding (typography plugin).
          "prose prose-sm max-w-[85%]",
          "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
          "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          // Preformatted code blocks: Glass depth (inner shadow + hairline border).
          "prose-pre:my-2 prose-pre:p-2 prose-pre:rounded",
          "prose-pre:font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
          "prose-pre:bg-[rgba(10,12,20,0.6)] prose-pre:border prose-pre:border-white/[0.06]",
          "prose-pre:shadow-[inset_0_2px_8px_rgba(0,0,0,0.4)]",
          // Inline code: warm coral foreground + subtle chip rectangle.
          "prose-code:before:content-none prose-code:after:content-none",
          "prose-code:rounded prose-code:px-1 prose-code:py-0.5",
          "prose-code:font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
          "prose-code:bg-white/[0.08] prose-code:text-[var(--color-pv-code-fg)]",
          "prose-code:border prose-code:border-white/[0.06]",
          isUser
            ? cn(
                // User bubble = mock's original assistant treatment
                // (translucent mid-blue-gray gradient over the depth). Ashley
                // is always Ashley, no per-pane variation. Reads as the
                // stable "not-the-agent" side; assistant bubbles pop against
                // it with their identity hue.
                "bg-[linear-gradient(160deg,rgba(45,55,80,0.55),rgba(28,35,55,0.6))]",
                "text-[#dfe3ee]",
                "border-[rgba(120,140,180,0.2)]",
                "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.1)_inset,_0_0_0_0.5px_rgba(120,140,180,0.15)]",
                "dark:prose-invert",
              )
            : cn(
                // Assistant carries the identity-hue tint — "the identity is
                // the one speaking these bubbles" semantic. More saturated
                // than the first pass (28% → 50% sat) per Ashley's "colors
                // should be more vibrant" round. Rich hue border + hue outer
                // glow at ~15-20% alpha.
                "bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]",
                "text-[#fbf5e8]",
                "border-[hsla(var(--pv-id-hue),65%,55%,0.32)]",
                "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,220,170,0.18)_inset,_0_0_0_0.5px_hsla(var(--pv-id-hue),70%,55%,0.2),_0_0_32px_hsla(var(--pv-id-hue),70%,52%,0.18)]",
                "prose-invert",
              ),
        )}
      >
        {isQuickReply ? (
          <ThumbsUp className="size-6" aria-label="quick reply" />
        ) : injected ? (
          // Phase 05 Plan 03 (UPLOAD-11): sender-side render of an injected
          // user turn. Caption text sits above an inline chip strip inside
          // the SAME bubble. Chips are filename + human-size only — no
          // thumbnails, no inline previews even for images, no landing-path
          // display (HARD LOCK from CONTEXT.md § Sender-side rendering).
          // AttachmentChipStrip runs in readOnly mode: no × remove, no
          // progress ring, no error decorations.
          <>
            {injected.caption.length > 0 && (
              <div className="pv-injected-caption whitespace-pre-wrap mb-2">
                {injected.caption}
              </div>
            )}
            <AttachmentChipStrip
              attachments={injected.files.map((f) => ({
                // tempId is unique per-file inside this bubble; landingPath
                // is guaranteed unique by the backend's collision-suffix loop
                // (Plan 01 orchestrator) so it doubles as a stable key.
                tempId: f.landingPath,
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
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ node, ...props }) => (
                <a
                  {...props}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              ),
              p: ({ node, children, ...props }) => (
                <p {...props}>{splitMarkers(children)}</p>
              ),
            }}
          >
            {processedContent}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
