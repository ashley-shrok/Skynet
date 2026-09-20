// ─── Feedback-enabled boot-time fetch (Phase 121 Plan 02) ────────────────────
// Fires GET /api/feedback/enabled and — on success — publishes the boolean
// into feedback-store. On any failure (non-2xx, network error, malformed
// JSON parse, unexpected shape) the fetch is a silent no-op and the store
// retains its default false ("feedback disabled") sentinel per D-08.
//
// DIVERGENCE FROM branding-fetch.ts:
//   /api/feedback/enabled is AUTH-GATED (contrast /api/branding which is
//   pre-login per Plan 70-01 D-05). This fetch MUST be fired AFTER the user
//   is authenticated. Plan 04's AppShell wire fires it inside a useEffect on
//   mount — AppShell only mounts after auth. DO NOT call fetchFeedbackConfig()
//   from src/main.tsx boot: the request would race the auth cookie, land as
//   401, and permanently leave the store on `false` for the session.
//
//   The fetch sends `credentials: "include"` so the auth cookie travels with
//   the request per fleet cookie-auth convention (matches the app's other
//   authenticated fetches — e.g. WeeklyUsageMeter L96-111 pattern for GETs
//   that need the JWT cookie).
//
// No console.error on failure — matches branding-fetch philosophy. Silent
// retain is correct: feedback is a non-essential ambient feature; noisy logs
// on every auth-gated boot would pollute the console for every user.
//
// Threat model (from 121-02-PLAN.md):
//   T-121-05 (Tampering) — isFeedbackEnabledResponse type guard rejects
//     unexpected shapes before publish; store retains default `false` on any
//     validation failure (never a partial or invalid state).
//   T-121-06 (DoS via boot-poisoning) — try/catch around the whole fetch +
//     parse chain means a rejected fetch or synchronous parse rejection
//     from json() never surfaces to the caller (AppShell effect), which
//     cannot break app boot.
//   T-121-07 (Info Disclosure pre-login) — mitigated CLIENT-SIDE by the
//     "call after auth only" docstring contract enforced by AppShell wiring
//     in Plan 04; server-side by Plan 03's authenticateJWT middleware.

import { publishFeedbackEnabled } from "./feedback-store";

// ─── Defensive shape guard ───────────────────────────────────────────────────
//
// Network is a distinct trust boundary from the backend's own response
// shape; re-validate here so the store only sees well-formed responses.
// Inline typeof check matches codebase house style (analog:
// branding-fetch.ts L45-56).

function isFeedbackEnabledResponse(v: unknown): v is { enabled: boolean } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.enabled === "boolean";
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch /api/feedback/enabled once (called from AppShell useEffect after auth)
 * and publish the result into feedback-store.
 *
 * Silent no-op on any failure path:
 *   - fetch() rejects (network offline, DNS failure, aborted request)
 *   - Response is non-2xx (401 pre-auth-race, 500 server error, 404 route
 *     not mounted on legacy backend)
 *   - Response body is not valid JSON
 *   - Parsed value fails isFeedbackEnabledResponse shape guard
 *
 * In all these cases the store retains {enabled:false} and the app hides
 * every feedback affordance — the D-08 default-disabled sentinel is a safe
 * failure mode.
 */
export async function fetchFeedbackConfig(): Promise<void> {
  try {
    const res = await fetch("/api/feedback/enabled", {
      credentials: "include",
    });
    if (!res.ok) return; // non-2xx: retain default `false`, do not clear
    const json = (await res.json()) as unknown;
    if (!isFeedbackEnabledResponse(json)) return; // unexpected shape: retain default
    publishFeedbackEnabled(json.enabled);
  } catch {
    // Network error, malformed JSON parse rejection, or any other
    // unexpected failure: silently retain the default `false` already
    // in the store.
  }
}
