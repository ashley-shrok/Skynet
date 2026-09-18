import { authApi, handleApiError } from "@/main-axios";

// ─── Phase 117 Plan 117-06 (D-25 / D-28 / D-30) — project-list-api ──────────
//
// Thin fetch wrappers for the three /projects endpoints landed by Plan 117-04.
// Byte-shape mirror of identity-archive-api.ts: authApi + handleApiError, one
// try/catch per wrapper, no error swallowing.
//
// Endpoints:
//   GET  /projects?hostId=<n>          → { projects: ProjectSummary[] }
//   POST /projects                     body { hostId, displayName }
//                                        → { ok: true, slug }
//                                        (409 on duplicate slug → error
//                                         propagated via handleApiError with
//                                         the "create project" operation
//                                         label so the modal can detect it
//                                         and surface a specific message)
//   POST /projects/:slug/archive       body { hostId }
//                                        → { ok: true }
//
// Backend-authoritative slug derivation (D-25, Pitfall 1 in RESEARCH):
// createProject submits the raw displayName; the response body carries the
// slug produced by the backend's normalizeToSlug. The frontend NEVER computes
// the slug at runtime.
//
// Errors flow through handleApiError (main-axios.ts) so callers see the same
// ApiError / message shape every other API surface produces — keeps the
// callsite catch-and-log path uniform.

/**
 * Summary of a project as returned by GET /projects.
 * Backend guarantees archived===false in this list (GET /projects excludes
 * the archive/ subdir per D-30); the field is retained on the type for
 * symmetry with the wire-protocol schema.
 */
export type ProjectSummary = {
  slug: string;
  displayName: string;
  archived: boolean;
};

export async function listProjects(
  hostId: number,
): Promise<{ projects: ProjectSummary[] }> {
  try {
    const url = `/projects?hostId=${encodeURIComponent(String(hostId))}`;
    const response = await authApi.get(url);
    return response.data as { projects: ProjectSummary[] };
  } catch (error) {
    handleApiError(error, "list projects");
  }
}

export async function createProject(
  hostId: number,
  displayName: string,
): Promise<{ ok: true; slug: string }> {
  try {
    const response = await authApi.post("/projects", { hostId, displayName });
    return response.data as { ok: true; slug: string };
  } catch (error) {
    handleApiError(error, "create project");
  }
}

export async function archiveProject(
  hostId: number,
  slug: string,
): Promise<{ ok: true }> {
  try {
    const url = `/projects/${encodeURIComponent(slug)}/archive`;
    const response = await authApi.post(url, { hostId });
    return response.data as { ok: true };
  } catch (error) {
    handleApiError(error, "archive project");
  }
}

/**
 * Phase 117 Plan 117-07 (Fix 1 / D-05 relay-room carrier): boot-time
 * enumerator that returns every joined relay-room whose account_data carries
 * a `u.project.<slug>` tag. AppShell aggregates the per-host results into a
 * flat Map<roomId, slug> and passes it to setRoomProjectAssignments before
 * the first render.
 *
 * Endpoint: GET /relay-rooms/project-tags?hostId=<n>
 * Response: `{ assignments: Array<{ roomId: string, slug: string }> }`
 *
 * Partial-hydration discipline: per-room Matrix errors are swallowed
 * server-side (logged as warn, entry omitted from the returned array). The
 * frontend just consumes whatever the backend returns.
 */
export async function listRelayRoomProjectTags(
  hostId: number,
): Promise<{ assignments: Array<{ roomId: string; slug: string }> }> {
  try {
    const url = `/relay-rooms/project-tags?hostId=${encodeURIComponent(String(hostId))}`;
    const response = await authApi.get(url);
    return response.data as {
      assignments: Array<{ roomId: string; slug: string }>;
    };
  } catch (error) {
    handleApiError(error, "list relay-room project tags");
  }
}
