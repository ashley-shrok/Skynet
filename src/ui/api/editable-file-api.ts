import axios from "axios";
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

/**
 * Phase 75 D-01 URL parser used by fetchHostFileUrl below. Kept
 * module-private (not exported) — the modal + eligibility hook do their
 * own dispatch-guard test on the URL shape via a fresh non-global regex,
 * not via re-parsing.
 *
 * Grammar:
 *   - `https://<anything-but-slash>` — the Skynet domain (with optional port)
 *   - `/file/`                        — literal path segment locking the shape
 *   - `([a-zA-Z0-9._-]+)`             — captured hostname
 *   - `/`                             — literal separator
 *   - `(.*)`                          — captured absolute path suffix
 *                                       (leading slash is re-added below)
 *
 * On no match, callers throw `Error("invalid file URL")` before any
 * network call fires.
 */
const FILE_URL_PARSE_RE =
  /^https:\/\/[^/]+\/file\/([a-zA-Z0-9._-]+)\/(.*)$/;

/**
 * POST /pretty-view/fetch-host-file
 *
 * Phase 75 D-01, D-04: fetches a Skynet file URL via the backend's
 * SFTP-hardened proxy (shipped in Plan 75-01). Same response envelope shape
 * as `fetchTailnetUrl` (TailnetFetchResult) — the modal and eligibility
 * hook consume both helpers without discrimination.
 *
 * URL parsing happens client-side (`FILE_URL_PARSE_RE`) to extract
 * `{hostname, absolutePath}`. The leading slash is re-added to the
 * absolute path per D-01's re-add-leading-slash rule (backend strips
 * `/file/<hostname>/`, we re-add the `/` when POSTing).
 *
 * Consumers:
 *   1. useEditableFileEligibility — byte-sniff, DISCARDS bytes (per D-04's
 *      "bytes fetched for eligibility MUST NEVER be served to the editor
 *      path" invariant).
 *   2. EditableFileModal — fresh fetch on open, surfaces error as
 *      human-readable in-body copy per D-02 (Host unreachable, File not
 *      found, Permission denied on <host>, etc.).
 *
 * Error-class preservation (Rule 2 deviation from the plan's "mirror
 * fetchTailnetUrl exactly" instruction — documented in 75-02-SUMMARY):
 * the modal's D-02 requirement to render distinct human copy PER backend
 * error class (host_unreachable vs not_found vs ssh_timeout vs
 * permission_denied vs too_large vs ...) cannot be satisfied through
 * `handleApiError` alone — that helper collapses 404 into `NOT_FOUND` and
 * 5xx into `SERVER_ERROR`, destroying the taxonomy the modal needs. So on
 * an axios error carrying `response.data.error === "<class>"` we throw a
 * plain `Error` whose `.message` IS the class string, letting the modal's
 * catch block switch on it. `handleApiError` is still called for any
 * axios error that doesn't carry a recognizable class (falls through to
 * the existing fleet-standard ApiError taxonomy for auth / network /
 * non-Skynet failure paths).
 */
export async function fetchHostFileUrl(
  url: string,
): Promise<TailnetFetchResult> {
  const match = url.match(FILE_URL_PARSE_RE);
  if (!match) {
    throw new Error("invalid file URL");
  }
  const hostname = match[1];
  const absolutePath = "/" + match[2]; // D-01: re-add leading slash

  try {
    const response = await authApi.post("/pretty-view/fetch-host-file", {
      hostname,
      absolutePath,
    });
    return response.data as TailnetFetchResult;
  } catch (error) {
    // Preserve the backend's error-class string so the modal can render
    // distinct human copy per class (D-02). See docblock above for the
    // full rationale — this is intentionally NOT a symmetric mirror of
    // fetchTailnetUrl's flow because the modal's needs differ.
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "HostFileFetchError";
        throw rich;
      }
    }
    handleApiError(error, "fetch host file URL");
    throw error; // unreachable — handleApiError throws; satisfies TS return type
  }
}
