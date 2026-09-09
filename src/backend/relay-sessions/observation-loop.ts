/**
 * observation-loop.ts — Phase 89-03 Task 3.
 *
 * The observation loop polls each user's joined-rooms list on ~10s cadence
 * (D-04) using Skynet's Matrix admin credential and reconciles the discovered
 * memberships into the relay_room_sessions table via the store primitives
 * from Plan 89-01. Rooms that pass the classifier (Plan 89-03 Task 2) are
 * materialized; rooms in DB-active-set-minus-discovered are marked inactive
 * (external-kick); brand-new memberships become new active rows.
 *
 * ## Design invariants (D-04..D-13)
 *
 * - Per-user tick scheduling with per-user backoff (D-04, D-06). One user's
 *   failing tick does NOT stall observations for any other user.
 * - Same-tick augmentation (D-05): each successful tick fetches the newest
 *   event timestamp per joined room in parallel and refreshes last_activity_at.
 * - No-destruction-on-failure (D-06): a failing tick returns { ok:false }
 *   WITHOUT touching any existing row. Absence of observation is not
 *   evidence the user left the rooms.
 * - Backoff ladder (D-06): 10s → 30s → 60s → 120s → 300s cap. Success
 *   resets to 10s.
 * - No user-visible failure surface (D-07): all failures land in
 *   databaseLogger; runObservationTick MUST NOT throw to its caller (the
 *   scheduler); the scheduler MUST NOT throw to its parent.
 * - Classification (D-08, D-09, D-13) delegates to observation-loop-classifier
 *   with the caller-supplied fact-set: admin_rooms membership +
 *   agents-registry-room member set (both loaded ONCE per tick, not per room).
 *
 * ## In-flight guard
 *
 * A slow tick MUST NOT accumulate a second tick for the same user (mirrors
 * the ssh-poll-orchestrator quick-260820-tm0 pattern from the wilma incident
 * 2026-08-20 — see ssh-poll-orchestrator.ts:822-844). The scheduler tracks
 * `inFlight: boolean` per-user; a scan tick that finds inFlight=true logs
 * at debug and skips. The guard is per-user, NOT global — a slow user does
 * not block other users.
 *
 * ## Deps injection
 *
 * Every DB primitive and matrix-admin-client primitive that runObservationTick
 * uses is a field on the ObservationTickDeps interface, so tests can inject
 * vi.fn() stubs without any vi.mock() call. The boot-time starter
 * (observation-loop-starter.ts, Task 4) wires the concrete implementations.
 */

import { databaseLogger } from "../utils/logger.js";
import { assertAdminErr } from "../matrix/matrix-admin-client.js";
import { classifyRoom } from "./observation-loop-classifier.js";
import type { ActiveRelayRoomSession } from "./relay-room-sessions-store.js";

/** D-04 target cadence. Scheduler enforces this per-user. */
export const OBSERVATION_TICK_INTERVAL_MS = 10_000;

/**
 * D-06 backoff ladder for consecutive failures. Index 0 = first backoff
 * (10s), index 4 = capped max (300s = 5 min). backoffIndex clamps at
 * ladder.length - 1. On any success the scheduler resets backoffIndex to 0
 * (next tick fires OBSERVATION_TICK_INTERVAL_MS from success).
 */
export const BACKOFF_LADDER_MS: readonly number[] = [
  10_000, 30_000, 60_000, 120_000, 300_000,
];

/**
 * Cap on same-tick augmentation parallelism (D-05 cost bound). Rooms per
 * user are typically small, but this guards against a user with many
 * rooms fanning out unbounded fetch fan.
 *
 * Fixup N-5 (2026-09-08) rationale for `8`: educated guess anchored to
 * the observed slice-B fleet — most users have <5 joined rooms at slice-B
 * shipping time; power users may accumulate 10-20 over slice-C's lifetime.
 * 8 keeps a normal user's tick to a single Promise.all batch while
 * throttling a power user to at most 3 sequential batches (which still
 * finishes well within the 10s TICK_INTERVAL_MS budget on a healthy
 * homeserver). Tune upward if Synapse admin-API concurrency becomes the
 * dominant cost; tune downward if a slow homeserver saturates on 8x
 * parallel fetches.
 */
