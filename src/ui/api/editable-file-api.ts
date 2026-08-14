import { authApi, handleApiError } from "@/main-axios";

/**
 * Phase 40 Plan 40-02 (D-01, D-04): Frontend axios helper for the tailnet-URL
 * proxy endpoint that Plan 40-01 shipped.
 *
 * D-01 (URL detection is purely frontend, no agent-side change): this endpoint
 * is the ONLY way the frontend obtains bytes from an agent-served tailnet URL.
 * The browser cannot fetch `http://100.x.y.z:PORT/` directly — mixed-content
 * blocks it on HTTPS Skynet, `python3 -m http.server` sets no CORS headers, and
 * the tailnet IP may not be routable from the user's browser (only the Skynet
 * backend is guaranteed to be on the Tailnet). All fetches route through this
 * SSRF-hardened proxy.
 *
 * D-04 (visible failure over silent maybe-stale): this helper is the ONLY
 * frontend fetch of tailnet content. Two callers exist:
 *   1. useEditableFileEligibility — uses bytes for `isTextByBytes` classification
 *      and DISCARDS them. Bytes fetched for eligibility MUST NEVER be served to
 *      the editor path.
 *   2. EditableFileModal (Plan 40-03) — fires a fresh call at open-time and
 *      surfaces any error explicitly (does NOT fall back to cached bytes).
 *
 * Endpoint contract from Plan 40-01 Task 2 step 9:
 *   POST /pretty-view/fetch-tailnet-url
 *   Body:     { url: string }              — must match 100.64.0.0/10 CGNAT range
 *   Response: TailnetFetchResult (see type below)
 *   Errors:   400 invalid body/URL; 401 unauth; 413 oversized;
 *             502 upstream non-2xx / HTML spoof / fetch failed; 504 timeout
 *
 * Mirrors the shape of global-files-api.ts (authApi + handleApiError pattern).
 */

/**
 * Response shape from `POST /pretty-view/fetch-tailnet-url`.
 *
 * `isTextByBytes` is intentionally optional: the backend only populates it when
 * `isTextByExt === false` (byte-sniff runs only for extension-miss URLs, per
 * D-02). A caller MUST NOT read `isTextByBytes` unless it has first checked
 * that `isTextByExt` is false.
 */
export type TailnetFetchResult = {
  contentBase64: string;
  sizeBytes: number;
  contentType: string | null;
  extension: string | null;
  filename: string;
  isTextByExt: boolean;
  isTextByBytes?: boolean;
};

/**
 * POST /pretty-view/fetch-tailnet-url
 * Fetches an agent-served tailnet URL via the backend SSRF-hardened proxy.
 * JWT auth is auto-attached by the axios request interceptor.
 *
 * Throws on any non-2xx response via `handleApiError` — the caller receives
 * the fleet's standard `ApiError` taxonomy (401, 403, 404, 409, 422, 5xx,
 * network) so it can distinguish auth vs. proxy-upstream vs. size-cap vs.
 * timeout without hand-rolling axios error-shape checks.
 */
export async function fetchTailnetUrl(
  url: string,
): Promise<TailnetFetchResult> {
  try {
    const response = await authApi.post("/pretty-view/fetch-tailnet-url", {
      url,
    });
    return response.data as TailnetFetchResult;
  } catch (error) {
    handleApiError(error, "fetch tailnet URL");
    throw error; // unreachable — handleApiError throws; satisfies TS return type
  }
}
