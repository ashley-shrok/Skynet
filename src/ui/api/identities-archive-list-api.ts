import { authApi, handleApiError } from "@/main-axios";

// ─── Phase 143 Plan 143-05 (D-05 / D-06 / D-07) — listArchivedIdentities ────
//
// Fleet-wide GET that returns all archived identities. Exposes the existing
// internal primitive at `src/backend/claude-session/list-archived-identity-keys.ts`
// (D-06 — no new listing logic needed, just the HTTP surface).
//
// Endpoint:  GET /identities-archive
// Response:  ArchivedIdentityListEntry[] — each entry carries identityKey +
//            hostId. The compound key `${hostId}:${identityKey}` mirrors how
//            the live conversation panel keys its identity tiles.
//
// Host-scoping: fleet-wide (D-07 — matches conversation search's fleet-wide scope).
//
// Errors flow through handleApiError (main-axios.ts) for a uniform ApiError.

export interface ArchivedIdentityListEntry {
  identityKey: string;
  hostId: number;
}

export async function listArchivedIdentities(): Promise<
  ArchivedIdentityListEntry[]
> {
  try {
    const response = await authApi.get("/identities-archive");
    return response.data as ArchivedIdentityListEntry[];
  } catch (error) {
    handleApiError(error, "list archived identities");
  }
}
