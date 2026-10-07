/**
 * Shared building blocks for the admin panel panes — section headers,
 * setting rows, buttons and inline status text, styled to match the
 * Preferences panes (slate modal, cream text, muted uppercase labels).
 */

import type { ReactNode } from "react";
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

export function AdminSection({
  title,
  description,
  children,
  testId,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h3 className="text-[12px] uppercase tracking-wide text-[#a89a80]">
        {title}
      </h3>
      {description && (
        <p className="text-[12.5px] leading-[1.45] text-[#a89a80]">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

/** One label/description on the left, a control on the right. */
export function AdminRow({
  label,
  description,
  control,
  testId,
}: {
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="flex items-center gap-4 py-2 border-b border-white/[0.06] last:border-b-0"
      data-testid={testId}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-[13px] text-[#e8e4d8]">{label}</span>
        {description && (
          <span className="text-[12px] leading-[1.4] text-[#a89a80]">
            {description}
          </span>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2">{control}</div>
    </div>
  );
}

type ButtonTone = "default" | "danger";

export function AdminButton({
  tone = "default",
  className,
  ...props
}: React.ComponentProps<"button"> & { tone?: ButtonTone }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "px-3 py-1.5 rounded-md text-[12.5px] cursor-pointer whitespace-nowrap",
        "disabled:cursor-not-allowed disabled:opacity-60",
        tone === "danger"
          ? "bg-transparent border border-[rgba(211,143,143,0.35)] text-[#d38f8f] hover:bg-[rgba(211,143,143,0.08)]"
          : "bg-black/20 border border-white/10 text-[#e8e4d8] hover:bg-black/30",
        className,
      )}
    />
  );
}

export const adminInputClass = cn(
  "px-2.5 py-1.5 rounded-md text-[13px] font-mono",
  "bg-black/25 border border-[rgba(255,240,215,0.18)] text-[#e8e4d8]",
  "focus:outline-none focus:border-[hsla(var(--pv-id-hue),70%,60%,0.55)]",
  "disabled:opacity-60",
);

export function AdminError({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <span
      role="alert"
      data-testid={testId}
      className="text-[12px] text-[#d38f8f]"
    >
      {children}
    </span>
  );
}

export function AdminMuted({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] text-[#a89a80]">{children}</p>;
}

export function AdminBadge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "accent";
}) {
  return (
    <span
      className={cn(
        "px-1.5 py-px rounded text-[10.5px] font-medium uppercase tracking-wide",
        tone === "accent"
          ? "bg-[hsla(var(--pv-id-hue),60%,50%,0.28)] text-[#fbf5e8]"
          : "bg-white/[0.07] text-[#cfc8b8]",
      )}
    >
      {children}
    </span>
  );
}

/** Same initial-circle / uploaded-avatar treatment as the sidebar footer. */
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
  const initial = [...username.trim()][0]?.toUpperCase() ?? "?";
  if (avatarPath) {
    return (
      <img
        src={`/users/${encodeURIComponent(userId)}/avatar?f=${encodeURIComponent(avatarPath)}`}
        alt=""
        aria-hidden="true"
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="rounded-full shrink-0 flex items-center justify-center font-semibold bg-[hsla(var(--pv-id-hue),40%,45%,0.45)] text-[#fbf5e8]"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {initial}
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
