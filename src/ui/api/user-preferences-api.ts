import { authApi, handleApiError } from "@/main-axios";

// Phase 15 (Wave 2) → Phase 92 Plan 04 (D-04) —
// thin wrapper around PUT /user-preferences for the pinned slice.
//
// Phase 92 changes:
// - getPinnedIds() is RETIRED. The hydrate path no longer routes through
//   GET /user-preferences for pinned ids. The panel derives pinnedIds by
//   projecting each identity's `pinned: boolean` field (populated on-demand
//   from disk by the backend per Plan 92-02) via
//   deriveDiskPinnedIds(identityHosts) exported from identities-store.ts.
// - putPinnedIds now takes a SECOND argument `identityHosts: Record<key, hostId>`
//   that the backend fanout (Plan 92-02 Task 2) uses to route each .pinned
//   sentinel write to the correct host. Same helper `buildIdentityHostsFromFleet`
//   (identities-store.ts L74-85) supplies both the read-side selector's arg
//   AND this write-side field (H2 lock — single derivation site invariant).
//
// (Phase 115 Plan 115-02: the Phase 107 `.hidden` sibling code path —
// getHiddenIds / putHiddenIds — was retired per D-21. The archive gesture
// ships in 115-06 via a dedicated POST endpoint, not a PUT array shape.)
//
// SC6 rollout scaffold preserved: putPinnedIds compares the server-echoed
// array to the input and console.warn on any divergence. The echoed value
// is the AUTHORITATIVE post-fanout disk state.

// Composite row ids from the conversation store take the shape
// `fleet::<hostId>::<identityKey>` (deriveDiskPinnedIds in identities-store.ts
// L125-140 emits them). The backend fanout at user-preferences.ts:273 expects
// BARE identityKeys — it does `if (!(key in identityHosts))` where
// identityHosts is keyed by bare identityKey. Passing composite ids
// unstripped 400s on every real pin toggle in production (bug found by
// unbiased code review after Plan 92-04 shipped — Frontend Plan 04 and
// Backend Plan 02 designed independent halves of a wire that never crossed
// in tests). The strip lives here at the wire boundary — not at every
// pin/unpin callsite — so the wire contract stays honest and future callers
// can't reintroduce the mismatch. Non-composite ids (already-bare, from
// tests or older callers) pass through untouched.
export function toBareIdentityKey(id: string): string {
  const parts = id.split("::");
  if (parts.length === 3 && parts[0] === "fleet") return parts[2];
  return id;
}

/**
 * Pin or unpin ONE identity — PUT /identities/:key/pinned writes/removes that
 * identity's `.pinned` sentinel on its host. This is the pin/unpin click path;
 * it replaces the whole-set putPinnedIds write, which let a stale tab clobber
 * another tab's pins and 400'd entirely on any unmappable id.
 */
export async function setIdentityPinned(
  identityKey: string,
  hostId: number,
  pinned: boolean,
): Promise<void> {
  try {
    await authApi.put(`/identities/${encodeURIComponent(identityKey)}/pinned`, {
      hostId,
      pinned,
    });
  } catch (error) {
    throw new Error(handleApiError(error, "set identity pin"));
  }
}

export async function putPinnedIds(
  ids: string[],
  identityHosts: Record<string, number>,
): Promise<string[]> {
  try {
    const bareIds = ids.map(toBareIdentityKey);
    const response = await authApi.put("/user-preferences", {
      pinnedConversationIds: bareIds,
      identityHosts,
    });
    const raw = response.data?.pinnedConversationIds;
    const echoed: string[] =
      Array.isArray(raw) && raw.every((v) => typeof v === "string")
        ? raw
        : bareIds;
    // SC6 rollout scaffold: deep-compare bare-sent vs echoed on every put.
    // Both sides are bare identityKeys post-strip (backend echoes bare from
    // its post-fanout disk re-derive; we send bare after the strip above),
    // so the comparison is honest. Divergence is the JSON-endpoint
    // equivalent of a silent-200 no-op — patch #77 generalised. Log but
    // do not throw; the server is authoritative.
    const diverged =
      bareIds.length !== echoed.length ||
      bareIds.some((v, i) => v !== echoed[i]);
    if (diverged) {
      console.warn("[pin-persistence] server echo mismatch", {
        sent: bareIds,
        echoed,
      });
    }
    return echoed;
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}

// (Phase 115 Plan 115-02: putHiddenIds retired per D-21 alongside the
//  backend HIDDEN FANOUT block. The archive gesture ships in 115-06.)

/**
 * Phase 137 D-10 / D-30 — upload a user avatar.
 *
 * PUTs multipart form-data to /users/:id/avatar (PUT /users/:id/avatar —
 * fully built in Phase 85; guarded by multipartOriginGuard +
 * authenticateJWT + assertOwnOrAdminForAvatarChange + userAvatarUpload).
 * The backend mints a new random filename per upload (writeUserAvatar),
 * which is the mechanism that makes the ?f={avatarPath} cache-buster on
 * the sidebar footer work naturally without manual invalidation.
 *
 * Uses authApi (not raw axios/fetch) so X-Skynet-Client-Build is stamped
 * on every request (version-drift hard-lock).
 */
export async function uploadUserAvatar(
  userId: string,
  file: File,
): Promise<{ avatarPath: string }> {
  try {
    const fd = new FormData();
    fd.append("avatar", file);
    const response = await authApi.put(
      `/users/${encodeURIComponent(userId)}/avatar`,
      fd,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return response.data as { id: string; avatarPath: string };
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}

/**
 * Phase 137 D-11 / D-30 — remove a user avatar.
 *
 * DELETEs /users/:id/avatar. On success the backend clears users.avatar_path
 * and removes the file from disk. The onAvatarChanged(null) callback in the
 * pane ensures the sidebar footer reverts to the initials-circle without a
 * page refresh.
 */
export async function removeUserAvatar(userId: string): Promise<void> {
  try {
    await authApi.delete(`/users/${encodeURIComponent(userId)}/avatar`);
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}
