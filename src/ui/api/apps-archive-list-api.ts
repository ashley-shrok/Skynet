import { authApi, handleApiError } from "@/main-axios";

// ─── Phase 143 Plan 143-05 (D-05 / D-06 / D-07) — listArchivedApps ──────────
//
// Fleet-wide GET that returns all archived apps. Parallels the fleet-wide
// archived-identities list and mirrors how live apps are keyed in the sidebar:
// `${hostId}:${slug}` (PrettyConversationsPanel.tsx:3025).
//
// Endpoint:  GET /apps-archive
// Response:  ArchivedAppListEntry[] — compound key is hostId:slug. title +
//            iconUrl are OPTIONAL: if the archived app folder carries a
//            title.txt or an icon-serving path the backend may populate them;
//            absent = caller renders slug as fallback.
//
// Host-scoping: fleet-wide (D-07 — matches how sidebar apps are shown mixed
//               across hosts).
//
// Errors flow through handleApiError (main-axios.ts).

export interface ArchivedAppListEntry {
  hostId: number;
  slug: string;
  title?: string;
  iconUrl?: string;
}

export async function listArchivedApps(): Promise<ArchivedAppListEntry[]> {
  try {
    const response = await authApi.get("/apps-archive");
    return response.data as ArchivedAppListEntry[];
  } catch (error) {
    handleApiError(error, "list archived apps");
  }
}
