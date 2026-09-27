import { authApi, handleApiError } from "@/main-axios";

// ─── archiveApp — app-archive shape ─────────────────────────────────────────
//
// One-shot POST that drops the `.archive-requested` intent sentinel on the
// app folder on the owning host. The backend route (apps-archive.ts) handles
// the SFTP fanout via writeAppFile; this frontend helper is a thin fetch
// wrapper mirroring the sibling identity-archive-api.ts / role-archive-api.ts
// shape.
//
// Endpoint:  POST /apps/:hostId/:slug/archive
// Body:      (empty — hostId is in the URL path, matching the app-domain
//             convention established by GET /apps/:hostId/:slug and
//             /apps/:hostId/:slug/icon)
// Response:  { ok: true }
//
// Errors are surfaced through handleApiError (main-axios.ts) so the caller
// sees the same ApiError / message shape every other API surface produces —
// keeps the AppTile catch-and-log path uniform with the identity + role
// archive callers'.
//
// No un-archive companion by design (parity with role-archive-api.ts D-19).
// The agent-side restore path (restore-app.sh in the app-development skill)
// remains available.

export async function archiveApp(
  hostId: number,
  slug: string,
): Promise<{ ok: true }> {
  try {
    const url = `/apps/${hostId}/${encodeURIComponent(slug)}/archive`;
    const response = await authApi.post(url);
    return response.data as { ok: true };
  } catch (error) {
    handleApiError(error, "archive app");
  }
}
