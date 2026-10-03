/**
 * Phase 144 Plan 01 Task 4 — ntfy env-var loader with fail-fast boot gate.
 *
 * What this module does:
 *   - `assertNtfyConfigAtBoot()` — invoked once at process start from starter.ts.
 *     Reads NTFY_PUBLIC_URL, NTFY_PUBLISH_TOKEN, NTFY_ADMIN_USER, NTFY_ADMIN_PASS
 *     from `process.env`; throws a structured Error naming the offender when any
 *     is missing OR when NTFY_PUBLIC_URL does not start with "https://". Logs a
 *     redacted-safe success line on the happy path.
 *   - `getNtfyBaseUrl()` — returns the trimmed NTFY_PUBLIC_URL (no path append).
 *     ntfy explicitly rejects path-prefix hosting at startup, so each instance
 *     deploys ntfy on its own dedicated subdomain (e.g. https://push.example.com).
 *   - `getNtfyInternalPublishUrl()` — returns the literal `"http://ntfy:2586"`
 *     (internal Docker network URL; never traverses the public internet).
 *   - `getNtfyPublishToken()`, `getNtfyAdminUser()`, `getNtfyAdminPassword()` —
 *     plain getters returning trimmed env values.
 *
 * Why fail-fast at boot:
 *   Mirrors `assertVapidConfigAtBoot` (Phase 128) and `assertBrandingConfigAtBoot`.
 *   A missing NTFY_PUBLIC_URL means the preferences pane would show an empty
 *   server address. A missing NTFY_PUBLISH_TOKEN means every publish POST would
 *   return 401 from the ntfy container. Better to refuse to boot than to run
 *   degraded and silently drop every notification.
 *
 * Why NTFY_PUBLIC_URL must be https://:
 *   ntfy's iOS app requires HTTPS for self-hosted servers. The ntfy upstream relay
 *   also sends poll_request URLs derived from base-url — a non-HTTPS base-url
 *   produces broken relay URLs.
 *
 * Why NTFY_PUBLIC_URL is separate from SKYNET_PUBLIC_URL:
 *   ntfy refuses to run on a sub-path (its own startup validation). The two
 *   services must live at distinct hostname roots. Each instance operator sets
 *   both env vars; both are instance-specific and never hardcoded in the
 *   codebase.
 *
 * Security discipline:
 *   The success log line emits the derived ntfy base URL (a public URL, safe) but
 *   NEVER the publish token, admin password, or any credential material.
 *
 * Publish-token-only arch note (HC-3):
 *   The `ntfy_publish_config` singleton table from RESEARCH.md Q7 is deliberately
 *   NOT built. The publish token lives in NTFY_PUBLISH_TOKEN env var only (not DB).
 */

import { systemLogger } from "../utils/logger.js";

/**
 * Read and validate all required ntfy env vars, throwing a structured Error
 * that names the offender on any failure. Never returns partial config.
 */
function readNtfyEnv(): {
  publicUrl: string;
  publishToken: string;
  adminUser: string;
  adminPass: string;
} {
  const publicUrl = (process.env.NTFY_PUBLIC_URL ?? "").trim();
  const publishToken = (process.env.NTFY_PUBLISH_TOKEN ?? "").trim();
  const adminUser = (process.env.NTFY_ADMIN_USER ?? "").trim();
  const adminPass = (process.env.NTFY_ADMIN_PASS ?? "").trim();

  if (publicUrl.length === 0 || !publicUrl.startsWith("https://")) {
    throw new Error(
      "NTFY_PUBLIC_URL env var is missing or not an HTTPS URL. " +
        "Set it to the ntfy server's own HTTPS URL (e.g. https://push.example.com — " +
        "NO path prefix; ntfy refuses path-prefix hosting at startup). " +
        "This is a dedicated subdomain, separate from SKYNET_PUBLIC_URL, because " +
        "ntfy must run at a hostname root. The ntfy iOS app requires HTTPS for self-hosted servers.",
    );
  }
  if (publishToken.length === 0) {
    throw new Error(
      "NTFY_PUBLISH_TOKEN env var is missing or empty. " +
        'Generate a 32-char token (tk_ prefix) via: node -e \'console.log("tk_" + require("crypto").randomBytes(16).toString("hex").slice(0, 29))\' ' +
        "and add it to skynet.env before boot. Without it, every ntfy publish POST returns 401.",
    );
  }
  if (adminUser.length === 0) {
    throw new Error(
      "NTFY_ADMIN_USER env var is missing or empty. " +
        "Set the ntfy admin username (e.g. skynet-admin) in skynet.env before boot. " +
        "Required for Skynet backend HTTP admin API calls (/v1/users).",
    );
  }
  if (adminPass.length === 0) {
    throw new Error(
      "NTFY_ADMIN_PASS env var is missing or empty. " +
        "Set the plaintext admin password in skynet.env before boot. " +
        "Required for Skynet backend HTTP Basic auth against the ntfy admin API.",
    );
  }

  return { publicUrl, publishToken, adminUser, adminPass };
}

