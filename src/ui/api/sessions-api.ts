import { authApi } from "@/main-axios";
import type { AxiosError } from "axios";

export interface RemoteTmuxSession {
  hostId: number;
  hostName: string;
  sessionName: string;
  created: number;
  role: string | null;
  // Phase 44 — inline recency signal from /sessions/list route (Plan 44-01). Optional for compat with pre-Phase-43 backends; consumers treat undefined as null.
  lastMessageAt?: number | null;
}

export async function getSessionList(): Promise<RemoteTmuxSession[]> {
  const response = await authApi.get("/sessions/list");
  return response.data;
}

/**
 * quick-260810-n3a: Kill a tmux session on a remote host via the backend SSH route.
 * Sends POST /host/:hostId/session/kill with { tmuxSession } as JSON.
 * On non-2xx: throws Error with the backend's error message (or axios's default).
 * Does NOT swallow errors — the caller (AppShell.onKillRow) must handle.
 */
export async function killTmuxSession(
  hostId: number,
  tmuxSession: string,
): Promise<void> {
  try {
    await authApi.post(`/host/${hostId}/session/kill`, { tmuxSession });
  } catch (err) {
    const axiosErr = err as AxiosError<{ error?: string }>;
    throw new Error(
      axiosErr.response?.data?.error ??
        axiosErr.message ??
        "Failed to kill session",
    );
  }
}
