// Queued-send dedup (Phase 50): a message sent while the agent is busy lands
// in the session file twice — as a queue-operation enqueue and again at
// dequeue — and the conversation shows it once. Shared by the live tail (one
// Map per connection, wall-clock `now`) and conversation search (one Map per
// transcript, each line's own timestamp as `now`). See the strategy notes
// above the call site in claude-session-server.ts.

import { createHash } from "node:crypto";
import type { ParsedLine } from "./session-file-parser.js";

/** TTL for a dedup Map entry — 10 minutes, per D-11 Discretion. */
export const __QUEUE_DEDUP_TTL_MS = 10 * 60 * 1000;
/** Cap on Map size — bounds memory at ~100 * (~48B key + 8B value) ≈ 5.6KB/session. */
export const __QUEUE_DEDUP_CAP = 100;

/** Task-notification / system-reminder wrapper guards (mirrors parser Task 1). */
function isWrapperContent(content: string): boolean {
  return (
    content.startsWith("<task-notification>") ||
    content.startsWith("<system-reminder>")
  );
}

/**
 * Prune dedup Map entries older than the TTL. Walks from Map-insertion
 * head; stops at the first non-expired entry because insertion order is
 * monotonic (values are wall-clock ms epochs at insertion time and now
 * is monotonic-ish for our purposes — the tail-watcher lifetime is at
 * most a WS-connection lifetime, hours not months).
 */
function pruneExpiredQueueDedupEntries(
  dedupMap: Map<string, number>,
  now: number,
): void {
  for (const [key, insertedAt] of dedupMap) {
    if (now - insertedAt > __QUEUE_DEDUP_TTL_MS) {
      dedupMap.delete(key);
    } else {
      // Insertion order is monotonic — first non-expired means the rest
      // are also non-expired. Break to avoid scanning the full 100-entry Map.
      break;
    }
  }
}

/**
 * Enforce the capacity cap on the dedup Map. Called AFTER prune (so we
 * only evict live entries when we're genuinely at capacity, not just
 * because we haven't pruned in a while). Oldest-first eviction — Map
 * preserves insertion order in JS, so `.keys().next().value` is the
 * oldest.
 */
function enforceQueueDedupCap(dedupMap: Map<string, number>): void {
  while (dedupMap.size >= __QUEUE_DEDUP_CAP) {
    const oldest = dedupMap.keys().next();
    if (oldest.done) break;
    dedupMap.delete(oldest.value);
  }
}

/**
 * Apply the queue-enqueue dedup logic for a single parsed frame.
 *
 * Test seam mirroring the __applyInputMessageForTests convention. Called
 * from the production tail-watcher onLine right before ws.send for
 * kind:"message" frames.
 *
 * @param deps.parsedFrame - the ParsedLine returned by parseSessionLine
 * @param deps.rawObj      - the JSON.parse'd raw JSONL object (must expose
 *                           `.type` and `.operation`; other fields ignored)
 * @param deps.dedupMap    - per-session Map<contentHash, insertedAt-ms>
 * @param deps.now         - injectable wall-clock epoch (Date.now() in prod)
 *
 * @returns `{ suppress, dedupMap }`. `suppress:true` means the caller
 *          MUST NOT emit the WS frame (the frame was already emitted
 *          from an earlier enqueue entry). `dedupMap` is the same Map
 *          reference passed in — returned for test ergonomics.
 */
/**
 * Key for matching a dequeued user turn that Claude Code turned into inline
 * images against its earlier enqueue entry. The image turn's text gains
 * `[Image #N]` markers and loses the image paths, so neither side is
 * byte-comparable; drop both, collapse whitespace, and hash what is left.
 */
