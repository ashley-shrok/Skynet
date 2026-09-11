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
/**
 * Fixup N-3 (2026-09-08). Stable error code for the "expected response
 * field missing" case. Introduced as a semantic clarifier for createRoom
 * (which previously reused ERR_NO_TOKEN for its missing-room_id case —
 * confusing because there's no token concept in a createRoom response).
 * loginAsUser's actual missing-access-token case stays on ERR_NO_TOKEN.
 */
const ERR_MISSING_FIELD = "admin_api_missing_field";

/** Discriminated-union return shape shared by every primitive. */
type AdminOk<T> = { ok: true } & T;
export type AdminErr = { ok: false; status: number; error: string };

// Narrowing helpers live in ./matrix-admin-narrow.ts (separate module so
// external tests that `vi.mock("./matrix-admin-client")` don't need to also
// stub these helpers). Import them directly from the narrow module below.
import { assertAdminErr } from "./matrix-admin-narrow.js";

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
// countUsersMatching — GET /_synapse/admin/v2/users?user_id=<prefix>&deactivated=true&limit=1
// ---------------------------------------------------------------------------
//
// Substring filter on user_id; deactivated=true INCLUDES deactivated accounts
// (crucial — Synapse deactivates but never deletes; deactivated usernames stay
// reserved per Phase 80 pool-name allocator design). limit=1 because callers
// only need `total` — the users array is discarded.
//
// Substrate used by:
//   - Phase 80-03b (identity birth): compute ordinal suffix from current count
//     (e.g. `Willow-Skynet-Maintainer-2` when Willow-* count is 1).
//   - Phase 80-04 (`/identities/pool/pick`): confirm a pool-derived MXID handle
//     is still free before returning it to the frontend picker.

export type CountUsersOk = AdminOk<{ total: number }>;

export async function countUsersMatching(
  prefix: string,
): Promise<CountUsersOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  const url = `${creds.homeserverBase}/_synapse/admin/v2/users?user_id=${encodeURIComponent(prefix)}&deactivated=true&limit=1`;

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
    const parsed = (await response.json()) as { total?: number };
    return {
      ok: true,
      total: typeof parsed.total === "number" ? parsed.total : 0,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_count_users",
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
 * Build the JSON body recv.sh reads at `~/fleet/identities/<name>/relay.json`.
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
// getUserJoinedRooms — GET /_synapse/admin/v1/users/{mxid}/joined_rooms
// ---------------------------------------------------------------------------
//
// Top-level primitive extracted from getSharedDMRoom's internal helper in
// Phase 89-03 Task 1. The observation loop (Plan 89-03) polls each user's
// joined-rooms list on ~10s cadence and needs the failure REASON to drive
// per-user backoff decisions (D-06), so this primitive returns the standard
// discriminated-union shape rather than the previous internal-nullable that
// was cleaner for getSharedDMRoom's Promise.all-across-pairs use case.
// getSharedDMRoom now delegates to this primitive and collapses failures to
// null internally to preserve its existing null-tolerant callers.

export type GetUserJoinedRoomsOk = AdminOk<{ roomIds: string[] }>;

/**
 * List the Matrix rooms a user has joined.
 *
 * GET /_synapse/admin/v1/users/{mxid}/joined_rooms — Bearer admin auth.
 * Response `{ joined_rooms: string[] }` filtered to string-typed entries
 * only (defensive against wire-shape drift).
 *
 * Path-traversal defense: encodeURIComponent on the mxid (T-75-05 —
 * matches createOrUpdateUser L76 pattern).
 */
export async function getUserJoinedRooms(
  mxid: string,
): Promise<GetUserJoinedRoomsOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  const url = `${creds.homeserverBase}/_synapse/admin/v1/users/${encodeURIComponent(mxid)}/joined_rooms`;

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
    const parsed = (await response.json()) as { joined_rooms?: unknown };
    const roomIds = Array.isArray(parsed.joined_rooms)
      ? (parsed.joined_rooms.filter((r) => typeof r === "string") as string[])
      : [];
    return { ok: true, roomIds };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_get_user_joined_rooms",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}

// ---------------------------------------------------------------------------
// getRoomLatestEventTs — GET /_synapse/admin/v1/rooms/{roomId}/messages?dir=b&limit=1&filter={...}
// ---------------------------------------------------------------------------
//
// Phase 89-03 Task 1 (D-05 same-tick augmentation). Each observation-loop
// tick fetches the newest event timestamp per joined room so the stored
// last_activity_at field stays accurate for sidebar-sort UX. A brand-new
// room with no events yet returns { ok: true, ts: null } — the caller
// (observation loop) skips the refreshRelayRoomLastActivity call in that
// case.
//
// Phase 97 UAT batch #8 (2026-09-10): filters to `m.room.message` events
// only; state events (member/name/topic changes) are excluded from the
// timestamp. Pre-fix, state-event churn on otherwise-dead rooms inflated
// `last_activity_at`, making the sidebar promote quiet rooms just because a
// member joined/left or the topic changed.

export type GetRoomLatestEventTsOk = AdminOk<{ ts: number | null }>;

/**
 * Return the origin_server_ts (ms since epoch) of the newest event in a
 * room, or null if the room has no events yet.
 *
 * GET /_synapse/admin/v1/rooms/{roomId}/messages?dir=b&limit=1 —
 * `dir=b` = backward paging (newest first), `limit=1` = just the head.
 *
 * Path-traversal defense: encodeURIComponent on the roomId.
 */
export async function getRoomLatestEventTs(
  roomId: string,
): Promise<GetRoomLatestEventTsOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  // Phase 97 UAT batch #8 (2026-09-10): scope to `m.room.message` events so
  // state-event churn (member joins/leaves, name/topic changes) doesn't
  // inflate last_activity_at on rooms with no actual chat activity.
  const filter = JSON.stringify({ types: ["m.room.message"] });
  const url = `${creds.homeserverBase}/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=1&filter=${encodeURIComponent(filter)}`;

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
      chunk?: unknown;
    };
    if (!Array.isArray(parsed.chunk) || parsed.chunk.length === 0) {
      return { ok: true, ts: null };
    }
    const head = parsed.chunk[0] as { origin_server_ts?: unknown } | undefined;
    // Fixup L-3 (2026-09-08). Defensive: treat non-positive origin_server_ts
    // as null. Matrix spec guarantees origin_server_ts > 0 in practice, but
    // a 0 / negative value slipping through would render as 1970-01-01 in
    // the sidebar. Returning null is safer — refreshRelayRoomLastActivity
    // simply won't fire, so the previous last_activity_at is preserved.
    const rawTs =
      head && typeof head.origin_server_ts === "number"
        ? head.origin_server_ts
        : null;
    const ts = rawTs !== null && rawTs > 0 ? rawTs : null;
    return { ok: true, ts };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_get_room_latest_event_ts",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}