export const MAX_PARALLEL_ROOMS_PER_TICK = 8;

/**
 * How often the scheduler's internal wake-timer fires (checks each user's
 * nextRunAt). Independent of OBSERVATION_TICK_INTERVAL_MS — the scan
 * cadence needs to be finer than the tick cadence so backoff transitions
 * fire promptly. 1s scan is fine for ~10s tick cadence.
 */
const SCHEDULER_SCAN_INTERVAL_MS = 1_000;

/**
 * Fixup M-3 (2026-09-08). Cache TTL for getRoomJoinedMembers of the
 * agents-registry room. Without a cache, every user's tick fetches the
 * agents-registry members independently — N users → N redundant admin
 * API calls per 10s window against the same room. 5s TTL is strictly
 * less than TICK_INTERVAL_MS (10s), so worst-case staleness is one
 * TICK_INTERVAL_MS. Registry-room membership changes propagate on the
 * following tick.
 */
export const AGENTS_REGISTRY_MEMBERS_CACHE_TTL_MS = 5_000;

/**
 * Fixup M-3 (2026-09-08). Cache for agents-registry member sets. Keyed
 * by room ID so a registry-room ID rotation invalidates the entry
 * naturally. Module-level so all createObservationLoop instances share
 * — in practice there's one, but the cache is a stateless bag.
 */
interface AgentsRegistryCacheEntry {
  memberMxids: Set<string>;
  expiresAt: number;
}
const agentsRegistryMembersCache = new Map<string, AgentsRegistryCacheEntry>();

// ---------------------------------------------------------------------------
// Dep-injection interface (every I/O primitive the tick uses)
// ---------------------------------------------------------------------------

/**
 * Every I/O primitive runObservationTick consumes. Boot-time starter wires
 * the concrete implementations (Task 4); tests inject vi.fn() stubs.
 */
export interface ObservationTickDeps {
  // Matrix admin-client primitives (Task 1 outputs)
  getUserJoinedRooms(mxid: string): Promise<
    | { ok: true; roomIds: string[] }
    | { ok: false; status: number; error: string }
  >;
  getRoomLatestEventTs(roomId: string): Promise<
    | { ok: true; ts: number | null }
    | { ok: false; status: number; error: string }
  >;
  getRoomJoinedMembers(roomId: string): Promise<
    | { ok: true; memberMxids: string[]; total: number }
    | { ok: false; status: number; error: string }
  >;
  // Fixup M-1 (2026-09-08). Same-tick batch alongside members + latest-ts
  // per D-05, so materialize can populate relay_room_sessions.room_title
  // (D-02) instead of the previous hard-coded null.
  getRoomName(roomId: string): Promise<
    | { ok: true; name: string | null }
    | { ok: false; status: number; error: string }
  >;
  // relay-room-sessions-store primitives (Plan 01)
  materializeRelayRoomSession(
    userId: string,
    roomId: string,
    roomTitle: string | null,
  ): Promise<void>;
  markRelayRoomSessionInactive(userId: string, roomId: string): Promise<void>;
  reactivateRelayRoomSession(userId: string, roomId: string): Promise<void>;
  refreshRelayRoomLastActivity(
    userId: string,
    roomId: string,
    isoTs: string,
  ): Promise<void>;
  listActiveRelayRoomSessions(userId: string): Promise<ActiveRelayRoomSession[]>;
  // admin-rooms-ignore-list + registry-rooms primitives (Plans 01/02)
  listAdminRooms(): Promise<string[]>;
  getAgentsRegistryRoomId(): Promise<string | null>;
}

/**
 * Result of a single tick. `ok:true` includes a tally suitable for
 * structured logging + smoke tests; `ok:false` includes a stable reason
 * string so the scheduler can classify failures without parsing.
 */
