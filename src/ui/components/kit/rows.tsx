import * as React from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

// Kit rows: grouped settings rows, the one list row, and the file toolbar.

// ─── Settings rows ───────────────────────────────────────────────────────

export function KitSettingsGroup({
  title,
  footer,
  className,
  children,
  "data-testid": testId,
}: {
  title?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  "data-testid"?: string;
}): JSX.Element {
  return (
    <section className={cn("k-group-wrap", className)} data-testid={testId}>
      {title ? <h3 className="k-group-title">{title}</h3> : null}
      <div className="k-group">{children}</div>
      {footer ? <p className="k-group-foot">{footer}</p> : null}
    </section>
  );
}

export interface KitSettingsRowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** The control on the right (switch, dropdown, value…). */
  control?: React.ReactNode;
  /** Plain value text on the right, dimmed. */
  value?: React.ReactNode;
  /** Makes the whole row a button (adds a chevron unless `chevron={false}`). */
  onClick?: () => void;
  chevron?: boolean;
  tone?: "default" | "danger";
  disabled?: boolean;
  /** Label on top, control full-width below (for wide controls). */
  stacked?: boolean;
  className?: string;
  "data-testid"?: string;
  children?: React.ReactNode;
}

/** What it is on the left, its control on the right. */
export function KitSettingsRow({
  label,
  description,
  control,
  value,
  onClick,
  chevron,
  tone = "default",
  disabled,
  stacked,
  className,
  "data-testid": testId,
  children,
}: KitSettingsRowProps): JSX.Element {
  const inner = (
    <>
      <span className="k-row-text">
        <span className="k-row-label">{label}</span>
        {description ? <span className="k-row-desc">{description}</span> : null}
      </span>
      {value != null ? <span className="k-row-value">{value}</span> : null}
      {control}
      {children}
      {onClick && chevron !== false ? <ChevronRight className="k-row-chev" aria-hidden="true" /> : null}
    </>
  );
  const common = {
    className: cn("k-row", className),
    "data-tone": tone === "danger" ? "danger" : undefined,
    "data-disabled": disabled ? "true" : undefined,
    "data-stack": stacked ? "true" : undefined,
    "data-testid": testId,
  };
  if (onClick) {
    return (
      <button type="button" disabled={disabled} onClick={onClick} {...common}>
        {inner}
      </button>
    );
  }
  return <div {...common}>{inner}</div>;
}

// ─── List rows ───────────────────────────────────────────────────────────

export function KitList({ className, ...props }: React.ComponentProps<"div">): JSX.Element {
  return <div data-slot="kit-list" className={cn("k-list", className)} {...props} />;
}

/** A small heading between groups of list rows. */
export function KitListHead({ className, ...props }: React.ComponentProps<"div">): JSX.Element {
  return <div className={cn("k-list-head", className)} {...props} />;
}

export interface KitListRowProps extends Omit<React.ComponentProps<"div">, "title"> {
  /** Avatar: an image URL, or any node (initial, emoji, icon). */
  avatar?: React.ReactNode;
  avatarSrc?: string | null;
  avatarColor?: string;
  avatarShape?: "round" | "square";
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Let the subtitle wrap instead of truncating. */
  wrapSubtitle?: boolean;
  /** Chips, switches, values — sits before the menu. */
  trailing?: React.ReactNode;
  /** The three-dot menu; shown on hover/focus (always on touch). */
  menu?: React.ReactNode;
  selected?: boolean;
  /** Archived / unavailable look. */
  dim?: boolean;
  onActivate?: () => void;
}

/** One row for roles, tasks, search results, archived things, users. */
export const KitListRow = React.forwardRef<HTMLDivElement, KitListRowProps>(function KitListRow(
  {
    avatar,
    avatarSrc,
    avatarColor,
    avatarShape = "round",
    title,
    subtitle,
    wrapSubtitle,
    trailing,
    menu,
    selected,
    dim,
    onActivate,
    className,
    onKeyDown,
    ...props
  },
  ref,
) {
  const clickable = !!onActivate;
  return (
    <div
      ref={ref}
      data-slot="kit-list-row"
      data-clickable={clickable ? "true" : undefined}
      data-dim={dim ? "true" : undefined}
      aria-selected={selected || undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={cn("k-item", className)}
      onClick={
        clickable
          ? (e) => {
              // Clicks on the row's own controls (menu, switch) don't activate
              // it, nor do clicks that bubble up from a portaled menu or dialog.
              const target = e.target as Element;
              if (!e.currentTarget.contains(target)) return;
              if (target.closest("button, input, select, textarea, a, label")) return;
              onActivate?.();
            }
          : undefined
      }
      onKeyDown={(e) => {
        if (clickable && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onActivate?.();
        }
        onKeyDown?.(e);
      }}
      {...props}
    >
      {avatar != null || avatarSrc ? (
        <span
          className="k-item-av"
          data-shape={avatarShape === "square" ? "square" : undefined}
          style={avatarColor ? { background: avatarColor } : undefined}
          aria-hidden="true"
        >
          {avatarSrc ? <img src={avatarSrc} alt="" /> : avatar}
        </span>
      ) : null}
      <span className="k-item-text">
        <span className="k-item-title">{title}</span>
        {subtitle ? (
          <span className="k-item-sub" data-wrap={wrapSubtitle ? "true" : undefined}>
            {subtitle}
          </span>
        ) : null}
      </span>
      {trailing || menu ? (
        <span className="k-item-trail">
          {trailing}
          {menu ? <span className="k-item-menu">{menu}</span> : null}
        </span>
      ) : null}
    </div>
  );
});

// ─── Toolbar ─────────────────────────────────────────────────────────────

/** Where-you-are on the left, actions on the right (Files, Git, Desktop). */
export function KitToolbar({ className, ...props }: React.ComponentProps<"div">): JSX.Element {
  return <div role="toolbar" data-slot="kit-toolbar" className={cn("k-toolbar", className)} {...props} />;
}

export function KitToolbarSpacer(): JSX.Element {
  return <span className="k-toolbar-grow" />;
}

export interface KitCrumb {
  label: React.ReactNode;
  onClick?: () => void;
  testId?: string;
}

/** Breadcrumbs: every crumb but the last is a button. */
export function KitCrumbs({
  crumbs,
  className,
  "aria-label": ariaLabel = "Location",
}: {
  crumbs: ReadonlyArray<KitCrumb>;
  className?: string;
  "aria-label"?: string;
}): JSX.Element {
  return (
    <nav aria-label={ariaLabel} className={cn("k-crumbs", className)}>
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <React.Fragment key={i}>
            {i > 0 ? <span aria-hidden="true">/</span> : null}
            {last || !c.onClick ? (
              <span aria-current={last ? "page" : undefined} data-testid={c.testId}>
                {c.label}
              </span>
            ) : (
              <button type="button" onClick={c.onClick} data-testid={c.testId}>
                {c.label}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
