import { authApi, handleApiError } from "@/main-axios";

export interface Identity {
  id: string;
  identityKey: string;
  displayName: string;
  title: string | null;
  colorHue: number | null;
  voice: string | null;
  avatarMime: string;
  avatarUrl: string;
  avatarEtag: string;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityInput {
  identityKey?: string;
  displayName?: string;
  title?: string | null;
  colorHue?: number | null;
  voice?: string | null;
}

function buildFormData(meta: IdentityInput, avatar: File | null): FormData {
  const fd = new FormData();
  fd.append("data", JSON.stringify(meta));
  if (avatar) fd.append("avatar", avatar);
  return fd;
}

export async function listIdentities(): Promise<Identity[]> {
  try {
    const response = await authApi.get("/identities");
    return response.data as Identity[];
  } catch (error) {
    handleApiError(error, "list identities");
  }
}

export async function createIdentity(
  meta: Required<Pick<IdentityInput, "identityKey" | "displayName">> &
    Pick<IdentityInput, "title" | "colorHue">,
  avatar: File,
): Promise<Identity> {
  try {
    const response = await authApi.post(
      "/identities",
      buildFormData(meta, avatar),
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return response.data as Identity;
  } catch (error) {
    handleApiError(error, "create identity");
  }
}

export async function updateIdentity(
  id: string,
  meta: IdentityInput,
  avatar: File | null,
): Promise<Identity> {
  try {
    const response = await authApi.put(
      `/identities/${id}`,
      buildFormData(meta, avatar),
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return response.data as Identity;
  } catch (error) {
    handleApiError(error, "update identity");
  }
}

export async function deleteIdentity(id: string): Promise<void> {
  try {
    await authApi.delete(`/identities/${id}`);
  } catch (error) {
    handleApiError(error, "delete identity");
  }
}

export interface AvatarCandidate {
  id: string;
  url: string;
}

export async function postGenerateAvatarBatch(input: {
  name: string;
  title: string;
  brief: string;
}): Promise<AvatarCandidate[]> {
  try {
    const response = await authApi.post("/identities/avatar/batch", input);
    return (response.data as { candidates: AvatarCandidate[] }).candidates;
  } catch (error) {
    handleApiError(error, "generate avatars");
  }
}

export async function getIdentityExistsOnHost(
  hostId: number,
  name: string,
): Promise<boolean> {
  try {
    const response = await authApi.get("/identities/exists-on-host", {
      params: { hostId, name },
    });
    return (response.data as { exists: boolean }).exists;
  } catch (error) {
    handleApiError(error, "check identity on host");
  }
}

// ─── Phase 22 (SRIC-02): roles list per host ─────────────────────────────────
// Backing route: src/backend/database/routes/roles-list-for-host.ts
// GET /roles?hostId=<n> → [{name, description}]
// Consumed by NewSessionDialog's Role dropdown (see plan 22-02 Task 4).

export type RoleSummary = { name: string; description: string };

export async function listRolesForHost(hostId: number): Promise<RoleSummary[]> {
  try {
    const response = await authApi.get("/roles", { params: { hostId } });
    return response.data as RoleSummary[];
  } catch (error) {
    handleApiError(error, "list roles for host");
  }
}

// ─── openBirthStream ─────────────────────────────────────────────────────────
// SSE consumer for POST /identities/birth. EventSource does NOT support POST;
// we use fetch + ReadableStream instead. Auth is cookie-based (withCredentials
// equivalent: credentials:"include") — the JWT cookie is sent automatically by
// the browser, matching the authApi axios instance's `withCredentials: true`.
//
// Wire format (per plan 04 SSE route):
//   event: birth
//   data: {"type":"step","n":1,"phase":"started"}
//
//   event: birth
//   data: {"type":"ended","ok":true,"identityId":"...","sessionName":"..."}
//
// The generator yields each parsed BirthEvent in order. On non-200 response,
// it reads the JSON error body and throws. On stream end, it exits cleanly.

export interface BirthRequest {
  hostId: number;
  name: string;
  title: string;
  path: string;
  colorHue: number | null;
  voice: string | null;
  avatarCandidateId: string;
}

export type BirthEvent =
  | {
      type: "step";
      n: 1 | 2 | 3 | 4 | 5;
      phase: "started" | "completed" | "failed";
      reason?: string;
    }
  | {
      type: "ended";
      ok: boolean;
      failedStep?: number;
      identityId?: string;
      sessionName?: string;
    };

export async function* openBirthStream(
  opts: BirthRequest,
  signal?: AbortSignal,
): AsyncGenerator<BirthEvent> {
  const response = await fetch("/identities/birth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(opts),
    credentials: "include",
    signal,
  });

  if (response.status !== 200) {
    let errorMsg = `birth failed: HTTP ${response.status}`;
    try {
      const json = (await response.json()) as { error?: string };
      if (json.error) errorMsg = json.error;
    } catch {
      // ignore JSON parse errors; use the default message
    }
    // Belt-and-braces: cancel the body to release the TCP/HTTP2 connection
    // slot even if response.json() already consumed it (cancel is a no-op on
    // a consumed body). Placed after JSON extraction so error message is preserved.
    await response.body?.cancel().catch(() => { /* swallow — best-effort release */ });
    throw new Error(errorMsg);
  }

  if (!response.body) {
    throw new Error("birth failed: server returned empty SSE stream");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by double newlines
    const frames = buffer.split("\n\n");
    // Keep the last (potentially incomplete) chunk in the buffer
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      if (!frame.trim()) continue;
      // Find the data: line in the frame
      const lines = frame.split("\n");
      let dataLine: string | undefined;
      for (const line of lines) {
        if (line.startsWith("data:")) {
          dataLine = line.slice("data:".length).trim();
          break;
        }
      }
      if (!dataLine) continue;
      try {
        const evt = JSON.parse(dataLine) as BirthEvent;
        yield evt;
      } catch {
        // Malformed JSON — skip frame
      }
    }
  }

  // Flush any remaining complete frame from the buffer
  if (buffer.trim()) {
    const lines = buffer.split("\n");
    let dataLine: string | undefined;
    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataLine = line.slice("data:".length).trim();
        break;
      }
    }
    if (dataLine) {
      try {
        const evt = JSON.parse(dataLine) as BirthEvent;
        yield evt;
      } catch {
        // Malformed JSON — skip
      }
    }
  }
}
