import { authApi, handleApiError } from "@/main-axios";

// ─── Phase 115 Plan 115-06 (D-07 / D-08 / D-17) — archiveIdentity ───────────
//
// One-shot POST that drops the `.archive-requested` intent sentinel on the
// identity's home host. The backend route (115-03) handles the fanout via
// writeIdentityFile; this frontend helper is a thin fetch wrapper mirroring
// the sibling identities-api.ts shape.
//
// Endpoint:  POST /identities/:key/archive
// Body:      { hostId: number }
// Response:  { ok: true }
//
// Errors are surfaced through handleApiError (main-axios.ts) so the caller
// sees the same ApiError / message shape every other API surface produces —
// keeps the panel's catch-and-log path uniform.
//
// No un-archive companion by design (D-05). No batch shape. One identity,
// one call. If the user needs to archive N identities she clicks N times.

export async function archiveIdentity(
  hostId: number,
  identityKey: string,
): Promise<{ ok: true }> {
  try {
    const url = `/identities/${encodeURIComponent(identityKey)}/archive`;
    const response = await authApi.post(url, { hostId });
    return response.data as { ok: true };
  } catch (error) {
    handleApiError(error, "archive identity");
  }
}
