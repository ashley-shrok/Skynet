import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Skeleton } from "@/components/skeleton";

// Patch #17g: tab renderer for the identity's <key>.md file.
//
// Shared TabState<T> type is exported from here so all 4 tab files share
// the same shape without a shared abstraction layer (each tab file is self-contained).
//
// Markdown scaffold mirrors ChatMessage.tsx assistant bubble — same
// ReactMarkdown + remarkGfm + prose class chain. The ~675-line identity file
// scrolls inside the tab pane via overflow-y-auto on the wrapper div.

export type TabState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T };

export function IdentityFileTab({ state }: { state: TabState<string> }) {
  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="text-sm text-[color:var(--color-pv-code-fg)]">
        Couldn&apos;t load identity file: {state.error}
      </div>
    );
  }

  if (!state.data) {
    return (
      <div className="text-sm text-[var(--color-pv-fg-muted)]">
        No identity file found for this identity.
      </div>
    );
  }

  return (
    <div
      className={[
        "prose prose-sm max-w-none overflow-y-auto h-full px-1",
        "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "dark:prose-invert",
        "prose-pre:my-2 prose-pre:p-2 prose-pre:rounded",
        "prose-pre:font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
        "prose-pre:bg-[rgba(10,12,20,0.6)] prose-pre:border prose-pre:border-white/[0.06]",
        "prose-pre:shadow-[inset_0_2px_8px_rgba(0,0,0,0.4)]",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-code:rounded prose-code:px-1 prose-code:py-0.5",
        "prose-code:font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
        "prose-code:bg-white/[0.08] prose-code:text-[var(--color-pv-code-fg)]",
        "prose-code:border prose-code:border-white/[0.06]",
      ].join(" ")}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {state.data}
      </ReactMarkdown>
    </div>
  );
}
