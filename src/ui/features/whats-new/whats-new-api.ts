import { authApi } from "@/main-axios";

export interface WhatsNewNote {
  id: string;
  text: string;
}

/** Notes this person hasn't seen yet, newest first (server: routes/whats-new.ts). */
export async function getWhatsNew(): Promise<WhatsNewNote[]> {
  const response = await authApi.get("/whats-new");
  return Array.isArray(response.data?.notes) ? response.data.notes : [];
}

export async function markWhatsNewSeen(ids: string[]): Promise<void> {
  await authApi.post("/whats-new/seen", { ids });
}
