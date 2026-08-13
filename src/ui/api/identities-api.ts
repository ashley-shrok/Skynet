import { authApi, handleApiError } from "@/main-axios";

export interface Identity {
  id: string;
  identityKey: string;
  displayName: string;
  title: string | null;
  colorHue: number | null;
  voice: string | null;
  role: string | null;
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
    // Patch #314: per-call timeout override. Default authApi timeout is
    // 30s but this endpoint runs an LLM archetype draft (up to 30s) THEN
    // 3 parallel gpt-image-1 renders (up to 60s each). Wall time can
    // legitimately reach ~90s; matching the nginx location's
    // proxy_read_timeout 120s gives headroom without changing the
    // global default. Do NOT bump the global timeout — every other
    // route benefits from failing fast on a network hiccup.
    const response = await authApi.post("/identities/avatar/batch", input, {
      timeout: 120_000,
    });
    return (response.data as { candidates: AvatarCandidate[] }).candidates;
  } catch (error) {
    handleApiError(error, "generate avatars");
  }
}

export async function postManualAvatarCandidate({
  file,
}: {
  file: File;
}): Promise<{ id: string }> {
  try {
    const fd = new FormData();
    fd.append("avatar", file);
    // Do NOT set Content-Type manually — let axios set it with the boundary.
    const response = await authApi.post("/identities/avatar/candidate/manual", fd);
    return response.data as { id: string };
  } catch (error) {
    handleApiError(error, "upload manual avatar");
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

// ─── Quick 260811-ax1: per-identity .no-dormancy sentinel toggle ─────────────
// Backing routes: src/backend/database/routes/identity-no-dormancy.ts
// GET /identities/:key/no-dormancy?hostId=<n> → { present: boolean }
// PUT /identities/:key/no-dormancy body { present: boolean } + query hostId=<n> → { present: boolean }
// Consumed by IdentityModal DialogHeader "Stays awake" switch.

export async function getIdentityNoDormancy(
  identityKey: string,
  hostId: number,
): Promise<boolean> {
  try {
    const response = await authApi.get(
      `/identities/${encodeURIComponent(identityKey)}/no-dormancy`,
      { params: { hostId } },
    );
    return (response.data as { present: boolean }).present;
  } catch (error) {
    handleApiError(error, "read stays-awake sentinel");
  }
}

export async function setIdentityNoDormancy(
  identityKey: string,
  hostId: number,
  present: boolean,
): Promise<boolean> {
  try {
    const response = await authApi.put(
      `/identities/${encodeURIComponent(identityKey)}/no-dormancy`,
      { present },
      { params: { hostId } },
    );
    return (response.data as { present: boolean }).present;
  } catch (error) {
    handleApiError(error, "update stays-awake sentinel");
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

// ─── Phase 22 (SRIC-03): clone identity on same host ─────────────────────────
// Backing route: src/backend/database/routes/identity-clone.ts
// POST /identities/clone with JSON body {sourceIdentityKey, hostId, newName,
//   title, voice, avatarCandidateId} → 201 publicIdentity(newRow)
// Consumed by CloneAgentDialog's submit handler (see plan 22-03 Task 2).
//
// Contract intentionally JSON-only (NOT multipart) — sidesteps Phase 20 patch
// #77 silent-no-op trap per RESEARCH Pitfall 2; backend enforces via 415 gate.
//
// Error handling: 409 collisions surface as a typed error the dialog renders
// inline (`Name "<name>" already exists on the source host`). All other
// non-2xx responses surface via handleApiError.

export class IdentityCloneCollisionError extends Error {
  constructor(public readonly newName: string) {
    super(`identity clone collision: ${newName}`);
    this.name = "IdentityCloneCollisionError";
  }
}

export interface CloneIdentityInput {
  sourceIdentityKey: string;
  hostId: number;
  newName: string;
  title: string;
  voice: string | null;
  avatarCandidateId: string | null;
  /** Working directory for the new identity on the target host. Backend
   *  mkdir -p's this path. Required (default "~" in CloneAgentDialog).
   *  Mirrors birth's `path` param — supports "~", "~/foo", or absolute. */
  path: string;
}

export async function cloneIdentity(input: CloneIdentityInput): Promise<Identity> {
  try {
    const response = await authApi.post("/identities/clone", input);
    return response.data as Identity;
  } catch (error) {
    const err = error as { response?: { status?: number } };
    if (err?.response?.status === 409) {
      throw new IdentityCloneCollisionError(input.newName);
    }
    handleApiError(error, "clone identity");
  }
}

// ─── Phase 22 (SRIC-04): create role on target host ──────────────────────────
// Backing route: src/backend/database/routes/roles-create.ts
// POST /roles with body {name, description, hostId} → 201 {name, description}
// Consumed by CreateRoleDialog's submit handler (see plan 22-04 Task 2).
//
// Error handling: 409 collisions surface as a typed error the dialog can
// render inline ("A role named `<name>` already exists on <host>"). All
// other non-2xx responses surface via handleApiError.

export class RoleAlreadyExistsError extends Error {
  constructor(public readonly roleName: string) {
    super(`role exists on host: ${roleName}`);
    this.name = "RoleAlreadyExistsError";
  }
}

export async function createRole(input: {
  name: string;
  description: string;
  hostId: number;
}): Promise<{ name: string; description: string }> {
  try {
    const response = await authApi.post("/roles", input);
    return response.data as { name: string; description: string };
  } catch (error) {
    // Detect 409 conflict — surface as a typed error so the dialog can
    // render an inline "role already exists" message rather than throwing
    // through handleApiError's generic surface.
    const err = error as { response?: { status?: number } };
    if (err?.response?.status === 409) {
      throw new RoleAlreadyExistsError(input.name);
    }
    handleApiError(error, "create role");
  }
}

// ─── Phase 38: identity sharing ─────────────────────────────────────────────
// Backing route: src/backend/database/routes/identity-share.ts
// POST /identities/:id/share with JSON body {targetUserId} →
//   { identityId: string, shared: boolean }
// Consumed by ShareIdentityPicker inside IdentityModal DialogHeader (Wave 2).
//
// Contract intentionally JSON — sidesteps the Phase 20 patch #77 silent-200
// trap that hits form-data POSTs whose backend expects `data=<json>`. Wave 1
// backend gates non-JSON content types at the router level.
//
// `shared: true` = fresh row inserted onto target user's identities.
// `shared: false` = target already had a row with the same identityKey; the
//   endpoint returns the EXISTING row's id so the picker can update its
//   "already shared" set without a second round-trip. Both cases are HTTP 200.
//
// Error handling: 400 (targetUserId missing / self-target / target-not-found)
// and 404 (source not in requester's scope) and 500 all surface via
// handleApiError with the "share identity" label. The picker prevents the
// 400 branches at the UI layer (backend re-validates as defense-in-depth per
// threat model T-38-02-01), so no typed error subclass is warranted.

export interface ShareIdentityResponse {
  identityId: string;
  shared: boolean; // true = new row inserted onto target; false = target already had this identityKey
}

export async function shareIdentity(
  sourceIdentityId: string,
  targetUserId: string,
): Promise<ShareIdentityResponse> {
  try {
    const response = await authApi.post(
      `/identities/${sourceIdentityId}/share`,
      { targetUserId },
    );
    return response.data as ShareIdentityResponse;
  } catch (error) {
    handleApiError(error, "share identity");
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
  /** Phase 22 SRIC-02: kebab-case-lowercase role name from the target host. */
  role: string;
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
