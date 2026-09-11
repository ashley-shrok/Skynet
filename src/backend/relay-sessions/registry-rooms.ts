/**
 * registry-rooms.ts — Phase 89 Plan 02 Task 2.
 *
 * Two "registry rooms" (agents + humans) that give the observation loop a
 * positive homeserver-persistent signal for "who is what" per D-09:
 *
 *   - Other member of a two-party room is in the agents registry → exclude
 *     (harness sessions already cover this case).
 *   - Other member is in the humans registry → materialize as real human DM.
 *   - Other member is in neither → materialize conservatively as
 *     foreign/unknown-origin account.
 *
 * Registry-room membership is homeserver-persistent — an agent's host can
 * be offline for a week and the exclusion still works. This module owns:
 *
 *   1. Boot-time idempotent room creation (ensureRegistryRoomsExist).
 *   2. Per-account join hooks fired at mint sites (joinAgentToAgentsRegistry
 *      + joinHumanToHumansRegistry).
 *   3. Read accessors (getAgentsRegistryRoomId / getHumansRegistryRoomId)
 *      for the observation loop.
 *
 * The room IDs are persisted in the settings table under
 * SETTINGS_KEY_AGENTS_REGISTRY + SETTINGS_KEY_HUMANS_REGISTRY. Downstream
 * consumers (Plan 03 observation loop) import the exported constants so
 * the key strings stay in lockstep across modules.
 *
 * ## D-13: registry rooms are added to the admin_rooms ignore-list at
 * creation time — the observation loop skips materializing them per D-16.
 *
 * ## D-10 planner-locked concrete strings
 *
 *   Agents room: name = "Skynet agents directory (internal)",
 *                roomAliasName = "_skynet_agents_directory"
 *   Humans room: name = "Skynet humans directory (internal)",
 *                roomAliasName = "_skynet_humans_directory"
 *
 * The leading underscore + "(internal)" parenthetical are internal-flavored
 * markers so a human who somehow stumbles in won't be confused. Concrete
 * names are locked here — do NOT re-question.
 *
 * ## Crown-jewel forceSave discipline
 *
 * Every settings write in ensureRegistryRoomsExist is paired with a labeled
 * DatabaseSaveTrigger.forceSave("phase-89-registry-rooms-ensure") wrapped
 * in try/catch that logs and swallows — matches
 * admin-rooms-ignore-list.ts:79-91 and identity-send-log-store.ts:167-181.
 * A downstream flush failure must not fail the caller (an in-memory row is
 * better than a 500 back to the boot / mint-hook path).
 */

import { db } from "../database/db/index.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { databaseLogger } from "../utils/logger.js";
import {
  createRoom,
  joinRoom,
  getRoomPowerLevels,
  putRoomPowerLevels,
} from "../matrix/matrix-admin-client.js";
import { assertNotOk } from "../matrix/matrix-admin-narrow.js";
import { getMatrixAdminCreds } from "../matrix/matrix-admin-creds-store.js";
import { addAdminRoom, isAdminRoom } from "./admin-rooms-ignore-list.js";

/**
 * Settings-table key holding the agents-registry room ID after
 * ensureRegistryRoomsExist has run. Plan 03's observation loop imports
 * this constant.
 */
export const SETTINGS_KEY_AGENTS_REGISTRY = "agents_registry_room_id";

/**
 * Settings-table key holding the humans-registry room ID after
 * ensureRegistryRoomsExist has run. Plan 03's observation loop imports
 * this constant.
 */
export const SETTINGS_KEY_HUMANS_REGISTRY = "humans_registry_room_id";

// D-10 planner-locked concrete room-config strings.
const AGENTS_ROOM_NAME = "Skynet agents directory (internal)";
const AGENTS_ROOM_ALIAS_LOCALPART = "_skynet_agents_directory";
const HUMANS_ROOM_NAME = "Skynet humans directory (internal)";
const HUMANS_ROOM_ALIAS_LOCALPART = "_skynet_humans_directory";

// ---------------------------------------------------------------------------
// Read accessors
// ---------------------------------------------------------------------------

/**
 * Return the agents-registry room ID stored in the settings table, or null
 * when the settings row is absent (ensureRegistryRoomsExist has not yet run
 * successfully). Read-only — no forceSave.
 */
export async function getAgentsRegistryRoomId(): Promise<string | null> {
  return readSettingsValue(SETTINGS_KEY_AGENTS_REGISTRY);
}

