/**
 * Phase 122 Plan 122-03 Task 1 — Frontend surface for POST /conversation-search.
 *
 * Thin axios wrapper mirroring the workspace-api.ts / identity-archive-api.ts
 * shape. The backend endpoint is Wave 1 (plan 122-02) and the response
 * contract is documented in .planning/phases/122-conversation-search-modal/
 * 122-02-SUMMARY.md. The 11th field `tmuxSessionName` was added by the
 * Plan 03 Task 1 forward-patch so AppShell can feed openTab's
 * targetTmuxSession option — mirroring the sidebar's onDetachedRowClick.
 *
 * Error-class preservation follows the workspace-api.ts convention
 * (workspace-api.ts:70-77): axios errors carrying a backend `error` class
 * string (e.g. "query_too_long") are re-thrown as a plain Error whose
 * `.message` IS that class and whose `.name === "ConversationSearchError"`.
 * Non-axios / non-classed errors fall through to `handleApiError` (the
 * fleet-standard ApiError taxonomy for auth / network failures).
 */

import axios from "axios";
import { authApi, handleApiError } from "@/main-axios";

// ---------------------------------------------------------------------------
// Wire types (verbatim mirror of backend ConversationSearchResult — kept in
// sync with src/backend/database/routes/conversation-search.ts)
// ---------------------------------------------------------------------------

export interface ConversationSearchResult {
  transcriptPath: string; // absolute path to matched JSONL on the host — row key
  transcriptMtime: number; // ms since epoch (backend * 1000 from shell seconds)
  identityKey: string; // fleet identity directory name
  hostId: number; // hosts.id column
  hostName: string; // hosts.name (or hosts.ip fallback)
  aiTitle: string | null; // Wave-1 deferral — always null; frontend falls back to identityKey
  snippet: string; // pre-windowed ±80-char text around the match
  hitStart: number; // char offset of match inside snippet (−1 on fallback)
  hitLength: number; // length of match (0 on fallback)
  isArchived: boolean; // true iff row came from listArchivedIdentityKeysOnHost
  tmuxSessionName: string | null; // canonical tmux session — AppShell feeds openTab
}

export interface ConversationSearchResponse {
  results: ConversationSearchResult[];
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// searchConversations — POST /conversation-search
// ---------------------------------------------------------------------------

/**
 * Content-search across the caller's SSH+autoTmux hosts.
 *
 * @param query   plain-substring query (case-insensitive; regex NOT supported per D-02)
 * @param offset  pagination offset (0 for first fetch; results.length for load-more)
 * @param limit   page size (backend clamps to [1, 100]; frontend uses 20 per D-12)
 */
export async function searchConversations(
  query: string,
  offset: number,
  limit: number,
): Promise<ConversationSearchResponse> {
  try {
    const response = await authApi.post("/conversation-search", {
      query,
      offset,
      limit,
    });
    return response.data as ConversationSearchResponse;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "ConversationSearchError";
        throw rich;
      }
    }
    handleApiError(error, "search conversations");
    throw error; // unreachable — handleApiError throws; satisfies TS return type
  }
}
