// Which question the tray holds, worked out from the conversation itself, so
// every device showing the conversation agrees. The tray holds the latest ask
// the agent wrote since the user's last message; anything the user sends (an
// answer or words) closes it. Agent replies, wake-ups and other agents'
// messages never do. Earlier asks written since the user's last message were
// replaced by the newer one — the next message the user sends says so.
import { lastAskIn, type Ask } from "./ask-format";

export interface OpenAsk {
  ask: Ask;
  /** The agent message the ask came from. */
  eventId: string;
  /** Older unanswered asks the open one replaced, oldest first. */
  replaced: Ask[];
}

interface MessageLike {
  type: string;
  role?: string;
  content?: unknown;
  eventId: string;
}

export function deriveOpenAsk(
  events: readonly MessageLike[],
  /** A user message is on its way (optimistic bubble): the tray is already closed. */
  userSendInFlight: boolean,
): OpenAsk | null {
  if (userSendInFlight) return null;
  const found: Array<{ ask: Ask; eventId: string }> = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "message" || typeof e.content !== "string") continue;
    if (e.role === "user") break;
    if (e.role !== "assistant") continue;
    const ask = lastAskIn(e.content);
    if (ask) found.push({ ask, eventId: e.eventId });
  }
  if (found.length === 0) return null;
  const [open, ...older] = found;
  return { ask: open.ask, eventId: open.eventId, replaced: older.reverse().map((f) => f.ask) };
}
