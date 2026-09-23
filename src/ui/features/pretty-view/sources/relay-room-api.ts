/**
 * Phase 93 Slice 3 — ported from Slice D's relay-room-api.ts per D-10.
 *
 * The retirement moved this out of the (now-retired per Phase 93 Slice 4)
 * standalone relay-source tree. This is a byte-for-behavior port: wire
 * types + `openRelayRoomSocket()` helper are preserved verbatim; only the
 * module-header JSDoc is rewritten to reflect the new home.
 *
 * ---
 *
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
 *
 * Phase 111 SKEW-09 (Plan 06): the WS URL grows a `?build=<CLIENT_BUILD_ID>`
 * query param at construction time so the backend handshake gate (Plan 05
 * Task 2 on relay-room-stream-server.ts) can refuse mismatched clients
 * with a distinguishable 4409 close code. Shared close/message detection
 * listeners are attached via `addEventListener` (which coexists with
 * caller-owned `.onclose`/`.onmessage` in `use-relay-adapter.ts`).
 */
import { CLIENT_BUILD_ID } from "@/lib/client-build-id";
import { lockSkewedSession } from "@/state/skew-lock-store";

export function openRelayRoomSocket(): WebSocket {
  const scheme =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "wss:"
      : "ws:";
  const host =
    typeof window !== "undefined" ? window.location.host : "localhost";
  // Phase 111 SKEW-09: handshake stamp for D-08 refusal on mismatch.
  const url = `${scheme}//${host}/relay-room/websocket/?build=${encodeURIComponent(CLIENT_BUILD_ID)}`;
  const ws = new WebSocket(url);
  attachRelayRoomSkewLockListeners(ws);
  return ws;
}

/**
 * Phase 111 SKEW-09 (D-08 + D-09): attach drift-detection listeners.
 *
 * `addEventListener` coexists with the caller's own `.onclose`/`.onmessage`
 * assignments (use-relay-adapter.ts L458 + L616) — both fire per DOM spec.
 *
 * D-08 close-code lane: `event.code === 4409` = handshake refused because
 * bundle is stale. Fires `lockSkewedSession`; the use-relay-adapter's own
 * onclose still runs but its reconnect setTimeout callback re-checks the
 * skew-lock snapshot before firing a fresh WS (see companion edit).
 *
 * D-09 per-message lane: backend piggybacks `build:` on every outbound
 * envelope. Mismatch fires the lock.
 *
 * Structured logging: explicit-field extraction on CloseEvent per role-file
 * directive (Pitfall 5).
 */
function attachRelayRoomSkewLockListeners(ws: WebSocket): void {
  // Test-mock compatibility: pre-existing relay tests (PrettyView.relay-veil,
  // use-relay-adapter) stub WebSocket with only `.onmessage`/`.onclose`
  // setters. Real browsers always ship `addEventListener` on WebSocket.
  if (typeof ws.addEventListener !== "function") return;
  ws.addEventListener("close", (event) => {
    const isSkew = event.code === 4409;
    console.info("[skew-lock] ws closed", {
      operation: "ws_closed",
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
      isSkew,
      endpoint: "relay-room-stream",
    });
    if (isSkew) {
      lockSkewedSession({
        reason: "ws_handshake_mismatch",
        clientBuild: CLIENT_BUILD_ID,
        serverBuild: event.reason || "unknown",
      });
    }
  });

  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "build" in parsed &&
      typeof (parsed as { build: unknown }).build === "string" &&
      (parsed as { build: string }).build !== CLIENT_BUILD_ID
    ) {
      lockSkewedSession({
        reason: "ws_message_tag_mismatch",
        clientBuild: CLIENT_BUILD_ID,
        serverBuild: (parsed as { build: string }).build,
      });
    }
  });
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