export type ObservationTickResult =
  | {
      ok: true;
      roomsSeen: number;
      materialized: number;
      markedInactive: number;
      reactivated: number;
    }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// runObservationTick — one tick, one user, one admin credential
// ---------------------------------------------------------------------------

/**
 * Run one observation tick against Skynet's Matrix admin credential for a
 * single user. Idempotent — safe to re-run on the same user without
 * side-effects beyond the tally.
 *
 * MUST NOT throw. All error paths return { ok:false, reason:... } after
 * logging via databaseLogger (D-07). All caught downstream primitive
 * failures are logged and continue (per D-05 best-effort-per-axis + D-07
 * silent-failure).
 */
export async function runObservationTick(
  userId: string,
  userMxid: string,
  deps: ObservationTickDeps,
): Promise<ObservationTickResult> {
  databaseLogger.debug("[phase-89] observation tick start", {
    operation: "relay_observation_tick_start",
    userId,
    userMxid,
  });

  try {
    // Step 1: fetch the user's joined rooms via admin credential.
    const joinedResult = await deps.getUserJoinedRooms(userMxid);
    if (!joinedResult.ok) {
      assertAdminErr(joinedResult);
      // D-06 no-destruction-on-failure — do NOT touch any existing row.
      databaseLogger.debug(
        "[phase-89] observation tick — joined_rooms fetch failed, no reconcile",
        {
          operation: "relay_observation_tick_joined_rooms_failed",
          userId,
          userMxid,
          status: joinedResult.status,
          error: joinedResult.error,
        },
      );
      return { ok: false, reason: "joined_rooms_fetch_failed" };
    }
    const joinedRoomIds = joinedResult.roomIds;

    // Step 2: load classification helpers ONCE per tick (not per room).
    const adminRoomIds = new Set<string>(await safeListAdminRooms(deps));
    const agentsRegistryRoomId = await safeGetAgentsRegistryRoomId(deps);
    let agentsInRegistry: Set<string> = new Set();
    if (agentsRegistryRoomId !== null) {
      // Fixup M-3 (2026-09-08). Cache the agents-registry members with
      // AGENTS_REGISTRY_MEMBERS_CACHE_TTL_MS TTL so N users don't each
      // fetch the same room independently within a single tick window.
      agentsInRegistry = await getAgentsRegistryMembersCached(
        agentsRegistryRoomId,
        deps,
        userId,
      );
    }

    // Step 3: for each joined room (bounded parallelism), fetch members +
    // latest-event-ts, classify, and materialize when applicable. Track
    // which roomIds we successfully materialized so Step 4 can reconcile.
    //
    // fetchedRoomIds is the set of roomIds whose per-room members fetch
    // SUCCEEDED (regardless of whether the classifier chose to materialize).
    // Step 4's reconcile MUST only consider fetchedRoomIds — a per-room
    // fetch failure leaves that room in an unknown state, and marking its
    // DB row inactive would violate D-06 (absence of observation is not
    // evidence the user left). See fixup H-1 (2026-09-08).
    const materializedRoomIds = new Set<string>();
    const fetchedRoomIds = new Set<string>();
    let materialized = 0;
    let reactivated = 0;
    for (
      let offset = 0;
      offset < joinedRoomIds.length;
      offset += MAX_PARALLEL_ROOMS_PER_TICK
    ) {
      const chunk = joinedRoomIds.slice(
        offset,
        offset + MAX_PARALLEL_ROOMS_PER_TICK,
      );
      const results = await Promise.all(
        chunk.map(async (roomId) => {
          // D-05 same-tick augmentation: members + latest-event-ts + name
          // fetched in parallel. Fixup M-1 (2026-09-08) added the name
          // batch so materialize can populate D-02 room_title instead of
          // always passing null.
          const [membersResult, tsResult, nameResult] = await Promise.all([
            deps.getRoomJoinedMembers(roomId),
            deps.getRoomLatestEventTs(roomId),
            deps.getRoomName(roomId),
          ]);
          return { roomId, membersResult, tsResult, nameResult };
        }),
      );

      for (const { roomId, membersResult, tsResult, nameResult } of results) {
        if (!membersResult.ok) {
          assertAdminErr(membersResult);
          // Per-room fetch failed. Do NOT add to fetchedRoomIds — Step 4's
          // reconcile will therefore skip any DB row for this room, honoring
          // D-06 (no destruction on failure — including per-room failures).
          databaseLogger.debug(
            "[phase-89] observation tick — room members fetch failed, skipping this room (state unknown, reconcile skipped for this room)",
            {
              operation: "relay_observation_tick_room_members_failed",
              userId,
              roomId,
              status: membersResult.status,
              error: membersResult.error,
            },
          );
          continue;
        }
        // Per-room fetch succeeded → this room's state is known. Even if
        // the classifier excludes it below (harness DM, admin room, etc.),
        // Step 4 can safely reconcile against fetchedRoomIds.
        fetchedRoomIds.add(roomId);
        const decision = classifyRoom({
          userMxid,
          roomId,
          memberMxids: membersResult.memberMxids,
          memberCount: membersResult.total,
          isRoomInAdminList: adminRoomIds.has(roomId),
          agentsInRegistry,
        });
        if (decision.decision === "exclude") {
          databaseLogger.debug(
            "[phase-89] observation tick — room excluded by classifier",
            {
              operation: "relay_observation_tick_room_excluded",
              userId,
              roomId,
              reason: decision.reason,
            },
          );
          continue;
        }
        // Materialize path. Best-effort per axis — store primitives may
        // throw (DB failure); catch each independently. Fixup M-1
        // (2026-09-08): resolved room name (or null on getRoomName
        // failure / no state event) flows into materialize per D-02.
        const roomTitle = nameResult.ok ? nameResult.name : null;
        if (!nameResult.ok) {
          assertAdminErr(nameResult);
          databaseLogger.debug(
            "[phase-89] observation tick — getRoomName failed, materializing with null title",
            {
              operation: "relay_observation_tick_get_room_name_failed",
              userId,
              roomId,
              status: nameResult.status,
              error: nameResult.error,
            },
          );
        }
        try {
          await deps.materializeRelayRoomSession(userId, roomId, roomTitle);
          materialized++;
          materializedRoomIds.add(roomId);
        } catch (err) {
          databaseLogger.warn(
            "[phase-89] observation tick — materializeRelayRoomSession failed",
            {
              operation: "relay_observation_tick_materialize_failed",
              userId,
              roomId,
              error: err instanceof Error ? err.message : "unknown",
            },
          );
          // Do NOT continue with reactivate/refresh for this room — the
          // row may not exist.
          continue;
        }
        try {
          await deps.reactivateRelayRoomSession(userId, roomId);
          reactivated++;
        } catch (err) {
          databaseLogger.warn(
            "[phase-89] observation tick — reactivateRelayRoomSession failed",
            {
              operation: "relay_observation_tick_reactivate_failed",
              userId,
              roomId,
              error: err instanceof Error ? err.message : "unknown",
            },
          );
        }
        if (tsResult.ok && tsResult.ts !== null) {
          try {
            await deps.refreshRelayRoomLastActivity(
              userId,
              roomId,
              new Date(tsResult.ts).toISOString(),
            );
          } catch (err) {
            databaseLogger.warn(
              "[phase-89] observation tick — refreshRelayRoomLastActivity failed",
              {
                operation: "relay_observation_tick_refresh_activity_failed",
                userId,
                roomId,
                error: err instanceof Error ? err.message : "unknown",
              },
            );
          }
        }
      }
    }

    // Step 4: reconcile. Two disjoint categories of "should be inactive":
    //
    //   (a) Rooms the whole-user joined_rooms fetch didn't return AT ALL —
    //       user was externally kicked. joinedRoomIdsSet.has(row.roomId) is
    //       false. Safe to mark inactive: whole-user fetch succeeded (see
    //       Step 1's ok gate), so absence from that list is authoritative.
    //   (b) Rooms in joined_rooms whose per-room fetch SUCCEEDED but the
    //       classifier excluded (e.g. newly excluded because the other
    //       member joined the agents registry). fetchedRoomIds.has(...) is
    //       true but materializedRoomIds.has(...) is false.
    //
    // Rooms in joined_rooms whose per-room fetch FAILED are UNKNOWN state
    // (per fixup H-1, 2026-09-08 — D-06 no-destruction extended to per-room
    // failures). They match neither (a) nor (b): joinedRoomIdsSet has them
    // (skips (a)) and fetchedRoomIds does not (skips (b)). Left untouched.
    const joinedRoomIdsSet = new Set(joinedRoomIds);
    let markedInactive = 0;
    try {
      const activeRows = await deps.listActiveRelayRoomSessions(userId);
      for (const row of activeRows) {
        const category_a_external_kick = !joinedRoomIdsSet.has(row.roomId);
        const category_b_now_excluded =
          fetchedRoomIds.has(row.roomId) &&
          !materializedRoomIds.has(row.roomId);
        if (category_a_external_kick || category_b_now_excluded) {
          try {
            await deps.markRelayRoomSessionInactive(userId, row.roomId);
            markedInactive++;
          } catch (err) {
            databaseLogger.warn(
              "[phase-89] observation tick — markRelayRoomSessionInactive failed",
              {
                operation: "relay_observation_tick_mark_inactive_failed",
                userId,
                roomId: row.roomId,
                error: err instanceof Error ? err.message : "unknown",
              },
            );
          }
        }
      }
    } catch (err) {
      databaseLogger.warn(
        "[phase-89] observation tick — listActiveRelayRoomSessions failed, skipping reconcile",
        {
          operation: "relay_observation_tick_list_active_failed",
          userId,
          error: err instanceof Error ? err.message : "unknown",
        },
      );
    }

    databaseLogger.debug("[phase-89] observation tick complete", {
      operation: "relay_observation_tick_complete",
      userId,
      userMxid,
      roomsSeen: joinedRoomIds.length,
      materialized,
      markedInactive,
      reactivated,
    });
    return {
      ok: true,
      roomsSeen: joinedRoomIds.length,
      materialized,
      markedInactive,
      reactivated,
    };
  } catch (err) {
    // Absolute safety net — D-07 no-throw contract. This SHOULD be
    // unreachable because every await above is wrapped, but defense-in-depth.
    databaseLogger.error(
      "[phase-89] observation tick — unexpected uncaught error",
      err,
      {
        operation: "relay_observation_tick_uncaught_error",
        userId,
        userMxid,
      },
    );
    return { ok: false, reason: "uncaught_error" };
  }
}

