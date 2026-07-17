/**
 * Parse one line of a Claude Code JSONL session file into a conversational
 * message event, or classify it as skip/malformed.
 *
 * V1 scope is a HARD LOCK (RENDER-01, .planning/shapes/shape-pretty-session-view.md
 * "aggressive minimalism"): only user-typed text and Claude's text replies
 * become messages. Anthropic content blocks come in four shapes — text,
 * tool_use, tool_result, thinking — and v1 emits ONLY text. tool_use,
 * tool_result, and thinking are dropped structurally (never surfaced as
 * content), and turns whose only non-text content is those types return
 * {kind:"skip"}.
 *
 * Informational-only prior art (NOT a dependency): github.com/delexw/claude-code-trace
 * has already worked out the file format; we reimplement here because the
 * scope is narrower than what the library does.
 */

export type ConversationalMessage = {
  kind: "message";
  role: "user" | "assistant";
  content: string;
  eventId: string;
  ts: number;
};

export type ParsedLine =
  | ConversationalMessage
  | { kind: "skip"; why: string }
  | { kind: "malformed" };

type ContentBlock = { type?: string; text?: string; [k: string]: unknown };

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as ContentBlock[]) {
      if (
        block &&
        typeof block === "object" &&
        block.type === "text" &&
        typeof block.text === "string"
      ) {
        parts.push(block.text);
      }
    }
    return parts.join("");
  }
  return "";
}

function fallbackEventId(): string {
  return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
}

export function parseSessionLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (trimmed === "") return { kind: "skip", why: "empty" };

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { kind: "malformed" };
  }

  const type = obj.type;
  const isUser = type === "user";
  const isAssistant = type === "assistant";
  if (!isUser && !isAssistant) {
    return { kind: "skip", why: String(type ?? "unknown") };
  }
  const role: "user" | "assistant" = isUser ? "user" : "assistant";

  // Skip machinery-injected turns (skill bodies, <local-command-caveat>
  // notices). Real user speech is never `isMeta: true`; cross-verified on
  // 4 live sessions with 0 false positives.
  if (obj.isMeta === true) {
    return { kind: "skip", why: "meta" };
  }

  const msg = obj.message as Record<string, unknown> | null | undefined;
  if (msg == null) return { kind: "skip", why: "no_message" };

  const content = extractText(msg.content);
  if (content === "") return { kind: "skip", why: "empty_content" };

  // Skip harness-injected wrapper-only user turns. The Monitor tool
  // ("<task-notification>") and stop-hook nudges ("<system-reminder>")
  // land as user turns because the harness stitches them into the user
  // stream — but they're not real user speech and add noise to pretty
  // view. Filter is intentionally strict: whole trimmed content must BE
  // the wrapper (startsWith AND endsWith), so a user turn that mixes a
  // reminder with real speech (both text blocks concatenated) still
  // renders. Nobody legitimately types these tags as prose.
  if (isUser) {
    const t = content.trim();
    if (
      (t.startsWith("<task-notification>") && t.endsWith("</task-notification>")) ||
      (t.startsWith("<system-reminder>") && t.endsWith("</system-reminder>"))
    ) {
      return { kind: "skip", why: "harness_wrapper" };
    }
  }

  const uuid = obj.uuid;
  const messageId = obj.messageId;
  const eventId =
    typeof uuid === "string" && uuid.length > 0
      ? uuid
      : typeof messageId === "string" && messageId.length > 0
        ? messageId
        : fallbackEventId();

  const rawTs = obj.timestamp;
  let ts = Date.now();
  if (typeof rawTs === "string") {
    const parsed = Date.parse(rawTs);
    if (Number.isFinite(parsed)) ts = parsed;
  }

  return {
    kind: "message",
    role,
    content,
    eventId,
    ts,
  };
}
