/**
 * Conversation search's line judge (shape-search-matches-conversation).
 *
 * Search finds only what the conversation view shows, attributed the way the
 * view attributes it. Rather than keep its own rules about what counts, it
 * asks the same pipeline the conversation uses to turn transcript lines into
 * bubbles: the session-file parser, then the queued-send dedup, then the
 * bubble-text tidying ChatMessage applies before rendering. A line the
 * conversation hides judges to null; a line it shows judges to the words its
 * bubble displays and who the bubble belongs to.
 *
 * One judge per transcript, fed lines in file order — the dedup steps are
 * stateful (a queued send appears twice; a relay message can arrive in more
 * than one envelope).
 *
 * One thing a single line can't tell: whether the user later cancelled a
 * message (the conversation learns that from the next prompt). Callers that
 * need it run the conversation's cancel tracker too — over the lines they
 * hold (user-reply-scan.ts) or via search's cancel pass
 * (conversation-search-cancels.ts).
 */

import { parseSessionLineQuietly } from "./session-file-parser.js";
import { __applyQueueDedupForTests } from "./queue-dedup.js";
import {
  agentBubbleText,
  userBubbleText,
} from "../../ui/features/pretty-view/bubble-text.js";
import {
  detectFilePointer,
  pointerPreview,
} from "../../ui/features/pretty-view/relay-pointer-detect.js";

/** Whose bubble a match is in. `relay` = a relay message in or out; the
 *  frontend names the parties the way the conversation's relay cards do. */
export type SearchSpeaker = "user" | "agent" | "relay";

export interface JudgedLine {
  speaker: SearchSpeaker;
  /** The words the bubble displays. */
  text: string;
  /** relay only: the sender's mxid for a message the agent received; null for
   *  one the agent sent. */
  relayFrom?: string | null;
  /** relay only: who the agent addressed a message it sent (mxid or name as
   *  the agent wrote it), null when unknown or for a received message. */
  relayTo?: string | null;
  /** relay only: the room it went through, so the row can name the parties
   *  from the room's members the way the relay cards do. */
  relayRoom?: string | null;
}

export interface SearchLineJudge {
  judge(rawLine: string): JudgedLine | null;
}

export function createSearchLineJudge(): SearchLineJudge {
  const queueDedup = new Map<string, number>();
  const seenRelayEvents = new Set<string>();

  return {
    judge(rawLine: string): JudgedLine | null {
      const parsed = parseSessionLineQuietly(rawLine);

      if (parsed.kind === "message" || parsed.kind === "image") {
        if (parsed.kind === "message" && parsed.interrupted) return null;
        if (parsed.role !== "user" && parsed.role !== "assistant") return null;
        // Queued sends: the conversation shows the enqueue and drops the
        // dequeue repeat. Opening a conversation replays the whole file at one
        // moment, so the repeat window never runs out there; a fixed clock
        // does the same here.
        let rawObj: Record<string, unknown>;
        try {
          rawObj = JSON.parse(rawLine) as Record<string, unknown>;
        } catch {
          return null;
        }
        const { suppress } = __applyQueueDedupForTests({
          parsedFrame: parsed,
          rawObj,
          dedupMap: queueDedup,
          now: 0,
        });
        if (suppress) return null;
        const raw = parsed.kind === "message" ? parsed.content : parsed.text;
        const text = parsed.role === "user" ? userBubbleText(raw) : agentBubbleText(raw);
        if (text.trim().length === 0) return null;
        return { speaker: parsed.role === "user" ? "user" : "agent", text };
      }

      if (parsed.kind === "relay_inbound") {
        // The conversation shows one bubble per relay event.
        if (parsed.matrixEventId) {
          if (seenRelayEvents.has(parsed.matrixEventId)) return null;
          seenRelayEvents.add(parsed.matrixEventId);
        }
        // A long message arrives as a pointer to a file; the bubble shows the
        // preview the pointer line quotes.
        const pointer = detectFilePointer(parsed.body);
        const text = pointer ? pointerPreview(pointer.pointerLine) : parsed.body;
        if (text.trim().length === 0) return null;
        return { speaker: "relay", text, relayFrom: parsed.sender, relayTo: null, relayRoom: parsed.room };
      }

      if (parsed.kind === "relay_outbound") {
        // A send whose body couldn't be read shows no words to match.
        if (parsed.body === null || parsed.body.trim().length === 0) return null;
        return {
          speaker: "relay",
          text: parsed.body,
          relayFrom: null,
          relayTo: parsed.to ?? null,
          relayRoom: parsed.room,
        };
      }

      return null;
    },
  };
}
