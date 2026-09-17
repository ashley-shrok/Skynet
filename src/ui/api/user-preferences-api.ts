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