// ---------------------------------------------------------------------------
// getRoomJoinedMembers — GET /_synapse/admin/v1/rooms/{roomId}/members
// ---------------------------------------------------------------------------
//
// Phase 89-03 Task 1 — hoists the existing endpoint used inside
// getSharedDMRoom's L511 members-count loop to a top-level primitive with
// the standard discriminated-union return. The observation loop uses this
// (a) to enumerate members for the D-08/D-09 classifier decision, and (b)
// to fetch the agents-registry-room members for the D-09 authority set.

export type GetRoomJoinedMembersOk = AdminOk<{
  memberMxids: string[];
  total: number;
}>;

/**
 * List the mxids currently joined to a room, plus the reported total.
 *
 * GET /_synapse/admin/v1/rooms/{roomId}/members — Bearer admin auth.
 * Response `{ members?: string[], total?: number }`. On missing / wrong
 * type fields, falls back to memberMxids = [] and total = memberMxids.length
 * so the caller (classifier) sees a defensible zero rather than a throw.
 *
 * Path-traversal defense: encodeURIComponent on the roomId.
 */
export async function getRoomJoinedMembers(
  roomId: string,
): Promise<GetRoomJoinedMembersOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

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
    if (!response.ok) {
      return { ok: false, status: response.status, error: ERR_NON_2XX };
    }
    const parsed = (await response.json()) as {
      members?: unknown;
      total?: unknown;
    };
    const memberMxids = Array.isArray(parsed.members)
      ? (parsed.members.filter((m) => typeof m === "string") as string[])
      : [];
    const total =
      typeof parsed.total === "number" ? parsed.total : memberMxids.length;
    return { ok: true, memberMxids, total };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_get_room_joined_members",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
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
 * (bridge-config-writer.ts Plan 81-04) can Promise.all across pairs
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

  // Delegate to the top-level getUserJoinedRooms primitive (extracted from
  // the previous internal `joinedRooms` helper at Phase 89-03 Task 1).
  // Collapse discriminated-union errors to null to preserve this function's
  // existing null-tolerant signature — bridge-config-writer.ts + other
  // existing callers expect null-on-error.
  const [agentResult, humanResult] = await Promise.all([
    getUserJoinedRooms(agentMxid),
    getUserJoinedRooms(humanMxid),
  ]);
  const agentRooms = agentResult.ok ? agentResult.roomIds : null;
  const humanRooms = humanResult.ok ? humanResult.roomIds : null;
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