/**
 * Fixup M-3 (2026-09-08). Return the agents-registry members set,
 * consulting the module-level cache first. Cache miss → fetch via
 * getRoomJoinedMembers and populate the cache with a TTL of
 * AGENTS_REGISTRY_MEMBERS_CACHE_TTL_MS. Fetch failure returns an empty
 * set (same degraded state as the previous inline implementation) and
 * does NOT populate the cache (so the next tick retries immediately).
 */
async function getAgentsRegistryMembersCached(
  agentsRegistryRoomId: string,
  deps: ObservationTickDeps,
  userId: string,
): Promise<Set<string>> {
  const now = Date.now();
  const cached = agentsRegistryMembersCache.get(agentsRegistryRoomId);
  if (cached && cached.expiresAt > now) {
    return cached.memberMxids;
  }
  const membersResult = await deps.getRoomJoinedMembers(agentsRegistryRoomId);
  if (!membersResult.ok) {
    assertAdminErr(membersResult);
    databaseLogger.debug(
      "[phase-89] observation tick — agents registry members fetch failed, degraded classification",
      {
        operation: "relay_observation_tick_agents_registry_members_failed",
        userId,
        agentsRegistryRoomId,
        status: membersResult.status,
        error: membersResult.error,
      },
    );
    return new Set();
  }
  const memberMxids = new Set(membersResult.memberMxids);
  agentsRegistryMembersCache.set(agentsRegistryRoomId, {
    memberMxids,
    expiresAt: now + AGENTS_REGISTRY_MEMBERS_CACHE_TTL_MS,
  });
  return memberMxids;
}

