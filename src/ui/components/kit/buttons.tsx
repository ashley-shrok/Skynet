import * as React from "react";

import { cn } from "@/lib/utils";

// Kit buttons. One button for every action inside a modal: the main action
// (primary), an ordinary one (secondary, the default), a plain text action,
// and two destructive weights. Look lives in kit.css; variants are data
// attributes so a single class carries every state.

export type KitButtonVariant =
  | "primary"
  | "secondary"
  | "plain"
  | "danger"
  | "danger-quiet";

export interface KitButtonProps extends React.ComponentProps<"button"> {
  variant?: KitButtonVariant;
  size?: "md" | "sm";
  /** Shows a spinner and blocks clicks while an action is in flight. */
  busy?: boolean;
  /** Stretches to the container's width. */
  full?: boolean;
}

export const KitButton = React.forwardRef<HTMLButtonElement, KitButtonProps>(
  function KitButton(
    { variant = "secondary", size = "md", busy, full, className, children, disabled, type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        data-slot="kit-button"
        data-variant={variant}
        data-size={size}
        data-full={full ? "true" : undefined}
        aria-busy={busy || undefined}
        disabled={disabled || busy}
        className={cn("k-btn", className)}
        {...props}
      >
        {busy ? <span className="k-spin" aria-hidden="true" /> : null}
        {children}
      </button>
    );
  },
);

export interface KitIconButtonProps extends Omit<React.ComponentProps<"button">, "aria-label"> {
  /** Required — icon-only buttons need a spoken name. Also the tooltip. */
  label: string;
  size?: "md" | "sm";
  /** A subtle filled circle (e.g. a close button that should read as one). */
  filled?: boolean;
  tone?: "default" | "danger";
}

export const KitIconButton = React.forwardRef<HTMLButtonElement, KitIconButtonProps>(
  function KitIconButton(
    { label, size = "md", filled, tone = "default", className, title, type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={title ?? label}
        data-slot="kit-icon-button"
        data-size={size}
        data-filled={filled ? "true" : undefined}
        data-tone={tone === "danger" ? "danger" : undefined}
        className={cn("k-icon-btn", className)}
        {...props}
      />
    );
  },
);

/** Inline spinner (busy indicator for places that aren't a button). */
export function KitSpinner({ className }: { className?: string }): JSX.Element {
  return <span className={cn("k-spin", className)} role="status" aria-label="Loading" />;
}
