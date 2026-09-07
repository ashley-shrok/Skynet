// matrix-admin-client — thin fetch wrapper around the five Synapse admin API
// endpoints Skynet needs, plus a pure helper for building the relay.json body
// recv.sh consumes.
//
// Shape mirrors voice.ts handleSpeak (src/backend/database/routes/voice.ts
// L200-275): Node built-in fetch + AbortController timeout + non-2xx as a
// stable discriminated-union error + never leak upstream body or admin token.
//
// Every primitive:
//   1. resolves creds via getMatrixAdminCreds(); returns 500/creds-missing if null.
//   2. builds URL with encodeURIComponent() on every externally-supplied path arg
//      (defense against T-75-05 mxid path-traversal — PATTERNS.md security-critical).
//   3. sends Authorization: Bearer <token> + Content-Type: application/json.
//   4. wraps in AbortController with REQUEST_TIMEOUT_MS = 30_000.
//   5. returns { ok:true, ... } | { ok:false, status, error } — never leaks
//      upstream body, never logs the admin token or its prefix.
//   6. clearTimeout() in both success and error paths.

import { databaseLogger } from "../utils/logger.js";
import { getMatrixAdminCreds } from "./matrix-admin-creds-store.js";

/** 30s AbortController timeout for every admin fetch. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Default paging cap for listRooms (Assumption A7 — defensive against large
 * responses; caller can override up to Synapse's own cap). */
const DEFAULT_LIST_LIMIT = 200;

/** Stable error code emitted when getMatrixAdminCreds() returns null. */
const ERR_CREDS_MISSING = "matrix_admin_creds_missing";
/** Stable error code emitted when the Synapse admin API replies non-2xx. */
const ERR_NON_2XX = "admin_api_non_2xx";
/** Stable error code emitted on AbortError (30s timeout expired). */
const ERR_TIMEOUT = "admin_api_timeout";
/** Stable error code emitted on any other thrown error (network/parse). */
const ERR_PROXY = "admin_api_proxy_error";
/** Stable error code emitted when loginAsUser gets a 2xx without access_token. */
const ERR_NO_TOKEN = "admin_api_no_token";

/** Discriminated-union return shape shared by every primitive. */
type AdminOk<T> = { ok: true } & T;
type AdminErr = { ok: false; status: number; error: string };

// ---------------------------------------------------------------------------
// createOrUpdateUser — PUT /_synapse/admin/v2/users/{mxid}
// ---------------------------------------------------------------------------

/** Successful mint-or-update: returns the request password so caller can
 * hand it to the target host (relay.json), plus the actual response status
 * so caller can distinguish create (201) from update (200) if it cares. */
export type CreateOrUpdateUserOk = AdminOk<{
  mxid: string;
  password: string;
  status: number;
}>;

/**
 * Mint or update a Synapse account.
 *
 * PUT /_synapse/admin/v2/users/{mxid} — treats both 200 (updated existing)
 * and 201 (created new) as success (RESEARCH.md Pitfall 5). Optional
 * `displayname` is only sent when supplied.
 *
 * Idempotent per the Synapse admin API contract; safe to retry.
 */
export async function createOrUpdateUser(
  mxid: string,
  password: string,
  displayname?: string,
): Promise<CreateOrUpdateUserOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  const url = `${creds.homeserverBase}/_synapse/admin/v2/users/${encodeURIComponent(mxid)}`;
  const body: Record<string, unknown> = {
    password,
    admin: false,
    deactivated: false,
  };
  if (displayname !== undefined) {
    body.displayname = displayname;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return { ok: false, status: response.status, error: ERR_NON_2XX };
    }
    return { ok: true, mxid, password, status: response.status };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_create_or_update_user",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}

// ---------------------------------------------------------------------------
// loginAsUser — POST /_synapse/admin/v1/users/{mxid}/login
// ---------------------------------------------------------------------------

export type LoginAsUserOk = AdminOk<{ accessToken: string }>;

/**
 * Mint a fresh access_token for a user WITHOUT knowing their password
 * (admin-only endpoint). Optional `validUntilMs` caps the token's lifetime.
 *
 * POST /_synapse/admin/v1/users/{mxid}/login
 */
