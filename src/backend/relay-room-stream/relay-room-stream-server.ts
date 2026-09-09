/**
 * relay-room-stream-server.ts — Phase 90 Plan 04 Task 2.
 *
 * New WS server bound to a dedicated port for /relay-room/websocket/.
 * Keyed on `(userId, roomId)` — mirrors claude-session-server's
 * `(hostId, tmuxSession)` keying model. Every relay-room pane in the
 * browser opens a WS to this server.
 *
 * ## Trust boundaries
 *
 * - Browser → server: JWT httpOnly cookie on the upgrade request. All
 *   frame content and URL query params are UNTRUSTED. userId + mxid are
 *   populated by the JWT verification step ONLY (Security V2 —
 *   session-fixation defense).
 * - Server → Synapse: admin creds (via Plan 03's getRoomMessages) OR
 *   per-user mint via loginAsUser (via Plan 03's sendMessageAsUser).
 *   NEVER emit tokens in server → client frames or logs (T-90-BE-01).
 *
 * ## Access-control gate (T-90-BE-02)
 *
 * Every read/write path executes:
 *
 *     SELECT id FROM relay_room_sessions WHERE user_id = ? AND room_id = ?
 *
 * BEFORE any Matrix call. Missing row → ws.close(4404, "not found") —
 * SAME close code for BOTH "row not found" AND "user not a member" to
 * avoid an existence oracle (Security V8).
 *
 * ## Pitfall 4 correlation
 *
 * The frontend-generated `mqid` is passed VERBATIM as the Matrix `txnId`
 * on outbound sends (via Plan 03's sendMessageAsUser). This is the
 * correlation infrastructure Plan 06's optimistic-send matcher uses.
 *
 * ## Pitfall 8 friendly-error translation
 *
 * If the initial history fetch returns 403/404 (canonicalized to
 * `not_member` / `not_found` by matrix-message-fetch.ts), the server emits
 * an `inactive` frame + closes the WS cleanly. Frontend renders D-18
 * friendly error state (no crash, no infinite retry).
 *
 * ## W#9 participants-frame emission
 *
 * The server emits a `participants` frame:
 *   (a) On initial connect (after `session`, before `history_batch`).
 *   (b) On every membership-tick change — the per-room poll compares
 *       the joined-member set from the previous tick; on change,
 *       broadcasts a fresh `participants` frame carrying the FULL
 *       updated list to every subscriber for the room.
 * The classifier is the shared `participants-classifier.ts` helper that
 * Task 3's REST endpoint also imports (T-90-04-C1 consistency invariant).
 *
 * ## Rate limiting (T-90-04-D1)
 *
 * Per-user token bucket: 30 sends per 60s window. Exceeded →
 * `send_error { reason: 'rate_limited' }` without calling Matrix.
 *
 * ## Testability
 *
 * The WS-server binding + per-connection lifecycle live at the file
 * bottom (import-side-effect module). The frame-dispatch core is
 * exported as pure functions (`handleConnectToRoom`,
 * `handleFetchOlderRange`, `handleSendMessage`, `computeParticipantsFrame`)
 * that take injected deps (auth check, DB check, Matrix client, classifier)
 * and return the resulting server-side frames. Tests exercise the pure
 * core without spinning up a real WebSocketServer.
 */

import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { IncomingMessage } from "http";
import { AuthManager } from "../utils/auth-manager.js";
import { databaseLogger } from "../utils/logger.js";
import { db } from "../database/db/index.js";
import { users } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import { getRoomJoinedMembers } from "../matrix/matrix-admin-client.js";
import { fetchRoomHistory } from "./matrix-message-fetch.js";
import { sendRoomMessage } from "./matrix-message-send.js";
import {
  classifyParticipants,
  lookupHumansFromUsersTable,
  type ClassifiedParticipants,
  type ClassifyParticipantsDeps,
} from "./participants-classifier.js";

// ============================================================================
// PORT + CONSTANTS
// ============================================================================

/**
 * Dedicated WS server port. 30011 = claude-session, 30012 = fleet-status.
 * 30015 is the next free slot in the fleet's allocation scheme (skipping
 * 30013/30014 to leave room for peer subsystems).
 */
export const RELAY_ROOM_STREAM_PORT = 30015;

/** Rate limit — 30 sends per 60s window per user. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_SENDS = 30;

/** Initial history load size (matches pretty view's D-14 = 20). */
const INITIAL_HISTORY_COUNT = 20;

/**
 * Membership-tick poll interval. M5 fixup 2026-09-09: bumped 2s → 30s
 * now that H1 wired the tick. Membership changes are user-initiated
 * joins/leaves (order of hours-to-days); worst-case 30s badge-row
 * update lag is fine and saves 15x the `getRoomJoinedMembers` calls
 * the 2s cadence would generate against Synapse. Live inbound messages
 * still poll at `LIVE_EVENT_POLL_INTERVAL_MS` (2s) since those ARE the
 * primary UX signal.
 */
export const MEMBERSHIP_POLL_INTERVAL_MS = 30_000;

/**
 * Live-event tick poll interval. Faster than the membership tick because
 * inbound messages are the primary UX signal in a relay room — a 2s
 * worst-case lag matches the fleet's other WS-server poll cadences.
 * Uses the cheap `/messages` read cursor (H1 fixup); no `/sync` involvement.
 */