// ---------------------------------------------------------------------------
// getRoomName — GET /_matrix/client/v3/rooms/{roomId}/state/m.room.name
// ---------------------------------------------------------------------------
//
// Phase 89 fixup M-1 (2026-09-08). Read the m.room.name state event for a
// room. Called from the observation loop's Step 3 alongside
// getRoomJoinedMembers + getRoomLatestEventTs so the D-05 same-tick batch
// picks up the display name for materialized rows (relay_room_sessions.
// room_title, D-02).
//
// Uses the client-server API (NOT admin API — m.room.name is a client-
// server state-event concept and the admin API has no equivalent
// endpoint). The admin credential is a normal Matrix access_token that
// works on both APIs via Bearer auth — same pattern as createRoom.
//
// Return-shape choice: ok:true carries name:string|null (null for rooms
// with no m.room.name event set — Matrix returns 404 in that case; we
// map to name:null, ok:true because "no name" is legitimate data, not
// an error). Empty-string names are also treated as null.

export type GetRoomNameOk = AdminOk<{ name: string | null }>;

/**
 * Return the m.room.name of a room, or null if the state event is not set.
 *
 * GET /_matrix/client/v3/rooms/{roomId}/state/m.room.name
 *
 * Response parse:
 *   - 200 with `{ name: string }` → { ok:true, name }
 *   - 200 with missing / wrong-type / empty-string name → { ok:true, name:null }
 *   - 404 (state event unset — common for DMs / brand-new rooms) → { ok:true, name:null }
 *   - Other non-2xx → { ok:false, status, error }
 *
 * Path-traversal defense: encodeURIComponent on the roomId.
 */
export async function getRoomName(
  roomId: string,
): Promise<GetRoomNameOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  // Use Synapse admin room-details endpoint — works for server-admins
  // regardless of room membership. Response shape carries `name` directly
  // (null when unset), so no state-event filter needed. (Alice UAT
  // 2026-09-09 — swap out client-server /state/m.room.name which 403s
  // when admin isn't a room member.)
  const url = `${creds.homeserverBase}/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}`;

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
    // 404 from admin room-details = room doesn't exist. Return name:null
    // as legitimate data (matches prior client-server-404 = "name state
    // event unset" fallback shape).
    if (response.status === 404) {
      return { ok: true, name: null };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: ERR_NON_2XX };
    }
    const parsed = (await response.json()) as { name?: unknown };
    const name =
      typeof parsed.name === "string" && parsed.name.length > 0
        ? parsed.name
        : null;
    return { ok: true, name };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_get_room_name",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}

// ---------------------------------------------------------------------------
// createRoom — POST /_matrix/client/v3/createRoom
// ---------------------------------------------------------------------------
//
// Client-server API (NOT the admin API — the admin API has no createRoom
// endpoint). The admin credential is a normal Matrix access_token that
// works on both APIs, so we use the same Authorization: Bearer <token>
// pattern. Introduced Phase 89-02 for the two registry rooms (agents +
// humans) Skynet creates idempotently at boot (D-10).

export type CreateRoomOk = AdminOk<{ roomId: string; roomAlias?: string }>;

/**
 * Create a Matrix room via the client-server API.
 *
 * POST /_matrix/client/v3/createRoom
 *
 * Body fields:
 *   - `name` — display name (required arg).
 *   - `preset` — closed/invite-only room type; defaults to "private_chat"
 *     (see Matrix spec createRoom presets).
 *   - `visibility` — whether the room is published in the public room
 *     directory; defaults to "private".
 *   - `room_alias_name` — optional canonical alias localpart. When supplied,
 *     the returned room will have alias `#{alias}:{server_name}`.
 *
 * Response parse: expects `{ room_id: string, room_alias?: string }`. If
 * `room_id` is missing or the wrong type, returns
 * `{ ok:false, status:500, error:ERR_MISSING_FIELD }` (semantic clarifier
 * introduced by fixup N-3 2026-09-08 — previously reused ERR_NO_TOKEN,
 * which is confusing because there's no token concept in a createRoom
 * response).
 *
 * NEVER logs the admin access_token (proxy-error path scrubs).
 */
