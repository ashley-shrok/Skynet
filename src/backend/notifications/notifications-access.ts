/**
 * Notifications access gate.
 *
 * Push notifications are opt-in per user: `users.notifications_enabled`
 * defaults to 0, and admins always pass. Checked at two layers:
 *   - the /push-subscriptions/* routes (setup, test, regenerate, delete), and
 *   - sendPushToUser at publish time, so a user who set up ntfy and later
 *     lost the flag (and isn't an admin) stops receiving pushes even though
 *     their push_subscriptions row still exists.
 *
 * Read live from the DB on every call (not from the JWT) so revocation takes
 * effect immediately.
 */

import { db } from "../database/db/index.js";

interface AccessRow {
  is_admin: number;
  notifications_enabled: number;
}

export function userCanUseNotifications(userId: string): boolean {
  const row = db.$client
    .prepare("SELECT is_admin, notifications_enabled FROM users WHERE id = ?")
    .get(userId) as AccessRow | undefined;
  if (!row) return false;
  return !!row.is_admin || !!row.notifications_enabled;
}
