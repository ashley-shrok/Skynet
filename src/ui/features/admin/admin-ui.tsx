/**
 * Admin helpers shared by the admin panel panes. The panes themselves are
 * built from the kit (`@/components/kit`); this file only keeps what the
 * kit doesn't cover — error-message recovery, the user avatar, and date
 * formatting.
 */

import { cn } from "@/lib/utils";

/**
 * Best human-readable message for a failed admin call. handleApiError
 * replaces every 403 body with a generic "Access denied" message but keeps
 * the axios response on the error, so the backend's own reason (e.g.
 * "Cannot delete the last admin user") is recovered from there first.
 */
export function adminErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: unknown } } })?.response
    ?.data;
  if (data && typeof data.error === "string" && data.error) return data.error;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// ─── User avatar ─────────────────────────────────────────────────────────

/** URL of a user's uploaded avatar, or null when they have none. */
export function userAvatarUrl(
  userId: string,
  avatarPath: string | null,
): string | null {
  return avatarPath
    ? `/users/${encodeURIComponent(userId)}/avatar?f=${encodeURIComponent(avatarPath)}`
    : null;
}

/** First letter of the username, upper-cased, for the initial avatar. */
export function userInitial(username: string): string {
  return [...username.trim()][0]?.toUpperCase() ?? "?";
}

/** Initial-circle / uploaded-avatar, for places that aren't a KitListRow. */
export function UserAvatar({
  userId,
  username,
  avatarPath,
  size = 28,
}: {
  userId: string;
  username: string;
  avatarPath: string | null;
  size?: number;
}) {
  const src = userAvatarUrl(userId, avatarPath);
  // The size is the caller's choice, so it's the one inline style here.
  const dims = { width: size, height: size, fontSize: size * 0.45 };
  return (
    <span
      aria-hidden="true"
      className={cn(
        "rounded-full shrink-0 overflow-hidden flex items-center justify-center font-semibold",
        "bg-[var(--k-s3)] text-[var(--k-t1)]",
      )}
      style={dims}
    >
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover" />
      ) : (
        userInitial(username)
      )}
    </span>
  );
}

/** "3 Oct 2026, 14:05" — or the raw string when it doesn't parse. */
export function formatAdminDate(value: string | null | undefined): string {
  if (!value) return "—";
  // SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC with no zone.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