export async function createRoom(opts: {
  name: string;
  preset?: "private_chat" | "trusted_private_chat";
  visibility?: "public" | "private";
  roomAliasName?: string;
}): Promise<CreateRoomOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  const url = `${creds.homeserverBase}/_matrix/client/v3/createRoom`;
  const body: Record<string, unknown> = {
    name: opts.name,
    preset: opts.preset ?? "private_chat",
    visibility: opts.visibility ?? "private",
  };
  if (opts.roomAliasName !== undefined) {
    body.room_alias_name = opts.roomAliasName;
  }

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
    const parsed = (await response.json()) as {
      room_id?: unknown;
      room_alias?: unknown;
    };
    const roomId = parsed.room_id;
    if (typeof roomId !== "string" || roomId.length === 0) {
      // Fixup N-3 (2026-09-08). Renamed from ERR_NO_TOKEN → ERR_MISSING_FIELD
      // for semantic clarity — there's no token concept in a createRoom
      // response; the missing field is `room_id`.
      return { ok: false, status: 500, error: ERR_MISSING_FIELD };
    }
    const result: CreateRoomOk = { ok: true, roomId };
    if (typeof parsed.room_alias === "string" && parsed.room_alias.length > 0) {
      result.roomAlias = parsed.room_alias;
    }
    return result;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_create_room",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}

// ---------------------------------------------------------------------------
// deactivateUser — POST /_synapse/admin/v1/deactivate/{mxid}
// ---------------------------------------------------------------------------

// `AdminOk<Record<string, never>>` collapses to an impossible type under
// strict build settings (Docker build's tsc rejects `{ok:true}` as violating
// Record<string, never>). This primitive has no payload beyond the ok flag —
// just declare that directly.
export type DeactivateUserOk = { ok: true };

/**
 * Deactivate a Synapse account by mxid. Called from POST /users/create rollback
 * (Plan 03) and both delete paths (Plan 04). Best-effort at call sites — callers
 * log-and-proceed on non-ok per D-10.
 *
 * POST /_synapse/admin/v1/deactivate/{mxid}
 *
 * Body: sends explicit `erase` field set to false (defensive per RESEARCH.md
 * Assumption A3 — prevents accidental room-history erasure).
 */
export async function deactivateUser(
  mxid: string,
): Promise<DeactivateUserOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  const url = `${creds.homeserverBase}/_synapse/admin/v1/deactivate/${encodeURIComponent(mxid)}`;
  const body = { erase: false };

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
      operation: "matrix_admin_deactivate_user",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}

// ---------------------------------------------------------------------------
// getRoomMessages (Phase 90 Plan 03 Task 1) — GET /_matrix/client/v3/rooms/
// {roomId}/messages?dir={b|f}&from={cursor}&limit={n} — client-server API
// pagination by event-id cursor (Pitfall 5). Consumed by the Plan 04 WS
// server for the relay-room pane's initial history load AND scroll-back
// batches. Admin-mediated read — reads use admin creds (only sends need the
// per-user token, per T-90-BE-03 mitigation in sendMessageAsUser).
// ---------------------------------------------------------------------------

/**
 * Minimal Matrix event shape returned in a /messages chunk.
 *
 * Mirrors the Matrix client-server API event shape. `unsigned.transaction_id`
 * is the load-bearing field for Pitfall 4 (mqid ↔ txnId echo-back match):
 * Plan 06's optimistic-send matcher reads this to correlate a pending bubble
 * with its corresponding relay event when it lands back through /sync.
 */
export interface MatrixEvent {
  event_id: string;
  type: string;
  sender: string;
  origin_server_ts: number;
  content: Record<string, unknown>;
  unsigned?: { transaction_id?: string; [k: string]: unknown };
}

export type GetRoomMessagesOk = AdminOk<{
  events: MatrixEvent[];
  end?: string;
  start?: string;
}>;

