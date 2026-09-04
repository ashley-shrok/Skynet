/**
 * Phase 74 Plan 02 — boot-time presence gate on `avatarDirectorSpec`.
 *
 * Contract:
 *   - Reads the branding config once via `loadBrandingConfig()` (never-throws,
 *     per Phase 70 contract).
 *   - If `avatarDirectorSpec` is missing, empty, or whitespace-only-after-trim,
 *     logs a structured fatal via `systemLogger.error` with
 *     `operation: "branding_config_boot_gate"` and exits the process with
 *     code 1.
 *   - If non-empty after trim, returns silently — boot continues.
 *   - Does NOT gate on the gamma field (per Ashley resolution #5 in
 *     74-CONTEXT.md — gamma is optional-with-code-default; the loader's
 *     shape guard already requires it be finite, and the request-time
 *     consumer trusts whatever value it reads).
 *
 * Why a SEPARATE module (not a throw inside the loader):
 *   The Phase 70 loader is deliberately never-throws so `/api/branding` HTTP
 *   route can't crash. Adding a throw path there would break that contract.
 *   The boot gate lives here as an explicit fail-fast layer invoked once at
 *   startup from starter.ts's boot IIFE.
 *
 * Fail-fast pattern reference: starter.ts L753-770 (uncaughtException +
 * startup_failed catch) uses the same structured-error-log + non-zero-exit
 * shape. The container supervisor sees the non-zero exit and restarts /
 * surfaces the failed-boot log line so Ashley sees why.
 *
 * Anti-pattern lock (74-CONTEXT.md § 'What would make it wrong' §5 + §3):
 *   NO fallback branch that reads a hardcoded spec constant. NO content
 *   validation beyond trim-then-length (trust-the-admin per 74-CONTEXT.md
 *   Philosophy — no regex, no word count, no forbidden-content list).
 */

import { loadBrandingConfig } from "./branding-config-loader.js";
import { systemLogger } from "../utils/logger.js";

export async function assertBrandingConfigAtBoot(): Promise<void> {
  const config = await loadBrandingConfig();
  // Defensive `?? ""` because the loader's shape guard normally rejects a
  // missing avatarDirectorSpec (falls back to bundled defaults, whose spec
  // is intentionally ""), but defense-in-depth: this gate must not crash on
  // an unexpected `undefined` reaching it — it must FIRE.
  const spec = (
    typeof config.avatarDirectorSpec === "string" ? config.avatarDirectorSpec : ""
  ).trim();
  if (spec.length === 0) {
    systemLogger.error(
      "Fatal: branding.json is missing or has empty avatarDirectorSpec — refusing to boot",
      new Error("avatarDirectorSpec missing"),
      { operation: "branding_config_boot_gate" },
    );
    process.exit(1);
  }
}
