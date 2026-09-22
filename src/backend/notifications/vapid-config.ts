/**
 * Phase 128 Plan 02 Task 2 — VAPID env-var loader with fail-fast boot gate.
 *
 * What this module does:
 *   - `assertVapidConfigAtBoot()` — invoked once at process start (Plan 08
 *     will wire it into starter.ts at the same insertion point as
 *     `assertBrandingConfigAtBoot`, per PATTERNS.md §5). Reads the three
 *     VAPID env vars, throws a structured Error naming the offender when
 *     any is missing OR when `VAPID_SUBJECT` is not a `mailto:` or `https://`
 *     URL. Logs a redacted-safe success line on the happy path.
 *   - `getVapidDetails()` — per-call reader that returns
 *     `{subject, publicKey, privateKey}`. Called by push-sender.ts's
 *     module-top-level `webpush.setVapidDetails(...)` init.
 *
 * Why fail-fast at boot:
 *   Same shape as `src/backend/branding/assert-boot.ts::assertBrandingConfigAtBoot`
 *   (PATTERNS.md §5 analog). A missing or malformed VAPID subject means
 *   every push send would return 403 from Apple's push service silently
 *   (RESEARCH.md § Common Pitfalls § Pitfall 2). Better to refuse to boot
 *   than to run degraded and silently drop every notification.
 *
 * Why env-var storage (not DB row):
 *   Planner picked the env-var path per RESEARCH.md § Open Question 1 —
 *   simpler deploy shape, no ingest route, no admin surface. The private
 *   key lives ONLY in the operator's deployment env / skynet.env; NEVER
 *   in disk-persisted state managed by this codebase. Threat T-128-06
 *   mitigation.
 *
 * Why NO setVapidDetails call here:
 *   This module ONLY loads + validates. Task 3's push-sender.ts owns the
 *   module-top-level `webpush.setVapidDetails(...)` call — separation of
 *   concerns keeps this module test-friendly (no library import → no need
 *   to mock web-push in vapid-config.test.ts).
 *
 * Security discipline:
 *   The success log line names the load but NEVER emits the private key
 *   or the full public key value (Security V6/V7). We log a `publicKeyLen`
 *   count and the subject scheme prefix only — enough for ops to confirm
 *   "config loaded" without turning the log stream into a key-extraction
 *   surface.
 */

import { systemLogger } from "../utils/logger.js";

/**
 * Subjects must match `mailto:` or `https://` (Web Push VAPID spec RFC 8292
 * + Apple's push service constraint — Apple returns 403 for anything else,
 * RESEARCH.md § Pitfall 2). Bare domains, `http://`, and bare emails all
 * fail the validation.
 */
const VAPID_SUBJECT_PATTERN = /^(mailto:|https:\/\/)/;

interface VapidDetails {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Read + validate the three VAPID env vars, throwing a structured Error
 * that names the offender on any failure. Never returns partial config.
 *
 * Callers: `assertVapidConfigAtBoot` (boot-time gate) and any code path
 * that needs the raw values (push-sender.ts at module top-level).
 */
function readVapidEnv(): VapidDetails {
  const publicKey = (process.env.VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (process.env.VAPID_SUBJECT ?? "").trim();

  if (publicKey.length === 0) {
    throw new Error(
      "VAPID_PUBLIC_KEY env var is missing or empty. Generate a keypair via `npx web-push generate-vapid-keys` and paste the publicKey into skynet.env before boot.",
    );
  }
  if (privateKey.length === 0) {
    throw new Error(
      "VAPID_PRIVATE_KEY env var is missing or empty. Generate a keypair via `npx web-push generate-vapid-keys` and paste the privateKey into skynet.env before boot.",
    );
  }
  if (subject.length === 0) {
    throw new Error(
      "VAPID_SUBJECT env var is missing or empty. Set to a mailto: URL (e.g. mailto:admin@example.com) or https:// URL before boot — Apple's push service returns 403 on any other subject shape.",
    );
  }
  if (!VAPID_SUBJECT_PATTERN.test(subject)) {
    throw new Error(
      `VAPID_SUBJECT env var is malformed (received: ${JSON.stringify(subject)}). Must start with 'mailto:' or 'https://' — Apple's push service returns 403 on any other subject shape (see Web Push VAPID spec RFC 8292).`,
    );
  }

  return { subject, publicKey, privateKey };
}

/**
 * Boot-time gate. Invoked ONCE from starter.ts (Plan 08 wires this).
 * Throws a structured, operator-facing Error on any missing/malformed env
 * var — the container supervisor sees the non-zero exit and the failed-boot
 * log line surfaces immediately.
 *
 * Mirrors `assertBrandingConfigAtBoot` — same fail-fast discipline, same
 * "structured error before any HTTP route mounts" placement.
 *
 * Success log: names the load + subject scheme + public-key length ONLY.
 * NEVER prints key material (Security V6/V7 + Threat T-128-06 mitigation).
 */
export function assertVapidConfigAtBoot(): void {
  // Throws if invalid; we intentionally re-throw so starter.ts's uncaught-
  // exception handler produces the standard structured-error-log + non-zero
  // exit that the container supervisor watches for.
  const { subject, publicKey } = readVapidEnv();

  // Subject scheme prefix ("mailto:" or "https://") is safe to log — it's
  // shape data, not key material. Public-key length is safe to log — it's
  // a bounded integer, not the value.
  const subjectScheme = subject.startsWith("mailto:") ? "mailto:" : "https://";

  systemLogger.info("[push] VAPID config loaded", {
    operation: "vapid_config_boot_loaded",
    subjectScheme,
    publicKeyLen: publicKey.length,
  });
}

/**
 * Per-call reader for push-sender.ts. Returns the tuple web-push needs for
 * `webpush.setVapidDetails(subject, publicKey, privateKey)`.
 *
 * Reads env vars fresh each call (rather than caching at module load) so
 * that an operator hot-swap of skynet.env plus a process restart is the
 * ONLY path to picking up new keys — no stale-in-memory copy sitting on a
 * decommissioned key past a restart.
 *
 * Throws if any env var is missing/malformed — callers depend on all three
 * being valid; silently returning partial config would produce cryptic
 * downstream errors from web-push's ES256 signer.
 */
export function getVapidDetails(): VapidDetails {
  return readVapidEnv();
}