/**
 * Fetch a batch of room messages with an event-id cursor.
 *
 * GET /_matrix/client/v3/rooms/{roomId}/messages?dir={dir}[&from={cursor}][&limit={n}]
 *
 * - `dir: "b"` = backward paging (older messages, newest-first order);
 *   `dir: "f"` = forward paging (newer messages).
 * - `from` = opaque event-id cursor from a prior response's `end` (for `dir=b`)
 *   or `start` (for `dir=f`). Omit on the first call to get the room tail.
 * - `limit` = batch size. Omit to let Synapse pick its default.
 *
 * Uses the admin token in Authorization — reads are admin-mediated (the
 * per-user-token path is used ONLY for sends per T-90-BE-03).
 *
 * Path-traversal defense: encodeURIComponent on roomId.
 *
 * Response parse: expects `{ chunk: MatrixEvent[], end?: string, start?: string }`.
 * If `chunk` is missing or not an array, returns ERR_MISSING_FIELD (500).
 * Entries that fail the MatrixEvent shape check are silently skipped rather
 * than failing the whole batch — a single malformed event should not crash a
 * history load.
 *
 * NEVER logs the admin access_token (proxy-error path scrubs — T-90-BE-01).
 */
export async function getRoomMessages(
  roomId: string,
  opts: { dir: "b" | "f"; from?: string; limit?: number },
): Promise<GetRoomMessagesOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  const params = new URLSearchParams();
  params.set("dir", opts.dir);
  if (opts.from !== undefined) {
    params.set("from", opts.from);
  }
  if (opts.limit !== undefined) {
    params.set("limit", String(opts.limit));
  }
  // Use Synapse admin API (v1.75+) — bypasses room-membership requirement.
  // Alice UAT 2026-09-09 + nicole diagnosis: the client-server /messages
  // endpoint requires the caller to be a room member (or public join_rules),
  // so admin-mediated reads 403'd on every user-created private relay room.
  // Synapse's admin equivalent works for server-admins regardless of
  // membership. Same response shape (chunk/start/end).
  const url = `${creds.homeserverBase}/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/messages?${params.toString()}`;

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
      chunk?: unknown;
      end?: unknown;
      start?: unknown;
    };
    if (!Array.isArray(parsed.chunk)) {
      return { ok: false, status: 500, error: ERR_MISSING_FIELD };
    }
    const events: MatrixEvent[] = [];
    for (const raw of parsed.chunk) {
      if (raw === null || typeof raw !== "object") continue;
      const ev = raw as {
        event_id?: unknown;
        type?: unknown;
        sender?: unknown;
        origin_server_ts?: unknown;
        content?: unknown;
        unsigned?: unknown;
      };
      if (typeof ev.event_id !== "string" || ev.event_id.length === 0) continue;
      if (typeof ev.type !== "string") continue;
      if (typeof ev.sender !== "string") continue;
      if (typeof ev.origin_server_ts !== "number") continue;
      if (ev.content === null || typeof ev.content !== "object") continue;
      const narrowed: MatrixEvent = {
        event_id: ev.event_id,
        type: ev.type,
        sender: ev.sender,
        origin_server_ts: ev.origin_server_ts,
        content: ev.content as Record<string, unknown>,
      };
      if (ev.unsigned !== undefined && ev.unsigned !== null && typeof ev.unsigned === "object") {
        narrowed.unsigned = ev.unsigned as MatrixEvent["unsigned"];
      }
      events.push(narrowed);
    }
    const result: GetRoomMessagesOk = { ok: true, events };
    if (typeof parsed.end === "string" && parsed.end.length > 0) {
      result.end = parsed.end;
    }
    if (typeof parsed.start === "string" && parsed.start.length > 0) {
      result.start = parsed.start;
    }
    return result;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_get_room_messages",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}

// ---------------------------------------------------------------------------
// sendMessageAsUser (Phase 90 Plan 03 Task 2) — PUT /_matrix/client/v3/rooms/
// {roomId}/send/m.room.message/{txnId} using a per-user access token minted
// via loginAsUser(senderMxid) — NOT the admin token.
//
// This is the T-90-BE-03 / Pitfall 3 mitigation. Reads (getRoomMessages,
// getRoomJoinedMembers, etc.) run on the admin token; WRITES on behalf of
// a user MUST use that user's own token so Matrix attributes the resulting
// event's `sender` field to the human user, not to @skynet-admin.
//
// The primitive composes with the existing loginAsUser primitive at L135.
// ---------------------------------------------------------------------------