export const LIVE_EVENT_POLL_INTERVAL_MS = 2_000;

/**
 * Live-event tick batch size. Small enough to keep per-tick payloads
 * bounded even if a burst of messages arrives between ticks; large enough
 * to catch a typical group-chat burst without missing events across a
 * single tick's window.
 */
const LIVE_EVENT_POLL_BATCH_SIZE = 20;

// ============================================================================
// FRAME TYPES
// ============================================================================

/**
 * Client → server frame types.
 */
export type ConnectToRoomFrame = { type: "connectToRoom"; roomId: string };
export type FetchOlderRangeFrame = {
  type: "fetch_older_range";
  beforeEventId: string;
  count: number;
};
export type SendMessageFrame = {
  type: "send_message";
  body: string;
  txnId: string;
};
export type ClientFrame =
  | ConnectToRoomFrame
  | FetchOlderRangeFrame
  | SendMessageFrame;

/**
 * Server → client frame types.
 */
export type SessionFrame = {
  type: "session";
  roomId: string;
  roomTitle: string | null;
};
export type ParticipantsFrame = { type: "participants" } & ClassifiedParticipants;
export type HistoryBatchFrame = {
  type: "history_batch";
  events: unknown[];
  hasMore: boolean;
};
export type LiveEventFrame = { type: "live_event"; event: unknown };
export type SendAckFrame = {
  type: "send_ack";
  txnId: string;
  eventId: string;
};
export type SendErrorFrame = {
  type: "send_error";
  txnId: string;
  reason: string;
};
export type InactiveFrame = {
  type: "inactive";
  reason: "not_member" | "not_found";
};
export type ErrorFrame = { type: "error"; message: string };
export type ServerFrame =
  | SessionFrame
  | ParticipantsFrame
  | HistoryBatchFrame
  | LiveEventFrame
  | SendAckFrame
  | SendErrorFrame
  | InactiveFrame
  | ErrorFrame;

// ============================================================================
// PER-USER RATE LIMITER (T-90-04-D1)
// ============================================================================

/**
 * Simple sliding-window rate limiter. Each userId has a bounded array of
 * recent send timestamps; on each `send_message` frame, prune entries
 * older than RATE_LIMIT_WINDOW_MS, reject if the pruned list already
 * has RATE_LIMIT_MAX_SENDS entries, otherwise append.
 *
 * In-memory only (per-process). If skynet ever runs multi-process, this
 * needs Redis or similar — for now the fleet is a single-node deploy.
 */
const rateWindows = new Map<string, number[]>();

export function checkRateLimit(userId: string, now: number = Date.now()): boolean {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const window = rateWindows.get(userId) ?? [];
  const pruned = window.filter((ts) => ts > cutoff);
  if (pruned.length >= RATE_LIMIT_MAX_SENDS) {
    rateWindows.set(userId, pruned);
    return false;
  }
  pruned.push(now);
  rateWindows.set(userId, pruned);
  return true;
}

/** Test-only reset — clears all rate-limit windows. */
export function __resetRateLimiterForTests(): void {
  rateWindows.clear();
}

// ============================================================================
// ACCESS-CONTROL GATE (T-90-BE-02 — no existence oracle per Security V8)
// ============================================================================

/**
 * Verify the authenticated user owns the relay_room_sessions row for
 * the target room. Returns true if the row exists AND is owned by
 * this user; false otherwise. Callers translate false → close(4404) /
 * REST 404. Same status for both 'not found' and 'not owned' — no oracle.
 */
export interface AccessGateDeps {
  ownsRelayRoomSession: (userId: string, roomId: string) => boolean;
}

/**
 * Production access-gate check — direct SQL prepared statement. Mirrors
 * the SQL literal named in the plan's threat_model (T-90-BE-02).
 */
export function ownsRelayRoomSession(userId: string, roomId: string): boolean {
  // SELECT id FROM relay_room_sessions WHERE user_id = ? AND room_id = ?
  // (schema-as-coordinator per Phase 89 D-14; row is authoritative.)
  const row = db.$client
    .prepare(
      `SELECT id FROM relay_room_sessions WHERE user_id = ? AND room_id = ?`,
    )
    .get(userId, roomId) as { id?: string } | undefined;
  return row !== undefined && typeof row.id === "string";
}

// ============================================================================
// USER MXID LOOKUP (backend-authoritative — never trust WS frames)
// ============================================================================

export interface LookupUserMxidDeps {
  lookupUserMxid: (userId: string) => Promise<string | null>;
}

/**
 * Production lookup — reads users.mxid via Drizzle. Returns null if the
 * user has no mxid (pre-Phase-88 accounts) — the WS server rejects sends
 * with a `send_error { reason: 'no_mxid' }` in that case.
 */