/**
 * Boot-time gate. Invoked ONCE from starter.ts alongside assertVapidConfigAtBoot
 * (until Plan 04 removes the VAPID gate). Throws a structured, operator-facing
 * Error on any missing/malformed env var.
 *
 * Mirrors `assertVapidConfigAtBoot` / `assertBrandingConfigAtBoot` — same
 * fail-fast discipline, same "structured error before any HTTP route mounts"
 * placement.
 *
 * Success log: names the load + derived ntfy base URL ONLY.
 * NEVER logs credential values (publish token, admin password).
 */
export function assertNtfyConfigAtBoot(): void {
  const { publicUrl } = readNtfyEnv();

  const baseUrl = publicUrl.replace(/\/+$/, "");

  systemLogger.info("[ntfy] config loaded", {
    operation: "ntfy_config_boot_loaded",
    baseUrl,
  });
}

/**
 * Returns the ntfy server's public base URL, e.g.
 * `"https://push.example.com"`.
 *
 * Reads NTFY_PUBLIC_URL env var (NOT SKYNET_PUBLIC_URL + "/ntfy") because
 * ntfy's own server validation refuses path-prefix hosting at startup
 * (error: "base-url must not have a path, as hosting ntfy on a sub-path is
 * not supported"). Each instance deploys ntfy on its own dedicated subdomain
 * (e.g., https://push.example.com) and sets NTFY_PUBLIC_URL to that.
 *
 * Trailing slashes are stripped to prevent doubled-slash issues in deep-links
 * and the upstream relay poll_request URL.
 *
 * This is the URL the ntfy iOS app's "Service URL" field must be set to, and
 * the value shown in the Skynet preferences pane (Plan 03).
 */
export function getNtfyBaseUrl(): string {
  const publicUrl = (process.env.NTFY_PUBLIC_URL ?? "").trim();
  return publicUrl.replace(/\/+$/, "");
}

/**
 * Returns the internal Docker network URL for ntfy publish calls:
 * `"http://ntfy:2586"`.
 *
 * This URL is used by Skynet's backend for fire-and-forget DM publish POSTs:
 *   `POST http://ntfy:2586/<topicName>`
 * It NEVER traverses the public internet — traffic stays on skynet-net.
 * The container is not port-published; Caddy reaches it via the same internal
 * alias for the public-facing ntfy path prefix.
 */
export function getNtfyInternalPublishUrl(): string {
  return "http://ntfy:2586";
}

/**
 * Returns the ntfy publish token (NTFY_PUBLISH_TOKEN), trimmed.
 *
 * This is the Bearer token Skynet's backend uses for all publish POSTs:
 *   `Authorization: Bearer <token>`
 * It is keyed to the admin user in ntfy's auth.db. Token format: `tk_` + 29
 * hex chars = 32 chars total (ntfy's required format per RESEARCH.md Pitfall 3).
 *
 * NEVER log or include this value in any API response or agent context.
 */
export function getNtfyPublishToken(): string {
  return (process.env.NTFY_PUBLISH_TOKEN ?? "").trim();
}

/**
 * Returns the ntfy admin username (NTFY_ADMIN_USER), trimmed.
 *
 * Used as the HTTP Basic auth username when Skynet calls the ntfy admin API
 * (POST /v1/users, POST /v1/users/access, etc.) in Plan 02.
 */
export function getNtfyAdminUser(): string {
  return (process.env.NTFY_ADMIN_USER ?? "").trim();
}

/**
 * Returns the ntfy admin password (NTFY_ADMIN_PASS), trimmed.
 *
 * Used as the HTTP Basic auth password when Skynet calls the ntfy admin API.
 * The bcrypt-hashed form of this value (NTFY_ADMIN_PASS_BCRYPT) is what lives
 * in server.yml's auth-users entry; the plaintext lives here for the backend's
 * HTTP Basic auth calls.
 *
 * NEVER log or include this value in any API response or agent context.
 */
export function getNtfyAdminPassword(): string {
  return (process.env.NTFY_ADMIN_PASS ?? "").trim();
}
