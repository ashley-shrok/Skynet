// Phase 90 Plan 05 Task 2 — RelayMessageList.
//
// The bubble list wrapper for the relay-room pane. Pure-render component:
// takes `history: MatrixEvent[]` from the parent (RelayRoomPane) and
// dispatches per event:
//
//   sender === viewingUserMxid → OutboundBubble (D-13 primitive from Plan 02)
//   otherwise                  → RelayRoomInboundBubble (D-12 fork from Plan 02
//                                Task 3 — expanded-always, no-collapse,
//                                no pointer-detect)
//
// LoadMoreOlderButton (D-14 reuse-as-is per PLAN.md) sits at the top of the
// list. Plan 06 wires the WS `fetch_older_range` call; this plan just
// forwards the click to a caller-supplied onLoadOlder callback.
//
// Attachment handling (D-19): inbound events with msgtype in
// (m.image, m.file, m.video, m.audio) render as a minimal placeholder text:
// "attachment: <filename>". No media fetch, no thumbnail, no mxc:// resolution.
// Outbound attachment rendering is DEFERRED — v1 attach is hidden per D-05
// (so the viewing user cannot originate attachments; only Element-clients or
// legacy agent rooms can).
//
// Empty history (D-17): renders the empty middle with NO empty-state chrome
// — just the LoadMoreOlderButton (which itself renders null when hasOlder is
// false per its own no-lie invariant) and no bubble children.
//
// Pending-send correlation (Pitfall 4): the parent passes a `pendingSends`
// array; when rendering an outbound event, this component looks up the
// pending entry by matching `unsigned.transaction_id === mqid` and passes
// its state to OutboundBubble. Plan 06 wires the actual state-machine
// removal on ack/timeout.
//
// D-12 FORK CONSUMPTION (CRITICAL): the inbound bubble import is from
// `./RelayRoomInboundBubble` — the Plan 02 Task 3 fork. It is NOT imported
// from the pretty-view sibling directory (that primitive stays untouched in
// pretty view per D-03). Test 7 grep-verifies the import path.
//
// Security (T-17-03-01 preserved from the sibling primitives): every bubble
// body is a React text child. Never uses HTML-injection APIs. See
// OutboundBubble.tsx + RelayRoomInboundBubble.tsx for the referenced discipline.

import { cn } from "@/lib/utils";
import { OutboundBubble } from "@/components/OutboundBubble";
import { LoadMoreOlderButton } from "@/features/pretty-view/LoadMoreOlderButton";
import { RelayRoomInboundBubble } from "./RelayRoomInboundBubble";
import type { MatrixEvent } from "./relay-room-api";

/**
 * A pending optimistic-send record. Parent (RelayRoomPane, populated by
 * Plan 06) tracks these; this component reads to drive the sending/failed
 * spinner + red-bubble treatment on outbound bubbles.
 */
export interface PendingSendRecord {
  /**
   * Correlation id. Same value used as Matrix txnId at send time; echoed
   * back by Matrix in `event.unsigned.transaction_id` on the resulting
   * event. Pitfall 4 correlation carrier.
   */
  mqid: string;
  content: string;
  state: "sending" | "failed";
}

export interface RelayMessageListProps {
  /**
   * Room events, ordered oldest → newest. Plan 06 wires the WS-derived
   * history + live-event append; this plan takes them as a prop.
   */
  history: MatrixEvent[];
  /**
   * The viewing user's Matrix mxid. Sourced by the parent via
   * useViewingUserMxid() (viewing-user-store; W#8). Drives the outbound-
   * vs-inbound render dispatch.
   */
  viewingUserMxid: string;
  /**
   * Pending optimistic-send records. Parent owns the state machine;
   * this component only READS the entries to look up sending/failed
   * state for outbound bubbles by matching mqid ↔ unsigned.transaction_id.
   */
  pendingSends: PendingSendRecord[];
  /** LoadMoreOlderButton passthrough — pane knows via WS session frame. */
  hasOlder: boolean;
  loadOlderStatus: "idle" | "in-flight" | "error";
  loadOlderError: string | null;
  onLoadOlder: () => void;
  /**
   * Room title used as the header label on inbound bubbles. May be null
   * when the Matrix room has no `m.room.name` state event set.
   */
  roomTitle: string | null;
  /** Optional wrapper class for consumers to control the flex/scroll layout. */
  className?: string;
}

