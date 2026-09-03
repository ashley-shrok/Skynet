/**
 * Phase 70 fix — index.html branding template
 *
 * ## Contract
 *
 * - **NEVER THROWS.** On any read/stat failure, returns the raw index.html bytes
 *   (or an empty string as absolute-last-resort). Same never-throws contract as
 *   `branding-config-loader.ts` — an operator misconfiguration must never take
 *   down the SPA shell.
 * - Reads `<frontendDist>/index.html` once per mtime and memoizes it, then applies
 *   the current `BrandingConfig.appName` to the two user-visible hardcoded strings
 *   (`<title>` and `<meta name="apple-mobile-web-app-title">`). Substitution is
 *   exact-string match — no regex, no global replace, no risk of hitting the
 *   internal `window.__SKYNET_BASE_PATH__` variable.
 * - `appName` is HTML-escaped before insertion (operator-controlled config value
 *   isn't strictly hostile, but escaping is cheap defense-in-depth).
 *
 * ## Cache
 *
 * The raw index.html is cached by mtime of the file on disk. The branding config
 * itself is not cached here — `loadBrandingConfig()` returns fast because the
 * loader already handles its own read + fallback. If the operator swaps the
 * config file, the next SPA request picks it up.
 */

import { promises as fs } from "fs";
import path from "path";

import { sshLogger } from "../utils/logger.js";
import { loadBrandingConfig } from "./branding-config-loader.js";

const TITLE_LITERAL = "<title>SKYNET</title>";
const APPLE_META_LITERAL =
  '<meta name="apple-mobile-web-app-title" content="SKYNET" />';

type IndexCacheEntry = {
  mtimeMs: number;
  raw: string;
};

const rawIndexCache = new Map<string, IndexCacheEntry>();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function readIndexHtml(frontendDist: string): Promise<string> {
  const indexPath = path.join(frontendDist, "index.html");
  try {
    const stat = await fs.stat(indexPath);
    const cached = rawIndexCache.get(indexPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.raw;
    }
    const raw = await fs.readFile(indexPath, "utf8");
    rawIndexCache.set(indexPath, { mtimeMs: stat.mtimeMs, raw });
    return raw;
  } catch (error) {
    sshLogger.error("branding-template: failed to read index.html", {
      operation: "branding_template_read_failed",
      error: error instanceof Error ? error.message : String(error),
      path: indexPath,
    });
    return "";
  }
}

export async function getBrandedIndexHtml(
  frontendDist: string,
): Promise<string> {
  const raw = await readIndexHtml(frontendDist);
  if (!raw) return raw;
  try {
    const config = await loadBrandingConfig();
    const escaped = escapeHtml(config.appName);
    return raw
      .replace(TITLE_LITERAL, `<title>${escaped}</title>`)
      .replace(
        APPLE_META_LITERAL,
        `<meta name="apple-mobile-web-app-title" content="${escaped}" />`,
      );
  } catch (error) {
    sshLogger.error("branding-template: failed to apply branding to index.html", {
      operation: "branding_template_apply_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return raw;
  }
}

/** Test-only helper to reset the internal mtime cache between suites. */
export function __resetIndexCacheForTest(): void {
  rawIndexCache.clear();
}
