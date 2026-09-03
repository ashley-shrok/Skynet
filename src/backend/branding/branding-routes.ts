/**
 * Phase 70 (branding-config): unauthenticated Express router for the three
 * branding surfaces consumed pre-login by the browser:
 *
 *   - GET /api/branding          → parsed branding config JSON
 *   - GET /manifest.webmanifest  → dynamically-generated PWA manifest
 *   - GET /branding/*            → asset files (per-file fallback to bundled defaults)
 *
 * No auth: matches the usage.ts unauthenticated pattern. Branding surfaces are
 * used by the login screen (icon + wordmark), the browser tab (favicon +
 * manifest), and the PWA install (manifest icons) — all pre-login.
 *
 * Per CLAUDE.md nginx caveat: matching location blocks MUST exist in
 * BOTH docker/nginx.conf AND docker/nginx-https.conf for:
 *   - /api/branding
 *   - /branding/*
 *   - /manifest.webmanifest  (existing static-serve block MUST be REPLACED
 *     with proxy_pass — otherwise nginx returns /app/html/manifest.webmanifest
 *     and the backend route is never hit)
 * That plumbing is landed in plan 70-02.
 *
 * Cache-Control per PATTERNS.md route-type table:
 *   - /api/branding + /manifest.webmanifest → no-store (operator may swap; PWA
 *     install pickup)
 *   - /branding/*                            → public, max-age=300 (short cache;
 *     assets are operator-controlled, NOT immutable)
 *
 * Path-containment defense (V5/V12): /branding/* wildcard capture is
 * user-controlled — resolveAssetPath() applies path.resolve + startsWith guard
 * on BOTH the override and bundled-default base dirs. Escape → 400 with empty
 * body (no filesystem paths in error responses per V13).
 *
 * Mounted at: app.use(brandingRoutes) in database.ts, BEFORE the frontend
 * static middleware (Pitfall 7 — Express-side mount-order discipline).
 */

import express, { type Request, type Response } from "express";
import {
  loadBrandingConfig,
  getBundledDefaults,
  resolveAssetPath,
} from "./branding-config-loader.js";
import { sshLogger } from "../utils/logger.js";

const router = express.Router();

const NO_STORE_CACHE =
  "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
const ASSET_CACHE = "public, max-age=300";

/**
 * GET /api/branding — parsed branding config JSON.
 * loadBrandingConfig() is never-throws; the try/catch here is belt-and-suspenders.
 */
router.get("/api/branding", async (_req: Request, res: Response) => {
  try {
    const config = await loadBrandingConfig();
    res.setHeader("Cache-Control", NO_STORE_CACHE);
    return res.status(200).json(config);
  } catch (err) {
    sshLogger.error("branding-routes: /api/branding unexpected error", {
      operation: "branding_route_config",
      error: err instanceof Error ? err.message : String(err),
    });
    res.setHeader("Cache-Control", NO_STORE_CACHE);
    return res.status(200).json(getBundledDefaults());
  }
});

/**
 * GET /manifest.webmanifest — dynamically-generated PWA manifest.
 * Content-Type must be application/manifest+json (per PWA spec + prior nginx
 * static-serve header at nginx.conf L76).
 * background_color + theme_color are hardcoded #0a0b12 per CONTEXT.md deferred
 * note ("Theme color / visual styling swaps — explicitly out of scope").
 */
router.get(
  "/manifest.webmanifest",
  async (_req: Request, res: Response) => {
    try {
      const config = await loadBrandingConfig();
      const manifest = {
        name: config.appName,
        short_name: config.shortName,
        icons: config.pwaIcons,
        start_url: "/",
        display: "standalone",
        background_color: "#0a0b12",
        theme_color: "#0a0b12",
      };
      res.setHeader("Content-Type", "application/manifest+json");
      res.setHeader("Cache-Control", NO_STORE_CACHE);
      return res.status(200).send(JSON.stringify(manifest));
    } catch (err) {
      sshLogger.error(
        "branding-routes: /manifest.webmanifest unexpected error",
        {
          operation: "branding_route_manifest",
          error: err instanceof Error ? err.message : String(err),
        },
      );
      const defaults = getBundledDefaults();
      const manifest = {
        name: defaults.appName,
        short_name: defaults.shortName,
        icons: defaults.pwaIcons,
        start_url: "/",
        display: "standalone",
        background_color: "#0a0b12",
        theme_color: "#0a0b12",
      };
      res.setHeader("Content-Type", "application/manifest+json");
      res.setHeader("Cache-Control", NO_STORE_CACHE);
      return res.status(200).send(JSON.stringify(manifest));
    }
  },
);

/**
 * GET /branding/* — asset files with per-file fallback (override → default → 404).
 *
 * Path safety:
 *   - resolveAssetPath() rejects containment escapes by throwing → we return 400.
 *   - Missing after both override + default checked → 404.
 *   - Response body on error is empty (no filesystem paths echoed).
 */
router.get("/branding/*splat", async (req: Request, res: Response) => {
  // Express 5 wildcard: `*splat` gives req.params.splat as string[] of the
  // path segments after /branding/. Join with '/' to reconstruct the path
  // for resolveAssetPath(). A bare "/branding/" (empty splat) returns 404.
  const splat = (req.params as { splat?: string | string[] }).splat;
  const requested = Array.isArray(splat) ? splat.join("/") : (splat ?? "");
  if (requested === "" || requested === "/") {
    return res.status(404).end();
  }

  let resolved: { path: string; source: "override" | "default" | "missing" };
  try {
    resolved = await resolveAssetPath(requested);
  } catch (err) {
    sshLogger.error("branding-routes: /branding/* path containment violation", {
      operation: "branding_route_asset_escape",
      error: err instanceof Error ? err.message : String(err),
      requested,
    });
    return res.status(400).end();
  }

  if (resolved.source === "missing") {
    return res.status(404).end();
  }

  res.setHeader("Cache-Control", ASSET_CACHE);
  return res.sendFile(resolved.path, (err) => {
    if (err) {
      sshLogger.error("branding-routes: /branding/* sendFile error", {
        operation: "branding_route_asset_send",
        error: err instanceof Error ? err.message : String(err),
        path: resolved.path,
      });
      if (!res.headersSent) {
        res.status(500).end();
      }
    }
  });
});

export default router;
