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
import { createRoom, joinRoom } from "../matrix/matrix-admin-client.js";
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
    const created = await createRegistryRoom("agents", AGENTS_ROOM_NAME, AGENTS_ROOM_ALIAS_LOCALPART);
    if (created.ok) {
      agentsRoomId = created.roomId;
    } else {
      assertNotOk(created);
      failures.push(`agents: ${created.reason}`);
    }
  }

  if (humansRoomId === null) {
    const created = await createRegistryRoom("humans", HUMANS_ROOM_NAME, HUMANS_ROOM_ALIAS_LOCALPART);
    if (created.ok) {
      humansRoomId = created.roomId;
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
 */
async function createRegistryRoom(
  role: "agents" | "humans",
  name: string,
  roomAliasName: string,
): Promise<{ ok: true; roomId: string } | { ok: false; reason: string }> {
  databaseLogger.info("registry rooms create fire", {
    operation: "registry_rooms_create_fire",
    role,
    name,
  });

  const created = await createRoom({
    name,
    preset: "private_chat",
    visibility: "private",
    roomAliasName,
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
