/**
 * Phase 70 (branding-config): reads /etc/skynet/branding.json with per-file
 * fallback to /app/branding-defaults/ (bundled defaults COPYed into the image).
 *
 * Where the config lives:
 *   - Config JSON: /etc/skynet/branding.json  (bind-mounted read-only from host
 *     /opt/skynet/branding.json — D-01)
 *   - Asset dir:   /etc/skynet/branding/       (bind-mounted read-only from host
 *     /opt/skynet/branding/ — D-01)
 *   - Bundled defaults: /app/branding-defaults/ (Dockerfile COPY per D-11 —
 *     always present at runtime)
 *
 * Error handling contract:
 *   - Missing config file (ENOENT) → return bundled defaults (empty state
 *     is normal — no log; per D-14 a no-config deploy preserves current behavior).
 *   - Config file exceeds size cap (>256 KB) → sshLogger.error + return
 *     bundled defaults.
 *   - Other read error → sshLogger.error + return bundled defaults.
 *   - JSON parse error → sshLogger.error + return bundled defaults.
 *   - Shape-invalid parsed value → sshLogger.error + return bundled defaults.
 *   - This function never throws; all failure modes return the safe default.
 *
 * resolveAssetPath() implements per-file fallback per D-04:
 *   - If the requested asset exists under /etc/skynet/branding/ → serve override.
 *   - Else if it exists under /app/branding-defaults/ → serve bundled default.
 *   - Else return { source: "missing" }.
 *   - Path-containment guard (V5/V12): rejects any request that escapes the base
 *     directory via `..` — throws on escape (route wraps in try/catch → 400).
 *
 * Pure I/O: no Express, no SSH — safe to import from any context.
 */

