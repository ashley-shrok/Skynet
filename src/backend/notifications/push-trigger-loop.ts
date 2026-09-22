/**
 * Phase 128 Plan 06 Task 1 — push-trigger-loop.
 *
 * The per-user always-on live-event pump. This is the LOAD-BEARING trigger
 * for every push notification the phase delivers — without this loop, all
 * the plumbing built in Wave 1 (vapid-config, push-sender, service worker
 * handlers, subscription route) has no way to fire.
 *
 * ## Why a new loop (not "bolt onto observation-loop")
 *
 * Skynet's existing observation-loop polls at 10s cadence per user; that
 * cadence is fine for "reconcile joined_rooms into relay_room_sessions"
 * but WAY too slow for the "you just got pinged" push signal. This loop
 * polls at LIVE_EVENT_POLL_INTERVAL_MS = 2s per user, mirroring the
 * relay-room-stream-server's fetchLive cadence. Concerns are cleanly
 * separated: observation-loop reconciles DB, push-trigger-loop dispatches
 * events. Both share `classifyRoom` (D-02), user enumeration (users WHERE
 * mxid IS NOT NULL), and the observation-loop's proven scheduler shape
 * (backoff ladder + in-flight guard + thundering-herd jitter).
 *
 * ## Design invariants (D-01..D-05)
 *
 * - D-01 per-event shape check: every event flows through `classifyRoom`
 *   at the moment of firing — we do NOT rely on any cached "is this room
 *   a DM" bit on the room-session row.
 * - D-02 classifier reuse: `classifyRoom` is called for every event that
 *   passes the earlier filter steps. Room-shape logic is NEVER re-derived
 *   in this file — the classifier is the single source of truth.
 * - D-03 per-event, not per-pair: fresh classifier lookup every time.
 *   Robustness beats efficiency here — if an agent uses a second DM room
 *   by mistake, notifications still land.
 * - D-04 only new agent-originated messages: four-step filter pipeline
 *   rejects (a) non-m.room.message events, (b) self-sent, (c) edits
 *   (m.relates_to.rel_type === "m.replace"), (d) non-harness_dm rooms.
 * - D-05 honored-by-absence: this loop does NOT check whether the app is
 *   currently displaying the target room. D-05 explicitly marks that as
 *   best-effort/soft-signal; no plan implements it in v1.
 *
 * ## Cold-start policy (T-128-29 mitigation)
 *
 * On the FIRST tick for a room (empty cursor), we issue a `dir:"b",
 * limit:1` fetch via `fetchInitialCursor` and seed our forward cursor
 * with the returned `end` token — the room's CURRENT head. NO events
 * are dispatched on cold-start. Second tick onward uses fetchLive
 * (dir=f) from that anchored cursor for normal filter+dispatch flow.
 *
 * Why the extra hop (M-1 review fix): a `dir:"f"` fetch with no `from`
 * cursor starts from the room's HISTORICAL start, not the head. If we
 * used its returned `end` as the "current head", subsequent forward
 * polls would replay every historical message in every DM room as fresh
 * pushes — a boot-time push storm exactly what T-128-29 documented.
 * The backward-fetch pattern is the proven anchor idiom from
 * relay-room-stream-server.ts:1102-1120's fetchInitialHistory.
 *
 * ## Scheduler shape
 *
 * Mirrors `createObservationLoop` from observation-loop.ts:590-784:
 *   - PerUserState { userMxid, nextRunAt, backoffIndex, inFlight,
 *     cursorByRoom } — same shape, ADD cursorByRoom for Matrix cursors.
 *   - start(users) seeds each user with a jittered initial delay in
 *     [0, PUSH_TRIGGER_INITIAL_JITTER_MS).
 *   - scanTick iterates users; if !inFlight AND nextRunAt <= now, mark
 *     inFlight and dispatch runPushTriggerTick.
 *   - scheduleNext(ok=true) resets backoff + applies ±20% jitter for the
 *     next tick's delay; ok=false advances the backoff ladder.
 *   - stop() clears the map and cancels the scan timer.
 *
 * ## Never-throw contract
 *
 * runPushTriggerTick MUST NOT throw to the scheduler. Every I/O primitive
 * that could fail is caught locally; sendPushToUser failures are absorbed
 * to .warn (dropping a push is preferable to re-firing on next tick from
 * the same cursor, which would spam pushes for the same event). The
 * scheduler has a defense-in-depth catch mirroring observation-loop.ts:
 * 714-724 for contract violations.
 *
 * ## Deps injection
 *
 * Every I/O primitive is a field on PushTriggerLoopDeps. The boot-time
 * starter (Task 2) wires the concrete implementations; tests inject
 * vi.fn() stubs directly.
 */

