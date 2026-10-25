import { db } from "../database/db/index.js";

/** Sign-in length when the admin hasn't set one: 30 days, counted from sign-in. */
export const DEFAULT_SESSION_TIMEOUT_HOURS = 720;
export const MAX_SESSION_TIMEOUT_HOURS = 720;

function readSetting(): number | null {
  const row = db.$client
    .prepare("SELECT value FROM settings WHERE key = 'session_timeout_hours'")
    .get() as { value: string } | undefined;
  const hours = row ? parseInt(row.value, 10) : NaN;
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

/** How long a sign-in lasts, in hours — the admin setting, else the default. */
export function getSessionTimeoutHours(): number {
  return readSetting() ?? DEFAULT_SESSION_TIMEOUT_HOURS;
}

/**
 * Lifetime for the server's own sessionless tokens (internal calls, never a
 * sign-in). Kept at what they had before the 30-day default: the setting,
 * else 20 hours.
 */
export function getSessionlessTokenHours(): number {
  return readSetting() ?? 20;
}