export async function loginAsUser(
  mxid: string,
  validUntilMs?: number,
): Promise<LoginAsUserOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  const url = `${creds.homeserverBase}/_synapse/admin/v1/users/${encodeURIComponent(mxid)}/login`;
  const body = validUntilMs !== undefined ? { valid_until_ms: validUntilMs } : {};

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return { ok: false, status: response.status, error: ERR_NON_2XX };
    }
    const parsed = (await response.json()) as { access_token?: string };
    const accessToken = parsed.access_token;
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      return { ok: false, status: 500, error: ERR_NO_TOKEN };
    }
    return { ok: true, accessToken };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_login_as_user",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}

// ---------------------------------------------------------------------------
// joinRoom — POST /_synapse/admin/v1/join/{roomIdOrAlias}
// ---------------------------------------------------------------------------

export type JoinRoomOk = AdminOk<{ roomId: string }>;

/**
 * Force a user (default: @skynet-admin itself) into a room. Covers the
 * legacy-room mess where Skynet needs to elevate itself into rooms it did
 * not create.
 *
 * POST /_synapse/admin/v1/join/{roomIdOrAlias}
 */
export async function joinRoom(
  roomIdOrAlias: string,
  userId?: string,
): Promise<JoinRoomOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  const url = `${creds.homeserverBase}/_synapse/admin/v1/join/${encodeURIComponent(roomIdOrAlias)}`;
  const body = { user_id: userId ?? creds.userId };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return { ok: false, status: response.status, error: ERR_NON_2XX };
    }
    const parsed = (await response.json()) as { room_id?: string };
    const roomId = typeof parsed.room_id === "string" ? parsed.room_id : roomIdOrAlias;
    return { ok: true, roomId };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_join_room",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}

// ---------------------------------------------------------------------------
// makeRoomAdmin — POST /_synapse/admin/v1/rooms/{roomIdOrAlias}/make_room_admin
// ---------------------------------------------------------------------------

// `AdminOk<Record<string, never>>` collapses to an impossible type under
// strict build settings (Docker build's tsc rejects `{ok:true}` as violating
// Record<string, never>). This primitive has no payload beyond the ok flag —
// just declare that directly.
export type MakeRoomAdminOk = { ok: true };

/**
 * Elevate a user (default: @skynet-admin itself) to PL100 in a room. Used
 * after joinRoom on legacy rooms whose original creator is gone.
 *
 * POST /_synapse/admin/v1/rooms/{roomIdOrAlias}/make_room_admin
 */
export async function makeRoomAdmin(
  roomIdOrAlias: string,
  userId?: string,
): Promise<MakeRoomAdminOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  const url = `${creds.homeserverBase}/_synapse/admin/v1/rooms/${encodeURIComponent(roomIdOrAlias)}/make_room_admin`;
  const body = { user_id: userId ?? creds.userId };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return { ok: false, status: response.status, error: ERR_NON_2XX };
    }
    return { ok: true };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_make_room_admin",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}

// ---------------------------------------------------------------------------
// listRooms — GET /_synapse/admin/v1/rooms
// ---------------------------------------------------------------------------

export type ListRoomsOk = AdminOk<{ rooms: unknown[]; nextBatch?: number }>;

/**
 * Paginated room list from Synapse. `limit` defaults to 200 (defensive
 * cap — Assumption A7), `from` defaults to 0 (start of paging).
 *
 * GET /_synapse/admin/v1/rooms?limit={limit}&from={from}
 */