function imageTurnDedupKey(content: string): string {
  const normalized = content
    .replace(/\[Image #\d+\]/g, " ")
    .replace(/(?:^|\s)[`'"]?\/\S*\.(?:png|jpe?g|gif|webp)[`'"]?(?=\s|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    "img:" + createHash("sha256").update(normalized).digest("hex").slice(0, 32)
  );
}

export function __applyQueueDedupForTests(deps: {
  parsedFrame: ParsedLine;
  rawObj: Record<string, unknown>;
  dedupMap: Map<string, number>;
  now: number;
}): { suppress: boolean; dedupMap: Map<string, number> } {
  const { parsedFrame, rawObj, dedupMap, now } = deps;

  // User-role message frames participate, and user-role image frames on the
  // lookup side: a queued send whose image paths Claude Code inlined comes
  // back at dequeue as an image frame and must dedup against its enqueue.
  // Assistant turns, relay frames, skips, malformed lines pass through.
  if (parsedFrame.kind === "image") {
    if (parsedFrame.role !== "user" || parsedFrame.text.length === 0) {
      return { suppress: false, dedupMap };
    }
    if (rawObj.type !== "user") return { suppress: false, dedupMap };
    const imageKey = imageTurnDedupKey(parsedFrame.text);
    const insertedAt = dedupMap.get(imageKey);
    if (insertedAt === undefined) return { suppress: false, dedupMap };
    dedupMap.delete(imageKey);
    return { suppress: now - insertedAt <= __QUEUE_DEDUP_TTL_MS, dedupMap };
  }
  if (parsedFrame.kind !== "message") return { suppress: false, dedupMap };
  if (parsedFrame.role !== "user") return { suppress: false, dedupMap };
  if (typeof parsedFrame.content !== "string" || parsedFrame.content.length === 0) {
    return { suppress: false, dedupMap };
  }

  // Defensive: task-notification / system-reminder content should have
  // been skipped upstream at the parser; if it somehow reaches here (e.g.
  // a future parser change), still don't touch the Map.
  if (isWrapperContent(parsedFrame.content)) {
    return { suppress: false, dedupMap };
  }

  // contentHash = sha256(content).slice(0, 32) — content-only, matches
  // the derivation Plan 50-02's watchdog uses for arm-time + notifyMatched
  // keys (see 50-01-PLAN.md § objective "Hash-derivation contract").
  const contentHash = createHash("sha256")
    .update(parsedFrame.content)
    .digest("hex")
    .slice(0, 32);

  const rawType = rawObj.type;
  const rawOperation = rawObj.operation;

  if (rawType === "queue-operation" && rawOperation === "enqueue") {
    // Populate branch: parser confirmed this is a normal-content enqueue
    // and the frame is emitting. Insert into dedup Map so a later
    // dequeue-time user turn with matching content can be suppressed.
    // Lazy TTL prune + cap enforcement before insert.
    pruneExpiredQueueDedupEntries(dedupMap, now);
    enforceQueueDedupCap(dedupMap);
    dedupMap.set(contentHash, now);
    // Only enqueues that carried an image path can come back as an image
    // frame; keep the second key off ordinary sends.
    if (/\.(?:png|jpe?g|gif|webp)\b/i.test(parsedFrame.content)) {
      enforceQueueDedupCap(dedupMap);
      dedupMap.set(imageTurnDedupKey(parsedFrame.content), now);
    }
    return { suppress: false, dedupMap };
  }

  // Lookup branch: matching enqueue entry within TTL suppresses the frame
  // (dequeue-time double-write). Two rawType shapes carry the dequeue:
  //
  //   1. rawType === "user" — the original Claude-Code shape (D-11 revised).
  //   2. rawType === "attachment" with attachment.type === "queued_command" —
  //      newer shape that emerged in the harness (parser branch accepts it
  //      at session-file-parser.ts L1085, per pv-parser-accept-queued-
  //      command-attachment 2026-08-10). The user 2026-09-13 confirmed a live
  //      dormant-send repro where the same content lands as enqueue +
  //      attachment_queued_command, no user turn — two bubbles rendered
  //      because this lookup only matched "user". Diagnostic drop:
  //      pv-client-pending-send-timer-dormancy-blind — solstice follow-up.
  //
  // Both are the SAME logical send and MUST dedup against the earlier
  // enqueue. Single-shot on match — matched entry is consumed so a later
  // genuine third occurrence still emits.
  const isUserTurn = rawType === "user";
  let isAttachmentQueuedCommand = false;
  if (rawType === "attachment") {
    const att = rawObj.attachment;
    if (att !== null && typeof att === "object") {
      isAttachmentQueuedCommand =
        (att as Record<string, unknown>).type === "queued_command";
    }
  }
  if (isUserTurn || isAttachmentQueuedCommand) {
    const insertedAt = dedupMap.get(contentHash);
    if (insertedAt !== undefined) {
      if (now - insertedAt <= __QUEUE_DEDUP_TTL_MS) {
        dedupMap.delete(contentHash);
        // The send came back as text, so its image-turn key is spent too.
        dedupMap.delete(imageTurnDedupKey(parsedFrame.content));
        return { suppress: true, dedupMap };
      }
      // Expired entry — clean up and continue to emit.
      dedupMap.delete(contentHash);
    }
    return { suppress: false, dedupMap };
  }

  // Any other rawType (relay_inbound wrappers that surfaced as user turns
  // via a different path, etc.) is out of scope for this dedup path.
  return { suppress: false, dedupMap };
}