export type SendMessageAsUserOk = AdminOk<{ eventId: string }>;

// ---------------------------------------------------------------------------
// Per-user access-token cache (H2 fixup 2026-09-09)
// ---------------------------------------------------------------------------
//
// Before H2, every sendMessageAsUser call ran a fresh loginAsUser round-trip
// to Synapse before the send PUT — an unnecessary admin-API request per
// message even when a valid token had just been minted milliseconds ago.
// At relay-room chat cadence (multiple sends per minute per user in an
// active group), this doubled the admin-token traffic to Synapse.
//
// Cache shape: module-scoped Map<mxid, {token, expiresAt}>. TTL is 1 hour,
// well within Synapse's default token lifespan. loginAsUser is called with
// `validUntilMs = Date.now() + TOKEN_CACHE_TTL_MS` so Synapse itself expires
// the token at the same time — a stolen cached token can't outlive the
// server-side lifetime.
//
// On send 401 (Synapse says the token is no longer valid — user password
// rotated, admin revoked the token, etc.), the cache entry is evicted and
// sendMessageAsUser retries ONCE with a freshly-minted token. Beyond one
// retry, subsequent failures are returned to the caller — retrying past
// that would only hide a real problem.
//
// Threat T-90-BE-01 preserved: tokens are only ever held in memory; the
// cache is never serialized. Logs never carry the token value.

const TOKEN_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedUserToken {
  token: string;
  expiresAt: number;
}

const userTokenCache = new Map<string, CachedUserToken>();

/**
 * Test-only reset. Clears every cached per-user token so a fresh test starts
 * from an empty cache.
 */
export function __resetUserTokenCacheForTests(): void {
  userTokenCache.clear();
}

/**
 * Get a cached token for `mxid` if it is present AND not yet expired.
 * Returns null on miss or expiry (expired entries are evicted).
 */
function getCachedUserToken(mxid: string, now: number): string | null {
  const entry = userTokenCache.get(mxid);
  if (entry === undefined) return null;
  if (entry.expiresAt <= now) {
    userTokenCache.delete(mxid);
    return null;
  }
  return entry.token;
}

/**
 * Store a freshly-minted user token in the cache with a TTL bounded by
 * TOKEN_CACHE_TTL_MS. The Synapse-side validity ceiling (passed via
 * validUntilMs on loginAsUser) matches this ceiling exactly.
 */
function putCachedUserToken(mxid: string, token: string, now: number): void {
  userTokenCache.set(mxid, {
    token,
    expiresAt: now + TOKEN_CACHE_TTL_MS,
  });
}

/**
 * Ensure a valid per-user token is cached; mint via loginAsUser on a miss
 * or expiry. Returns the token on success or the loginAsUser error verbatim
 * on failure (preserves the pre-H2 caller-visible error semantics).
 */
async function ensureUserToken(
  mxid: string,
): Promise<{ ok: true; token: string } | AdminErr> {
  const now = Date.now();
  const cached = getCachedUserToken(mxid, now);
  if (cached !== null) {
    return { ok: true, token: cached };
  }
  const login = await loginAsUser(mxid, now + TOKEN_CACHE_TTL_MS);
  if (login.ok === false) {
    return login;
  }
  putCachedUserToken(mxid, login.accessToken, now);
  return { ok: true, token: login.accessToken };
}

/**
 * Send an m.room.message into a room ON BEHALF OF the specified user.
 *
 * Uses loginAsUser-minted per-user token — NOT the admin token — so the
 * resulting Matrix event's sender is the human user, not @skynet-admin.
 * See Pitfall 3 in .planning/phases/90-relay-mediated-group-conversations-sub-slice-d-relay-session/90-RESEARCH.md.
 *
 * PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}
 *
 * - `senderMxid` — the human user whose relay identity the message is sent as.
 * - `roomId` — the target Matrix room.
 * - `body` — the message text (rendered verbatim; no shell escaping needed
 *   because this is HTTP JSON, not shell).
 * - `txnId` — the Matrix transaction ID. Plan 06 uses the frontend-generated
 *   mqid directly as the txnId so the Matrix `unsigned.transaction_id`
 *   echo-back matches on the way in (Pitfall 4 correlation infrastructure).
 *
 * Composition (H2 fixup 2026-09-09):
 *   1. ensureUserToken(senderMxid) → cached per-user token (mints on miss).
 *   2. PUT rooms/.../send/m.room.message/{txnId} with Bearer <that token>.
 *   3. On 401: evict cache entry, mint a fresh token, retry step 2 ONCE.
 *
 * If loginAsUser fails, its error is returned verbatim (no wrapping) so the
 * caller can distinguish auth-mint failures from send failures.
 *
 * Path-traversal defense: encodeURIComponent on BOTH roomId AND txnId
 * (PATTERNS.md § 6 / T-90-03-T1).
 *
 * NEVER logs the minted user token, the admin token, or the request body
 * content (Security V7 — T-90-BE-01 token leak defense + user-content privacy).
 */