import { databaseLogger } from "../utils/logger.js";
import { assertNotOk } from "../matrix/matrix-admin-narrow.js";
import type {
  ClassifyRoomInput,
  ClassifyResult,
} from "../relay-sessions/observation-loop-classifier.js";

// ---------------------------------------------------------------------------
// Cadence + jitter + backoff constants
//
// Constants are re-declared locally rather than imported from
// relay-room-stream-server.ts (LIVE_EVENT_POLL_INTERVAL_MS) or
// observation-loop.ts (INITIAL_TICK_JITTER_MS + BACKOFF_LADDER_MS) so this
// module can evolve its cadence policy independently. Comments name the
// source pattern.
// ---------------------------------------------------------------------------

/**
 * Per-user cadence for the live-event pump. Matches
 * `LIVE_EVENT_POLL_INTERVAL_MS` in relay-room-stream-server.ts:122 — 2s
 * gives responsive "just got pinged" feel without hammering Synapse
 * (fleet math: ~100 users × 1 poll/2s = 50 req/s admin API budget).
 */
export const PUSH_TRIGGER_POLL_INTERVAL_MS = 2_000;

/**
 * Batch size for fetchLive per room per tick. Matches
 * `LIVE_EVENT_POLL_BATCH_SIZE` in relay-room-stream-server.ts:130 — small
 * enough to keep per-tick payloads bounded even under burst, large enough
 * to catch a typical multi-message flurry without spilling across ticks.
 */
export const PUSH_TRIGGER_BATCH_SIZE = 20;

/**
 * Boot-time first-tick spread window. Mirrors
 * `INITIAL_TICK_JITTER_MS` in observation-loop.ts:85 — 500ms is under
 * human perceptibility threshold while breaking the N-user lock-step
 * boot pattern that would otherwise thunder N admin API calls at Synapse
 * on the same 2s beat.
 */
export const PUSH_TRIGGER_INITIAL_JITTER_MS = 500;

/**
 * Backoff ladder for consecutive per-user tick failures. Same shape as
 * `BACKOFF_LADDER_MS` in observation-loop.ts:93-95 but tightened for the
 * 2s cadence — first backoff = one cadence-multiple, growing to a 60s
 * cap. Success at any step resets backoffIndex to 0.
 */
export const PUSH_TRIGGER_BACKOFF_LADDER_MS: readonly number[] = [
  2_000,
  8_000,
  15_000,
  30_000,
  60_000,
];

/**
 * How often the scheduler's wake-timer fires. Mirrors
 * SCHEDULER_SCAN_INTERVAL_MS in observation-loop.ts:120 — scan cadence
 * must be finer than tick cadence so backoff transitions fire promptly.
 * 500ms scan is fine for 2s tick cadence.
 */
const SCHEDULER_SCAN_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// Per-user state
// ---------------------------------------------------------------------------

/**
 * Per-user scheduling state tracked by the loop. Mirrors PerUserState in
 * observation-loop.ts:594-599, PLUS `cursorByRoom` — the Matrix dir=f
 * `end` token per joined room so successive polls only see NEW events.
 */
