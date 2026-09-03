// ─── Branding config boot-time fetch (Phase 70 Plan 03) ──────────────────────
// Fires GET /api/branding once from src/main.tsx's boot chain and — on
// success — publishes the parsed config into branding-store. On any failure
// (non-2xx, network error, JSON.parse throw, unexpected shape) the fetch is
// a silent no-op and the store retains its bundled-default sentinel.
//
// Unauthenticated (pre-login) — matches
// src/ui/features/pretty-conversations/WeeklyUsageMeter.tsx L96-111 pattern:
// plain fetch("/api/branding") with no auth wrapper, no JWT header. Backend
// route is unauthenticated per Plan 70-01 D-05.
//
// Call ONCE at boot. main.tsx fires this as `void fetchBrandingConfig();`
// in parallel with prepareClientCacheVersion() — createRoot render is NOT
// gated on the resolved promise (Pitfall 5 mitigation: defaults sentinel
// keeps first-paint defensible even if this never resolves).
//
// No console.error on failure — Pitfall 5 rationale says silent retain is
// the correct behavior; noisy logging of a boot-race non-fatal fetch would
// pollute the console for every user on every page load.
//
// Threat model:
//   T-70-03-01 (Tampering) — isBrandingConfig type guard rejects unexpected
//     shapes before publish; store retains the bundled-default sentinel on any
//     validation failure (never a partial or invalid state).
//   T-70-03-02 (Denial of Service) — backend caps config file at 256 KB
//     (Plan 70-01 MAX_CONFIG_BYTES), so response body is bounded. No
//     additional client-side response-size limit needed.
//   T-70-03-05 (Compatibility) — void call from main.tsx does not await;
//     first paint proceeds against the defaults sentinel regardless of
//     whether the fetch resolves, rejects, or hangs.

import { publishBrandingConfig, type BrandingConfig } from "./branding-store";

// ─── Defensive shape guard ───────────────────────────────────────────────────
//
// Network is a distinct trust boundary from the backend loader's own shape
// guard (Plan 70-01 isValidBrandingShape). We re-validate here so the store
// only sees well-formed BrandingConfig instances — a compromised or misrouted
// response (e.g. nginx SPA fallback returning index.html) is rejected quietly
// rather than corrupting the store.
//
// Inline typeof / Array.isArray checks match the codebase house style (analog:
// global-files-config-loader.ts L122-137). No Zod dependency.

function isBrandingConfig(v: unknown): v is BrandingConfig {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.appName !== "string") return false;
  if (typeof o.shortName !== "string") return false;
  if (typeof o.iconPath !== "string") return false;
  if (typeof o.wordmarkPath !== "string") return false;
  if (typeof o.faviconPath !== "string") return false;
  if (!Array.isArray(o.pwaIcons)) return false;
  return true;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch /api/branding once at boot and publish the result into branding-store.
 *
 * Silent no-op on any failure path:
 *   - fetch() throws (network offline, DNS failure, aborted request)
 *   - Response is non-2xx (backend returned 500, nginx returned 404 with the
 *     wrong location block, etc.)
 *   - Response body is not valid JSON
 *   - Parsed value fails isBrandingConfig shape guard
 *
 * In all these cases the store retains the bundled-default sentinel; the app
 * renders with "Skynet" branding, which is byte-identical to today's t1000
 * behavior per D-14. Only a successful, well-shaped response transitions the
 * store to the operator's config.
 */
export async function fetchBrandingConfig(): Promise<void> {
  try {
    const res = await fetch("/api/branding");
    if (!res.ok) return; // non-2xx: retain bundled defaults, do not clear
    const json = (await res.json()) as unknown;
    if (!isBrandingConfig(json)) return; // unexpected shape: retain defaults
    publishBrandingConfig(json);
  } catch {
    // Network error, JSON.parse throw, or any other unexpected failure:
    // silently retain the bundled-default sentinel already in the store.
  }
}
