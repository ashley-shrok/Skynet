/**
 * Admin helpers shared by the admin panel panes. The panes themselves are
 * built from the kit (`@/components/kit`); this file only keeps what the
 * kit doesn't cover — error-message recovery, avatar URLs, dates, and the
 * back control / Esc for the views one level deeper.
 */

import { useEffect, useRef } from "react";
import { ChevronLeft } from "lucide-react";
import { escBelongsElsewhere } from "@/components/modal";

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

// ─── One level deeper ────────────────────────────────────────────────────

/** While `active`, Esc goes back one level instead of closing the window. */
export function useEscBack(active: boolean, onBack: () => void): void {
  const ref = useRef({ active, onBack });
  ref.current = { active, onBack };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented || !ref.current.active) return;
      if (escBelongsElsewhere(e)) return;
      e.preventDefault();
      e.stopPropagation();
      ref.current.onBack();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

/** "‹ Users" — back to the list a deeper view came from. Takes focus when
 *  the view opens, so the keyboard lands where the clicked row was. */
export function AdminBack({
  label,
  onBack,
  testId,
}: {
  label: string;
  onBack: () => void;
  testId: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-0.5 -ml-1 py-1.5 pr-1.5 text-[14px] font-[550] text-[var(--k-acc-text)] cursor-pointer"
      data-testid={testId}
    >
      <ChevronLeft size={18} aria-hidden="true" />
      {label}
    </button>
  );
}

/** "just now" / "12m ago" / "3h ago" / "4d ago" — or the date past 30 days.
 *  Takes a server timestamp string or epoch milliseconds. */
export function relativeAdminTime(value: string | number | null | undefined, now: number): string {
  if (value == null || value === "") return "—";
  let t: number;
  if (typeof value === "number") {
    t = value;
  } else {
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
    t = Date.parse(iso);
    if (Number.isNaN(t)) return value;
  }
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : formatAdminDate(new Date(t).toISOString());
}
