/**
 * image-gen-requests/adapter.ts
 *
 * OpenAI gpt-image-1 HTTP adapter for the image-gen file-drop broker
 * (D-25, D-26). Wraps a raw `fetch` call — no `openai` npm SDK dep, matching
 * the existing avatar-batch route convention
 * (src/backend/database/routes/identity-avatar-batch.ts:378-410).
 *
 * Contract:
 *   - NEVER throws in normal operation. All failure modes return
 *     `{ok:false, reason, message?}` via the AdapterResult discriminated
 *     union. A truly unexpected throw is caught in an outer try/catch and
 *     mapped to `reason: "unknown"` so the worker sees a failure JSON rather
 *     than a crash.
 *   - Missing `OPENAI_API_KEY` returns `reason: "not_configured"` BEFORE
 *     any fetch preparation (Pitfall 4 + D-25). A set-but-invalid key that
 *     returns 401 from OpenAI is mapped to `reason: "unknown"` — NOT
 *     `not_configured` — because "no key" and "bad key" are different
 *     operator problems.
 *   - Status-code mapping (D-23, D-24, D-27):
 *       429                                          → rate_limited (Retry-After parsed if present)
 *       408 (Request Timeout) / 425 (Too Early)      → provider_unavailable
 *       5xx (500, 502, 503, 504, and Cloudflare 522/523/524) / AbortError → provider_unavailable
 *       400 with error.code === "content_policy_violation" → content_blocked
 *       400 other                                    → malformed
 *       anything else non-ok                         → unknown
 *   - Two-mode dispatch:
 *       No refImage → POST /v1/images/generations with JSON body
 *       refImage    → POST /v1/images/edits with multipart FormData body
 *   - AbortController with 60_000ms timeout on every fetch call so the
 *     worker pool cannot stall on a hung upstream (Pitfall 6).
 *   - NEVER logs the Authorization header or the OPENAI_API_KEY value in any
 *     code path (T-116-01-01 mitigation, V13).
 *
 * Model: locked to `gpt-image-1` per D-26. Not exposed to the caller — the
 * request parser has no `model` key in KNOWN_KEYS so no smuggle path exists.
 */

import { systemLogger } from "../utils/logger.js";
import type { FailureReason, ImageGenRequestBody } from "./types.js";

/**
 * Adapter timeout — matches identity-avatar-batch.ts:56 IMAGE_GEN_TIMEOUT_MS
 * (60s per call). At worker-pool concurrency N=5, a hung call parking a
 * worker for > 60s degrades throughput but cannot stall the pool forever.
 */
const IMAGE_GEN_TIMEOUT_MS = 60_000;

/**
 * OpenAI image API URLs.
 */
const OPENAI_GENERATIONS_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";

/**
 * OpenAI model. Locked to gpt-image-1 per D-26 — do NOT accept a
 * caller-supplied model.
 */
const OPENAI_MODEL = "gpt-image-1";

/**
 * Parse an RFC 7231 §7.1.3 Retry-After header value. The header may carry
 * either a non-negative integer number of seconds ("30") OR an HTTP-date
 * ("Fri, 31 Dec 2027 23:59:59 GMT"). Returns the wait time in seconds as a
 * non-negative integer, or `null` if:
 *   - The header is absent (`raw === null`).
 *   - The value is neither an integer-seconds shape nor a parseable date.
 *   - The value parses to a date in the past (negative wait).
 *
 * We never throw; malformed input just yields `null` so the adapter falls
 * back to the bare `rate_limited` failure surface.
 */
export function parseRetryAfterSeconds(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Integer-seconds form. Enforce the whole string is digits (no unit
  // suffix, no fractional value — the RFC specifies a `delta-seconds` int).
  if (/^\d+$/.test(trimmed)) {
    const secs = Number(trimmed);
    if (Number.isFinite(secs) && secs >= 0) return Math.floor(secs);
    return null;
  }

  // HTTP-date form.
  const parsedMs = Date.parse(trimmed);
  if (Number.isNaN(parsedMs)) return null;
  const deltaMs = parsedMs - Date.now();
  if (deltaMs <= 0) return 0;
  return Math.max(0, Math.floor(deltaMs / 1000));
}

/**
 * Discriminated-union return type for the adapter.
 * `images` is an array of PNG buffers (one per generated image); order matches
 * the OpenAI response `data[]` order.
 */
export type AdapterResult =
  | { ok: true; images: Buffer[]; generation_time_ms: number }
  | { ok: false; reason: FailureReason; message?: string };

/**
 * Shape of the OpenAI success response payload. `data[].b64_json` carries
 * one base64-encoded PNG per generated image.
 */
interface OpenAiImageResponse {
  data: Array<{ b64_json: string }>;
}

/**
 * Shape of the OpenAI error response payload for 4xx errors. `error.code`
 * carries the machine-readable error kind (e.g. "content_policy_violation"
 * for content-policy refusals); `error.message` is the human-readable
 * explanation.
 */
interface OpenAiErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
}

