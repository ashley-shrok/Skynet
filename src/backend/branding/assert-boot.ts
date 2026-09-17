/**
 * Phase 74 Plan 02 — boot-time presence gate on `avatarDirectorSpec`.
 * Phase 114 Plan 04 — NON-throwing misconfig alarm on `instancePolicyFilename`
 * appended AFTER the Phase 74 gate. Deliberate non-replication of the
 * Phase 74 fatal shape: Skynet without a twinkie is a valid state; a
 * filename pointing at a missing file is a loud MISCONFIG, not a boot
 * failure. Contrast with the Phase 74 avatarDirectorSpec fatal gate above.
 *
 * Phase 74 contract (avatarDirectorSpec, UNCHANGED):
 *   - Reads the branding config once via `loadBrandingConfig()` (never-throws,
 *     per Phase 70 contract).
 *   - If `avatarDirectorSpec` is missing, empty, or whitespace-only-after-trim,
 *     logs a structured fatal via `systemLogger.error` with
 *     `operation: "branding_config_boot_gate"` and exits the process with
 *     code 1.
 *   - If non-empty after trim, returns silently — boot continues.
 *   - Does NOT gate on the gamma field (per user resolution #5 in
 *     74-CONTEXT.md — gamma is optional-with-code-default; the loader's
 *     shape guard already requires it be finite, and the request-time
 *     consumer trusts whatever value it reads).
 *
 * Phase 114 addition (instancePolicyFilename, NON-THROWING):
 *   - After the Phase 74 gate, examines `config.instancePolicyFilename`.
 *   - Empty string (the default): silent no-op. Guards against future
 *     accidental gate additions — a Skynet with no twinkie configured is
 *     a valid state per D-05.
 *   - Non-empty AND `readInstancePolicyBytes()` returns null (file missing,
 *     over the 256 KB byte cap, containment violation, or read error):
 *     emit `sshLogger.error` with the D-05 message shape and
 *     `operation: "branding_instance_policy_boot_alarm"`. NO throw, NO
 *     `process.exit` — the process continues to start. Ops sees the alarm
 *     immediately in the startup log stream (loud alarm, not a boot gate).
 *   - Non-empty AND resolver returns a Buffer: silent success.
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
 * surfaces the failed-boot log line so user sees why.
 *
 * Anti-pattern lock (74-CONTEXT.md § 'What would make it wrong' §5 + §3):
 *   NO fallback branch that reads a hardcoded spec constant. NO content
 *   validation beyond trim-then-length (trust-the-admin per 74-CONTEXT.md
 *   Philosophy — no regex, no word count, no forbidden-content list).
 *
 * Phase 114 anti-pattern lock (D-05, 112-CONTEXT.md § Philosophy):
 *   The Phase 114 branch MUST NOT call `process.exit` or throw — a
 *   misconfigured twinkie filename is not a boot failure, it is a
 *   misconfig ops needs to see loudly at boot. The regression test
 *   T-06c explicitly asserts `exitSpy.not.toHaveBeenCalled()` when the
 *   alarm fires, and acceptance_criteria demands `process.exit` appear
 *   EXACTLY ONCE in this file (the Phase 74 branch only).
 */

import { loadBrandingConfig, readInstancePolicyBytes } from "./branding-config-loader.js";
import { systemLogger, sshLogger } from "../utils/logger.js";

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

  // === Phase 114 (D-05): non-throwing instance-policy misconfig alarm ===
  // Fires when the admin has SET instancePolicyFilename but the referenced
  // markdown file is missing / over the 256 KB byte cap / contained-out /
  // unreadable. NOT a boot gate — process continues to start. A Skynet
  // without a twinkie is a valid state (D-05); a Skynet WITH a filename
  // pointing at a missing file is a misconfig ops needs to see loudly at
  // boot, not wait for a sweep grep to notice.
  const filename = (
    typeof config.instancePolicyFilename === "string"
      ? config.instancePolicyFilename
      : ""
  ).trim();
  if (filename !== "") {
    const bytes = await readInstancePolicyBytes();
    if (bytes === null) {
      const resolvedPath = `/etc/skynet/branding/${filename}`;
      sshLogger.error(
        `[branding] instance-policy field is set to '${filename}' but the file is missing (or unreadable) at ${resolvedPath} — no twinkie will be pushed to managed hosts this sweep. Fix by placing the file at that path OR clearing the branding-config field.`,
        {
          operation: "branding_instance_policy_boot_alarm",
          instancePolicyFilename: filename,
          resolvedPath,
        },
      );
      // NO throw, NO process.exit — this is a misconfig alarm, not a boot gate.
    }
  }
}
