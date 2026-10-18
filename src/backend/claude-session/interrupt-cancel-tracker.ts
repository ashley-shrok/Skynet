/**
 * interrupt-cancel-tracker.ts — transcript-only bookkeeping for the pretty-view
 * interrupt button (campaign interrupt-button, shape-interrupt-button.md).
 *
 * One tracker per claude-session WS connection, fed every raw JSONL line the
 * connection's `tail -F -n +1` replays (history AND live, in file order).
 *
 * What Claude Code does (measured on 2.1.286 + 2.1.302, 2026-10-16/18):
 *   • Escape (or Ctrl-C) pressed before the agent has produced ANY output for
 *     the latest prompt rewinds it: the prompt goes back into the harness input
 *     box and the model never sees it. The transcript KEEPS the user entry and
 *     writes nothing to mark the cancel.
 *   • The next prompt is then written with the SAME parentUuid as the cancelled
 *     one — the cancelled prompt becomes a sibling dead end. Across 499 real
 *     transcripts this "consecutive prompt starts share a parent, no agent
 *     output between" shape identified every real cancellation and nothing else.
 *   • Pressed after output began, the harness stops and writes a user entry
 *     "[Request interrupted by user]" (or "... for tool use") immediately.
 *   • If the harness restarts (dormancy /exit, recycle, crash) BEFORE the next
 *     prompt, `--resume` rebuilds from the file and REVIVES the cancelled prompt
 *     (anthropics/claude-code#103213): new entries descend from it (a synthetic
 *     "No response requested." reply, or the next prompt). The tracker reports
 *     that as an unhide so the view keeps matching what the agent has.
 *
 * The tracker never reads the harness screen and stores nothing outside the
 * connection's memory: after the live moment, the transcript decides.
 */

const INTERRUPT_MARKER_PREFIX = "[Request interrupted by user";

export type PromptState = "open" | "cancelled_live" | "cancelled_confirmed";

export interface TrackedPrompt {
  uuid: string;
  parentUuid: string | null;
  /** Text the chat view shows for this prompt (null = not a visible bubble). */
  visibleText: string | null;
  /** True once anything other than the prompt's attachments descends from it. */
  agentOutput: boolean;
  /** True once an interrupt marker descends from this prompt. */
  stopped: boolean;
  state: PromptState;
}

export interface TrackerChanges {
  /** eventIds the view must hide (cancelled prompts). */
  hide: string[];
  /** eventIds the view must show again (a restart revived them). */
  unhide: string[];
}

export interface TrackerSnapshot {
  markerCount: number;
  latestUuid: string | null;
}

export type InterruptVerdict =
  | { verdict: "stopped" }
  | { verdict: "cancelled"; prompt: TrackedPrompt }
  | {
      verdict: "none";
      reason: "no_prompt" | "agent_output" | "already_cancelled";
    };

function messageContent(obj: Record<string, unknown>): unknown {
  const msg = obj.message;
  if (!msg || typeof msg !== "object") return undefined;
  return (msg as Record<string, unknown>).content;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { type: string; text: string } =>
        !!b &&
        typeof b === "object" &&
        (b as Record<string, unknown>).type === "text" &&
        typeof (b as Record<string, unknown>).text === "string",
    )
    .map((b) => b.text)
    .join("\n");
}

/** The harness's interrupt marker line (plain or "for tool use"). */
export function isInterruptMarker(obj: Record<string, unknown>): boolean {
  if (obj.type !== "user") return false;
  return textOf(messageContent(obj)).trimStart().startsWith(INTERRUPT_MARKER_PREFIX);
}

/**
 * A user entry that starts a new prompt: not a tool result, not meta, not the
 * interrupt marker. Includes harness-injected prompts (task-notification
 * wrappers, slash commands) — they take part in the sibling shape too even
 * though the view never shows them.
 */