export async function lookupUserMxid(userId: string): Promise<string | null> {
  try {
    const rows = (await db
      .select({ mxid: users.mxid })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)) as Array<{ mxid: string | null }>;
    const row = rows[0];
    if (row === undefined) return null;
    return typeof row.mxid === "string" && row.mxid.length > 0 ? row.mxid : null;
  } catch (err) {
    databaseLogger.warn(
      "relay-room-stream: lookupUserMxid failed",
      {
        operation: "relay_room_stream_lookup_user_mxid_failed",
        userId,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return null;
  }
}

// ============================================================================
// ROOM TITLE LOOKUP (from relay_room_sessions.room_title)
// ============================================================================

export interface LookupRoomTitleDeps {
  lookupRoomTitle: (userId: string, roomId: string) => string | null;
}

/**
 * Read `room_title` from the caller's owned relay_room_sessions row. This
 * is the same source the sidebar reads via `/sessions/list`, so the
 * `session` frame's roomTitle matches what the user clicked on.
 */
export function lookupRoomTitle(userId: string, roomId: string): string | null {
  const row = db.$client
    .prepare(
      `SELECT room_title AS roomTitle FROM relay_room_sessions
        WHERE user_id = ? AND room_id = ?`,
    )
    .get(userId, roomId) as { roomTitle?: string | null } | undefined;
  if (row === undefined) return null;
  return typeof row.roomTitle === "string" ? row.roomTitle : null;
}

// ============================================================================
// PARTICIPANTS FRAME COMPUTATION (W#9 — shared classifier)
// ============================================================================

export interface ComputeParticipantsDeps {
  fetchMembers: (roomId: string) => Promise<
    | { ok: true; memberMxids: string[] }
    | { ok: false; status: number; error: string }
  >;
  classifierDeps: ClassifyParticipantsDeps;
}

/**
 * Compute the participants frame payload for a room. On membership-fetch
 * failure, returns null so the caller can decide what to do (usually
 * skip the emission and let the next tick retry).
 */
export async function computeParticipantsFrame(
  roomId: string,
  deps: ComputeParticipantsDeps,
): Promise<ParticipantsFrame | null> {
  const withSet = await computeParticipantsFrameWithMemberSet(roomId, deps);
  return withSet === null ? null : withSet.frame;
}

/**
 * Same as `computeParticipantsFrame` but also returns the raw joined-member
 * set so callers wiring the membership tick can seed `lastMemberSet` without
 * re-fetching. Introduced by H1 wire-up (2026-09-09) — the WS-server needs
 * both the frame (to send now) and the set (to seed the tick).
 */
export async function computeParticipantsFrameWithMemberSet(
  roomId: string,
  deps: ComputeParticipantsDeps,
): Promise<{ frame: ParticipantsFrame; memberSet: Set<string> } | null> {
  const members = await deps.fetchMembers(roomId);
  if (members.ok === false) {
    return null;
  }
  const classified = await classifyParticipants(
    members.memberMxids,
    deps.classifierDeps,
  );
  return {
    frame: { type: "participants", ...classified },
    memberSet: new Set<string>(members.memberMxids),
  };
}

// ============================================================================
// FRAME DISPATCH — pure core (testable without WebSocketServer)
// ============================================================================

/**
 * Combined per-connection auth context.
 */
export interface WsAuthContext {
  userId: string;
  mxid: string | null;
}

/**
 * All deps for the connectToRoom handler. Injectable for tests.
 *
 * `fetchInitialHistory` returns an `endToken` on the ok path — the Matrix
 * `end` cursor from the backward-pagination response, which becomes the
 * forward-pagination `from` cursor the live-event tick uses to seed its
 * subscription. May be null when the initial batch is empty (D-17
 * empty-room state) — the live-event tick short-circuits until a later
 * seed lands.
 */
export interface HandleConnectToRoomDeps
  extends AccessGateDeps,
    LookupRoomTitleDeps,
    ComputeParticipantsDeps {
  fetchInitialHistory: (
    roomId: string,
  ) => Promise<
    | {
        ok: true;
        events: unknown[];
        hasMore: boolean;
        endToken: string | null;
      }
    | { ok: false; status: number; error: string }
  >;
}

/**
 * connectToRoom outcome — a sequence of frames to emit, plus an optional
 * close directive. The WS-server wrapper writes each frame then applies
 * the close if present.
 *
 * `subscription` carries the seed data (initial member set + since token)
 * the WS-server wrapper needs to register the connection into the
 * per-room subscription state. Undefined when the connect terminates
 * before the subscription should be registered (access denied, inactive
 * frame + close).
 */
export type ConnectToRoomOutcome = {
  frames: ServerFrame[];
  close?: { code: number; reason: string };
  subscription?: {
    initialMemberSet: Set<string>;
    initialSinceToken: string | null;
  };
};

/**
 * Dispatch the `connectToRoom` frame. Emits (on happy path):
 *   1. session frame (roomId, roomTitle)
 *   2. participants frame (W#9 initial)
 *   3. history_batch frame (initial 20 events)
 *
 * On access-gate failure: single close(4404). No participants/history
 * emitted (would leak roomTitle to a non-member).
 *
 * On initial-history 403/404: emits `inactive` frame + closes cleanly
 * (Pitfall 8 / D-18).
 */
export async function handleConnectToRoom(
  auth: WsAuthContext,
  frame: ConnectToRoomFrame,
  deps: HandleConnectToRoomDeps,
): Promise<ConnectToRoomOutcome> {
  const { userId } = auth;
  const { roomId } = frame;

  // Access-control gate (T-90-BE-02). Same close for both no-row + not-owner.
  if (!deps.ownsRelayRoomSession(userId, roomId)) {
    databaseLogger.info("relay_room_stream access denied", {
      operation: "relay_room_stream_access_denied",
      userId,
      roomId,
    });
    return { frames: [], close: { code: 4404, reason: "not found" } };
  }

  const roomTitle = deps.lookupRoomTitle(userId, roomId);
  const outcome: ConnectToRoomOutcome = {
    frames: [{ type: "session", roomId, roomTitle }],
  };

  // W#9 initial participants frame + membership seed for the tick.
  const participantsResult = await computeParticipantsFrameWithMemberSet(
    roomId,
    deps,
  );
  let initialMemberSet: Set<string> = new Set();
  if (participantsResult !== null) {
    outcome.frames.push(participantsResult.frame);
    initialMemberSet = participantsResult.memberSet;
  }
  // If participants fetch failed, don't fail the whole connect — the
  // periodic membership tick will retry. lastMemberSet stays empty; the
  // tick's first successful fetch will emit a fresh frame.

  // Initial history load.
  const history = await deps.fetchInitialHistory(roomId);
  if (history.ok === false) {
    // Pitfall 8 / D-18: 403/404 → inactive frame + clean close.
    if (history.error === "not_member" || history.error === "not_found") {
      outcome.frames.push({ type: "inactive", reason: history.error });
      outcome.close = { code: 1000, reason: "inactive" };
      return outcome;
    }
    // Other errors — emit an error frame but keep the connection open;
    // frontend can decide whether to retry.
    outcome.frames.push({
      type: "error",
      message: `history_fetch_failed:${history.error}`,
    });
    // Register the subscription anyway (no cursor yet — the live-event
    // tick short-circuits on null until a future connect seeds it, and
    // the membership tick doesn't depend on the cursor).
    outcome.subscription = {
      initialMemberSet,
      initialSinceToken: null,
    };
    return outcome;
  }

  outcome.frames.push({
    type: "history_batch",
    events: history.events,
    hasMore: history.hasMore,
  });

  // Wire the subscription seed — the WS-server uses this to register the
  // per-connection emit closure into the per-room tick driver.
  outcome.subscription = {
    initialMemberSet,
    initialSinceToken: history.endToken,
  };

  databaseLogger.info("relay_room_stream connect ok", {
    operation: "relay_room_stream_connect_ok",
    userId,
    roomId,
    historyCount: history.events.length,
    hasSinceToken: history.endToken !== null,
  });

  return outcome;
}

/**
 * Deps for handleFetchOlderRange.
 */
export interface HandleFetchOlderDeps extends AccessGateDeps {
  fetchOlder: (
    roomId: string,
    beforeEventId: string,
    count: number,
  ) => Promise<
    | { ok: true; events: unknown[]; hasMore: boolean }
    | { ok: false; status: number; error: string }
  >;
}

/**
 * Dispatch the `fetch_older_range` frame. Emits history_batch on
 * success, error on failure. Access-gate check per T-90-BE-02.
 */
export async function handleFetchOlderRange(
  auth: WsAuthContext,
  roomId: string,
  frame: FetchOlderRangeFrame,
  deps: HandleFetchOlderDeps,
): Promise<ServerFrame[]> {
  if (!deps.ownsRelayRoomSession(auth.userId, roomId)) {
    // Same-status no-oracle — respond with an error frame instead of
    // closing (the connection may already be past connect; closing here
    // would tell the browser something changed since connect).
    return [{ type: "error", message: "not_found" }];
  }

  const result = await deps.fetchOlder(roomId, frame.beforeEventId, frame.count);
  if (result.ok === false) {
    if (result.error === "not_member" || result.error === "not_found") {
      return [{ type: "inactive", reason: result.error }];
    }
    return [{ type: "error", message: `fetch_older_failed:${result.error}` }];
  }
  return [
    { type: "history_batch", events: result.events, hasMore: result.hasMore },
  ];
}

/**
 * Deps for handleSendMessage.
 */
export interface HandleSendMessageDeps extends AccessGateDeps {
  send: (
    senderMxid: string,
    roomId: string,
    body: string,
    txnId: string,
  ) => Promise<
    | { ok: true; eventId: string }
    | { ok: false; status: number; error: string }
  >;
  checkRate: (userId: string) => boolean;
}

/**
 * Dispatch the `send_message` frame. Rate-limits per-user; access-gates
 * per T-90-BE-02; sends via matrix-message-send (with the caller's own
 * mxid — NEVER a mxid from the WS frame).
 */
export async function handleSendMessage(
  auth: WsAuthContext,
  roomId: string,
  frame: SendMessageFrame,
  deps: HandleSendMessageDeps,
): Promise<ServerFrame[]> {
  const { txnId } = frame;

  // Rate-limit BEFORE access-gate — a user who has already sent 30 msgs
  // this window shouldn't be able to probe access via a burst.
  if (!deps.checkRate(auth.userId)) {
    return [{ type: "send_error", txnId, reason: "rate_limited" }];
  }

  if (!deps.ownsRelayRoomSession(auth.userId, roomId)) {
    return [{ type: "send_error", txnId, reason: "not_found" }];
  }

  if (auth.mxid === null) {
    // Pre-Phase-88 user with no mxid — can't send.
    return [{ type: "send_error", txnId, reason: "no_mxid" }];
  }

  const result = await deps.send(auth.mxid, roomId, frame.body, txnId);
  if (result.ok === false) {
    // Map primitive errors to send_error reasons the frontend can render.
    let reason = result.error;
    if (result.status === 502) reason = "proxy";
    if (result.status === 504) reason = "timeout";
    return [{ type: "send_error", txnId, reason }];
  }

  return [{ type: "send_ack", txnId, eventId: result.eventId }];
}

// ============================================================================
// FRAME VALIDATION (parse-then-dispatch)
// ============================================================================

/**
 * Narrow an incoming raw WS frame to a typed ClientFrame. Returns null
 * on protocol violation; the caller emits an `error` frame + closes.
 */
export function parseClientFrame(raw: unknown): ClientFrame | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as { type?: unknown };
  if (typeof obj.type !== "string") return null;

  if (obj.type === "connectToRoom") {
    const f = obj as { roomId?: unknown };
    if (typeof f.roomId !== "string" || f.roomId.length === 0) return null;
    return { type: "connectToRoom", roomId: f.roomId };
  }

  if (obj.type === "fetch_older_range") {
    const f = obj as { beforeEventId?: unknown; count?: unknown };
    if (typeof f.beforeEventId !== "string" || f.beforeEventId.length === 0) {
      return null;
    }
    if (typeof f.count !== "number" || !Number.isInteger(f.count) || f.count <= 0) {
      return null;
    }
    return {
      type: "fetch_older_range",
      beforeEventId: f.beforeEventId,
      count: f.count,
    };
  }

  if (obj.type === "send_message") {
    const f = obj as { body?: unknown; txnId?: unknown };
    if (typeof f.body !== "string") return null;
    if (typeof f.txnId !== "string" || f.txnId.length === 0) return null;
    return { type: "send_message", body: f.body, txnId: f.txnId };
  }

  return null;
}

