/**
 * user-reply-scan.ts — find the user's latest reply in a session transcript.
 *
 * A reply from the user clears a conversation's unread mark: once the user
 * has answered, everything the agent had finished before that answer counts
 * as seen, whether they typed it in Skynet or an orchestrator relayed it for
 * them (relays land in the transcript as plain typed text, same as the
 * composer).
 *
 * A reply is a bubble the conversation shows as the user's. Rather than keep
 * its own rules, the scan asks the same pipeline conversation search uses
 * (search-line-judge: the conversation's parser, queued-send dedup and bubble
 * tidying), and drops prompts the user cancelled with the conversation's own
 * cancel tracker. So wake-ups, relay DMs, app events, the supervisor's /id,
 * /exit and /compact, skill bodies, condense summaries, tool results and
 * interrupt markers never count, and a long pasted message, an answered
 * question, an upload or a slash command the user ran always does — exactly
 * as the conversation draws them.
 *
 * The timestamp is the transcript's own, written on the agent's machine —
 * the same clock as the Stop-file mtime it is compared against.
 */
import { createSearchLineJudge } from "../claude-session/search-line-judge.js";
import { InterruptCancelTracker } from "../claude-session/interrupt-cancel-tracker.js";

function timestampOf(obj: Record<string, unknown>): number | null {
  if (typeof obj.timestamp !== "string") return null;
  const ts = Date.parse(obj.timestamp);
  return Number.isFinite(ts) ? ts : null;
}

/** The reply's timestamp (unix ms) if `rawLine` alone is a message the user sent, else null. */
export function userReplyAt(rawLine: string): number | null {
  return scanTailForLatestUserReply(rawLine);
}

/**
 * Newest user reply (unix ms) in a transcript tail, or null when there is none.
 * The tail is read front to back: the queued-send dedup and the cancel tracker
 * both depend on what came before. A cut first line just fails to parse.
 */
export function scanTailForLatestUserReply(tailContents: string): number | null {
  const judge = createSearchLineJudge();
  const tracker = new InterruptCancelTracker();
  const replies: Array<{ uuid: string | null; at: number }> = [];
  const cancelled = new Set<string>();
  for (const line of tailContents.split("\n")) {
    if (line.trim() === "") continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) continue;
    const rec = obj as Record<string, unknown>;
    const { hide, unhide } = tracker.observe(rec, null);
    for (const uuid of hide) cancelled.add(uuid);
    for (const uuid of unhide) cancelled.delete(uuid);
    if (judge.judge(line)?.speaker !== "user") continue;
    const at = timestampOf(rec);
    if (at === null) continue;
    replies.push({ uuid: typeof rec.uuid === "string" ? rec.uuid : null, at });
  }
  for (let i = replies.length - 1; i >= 0; i--) {
    const r = replies[i];
    if (r.uuid === null || !cancelled.has(r.uuid)) return r.at;
  }
  return null;
}