/**
 * Build the multipart FormData body for the /edits endpoint (image-to-image).
 * The `image` file is derived from the caller's `ref` filename (kept for
 * OpenAI's benefit — some providers use the filename to sniff the file
 * type). Other passthrough fields (n, size, quality) are added if present.
 */
function buildMultipartEditBody(body: ImageGenRequestBody, refImage: Buffer): FormData {
  const fd = new FormData();
  fd.append("model", OPENAI_MODEL);
  fd.append("prompt", body.prompt);

  // Extract extension from body.ref (parser guarantees the shape).
  const filename = body.ref ?? "ref.png";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "png";
  const mimeType =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "webp"
        ? "image/webp"
        : "image/png";
  // Node's Blob accepts a Buffer-derived Uint8Array.
  const blob = new Blob([new Uint8Array(refImage)], { type: mimeType });
  fd.append("image", blob, filename);

  if (body.n !== undefined) fd.append("n", String(body.n));
  if (body.size !== undefined) fd.append("size", body.size);
  if (body.quality !== undefined) fd.append("quality", body.quality);
  return fd;
}

/**
 * Call OpenAI's image API. Returns a discriminated union — NEVER throws
 * in normal operation. `refImage` triggers the /edits multipart path;
 * otherwise the /generations JSON path is used.
 */