/**
 * Extract a plain-text body from a Matrix event's content. Returns "" when
 * content.body is not a string. Handles the D-19 attachment placeholder
 * for inbound bubbles by returning `attachment: <filename>` when the event
 * carries an attachment msgtype.
 *
 * NEVER returns non-string content to the bubble body prop — that would
 * risk propagating raw untrusted objects into the DOM via React's
 * default-string-coercion behavior on children.
 */
function extractBody(event: MatrixEvent): string {
  const content = event.content;
  const msgtype = typeof content.msgtype === "string" ? content.msgtype : null;

  // D-19: attachment placeholder. Detect standard Matrix attachment msgtypes
  // OR the presence of an `info.filename` / `content.url` (mxc://) marker.
  const isAttachment =
    msgtype === "m.image" ||
    msgtype === "m.file" ||
    msgtype === "m.video" ||
    msgtype === "m.audio";
  if (isAttachment) {
    // Extract a filename with graceful fallbacks. Order: content.info.filename,
    // content.body (Matrix convention for the display name), then "file".
    const info = content.info as { filename?: unknown } | undefined;
    const infoFilename =
      info && typeof info.filename === "string" ? info.filename : null;
    const bodyFilename =
      typeof content.body === "string" && content.body.length > 0
        ? content.body
        : null;
    const filename = infoFilename ?? bodyFilename ?? "file";
    return `attachment: ${filename}`;
  }

  if (typeof content.body === "string") return content.body;
  return "";
}

/**
 * Look up a pending-send record by its matching Matrix txnId echoed back
 * as `unsigned.transaction_id`. Returns the record if found, else null.
 * Pitfall 4 correlation.
 */
function findPending(
  transactionId: string | undefined,
  pendingSends: PendingSendRecord[],
): PendingSendRecord | null {
  if (transactionId === undefined) return null;
  for (const p of pendingSends) {
    if (p.mqid === transactionId) return p;
  }
  return null;
}

export function RelayMessageList({
  history,
  viewingUserMxid,
  pendingSends,
  hasOlder,
  loadOlderStatus,
  loadOlderError,
  onLoadOlder,
  roomTitle,
  className,
}: RelayMessageListProps) {
  return (
    <div
      data-testid="relay-room-message-list"
      className={cn(
        // Fill the pane's middle area; scrollable so the list body stays
        // under the badge row and above the compose slot.
        "flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 px-3 py-2",
        className,
      )}
    >
      {/* LoadMoreOlderButton at the top — reused as-is per D-14. Its own
          no-lie invariant renders null when hasOlder=false, so no
          conditional needed here. */}
      <LoadMoreOlderButton
        hasOlder={hasOlder}
        status={loadOlderStatus}
        error={loadOlderError}
        onClick={onLoadOlder}
      />
      {history.map((event) => {
        // Outbound vs inbound dispatch (D-11 + D-13).
        if (event.sender === viewingUserMxid) {
          const txnId =
            event.unsigned !== undefined
              ? event.unsigned.transaction_id
              : undefined;
          const pending = findPending(txnId, pendingSends);
          return (
            <OutboundBubble
              key={event.event_id}
              content={extractBody(event)}
              ts={event.origin_server_ts}
              pendingState={pending?.state ?? null}
            />
          );
        }
        // Inbound bubble — uses the FORKED RelayRoomInboundBubble (D-12
        // fork consumption; NOT the pretty-view original per D-03).
        return (
          <RelayRoomInboundBubble
            key={event.event_id}
            room={roomTitle ?? ""}
            sender={event.sender}
            body={extractBody(event)}
            ts={event.origin_server_ts}
          />
        );
      })}
    </div>
  );
}
