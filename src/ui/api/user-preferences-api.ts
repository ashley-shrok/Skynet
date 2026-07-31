import { authApi, handleApiError } from "@/main-axios";

// Phase 15 (Wave 2) — thin wrappers around GET/PUT /user-preferences for the
// pinnedConversationIds slice. Wave 1 (backend) extended /user-preferences
// with a JSON `pinnedConversationIds: string[]` field; this file surfaces
// that contract to the Zustand conversation-store's optimistic mutators
// (see conversation-store.ts pinConversation/unpinConversation).
//
// SC6 rollout scaffold: putPinnedIds compares the server-echoed array to
// the input and console.warn's on any divergence (generalisation of the
// patch #77 GET-verify-after-PUT lesson to the JSON-endpoint shape — the
// response echo IS the verification substrate, and the warn is the alarm
// the rollout window relies on to detect a silent-drop regression).

export async function getPinnedIds(): Promise<string[]> {
  try {
    const response = await authApi.get("/user-preferences");
    const raw = response.data?.pinnedConversationIds;
    if (Array.isArray(raw) && raw.every((v) => typeof v === "string")) {
      return raw;
    }
    return [];
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}

export async function putPinnedIds(ids: string[]): Promise<string[]> {
  try {
    const response = await authApi.put("/user-preferences", {
      pinnedConversationIds: ids,
    });
    const raw = response.data?.pinnedConversationIds;
    const echoed: string[] =
      Array.isArray(raw) && raw.every((v) => typeof v === "string")
        ? raw
        : ids;
    // SC6 rollout scaffold: deep-compare input vs echoed on every put.
    // Divergence is the JSON-endpoint equivalent of a silent-200 no-op —
    // patch #77 generalised. Log but do not throw; the server is
    // authoritative and the return value below is the echoed array.
    const diverged =
      ids.length !== echoed.length ||
      ids.some((v, i) => v !== echoed[i]);
    if (diverged) {
      console.warn("[pin-persistence] server echo mismatch", {
        sent: ids,
        echoed,
      });
    }
    return echoed;
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}

// quick-260731-tgg — thin wrappers around GET/PUT /user-preferences for the
// hiddenConversationIds slice. Structural mirrors of getPinnedIds / putPinnedIds
// above — do NOT extract a shared helper; mirror inline to keep the diff atomic.

export async function getHiddenIds(): Promise<string[]> {
  try {
    const response = await authApi.get("/user-preferences");
    const raw = response.data?.hiddenConversationIds;
    if (Array.isArray(raw) && raw.every((v) => typeof v === "string")) {
      return raw;
    }
    return [];
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}

export async function putHiddenIds(ids: string[]): Promise<string[]> {
  try {
    const response = await authApi.put("/user-preferences", {
      hiddenConversationIds: ids,
    });
    const raw = response.data?.hiddenConversationIds;
    const echoed: string[] =
      Array.isArray(raw) && raw.every((v) => typeof v === "string")
        ? raw
        : ids;
    // SC6 rollout scaffold: deep-compare input vs echoed on every put.
    const diverged =
      ids.length !== echoed.length ||
      ids.some((v, i) => v !== echoed[i]);
    if (diverged) {
      console.warn("[hide-persistence] server echo mismatch", {
        sent: ids,
        echoed,
      });
    }
    return echoed;
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}
