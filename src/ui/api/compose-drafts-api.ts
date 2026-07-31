import { authApi, handleApiError } from "@/main-axios";

// Patch #57: per-pane ComposeBox draft persistence client.
//
// Singleton draft per (userId, hostId, tmuxSession). The backend upserts
// so PUT is idempotent; GET returns { body: "", queueSlots: [] } when no row
// exists (never 404). tmuxSession is nullable at the wire — null means
// "non-tmux SSH host" — and the server coalesces to '' at the storage
// boundary. See routes/compose-drafts.ts for the NULL-KEY rationale.
//
// Bounty message-queue-in-pretty-view: ComposeDraft extended with queueSlots.
// putComposeDraft and flushComposeDraftKeepalive now accept and send queueSlots
// alongside body. getComposeDraft defensively parses queueSlots from the server
// response, defaulting to [] on missing or malformed data.

export interface ComposeDraft {
  body: string;
  queueSlots: Array<{ id: string; text: string }>;
}

export async function getComposeDraft(
  hostId: number,
  tmuxSession: string | null,
): Promise<ComposeDraft> {
  try {
    const params: Record<string, string> = { hostId: String(hostId) };
    if (tmuxSession != null) params.tmuxSession = tmuxSession;
    const response = await authApi.get("/compose-drafts", { params });
    const body = response.data?.body ?? "";
    // Client-side defensive parse mirrors server-side; belt-and-suspenders.
    const rawSlots = response.data?.queueSlots;
    let queueSlots: Array<{ id: string; text: string }> = [];
    if (
      Array.isArray(rawSlots) &&
      rawSlots.every(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          typeof item.text === "string",
      )
    ) {
      queueSlots = rawSlots as Array<{ id: string; text: string }>;
    }
    return { body, queueSlots };
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}

export async function putComposeDraft(
  hostId: number,
  tmuxSession: string | null,
  body: string,
  queueSlots?: Array<{ id: string; text: string }>,
): Promise<void> {
  try {
    const payload: Record<string, unknown> = { hostId, tmuxSession, body };
    if (queueSlots !== undefined) payload.queueSlots = queueSlots;
    await authApi.put("/compose-drafts", payload);
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
  queueSlots?: Array<{ id: string; text: string }>,
): void {
  try {
    const base = authApi.defaults.baseURL ?? "";
    const url = `${base}/compose-drafts`;
    const payload: Record<string, unknown> = { hostId, tmuxSession, body };
    if (queueSlots !== undefined) payload.queueSlots = queueSlots;
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // never throw during unload
  }
}