// ============================================================================
// MEMBERSHIP-TICK POLL (W#9 — participants-on-change)
// ============================================================================

/**
 * Per-room subscription state. Coalesces multiple WS connections for the
 * same room so the membership poll + live-event poll each run ONCE per
 * room per tick regardless of how many browsers are open.
 *
 * H1 wire-up (2026-09-09):
 *   - `subscribers` — every WS's frame-emit closure. Registered on
 *     handleConnectToRoom success, deregistered on ws.on('close').
 *   - `lastMemberSet` — carried across membership ticks so we only emit
 *     `participants` frames on change (not on every tick).
 *   - `sinceToken` — Matrix `/messages?dir=f&from=<token>` cursor for the
 *     live-event tick. Seeded from the initial-history `end` token so we
 *     don't re-broadcast the initial batch back through `live_event`.
 *   - `membershipTimer` / `liveEventTimer` — cleared when the last
 *     subscriber closes so an idle room drops all timers.
 */
interface RoomSubscription {
  subscribers: Set<(frame: ServerFrame) => void>;
  lastMemberSet: Set<string>;
  sinceToken: string | null;
  membershipTimer: NodeJS.Timeout | null;
  liveEventTimer: NodeJS.Timeout | null;
}

const roomSubscriptions = new Map<string, RoomSubscription>();

