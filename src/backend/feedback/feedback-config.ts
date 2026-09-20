/**
 * Phase 121 (feedback-config): reads FEEDBACK_* env vars ONCE at backend boot
 * and caches the parsed FeedbackConfig in module scope. Called from starter.ts's
 * boot IIFE via loadFeedbackConfig(); downstream getFeedbackConfig() returns
 * the cached value with no I/O.
 *
 * Env vars consumed (D-04):
 *   - FEEDBACK_SMTP_HOST       (required if any feedback env is set)
 *   - FEEDBACK_SMTP_PORT       (required; must be numeric 1-65535)
 *   - FEEDBACK_SMTP_USER       (optional — paired with PASSWORD; anonymous relay
 *                               is acceptable when both absent, per D-04)
 *   - FEEDBACK_SMTP_PASSWORD   (optional — paired with USER; whitespace
 *                               preserved verbatim per Pitfall 4)
 *   - FEEDBACK_SMTP_FROM       (required)
 *   - FEEDBACK_TO_ADDRESS      (required)
 *   - FEEDBACK_INCLUDE_CONTENT (optional; defaults false per D-02 + T-121-01)
 *
 * Error handling contract (mirrors branding-config-loader.ts L13-21):
 *   - Missing env vars → cached = {enabled: false, reason: "..."} + sshLogger.info
 *   - Present but invalid (bad port, unpaired USER/PASSWORD, etc.) → cached =
 *     {enabled: false, reason: "..."} + sshLogger.info
 *   - This function NEVER RAISES; failure modes populate cached with a
 *     disabled sentinel. Even hostile env access (a getter that raises) is
 *     swallowed and yields a disabled sentinel (T-121-04).
 *
 * Divergence from branding-config-loader.ts (D-07):
 *   - No transporter handshake at load — bad-but-present SMTP creds surface
 *     at real send time, not at boot. Contrast with branding/assert-boot.ts's
 *     Phase 74 gate.
 *   - No hard-exit branch. Feedback is optional; a disabled config is a
 *     valid runtime state (the frontend hides the UI). See D-07.
 *
 * Threat mitigations:
 *   - T-121-01: FEEDBACK_INCLUDE_CONTENT defaults FALSE when unset or non-
 *     truthy. Explicit truthy set: "1" / "true" / "yes" (case-insensitive).
 *   - T-121-03: SMTP password is NEVER logged. The structured-log payload
 *     omits the password key entirely.
 *   - T-121-04: All env reads are wrapped in a fail-safe so a hostile
 *     getter-that-raises env access still returns a disabled sentinel.
 *
 * Pure module-scope state: no Express, no drizzle, no fs — safe to import anywhere.
 */

import { sshLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeedbackConfig =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      smtp: {
        host: string;
        port: number;
        user: string;
        password: string;
        fromAddress: string;
      };
      toAddress: string;
      includeContent: boolean;
    };

// ---------------------------------------------------------------------------
// Module-scope cache
// ---------------------------------------------------------------------------

let cached: FeedbackConfig | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely read a single env var. Returns "" on any read error (T-121-04 —
 * hostile env with a raising accessor property must not crash the loader).
 */