/**
 * Test seam (Fixup M-3): reset the module-level agents-registry members
 * cache. Called from beforeEach in tests that need to assert cache
 * behavior deterministically. Not exported for production callers.
 */
export function __resetAgentsRegistryMembersCacheForTests(): void {
  agentsRegistryMembersCache.clear();
}

/** Wrap listAdminRooms in try/catch so a DB failure degrades gracefully. */
async function safeListAdminRooms(deps: ObservationTickDeps): Promise<string[]> {
  try {
    return await deps.listAdminRooms();
  } catch (err) {
    databaseLogger.warn(
      "[phase-89] observation tick — listAdminRooms failed, treating as empty ignore-list",
      {
        operation: "relay_observation_tick_list_admin_rooms_failed",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return [];
  }
}

/** Wrap getAgentsRegistryRoomId in try/catch — fresh install may have no
 * registry row; treat as null (degraded classification, safe fallback). */
async function safeGetAgentsRegistryRoomId(
  deps: ObservationTickDeps,
): Promise<string | null> {
  try {
    return await deps.getAgentsRegistryRoomId();
  } catch (err) {
    databaseLogger.warn(
      "[phase-89] observation tick — getAgentsRegistryRoomId failed, treating as null",
      {
        operation: "relay_observation_tick_get_agents_registry_failed",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// createObservationLoop — per-user scheduler with backoff + in-flight guard
// ---------------------------------------------------------------------------

/** Per-user scheduling state tracked by the loop. */
interface PerUserState {
  userMxid: string;
  nextRunAt: number; // ms since epoch
  backoffIndex: number;
  inFlight: boolean;
}

/** Public interface returned by createObservationLoop. */
export interface ObservationLoopScheduler {
  start(users: Array<{ userId: string; userMxid: string }>): void;
  stop(): void;
}

/**
 * Fixup M-2 (2026-09-08). Options for createObservationLoop scheduler.
 *
 * Jitter defense: without jitter, N users boot in lock-step, then all fire
 * their first tick simultaneously on the same 10s beat forever — every
 * subsequent scheduleNext(ok=true) sets nextRunAt = now + 10_000 for all
 * users at once. On a fleet with N users this thunders N admin API calls
 * against Synapse every 10s. Random ±20% on success and initial [0,
 * TICK_INTERVAL_MS) spread on boot break the synchronization.
 *
 * `rng` is exposed for deterministic tests. Default is Math.random.
 * `jitter: false` disables both boot-spread and per-tick jitter (useful
 * for tests that assert on exact timings).
 */
export interface ObservationLoopOptions {
  jitter?: boolean;
  rng?: () => number;
}

/**
 * Build a scheduler that runs runObservationTick per-user on a ~10s cadence
 * with D-06 backoff ladder + per-user in-flight guard. `start(users)` seeds
 * the state and kicks off a global scan interval that dispatches ticks;
 * `stop()` clears the interval and empties state (idempotent).
 *
 * Per-user isolation (D-04): each user has independent nextRunAt +
 * backoffIndex + inFlight; a failing tick for user A cannot delay or block
 * user B.
 */
export function createObservationLoop(
  deps: ObservationTickDeps,
  options: ObservationLoopOptions = {},
): ObservationLoopScheduler {
  const perUserState = new Map<string, PerUserState>();
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  const jitterEnabled = options.jitter !== false;
  const rng = options.rng ?? Math.random;

  function scheduleNext(userId: string, ok: boolean): void {
    const state = perUserState.get(userId);
    if (!state) return;
    if (ok) {
      // Success: reset backoff, next tick at OBSERVATION_TICK_INTERVAL_MS.
      if (state.backoffIndex !== 0) {
        databaseLogger.debug(
          "[phase-89] observation loop — backoff reset on success",
          {
            operation: "relay_observation_loop_backoff_reset",
            userId,
            previousBackoffIndex: state.backoffIndex,
          },
        );
      }
      state.backoffIndex = 0;
      // Fixup M-2 (2026-09-08). Thundering-herd defense: ±20% jitter on
      // per-tick success interval. Without this, N users lock-step-fire
      // every 10s forever after boot, hammering Synapse on the same beat.
      // Skipped when jitter is disabled (tests) or backoff-driven paths
      // (backoff intervals are pre-shaped and desync naturally).
      const jitterMultiplier = jitterEnabled ? 0.9 + rng() * 0.2 : 1.0;
      state.nextRunAt =
        Date.now() + Math.floor(OBSERVATION_TICK_INTERVAL_MS * jitterMultiplier);
    } else {
      // Failure: advance backoff (clamped at ladder max index).
      const previousIndex = state.backoffIndex;
      state.backoffIndex = Math.min(
        state.backoffIndex + 1,
        BACKOFF_LADDER_MS.length - 1,
      );
      const delayMs = BACKOFF_LADDER_MS[state.backoffIndex];
      state.nextRunAt = Date.now() + delayMs;
      databaseLogger.debug(
        "[phase-89] observation loop — backoff advanced on failure",
        {
          operation: "relay_observation_loop_backoff_advance",
          userId,
          previousBackoffIndex: previousIndex,
          nextBackoffIndex: state.backoffIndex,
          delayMs,
        },
      );
    }
  }

  function scanTick(): void {
    const now = Date.now();
    for (const [userId, state] of perUserState.entries()) {
      if (state.nextRunAt > now) continue;
      if (state.inFlight) {
        // Per-user in-flight guard — mirrors ssh-poll-orchestrator quick-260820-tm0.
        databaseLogger.debug(
          "[phase-89] observation loop — tick skipped, prior tick still in flight",
          {
            operation: "relay_observation_loop_tick_skipped_inflight",
            userId,
          },
        );
        continue;
      }
      // Fire the tick. Do NOT await inside the scan loop — each user's
      // tick runs independently in the background. The in-flight flag is
      // set NOW (before the async fires) and released in the finally.
      state.inFlight = true;
      runObservationTick(userId, state.userMxid, deps)
        .then((result) => {
          scheduleNext(userId, result.ok);
        })
        .catch((err) => {
          // runObservationTick's contract is no-throw, but defense-in-depth.
          databaseLogger.error(
            "[phase-89] observation loop — tick threw unexpectedly (contract violation)",
            err,
            {
              operation: "relay_observation_loop_tick_threw",
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
      // Idempotent — starting again resets the user list.
      clearInterval(scanTimer);
      scanTimer = null;
    }
    perUserState.clear();
    const now = Date.now();
    for (const { userId, userMxid } of users) {
      // Fixup M-2 (2026-09-08). Thundering-herd defense: spread each user's
      // FIRST tick uniformly across [now, now + TICK_INTERVAL_MS). Without
      // this, `nextRunAt: now` fires every user on the first scan pass,
      // meaning N parallel admin-API calls to Synapse at boot for a fleet
      // of N users. Skipped when jitter is disabled (tests want
      // deterministic firing on the first scan tick).
      const initialDelayMs = jitterEnabled
        ? Math.floor(rng() * OBSERVATION_TICK_INTERVAL_MS)
        : 0;
      perUserState.set(userId, {
        userMxid,
        nextRunAt: now + initialDelayMs,
        backoffIndex: 0,
        inFlight: false,
      });
    }
    databaseLogger.info("[phase-89] observation loop start", {
      operation: "relay_observation_loop_start",
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
    databaseLogger.info("[phase-89] observation loop stop", {
      operation: "relay_observation_loop_stop",
    });
  }

  return { start, stop };
}
