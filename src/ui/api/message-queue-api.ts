import { authApi, handleApiError } from "@/main-axios";

export interface MessageQueueItem {
  id: string;
  hostId: number;
  tmuxSession: string | null;
  body: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MessageQueueKey {
  hostId: number;
  tmuxSession: string | null;
}

export async function listMessageQueueItems(
  key: MessageQueueKey,
): Promise<MessageQueueItem[]> {
  try {
    const params: Record<string, string> = { hostId: String(key.hostId) };
    if (key.tmuxSession != null) params.tmuxSession = key.tmuxSession;
    const response = await authApi.get("/message-queue", { params });
    return response.data ?? [];
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}

export async function createMessageQueueItem(
  key: MessageQueueKey,
  body: string = "",
): Promise<MessageQueueItem> {
  try {
    const response = await authApi.post("/message-queue", {
      hostId: key.hostId,
      tmuxSession: key.tmuxSession,
      body,
    });
    return response.data;
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}

export async function updateMessageQueueItem(
  id: string,
  patch: { body?: string; sortOrder?: number },
): Promise<MessageQueueItem> {
  try {
    const response = await authApi.patch(`/message-queue/${id}`, patch);
    return response.data;
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}

export async function deleteMessageQueueItem(id: string): Promise<void> {
  try {
    await authApi.delete(`/message-queue/${id}`);
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}

// Fire-and-forget PATCH that survives page unload — for flushing dirty
// drafts in pagehide/visibilitychange. Axios cancels in-flight XHRs on
// unload; fetch with keepalive:true is the modern browser primitive that
// stays in flight after the page is gone. Response is unreachable by
// design — treat this as best-effort.
export function flushMessageQueueItemKeepalive(id: string, body: string): void {
  try {
    const base = authApi.defaults.baseURL ?? "";
    const url = `${base}/message-queue/${id}`;
    fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
      credentials: "include",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // never throw during unload
  }
}