/**
 * Compare two Sets for equality — order-independent.
 */
export function memberSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const m of a) {
    if (!b.has(m)) return false;
  }
  return true;
}

/**
 * Deps for one membership-tick iteration. Injectable for tests.
 */
export interface MembershipTickDeps extends ComputeParticipantsDeps {}

/**
 * Run ONE membership tick for a room. If the joined-member set has
 * changed since last tick, computes a fresh participants frame and
 * returns it (for broadcast to every subscriber). Otherwise returns null.
 *
 * Pure function — the caller wires the broadcast. Testable without a
 * real WS server.
 */
export async function runMembershipTick(
  roomId: string,
  lastMemberSet: Set<string>,
  deps: MembershipTickDeps,
): Promise<{
  nextMemberSet: Set<string>;
  frame: ParticipantsFrame | null;
}> {
  const members = await deps.fetchMembers(roomId);
  if (members.ok === false) {
    // Preserve the previous set — a transient fetch failure shouldn't
    // spuriously invalidate our prior view.
    return { nextMemberSet: lastMemberSet, frame: null };
  }
  const nextMemberSet = new Set<string>(members.memberMxids);
  if (memberSetsEqual(nextMemberSet, lastMemberSet)) {
    return { nextMemberSet, frame: null };
  }
  const classified = await classifyParticipants(
    members.memberMxids,
    deps.classifierDeps,
  );
  return {
    nextMemberSet,
    frame: { type: "participants", ...classified },
  };
}

// ============================================================================
// LIVE-EVENT TICK (H1 wire-up — inbound message subscription)
// ============================================================================

/**
 * Deps for one live-event tick iteration. Injectable for tests.
 * `fetchLive` mirrors `fetchInitialHistory` / `fetchOlder` but is called with
 * dir=f and the room's `sinceToken` cursor so we get only NEW events since
 * the last tick (or the initial history's end).
 */
export interface LiveEventTickDeps {
  fetchLive: (
    roomId: string,
    sinceToken: string,
    count: number,
  ) => Promise<
    | { ok: true; events: unknown[]; nextSinceToken: string | null }
    | { ok: false; status: number; error: string }
  >;
}

