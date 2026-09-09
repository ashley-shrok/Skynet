/**
 * matrix-message-fetch.ts — Phase 90 Plan 04 Task 1.
 *
 * Thin composition layer over Plan 03's `getRoomMessages` primitive at
 * src/backend/matrix/matrix-admin-client.ts. Owns the WS-facing shape and
 * the canonicalization of D-18 error codes (`not_member`, `not_found`) so
 * the WS server can translate them to `inactive` frames per Pitfall 8.
 *
 * ## Why a service layer at all
 *
 * Two concerns live here that don't belong in matrix-admin-client:
 *
 *   1. The WS server thinks in terms of "before this event id" — a UI
 *      pagination concept. matrix-admin-client thinks in terms of the raw
 *      Matrix `from` cursor. This layer maps the former to the latter.
 *
 *   2. The WS server needs Pitfall 8 semantics (403/404 → `inactive` frame
 *      → D-18 friendly error state). matrix-admin-client returns bare HTTP
 *      status codes with the generic `admin_api_non_2xx` error. This layer
 *      canonicalizes those into stable error-code strings so the WS server
 *      doesn't couple to Matrix's HTTP contract.
 *
 * The heavy lifting (fetch, auth, encodeURIComponent, AbortController,
 * response-parse discipline) lives in matrix-admin-client. This layer is
 * intentionally thin.
 *
 * ## Error canonicalization
 *
 * - Matrix 403 (typically `M_FORBIDDEN` — not a member of the room, or the
 *   room's history_visibility disallows the read) → `{ok: false, status: 403,
 *   error: "not_member"}`.
 * - Matrix 404 (room does not exist, or was deleted) → `{ok: false, status:
 *   404, error: "not_found"}`.
 * - Other errors (500, 502, 504, network) pass through verbatim so the WS
 *   server can distinguish transient proxy failures from access-lost.
 *
 * Both 403 and 404 must be treated the same by the WS server (same
 * `inactive` frame reason) to avoid an existence oracle per Security V8 —
 * but the codes remain distinct at this boundary so structured logging
 * can differentiate for debugging.
 *
 * ## What NOT to add here
 *
 * - NO auth logic — matrix-admin-client owns admin creds.
 * - NO retry logic — the WS server's per-connection lifecycle handles that
 *   by opening a fresh WS on the frontend's reconnect discipline.
 * - NO cursor persistence — the WS server passes the cursor from the frame.
 */

import { getRoomMessages, type MatrixEvent } from "../matrix/matrix-admin-client.js";

/**
 * WS-facing result shape. Success mirrors getRoomMessages; failure uses
 * canonicalized error-code strings for D-18 translation.
 */
export type FetchRoomHistoryOk = {
  ok: true;
  events: MatrixEvent[];
  end?: string;
  start?: string;
};

export type FetchRoomHistoryErr = {
  ok: false;
  status: number;
  error: string;
};

/**
 * Fetch a batch of relay-room history messages.
 *
 * @param roomId - Matrix room id.
 * @param opts.dir - 'b' for backward (older), 'f' for forward (newer).
 * @param opts.beforeEventId - Optional event-id cursor from a prior response
 *   (`end` for dir=b, `start` for dir=f). Omit on the initial load.
 * @param opts.count - Batch size (matches pretty-view's D-14 initial load = 20).
 */
export async function fetchRoomHistory(
  roomId: string,
  opts: { dir: "b" | "f"; beforeEventId?: string; count: number },
): Promise<FetchRoomHistoryOk | FetchRoomHistoryErr> {
  const result = await getRoomMessages(roomId, {
    dir: opts.dir,
    from: opts.beforeEventId,
    limit: opts.count,
  });

  if (result.ok === false) {
    // Canonicalize 403/404 for D-18 translation. Other statuses pass
    // through verbatim so structured logging + WS-server dispatch can
    // distinguish transient failures from access-lost.
    if (result.status === 403) {
      return { ok: false, status: 403, error: "not_member" };
    }
    if (result.status === 404) {
      return { ok: false, status: 404, error: "not_found" };
    }
    return result;
  }

  // M3 fixup 2026-09-09: filter non-`m.room.message` events out of the
  // batch before returning to the WS server. Matrix `/messages` returns
  // every kind of timeline event — state changes (m.room.member joins,
  // m.room.name renames, m.room.topic edits), reactions, redactions, etc.
  // The relay-room pane only renders message bubbles; unfiltered state
  // events used to fall through to the message-list body extractor (now
  // internalized into the shared chat surface via `useRelayAdapter`'s
  // MatrixEvent -> StreamEvent mapper per Phase 93 Slice 3) and
  // render as blank inbound bubbles attributed to whoever caused the
  // state change. Doing the filter here (backend) rather than in the
  // React render layer keeps WS payloads leaner (state events on a busy
  // room can outnumber messages) AND ensures downstream primitives never
  // see events they weren't designed for.
  //
  // NOTE: this is intentionally lenient about ordering — Matrix returns
  // events in the requested `dir`, so removing non-messages from the
  // middle just tightens the chunk without violating the caller's
  // pagination expectations. The `end`/`start` cursors still point at the
  // original chunk boundaries (they are opaque tokens; Matrix, not us,
  // decides how they advance).
  const messagesOnly = result.events.filter((e) => e.type === "m.room.message");

  // Happy path: pass-through. Empty chunk is D-17 empty-room state and is
  // returned as-is (`{ok: true, events: []}`) — the WS server's initial
  // history_batch frame will just have zero events; the pane renders with
  // the presence row + compose bar only.
  const passthrough: FetchRoomHistoryOk = { ok: true, events: messagesOnly };
  if (result.end !== undefined) passthrough.end = result.end;
  if (result.start !== undefined) passthrough.start = result.start;
  return passthrough;
}