export interface PerUserState {
  userMxid: string;
  nextRunAt: number; // ms since epoch
  backoffIndex: number;
  inFlight: boolean;
  /** roomId → Matrix `end` token (sinceToken) from the last fetchLive call. */
  cursorByRoom: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Dep-injection interface — every I/O primitive the tick uses
// ---------------------------------------------------------------------------

/**
 * Matrix live-event fetch primitive. Byte-mirror of the fetchLive closure
 * in relay-room-stream-server.ts:1142-1154. Returns { ok:true, events,
 * nextSinceToken } on success; failure passes through the underlying
 * fetchRoomHistory error shape.
 */
export type FetchLiveResult =
  | { ok: true; events: readonly MatrixMessageEvent[]; nextSinceToken: string | null }
  | { ok: false; status: number; error: string };

/**
 * Minimal Matrix message event shape the loop needs. Kept intentionally
 * narrow so tests can construct events without importing the full
 * matrix-admin-client MatrixEvent type. Mirrors the runtime shape returned
 * by fetchRoomHistory (which itself filters to `type === "m.room.message"`).
 */
export interface MatrixMessageEvent {
  type: string;
  sender: string;
  event_id?: string;
  content?: {
    msgtype?: string;
    body?: string;
    filename?: string;
    "m.relates_to"?: { rel_type?: string; event_id?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Every I/O primitive runPushTriggerTick + the scheduler consume. Boot-time
 * starter wires the concrete implementations; tests inject vi.fn() stubs.
 */
export interface PushTriggerLoopDeps {
  /**
   * Poll for NEW events in a room since `sinceToken`. Passes through to
   * fetchRoomHistory({dir:"f", beforeEventId:sinceToken, count}). Empty
   * sinceToken on first call means "from the room's current head".
   */
  fetchLive(
    roomId: string,
    sinceToken: string,
    count: number,
  ): Promise<FetchLiveResult>;
  /**
   * Cold-start anchor primitive. Returns the room's CURRENT head token
   * (Matrix `end` cursor from a `dir:"b", limit:1` fetch — the same anchor
   * relay-room-stream-server uses at :1102-1120). This is the ONLY way to
   * seed a forward-cursor at the actual tail: a `dir:"f"` fetch with no
   * `from` starts from the room's HISTORICAL start, not the head, and the
   * returned `end` from that call would be ~one batch into history —
   * causing subsequent forward polls to replay historical events as fresh
   * pushes (Fix pass M-1).
   *
   * Returns `{ ok:true, endToken }` where endToken may be null if Matrix
   * omits `end` (empty room). Loop treats null as "no cursor yet, retry
   * on next tick" — same discipline as fetchLive's null nextSinceToken.
   */
  fetchInitialCursor(
    roomId: string,
  ): Promise<
    | { ok: true; endToken: string | null }
    | { ok: false; status: number; error: string }
  >;
  /** Enumerate a user's joined rooms via the Matrix admin API. */
  getUserJoinedRooms(mxid: string): Promise<
    | { ok: true; roomIds: string[] }
    | { ok: false; status: number; error: string }
  >;
  /** List a room's joined members. Passed to classifyRoom for D-02 check. */
  getRoomJoinedMembers(roomId: string): Promise<
    | { ok: true; memberMxids: string[]; total: number }
    | { ok: false; status: number; error: string }
  >;
  /**
   * D-02 room-shape classifier. Loop MUST call this per-event (D-03) — no
   * re-derivation. Trigger fires only if
   * `decision === "exclude" && reason === "harness_dm"`.
   */
  classifyRoom(input: ClassifyRoomInput): ClassifyResult;
  /** admin_rooms ignore list — passed into classifyRoom (D-13). */
  listAdminRooms(): Promise<string[]>;
  /** Agents-registry room id or null (fresh install). */
  getAgentsRegistryRoomId(): Promise<string | null>;
  /**
   * Resolve the members of the agents-registry room as a Set<mxid>. Loop
   * caller is expected to memoize this per-tick if desired — we call it
   * once per tick and reuse the result across all rooms.
   */
  getRegistryMembers(agentsRegistryRoomId: string): Promise<Set<string>>;
  /**
   * Dispatch a push notification for a qualifying event. Never-throws by
   * contract (T-128-09) — see push-sender.ts. This dep's I/O and prune
   * discipline are owned entirely by push-sender.
   */
  sendPushToUser(
    userId: string,
    payload: {
      title: string;
      body: string;
      roomId: string;
      agentMxid: string;
    },
  ): Promise<void>;
  /** Compute the lock-screen preview body (D-07). Pure function. */
  derivePreviewText(event: MatrixMessageEvent): string;
  /**
   * Resolve the agent's display-name string for the notification title
   * (D-07). Never-throws — falls back to mxid local-part.
   */
  resolveAgentDisplayName(mxid: string): Promise<string>;
  /**
   * Clock-source dep — accepts an injected fake in tests (deterministic
   * jitter + scheduling). Production wire passes `() => Date.now()`.
   */
  now(): number;
}

// ---------------------------------------------------------------------------
// runPushTriggerTick — one tick, one user
// ---------------------------------------------------------------------------

/**
 * Result of a single tick. `ok:true` when the tick completed (with or
 * without pushes fired); `ok:false` when a top-level primitive failed
 * (joined_rooms fetch, or an uncaught throw somewhere in the body).
 */
export type PushTriggerTickResult =
  | { ok: true; roomsScanned: number; eventsFired: number }
  | { ok: false; reason: string };

/**
 * Run one push-trigger tick for a single user. Never throws. All errors
 * are caught locally, logged at .warn, and result in either a skipped-room
 * or a `{ ok:false, reason }` return so the scheduler can advance the
 * backoff ladder appropriately.
 *
 * Filter pipeline (per event, in order):
 *   1. event.type === "m.room.message"                     (D-04)
 *   2. event.sender !== userMxid                           (D-04 no self-push)
 *   3. content["m.relates_to"]?.rel_type !== "m.replace"   (D-04 no edits)
 *   4. classifyRoom → decision === "exclude"
 *      AND reason === "harness_dm"                          (D-02, D-01, D-03)
 *
 * Cold-start policy (M-1 review-fix): on the FIRST tick for a room (no
 * cursor entry), we issue a `dir:"b", limit:1` fetch via
 * fetchInitialCursor to anchor at the room's CURRENT head, seed
 * state.cursorByRoom with the returned `end` token, and dispatch NO
 * pushes. Second tick onward uses fetchLive (dir=f) from the anchored
 * cursor for normal filter+dispatch flow. Prevents boot-time push
 * storm (T-128-29 mitigation). Do NOT call fetchLive on cold-start —
 * dir=f from an empty cursor starts from the room's HISTORICAL start,
 * not the head, and would replay history as fresh pushes on the second
 * tick.
 */
export async function runPushTriggerTick(
  userId: string,
  state: PerUserState,
  deps: PushTriggerLoopDeps,
): Promise<PushTriggerTickResult> {
  const userMxid = state.userMxid;

  try {
    // Step 1: fetch joined rooms for this user.
    const joinedResult = await deps.getUserJoinedRooms(userMxid);
    if (!joinedResult.ok) {
      assertNotOk(joinedResult);
      databaseLogger.debug(
        "[phase-128] push-trigger tick — joined_rooms fetch failed",
        {
          operation: "push_trigger_tick_joined_rooms_failed",
          userId,
          userMxid,
          status: joinedResult.status,
          error: joinedResult.error,
        },
      );
      return { ok: false, reason: "joined_rooms_fetch_failed" };
    }
    const joinedRoomIds = joinedResult.roomIds;

    // Step 2: load classification helpers ONCE per tick — the classifier
    // needs the admin-rooms ignore list + agents-registry members for
    // every room, and these lookups are shared across all rooms this
    // user has joined.
    const adminRoomIds = new Set<string>(await safeListAdminRooms(deps));
    const agentsRegistryRoomId = await safeGetAgentsRegistryRoomId(deps);
    let agentsInRegistry: Set<string> = new Set();
    if (agentsRegistryRoomId !== null) {
      try {
        agentsInRegistry = await deps.getRegistryMembers(agentsRegistryRoomId);
      } catch (err) {
        databaseLogger.warn(
          "[phase-128] push-trigger tick — getRegistryMembers failed, classifier will see empty registry",
          {
            operation: "push_trigger_tick_registry_members_failed",
            userId,
            error: err instanceof Error ? err.message : "unknown",
          },
        );
        agentsInRegistry = new Set();
      }
    }

    // Step 3: for each joined room, fetchLive from the cursor, filter, dispatch.
    let eventsFired = 0;
    for (const roomId of joinedRoomIds) {
      const isColdStart = !state.cursorByRoom.has(roomId);

      // Cold-start branch (M-1 review-fix): anchor at the room's CURRENT
      // head via a backward-fetch. Do NOT call fetchLive here — dir=f
      // with no `from` starts from the room's HISTORICAL start; its
      // returned `end` would be ~one batch into history, and the next
      // dir=f poll from THAT cursor would dispatch every subsequent
      // historical event as a fresh push. Byte-mirror of the anchor
      // pattern from relay-room-stream-server.ts:1102-1120.
      if (isColdStart) {
        const initialResult = await deps.fetchInitialCursor(roomId);
        if (!initialResult.ok) {
          assertNotOk(initialResult);
          // Do NOT set a cursor — subsequent ticks retry the same
          // cold-start hop with a fresh call. Same discipline as
          // fetchLive-failure retry.
          databaseLogger.debug(
            "[phase-128] push-trigger tick — fetchInitialCursor failed, cold-start deferred",
            {
              operation: "push_trigger_tick_cold_start_fetch_failed",
              userId,
              roomId,
              status: initialResult.status,
              error: initialResult.error,
            },
          );
          continue;
        }
        if (initialResult.endToken !== null) {
          state.cursorByRoom.set(roomId, initialResult.endToken);
        } else {
          // Empty room (Matrix omitted `end`) — mark seen-but-empty
          // with a "" sentinel so the next tick's has()-check treats
          // this as warm. Next tick's fetchLive with "" will fetch
          // from the room's historical start — but since the room is
          // empty, there's nothing to dispatch. First actual message
          // will advance the cursor on the following tick.
          state.cursorByRoom.set(roomId, "");
        }
        databaseLogger.debug(
          "[phase-128] push-trigger tick — cold-start anchored at current head, NO pushes dispatched",
          {
            operation: "push_trigger_tick_cold_start_anchored",
            userId,
            roomId,
            hasEndToken: initialResult.endToken !== null,
          },
        );
        continue;
      }

      const cursor = state.cursorByRoom.get(roomId) ?? "";
      const liveResult = await deps.fetchLive(
        roomId,
        cursor,
        PUSH_TRIGGER_BATCH_SIZE,
      );
      if (!liveResult.ok) {
        assertNotOk(liveResult);
        // Do NOT advance the cursor — subsequent ticks retry the same
        // range with the fresh cursor. T-128-32 mitigation.
        databaseLogger.debug(
          "[phase-128] push-trigger tick — fetchLive failed, skipping room, cursor NOT advanced",
          {
            operation: "push_trigger_tick_fetch_live_failed",
            userId,
            roomId,
            status: liveResult.status,
            error: liveResult.error,
          },
        );
        continue;
      }

      // Fetch member list ONCE per room-per-tick, only when there ARE
      // events to process. Passed to classifyRoom for D-02.
      let membersResult: Awaited<
        ReturnType<typeof deps.getRoomJoinedMembers>
      > | null = null;
      if (liveResult.events.length > 0) {
        membersResult = await deps.getRoomJoinedMembers(roomId);
      }

      for (const event of liveResult.events) {
        // ─── Filter Step 1: type === "m.room.message" ─────────────────
        // Defense-in-depth: fetchRoomHistory already filters, but a
        // direct caller of runPushTriggerTick could bypass that layer.
        if (event.type !== "m.room.message") {
          continue;
        }
        // ─── Filter Step 2: sender !== userMxid ───────────────────────
        // D-04 no self-push: the user's own outbound (from any device)
        // never fires a push to their phone.
        if (event.sender === userMxid) {
          continue;
        }
        // ─── Filter Step 3: not an edit ───────────────────────────────
        // D-04: edits (m.replace relations) don't fire — the original
        // message already pushed; re-firing on edit is spam.
        const relatesTo = event.content?.["m.relates_to"];
        if (
          relatesTo !== undefined &&
          relatesTo !== null &&
          typeof relatesTo === "object" &&
          "rel_type" in relatesTo &&
          relatesTo.rel_type === "m.replace"
        ) {
          continue;
        }
        // ─── Filter Step 4: classifyRoom → harness_dm ─────────────────
        // D-02: room-shape decision delegated to the existing classifier.
        // We call this per-event (D-03) — never re-derive shape logic.
        if (membersResult === null || !membersResult.ok) {
          // Members fetch failed — cannot classify. Skip this event
          // (and every other event in this room's batch).
          databaseLogger.debug(
            "[phase-128] push-trigger tick — getRoomJoinedMembers failed, skipping events",
            {
              operation: "push_trigger_tick_members_failed",
              userId,
              roomId,
              status: membersResult?.ok === false ? membersResult.status : null,
              error: membersResult?.ok === false ? membersResult.error : null,
            },
          );
          break;
        }
        const decision = deps.classifyRoom({
          userMxid,
          roomId,
          memberMxids: membersResult.memberMxids,
          memberCount: membersResult.total,
          isRoomInAdminList: adminRoomIds.has(roomId),
          agentsInRegistry,
        });
        if (decision.decision !== "exclude" || decision.reason !== "harness_dm") {
          databaseLogger.debug(
            "[phase-128] push-trigger tick — event excluded by classifier",
            {
              operation: "push_trigger_tick_event_excluded",
              userId,
              roomId,
              decision: decision.decision,
              reason: decision.reason,
            },
          );
          continue;
        }

        // ─── Dispatch: all four filters passed ─────────────────────────
        // Compute title + body, dispatch through push-sender.
        // sendPushToUser is never-throws by contract (T-128-09), but wrap
        // in try/catch as defense-in-depth. Absorb failures — dropping a
        // push is preferable to re-firing on next tick (which would spam
        // the same event).
        try {
          const [displayName, body] = await Promise.all([
            deps.resolveAgentDisplayName(event.sender),
            Promise.resolve(deps.derivePreviewText(event)),
          ]);
          await deps.sendPushToUser(userId, {
            title: `${displayName}:`,
            body,
            roomId,
            agentMxid: event.sender,
          });
          eventsFired++;
        } catch (err) {
          databaseLogger.warn(
            "[phase-128] push-trigger tick — sendPushToUser dispatch failed, event dropped",
            {
              operation: "push_trigger_tick_dispatch_failed",
              userId,
              roomId,
              eventId: event.event_id,
              error: err instanceof Error ? err.message : "unknown",
            },
          );
        }
      }

      // Advance cursor AFTER processing the batch — only when fetch was ok.
      if (liveResult.nextSinceToken !== null) {
        state.cursorByRoom.set(roomId, liveResult.nextSinceToken);
      }
    }

    return { ok: true, roomsScanned: joinedRoomIds.length, eventsFired };
  } catch (err) {
    // Defense-in-depth catch — the body above should never throw, but a
    // dep injecting an unexpected primitive could. Log at .warn and let
    // the scheduler advance backoff.
    databaseLogger.warn(
      "[phase-128] push-trigger tick — unexpected throw (contract violation)",
      {
        operation: "push_trigger_tick_threw",
        userId,
        userMxid,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return { ok: false, reason: "tick_threw" };
  }
}

// ---------------------------------------------------------------------------
// Helpers — best-effort classifier prerequisites
// ---------------------------------------------------------------------------

async function safeListAdminRooms(deps: PushTriggerLoopDeps): Promise<string[]> {
  try {
    return await deps.listAdminRooms();
  } catch (err) {
    databaseLogger.warn(
      "[phase-128] push-trigger tick — listAdminRooms failed, classifier will see empty admin-rooms list",
      {
        operation: "push_trigger_tick_list_admin_rooms_failed",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return [];
  }
}

async function safeGetAgentsRegistryRoomId(
  deps: PushTriggerLoopDeps,
): Promise<string | null> {
  try {
    return await deps.getAgentsRegistryRoomId();
  } catch (err) {
    databaseLogger.warn(
      "[phase-128] push-trigger tick — getAgentsRegistryRoomId failed",
      {
        operation: "push_trigger_tick_get_agents_registry_failed",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// createPushTriggerLoop — per-user scheduler with backoff + in-flight guard
// ---------------------------------------------------------------------------

export interface PushTriggerLoopOptions {
  jitter?: boolean;
  rng?: () => number;
}

export interface PushTriggerLoopScheduler {
  start(users: Array<{ userId: string; userMxid: string }>): void;
  stop(): void;
  /**
   * Test-only escape hatch — returns the internal per-user state Map
   * (LIVE reference, not a copy) so scoped tests can assert on
   * scheduling shape (nextRunAt jitter distribution, backoffIndex).
   * Named with the double-underscore convention used by
   * observation-loop.ts's `__resetAgentsRegistryMembersCacheForTests`.
   */
  __getPerUserStateForTests(): Map<string, PerUserState>;
}

/**
 * Build a scheduler that runs runPushTriggerTick per-user on a ~2s cadence
 * with backoff ladder + per-user in-flight guard. Mirror of
 * createObservationLoop from observation-loop.ts:636-784.
 *
 * Per-user isolation (D-04 analog): each user has independent nextRunAt +
 * backoffIndex + inFlight + cursorByRoom; a failing tick for user A
 * cannot delay or block user B's tick.
 */
export function createPushTriggerLoop(
  deps: PushTriggerLoopDeps,
  options: PushTriggerLoopOptions = {},
): PushTriggerLoopScheduler {
  const perUserState = new Map<string, PerUserState>();
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  const jitterEnabled = options.jitter !== false;
  const rng = options.rng ?? Math.random;

  function scheduleNext(userId: string, ok: boolean): void {
    const state = perUserState.get(userId);
    if (!state) return;
    if (ok) {
      if (state.backoffIndex !== 0) {
        databaseLogger.debug(
          "[phase-128] push-trigger — backoff reset on success",
          {
            operation: "push_trigger_backoff_reset",
            userId,
            previousBackoffIndex: state.backoffIndex,
          },
        );
      }
      state.backoffIndex = 0;
      // ±20% jitter on per-tick success — mirrors observation-loop.ts:
      // 661-668. Without this, N users lock-step-fire against Synapse
      // every 2s forever after boot.
      const jitterMultiplier = jitterEnabled ? 0.9 + rng() * 0.2 : 1.0;
      state.nextRunAt =
        deps.now() +
        Math.floor(PUSH_TRIGGER_POLL_INTERVAL_MS * jitterMultiplier);
    } else {
      const previousIndex = state.backoffIndex;
      state.backoffIndex = Math.min(
        state.backoffIndex + 1,
        PUSH_TRIGGER_BACKOFF_LADDER_MS.length - 1,
      );
      const delayMs = PUSH_TRIGGER_BACKOFF_LADDER_MS[state.backoffIndex];
      state.nextRunAt = deps.now() + delayMs;
      databaseLogger.debug(
        "[phase-128] push-trigger — backoff advanced on failure",
        {
          operation: "push_trigger_backoff_advance",
          userId,
          previousBackoffIndex: previousIndex,
          nextBackoffIndex: state.backoffIndex,
          delayMs,
        },
      );
    }
  }

  function scanTick(): void {
    const now = deps.now();
    for (const [userId, state] of perUserState.entries()) {
      if (state.nextRunAt > now) continue;
      if (state.inFlight) {
        databaseLogger.debug(
          "[phase-128] push-trigger — tick skipped, prior tick still in flight",
          {
            operation: "push_trigger_tick_skipped_inflight",
            userId,
          },
        );
        continue;
      }
      state.inFlight = true;
      runPushTriggerTick(userId, state, deps)
        .then((result) => {
          scheduleNext(userId, result.ok);
        })
        .catch((err) => {
          // Defense-in-depth — runPushTriggerTick's contract is no-throw.
          databaseLogger.error(
            "[phase-128] push-trigger — tick threw unexpectedly (contract violation)",
            err,
            {
              operation: "push_trigger_tick_threw_scheduler",
              userId,
            },
          );
          scheduleNext(userId, false);
        })
        .finally(() => {
          const finalState = perUserState.get(userId);
          if (finalState) {
            finalState.inFlight = false;
          }
        });
    }
  }

  function start(users: Array<{ userId: string; userMxid: string }>): void {
    if (scanTimer !== null) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    perUserState.clear();
    const now = deps.now();
    for (const { userId, userMxid } of users) {
      // Thundering-herd defense: spread each user's FIRST tick uniformly
      // across [now, now + PUSH_TRIGGER_INITIAL_JITTER_MS). Mirrors
      // observation-loop.ts:744-757.
      const initialDelayMs = jitterEnabled
        ? Math.floor(rng() * PUSH_TRIGGER_INITIAL_JITTER_MS)
        : 0;
      perUserState.set(userId, {
        userMxid,
        nextRunAt: now + initialDelayMs,
        backoffIndex: 0,
        inFlight: false,
        cursorByRoom: new Map(),
      });
    }
    databaseLogger.info("[phase-128] push-trigger loop start", {
      operation: "push_trigger_loop_start",
      userCount: users.length,
    });
    scanTimer = setInterval(scanTick, SCHEDULER_SCAN_INTERVAL_MS);
  }

  function stop(): void {
    if (scanTimer !== null) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    perUserState.clear();
    databaseLogger.info("[phase-128] push-trigger loop stop", {
      operation: "push_trigger_loop_stop",
    });
  }

  function __getPerUserStateForTests(): Map<string, PerUserState> {
    return perUserState;
  }

  return { start, stop, __getPerUserStateForTests };
}