import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { sshLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BrandingConfig = {
  appName: string;
  shortName: string;
  iconPath: string;
  wordmarkPath: string;
  faviconPath: string;
  pwaIcons: Array<{ src: string; sizes: string; type: string }>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BRANDING_CONFIG_FILENAME = "branding.json";

/** Byte cap: reject files >256KB — config file should be tiny. Matches
 * global-files-config-loader.ts L50. */
const MAX_CONFIG_BYTES = 256 * 1024;

/** Last-resort defaults if even /app/branding-defaults/branding.json is
 * missing at runtime (should never happen — Dockerfile COPYs it). Contents
 * must match docker/branding-defaults/branding.json exactly so a no-config
 * deploy on t1000 preserves current behavior byte-for-byte (D-14). */
const HARDCODED_FALLBACK: BrandingConfig = {
  appName: "Skynet",
  shortName: "Skynet",
  iconPath: "/branding/icon.png",
  wordmarkPath: "/branding/wordmark.png",
  faviconPath: "/branding/favicon.svg",
  pwaIcons: [
    { src: "/branding/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/branding/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
  ],
};

// ---------------------------------------------------------------------------
// Path helpers (fixed absolute paths per D-01 / D-11)
// ---------------------------------------------------------------------------

export function getBrandingConfigPath(): string {
  // Config file lives INSIDE the branding directory so a single bind-mount
  // (see docker-compose.yml) covers both config + assets and there is no
  // file-vs-directory ambiguity for docker's create_host_path auto-init.
  return "/etc/skynet/branding/branding.json";
}

export function getBrandingAssetsDir(): string {
  return "/etc/skynet/branding";
}

export function getBundledDefaultsDir(): string {
  return "/app/branding-defaults";
}

// ---------------------------------------------------------------------------
// Bundled defaults (memoized)
// ---------------------------------------------------------------------------

let cachedBundledDefaults: BrandingConfig | null = null;

/**
 * Synchronously read the bundled defaults JSON on first call; memoize result.
 * The file is baked into the image at Dockerfile COPY time and never changes
 * at runtime, so caching is safe.
 */
export function getBundledDefaults(): BrandingConfig {
  if (cachedBundledDefaults !== null) {
    return cachedBundledDefaults;
  }
  const defaultsPath = path.join(
    getBundledDefaultsDir(),
    BRANDING_CONFIG_FILENAME,
  );
  try {
    const raw = readFileSync(defaultsPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (isValidBrandingShape(parsed)) {
      cachedBundledDefaults = parsed as BrandingConfig;
      return cachedBundledDefaults;
    }
    sshLogger.error("branding-config-loader: bundled defaults shape invalid", {
      operation: "branding_config_bundled_shape",
      error: "Bundled /app/branding-defaults/branding.json fails shape guard",
      path: defaultsPath,
    });
  } catch (err) {
    sshLogger.error("branding-config-loader: bundled defaults read error", {
      operation: "branding_config_bundled_read",
      error: err instanceof Error ? err.message : String(err),
      path: defaultsPath,
    });
  }
  // Last-resort hardcoded fallback — should never fire in practice.
  cachedBundledDefaults = HARDCODED_FALLBACK;
  return cachedBundledDefaults;
}

// ---------------------------------------------------------------------------
// Shape guard (inline typeof / Array.isArray — matches house style)
// ---------------------------------------------------------------------------

function isValidBrandingShape(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.appName !== "string") return false;
  if (typeof o.shortName !== "string") return false;
  if (typeof o.iconPath !== "string") return false;
  if (typeof o.wordmarkPath !== "string") return false;
  if (typeof o.faviconPath !== "string") return false;
  if (!Array.isArray(o.pwaIcons)) return false;
  for (const entry of o.pwaIcons as unknown[]) {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    if (typeof e.src !== "string") return false;
    if (typeof e.sizes !== "string") return false;
    if (typeof e.type !== "string") return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Reads and parses /etc/skynet/branding.json. Returns bundled defaults on any
 * error (ENOENT, parse failure, shape invalid, oversized file) — never throws.
 */
export async function loadBrandingConfig(): Promise<BrandingConfig> {
  const configPath = getBrandingConfigPath();

  let raw: string;
  try {
    const stat = await fs.stat(configPath);
    if (stat.size > MAX_CONFIG_BYTES) {
      sshLogger.error("branding-config-loader: config file exceeds size cap", {
        operation: "branding_config_size",
        error: `Config file is ${stat.size} bytes (max ${MAX_CONFIG_BYTES}) — returning defaults`,
        path: configPath,
      });
      return getBundledDefaults();
    }
    raw = await fs.readFile(configPath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Missing file is normal for deployments that don't override branding.
      return getBundledDefaults();
    }
    sshLogger.error("branding-config-loader: config file read error", {
      operation: "branding_config_read",
      error: err instanceof Error ? err.message : String(err),
      path: configPath,
    });
    return getBundledDefaults();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    sshLogger.error("branding-config-loader: JSON parse error", {
      operation: "branding_config_parse",
      error: err instanceof Error ? err.message : String(err),
      path: configPath,
    });
    return getBundledDefaults();
  }

  if (!isValidBrandingShape(parsed)) {
    sshLogger.error("branding-config-loader: unexpected config shape", {
      operation: "branding_config_shape",
      error: "Config does not have expected BrandingConfig shape",
      path: configPath,
    });
    return getBundledDefaults();
  }

  return parsed as BrandingConfig;
}

// ---------------------------------------------------------------------------
// Asset resolver (per-file fallback per D-04)
// ---------------------------------------------------------------------------

/**
 * Given a requested filename (path segment after `/branding/`), resolves the
 * absolute filesystem path to serve.
 *
 * Steps:
 *   1. Strip leading `/`.
 *   2. Compute overridePath = path.resolve(brandingAssetsDir, sanitized) and
 *      verify containment (rejects `..` escape). Throws on escape — the
 *      route handler catches and returns 400.
 *   3. If overridePath exists → return { path, source: "override" }.
 *   4. Else compute defaultPath = path.resolve(bundledDefaultsDir, sanitized)
 *      + parallel containment check.
 *   5. If defaultPath exists → return { path, source: "default" }.
 *   6. Else return { path: "", source: "missing" }.
 *
 * Throws only on containment violation (path escape). All other failure modes
 * return { source: "missing" } — the route surfaces that as 404.
 */
export async function resolveAssetPath(
  requested: string,
): Promise<{ path: string; source: "override" | "default" | "missing" }> {
  const sanitized = requested.replace(/^\/+/, "");
  if (sanitized === "" || sanitized === "/") {
    return { path: "", source: "missing" };
  }

  // Override path check
  const overrideBase = getBrandingAssetsDir();
  const overridePath = path.resolve(overrideBase, sanitized);
  if (
    !overridePath.startsWith(overrideBase + path.sep) &&
    overridePath !== overrideBase
  ) {
    throw new Error("branding asset path escapes override base directory");
  }
  try {
    await fs.access(overridePath);
    return { path: overridePath, source: "override" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      sshLogger.error("branding-config-loader: override asset access error", {
        operation: "branding_asset_override_access",
        error: err instanceof Error ? err.message : String(err),
        path: overridePath,
      });
    }
  }

  // Bundled-default fallback
  const defaultBase = getBundledDefaultsDir();
  const defaultPath = path.resolve(defaultBase, sanitized);
  if (
    !defaultPath.startsWith(defaultBase + path.sep) &&
    defaultPath !== defaultBase
  ) {
    throw new Error("branding asset path escapes default base directory");
  }
  try {
    await fs.access(defaultPath);
    return { path: defaultPath, source: "default" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      sshLogger.error("branding-config-loader: default asset access error", {
        operation: "branding_asset_default_access",
        error: err instanceof Error ? err.message : String(err),
        path: defaultPath,
      });
    }
  }

  return { path: "", source: "missing" };
}