/**
 * Return the humans-registry room ID stored in the settings table, or null
 * when the settings row is absent. Read-only — no forceSave.
 */
export async function getHumansRegistryRoomId(): Promise<string | null> {
  return readSettingsValue(SETTINGS_KEY_HUMANS_REGISTRY);
}

function readSettingsValue(key: string): string | null {
  const row = db.$client
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (row === undefined) return null;
  return row.value;
}

// ---------------------------------------------------------------------------
// ensureRegistryRoomsExist — idempotent boot-time init
// ---------------------------------------------------------------------------

/**
 * Result of ensureRegistryRoomsExist. Discriminated on `ok` — mirrors the
 * matrix-admin-client convention but uses a `reason` string on the error
 * branch since this is a boot-time module coordinating multiple downstream
 * calls, not a single HTTP primitive.
 */
export type EnsureRegistryRoomsResult =
  | { ok: true; agentsRoomId: string; humansRoomId: string }
  | { ok: false; reason: string };

/**
 * Boot-safe idempotent init of the two registry rooms:
 *
 *   1. If getMatrixAdminCreds returns null → { ok:false, reason:"creds_missing" }.
 *      Boot before matrix-admin creds are available → clean no-throw bail; the
 *      caller (Plan 03's observation-loop bootstrap) will retry later.
 *
 *   2. Read both settings keys. If both present → return { ok:true, ... } —
 *      no-op happy path.
 *
 *   3. For each missing setting, call createRoom, persist the returned room_id
 *      to settings, then call addAdminRoom to populate the ignore-list (D-13).
 *      If createRoom fails for a given role, that role's settings row is NOT
 *      written and addAdminRoom is NOT called for it — the boot returns
 *      { ok:false, reason } so the caller can retry next tick.
 *
 * All settings writes are paired with a labeled forceSave.
 */
export async function ensureRegistryRoomsExist(): Promise<EnsureRegistryRoomsResult> {
  databaseLogger.info("registry rooms ensure start", {
    operation: "registry_rooms_ensure_start",
  });

  const creds = await getMatrixAdminCreds();
  if (!creds) {
    databaseLogger.info("registry rooms ensure skipped — creds missing", {
      operation: "registry_rooms_ensure_creds_missing",
    });
    return { ok: false, reason: "creds_missing" };
  }

  // Fast path: both already exist.
  const existingAgents = await getAgentsRegistryRoomId();
  const existingHumans = await getHumansRegistryRoomId();
  if (existingAgents !== null && existingHumans !== null) {
    databaseLogger.info("registry rooms ensure — both already present", {
      operation: "registry_rooms_ensure_noop",
      agentsRoomId: existingAgents,
      humansRoomId: existingHumans,
    });
    // Fixup H-2 (2026-09-08): self-heal any missing admin_rooms row. The
    // original createRegistryRoom writes settings FIRST then calls
    // addAdminRoom in a try/catch that only warns on failure. If addAdminRoom
    // failed on the first boot, subsequent boots hit this fast path and
    // NEVER retry the ignore-list add — permanently leaking the registry
    // room into every user's sidebar. Verify each roomId is in the
    // ignore-list; addAdminRoom (idempotent per Plan-01 store contract) if
    // missing.
    await selfHealAdminRoomsMembership("agents", existingAgents);
    await selfHealAdminRoomsMembership("humans", existingHumans);
    // Quick 260911-n8a — lockdown assertion on the fast path.
    await assertRegistryRoomLockdown("agents", existingAgents, creds.userId);
    await assertRegistryRoomLockdown("humans", existingHumans, creds.userId);
    return {
      ok: true,
      agentsRoomId: existingAgents,
      humansRoomId: existingHumans,
    };
  }

  // Slow path: create whichever is missing.
  let agentsRoomId = existingAgents;
  let humansRoomId = existingHumans;
  const failures: string[] = [];

  if (agentsRoomId === null) {
    const created = await createRegistryRoom(
      "agents",
      AGENTS_ROOM_NAME,
      AGENTS_ROOM_ALIAS_LOCALPART,
      creds.userId,
    );
    if (created.ok) {
      agentsRoomId = created.roomId;
      // Defensive: new rooms are birth-locked via createRoom's initial_state
      // (no observable open-write window). Still run the assertion — it
      // no-ops on well-locked content and repairs any drift on a room this
      // boot happened to create.
      await assertRegistryRoomLockdown("agents", agentsRoomId, creds.userId);
    } else {
      assertNotOk(created);
      failures.push(`agents: ${created.reason}`);
    }
  }

  if (humansRoomId === null) {
    const created = await createRegistryRoom(
      "humans",
      HUMANS_ROOM_NAME,
      HUMANS_ROOM_ALIAS_LOCALPART,
      creds.userId,
    );
    if (created.ok) {
      humansRoomId = created.roomId;
      await assertRegistryRoomLockdown("humans", humansRoomId, creds.userId);
    } else {
      assertNotOk(created);
      failures.push(`humans: ${created.reason}`);
    }
  }

  if (agentsRoomId === null || humansRoomId === null) {
    return {
      ok: false,
      reason: `registry_room_create_failed: ${failures.join("; ")}`,
    };
  }

  return { ok: true, agentsRoomId, humansRoomId };
}