export async function callOpenAiImageGen(
  body: ImageGenRequestBody,
  refImage?: Buffer,
): Promise<AdapterResult> {
  // -----------------------------------------------------------------------
  // Missing-key check runs FIRST (Pitfall 4 + D-25). Do NOT start the
  // AbortController timer or prepare a request body if we cannot call.
  // -----------------------------------------------------------------------
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    systemLogger.warn("image-gen adapter: OPENAI_API_KEY not configured", {
      operation: "image_gen_openai_not_configured",
    });
    return { ok: false, reason: "not_configured" };
  }

  systemLogger.info("image-gen adapter: openai call start", {
    operation: "image_gen_openai_call_start",
    hasRef: refImage !== undefined,
    // Deliberately NOT logging prompt content or the apiKey.
    n: body.n,
    size: body.size,
  });

  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_GEN_TIMEOUT_MS);

  try {
    const url = refImage !== undefined ? OPENAI_EDITS_URL : OPENAI_GENERATIONS_URL;

    // Build headers. Content-Type ONLY for JSON path — for multipart the
    // fetch runtime derives the boundary automatically.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    };
    // fetch accepts string | FormData | Buffer | ReadableStream — let TS
    // infer the union rather than importing DOM's BodyInit (not in the
    // backend's ES2023-only lib set).
    let requestBody: string | FormData;
    if (refImage !== undefined) {
      requestBody = buildMultipartEditBody(body, refImage);
    } else {
      headers["Content-Type"] = "application/json";
      requestBody = JSON.stringify({
        model: OPENAI_MODEL,
        prompt: body.prompt,
        ...(body.n !== undefined ? { n: body.n } : {}),
        ...(body.size !== undefined ? { size: body.size } : {}),
        ...(body.quality !== undefined ? { quality: body.quality } : {}),
      });
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: requestBody,
      signal: ctrl.signal,
    });

    // ---------------------------------------------------------------------
    // Status-code mapping per D-23 / D-24 / D-27.
    // ---------------------------------------------------------------------
    if (res.status === 429) {
      // Parse the Retry-After header when present. Per RFC 7231 §7.1.3 the
      // value is either an integer number of seconds OR an HTTP-date. Populate
      // `message` only when parsing yields a positive integer count of seconds
      // — malformed or absent headers leave message unset (caller sees a bare
      // rate_limited failure and infers a self-throttle misconfiguration per
      // D-23).
      const retryAfterRaw = res.headers.get("retry-after");
      const retryAfterSec = parseRetryAfterSeconds(retryAfterRaw);
      systemLogger.warn("image-gen adapter: openai non-2xx", {
        operation: "image_gen_openai_non_2xx",
        status: 429,
        reason: "rate_limited",
        // Do NOT log the header value itself — only whether a parseable
        // value was extracted (avoids any risk of leaking upstream data).
        retryAfterParsed: retryAfterSec !== null,
      });
      if (retryAfterSec !== null) {
        return { ok: false, reason: "rate_limited", message: `retry after ${retryAfterSec} seconds` };
      }
      return { ok: false, reason: "rate_limited" };
    }
    // 408 (Request Timeout) + 425 (Too Early) are transient-server signals per
    // RFC 9110 §15.5 — the request never reached logical processing on the
    // server side. Treat them as `provider_unavailable` (retryable at the
    // caller's discretion, matching D-24 semantics), not `unknown`.
    if (res.status === 408 || res.status === 425) {
      systemLogger.warn("image-gen adapter: openai non-2xx", {
        operation: "image_gen_openai_non_2xx",
        status: res.status,
        reason: "provider_unavailable",
      });
      return { ok: false, reason: "provider_unavailable" };
    }
    if (res.status >= 500) {
      // Covers 500, 502, 503, 504 (OpenAI-origin) AND 522/523/524
      // (Cloudflare-edge) — all are transient upstream unavailability signals
      // where the caller-side retry decision is correct.
      systemLogger.warn("image-gen adapter: openai non-2xx", {
        operation: "image_gen_openai_non_2xx",
        status: res.status,
        reason: "provider_unavailable",
      });
      return { ok: false, reason: "provider_unavailable" };
    }
    if (res.status === 400) {
      let err: OpenAiErrorResponse = {};
      try {
        err = (await res.json()) as OpenAiErrorResponse;
      } catch {
        // Malformed error-JSON body — fall through to generic bad-request.
      }
      if (err?.error?.code === "content_policy_violation") {
        systemLogger.warn("image-gen adapter: openai non-2xx", {
          operation: "image_gen_openai_non_2xx",
          status: 400,
          reason: "content_blocked",
        });
        return { ok: false, reason: "content_blocked", message: err?.error?.message };
      }
      systemLogger.warn("image-gen adapter: openai non-2xx", {
        operation: "image_gen_openai_non_2xx",
        status: 400,
        reason: "malformed",
      });
      return { ok: false, reason: "malformed", message: err?.error?.message ?? "bad request" };
    }
    if (!res.ok) {
      // 401 / 403 / other unclassified — treat as unknown so operators can
      // distinguish "no key" (not_configured) from "bad or rejected key"
      // (unknown) per Pitfall 4.
      systemLogger.warn("image-gen adapter: openai non-2xx", {
        operation: "image_gen_openai_non_2xx",
        status: res.status,
        reason: "unknown",
      });
      return { ok: false, reason: "unknown", message: `status ${res.status}` };
    }

    // ---------------------------------------------------------------------
    // 2xx success — decode b64_json into PNG Buffers.
    // ---------------------------------------------------------------------
    let parsed: OpenAiImageResponse;
    try {
      parsed = (await res.json()) as OpenAiImageResponse;
    } catch (err) {
      systemLogger.warn("image-gen adapter: openai 2xx with malformed json", {
        operation: "image_gen_openai_json_parse_failed",
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        reason: "unknown",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    if (!parsed || !Array.isArray(parsed.data)) {
      systemLogger.warn("image-gen adapter: openai 2xx with unexpected shape", {
        operation: "image_gen_openai_shape_unexpected",
      });
      return { ok: false, reason: "unknown", message: "openai response missing data[]" };
    }

    const images = parsed.data.map((d) => Buffer.from(d.b64_json, "base64"));
    const generation_time_ms = Date.now() - start;

    systemLogger.info("image-gen adapter: openai call done", {
      operation: "image_gen_openai_call_done",
      status: res.status,
      ok: true,
      generation_time_ms,
      imageCount: images.length,
    });

    return { ok: true, images, generation_time_ms };
  } catch (err) {
    // AbortError from the AbortController firing → provider_unavailable
    // with a stable "openai timeout" tag (Pitfall 6). Anything else is an
    // uncategorised throw → unknown.
    if (err instanceof Error && err.name === "AbortError") {
      systemLogger.warn("image-gen adapter: openai timeout", {
        operation: "image_gen_openai_timeout",
        timeoutMs: IMAGE_GEN_TIMEOUT_MS,
      });
      return { ok: false, reason: "provider_unavailable", message: "openai timeout" };
    }
    systemLogger.warn("image-gen adapter: openai unexpected error", {
      operation: "image_gen_openai_unexpected_error",
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      reason: "unknown",
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
