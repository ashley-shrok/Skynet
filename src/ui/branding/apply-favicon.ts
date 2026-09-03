// ─── Favicon imperative-DOM hook (Phase 70 Plan 03) ──────────────────────────
// useBrandingFavicon() — subscribes to branding-store and rewrites every
// <link rel="icon"> element's href whenever branding.faviconPath changes.
//
// React does not own <head>; the pattern here matches
// src/ui/AppShell.tsx L613-624 which imperatively assigns document.title
// inside a useEffect. No head-management library — none installed, and
// three existing document.title assignments prove out the imperative style
// (see 70-RESEARCH.md § "Standard Stack" for the ban rationale).
//
// Where to call from: a top-level always-mounted component. The recommended
// site (per plan output handoff notes) is inside AppShell so the favicon
// applies pre-login as well as post-login. Plan 70-04 owns that wiring
// decision — this hook is the primitive; the wiring is 70-04's job.
//
// Threat model: none new. faviconPath is an operator-controlled URL string
// treated as a same-origin path by the browser; the /branding/* backend
// route (Plan 70-01) enforces the path-containment guard for actual asset
// resolution. See T-70-03-04 in the plan threat model for the injection
// disposition (trusted operator config).

import { useEffect } from "react";
import { useBrandingConfig } from "./branding-store";

/**
 * Hook: on mount and whenever branding.faviconPath changes, rewrite the href
 * of every <link rel="icon"> element in <head> to the current faviconPath.
 *
 * index.html ships two such links (16x16 + 32x32 PNGs) — both are rewritten
 * in one pass. The apple-touch-icon links are intentionally left alone per
 * D-10 (deferred as low-value MVP scope).
 *
 * No cleanup function: unmount does not need to revert the favicon because
 * (a) this hook is expected to live on a top-level always-mounted component
 * and (b) even if it did unmount, restoring the previous href would flash
 * the OLD favicon to the user briefly which is worse than keeping the new
 * one visible.
 */
export function useBrandingFavicon(): void {
  const branding = useBrandingConfig();
  useEffect(() => {
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
    for (const link of links) {
      link.href = branding.faviconPath;
    }
  }, [branding.faviconPath]);
}