/**
 * Fixup H-2 (2026-09-08). Verify a registry-room ID is present in the
 * admin_rooms ignore-list; if missing, call addAdminRoom to insert it.
 * addAdminRoom is idempotent (Plan-01 store contract — INSERT OR IGNORE
 * on room_id PRIMARY KEY), so a false-negative from isAdminRoom is
 * harmless — we just re-run an INSERT that turns into a no-op. Best-effort:
 * a downstream failure logs a warning and continues (matches
 * createRegistryRoom's addAdminRoom try/catch discipline).
 */
async function selfHealAdminRoomsMembership(
  role: "agents" | "humans",
  roomId: string,
): Promise<void> {
  try {
    const alreadyPresent = await isAdminRoom(roomId);
    if (alreadyPresent) return;
    databaseLogger.info(
      "registry rooms self-heal — admin_rooms row missing on fast path, adding",
      {
        operation: "registry_rooms_admin_room_self_heal",
        role,
        roomId,
      },
    );
    await addAdminRoom(roomId);
  } catch (err) {
    databaseLogger.warn("registry rooms self-heal check failed", {
      operation: "registry_rooms_admin_room_self_heal_failed",
      role,
      roomId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

/**
 * Internal helper: create ONE registry room via matrix-admin-client, persist
 * its room_id to the settings table, add it to the admin_rooms ignore-list
 * (D-13), and fire a labeled forceSave. Returns the roomId on success or a
 * failure reason string on any downstream failure.
 *
 * Quick 260911-n8a: birth-locked via createRoom's `initialState` — a single
 * m.room.power_levels state event is set at room-creation time so there is
 * NO observable open-write window. `fleetAdminMxid` is threaded from
 * ensureRegistryRoomsExist's already-loaded creds.userId; a null passed to
 * buildLockdownPowerLevelsContent means "assume Matrix defaults" (fresh
 * room), which the builder raises to the target invariants + adds
 * fleet-admin at 100.
 */
async function createRegistryRoom(
  role: "agents" | "humans",
  name: string,
  roomAliasName: string,
  fleetAdminMxid: string,
): Promise<{ ok: true; roomId: string } | { ok: false; reason: string }> {
  databaseLogger.info("registry rooms create fire", {
    operation: "registry_rooms_create_fire",
    role,
    name,
  });

  const { content: birthLockedPl } = buildLockdownPowerLevelsContent(
    fleetAdminMxid,
    null,
  );
  const created = await createRoom({
    name,
    preset: "private_chat",
    visibility: "private",
    roomAliasName,
    initialState: [
      {
        type: "m.room.power_levels",
        content: birthLockedPl,
      },
    ],
  });
  if (!created.ok) {
    assertNotOk(created);
    databaseLogger.warn("registry rooms create failed", {
      operation: "registry_rooms_create_failed",
      role,
      status: created.status,
      error: created.error,
    });
    return {
      ok: false,
      reason: `create_room_${created.status}_${created.error}`,
    };
  }

  const roomId = created.roomId;
  const settingsKey =
    role === "agents"
      ? SETTINGS_KEY_AGENTS_REGISTRY
      : SETTINGS_KEY_HUMANS_REGISTRY;

  db.$client
    .prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    )
    .run(settingsKey, roomId);

  try {
    await DatabaseSaveTrigger.forceSave("phase-89-registry-rooms-ensure");
  } catch (err) {
    databaseLogger.warn(
      "registry rooms settings persistence flush failed — write persisted to RAM only",
      {
        operation: "registry_rooms_force_save_failed",
        reason: "phase-89-registry-rooms-ensure",
        role,
        roomId,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
  }

  // D-13: add the fresh registry-room ID to the admin_rooms ignore-list so
  // the observation loop skips materializing it.
  databaseLogger.info("registry rooms addAdminRoom fire", {
    operation: "registry_rooms_add_admin_room",
    role,
    roomId,
  });
  try {
    await addAdminRoom(roomId);
  } catch (err) {
    databaseLogger.warn("registry rooms addAdminRoom failed", {
      operation: "registry_rooms_add_admin_room_failed",
      role,
      roomId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }

  return { ok: true, roomId };
}

// ---------------------------------------------------------------------------
// Join hooks (post-mint)
// ---------------------------------------------------------------------------

/**
 * Post-mint hook fired from runRelayMintAndWrite Step 6 (D-11). Reads the
 * stored agents-registry room ID and joins the newly-minted agent's Matrix
 * account to it via the admin joinRoom primitive. Returns the joinRoom
 * result verbatim (already a discriminated union).
 *
 * If ensureRegistryRoomsExist has not yet run successfully (settings row
 * absent), returns { ok:false, status:500, error:"registry_room_not_configured" }
 * WITHOUT calling joinRoom — best-effort semantics per D-12 (backfill
 * covers the gap).
 */
export async function joinAgentToAgentsRegistry(
  agentMxid: string,
): Promise<
  { ok: true; roomId: string } | { ok: false; status: number; error: string }
> {
  const roomId = await getAgentsRegistryRoomId();
  if (roomId === null) {
    return {
      ok: false,
      status: 500,
      error: "registry_room_not_configured",
    };
  }
  databaseLogger.info("registry rooms join agent", {
    operation: "registry_rooms_join",
    role: "agents",
    mxid: agentMxid,
    roomId,
  });
  return joinRoom(roomId, agentMxid);
}

/**
 * Post-mint hook fired from POST /users/create after createOrUpdateUser
 * succeeds (D-11). Mirrors joinAgentToAgentsRegistry for the humans room.
 */
export async function joinHumanToHumansRegistry(
  humanMxid: string,
): Promise<
  { ok: true; roomId: string } | { ok: false; status: number; error: string }
> {
  const roomId = await getHumansRegistryRoomId();
  if (roomId === null) {
    return {
      ok: false,
      status: 500,
      error: "registry_room_not_configured",
    };
  }
  databaseLogger.info("registry rooms join human", {
    operation: "registry_rooms_join",
    role: "humans",
    mxid: humanMxid,
    roomId,
  });
  return joinRoom(roomId, humanMxid);
}

// ---------------------------------------------------------------------------
// Registry-room lockdown (quick 260911-n8a)
// ---------------------------------------------------------------------------
//
// Both registry rooms (agents + humans) come out of every boot pass with
// their m.room.power_levels state event enforcing:
//   events_default=100, state_default=100, redact=100, invite=100,
//   kick=100, ban=100, historical=100, users[fleet-admin]=100.
//
// Applied BOTH at createRoom time via initial_state (birth-locked — no
// observable open-write window) AND via a boot-time idempotent
// read-then-optionally-write PATCH on m.room.power_levels (repairs drift
// on existing rooms).
//
// - Preserve any existing PL 100 humans in the users map.
// - Only ADD fleet-admin if missing.
// - Only RAISE defaults, never LOWER.
// - Preserve any levels already ABOVE 100 (e.g. kick=200 set by operator).
// - Preserve unrelated top-level fields (events, notifications, users_default).
// - Log-and-continue on any Matrix failure — boot must not fail because
//   the lockdown assertion couldn't reach Synapse. Retry happens next boot.
//
// Kills the 2026-09-11 failure mode where a misrouted forward landed in
// the ~90-member agents-registry room and fanned out as a chat message.
// Structural fix — the room itself refuses non-admin sends regardless of
// what upstream callers do.
// ---------------------------------------------------------------------------

/**
 * Well-known Matrix `m.room.power_levels` defaults, per the spec (see
 * shape doc L83-85). Used as the fallback when the incoming content is
 * null (state event unset) or when a field is missing from the incoming
 * content. Never inline these magic numbers — the merge logic
 * (RAISE-only rule) reads defaults from here.
 */
const PL_MATRIX_DEFAULTS: Readonly<{
  events_default: number;
  state_default: number;
  users_default: number;
  invite: number;
  kick: number;
  ban: number;
  redact: number;
  historical: number;
}> = {
  events_default: 0,
  state_default: 50,
  users_default: 0,
  invite: 0,
  kick: 50,
  ban: 50,
  redact: 50,
  historical: 100,
};

/**
 * Numeric-invariant target fields — each must sit at >= 100 in a locked
 * registry room. The merge logic (buildLockdownPowerLevelsContent) walks
 * this list, coerces each field to a number (defensively), and applies
 * `Math.max(existing, 100)` — RAISE-only rule.
 *
 * users_default is deliberately NOT in this list — it's an existing-user
 * default and is passed through unchanged.
 */
const PL_INVARIANT_FIELDS = [
  "events_default",
  "state_default",
  "redact",
  "invite",
  "kick",
  "ban",
  "historical",
] as const;

/**
 * Build the target `m.room.power_levels` content object enforcing all
 * lockdown invariants at >= 100 + fleet-admin at PL 100 in `users`, while
 * preserving every other field on the input content byte-identical.
 *
 * Rules:
 *   - RAISE-only per invariant: `target[field] = Math.max(existing[field] ?? default, 100)`.
 *     Never lowers.
 *   - `users` merge: shallow-copy existing users map (narrowed to
 *     `Record<string, number>` after per-entry `typeof` check); ADD
 *     fleetAdminMxid at 100 if not already >= 100; NEVER remove or lower
 *     an existing entry.
 *   - Every other field on the incoming content passes through unchanged
 *     (defensive against custom `events` / `notifications` / etc. that the
 *     operator may have set).
 *   - `needsPatch = false` iff every invariant is already at >= its
 *     target AND fleetAdminMxid is already in users at >= 100. Otherwise
 *     `needsPatch = true`.
 *
 * Pure function — no I/O, no logger. Tests unit it directly.
 *
 * @param fleetAdminMxid the admin account mxid that must sit at PL 100
 *   in `users` (source: `getMatrixAdminCreds().userId` from the caller).
 * @param existing the currently-fetched content, or `null` when the
 *   state event is unset (Matrix returns 404 — caller maps to null =
 *   "assume defaults").
 */
export function buildLockdownPowerLevelsContent(
  fleetAdminMxid: string,
  existing: Record<string, unknown> | null,
): { content: Record<string, unknown>; needsPatch: boolean } {
  // Copy every top-level field byte-identical (preserves `events`,
  // `notifications`, `users_default`, any unknown custom keys).
  const target: Record<string, unknown> =
    existing !== null ? { ...existing } : {};

  let needsPatch = false;

  // RAISE-only merge on each numeric invariant.
  for (const field of PL_INVARIANT_FIELDS) {
    const rawExisting = existing !== null ? existing[field] : undefined;
    const existingNum =
      typeof rawExisting === "number"
        ? rawExisting
        : PL_MATRIX_DEFAULTS[field];
    const targetNum = Math.max(existingNum, 100);
    target[field] = targetNum;
    if (targetNum !== existingNum) needsPatch = true;
    // Additional needsPatch signal: even if existing was a number and
    // already >= 100, if it was stored as a non-number typed value the
    // above branch coerced to the default and comparison catches it. Also:
    // if the existing top-level field was missing entirely (undefined),
    // rawExisting is undefined → existingNum falls back to default → any
    // default < 100 flips needsPatch.
    if (rawExisting === undefined && targetNum >= 100 && targetNum !== PL_MATRIX_DEFAULTS[field]) {
      needsPatch = true;
    }
  }

  // Users map merge.
  const existingUsersRaw =
    existing !== null && existing.users !== undefined ? existing.users : null;
  const existingUsers: Record<string, number> = {};
  if (existingUsersRaw !== null && typeof existingUsersRaw === "object") {
    for (const [k, v] of Object.entries(
      existingUsersRaw as Record<string, unknown>,
    )) {
      if (typeof v === "number") {
        existingUsers[k] = v;
      }
    }
  }
  const targetUsers: Record<string, number> = { ...existingUsers };
  const existingFleetAdmin = targetUsers[fleetAdminMxid];
  if (typeof existingFleetAdmin !== "number" || existingFleetAdmin < 100) {
    targetUsers[fleetAdminMxid] = 100;
    needsPatch = true;
  }
  target.users = targetUsers;

  // events sub-object merge — per-event overrides silently undercut
  // events_default:100. `events["m.room.message"] = 0` would leave non-admins
  // able to send messages regardless of the top-level lockdown. Raise every
  // numeric entry <100 to 100; preserve entries >=100 unchanged; drop
  // non-number entries (invalid PL values that would leave the map corrupted,
  // and events_default:100 governs anyway).
  const existingEventsRaw =
    existing !== null && existing.events !== undefined ? existing.events : null;
  if (
    existingEventsRaw !== null &&
    typeof existingEventsRaw === "object" &&
    !Array.isArray(existingEventsRaw)
  ) {
    const targetEvents: Record<string, number> = {};
    let eventsChanged = false;
    for (const [k, v] of Object.entries(
      existingEventsRaw as Record<string, unknown>,
    )) {
      if (typeof v === "number") {
        const raised = Math.max(v, 100);
        targetEvents[k] = raised;
        if (raised !== v) eventsChanged = true;
      } else {
        eventsChanged = true;
      }
    }
    target.events = targetEvents;
    if (eventsChanged) needsPatch = true;
  }

  return { content: target, needsPatch };
}

/**
 * Boot-time idempotent lockdown assertion for one registry room.
 *
 * Steps (all in try/catch — never throws; on any failure logs a
 * structured warn with role + roomId + reason and returns):
 *
 *   1. GET m.room.power_levels via getRoomPowerLevels(roomId).
 *      - AdminErr status:404 → treat as content=null (state event unset =
 *        "assume Matrix defaults").
 *      - AdminErr other → warn (operation="registry_rooms_lockdown_get_failed")
 *        and return; boot continues.
 *   2. buildLockdownPowerLevelsContent(fleetAdminMxid, contentOrNull).
 *      - `needsPatch === false` → info
 *        (operation="registry_rooms_lockdown_noop") and return. Zero-diff
 *        = zero writes.
 *   3. info (operation="registry_rooms_lockdown_patch_fire").
 *      putRoomPowerLevels(roomId, target).
 *      - AdminErr → warn (operation="registry_rooms_lockdown_patch_failed")
 *        and return.
 *      - Ok → info (operation="registry_rooms_lockdown_patched").
 *
 * Called from ensureRegistryRoomsExist on BOTH fast-path and slow-path
 * for each registry room every boot. `fleetAdminMxid` is threaded from
 * the caller's already-loaded creds.userId.
 */
export async function assertRegistryRoomLockdown(
  role: "agents" | "humans",
  roomId: string,
  fleetAdminMxid: string,
): Promise<void> {
  try {
    const got = await getRoomPowerLevels(roomId);
    let existingContent: Record<string, unknown> | null;
    if (got.ok) {
      existingContent = got.content;
    } else {
      // Not-ok branch: narrow to AdminErr shape (status/error). 404 = state
      // event unset → treat as null (assume Matrix defaults). Other non-ok
      // = warn-and-return; boot continues.
      assertNotOk(got);
      if (got.status === 404) {
        existingContent = null;
      } else {
        databaseLogger.warn("registry rooms lockdown GET failed", {
          operation: "registry_rooms_lockdown_get_failed",
          role,
          roomId,
          status: got.status,
          error: got.error,
        });
        return;
      }
    }

    const { content: target, needsPatch } = buildLockdownPowerLevelsContent(
      fleetAdminMxid,
      existingContent,
    );

    if (!needsPatch) {
      databaseLogger.info("registry rooms lockdown no-op", {
        operation: "registry_rooms_lockdown_noop",
        role,
        roomId,
      });
      return;
    }

    databaseLogger.info("registry rooms lockdown patch fire", {
      operation: "registry_rooms_lockdown_patch_fire",
      role,
      roomId,
    });

    const put = await putRoomPowerLevels(roomId, target);
    if (!put.ok) {
      assertNotOk(put);
      databaseLogger.warn("registry rooms lockdown PATCH failed", {
        operation: "registry_rooms_lockdown_patch_failed",
        role,
        roomId,
        status: put.status,
        error: put.error,
      });
      return;
    }

    databaseLogger.info("registry rooms lockdown patched", {
      operation: "registry_rooms_lockdown_patched",
      role,
      roomId,
    });
  } catch (err) {
    databaseLogger.warn("registry rooms lockdown assertion threw", {
      operation: "registry_rooms_lockdown_assert_failed",
      role,
      roomId,
      reason: err instanceof Error ? err.message : "unknown",
    });
  }
}
