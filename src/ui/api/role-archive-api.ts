import { authApi, handleApiError } from "@/main-axios";

// ─── Phase 133 Plan 133-02 (D-01 / D-19) — archiveRole ──────────────────────
//
// One-shot POST that drops the `.archive-requested` intent sentinel on the
// role's home host. The backend route (133-01) handles the SFTP fanout via
// writeRoleFile; this frontend helper is a thin fetch wrapper mirroring the
// sibling identity-archive-api.ts shape byte-for-byte.
//
// Endpoint:  POST /roles/:name/archive
// Body:      { hostId: number }
// Response:  { ok: true }
//
// Errors are surfaced through handleApiError (main-axios.ts) so the caller
// sees the same ApiError / message shape every other API surface produces —
// keeps the RolesListModal catch-and-log path uniform with the identity
// archive caller's.
//
// No un-archive companion by design (D-19: one-way, no un-archive gesture).
// No batch shape (D-01: single sentinel drop; cascade complexity lives in the
// supervisor). If the operator wants to archive N roles, N clicks, N calls.

export async function archiveRole(
  hostId: number,
  roleName: string,
): Promise<{ ok: true }> {
  try {
    const url = `/roles/${encodeURIComponent(roleName)}/archive`;
    const response = await authApi.post(url, { hostId });
    return response.data as { ok: true };
  } catch (error) {
    handleApiError(error, "archive role");
  }
}
