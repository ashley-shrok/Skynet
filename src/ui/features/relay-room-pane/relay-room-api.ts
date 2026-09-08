/**
 * Live relay-room WebSocket client wrapper + type-only wire contracts.
 *
 * Opens a same-origin WebSocket to the backend `relay-room-stream-server`
 * (Plan 04 output, listening on port 30015 behind nginx at
 * `/relay-room/websocket/`). The browser attaches the `jwt` HttpOnly cookie
 * automatically via same-origin.
 *
 * Callers construct payloads directly and `switch (event.type)` on incoming
 * frames — no runtime discriminator helper is exported. Every frame shape
 * mirrors Plan 04's server-side emissions byte-for-byte (see
 * `src/backend/relay-room-stream/relay-room-stream-server.ts` L110-168 for the
 * canonical definitions).
 *
 * Pitfall 4 correlation carrier: on inbound `live_event` frames, the frontend
 * reads `event.unsigned.transaction_id` to match its optimistic pending
 * bubbles (mqid == txnId at send time, echoed back by Matrix in
 * `unsigned.transaction_id` on the same event). This module names the field
 * on `MatrixEvent`; consumers pattern-match on it.
 */

// ────────────────────────────────────────────────────────────────────────────
// WebSocket primitive
// ────────────────────────────────────────────────────────────────────────────

/**
 * Open a WebSocket to the relay-room-stream server. Mirrors
 * `openClaudeSessionSocket` in `claude-session-api.ts` L14-23 with the URL
 * path swapped to `/relay-room/websocket/`. Same-origin — no query-string
 * JWT fallback (browsers send the HttpOnly cookie automatically).
 */
export function openRelayRoomSocket(): WebSocket {
  const scheme =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "wss:"
      : "ws:";
  const host =
    typeof window !== "undefined" ? window.location.host : "localhost";
  const url = `${scheme}//${host}/relay-room/websocket/`;
  return new WebSocket(url);
}

// ────────────────────────────────────────────────────────────────────────────
// Matrix event shape (minimal — enough for the pane's render + correlation)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Matrix event, as delivered by Plan 04's backend from Synapse's `/messages`
 * and `/sync` calls. Minimum fields needed by the relay-room pane; the raw
 * Matrix shape carries more fields that this pane does not consume today.
 *
 * `unsigned.transaction_id` is the Pitfall 4 correlation carrier. When the
 * frontend sends a message with `txnId === mqid`, Matrix echoes the same
 * value back on the resulting event's `unsigned.transaction_id` field —
 * the pane matches its pending optimistic bubble by that value.
 */
export interface MatrixEvent {
  event_id: string;
  type: string;
  sender: string;
  origin_server_ts: number;
  content: Record<string, unknown>;
  unsigned?: {
    transaction_id?: string;
    [k: string]: unknown;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Participant shapes (mirror Plan 04's participants-classifier.ts contract)
// ────────────────────────────────────────────────────────────────────────────

/**
 * A human participant in a relay room. Mirrors the backend's HumanParticipant
 * shape at `src/backend/relay-room-stream/participants-classifier.ts` L65-69.
 * `userId` is the Skynet user-row id (backend emits it as a string).
 */
export interface HumanParticipant {
  mxid: string;
  displayName: string;
  userId: string;
}

/**
 * An agent participant in a relay room. Mirrors the backend's AgentParticipant
 * shape at `src/backend/relay-room-stream/participants-classifier.ts` L76-79.
 * `identityKey` is derived server-side from the mxid's localpart.
 */
export interface AgentParticipant {
  mxid: string;
  identityKey: string;
}

/**
 * REST response shape for `GET /relay-room/:roomId/participants` (Plan 04
 * Task 3). Note: the REST endpoint filters the viewing user out of `humans`
 * server-side (D-07). The WS `participants` frame does NOT filter — it carries
 * the full list.
 */
export interface RelayRoomParticipantsResponse {
  humans: HumanParticipant[];
  agents: AgentParticipant[];
}

// ────────────────────────────────────────────────────────────────────────────
// Server → client frame types (mirror relay-room-stream-server.ts L133-168)
// ────────────────────────────────────────────────────────────────────────────

/** Emitted immediately on WS connect after auth + access gate pass. */
export interface SessionFrame {
  type: "session";
  roomId: string;
  roomTitle: string | null;
}

/**
 * Emitted on connect (after `session`, before `history_batch`) AND on every
 * membership-change tick. Carries the FULL humans+agents list — the frontend
 * filters the viewing user client-side per D-07.
 */
export interface ParticipantsFrame {
  type: "participants";
  humans: HumanParticipant[];
  agents: AgentParticipant[];
}

/**
 * Emitted on initial connect (20 newest events) and in response to
 * `fetch_older_range` client frames.
 */
export interface HistoryBatchFrame {
  type: "history_batch";
  events: MatrixEvent[];
  hasMore: boolean;
}

/**
 * Emitted for every new room event delivered via the backend's live
 * subscription to Matrix `/sync`.
 */
export interface LiveEventFrame {
  type: "live_event";
  event: MatrixEvent;
}

/**
 * Emitted on successful `send_message` — `txnId` echoes the client-supplied
 * mqid so the optimistic pending bubble can be settled.
 */
export interface SendAckFrame {
  type: "send_ack";
  txnId: string;
  eventId: string;
}

/** Emitted on failed `send_message` — reason is a stable string code. */
export interface SendErrorFrame {
  type: "send_error";
  txnId: string;
  reason: string;
}

/**
 * Emitted when the room becomes unavailable to the viewing user (403/404
 * from Matrix — kicked, banned, or room deleted). Backend closes the WS
 * cleanly (code 1000) after this frame. Frontend translates to the D-18
 * error state.
 */
export interface InactiveFrame {
  type: "inactive";
  reason: "not_member" | "not_found";
}

/** Emitted for non-fatal errors (backend keeps the connection open). */
export interface ErrorFrame {
  type: "error";
  message: string;
}

/**
 * Discriminated union covering every frame type Plan 04's WS server emits.
 * Consumers `switch (event.type)` to narrow.
 */
export type RelayRoomServerEvent =
  | SessionFrame
  | ParticipantsFrame
  | HistoryBatchFrame
  | LiveEventFrame
  | SendAckFrame
  | SendErrorFrame
  | InactiveFrame
  | ErrorFrame;

// ────────────────────────────────────────────────────────────────────────────
// Client → server frame types (mirror relay-room-stream-server.ts L114-128)
// ────────────────────────────────────────────────────────────────────────────

/** Sent immediately after WS `onopen` — subscribes to the room. */
export interface ConnectToRoomPayload {
  type: "connectToRoom";
  roomId: string;
}

/**
 * Sent by the compose-box send path (Plan 06 wires the caller).
 * `txnId === mqid` — the client's optimistic-send id doubles as Matrix's
 * transaction id (Pitfall 4 correlation).
 */
export interface SendMessagePayload {
  type: "send_message";
  body: string;
  txnId: string;
}

/**
 * Sent by the pane's LoadMoreOlderButton (Plan 06 wires the caller).
 * `beforeEventId` is the oldest currently-loaded event's id; `count` is 20
 * to match pretty view's WORKING_SET_CAP (D-14).
 */
export interface FetchOlderRangePayload {
  type: "fetch_older_range";
  beforeEventId: string;
  count: number;
}

/** Discriminated union of every client-side payload this pane can send. */
export type RelayRoomClientPayload =
  | ConnectToRoomPayload
  | SendMessagePayload
  | FetchOlderRangePayload;
