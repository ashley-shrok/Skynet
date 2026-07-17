/**
 * Patch #51: WIP state classifier for the pretty-view work-in-progress
 * indicator.
 *
 * Pure helper — no I/O, no side effects, no imports. Classifies a raw
 * JSONL object from a Claude Code session file into a WIP transition
 * signal so `claude-session-server.ts` can emit `{type:"wip",active}`
 * frames on the wire without touching the existing parser.
 *
 * JSONL turn state machine (settled by design):
 *
 *   user turn (non-meta, non-harness-wrapper) → "start"  (WIP=true)
 *   assistant turn with any tool_use block    → "start"  (WIP=true)
 *   assistant turn with text-only blocks      → "end"    (WIP=false)
 *   assistant turn with only thinking blocks  → "start"  (WIP=true, defensive)
 *   anything else                             → null     (no transition)
 *
 * Known edge case (documented, no code fix): if Claude Code crashes
 * mid-tool-call the last JSONL event will be tool_use or tool_result
 * and WIP will remain true until new user input arrives. Accepted.
 */

const HARNESS_WRAPPER_TAGS = [
  ["<task-notification>", "</task-notification>"],
  ["<system-reminder>", "</system-reminder>"],
] as const;

/**
 * Extract all string text from a message content field.
 *
 * `content` may be a plain string or an array of content blocks, each
 * optionally having a `text` string field. Returns the trimmed
 * concatenation of all string text found.
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (
      block !== null &&
      typeof block === "object" &&
      "text" in block &&
      typeof (block as Record<string, unknown>).text === "string"
    ) {
      parts.push((block as Record<string, unknown>).text as string);
    }
  }
  return parts.join("").trim();
}

/**
 * Classify a raw JSONL object from a Claude Code session file into a
 * WIP transition signal.
 *
 * Returns:
 *   "start" — WIP is now true (Claude Code is working)
 *   "end"   — WIP is now false (Claude Code returned control)
 *   null    — no state change (meta, harness wrapper, malformed, system)
 *
 * Never throws — returns null on any structural surprise.
 */
export function classifyWipTransition(
  rawObj: Record<string, unknown>,
): "start" | "end" | null {
  try {
    const type = rawObj.type;

    // ── User turns ──────────────────────────────────────────────────────────
    if (type === "user") {
      // Meta events (skill body dumps, etc.) do not change WIP state.
      if (rawObj.isMeta === true) {
        return null;
      }

      // Harness wrappers (<task-notification> / <system-reminder>) are
      // injected by the Claude Code runtime and are not real user speech.
      const message = rawObj.message;
      if (message !== null && typeof message === "object") {
        const content = (message as Record<string, unknown>).content;
        const text = extractTextContent(content);
        if (text.length > 0) {
          for (const [openTag, closeTag] of HARNESS_WRAPPER_TAGS) {
            if (text.startsWith(openTag) && text.endsWith(closeTag)) {
              return null;
            }
          }
        }
      }

      // Real user turn: API call inbound / tool_result being processed.
      return "start";
    }

    // ── Assistant turns ──────────────────────────────────────────────────────
    if (type === "assistant") {
      const message = rawObj.message;
      if (message === null || typeof message !== "object") {
        return null; // Malformed.
      }
      const content = (message as Record<string, unknown>).content;
      if (!Array.isArray(content)) {
        return null; // Unexpected shape.
      }

      const blocks = content as Array<unknown>;
      const hasToolUse = blocks.some(
        (b) =>
          b !== null &&
          typeof b === "object" &&
          (b as Record<string, unknown>).type === "tool_use",
      );
      const hasText = blocks.some(
        (b) =>
          b !== null &&
          typeof b === "object" &&
          (b as Record<string, unknown>).type === "text",
      );

      if (hasToolUse) {
        // Tool call about to run — still working.
        return "start";
      }
      if (hasText) {
        // Text-only response — assistant returned control to the user.
        return "end";
      }
      // Only thinking blocks (or empty) — defensive: treat as still working.
      return "start";
    }

    // ── Everything else (system, unknown) ───────────────────────────────────
    return null;
  } catch {
    // Never propagate structural surprises.
    return null;
  }
}