/**
 * Run ONE live-event tick for a room. Returns any new events plus the
 * updated cursor. Pure — caller drives the broadcast.
 *
 * The sinceToken lifecycle:
 *   - Seed at connect time from initial-history's `end` token (backward
 *     pagination's `end` = the newest boundary, which becomes forward
 *     pagination's `from`).
 *   - After each tick, advance to the returned `nextSinceToken` (Matrix's
 *     `end` from a dir=f response = the newest cursor we've observed).
 *   - On fetch failure, preserve the previous token so the next tick retries
 *     from the same cursor (matches runMembershipTick's transient-failure
 *     discipline).
 *
 * `sinceToken === null` on entry means "no cursor yet" — the tick is a
 * no-op in that case since we have nothing to poll from. The caller should
 * only invoke this tick once a cursor is seeded.
 */
export async function runLiveEventTick(
  roomId: string,
  sinceToken: string | null,
  deps: LiveEventTickDeps,
): Promise<{
  nextSinceToken: string | null;
  events: unknown[];
}> {
  if (sinceToken === null) {
    return { nextSinceToken: null, events: [] };
  }
  const result = await deps.fetchLive(
    roomId,
    sinceToken,
    LIVE_EVENT_POLL_BATCH_SIZE,
  );
  if (result.ok === false) {
    // Transient failure — preserve the cursor so the next tick retries.
    return { nextSinceToken: sinceToken, events: [] };
  }
  return {
    nextSinceToken: result.nextSinceToken,
    events: result.events,
  };
}

/** Test-only reset — clears all room subscriptions and their timers. */
export function __resetRoomSubscriptionsForTests(): void {
  for (const sub of roomSubscriptions.values()) {
    if (sub.membershipTimer !== null) clearInterval(sub.membershipTimer);
    if (sub.liveEventTimer !== null) clearInterval(sub.liveEventTimer);
  }
  roomSubscriptions.clear();
}

/**
 * Test-only accessor — returns the current subscription for a room, or
 * `undefined` when none. Exposed so tests can assert subscriber-set size
 * + timer lifecycle without depending on the module-scoped Map.
 */
export function __getRoomSubscriptionForTests(
  roomId: string,
): RoomSubscription | undefined {
  return roomSubscriptions.get(roomId);
}

// ============================================================================
// SUBSCRIBER LIFECYCLE (H1 wire-up)
// ============================================================================

/**
 * Deps for the per-room tick driver. Combines the membership + live-event
 * dep sets so a single subscription entry drives both timers.
 */
export interface RoomTickDeps extends MembershipTickDeps, LiveEventTickDeps {}

/**
 * Register a subscriber for a room. On first subscriber, seeds the
 * membership + live-event timers with the given cadence. Idempotent per
 * `(roomId, emit)` — the same emit closure won't be added twice.
 *
 * `initialSinceToken` seeds the live-event cursor. Caller (handleConnect)
 * passes the `end` token from the initial history batch.
 * `initialMemberSet` seeds the membership tick.
 *
 * Returns a `dispose()` closure that the WS's `on('close')` should invoke
 * — deregisters the subscriber and, if it was the last one, clears both
 * timers so an idle room drops all polling.
 */
export function subscribeRoom(
  roomId: string,
  emit: (frame: ServerFrame) => void,
  initialSinceToken: string | null,
  initialMemberSet: Set<string>,
  deps: RoomTickDeps,
  intervals: {
    membershipMs?: number;
    liveEventMs?: number;
  } = {},
): () => void {
  const membershipMs = intervals.membershipMs ?? MEMBERSHIP_POLL_INTERVAL_MS;
  const liveEventMs = intervals.liveEventMs ?? LIVE_EVENT_POLL_INTERVAL_MS;

  let sub = roomSubscriptions.get(roomId);
  if (sub === undefined) {
    sub = {
      subscribers: new Set(),
      lastMemberSet: initialMemberSet,
      sinceToken: initialSinceToken,
      membershipTimer: null,
      liveEventTimer: null,
    };
    roomSubscriptions.set(roomId, sub);
  } else if (sub.sinceToken === null && initialSinceToken !== null) {
    // A previously-seeded subscription may have missed its cursor if the
    // first connect's initial history was empty. Newer connect can seed it.
    sub.sinceToken = initialSinceToken;
  }
  const subscription = sub;
  subscription.subscribers.add(emit);

  // Boot the timers on the first subscriber (or after a full drop).
  if (subscription.membershipTimer === null) {
    subscription.membershipTimer = setInterval(() => {
      void (async () => {
        try {
          const result = await runMembershipTick(
            roomId,
            subscription.lastMemberSet,
            deps,
          );
          subscription.lastMemberSet = result.nextMemberSet;
          if (result.frame !== null) {
            for (const s of subscription.subscribers) {
              try {
                s(result.frame);
              } catch (err) {
                databaseLogger.warn(
                  "relay_room_stream membership emit failed",
                  {
                    operation: "relay_room_stream_membership_emit_failed",
                    roomId,
                    error: err instanceof Error ? err.message : "unknown",
                  },
                );
              }
            }
          }
        } catch (err) {
          databaseLogger.warn("relay_room_stream membership tick failed", {
            operation: "relay_room_stream_membership_tick_failed",
            roomId,
            error: err instanceof Error ? err.message : "unknown",
          });
        }
      })();
    }, membershipMs);
  }
  if (subscription.liveEventTimer === null) {
    subscription.liveEventTimer = setInterval(() => {
      void (async () => {
        try {
          const result = await runLiveEventTick(
            roomId,
            subscription.sinceToken,
            deps,
          );
          subscription.sinceToken = result.nextSinceToken;
          if (result.events.length > 0) {
            for (const event of result.events) {
              const frame: LiveEventFrame = { type: "live_event", event };
              for (const s of subscription.subscribers) {
                try {
                  s(frame);
                } catch (err) {
                  databaseLogger.warn(
                    "relay_room_stream live_event emit failed",
                    {
                      operation: "relay_room_stream_live_event_emit_failed",
                      roomId,
                      error: err instanceof Error ? err.message : "unknown",
                    },
                  );
                }
              }
            }
          }
        } catch (err) {
          databaseLogger.warn("relay_room_stream live-event tick failed", {
            operation: "relay_room_stream_live_event_tick_failed",
            roomId,
            error: err instanceof Error ? err.message : "unknown",
          });
        }
      })();
    }, liveEventMs);
  }

  return function dispose(): void {
    subscription.subscribers.delete(emit);
    if (subscription.subscribers.size === 0) {
      if (subscription.membershipTimer !== null) {
        clearInterval(subscription.membershipTimer);
        subscription.membershipTimer = null;
      }
      if (subscription.liveEventTimer !== null) {
        clearInterval(subscription.liveEventTimer);
        subscription.liveEventTimer = null;
      }
      roomSubscriptions.delete(roomId);
    }
  };
}

