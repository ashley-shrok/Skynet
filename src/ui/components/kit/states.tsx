import * as React from "react";
import { AlertCircle, CheckCircle2, Info, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { KitIconButton } from "./buttons";

// Kit states: one empty state, one loading look, one way to show a problem.

export function KitEmpty({
  icon,
  title,
  body,
  action,
  className,
  "data-testid": testId,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}): JSX.Element {
  return (
    <div className={cn("k-empty", className)} data-slot="kit-empty" data-testid={testId}>
      {icon}
      <div className="k-empty-title">{title}</div>
      {body ? <div className="k-empty-body">{body}</div> : null}
      {action ? <div className="k-empty-action">{action}</div> : null}
    </div>
  );
}

/** Shimmering placeholder lines, optionally with a spinner + label. */
export function KitLoading({
  label,
  lines = 3,
  className,
  "data-testid": testId,
}: {
  label?: React.ReactNode;
  lines?: number;
  className?: string;
  "data-testid"?: string;
}): JSX.Element {
  const widths = ["70%", "100%", "85%", "60%", "92%"];
  return (
    <div
      className={cn("k-loading", className)}
      role="status"
      aria-live="polite"
      data-slot="kit-loading"
      data-testid={testId}
    >
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="k-skel" style={{ width: widths[i % widths.length] }} />
      ))}
      {label ? (
        <div className="k-loading-line">
          <span className="k-spin" aria-hidden="true" />
          {label}
        </div>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </div>
  );
}

export type KitBannerTone = "danger" | "warn" | "info" | "ok";

const BANNER_ICONS: Record<KitBannerTone, React.ComponentType<{ "aria-hidden"?: boolean }>> = {
  danger: AlertCircle,
  warn: AlertCircle,
  info: Info,
  ok: CheckCircle2,
};

/** An inline problem, warning or note. */
export function KitBanner({
  tone = "info",
  children,
  onDismiss,
  action,
  className,
  "data-testid": testId,
  dismissTestId,
}: {
  tone?: KitBannerTone;
  children: React.ReactNode;
  onDismiss?: () => void;
  action?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
  dismissTestId?: string;
}): JSX.Element {
  const Icon = BANNER_ICONS[tone];
  return (
    <div
      className={cn("k-banner", className)}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
      data-slot="kit-banner"
      data-testid={testId}
    >
      <Icon aria-hidden />
      <div className="k-banner-text">{children}</div>
      {action}
      {onDismiss ? (
        <KitIconButton label="Dismiss" size="sm" onClick={onDismiss} data-testid={dismissTestId}>
          <XIcon />
        </KitIconButton>
      ) : null}
    </div>
  );
}