export async function sendMessageAsUser(
  senderMxid: string,
  roomId: string,
  body: string,
  txnId: string,
): Promise<SendMessageAsUserOk | AdminErr> {
  // Step 1: obtain a per-user access token via the cache (mints on miss).
  const first = await ensureUserToken(senderMxid);
  if (first.ok === false) {
    return first;
  }

  // Step 2: attempt the send with the first token.
  const firstResult = await sendMessageOnce(
    first.token,
    senderMxid,
    roomId,
    body,
    txnId,
  );
  if (firstResult.retryable !== true) {
    return firstResult.result;
  }

  // Step 3 (H2): 401 on the send — evict the cached token and try ONCE more
  // with a freshly-minted token. Beyond one retry, subsequent failures are
  // returned to the caller.
  userTokenCache.delete(senderMxid);
  const second = await ensureUserToken(senderMxid);
  if (second.ok === false) {
    return second;
  }
  const retryResult = await sendMessageOnce(
    second.token,
    senderMxid,
    roomId,
    body,
    txnId,
  );
  return retryResult.result;
}

// ---------------------------------------------------------------------------
// inviteToRoom — POST /_matrix/client/v3/rooms/{roomId}/invite
// ---------------------------------------------------------------------------

export type InviteToRoomOk = { ok: true };

/**
 * Invite a Matrix user to a room. Called from Slice C's
 * `POST /relay-room/create` after room creation succeeds.
 *
 * POST /_matrix/client/v3/rooms/{roomId}/invite
 *
 * Body: { user_id: mxidToInvite }
 *
 * Two auth paths:
 * - If `senderMxid` is provided, the invite is sent via that user's own
 *   token (minted via `loginAsUser`) — matches the shape file's "the room
 *   is created via the user's own relay identity" requirement.
 * - If `senderMxid` is omitted, the invite is sent via admin creds
 *   (functional but attributes the invite to @skynet-admin — used only
 *   for internal/system flows).
 *
 * Follows all six per-primitive invariants at L1-46:
 *   1. getMatrixAdminCreds() — 500/creds-missing on null.
 *   2. encodeURIComponent on roomId path arg (T-91-02-T1 mitigate).
 *   3. Authorization: Bearer <token>.
 *   4. AbortController + 30s REQUEST_TIMEOUT_MS.
 *   5. clearTimeout in BOTH success and error paths.
 *   6. { ok: true } | AdminErr discriminated return (T-91-02-I1 mitigate).
 */
