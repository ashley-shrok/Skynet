import { authApi, handleApiError } from "@/main-axios";

// ─── Phase 143 Plan 143-05 (D-05 / D-06 / D-07) — listArchivedRoles ─────────
//
// Host-scoped GET that returns all archived roles for a given host. Parallels
// GET /roles?hostId=<n> (see identities-api.ts listRolesForHost) with the
// archive-list endpoint landed in 143-03.
//
// Endpoint:  GET /roles-archive?hostId=<n>
// Response:  ArchivedRoleListEntry[] — each entry carries the role name.
//            Minimal metadata (name alone) suffices for placeholder-row
//            rendering per D-05. The FALLBACK_HUE=190 hue-derivation pattern
//            (RolesListModal.tsx:62) can derive color from the name at render
//            time without the server emitting it.
//
// Host-scoping: host-scoped (D-07 — matches roles modal's host-scoped design).
//
// Errors flow through handleApiError (main-axios.ts).

export interface ArchivedRoleListEntry {
  name: string;
}

export async function listArchivedRoles(
  hostId: number,
): Promise<ArchivedRoleListEntry[]> {
  try {
    const response = await authApi.get("/roles-archive", {
      params: { hostId },
    });
    return response.data as ArchivedRoleListEntry[];
  } catch (error) {
    handleApiError(error, "list archived roles");
  }
}
