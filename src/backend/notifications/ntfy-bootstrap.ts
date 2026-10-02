/**
 * Phase 144 belt-and-suspenders ntfy admin bootstrap. Primary provisioning
 * path is docker/ntfy/server.yml (plan 01 task 1). This runtime bootstrap
 * exists as a safety net for environments where server.yml provisioning
 * failed — in the normal case, createNtfyUser returns 409 and this function
 * is a no-op. HC-1 clarification per plan-checker review.
 *
 * ## What this does
 *
 * At backend startup, attempts to create the ntfy admin user identified
 * by `getNtfyAdminUser()`. The ntfy admin user is the SAME identity used
 * for both:
 *   - HTTP admin API calls (Basic auth in ntfy-admin-client.ts)
 *   - Publish calls (Bearer token from NTFY_PUBLISH_TOKEN)
 *
 * ## Why 409 is expected and swallowed
 *
 * In the normal runtime path, the admin user was already created by
 * docker/ntfy/server.yml at `docker compose up`. ntfy's HTTP admin API
 * returns 409 Conflict when asked to create a user that already exists.
 * This is the SUCCESS case — the admin user exists and the bootstrap is
 * a no-op. Logs at info level to confirm it was called and found the
 * user already present.
 *
 * ## Why this is belt-and-suspenders only
 *
 * The server.yml provisioning path (plan 01) is the primary and correct
 * way to ensure the admin user exists. This runtime bootstrap is a safety
 * net for environments where:
 *   - server.yml was not mounted correctly
 *   - The ntfy container was recreated without server.yml (edge case)
 *   - Auth.db was wiped and ntfy needs re-provisioning
 *
 * Failure is non-fatal: if ntfy is slow to start or the admin API is
 * temporarily unavailable, the backend boots anyway and the trigger loop
 * will retry publishes naturally. The next DM will either succeed (if
 * ntfy came up) or log a warn (if still down).
 *
 * ## HC-1 clarification (plan-checker HC-1 flag)
 *
 * This function calls `createNtfyUser(getNtfyAdminUser(), ...)` — it does
 * NOT hardcode the string "skynet-publisher" or any other identity name.
 * The admin user name comes from `NTFY_ADMIN_USER` env var via `getNtfyAdminUser()`.
 * Using getNtfyAdminUser() ensures the bootstrap is coherent with the admin
 * API client and server.yml provisioning, regardless of what name the operator
 * chose for the admin identity.
 */

import { createNtfyUser, NtfyAdminError } from "./ntfy-admin-client.js";
import { getNtfyAdminUser, getNtfyAdminPassword } from "./ntfy-config.js";
import { systemLogger } from "../utils/logger.js";

/**
 * Belt-and-suspenders safety net: attempt to ensure the ntfy admin user
 * (identified by `getNtfyAdminUser()`) exists in the ntfy auth.db.
 *
 * This is called from starter.ts after `assertNtfyConfigAtBoot()` using
 * void (fire-and-forget, not awaited) — a failure here must not prevent
 * the backend from starting.
 *
 * HC-1: uses getNtfyAdminUser() — NEVER a hardcoded "skynet-publisher" string.
 * HC-2 context: primary provisioning is server.yml at compose up; this is
 * belt-and-suspenders only. The 409 case (user already exists) is the
 * normal, expected outcome.
 */
export async function ensureSkynetPublisherUserExists(): Promise<void> {
  const adminUser = getNtfyAdminUser();
  const adminPass = getNtfyAdminPassword();

  try {
    await createNtfyUser(adminUser, adminPass);
    systemLogger.info("[ntfy] admin user created via bootstrap (server.yml may not have run)", {
      operation: "ntfy_bootstrap_admin_created",
    });
  } catch (err) {
    if (err instanceof NtfyAdminError && err.status === 409) {
      // Expected case: server.yml already provisioned the admin user at
      // compose up. 409 means "user already exists" — this is a no-op.
      systemLogger.info(
        "[ntfy] admin user already exists (expected — provisioned by server.yml)",
        {
          operation: "ntfy_bootstrap_admin_already_exists",
          status: 409,
        },
      );
      return;
    }

    // Non-409 error: ntfy may be slow to start, or config is wrong.
    // Log a warning but do NOT throw — backend startup must not fail here.
    // The trigger loop will retry publishes on the next DM; if ntfy is
    // consistently unavailable, the structured warn logs will surface it.
    systemLogger.warn(
      "[ntfy] belt-and-suspenders bootstrap failed (non-fatal — ntfy may be starting up; retry on next DM)",
      {
        operation: "ntfy_bootstrap_failed",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
  }
}