export async function listRooms(
  limit?: number,
  from?: number,
): Promise<ListRoomsOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  const effectiveLimit = limit ?? DEFAULT_LIST_LIMIT;
  const effectiveFrom = from ?? 0;
  const url = `${creds.homeserverBase}/_synapse/admin/v1/rooms?limit=${encodeURIComponent(String(effectiveLimit))}&from=${encodeURIComponent(String(effectiveFrom))}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return { ok: false, status: response.status, error: ERR_NON_2XX };
    }
    const parsed = (await response.json()) as {
      rooms?: unknown[];
      next_batch?: number;
    };
    const rooms = Array.isArray(parsed.rooms) ? parsed.rooms : [];
    const result: ListRoomsOk = { ok: true, rooms };
    if (typeof parsed.next_batch === "number") {
      result.nextBatch = parsed.next_batch;
    }
    return result;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_list_rooms",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}

// ---------------------------------------------------------------------------
// buildRelayJsonBody — pure helper
// ---------------------------------------------------------------------------

/** Inputs for buildRelayJsonBody. `accessToken` populates BOTH `token` and
 * `access_token` in the emitted JSON — recv.sh reads either (belt-and-braces
 * defensively across historical schema variants). */
export interface BuildRelayJsonBodyOpts {
  mxid: string;
  password: string;
  accessToken: string;
  homeserverBase: string;
}

/**
 * Build the JSON body recv.sh reads at `~/.claude/identities/<name>/relay.json`.
 *
 * Emits exactly five keys — base, user_id, password, token, access_token —
 * matching the shape defined in substrate/skills/agent-relay/SKILL.md L100-116
 * and consumed by recv.sh (L25-32 base/uid resolution, L49-59 relogin
 * self-heal, L82-91 media root derivation).
 *
 * CRITICAL: `base` MUST end in `/_matrix/client/v3` — recv.sh strips that
 * suffix to derive MROOT for the media endpoints. Do not drop.
 */
export function buildRelayJsonBody(opts: BuildRelayJsonBodyOpts): string {
  const base = `${opts.homeserverBase}/_matrix/client/v3`;
  const body = {
    base,
    user_id: opts.mxid,
    password: opts.password,
    token: opts.accessToken,
    access_token: opts.accessToken,
  };
  return JSON.stringify(body, null, 2);
}

// ---------------------------------------------------------------------------
// getSharedDMRoom — free helper composing joined_rooms + rooms/members
// ---------------------------------------------------------------------------

/**
 * Return the first Matrix room_id where BOTH agentMxid and humanMxid are
 * joined AND the total joined-member count is exactly 2 (i.e. a DM room).
 * Returns null when no such room exists, when either user's joined_rooms
 * call fails, or when creds are absent.
 *
 * Never throws — every error path collapses to null so the caller
 * (bridge-config-writer.ts Plan 83-04) can Promise.all across pairs
 * without try/catch at every site. Discriminated-union errors would
 * force the caller to unwrap on every element; a nullable is cleaner
 * for the "best-effort discover then fall back" pattern.
 *
 * Path-traversal defense: encodeURIComponent on every mxid AND every
 * candidate room_id (T-75-05 — matches createOrUpdateUser L76 pattern).
 *
 * Timeouts: each fetch wrapped in a fresh AbortController + 30s timeout
 * matching REQUEST_TIMEOUT_MS. clearTimeout on both branches.
 */
export async function getSharedDMRoom(
  agentMxid: string,
  humanMxid: string,
): Promise<string | null> {
  const creds = await getMatrixAdminCreds();
  if (!creds) return null;

  // Helper: fetch a user's joined_rooms; returns null on any non-2xx or throw.
  async function joinedRooms(mxid: string): Promise<string[] | null> {
    const url = `${creds!.homeserverBase}/_synapse/admin/v1/users/${encodeURIComponent(mxid)}/joined_rooms`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${creds!.accessToken}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) return null;
      const parsed = (await response.json()) as { joined_rooms?: unknown };
      return Array.isArray(parsed.joined_rooms)
        ? (parsed.joined_rooms.filter((r) => typeof r === "string") as string[])
        : null;
    } catch {
      clearTimeout(timeoutId);
      return null;
    }
  }

  const [agentRooms, humanRooms] = await Promise.all([
    joinedRooms(agentMxid),
    joinedRooms(humanMxid),
  ]);
  if (agentRooms === null || humanRooms === null) return null;

  const humanSet = new Set(humanRooms);
  const shared = agentRooms.filter((r) => humanSet.has(r));
  if (shared.length === 0) return null;

  // Serialize member-count checks so we short-circuit on the first match
  // (typical case: at most 1-2 shared rooms — parallelizing gives no win).
  for (const roomId of shared) {
    const url = `${creds.homeserverBase}/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/members`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) continue;
      const parsed = (await response.json()) as {
        members?: unknown;
        total?: unknown;
      };
      const total =
        typeof parsed.total === "number"
          ? parsed.total
          : Array.isArray(parsed.members)
            ? parsed.members.length
            : -1;
      if (total === 2) return roomId;
    } catch {
      clearTimeout(timeoutId);
      continue;
    }
  }
  return null;
}
