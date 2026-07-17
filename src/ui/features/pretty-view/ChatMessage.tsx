import { cn } from "@/lib/utils";

// Presentational chat bubble for one conversational message.
//
// Content renders as a plain DOM text node inside the bubble so that
// Phase 2 can attach native browser text selection without any render-
// tree rewrite here. Role is carried by bubble alignment + background
// color; no textual role label ("You:" / "Claude:") is rendered.
// Timestamps are out of Phase 1 scope.
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
          "max-w-[85%] rounded-lg px-3 py-2 whitespace-pre-wrap break-words text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-card text-card-foreground border border-border",
        )}
      >
        {content}
      </div>
    </div>
  );
}
