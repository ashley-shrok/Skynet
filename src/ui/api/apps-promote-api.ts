import { authApi, handleApiError } from "@/main-axios";

/**
 * convo-scoped apps: ask the agent that owns a conversation app to move it to
 * the sidebar. The backend drops an event into the agent's inbox; the agent
 * does the move and confirms in its conversation.
 */
export async function requestAppPromotion(
  hostId: number,
  slug: string,
): Promise<{ ok: true }> {
  try {
    const url = `/apps/${hostId}/${encodeURIComponent(slug)}/promote-request`;
    const response = await authApi.post(url);
    return response.data as { ok: true };
  } catch (error) {
    handleApiError(error, "request moving the app to the sidebar");
  }
}