function safeEnv(key: string): string {
  try {
    const raw = process.env[key];
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

/**
 * Parse the FEEDBACK_INCLUDE_CONTENT flag. Defaults FALSE (T-121-01, D-02).
 * Truthy tokens: "1" / "true" / "yes" (case-insensitive, whitespace-trimmed).
 * All other values (including empty and unset) → false.
 */
function parseIncludeContent(raw: string): boolean {
  const norm = raw.trim().toLowerCase();
  return norm === "1" || norm === "true" || norm === "yes";
}

// ---------------------------------------------------------------------------
// Loader (D-07 contract: never raises)
// ---------------------------------------------------------------------------

/**
 * Called ONCE from starter.ts boot chain. Reads env, validates, populates
 * module-scope cache, and emits a single structured log line describing
 * the outcome. Never raises (D-07, T-121-04). Can be called multiple times
 * for test setup — each call fully re-populates the cache from current env.
 */
export function loadFeedbackConfig(): void {
  try {
    // Read + trim all string env vars except PASSWORD (Pitfall 4).
    const host = safeEnv("FEEDBACK_SMTP_HOST").trim();
    const portRaw = safeEnv("FEEDBACK_SMTP_PORT").trim();
    const user = safeEnv("FEEDBACK_SMTP_USER").trim();
    // NOTE (Pitfall 4): the secret env is read verbatim — no whitespace
    // stripping — because passwords may legitimately contain surrounding
    // whitespace (e.g., base64 tokens, app-passwords with padding).
    const password = safeEnv("FEEDBACK_SMTP_PASSWORD");
    const fromAddress = safeEnv("FEEDBACK_SMTP_FROM").trim();
    const toAddress = safeEnv("FEEDBACK_TO_ADDRESS").trim();
    const includeContentRaw = safeEnv("FEEDBACK_INCLUDE_CONTENT");
    const includeContent = parseIncludeContent(includeContentRaw);

    // D-06 required set: host, port, from, to. Report ALL missing at once so
    // operators can fix everything in one restart cycle.
    const missing: string[] = [];
    if (host === "") missing.push("FEEDBACK_SMTP_HOST");
    if (portRaw === "") missing.push("FEEDBACK_SMTP_PORT");
    if (fromAddress === "") missing.push("FEEDBACK_SMTP_FROM");
    if (toAddress === "") missing.push("FEEDBACK_TO_ADDRESS");

    // PORT numeric validation (only bother when non-empty — empty is already
    // reported above).
    let portNum = 0;
    if (portRaw !== "") {
      const parsed = Number(portRaw);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        missing.push("FEEDBACK_SMTP_PORT (must be a number)");
      } else if (parsed < 1 || parsed > 65535) {
        missing.push("FEEDBACK_SMTP_PORT (must be 1-65535)");
      } else {
        portNum = parsed;
      }
    }

    // D-04 pairing rule: USER + PASSWORD must both be set OR both be absent.
    // XOR-set → disabled. Anonymous relay (both absent) is allowed.
    const userSet = user !== "";
    const passwordSet = password !== "";
    if (userSet !== passwordSet) {
      missing.push(
        "FEEDBACK_SMTP_USER and FEEDBACK_SMTP_PASSWORD must be set together",
      );
    }

    if (missing.length > 0) {
      const reason = `missing/invalid: ${missing.join(", ")}`;
      cached = { enabled: false, reason };
      sshLogger.info("feedback-config: feature disabled", {
        operation: "feedback_config_load",
        enabled: false,
        reason,
      });
      return;
    }

    cached = {
      enabled: true,
      smtp: { host, port: portNum, user, password, fromAddress },
      toAddress,
      includeContent,
    };
    // T-121-03: DO NOT include password in the log payload. Every other
    // config field is safe to log at info level.
    sshLogger.info("feedback-config: feature enabled", {
      operation: "feedback_config_load",
      enabled: true,
      host,
      port: portNum,
      user, // username is not a secret; password is omitted
      fromAddress,
      toAddress,
      includeContent,
    });
  } catch (err) {
    // Absolute-last-resort safety net for T-121-04. Any unforeseen raise
    // (e.g., a hostile property accessor on process.env that safeEnv failed
    // to shield) becomes a disabled sentinel + a diagnostic log line.
    const reason = `internal error: ${err instanceof Error ? err.message : String(err)}`;
    cached = { enabled: false, reason };
    sshLogger.info("feedback-config: feature disabled", {
      operation: "feedback_config_load",
      enabled: false,
      reason,
    });
  }
}

// ---------------------------------------------------------------------------
// Accessor
// ---------------------------------------------------------------------------

/**
 * Returns the cached FeedbackConfig populated by loadFeedbackConfig().
 * Defensive default when called before load: `{enabled: false, reason:
 * "not_yet_loaded"}`. This should never happen when starter.ts ordering is
 * correct, but the sentinel keeps request-time code safe.
 */
export function getFeedbackConfig(): FeedbackConfig {
  if (cached === null) {
    return { enabled: false, reason: "not_yet_loaded" };
  }
  return cached;
}