export function isPromptStart(obj: Record<string, unknown>): boolean {
  if (obj.type !== "user") return false;
  if (obj.isMeta === true) return false;
  if (obj.isSidechain === true) return false;
  const content = messageContent(obj);
  if (Array.isArray(content)) {
    if (
      content.some(
        (b) => !!b && typeof b === "object" && (b as Record<string, unknown>).type === "tool_result",
      )
    ) {
      return false;
    }
  }
  return !isInterruptMarker(obj);
}

export class InterruptCancelTracker {
  private latest: TrackedPrompt | null = null;
  /** uuids descending from `latest` (its attachments, replies, markers). */
  private subtree = new Set<string>();
  private markerCount = 0;

  /**
   * Feed one raw JSONL object, in file order.
   * @param visibleText the text the chat view renders for this line when it is
   *   a visible user bubble (from parseSessionLine), else null.
   */
  observe(obj: Record<string, unknown>, visibleText: string | null): TrackerChanges {
    const changes: TrackerChanges = { hide: [], unhide: [] };
    const uuid = typeof obj.uuid === "string" && obj.uuid.length > 0 ? obj.uuid : null;
    if (uuid === null) return changes;
    const parentUuid =
      typeof obj.parentUuid === "string" && obj.parentUuid.length > 0 ? obj.parentUuid : null;
    const prev = this.latest;
    const descendsFromLatest = parentUuid !== null && this.subtree.has(parentUuid);

    if (isPromptStart(obj)) {
      if (prev) {
        const sibling =
          parentUuid !== null && parentUuid === prev.parentUuid && !prev.agentOutput && !prev.stopped;
        if (sibling) {
          if (prev.state === "open") changes.hide.push(prev.uuid);
          prev.state = "cancelled_confirmed";
        } else if (prev.state === "cancelled_live" && descendsFromLatest) {
          // Restart revived the cancelled prompt: the next prompt hangs off it.
          changes.unhide.push(prev.uuid);
          prev.state = "open";
        }
      }
      this.latest = {
        uuid,
        parentUuid,
        visibleText,
        agentOutput: false,
        stopped: false,
        state: "open",
      };
      this.subtree = new Set([uuid]);
      return changes;
    }

    if (!prev || !descendsFromLatest) return changes;
    this.subtree.add(uuid);
    if (isInterruptMarker(obj)) {
      prev.stopped = true;
      this.markerCount += 1;
      return changes;
    }
    // Anything but the prompt's own attachments (an assistant entry, an API
    // error notice, …) means the harness was already handling it — a rewind
    // only ever leaves attachments under the prompt.
    if (obj.type !== "attachment") prev.agentOutput = true;
    if (obj.type === "assistant") {
      if (prev.state === "cancelled_live") {
        // Restart revived the cancelled prompt (synthetic reply written to it).
        changes.unhide.push(prev.uuid);
        prev.state = "open";
      }
    }
    return changes;
  }

  snapshot(): TrackerSnapshot {
    return { markerCount: this.markerCount, latestUuid: this.latest?.uuid ?? null };
  }

  /** True when an interrupt marker landed after `snap` was taken. */
  markerSince(snap: TrackerSnapshot): boolean {
    return this.markerCount > snap.markerCount;
  }

  /** Verdict after Escape has been sent and the marker wait has elapsed. */
  decide(snap: TrackerSnapshot): InterruptVerdict {
    if (this.markerSince(snap)) return { verdict: "stopped" };
    const p = this.latest;
    if (!p) return { verdict: "none", reason: "no_prompt" };
    if (p.state !== "open") return { verdict: "none", reason: "already_cancelled" };
    if (p.agentOutput || p.stopped) return { verdict: "none", reason: "agent_output" };
    return { verdict: "cancelled", prompt: p };
  }

  /** Record a live cancel verdict (this connection's or a peer's). */
  markCancelledLive(uuid: string): boolean {
    if (!this.latest || this.latest.uuid !== uuid || this.latest.state !== "open") return false;
    this.latest.state = "cancelled_live";
    return true;
  }
}
