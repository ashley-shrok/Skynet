import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

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
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 break-words text-sm leading-relaxed",
          "prose prose-sm max-w-[85%]",
          "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
          "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          "prose-pre:my-2 prose-pre:p-2 prose-pre:rounded",
          "prose-code:before:content-none prose-code:after:content-none",
          "prose-code:rounded prose-code:px-1 prose-code:py-0.5",
          "prose-code:font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
          "prose-pre:font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
          isUser
            ? "bg-primary text-primary-foreground prose-invert"
            : "bg-card text-card-foreground border border-border dark:prose-invert",
        )}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
