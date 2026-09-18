import { authApi, handleApiError } from "@/main-axios";

// ─── Phase 117 Plan 117-06 (D-05 / D-05a) — session-project-api ─────────────
//
// Frontend wrappers for the session-project-write (identity route) and the
// relay-room-project-tag (Matrix route) endpoints landed by Plan 117-05.
// Both accept null as the third argument to CLEAR the project membership
// (writer strips the frontmatter field / m.tag entry respectively per
// D-05a's read-modify-write discipline).
//
// Endpoints:
//   POST /identities/:key/project           body { hostId, project }
//                                             → { ok: true }
//   POST /relay-rooms/:roomId/project       body { userMxid, project }
//                                             → { ok: true }
//
// Byte-shape mirror of identity-archive-api.ts. authApi + handleApiError,
// one try/catch per wrapper, no error swallowing.

export async function setSessionProject(
  hostId: number,
  identityKey: string,
  projectSlug: string | null,
): Promise<{ ok: true }> {
  try {
    const url = `/identities/${encodeURIComponent(identityKey)}/project`;
    const response = await authApi.post(url, {
      hostId,
      project: projectSlug,
    });
    return response.data as { ok: true };
  } catch (error) {
    handleApiError(error, "set session project");
  }
}

export async function setRelayRoomProject(
  roomId: string,
  userMxid: string,
  projectSlug: string | null,
): Promise<{ ok: true }> {
  try {
    const url = `/relay-rooms/${encodeURIComponent(roomId)}/project`;
    const response = await authApi.post(url, {
      userMxid,
      project: projectSlug,
    });
    return response.data as { ok: true };
  } catch (error) {
    handleApiError(error, "set relay room project");
  }
}
