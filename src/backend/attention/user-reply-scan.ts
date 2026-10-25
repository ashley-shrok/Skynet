/**
 * user-reply-scan.ts — find the user's latest reply in a session transcript.
 *
 * A reply from the user clears a conversation's unread mark: once the user
 * has answered, everything the agent had finished before that answer counts
 * as seen, whether they typed it in Skynet or an orchestrator relayed it for
 * them (relays land in the transcript as plain typed text, same as the
 * composer).
 *
 * A transcript "user" line is a reply only when a person sent it. Excluded:
 *   - anything the fleet delivers wrapped in <task-notification> — ambient
 *     watcher events (wake-ups, sensors, relay DMs, file changes), app
 *     events (Move to sidebar, widget submits), background-task results —
 *     whether bare or inside a <pasted_content> block
 *   - other XML-wrapped harness lines (local-command output and the like)
 *   - the supervisor's own slash commands: /id (birth, recycle), /exit,
 *     /compact — and the plain "/compact …" prompt line written before a
 *     condense runs (what the supervisor types to start one)
 *   - skill-body injections (isMeta), compaction summaries (written as a
 *     plain-text user line, before the /compact line) and tool results
 *   - interrupt markers, Ctrl-C noise, the supervisor's resumed sentinel,
 *     agent-team teammate messages
 *
 * Included beyond the older isRealUserTurn predicate: long messages, which
 * arrive wrapped in <pasted_content>, and messages with an image attached
 * (list content).
 *
 * The timestamp is the transcript's own, written on the agent's machine —
 * the same clock as the Stop-file mtime it is compared against.
 */
import { isTeammateMessage } from "../claude-session/session-file-parser.js";

const SUPERVISOR_COMMANDS = new Set(["/id", "/exit", "/compact"]);
const LEADING_IMAGE_MARKERS = /^(?:\[Image #\d+\]\s*)+/;
const PASTED_OPEN = /^<pasted_content\b[^>]*>/;
const COMMAND_NAME = /<command-name>([^<]*)<\/command-name>/;

function contentText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (block === null || typeof block !== "object") return null;
    const b = block as Record<string, unknown>;
    if (b.type === "tool_result") return null;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

/** The reply's timestamp (unix ms) if `rawLine` is a message the user sent, else null. */
export function userReplyAt(rawLine: string): number | null {
  const trimmedLine = rawLine.trim();
  if (trimmedLine === "") return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmedLine);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== "object") return null;
  const top = obj as Record<string, unknown>;
  if (top.type !== "user" || top.isMeta === true) return null;
  if (top.isCompactSummary === true || top.isVisibleInTranscriptOnly === true) return null;
  const msg = top.message;
  if (msg === null || typeof msg !== "object") return null;
  const text = contentText((msg as Record<string, unknown>).content);
  if (text === null) return null;

  const t = text.trim().replace(LEADING_IMAGE_MARKERS, "").trim();
  if (t.replace(/[\x00-\x1F]/g, "").trim() === "") return null;

  const pasted = PASTED_OPEN.exec(t);
  if (pasted) {
    const inner = t.slice(pasted[0].length).trim();
    if (inner.startsWith("<task-notification")) return null;
    if (/^\/compact(\s|$)/.test(inner)) return null;
  } else if (t.startsWith("<command-")) {
    const name = COMMAND_NAME.exec(t)?.[1]?.trim() ?? "";
    if (SUPERVISOR_COMMANDS.has(name)) return null;
  } else if (t.startsWith("<") && t.endsWith(">")) {
    return null;
  }

  if (/^\/compact(\s|$)/.test(t)) return null;
  if (t.startsWith("[Request interrupted")) return null;
  if (t.startsWith("Your session was just resumed by the agent-supervisor")) return null;
  if (isTeammateMessage(t)) return null;

  const rawTs = top.timestamp;
  if (typeof rawTs !== "string") return null;
  const ts = Date.parse(rawTs);
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Newest user reply (unix ms) in a transcript tail, or null when there is none.
 * Transcripts are append-only, so the scan walks back from the end and stops
 * at the first reply; the substring checks skip parsing non-user lines and
 * tool results (in the raw JSON line, quotes inside message text are escaped,
 * so `"type":"tool_result"` only matches the structure).
 */
export function scanTailForLatestUserReply(tailContents: string): number | null {
  const lines = tailContents.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"type":"user"') || line.includes('"type":"tool_result"')) continue;
    const ts = userReplyAt(line);
    if (ts !== null) return ts;
  }
  return null;
}
