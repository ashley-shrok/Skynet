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
  // Phase 47 — inline current-work hint from /sessions/list route. Optional for compat with pre-Phase-47 backends; consumers treat undefined as null.
  aiTitle?: string | null;

  // ─── Phase 90 Plan 01 — /sessions/list kind discriminator + relay fields ───
  //
  // Phase 89 Plan 04 taught the /sessions/list handler to return a MERGED
  // flat list of two row shapes: harness rows (the pre-existing pattern) and
  // relay-room rows (materialized from `relay_room_sessions` in the DB). The
  // backend source of truth is the discriminated union in
  // `src/backend/database/routes/sessions-merge-helper.ts` — HarnessSessionRow
  // | RelayRoomSessionRow, discriminated on `kind: "harness" | "relay-room"`
  // (kebab-case, wire-protocol-locked by Plan 04 M-1).
  //
  // Frontend representation choice: FLAT-OPTIONAL widening (not a full
  // discriminated-union refactor) — the harness fields above stay as-is so
  // (a) pre-Phase-89 rehydrated caches deserialize into a valid object with
  // `kind` simply absent (backward-compat), (b) the ~10 existing call sites
  // that read `hostId`/`sessionName` unconditionally keep working without a
  // narrow branch, and (c) the diff for this widening is surgical (five new
  // optional fields on one interface — no cascading call-site edits).
  //
  // Backward-compat rule: consumers reading `kind` MUST treat `undefined` as
  // `"harness"` (matches pre-Phase-89 backend responses and pre-Phase-89
  // rehydrated FleetSession caches). See PATTERNS.md § widen section.
  //
  // Downstream plans (90-02..90-07) branch on `kind` to route the row-click
  // to the relay-room pane orchestrator; landing the fields here in Wave 1
  // unblocks parallel work on the shared primitives, backend Matrix
  // primitives, and the WS server.
  kind?: "harness" | "relay-room";
  // Relay-room-only identity fields (present iff `kind === "relay-room"`).
  // Mirrors the RelayRoomSessionRow shape in sessions-merge-helper.ts.
  id?: string;
  roomId?: string;
  roomTitle?: string | null;
  lastActivityAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
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