// ============================================================================
// LIVE WS SERVER (module-scope side-effect at bottom)
// ============================================================================

/**
 * Extract the JWT from the upgrade request. Cookie-first (production
 * path), Bearer-second, URL-query-token last. Mirrors claude-session-server
 * L3572-3596 shape. NEVER accept a userId or mxid from URL/query — those
 * fields are for auth-material only (Security V2 session-fixation defense).
 */
function extractJwt(req: IncomingMessage): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)jwt=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }
  const urlObj = new URL(req.url ?? "", "http://localhost");
  const qp = urlObj.searchParams.get("token");
  if (qp) return qp;
  return undefined;
}

/**
 * Build the production deps object for the connect/fetch/send/tick
 * handlers. Composed once at module load; testable seams live in the
 * pure exports above.
 *
 * Exported so scoped tests can exercise the composition layer's small but
 * load-bearing decisions (M2 `hasMore` = "batch came back full", H1
 * `fetchLive` dir=f wiring, sinceToken carry-forward) without spinning
 * up a real WebSocketServer. Not part of the public API surface.
 */
export function makeProductionDeps() {
  const classifierDeps: ClassifyParticipantsDeps = {
    lookupHumans: lookupHumansFromUsersTable,
  };
  const fetchMembers: ComputeParticipantsDeps["fetchMembers"] = async (
    roomId,
  ) => {
    const result = await getRoomJoinedMembers(roomId);
    if (result.ok === false) return result;
    return { ok: true, memberMxids: result.memberMxids };
  };
  return {
    ownsRelayRoomSession,
    lookupRoomTitle,
    fetchMembers,
    classifierDeps,
    fetchInitialHistory: async (roomId: string) => {
      const result = await fetchRoomHistory(roomId, {
        dir: "b",
        count: INITIAL_HISTORY_COUNT,
      });
      if (result.ok === false) return result;
      return {
        ok: true as const,
        events: result.events,
        // M2 fixup: `hasMore` reflects "batch came back full" (not "Matrix
        // returned an `end` cursor") — Matrix returns `end` even on empty
        // start-of-history chunks, which used to render an infinite
        // "load older" button.
        hasMore: result.events.length === INITIAL_HISTORY_COUNT,
        // H1 wire-up: expose the `end` cursor so the live-event tick can
        // seed its forward-pagination `from` from the same boundary the
        // initial backward-history returned. Null when Matrix omits `end`
        // (D-17 empty-room state).
        endToken: typeof result.end === "string" ? result.end : null,
      };
    },
    fetchOlder: async (roomId: string, beforeEventId: string, count: number) => {
      const result = await fetchRoomHistory(roomId, {
        dir: "b",
        beforeEventId,
        count,
      });
      if (result.ok === false) return result;
      return {
        ok: true as const,
        events: result.events,
        // M2 fixup: same "batch came back full" discipline as
        // fetchInitialHistory (see the sibling comment above).
        hasMore: result.events.length === count,
      };
    },
    // H1 wire-up: forward-paging live-event fetch. Uses the same
    // fetchRoomHistory helper but with dir=f so we get NEW events since
    // the `sinceToken` cursor. `nextSinceToken` = the response's `end`
    // (dir=f advances forward). Null when Matrix omits `end` (nothing new
    // to advance to; keep polling from the same cursor).
    fetchLive: async (roomId: string, sinceToken: string, count: number) => {
      const result = await fetchRoomHistory(roomId, {
        dir: "f",
        beforeEventId: sinceToken,
        count,
      });
      if (result.ok === false) return result;
      return {
        ok: true as const,
        events: result.events,
        nextSinceToken: typeof result.end === "string" ? result.end : null,
      };
    },
    send: sendRoomMessage,
    checkRate: (userId: string) => checkRateLimit(userId),
  };
}