export async function inviteToRoom(
  roomId: string,
  mxidToInvite: string,
  senderMxid?: string,
): Promise<InviteToRoomOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  let accessToken: string;
  if (senderMxid !== undefined) {
    const login = await loginAsUser(senderMxid);
    if (!login.ok) return login;
    accessToken = login.accessToken;
  } else {
    accessToken = creds.accessToken;
  }

  // T-91-02-T1: encodeURIComponent on roomId — defense against path-traversal
  const url = `${creds.homeserverBase}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: mxidToInvite }),
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
      operation: "matrix_admin_invite_to_room",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}

// ---------------------------------------------------------------------------
// createRoomAsUser — POST /_matrix/client/v3/createRoom (user-scoped)
// ---------------------------------------------------------------------------

export type CreateRoomAsUserOk = AdminOk<{ roomId: string; roomAlias?: string }>;

/**
 * Create a Matrix room on behalf of a specific user (user is PL100 creator).
 *
 * POST /_matrix/client/v3/createRoom
 *
 * This is a peer of `createRoom` (L867) with one key difference: instead of
 * the admin token, it mints a per-user token via `loginAsUser(senderMxid)` so
 * the resulting room's creator is the user, not @skynet-admin.
 *
 * Shape file requirement: "A room is created on the relay via the user's own
 * relay identity." This ensures PL100 attribution — the sender is the room
 * creator — and is the reason this peer exists alongside the admin-scoped
 * `createRoom`.
 *
 * Follows all six per-primitive invariants at L1-46.
 * Defensive: a 200 response without room_id is treated as a Matrix-side
 * contract violation and returns ERR_PROXY (not a silent success with an
 * empty roomId).
 */
export async function createRoomAsUser(
  senderMxid: string,
  opts: {
    name: string;
    preset?: string;
    visibility?: "private" | "public";
    roomAliasName?: string;
  },
): Promise<CreateRoomAsUserOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  const login = await loginAsUser(senderMxid);
  if (!login.ok) {
    assertAdminErr(login);
    return login;
  }

  const url = `${creds.homeserverBase}/_matrix/client/v3/createRoom`;
  const body: Record<string, unknown> = {
    name: opts.name,
    preset: opts.preset ?? "private_chat",
    visibility: opts.visibility ?? "private",
  };
  if (opts.roomAliasName !== undefined) {
    body.room_alias_name = opts.roomAliasName;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${login.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return { ok: false, status: response.status, error: ERR_NON_2XX };
    }
    const parsed = (await response.json()) as {
      room_id?: unknown;
      room_alias?: unknown;
    };
    if (typeof parsed.room_id !== "string" || parsed.room_id.length === 0) {
      // Defensive: a 200 without room_id is a Matrix-side contract violation.
      return { ok: false, status: 502, error: ERR_PROXY };
    }
    const result: CreateRoomAsUserOk = { ok: true, roomId: parsed.room_id };
    if (typeof parsed.room_alias === "string" && parsed.room_alias.length > 0) {
      result.roomAlias = parsed.room_alias;
    }
    return result;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_create_room_as_user",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}

// ---------------------------------------------------------------------------
// sendMessageOnce (internal helper for sendMessageAsUser)
// ---------------------------------------------------------------------------

/**
 * One-shot send attempt. Returns `retryable: true` when the send hit a 401
 * (invalid/expired user token — evict cache + retry with a fresh mint);
 * returns `retryable: false` for every other outcome so the caller stops.
 */
async function sendMessageOnce(
  userToken: string,
  _senderMxid: string,
  roomId: string,
  body: string,
  txnId: string,
): Promise<{
  result: SendMessageAsUserOk | AdminErr;
  retryable: boolean;
}> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return {
      result: { ok: false, status: 500, error: ERR_CREDS_MISSING },
      retryable: false,
    };
  }

  const url = `${creds.homeserverBase}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        // CRITICAL (T-90-BE-03 / Pitfall 3): Bearer <userToken>, NOT
        // <creds.accessToken>. If the admin token is used here, every
        // message in the room is attributed to @skynet-admin instead of
        // the actual sender. Task 2 Test 2 is a dedicated regression
        // gate on this line.
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ msgtype: "m.text", body }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      // H2: only 401 is retryable (invalid/expired user token). Other
      // non-2xx responses go straight back to the caller so a rate-
      // limit or Matrix outage isn't hidden behind a retry.
      const retryable = response.status === 401;
      return {
        result: { ok: false, status: response.status, error: ERR_NON_2XX },
        retryable,
      };
    }
    const parsed = (await response.json()) as { event_id?: unknown };
    if (typeof parsed.event_id !== "string" || parsed.event_id.length === 0) {
      return {
        result: { ok: false, status: 500, error: ERR_MISSING_FIELD },
        retryable: false,
      };
    }
    return { result: { ok: true, eventId: parsed.event_id }, retryable: false };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        result: { ok: false, status: 504, error: ERR_TIMEOUT },
        retryable: false,
      };
    }
    // Security V7: log operation only. NEVER include the minted access token
    // (`userToken`), the admin token, or the request body (`body`
    // parameter) — the raw `err` object may serialize the fetch options in
    // some Node builds; databaseLogger's own scrubbing is the second line of
    // defense but we do not rely on it here. The `err` argument is passed as
    // the second positional so the logger's structured serializer captures
    // just its message + stack, not our composed request body.
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_send_message_as_user",
    });
    return {
      result: { ok: false, status: 502, error: ERR_PROXY },
      retryable: false,
    };
  }
}
