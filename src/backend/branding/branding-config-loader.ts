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
  // Phase 82: operator-overridable WIP indicator image; bundled default IS the fallback (unlike Phase 74's intentionally-empty avatarDirectorSpec — no boot gate needed).
  wipIndicatorPath: string;
  pwaIcons: Array<{ src: string; sizes: string; type: string }>;
  // Phase 74 (avatar-style-through-branding-config) — required extended fields.
  // avatarDirectorSpec is the operator-authored aesthetic director prompt fed
  // to the chat drafter model at avatar-generation time (moved out of the
  // hardcoded ARCHETYPE_SYSTEM_PROMPT constant in identity-avatar-batch.ts).
  // Presence-enforcement (non-empty after trim) lives in the boot gate
  // (Plan 02 assert-boot.ts), NOT here — this loader stays never-throws per
  // the Phase 70 contract so `/api/branding` cannot crash at request time.
  // avatarGammaDefault is the post-generation gamma lift applied by
  // sharp.linear() — bundled default 0.7 matches the historical
  // applyGamma07() behavior baked into identity-avatar-batch.ts.
  avatarDirectorSpec: string;
  avatarGammaDefault: number;
  // Phase 114 (instance-wide managed-policy CLAUDE.md) — D-01 + D-02 + D-10.
  // Bare filename (NOT a URL path — contrast with iconPath/wordmarkPath which
  // route through the /branding/* HTTP handler; the twinkie file is never
  // HTTP-served, so a `Path` suffix would mislead readers). Empty-string
  // convention mirrors avatarDirectorSpec (Phase 74) — "" means "no twinkie
  // for this instance." NO bundled-default leg (D-10): unlike iconPath /
  // wipIndicatorPath, when this field points at a missing file the
  // distributor pushes NOTHING to managed hosts (clean unset state).
  instancePolicyFilename: string;
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
  appName: "SKYNET",
  shortName: "SKYNET",
  iconPath: "/branding/icon.png",
  wordmarkPath: "/branding/wordmark.png",
  faviconPath: "/branding/favicon.svg",
  // Phase 82: routes through the branding router's /branding/* handler which
  // falls back to /app/branding-defaults/wip-cube.webp (relocated by Plan 82-02).
  wipIndicatorPath: "/branding/wip-cube.webp",
  pwaIcons: [
    { src: "/branding/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/branding/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
  ],
  // Phase 74: avatarDirectorSpec MUST be empty string here (INTENTIONAL —
  // per 74-CONTEXT.md § "Tempting-but-no" §1 + 74-RESEARCH.md § Pitfall 1).
  // A shipped default director spec would silently satisfy the Plan 02 boot
  // gate on no-config deployments — closing the whole point of the gate.
  // avatarGammaDefault=0.7 matches the historical applyGamma07() behavior.
  avatarDirectorSpec: "",
  avatarGammaDefault: 0.7,
  // Phase 114 D-03 + D-10: empty string is the intentional-unset state.
  // NO bundled-default leg here (departure from the branding-asset pattern):
  // a shipped default filename would silently point at a bundled markdown
  // file that no admin has authored — closing the whole point of the field.
  instancePolicyFilename: "",
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
  // Phase 82: wipIndicatorPath is required. Bundled default is the fallback
  // (no boot gate needed) — but the field must exist and be a string.
  if (typeof o.wipIndicatorPath !== "string") return false;
  // Phase 74: avatarDirectorSpec must be a string (empty allowed at loader
  // level — boot gate in assert-boot.ts enforces non-empty). avatarGammaDefault
  // must be a finite number — Number.isFinite() rejects NaN and Infinity too.
  if (typeof o.avatarDirectorSpec !== "string") return false;
  if (
    typeof o.avatarGammaDefault !== "number" ||
    !Number.isFinite(o.avatarGammaDefault)
  )
    return false;
  // Phase 114 D-01 + Pitfall 1: optional-in-guard so deployed branding.json
  // files written BEFORE Phase 114 landed (which do not carry this field)
  // don't fall back to HARDCODED_FALLBACK and silently stomp the operator's
  // iconPath / wordmarkPath / wipIndicatorPath overrides on first boot after
  // upgrade. Accept absent; reject non-string when present.
  if (
    o.instancePolicyFilename !== undefined &&
    typeof o.instancePolicyFilename !== "string"
  )
    return false;
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

  // Phase 114 D-01: post-guard normalization for optional-in-guard field.
  // Guard accepts documents without `instancePolicyFilename`; loader
  // guarantees the returned BrandingConfig always has it as a string so
  // downstream callers (readInstancePolicyBytes, assert-boot alarm branch)
  // can safely `.trim()` without an undefined check.
  const mutable = parsed as Record<string, unknown>;
  if (mutable.instancePolicyFilename === undefined) {
    mutable.instancePolicyFilename = "";
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

// ---------------------------------------------------------------------------
// Instance-wide managed-policy CLAUDE.md ("twinkie") reader — Phase 114
// ---------------------------------------------------------------------------

/**
 * Reads the bytes of the file referenced by `config.instancePolicyFilename`,
 * from the branding-assets directory. Returns `null` on any of:
 *
 *   (a) `instancePolicyFilename` is empty string — clean unset state
 *       (D-10: no bundled-default leg; empty means "no twinkie for this
 *       instance"). Fast-path: no fs call issued.
 *   (b) Path-containment violation (filename contains `..` or path-resolves
 *       outside `/etc/skynet/branding/`) — emits sshLogger.error with
 *       `operation: "branding_instance_policy_containment"`.
 *   (c) File exceeds 256 KB byte cap (`MAX_CONFIG_BYTES`, reused per D-06 —
 *       no separate constant). Emits sshLogger.error with
 *       `operation: "branding_instance_policy_size"`. Short-circuits BEFORE
 *       readFile, so the oversized bytes never enter memory.
 *   (d) File is missing (ENOENT) — SILENT null return. The D-05 boot alarm
 *       in Plan 04's `assert-boot.ts` addition observes this null-with-set-
 *       field state and fires the loud misconfig log ONCE at boot. Per-sweep
 *       silence here is required to avoid log spam.
 *   (e) Any other read error (EACCES, EIO, etc.) — emits sshLogger.error
 *       with `operation: "branding_instance_policy_read"`.
 *
 * Never throws (per D-11). All failure modes return null. Contract mirrors
 * `loadBrandingConfig()`'s Phase 70 never-throws invariant — the twinkie is
 * called at sweep time (composer-level, fire-and-forget) and at boot time
 * (non-fatal alarm), neither of which surfaces exceptions to callers.
 */
export async function readInstancePolicyBytes(): Promise<Buffer | null> {
  const config = await loadBrandingConfig();
  const filename = config.instancePolicyFilename ?? "";
  if (filename === "") {
    // Clean unset state — no fs call, no log. Distributor sweep composer
    // observes null and skips the row (or issues rm-f on eligible hosts per
    // D-16); assert-boot observes empty filename and does NOT fire alarm.
    return null;
  }

  const assetsBase = getBrandingAssetsDir();
  const requestedPath = path.resolve(assetsBase, filename);

  // Path-containment guard — mirrors resolveAssetPath():289-295 shape.
  // Per D-11 never-throws contract: log + return null (do NOT throw). The
  // twinkie is called at sweep time, not HTTP-route time, so there is no
  // 400-surface that would benefit from a thrown containment exception.
  if (
    !requestedPath.startsWith(assetsBase + path.sep) &&
    requestedPath !== assetsBase
  ) {
    sshLogger.error(
      "branding-config-loader: instance-policy filename escapes assets base",
      {
        operation: "branding_instance_policy_containment",
        filename,
        resolvedPath: requestedPath,
      },
    );
    return null;
  }

  try {
    const stat = await fs.stat(requestedPath);
    if (stat.size > MAX_CONFIG_BYTES) {
      sshLogger.error(
        "branding-config-loader: instance-policy file exceeds size cap",
        {
          operation: "branding_instance_policy_size",
          error: `File is ${stat.size} bytes (max ${MAX_CONFIG_BYTES}) — returning null`,
          path: requestedPath,
        },
      );
      return null;
    }
    // readFile without an encoding argument returns Buffer directly.
    const bytes = await fs.readFile(requestedPath);
    return bytes;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Field set but file missing — this IS the D-05 misconfig case, but
      // the LOUD alarm fires ONCE at boot (Plan 04's assert-boot.ts). Per-
      // sweep silence here avoids log spam on every 30s tick.
      return null;
    }
    sshLogger.error(
      "branding-config-loader: instance-policy read error",
      {
        operation: "branding_instance_policy_read",
        error: err instanceof Error ? err.message : String(err),
        path: requestedPath,
      },
    );
    return null;
  }
}
