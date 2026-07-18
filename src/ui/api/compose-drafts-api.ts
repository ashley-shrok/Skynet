import { authApi, handleApiError } from "@/main-axios";

// Patch #57: per-pane ComposeBox draft persistence client.
//
// Singleton draft per (userId, hostId, tmuxSession). The backend upserts
// so PUT is idempotent; GET returns { body: "" } when no row exists
// (never 404). tmuxSession is nullable at the wire — null means
// "non-tmux SSH host" — and the server coalesces to '' at the storage
// boundary. See routes/compose-drafts.ts for the NULL-KEY rationale.

export interface ComposeDraft {
  body: string;
}

export async function getComposeDraft(
  hostId: number,
  tmuxSession: string | null,
): Promise<ComposeDraft> {
  try {
    const params: Record<string, string> = { hostId: String(hostId) };
    if (tmuxSession != null) params.tmuxSession = tmuxSession;
    const response = await authApi.get("/compose-drafts", { params });
    return { body: response.data?.body ?? "" };
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}

export async function putComposeDraft(
  hostId: number,
  tmuxSession: string | null,
  body: string,
): Promise<void> {
  try {
    await authApi.put("/compose-drafts", {
      hostId,
      tmuxSession,
      body,
    });
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}

// Fire-and-forget PUT that survives page unload — for flushing a dirty
// draft in pagehide/visibilitychange. Axios cancels in-flight XHRs on
// unload; fetch with keepalive:true is the modern browser primitive
// that stays in flight after the page is gone. Response is unreachable
// by design — treat this as best-effort.
export function flushComposeDraftKeepalive(
  hostId: number,
  tmuxSession: string | null,
  body: string,
): void {
  try {
    const base = authApi.defaults.baseURL ?? "";
    const url = `${base}/compose-drafts`;
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostId, tmuxSession, body }),
      credentials: "include",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // never throw during unload
  }
}
