import * as React from "react";
import { Check, ChevronRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

// Kit rows: grouped settings rows, the one list row, and the file toolbar.

// ─── Settings rows ───────────────────────────────────────────────────────

export interface KitColumn {
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Hover text explaining the column. */
  hint?: string;
}

export function KitSettingsGroup({
  title,
  note,
  columns,
  chevronSpace,
  footer,
  className,
  children,
  "data-testid": testId,
}: {
  title?: React.ReactNode;
  /** A line right under the title — what this group is. */
  note?: React.ReactNode;
  /** Labels over the rows' controls; each row puts one KitCell per column. */
  columns?: ReadonlyArray<KitColumn>;
  /** Leave room for the rows' chevrons at the end of the column labels. */
  chevronSpace?: boolean;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  "data-testid"?: string;
}): JSX.Element {
  return (
    <section className={cn("k-group-wrap", className)} data-testid={testId}>
      {title ? <h3 className="k-group-title">{title}</h3> : null}
      {note ? <p className="k-group-note">{note}</p> : null}
      {columns?.length ? (
        <div className="k-cols" aria-hidden="true">
          <span className="k-cols-grow" />
          {columns.map((c, i) => (
            <span key={i} className="k-cell" title={c.hint}>
              {c.icon}
              {c.label}
            </span>
          ))}
          {chevronSpace ? <span className="k-cols-chev" /> : null}
        </div>
      ) : null}
      <div className="k-group">{children}</div>
      {footer ? <p className="k-group-foot">{footer}</p> : null}
    </section>
  );
}

export interface KitSettingsRowProps {
  /** A picture or icon before the label (e.g. a KitAvatar). */
  leading?: React.ReactNode;
  label: React.ReactNode;
  description?: React.ReactNode;
  /** The control on the right (switch, dropdown, value…). */
  control?: React.ReactNode;
  /** Plain value text on the right, dimmed. */
  value?: React.ReactNode;
  /** Makes the whole row a button (adds a chevron unless `chevron={false}`). */
  onClick?: () => void;
  chevron?: boolean;
  /** "accent" colours the label like a link — an action row ("Send a test"). */
  tone?: "default" | "danger" | "accent";
  disabled?: boolean;
  /** Label on top, control full-width below (for wide controls). */
  stacked?: boolean;
  /** One-line description (two on a phone) instead of wrapping. */
  truncate?: boolean;
  /** Accessible name for the row's open button (when onClick + control). */
  openLabel?: string;
  /** A toggle row: announces picked/not picked (aria-pressed) on its button. */
  pressed?: boolean;
  /** Right-click on the row (e.g. a row menu at the cursor). */
  onContextMenu?: React.MouseEventHandler<HTMLElement>;
  className?: string;
  "data-testid"?: string;
  children?: React.ReactNode;
}

/** What it is on the left, its control on the right. */
export function KitSettingsRow({
  leading,
  label,
  description,
  control,
  value,
  onClick,
  chevron,
  tone = "default",
  disabled,
  stacked,
  truncate,
  openLabel,
  pressed,
  onContextMenu,
  className,
  "data-testid": testId,
  children,
}: KitSettingsRowProps): JSX.Element {
  const text = (
    <>
      {leading}
      <span className="k-row-text">
        <span className="k-row-label">{label}</span>
        {description ? <span className="k-row-desc">{description}</span> : null}
      </span>
    </>
  );
  // Opens something AND has its own controls: the text is the button and
  // the controls sit beside it, so no control ends up inside a button.
  if (onClick && control) {
    return (
      <div
        className={cn("k-row", className)}
        data-split="true"
        data-tone={tone === "default" ? undefined : tone}
        data-truncate={truncate ? "true" : undefined}
        data-disabled={disabled ? "true" : undefined}
        data-testid={testId}
        onContextMenu={onContextMenu}
        onClick={(e) => {
          const target = e.target as Element;
          // Controls and the cells around them don't open the row — a click
          // that just misses a switch shouldn't navigate away.
          if (target.closest("button, input, select, textarea, a, label, .k-cell")) return;
          onClick();
        }}
      >
        <button type="button" className="k-row-main" onClick={onClick} disabled={disabled} aria-label={openLabel} aria-pressed={pressed}>
          {text}
        </button>
        {value != null ? <span className="k-row-value">{value}</span> : null}
        {control}
        {children}
        {chevron !== false ? <ChevronRight className="k-row-chev" aria-hidden="true" /> : null}
      </div>
    );
  }
  const inner = (
    <>
      {text}
      {value != null ? <span className="k-row-value">{value}</span> : null}
      {control}
      {children}
      {onClick && chevron !== false ? <ChevronRight className="k-row-chev" aria-hidden="true" /> : null}
    </>
  );
  const common = {
    className: cn("k-row", className),
    "data-tone": tone === "default" ? undefined : tone,
    "data-disabled": disabled ? "true" : undefined,
    "data-stack": stacked ? "true" : undefined,
    "data-truncate": truncate ? "true" : undefined,
    "data-testid": testId,
    onContextMenu,
  };
  if (onClick) {
    return (
      <button type="button" disabled={disabled} onClick={onClick} aria-pressed={pressed} {...common}>
        {inner}
      </button>
    );
  }
  return <div {...common}>{inner}</div>;
}

/** A round picture (or initial) on a colour — rows, heads, previews. */
export function KitAvatar({
  src,
  fallback,
  color,
  size = 38,
  dim,
  className,
  "data-testid": testId,
}: {
  src?: string | null;
  /** Shown when there's no picture (or it fails to load) — usually an initial. */
  fallback?: React.ReactNode;
  color?: string;
  size?: number;
  dim?: boolean;
  className?: string;
  "data-testid"?: string;
}): JSX.Element {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  return (
    <span
      className={cn("k-item-av", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        ...(color ? { background: color } : {}),
        ...(dim ? { filter: "grayscale(1) brightness(0.7)" } : {}),
      }}
      aria-hidden="true"
      data-testid={testId}
    >
      {src && !failed ? <img src={src} alt="" draggable={false} onError={() => setFailed(true)} /> : fallback}
    </span>
  );
}

/** One column's slot in a row, under a KitSettingsGroup column label. */
export function KitCell({ className, ...props }: React.ComponentProps<"span">): JSX.Element {
  return <span className={cn("k-cell", className)} {...props} />;
}

/** A setting shown but not changeable here: a check when on, a dash when off. */
export function KitMark({
  on,
  label,
  "data-testid": testId,
}: {
  on: boolean;
  /** Says what the mark means — hover text and screen-reader name. */
  label: string;
  "data-testid"?: string;
}): JSX.Element {
  return (
    <span className="k-mark" data-on={on ? "true" : "false"} title={label} role="img" aria-label={label} data-testid={testId}>
      {on ? <Check strokeWidth={2.8} /> : <Minus strokeWidth={2.6} />}
    </span>
  );
}

// ─── List rows ───────────────────────────────────────────────────────────

const InKitList = React.createContext(false);

/** A list of KitListRows — announced as a list ("list, N items"). */
export function KitList({ className, ...props }: React.ComponentProps<"div">): JSX.Element {
  return (
    <InKitList.Provider value={true}>
      <div role="list" data-slot="kit-list" className={cn("k-list", className)} {...props} />
    </InKitList.Provider>
  );
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

/**
 * One row for roles, tasks, search results, archived things, users. When
 * it's clickable, the avatar + text are one real button and the row's own
 * controls (switch, chips, menu) sit beside it — never inside it — so
 * screen readers reach each of them. A click anywhere on the row that isn't
 * one of those controls also activates it.
 */
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
    role: ownRole,
    "aria-label": ariaLabel,
    onKeyDown,
    ...props
  },
  ref,
) {
  const inList = React.useContext(InKitList);
  const clickable = !!onActivate;
  // A caller that gives the row its own role (e.g. "option" in a listbox)
  // owns its semantics: the whole row is the focusable, activatable item.
  // Otherwise the avatar + text are a real button inside the row.
  const wholeRow = clickable && !!ownRole;
  const mainButton = clickable && !ownRole;
  const content = (
    <>
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
    </>
  );
  return (
    <div
      ref={ref}
      role={ownRole ?? (inList ? "listitem" : undefined)}
      aria-label={mainButton ? undefined : ariaLabel}
      tabIndex={wholeRow ? 0 : undefined}
      onKeyDown={(e) => {
        if (wholeRow && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onActivate?.();
        }
        onKeyDown?.(e);
      }}
      data-slot="kit-list-row"
      data-clickable={clickable ? "true" : undefined}
      data-dim={dim ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      className={cn("k-item", className)}
      onClick={
        clickable
          ? (e) => {
              // Clicks on the row's own controls (menu, switch) don't activate
              // it, nor do clicks that bubble up from a portaled menu or
              // dialog, nor the main button (it activates itself).
              const target = e.target as Element;
              if (!e.currentTarget.contains(target)) return;
              if (target.closest("button, input, select, textarea, a, label")) return;
              onActivate?.();
            }
          : undefined
      }
      {...props}
    >
      {mainButton ? (
        <button
          type="button"
          className="k-item-main"
          aria-label={ariaLabel}
          aria-current={selected ? "true" : undefined}
          onClick={() => onActivate?.()}
        >
          {content}
        </button>
      ) : (
        <span className="k-item-main">{content}</span>
      )}
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

/**
 * The top of a settings section: an icon tile, the section's name, and one
 * line saying what the section is for.
 */
export function KitSectionHero({
  icon,
  title,
  description,
  className,
  "data-testid": testId,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}): JSX.Element {
  return (
    <header className={cn("k-hero", className)} data-testid={testId}>
      <span className="k-hero-tile" aria-hidden="true">
        {icon}
      </span>
      <span className="k-hero-text">
        <h2 className="k-hero-title">{title}</h2>
        {description ? <p className="k-hero-desc">{description}</p> : null}
      </span>
    </header>
  );
}