/**
 * Bind the WebSocketServer to RELAY_ROOM_STREAM_PORT. Guarded by the
 * NODE_ENV/VITEST check so importing this module in a test does NOT
 * spin up a real listener.
 */
function startWebSocketServer(): void {
  const authManager = AuthManager.getInstance();
  const deps = makeProductionDeps();

  const wss = new WebSocketServer({ port: RELAY_ROOM_STREAM_PORT });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    // ─── JWT auth on upgrade ───────────────────────────────────────────
    const token = extractJwt(req);
    if (!token) {
      ws.close(1008, "Authentication required");
      return;
    }
    let userId: string;
    try {
      const payload = await authManager.verifyJWTToken(token);
      if (!payload?.userId || payload.pendingTOTP) {
        ws.close(1008, "Authentication required");
        return;
      }
      userId = payload.userId;
    } catch (err) {
      databaseLogger.warn("relay_room_stream JWT verification failed", {
        operation: "relay_room_stream_jwt_verify_failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      ws.close(1008, "Authentication required");
      return;
    }

    const mxid = await lookupUserMxid(userId);
    const auth: WsAuthContext = { userId, mxid };

    databaseLogger.info("relay_room_stream ws connect", {
      operation: "relay_room_stream_ws_connect",
      userId,
    });

    // Per-connection state.
    let boundRoomId: string | null = null;
    // H1 wire-up: dispose closure from subscribeRoom. Called on ws close
    // to deregister this connection from the per-room tick driver and,
    // if it was the last subscriber, tear down the timers.
    let disposeSubscription: (() => void) | null = null;

    /**
     * Per-connection frame emitter — the closure passed into subscribeRoom.
     * Wraps ws.send with the same try/catch as the request-response paths
     * so a mid-close ws doesn't throw out of the tick callback.
     */
    const emit = (frame: ServerFrame): void => {
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        /* ws may be mid-close */
      }
    };

    ws.on("message", async (raw: RawData) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        try {
          ws.send(JSON.stringify({ type: "error", message: "invalid_json" }));
        } catch {
          /* ws may be mid-close */
        }
        return;
      }
      const frame = parseClientFrame(parsed);
      if (frame === null) {
        try {
          ws.send(JSON.stringify({ type: "error", message: "invalid_frame" }));
        } catch {
          /* ws may be mid-close */
        }
        return;
      }

      if (frame.type === "connectToRoom") {
        boundRoomId = frame.roomId;
        const outcome = await handleConnectToRoom(auth, frame, deps);
        for (const f of outcome.frames) {
          emit(f);
        }
        // H1: register the subscription BEFORE the (optional) close so a
        // closing outcome (inactive frame) doesn't leak a subscription.
        if (
          outcome.close === undefined &&
          outcome.subscription !== undefined &&
          disposeSubscription === null
        ) {
          disposeSubscription = subscribeRoom(
            boundRoomId,
            emit,
            outcome.subscription.initialSinceToken,
            outcome.subscription.initialMemberSet,
            deps,
          );
        }
        if (outcome.close !== undefined) {
          ws.close(outcome.close.code, outcome.close.reason);
        }
        return;
      }

      if (boundRoomId === null) {
        try {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "connect_first",
            }),
          );
        } catch {
          /* ws may be mid-close */
        }
        return;
      }

      let outFrames: ServerFrame[] = [];
      if (frame.type === "fetch_older_range") {
        outFrames = await handleFetchOlderRange(auth, boundRoomId, frame, deps);
      } else if (frame.type === "send_message") {
        outFrames = await handleSendMessage(auth, boundRoomId, frame, deps);
      }
      for (const f of outFrames) {
        emit(f);
      }
    });

    ws.on("close", () => {
      // H1: deregister from the tick driver. dispose is idempotent and
      // clears the timers when this was the last subscriber.
      if (disposeSubscription !== null) {
        try {
          disposeSubscription();
        } catch (err) {
          databaseLogger.warn(
            "relay_room_stream dispose subscription failed",
            {
              operation: "relay_room_stream_dispose_subscription_failed",
              userId,
              error: err instanceof Error ? err.message : "unknown",
            },
          );
        }
        disposeSubscription = null;
      }
      databaseLogger.info("relay_room_stream ws close", {
        operation: "relay_room_stream_ws_close",
        userId,
      });
    });
  });

  // L5 fixup: WSS-level error handler. Node's default is to raise
  // 'uncaughtException' on unhandled 'error' events → process crash.
  // Match the pattern used by other fleet WS servers.
  wss.on("error", (err) => {
    databaseLogger.error("relay_room_stream_wss_error", err, {
      operation: "relay_room_stream_wss_error",
    });
  });

  databaseLogger.info("relay-room-stream WebSocket server listening", {
    operation: "relay_room_stream_ws_listen",
    port: RELAY_ROOM_STREAM_PORT,
  });
}

// Only start the server when actually running as a backend process (not
// during test import). Vitest sets `VITEST` in the environment.
if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") {
  startWebSocketServer();
}
